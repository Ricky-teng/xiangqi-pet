// src/lib/notifications/registerPush.ts
/**
 * 瀏覽器端推播註冊流程：
 *   1. 檢查瀏覽器支不支援（Service Worker + Notification API + FCM）
 *   2. 跟使用者要通知權限
 *   3. 註冊 public/sw.js 這個 service worker（FCM 邏輯已經合併進去）
 *   4. 跟 FCM 要一個這台裝置專屬的 token
 *   5. 把 token 存進自己的 users/{uid}.fcmTokens 陣列（自己寫自己的
 *      文件，一般 client SDK 就能做，不需要伺服器 API）
 *
 * 呼叫時機：
 *   - 自動：見 useAutoRegisterPush()，學生登入後、瀏覽器權限狀態還是
 *     「default」（從來沒問過）時自動觸發一次。瀏覽器的 Notification
 *     權限本來就是「問一次，之後同意/拒絕都記住」，所以自動觸發不會
 *     每次登入都跳提示——已經同意就直接靜默拿 token，已經拒絕就不會
 *     再自動跳（瀏覽器本身就不給再跳，要使用者自己去瀏覽器設定改）。
 *   - 手動：設定頁的「開啟推播通知」按鈕，給使用者之前拒絕、後來想
 *     再試一次的補救管道。
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
