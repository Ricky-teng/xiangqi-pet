/**
 * src/app/api/puzzle/submissions/review/route.ts
 *
 * 老師審核學生投稿的題目（見 PuzzleSubmissionDoc）。
 * ------------------------------------------------------------
 * 通過（approve）時要一次做三件事，而且必須全部成功或全部不做：
 *   1. 建立正式的 puzzles 文件
 *   2. 把投稿標記成 approved，記下產生的題目 id 跟獎勵金額
 *   3. 發飼料給投稿的學生
 * 所以整段包在 Firestore transaction 裡。否則中途失敗可能出現「題目
 * 建好了但學生沒拿到獎勵」或是「重複點兩次審核通過，發了兩次飼料」
 * 這種對不起來的狀況。
 *
 * 權限：只有 role === "teacher" 的帳號能呼叫。這件事一定要在伺服器端
 * 檢查——client 端的路由保護只是 UI 層的方便，繞過非常容易。
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { getSubmissionReward } from "@/lib/puzzleSubmission";

export async function POST(request: Request) {
  let uid: string;
  try {
    uid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  let body: {
    submissionId?: string;
    action?: "approve" | "reject";
    rejectReason?: string;
    // approve 時老師補上的題目內容
    level?: number;
    title?: string;
    description?: string;
    moves?: string[];
    alternativeLines?: string[][];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const { submissionId, action } = body;
  if (typeof submissionId !== "string" || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "缺少必要參數" }, { status: 400 });
  }

  const db = getAdminDb();

  // 權限檢查：一定要在伺服器端做
  const reviewerSnapshot = await db.collection("users").doc(uid).get();
  if (reviewerSnapshot.data()?.role !== "teacher") {
    return NextResponse.json({ error: "只有老師可以審核投稿。" }, { status: 403 });
  }

  const submissionRef = db.collection("puzzleSubmissions").doc(submissionId);

  try {
    if (action === "reject") {
      const result = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(submissionRef);
        if (!snapshot.exists) throw new Error("找不到這筆投稿");
        if (snapshot.data()?.status !== "pending") throw new Error("這筆投稿已經審核過了");

        tx.update(submissionRef, {
          status: "rejected",
          reviewedAt: Date.now(),
          reviewedBy: uid,
          rejectReason: typeof body.rejectReason === "string" ? body.rejectReason.slice(0, 200) : "",
        });
        return { success: true };
      });
      return NextResponse.json(result);
    }

    // ---- approve ----
    const { level, title, description, moves, alternativeLines } = body;
    if (typeof level !== "number" || level < 1 || level > 10) {
      return NextResponse.json({ error: "請設定 1-10 的題目難度" }, { status: 400 });
    }
    if (typeof title !== "string" || title.trim() === "") {
      return NextResponse.json({ error: "請填寫題目標題" }, { status: 400 });
    }
    if (!Array.isArray(moves) || moves.length === 0 || moves.some((m) => typeof m !== "string")) {
      return NextResponse.json({ error: "請填寫正解走法序列" }, { status: 400 });
    }

    // 其他解法（選填）。注意 Firestore 不支援「陣列裡直接放陣列」，
    // 所以要包成 { moves: [...] }[]（見 PuzzleDoc.alternativeLines 的
    // 說明，直接存 string[][] 會讓寫入直接拋錯）。
    const normalizedAlternatives = Array.isArray(alternativeLines)
      ? alternativeLines
          .filter((line) => Array.isArray(line) && line.length > 0 && line.every((m) => typeof m === "string"))
          .map((line) => ({ moves: line }))
      : [];

    const result = await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(submissionRef);
      if (!snapshot.exists) throw new Error("找不到這筆投稿");
      const submission = snapshot.data()!;
      if (submission.status !== "pending") throw new Error("這筆投稿已經審核過了");

      const studentRef = db.collection("users").doc(submission.studentUid);
      const studentSnapshot = await tx.get(studentRef);
      if (!studentSnapshot.exists) throw new Error("找不到投稿的學生資料");

      const now = Date.now();
      const awardedFood = getSubmissionReward(level as 1);
      const puzzleRef = db.collection("puzzles").doc();

      tx.set(puzzleRef, {
        id: puzzleRef.id,
        level,
        title: title.trim(),
        description: typeof description === "string" ? description.trim() : "",
        initialFen: submission.fen,
        moves,
        alternativeLines: normalizedAlternatives,
        totalSteps: moves.length,
        // 記錄原始投稿者，之後想在題目頁顯示「本題由 OO 同學提供」很方便
        createdBy: uid,
        submittedByUid: submission.studentUid,
        submittedByName: submission.studentName,
        isPublished: true,
        createdAt: now,
        updatedAt: now,
      });

      tx.update(submissionRef, {
        status: "approved",
        reviewedAt: now,
        reviewedBy: uid,
        createdPuzzleId: puzzleRef.id,
        awardedFood,
      });

      tx.update(studentRef, {
        foodCount: FieldValue.increment(awardedFood),
        updatedAt: now,
      });

      return { success: true, puzzleId: puzzleRef.id, awardedFood };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/puzzle/submissions/review] 審核失敗：", error);
    const message = error instanceof Error ? error.message : "審核失敗，請稍後再試。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
