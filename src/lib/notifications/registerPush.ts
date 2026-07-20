// src/lib/notifications/registerPush.ts
/**
 * 瀏覽器端推播註冊流程：
 *   1. 檢查瀏覽器支不支援（Service Worker + Notification API + FCM）
 *   2. 跟使用者要通知權限（一定要使用者主動點按鈕觸發，不能自動彈出，
 *      不然大多數瀏覽器會直接擋掉、以後也不會再問）
 *   3. 註冊 public/firebase-messaging-sw.js 這個 service worker
 *   4. 跟 FCM 要一個這台裝置專屬的 token
 *   5. 把 token 存進自己的 users/{uid}.fcmTokens 陣列（自己寫自己的
 *      文件，一般 client SDK 就能做，不需要伺服器 API）
 *
 * 呼叫時機：設定頁的「開啟推播通知」按鈕（見 src/app/settings/page.tsx），
 * 刻意不在登入當下自動觸發，尊重使用者自己決定要不要開。
 */

import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type PushRegistrationResult =
  | { status: "success" }
  | { status: "unsupported"; message: string }
  | { status: "permission_denied"; message: string }
  | { status: "error"; message: string };

export async function registerPushNotifications(uid: string): Promise<PushRegistrationResult> {
  if (typeof window === "undefined") {
    return { status: "unsupported", message: "只能在瀏覽器裡執行。" };
  }

  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return { status: "unsupported", message: "這個瀏覽器不支援推播通知。" };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { status: "permission_denied", message: "沒有取得通知權限，無法開啟推播（可能被拒絕或忽略了）。" };
    }

    // 動態載入 firebase/messaging，避免這段程式碼被打包進不支援的環境
    // （例如 SSR、或不支援 FCM 的瀏覽器）造成整包 import 失敗。
    const { getMessaging, getToken, isSupported } = await import("firebase/messaging");

    const supported = await isSupported();
    if (!supported) {
      return { status: "unsupported", message: "這個瀏覽器不支援 Firebase 推播。" };
    }

    // 跟 ServiceWorkerRegister.tsx 註冊的是同一個 /sw.js（FCM 推播邏輯已經
    // 合併進那個檔案，見該檔案最下面的說明），不是獨立的 service worker。
    const registration = await navigator.serviceWorker.register("/sw.js");

    const app = (await import("@/lib/firebase")).default;
    const messaging = getMessaging(app);

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      return { status: "error", message: "缺少 NEXT_PUBLIC_FIREBASE_VAPID_KEY 環境變數，請聯絡開發者設定。" };
    }

    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    if (!token) {
      return { status: "error", message: "取得推播 token 失敗，請稍後再試一次。" };
    }

    await updateDoc(doc(db, "users", uid), { fcmTokens: arrayUnion(token) });

    return { status: "success" };
  } catch (error) {
    console.error("[registerPushNotifications] 失敗：", error);
    return { status: "error", message: "開啟推播通知時發生錯誤，請稍後再試一次。" };
  }
}
