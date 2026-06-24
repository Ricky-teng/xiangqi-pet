/**
 * src/hooks/usePuzzleSolver.ts
 *
 * 學生端解題核心 Hook
 * ------------------------------------------------------------
 * 職責：
 *   1. 維護「目前棋盤狀態」與「解題進度狀態」這兩份本地（元件層級）狀態。
 *   2. 比對學生走法是否與正解序列當前步相符（呼叫 lib/xiangqi/move.ts）。
 *   3. 答對：推進進度、播放電腦回應步（若有）、解題完成時計算並發放飼料獎勵。
 *   4. 答錯：累計連續答錯次數；達 3 次時觸發小雞生病並鎖定棋盤；
 *      未達 3 次則將棋盤重置回「目前正確進度」對應的盤面，讓學生重新嘗試。
 *
 * 重要設計說明：
 *   - 「重置棋盤」採用「從 initialFen 重新解析、重播 [0, currentStep) 步」的方式，
 *     而非嘗試撤銷單步操作。這樣無論學生中途亂走了什麼，都能精準復原到
 *     「正解序列當前進度」對應的正確盤面，不會有狀態漂移風險。
 *   - 解題成功的飼料獎勵只更新 user.foodCount，不直接更動 pet.xp。
 *     小雞 XP 的累積仍透過「立即餵食」（store 的 feedPet）消耗飼料取得，
 *     避免飼料與 XP 兩套經濟系統互相打架、定義不一致。
 *   - 電腦自動回應步使用 setTimeout 延遲 500ms 執行，並在 Hook 卸載或
 *     下一次走法觸發前清除先前的計時器，避免 race condition（計時器
 *     觸發時更新一個已經不存在或已經被覆蓋的狀態）。
 *   - 本 Hook 不驗證走法是否「合法象棋走法」，只負責「逐字比對是否等於
 *     正解序列當前步」，完全對應需求書的解題策略（rules.ts 留待未來）。
 *
 *   - 【防刷修正】解題獎勵現在會先查詢 Firestore 的
 *     users/{uid}/solvedPuzzles/{puzzleId} 防刷記錄：若該題目該使用者
 *     已經解過，這次就不會再發放飼料（避免同一題反覆進出無限刷飼料），
 *     只有「第一次」解開某題才會真的拿到獎勵，並把獎勵結果（granted /
 *     already_claimed / error）透過 rewardOutcome 回傳給呼叫端的 UI，
 *     讓畫面能分別顯示「獲得 X 飼料」或「這題你已經解過了」。
 *     同時 user.foodCount／統計數字的更新現在會「同步寫回 Firestore」
 *     （用 increment() 做原子加總），不再只停留在本地 Zustand store，
 *     重新整理頁面後飼料數量不會跑掉。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { doc, getDoc, increment, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import type { PuzzleDoc, SolvedPuzzleRecord } from "@/types/database";
import type { BoardGrid, SolverState } from "@/types/xiangqi";
import { parseFen } from "@/lib/xiangqi/fen";
import { applyMoveNotation, isMoveMatchingExpected } from "@/lib/xiangqi/move";

// ============================================================
// 1. 常數設定
// ============================================================

/** 同一題連續答錯達此次數時，立刻觸發小雞生病並鎖定棋盤 */
const MAX_CONSECUTIVE_WRONG = 3;

