/**
 * src/lib/engine/rulesEngine.ts
 *
 * 真正的象棋規則引擎（合法走法、將軍、將死判定）
 * ------------------------------------------------------------
 * 之前的解題系統（usePuzzleSolver.ts）完全沒有「這步合不合法」這層
 * 判斷——只是把學生的走法跟預錄好的正解逐字比對，不是真的下棋規則。
 * 「跟電腦對弈」需要的是真正的象棋規則：任何一步只要合法就能下，
 * 電腦要能判斷將軍/將死/困斃，這些都需要一個真正的規則引擎。
 *
 * 用 ffish-es6（基於 Fairy-Stockfish 編譯成 WASM 的套件，明確支援
 * xiangqi 變體）。這個套件已經實測過確實能正確跑出標準開局的合法
 * 走法數（44 種，跟真實象棋吻合）。
 *
 * 【棋子字母編碼轉換】
 * 這個 App 的 FEN 用 k/a/e/h/r/c/p（將/仕/相/馬/車/炮/兵，h=horse
 * 取「horse」的字頭，e=elephant 取「elephant」的字頭），但 ffish-es6
 * 內部用的是對應西洋棋棋子外觀的字母：k/a/b/n/r/c/p（n=knight 對應馬，
 * b=bishop 對應象/相）。差異只在 h↔n、e↔b 這兩個字母，其他字母
 * （k/a/r/c/p）剛好相同。走法記號本身（例如 "h2e2" 這種四字元座標）
 * 兩邊格式一致，不需要轉換。
 *
 * 【瀏覽器內載入 WASM】
 * ffish-es6 預設用相對路徑 fetch ffish.wasm，在 Next.js 的打包環境下
 * 不一定能正確解析這個路徑，所以改成：把 ffish.wasm 複製一份到
 * public/ffish.wasm，並用 locateFile 選項明確指向這個固定的公開路徑，
 * 不依賴套件預設的路徑解析機制。
 */

import Module, { type Board, type FairyStockfish } from "ffish-es6";

const XIANGQI_VARIANT = "xiangqi";

/** 棋子字母對照表：這個 App 的字母 → ffish-es6 的字母（只有 h/e 需要轉換） */
const APP_TO_FFISH_LETTER: Record<string, string> = {
  h: "n",
  H: "N",
  e: "b",
  E: "B",
};

/** 反向對照表：ffish-es6 的字母 → 這個 App 的字母 */
const FFISH_TO_APP_LETTER: Record<string, string> = {
  n: "h",
  N: "H",
  b: "e",
  B: "E",
};

function translateLetters(input: string, table: Record<string, string>): string {
  let result = "";
  for (const char of input) {
    result += table[char] ?? char;
  }
  return result;
}

/**
 * 【重要更正】一開始以為兩邊只有棋子字母（h/e vs n/b）不同，走法座標格式
 * 一樣可以直接共用——後來實測才發現排數編號系統整個不一樣：
 *   - 這個 App：排數 0~9，紅方底線＝排數 9（FEN 字串最後一行）
 *   - ffish-es6：排數 1~10，紅方底線＝排數 1（FEN 字串最後一行）
 * 換算公式：ffish排數 = 10 − App排數（兩邊互相轉換公式相同）。
 * 因為 ffish 排數最大到 10（兩位數字），走法記號長度可能是 4 或 5 個字元
 * （例如 "b3b10"），跟這個 App 永遠固定 4 字元不同，所以不能直接做
 * 字元替換，需要先解析成「起點檔/排、終點檔/排」再分別換算、組回字串。
 *
 * FEN 棋盤佈局字串本身（"/" 分隔的 10 行）不需要排數轉換，因為兩邊
 * 都是「字串裡第一行＝黑方底線，最後一行＝紅方底線」，順序一致，只有
 * 走法記號裡「數字代表第幾排」這個語意不同，才需要換算。
 */

/** 解析這個 App 的走法記號（固定 4 字元：檔/排/檔/排，排數 0-9） */
function parseAppMove(appMove: string): { fromFile: string; fromRank: number; toFile: string; toRank: number } {
  if (appMove.length !== 4) {
    throw new Error(`走法記號格式錯誤，應為固定 4 字元：${appMove}`);
  }
  return {
    fromFile: appMove[0],
    fromRank: Number(appMove[1]),
    toFile: appMove[2],
    toRank: Number(appMove[3]),
  };
}

/** 解析 ffish-es6 的走法記號（排數可能是 1-2 位數字，例如 "b3b10"） */
function parseFfishMove(ffishMove: string): { fromFile: string; fromRank: number; toFile: string; toRank: number } {
  const match = ffishMove.match(/^([a-i])(10|[1-9])([a-i])(10|[1-9])$/);
  if (!match) {
    throw new Error(`無法解析 ffish-es6 走法記號：${ffishMove}`);
  }
  const [, fromFile, fromRankStr, toFile, toRankStr] = match;
  return { fromFile, fromRank: Number(fromRankStr), toFile, toRank: Number(toRankStr) };
}

/** 這個 App 的走法記號 → ffish-es6 的走法記號 */
function appMoveToFfishMove(appMove: string): string {
  const { fromFile, fromRank, toFile, toRank } = parseAppMove(appMove);
  return `${fromFile}${10 - fromRank}${toFile}${10 - toRank}`;
}

