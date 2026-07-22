/**
 * src/lib/engine/moveQuality.ts
 *
 * 「每步好壞標記」計算邏輯（對局結束後在背景跑一次，結果存進
 * VsComputerGameDoc.moveQualityTags，回放頁直接讀，不用重算）。
 * ------------------------------------------------------------
 * 原理：分析 fenHistory 裡每一個局面（用 @/app/api/analyze-position-fast，
 * 犧牲一點準確度換速度，見那個檔案的說明），拿到每個局面「輪走方
 * 視角」的分數，兩兩比較：
 *
 *   走某一步「之前」的分數（beforeCp，站在走這步的那方視角）
 *   代表「這個局面理論上最好可以到多少分」。
 *   走完「之後」的局面分數是站在對方視角，取負號換算回原本這方的
 *   視角（afterCpFromMoverView），代表「實際走完之後，這方局面
 *   變成多少分」。
 *
 *   兩者的差距（lossCp = beforeCp - afterCpFromMoverView）就是這一步
 *   「虧了多少分」，虧越多代表這步越糟，依虧損分三級：好手/普通/失誤。
 *
 * 終局局面（將死/困斃）沒有合法走法，引擎沒辦法分析，這裡用規則引擎
 * 先判斷，遇到終局局面就直接給一個推算出來的分數，不呼叫 API
 * （見 getTerminalPositionScore）。
 */

import type { RulesEngineApi } from "@/lib/engine/rulesEngine";
import type { MoveQualityTag } from "@/types/database";

const GOOD_THRESHOLD_CP = 50;
const MISTAKE_THRESHOLD_CP = 150;
/** 分數的絕對值超過這個門檻就視為「等同將死」的極端分數，不用真的
 * 去比對 30000 那個確切數字（跟 pikafishProcess.ts 給將死局面塞的
 * 極端值對應，但這裡故意用比較寬鬆的門檻，避免因為雙方引擎版本/
 * 換算方式的細微差異而誤判）。 */
const MATE_LIKE_CP = 20000;

function sideToMoveAtStep(step: number): "w" | "b" {
  return step % 2 === 0 ? "w" : "b";
}

function classifyLoss(lossCp: number): MoveQualityTag {
  if (lossCp <= GOOD_THRESHOLD_CP) return "good";
  if (lossCp <= MISTAKE_THRESHOLD_CP) return "normal";
  return "mistake";
}

/**
 * 終局局面（將死/困斃/其他規則引擎判定 isGameOver 的情況）沒辦法送去
 * 給引擎分析（沒有合法走法可以搜尋），直接用規則引擎的判斷結果推算
 * 一個分數，站在「這個局面輪到走的那方」視角：
 *   - 被將死：對這方是最壞的結果，給一個極端負分
 *   - 困斃（平局）：中性，給 0 分
 * 這個分數的角色跟引擎回傳的 scoreCp 完全一樣，可以直接套進後面
 * 兩兩比較的邏輯，不需要特殊處理呼叫端。
 */
function getTerminalPositionScore(engine: RulesEngineApi, fen: string, sideToMove: "w" | "b"): number | null {
  const status = engine.getGameStatus(fen, sideToMove);
  if (!status.isGameOver) return null;
  if (status.result === "draw") return 0;
  // result 是 "red_wins" 或 "black_wins"：如果贏的那方不是現在輪到走的
  // 這方，代表這方被將死了。
  const sideWon = status.result === "red_wins" ? "w" : "b";
  return sideWon === sideToMove ? MATE_LIKE_CP : -MATE_LIKE_CP;
}

/**
 * 依序分析 fenHistory 裡每一個局面，回傳跟 moveHistory 等長的好壞
 * 標記陣列。一次分析一個局面（不平行呼叫），避免同時開太多 Pikafish
 * 子程序。onProgress 選填，每分析完一個局面就會呼叫一次，給呼叫端
 * 顯示進度用。
 */
export async function computeMoveQualityTags(
  engine: RulesEngineApi,
  fenHistory: string[],
  onProgress?: (done: number, total: number) => void
): Promise<MoveQualityTag[]> {
  const total = fenHistory.length;
  const scores: number[] = [];

  for (let i = 0; i < total; i++) {
    const fen = fenHistory[i];
    const sideToMove = sideToMoveAtStep(i);

    const terminalScore = getTerminalPositionScore(engine, fen, sideToMove);
    if (terminalScore !== null) {
      scores.push(terminalScore);
    } else {
      const res = await fetch("/api/analyze-position-fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen, sideToMove }),
      });
      if (!res.ok) {
        throw new Error(`分析第 ${i} 個局面失敗（HTTP ${res.status}）`);
      }
      const data = (await res.json()) as { scoreCp: number };
      scores.push(data.scoreCp);
    }

    onProgress?.(i + 1, total);
  }

  const tags: MoveQualityTag[] = [];
  for (let i = 0; i < scores.length - 1; i++) {
    const beforeCp = scores[i];
    const afterCpFromMoverView = -scores[i + 1];
    const lossCp = Math.max(0, beforeCp - afterCpFromMoverView);
    tags.push(classifyLoss(lossCp));
  }
  return tags;
}
