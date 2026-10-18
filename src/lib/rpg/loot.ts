// src/lib/rpg/loot.ts

/**
 * RPG 擴充：探險掉落
 * ------------------------------------------------------------
 * 打贏一關之後掉什麼，全部在這裡決定（純函式，rng 可注入）。
 *
 *   首通：必掉 2 件第 1 階裝備 ＋ 1 顆寶石
 *   重打：只有「今天前 10 次贏的重打」有機會掉，各自獨立擲骰：
 *         寶石 20%、裝備 10%（1 件）
 *         第 11 次之後照樣可以打（也不扣次數），只是不會掉東西
 *   輸了：什麼都不掉，也不算進每天 10 次的重打掉落名額
 *
 * 為什麼要限制重打掉落的次數：重打已通關的關卡不扣每日次數，如果
 * 重打又沒有上限地掉東西，學生就能無限刷寶石跟裝備。
 *
 * 裝備的種類規則在 equipment.ts 的 rollDropEquipment（主掉這座塔
 * 新解鎖的種類），寶石的顏色在 gems.ts 的 rollGem（六色平均）。
 */

import { rollDropEquipment, type EquipmentItem } from "@/lib/rpg/equipment";
import { GEM_DROP_CHANCE_REPLAY, GEM_DROP_FIRST_CLEAR, rollGem, type GemId } from "@/lib/rpg/gems";

/** 首通掉幾件裝備（每一關最後都有 Boss，一律 2 件） */
export const EQUIPMENT_DROP_FIRST_CLEAR = 2;
/** 重打掉 1 件裝備的機率 */
export const EQUIPMENT_DROP_CHANCE_REPLAY = 0.1;
/** 每天前幾次「贏的重打」有機會掉東西 */
export const REPLAY_LOOT_DAILY_LIMIT = 10;

export interface StageLoot {
  equipment: EquipmentItem[];
  gems: GemId[];
  /** 這一場有沒有用掉一次「重打掉落名額」 */
  usedReplayLoot: boolean;
}

export function rollStageLoot(args: {
  tower: number;
  won: boolean;
  isFirstClear: boolean;
  /** 今天已經用掉幾次重打掉落名額 */
  replayLootUsedToday: number;
  now?: number;
  rng?: () => number;
}): StageLoot {
  const { tower, won, isFirstClear, replayLootUsedToday } = args;
  const now = args.now ?? Date.now();
  const rng = args.rng ?? Math.random;
  const empty: StageLoot = { equipment: [], gems: [], usedReplayLoot: false };

  if (!won) return empty;

  if (isFirstClear) {
    return {
      equipment: Array.from({ length: EQUIPMENT_DROP_FIRST_CLEAR }, (_, i) => rollDropEquipment(tower, now + i, rng)),
      gems: Array.from({ length: GEM_DROP_FIRST_CLEAR }, () => rollGem(rng)),
      usedReplayLoot: false,
    };
  }

  if (replayLootUsedToday >= REPLAY_LOOT_DAILY_LIMIT) return empty;

  return {
    equipment: rng() < EQUIPMENT_DROP_CHANCE_REPLAY ? [rollDropEquipment(tower, now, rng)] : [],
    gems: rng() < GEM_DROP_CHANCE_REPLAY ? [rollGem(rng)] : [],
    usedReplayLoot: true,
  };
}

/** 今天還剩幾次重打掉落名額（給準備頁顯示） */
export function getReplayLootLeft(replayLootUsedToday: number): number {
  return Math.max(0, REPLAY_LOOT_DAILY_LIMIT - Math.max(0, replayLootUsedToday));
}