/** ffish-es6 的走法記號 → 這個 App 的走法記號 */
function ffishMoveToAppMove(ffishMove: string): string {
  const { fromFile, fromRank, toFile, toRank } = parseFfishMove(ffishMove);
  return `${fromFile}${10 - fromRank}${toFile}${10 - toRank}`;
}
function toFfishFen(appFen: string, sideToMove: "w" | "b" = "w"): string {
  const boardPart = translateLetters(appFen.trim(), APP_TO_FFISH_LETTER);
  // ffish-es6 的 board-only FEN（不含 side-to-move）在建構 Board 時可以正常使用，
  // 但要繼續往下走棋（push）需要完整 FEN，所以這裡一律補上 side-to-move。
  return `${boardPart} ${sideToMove}`;
}

/** 把 ffish-es6 回傳的 FEN 轉回這個 App 的字母格式，並去掉 side-to-move 等後綴 */
function fromFfishFen(ffishFen: string): string {
  const boardPart = ffishFen.trim().split(" ")[0];
  return translateLetters(boardPart, FFISH_TO_APP_LETTER);
}

export type GameResultStatus =
  | "ongoing"
  | "red_wins"
  | "black_wins"
  | "draw";

export interface GameStatus {
  isGameOver: boolean;
  isCheck: boolean;
  /** true 代表紅方下一步，false 代表黑方下一步（跟 ffish-es6 的 turn() 一致） */
  isRedToMove: boolean;
  result: GameResultStatus;
}

export interface RulesEngineApi {
  /** 取得某個局面下所有合法走法（四字元座標記號，例如 "h2e2"） */
  getLegalMoves(appFen: string, sideToMove: "w" | "b"): string[];
  /** 判斷某一步在某個局面下是否合法 */
  isLegalMove(appFen: string, sideToMove: "w" | "b", move: string): boolean;
  /** 判斷某一步是不是吃子（給電腦對手的難度邏輯用：等級越高越傾向吃子） */
  isCaptureMove(appFen: string, sideToMove: "w" | "b", move: string): boolean;
  /** 套用一步走法，回傳套用後的新局面（這個 App 格式的 FEN）跟新的輪走方 */
  applyMove(
    appFen: string,
    sideToMove: "w" | "b",
    move: string
  ): { fen: string; sideToMove: "w" | "b" };
  /** 取得某個局面的狀態（是否將軍、是否終局、終局結果） */
  getGameStatus(appFen: string, sideToMove: "w" | "b"): GameStatus;
}

let modulePromise: Promise<FairyStockfish> | null = null;

/**
 * 載入 ffish-es6 的 WASM 模組（只會真正載入一次，後續呼叫共用同一個
 * Promise，避免每個用到規則引擎的元件各自重新載入一次 WASM）。
 */
function loadFfishModule(): Promise<FairyStockfish> {
  if (!modulePromise) {
    modulePromise = Module({
      locateFile: (file: string) => (file.endsWith(".wasm") ? "/ffish.wasm" : file),
    });
  }
  return modulePromise;
}

/** 用一個局面暫時建立 Board 物件、執行查詢、查完立刻 delete 釋放記憶體 */
function withBoard<T>(
  ffish: FairyStockfish,
  appFen: string,
  sideToMove: "w" | "b",
  callback: (board: Board) => T
): T {
  const board = new ffish.Board(XIANGQI_VARIANT, toFfishFen(appFen, sideToMove));
  try {
    return callback(board);
  } finally {
    board.delete();
  }
}

function resolveGameResult(board: Board): GameResultStatus {
  if (!board.isGameOver()) return "ongoing";
  const resultString = board.result(); // "1-0" 紅勝 / "0-1" 黑勝 / "1/2-1/2" 和棋
  if (resultString === "1-0") return "red_wins";
  if (resultString === "0-1") return "black_wins";
  return "draw";
}

/**
 * 載入規則引擎並回傳可重複呼叫的 API。元件層級可以用這個搭配
 * useEffect/useState 包成 Hook（見 useRulesEngine.ts），確保畫面只在
 * 引擎真正準備好之後才允許下棋互動。
 */
export async function createRulesEngine(): Promise<RulesEngineApi> {
  const ffish = await loadFfishModule();

  return {
    getLegalMoves(appFen, sideToMove) {
      return withBoard(ffish, appFen, sideToMove, (board) =>
        board
          .legalMoves()
          .split(" ")
          .filter(Boolean)
          .map(ffishMoveToAppMove)
      );
    },

    isLegalMove(appFen, sideToMove, move) {
      return withBoard(ffish, appFen, sideToMove, (board) => {
        const ffishMove = appMoveToFfishMove(move);
        return board.legalMoves().split(" ").includes(ffishMove);
      });
    },

    isCaptureMove(appFen, sideToMove, move) {
      return withBoard(ffish, appFen, sideToMove, (board) => {
        const ffishMove = appMoveToFfishMove(move);
        return board.isCapture(ffishMove);
      });
    },

    applyMove(appFen, sideToMove, move) {
      return withBoard(ffish, appFen, sideToMove, (board) => {
        const ffishMove = appMoveToFfishMove(move);
        const pushed = board.push(ffishMove);
        if (!pushed) {
          throw new Error(`不合法的走法：${move}（局面：${appFen}）`);
        }
        const newFfishFen = board.fen();
        const newSideToMove = newFfishFen.trim().split(" ")[1] === "b" ? "b" : "w";
        return { fen: fromFfishFen(newFfishFen), sideToMove: newSideToMove };
      });
    },

    getGameStatus(appFen, sideToMove) {
      return withBoard(ffish, appFen, sideToMove, (board) => ({
        isGameOver: board.isGameOver(),
        isCheck: board.isCheck(),
        isRedToMove: board.turn(),
        result: resolveGameResult(board),
      }));
    },
  };
}
