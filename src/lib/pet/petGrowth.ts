/**
 * src/lib/pet/petGrowth.ts
 *
 * 小雞成長階段（孵化／進化）判定邏輯
 * ------------------------------------------------------------
 * 背景：database.ts 對 PetDoc.xp 的註解寫「當前階段累積的生命經驗值」，
 * 但實際在首頁 page.tsx 計算 XP 進度條時，是把 xp 當作「終身累計總值」
 * 來用（STAGE_XP_THRESHOLDS 的 from/to 是累計式的關卡分界，例如
 * chick 的 from 是 100，剛好接續 egg 的 to）。本檔案延續「終身累計總值」
 * 這個實際被使用的設計，把 xp 視為一路累加、不會因換階段而歸零的數字，
 * 階段門檻只是這條累計線上的幾個檢查點。
 *
 * 集中放在這裡的原因：
 *   - useGameStore.ts 的 feedPet（餵食加 XP）需要這份門檻表來判斷
 *     是否該往下一階段推進（孵化／進化）。
 *   - page.tsx 的 XP 進度條也需要同一份門檻表來算百分比。
 *   兩處共用同一份常數，才不會像「金幣欄位」那樣，兩邊各自寫一份
 *   資料，邏輯跑歪了還互相對不起來。
 */

import type { PetStage } from "@/types/database";

/** 各階段的「累計 XP 區間」，from 是進入該階段時的累計 XP，to 是離開該階段（進化到下一階段）所需的累計 XP */
export const STAGE_XP_THRESHOLDS: Record<PetStage, { from: number; to: number }> = {
  egg: { from: 0, to: 100 },
  chick: { from: 100, to: 400 },
  teen: { from: 400, to: 700 },
  master: { from: 700, to: 730 },
};

/** 階段推進順序：蛋 -> 雛雞 -> 青年雞 -> 大師雞 */
const STAGE_ORDER: PetStage[] = ["egg", "chick", "teen", "master"];

/**
 * 取得指定階段的下一個階段。
 * @returns 下一階段；若已經是最高階（master），回傳 null。
 */
export function getNextStage(stage: PetStage): PetStage | null {
  const index = STAGE_ORDER.indexOf(stage);
  if (index === -1 || index === STAGE_ORDER.length - 1) {
    return null;
  }
  return STAGE_ORDER[index + 1];
}

/**
 * 依照目前累計 xp，從 currentStage 開始往上推進階段，直到累計 xp
 * 不足以跨越下一個門檻、或已經到達最高階（master）為止。
 *
 * 用 while 迴圈而不是只判斷一次，是為了應付「一次性大量增加 XP」
 * 的情境（例如未來若有一次性大量發放 XP 的活動獎勵），確保即使一次
 * 跨越兩個以上的階段門檻，也能正確連續孵化／進化到最終該停留的階段，
 * 而不是卡在中間某一階。
 *
 * @param currentStage 目前的階段
 * @param xp 目前的累計 XP（終身累計總值，不因換階段而歸零）
 * @returns 推進後（可能跨多階）應該停留的階段
 */
export function resolveStageForXp(currentStage: PetStage, xp: number): PetStage {
  let stage = currentStage;

  while (true) {
    const threshold = STAGE_XP_THRESHOLDS[stage];
    if (xp < threshold.to) {
      break; // 累計 xp 還沒到達這一階的上限，留在這一階
    }

    const nextStage = getNextStage(stage);
    if (!nextStage) {
      break; // 已經是 master，沒有更高階可以推進了
    }

    stage = nextStage;
  }

  return stage;
}
