/**
 * src/lib/chessRank.ts
 *
 * 棋力段位（chessLevel 自動成長）
 * ------------------------------------------------------------
 * 改版前的問題：chessLevel（1-10）只有老師能在 /admin/dashboard 手動
 * 指定，學生解了幾百題也不會變動——等於這個象棋教學 App 完全沒有
 * 「自動的能力成長線」，所有成就感都來自小雞外觀，跟下棋本身脫鉤。
 *
 * 改法：學生解題／贏電腦／贏對戰都會累積「棋力積分」
 * （UserDoc.chessLevelPoints），累積到門檻就自動升一級。
 *
 * 三個刻意的設計決定：
 *   1. **積分依「相對難度」加權**：挑戰低於自己等級的題目只拿到很少
 *      的積分，同級或更高才拿得多。否則學生會發現「狂刷最簡單的題目
 *      升級最快」，那就跟教學目的完全相反了。
 *   2. **只升不降**：對小學生來說掉段很打擊信心，而且 chessLevel 還
 *      牽動題目難度跟獎勵倍率，掉級會讓體驗變得很混亂。
 *   3. **升級門檻逐級變高**：低段位升得快（新手有感），高段位需要
 *      明顯更多練習，避免幾天就打到頂。
 *
 * 老師的手動覆寫仍然有效（/admin/dashboard）：自動成長只是預設的
 * 引擎，老師發現某個學生被分錯組還是可以直接改。老師改動等級時會
 * 一併把 chessLevelPoints 歸零，避免改完之後馬上又被舊積分推升一級。
 */

import type { UserDoc } from "@/types/database";

/** chessLevel 的合法範圍（跟 PuzzleLevel 一致），1 最弱、10 最強 */
export const MIN_CHESS_LEVEL = 1;
export const MAX_CHESS_LEVEL = 10;

/**
 * 把 chessLevel 換算成學生看得懂的段位名稱。
 * 傳統圍棋/象棋的「級」是數字越小越強，跟 chessLevel 剛好相反，
 * 所以這裡要倒過來：chessLevel 1 → 十級（最弱），10 → 一級（最強）。
 */
const RANK_NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export function getChessRankLabel(chessLevel: number): string {
  const clamped = Math.min(MAX_CHESS_LEVEL, Math.max(MIN_CHESS_LEVEL, chessLevel));
  // chessLevel 1 → 十級、10 → 一級
  const rankNumber = MAX_CHESS_LEVEL + 1 - clamped;
  return `${RANK_NUMERALS[rankNumber - 1]}級`;
}

/**
 * 升到「下一級」所需要的積分，每一級都是前一級的兩倍：
 * Lv1→2 需 30 分、Lv2→3 需 60 分……Lv9→10 需 7680 分。
 * 已經滿級（Lv10）回傳 null，代表沒有下一級了。
 *
 * 用倍增（而不是等差）是刻意的：低段位升得非常快，讓新手前幾天就
 * 有明顯進展；高段位則需要長期累積，讓「一級」真的是稀有的成就，
 * 撐得住好幾個學期而不會很快就打到頂。
 */
export function getPointsForNextLevel(chessLevel: number): number | null {
  if (chessLevel >= MAX_CHESS_LEVEL) return null;
  const step = Math.max(MIN_CHESS_LEVEL, chessLevel);
  return 30 * Math.pow(2, step - 1);
}

/**
 * 解對一題可以拿到的棋力積分，依「題目難度 - 自己的等級」加權：
 * 低於自己等級的題目只拿 1 分（不是 0，避免複習舊題目完全沒有回饋），
 * 同級 3 分，每高一級多 2 分。
 */
export function getPuzzleSolvePoints(chessLevel: number, puzzleLevel: number): number {
  const diff = puzzleLevel - chessLevel;
  if (diff < 0) return 1;
  return 3 + diff * 2;
}

/** 贏電腦拿到的積分，加權方式跟解題一樣，但基礎分數比較高（對局比單題花時間） */
export function getVsComputerWinPoints(chessLevel: number, opponentLevel: number): number {
  const diff = opponentLevel - chessLevel;
  if (diff < 0) return 2;
  return 5 + diff * 3;
}

/** 贏真人對戰的積分。對手強弱不像電腦有明確等級，所以給固定分數。 */
export const BATTLE_WIN_POINTS = 6;

export interface ChessLevelProgress {
  /** 結算後的等級（可能跟原本一樣，也可能升了不只一級） */
  chessLevel: number;
  /** 結算後、還沒用掉的剩餘積分 */
  chessLevelPoints: number;
  /** 這次總共升了幾級（0 代表沒升級） */
  levelsGained: number;
}

/**
 * 加上積分並結算升級。用 while 迴圈而不是單次 if，是因為一次拿到
 * 大量積分（例如挑戰高難度題目）有可能一口氣跨過不只一級的門檻，
 * 用 if 只升一級的話多出來的積分會卡住不生效。
 * 滿級之後積分就不再累積（回傳 0），避免數字無意義地一直長。
 */
export function applyChessLevelPoints(
  currentLevel: number,
  currentPoints: number,
  pointsToAdd: number
): ChessLevelProgress {
  let level = Math.min(MAX_CHESS_LEVEL, Math.max(MIN_CHESS_LEVEL, currentLevel));
  let points = Math.max(0, currentPoints) + Math.max(0, pointsToAdd);
  let levelsGained = 0;

  while (level < MAX_CHESS_LEVEL) {
    const needed = getPointsForNextLevel(level);
    if (needed === null || points < needed) break;
    points -= needed;
    level += 1;
    levelsGained += 1;
  }

  if (level >= MAX_CHESS_LEVEL) points = 0;

  return { chessLevel: level, chessLevelPoints: points, levelsGained };
}

/** 給進度條用：目前這一級的完成百分比（滿級固定回傳 100） */
export function getChessLevelProgressPercent(user: Pick<UserDoc, "chessLevel" | "chessLevelPoints">): number {
  const needed = getPointsForNextLevel(user.chessLevel);
  if (needed === null) return 100;
  return Math.min(100, Math.round(((user.chessLevelPoints ?? 0) / needed) * 100));
}
