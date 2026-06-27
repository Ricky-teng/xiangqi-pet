/**
 * src/lib/engine/pikafishProcess.ts
 *
 * 真正的 Pikafish 引擎（伺服器端，原生執行檔，不是 WASM）
 * ------------------------------------------------------------
 * 只能在 Node.js 伺服器環境執行（API Route），不能在瀏覽器執行——
 * 用 child_process 把 vendor/pikafish/pikafish 這個原生執行檔當子
 * 程序啟動，透過 UCI 協議（標準輸入/輸出文字指令）跟它對話。
 *
 * 【為什麼選這個方案，不是 WASM】
 * Pikafish 官方自己的網頁版也承認「棋力比原生版弱」（WASM 在瀏覽器
 * 執行天生比編譯成機器碼慢）。改用「伺服器端跑原生執行檔」完全不用
 * 犧牲棋力，而且 Vercel 的 Node.js Serverless Function 本身就支援
 * spawn 子程序執行已經包進部署包裡的執行檔。
 *
 * 【座標系統】
 * 實測確認 Pikafish 跟這個 App 用的是同一套排數（0-9，紅方底線是
 * 排數 0），跟 ffish-es6（規則引擎，1-10、紅方底線是排數1）不一樣。
 * 所以這裡只需要棋子字母轉換（h↔n, e↔b，跟 rulesEngine.ts 同一套
 * 邏輯但是獨立實作，因為這個檔案完全是 Node.js 環境，不能 import
 * 瀏覽器端的 rulesEngine.ts），完全不需要排數轉換。
 *
 * 【難度設定】
 * Pikafish 沒有內建的「Skill Level」之類弱化選項，所以難度是靠
 * 「搜尋深度上限 + 思考時間上限（兩者取先到的）」控制，見
 * LEVEL_SEARCH_CONFIG。思考時間上限同時也是保護 Vercel 函式執行
 * 時間限制的安全閥。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs";
import path from "path";
import type { ComputerLevel } from "@/lib/engine/computerPlayer";

const APP_TO_PIKAFISH_LETTER: Record<string, string> = { h: "n", H: "N", e: "b", E: "B" };

function translateLetters(input: string, table: Record<string, string>): string {
  let result = "";
  for (const char of input) {
    result += table[char] ?? char;
  }
  return result;
}

/**
 * 【重要更正】一開始實測 Pikafish 的 "d" 除錯指令，看到棋子字母跟
 * 排數範圍（0-9）跟這個 App 一樣，就誤判兩邊座標系統相同——後來拿
 * 真正的走法結果去跟 rulesEngine.ts（ffish-es6）交叉驗證，發現
 * Pikafish 回傳的走法被判定不合法，才發現少看了一個關鍵差異：
 * Pikafish 的排數 0 是「紅方底線」（顯示在視覺棋盤最下面），但這個
 * App 的排數 0 是「黑方底線」（FEN 字串的第一行）——兩邊排數定義
 * 上下顛倒。換算公式：pikafishRow = 9 − appRow（雙向公式相同）。
 * 棋子字母（h↔n、e↔b）的轉換本身是對的，只是還需要加上這個排數
 * 顛倒的轉換，兩者都要做才正確。
 */

/** 解析這個 App 的走法記號（固定 4 字元：檔/排/檔/排，排數 0-9） */
function parseAppMove(appMove: string): { fromFile: string; fromRow: number; toFile: string; toRow: number } {
  return {
    fromFile: appMove[0],
    fromRow: Number(appMove[1]),
    toFile: appMove[2],
    toRow: Number(appMove[3]),
  };
}

/** 這個 App 的走法記號 → Pikafish 的走法記號（排數顛倒：9 − row）。
 * 目前的設計每次都是送「完整局面 FEN」，不是送「開局+完整走法歷史」，
 * 所以呼叫端目前不需要把學生/電腦走過的歷史走法轉換成 Pikafish 格式
 * 餵給它——只有「引擎吐出來的 bestmove」需要轉換回 App 格式
 * （fromPikafishMove）。如果之後想改成送完整走法歷史（例如要讓引擎
 * 正確套用需要完整歷史才能判斷的長將/重複局面規則），到時候才會
 * 需要這個方向的轉換，先保留這段說明方便之後擴充。 */

