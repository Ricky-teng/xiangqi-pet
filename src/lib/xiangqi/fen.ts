/**
 * src/lib/xiangqi/fen.ts
 *
 * FEN（Forsyth-Edwards Notation）編解碼工具
 * ------------------------------------------------------------
 * 採用標準象棋 FEN 格式：
 *   - 從黑方底線（row 0）開始，逐行往紅方底線（row 9）描述。
 *   - 每一行內，從 col 0（左側 a 列）往 col 8（右側 i 列）描述。
 *   - 行與行之間以 "/" 分隔，共 10 行。
 *   - 數字代表連續空格數量（例如 "9" 代表整行 9 格全空）。
 *   - 大寫字母 = 紅方棋子，小寫字母 = 黑方棋子。
 *   - 棋子代號對應 PieceType：k(將/帥) a(士/仕) e(象/相) h(馬) r(車) c(炮) p(兵/卒)。
 *
 * 範例（標準開局）：
 *   "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR"
 *
 * 本檔案僅負責「棋盤格局」的編解碼，不處理回合方／步數等中繼資料，
 * 因為目前解題系統不需要完整對局記譜，只需要靜態盤面 + 正解序列比對。
 */

import type { BoardGrid, Piece, PieceColor, PieceType } from "@/types/xiangqi";

// ============================================================
// 1. 標準開局 FEN 常數
// ============================================================

/**
 * 標準象棋開局局面 FEN 字串。
 * 由黑方底線（row 0）開始，逐行往紅方底線（row 9）排列：
 *   row 0：黑方主將/士/象/馬/車（底線）
 *   row 1：（空行）
 *   row 2：黑方炮（c）位於 col 1, col 7
 *   row 3：黑方兵（p）位於 col 0,2,4,6,8（共 5 個）
 *   row 4：（空行，黑方領域）
 *   row 5：（空行，紅方領域，楚河漢界）
 *   row 6：紅方兵（P）位於 col 0,2,4,6,8
 *   row 7：紅方炮（C）位於 col 1, col 7
 *   row 8：（空行）
 *   row 9：紅方主將/仕/相/馬/車（底線）
 */
export const STANDARD_START_FEN =
  "rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR";

// ============================================================
// 2. 棋子代號 <-> PieceType 對照表
// ============================================================

/** 小寫字母 -> PieceType 對照（陣營資訊另外由大小寫判斷，不放在此表中） */
const CODE_TO_TYPE: Record<string, PieceType> = {
  k: "k",
  a: "a",
  e: "e",
  h: "h",
  r: "r",
  c: "c",
  p: "p",
};

/** PieceType -> 小寫字母對照（CODE_TO_TYPE 的反向表，產生 FEN 時使用） */
const TYPE_TO_CODE: Record<PieceType, string> = {
  k: "k",
  a: "a",
  e: "e",
  h: "h",
  r: "r",
  c: "c",
  p: "p",
};

// ============================================================
// 3. FEN -> BoardGrid（解碼）
// ============================================================

/**
 * 將 FEN 字串解析為棋盤格局（BoardGrid）。
 *
 * @param fen 標準象棋 FEN 字串（僅含棋盤格局部分，不含回合方等中繼資料）
 * @returns 10x9 的 BoardGrid，grid[row][col]
 * @throws 當 FEN 格式不符合「10 行、每行 9 格」規則時拋出錯誤，
 *         避免錯誤資料悄悄進入棋盤狀態而難以除錯。
 */
