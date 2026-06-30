/**
 * src/app/play/review/[gameId]/page.tsx
 *
 * 對局回顧頁面：回放 + 分析 + 推演
 * ------------------------------------------------------------
 * 學生從首頁「📺 最近對局」點進來，看自己某一場對弈電腦的完整紀錄。
 *
 * 三個功能：
 *   1. 回放（replay）：用 prev/next 一步步重現整局棋，跟老師後台的
 *      回放邏輯相同概念，只是這裡是學生看自己的對局，獨立實作成
 *      一個完整頁面（不是 modal），因為要容納分析/推演功能，空間
 *      需求比較大。
 *   2. 分析（analyze）：呼叫 /api/analyze-position，用 Pikafish
 *      最強設定（不套用對弈時的「送子」隨機性）分析「目前看到的這個
 *      局面」，告訴學生引擎認為最好的走法跟分數。
 *   3. 推演（explore）：從回放看到的任何一步「分支」出去，學生可以
 *      自己試著走不同的路線（用 rulesEngine.ts 驗證合法性），探索
 *      「如果走這步會怎樣」，可以隨時在推演中再按分析看引擎怎麼看。
 *      退出推演模式會回到原本回放的那一步，不影響原始紀錄。
 */

"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { useRulesEngine } from "@/hooks/useRulesEngine";
import { usePositionAnalysis, toRedPerspectiveScore, toRedPerspectiveMateIn, getScoreDisplay, SCORE_DISPLAY_STYLES } from "@/hooks/usePositionAnalysis";
import { parseFen } from "@/lib/xiangqi/fen";
import { toChineseNotation } from "@/lib/xiangqi/chineseNotation";
import type { VsComputerGameDoc } from "@/types/database";

const OUTCOME_LABEL: Record<"win" | "lose" | "draw", string> = {
  win: "🏆 獲勝",
  lose: "😢 落敗",
  draw: "🤝 和棋",
};

function sideToMoveAtStep(step: number): "w" | "b" {
  // fenHistory[0] 是開局（紅方先走），每往後一步換另一方走，
  // 所以「第 step 步之後輪到誰」就看 step 是奇數還是偶數。
  return step % 2 === 0 ? "w" : "b";
}

/** 把紅方視角分數換算成「黑優202分」「紅優100分」這種一看就懂的格式 */

