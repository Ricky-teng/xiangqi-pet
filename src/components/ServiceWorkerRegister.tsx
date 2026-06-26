/**
 * src/components/ServiceWorkerRegister.tsx
 *
 * 掛在 root layout 裡，App 啟動時註冊 public/sw.js。
 * 純粹的副作用元件，不渲染任何畫面內容。
 * 用 try/catch 包起來，註冊失敗（例如瀏覽器不支援、開發環境某些設定）
 * 只記錄 console，不影響其他功能正常運作。
 */

"use client";

import { useEffect } from "react";

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("[ServiceWorkerRegister] 註冊 Service Worker 失敗：", error);
    });
  }, []);

  return null;
}
