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

/** 飽食度低於這個值時，發出「快餓死了」警告；同時也是生病藥水治療時
 * 「補到多少飽食度才不會治好瞬間又因為飽食度歸零復發」的安全線
 * （見 useGameStore.ts 的 useItem，slight_sick_potion / severe_sick_potion）。 */
export const LOW_FULLNESS_THRESHOLD = 20;

/**
 * 生小病經過這麼多小時未醫治會加重變生大病；生大病經過這麼多小時
 * 未醫治會死掉。兩個轉變目前共用同一個門檻值，所以只宣告一個常數，
 * 避免兩邊各寫一份「4」卻忘記同步改的風險。同時 export 出去，
 * 讓首頁（page.tsx）的「還剩多久會惡化」倒數提示可以共用同一個數字。
 */
export const SICKNESS_ESCALATION_HOURS = 4;

/** 垃圾/大便：每過幾分鐘多冒一個（純前端用「現在時間 - lastCleanedTime」
 * 算，不需要額外存「目前幾個」，跟 fullness 用同一套「靠時間戳算」的
 * 設計哲學）。 */
export const POOP_INTERVAL_MINUTES = 60;
const POOP_INTERVAL_MS = POOP_INTERVAL_MINUTES * 60 * 1000;

/** 垃圾累積到這個數量（也就是這麼多個 POOP_INTERVAL_MINUTES 沒清）
 * 會觸發生小病，跟飽食度歸零共用同一套 slightly_sick 機制。 */
export const POOP_SICKNESS_THRESHOLD_COUNT = 10;

/** 清理垃圾費用：第 N 次清理 = N × PET_CLEAN_BASE_COST（100、200、300...
 * 累加，不是倍數），每天 00:00 重置（見 UserDoc.dailyPetCleanProgress）。 */
export const PET_CLEAN_BASE_COST = 100;

/**
 * 依「上次清理時間」跟「現在時間」算目前小雞旁邊有幾個垃圾/大便，
 * 封頂在 POOP_SICKNESS_THRESHOLD_COUNT（超過這個數字意義上就是「已經
 * 生病了」，不需要繼續往上顯示更多垃圾）。lastCleanedTime 是
 * undefined（舊帳號還沒補值）時視為 0 個垃圾。
 */
export function getPoopCount(lastCleanedTime: number | undefined, now: number): number {
  if (!lastCleanedTime) return 0;
  const elapsedMs = now - lastCleanedTime;
  if (elapsedMs <= 0) return 0;
  return Math.min(POOP_SICKNESS_THRESHOLD_COUNT, Math.floor(elapsedMs / POOP_INTERVAL_MS));
}

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

  // ---- 0. 舊帳號沒有 lastCleanedTime 欄位：補一個「現在」當起點，
  //      避免補完欄位後被誤判成「已經很久沒清」而立刻生病。 ----
  if (pet.lastCleanedTime == null) {
    next.lastCleanedTime = now;
    changed = true;
  }

  // ---- 1. 飽食度隨時間下降（死掉就不再繼續扣，沒有意義） ----
  const isFullnessProtected =
    !!pet.fullnessProtectionUntil && now < pet.fullnessProtectionUntil;

  if (pet.healthStatus !== "dead") {
    if (isFullnessProtected) {
      // 護盾生效中：不扣飽食度，但要把「上次餵食」檢查點往前推到現在，
      // 避免護盾到期後，這段被保護的時間被一次補扣（造成護盾一結束就暴跌）。
      if (pet.lastFedTime < now) {
        next.lastFedTime = now;
        changed = true;
      }
    } else {
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

  // ---- 2.5 飽食度歸零觸發生病 ----
  // 飽食度降到 0 且目前健康，自動開始生小病——這樣不做題不餵食的學生
  // 最終也會讓小雞生病甚至死亡，飼料系統才有意義。
  if (
    next.fullness <= 0 &&
    next.healthStatus === "normal" &&
    next.sickStartTime === null
  ) {
    next.healthStatus = "slightly_sick";
    next.sickStartTime = now;
    changed = true;
    if (!pet.notifiedFlags.slightlySick) {
      notifications.push("🤒 小雞太餓了，開始生病了！快去餵食並買小病藥水！");
      next.notifiedFlags = { ...next.notifiedFlags, slightlySick: true };
    }
  }

  // ---- 2.6 垃圾太久沒清，觸發生病 ----
  // 跟上面「飽食度歸零」是兩條獨立的觸發途徑，共用同一個
  // healthStatus/sickStartTime，誰先觸發就先讓小雞生病，之後的
  // 生大病/死亡完全沿用同一套 SICKNESS_ESCALATION_HOURS 邏輯，
  // 不需要另外寫一套「垃圾病情」的加重規則。
  if (
    next.healthStatus === "normal" &&
    next.sickStartTime === null &&
    getPoopCount(next.lastCleanedTime, now) >= POOP_SICKNESS_THRESHOLD_COUNT
  ) {
    next.healthStatus = "slightly_sick";
    next.sickStartTime = now;
    changed = true;
    if (!pet.notifiedFlags.slightlySick) {
      notifications.push("🤢 小雞旁邊的垃圾太久沒清，開始生病了！快去清理環境！");
      next.notifiedFlags = { ...next.notifiedFlags, slightlySick: true };
    }
  }

  // ---- 3. 生病加重邏輯 ----
  // 這裡故意用「理論上應該加重的時間點」（sickStartTime + 4小時）來
  // 設下一階段的起算時間，而不是直接用 now。原本的 bug：如果使用者
  // 很久沒登入（比如離線 10 小時），severeSickStartTime 被設成「現在
  // 登入的時間」，等於把離線期間的經過時間直接歸零重算，小雞本來
  // 應該已經死了卻只停在生大病、而且還有整整 4 小時可以活。
  // 另外原本是 if / else if（只認 pet.healthStatus 這個「本次計算前」
  // 的狀態），一次最多只會加重一階，離線很久、中間其實跨過不只一個
  // 階段的話會卡住。改成兩個獨立的 if、都檢查 next.healthStatus
  // （本次計算「目前為止」的狀態），第一個 if 觸發生大病之後，第二個
  // if 馬上接著用剛剛算出來的 severeSickStartTime 檢查要不要直接
  // 死掉，一次補完離線期間該發生的所有階段。
  if (next.healthStatus === "slightly_sick" && next.sickStartTime !== null) {
    const severeStartTime = next.sickStartTime + SICKNESS_ESCALATION_HOURS * HOUR_MS;
    if (now >= severeStartTime) {
      next.healthStatus = "severely_sick";
      next.severeSickStartTime = severeStartTime;
      next.sickStartTime = null;
      changed = true;
      if (!pet.notifiedFlags.severelySick) {
        notifications.push(
          "🤮 小雞太久沒醫治，病情加重變成生大病了！要趕快買大病藥水，不然會有生命危險！"
        );
        next.notifiedFlags = { ...next.notifiedFlags, severelySick: true, slightlySick: false };
      }
    }
  }
  if (next.healthStatus === "severely_sick" && next.severeSickStartTime !== null) {
    const deathTime = next.severeSickStartTime + SICKNESS_ESCALATION_HOURS * HOUR_MS;
    if (now >= deathTime) {
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
