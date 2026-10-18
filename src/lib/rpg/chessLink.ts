// src/lib/rpg/chessLink.ts

/**
 * 象棋 × RPG 的連結（解題不是行動條件，只是「解題會讓 RPG 更順」）
 * ------------------------------------------------------------
 * 四項，全部拍板過：
 *   ① 當天解題加成：當天每解對 1 題，探險時四項 +1%，最多 +5%。
 *      只有探險有效（戰隊對手是電腦代打，不能讓挑戰方多一層加成）。
 *   ② 解題換探險次數：每天的 10 次之外，當天每解對 3 題多 1 次，最多多 5 次。
 *   ③ 解題掉寶石：每天前 5 題，每題 30% 掉一顆隨機寶石。
 *   ④ Boss 封印殘局：每座塔的 Boss 首通之後解鎖一題，從題庫依難度挑
 *      （第 N 塔 → 難度 N 的題目），第一次解開送 2 顆寶石。
 *
 * 「解對一題」包含重解的舊題（拍板：重解也算）。
 * 每日計數跟探險次數一樣用台北日期換日。
 */

import type { GemId } from "@/lib/rpg/gems";
import { rollGem } from "@/lib/rpg/gems";

export const PUZZLE_BONUS_PER_SOLVE = 0.01;
export const PUZZLE_BONUS_MAX = 0.05;
export const PUZZLES_PER_EXTRA_ATTEMPT = 3;
export const MAX_EXTRA_EXPLORE_ATTEMPTS = 5;
export const PUZZLE_GEM_DAILY_ROLLS = 5;
export const PUZZLE_GEM_CHANCE = 0.3;
export const SEAL_PUZZLE_GEMS = 2;

/** users/{uid} 上的每日計數 */
export interface PuzzleRpgDaily {
  /** 台北日期 YYYY-MM-DD */
  date: string;
  /** 今天解對幾題（含重解） */
  solved: number;
  /** 今天已經擲過幾次「解題掉寶石」 */
  gemRolls: number;
}

/** 某一座塔的封印殘局 */
export interface SealPuzzle {
  puzzleId: string;
  /** 解開過了（2 顆寶石已經領過） */
  claimed: boolean;
}

/** 取今天的計數；日期不是今天就當作 0 */
export function getTodayPuzzleDaily(daily: PuzzleRpgDaily | null | undefined, today: string): PuzzleRpgDaily {
  if (!daily || daily.date !== today) return { date: today, solved: 0, gemRolls: 0 };
  return daily;
}

/** 當天解題給探險的加成（0.03 = 四項 +3%） */
export function getPuzzleStatBonus(solvedToday: number): number {
  return Math.min(PUZZLE_BONUS_MAX, Math.max(0, solvedToday) * PUZZLE_BONUS_PER_SOLVE);
}

/** 當天解題換到的額外探險次數 */
export function getExtraExploreAttempts(solvedToday: number): number {
  return Math.min(MAX_EXTRA_EXPLORE_ATTEMPTS, Math.floor(Math.max(0, solvedToday) / PUZZLES_PER_EXTRA_ATTEMPT));
}

/** 還要再解幾題才會多 1 次（已經滿了回傳 null） */
export function getPuzzlesUntilNextAttempt(solvedToday: number): number | null {
  if (getExtraExploreAttempts(solvedToday) >= MAX_EXTRA_EXPLORE_ATTEMPTS) return null;
  return PUZZLES_PER_EXTRA_ATTEMPT - (Math.max(0, solvedToday) % PUZZLES_PER_EXTRA_ATTEMPT);
}

/**
 * 解對一題之後的每日計數更新（純函式）。
 * 回傳新的計數，以及這題有沒有掉寶石。
 */
export function applyPuzzleSolve(
  daily: PuzzleRpgDaily,
  rng: () => number = Math.random,
): { daily: PuzzleRpgDaily; gem: GemId | null } {
  const next: PuzzleRpgDaily = { ...daily, solved: daily.solved + 1 };
  let gem: GemId | null = null;
  if (daily.gemRolls < PUZZLE_GEM_DAILY_ROLLS) {
    next.gemRolls = daily.gemRolls + 1;
    if (rng() < PUZZLE_GEM_CHANCE) gem = rollGem(rng);
  }
  return { daily: next, gem };
}

/** 封印殘局的難度：第 N 塔 → 難度 N */
export function getSealPuzzleLevel(tower: number): number {
  return Math.max(1, Math.min(10, tower));
}

/**
 * 從候選題目裡挑一題當封印殘局。用 uid＋塔號算雜湊，同一個人同一座塔
 * 永遠挑到同一題（每個人可能不同），之後補發或重新整理都不會換題。
 */
export function pickSealPuzzleId(uid: string, tower: number, candidateIds: string[]): string | null {
  if (candidateIds.length === 0) return null;
  const sorted = [...candidateIds].sort();
  let h = 2166136261;
  for (const ch of `${uid}#${tower}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return sorted[(h >>> 0) % sorted.length];
}