/** Pikafish 的走法記號 → 這個 App 的走法記號（同一個換算公式，雙向對稱） */
function fromPikafishMove(pikafishMove: string): string {
  const { fromFile, fromRow, toFile, toRow } = parseAppMove(pikafishMove);
  return `${fromFile}${9 - fromRow}${toFile}${9 - toRow}`;
}

/** 這個 App 的 FEN（沒有 side-to-move 後綴）→ Pikafish 看得懂的完整 FEN。
 * FEN 棋盤佈局字串本身（"/" 分隔的 10 行）不需要排數轉換，因為「黑方
 * 底線是第一行、紅方底線是最後一行」這個字串排列順序兩邊是一致的，
 * 排數顛倒只發生在「走法記號裡的數字」這個語意層級，跟 FEN 字串本身
 * 的行順序是分開的兩件事。 */
function toPikafishFen(appFen: string, sideToMove: "w" | "b"): string {
  return `${translateLetters(appFen.trim(), APP_TO_PIKAFISH_LETTER)} ${sideToMove}`;
}

/**
 * 優化後的皮卡魚難度配置
 * 1. 修正了高難度下深度與時間不匹配的問題（調低了10級的預期深度，拉長了時間）。
 * 2. 確保 movetime 絕對不超過 9000ms，為 Vercel 預留足夠的 HTTP 傳輸與 API 回傳緩衝時間（防止 504 Timeout）。
 */
const LEVEL_SEARCH_CONFIG: Record<ComputerLevel, { depth: number; movetimeMs: number }> = {
  1: { depth: 1, movetimeMs: 100 },
  2: { depth: 2, movetimeMs: 200 },
  3: { depth: 4, movetimeMs: 350 },
  4: { depth: 6, movetimeMs: 500 },
  5: { depth: 8, movetimeMs: 800 },
  6: { depth: 10, movetimeMs: 1200 },
  7: { depth: 12, movetimeMs: 1800 },
  8: { depth: 14, movetimeMs: 2600 },
  9: { depth: 16, movetimeMs: 4000 },
  10: { depth: 18, movetimeMs: 8500 }, // 8.5秒是 Vercel Serverless Function 既安全又能發揮最高棋力的平衡點
};

/**
 * 【等級1~3的「亂走/送子」感】只靠搜尋深度淺，不足以讓電腦看起來像
 * 真的會犯錯——就算只搜1層，NNUE 評估函式本身還是很準，電腦依然會
 * 挑「當下看起來最不糟」的那一步，不會主動送子。要做出「常送子」的
 * 體感，必須讓電腦有意選擇明知比較差的走法，不能只靠搜得淺。
 *
 * 做法：低等級時請 Pikafish 同時回報多條候選線（MultiPV），每條都有
 * 自己的分數；選棋時不是永遠選第1名，而是依等級決定「有多大機率不選
 * 最好的那條、改選排名比較後面（分數比較差）的那條」。分數比較差的
 * 候選線本來就常常是「送了子」「漏了防守」這類明顯缺陷的走法，這樣
 * 選出來的「錯」是真正有意義的錯，不是純粹的隨機亂下。
 */
const LEVEL_MULTIPV_CONFIG: Record<ComputerLevel, { multiPv: number; topChoiceProbability: number }> = {
  1: { multiPv: 8, topChoiceProbability: 0.15 },
  2: { multiPv: 6, topChoiceProbability: 0.3 },
  3: { multiPv: 5, topChoiceProbability: 0.45 },
  4: { multiPv: 4, topChoiceProbability: 0.6 },
  5: { multiPv: 3, topChoiceProbability: 0.75 },
  6: { multiPv: 2, topChoiceProbability: 0.85 },
  7: { multiPv: 1, topChoiceProbability: 1 },
  8: { multiPv: 1, topChoiceProbability: 1 },
  9: { multiPv: 1, topChoiceProbability: 1 },
  10: { multiPv: 1, topChoiceProbability: 1 },
};

function getPikafishBinaryPath(): string {
  return path.join(process.cwd(), "vendor", "pikafish", "pikafish");
}

function getNnueFilePath(): string {
  return path.join(process.cwd(), "vendor", "pikafish", "pikafish.nnue");
}

interface SearchResult {
  move: string;
  scoreCp: number;
  depth: number;
}

