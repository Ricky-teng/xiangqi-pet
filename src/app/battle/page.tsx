/**
 * src/app/battle/page.tsx
 *
 * 殘局作戰：配對 → 對戰 → 結算
 * ------------------------------------------------------------
 * FSM 狀態：
 *   queuing    → 在等待室配對中
 *   matched    → 配對成功，準備開始
 *   playing    → 對戰進行中（10 題 × 30 秒）
 *   finished   → 結算畫面
 *
 * Firestore 結構：
 *   matchmakingQueue/{uid}  等待中的玩家
 *   battleRooms/{roomId}    對戰房間，雙方共用
 *
 * 配對邏輯（前端 leader 做）：
 *   進入等待室後，每 3 秒掃一次 queue，找到等級差距最小的對手
 *   （queue 裡排最久的那個），成功配對的那方建立 battleRoom 並寫入
 *   questions（抽 Lv.1-5 的 10 題），再把雙方的 queueEntry.roomId 設為
 *   roomId，對方偵測到 roomId 變化就知道配對成功了。
 *
 * 問題同步：
 *   兩位玩家共用同一個 battleRoom，currentQuestion 跟 questionStartTime
 *   由「先答完的人」推進到下一題（寫 Firestore），另一方監聽到更新就跟著切換。
 *   時間到未答完→算錯：前端用 setTimeout 在 30 秒後自動把自己標記為「超時」。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { useRulesEngine } from "@/hooks/useRulesEngine";
import { parseFen } from "@/lib/xiangqi/fen";
import type { BattleRoomDoc, MatchmakingQueueEntry, PuzzleDoc } from "@/types/database";

const BATTLE_ENTRY_COST = 50;
const BATTLE_WIN_REWARD = 50;
const QUESTION_TIME_LIMIT_MS = 30_000;
const TOTAL_QUESTIONS = 10;
const MATCHMAKING_INTERVAL_MS = 3000;
const MAX_LEVEL_DIFF_FOR_MATCH = 3; // 等級差超過這個值才降為「任意配」

type PagePhase = "queuing" | "matched" | "playing" | "finished";

// ============================================================
// 工具函式
// ============================================================

function generateRoomId(): string {
  return `battle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================
// 主元件
// ============================================================

function BattlePageContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const { engine } = useRulesEngine();

  const [phase, setPhase] = useState<PagePhase>("queuing");
  const [statusMessage, setStatusMessage] = useState("尋找對手中…");

  // 配對 / 房間
  const [roomId, setRoomId] = useState<string | null>(null);
  const [room, setRoom] = useState<BattleRoomDoc | null>(null);
  const [opponentUid, setOpponentUid] = useState<string | null>(null);

  // 題目
  const [questions, setQuestions] = useState<PuzzleDoc[]>([]);
  const [currentPuzzle, setCurrentPuzzle] = useState<PuzzleDoc | null>(null);

  // 解題
  const [board, setBoard] = useState<ReturnType<typeof parseFen> | null>(null);
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [sideToMove, setSideToMove] = useState<"w" | "b">("w");
  const [solvedThisQuestion, setSolvedThisQuestion] = useState(false);
  const [lastAnswerResult, setLastAnswerResult] = useState<"correct" | "wrong" | null>(null);
  const [lastMoveHighlight, setLastMoveHighlight] = useState<{ from: string; to: string } | null>(null);

  // 計時
  const [timeLeftMs, setTimeLeftMs] = useState(QUESTION_TIME_LIMIT_MS);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartTimeRef = useRef<number>(0);

  const myUid = user?.uid ?? "";

  // 我的分數、對手分數
  const myScore = room?.scores[myUid] ?? 0;
  const oppScore = opponentUid ? (room?.scores[opponentUid] ?? 0) : 0;
  const currentQuestionIndex = room?.currentQuestion ?? 0;

  // ---- 清理計時器 ----
  function clearTimers() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  }

  // ---- 離開清理 ----
  const leaveAndCleanup = useCallback(async () => {
    clearTimers();
    if (myUid) {
      await deleteDoc(doc(db, "matchmakingQueue", myUid)).catch(() => {});
    }
  }, [myUid]);

  /** 配對成功前取消才退款，配對成功後取消（認輸）不退 */
  const refundIfNotMatched = useCallback(() => {
    if (hasMatchedRef.current) return;
    if (!user) return;
    const newFood = user.foodCount + BATTLE_ENTRY_COST;
    const updatedUser = { ...user, foodCount: newFood, updatedAt: Date.now() };
    setUser(updatedUser);
    updateDoc(doc(db, "users", user.uid), { foodCount: newFood, updatedAt: Date.now() }).catch(console.error);
  }, [user, setUser]);

  // 配對成功後設為 true，取消時用來判斷要不要退款
  const hasMatchedRef = useRef(false);

  // ---- 扣費進場 ----
  useEffect(() => {
    if (!user) return;
    if (user.foodCount < BATTLE_ENTRY_COST) {
      router.replace("/");
      return;
    }

    // 扣飼料
    const newFood = user.foodCount - BATTLE_ENTRY_COST;
    const updatedUser = { ...user, foodCount: newFood, updatedAt: Date.now() };
    setUser(updatedUser);
    updateDoc(doc(db, "users", user.uid), { foodCount: newFood, updatedAt: Date.now() }).catch(console.error);

    // 寫入等待隊列
    const entry: MatchmakingQueueEntry = {
      uid: user.uid,
      displayName: user.displayName,
      chessLevel: user.chessLevel,
      joinedAt: Date.now(),
      roomId: null,
    };
    setDoc(doc(db, "matchmakingQueue", user.uid), entry).catch(console.error);

    return () => { leaveAndCleanup(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 監聽自己的 queue entry，等 roomId 出現（配對成功） ----
  useEffect(() => {
    if (!myUid) return;
    const unsubscribe = onSnapshot(doc(db, "matchmakingQueue", myUid), (snap) => {
      if (!snap.exists()) return;
      const entry = snap.data() as MatchmakingQueueEntry;
      if (entry.roomId && entry.roomId !== roomId) {
        setRoomId(entry.roomId);
      }
    });
    return () => unsubscribe();
  }, [myUid, roomId]);

  // ---- 配對輪詢：每 3 秒掃 queue，找最佳對手 ----
  useEffect(() => {
    if (phase !== "queuing" || !user) return;

    const interval = setInterval(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "matchmakingQueue"), where("roomId", "==", null))
        );
        const candidates = snap.docs
          .map((d) => d.data() as MatchmakingQueueEntry)
          .filter((e) => e.uid !== myUid);

        if (candidates.length === 0) return;

        // 先找等級差 ≤ MAX_LEVEL_DIFF_FOR_MATCH 的，再退而求其次任意配
        const sameLevel = candidates.filter(
          (e) => Math.abs(e.chessLevel - user.chessLevel) <= MAX_LEVEL_DIFF_FOR_MATCH
        );
        const pool = sameLevel.length > 0 ? sameLevel : candidates;
        // 從 pool 裡選等待最久的那個（joinedAt 最小）
        const opponent = pool.reduce((a, b) => (a.joinedAt < b.joinedAt ? a : b));

        // 建立房間（抽 Lv.1-5 的題目）
        const puzzleSnap = await getDocs(
          query(
            collection(db, "puzzles"),
            where("isPublished", "==", true),
            where("level", "<=", 5)
          )
        );
        const allIds = puzzleSnap.docs.map((d) => d.id);
        if (allIds.length < TOTAL_QUESTIONS) {
          setStatusMessage(`題庫 Lv.1-5 題目不足 ${TOTAL_QUESTIONS} 題，無法開始作戰。`);
          return;
        }

        // Fisher-Yates 抽 10 題
        const shuffled = [...allIds].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, TOTAL_QUESTIONS);

        const newRoomId = generateRoomId();
        const now = Date.now();

        const newRoom: BattleRoomDoc = {
          roomId: newRoomId,
          status: "playing",
          players: {
            [myUid]: { displayName: user.displayName, chessLevel: user.chessLevel, solved: false, timeMs: null },
            [opponent.uid]: { displayName: opponent.displayName, chessLevel: opponent.chessLevel, solved: false, timeMs: null },
          },
          questions: selected,
          currentQuestion: 0,
          questionStartTime: now,
          scores: { [myUid]: 0, [opponent.uid]: 0 },
          winner: null,
          createdAt: now,
        };

        await setDoc(doc(db, "battleRooms", newRoomId), newRoom);

        // 讓雙方都知道 roomId
        await updateDoc(doc(db, "matchmakingQueue", myUid), { roomId: newRoomId });
        await updateDoc(doc(db, "matchmakingQueue", opponent.uid), { roomId: newRoomId });

        setOpponentUid(opponent.uid);
      } catch (error) {
        console.error("[battle] 配對失敗：", error);
      }
    }, MATCHMAKING_INTERVAL_MS);

    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, myUid]);

  // ---- 有 roomId 之後開始監聽房間 ----
  useEffect(() => {
    if (!roomId) return;

    const unsubscribe = onSnapshot(doc(db, "battleRooms", roomId), async (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as BattleRoomDoc;
      setRoom(data);

      // 找對手
      const oppUid = Object.keys(data.players).find((uid) => uid !== myUid) ?? null;
      if (oppUid) setOpponentUid(oppUid);

      if (data.status === "finished") {
        setPhase("finished");
        clearTimers();
        applyBattleResult(data, myUid);
        return;
      }

      if (phase !== "playing") {
        hasMatchedRef.current = true;
        setPhase("playing");
      }

      // 推進邏輯在這裡集中處理：偵測到「雙方都已回答（timeMs 不為 null）」時，
      // 由 uid 字典序較小的那方負責推進（避免兩方同時推進造成重複寫入）。
      if (!oppUid) return;
      const me = data.players[myUid];
      const opp = data.players[oppUid];
      const bothAnswered = me?.timeMs !== null && me?.timeMs !== undefined
        && opp?.timeMs !== null && opp?.timeMs !== undefined;

      if (!bothAnswered) return;

      // 用 uid 字典序決定誰推進，避免兩方同時寫 Firestore
      const shouldIAdvance = myUid < oppUid;
      if (!shouldIAdvance) return;

      const isLastQuestion = data.currentQuestion >= TOTAL_QUESTIONS - 1;
      const myFinalScore = data.scores[myUid] ?? 0;

      if (isLastQuestion) {
        const oppFinalScore = data.scores[oppUid] ?? 0;
        let winner: string | null = null;
        if (myFinalScore > oppFinalScore) winner = myUid;
        else if (oppFinalScore > myFinalScore) winner = oppUid;
        // 平局 winner 保持 null

        await updateDoc(doc(db, "battleRooms", roomId), {
          status: "finished",
          winner,
        }).catch(console.error);
      } else {
        // 重置雙方本題狀態，推進到下一題
        await updateDoc(doc(db, "battleRooms", roomId), {
          currentQuestion: data.currentQuestion + 1,
          questionStartTime: Date.now(),
          [`players.${myUid}.solved`]: false,
          [`players.${myUid}.timeMs`]: null,
          [`players.${oppUid}.solved`]: false,
          [`players.${oppUid}.timeMs`]: null,
        }).catch(console.error);
      }
    });

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, myUid]);

  // ---- 載入題目清單 ----
  useEffect(() => {
    if (!room || questions.length > 0) return;
    Promise.all(
      room.questions.map((id) =>
        getDocs(query(collection(db, "puzzles"), where("id", "==", id)))
          .then((snap) => snap.docs[0]?.data() as PuzzleDoc | undefined)
      )
    ).then((results) => {
      const valid = results.filter(Boolean) as PuzzleDoc[];
      if (valid.length > 0) setQuestions(valid);
    }).catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.questions]);

  // ---- 當 currentQuestion 變化時，切換到新題目並重設計時 ----
  useEffect(() => {
    if (!room || questions.length === 0) return;
    const puzzle = questions[room.currentQuestion];
    if (!puzzle) return;

    setCurrentPuzzle(puzzle);
    try {
      setBoard(parseFen(puzzle.initialFen));
    } catch { return; }
    setMoveHistory([]);
    setSideToMove("w");
    setSolvedThisQuestion(false);
    setLastAnswerResult(null);
    setLastMoveHighlight(null);

    const startTime = room.questionStartTime;
    questionStartTimeRef.current = startTime;
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, QUESTION_TIME_LIMIT_MS - elapsed);
    setTimeLeftMs(remaining);

    clearTimers();

    // 30 秒倒數顯示
    timerIntervalRef.current = setInterval(() => {
      const left = Math.max(0, QUESTION_TIME_LIMIT_MS - (Date.now() - questionStartTimeRef.current));
      setTimeLeftMs(left);
    }, 200);

    // 超時自動標記失敗
    timeoutRef.current = setTimeout(() => {
      handleTimeOut();
    }, remaining);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.currentQuestion, room?.questionStartTime, questions]);

  // ---- 走棋 ----
  function handleMove(notation: string) {
    if (!engine || !board || !currentPuzzle || solvedThisQuestion || phase !== "playing") return;
    // 只在輪到玩家（紅方 w）時接受輸入
    if (sideToMove !== "w") return;

    if (!engine.isLegalMove(toFenStr(board, sideToMove), sideToMove, notation)) return;

    const result = engine.applyMove(toFenStr(board, sideToMove), sideToMove, notation);
    const newBoard = parseFen(result.fen);
    setBoard(newBoard);
    setSideToMove(result.sideToMove);
    setLastMoveHighlight({ from: notation.slice(0, 2), to: notation.slice(2, 4) });

    const newHistory = [...moveHistory, notation];
    setMoveHistory(newHistory);

    const allLines = [currentPuzzle.moves, ...(currentPuzzle.alternativeLines ?? []).map((l) => l.moves)];

    // 答對判定
    const isCorrect = allLines.some(
      (line) =>
        line.length === newHistory.length &&
        line.every((move, i) => move === newHistory[i])
    );

    if (isCorrect) {
      setSolvedThisQuestion(true);
      setLastAnswerResult("correct");
      clearTimers();
      const timeMs = Date.now() - questionStartTimeRef.current;
      submitAnswer(true, timeMs);
      return;
    }

    // 答錯判定：走法已無法符合任何正解前綴
    const canStillMatch = allLines.some((line) =>
      newHistory.length <= line.length &&
      newHistory.every((move, i) => move === line[i])
    );

    if (!canStillMatch) {
      setSolvedThisQuestion(true);
      setLastAnswerResult("wrong");
      clearTimers();
      submitAnswer(false, 0);
      return;
    }

    // 玩家走對了但還沒結束——自動替黑方走正解的下一步（題目電腦回應）。
    // 找出「跟目前走法序列前綴一致」的正解線，取其下一步就是電腦要走的棋。
    // 如果多條線的下一步不一樣，取第一條（主線優先）。
    const nextBlackMove = allLines.find(
      (line) =>
        line.length > newHistory.length &&
        newHistory.every((move, i) => move === line[i])
    )?.[newHistory.length];

    if (nextBlackMove && result.sideToMove === "b") {
      // 延遲 400ms 讓玩家看到自己走的棋再看電腦走
      setTimeout(() => {
        setBoard((prevBoard) => {
          if (!prevBoard || !engine) return prevBoard;
          const fenForBlack = toFenStr(prevBoard, "b");
          if (!engine.isLegalMove(fenForBlack, "b", nextBlackMove)) return prevBoard;
          const blackResult = engine.applyMove(fenForBlack, "b", nextBlackMove);
          setSideToMove(blackResult.sideToMove);
          setLastMoveHighlight({ from: nextBlackMove.slice(0, 2), to: nextBlackMove.slice(2, 4) });
          setMoveHistory((prev) => [...prev, nextBlackMove]);
          return parseFen(blackResult.fen);
        });
      }, 400);
    }
  }

  async function submitAnswer(solved: boolean, timeMs: number) {
    if (!roomId || !myUid) return;

    // 只寫自己的答案，不在這裡判斷推進邏輯。
    // 推進下一題的邏輯統一在 onSnapshot 裡處理，避免兩方同時寫時的競態問題。
    await updateDoc(doc(db, "battleRooms", roomId), {
      [`players.${myUid}.solved`]: solved,
      [`players.${myUid}.timeMs`]: solved ? timeMs : 0,
      [`scores.${myUid}`]: solved
        ? (room?.scores[myUid] ?? 0) + 1
        : (room?.scores[myUid] ?? 0),
    }).catch((error) => {
      console.error("[battle] submitAnswer 失敗：", error);
    });
  }

  async function handleTimeOut() {
    clearTimers();
    setSolvedThisQuestion(true);
    setLastAnswerResult("wrong");
    await submitAnswer(false, 0);
  }

  async function handleResign() {
    if (!roomId || !myUid || !opponentUid) return;
    clearTimers();
    // 認輸：直接把對手設為贏家
    await updateDoc(doc(db, "battleRooms", roomId), {
      status: "finished",
      winner: opponentUid,
    }).catch(console.error);
  }

  function applyBattleResult(data: BattleRoomDoc, uid: string) {
    if (!user) return;
    const winner = data.winner;
    // 贏：退還入場費 50 + 額外獎勵 50 = 淨賺 50（因為進場已扣 50，現在補回來再多給 50）
    // 輸：入場費 50 不退還，不再額外扣除
    // 平局：退還入場費（不虧不賺）
    let delta = 0;
    if (winner === uid) delta = BATTLE_ENTRY_COST + BATTLE_WIN_REWARD; // +100（退場費+獎勵）
    else if (winner === null) delta = BATTLE_ENTRY_COST; // 退還入場費，平局不賺不虧

    if (delta === 0) return; // 輸了不退，delta 維持 0
    const newFood = Math.max(0, user.foodCount + delta);
    const updatedUser = { ...user, foodCount: newFood, updatedAt: Date.now() };
    setUser(updatedUser);
    updateDoc(doc(db, "users", uid), { foodCount: newFood, updatedAt: Date.now() }).catch(console.error);
  }

  // ---- 結算畫面 ----
  if (phase === "finished" && room) {
    const winner = room.winner;
    const isWin = winner === myUid;
    const isDraw = winner === null;
    const oppName = opponentUid ? (room.players[opponentUid]?.displayName ?? "對手") : "對手";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#FDF6E8] px-4">
        <section className="w-full max-w-sm rounded-3xl bg-white/70 px-6 py-8 text-center shadow-xl">
          <p className="text-4xl">{isDraw ? "🤝" : isWin ? "🏆" : "😢"}</p>
          <p className="mt-2 text-xl font-extrabold text-[#1A1A2E]">
            {isDraw ? "平局！" : isWin ? "你贏了！" : "你輸了…"}
          </p>
          <p className="mt-1 text-sm text-[#1A1A2E]/60">vs {oppName}</p>
          <div className="mt-4 flex justify-center gap-8 text-center">
            <div>
              <p className="text-2xl font-extrabold text-[#C0392B]">{myScore}</p>
              <p className="text-xs text-[#1A1A2E]/50">我的答對題數</p>
            </div>
            <div className="text-2xl font-bold text-[#1A1A2E]/30">:</div>
            <div>
              <p className="text-2xl font-extrabold text-[#1A1A2E]">{oppScore}</p>
              <p className="text-xs text-[#1A1A2E]/50">{oppName}</p>
            </div>
          </div>
          <p className="mt-3 rounded-xl bg-[#1A1A2E]/5 px-4 py-2 text-sm font-semibold text-[#1A1A2E]">
            {isDraw
              ? "平局，退還入場費 50 飼料"
              : isWin
              ? `+${BATTLE_WIN_REWARD} 飼料（退場費 +${BATTLE_ENTRY_COST} + 獎勵 +${BATTLE_WIN_REWARD}）🎉`
              : "入場費 50 飼料不退還"}
          </p>
          <button
            type="button"
            onClick={async () => { await leaveAndCleanup(); router.push("/"); }}
            className="mt-6 w-full rounded-2xl bg-[#1A1A2E] px-4 py-3 text-sm font-extrabold text-white transition-transform active:scale-95"
          >
            返回大廳
          </button>
        </section>
      </main>
    );
  }

  // ---- 等待配對 ----
  if (phase === "queuing" || !currentPuzzle || !board) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-[#FDF6E8] px-4">
        <section className="w-full max-w-sm rounded-3xl bg-white/70 px-6 py-8 text-center shadow-xl">
          <p className="text-3xl">⚔️</p>
          <p className="mt-2 text-base font-extrabold text-[#1A1A2E]">配對中…</p>
          <p className="mt-1 text-sm text-[#1A1A2E]/60">{statusMessage}</p>
          <div className="mt-4 flex justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#E8B84B] border-t-transparent" />
          </div>
          <button
            type="button"
            onClick={async () => { refundIfNotMatched(); await leaveAndCleanup(); router.push("/"); }}
            className="mt-6 w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95"
          >
            取消並返回大廳（退回 50 飼料）
          </button>
        </section>
      </main>
    );
  }

  // ---- 對戰畫面 ----
  const timeLeftSec = Math.ceil(timeLeftMs / 1000);
  const oppName = opponentUid ? (room?.players[opponentUid]?.displayName ?? "對手") : "對手";

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* 對戰資訊列 */}
        <div className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <div className="text-center">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">{user?.displayName}</p>
            <p className="text-2xl font-extrabold text-[#C0392B]">{myScore}</p>
          </div>
          <div className="text-center">
            <p className="text-[11px] text-[#1A1A2E]/40">第 {currentQuestionIndex + 1} / {TOTAL_QUESTIONS} 題</p>
            <p className={["text-xl font-extrabold tabular-nums", timeLeftSec <= 5 ? "text-[#C0392B]" : "text-[#1A1A2E]"].join(" ")}>
              {timeLeftSec}s
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">{oppName}</p>
            <p className="text-2xl font-extrabold text-[#1A1A2E]">{oppScore}</p>
          </div>
        </div>

        {/* 棋盤 */}
        <div className="mt-4">
          <ChessBoard
            board={board}
            onMove={handleMove}
            lastMove={lastMoveHighlight}
          />
        </div>

        {solvedThisQuestion ? (
          <p className={[
            "mt-3 rounded-2xl px-4 py-2 text-center text-sm font-bold",
            lastAnswerResult === "correct"
              ? "bg-[#5B8C5A]/10 text-[#5B8C5A]"
              : "bg-[#C0392B]/10 text-[#C0392B]",
          ].join(" ")}>
            {lastAnswerResult === "correct" ? "✅ 答對！等待對手…" : "❌ 答錯，等待下一題…"}
          </p>
        ) : null}

        {/* 認輸按鈕 */}
        <button
          type="button"
          onClick={handleResign}
          className="mt-4 w-full rounded-2xl bg-white px-4 py-2.5 text-sm font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
        >
          🏳️ 認輸（直接離開，本局記輸）
        </button>
      </div>
    </main>
  );
}

