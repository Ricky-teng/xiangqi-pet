// src/lib/tutorial/demoBoards.ts
//
// 新手教學卡片專用的示範盤面產生器。
// 跟 usePuzzleSolver / battle 那些「真的在下棋」的邏輯完全無關，
// 純粹是「擺幾顆棋子在棋盤上，方便用圖說明規則」的展示用途，
// 所以刻意獨立成這個小檔案，不會跟遊戲邏輯互相影響。

import type { BoardGrid, Piece, PieceType } from "@/types/xiangqi";
import { parseSquare } from "@/lib/xiangqi/move";

/** 10x9 全空棋盤 */
export function emptyBoard(): BoardGrid {
  return Array.from({ length: 10 }, () => Array<Piece | null>(9).fill(null));
}

/** 在指定座標放一顆棋子，回傳同一個 board（方便串接呼叫） */
export function place(
  board: BoardGrid,
  row: number,
  col: number,
  type: PieceType,
  color: "r" | "b" = "r"
): BoardGrid {
  board[row][col] = { type, color };
  return board;
}

/**
 * 把一步棋（例如 "a9a5"）套用到盤面上：起點棋子搬到終點，終點原本
 * 的棋子（如果有）直接被吃掉消失。回傳一個新的 board（不修改原本的），
 * 用於吃子練習答對時，讓畫面上真的看到「棋子被吃掉了」的回饋。
 */
export function applyMove(board: BoardGrid, fromNotation: string, toNotation: string): BoardGrid {
  const from = parseSquare(fromNotation);
  const to = parseSquare(toNotation);
  const next = board.map((row) => [...row]);
  const movingPiece = next[from.row][from.col];
  next[from.row][from.col] = null;
  next[to.row][to.col] = movingPiece;
  return next;
}

/** 標準開局擺法（教學用的「認識棋盤」卡片示範） */
export function standardOpeningBoard(): BoardGrid {
  const board = emptyBoard();

  // 黑方在上（row 0 底線），紅方在下（row 9 底線）
  const backRank: PieceType[] = ["r", "h", "e", "a", "k", "a", "e", "h", "r"];
  backRank.forEach((type, col) => place(board, 0, col, type, "b"));
  backRank.forEach((type, col) => place(board, 9, col, type, "r"));

  // 炮
  place(board, 2, 1, "c", "b");
  place(board, 2, 7, "c", "b");
  place(board, 7, 1, "c", "r");
  place(board, 7, 7, "c", "r");

  // 兵/卒（間隔一格，共 5 個）
  [0, 2, 4, 6, 8].forEach((col) => {
    place(board, 3, col, "p", "b");
    place(board, 6, col, "p", "r");
  });

  return board;
}

/**
 * 帥/將：九宮格內示範（紅方九宮格是 row7~9、col3~5）。
 * 帥站在九宮格正中間，用一個箭頭示範「直線走一格」。
 */
export function kingDemoBoard(): BoardGrid {
  return place(emptyBoard(), 8, 4, "k", "r");
}

/** 仕/士：九宮格內斜走一格 */
export function advisorDemoBoard(): BoardGrid {
  return place(emptyBoard(), 9, 3, "a", "r");
}

/** 相/象：走「田」字（兩點對角線），不能過河 */
export function elephantDemoBoard(): BoardGrid {
  return place(emptyBoard(), 9, 2, "e", "r");
}

/** 馬：走「日」字 */
export function horseDemoBoard(): BoardGrid {
  return place(emptyBoard(), 9, 1, "h", "r");
}

/** 車：直線走任意格數 */
export function chariotDemoBoard(): BoardGrid {
  return place(emptyBoard(), 9, 0, "r", "r");
}

/**
 * 炮：不吃子時像車一樣直線走；吃子時中間要隔剛好一個「炮架」。
 * 擺法：紅炮在中間，中間隔一顆棋子（炮架），最遠端擺一顆黑子當獵物，
 * 用箭頭示範「跳過炮架去吃掉對面的子」。
 */
export function cannonDemoBoard(): BoardGrid {
  const board = emptyBoard();
  place(board, 6, 4, "c", "r"); // 紅炮
  place(board, 4, 4, "p", "r"); // 炮架（自己的兵也可以當炮架）
  place(board, 1, 4, "h", "b"); // 對面的黑馬，被炮吃掉
  return board;
}

/** 兵/卒過河前：只能往前走一格 */
export function pawnBeforeRiverDemoBoard(): BoardGrid {
  return place(emptyBoard(), 6, 4, "p", "r");
}

/** 兵/卒過河後：可以往前或左右走一格（但永遠不能後退） */
export function pawnAfterRiverDemoBoard(): BoardGrid {
  return place(emptyBoard(), 4, 4, "p", "r");
}

// ============================================================
// 吃子練習用的初始盤面
// ------------------------------------------------------------
// 跟上面「單純展示走法」的盤面不同，這些是給互動練習用的：
// 玩家要自己點紅棋、點黑棋完成吃子，元件會判斷是否吃對棋子。
// ============================================================

/** 車吃子練習：直線上有一顆黑子擋在路上，練習「直線吃子」最基本的情境 */
export function chariotCaptureExercise(): BoardGrid {
  const board = emptyBoard();
  place(board, 9, 0, "r", "r"); // 紅車
  place(board, 5, 0, "h", "b"); // 直線正前方的黑馬，可以直接吃掉
  return board;
}

/** 炮吃子練習：中間隔一個炮架，練習「跳吃」這個炮專屬的規則 */
export function cannonCaptureExercise(): BoardGrid {
  const board = emptyBoard();
  place(board, 6, 4, "c", "r"); // 紅炮
  place(board, 4, 4, "p", "b"); // 炮架（這裡刻意放黑子，示範炮架不分敵我）
  place(board, 1, 4, "h", "b"); // 隔著炮架，可以跳過去吃掉的黑馬
  return board;
}
