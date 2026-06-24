/**
 * src/lib/pet/petDecay.ts
 *
 * 小雞「隨時間流逝」狀態衰退計算
 * ------------------------------------------------------------
 * PetDoc 裡 fullness / sickStartTime / severeSickStartTime /
 * notifiedFlags 這幾個欄位，從專案一開始的型別註解就寫著：
 *   - fullness: "飽食度 (0~100，每 4 小時自動 -5)"
 *   - sickStartTime: "開始生小病的時間點（過 4 小時未醫治則變大病）"
 *   - severeSickStartTime: "開始生大病的時間點（過 4 小時未醫治則死掉）"
 *   - notifiedFlags: 各種「是否已經通知過」的旗標
 * 但完全沒有任何程式碼真正計算/套用這些規則。本檔案把它接上。
 *
 * 重要限制（純前端 App 的本質限制，不是 bug）：
 *   這是純前端計算，不是後端排程。意思是「小雞的病情/飽食度」
 *   只會在「使用者實際打開 App 的時候」被重新計算、補上經過的時間，
 *   不會在使用者完全沒開 App 期間，伺服器自己在背景倒數計時、
 *   主動推播通知。只要學生定期會打開 App（簽到、解題），這個機制
 *   就能正確反映「該生病加重了」「該餓了」；如果想要做到「即使完全
 *   不開 App，4 小時後系統也要主動讓小雞變嚴重」，需要 Firebase
 *   Cloud Functions + Cloud Scheduler 排程（需要付費方案），是更大的
 *   工程，目前先用這個免費、夠用的版本。
 *
 * 使用方式：apply 函式是純函式（不直接碰 Firestore/Zustand），
 * 呼叫端（useAuth.ts 的 useAuthBootstrap、新的 usePetTimeDecayTicker）
 * 負責決定算出來的新狀態要怎麼存（本地 store + Firestore）跟
 * 要不要顯示通知。
 */

import type { PetDoc } from "@/types/database";

// ============================================================
// 1. 時間常數設定
// ============================================================

const HOUR_MS = 60 * 60 * 1000;

/** 飽食度每小時下降的百分比 */
export const FULLNESS_DECAY_PERCENT_PER_HOUR = 2;

/** 飽食度低於這個值時，發出「快餓死了」警告 */
const LOW_FULLNESS_THRESHOLD = 20;

/**
 * 生小病經過這麼多小時未醫治會加重變生大病；生大病經過這麼多小時
 * 未醫治會死掉。兩個轉變目前共用同一個門檻值，所以只宣告一個常數，
 * 避免兩邊各寫一份「4」卻忘記同步改的風險。同時 export 出去，
 * 讓首頁（page.tsx）的「還剩多久會惡化」倒數提示可以共用同一個數字。
 */
export const SICKNESS_ESCALATION_HOURS = 4;

// ============================================================
// 2. 套用結果型別
// ============================================================

export interface PetDecayResult {
  /** 套用時間衰退後的新寵物狀態（若什麼都沒變，會是內容相同的新物件） */
  pet: PetDoc;
  /** 這次計算是否真的改變了任何欄位（用來判斷是否需要寫回 Firestore） */
  changed: boolean;
  /** 這次計算觸發的提示訊息（例如剛剛加重生病、剛剛餓到警戒線），可能有 0～多則 */
  notifications: string[];
}

// ============================================================
// 3. 主體計算函式
// ============================================================

/**
 * 依「現在時間」與寵物目前的時間戳記欄位，計算出套用時間流逝後的新狀態。
 * 純函式，不會自己寫入 Firestore 或 Zustand，呼叫端決定要怎麼處理結果。
 *
 * @param pet 目前的寵物資料
 * @param now 目前時間（epoch ms），外部傳入方便測試（不用 Date.now() 寫死)
 */
export function applyPetTimeDecay(pet: PetDoc, now: number): PetDecayResult {
  const notifications: string[] = [];
  let next: PetDoc = { ...pet };
  let changed = false;

  // ---- 1. 飽食度隨時間下降（死掉就不再繼續扣，沒有意義） ----
  if (pet.healthStatus !== "dead") {
    const hoursSinceLastFed = (now - pet.lastFedTime) / HOUR_MS;
    if (hoursSinceLastFed > 0) {
      const decayAmount = hoursSinceLastFed * FULLNESS_DECAY_PERCENT_PER_HOUR;
      const newFullness = Math.max(0, pet.fullness - decayAmount);
      if (newFullness !== pet.fullness) {
        next.fullness = newFullness;
        next.lastFedTime = now; // 重設檢查點，避免下次計算重複扣這段時間
        changed = true;
      }
    }
  }

  // ---- 2. 飽食度過低警告（只在「跌破門檻的那一刻」通知一次） ----
  if (next.fullness < LOW_FULLNESS_THRESHOLD && !pet.notifiedFlags.lowFullness) {
    notifications.push("⚠️ 小雞快餓死了！飽食度已經低於 20，趕快回去餵食吧！");
    next.notifiedFlags = { ...next.notifiedFlags, lowFullness: true };
    changed = true;
  } else if (next.fullness >= LOW_FULLNESS_THRESHOLD && pet.notifiedFlags.lowFullness) {
    // 飽食度回升到安全範圍，重置旗標，下次再跌破門檻才會再通知一次
    next.notifiedFlags = { ...next.notifiedFlags, lowFullness: false };
    changed = true;
  }

  // ---- 3. 生病加重邏輯 ----
  if (pet.healthStatus === "slightly_sick" && pet.sickStartTime !== null) {
    const hoursSick = (now - pet.sickStartTime) / HOUR_MS;
    if (hoursSick >= SICKNESS_ESCALATION_HOURS) {
      next.healthStatus = "severely_sick";
      next.severeSickStartTime = now;
      next.sickStartTime = null;
      changed = true;
      if (!pet.notifiedFlags.severelySick) {
        notifications.push(
          "🤮 小雞太久沒醫治，病情加重變成生大病了！要趕快買大病藥水，不然會有生命危險！"
        );
        next.notifiedFlags = { ...next.notifiedFlags, severelySick: true, slightlySick: false };
      }
    }
  } else if (pet.healthStatus === "severely_sick" && pet.severeSickStartTime !== null) {
    const hoursSevere = (now - pet.severeSickStartTime) / HOUR_MS;
    if (hoursSevere >= SICKNESS_ESCALATION_HOURS) {
      next.healthStatus = "dead";
      changed = true;
      if (!pet.notifiedFlags.dead) {
        notifications.push("💀 小雞沒有得到及時醫治，已經死掉了……");
        next.notifiedFlags = { ...next.notifiedFlags, dead: true, severelySick: false };
      }
    }
  }

  if (changed) {
    next = { ...next, updatedAt: now };
  }

  return { pet: next, changed, notifications };
}
