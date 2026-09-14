/**
 * src/lib/pet/prestige.ts
 *
 * 轉生印記（Prestige）
 * ------------------------------------------------------------
 * 設計目的：原本轉生是「純歸零」——辛苦轉職到鳳凰雞之後，小雞變回
 * 蛋、職業清空，學生換到的只有 rebirthCount 這個計數器 +1，沒有任何
 * 實質好處，所以沒人想轉生（也就是「轉生太慢」這個回饋的真正原因：
 * 不是慢，是不值得）。
 *
 * 改法：每轉生一次得到一枚「轉生印記」，每枚讓餵食獲得的 XP +10%，
 * 上限 10 枚（+100%）。這樣每一輪轉生都會比上一輪更快養大，形成
 * 「越轉生越強」的正向循環，不用去調整成長曲線的數值就能解決
 * 「轉生太慢」的問題。
 *
 * 相容性：印記數量直接用既有的 UserDoc.rebirthCount 換算，不另外開
 * 欄位——所以舊帳號已經轉生過的次數會自動生效，不需要任何資料遷移。
 */

/** 每枚印記增加的餵食 XP 百分比 */
export const PRESTIGE_XP_BONUS_PER_MARK = 0.1;

/** 印記加成的上限枚數（超過的轉生次數仍會顯示，只是不再增加加成） */
export const PRESTIGE_MAX_EFFECTIVE_MARKS = 10;

/**
 * 依轉生次數算餵食 XP 的加成倍率。
 * 0 次轉生 → 1（沒有加成）；3 次 → 1.3；10 次以上 → 2（封頂）。
 */
export function getPrestigeXpMultiplier(rebirthCount: number): number {
  const effectiveMarks = Math.min(PRESTIGE_MAX_EFFECTIVE_MARKS, Math.max(0, rebirthCount));
  return 1 + effectiveMarks * PRESTIGE_XP_BONUS_PER_MARK;
}

/** 加成的百分比整數，給 UI 顯示用（例如 30 代表 +30%） */
export function getPrestigeBonusPercent(rebirthCount: number): number {
  return Math.round((getPrestigeXpMultiplier(rebirthCount) - 1) * 100);
}

/**
 * 印記的顯示字串。轉生次數少的時候直接畫出對應數量的印記符號，
 * 多了之後改成「✨×12」這種精簡寫法，避免名字旁邊排一長串圖示。
 */
export function getPrestigeMarkLabel(rebirthCount: number): string {
  if (rebirthCount <= 0) return "";
  if (rebirthCount <= 5) return "✨".repeat(rebirthCount);
  return `✨×${rebirthCount}`;
}
