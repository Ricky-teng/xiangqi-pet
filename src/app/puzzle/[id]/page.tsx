/**
 * src/app/puzzle/[id]/page.tsx
 *
 * 動態殘局挑戰頁面
 * ------------------------------------------------------------
 * 畫面分為三大區塊（對應需求書 A/B/C 三區）：
 *   (A) 頂部標題與狀態列：關卡名稱、難度、即時金幣/飼料、寵物頭像
 *       與健康狀態（依 pet.healthStatus 顯示對應去背圖片）、返回大廳按鈕。
 *   (B) 中央核心解題區：<ChessBoard /> + 控制面板
 *       （顯示提示／重新開始／目前進度 X/Y 步）。
 *   (C) 底部回饋與互動區：答錯提示、過關慶祝（生病/死亡不會鎖定這個區塊，
 *       小雞的健康狀態只會顯示在 A 區的狀態徽章，提醒學生記得照顧牠，
 *       不會阻擋解題本身——理由見 usePuzzleSolver.ts 檔案頂部說明）。
 *
 * 資料來源：
 *   - 透過 getDoc(doc(db, "puzzles", id)) 從 Firestore 讀取真實 PuzzleDoc，
 *     讀取期間顯示手遊風格的載入動畫；查無此題或讀取失敗時顯示對應提示畫面。
 *   - 玩家／小雞資料一律從 useGameStore 透過獨立 selector 取得
 *     （與 usePuzzleSolver.ts、首頁 page.tsx 的既有風格一致）。
 *     身分驗證已改由 src/hooks/useAuth.ts + <RequireAuth> 處理：
 *     本頁整體包在 <RequireAuth> 裡，未登入會被導向 /login，
 *     不需要在這裡額外判斷登入狀態。
 *
 * 與既有 Hook／元件之間的銜接說明（重要，請先讀過再修改本檔案）：
 *   1. usePuzzleSolver 目前並未對外暴露任何「重置」函式，且其內部棋盤／
 *      進度狀態是用 useState 的「惰性初始值」做法（只在第一次掛載時執行
 *      parseFen(puzzle.initialFen)），puzzle 物件本身換掉並不會自動觸發重置。
 *      因此「重新開始本題」這裡採用 React 的 key remount 技巧：把整個會呼叫
 *      usePuzzleSolver 的子元件包成 <PuzzleSolverSection key={resetSignal} />，
 *      點擊「重新開始」時讓 resetSignal 改變，強制該子樹整個卸載再重新掛載，
 *      所有內部 local state（含棋盤、連續答錯次數、計時器）都會回到初始值。
 *      這是目前在「不更動 usePuzzleSolver.ts 本體」前提下最乾淨的做法；
 *      若未來想要更精緻的重置體驗（例如重置時保留某些統計），
 *      建議直接在 Hook 內新增一個 resetPuzzle() 函式取代這個 key trick。
 *   2. usePuzzleSolver 也沒有「提示」邏輯（SolverState.hintUsed 目前永遠是
 *      false，Hook 內部沒有任何地方會更新它）。本頁面的「顯示提示」純粹是
 *      頁面層級的唯讀功能：直接讀 leadLine[solverState.currentStep]
 *      （leadLine 是 usePuzzleSolver 回傳的「目前還跟得上的正解線中
 *      排第一的那條」，題目若有多條正解線，提示會自動對應到正確的線，
 *      不會、也不需要去更動 Hook 內部
 *      狀態，因此不會影響 Hook 既有的答對/答錯比對邏輯。
 *   3. usePuzzleSolver.ts 的 grantSolveReward 現在已經會做防刷檢查
 *      （查 users/{uid}/solvedPuzzles/{puzzleId}）並同步寫回 Firestore，
 *      Hook 會透過 rewardOutcome 回傳結算結果（granted／already_claimed／
 *      error），本頁直接讀這個欄位顯示對應訊息，不再需要自己用
 *      foodCount 前後差值去反推「賺了多少飼料」。
 *   4. 「顯示提示」現在會扣除飼料（HINT_COST_FOOD，見本檔案常數），
 *      且會同步寫回 Firestore 的 user.foodCount，不是只改本地畫面數字；
 *      同一步重複切換顯示/隱藏不會重複收費。
 */

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { collection, doc, getDoc, getDocs, increment, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { usePuzzleSolver } from "@/hooks/usePuzzleSolver";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { PetCommentary, EMPTY_COMMENTARY_LINES } from "@/components/PetCommentary";
import type { PetCommentaryTrigger } from "@/components/PetCommentary";
import { toChineseNotation } from "@/lib/xiangqi/chineseNotation";
import type { PetHealthStatus, PuzzleDoc } from "@/types/database";
import type { PuzzleLevel } from "@/types/xiangqi";
import { useAppBackground } from "@/lib/useAppBackground";
import { getActiveBoardSkinSrc } from "@/lib/shopItems";

/** 使用一次提示需要扣除的飼料數量 */
const HINT_COST_FOOD = 5;

// ============================================================
// 1. 寵物健康狀態 <-> 去背圖片／中文顯示文字 對照表
// ------------------------------------------------------------
// 注意：對照表的 key 嚴格依照 src/types/database.ts 的 PetHealthStatus
// 定義（"normal" | "slightly_sick" | "severely_sick" | "dead"），
// 而非口頭描述中的 "healthy" / "seriously_sick"，確保與知識庫型別
// 100% 契合，TypeScript 才能在編譯期就檢查出對照表是否漏寫任何狀態。
// ============================================================

const PET_HEALTH_IMAGE: Record<PetHealthStatus, string> = {
  normal: "/image/health.png",
  slightly_sick: "/image/sick.png",
  severely_sick: "/image/serioussick.png",
  dead: "/image/died.png",
};

/** 預設備援圖片：理論上 PET_HEALTH_IMAGE 已經涵蓋所有 PetHealthStatus，
 * 但用一個明確的 fallback 函式取代直接索引，確保不管什麼原因（例如
 * pet 資料在過渡瞬間還沒完全就位）都絕對不會把空字串或 undefined
 * 傳進 next/image 的 src（那樣會讓 Next.js 噴錯：少了必填的 src）。 */
function getPetHealthImageSrc(healthStatus: PetHealthStatus | undefined | null): string {
  if (!healthStatus) return PET_HEALTH_IMAGE.normal;
  return PET_HEALTH_IMAGE[healthStatus] ?? PET_HEALTH_IMAGE.normal;
}

const HEALTH_STATUS_LABEL: Record<PetHealthStatus, string> = {
  normal: "健康",
  slightly_sick: "生小病",
  severely_sick: "生大病",
  dead: "已死亡",
};

// ============================================================
// 2. Firestore 文件 -> PuzzleDoc 轉換（含防呆檢查）
// ------------------------------------------------------------
// 採用「明確檢查 + 詳細錯誤訊息」風格，與 lib/xiangqi/fen.ts、move.ts
// 一致，避免格式不符的髒資料悄悄流入 usePuzzleSolver 而難以除錯
// （例如 moves 裡混入非字串、level 超出 1~10 範圍等）。
// ============================================================

function mapFirestoreDocToPuzzle(puzzleId: string, data: Record<string, unknown>): PuzzleDoc {
  const level = data.level;
  if (typeof level !== "number" || level < 1 || level > 10 || !Number.isInteger(level)) {
    throw new Error(
      `題目資料格式錯誤：level 應為 1~10 的整數，但實際為 "${String(level)}"（題目 ID: ${puzzleId}）。`
    );
  }

  const initialFen = data.initialFen;
  if (typeof initialFen !== "string" || initialFen.length === 0) {
    throw new Error(`題目資料格式錯誤：initialFen 應為非空字串（題目 ID: ${puzzleId}）。`);
  }

  const moves = data.moves;
  if (!Array.isArray(moves) || moves.some((step) => typeof step !== "string")) {
    throw new Error(`題目資料格式錯誤：moves 應為字串陣列（題目 ID: ${puzzleId}）。`);
  }

  // 修正：這個函式是在「多解法」功能存在之前寫的，後來 PuzzleDoc 加了
  // alternativeLines 欄位，但這裡忘了同步更新，導致即使 Firestore 裡
  // 真的存了替代解法，組出來的 PuzzleDoc 物件這個欄位永遠是 undefined，
  // usePuzzleSolver 因此只看得到主線——這正是「只接受其中一種解法」的根因。
  // 格式不對時不直接拋錯（這個欄位本來就是可選的），只記錄警告、當作沒有
  // 替代解法處理，主線仍然可以正常解題。
  const alternativeLines = parseAlternativeLines(data.alternativeLines, puzzleId);

  return {
    id: puzzleId,
    level: level as PuzzleLevel,
    title: typeof data.title === "string" ? data.title : "（未命名題目）",
    description: typeof data.description === "string" ? data.description : "",
    initialFen,
    moves: moves as string[],
    alternativeLines,
    totalSteps: typeof data.totalSteps === "number" ? data.totalSteps : moves.length,
    createdBy: typeof data.createdBy === "string" ? data.createdBy : "unknown",
    isPublished: typeof data.isPublished === "boolean" ? data.isPublished : false,
    createdAt: toEpochMillis(data.createdAt),
    updatedAt: toEpochMillis(data.updatedAt),
  };
}

/**
 * 驗證並解析 Firestore 文件裡的 alternativeLines 欄位。
 * 格式應為 { moves: string[] }[]（每條替代線包一層物件，理由見
 * database.ts 裡 alternativeLines 欄位的註解：Firestore 不支援巢狀陣列）。
 * 沒有這個欄位、或格式不正確時，回傳 undefined（視為沒有替代解法，
 * 不影響主線正常解題），並在格式不正確時記錄警告方便除錯。
 */
function parseAlternativeLines(
  rawValue: unknown,
  puzzleId: string
): { moves: string[] }[] | undefined {
  if (rawValue === undefined) {
    return undefined;
  }

  const isValidShape =
    Array.isArray(rawValue) &&
    rawValue.every(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        Array.isArray((line as { moves?: unknown }).moves) &&
        (line as { moves: unknown[] }).moves.every((step) => typeof step === "string")
    );

  if (!isValidShape) {
    console.warn(
      `[puzzle/[id]] alternativeLines 格式不正確，已忽略替代解法（題目 ID: ${puzzleId}）。`
    );
    return undefined;
  }

  return rawValue as { moves: string[] }[];
}

/**
 * 將 Firestore 可能回傳的時間欄位統一轉換為 epoch ms。
 * 未來「視覺化擺子出題」後台（需求書第八步）若改用 serverTimestamp() 寫入，
 * 欄位型別會變成 Firestore Timestamp 而不是 number，這裡先做好防呆轉換，
 * 避免屆時整題解析失敗。
 */
function toEpochMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value instanceof Timestamp) return value.toMillis();
  return Date.now();
}

