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

import { collection, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { VsComputerGameDoc } from "@/types/database";
import type { ComputerLevel } from "@/lib/engine/computerPlayer";

export async function recordVsComputerGame(params: {
  studentUid: string;
  opponentLevel: ComputerLevel;
  studentLevelAtPlay: ComputerLevel;
  outcome: "win" | "lose" | "draw";
  foodDelta: number;
  moveHistory: string[];
  fenHistory: string[];
}): Promise<void> {
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
  };

  await setDoc(gameRef, record);
}
