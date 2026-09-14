/**
 * src/app/api/puzzle/submissions/ack/route.ts
 *
 * 學生看過投稿審核結果的彈窗之後，標記成「已通知」，下次開 App 就不
 * 會再跳同一則。
 * ------------------------------------------------------------
 * 為什麼要一支 API 而不是讓 client 直接寫：puzzleSubmissions 的安全
 * 規則是 `allow write: if false`（所有寫入都走 Admin SDK），刻意不開
 * 放給 client——開放的話學生就能自己改 status、偽造審核結果。這支
 * API 只允許把「自己的」投稿的 notifiedToStudent 改成 true，其他欄位
 * 一律不動。
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";

export async function POST(request: Request) {
  let uid: string;
  try {
    uid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  let body: { submissionIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const { submissionIds } = body;
  if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
    return NextResponse.json({ error: "缺少要標記的投稿 id" }, { status: 400 });
  }

  const db = getAdminDb();

  try {
    const batch = db.batch();
    let updatedCount = 0;

    // 一筆一筆確認「這真的是這個學生自己的投稿」再標記，不能只信任
    // 前端傳來的 id——否則有人可以把別人的通知標記成已讀，讓對方永遠
    // 看不到自己的審核結果。
    for (const submissionId of submissionIds.slice(0, 20)) {
      if (typeof submissionId !== "string") continue;
      const ref = db.collection("puzzleSubmissions").doc(submissionId);
      const snapshot = await ref.get();
      if (!snapshot.exists) continue;
      if (snapshot.data()?.studentUid !== uid) continue;
      batch.update(ref, { notifiedToStudent: true });
      updatedCount += 1;
    }

    if (updatedCount > 0) await batch.commit();
    return NextResponse.json({ success: true, updatedCount });
  } catch (error) {
    console.error("[api/puzzle/submissions/ack] 標記已通知失敗：", error);
    return NextResponse.json({ error: "標記失敗" }, { status: 500 });
  }
}