/** 答對後，等待電腦自動回應步的延遲時間（毫秒） */
const COMPUTER_MOVE_DELAY_MS = 500;

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
  /** 目前解題進度狀態（含 isLocked：是否因生病鎖定棋盤） */
  solverState: SolverState & { isLocked: boolean };
  /** 學生走一步棋的處理函式，傳入四字元走法記號（例如 "h2e2"） */
  handleStudentMove: (moveNotation: string) => void;
  /** 最近一次答錯/生病提示訊息（答對或尚未作答時為 null），供 UI 顯示提示用 */
  lastErrorMessage: string | null;
  /**
   * 解題完成後的獎勵結算狀態（尚未解完時為 null）。
   * "granted" 代表這是第一次解開這題、真的拿到飼料；
   * "already_claimed" 代表這題之前已經解過，這次不會重複發放。
   */
  rewardOutcome: RewardOutcome | null;
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

  // ---- 本地狀態：目前棋盤、解題進度 ----
  const [currentBoard, setCurrentBoard] = useState<BoardGrid>(() => parseFen(puzzle.initialFen));
  const [solverState, setSolverState] = useState<SolverState>({
      currentStep: 0,
      isCompleted: false,
      consecutiveWrongCount: 0,
      hintUsed: false,
      totalWrongAttempts: 0,
    });
    
    // 🎯 1. 先宣告衍生狀態
  const isLocked = pet?.healthStatus === "slightly_sick" || 
                   pet?.healthStatus === "severely_sick" || 
                   pet?.healthStatus === "dead";

  // 🎯 2. 用 useRef 記住「上一次 Render 的鎖定狀態」
  const prevIsLockedRef = useRef(isLocked);

  // 🎯 3. 精準捕捉「由鎖定轉為解鎖」的動態瞬間
  useEffect(() => {
    // 唯有【上一次是鎖定（true）】且【這一次解鎖了（false）】，才代表剛剛吃了藥治好
    if (prevIsLockedRef.current && !isLocked) {
      setSolverState((prev) => ({
        ...prev,
        consecutiveWrongCount: 0, // 治好後精準歸零
      }));
    }
    
    // 每次 Render 結束後，同步更新 Ref 的值，留給下一次比對
    prevIsLockedRef.current = isLocked;
  }, [isLocked]);
  
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

  /**
   * 將棋盤重置為「目前正解進度」對應的正確盤面。
   * 作法：從題目初始 FEN 重新解析，再依序重播 [0, stepIndex) 的正解走法。
   * 這樣無論學生中途亂走了什麼步，都能精準復原，不會有狀態漂移風險。
   */
  const rebuildBoardAtStep = useCallback(
    (stepIndex: number): BoardGrid => {
      let board = parseFen(puzzle.initialFen);
      for (let i = 0; i < stepIndex; i++) {
        const notation = puzzle.moves[i];
        board = applyMoveNotation(board, notation).board;
      }
      return board;
    },
    [puzzle.initialFen, puzzle.moves]
  );

  /**
   * 解題完成時的獎勵結算。
   * ------------------------------------------------------------
   * 1. 先查 users/{uid}/solvedPuzzles/{puzzleId} 防刷記錄：
   *    - 已存在 -> 這題之前解過了，不發放新的飼料獎勵
   *      （rewardOutcome 設為 "already_claimed"）。
   *    - 不存在 -> 第一次解開，依動態飼料公式計算 earnedFood，
   *      寫入防刷記錄 + 用 increment() 原子更新 Firestore 上的
   *      user.foodCount／stats，同時同步更新本地 store
   *      （rewardOutcome 設為 "granted"）。
   * 2. 不論是否拿到新獎勵，pet 的連續答錯計數都會歸零
   *    （因為這題目前已經被正確解開了）。
   *
   * 設為 async：因為要等 Firestore 的 getDoc/setDoc/updateDoc 完成，
   * 呼叫端（handleStudentMove）不會、也不需要 await 它——UI 上
   * isCompleted 會立刻變 true，rewardOutcome 則是稍後才補上結果，
   * 這段時間 UI 會先顯示「pending」（結算中）的過渡文字。
   */
  const grantSolveReward = useCallback(async () => {
    if (!user) {
      setRewardOutcome({ status: "error", message: "找不到目前登入的使用者資料。" });
      return;
    }

    setRewardOutcome({ status: "pending" });

    const solvedRecordRef = doc(db, "users", user.uid, "solvedPuzzles", puzzle.id);

    try {
      const existingRecord = await getDoc(solvedRecordRef);

      if (existingRecord.exists()) {
        // 防刷：這題這個使用者已經解過了，不重複發放飼料
        setRewardOutcome({ status: "already_claimed" });

        if (pet) {
          setPet({
            ...pet,
            consecutiveWrongCount: 0,
            currentWrongPuzzleId: null,
          });
        }
        return;
      }

      const earnedFood = calculateFoodReward(user.chessLevel, puzzle.level);
      const now = Date.now();

      const solvedRecord: SolvedPuzzleRecord = {
        puzzleId: puzzle.id,
        solvedAt: now,
        puzzleLevelAtSolve: puzzle.level,
        userLevelAtSolve: user.chessLevel,
        earnedFood,
        wrongAttemptsBeforeSolving: solverState.totalWrongAttempts,
      };

      // 先寫 Firestore（防刷記錄 + 原子 increment 更新 user 文件），
      // 確認真的成功落地之後，才更新本地 store，避免「畫面顯示拿到了，
      // 但 Firestore 其實沒寫成功」這種畫面與資料庫不一致的情況。
      await Promise.all([
        setDoc(solvedRecordRef, solvedRecord),
        updateDoc(doc(db, "users", user.uid), {
          foodCount: increment(earnedFood),
          "stats.totalSolved": increment(1),
          "stats.totalAttempts": increment(1),
          updatedAt: now,
        }),
      ]);

      setUser({
        ...user,
        foodCount: user.foodCount + earnedFood,
        stats: {
          ...user.stats,
          totalSolved: user.stats.totalSolved + 1,
          totalAttempts: user.stats.totalAttempts + 1,
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

  /**
   * 安排電腦自動回應步：延遲 COMPUTER_MOVE_DELAY_MS 後，
   * 自動執行正解序列中下一步（電腦方），並將 currentStep 再推進 1 步。
   *
   * @param boardAfterStudentMove 學生剛才那一步走完後的棋盤狀態
   * @param computerStepIndex 電腦這一步在 puzzle.moves 中的索引
   */
  const scheduleComputerMove = useCallback(
    (boardAfterStudentMove: BoardGrid, computerStepIndex: number) => {
      clearComputerMoveTimer();

      computerMoveTimerRef.current = setTimeout(() => {
        const computerNotation = puzzle.moves[computerStepIndex];
        const { board: boardAfterComputerMove } = applyMoveNotation(
          boardAfterStudentMove,
          computerNotation
        );

        setCurrentBoard(boardAfterComputerMove);
        setSolverState((prev) => ({
          ...prev,
          currentStep: computerStepIndex + 1,
        }));

        computerMoveTimerRef.current = null;
      }, COMPUTER_MOVE_DELAY_MS);
    },
    [puzzle.moves, clearComputerMoveTimer]
  );

  /**
   * 核心處理函式：接收學生輸入的走法記號，執行比對與後續邏輯。
   */
  const handleStudentMove = useCallback(
    (moveNotation: string) => {
      // 棋盤已鎖定（生病中）或已過關，不再接受任何走法輸入
      if (isLocked || solverState.isCompleted) {
        return;
      }

      // 學生再次出手前，先清除任何尚未觸發的電腦回應步計時器，
      // 避免「學生在電腦思考期間又走了一步」造成的狀態錯亂
      clearComputerMoveTimer();

      const expectedNotation = puzzle.moves[solverState.currentStep];

      // ---- 答對 ----
      if (isMoveMatchingExpected(moveNotation, expectedNotation)) {
        setLastErrorMessage(null);

        const { board: boardAfterMove } = applyMoveNotation(currentBoard, moveNotation);
        setCurrentBoard(boardAfterMove);

        const nextStepIndex = solverState.currentStep + 1;
        const isLastStep = nextStepIndex >= puzzle.moves.length;

        if (isLastStep) {
          // 學生這一步就是正解序列的最後一步，整題解完
          setSolverState((prev) => ({
            ...prev,
            currentStep: nextStepIndex,
            isCompleted: true,
            consecutiveWrongCount: 0,
          }));
          grantSolveReward();
        } else {
          // 後面還有電腦的回應步，先把進度推進到「電腦步」的索引，
          // 並安排 500ms 後自動播放電腦走法
          setSolverState((prev) => ({
            ...prev,
            currentStep: nextStepIndex,
            consecutiveWrongCount: 0,
          }));
          scheduleComputerMove(boardAfterMove, nextStepIndex);
        }
        return;
      }

      // ---- 答錯 ----
      const newWrongCount = solverState.consecutiveWrongCount + 1;
      const newTotalWrongAttempts = solverState.totalWrongAttempts + 1;

      if (newWrongCount >= MAX_CONSECUTIVE_WRONG) {
        // 連續答錯達上限：觸發小雞生病、鎖定棋盤，交由 UI 層導回主頁
        setSolverState((prev) => ({
          ...prev,
          consecutiveWrongCount: newWrongCount,
          totalWrongAttempts: newTotalWrongAttempts,
        }));
        setLastErrorMessage(
          `已連續答錯 ${MAX_CONSECUTIVE_WRONG} 次，小雞生病了！請先回到主頁照顧牠。`
        );
        // 修正：triggerSickness 現在直接接收 puzzleId/wrongCount，在 store 裡
        // 一次性原子更新 healthStatus + currentWrongPuzzleId + consecutiveWrongCount，
        // 不再額外呼叫 setPet（之前那個額外呼叫會用「呼叫前」捕捉到的舊 pet
        // 物件覆蓋掉剛設好的生病狀態，導致主頁畫面一直顯示「健康」）。
        triggerSickness(puzzle.id, newWrongCount);
        return;
      }

      // 未達上限：重置棋盤回到目前正確進度對應的盤面，讓學生重新嘗試
      const resetBoard = rebuildBoardAtStep(solverState.currentStep);
      setCurrentBoard(resetBoard);
      setSolverState((prev) => ({
        ...prev,
        consecutiveWrongCount: newWrongCount,
        totalWrongAttempts: newTotalWrongAttempts,
      }));
      setLastErrorMessage(
        `這步不對喔，再想想看！（已連續答錯 ${newWrongCount} 次，連續答錯 ${MAX_CONSECUTIVE_WRONG} 次小雞會生病）`
      );

      if (pet) {
        setPet({
          ...pet,
          currentWrongPuzzleId: puzzle.id,
          consecutiveWrongCount: newWrongCount,
        });
      }
    },
    [
      isLocked,
      solverState,
      currentBoard,
      puzzle.moves,
      puzzle.id,
      clearComputerMoveTimer,
      grantSolveReward,
      scheduleComputerMove,
      rebuildBoardAtStep,
      triggerSickness,
      pet,
      setPet,
    ]
  );

  return {
    currentBoard,
    solverState: { ...solverState, isLocked },
    handleStudentMove,
    lastErrorMessage,
    rewardOutcome,
  };
}
