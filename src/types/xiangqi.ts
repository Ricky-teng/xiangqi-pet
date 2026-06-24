// src/types/xiangqi.ts

/**
 * 棋子顏色：r 代表紅方（Red），b 代表黑方（Black）
 */
export type PieceColor = "r" | "b";

/**
 * 棋子兵種（採用 FEN 標準記號的小寫字母）：
 * k: 將/帥 (King)
 * a: 士/仕 (Advisor)
 * e: 象/相 (Elephant)
 * h: 馬 (Horse)
 * c: 車 (Chariot/Rook)
 * n: 炮/砲 (Cannon)
 * p: 兵/卒 (Pawn)
 */
export type PieceType = "k" | "a" | "e" | "h" | "r" | "c" | "p";

/**
 * 棋子物件介面
 */
export interface Piece {
  type: PieceType;
  color: PieceColor;
}

/**
 * FEN 棋子代碼（大寫為紅方，小寫為黑方）
 * 紅方：K, A, E, H, C, N, P
 * 黑方：k, a, e, h, c, n, p
 */
export type PieceCode =
  | "K" | "A" | "E" | "H" | "R" | "C" | "P"
  | "k" | "a" | "e" | "h" | "r" | "c" | "p";
/**
 * 棋盤座標系統：
 * col (直列): 0 到 8 (對應 a 到 i，紅方視角由左至右)
 * row (橫線): 0 到 9 (row 0 為黑方底線，row 9 為紅方底線)
 */
export interface Position {
  row: number; // 0 ~ 9
  col: number; // 0 ~ 8
}

/**
 * 9x10 的二維棋盤陣列，null 代表該格子沒有棋子
 */
export type BoardGrid = (Piece | null)[][];

/**
 * 單步走法
 */
export interface Move {
  from: Position; // 起點座標
  to: Position;   // 終點座標
}

/**
 * 題目難度等級：1 級（初學者）～ 10 級（最高級）
 */
export type PuzzleLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * 多步殺正解走法序列，例如：["h2e2", "h8g7", "e3e4"]
 * 偶數索引 (0, 2, 4...) 為學生（紅方）正解
 * 奇數索引 (1, 3, 5...) 為電腦（黑方）自動回應
 */
export type SolutionSequence = string[];

/**
 * 當前互動解題的狀態
 */
export interface SolverState {
  currentStep: number;         // 目前對應到正解序列的第幾步 (0-indexed)
  isCompleted: boolean;        // 是否順利通關
  consecutiveWrongCount: number; // 同一題連續答錯次數（答對一步就會歸零）
  hintUsed: boolean;           // 本題是否使用過提示
  /**
   * 本次解題（從頭到完成）累計答錯次數，不會因為中途答對一步而歸零，
   * 只有重新挂載（重新進入這道題）才會回到 0。
   * 用途：解題完成時連同 SolvedPuzzleRecord 一併寫入 Firestore，
   * 供老師監控後台統計「這個學生這道題錯了幾次才解出來」。
   */
  totalWrongAttempts: number;
}