// ============================================================
// 3. 資料讀取狀態
// ============================================================

type FetchStatus = "loading" | "success" | "not_found" | "error";

// ============================================================
// 4. 主體頁面元件
// ============================================================

interface PuzzlePageProps {
  /** Next.js 15：動態路由 params 是 Promise，需用 React.use() 解開 */
  params: Promise<{ id: string }>;
  searchParams: Promise<{ level?: string }>;
}

function PuzzleChallengePageContent({ params, searchParams }: PuzzlePageProps) {
  const { id: puzzleId } = use(params);
  const { level: levelParam } = use(searchParams);
  // 從 URL ?level=N 讀出「這一題是從哪個等級選來的」，給「下一題」按鈕用。
  // 沒有帶 level param（例如直接輸入網址）時 levelParam 是 undefined，
  // 這種情況下一題按鈕會回到等級選擇頁讓學生重選。
  const sourceLevel = levelParam ? Number(levelParam) : null;
  const router = useRouter();

  // ---- 從全域狀態總機取出使用者與小雞資料（獨立 selector，避免不必要的重渲染） ----
  const user = useGameStore((s) => s.user);

  const bgStyle = useAppBackground();
  const pet = useGameStore((s) => s.pet);

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("loading");
  const [puzzle, setPuzzle] = useState<PuzzleDoc | null>(null);
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);

  // 用於強制重新掛載 <PuzzleSolverSection>，達成「重新開始本題」效果
  // （理由見檔案頂部說明 1）
  const [resetSignal, setResetSignal] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function fetchPuzzle() {
      setFetchStatus("loading");
      setFetchErrorMessage(null);

      try {
        const snapshot = await getDoc(doc(db, "puzzles", puzzleId));

        if (isCancelled) return;

        if (!snapshot.exists()) {
          setFetchStatus("not_found");
          return;
        }

        const puzzleDoc = mapFirestoreDocToPuzzle(snapshot.id, snapshot.data());
        setPuzzle(puzzleDoc);
        setFetchStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[puzzle/[id]] 讀取題目失敗：", error);
        setFetchErrorMessage(
          error instanceof Error ? error.message : "讀取題目時發生未知錯誤，請稍後再試。"
        );
        setFetchStatus("error");
      }
    }

    fetchPuzzle();

    return () => {
      isCancelled = true;
    };
  }, [puzzleId]);

  function handleBackToLobby() {
    router.push("/");
  }

  // ---- 讀取中 ----
  if (fetchStatus === "loading") {
    return <PuzzleLoadingScreen />;
  }

  // ---- 查無此題 ----
  if (fetchStatus === "not_found") {
    return (
      <PuzzleFetchErrorScreen
        title="找不到這道題目"
        description="這道殘局題目可能已被下架，或連結網址有誤，請回到大廳重新選擇。"
        onBackToLobby={handleBackToLobby}
      />
    );
  }

  // ---- 讀取發生錯誤（網路、權限、資料格式不符等） ----
  if (fetchStatus === "error" || !puzzle) {
    return (
      <PuzzleFetchErrorScreen
        title="題目讀取失敗"
        description={fetchErrorMessage ?? "請檢查網路連線後再試一次。"}
        onBackToLobby={handleBackToLobby}
      />
    );
  }

  // ---- 玩家／小雞資料尚未從全域 Store 載入完成的保護性渲染 ----
  if (!user || !pet) {
    return <PuzzleLoadingScreen />;
  }

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4 md:max-w-3xl">
        {/* ============================================================
            A. 頂部標題與狀態列
           ============================================================ */}
        <PuzzleHeader
          puzzle={puzzle}
          foodCount={user.foodCount}
          healthStatus={pet.healthStatus}
          onBackToLobby={handleBackToLobby}
        />

        {/* ============================================================
            B + C. 中央解題區與底部回饋區
            （key={resetSignal} 是「重新開始」的核心：見檔案頂部說明 1）
           ============================================================ */}
        <PuzzleSolverSection
          key={resetSignal}
          puzzle={puzzle}
          onRequestReset={() => setResetSignal((value) => value + 1)}
          sourceLevel={sourceLevel}
        />
      </div>
    </main>
  );
}

