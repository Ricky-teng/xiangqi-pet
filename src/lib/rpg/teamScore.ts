// src/lib/rpg/teamScore.ts

/**
 * RPG 擴充：戰隊積分與賽季
 * ------------------------------------------------------------
 * 積分公式（規格拍板版）：
 *
 *   排名差 = 我的排名 − 對手排名
 *            （正數代表對手排在我前面，也就是我在挑戰比我強的人）
 *
 *   贏：+10 + 排名差    夾在 +2 ~ +50
 *   輸：−(10 − 排名差)  夾在 0 ~ −15
 *
 *   分數不會為負（扣到 0 就停）
 *
 * 這組公式的設計意圖：
 *   - 挑戰比自己高很多的人，贏了大賺、輸了幾乎不痛（甚至 0 分）
 *   - 欺負排名很後面的人，贏了只有 +2、輸了倒扣 15，完全划不來
 *   → 自然把大家推去挑戰實力相近或略強的對手，不用另外做限制
 *
 * 被挑戰方一律不加不減，所以不會有人因為睡覺而掉分。
 */

// ============================================================
// 1. 積分常數
// ============================================================

/** 排名完全相同時的基準分 */
export const SCORE_BASE = 10;

/** 贏的加分上下限 */
export const WIN_SCORE_MAX = 50;
export const WIN_SCORE_MIN = 2;

/** 輸的扣分上下限（都寫正數，實際套用時取負） */
export const LOSE_SCORE_MAX = 15;
export const LOSE_SCORE_MIN = 0;

/** 新戰隊的起始積分 */
export const INITIAL_TEAM_SCORE = 0;

/** 每天可以挑戰幾次 */
export const DAILY_TEAM_ATTEMPTS = 5;

/** 對手清單最多列到第幾名 */
export const CHALLENGE_LIST_MAX_RANK = 50;

/** 戰隊最多幾隻 */
export const TEAM_MAX_MEMBERS = 3;

// ============================================================
// 2. 積分計算
// ============================================================

export interface ScoreChange {
  /** 這一場實際的分數變化（贏是正的，輸是負的或 0） */
  delta: number;
  /** 套用後的新分數（已經夾過不為負） */
  newScore: number;
  /** 排名差，給結算畫面顯示「你挑戰了高 12 名的對手」用 */
  rankDiff: number;
}

/**
 * 算一場戰隊對戰之後，挑戰方的分數變化。
 *
 * @param myRank       我目前的排名（1-indexed）
 * @param opponentRank 對手目前的排名（1-indexed）
 * @param myScore      我目前的積分
 * @param won          這場有沒有贏
 */
export function getScoreChange(
  myRank: number,
  opponentRank: number,
  myScore: number,
  won: boolean,
): ScoreChange {
  const rankDiff = myRank - opponentRank;

  let delta: number;
  if (won) {
    delta = clamp(SCORE_BASE + rankDiff, WIN_SCORE_MIN, WIN_SCORE_MAX);
  } else {
    const penalty = clamp(SCORE_BASE - rankDiff, LOSE_SCORE_MIN, LOSE_SCORE_MAX);
    delta = -penalty;
  }

  const newScore = Math.max(0, myScore + delta);

  return {
    // 分數被夾在 0 的時候，實際變化要跟著修正，不然結算畫面會顯示
    // 「−15」但分數只掉了 3，學生會覺得有 bug
    delta: newScore - myScore,
    newScore,
    rankDiff,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 給挑戰前的預覽用：這場贏了會加幾分、輸了會扣幾分 */
export function previewScoreChange(
  myRank: number,
  opponentRank: number,
  myScore: number,
): { onWin: number; onLose: number } {
  return {
    onWin: getScoreChange(myRank, opponentRank, myScore, true).delta,
    onLose: getScoreChange(myRank, opponentRank, myScore, false).delta,
  };
}

// ============================================================
// 3. 賽季
// ============================================================

/** 前三名的飼料獎勵（index 0 = 第 1 名） */
export const SEASON_TOP_REWARDS: number[] = [3000, 2000, 1000];

/** 進步獎：每進步 1 名給多少飼料 */
export const IMPROVEMENT_REWARD_PER_RANK = 20;
/** 進步獎上限 */
export const IMPROVEMENT_REWARD_MAX = 200;

/**
 * 季末結算某個戰隊拿多少飼料。
 *
 * @param finalRank     這一季的最終排名（1-indexed）
 * @param previousRank  上一季的排名；第一季（或上季沒參加）傳 null，
 *                      這時候沒有進步獎
 */
export interface SeasonReward {
  /** 前三名獎勵 */
  topReward: number;
  /** 進步獎 */
  improvementReward: number;
  /** 合計 */
  total: number;
  /** 進步了幾名（沒進步或第一季是 0） */
  ranksImproved: number;
}

export function getSeasonReward(finalRank: number, previousRank: number | null): SeasonReward {
  const topReward = finalRank >= 1 && finalRank <= SEASON_TOP_REWARDS.length
    ? SEASON_TOP_REWARDS[finalRank - 1]
    : 0;

  let ranksImproved = 0;
  let improvementReward = 0;

  // 第一季沒有進步獎（沒有上一季可以比）
  if (previousRank !== null && previousRank > finalRank) {
    ranksImproved = previousRank - finalRank;
    improvementReward = Math.min(IMPROVEMENT_REWARD_MAX, ranksImproved * IMPROVEMENT_REWARD_PER_RANK);
  }

  return {
    topReward,
    improvementReward,
    total: topReward + improvementReward,
    ranksImproved,
  };
}

// ============================================================
// 4. 賽季代號
// ============================================================

/**
 * 賽季代號用「YYYY-MM」（台北時間）。每月 1 號 00:00 換季，
 * 所以某個時間點屬於哪一季，就是看它在台北時區的年月。
 *
 * ⚠️ Vercel 跑在 UTC，絕對不能直接用 new Date().getMonth()，
 * 會讓每月 1 號台北時間 00:00 ~ 08:00 這段被算進上一季。
 */
export function getSeasonId(now: number = Date.now()): string {
  const taipei = new Date(now + 8 * 60 * 60 * 1000);
  const year = taipei.getUTCFullYear();
  const month = String(taipei.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** 給畫面顯示用，例如「2026 年 9 月賽季」 */
export function getSeasonLabel(seasonId: string): string {
  const [year, month] = seasonId.split("-");
  if (!year || !month) return seasonId;
  return `${year} 年 ${Number(month)} 月賽季`;
}

/** 這一季結束的時間戳（＝下個月 1 號台北 00:00 的 UTC ms） */
export function getSeasonEndTime(seasonId: string): number {
  const [yearStr, monthStr] = seasonId.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1 ~ 12

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  // 台北 00:00 = UTC 前一天 16:00，所以整個時間減 8 小時
  return Date.UTC(nextYear, nextMonth - 1, 1, 0, 0, 0) - 8 * 60 * 60 * 1000;
}

/** 距離換季還有多久，給戰隊頁的倒數顯示用 */
export function getMillisecondsUntilSeasonEnd(now: number = Date.now()): number {
  return Math.max(0, getSeasonEndTime(getSeasonId(now)) - now);
}
