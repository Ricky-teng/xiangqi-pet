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

/** 每個難度等級對應的搜尋深度上限/思考時間上限（毫秒）。
 * 時間上限同時是保護 Vercel 函式執行時間限制的安全閥——不管局面多
 * 複雜，搜尋一定會在這個時間內停止，不會害整個 API 逾時。 */
const LEVEL_SEARCH_CONFIG: Record<ComputerLevel, { depth: number; movetimeMs: number }> = {
  1: { depth: 1, movetimeMs: 200 },
  2: { depth: 2, movetimeMs: 300 },
  3: { depth: 3, movetimeMs: 400 },
  4: { depth: 4, movetimeMs: 600 },
  5: { depth: 6, movetimeMs: 900 },
  6: { depth: 8, movetimeMs: 1300 },
  7: { depth: 10, movetimeMs: 1800 },
  8: { depth: 13, movetimeMs: 2500 },
  9: { depth: 16, movetimeMs: 3500 },
  10: { depth: 20, movetimeMs: 5000 },
};

function getPikafishBinaryPath(): string {
  return path.join(process.cwd(), "vendor", "pikafish", "pikafish");
}

function getNnueFilePath(): string {
  return path.join(process.cwd(), "vendor", "pikafish", "pikafish.nnue");
}

/**
 * 啟動一個 Pikafish 子程序、送出指定局面、等待 bestmove 回應後關閉
 * 子程序。每次呼叫都是全新的子程序（不在多次請求之間保留常駐程序），
 * 因為 Serverless Function 本來就是無狀態、每次調用環境都可能不同，
 * 沒有「常駐」這個概念可以依賴。
 */
export async function getPikafishMove(
  appFen: string,
  sideToMove: "w" | "b",
  level: ComputerLevel
): Promise<{ move: string; scoreCp: number; depth: number }> {
  const config = LEVEL_SEARCH_CONFIG[level];
  const pikafishFen = toPikafishFen(appFen, sideToMove);
  const binaryPath = getPikafishBinaryPath();
  const nnuePath = getNnueFilePath();

  // 診斷用：在真正 spawn 之前先確認檔案到底存不存在，這樣 log 裡會
  // 明確區分「檔案根本沒被打包進部署」跟「檔案有，但引擎執行時卡住」
  // 這兩種完全不同的問題，不用再靠猜測。
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
    let lastScoreCp = 0;
    let lastDepth = 0;
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
        "目前累積的 stdout 內容:",
        stdoutBuffer.slice(0, 2000)
      );
      proc.kill();
      reject(new Error(`Pikafish 引擎回應逾時（曾收到輸出：${receivedAnyOutput}）`));
    }, config.movetimeMs + 5000);

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

      // 持續解析目前累積到的每一行，更新「目前看到的最新分數/深度」，
      // 等看到 bestmove 才算真正結束。
      const lines = stdoutBuffer.split("\n");
      for (const line of lines) {
        if (line.startsWith("info") && line.includes("score cp")) {
          const depthMatch = line.match(/depth (\d+)/);
          const scoreMatch = line.match(/score cp (-?\d+)/);
          if (depthMatch) lastDepth = Number(depthMatch[1]);
          if (scoreMatch) lastScoreCp = Number(scoreMatch[1]);
        }

        if (line.startsWith("bestmove")) {
          if (settled) return;
          const move = line.split(" ")[1];
          if (!move || move === "(none)") {
            settled = true;
            cleanup();
            proc.kill();
            reject(new Error("Pikafish 回傳「沒有合法走法」，呼叫端應該在呼叫前先確認遊戲還沒結束。"));
            return;
          }
          settled = true;
          cleanup();
          proc.kill();
          resolve({ move: fromPikafishMove(move), scoreCp: lastScoreCp, depth: lastDepth });
          return;
        }
      }
    });

    proc.stderr.on("data", () => {
      // Pikafish 正常運作時不太會往 stderr 寫東西；這裡不特別處理，
      // 真正的錯誤都是透過 stdout 的 "info string ERROR: ..." 文字
      // 或者進程整個 exit/error 事件來呈現。
    });

    // 依序送出 UCI 指令：設定權重檔路徑 → 確認準備好 → 設定局面 →
    // 開始搜尋（深度/時間雙重上限，先到的算）。
    proc.stdin.write(`setoption name EvalFile value ${getNnueFilePath()}\n`);
    proc.stdin.write("isready\n");
    proc.stdin.write(`position fen ${pikafishFen}\n`);
    proc.stdin.write(`go depth ${config.depth} movetime ${config.movetimeMs}\n`);
  });
}
