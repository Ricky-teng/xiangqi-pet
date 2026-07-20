// src/lib/server/verifyAuth.ts
/**
 * API route 共用：驗證前端請求帶來的 Firebase ID Token，確認呼叫者
 * 真的是他自己宣稱的那個 uid，不是隨便誰都能冒充別人發好友邀請/
 * 對戰挑戰、或亂改別人的資料。
 *
 * 前端呼叫慣例：Authorization: Bearer <idToken>
 * （idToken 從 firebase/auth 的 `user.getIdToken()` 拿）
 */

import { getAdminAuth } from "@/lib/server/firebaseAdmin";

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

/** 從 Request 的 Authorization header 驗證身分，回傳已驗證的 uid */
export async function verifyRequestAuth(request: Request): Promise<string> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    throw new AuthError("缺少身分驗證，請重新登入後再試一次。");
  }

  const idToken = header.slice("Bearer ".length).trim();
  if (!idToken) {
    throw new AuthError("缺少身分驗證，請重新登入後再試一次。");
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    return decoded.uid;
  } catch (error) {
    console.error("[verifyRequestAuth] token 驗證失敗：", error);
    throw new AuthError("登入狀態已過期，請重新登入後再試一次。");
  }
}
