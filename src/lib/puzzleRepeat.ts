/**
 * src/lib/puzzleRepeat.ts
 *
 * 重複解題的獎勵遞減規則
 * ------------------------------------------------------------
 * 背景：原本的程式碼其實「沒有」擋重複解題——grantSolveReward 直接
 * setDoc 覆蓋 solvedPuzzles 紀錄就發獎，型別裡的 already_claimed 狀態
 * 從來沒有被設定過。所以學生只要記住某題網址就能無限重刷飼料，加上
 * 棋力積分之後這個漏洞會更嚴重。
 *
 * 這裡把「意外可重刷」轉成「刻意設計的複習機制」：
 *   - 第一次解：全額飼料 + 全額棋力積分
 *   - 之後重解：飼料減半（至少 1）、棋力積分固定 1 分
 *   - 重解不計入 stats.totalSolved（排行榜的「解題數」才不會被刷爆）
 *
 * 為什麼開放重複而不是直接封鎖：象棋的學習本來就仰賴反覆練習殺法
 * 定式，重解舊題在教學上是正當的；而且題庫是有限資源，只認第一次
 * 會讓認真的學生很快就無題可解。給少量獎勵剛好能鼓勵複習、又不會
 * 划算到值得刷。
 */

/** 重複解題時，飼料獎勵要乘上的比例 */
export const REPEAT_FOOD_RATIO = 0.5;

/** 重複解題時，飼料獎勵的最低值（避免算完變成 0，複習完全沒回饋） */
export const REPEAT_FOOD_MIN = 1;

/** 重複解題固定給的棋力積分（不隨題目難度加權，就是很少的複習分） */
export const REPEAT_RANK_POINTS = 1;

/** 依「是否為重複解題」算實際到手的飼料 */
export function getEffectiveFood(baseFood: number, isRepeat: boolean): number {
  if (!isRepeat) return baseFood;
  return Math.max(REPEAT_FOOD_MIN, Math.floor(baseFood * REPEAT_FOOD_RATIO));
}

/** 依「是否為重複解題」算實際到手的棋力積分 */
export function getEffectiveRankPoints(basePoints: number, isRepeat: boolean): number {
  return isRepeat ? REPEAT_RANK_POINTS : basePoints;
}
