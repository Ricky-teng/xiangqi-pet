/**
 * src/hooks/usePuzzleSolver.ts
 *
 * 學生端解題核心 Hook
 * ------------------------------------------------------------
 * 職責：
 *   1. 維護「目前棋盤狀態」與「解題進度狀態」這兩份本地（元件層級）狀態。
 *   2. 比對學生走法是否與正解序列當前步相符（呼叫 lib/xiangqi/move.ts）。
 *   3. 答對：推進進度、播放電腦回應步（若有）、解題完成時計算並發放飼料獎勵。
 *   4. 答錯：累計連續答錯次數；達 3 次時觸發小雞生病（提醒學生記得照顧牠），
 *      但不會鎖定棋盤——生病/死亡不再阻擋解題本身，理由：飼料主要靠解題
 *      賺來，如果生病就不能解題，會變成「治病要飼料、生病又賺不到飼料」
 *      的死循環。不管是否觸發生病，都會把棋盤重置回「目前正確進度」
 *      對應的盤面，讓學生立刻重新嘗試。
 *
 * 【多組正解線支援】
 *   同一道殘局有時不只一種能獲勝的走法。puzzle.moves（主線）+
 *   puzzle.alternativeLines（替代線，可選）會被合併成 allLines，
 *   學生每走一步，會跟「目前還跟得上的所有線」（activeLineIndices）
 *   的當前步比對，只要符合其中任何一條，就算答對，並把
 *   activeLineIndices 收斂成「真的符合這一步」的那些線，繼續往下走。
 *   - 電腦的回應步、棋盤重播都改成使用「目前還存活的線之中，第一條」
 *     （leadLine）作為依據，因為這些操作需要「一條明確的線」才能決定
 *     下一步是什麼，而存活的線到目前為止的走法都是一致的（只是接下來
 *     可能分岔），所以選哪條當 leadLine 在「目前」這一步都是等價的。
 *   - 出題老師要確保「替代線」跟主線在分岔之前的走法是逐字一致的
 *     （包含電腦回應步），這樣系統才能正確判斷「目前還跟得上哪幾條」。
 *
 * 【2026-07 新增：偏離已知正解線時，改用引擎即時判斷】
 *   之前學生的走法一定要逐字符合 moves/alternativeLines 裡預存的某一
 *   條線，走法稍有不同（哪怕客觀上也能將死）就直接判錯——這對「同一
 *   殘局其實有不同解法」的情況不公平。現在改成：
 *     1. 學生每一步，先照原本邏輯跟「目前還跟得上的已知正解線」比對，
 *        符合就完全不花任何運算成本（跟以前一樣）。
 *     2. 只有這一步「偏離了所有已知正解線」，才會呼叫
 *        /api/puzzle/judge-move，讓 Pikafish 引擎即時判斷「這步是否
 *        仍然在（步數預算內的）必勝路線上」——是的話，引擎同時給出
 *        電腦這方的最強防守，雙方接下來的每一步都會持續呼叫這支 API
 *        判斷（進入「偏離模式」，直到真的將死或超過步數預算為止）；
 *        不是的話，判定這步答錯（走法失效，跟原本答錯的處理方式完全
 *        一樣：重置棋盤、累計連續答錯次數）。
 *   步數預算 = 題目原本正解線的步數（moves.length，雙方合計）+ 2，
 *   超過預算即使理論上仍必勝，也視為答錯（見 MOVE_BUDGET_BUFFER）。
 *
 *   這個機制刻意設計成「已知正解線優先、免費比對；只有真的走出新招
 *   才花引擎運算」，因為解題是本 App 使用頻率最高的功能，如果每一步
 *   都呼叫引擎會嚴重超出 Vercel 的 CPU 額度（見這次改動前的討論）。
 *
 * 重要設計說明：
 *   - 「重置棋盤」統一用 confirmedFen（目前確認正確的局面 FEN）配合
 *     parseFen 重新產生一份全新的 BoardGrid 物件，取代舊版「從
 *     initialFen 重播 [0, currentStep) 步」的作法——因為進入偏離模式
 *     之後，已經沒有一條「線」可以拿來重播了，改成「隨時記住目前
 *     確認正確的 FEN」是唯一在兩種模式下都通用的作法。
 *   - 解題成功的飼料獎勵只更新 user.foodCount，不直接更動 pet.xp。
 *   - 電腦自動回應步使用 setTimeout 延遲 500ms 執行，並在 Hook 卸載或
 *     下一次走法觸發前清除先前的計時器，避免 race condition。
 *   - 【防刷修正】解題獎勵會依動態公式計算，並把獎勵結果（granted /
 *     error）透過 rewardOutcome 回傳給呼叫端的 UI。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, increment, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import type { PuzzleDoc, SolvedPuzzleRecord } from "@/types/database";
import type { BoardGrid, SolverState } from "@/types/xiangqi";
import { parseFen, toFen } from "@/lib/xiangqi/fen";
import { applyMoveNotation, isMoveMatchingExpected, parseMoveNotation } from "@/lib/xiangqi/move";
import { useRulesEngine } from "@/hooks/useRulesEngine";

// ============================================================
// 1. 常數設定
// ============================================================

/** 同一題連續答錯達此次數時，立刻觸發小雞生病並鎖定棋盤 */
const MAX_CONSECUTIVE_WRONG = 3;

