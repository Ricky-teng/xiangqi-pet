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
