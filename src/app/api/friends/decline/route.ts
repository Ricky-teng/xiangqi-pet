/**
 * src/app/api/friends/decline/route.ts
 *
 * 拒絕好友邀請。
 * ------------------------------------------------------------
 * 跟 accept 一樣，需要動到「邀請人」的文件（把 toUid 從他的
 * outgoingFriendRequestUids 清掉），一般 client SDK 寫不到別人的
 * 文件，所以走這支 Admin SDK 的伺服器 API。
 *
 * 清掉之後，邀請人那邊會自動變回「還沒送出邀請」的狀態，之後可以
 * 重新加好友——不會像單純的「忽略」那樣卡在一個永遠 pending、
 * 邀請人猜不到发生什麼事、也沒辦法重新邀請的死狀態。
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤，應為 JSON。" }, { status: 400 });
  }

  const { fromUid } = (body ?? {}) as { fromUid?: unknown };
  if (typeof fromUid !== "string" || !fromUid) {
    return NextResponse.json({ error: "缺少 fromUid。" }, { status: 400 });
  }

  let toUid: string;
  try {
    toUid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const db = getAdminDb();
    await db.collection("users").doc(fromUid).update({
      outgoingFriendRequestUids: FieldValue.arrayRemove(toUid),
      updatedAt: Date.now(),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/friends/decline] 失敗：", error);
    return NextResponse.json({ error: "拒絕邀請失敗，請稍後再試一次。" }, { status: 500 });
  }
}