/** 答對後，等待電腦自動回應步的延遲時間（毫秒） */
const COMPUTER_MOVE_DELAY_MS = 500;

/** 步數預算 = 題目原本正解線步數（雙方合計）+ 這個緩衝值 */
const MOVE_BUDGET_BUFFER = 2;

// ============================================================
// 2. 動態飼料獎勵公式
// ============================================================

/**
 * 依照需求書 4.B 計算動態飼料獎勵：
 *   - 同級挑戰 (U = P)：基礎 10 單位。
 *   - 越級挑戰 (U < P)：F = 10 + (P - U) * 5
 *   - 降級挑戰 (U > P)：F = max(1, 10 - (U - P) * 3)
 *
 * @param userLevel 學生目前象棋等級 (U)
 * @param puzzleLevel 題目等級 (P)
 * @returns 應發放的飼料數量
 */
function calculateFoodReward(userLevel: number, puzzleLevel: number): number {
  if (userLevel === puzzleLevel) {
    return 10;
  }
  if (userLevel < puzzleLevel) {
    return 10 + (puzzleLevel - userLevel) * 5;
  }
  // userLevel > puzzleLevel：降級挑戰
  return Math.max(1, 10 - (userLevel - puzzleLevel) * 3);
}

// ============================================================
// 3. Hook 回傳型別
// ============================================================

/** 解題完成後，獎勵結算的結果狀態，供 UI 顯示對應訊息 */
export type RewardOutcome =
  | { status: "pending" }
  | { status: "granted"; earnedFood: number }
  | { status: "already_claimed" }
  | { status: "error"; message: string };

export interface UsePuzzleSolverResult {
  /** 目前棋盤狀態 */
  currentBoard: BoardGrid;
  /** 目前解題進度狀態 */
  solverState: SolverState;
  /** 學生走一步棋的處理函式，傳入四字元走法記號（例如 "h2e2"） */
  handleStudentMove: (moveNotation: string) => void;
  /** 最近一次答錯/生病提示訊息（答對或尚未作答時為 null），供 UI 顯示提示用 */
  lastErrorMessage: string | null;
  /**
   * 解題完成後的獎勵結算狀態（尚未解完時為 null）。
   * "granted" 代表真的拿到飼料。
   */
  rewardOutcome: RewardOutcome | null;
  /**
   * 目前「還跟得上」的正解線之中，排在最前面的那一條完整走法陣列。
   * 用途：給 puzzle/[id]/page.tsx 的提示功能讀
   * leadLine[solverState.currentStep] 顯示下一步提示。
   * 一旦進入偏離模式（見 isDeviatedMode），已經沒有「線」可以提示了，
   * leadLine 會停在偏離發生前最後一條存活的線（不會再更新），
   * 索引超出範圍時是 undefined，呼叫端要自行處理「沒有提示可給」。
   */
  leadLine: string[];
  /**
   * 是否已經偏離所有已知正解線、進入「引擎即時判斷」模式。
   * 給 UI 顯示「目前正在挑戰不同解法」之類的提示用。
   */
  isDeviatedMode: boolean;
  /** 正在等待引擎判斷偏離的這一步（呼叫 /api/puzzle/judge-move 期間為 true） */
  isJudging: boolean;
  /** 步數預算（雙方合計），題目原本正解線步數 + MOVE_BUDGET_BUFFER */
  moveBudget: number;
}

