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
 * 帥/將：放在九宮格正中央（row8,col4），這樣「上下左右走一格」四個
 * 方向都在合法範圍內，可以一次畫出帥能走的所有路線。
 */
export function kingDemoBoard(): BoardGrid {
  return place(emptyBoard(), 8, 4, "k", "r");
}

/**
 * 仕/士：放在九宮格正中央，四個角落都構成合法的斜線目的地，
 * 一次畫出仕能走的所有路線（4 個方向）。
 */
export function advisorDemoBoard(): BoardGrid {
  return place(emptyBoard(), 8, 4, "a", "r");
}

/**
 * 相/象：放在 row7,col4（紅方這一側的「十字交叉點」），四個田字
 * 方向的落點都還在紅方半場內、也都在棋盤範圍內，一次展示全部 4 條路線。
 */
export function elephantDemoBoard(): BoardGrid {
  return place(emptyBoard(), 7, 4, "e", "r");
}

/**
 * 馬：放在盤面正中央（row5,col4），8 個日字方向的落點都在棋盤範圍內，
 * 一次展示馬所有可能的走法。
 */
export function horseDemoBoard(): BoardGrid {
  return place(emptyBoard(), 5, 4, "h", "r");
}

/**
 * 車：放在盤面正中央，方便畫出上下左右四個方向「一路到底」的路線，
 * 展示車可以直線走任意格數（示範用箭頭畫到底線，不是真的只能走那麼遠）。
 */
export function chariotDemoBoard(): BoardGrid {
  return place(emptyBoard(), 5, 4, "r", "r");
}

/**
 * 炮：不吃子的時候走法跟車一樣（直線任意格數），一樣放中央展示
 * 四個方向。吃子時的「隔炮架跳吃」規則另外用 cannonDemoBoard 示範。
 */
export function cannonMovementDemoBoard(): BoardGrid {
  return place(emptyBoard(), 5, 4, "c", "r");
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

/** 馬吃子練習：練習「日」字走法的吃子，順便複習蹩馬腳（這裡刻意不擋馬腳） */
export function horseCaptureExercise(): BoardGrid {
  const board = emptyBoard();
  place(board, 6, 4, "h", "r"); // 紅馬
  place(board, 4, 5, "p", "b"); // 日字方向（直2橫1）可以直接吃掉的黑卒
  return board;
}

// ============================================================
// 「被擋住了」教學示範（蹩馬腳／塞象眼），搭配 ChessBoard 的
// blockedPoints prop 在擋路的棋子上畫大叉。跟上面「展示所有走法」
// 的主要示範盤面是分開的兩顆棋盤，不會互相影響。
// ============================================================

/**
 * 馬蹩馬腳示範：馬正上方（走直線的那一格）有一顆棋子擋著，
 * 往上的兩個日字方向（左上、右上）就都不能走了。
 */
export function horseBlockedDemoBoard(): BoardGrid {
  const board = emptyBoard();
  place(board, 5, 4, "h", "r"); // 馬
  place(board, 4, 4, "p", "b"); // 擋在「馬腳」位置的黑卒
  return board;
}

/**
 * 象塞象眼示範：田字對角線中間那個點（象眼）有一顆棋子擋著，
 * 這個方向就不能走了。
 */
export function elephantBlockedDemoBoard(): BoardGrid {
  const board = emptyBoard();
  place(board, 7, 4, "e", "r"); // 象
  place(board, 6, 3, "p", "b"); // 塞住「象眼」的黑卒
  return board;
}

/**
 * 兵/卒比較示範：同時放兩顆紅兵，一顆還沒過河（下方）、一顆已經過河
 * （上方），方便同時展示兩者走法的差異（各自搭配自己的箭頭）。
 */
export function pawnComparisonDemoBoard(): BoardGrid {
  const board = emptyBoard();
  place(board, 6, 2, "p", "r"); // 還沒過河：只能往前
  place(board, 4, 6, "p", "r"); // 已經過河：前/左/右都可以
  return board;
}
