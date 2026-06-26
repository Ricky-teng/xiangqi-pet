/**
 * public/sw.js
 *
 * 最小可行的 Service Worker，目的單純是滿足瀏覽器「可安裝 PWA」的條件
 * （Chrome/Android 在判斷要不要顯示「安裝應用程式」提示時，會檢查
 * 有沒有註冊 Service Worker），不是用來做積極的離線快取。
 *
 * 刻意不快取任何 Firestore/API 回應、不做任何「離線優先」的邏輯：
 * 這個 App 的核心畫面（飼料數量、小雞健康狀態、排行榜、題庫…）全部
 * 都是即時資料，如果 Service Worker 把這些內容快取起來，學生重新
 * 整理頁面時可能會看到「上次離線前」的舊資料，看起來像是資料跑掉、
 * bug，比完全沒有離線支援更糟。只快取一個不太會變的靜態外殼頁面，
 * 純粹讓「完全沒網路」時不會看到瀏覽器的恐龍錯誤畫面。
 */

const SHELL_CACHE_NAME = "xiangqi-pet-shell-v1";
const SHELL_URLS = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// Network-first：永遠先試著抓最新資料，只有在「完全沒網路、連線失敗」
// 時才退回快取的外殼頁面，避免任何時候優先顯示舊資料。
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached ?? caches.match("/"))
    )
  );
});
