// src/lib/server/push.ts
/**
 * 推播發送共用函式，給各個 API route 呼叫。
 * ------------------------------------------------------------
 * 讀取指定使用者的 fcmTokens（存在 users/{uid} 文件上），對每個 token
 * 發送一則推播；如果某個 token 已經失效（使用者移除了 App、清了瀏覽器
 * 資料等等），FCM 會回傳特定錯誤代碼，這裡順便把失效的 token 從
 * Firestore 清掉，避免 fcmTokens 陣列一直塞垃圾、越送越慢。
 */

import { getAdminDb, getAdminMessaging } from "@/lib/server/firebaseAdmin";

const INVALID_TOKEN_ERROR_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

export interface PushPayload {
  title: string;
  body: string;
  /** 點推播要導去的頁面路徑，例如 "/friends" */
  url?: string;
}

/**
 * 對單一使用者發送推播（會發給他所有已知裝置的 token）。
 * 找不到使用者、沒有任何 token、或全部發送失敗都不會 throw——
 * 推播本來就是「錦上添花」的功能，失敗也不該讓呼叫端的主要操作
 * （例如加好友、送出挑戰）跟著失敗，所以這裡吞掉錯誤只記 log。
 */
export async function sendPushToUser(uid: string, payload: PushPayload): Promise<void> {
  try {
    const db = getAdminDb();
    const snap = await db.collection("users").doc(uid).get();
    if (!snap.exists) return;

    const tokens: string[] = snap.data()?.fcmTokens ?? [];
    if (tokens.length === 0) return;

    const messaging = getAdminMessaging();
    const invalidTokens: string[] = [];

    await Promise.all(
      tokens.map(async (token) => {
        try {
          await messaging.send({
            token,
            notification: { title: payload.title, body: payload.body },
            webpush: {
              fcmOptions: payload.url ? { link: payload.url } : undefined,
              notification: { icon: "/icons/icon-192.png" },
            },
          });
        } catch (error: unknown) {
          const code = (error as { code?: string } | null)?.code;
          if (code && INVALID_TOKEN_ERROR_CODES.has(code)) {
            invalidTokens.push(token);
          } else {
            console.error(`[push] 發送給 ${uid} 失敗：`, error);
          }
        }
      })
    );

    if (invalidTokens.length > 0) {
      const remaining = tokens.filter((t) => !invalidTokens.includes(t));
      await db.collection("users").doc(uid).update({ fcmTokens: remaining });
    }
  } catch (error) {
    console.error(`[push] sendPushToUser(${uid}) 整體失敗：`, error);
  }
}
