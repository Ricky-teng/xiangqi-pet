/**
 * src/lib/xiangqi/chineseNotation.ts
 *
 * 把這個 App 的座標走法記號（例如 "h9g7"）轉成傳統中文記譜
 * （例如「馬2進5」），純前端計算，不需要呼叫任何引擎/API。
 * ------------------------------------------------------------
 * 一開始想直接用 ffish-es6 內建的 XIANGQI_WXF 記譜功能（它的型別定義
 * 裡確實列出這個選項），但實測發現這個套件目前包的 WASM 編譯版本
 * 並沒有真的實作這個轉換（不管傳哪個 notation 數值，輸出都一樣，
 * 是西式記號），所以這裡自己實作。
 *
 * 【座標規則】（這個 App 的座標系統：檔案 a-i，排數 0-9，紅方底線在
 * 排數 9、黑方底線在排數 0）
 *   - 紅方的「傳統直線編號」是從紅方自己的右手邊數 1~9（紅方坐在
 *     棋盤下方面對黑方，紅方右手邊對應畫面右側），所以：
 *       紅方傳統直線編號 = 9 − col（col 是 0-indexed，a=0...i=8）
 *   - 黑方的「傳統直線編號」是從黑方自己的右手邊數 1~9（黑方坐在
 *     棋盤上方面對紅方，黑方右手邊對應畫面左側），所以：
 *       黑方傳統直線編號 = col + 1
 *   這個換算已經用「炮二平五」這個眾所皆知的開局走法驗證過：紅方
 *   右炮（這個 App 座標的 h7）算出來正好是傳統編號「2」，移到中央
 *   （e7，傳統編號「5」）完全吻合。
 *
 * 【數字用阿拉伯數字，不是中文數字】這裡採用「馬2進5」這種阿拉伯
 * 數字寫法（不是「馬二進五」的中文數字寫法）——兩種寫法在實務上
 * 都很常見，這裡配合使用情境選阿拉伯數字版本，紅黑雙方一致，只靠
 * 「直線編號的數方向不同」跟「棋子名稱本身」區分紅黑（仕/士、
 * 相/象、帥/將、兵/卒），不需要額外的中文數字轉換邏輯。
 *
 * 【進/退/平 跟後面數字的意義，依棋子種類而不同】
 *   - 車、炮、兵卒、帥將：直線移動。同排移動（檔案改變、排數不變）
 *     用「平」+ 目的地直線編號；沿著同一條直線前進/後退用「進」/
 *     「退」+ 移動的排數（兵卒帥將通常只移動1排，車炮可以移動多排）。
 *   - 馬、仕士、相象：每一步移動都同時改變檔案跟排數（馬走日字、
 *     仕走斜一步、相走田字），永遠用「進」/「退」（沒有「平」這種
 *     走法），後面接的數字是「目的地的直線編號」，不是移動的排數。
 *
 * 【同直線多子的處理】如果同一直線上有兩個同類型的棋子（常見於馬、
 * 車），傳統記譜會用「前」「後」取代直線編號來消除歧義（例如
 * 「前馬進1」）。這個函式會自動偵測這種情況並套用。
 */

import type { BoardGrid, PieceColor, PieceType } from "@/types/xiangqi";
import { PIECE_LABEL } from "@/types/xiangqi";

interface ParsedSquare {
  col: number;
  row: number;
}

function parseSquare(square: string): ParsedSquare {
  const col = square.charCodeAt(0) - "a".charCodeAt(0);
  const row = Number(square[1]);
  return { col, row };
}

/** 紅方/黑方各自的傳統直線編號（1-9），見檔案頂部說明的換算公式 */
function toTraditionalFileNumber(col: number, color: PieceColor): number {
  return color === "r" ? 9 - col : col + 1;
}

/** 同一直線（同傳統直線編號）上，是否還有其他同類型、同色的棋子 */
function findSameFileSameTypePieces(
  board: BoardGrid,
  fromCol: number,
  pieceType: PieceType,
  color: PieceColor
): number[] {
  const rows: number[] = [];
  for (let row = 0; row < 10; row++) {
    const cell = board[row]?.[fromCol];
    if (cell && cell.type === pieceType && cell.color === color) {
      rows.push(row);
    }
  }
  return rows;
}

/**
 * 把這個 App 的走法記號轉成傳統中文記譜。boardBeforeMove 必須是「套用
 * 這步之前」的局面（用來判斷是哪個棋子在動、有沒有同直線多子的歧義），
 * 不是套用之後的局面。
 */
export function toChineseNotation(boardBeforeMove: BoardGrid, move: string): string {
  const from = parseSquare(move.slice(0, 2));
  const to = parseSquare(move.slice(2, 4));

  const movingPiece = boardBeforeMove[from.row]?.[from.col];
  if (!movingPiece) {
    // 防呆：理論上不該發生（呼叫端應該保證 move 是套用在 boardBeforeMove
    // 上的合法走法），萬一真的發生，回退顯示原始座標記號，不要整個壞掉。
    return move;
  }

  const { type: pieceType, color } = movingPiece;
  const pieceName = PIECE_LABEL[pieceType][color === "r" ? "red" : "black"];

  const sameFilePieces = findSameFileSameTypePieces(boardBeforeMove, from.col, pieceType, color);
  const hasAmbiguity = sameFilePieces.length > 1;

  // 「前」「後」消歧義：排數比較靠近對方（紅方排數比較小、黑方排數
  // 比較大）的算「前」，比較靠近自己這邊的算「後」。多於兩個同直線
  // 同類型棋子的情況極為罕見（理論上一直線最多撞到底，但傳統記譜
  // 本身也只定義前後兩種，這裡只處理最常見的兩個的情況，第三個以上
  // 還是會標示「前」或「後」但可能不夠精確——這個邊緣情況故意不過度
  // 處理，保持函式單純）。
  let pieceLabel = `${pieceName}${toTraditionalFileNumber(from.col, color)}`;
  if (hasAmbiguity) {
    const sortedRows = [...sameFilePieces].sort((a, b) => (color === "r" ? a - b : b - a));
    const isFront = sortedRows[0] === from.row;
    pieceLabel = `${isFront ? "前" : "後"}${pieceName}`;
  }

  const sameRow = from.row === to.row;
  const traditionalToFile = toTraditionalFileNumber(to.col, color);

  // 「前進」方向：紅方排數變小、黑方排數變大算前進。
  const movedForward = color === "r" ? to.row < from.row : to.row > from.row;

  // 馬、仕、相每一步都同時改變排數跟檔案，傳統記譜永遠用進/退 + 目的地
  // 直線編號，沒有「平」這種寫法。
  const alwaysDiagonalLike = pieceType === "h" || pieceType === "a" || pieceType === "e";

  if (!alwaysDiagonalLike && sameRow) {
    return `${pieceLabel}平${traditionalToFile}`;
  }

  if (alwaysDiagonalLike) {
    return `${pieceLabel}${movedForward ? "進" : "退"}${traditionalToFile}`;
  }

  // 車、炮、兵卒、帥將沿直線前進/後退：後面接的數字是移動的排數，
  // 不是目的地直線編號。
  const rankDistance = Math.abs(to.row - from.row);
  return `${pieceLabel}${movedForward ? "進" : "退"}${rankDistance}`;
}
