/**
 * src/app/play/page.tsx
 *
 * 與電腦對弈頁面
 * ------------------------------------------------------------
 * 跟解題系統（usePuzzleSolver.ts）是完全不同的兩套邏輯：解題是跟預錄
 * 好的正解序列逐字比對，這裡是真正的下棋——用 @/lib/engine/rulesEngine.ts
 * （ffish-es6 規則引擎）驗證每一步合法性、判斷將軍/終局，學生可以走
 * 任何合法的棋，不限於某條預先設計好的路線。
 *
 * 難度分 1-10 級（跟題目系統共用 PuzzleLevel），贏的飼料獎勵依「對手
 * 等級 vs 學生自己等級」的差距計算——以小博大贏了給最多到100，以大
 * 欺小贏了只給10（見 @/lib/engine/computerPlayer.ts 的公式說明）。
 *
 * 對局結束（贏/輸/和都算）會把完整的走法/局面歷史寫進 Firestore
 * （@/lib/engine/gameRecording.ts），給老師後台查閱、回放整局棋。
 *
 * 學生固定執紅先走、電腦執黑，從標準開局開始。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { useRulesEngine } from "@/hooks/useRulesEngine";
import { parseFen, STANDARD_START_FEN } from "@/lib/xiangqi/fen";
import {
  chooseComputerMove,
  calculateWinRewardFood,
  COMPUTER_LEVELS,
  LOSE_PENALTY_FOOD,
  DRAW_REWARD_FOOD,
  type ComputerLevel,
} from "@/lib/engine/computerPlayer";
import { recordVsComputerGame } from "@/lib/engine/gameRecording";
import type { UserDoc } from "@/types/database";

type GamePhase = "choosing_difficulty" | "student_turn" | "computer_thinking" | "game_over";

function VsComputerContent() {
  const router = useRouter();
  const { engine, error: engineError, isLoading: engineLoading } = useRulesEngine();
  const user = useGameStore((s) => s.user);
  const applyVsComputerResult = useGameStore((s) => s.applyVsComputerResult);

  const [opponentLevel, setOpponentLevel] = useState<ComputerLevel | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>("choosing_difficulty");
  const [fen, setFen] = useState(STANDARD_START_FEN);
  // 剛剛走的這一步（學生或電腦都算），給 ChessBoard 畫淡色標示用，
  // 解決「電腦走完棋看不出剛剛動了哪顆子」的問題。
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [sideToMove, setSideToMove] = useState<"w" | "b">("w");
  const [moveError, setMoveError] = useState<string | null>(null);

  // 認輸：兩段式確認（先按一次顯示「確定要認輸嗎？」，再按一次才真的執行），
  // 避免不小心點到就直接判輸。
  const [isConfirmingResign, setIsConfirmingResign] = useState(false);

  // 求和：呼叫 /api/analyze-position 看現在的局面，電腦（黑方）自己的
  // 優勢分數沒有超過 100，就同意和棋；否則拒絕，遊戲繼續。
  const [isCheckingDraw, setIsCheckingDraw] = useState(false);
  const [drawRejectedMessage, setDrawRejectedMessage] = useState<string | null>(null);
  const DRAW_ACCEPT_THRESHOLD_CP = 100;
  // 求和最少要下滿這個步數才能用，避免「一開局就求和騙飼料」這種
  // 刷分手法——開局雙方分數本來就接近 0，幾乎一定會被判定「可以
  // 接受求和」，如果沒有這個門檻，學生可以每盤一開局就求和，完全
  // 不用真的下棋就能一直拿和棋安慰獎飼料。15 步（雙方合計）大概是
  // 開局走完、進入中局的程度，足以確保這是一場「有認真下」的對局。
  const MIN_MOVES_BEFORE_DRAW_OFFER = 15;
  const [gameResultMessage, setGameResultMessage] = useState<string | null>(null);

  // 走法/局面歷史，給對局結束時寫進 Firestore 用（回放功能要用到）
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [fenHistory, setFenHistory] = useState<string[]>([STANDARD_START_FEN]);

  const board = useMemo(() => parseFen(fen), [fen]);

  const isCheck = useMemo(() => {
    if (!engine || gamePhase === "choosing_difficulty") return false;
    try {
      return engine.getGameStatus(fen, sideToMove).isCheck;
    } catch {
      return false;
    }
  }, [engine, fen, sideToMove, gamePhase]);

  function handleStartGame(chosenLevel: ComputerLevel) {
    setOpponentLevel(chosenLevel);
    setFen(STANDARD_START_FEN);
    setSideToMove("w");
    setMoveError(null);
    setGameResultMessage(null);
    setMoveHistory([]);
    setFenHistory([STANDARD_START_FEN]);
    setLastMove(null);
    setGamePhase("student_turn");
  }

  function handleBackToDifficultyPicker() {
    setGamePhase("choosing_difficulty");
    setOpponentLevel(null);
    setMoveError(null);
    setGameResultMessage(null);
  }

  /**
   * 檢查指定局面是否終局；如果是，結算獎懲、寫入對局紀錄、切換到
   * game_over，回傳 true。newMoveHistory/newFenHistory 是「加上這一步
   * 之後」的完整歷史（呼叫端負責先 append 好再傳進來，這樣不管是學生
   * 那步結束遊戲、還是電腦那步結束遊戲，記錄的都是完整正確的歷史）。
   */
  function finalizeGame(outcome: "win" | "lose" | "draw", finalMoveHistory: string[], finalFenHistory: string[]) {
    if (!opponentLevel || !user) return;

    const rewardResult = applyVsComputerResult(outcome, opponentLevel);
    setGameResultMessage(rewardResult.message);
    setGamePhase("game_over");

    recordVsComputerGame({
      studentUid: user.uid,
      opponentLevel,
      studentLevelAtPlay: user.chessLevel,
      outcome,
      foodDelta: rewardResult.foodDelta,
      moveHistory: finalMoveHistory,
      fenHistory: finalFenHistory,
    }).catch((error) => {
      console.error("[play] 對局紀錄寫入失敗（不影響飼料獎懲，只是老師後台看不到這一局）：", error);
    });
  }

  function resolveGameOverIfNeeded(
    checkFen: string,
    checkSideToMove: "w" | "b",
    newMoveHistory: string[],
    newFenHistory: string[]
  ): boolean {
    if (!engine || !opponentLevel || !user) return false;

    const status = engine.getGameStatus(checkFen, checkSideToMove);
    if (!status.isGameOver) return false;

    // 學生固定是紅方（w）
    const outcome: "win" | "lose" | "draw" =
      status.result === "draw" ? "draw" : status.result === "red_wins" ? "win" : "lose";

    finalizeGame(outcome, newMoveHistory, newFenHistory);
    return true;
  }

  function handleStudentMove(notation: string) {
    if (!engine || gamePhase !== "student_turn") return;
    setMoveError(null);
    setIsConfirmingResign(false);
    setDrawRejectedMessage(null);

    if (!engine.isLegalMove(fen, "w", notation)) {
      setMoveError("這步不合法，再想想看！");
      return;
    }

    const result = engine.applyMove(fen, "w", notation);
    const newMoveHistory = [...moveHistory, notation];
    const newFenHistory = [...fenHistory, result.fen];

    setFen(result.fen);
    setSideToMove(result.sideToMove);
    setMoveHistory(newMoveHistory);
    setFenHistory(newFenHistory);
    setLastMove({ from: notation.slice(0, 2), to: notation.slice(2, 4) });

    if (!resolveGameOverIfNeeded(result.fen, result.sideToMove, newMoveHistory, newFenHistory)) {
      setGamePhase("computer_thinking");
    }
  }

  function handleResign() {
    if (gamePhase !== "student_turn") return;

    if (!isConfirmingResign) {
      setIsConfirmingResign(true);
      return;
    }

    setIsConfirmingResign(false);
    finalizeGame("lose", moveHistory, fenHistory);
  }

  function cancelResignConfirm() {
    setIsConfirmingResign(false);
  }

  async function handleOfferDraw() {
    if (gamePhase !== "student_turn") return;

    if (moveHistory.length < MIN_MOVES_BEFORE_DRAW_OFFER) {
      setDrawRejectedMessage(
        `至少要下滿 ${MIN_MOVES_BEFORE_DRAW_OFFER} 步才能求和（目前 ${moveHistory.length} 步），再多下幾步吧！`
      );
      return;
    }

    setIsCheckingDraw(true);
    setDrawRejectedMessage(null);
    try {
      const response = await fetch("/api/analyze-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // 求和只會在學生（紅方）回合按，sideToMove 固定是 "w"。
        body: JSON.stringify({ fen, sideToMove: "w" }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(errorBody?.error ?? `分析失敗（狀態碼 ${response.status}）`);
      }
      const data = (await response.json()) as { scoreCp: number };
      // data.scoreCp 是紅方視角的分數（因為 sideToMove 是 "w"），取負號
      // 換算成電腦（黑方）自己的優勢分數。
      const computerAdvantage = -data.scoreCp;

      if (computerAdvantage <= DRAW_ACCEPT_THRESHOLD_CP) {
        finalizeGame("draw", moveHistory, fenHistory);
      } else {
        setDrawRejectedMessage("電腦覺得自己優勢明顯，拒絕求和，繼續下吧！");
      }
    } catch (error) {
      console.error("[play] 求和判斷失敗：", error);
      setDrawRejectedMessage("求和請求失敗，請稍後再試。");
    } finally {
      setIsCheckingDraw(false);
    }
  }

  // 電腦回應：真正引擎接上之後，光是呼叫 API（子程序啟動+權重檔
  // 載入+搜尋）本身就需要實際的時間（粗估 1~5 秒，依難度跟伺服器
  // 冷啟動狀態），不需要再疊加原本給隨機選棋佔位版本用的「假裝在想」
  // 延遲——疊加起來只會讓等待時間變得不必要地長。保留一個極短的
  // 緩衝（150ms）純粹是讓「電腦思考中…」的文字至少有機會被看到，
  // 不是要模擬思考時間。
  useEffect(() => {
    if (gamePhase !== "computer_thinking" || !engine || !opponentLevel) return;

    let isCancelled = false;
    const timer = setTimeout(async () => {
      try {
        const legalMoves = engine.getLegalMoves(fen, "b");
        const chosenMove = await chooseComputerMove(engine, fen, "b", legalMoves, opponentLevel);
        if (isCancelled) return;

        const result = engine.applyMove(fen, "b", chosenMove);
        const newMoveHistory = [...moveHistory, chosenMove];
        const newFenHistory = [...fenHistory, result.fen];

        setFen(result.fen);
        setSideToMove(result.sideToMove);
        setMoveHistory(newMoveHistory);
        setFenHistory(newFenHistory);
        setLastMove({ from: chosenMove.slice(0, 2), to: chosenMove.slice(2, 4) });

        if (!resolveGameOverIfNeeded(result.fen, result.sideToMove, newMoveHistory, newFenHistory)) {
          setGamePhase("student_turn");
        }
      } catch (error) {
        console.error("[play] 電腦走子失敗：", error);
        if (!isCancelled) {
          setMoveError("電腦走子時發生錯誤，請重新開始一局。");
        }
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, engine, opponentLevel]);

  const isStudentTurn = gamePhase === "student_turn";

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
          <h1 className="text-base font-bold text-[#1A1A2E]">♟️ 與電腦對弈</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {engineError ? (
          <div className="mt-4 rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
            {engineError}
          </div>
        ) : engineLoading || !user ? (
          <div className="mt-4 rounded-2xl bg-white/60 px-4 py-8 text-center text-sm text-[#1A1A2E]/60">
            棋規引擎載入中…
          </div>
        ) : gamePhase === "choosing_difficulty" ? (
          <DifficultyPicker user={user} onPick={handleStartGame} />
        ) : (
          <>
            <section className="mt-4 rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-[#1A1A2E]">
                  {gamePhase === "student_turn"
                    ? "🟢 你的回合"
                    : gamePhase === "computer_thinking"
                      ? "🤔 電腦思考中…"
                      : "🏁 對局結束"}
                </p>
                {isCheck && gamePhase !== "game_over" ? (
                  <span className="rounded-full bg-[#C0392B]/10 px-2 py-1 text-xs font-bold text-[#C0392B]">
                    將軍！
                  </span>
                ) : null}
              </div>

              <div className={["mt-3", isStudentTurn ? "" : "pointer-events-none opacity-60"].join(" ")}>
                <ChessBoard board={board} onMove={handleStudentMove} lastMove={lastMove} />
              </div>

              <div className="mt-3 min-h-[1.5rem] text-center text-xs">
                {moveError ? <span className="text-[#C0392B]">{moveError}</span> : null}
              </div>

              {isStudentTurn ? (
                <div className="mt-2">
                  {isConfirmingResign ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-xs font-bold text-[#C0392B]">確定要認輸嗎？</span>
                      <button
                        type="button"
                        onClick={handleResign}
                        className="rounded-lg bg-[#C0392B] px-3 py-1.5 text-xs font-bold text-white transition-transform active:scale-95"
                      >
                        確定認輸
                      </button>
                      <button
                        type="button"
                        onClick={cancelResignConfirm}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleResign}
                        className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
                      >
                        🏳️ 認輸
                      </button>
                      <button
                        type="button"
                        onClick={handleOfferDraw}
                        disabled={isCheckingDraw || moveHistory.length < MIN_MOVES_BEFORE_DRAW_OFFER}
                        className="flex-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95 disabled:opacity-50"
                      >
                        {isCheckingDraw
                          ? "詢問電腦中…"
                          : moveHistory.length < MIN_MOVES_BEFORE_DRAW_OFFER
                            ? `🤝 求和（還差 ${MIN_MOVES_BEFORE_DRAW_OFFER - moveHistory.length} 步）`
                            : "🤝 求和"}
                      </button>
                    </div>
                  )}

                  {drawRejectedMessage ? (
                    <p className="mt-2 text-center text-xs text-[#C0392B]">{drawRejectedMessage}</p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {gamePhase === "game_over" ? (
              <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 text-center shadow-sm">
                <p className="text-sm font-bold text-[#1A1A2E]">{gameResultMessage}</p>
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => opponentLevel && handleStartGame(opponentLevel)}
                    className="rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
                  >
                    🔁 再來一局（同難度）
                  </button>
                  <button
                    type="button"
                    onClick={handleBackToDifficultyPicker}
                    className="rounded-2xl bg-white/80 px-4 py-3 text-sm font-bold text-[#1A1A2E]/70 transition-transform active:scale-95"
                  >
                    重新選擇難度
                  </button>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}

/** 10 級難度選擇器，每個選項顯示「贏了給這位學生多少飼料」（依公式即時算出） */
function DifficultyPicker({
  user,
  onPick,
}: {
  user: UserDoc;
  onPick: (level: ComputerLevel) => void;
}) {
  return (
    <section className="mt-4 rounded-3xl bg-white/60 px-4 py-6 shadow-sm">
      <h2 className="text-center text-sm font-bold text-[#1A1A2E]">選擇對手等級</h2>
      <p className="mt-1 text-center text-xs text-[#1A1A2E]/60">
        你目前是 {user.chessLevel} 級。挑戰比自己高的等級，贏了飼料更多（最高 100）；
        挑戰比自己低的等級，贏了飼料較少（最低 10）。輸了固定扣 {LOSE_PENALTY_FOOD} 飼料，
        和棋給 {DRAW_REWARD_FOOD} 飼料安慰獎。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {COMPUTER_LEVELS.map((level) => {
          const winReward = calculateWinRewardFood(level, user.chessLevel);
          const isOwnLevel = level === user.chessLevel;
          return (
            <button
              key={level}
              type="button"
              onClick={() => onPick(level)}
              className={[
                "flex flex-col items-center gap-0.5 rounded-2xl px-3 py-3 shadow-sm transition-transform active:scale-95",
                isOwnLevel ? "bg-[#E8B84B]/20 ring-2 ring-[#E8B84B]" : "bg-white/80",
              ].join(" ")}
            >
              <span className="text-sm font-bold text-[#1A1A2E]">Lv.{level}</span>
              <span className="text-xs font-semibold text-[#8B5FBF]">贏 +{winReward}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default function VsComputerPage() {
  return (
    <RequireAuth requiredRole="student">
      <VsComputerContent />
    </RequireAuth>
  );
}