/**
 * 核心搜尋邏輯：啟動子程序、設定 MultiPV/權重檔、送出局面、等
 * bestmove。回傳「依排名分組的候選線」+ UCI 直接給的 bestmove
 * 字串，呼叫端（getPikafishMove 或 analyzePosition）各自決定要怎麼
 * 從候選線裡選出最終結果——遊戲對弈時可能故意選非最佳線製造「送子」
 * 效果，棋局分析時則永遠要最佳線，所以選擇邏輯不適合寫在這個共用
 * 函式裡，這裡只負責「跟引擎對話、拿到所有候選線資料」這件事。
 */
async function runPikafishSearch(
  appFen: string,
  sideToMove: "w" | "b",
  searchConfig: { depth: number; movetimeMs: number },
  multiPv: number
): Promise<{ candidatesByRank: Map<number, SearchResult>; bestmoveToken: string }> {
  const pikafishFen = toPikafishFen(appFen, sideToMove);
  const binaryPath = getPikafishBinaryPath();
  const nnuePath = getNnueFilePath();

  console.log("[pikafishProcess] process.cwd():", process.cwd());
  console.log("[pikafishProcess] binaryPath:", binaryPath, "存在:", fs.existsSync(binaryPath));
  console.log("[pikafishProcess] nnuePath:", nnuePath, "存在:", fs.existsSync(nnuePath));

  if (!fs.existsSync(binaryPath)) {
    throw new Error(`找不到 Pikafish 執行檔：${binaryPath}（process.cwd()=${process.cwd()}）`);
  }
  if (!fs.existsSync(nnuePath)) {
    throw new Error(`找不到 Pikafish 權重檔：${nnuePath}（process.cwd()=${process.cwd()}）`);
  }

  return new Promise((resolve, reject) => {
    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(binaryPath, [], { cwd: path.dirname(nnuePath) });
      console.log("[pikafishProcess] spawn 呼叫完成，pid:", proc.pid);
    } catch (error) {
      reject(new Error(`啟動 Pikafish 執行檔失敗：${error instanceof Error ? error.message : error}`));
      return;
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const candidatesByRank = new Map<number, SearchResult>();
    let settled = false;
    let receivedAnyOutput = false;

    // 安全閥：不管引擎回不回應，最多等 movetimeMs 再加一點緩衝時間，
    // 超過就強制視為失敗，避免 API 卡死。
    const hardTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.log(
        "[pikafishProcess] 逾時。曾經收到任何 stdout 輸出嗎:",
        receivedAnyOutput,
        "stderr 內容:",
        stderrBuffer.slice(0, 2000),
        "目前累積的 stdout 內容:",
        stdoutBuffer.slice(0, 2000)
      );
      proc.kill();
      reject(new Error(`Pikafish 引擎回應逾時（曾收到輸出：${receivedAnyOutput}）`));
    }, searchConfig.movetimeMs + 8000);

    function cleanup() {
      clearTimeout(hardTimeout);
      proc.stdout.removeAllListeners("data");
      proc.stderr.removeAllListeners("data");
    }

    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Pikafish 子程序錯誤：${error.message}`));
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      if (!receivedAnyOutput) {
        receivedAnyOutput = true;
        console.log("[pikafishProcess] 收到第一筆 stdout 輸出:", chunk.toString("utf-8").slice(0, 500));
      }
      stdoutBuffer += chunk.toString("utf-8");

      const lines = stdoutBuffer.split("\n");
      for (const line of lines) {
        if (line.startsWith("info") && line.includes("score cp") && line.includes(" pv ")) {
          const multipvMatch = line.match(/multipv (\d+)/);
          const depthMatch = line.match(/depth (\d+)/);
          const scoreMatch = line.match(/score cp (-?\d+)/);
          const pvMatch = line.match(/ pv (\S+)/);
          if (multipvMatch && depthMatch && scoreMatch && pvMatch) {
            candidatesByRank.set(Number(multipvMatch[1]), {
              move: pvMatch[1],
              scoreCp: Number(scoreMatch[1]),
              depth: Number(depthMatch[1]),
            });
          }
        }

        if (line.startsWith("bestmove")) {
          if (settled) return;
          const bestmoveToken = line.split(" ")[1];
          if (!bestmoveToken || bestmoveToken === "(none)") {
            settled = true;
            cleanup();
            proc.kill();
            reject(new Error("Pikafish 回傳「沒有合法走法」，呼叫端應該在呼叫前先確認遊戲還沒結束。"));
            return;
          }
          settled = true;
          cleanup();
          proc.kill();
          resolve({ candidatesByRank, bestmoveToken });
          return;
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      // 之前這裡完全沒記錄 stderr，導致 Linux 動態連結器找不到相容
      // 函式庫版本時印出的錯誤訊息完全看不到，排查問題時瞎子摸象了
      // 很久。現在改成記錄起來，逾時或失敗時會印在上面的診斷訊息裡。
      stderrBuffer += chunk.toString("utf-8");
    });

    proc.stdin.write(`setoption name EvalFile value ${nnuePath}\n`);
    proc.stdin.write(`setoption name MultiPV value ${multiPv}\n`);
    proc.stdin.write("isready\n");
    proc.stdin.write(`position fen ${pikafishFen}\n`);
    proc.stdin.write(`go depth ${searchConfig.depth} movetime ${searchConfig.movetimeMs}\n`);
  });
}

/**
 * 依等級決定的機率，從 MultiPV 候選線裡選一條：大機率選排名第1
 * （最好的那條），否則從排名第2之後均勻隨機選一條（故意選比較差的，
 * 製造「送子」之類有意義的錯誤）。
 *
 * candidatesByRank 為空（極端邊緣情況，例如搜尋極淺、根本沒有任何
 * 符合解析格式的輸出行）時，退回使用 UCI "bestmove" 那一行直接給的
 * 走法當保底，不會整個失敗。
 */
function selectMoveFromCandidates(
  candidatesByRank: Map<number, SearchResult>,
  multiPvConfig: { multiPv: number; topChoiceProbability: number },
  bestmoveToken: string
): SearchResult {
  const sortedByRank = Array.from(candidatesByRank.entries()).sort(([rankA], [rankB]) => rankA - rankB);

  if (sortedByRank.length === 0) {
    return { move: bestmoveToken, scoreCp: 0, depth: 0 };
  }

  const topCandidate = sortedByRank[0][1];
  if (sortedByRank.length === 1 || Math.random() < multiPvConfig.topChoiceProbability) {
    return topCandidate;
  }

  const alternatives = sortedByRank.slice(1).map(([, candidate]) => candidate);
  return alternatives[Math.floor(Math.random() * alternatives.length)];
}

/**
 * 取得電腦對手這一步要走哪裡（會套用等級對應的「送子」隨機性，
 * 見 LEVEL_MULTIPV_CONFIG）。
 */
export async function getPikafishMove(
  appFen: string,
  sideToMove: "w" | "b",
  level: ComputerLevel
): Promise<SearchResult> {
  const searchConfig = LEVEL_SEARCH_CONFIG[level];
  const multiPvConfig = LEVEL_MULTIPV_CONFIG[level];

  const { candidatesByRank, bestmoveToken } = await runPikafishSearch(
    appFen,
    sideToMove,
    searchConfig,
    multiPvConfig.multiPv
  );

  const chosen = selectMoveFromCandidates(candidatesByRank, multiPvConfig, bestmoveToken);
  return { move: fromPikafishMove(chosen.move), scoreCp: chosen.scoreCp, depth: chosen.depth };
}

/**
 * 棋局分析（給「最近對局」回顧功能用）：永遠用等級10的搜尋設定、
 * 永遠回傳真正最佳的那一步，不套用任何「送子」隨機性——分析時要給
 * 學生/老師看到的是引擎真正的判斷，不是刻意弄弱的版本。
 */
export async function analyzePosition(
  appFen: string,
  sideToMove: "w" | "b"
): Promise<SearchResult> {
  const searchConfig = LEVEL_SEARCH_CONFIG[10];

  const { candidatesByRank, bestmoveToken } = await runPikafishSearch(appFen, sideToMove, searchConfig, 1);

  const top = candidatesByRank.get(1);
  if (top) {
    return { move: fromPikafishMove(top.move), scoreCp: top.scoreCp, depth: top.depth };
  }
  return { move: fromPikafishMove(bestmoveToken), scoreCp: 0, depth: 0 };
}
