/**
 * src/hooks/usePetTimeDecayTicker.ts
 *
 * 開著 App 期間，定期重新檢查小雞的飽食度/生病時間衰退。
 * ------------------------------------------------------------
 * useAuthBootstrap 只在「登入狀態改變的那一刻」（包含每次重新整理
 * 頁面）算一次時間流逝，這個 hook 補上「使用者開著同一個分頁很久
 * 沒有重新整理」的情境：每隔一段時間（預設 60 秒）就重新檢查一次，
 * 讓飽食度條、生病加重這些效果在畫面上看起來像是「真的會自己變化」，
 * 不需要使用者手動重新整理頁面才會更新。
 *
 * 應該只在 App 裡掛載一次（見 AuthProvider.tsx），跟
 * useAuthBootstrap 掛在同一個地方。
 */

import { useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { applyPetTimeDecay } from "@/lib/pet/petDecay";

/** 開著 App 期間，每隔多久重新檢查一次小雞的時間衰退（毫秒） */
const CHECK_INTERVAL_MS = 60 * 1000;

export function usePetTimeDecayTicker(): void {
  useEffect(() => {
    const intervalId = setInterval(() => {
      const { pet, setPet, setPetAlertMessage } = useGameStore.getState();
      if (!pet) return;

      const result = applyPetTimeDecay(pet, Date.now());
      if (!result.changed) return;

      setPet(result.pet);

      updateDoc(doc(db, "pets", pet.uid), {
        fullness: result.pet.fullness,
        lastFedTime: result.pet.lastFedTime,
        healthStatus: result.pet.healthStatus,
        sickStartTime: result.pet.sickStartTime,
        severeSickStartTime: result.pet.severeSickStartTime,
        notifiedFlags: result.pet.notifiedFlags,
        updatedAt: result.pet.updatedAt,
      }).catch((error) => {
        console.error("[usePetTimeDecayTicker] 同步寫回 Firestore 失敗：", error);
      });

      if (result.notifications.length > 0) {
        setPetAlertMessage(result.notifications.join("\n"));
      }
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);
}
