/**
 * src/lib/firebase.ts
 *
 * Firebase 用戶端 SDK 初始化
 * ------------------------------------------------------------
 * 職責：
 *   1. 以 NEXT_PUBLIC_FIREBASE_* 環境變數初始化 Firebase App。
 *      這些 config 值本來就是設計給瀏覽器端公開使用的（安全性由
 *      Firestore Security Rules 把關，不是靠隱藏 config 值），
 *      因此全部使用 process.env 注入，絕對不寫死任何真實金鑰。
 *   2. 匯出 Firestore 實例 db，供其他檔案
 *      透過 `import { db } from "@/lib/firebase"` 取用
 *      （例如 src/app/puzzle/[id]/page.tsx 用它讀取題目資料）。
 *
 * 重要設計說明：
 *   - 用 getApps().length 判斷是否已經初始化過，避免 Next.js 開發模式下
 *     Fast Refresh / HMR 重複呼叫 initializeApp() 而拋出
 *     "Firebase App named '[DEFAULT]' already exists" 錯誤。
 *   - 僅在非正式環境（NODE_ENV !== "production"）且偵測到環境變數缺漏時，
 *     於 console 印出警告方便除錯；正式環境不印出任何設定細節。
 *   - 目前已加入 Firebase Auth（getAuth），供 Email/密碼登入、註冊、登出
 *     使用，詳見 src/hooks/useAuth.ts。
 */

import {
  initializeApp,
  getApps,
  getApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";

// ============================================================
// 1. Firebase 設定（全部從環境變數注入，不寫死任何金鑰）
// ============================================================

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// ============================================================
// 2. 開發模式檢查：缺少必要環境變數時提早警告
//    （避免日後忘記設定 .env.local，卻要到 Firestore 呼叫失敗時才發現）
// ============================================================

const REQUIRED_ENV_ENTRIES: Array<{ configKey: keyof FirebaseOptions; envVarName: string }> = [
  { configKey: "apiKey", envVarName: "NEXT_PUBLIC_FIREBASE_API_KEY" },
  { configKey: "authDomain", envVarName: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN" },
  { configKey: "projectId", envVarName: "NEXT_PUBLIC_FIREBASE_PROJECT_ID" },
  { configKey: "storageBucket", envVarName: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET" },
  { configKey: "messagingSenderId", envVarName: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID" },
  { configKey: "appId", envVarName: "NEXT_PUBLIC_FIREBASE_APP_ID" },
];

if (process.env.NODE_ENV !== "production") {
  const missingEnvVarNames = REQUIRED_ENV_ENTRIES.filter(
    (entry) => !firebaseConfig[entry.configKey]
  ).map((entry) => entry.envVarName);

  if (missingEnvVarNames.length > 0) {
    console.warn(
      `[firebase] 偵測到缺少以下環境變數，Firebase 可能無法正常運作：${missingEnvVarNames.join(
        ", "
      )}。請確認 .env.local 是否已正確設定，並重新啟動開發伺服器（環境變數只在啟動時讀取一次）。`
    );
  }
}

// ============================================================
// 3. 初始化 App（避免 HMR 重複初始化）
// ============================================================

const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// ============================================================
// 4. 匯出 Firestore 實例
// ============================================================

/** Firestore 實例，供其他檔案直接 `import { db } from "@/lib/firebase"` 使用 */
export const db: Firestore = getFirestore(app);

/**
 * Firebase Auth 實例，供登入/註冊/登出相關程式碼使用
 * （見 src/hooks/useAuth.ts、src/app/login/page.tsx）。
 */
export const auth: Auth = getAuth(app);

export default app;
