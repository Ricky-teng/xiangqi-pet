/**
 * src/app/match/page.tsx
 *
 * 配對對弈：下一整盤真正的棋（不是殘局解謎）
 * ------------------------------------------------------------
 * 跟 /battle（殘局作戰，10 題限時解謎）是完全不同的兩種 PvP 模式，
 * 刻意獨立成這個頁面跟自己的 Firestore collection
 * （chessMatchQueue / chessMatchRooms），架構上大量參考 /battle 的
 * 配對機制、跟 /play 的下棋/認輸/求和機制，但因為完整對局需要棋鐘、
 * 完整局面歷史，資料結構差很多，沒有直接共用同一份房間文件。
 *
 * 棋鐘：費雪制（Fischer），每人一開始 baseMinutes 分鐘，每走完一步
 * 加 incrementSeconds 秒。公開配對固定用 15+5；好友挑戰可以自訂
 * （見 /friends 頁面），設定值存在 chessMatchRooms 文件的
 * incrementMs／初始 clockRedMs/clockBlackMs 裡。
 *
 * 直接加入房間模式（?room=xxx）：從好友對局挑戰被接受後導過來，
 * 飼料已經在 /api/match/challenge-respond 扣過了，跳過配對排隊。
 *
 * 移動驗證/終局判斷：用 src/lib/engine/rulesEngine.ts（ffish-es6
 * WASM 引擎）在雙方瀏覽器本地各自驗證，不是伺服器權威——這跟
 * /battle、/play 是同一套信任模型（前端互信，不是防作弊系統），
 * 適合這個教育用途的 App，不是競技排位系統。
 *
 * 棋鐘用完的偵測：純前端算的，沒有後端排程一直在跑。雙方瀏覽器都會
 * 各自倒數，任何一方偵測到「輪到走的那方時間用完」就負責寫入結束
 * 狀態（不管是不是自己），避免有人拖網路或關頁面卡住不結算。
 */

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { useRulesEngine } from "@/hooks/useRulesEngine";
import { parseFen, STANDARD_START_FEN } from "@/lib/xiangqi/fen";
import type { ChessMatchRoomDoc, ChessMatchQueueEntry, ChessMatchEndReason } from "@/types/database";
import { useAppBackground } from "@/lib/useAppBackground";

const BATTLE_ENTRY_COST = 20; // 跟 /battle 頁面同一套經濟模型，故意同名同值
const BATTLE_WIN_REWARD = 50;
const MAX_LEVEL_DIFF_FOR_MATCH = 3;
const MATCHMAKING_INTERVAL_MS = 3000;
const DEFAULT_BASE_MINUTES = 15;
const DEFAULT_INCREMENT_SECONDS = 5;

type PagePhase = "queuing" | "playing" | "finished";

