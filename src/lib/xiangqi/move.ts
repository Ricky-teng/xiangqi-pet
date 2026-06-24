/**
 * src/lib/xiangqi/move.ts
 *
 * 走法記號工具
 * ------------------------------------------------------------
 * 對應需求書的開發策略：
 *   「解題系統目前不需要完整枚舉合法走法的規則引擎（rules.ts 留到以後做），
 *    只需要『比對學生走的每一步是否等於正解序列的當前步』即可。」
 *
 * 因此本檔案只做「記號 <-> 座標」轉換，以及「不驗證合法性、直接執行」的
 * applyMove（純粹搬動棋子、處理吃子），完整象棋規則驗證留給未來的 rules.ts。
 *
 * 走法記號格式：四字元純文字，例如 "h2e2"。
 *   - 第 0 字元：起點直列字母（a-i）
 *   - 第 1 字元：起點橫線數字（0-9）
 *   - 第 2 字元：終點直列字母（a-i）
 *   - 第 3 字元：終點橫線數字（0-9）
 * 座標系統：col 0-8 對應 a-i（紅方視角左到右），row 0-9（0 為黑方底線，9 為紅方底線）。
 */

import type { BoardGrid, Move, Piece, Position } from "@/types/xiangqi";

// ============================================================
// 1. 直列字母 <-> 數字索引 對照
// ============================================================

/** 直列字母順序，索引即為 col 數值（a=0, b=1, ..., i=8） */
const FILE_LETTERS = ["a", "b", "c", "d", "e", "f", "g", "h", "i"] as const;

/**
 * 將直列字母轉換為 col 數值（0-8）。
 * @throws 當輸入非 a-i 範圍內的字母時拋出錯誤
 */
function fileLetterToCol(letter: string): number {
  const col = FILE_LETTERS.indexOf(letter.toLowerCase() as (typeof FILE_LETTERS)[number]);
  if (col === -1) {
    throw new Error(`走法記號錯誤：無法辨識的直列字母 "${letter}"，應為 a-i 之一。`);
  }
  return col;
}

/**
 * 將 col 數值（0-8）轉換為直列字母。
 * @throws 當 col 超出 0-8 範圍時拋出錯誤
 */
function colToFileLetter(col: number): string {
  if (col < 0 || col > 8) {
    throw new Error(`座標錯誤：col 數值 ${col} 超出合法範圍 0-8。`);
  }
  return FILE_LETTERS[col];
}

// ============================================================
// 2. 座標字串（例如 "h2"） <-> Position 互轉
// ============================================================

/**
 * 將單一座標字串（例如 "h2"）解析為 Position。
 * @param square 兩字元座標字串，格式為「直列字母 + 橫線數字」
 * @throws 當格式不符（非兩字元、橫線非 0-9 數字、直列非 a-i）時拋出錯誤
 */
export function parseSquare(square: string): Position {
  if (square.length !== 2) {
    throw new Error(`座標格式錯誤："${square}" 應為兩字元（例如 "h2"）。`);
  }

  const fileChar = square[0];
  const rankChar = square[1];

  const col = fileLetterToCol(fileChar);
  const row = Number(rankChar);

  if (Number.isNaN(row) || row < 0 || row > 9) {
    throw new Error(`座標格式錯誤："${square}" 的橫線數字應為 0-9，實際為 "${rankChar}"。`);
  }

  return { row, col };
}

/**
 * 將 Position 轉換為座標字串（例如 {row:2, col:7} -> "h2"）。
 * @throws 當 row/col 超出合法範圍時拋出錯誤
 */
export function formatSquare(position: Position): string {
  if (position.row < 0 || position.row > 9) {
    throw new Error(`座標錯誤：row 數值 ${position.row} 超出合法範圍 0-9。`);
  }
  const file = colToFileLetter(position.col);
  return `${file}${position.row}`;
}

// ============================================================
// 3. 走法記號（四字元，例如 "h2e2"） <-> Move 互轉
// ============================================================

/**
 * 將四字元走法記號解析為 Move（{from, to}）。
 *
 * @param notation 四字元走法記號，例如 "h2e2"
 * @throws 當記號長度不為 4，或起點/終點座標格式錯誤時拋出錯誤
 */
export function parseMoveNotation(notation: string): Move {
  if (notation.length !== 4) {
    throw new Error(
      `走法記號格式錯誤："${notation}" 應為四字元（例如 "h2e2"），實際長度為 ${notation.length}。`
    );
  }

  const fromSquare = notation.slice(0, 2);
  const toSquare = notation.slice(2, 4);

  const from = parseSquare(fromSquare);
  const to = parseSquare(toSquare);

  return { from, to };
}