// ============================================================
// 5. A 區：頂部標題與狀態列
// ============================================================

function PuzzleHeader({
  puzzle,
  foodCount,
  healthStatus,
  onBackToLobby,
}: {
  puzzle: PuzzleDoc;
  foodCount: number;
  healthStatus: PetHealthStatus;
  onBackToLobby: () => void;
}) {
  return (
    <header className="mt-4 rounded-3xl bg-white/70 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBackToLobby}
          className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
        >
          <span aria-hidden="true">←</span>
          返回大廳
        </button>

        <div className="flex items-center gap-3 text-sm font-semibold">
          <span className="flex items-center gap-1 text-[#8B5FBF]">
            <span aria-hidden="true">🟪</span>
            <span className="tabular-nums">{foodCount}</span>
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-full border-2 border-[#E8B84B] bg-[#FDF6E8]">
          <Image
            src={getPetHealthImageSrc(healthStatus)}
            alt={`小雞目前狀態：${HEALTH_STATUS_LABEL[healthStatus]}`}
            fill
            sizes="48px"
            className="object-contain p-1"
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* 刻意不顯示 puzzle.title——很多題目標題本身就會洩漏解法
              （例如「馬後炮絕殺」這種標題等於直接告訴學生要用什麼殺法），
              尤其現在 /puzzle 改成隨機出題模式，更不該讓學生事先知道
              這題叫什麼名字。改成只顯示中性、不洩漏任何資訊的等級徽章。 */}
          <p className="text-sm font-bold text-[#1A1A2E]">象棋殘局挑戰</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="rounded-full border border-[#C9962C] bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-2 py-0.5 text-[10px] font-extrabold text-[#5C3D0A]">
              難度 Lv.{puzzle.level}
            </span>
            <span className="text-[11px] font-medium text-[#1A1A2E]/60">
              小雞狀態：{HEALTH_STATUS_LABEL[healthStatus]}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

// ============================================================
// 6. B + C 區：解題互動主體（棋盤、控制面板、回饋訊息）
// ------------------------------------------------------------
// 獨立成子元件的原因：讓「重新開始」可以只重新掛載這一塊
// （內部呼叫 usePuzzleSolver 的部分），而不影響 A 區的頂部狀態列。
// ============================================================

function PuzzleSolverSection({
  puzzle,
  onRequestReset,
  sourceLevel,
}: {
  puzzle: PuzzleDoc;
  onRequestReset: () => void;
  sourceLevel: number | null;
}) {
  const router = useRouter();
  const [isLoadingNext, setIsLoadingNext] = useState(false);
  const [commentaryTrigger, setCommentaryTrigger] = useState<PetCommentaryTrigger>(null);

  async function handleNextPuzzle() {
    if (sourceLevel === null) {
      router.push("/puzzle");
      return;
    }

    setIsLoadingNext(true);
    try {
      const snapshot = await getDocs(
        query(
          collection(db, "puzzles"),
          where("isPublished", "==", true),
          where("level", "==", sourceLevel)
        )
      );

      const ids = snapshot.docs
        .map((d) => d.id)
        .filter((id) => id !== puzzle.id); // 排除剛做完的這題，避免連續抽到同一題

      if (ids.length === 0) {
        // 這個等級只有這一題（或全部都被排除），直接回選等級頁
        router.push("/puzzle");
        return;
      }

      const nextId = ids[Math.floor(Math.random() * ids.length)];
      router.push(`/puzzle/${nextId}?level=${sourceLevel}`);
    } catch (error) {
      console.error("[puzzle] 抽下一題失敗：", error);
      router.push("/puzzle");
    }
  }
  // 獨立 selector，與 usePuzzleSolver.ts / 首頁 page.tsx 風格一致
  const user = useGameStore((s) => s.user);
  const pet = useGameStore((s) => s.pet);
  const setUser = useGameStore((s) => s.setUser);

  const { currentBoard, solverState, handleStudentMove, lastErrorMessage, rewardOutcome, leadLine } =
    usePuzzleSolver(puzzle);

  const [showHint, setShowHint] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  // 記錄「已經付費解鎖提示」的步驟編號：同一步重複切換顯示/隱藏提示不會
  // 重複收費，只有換到一個「還沒付費看過」的新步驟時，才會再扣一次飼料。
  const [hintPurchasedStep, setHintPurchasedStep] = useState<number | null>(null);

  // 進度往前推進時自動收起提示，避免提示停留在「已經走過的舊步驟」誤導學生
  // （不重置 hintPurchasedStep，因為它本來就是跟步驟編號比對，換新步驟自然視為「還沒買」）
  useEffect(() => {
    setShowHint(false);
    setHintError(null);
  }, [solverState.currentStep]);

  // 答對觸發
  useEffect(() => {
    if (solverState.isCompleted) {
      setCommentaryTrigger({ kind: "correct" });
    }
  }, [solverState.isCompleted]);

  // 答錯觸發（lastErrorMessage 每次新的答錯才會換新字串）
  useEffect(() => {
    if (lastErrorMessage) {
      setCommentaryTrigger({ kind: "wrong" });
    }
  }, [lastErrorMessage]);

  // 用 leadLine（目前還跟得上的正解線之中排第一的那條）而不是 puzzle.moves，
  // 因為題目可能有多條正解線，學生可能正走在某條替代線上，這時候
  // puzzle.moves（永遠是主線）不一定是目前該顯示的提示內容。
  const totalSteps = leadLine.length;
  const clampedStep = Math.min(solverState.currentStep, totalSteps);
  const canShowHint = !solverState.isCompleted && clampedStep < totalSteps;
  const hintNotation = canShowHint ? leadLine[solverState.currentStep] : null;
  const hasAlreadyPurchasedThisHint = hintPurchasedStep === solverState.currentStep;

  /**
   * 切換提示顯示/隱藏。第一次在「這一步」顯示提示時，需要扣
   * HINT_COST_FOOD 個飼料（同步寫回 Firestore，不只是本地 store），
   * 之後在同一步重複切換顯示/隱藏不會再收費。
   */
  async function handleToggleHint() {
    if (!canShowHint) return;
    setHintError(null);

    if (showHint) {
      setShowHint(false); // 已顯示中，純粹收起來，不收費
      return;
    }

    if (hasAlreadyPurchasedThisHint) {
      setShowHint(true); // 這一步已經付過費了，重新顯示不再收費
      return;
    }

    if (!user) {
      setHintError("找不到目前登入的使用者資料。");
      return;
    }
    if (user.foodCount < HINT_COST_FOOD) {
      setHintError(`飼料不足，使用提示需要 ${HINT_COST_FOOD} 個飼料。`);
      return;
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        foodCount: increment(-HINT_COST_FOOD),
        totalFoodSpent: increment(HINT_COST_FOOD),
        updatedAt: Date.now(),
      });
      setUser({ ...user, foodCount: user.foodCount - HINT_COST_FOOD, totalFoodSpent: (user.totalFoodSpent ?? 0) + HINT_COST_FOOD });
      setHintPurchasedStep(solverState.currentStep);
      setShowHint(true);
    } catch (error) {
      console.error("[puzzle] 扣除提示飼料失敗：", error);
      setHintError("扣除飼料失敗，請稍後再試。");
    }
  }

  if (!pet) {
    // 理論上不會發生（呼叫端已確認 pet 存在才渲染本元件），
    // 此處僅作為型別安全的防呆，避免 TypeScript 推斷出 null 而報錯。
    return null;
  }

  return (
    <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/* ---- B 區左側／行動端上方：棋盤本體 ---- */}
        <div className="md:flex-1">
          <ChessBoard
            board={currentBoard}
            onMove={handleStudentMove}
            boardSkinSrc={getActiveBoardSkinSrc(user?.activeBoardSkin)}
          />
        </div>

        {/* ---- B 區右側／行動端下方：控制面板 ---- */}
        <div className="flex flex-col gap-3 md:w-56">
          <div className="rounded-2xl bg-white/80 px-4 py-3">
            <div className="mb-1 flex justify-between text-xs font-medium text-[#1A1A2E]/70">
              <span>解題進度</span>
              <span className="tabular-nums">
                {clampedStep}/{totalSteps} 步
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E5DFCB]">
              <div
                className="h-full rounded-full bg-[#5B8C5A] transition-all duration-300"
                style={{
                  width: totalSteps > 0 ? `${(clampedStep / totalSteps) * 100}%` : "0%",
                }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleHint}
            disabled={!canShowHint}
            className={[
"rounded-2xl px-3 py-2 text-sm font-bold shadow-sm transition-transform active:scale-95",
              canShowHint
                ? "bg-[#E8B84B] text-[#1A1A2E]"
                : "cursor-not-allowed bg-[#E5DFCB] text-[#1A1A2E]/40",
            ].join(" ")}
          >
            💡{" "}
            {showHint
              ? "隱藏提示"
              : hasAlreadyPurchasedThisHint
                ? "顯示提示"
                : `顯示提示（-${HINT_COST_FOOD} 飼料）`}
          </button>

          {hintError ? (
            <p className="rounded-2xl bg-[#C0392B]/10 px-3 py-2 text-center text-xs font-medium text-[#C0392B]">
              {hintError}
            </p>
          ) : null}

          {showHint && hintNotation ? (
            <p className="rounded-2xl bg-[#FCE6A0] px-3 py-2 text-center text-xs font-semibold text-[#5C3D0A]">
              提示：{toChineseNotation(currentBoard, hintNotation)}
            </p>
          ) : null}

          {/* 重新開始：只在「還沒解出來」時顯示，解出來後不能重做（防刷） */}
          {!solverState.isCompleted ? (
            <button
              type="button"
              onClick={onRequestReset}
              className="rounded-2xl bg-white px-3 py-2 text-sm font-bold text-[#C0392B] shadow-sm ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
            >
              🔄 重新開始本題
            </button>
          ) : null}
        </div>
      </div>

      {/* 小雞講話 */}
      {pet ? (
        <PetCommentary
          stage={pet.stage}
          healthStatus={pet.healthStatus}
          trigger={commentaryTrigger}
          lines={EMPTY_COMMENTARY_LINES}
        />
      ) : null}

      {/* ============================================================
          C 區：底部回饋與互動區
         ============================================================ */}
      <div className="mt-4">
        {solverState.isCompleted ? (
          <div className="flex flex-col gap-3">
            <p className="rounded-2xl bg-[#5B8C5A]/10 px-4 py-3 text-center text-sm font-bold text-[#5B8C5A]">
              🎉 恭喜過關！
              {rewardOutcome?.status === "granted"
                ? `獲得了 ${rewardOutcome.earnedFood} 個飼料！`
                : rewardOutcome?.status === "error"
                  ? "但結算獎勵時發生錯誤，請稍後查看飼料數量是否有更新。"
                  : "正在結算獎勵…"}
            </p>
            <button
              type="button"
              onClick={handleNextPuzzle}
              disabled={isLoadingNext}
              className="w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:opacity-60"
            >
              {isLoadingNext ? "出題中…" : "➡️ 下一題"}
            </button>
          </div>
        ) : lastErrorMessage ? (
          <p className="rounded-2xl bg-[#C0392B]/10 px-4 py-3 text-center text-sm font-medium text-[#C0392B]">
            {lastErrorMessage}
          </p>
        ) : (
          <p className="text-center text-xs text-[#1A1A2E]/60">
            點擊棋子作為起點，再點擊目標位置完成走棋
          </p>
        )}
      </div>
    </section>
  );
}