function generateRoomId(): string {
  return `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const END_REASON_LABEL: Record<ChessMatchEndReason, string> = {
  checkmate: "將死",
  stalemate: "困斃",
  resign: "認輸",
  timeout: "棋鐘用完",
  draw_agreement: "雙方同意和棋",
  draw_rule: "和棋",
};

function MatchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const directRoomId = searchParams.get("room");

  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const { engine } = useRulesEngine();

  const [phase, setPhase] = useState<PagePhase>(directRoomId ? "playing" : "queuing");
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [roomId, setRoomId] = useState<string | null>(directRoomId);
  const [room, setRoom] = useState<ChessMatchRoomDoc | null>(null);

  const [moveError, setMoveError] = useState<string | null>(null);
  const [isConfirmingResign, setIsConfirmingResign] = useState(false);
  const [, forceTick] = useState(0); // 純粹拿來讓棋鐘畫面每秒重新算一次，沒有實際存值

  const myUid = user?.uid ?? "";
  const hasSettledRef = useRef(false);
  const hasCheckedTimeoutRef = useRef(false);
  const hasMatchedRef = useRef(!!directRoomId);

  const mySide: "w" | "b" | null =
    !room || !myUid ? null : room.red.uid === myUid ? "w" : room.black.uid === myUid ? "b" : null;
  const opponent = !room || !mySide ? null : mySide === "w" ? room.black : room.red;

  const board = useMemo(() => parseFen(room?.fen ?? STANDARD_START_FEN), [room?.fen]);
  const lastMove = useMemo(() => {
    const lastNotation = room?.moveHistory[room.moveHistory.length - 1];
    if (!lastNotation) return null;
    return { from: lastNotation.slice(0, 2), to: lastNotation.slice(2, 4) };
  }, [room?.moveHistory]);

  // ---- 等待計時器 ----
  useEffect(() => {
    if (phase !== "queuing") return;
    const id = setInterval(() => setWaitSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ---- 棋鐘每秒重新畫一次 ----
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [phase]);

  // ---- 離開時清理配對佇列 ----
  const leaveAndCleanup = useCallback(async () => {
    if (myUid) await deleteDoc(doc(db, "chessMatchQueue", myUid)).catch(() => {});
  }, [myUid]);

  const refundIfNotMatched = useCallback(() => {
    if (hasMatchedRef.current || !user) return;
    const newFood = user.foodCount + BATTLE_ENTRY_COST;
    setUser({ ...user, foodCount: newFood, updatedAt: Date.now() });
    updateDoc(doc(db, "users", user.uid), { foodCount: newFood, updatedAt: Date.now() }).catch(console.error);
  }, [user, setUser]);

  // ---- 扣費進場＋寫入配對佇列（直接加入房間模式跳過，見檔頭說明） ----
  useEffect(() => {
    if (!user || directRoomId) return;
    if (user.foodCount < BATTLE_ENTRY_COST) {
      router.replace("/");
      return;
    }

    const newFood = user.foodCount - BATTLE_ENTRY_COST;
    setUser({ ...user, foodCount: newFood, updatedAt: Date.now() });
    updateDoc(doc(db, "users", user.uid), { foodCount: newFood, updatedAt: Date.now() }).catch(console.error);

    const entry: ChessMatchQueueEntry = {
      uid: user.uid,
      displayName: user.displayName,
      chessLevel: user.chessLevel,
      joinedAt: Date.now(),
      roomId: null,
    };
    setDoc(doc(db, "chessMatchQueue", user.uid), entry).catch(console.error);

    return () => { leaveAndCleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 監聽自己的 queue entry，等 roomId 出現 ----
  useEffect(() => {
    if (!myUid || directRoomId) return;
    const unsubscribe = onSnapshot(doc(db, "chessMatchQueue", myUid), (snap) => {
      if (!snap.exists()) return;
      const entry = snap.data() as ChessMatchQueueEntry;
      if (entry.roomId && entry.roomId !== roomId) setRoomId(entry.roomId);
    });
    return () => unsubscribe();
  }, [myUid, roomId, directRoomId]);

  // ---- 配對輪詢 ----
  useEffect(() => {
    if (phase !== "queuing" || !user || directRoomId) return;

    const interval = setInterval(async () => {
      try {
        const snap = await getDocs(query(collection(db, "chessMatchQueue"), where("roomId", "==", null)));
        const candidates = snap.docs.map((d) => d.data() as ChessMatchQueueEntry).filter((e) => e.uid !== myUid);
        if (candidates.length === 0) return;

        const sameLevel = candidates.filter((e) => Math.abs(e.chessLevel - user.chessLevel) <= MAX_LEVEL_DIFF_FOR_MATCH);
        const pool = sameLevel.length > 0 ? sameLevel : candidates;
        const opp = pool.reduce((a, b) => (a.joinedAt < b.joinedAt ? a : b));

        // uid 字典序小的當紅方（誰先誰後純粹靠這個決定，公平且不用額外協調）
        const iAmRed = myUid < opp.uid;
        const newRoomId = generateRoomId();
        const now = Date.now();
        const baseMs = DEFAULT_BASE_MINUTES * 60 * 1000;

        const newRoom: ChessMatchRoomDoc = {
          roomId: newRoomId,
          status: "playing",
          red: iAmRed
            ? { uid: myUid, displayName: user.displayName, chessLevel: user.chessLevel }
            : { uid: opp.uid, displayName: opp.displayName, chessLevel: opp.chessLevel },
          black: iAmRed
            ? { uid: opp.uid, displayName: opp.displayName, chessLevel: opp.chessLevel }
            : { uid: myUid, displayName: user.displayName, chessLevel: user.chessLevel },
          fen: STANDARD_START_FEN,
          sideToMove: "w",
          moveHistory: [],
          fenHistory: [STANDARD_START_FEN],
          clockRedMs: baseMs,
          clockBlackMs: baseMs,
          incrementMs: DEFAULT_INCREMENT_SECONDS * 1000,
          lastMoveAt: now,
          drawOfferBy: null,
          winner: null,
          endReason: null,
          createdAt: now,
          updatedAt: now,
        };

        await setDoc(doc(db, "chessMatchRooms", newRoomId), newRoom);
        await updateDoc(doc(db, "chessMatchQueue", myUid), { roomId: newRoomId });
        await updateDoc(doc(db, "chessMatchQueue", opp.uid), { roomId: newRoomId });
      } catch (error) {
        console.error("[match] 配對失敗：", error);
      }
    }, MATCHMAKING_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, myUid, directRoomId]);

  // ---- 監聽房間 ----
  useEffect(() => {
    if (!roomId) return;
    const unsubscribe = onSnapshot(doc(db, "chessMatchRooms", roomId), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as ChessMatchRoomDoc;
      setRoom(data);
      hasMatchedRef.current = true;
      if (phase !== "playing" && data.status === "playing") setPhase("playing");
      if (data.status === "finished") setPhase("finished");
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ---- 棋鐘用完偵測：任何一方的瀏覽器都可能先偵測到，誰先偵測到誰負責結算 ----
  useEffect(() => {
    if (!room || room.status !== "playing" || hasCheckedTimeoutRef.current) return;
    const now = Date.now();
    const elapsed = now - room.lastMoveAt;
    const liveMs = room.sideToMove === "w" ? room.clockRedMs - elapsed : room.clockBlackMs - elapsed;
    if (liveMs > 0) return;

    hasCheckedTimeoutRef.current = true;
    const winnerUid = room.sideToMove === "w" ? room.black.uid : room.red.uid;
    updateDoc(doc(db, "chessMatchRooms", roomId!), {
      status: "finished",
      winner: winnerUid,
      endReason: "timeout" as ChessMatchEndReason,
      updatedAt: now,
    }).catch(console.error);
  });

  // ---- 結算：對局結束後扣/發飼料，只做一次 ----
  useEffect(() => {
    if (!room || room.status !== "finished" || !user || !mySide || hasSettledRef.current) return;
    hasSettledRef.current = true;

    const isDraw = room.winner === null;
    const isWin = room.winner === myUid;

    let delta = 0;
    if (isWin) delta = BATTLE_ENTRY_COST + BATTLE_WIN_REWARD;
    else if (isDraw) delta = BATTLE_ENTRY_COST;
    const spentDelta = !isWin && !isDraw ? BATTLE_ENTRY_COST : 0;

    const newFood = Math.max(0, user.foodCount + delta);
    const newTotalSpent = (user.totalFoodSpent ?? 0) + spentDelta;
    const now = Date.now();

    // 跟殘局對戰共用同一組勝負統計欄位——排行榜的「對戰勝率」本來就是
    // 想反映「所有跟其他玩家的對戰」，不特別為了這個模式再開一組數字。
    const statsDelta = isWin
      ? { battleWins: (user.stats.battleWins ?? 0) + 1 }
      : isDraw
        ? { battleDraws: (user.stats.battleDraws ?? 0) + 1 }
        : { battleLosses: (user.stats.battleLosses ?? 0) + 1 };

    const updatedUser = {
      ...user,
      foodCount: newFood,
      totalFoodSpent: newTotalSpent,
      stats: { ...user.stats, ...statsDelta },
      updatedAt: now,
    };
    setUser(updatedUser);
    updateDoc(doc(db, "users", user.uid), {
      foodCount: newFood,
      totalFoodSpent: newTotalSpent,
      [`stats.${Object.keys(statsDelta)[0]}`]: Object.values(statsDelta)[0],
      updatedAt: now,
    }).catch(console.error);
  }, [room, user, mySide, myUid, setUser]);

  // ---- 走棋 ----
  function handleMove(notation: string) {
    if (!engine || !room || !roomId || phase !== "playing" || !mySide) return;
    setMoveError(null);
    setIsConfirmingResign(false);

    if (room.sideToMove !== mySide) {
      setMoveError("還沒輪到你");
      return;
    }
    if (!engine.isLegalMove(room.fen, mySide, notation)) {
      setMoveError("這步不合法，再想想看！");
      return;
    }

    const now = Date.now();
    const elapsed = now - room.lastMoveAt;
    const applied = engine.applyMove(room.fen, mySide, notation);
    const newMoveHistory = [...room.moveHistory, notation];
    const newFenHistory = [...room.fenHistory, applied.fen];

    const myRemainingBefore = mySide === "w" ? room.clockRedMs : room.clockBlackMs;
    const myRemainingAfter = Math.max(0, myRemainingBefore - elapsed) + room.incrementMs;

    const updates: Record<string, unknown> = {
      fen: applied.fen,
      sideToMove: applied.sideToMove,
      moveHistory: newMoveHistory,
      fenHistory: newFenHistory,
      lastMoveAt: now,
      drawOfferBy: null, // 走一步視同拒絕/取消任何和棋提議
      updatedAt: now,
    };
    updates[mySide === "w" ? "clockRedMs" : "clockBlackMs"] = myRemainingAfter;

    const status = engine.getGameStatus(applied.fen, applied.sideToMove);
    if (status.isGameOver) {
      updates.status = "finished";
      updates.winner = status.result === "draw" ? null : status.result === "red_wins" ? room.red.uid : room.black.uid;
      updates.endReason = status.result === "draw" ? "draw_rule" : status.isCheck ? "checkmate" : "stalemate";
    }

    updateDoc(doc(db, "chessMatchRooms", roomId), updates).catch(console.error);
  }

  function handleResign() {
    if (phase !== "playing" || !room || !roomId || !mySide) return;
    if (!isConfirmingResign) {
      setIsConfirmingResign(true);
      return;
    }
    setIsConfirmingResign(false);
    const winnerUid = mySide === "w" ? room.black.uid : room.red.uid;
    updateDoc(doc(db, "chessMatchRooms", roomId), {
      status: "finished",
      winner: winnerUid,
      endReason: "resign" as ChessMatchEndReason,
      updatedAt: Date.now(),
    }).catch(console.error);
  }

  function handleOfferDraw() {
    if (phase !== "playing" || !room || !roomId) return;
    updateDoc(doc(db, "chessMatchRooms", roomId), { drawOfferBy: myUid, updatedAt: Date.now() }).catch(console.error);
  }

  function handleRespondDraw(accept: boolean) {
    if (!room || !roomId) return;
    if (accept) {
      updateDoc(doc(db, "chessMatchRooms", roomId), {
        status: "finished",
        winner: null,
        endReason: "draw_agreement" as ChessMatchEndReason,
        drawOfferBy: null,
        updatedAt: Date.now(),
      }).catch(console.error);
    } else {
      updateDoc(doc(db, "chessMatchRooms", roomId), { drawOfferBy: null, updatedAt: Date.now() }).catch(console.error);
    }
  }

  if (!user) return null;

  // ---- 等待配對 ----
  if (phase === "queuing" || !room) {
    const waitMin = Math.floor(waitSeconds / 60);
    const waitSec = waitSeconds % 60;
    const waitLabel = waitMin > 0 ? `已等待 ${waitMin} 分 ${waitSec} 秒` : waitSeconds > 0 ? `已等待 ${waitSeconds} 秒` : "正在連線…";

    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4" style={bgStyle}>
        <section className="w-full max-w-sm rounded-3xl bg-white/70 px-6 py-8 text-center shadow-xl">
          <p className="text-4xl">♟️</p>
          <p className="mt-3 text-lg font-extrabold text-[#1A1A2E]">{directRoomId ? "準備棋局中" : "尋找對手中"}</p>
          <div className="mt-2 flex justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-2.5 w-2.5 rounded-full bg-[#E8B84B]" style={{ animation: `matchBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
          <style>{`@keyframes matchBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-6px);opacity:1} }`}</style>
          <p className="mt-3 tabular-nums text-sm font-semibold text-[#1A1A2E]/60">{waitLabel}</p>
          {statusMessage ? <p className="mt-1 text-xs text-[#C0392B]">{statusMessage}</p> : null}
          {!directRoomId ? (
            <button
              type="button"
              onClick={async () => { refundIfNotMatched(); await leaveAndCleanup(); router.push("/"); }}
              className="mt-6 w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95"
            >
              取消並返回大廳（退回 {BATTLE_ENTRY_COST} 飼料）
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  // ---- 結算畫面 ----
  if (phase === "finished") {
    const isDraw = room.winner === null;
    const isWin = room.winner === myUid;
    const reasonLabel = room.endReason ? END_REASON_LABEL[room.endReason] : "";

    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-4" style={bgStyle}>
        <section className="w-full max-w-sm rounded-3xl bg-white/80 px-6 py-8 text-center shadow-xl">
          <p className="text-5xl">{isDraw ? "🤝" : isWin ? "🏆" : "😢"}</p>
          <p className="mt-3 text-xl font-extrabold text-[#1A1A2E]">
            {isDraw ? "和局" : isWin ? "獲勝！" : "落敗"}
          </p>
          <p className="mt-1 text-sm text-[#1A1A2E]/60">結束原因：{reasonLabel}</p>
          <p className="mt-3 text-sm font-bold text-[#8B5FBF]">
            {isDraw
              ? `和局，退還入場費 ${BATTLE_ENTRY_COST} 飼料`
              : isWin
                ? `+${BATTLE_WIN_REWARD} 飼料（退場費 +${BATTLE_ENTRY_COST} + 獎勵 +${BATTLE_WIN_REWARD}）🎉`
                : `入場費 ${BATTLE_ENTRY_COST} 飼料沒有退還`}
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="mt-6 w-full rounded-2xl bg-[#8B5FBF] px-4 py-3 text-sm font-bold text-white transition-transform active:scale-95"
          >
            返回大廳
          </button>
        </section>
      </main>
    );
  }

  // ---- 對局畫面 ----
  const now = Date.now();
  const elapsedSinceLastMove = room.status === "playing" ? now - room.lastMoveAt : 0;
  const liveRedMs = room.sideToMove === "w" ? Math.max(0, room.clockRedMs - elapsedSinceLastMove) : room.clockRedMs;
  const liveBlackMs = room.sideToMove === "b" ? Math.max(0, room.clockBlackMs - elapsedSinceLastMove) : room.clockBlackMs;
  const myLiveMs = mySide === "w" ? liveRedMs : liveBlackMs;
  const oppLiveMs = mySide === "w" ? liveBlackMs : liveRedMs;
  const isMyTurn = room.sideToMove === mySide;
  const drawOfferedByOpponent = !!room.drawOfferBy && room.drawOfferBy !== myUid;
  const drawOfferedByMe = !!room.drawOfferBy && room.drawOfferBy === myUid;

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* 對手資訊 + 棋鐘 */}
        <div className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <div className="text-center">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">{opponent?.displayName ?? "對手"}</p>
            <p className={["mt-0.5 text-lg font-extrabold tabular-nums", !isMyTurn && oppLiveMs < 30000 ? "text-[#C0392B]" : "text-[#1A1A2E]"].join(" ")}>
              {formatClock(oppLiveMs)}
            </p>
          </div>
          <p className="text-2xl">⚔️</p>
          <div className="text-center">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">你</p>
            <p className={["mt-0.5 text-lg font-extrabold tabular-nums", isMyTurn && myLiveMs < 30000 ? "text-[#C0392B]" : "text-[#1A1A2E]"].join(" ")}>
              {formatClock(myLiveMs)}
            </p>
          </div>
        </div>

        <p className="mt-2 text-center text-xs font-semibold text-[#1A1A2E]/50">
          {isMyTurn ? "輪到你走棋" : `等待 ${opponent?.displayName ?? "對手"} 走棋…`}
        </p>

        {/* 棋盤 */}
        <div className="mt-3">
          <ChessBoard board={board} onMove={handleMove} lastMove={lastMove} />
        </div>

        {moveError ? <p className="mt-2 text-center text-xs font-bold text-[#C0392B]">{moveError}</p> : null}

        {/* 和棋提議 */}
        {drawOfferedByOpponent ? (
          <div className="mt-3 rounded-2xl bg-[#8B5FBF]/10 px-4 py-3 text-center">
            <p className="text-xs font-bold text-[#8B5FBF]">{opponent?.displayName} 提議和棋</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => handleRespondDraw(false)} className="flex-1 rounded-xl bg-white py-2 text-xs font-bold text-[#1A1A2E]/60">拒絕</button>
              <button type="button" onClick={() => handleRespondDraw(true)} className="flex-[2] rounded-xl bg-[#8B5FBF] py-2 text-xs font-bold text-white">接受和棋</button>
            </div>
          </div>
        ) : drawOfferedByMe ? (
          <p className="mt-3 text-center text-xs font-semibold text-[#1A1A2E]/50">已送出和棋提議，等待對方回應…</p>
        ) : null}

        {/* 操作按鈕 */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={handleOfferDraw}
            disabled={!!room.drawOfferBy}
            className="flex-1 rounded-2xl bg-white/80 py-2.5 text-xs font-bold text-[#1A1A2E]/60 ring-1 ring-inset ring-[#A9764C]/20 transition-transform active:scale-95 disabled:opacity-40"
          >
            🤝 提和
          </button>
          {isConfirmingResign ? (
            <>
              <button type="button" onClick={() => setIsConfirmingResign(false)} className="flex-1 rounded-2xl bg-white/80 py-2.5 text-xs font-bold text-[#1A1A2E]/60 ring-1 ring-inset ring-[#A9764C]/20">
                取消
              </button>
              <button type="button" onClick={handleResign} className="flex-1 rounded-2xl bg-[#C0392B] py-2.5 text-xs font-bold text-white">
                確定認輸？
              </button>
            </>
          ) : (
            <button type="button" onClick={handleResign} className="flex-1 rounded-2xl bg-white/80 py-2.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#A9764C]/20 transition-transform active:scale-95">
              🏳️ 認輸
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

export default function MatchPage() {
  return (
    <RequireAuth requiredRole="student">
      <Suspense fallback={null}>
        <MatchPageContent />
      </Suspense>
    </RequireAuth>
  );
}
