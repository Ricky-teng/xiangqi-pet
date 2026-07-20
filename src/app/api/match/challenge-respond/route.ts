/**
 * src/app/api/match/challenge-respond/route.ts
 *
 * 回應「配對對弈」好友戰帖（接受／婉拒）。
 * ------------------------------------------------------------
 * 邏輯完全比照 /api/battle/challenge-respond（殘局對戰版本），差別
 * 只在建立的是 chessMatchRooms 文件（完整棋局初始狀態：標準開局、
 * 雙方棋鐘、費雪制加秒）而不是 battleRooms（抽題清單）。
 *
 * 呼叫者（Authorization header 驗證出的 uid）是「被挑戰、正在回應的人」。
 * body: { action: "accept" | "decline" }
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { sendPushToUser } from "@/lib/server/push";
import type { ChessMatchRoomDoc, UserDoc } from "@/types/database";
import { STANDARD_START_FEN } from "@/lib/xiangqi/fen";

const BATTLE_ENTRY_COST = 20; // 必須跟 src/app/match/page.tsx、src/app/battle/page.tsx 的常數保持一致

function generateRoomId(): string {
  return `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

  let toUid: string;
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

  const challengerSnap = await db
    .collection("users")
    .where("outgoingMatchChallengeUid", "==", toUid)
    .limit(1)
    .get();

  if (challengerSnap.empty) {
    return NextResponse.json({ error: "找不到這筆對局邀請，可能已經取消了。" }, { status: 404 });
  }

  const fromDoc = challengerSnap.docs[0];
  const fromUid = fromDoc.id;
  const fromUser = fromDoc.data() as UserDoc;
  const fromRef = db.collection("users").doc(fromUid);

  if (action === "decline") {
    await fromRef.update({
      outgoingMatchChallengeUid: null,
      outgoingMatchChallengeSentAt: null,
      outgoingMatchChallengeSettings: null,
      updatedAt: Date.now(),
    });
    await sendPushToUser(fromUid, {
      title: "對局邀請被婉拒了",
      body: `${toUser.displayName ?? "同學"} 現在沒空下棋`,
      url: "/friends",
    });
    return NextResponse.json({ success: true });
  }

  // ---- action === "accept" ----
  if ((fromUser.foodCount ?? 0) < BATTLE_ENTRY_COST) {
    await fromRef.update({
      outgoingMatchChallengeUid: null,
      outgoingMatchChallengeSentAt: null,
      outgoingMatchChallengeSettings: null,
      updatedAt: Date.now(),
    });
    return NextResponse.json({ error: "對方的飼料不夠支付對局入場費了，邀請已自動取消。" }, { status: 400 });
  }
  if ((toUser.foodCount ?? 0) < BATTLE_ENTRY_COST) {
    return NextResponse.json({ error: `你的飼料不足，需要 ${BATTLE_ENTRY_COST} 飼料才能接受對局。` }, { status: 400 });
  }

  try {
    const settings = fromUser.outgoingMatchChallengeSettings ?? { baseMinutes: 15, incrementSeconds: 5 };
    const baseMs = settings.baseMinutes * 60 * 1000;
    const incrementMs = settings.incrementSeconds * 1000;

    const roomId = generateRoomId();
    const now = Date.now();

    // 挑戰人固定紅方先走，被挑戰的人黑方——簡單公平的預設規則
    const newRoom: ChessMatchRoomDoc = {
      roomId,
      status: "playing",
      red: { uid: fromUid, displayName: fromUser.displayName, chessLevel: fromUser.chessLevel },
      black: { uid: toUid, displayName: toUser.displayName, chessLevel: toUser.chessLevel },
      fen: STANDARD_START_FEN,
      sideToMove: "w",
      moveHistory: [],
      fenHistory: [STANDARD_START_FEN],
      clockRedMs: baseMs,
      clockBlackMs: baseMs,
      incrementMs,
      lastMoveAt: now,
      drawOfferBy: null,
      winner: null,
      endReason: null,
      createdAt: now,
      updatedAt: now,
    };

    const batch = db.batch();
    batch.set(db.collection("chessMatchRooms").doc(roomId), newRoom);
    batch.update(fromRef, {
      foodCount: (fromUser.foodCount ?? 0) - BATTLE_ENTRY_COST,
      outgoingMatchChallengeUid: null,
      outgoingMatchChallengeSentAt: null,
      outgoingMatchChallengeSettings: null,
      lastMatchChallengeRoomId: roomId,
      updatedAt: now,
    });
    batch.update(toRef, {
      foodCount: (toUser.foodCount ?? 0) - BATTLE_ENTRY_COST,
      lastMatchChallengeRoomId: roomId,
      updatedAt: now,
    });
    await batch.commit();

    return NextResponse.json({ success: true, roomId });
  } catch (error) {
    console.error("[api/match/challenge-respond] 建立房間失敗：", error);
    return NextResponse.json({ error: "建立對局房間失敗，請稍後再試一次。" }, { status: 500 });
  }
}
