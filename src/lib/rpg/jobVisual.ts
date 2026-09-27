// src/lib/rpg/jobVisual.ts

/**
 * 職業的視覺資訊（顏色、光環）
 * ------------------------------------------------------------
 * 只負責「長什麼樣子」，不碰任何數值——數值在 stats.ts。
 * 分開的理由：戰鬥畫面要畫職業色光環，但戰鬥邏輯完全不該知道
 * 有顏色這回事。
 *
 * 顏色刻意對應該職業的優勢項，讓學生看久了會自己歸納出
 * 「紅色的是攻擊型、藍色的是防禦型」：
 *   HP   → 綠（沿用全站既有的綠）
 *   攻擊 → 紅（沿用全站既有的紅）
 *   防禦 → 藍
 *   速度 → 紫（沿用全站既有的紫）
 */

import { JOB_ADVANTAGE_STAT, type PetStatKey } from "@/lib/rpg/stats";

/** 四項各自的代表色 */
export const STAT_COLORS: Record<PetStatKey, string> = {
  hp: "#5B8C5A",
  attack: "#C0392B",
  defense: "#4A7FB5",
  speed: "#8B5FBF",
};

/** 還沒轉職的小雞用中性的米金色，不搶任何一項的顏色 */
export const NO_JOB_COLOR = "#A9764C";

/**
 * 某個職業的代表色。jobId 傳 null（未轉職）或表上沒有的值，
 * 一律回傳中性色，畫面不會壞掉。
 */
export function getJobColor(jobId: string | null | undefined): string {
  if (!jobId) return NO_JOB_COLOR;
  const stat = JOB_ADVANTAGE_STAT[jobId];
  return stat ? STAT_COLORS[stat] : NO_JOB_COLOR;
}

/**
 * 職業色光環的 CSS box-shadow。戰鬥畫面裡每一隻小雞腳下都會有一圈，
 * 六隻混戰的時候才分得出誰是誰。
 */
export function getJobGlow(jobId: string | null | undefined, intensity = 1): string {
  const color = getJobColor(jobId);
  const blur = Math.round(14 * intensity);
  return `0 0 ${blur}px ${color}`;
}