/**
 * 將 Move 序列化為四字元走法記號（例如 {from:{row:2,col:7}, to:{row:2,col:4}} -> "h2e2"）。
 */
export function formatMoveNotation(move: Move): string {
  return `${formatSquare(move.from)}${formatSquare(move.to)}`;
}

// ============================================================
// 4. 走法比對（解題系統核心需求）
// ============================================================

/**
 * 比對「學生走的這一步」是否與「正解序列當前步」的記號完全相符。
 *
 * 設計刻意採用「字串記號直接比對」而非「結構化座標比對」，
 * 原因：
 *   1. 字串比對最直接對應需求書「比對是否等於正解序列當前步」的描述，
 *      不需要額外解析成 Move 再比較欄位，邏輯單純、效能也更好。
 *   2. 避免將「合法走法判斷」誤植入比對邏輯——這裡只做「逐字相符」，
 *      完全不涉及棋子能不能那樣走（那是未來 rules.ts 的職責）。
 *
 * @param studentNotation 學生實際輸入的四字元走法記號
 * @param expectedNotation 正解序列當前步的四字元走法記號
 * @returns 是否完全相符（大小寫視為不同，因走法記號座標字母本身即為小寫慣例）
 */
export function isMoveMatchingExpected(
  studentNotation: string,
  expectedNotation: string
): boolean {
  return studentNotation === expectedNotation;
}

// ============================================================
// 5. applyMove —— 無驗證執行移動
// ============================================================

/** applyMove 執行後的回傳結果 */
export interface ApplyMoveResult {
  /** 執行移動後的新棋盤狀態（不修改傳入的原棋盤，回傳全新陣列） */
  board: BoardGrid;
  /** 被移動的棋子 */
  movedPiece: Piece;
  /** 若終點原本有棋子（吃子），則為被吃掉的棋子；否則為 null */
  capturedPiece: Piece | null;
}

/**
 * 執行一次走法，將棋子從 from 移動到 to。
 *
 * 【重要】本函式「不驗證合法性」：
 *   - 不檢查該棋子是否真的能那樣走（例如馬是否走日字、象是否過河）。
 *   - 不檢查是否導致己方將/帥被將軍。
 *   - 不檢查起點是否真的有棋子（若無棋子會拋出錯誤，但這只是基本資料完整性檢查，
 *     並非象棋規則驗證）。
 * 這完全符合需求書「rules.ts 留到以後做」的開發策略：
 * 解題流程只需要「按照正解序列逐步播放/比對」，不需要驗證每一步是否合法，
 * 因為正解序列本身就保證合法（由出題老師或引擎產生）。
 *
 * @param board 目前棋盤狀態（不會被修改）
 * @param move 要執行的走法
 * @returns 新棋盤狀態、被移動的棋子、以及（若有）被吃掉的棋子
 * @throws 當起點座標沒有棋子時拋出錯誤（基本資料完整性檢查）
 */
export function applyMove(board: BoardGrid, move: Move): ApplyMoveResult {
  const { from, to } = move;

  const movedPiece = board[from.row]?.[from.col];

  if (!movedPiece) {
    throw new Error(
      `applyMove 錯誤：起點 ${formatSquare(from)} 沒有棋子，無法執行走法 "${formatMoveNotation(move)}"。`
    );
  }

  const capturedPiece = board[to.row]?.[to.col] ?? null;

  // 深拷貝棋盤，避免原地修改傳入的 board（保持函式純粹、避免意外副作用）
  const newBoard: BoardGrid = board.map((rowCells) => rowCells.slice());

  newBoard[to.row][to.col] = movedPiece;
  newBoard[from.row][from.col] = null;

  return {
    board: newBoard,
    movedPiece,
    capturedPiece,
  };
}

/**
 * applyMove 的記號版本封裝：直接傳入四字元走法記號字串。
 * 內部會先呼叫 parseMoveNotation 解析，再呼叫 applyMove 執行。
 *
 * @param board 目前棋盤狀態（不會被修改）
 * @param notation 四字元走法記號，例如 "h2e2"
 */
export function applyMoveNotation(board: BoardGrid, notation: string): ApplyMoveResult {
  const move = parseMoveNotation(notation);
  return applyMove(board, move);
}