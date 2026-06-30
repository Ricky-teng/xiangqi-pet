/**
 * src/components/ServiceWorkerRegister.tsx
 *
 * 掛在 root layout 裡，App 啟動時註冊 public/sw.js，
 * 並監聽「有新版本」訊息，顯示更新提示條。
 * ------------------------------------------------------------
 * 更新流程：
 *   1. 瀏覽器每次開啟 App 時都會在背景重新下載 sw.js，如果檔案內容
 *      有任何一個 byte 不一樣，就判定為新版本，進入 install 排隊。
 *   2. 新版 sw.js 的 install 事件完成後會呼叫 skipWaiting()，立刻接管。
 *   3. activate 完成後 SW 對所有分頁送 "SW_UPDATED" 訊息。
 *   4. 這個元件收到訊息，把 showUpdateBanner 設為 true，出現提示條。
 *   5. 使用者點「立即更新」，呼叫 window.location.reload()，分頁重載
 *      後就會讀到新版的靜態資源，更新完成。
 *
 * 第一次安裝 App 時也會走一次 install → activate 流程，但那時分頁
 * 不是由舊版 SW 控制的（根本還沒有舊版 SW），clients.claim() 讓新
 * SW 接管，但因為這是「第一次安裝」，不應該顯示更新提示——
 * 用 navigator.serviceWorker.controller 判斷：如果 controller 是 null
 * 代表這個分頁是在「沒有 SW 控制」的狀態下開啟的（也就是第一次），
 * 不顯示更新提示；只有分頁已經被某個 SW 控制過，後來 SW 又更新接管，
 * 才顯示提示。
 */

"use client";

import { useEffect, useState } from "react";

export default function ServiceWorkerRegister() {
  const [showUpdateBanner, setShowUpdateBanner] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[ServiceWorkerRegister] 註冊 Service Worker 失敗：", error);
    });

    // 監聽 SW 發來的訊息。navigator.serviceWorker.controller 不是 null
    // 代表這個分頁原本就被舊版 SW 控制，現在新版 SW 接管 → 才顯示更新提示。
    // 第一次安裝（controller 是 null）不顯示，避免「你剛安裝完就跳出
    // 要你更新」這種奇怪的體驗。
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SW_UPDATED" && navigator.serviceWorker.controller) {
        setShowUpdateBanner(true);
      }
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
    };
  }, []);

  if (!showUpdateBanner) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[9999] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl bg-[#1A1A2E] px-4 py-3 shadow-xl"
    >
      <p className="text-sm font-semibold text-white">
        🎉 App 有新版本了！
      </p>
      <p className="mt-0.5 text-xs text-white/70">
        點擊下方按鈕重新整理，取得最新功能。
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex-1 rounded-xl bg-[#F6D87A] py-2 text-xs font-extrabold text-[#1A1A2E] transition-transform active:scale-95"
        >
          立即更新
        </button>
        <button
          type="button"
          onClick={() => setShowUpdateBanner(false)}
          className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/70 transition-transform active:scale-95"
        >
          稍後再說
        </button>
      </div>
    </div>
  );
}
