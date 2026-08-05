/**
 * src/lib/engine/gameRecording.ts
 *
 * 對弈電腦結束後，把整局紀錄寫進 Firestore 給老師後台查閱。
 * ------------------------------------------------------------
 * 跟 useGameStore.ts 裡的 applyVsComputerResult（負責飼料獎懲，是
 * 「畫面需要立刻反應」的狀態）刻意分開——這裡純粹是「寫入即忘」的
 * 紀錄寫入，不影響任何畫面上的即時狀態，所以沒有放進 Zustand store，
 * 用一個單純的 async 函式就好。
 */

import { collection, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VsComputerGameDoc } from "@/types/database";
import type { ComputerLevel } from "@/lib/engine/computerPlayer";
import { computeMoveQualityTags } from "@/lib/engine/moveQuality";
import type { RulesEngineApi } from "@/lib/engine/rulesEngine";

export async function recordVsComputerGame(params: {
  studentUid: string;
  opponentLevel: ComputerLevel;
  studentLevelAtPlay: ComputerLevel;
  outcome: "win" | "lose" | "draw";
  foodDelta: number;
  moveHistory: string[];
  fenHistory: string[];
}): Promise<{ gameId: string }> {
  // 用 Firestore 自動產生的文件 ID，不需要自己想 ID 規則
  const gameRef = doc(collection(db, "users", params.studentUid, "vsComputerGames"));

  const record: VsComputerGameDoc = {
    id: gameRef.id,
    studentUid: params.studentUid,
    opponentLevel: params.opponentLevel,
    studentLevelAtPlay: params.studentLevelAtPlay,
    outcome: params.outcome,
    foodDelta: params.foodDelta,
    moveHistory: params.moveHistory,
    fenHistory: params.fenHistory,
    playedAt: Date.now(),
    // 好壞標記改成「回放頁按了才分析」（見 analyzeMoveQualityOnDemand），
    // 不再對局結束就自動在背景跑——這裡故意不設 moveQualityStatus，
    // undefined 代表「還沒分析過」，回放頁看到這個狀態會顯示
    // 「分析整局」按鈕，不會顯示「分析中」的誤導文字。
  };

  await setDoc(gameRef, record);
  return { gameId: gameRef.id };
}

/**
 * 學生在回放頁按下「分析整局」才會呼叫：分析整局每步好壞（見
 * @/lib/engine/moveQuality.ts），算完寫回同一份文件。之前是對局
 * 結束當下自動在背景跑，但每局要花 20~30 秒的 Pikafish 引擎 CPU
 * 時間，不管學生有沒有要看回放都會燒掉——流量一大，這筆「其實沒人
 * 在看」的運算會先把 Vercel 的 CPU 額度榨乾，所以改成使用者自己觸發，
 * 只有真的想看好壞標記的人才會花這筆運算成本。
 */
export function analyzeMoveQualityOnDemand(
  engine: RulesEngineApi,
  studentUid: string,
  gameId: string,
  fenHistory: string[],
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  const gameRef = doc(db, "users", studentUid, "vsComputerGames", gameId);
  return updateDoc(gameRef, { moveQualityStatus: "computing" })
    .then(() => computeMoveQualityTags(engine, fenHistory, onProgress))
    .then((tags) => updateDoc(gameRef, { moveQualityTags: tags, moveQualityStatus: "done" }))
    .catch((error) => {
      console.error("[gameRecording] 分析整局每步好壞失敗：", error);
      updateDoc(gameRef, { moveQualityStatus: "failed" }).catch(() => {});
      throw error;
    });
}