export function parseFen(fen: string): BoardGrid {
  const trimmed = fen.trim();
  const rows = trimmed.split("/");

  if (rows.length !== 10) {
    throw new Error(
      `FEN 格式錯誤：應包含 10 行（以 "/" 分隔），但實際得到 ${rows.length} 行。FEN: "${fen}"`
    );
  }

  const grid: BoardGrid = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const rowStr = rows[rowIndex];
    const rowCells: (Piece | null)[] = [];

    for (const char of rowStr) {
      if (char >= "1" && char <= "9") {
        // 數字代表連續 N 個空格
        const emptyCount = Number(char);
        for (let i = 0; i < emptyCount; i++) {
          rowCells.push(null);
        }
      } else {
        const piece = decodePieceChar(char, fen, rowIndex);
        rowCells.push(piece);
      }
    }

    if (rowCells.length !== 9) {
      throw new Error(
        `FEN 格式錯誤：第 ${rowIndex} 行（從 0 起算，對應 row ${rowIndex}）應有 9 格，但實際解析出 ${rowCells.length} 格。原始片段: "${rowStr}"，完整 FEN: "${fen}"`
      );
    }

    grid.push(rowCells);
  }

  return grid;
}

/**
 * 將單一字元解碼為 Piece。
 * 內部輔助函式，集中處理大小寫判斷與未知字元錯誤訊息。
 */
function decodePieceChar(char: string, fullFen: string, rowIndex: number): Piece {
  const lowerChar = char.toLowerCase();
  const type = CODE_TO_TYPE[lowerChar];

  if (!type) {
    throw new Error(
      `FEN 格式錯誤：第 ${rowIndex} 行出現無法辨識的棋子代號 "${char}"。完整 FEN: "${fullFen}"`
    );
  }

  const color: PieceColor = char === lowerChar ? "b" : "r";

  return { type, color };
}

// ============================================================
// 4. BoardGrid -> FEN（編碼）
// ============================================================

/**
 * 將棋盤格局（BoardGrid）編碼為 FEN 字串。
 * 與 parseFen 互為反函式：parseFen(toFen(grid)) 應還原出等價的 grid。
 *
 * @param grid 10x9 的 BoardGrid，grid[row][col]
 * @returns 標準格式 FEN 字串（10 行，以 "/" 分隔）
 * @throws 當 grid 不是 10 列或某列不是 9 格時拋出錯誤
 */
export function toFen(grid: BoardGrid): string {
  if (grid.length !== 10) {
    throw new Error(
      `BoardGrid 格式錯誤：應有 10 列（row 0~9），但實際長度為 ${grid.length}。`
    );
  }

  const rowStrings: string[] = [];

  for (let rowIndex = 0; rowIndex < grid.length; rowIndex++) {
    const rowCells = grid[rowIndex];

    if (rowCells.length !== 9) {
      throw new Error(
        `BoardGrid 格式錯誤：row ${rowIndex} 應有 9 格（col 0~8），但實際長度為 ${rowCells.length}。`
      );
    }

    let rowStr = "";
    let emptyRun = 0; // 目前累積的連續空格數

    for (const cell of rowCells) {
      if (cell === null) {
        emptyRun += 1;
      } else {
        if (emptyRun > 0) {
          rowStr += String(emptyRun);
          emptyRun = 0;
        }
        rowStr += encodePieceChar(cell);
      }
    }

    // 該行結尾若還有未寫出的連續空格，要補上
    if (emptyRun > 0) {
      rowStr += String(emptyRun);
    }

    rowStrings.push(rowStr);
  }

  return rowStrings.join("/");
}

/**
 * 將單一 Piece 編碼為對應的 FEN 字元（大寫紅方／小寫黑方）。
 */
function encodePieceChar(piece: Piece): string {
  const code = TYPE_TO_CODE[piece.type];
  return piece.color === "r" ? code.toUpperCase() : code;
}

// ============================================================
// 5. 輔助函式：建立標準開局棋盤
// ============================================================

/**
 * 直接建立標準開局的 BoardGrid，等同於 parseFen(STANDARD_START_FEN)。
 * 提供此輔助函式方便呼叫端不需自行記憶常數名稱。
 */
export function createStandardStartBoard(): BoardGrid {
  return parseFen(STANDARD_START_FEN);
}