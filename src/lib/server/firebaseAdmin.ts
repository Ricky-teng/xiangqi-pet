// src/lib/server/firebaseAdmin.ts
/**
 * Firebase Admin SDK 初始化（只能在伺服器端使用，例如 API routes）。
 * ------------------------------------------------------------
 * 跟 src/lib/firebase.ts（前端用的 client SDK）是完全不同的東西：
 * Admin SDK 用服務帳戶金鑰認證，擁有繞過 Firestore 安全規則的完整權限，
 * 只應該在信任的伺服器環境執行，絕對不能把這裡的任何金鑰打包進前端。
 *
 * 需要的環境變數（在 Vercel 專案設定 → Environment Variables 加入）：
 *   FIREBASE_ADMIN_PROJECT_ID
 *   FIREBASE_ADMIN_CLIENT_EMAIL
 *   FIREBASE_ADMIN_PRIVATE_KEY
 * 這三個值來自 Firebase Console → 專案設定 → 服務帳戶 → 產生新的私密金鑰
 * 下載的 JSON 檔案（分別對應 JSON 裡的 project_id / client_email / private_key）。
 *
 * private_key 貼到 Vercel 環境變數時，換行符號通常會被存成字面上的 "\n"
 * 兩個字元，所以下面用 .replace(/\\n/g, "\n") 還原成真正的換行，這是
 * Firebase Admin SDK 官方文件也會提到的常見處理方式。
 */

import { getApps, initializeApp, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getAuth } from "firebase-admin/auth";

let cachedApp: App | null = null;

function getAdminApp(): App {
  if (cachedApp) return cachedApp;

  const existing = getApps();
  if (existing.length > 0) {
    cachedApp = existing[0];
    return cachedApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "[firebaseAdmin] 缺少 Firebase Admin 環境變數（FIREBASE_ADMIN_PROJECT_ID / " +
        "FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY），請先在 Vercel 加好再重新部署。"
    );
  }

  cachedApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return cachedApp;
}

// 刻意用函式包起來、呼叫時才初始化（lazy），而不是在 import 當下就執行，
// 避免環境變數還沒設定時，任何不小心引用到這個檔案的地方（包括 build
// 階段的靜態分析）就直接整個炸掉。實際的 Firestore/Messaging/Auth
// 操作只會發生在 API route 真正被呼叫的當下。
export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export function getAdminMessaging() {
  return getMessaging(getAdminApp());
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}