function ReviewContent({ gameId }: { gameId: string }) {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const { engine, error: engineError, isLoading: engineLoading } = useRulesEngine();

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [game, setGame] = useState<VsComputerGameDoc | null>(null);

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"replay" | "explore">("replay");

  // 推演模式專用狀態：從某一步分支出去之後，維護獨立的局面/輪走方/
  // 走過的路線，不影響原始的回放紀錄（game.fenHistory 完全不會被改）。
  const [exploreFen, setExploreFen] = useState<string | null>(null);
  const [exploreSideToMove, setExploreSideToMove] = useState<"w" | "b">("w");
  const [exploreMoveHistory, setExploreMoveHistory] = useState<string[]>([]);
  const [exploreMoveError, setExploreMoveError] = useState<string | null>(null);

  const rawFenForAnalysis = mode === "explore" ? exploreFen : game?.fenHistory[step] ?? null;
  const sideForAnalysis = mode === "explore" ? exploreSideToMove : sideToMoveAtStep(step);

  // 終局局面（將死/困斃）根本沒有合法走法可以分析，呼叫 API 只會浪費
  // 一次引擎啟動又得到一個「沒有合法走法」的錯誤。這裡用規則引擎先
  // 判斷一次，是終局就直接傳 null 給 usePositionAnalysis（它看到 fen
  // 是 null 就會自己跳過呼叫，不需要額外改 Hook 的介面）。
  const isCurrentPositionGameOver = useMemo(() => {
    if (!engine || !rawFenForAnalysis) return false;
    try {
      return engine.getGameStatus(rawFenForAnalysis, sideForAnalysis).isGameOver;
    } catch {
      return false;
    }
  }, [engine, rawFenForAnalysis, sideForAnalysis]);

  const fenForAnalysis = isCurrentPositionGameOver ? null : rawFenForAnalysis;

  const { analysis, isAnalyzing, analyzeError, autoAnalyze, toggleAutoAnalyze } = usePositionAnalysis(
    fenForAnalysis,
    sideForAnalysis
  );

  useEffect(() => {
    let isCancelled = false;

    async function fetchGame() {
      if (!user) return;
      setStatus("loading");
      try {
        const snapshot = await getDoc(doc(db, "users", user.uid, "vsComputerGames", gameId));
        if (isCancelled) return;
        if (!snapshot.exists()) {
          setErrorMessage("找不到這場對局紀錄。");
          setStatus("error");
          return;
        }
        setGame(snapshot.data() as VsComputerGameDoc);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[review] 讀取對局紀錄失敗：", error);
        setErrorMessage(error instanceof Error ? error.message : "讀取對局紀錄時發生未知錯誤。");
        setStatus("error");
      }
    }

    fetchGame();
    return () => {
      isCancelled = true;
    };
  }, [user, gameId]);

  const totalSteps = game ? game.fenHistory.length - 1 : 0;

  const replayBoard = useMemo(() => {
    if (!game) return null;
    return parseFen(game.fenHistory[step] ?? game.fenHistory[0]);
  }, [game, step]);

  const exploreBoard = useMemo(() => {
    if (!exploreFen) return null;
    return parseFen(exploreFen);
  }, [exploreFen]);

  function enterExploreMode() {
    if (!game) return;
    setExploreFen(game.fenHistory[step]);
    setExploreSideToMove(sideToMoveAtStep(step));
    setExploreMoveHistory([]);
    setExploreMoveError(null);
    setMode("explore");
  }

  function exitExploreMode() {
    setMode("replay");
    setExploreFen(null);
    setExploreMoveHistory([]);
    setExploreMoveError(null);
  }

  function handleExploreMove(notation: string) {
    if (!engine || !exploreFen) return;
    setExploreMoveError(null);

    if (!engine.isLegalMove(exploreFen, exploreSideToMove, notation)) {
      setExploreMoveError("這步不合法，再想想看！");
      return;
    }

    const result = engine.applyMove(exploreFen, exploreSideToMove, notation);
    setExploreFen(result.fen);
    setExploreSideToMove(result.sideToMove);
    setExploreMoveHistory((prev) => [...prev, notation]);
  }



  if (engineError) {
    return (
      <CenteredMessage>
        <p className="text-sm text-[#C0392B]">{engineError}</p>
      </CenteredMessage>
    );
  }
  if (engineLoading || status === "loading") {
    return (
      <CenteredMessage>
        <p className="text-sm text-[#1A1A2E]/60">載入中…</p>
      </CenteredMessage>
    );
  }
  if (status === "error" || !game || !replayBoard) {
    return (
      <CenteredMessage>
        <p className="text-sm text-[#C0392B]">{errorMessage ?? "讀取失敗"}</p>
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mt-3 rounded-full bg-[#1A1A2E]/5 px-4 py-2 text-xs font-bold text-[#1A1A2E]"
        >
          返回大廳
        </button>
      </CenteredMessage>
    );
  }

  const isExploring = mode === "explore";
  const displayBoard = isExploring ? exploreBoard! : replayBoard;
  const currentSideToMove = isExploring ? exploreSideToMove : sideToMoveAtStep(step);

  // 剛剛走的這一步：回放模式是「第 step 步」對應的走法；推演模式是
  // 推演路線裡最後一步（還沒走過任何推演步時是 null，不畫標示）。
  const displayLastMove = isExploring
    ? exploreMoveHistory.length > 0
      ? exploreMoveHistory[exploreMoveHistory.length - 1]
      : null
    : step > 0
      ? game.moveHistory[step - 1]
      : null;
  const lastMoveHighlight = displayLastMove
    ? { from: displayLastMove.slice(0, 2), to: displayLastMove.slice(2, 4) }
    : null;

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📺 對局回顧</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <section className="mt-3 rounded-2xl bg-white/70 px-4 py-2 text-center text-xs text-[#1A1A2E]/70">
          {OUTCOME_LABEL[game.outcome]}・對手 Lv.{game.opponentLevel}（自身 Lv.{game.studentLevelAtPlay}）・
          {game.moveHistory.length} 手
        </section>

        {/* 目前局面評分：跟下面棋盤本體分開、放在比較上面、視覺上更
            醒目的位置，按過一次「分析」之後，只要有分析結果就會顯示，
            不需要往下找才看得到分數。開了自動分析之後，切換局面時會
            短暫顯示「分析中」，讓學生知道系統在處理、不是卡住了。
            有強制將死時改用比較搶眼的底色，直接標示是哪一方有殺。 */}
        {isCurrentPositionGameOver && autoAnalyze ? (
          <section className="mt-3 rounded-2xl bg-[#1A1A2E]/10 px-4 py-2 text-center">
            <span className="text-xs font-semibold text-[#1A1A2E]/60">
              這是終局局面（將死/無棋可走），沒有走法可以分析。
            </span>
          </section>
        ) : null}

        {analysis || isAnalyzing ? (
          <section
            className={[
              "mt-3 rounded-2xl px-4 py-2 text-center",
              analysis
                ? SCORE_DISPLAY_STYLES[
                    getScoreDisplay(
                      toRedPerspectiveScore(analysis.scoreCp, currentSideToMove),
                      toRedPerspectiveMateIn(analysis.mateIn, currentSideToMove)
                    ).variant
                  ]
                : "bg-[#1A1A2E] text-[#FDF6E8]",
            ].join(" ")}
          >
            <span className="text-sm font-extrabold">
              {analysis
                ? getScoreDisplay(
                    toRedPerspectiveScore(analysis.scoreCp, currentSideToMove),
                    toRedPerspectiveMateIn(analysis.mateIn, currentSideToMove)
                  ).label
                : "分析中…"}
            </span>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#1A1A2E]">
              {isExploring ? "🔀 推演模式" : "📺 回放模式"}
            </p>
            <p className="text-xs text-[#1A1A2E]/50">
              {currentSideToMove === "w" ? "紅方走" : "黑方走"}
            </p>
          </div>

          <div className="mt-3">
            <ChessBoard
              board={displayBoard}
              onMove={isExploring ? handleExploreMove : () => {}}
              highlightMove={
                analysis ? { from: analysis.move.slice(0, 2), to: analysis.move.slice(2, 4) } : null
              }
              lastMove={lastMoveHighlight}
            />
          </div>

          {isExploring ? (
            <div className="mt-3 min-h-[1.5rem] text-center text-xs">
              {exploreMoveError ? <span className="text-[#C0392B]">{exploreMoveError}</span> : null}
            </div>
          ) : (
            <p className="mt-3 text-center text-xs text-[#1A1A2E]/60">
              第 {step} / {totalSteps} 步
              {step > 0
                ? `（${toChineseNotation(parseFen(game.fenHistory[step - 1]), game.moveHistory[step - 1])}）`
                : "（開局）"}
            </p>
          )}

          {!isExploring ? (
            <div className="mt-3 flex items-center justify-center gap-2">
              <NavButton label="⏮" onClick={() => setStep(0)} disabled={step === 0} />
              <NavButton
                label="◀ 上一步"
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                disabled={step === 0}
              />
              <NavButton
                label="下一步 ▶"
                onClick={() => setStep((current) => Math.min(totalSteps, current + 1))}
                disabled={step === totalSteps}
              />
              <NavButton label="⏭" onClick={() => setStep(totalSteps)} disabled={step === totalSteps} />
            </div>
          ) : null}

          <div className="mt-3 flex gap-2">
            {!isExploring ? (
              <button
                type="button"
                onClick={enterExploreMode}
                className="flex-1 rounded-xl bg-[#8B5FBF] px-3 py-2 text-xs font-bold text-white transition-transform active:scale-95"
              >
                🔀 從這裡推演
              </button>
            ) : (
              <button
                type="button"
                onClick={exitExploreMode}
                className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95"
              >
                ↩️ 返回回放（第 {step} 步）
              </button>
            )}
            <button
              type="button"
              onClick={toggleAutoAnalyze}
              className={[
                "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-transform active:scale-95",
                autoAnalyze ? "bg-[#1A1A2E]/10 text-[#1A1A2E]/70" : "bg-[#E8B84B] text-[#1A1A2E]",
              ].join(" ")}
            >
              {autoAnalyze ? (isAnalyzing ? "分析中…（點擊關閉）" : "🔍 自動分析中（點擊關閉）") : "🔍 分析這個局面"}
            </button>
          </div>

          {isExploring && exploreMoveHistory.length > 0 ? (
            <p className="mt-2 text-center text-[11px] text-[#1A1A2E]/50">
              推演路線：{exploreMoveHistory.join(" → ")}
            </p>
          ) : null}

          {analyzeError ? (
            <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-center text-xs text-[#C0392B]">
              {analyzeError}
            </p>
          ) : null}

          {analysis ? (
            <div className="mt-3 rounded-xl bg-[#5B8C5A]/10 px-3 py-2 text-center text-xs text-[#5B8C5A]">
              <p className="font-bold">
                引擎建議走法：{toChineseNotation(displayBoard, analysis.move)}
              </p>
              <p className="mt-0.5 text-[#5B8C5A]/80">搜尋深度 {analysis.depth}</p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#FDF6E8] px-4 text-center">
      {children}
    </main>
  );
}

export default function ReviewPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = use(params);
  return (
    <RequireAuth requiredRole="student">
      <ReviewContent gameId={gameId} />
    </RequireAuth>
  );
}
