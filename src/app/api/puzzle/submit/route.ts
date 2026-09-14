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

    return NextResponse.json({ success: true, submissionId: docRef.id });
  } catch (error) {
    console.error("[api/puzzle/submit] 投稿失敗：", error);
    return NextResponse.json({ error: "投稿失敗，請稍後再試。" }, { status: 500 });
  }
}
