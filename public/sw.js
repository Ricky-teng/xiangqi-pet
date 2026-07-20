/**
 * public/sw.js
 *
 * Service Worker — 有更新就通知前端，不積極快取動態資料
 * ------------------------------------------------------------
 * 核心策略跟之前一樣 network-first（有網路就抓最新，網路失敗才用快取），
 * 但加了「有新版本就立刻接管」的機制：
 *
 *   1. install 完成後立刻呼叫 skipWaiting()，不等舊分頁關掉才啟用。
 *   2. activate 時 clients.claim() 讓新 SW 馬上接管所有已開的分頁。
 *   3. activate 完成後對所有分頁送一則 "SW_UPDATED" 訊息。
 *   4. 前端（ServiceWorkerRegister.tsx）收到這則訊息就顯示
 *      「有新版本，點此重新整理」的提示條。
 *
 * 為什麼不在 install 事件送訊息：install 完成時新 SW 還沒接管，
 * 分頁還在聽舊 SW，postMessage 送過去沒有人接收。要等 activate
 * 完成（也就是 clients.claim() 完成）才能確定這些分頁都在聽新 SW。
 *
 * ⚠️ 這個檔案同時也是 FCM 推播用的 Service Worker（見檔案最下面），
 * 兩個功能刻意合併在同一個檔案裡、共用同一個 scope（"/"）——
 * 一個網站在同一個 scope 下只能有一個 Service Worker 生效，如果另外
 * 建一個 firebase-messaging-sw.js 各自 register()，後註冊的會直接
 * 蓋掉先註冊的，兩邊都會壞掉，所以推播邏輯改成 importScripts 合併
 * 進這裡，而不是獨立檔案。
 */

const SHELL_CACHE_NAME = "xiangqi-pet-shell-v2";
const SHELL_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: "window" }).then((clients) => {
          clients.forEach((client) => client.postMessage({ type: "SW_UPDATED" }));
        })
      )
  );
});

// Network-first：永遠先試著抓最新資料，只有在「完全沒網路、連線失敗」
// 時才退回快取的外殼頁面，避免任何時候優先顯示舊資料。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches
        .match(event.request)
        .then((cached) => cached ?? caches.match("/"))
    )
  );
});

// ============================================================
// FCM 背景推播
// ------------------------------------------------------------
// ⚠️ 下面這組設定值要「手動」貼上你的真實 Firebase 專案設定，
// 跟 Vercel 環境變數裡的 NEXT_PUBLIC_FIREBASE_* 是同一組值（Firebase
// Console → 專案設定 → 一般 → 你的應用程式 可以找到）。這個檔案是
// 靜態檔案，Next.js 建置時不會把 process.env 注入進來，所以要手動填。
// 這些本來就是設計給瀏覽器端公開的值，不是機密金鑰，可以放心寫在
// 這個公開檔案裡。部署後如果推播完全沒作用，第一件事就是檢查這裡
// 有沒有忘記填。
// ============================================================

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyBlYA2f_nTRpZuHwcg-jNyQA_ZUcU5idy8",
  authDomain: "xiangqi-pet.firebaseapp.com",
  projectId: "xiangqi-pet",
  storageBucket: "xiangqi-pet.firebasestorage.app",
  messagingSenderId: "634733436051",
  appId: "1:634733436051:web:7291dd426189052640c166"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? "象棋寵物";
  const body = payload.notification?.body ?? "";
  const url = payload.fcmOptions?.link ?? payload.data?.url ?? "/";

  self.registration.showNotification(title, {
    body,
    icon: "/icons/icon-192.png",
    data: { url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
