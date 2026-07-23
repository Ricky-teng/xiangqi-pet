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
 *   - 電腦的回應步、棋盤重播（rebuildBoardAtStep）都改成使用
 *     「目前還存活的線之中，第一條」（leadLine）作為依據，因為這些
 *     操作需要「一條明確的線」才能決定下一步是什麼，而存活的線
 *     到目前為止的走法都是一致的（只是接下來可能分岔），所以選哪條
 *     當 leadLine 在「目前」這一步都是等價的。
 *   - 出題老師要確保「替代線」跟主線在分岔之前的走法是逐字一致的
 *     （包含電腦回應步），這樣系統才能正確判斷「目前還跟得上哪幾條」。
 *     如果替代線整條從第一步就跟主線不同，也完全沒問題——這正是
 *     「同一個起手，不同的獲勝路徑」這種情境的標準用法。
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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, increment, setDoc, updateDoc } from "firebase/firestore";
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
  /** 目前解題進度狀態 */
  solverState: SolverState;
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
  /**
   * 目前「還跟得上」的正解線之中，排在最前面的那一條完整走法陣列。
   * 用途：給 puzzle/[id]/page.tsx 的提示功能讀
   * leadLine[solverState.currentStep] 顯示下一步提示，
   * 不直接寫 puzzle.moves（因為學生可能正走在某條替代線上，
   * puzzle.moves 不一定是目前適用的線）。
   */
  leadLine: string[];
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

  // ---- 多組正解線：合併主線 + 替代線 ----
  // puzzle.alternativeLines 每一條是 { moves: string[] }（不是直接的
  // string[][]），因為 Firestore 不支援巢狀陣列，所以存檔時把每條線
  // 包進一個物件——這裡讀取時要解開 .moves 還原成單純的 string[][]
  // 供後面的比對邏輯使用。
  const allLines = useMemo<string[][]>(
    () => [puzzle.moves, ...(puzzle.alternativeLines ?? []).map((line) => line.moves)],
    [puzzle.moves, puzzle.alternativeLines]
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

  // 目前「還跟得上」的正解線索引（每答對一步，會收斂成「真的符合這一步」的那些線）。
  // 惰性初始化成全部線都還存活，puzzle 變了（換題）的話整個 Hook 會重新掛載
  // （見 puzzle 頁面的 key remount 設計），不需要額外處理 puzzle 換了但這個
  // state 沒重置的情況。
  const [activeLineIndices, setActiveLineIndices] = useState<number[]>(() =>
    allLines.map((_, index) => index)
  );

  // 目前還存活的線之中，排在最前面那一條，作為「電腦回應步」「棋盤重播」
  // 「提示」共用的依據（理由見檔案頂部說明）。
  const leadLine = allLines[activeLineIndices[0] ?? 0] ?? puzzle.moves;

  // 修正：之前這裡會在小雞生病/死亡時把整個棋盤鎖住、不准繼續解題。
  // 但飼料主要就是靠解題賺來的，生病/死亡卻不能解題，等於「治病要錢、
  // 但生病了又賺不到錢」的死循環，不合理。現在小雞的健康狀態只會
  // 顯示在畫面上（PuzzleHeader 的狀態徽章）提醒學生記得回去照顧牠，
  // 不會再阻擋解題本身。連續答錯 3 次仍然會觸發生病（保留這個機制
  // 帶來的提醒作用），但不會鎖棋盤，學生可以馬上繼續嘗試。

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
  // 答對時再額外 +1 totalSolved，這樣 totalSolved/totalAttempts 才是真正的通過率
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
  }, [puzzle.id]); // puzzle.id 換了就是換題，重新計一次

  /**
   * 將棋盤重置為「目前正解進度」對應的正確盤面。
   * 作法：從題目初始 FEN 重新解析，再依序重播 [0, stepIndex) 的正解走法。
   * 這樣無論學生中途亂走了什麼步，都能精準復原，不會有狀態漂移風險。
   */
  const rebuildBoardAtStep = useCallback(
    (stepIndex: number): BoardGrid => {
      let board = parseFen(puzzle.initialFen);
      for (let i = 0; i < stepIndex; i++) {
        const notation = leadLine[i];
        board = applyMoveNotation(board, notation).board;
      }
      return board;
    },
    [puzzle.initialFen, leadLine]
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
      // 原本這裡有「已解過就不發飼料」的防刷 check，改成每次解完都給飼料：
      // /puzzle 頁面已改成「選等級隨機出題」，學生每次進來都是隨機抽題，
      // 不像以前能在題目列表直接挑一道「最簡單且之前做過」的題反覆刷，
      // 隨機選題的機制本身就已經大幅降低有意刷題的可能性，不需要在這裡
      // 再擋一層。solvedPuzzles 子集合這裡還是繼續寫入（updateDoc 不會
      // 重複 increment 只是因為 setDoc 有 merge），讓老師後台的解題紀錄
      // 還是能正確統計（每次解題都有一筆記錄，老師看得到練習頻率）。
      // 但用 puzzle.id 作為文件 ID 代表同一題只會有一筆記錄，若要每次都
      // 記錄可考慮之後改成用 timestamp 當 ID，目前先維持現有資料結構。

      const baseFood = calculateFoodReward(user.chessLevel, puzzle.level);
      // 雙倍飼料券：檢查 doubleRewardExpiry 是否還在有效期內
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

      // 先寫 Firestore（防刷記錄 + 原子 increment 更新 user 文件），
      // 確認真的成功落地之後，才更新本地 store，避免「畫面顯示拿到了，
      // 但 Firestore 其實沒寫成功」這種畫面與資料庫不一致的情況。
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

  /**
   * 安排電腦自動回應步：延遲 COMPUTER_MOVE_DELAY_MS 後，
   * 自動執行正解序列中下一步（電腦方），並將 currentStep 再推進 1 步。
   *
   * @param boardAfterStudentMove 學生剛才那一步走完後的棋盤狀態
   * @param computerStepIndex 電腦這一步在 puzzle.moves 中的索引
   */
  const scheduleComputerMove = useCallback(
    (boardAfterStudentMove: BoardGrid, computerStepIndex: number, computerNotation: string) => {
      clearComputerMoveTimer();

      computerMoveTimerRef.current = setTimeout(() => {
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
    [clearComputerMoveTimer]
  );

  /**
   * 核心處理函式：接收學生輸入的走法記號，執行比對與後續邏輯。
   */
  const handleStudentMove = useCallback(
    (moveNotation: string) => {
      // 已過關，不再接受任何走法輸入（生病/死亡不再是阻擋條件，理由見上方說明）
      if (solverState.isCompleted) {
        return;
      }

      // 學生再次出手前，先清除任何尚未觸發的電腦回應步計時器，
      // 避免「學生在電腦思考期間又走了一步」造成的狀態錯亂
      clearComputerMoveTimer();

      const matchingLineIndices = activeLineIndices.filter((lineIndex) =>
        isMoveMatchingExpected(moveNotation, allLines[lineIndex][solverState.currentStep])
      );

      // ---- 答對（至少有一條還存活的線，這一步的記號跟學生走的相符） ----
      if (matchingLineIndices.length > 0) {
        setLastErrorMessage(null);
        setActiveLineIndices(matchingLineIndices);

        const { board: boardAfterMove } = applyMoveNotation(currentBoard, moveNotation);
        setCurrentBoard(boardAfterMove);

        const nextStepIndex = solverState.currentStep + 1;
        // 修正：只要「目前還跟得上的線之中，任何一條」在這一步剛好走完，
        // 就視為解完——不能只看排第一的那條線的長度。否則學生選了一條
        // 比較短的替代解法、剛好把它走完，但主線恰好排第一且比較長，
        // 會誤判成「還沒解完」，逼學生硬是把主線多餘的步數也走完。
        const isLastStep = matchingLineIndices.some(
          (lineIndex) => nextStepIndex >= allLines[lineIndex].length
        );

        if (isLastStep) {
          // 學生這一步就是（其中一條）正解序列的最後一步，整題解完
          setSolverState((prev) => ({
            ...prev,
            currentStep: nextStepIndex,
            isCompleted: true,
            consecutiveWrongCount: 0,
          }));
          grantSolveReward();
        } else {
          // 後面還有電腦的回應步，先把進度推進到「電腦步」的索引，
          // 並安排 500ms 後自動播放電腦走法。
          // 用「剛剛算出來的 matchingLineIndices」直接查出這一步該怎麼回應，
          // 不依賴 leadLine 這個閉包變數（它可能還是上一次 render 的舊值，
          // 如果這一步剛好讓排第一的線換成別的線，會抓到錯誤的回應步）。
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

      // ---- 答錯 ----
      const newWrongCount = solverState.consecutiveWrongCount + 1;
      const newTotalWrongAttempts = solverState.totalWrongAttempts + 1;

      // 連續答錯達上限：觸發小雞生病（提醒學生記得回主頁買藥照顧牠），
      // 但不再鎖定棋盤——飼料主要靠解題賺來，生病/死亡卻不能解題會造成
      // 「治病要飼料、生病又賺不到飼料」的死循環，不合理（理由見檔案
      // 上方說明）。觸發生病之後，跟未達上限時一樣重置棋盤、讓學生可以
      // 馬上繼續嘗試，並把 consecutiveWrongCount 歸零重新開始算
      // （生病的提醒已經觸發過了，不需要繼續累加同一輪的計數）。
      const justTriggeredSickness = newWrongCount >= MAX_CONSECUTIVE_WRONG;
      if (justTriggeredSickness) {
        // 修正：triggerSickness 直接接收 puzzleId/wrongCount，在 store 裡
        // 一次性原子更新 healthStatus + currentWrongPuzzleId + consecutiveWrongCount，
        // 不再額外呼叫 setPet（之前那個額外呼叫會用「呼叫前」捕捉到的舊 pet
        // 物件覆蓋掉剛設好的生病狀態，導致主頁畫面一直顯示「健康」）。
        triggerSickness(puzzle.id, newWrongCount);
      }

      const resetBoard = rebuildBoardAtStep(solverState.currentStep);
      setCurrentBoard(resetBoard);
      setSolverState((prev) => ({
        ...prev,
        consecutiveWrongCount: justTriggeredSickness ? 0 : newWrongCount,
        totalWrongAttempts: newTotalWrongAttempts,
      }));
      setLastErrorMessage(
        justTriggeredSickness
          ? `已連續答錯 ${MAX_CONSECUTIVE_WRONG} 次，小雞生病了！記得有空回主頁買藥水照顧牠，現在可以繼續練習。`
          : `這步不對喔，再想想看！（已連續答錯 ${newWrongCount} 次，連續答錯 ${MAX_CONSECUTIVE_WRONG} 次小雞會生病）`
      );

      if (pet && !justTriggeredSickness) {
        // justTriggeredSickness 的情況下，triggerSickness 已經把
        // currentWrongPuzzleId/consecutiveWrongCount 一起寫進 pet 了，
        // 這裡不需要、也不應該再 setPet 一次（避免跟之前一樣的競態覆蓋問題）。
        setPet({
          ...pet,
          currentWrongPuzzleId: puzzle.id,
          consecutiveWrongCount: newWrongCount,
        });
      }
    },
    [
      solverState,
      currentBoard,
      activeLineIndices,
      allLines,
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
    solverState,
    handleStudentMove,
    lastErrorMessage,
    rewardOutcome,
    leadLine,
  };
}
