/**
 * src/app/api/puzzle/submit/route.ts
 *
 * 學生投稿題目：從對弈回放頁挑一個局面送出，寫進 puzzleSubmissions
 * 等老師審核（見 PuzzleSubmissionDoc 的說明）。
 * ------------------------------------------------------------
 * 走 Admin SDK 而不是讓 client 直接寫，有兩個理由：
 *   1. 要在伺服器端檢查「這個學生目前有幾筆待審核」，client 自己檢查
 *      的話可以直接繞過。
 *   2. studentName 要從 users 文件讀，不能信任前端傳來的名字，不然
 *      學生可以冒用別人的名字投稿。
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { MAX_PENDING_SUBMISSIONS_PER_STUDENT } from "@/lib/puzzleSubmission";
import { findMateSequence } from "@/lib/engine/pikafishProcess";
import { getTaipeiDateString } from "@/lib/server/serverDate";

// 投稿時會同步跑一次 Pikafish 分析（約 6 秒搜尋＋子程序啟動開銷）。
// 放在請求裡同步做是刻意的：Vercel 的 serverless 在回應送出後就會
// 終止程序，沒辦法可靠地「先回應、再背景分析」。學生多等幾秒，換到
// 的是立刻知道自己挑的局面行不行，老師那邊也不用再等分析。
export const maxDuration = 30;

/** 題目最多接受幾步殺（跟 /api/puzzle/verify-mate 保持一致） */
const MAX_MATE_IN = 10;

export async function POST(request: Request) {
  let uid: string;
  try {
    uid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  let body: { fen?: string; sourceGameId?: string; sourceStep?: number; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const { fen, sourceGameId, sourceStep, note } = body;
  if (typeof fen !== "string" || fen.trim() === "") {
    return NextResponse.json({ error: "缺少局面資料" }, { status: 400 });
  }
  if (typeof sourceGameId !== "string" || typeof sourceStep !== "number") {
    return NextResponse.json({ error: "缺少來源對局資料" }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    // 防洗：同時最多只能有 MAX_PENDING_SUBMISSIONS_PER_STUDENT 筆待審核
    const pendingSnapshot = await db
      .collection("puzzleSubmissions")
      .where("studentUid", "==", uid)
      .where("status", "==", "pending")
      .get();

    if (pendingSnapshot.size >= MAX_PENDING_SUBMISSIONS_PER_STUDENT) {
      return NextResponse.json(
        {
          error: `你已經有 ${pendingSnapshot.size} 筆投稿在等老師審核了，等老師看完再投稿新的吧！`,
        },
        { status: 429 }
      );
    }

    // 同一個局面不要重複投稿（同一局的同一步）
    const duplicateSnapshot = await db
      .collection("puzzleSubmissions")
      .where("studentUid", "==", uid)
      .where("sourceGameId", "==", sourceGameId)
      .where("sourceStep", "==", sourceStep)
      .limit(1)
      .get();

    if (!duplicateSnapshot.empty) {
      return NextResponse.json({ error: "這個局面你已經投稿過了。" }, { status: 409 });
    }

    // 名字從 users 文件讀，不信任前端傳來的值
    const userSnapshot = await db.collection("users").doc(uid).get();
    const studentName = (userSnapshot.data()?.displayName as string) ?? "同學";

    // ---- AI 自動分析：投稿當下就跑完，老師打開審核頁直接看結果 ----
    // 結果寫進「只有老師能讀」的 puzzleSubmissionAnalysis 集合，不放在
    // 投稿文件裡——學生讀得到自己的投稿，放一起等於讓他提前知道會不會過。
    // 分析失敗不該讓整筆投稿失敗（引擎有可能忙線或逾時），所以包在
    // 自己的 try 裡，失敗就留空，審核頁會退回手動分析的流程。
    let aiAnalysis: Record<string, unknown> | undefined;
    try {
      const result = await findMateSequence(fen.trim(), "w", MAX_MATE_IN);
      const [mainLine] = result.lines;
      aiAnalysis = {
        hasMate: result.hasMate,
        mateIn: result.hasMate ? mainLine.mateIn : result.mateIn,
        lines: result.lines,
        message: result.hasMateButIncomplete
          ? `偵測到 ${result.mateIn} 步殺，但引擎沒有回報完整的殺法序列，請按「重新分析」或自行填寫答案。`
          : result.hasMate
            ? `✅ 紅方 ${mainLine.mateIn} 步殺${
                result.lines.length > 1 ? `，共找到 ${result.lines.length} 種解法` : ""
              }。`
            : result.mateIn !== null && result.mateIn < 0
              ? `紅方在這個局面反而會被黑方在 ${Math.abs(result.mateIn)} 步內將死，建議駁回。`
              : `紅方在 ${MAX_MATE_IN} 步內找不到強制勝，建議駁回。`,
        analyzedAt: Date.now(),
      };
    } catch (error) {
      console.error("[api/puzzle/submit] AI 分析失敗（不影響投稿本身）：", error);
    }

    const docRef = db.collection("puzzleSubmissions").doc();
    await docRef.set({
      id: docRef.id,
      studentUid: uid,
      studentName,
      fen: fen.trim(),
      sourceGameId,
      sourceStep,
      note: typeof note === "string" ? note.slice(0, 200) : "",
      status: "pending",
      submittedAt: Date.now(),
    });

    if (aiAnalysis) {
      await db
        .collection("puzzleSubmissionAnalysis")
        .doc(docRef.id)
        .set({ submissionId: docRef.id, ...aiAnalysis });
    }

    // ---- 每日任務「投稿殘局」的進度 ----
    // 在伺服器端遞增，不讓 client 自己寫，否則不投稿也能把進度改成達標。
    // 日期一定要用台北時區算（見 serverDate.ts）：Vercel 伺服器是 UTC，
    // 直接用本地時區會跟學生端差 8 小時，導致任務進度對不起來。
    const today = getTaipeiDateString();
    const prevProgress = userSnapshot.data()?.dailyPuzzleSubmitProgress as
      | { date: string; count: number }
      | undefined;
    const newCount = prevProgress?.date === today ? prevProgress.count + 1 : 1;
    const dailyPuzzleSubmitProgress = { date: today, count: newCount };
    await db.collection("users").doc(uid).update({
      dailyPuzzleSubmitProgress,
      updatedAt: Date.now(),
    });

    // 回應刻意「不」帶任何 AI 分析的內容：審核結果要等老師決定，
    // 學生不該在投稿當下就知道自己會不會過。
    return NextResponse.json({
      success: true,
      submissionId: docRef.id,
      dailyPuzzleSubmitProgress,
    });
  } catch (error) {
    console.error("[api/puzzle/submit] 投稿失敗：", error);
    return NextResponse.json({ error: "投稿失敗，請稍後再試。" }, { status: 500 });
  }
}