// ============================================================
// 7. 載入中畫面（手遊風格、帶有小雞加載動畫感）
// ============================================================

function PuzzleLoadingScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 px-6">
      <style>{`
        @keyframes puzzle-loading-hop {
          0%, 100% { transform: translateY(0) rotate(-4deg); }
          50% { transform: translateY(-10px) rotate(4deg); }
        }
        @keyframes puzzle-loading-shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(280%); }
        }
      `}</style>

      <div className="rounded-full bg-white/70 p-6 shadow-sm">
        <span
          role="img"
          aria-label="正在加載的小雞"
          className="block text-6xl"
          style={{ animation: "puzzle-loading-hop 1s ease-in-out infinite" }}
        >
          🐣
        </span>
      </div>

      <p className="text-sm font-semibold text-[#1A1A2E]/70">小雞正在搬棋盤，請稍候…</p>

      <div className="h-2 w-48 overflow-hidden rounded-full bg-[#E5DFCB]">
        <div
          className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#F6D87A] to-[#E8B84B]"
          style={{ animation: "puzzle-loading-shimmer 1.2s ease-in-out infinite" }}
        />
      </div>
    </main>
  );
}

// ============================================================
// 8. 讀取失敗 / 查無題目畫面
// ============================================================

function PuzzleFetchErrorScreen({
  title,
  description,
  onBackToLobby,
}: {
  title: string;
  description: string;
  onBackToLobby: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <span role="img" aria-label="困惑的小雞" className="text-6xl">
        🐥
      </span>
      <h1 className="text-lg font-bold text-[#1A1A2E]">{title}</h1>
      <p className="max-w-xs text-sm text-[#1A1A2E]/70">{description}</p>
      <button
        type="button"
        onClick={onBackToLobby}
        className="rounded-full bg-[#E8B84B] px-6 py-2 text-sm font-bold text-[#1A1A2E] shadow-md transition-transform active:scale-95"
      >
        返回大廳
      </button>
    </main>
  );
}

// ============================================================
// 9. 預設匯出：包上 RequireAuth 路由守衛
// ------------------------------------------------------------
// 解題頁不限角色（學生／老師都能進來解題），所以不指定 requiredRole。
// ============================================================

export default function PuzzleChallengePage(props: PuzzlePageProps) {
  return (
    <RequireAuth>
      <PuzzleChallengePageContent {...props} />
    </RequireAuth>
  );
}

