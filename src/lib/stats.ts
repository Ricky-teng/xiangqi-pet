// src/lib/stats.ts
//
// 共用的統計計算工具。原本 vsComputer / battle 的勝率計算各自寫在
// leaderboard 頁面裡，現在設定頁的「統計總覽」也需要一樣的公式，
// 抽出來共用，避免兩邊各自維護一份、以後改公式漏改其中一邊。

import type { UserDoc } from "@/types/database";

/** 對電腦勝率：wins / (wins + losses + draws)，四捨五入到整數百分比 */
export function getVsComputerWinRate(s: UserDoc): number {
  const total = (s.stats.vsComputerWins ?? 0) + (s.stats.vsComputerLosses ?? 0) + (s.stats.vsComputerDraws ?? 0);
  return total > 0 ? Math.round(((s.stats.vsComputerWins ?? 0) / total) * 100) : 0;
}

/** 殘局對戰勝率：wins / (wins + losses + draws)，四捨五入到整數百分比 */
export function getBattleWinRate(s: UserDoc): number {
  const total = (s.stats.battleWins ?? 0) + (s.stats.battleLosses ?? 0) + (s.stats.battleDraws ?? 0);
  return total > 0 ? Math.round(((s.stats.battleWins ?? 0) / total) * 100) : 0;
}

/** 解題一次通過率：totalSolved / totalAttempts，四捨五入到整數百分比 */
export function getPuzzlePassRate(s: UserDoc): number {
  return s.stats.totalAttempts > 0 ? Math.round((s.stats.totalSolved / s.stats.totalAttempts) * 100) : 0;
}
