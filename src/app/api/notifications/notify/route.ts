/**
 * src/app/api/notifications/notify/route.ts
 *
 * 通用推播 API：前端做完「自己能做的那一半」Firestore 寫入
 * （例如把好友邀請寫進自己的 outgoingFriendRequestUids）之後，呼叫
 * 這支 API 通知對方——因為發送 FCM 推播一定要伺服器端的服務帳戶
 * 憑證，前端不可能也不應該擁有這個權限。
 *
 * 只驗證呼叫者「有登入」，不特別限制要跟 toUid 有什麼關係，因為
 * 推播內容都是伺服器這邊照 type 決定的固定文字，呼叫者沒辦法亂塞
 * 自訂文字亂發垃圾訊息。
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { sendPushToUser } from "@/lib/server/push";
import { getAdminDb } from "@/lib/server/firebaseAdmin";

type NotifyType =
  | "friend_request"
  | "friend_accept"
  | "battle_challenge"
  | "battle_challenge_declined"
  | "match_challenge"
  | "match_challenge_declined"
  | "chat_message";

const TEMPLATES: Record<NotifyType, (fromName: string) => { title: string; body: string; url: string }> = {
  friend_request: (fromName) => ({
    title: "🐣 新的好友邀請",
    body: `${fromName} 想加你為好友`,
    url: "/friends",
  }),
  friend_accept: (fromName) => ({
    title: "🎉 好友邀請被接受了",
    body: `${fromName} 接受了你的好友邀請`,
    url: "/friends",
  }),
  battle_challenge: (fromName) => ({
    title: "⚔️ 有人向你下戰帖",
    body: `${fromName} 邀請你殘局對戰，快去看看吧`,
    url: "/friends",
  }),
  battle_challenge_declined: (fromName) => ({
    title: "對戰邀請被婉拒了",
    body: `${fromName} 現在沒空對戰，飼料已經退還給你了`,
    url: "/friends",
  }),
  match_challenge: (fromName) => ({
    title: "♟️ 有人向你發出對局邀請",
    body: `${fromName} 邀請你下一整盤棋，快去看看吧`,
    url: "/friends",
  }),
  match_challenge_declined: (fromName) => ({
    title: "對局邀請被婉拒了",
    body: `${fromName} 現在沒空下棋，飼料已經退還給你了`,
    url: "/friends",
  }),
  // 聊天訊息是唯一一個「內容不是伺服器固定文字」的通知類型——這裡
  // body 先給預設值，實際處理時會用 buildChatMessageTemplate() 換成
  // 訊息預覽（見下面 POST handler，需要先驗證雙方是不是好友才會用
  // 呼叫端傳來的文字，避免被亂塞垃圾訊息）。
  chat_message: (fromName) => ({
    title: `💬 ${fromName}`,
    body: "傳了一則新訊息給你",
    url: "/chat",
  }),
};

const CHAT_PREVIEW_MAX_LENGTH = 60;

function buildChatMessageTemplate(fromName: string, fromUid: string, previewText: string) {
  const trimmed = previewText.trim();
  const preview = trimmed.length > CHAT_PREVIEW_MAX_LENGTH
    ? `${trimmed.slice(0, CHAT_PREVIEW_MAX_LENGTH)}…`
    : trimmed;
  return {
    title: `💬 ${fromName}`,
    body: preview || "傳了一則新訊息給你",
    url: `/chat/${fromUid}`,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤，應為 JSON。" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "請求格式錯誤。" }, { status: 400 });
  }

  const { toUid, type, previewText } = body as { toUid?: unknown; type?: unknown; previewText?: unknown };
  if (typeof toUid !== "string" || !toUid) {
    return NextResponse.json({ error: "缺少 toUid。" }, { status: 400 });
  }
  if (typeof type !== "string" || !(type in TEMPLATES)) {
    return NextResponse.json({ error: "未知的通知類型。" }, { status: 400 });
  }

  let fromUid: string;
  try {
    fromUid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const db = getAdminDb();
    const fromSnap = await db.collection("users").doc(fromUid).get();
    const fromName = (fromSnap.data()?.displayName as string | undefined) ?? "同學";

    let template: { title: string; body: string; url: string };

    if (type === "chat_message") {
      // 聊天訊息預覽文字是呼叫端傳來的，跟其他通知類型「內容完全固定」
      // 不一樣，所以要先驗證雙方真的是好友才會採用這段文字，避免有人
      // 拿這支 API 對任意 toUid 亂塞垃圾推播內容。不是好友就退回固定文字。
      const friends: string[] = fromSnap.data()?.friends ?? [];
      const isFriend = friends.includes(toUid);
      const preview = typeof previewText === "string" ? previewText : "";
      template = isFriend
        ? buildChatMessageTemplate(fromName, fromUid, preview)
        : TEMPLATES.chat_message(fromName);
    } else {
      template = TEMPLATES[type as NotifyType](fromName);
    }

    await sendPushToUser(toUid, template);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/notifications/notify] 發送失敗：", error);
    // 推播失敗不算嚴重錯誤（不影響前端已經完成的主要操作），回 200 讓前端不用特別處理
    return NextResponse.json({ success: false });
  }
}
