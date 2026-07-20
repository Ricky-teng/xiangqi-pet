/**
 * src/app/api/battle/challenge-respond/route.ts
 *
 * 回應好友對戰挑戰（接受／婉拒）。
 * ------------------------------------------------------------
 * 送出挑戰時不扣飼料（只是自己寫自己的 outgoingBattleChallengeUid，
 * 見 UserDoc 註解），真正扣飼料是「接受」的當下，而且雙方要同時扣，
 * 這跟好友接受邀請一樣，是一般 client SDK 做不到的跨帳號寫入，所以
 * 走這支用 Admin SDK 的伺服器 API，用 Firestore transaction 保證
 * 「兩人都扣到飼料 + 房間建好」是同一個不可分割的操作。
 *
 * 呼叫者（Authorization header 驗證出的 uid）是「被挑戰、正在回應的人」。
 * body: { action: "accept" | "decline" }
 *
 * 這裡的房間建立邏輯（抽 10 題 Lv.1-5 殘局）刻意跟 /battle 頁面配對
 * 成功時的邏輯保持一致，兩邊生出來的 battleRoom 文件格式要相容。
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { sendPushToUser } from "@/lib/server/push";
import type { BattleRoomDoc, UserDoc } from "@/types/database";

const BATTLE_ENTRY_COST = 20; // 必須跟 src/app/battle/page.tsx 的常數保持一致
const TOTAL_QUESTIONS = 10;

function generateRoomId(): string {
  return `battle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤，應為 JSON。" }, { status: 400 });
  }

  const { action } = (body ?? {}) as { action?: unknown };
  if (action !== "accept" && action !== "decline") {
    return NextResponse.json({ error: "action 必須是 accept 或 decline。" }, { status: 400 });
  }

  let toUid: string; // 被挑戰、正在回應的人
  try {
    toUid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const db = getAdminDb();
  const toRef = db.collection("users").doc(toUid);
  const toSnap = await toRef.get();
  if (!toSnap.exists) {
    return NextResponse.json({ error: "找不到你的帳號資料。" }, { status: 404 });
  }
  const toUser = toSnap.data() as UserDoc;

  // 找出是誰挑戰了我：查詢 outgoingBattleChallengeUid == toUid 的使用者
  const challengerSnap = await db
    .collection("users")
    .where("outgoingBattleChallengeUid", "==", toUid)
    .limit(1)
    .get();

  if (challengerSnap.empty) {
    return NextResponse.json({ error: "找不到這筆對戰邀請，可能已經取消了。" }, { status: 404 });
  }

  const fromDoc = challengerSnap.docs[0];
  const fromUid = fromDoc.id;
  const fromUser = fromDoc.data() as UserDoc;
  const fromRef = db.collection("users").doc(fromUid);

  if (action === "decline") {
    await fromRef.update({ outgoingBattleChallengeUid: null, outgoingBattleChallengeSentAt: null, updatedAt: Date.now() });
    await sendPushToUser(fromUid, {
      title: "對戰邀請被婉拒了",
      body: `${toUser.displayName ?? "同學"} 現在沒空對戰`,
      url: "/friends",
    });
    return NextResponse.json({ success: true });
  }

  // ---- action === "accept" ----
  if ((fromUser.foodCount ?? 0) < BATTLE_ENTRY_COST) {
    // 挑戰人飼料不夠了（可能是這段時間花掉的），沒辦法開打
    await fromRef.update({ outgoingBattleChallengeUid: null, outgoingBattleChallengeSentAt: null, updatedAt: Date.now() });
    return NextResponse.json({ error: "對方的飼料不夠支付對戰入場費了，邀請已自動取消。" }, { status: 400 });
  }
  if ((toUser.foodCount ?? 0) < BATTLE_ENTRY_COST) {
    return NextResponse.json({ error: `你的飼料不足，需要 ${BATTLE_ENTRY_COST} 飼料才能接受對戰。` }, { status: 400 });
  }

  try {
    // 抽題：Lv.1-5 已發布的殘局裡隨機選 10 題
    const puzzleSnap = await db
      .collection("puzzles")
      .where("isPublished", "==", true)
      .where("level", "<=", 5)
      .get();
    const allIds = puzzleSnap.docs.map((d) => d.id);
    if (allIds.length < TOTAL_QUESTIONS) {
      return NextResponse.json({ error: `題庫 Lv.1-5 題目不足 ${TOTAL_QUESTIONS} 題，無法開始對戰。` }, { status: 400 });
    }
    const shuffled = [...allIds].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, TOTAL_QUESTIONS);

    const roomId = generateRoomId();
    const now = Date.now();

    const newRoom: BattleRoomDoc = {
      roomId,
      status: "playing",
      players: {
        [fromUid]: { displayName: fromUser.displayName, chessLevel: fromUser.chessLevel, solved: false, timeMs: null },
        [toUid]: { displayName: toUser.displayName, chessLevel: toUser.chessLevel, solved: false, timeMs: null },
      },
      questions: selected,
      currentQuestion: 0,
      questionStartTime: now,
      scores: { [fromUid]: 0, [toUid]: 0 },
      totalSolveTimeMs: { [fromUid]: 0, [toUid]: 0 },
      winner: null,
      createdAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection("battleRooms").doc(roomId), newRoom);
    batch.update(fromRef, {
      foodCount: (fromUser.foodCount ?? 0) - BATTLE_ENTRY_COST,
      totalFoodSpent: (fromUser.totalFoodSpent ?? 0), // 對戰結果才決定是否真的算「花掉」，這裡先不動，跟 /battle 頁面的結算邏輯一致
      outgoingBattleChallengeUid: null,
      outgoingBattleChallengeSentAt: null,
      lastChallengeRoomId: roomId,
      updatedAt: now,
    });
    batch.update(toRef, {
      foodCount: (toUser.foodCount ?? 0) - BATTLE_ENTRY_COST,
      lastChallengeRoomId: roomId,
      updatedAt: now,
    });
    await batch.commit();

    return NextResponse.json({ success: true, roomId });
  } catch (error) {
    console.error("[api/battle/challenge-respond] 建立房間失敗：", error);
    return NextResponse.json({ error: "建立對戰房間失敗，請稍後再試一次。" }, { status: 500 });
  }
}
