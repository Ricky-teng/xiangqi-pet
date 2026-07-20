/**
 * src/app/api/friends/accept/route.ts
 *
 * 接受好友邀請。
 * ------------------------------------------------------------
 * 這是好友系統裡唯一真正需要「同時寫兩個人的文件」的操作：接受後
 * 雙方的 friends 陣列都要加上對方。一般前端 client SDK 只能寫自己
 * 的 users 文件，寫不了對方的，所以這裡改用 Firebase Admin SDK
 * （繞過安全規則）在伺服器端一次把兩邊都寫好，用 Firestore 的
 * batch write 確保兩邊要嘛一起成功、要嘛一起失敗。
 *
 * 呼叫者（Authorization header 驗證出的 uid）就是「接受邀請的人」，
 * body 帶 fromUid 表示「邀請是誰發的」。
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { sendPushToUser } from "@/lib/server/push";

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

  if (fromUid === toUid) {
    return NextResponse.json({ error: "不能加自己好友。" }, { status: 400 });
  }

  try {
    const db = getAdminDb();
    const [fromSnap, toSnap] = await Promise.all([
      db.collection("users").doc(fromUid).get(),
      db.collection("users").doc(toUid).get(),
    ]);

    if (!fromSnap.exists) {
      return NextResponse.json({ error: "邀請人帳號不存在（可能已被刪除）。" }, { status: 404 });
    }

    // 保險檢查：這個邀請真的存在（fromUid 的 outgoingFriendRequestUids 裡確實有 toUid），
    // 避免有人亂傳 fromUid 硬是把自己塞成別人好友。
    const fromOutgoing: string[] = fromSnap.data()?.outgoingFriendRequestUids ?? [];
    if (!fromOutgoing.includes(toUid)) {
      return NextResponse.json({ error: "找不到這筆好友邀請，可能已經被取消了。" }, { status: 404 });
    }

    const batch = db.batch();
    batch.update(db.collection("users").doc(fromUid), {
      friends: FieldValue.arrayUnion(toUid),
      outgoingFriendRequestUids: FieldValue.arrayRemove(toUid),
      updatedAt: Date.now(),
    });
    batch.update(db.collection("users").doc(toUid), {
      friends: FieldValue.arrayUnion(fromUid),
      dismissedFriendRequestUids: FieldValue.arrayRemove(fromUid),
      updatedAt: Date.now(),
    });
    await batch.commit();

    const toName = (toSnap.data()?.displayName as string | undefined) ?? "同學";
    await sendPushToUser(fromUid, {
      title: "🎉 好友邀請被接受了",
      body: `${toName} 接受了你的好友邀請`,
      url: "/friends",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/friends/accept] 失敗：", error);
    return NextResponse.json({ error: "接受好友邀請失敗，請稍後再試一次。" }, { status: 500 });
  }
}
