/**
 * src/lib/engine/computerPlayer.ts
 *
 * 電腦對手（目前是「會抓吃子機會」的陽春版，還不是真正的引擎）
 * + 10 級難度設定 + 依等級差距計算飼料獎勵
 * ------------------------------------------------------------
 * 難度沿用跟題目系統一樣的 1-10 級（PuzzleLevel），不是另外發明一套，
 * 跟整個 App 的等級概念一致。
 *
 * 【為什麼不能還是純隨機】
 * 如果電腦永遠隨機走、不管難度都一樣好打，那「贏低等級對手只給10飼料、
 * 贏高等級對手給到100飼料」這個獎勵分級就是假的——學生只要永遠選最高
 * 等級（因為反正一樣好贏），就能一直拿最高獎勵，等級分級完全沒意義。
 * 所以這裡加了一個簡單但有感的差異化：等級越高，電腦越「會抓吃子機會」
 * （legalMoves 裡有吃子選項時，等級高的電腦更傾向選吃子，且優先選能
 * 吃掉的子）。這仍然遠不是真正引擎的「看穿後面好幾步」的算棋能力，
 * 但至少讓「打贏高等級對手」這件事在實際下棋體感上真的比較難，獎勵
 * 分級才有意義。等真正接上 Pikafish 之後，這個差異化會被取代成真正
 * 依等級設定搜尋深度/思考時間。
 *
 * 【飼料獎勵公式】
 * 贏的飼料 = 10 + (對手等級 − 學生自己的等級 + 9) × 5
 * 兩端對應使用者給的需求：
 *   - 學生1級 vs 對手10級（以小博大，差距+9）→ 10 + 18×5 = 100（上限）
 *   - 學生10級 vs 對手1級（以大欺小，差距−9）→ 10 + 0×5 = 10（下限）
 *   - 同等級對戰（差距0）→ 10 + 9×5 = 55（中間值）
 * 線性內插，差距每差 1 級，獎勵增減 5 飼料。
 */

import type { PuzzleLevel } from "@/types/xiangqi";
import type { RulesEngineApi } from "@/lib/engine/rulesEngine";

export type ComputerLevel = PuzzleLevel;

export const COMPUTER_LEVELS: ComputerLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** 輸了的固定飼料懲罰：不分難度，象徵性的小扣，不會讓學生因為怕扣太多而不敢嘗試 */
export const LOSE_PENALTY_FOOD = 5;

/** 和棋給一點小獎勵：鼓勵認真下完，而不是因為「沒有獎勵」就隨便送將 */
export const DRAW_REWARD_FOOD = 5;

const MIN_WIN_REWARD = 10;
const MAX_WIN_REWARD = 100;
const REWARD_STEP_PER_LEVEL_GAP = 5;

/**
 * 計算「贏了這場對弈」的飼料獎勵，依「對手等級 − 學生自己的等級」的差距
 * 線性內插：差距越大（以小博大）獎勵越高，最高 100；差距越小甚至負的
 * （以大欺小）獎勵越低，最低 10。
 */
export function calculateWinRewardFood(opponentLevel: ComputerLevel, studentLevel: ComputerLevel): number {
  const levelGap = opponentLevel - studentLevel; // -9 ~ +9
  const reward = MIN_WIN_REWARD + (levelGap + 9) * REWARD_STEP_PER_LEVEL_GAP;
  // 理論上公式本身已經落在 10~100 之間，這裡夾一下純粹是防呆
  return Math.min(MAX_WIN_REWARD, Math.max(MIN_WIN_REWARD, reward));
}

/**
 * 選擇電腦這一步要走哪一個合法走法。
 *
 * 【真正引擎已接上】優先呼叫 /api/engine-move（伺服器端跑真正的
 * Pikafish 原生執行檔，見 pikafishProcess.ts），依難度等級設定搜尋
 * 深度/思考時間上限。如果這個 API 呼叫失敗（網路問題、伺服器端
 * 引擎發生錯誤等），會退回到「等級越高越傾向吃子」的陽春版邏輯
 * （見下方 chooseHeuristicMove），確保即使引擎暫時不可用，遊戲還是
 *能繼續玩下去，不會整個卡住。
 */
export async function chooseComputerMove(
  engine: RulesEngineApi,
  fen: string,
  sideToMove: "w" | "b",
  legalMoves: string[],
  level: ComputerLevel
): Promise<string> {
  if (legalMoves.length === 0) {
    throw new Error("沒有合法走法可選——呼叫端應該在呼叫這個函式之前就先判斷遊戲是否已經結束。");
  }

  try {
    const response = await fetch("/api/engine-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen, sideToMove, level }),
    });

    if (!response.ok) {
      throw new Error(`引擎 API 回應失敗（狀態碼 ${response.status}）`);
    }

    const data = (await response.json()) as { move?: string };
    if (data.move && legalMoves.includes(data.move)) {
      return data.move;
    }

    console.error("[computerPlayer] 引擎 API 回傳的走法不在合法走法列表裡，退回陽春版邏輯：", data);
  } catch (error) {
    console.error("[computerPlayer] 呼叫真正引擎失敗，退回陽春版隨機+吃子邏輯：", error);
  }

  return chooseHeuristicMove(engine, fen, sideToMove, legalMoves, level);
}

/**
 * 陽春版備援邏輯（真正引擎呼叫失敗時的退路）：等級越高越傾向優先選
 * 吃子的走法。不是真正引擎的搜尋能力，只是避免引擎不可用時整個
 * 遊戲卡住的保險。
 */
async function chooseHeuristicMove(
  engine: RulesEngineApi,
  fen: string,
  sideToMove: "w" | "b",
  legalMoves: string[],
  level: ComputerLevel
): Promise<string> {
  const captrueMoves = legalMoves.filter((move) => engine.isCaptureMove(fen, sideToMove, move));

  // 等級 1 時幾乎不特別偏好吃子（10%機率），等級 10 時幾乎一定吃
  // （100%機率），中間等級線性內插。
  const preferCaptrueChance = level / 10;
  if (captrueMoves.length > 0 && Math.random() < preferCaptrueChance) {
    return captrueMoves[Math.floor(Math.random() * captrueMoves.length)];
  }

  const quietMoves = legalMoves.filter((move) => !captrueMoves.includes(move));
  const pool = quietMoves.length > 0 ? quietMoves : legalMoves;
  return pool[Math.floor(Math.random() * pool.length)];
}
