/**
 * src/lib/puzzleSubmission.ts
 *
 * 學生投稿題目的共用規則
 * ------------------------------------------------------------
 * 投稿流程：學生在對弈回放頁挑一個局面投稿 → 老師在
 * /admin/submissions 審核 → 通過的話老師補上答案跟難度，系統轉成正式
 * 題目並依難度發飼料給投稿學生。
 */

import type { PuzzleLevel } from "@/types/xiangqi";

/**
 * 投稿通過的飼料獎勵：依老師最後判定的題目難度給，難度越高給越多。
 * 用「基礎分 + 難度 × 級距」而不是固定金額，是為了鼓勵學生去發掘
 * 比較深、比較有挑戰性的局面，而不是隨便挑一個簡單盤面來洗獎勵。
 */
export const SUBMISSION_REWARD_BASE = 100;
export const SUBMISSION_REWARD_PER_LEVEL = 50;

export function getSubmissionReward(level: PuzzleLevel): number {
  return SUBMISSION_REWARD_BASE + level * SUBMISSION_REWARD_PER_LEVEL;
}

/**
 * 每個學生同時最多能有幾筆「待審核」的投稿。
 * 這是防洗機制：不限制的話有人會一口氣送幾十筆碰運氣，既洗獎勵也
 * 讓老師的審核清單爆掉。已經被審完（通過/駁回）的不計入這個上限。
 */
export const MAX_PENDING_SUBMISSIONS_PER_STUDENT = 3;
