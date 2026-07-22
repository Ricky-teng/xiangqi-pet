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
    // 好壞標記還沒開始算，回放頁看到 "computing" 會顯示「分析中」，
    // 實際計算是呼叫端（play/page.tsx）在這個函式寫入成功之後另外
    // 觸發的背景流程（見 @/lib/engine/moveQuality.ts）。
    moveQualityStatus: "computing",
  };

  await setDoc(gameRef, record);
  return { gameId: gameRef.id };
}

/**
 * 對局紀錄寫入成功後呼叫：在背景分析整局每步好壞（見
 * @/lib/engine/moveQuality.ts），算完寫回同一份文件。這個函式故意
 * 不是 async、不回傳 Promise 給呼叫端 await——呼叫端（play/page.tsx）
 * 結算對局是「畫面需要立刻反應」的事，不應該被這個要跑好幾十秒的
 * 背景分析卡住；分析失敗也不影響對局本身已經結算完成的飼料/戰績，
 * 只是回放頁看不到好壞標記而已（moveQualityStatus 會變成 "failed"）。
 */
export function computeAndSaveMoveQualityInBackground(
  engine: RulesEngineApi,
  studentUid: string,
  gameId: string,
  fenHistory: string[]
): void {
  const gameRef = doc(db, "users", studentUid, "vsComputerGames", gameId);
  computeMoveQualityTags(engine, fenHistory)
    .then((tags) => updateDoc(gameRef, { moveQualityTags: tags, moveQualityStatus: "done" }))
    .catch((error) => {
      console.error("[gameRecording] 背景計算每步好壞標記失敗：", error);
      updateDoc(gameRef, { moveQualityStatus: "failed" }).catch(() => {});
    });
}