// ---- 小工具：把 BoardGrid 轉成 FEN 字串 ----
function toFenStr(board: ReturnType<typeof parseFen>, sideToMove: "w" | "b"): string {
  // 使用 ChessBoard 已有的 parseFen/toFen 邏輯
  // 這裡直接用規則引擎的 applyMove 需要 FEN，但我們維護了 board state，
  // 需要一個反向轉換。考慮到對戰頁面本身不需要很複雜的合法性校驗
  // （只需要比對正解），這裡直接使用 toFen 從 fen.ts 匯入。
  return _boardToFen(board, sideToMove);
}

// 簡單的 BoardGrid → FEN 轉換（複用 fen.ts 的 toFen，但那個函式只接受 BoardGrid
// 不附帶 sideToMove，這裡包一層加上輪走方）
function _boardToFen(board: ReturnType<typeof parseFen>, sideToMove: "w" | "b"): string {
  const rows = board.map((row) => {
    let fenRow = "";
    let empty = 0;
    for (const cell of row) {
      if (!cell) { empty++; continue; }
      if (empty > 0) { fenRow += empty; empty = 0; }
      const letter = cell.type === "k" ? "k" : cell.type === "a" ? "a" : cell.type === "e" ? "e" : cell.type === "h" ? "h" : cell.type === "r" ? "r" : cell.type === "c" ? "c" : "p";
      fenRow += cell.color === "r" ? letter.toUpperCase() : letter;
    }
    if (empty > 0) fenRow += empty;
    return fenRow;
  });
  return rows.join("/") + " " + sideToMove;
}

export default function BattlePage() {
  return (
    <RequireAuth requiredRole="student">
      <BattlePageContent />
    </RequireAuth>
  );
}
