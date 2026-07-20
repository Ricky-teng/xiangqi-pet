// src/hooks/useAutoRegisterPush.ts
/**
 * 學生登入後自動開啟推播通知（預設開啟，不用使用者自己去設定頁點）。
 * ------------------------------------------------------------
 * 只在瀏覽器的 Notification 權限還是 "default"（從來沒問過）時才
 * 自動觸發一次；已經同意或已經拒絕過的，瀏覽器都不會再跳提示視窗
 * （拒絕過的話，就算我們呼叫 requestPermission() 也只會靜默拿到
 * "denied"，不會真的跳窗騷擾使用者），所以這裡可以放心每次登入都
 * 檢查，不會變成每次都跳提示。
 *
 * 用 ref 記錄「這次登入已經試過了」，避免同一次 session 裡 user
 * 物件因為其他原因重新渲染就又觸發一次。
 */

import { useEffect, useRef } from "react";
import { registerPushNotifications } from "@/lib/notifications/registerPush";

export function useAutoRegisterPush(uid: string | undefined, role: string | undefined): void {
  const triedRef = useRef(false);

  useEffect(() => {
    if (!uid || role !== "student") return;
    if (triedRef.current) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "default") return; // 已經問過（同意或拒絕）就不要再自動跳

    triedRef.current = true;
    registerPushNotifications(uid).catch((error) => {
      console.error("[useAutoRegisterPush] 自動開啟推播失敗：", error);
    });
  }, [uid, role]);
}