// ============================================================
// 4. 主體 Hook
// ============================================================

/**
 * 學生端解題核心 Hook。
 *
 * @param puzzle 本次要解的殘局題目文件
 */
export function usePuzzleSolver(puzzle: PuzzleDoc): UsePuzzleSolverResult {
  // ---- 從全域狀態總機取得使用者與小雞資料（獨立 selector，避免不必要的重渲染） ----
  const user = useGameStore((s) => s.user);
  const pet = useGameStore((s) => s.pet);
  const setUser = useGameStore((s) => s.setUser);
  const setPet = useGameStore((s) => s.setPet);
  const triggerSickness = useGameStore((s) => s.triggerSickness);

  // ---- 規則引擎：偏離已知正解線時，判斷合法性/終局狀態要靠這個 ----
  const { engine } = useRulesEngine();

  // ---- 多組正解線：合併主線 + 替代線 ----
  const allLines = useMemo<string[][]>(
    () => [puzzle.moves, ...(puzzle.alternativeLines ?? []).map((line) => line.moves)],
    [puzzle.moves, puzzle.alternativeLines]
  );

  // ---- 步數預算（雙方合計）：題目主線步數 + 緩衝值 ----
  const moveBudget = useMemo(() => puzzle.moves.length + MOVE_BUDGET_BUFFER, [puzzle.moves.length]);

  // ---- 這道題目「第一步」是哪一方在走：從 puzzle.moves[0] 的起點格子，
  // 查初始盤面上那顆棋子的顏色決定，不需要另外在 PuzzleDoc 加欄位。 ----
  const initialSideToMove = useMemo<"w" | "b">(() => {
    const board = parseFen(puzzle.initialFen);
    const firstMove = puzzle.moves[0];
    if (!firstMove) return "w";
    try {
      const { from } = parseMoveNotation(firstMove);
      const piece = board[from.row]?.[from.col];
      return piece?.color === "b" ? "b" : "w";
    } catch {
      return "w";
    }
  }, [puzzle.initialFen, puzzle.moves]);

  const sideToMoveAtPly = useCallback(
    (ply: number): "w" | "b" => {
      const isEven = ply % 2 === 0;
      if (initialSideToMove === "w") return isEven ? "w" : "b";
      return isEven ? "b" : "w";
    },
    [initialSideToMove]
  );

  // ---- 本地狀態：目前棋盤、解題進度 ----
  const [currentBoard, setCurrentBoard] = useState<BoardGrid>(() => parseFen(puzzle.initialFen));
  const [solverState, setSolverState] = useState<SolverState>({
      currentStep: 0,
      isCompleted: false,
      consecutiveWrongCount: 0,
      hintUsed: false,
      totalWrongAttempts: 0,
    });

  // 目前「還跟得上」的正解線索引
  const [activeLineIndices, setActiveLineIndices] = useState<number[]>(() =>
    allLines.map((_, index) => index)
  );

  const leadLine = allLines[activeLineIndices[0] ?? 0] ?? puzzle.moves;

  // 「目前確認正確的局面 FEN」：統一取代舊版「從 initialFen 重播正解線」
  // 的重置作法——不管是照已知正解線走、還是已經進入偏離模式，每答對
  // 一步（含電腦回應步）都會更新這個值，答錯時直接拿它重新產生一份
  // 全新的 BoardGrid 物件重置畫面，兩種模式都適用同一套邏輯。
  const confirmedFenRef = useRef<string>(puzzle.initialFen);

  // 是否已經偏離所有已知正解線、進入引擎即時判斷模式
  const [isDeviatedMode, setIsDeviatedMode] = useState(false);
  const [isJudging, setIsJudging] = useState(false);

  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [rewardOutcome, setRewardOutcome] = useState<RewardOutcome | null>(null);

  // ---- 電腦自動回應步的計時器參照，用於清除避免 race condition ----
  const computerMoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 清除尚未觸發的電腦回應步計時器（卸載或下一次互動前呼叫） */
  const clearComputerMoveTimer = useCallback(() => {
    if (computerMoveTimerRef.current !== null) {
      clearTimeout(computerMoveTimerRef.current);
      computerMoveTimerRef.current = null;
    }
  }, []);

  // 元件卸載時，確保不會有殘留的計時器去更新已經不存在的狀態
  useEffect(() => {
    return () => {
      clearComputerMoveTimer();
    };
  }, [clearComputerMoveTimer]);

  // 進入題目時立刻 +1 totalAttempts（不管有沒有答對，只要開始嘗試就算）
  useEffect(() => {
    if (!user) return;
    updateDoc(doc(db, "users", user.uid), {
      "stats.totalAttempts": increment(1),
      updatedAt: Date.now(),
    }).catch((error) => {
      console.error("[usePuzzleSolver] 記錄嘗試次數失敗：", error);
    });
    setUser({
      ...user,
      stats: { ...user.stats, totalAttempts: user.stats.totalAttempts + 1 },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle.id]);

  /** 依 confirmedFenRef 目前的值，產生一份全新的 BoardGrid 物件（強制觸發重新渲染） */
  const rebuildConfirmedBoard = useCallback((): BoardGrid => {
    return parseFen(confirmedFenRef.current);
  }, []);

  /**
   * 解題完成時的獎勵結算。
   */
  const grantSolveReward = useCallback(async () => {
    if (!user) {
      setRewardOutcome({ status: "error", message: "找不到目前登入的使用者資料。" });
      return;
    }

    setRewardOutcome({ status: "pending" });

    const solvedRecordRef = doc(db, "users", user.uid, "solvedPuzzles", puzzle.id);

    try {
      const baseFood = calculateFoodReward(user.chessLevel, puzzle.level);
      const isDoubleActive = (user.doubleRewardExpiry ?? 0) > Date.now();
      const earnedFood = isDoubleActive ? baseFood * 2 : baseFood;
      const now = Date.now();

      const solvedRecord: SolvedPuzzleRecord = {
        puzzleId: puzzle.id,
        solvedAt: now,
        puzzleLevelAtSolve: puzzle.level,
        userLevelAtSolve: user.chessLevel,
        earnedFood,
        wrongAttemptsBeforeSolving: solverState.totalWrongAttempts,
      };

      await Promise.all([
        setDoc(solvedRecordRef, solvedRecord),
        updateDoc(doc(db, "users", user.uid), {
          foodCount: increment(earnedFood),
          "stats.totalSolved": increment(1),
          updatedAt: now,
        }),
      ]);

      setUser({
        ...user,
        foodCount: user.foodCount + earnedFood,
        stats: {
          ...user.stats,
          totalSolved: user.stats.totalSolved + 1,
        },
        updatedAt: now,
      });

      if (pet) {
        setPet({
          ...pet,
          consecutiveWrongCount: 0,
          currentWrongPuzzleId: null,
        });
      }

      setRewardOutcome({ status: "granted", earnedFood });
    } catch (error) {
      console.error("[usePuzzleSolver] 解題獎勵結算失敗：", error);
      setRewardOutcome({
        status: "error",
        message: error instanceof Error ? error.message : "結算獎勵時發生未知錯誤。",
      });
    }
  }, [user, pet, puzzle.id, puzzle.level, setUser, setPet, solverState.totalWrongAttempts]);

  /** 答錯共用處理：重置棋盤、累計連續答錯次數，達上限觸發生病 */
  const commitWrongAnswer = useCallback(
    (message: string) => {
      const newWrongCount = solverState.consecutiveWrongCount + 1;
      const newTotalWrongAttempts = solverState.totalWrongAttempts + 1;
      const justTriggeredSickness = newWrongCount >= MAX_CONSECUTIVE_WRONG;

      if (justTriggeredSickness) {
        triggerSickness(puzzle.id, newWrongCount);
      }

      setCurrentBoard(rebuildConfirmedBoard());
      setSolverState((prev) => ({
        ...prev,
        consecutiveWrongCount: justTriggeredSickness ? 0 : newWrongCount,
        totalWrongAttempts: newTotalWrongAttempts,
      }));
      setLastErrorMessage(
        justTriggeredSickness
          ? `已連續答錯 ${MAX_CONSECUTIVE_WRONG} 次，小雞生病了！記得有空回主頁買藥水照顧牠，現在可以繼續練習。`
          : `${message}（已連續答錯 ${newWrongCount} 次，連續答錯 ${MAX_CONSECUTIVE_WRONG} 次小雞會生病）`
      );

      if (pet && !justTriggeredSickness) {
        setPet({
          ...pet,
          currentWrongPuzzleId: puzzle.id,
          consecutiveWrongCount: newWrongCount,
        });
      }
    },
    [solverState, triggerSickness, puzzle.id, rebuildConfirmedBoard, pet, setPet]
  );

  /**
   * 安排電腦自動回應步（已知正解線模式）：延遲 COMPUTER_MOVE_DELAY_MS
   * 後，自動執行正解序列中下一步（電腦方）。
   */
  const scheduleComputerMove = useCallback(
    (boardAfterStudentMove: BoardGrid, computerStepIndex: number, computerNotation: string) => {
      clearComputerMoveTimer();

      computerMoveTimerRef.current = setTimeout(() => {
        const { board: boardAfterComputerMove } = applyMoveNotation(
          boardAfterStudentMove,
          computerNotation
        );

        confirmedFenRef.current = toFen(boardAfterComputerMove);
        setCurrentBoard(boardAfterComputerMove);
        setSolverState((prev) => ({
          ...prev,
          currentStep: computerStepIndex + 1,
        }));

        computerMoveTimerRef.current = null;
      }, COMPUTER_MOVE_DELAY_MS);
    },
    [clearComputerMoveTimer]
  );

  /**
   * 偏離已知正解線時的處理：先本地判斷合法性/是否已經將死（免費），
   * 都沒有結果才呼叫 /api/puzzle/judge-move 讓引擎判斷。
   */
  const handleDeviatedMove = useCallback(
    async (moveNotation: string) => {
      if (!engine) {
        commitWrongAnswer("引擎還沒準備好，這步先不算數，再試一次！");
        return;
      }

      const currentFen = confirmedFenRef.current;
      const currentSide = sideToMoveAtPly(solverState.currentStep);

      if (!engine.isLegalMove(currentFen, currentSide, moveNotation)) {
        commitWrongAnswer("這步不是合法的走法喔");
        return;
      }

      const afterStudent = engine.applyMove(currentFen, currentSide, moveNotation);
      const statusAfterStudent = engine.getGameStatus(afterStudent.fen, afterStudent.sideToMove);
      const studentWinsIfOver =
        statusAfterStudent.isGameOver &&
        ((currentSide === "w" && statusAfterStudent.result === "red_wins") ||
          (currentSide === "b" && statusAfterStudent.result === "black_wins"));

      if (statusAfterStudent.isGameOver) {
        if (studentWinsIfOver) {
          // 學生這步就已經直接將死對方了，免呼叫引擎，直接過關
          confirmedFenRef.current = afterStudent.fen;
          setCurrentBoard(parseFen(afterStudent.fen));
          setIsDeviatedMode(true);
          setLastErrorMessage(null);
          setSolverState((prev) => ({
            ...prev,
            currentStep: prev.currentStep + 1,
            isCompleted: true,
            consecutiveWrongCount: 0,
          }));
          grantSolveReward();
        } else {
          // 把自己走進和局/困斃，不算數
          commitWrongAnswer("這步會讓對方無路可走但沒有將死（困斃/和棋），不算解出喔");
        }
        return;
      }

      const pliesUsedIncludingThisMove = solverState.currentStep + 1;
      const remainingPlies = moveBudget - pliesUsedIncludingThisMove;

      if (remainingPlies <= 0) {
        commitWrongAnswer(`已經用完 ${moveBudget} 步的步數限制了`);
        return;
      }

      setIsJudging(true);
      try {
        const res = await fetch("/api/puzzle/judge-move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fen: afterStudent.fen,
            sideToMove: afterStudent.sideToMove,
            remainingPlies,
          }),
        });

        if (!res.ok) {
          throw new Error(`判斷失敗（HTTP ${res.status}）`);
        }
        const data = (await res.json()) as { accepted: boolean; opponentMove?: string };

        if (!data.accepted || !data.opponentMove) {
          commitWrongAnswer("這步讓必勝的機會流失掉了，再想想看！");
          return;
        }

        const afterOpponent = engine.applyMove(afterStudent.fen, afterStudent.sideToMove, data.opponentMove);
        const boardAfterOpponent = parseFen(afterOpponent.fen);

        setIsDeviatedMode(true);
        setLastErrorMessage(null);
        clearComputerMoveTimer();
        computerMoveTimerRef.current = setTimeout(() => {
          confirmedFenRef.current = afterOpponent.fen;
          setCurrentBoard(boardAfterOpponent);
          setSolverState((prev) => ({
            ...prev,
            currentStep: prev.currentStep + 2,
            consecutiveWrongCount: 0,
          }));
          computerMoveTimerRef.current = null;
        }, COMPUTER_MOVE_DELAY_MS);
      } catch (error) {
        console.error("[usePuzzleSolver] 偏離正解線判斷失敗：", error);
        // 判斷失敗（網路/伺服器問題）不該讓學生揹黑鍋算答錯，只顯示
        // 錯誤訊息、不重置棋盤、不累計連續答錯，讓他們可以再試一次。
        setLastErrorMessage("判斷這步時發生問題，請稍後再試一次。");
      } finally {
        setIsJudging(false);
      }
    },
    [engine, solverState.currentStep, sideToMoveAtPly, moveBudget, commitWrongAnswer, grantSolveReward, clearComputerMoveTimer]
  );

  /**
   * 核心處理函式：接收學生輸入的走法記號，執行比對與後續邏輯。
   */
  const handleStudentMove = useCallback(
    (moveNotation: string) => {
      // 已過關、正在等引擎判斷、或電腦回應步還沒播完，都先不接受輸入
      if (solverState.isCompleted || isJudging) {
        return;
      }

      clearComputerMoveTimer();

      // 已經進入偏離模式：不用再比對已知正解線，直接走引擎判斷路線
      if (isDeviatedMode) {
        handleDeviatedMove(moveNotation);
        return;
      }

      const matchingLineIndices = activeLineIndices.filter((lineIndex) =>
        isMoveMatchingExpected(moveNotation, allLines[lineIndex][solverState.currentStep])
      );

      // ---- 符合已知正解線（免費比對） ----
      if (matchingLineIndices.length > 0) {
        setLastErrorMessage(null);
        setActiveLineIndices(matchingLineIndices);

        const { board: boardAfterMove } = applyMoveNotation(currentBoard, moveNotation);
        confirmedFenRef.current = toFen(boardAfterMove);
        setCurrentBoard(boardAfterMove);

        const nextStepIndex = solverState.currentStep + 1;
        const isLastStep = matchingLineIndices.some(
          (lineIndex) => nextStepIndex >= allLines[lineIndex].length
        );

        if (isLastStep) {
          setSolverState((prev) => ({
            ...prev,
            currentStep: nextStepIndex,
            isCompleted: true,
            consecutiveWrongCount: 0,
          }));
          grantSolveReward();
        } else {
          setSolverState((prev) => ({
            ...prev,
            currentStep: nextStepIndex,
            consecutiveWrongCount: 0,
          }));
          const responseLine = allLines[matchingLineIndices[0]];
          scheduleComputerMove(boardAfterMove, nextStepIndex, responseLine[nextStepIndex]);
        }
        return;
      }

      // ---- 偏離所有已知正解線：不直接判錯，改讓引擎判斷這步是否仍然算數 ----
      handleDeviatedMove(moveNotation);
    },
    [
      solverState,
      currentBoard,
      activeLineIndices,
      allLines,
      isDeviatedMode,
      isJudging,
      clearComputerMoveTimer,
      grantSolveReward,
      scheduleComputerMove,
      handleDeviatedMove,
    ]
  );

  return {
    currentBoard,
    solverState,
    handleStudentMove,
    lastErrorMessage,
    rewardOutcome,
    leadLine,
    isDeviatedMode,
    isJudging,
    moveBudget,
  };
}
