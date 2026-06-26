/**
 * src/app/admin/page.tsx
 *
 * 老師視覺化擺子出題後台
 * ------------------------------------------------------------
 * 三大區塊：
 *   (A) 視覺化擺子棋盤：點選棋子置物箱中的圓形棋子按鈕，放到 9x10
 *       棋盤上建構初始盤面；支援清空棋盤、恢復標準開局、貼上 FEN
 *       反向渲染。視覺樣式（棋盤格配色、楚河漢界間距、棋子圓標籤）
 *       對齊學生端 ChessBoard.tsx。
 *   (B) 走法錄製系統：開關一開，棋盤點擊就會被解讀成「走一步」，
 *       依序記錄成正解序列；可清除最後一步或清空全部。
 *   (C) 關卡後設資料與上架：填寫 id / title / description / 難度
 *       （1~10 級，直接對應 PuzzleDoc.level），按下「一鍵上架」直接
 *       用 setDoc 寫入 puzzles/{id}。
 *
 * ------------------------------------------------------------
 * 這一版相對上一版的關鍵改動（請先讀過再修改本檔案）：
 *
 *   1.【支援多條正解線】
 *      同一道殘局有時不只一種能獲勝的走法。B 區現在用「線」的概念
 *      取代單一的 recordedMoves：lines[0] 是主線，lines[1] 之後是
 *      可選的替代解法，每一條都是從同一個 initialBoard 開始的完整
 *      走法陣列。可以用頁籤切換目前在編輯哪一條線，每條線各自獨立
 *      錄製/清除最後一步；發布時主線寫進 PuzzleDoc.moves，其餘的線
 *      寫進 PuzzleDoc.alternativeLines（學生端 usePuzzleSolver.ts
 *      已經改成會同時比對所有線，符合任何一條都算解開）。
 *      棋盤不再用 boardHistory 陣列快取每一步，改成「需要時才從
 *      initialBoard 重播目前選中的線」（見 replayMoves），因為線
 *      可能隨時切換，快取反而容易對不上。
 *
 *   2.【新增「編輯既有題目」功能】
 *      之前「現有題目管理」只能刪除，現在每一題多了「✏️ 編輯」
 *      按鈕，點下去會把該題的初始盤面、所有正解線、後設資料整個
 *      載入回上面的編輯區，關卡 ID 欄位會鎖定（避免不小心改成
 *      建立新文件），發布按鈕文字會變成「💾 更新題目」，且會保留
 *      原本的 createdBy/createdAt，不會被這次編輯覆蓋掉。
 *
 *   3.【棋子置物箱維持圓形帶框按鈕，視覺對齊棋盤上的棋子】
 *      （延續上一版的設計，沒有改動。）
 *
 *   4.【沒有「獎勵金幣」欄位、難度等級維持 1~10 級下拉選單】
 *      （延續上一版的設計，沒有改動。）
 *
 *   5.【不修改既有檔案】
 *      依需求，本頁不匯入也不修改 database.ts、ChessBoard.tsx；
 *      usePuzzleSolver.ts 這次因為要支援多條正解線而調整過比對邏輯，
 *      但那是另一個檔案的修改，本檔案這邊維持「象棋型別與工具函式
 *      直接從既有 lib/types 匯入重用」的原則不變。
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { createStandardStartBoard, parseFen, toFen } from "@/lib/xiangqi/fen";
import { applyMove, applyMoveNotation, formatMoveNotation, formatSquare } from "@/lib/xiangqi/move";
import type {
  BoardGrid,
  Move,
  Piece,
  PieceColor,
  PieceType,
  Position,
  PuzzleLevel,
} from "@/types/xiangqi";
import type { PuzzleDoc } from "@/types/database";

// ============================================================
// 1. 棋子顯示文字對照表
// ------------------------------------------------------------
// 與 ChessBoard.tsx 視覺一致，但獨立宣告一份，因為原檔案中的
// PIECE_LABEL 沒有 export，依需求也不去修改既有檔案。
// ============================================================

const PIECE_LABEL: Record<PieceType, { red: string; black: string }> = {
  k: { red: "帥", black: "將" },
  a: { red: "仕", black: "士" },
  e: { red: "相", black: "象" },
  h: { red: "馬", black: "馬" },
  r: { red: "車", black: "車" },
  c: { red: "炮", black: "炮" },
  p: { red: "兵", black: "卒" },
};

/** 棋子置物箱裡，每一列（紅方／黑方）棋子按鈕的排列順序 */
const PIECE_TYPES_IN_TRAY_ORDER: PieceType[] = ["k", "a", "e", "h", "r", "c", "p"];

/** 難度下拉選單選項：1 級 ~ 10 級，數值直接對應 PuzzleDoc.level */
const LEVEL_OPTIONS: PuzzleLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ============================================================
// 2. 棋子置物箱「工具」型別（擺放某顆棋子 or 橡皮擦移除棋子）
// ============================================================

type TrayTool = { kind: "eraser" } | { kind: "piece"; type: PieceType; color: PieceColor };

function isSameTrayTool(a: TrayTool | null, b: TrayTool): boolean {
  if (!a) return false;
  if (a.kind === "eraser" && b.kind === "eraser") return true;
  if (a.kind === "piece" && b.kind === "piece") {
    return a.type === b.type && a.color === b.color;
  }
  return false;
}

// ============================================================
// 3. 棋盤狀態輔助函式
// ============================================================

/** 建立一個 10x9 全空棋盤（清空棋盤功能用） */
function createEmptyBoard(): BoardGrid {
  return Array.from({ length: 10 }, () => Array<Piece | null>(9).fill(null));
}

/**
 * 從 startBoard 開始，依序套用 moves 陣列的每一步，回傳重播後的棋盤。
 * 多線錄製版本不快取每一步的棋盤（跟上一版的 boardHistory 不同），
 * 因為線可能隨時切換，重播一條短短幾步的象棋殘局走法開銷很小，
 * 用「需要時重播」換取邏輯簡單、不會有快取對不上的風險。
 */
function replayMoves(startBoard: BoardGrid, moves: string[]): BoardGrid {
  let board = startBoard;
  for (const notation of moves) {
    board = applyMoveNotation(board, notation).board;
  }
  return board;
}

// ============================================================
// 4. 共用樣式
// ============================================================

const INPUT_CLASS_NAME =
  "rounded-lg border border-[#A9764C]/40 bg-white px-3 py-2 text-sm text-[#1A1A2E] focus:border-[#E8B84B] focus:outline-none focus:ring-2 focus:ring-[#E8B84B]/40 disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS_NAME =
  "rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1A2E] shadow-sm ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

// ============================================================
// 5. 主體頁面元件
// ============================================================

function AdminPuzzleEditorPageContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  // ---- A 區：初始擺位 ----
  const [initialBoard, setInitialBoard] = useState<BoardGrid>(() => createStandardStartBoard());
  const [selectedTrayTool, setSelectedTrayTool] = useState<TrayTool | null>(null);
  const [fenInputValue, setFenInputValue] = useState("");
  const [fenApplyError, setFenApplyError] = useState<string | null>(null);

  // ---- B 區：走法錄製（支援多條正解線） ----
  // lines[0] 永遠是主線；lines[1] 之後是替代解法。每一條都是獨立的
  // 完整走法陣列，從同一個 initialBoard 開始重播（見 replayMoves）。
  const [isRecording, setIsRecording] = useState(false);
  const [lines, setLines] = useState<string[][]>([[]]);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [selectedFromForRecording, setSelectedFromForRecording] = useState<Position | null>(
    null
  );

  // ---- C 區：表單欄位（已移除獎勵金幣欄位） ----
  const [puzzleId, setPuzzleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<PuzzleLevel>(5);

  // ---- 編輯模式：載入既有題目時記住「正在編輯哪一題」跟它原本的
  // createdBy/createdAt，更新時要保留這兩個欄位、不要被覆蓋成
  // 目前操作者跟現在時間。null 代表目前是「建立新題目」模式。
  const [editingPuzzleId, setEditingPuzzleId] = useState<string | null>(null);
  const [editingOriginalMeta, setEditingOriginalMeta] = useState<{
    createdBy: string;
    createdAt: number;
  } | null>(null);

  // ---- 上架狀態 ----
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 已有任何一條線錄了步驟時，鎖定 A 區的初始擺位編輯（理由見檔案頂部說明）
  const isSetupLocked = lines.some((line) => line.length > 0);

  // 目前畫面該顯示的棋盤：從 initialBoard 重播「目前選中的那一條線」的所有步驟。
  // 多線版本不再用 boardHistory 陣列快取每一步，因為線可能中途切換，
  // 改成「需要時才重播」更簡單、不容易因為切換線而讓快取對不上。
  const liveBoard = replayMoves(initialBoard, lines[activeLineIndex] ?? []);

  // 成功提示 Toast：3 秒後自動消失，不擋住 UI
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  /** 把編輯器整個重置回「建立新題目」的空白狀態 */
  function resetEditorToBlankState() {
    setInitialBoard(createStandardStartBoard());
    setSelectedTrayTool(null);
    setFenInputValue("");
    setFenApplyError(null);
    setIsRecording(false);
    setLines([[]]);
    setActiveLineIndex(0);
    setSelectedFromForRecording(null);
    setPuzzleId("");
    setTitle("");
    setDescription("");
    setLevel(5);
    setEditingPuzzleId(null);
    setEditingOriginalMeta(null);
    setPublishError(null);
  }

  /**
   * 載入一道既有題目進編輯器（從 ExistingPuzzlesSection 的「✏️ 編輯」按鈕呼叫）。
   * 載入後：initialBoard/lines 會立刻讓 isSetupLocked 變 true
   * （因為主線一定有內容），跟「建立新題目時錄完步驟會鎖定」是同一條規則，
   * 不需要為編輯模式另外寫一套鎖定邏輯。
   */
  function handleEditPuzzle(puzzleToEdit: PuzzleDoc) {
    let parsedBoard: BoardGrid;
    try {
      parsedBoard = parseFen(puzzleToEdit.initialFen);
    } catch (error) {
      console.error("[admin] 載入題目的 initialFen 解析失敗：", error);
      setPublishError("這道題目的 initialFen 格式有誤，無法載入編輯。");
      return;
    }

    setInitialBoard(parsedBoard);
    // alternativeLines 存的是 { moves: string[] }[]（每條線包了一層物件，
    // 理由見 database.ts 裡 alternativeLines 欄位的註解：Firestore 不支援
    // 巢狀陣列），這裡要把每個物件的 .moves 取出來，還原成 lines 需要的
    // string[][] 形狀。
    setLines([
      puzzleToEdit.moves,
      ...(puzzleToEdit.alternativeLines ?? []).map((line) => line.moves),
    ]);
    setActiveLineIndex(0);
    setSelectedFromForRecording(null);
    setSelectedTrayTool(null);
    setFenInputValue("");
    setFenApplyError(null);
    setIsRecording(false);

    setPuzzleId(puzzleToEdit.id);
    setTitle(puzzleToEdit.title);
    setDescription(puzzleToEdit.description);
    setLevel(puzzleToEdit.level);

    setEditingPuzzleId(puzzleToEdit.id);
    setEditingOriginalMeta({
      createdBy: puzzleToEdit.createdBy,
      createdAt: puzzleToEdit.createdAt,
    });
    setPublishError(null);

    // 捲到頂部，讓老師立刻看到載入後的編輯區，不用自己往下滑找
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // ============================================================
  // A 區操作
  // ============================================================

  function handleSelectTrayTool(tool: TrayTool) {
    if (isSetupLocked) return;
    setSelectedTrayTool((prev) => (isSameTrayTool(prev, tool) ? null : tool));
  }

  function handleClearBoard() {
    if (isSetupLocked) return;
    setInitialBoard(createEmptyBoard());
    setFenApplyError(null);
  }

  function handleResetToStandardStart() {
    if (isSetupLocked) return;
    setInitialBoard(createStandardStartBoard());
    setFenApplyError(null);
  }

  function handleApplyFenInput() {
    if (isSetupLocked) return;
    setFenApplyError(null);
    try {
      const parsedBoard = parseFen(fenInputValue.trim());
      setInitialBoard(parsedBoard);
    } catch (error) {
      setFenApplyError(error instanceof Error ? error.message : "FEN 解析失敗，請確認格式。");
    }
  }

  // ============================================================
  // 棋盤點擊：依「是否正在錄製」分派成兩種完全不同的語意
  // ============================================================

  function handleBoardCellClick(row: number, col: number) {
    if (isRecording) {
      handleRecordingClick(row, col);
      return;
    }
    if (isSetupLocked) return; // 已有錄製步驟，初始擺位鎖定中
    handlePlacementClick(row, col);
  }

  /** 擺子模式：把目前選中的工具（棋子或橡皮擦）放到點擊的格子上 */
  function handlePlacementClick(row: number, col: number) {
    if (!selectedTrayTool) return;

    setInitialBoard((prev) => {
      const next = prev.map((rowCells) => rowCells.slice());
      next[row][col] =
        selectedTrayTool.kind === "eraser"
          ? null
          : { type: selectedTrayTool.type, color: selectedTrayTool.color };
      return next;
    });
  }

  /** 錄製模式：第一次點擊選起點（必須有棋子），第二次點擊選終點並記錄一步到目前選中的線 */
  function handleRecordingClick(row: number, col: number) {
    if (!selectedFromForRecording) {
      const piece = liveBoard[row]?.[col];
      if (piece) {
        setSelectedFromForRecording({ row, col });
      }
      return;
    }

    const isSameCell =
      selectedFromForRecording.row === row && selectedFromForRecording.col === col;

    if (isSameCell) {
      setSelectedFromForRecording(null); // 點同一格＝取消選取
      return;
    }

    const move: Move = { from: selectedFromForRecording, to: { row, col } };

    try {
      applyMove(liveBoard, move); // 純粹驗證「起點確實有棋子」，盡早攔截異常
      const notation = formatMoveNotation(move);
      setLines((prev) => {
        const next = prev.map((line) => line.slice());
        next[activeLineIndex] = [...next[activeLineIndex], notation];
        return next;
      });
    } catch (error) {
      console.error("[admin] 錄製走法失敗：", error);
    }

    setSelectedFromForRecording(null);
  }

  // ============================================================
  // B 區操作
  // ============================================================

  function handleToggleRecording() {
    setIsRecording((prev) => !prev);
    setSelectedFromForRecording(null);
  }

  function handleClearLastMove() {
    setLines((prev) => {
      const next = prev.map((line) => line.slice());
      next[activeLineIndex] = next[activeLineIndex].slice(0, -1);
      return next;
    });
    setSelectedFromForRecording(null);
  }

  function handleClearAllMoves() {
    setLines([[]]);
    setActiveLineIndex(0);
    setSelectedFromForRecording(null);
  }

  /** 新增一條替代解法：從同一個 initialBoard 開始錄製另一條完整路線 */
  function handleAddAlternativeLine() {
    setLines((prev) => [...prev, []]);
    setActiveLineIndex(lines.length);
    setSelectedFromForRecording(null);
  }

  /** 刪除指定的替代解法（index 0 是主線，不能刪） */
  function handleRemoveLine(indexToRemove: number) {
    if (indexToRemove === 0) return;
    setLines((prev) => prev.filter((_, index) => index !== indexToRemove));
    setActiveLineIndex((prev) => {
      if (prev === indexToRemove) return indexToRemove - 1;
      if (prev > indexToRemove) return prev - 1;
      return prev;
    });
    setSelectedFromForRecording(null);
  }

  function handleSwitchActiveLine(index: number) {
    setActiveLineIndex(index);
    setSelectedFromForRecording(null);
  }

  // ============================================================
  // C 區：一鍵上架
  // ============================================================

  async function handlePublish() {
    setPublishError(null);

    const trimmedId = puzzleId.trim();
    const trimmedTitle = title.trim();
    const mainLine = lines[0];
    // 包成 { moves: [...] }[]，不能直接存 string[][]，理由見
    // database.ts 裡 alternativeLines 欄位的註解（Firestore 不支援巢狀陣列）。
    const alternativeLinesToSave = lines
      .slice(1)
      .filter((line) => line.length > 0)
      .map((line) => ({ moves: line }));

    if (!trimmedId) {
      setPublishError("請輸入關卡 ID。");
      return;
    }
    if (trimmedId.includes("/")) {
      setPublishError("關卡 ID 不可包含「/」符號（Firestore 文件路徑限制）。");
      return;
    }
    if (!trimmedTitle) {
      setPublishError("請輸入關卡名稱。");
      return;
    }
    if (mainLine.length === 0) {
      setPublishError("請先在 B 區的「主線」錄製至少一步正解走法，才能上架題目。");
      return;
    }
    if (!user) {
      setPublishError("找不到目前登入的老師帳號資料，請重新登入後再試。");
      return;
    }

    let fenString: string;
    try {
      fenString = toFen(initialBoard);
    } catch (error) {
      setPublishError(
        error instanceof Error ? `初始棋盤格式錯誤：${error.message}` : "初始棋盤格式錯誤。"
      );
      return;
    }

    const now = Date.now();
    // 編輯既有題目時，保留原本的 createdBy/createdAt，不要被這次操作覆蓋掉；
    // 建立全新題目時，才用目前登入的老師 + 現在時間。
    const createdBy = editingOriginalMeta?.createdBy ?? user.uid;
    const createdAt = editingOriginalMeta?.createdAt ?? now;

    const puzzlePayload: PuzzleDoc = {
      id: trimmedId,
      level,
      title: trimmedTitle,
      description: description.trim(),
      initialFen: fenString,
      moves: mainLine,
      alternativeLines: alternativeLinesToSave,
      totalSteps: mainLine.length,
      createdBy,
      isPublished: true,
      createdAt,
      updatedAt: now,
    };

    setIsPublishing(true);
    try {
      await setDoc(doc(db, "puzzles", trimmedId), puzzlePayload);
      setToastMessage(
        editingPuzzleId
          ? `題目「${trimmedTitle}」已成功更新！`
          : `題目「${trimmedTitle}」已成功上架！`
      );
      if (editingPuzzleId) {
        // 更新成功後，記住「目前編輯的就是這一題」的狀態繼續保留
        // （不強制跳回空白狀態），老師可以繼續微調、或自己按
        // 「➕ 開始新題目」離開編輯模式。
        setEditingOriginalMeta({ createdBy, createdAt });
      }
    } catch (error) {
      console.error("[admin] 發布題目失敗：", error);
      setPublishError(
        error instanceof Error ? `發布失敗：${error.message}` : "發布時發生未知錯誤，請稍後再試。"
      );
    } finally {
      setIsPublishing(false);
    }
  }

  // ============================================================
  // 渲染
  // ============================================================

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-16">
      <div className="mx-auto max-w-6xl px-4 pt-4">
        {/* ---- 頂部標題列 ---- */}
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">🐔 老師視覺化擺子出題後台</h1>
          <button
            type="button"
            onClick={() => router.push("/admin/dashboard")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            📊 學生數據
          </button>
        </header>

        {/* ---- 現有題目管理（issue：老師之前無法刪除題目） ---- */}
        <ExistingPuzzlesSection onEditPuzzle={handleEditPuzzle} />

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* ============================================================
              A 區：視覺化擺子棋盤
             ============================================================ */}
          <section className="rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
            <h2 className="text-sm font-bold text-[#1A1A2E]">♟️ 視覺化擺子棋盤</h2>

            <p className="mt-1 text-xs text-[#1A1A2E]/60">
              {isRecording
                ? "目前模式：錄製中（棋盤點擊會記錄成走法，擺子工具已鎖定）"
                : isSetupLocked
                  ? "目前模式：已暫停錄製（已有錄製步驟，擺子工具鎖定中）"
                  : "目前模式：擺子設定中（從下方棋子置物箱選一顆棋子，再點棋盤格子放置）"}
            </p>

            <div className="mt-3">
              <AdminChessBoard
                board={liveBoard}
                selectedCell={isRecording ? selectedFromForRecording : null}
                onCellClick={handleBoardCellClick}
                disabled={!isRecording && isSetupLocked}
              />
            </div>

            {/* ---- 棋子置物箱（圓形帶框按鈕，視覺對齊棋盤上的棋子） ---- */}
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold text-[#1A1A2E]/70">
                ♟️ 備用棋子置物箱
              </p>
              <p className="mb-2 text-[11px] text-[#1A1A2E]/50">
                {selectedTrayTool
                  ? selectedTrayTool.kind === "eraser"
                    ? "目前工具：🗑️ 移除棋子（點擊棋盤上的棋子即可移除）"
                    : `目前工具：${selectedTrayTool.color === "r" ? "紅方" : "黑方"}「${
                        PIECE_LABEL[selectedTrayTool.type][
                          selectedTrayTool.color === "r" ? "red" : "black"
                        ]
                      }」（點擊棋盤格子放置）`
                  : "尚未選取工具，請先點選下方任一顆棋子，或選擇移除工具"}
              </p>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/80 px-3 py-3">
                {/* 紅方棋子 */}
                {PIECE_TYPES_IN_TRAY_ORDER.map((type) => {
                  const tool: TrayTool = { kind: "piece", type, color: "r" };
                  const isActive = isSameTrayTool(selectedTrayTool, tool);
                  return (
                    <button
                      key={`r-${type}`}
                      type="button"
                      onClick={() => handleSelectTrayTool(tool)}
                      disabled={isSetupLocked}
                      aria-label={`紅方${PIECE_LABEL[type].red}`}
                      className={[
                        "flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-bold shadow-sm transition-transform",
                        "border-[#8E2A1F] bg-[#C0392B] text-[#FDF6E8]",
                        isActive ? "ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110" : "",
                        isSetupLocked
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:scale-105 active:scale-95",
                      ].join(" ")}
                    >
                      {PIECE_LABEL[type].red}
                    </button>
                  );
                })}

                {/* 分隔線 */}
                <span className="mx-1 h-9 w-px bg-[#A9764C]/30" aria-hidden="true" />

                {/* 黑方棋子 */}
                {PIECE_TYPES_IN_TRAY_ORDER.map((type) => {
                  const tool: TrayTool = { kind: "piece", type, color: "b" };
                  const isActive = isSameTrayTool(selectedTrayTool, tool);
                  return (
                    <button
                      key={`b-${type}`}
                      type="button"
                      onClick={() => handleSelectTrayTool(tool)}
                      disabled={isSetupLocked}
                      aria-label={`黑方${PIECE_LABEL[type].black}`}
                      className={[
                        "flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-bold shadow-sm transition-transform",
                        "border-[#0F0F1A] bg-[#1A1A2E] text-[#FDF6E8]",
                        isActive ? "ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110" : "",
                        isSetupLocked
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:scale-105 active:scale-95",
                      ].join(" ")}
                    >
                      {PIECE_LABEL[type].black}
                    </button>
                  );
                })}

                {/* 分隔線 */}
                <span className="mx-1 h-9 w-px bg-[#A9764C]/30" aria-hidden="true" />

                {/* 橡皮擦工具 */}
                {(() => {
                  const eraserTool: TrayTool = { kind: "eraser" };
                  const isActive = isSameTrayTool(selectedTrayTool, eraserTool);
                  return (
                    <button
                      type="button"
                      onClick={() => handleSelectTrayTool(eraserTool)}
                      disabled={isSetupLocked}
                      aria-label="移除棋子工具"
                      className={[
                        "flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed text-lg shadow-sm transition-transform",
                        isActive
                          ? "border-[#E8B84B] bg-[#FCE6A0] text-[#5C3D0A] ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110"
                          : "border-[#A9764C]/50 bg-white text-[#1A1A2E]/60",
                        isSetupLocked
                          ? "cursor-not-allowed opacity-40"
                          : "cursor-pointer hover:scale-105 active:scale-95",
                      ].join(" ")}
                    >
                      🗑️
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* ---- 棋盤工具：清空 / 標準開局 / FEN ---- */}
            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleClearBoard}
                  disabled={isSetupLocked}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  🗑️ 清空棋盤
                </button>
                <button
                  type="button"
                  onClick={handleResetToStandardStart}
                  disabled={isSetupLocked}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  ♻️ 恢復標準開局
                </button>
              </div>

              <div className="rounded-2xl bg-white/80 px-3 py-3">
                <label className="text-xs font-semibold text-[#1A1A2E]/70">
                  貼上 FEN 字串直接套用
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    value={fenInputValue}
                    onChange={(event) => setFenInputValue(event.target.value)}
                    disabled={isSetupLocked}
                    placeholder="rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR"
                    className={`flex-1 font-mono text-xs ${INPUT_CLASS_NAME}`}
                  />
                  <button
                    type="button"
                    onClick={handleApplyFenInput}
                    disabled={isSetupLocked}
                    className={SECONDARY_BUTTON_CLASS_NAME}
                  >
                    套用
                  </button>
                </div>
                {fenApplyError ? (
                  <p className="mt-1 text-xs font-medium text-[#C0392B]">{fenApplyError}</p>
                ) : null}

                <div className="mt-3">
                  <p className="text-xs font-semibold text-[#1A1A2E]/70">
                    目前初始盤面 FEN（自動產生，將寫入 initialFen）
                  </p>
                  <p className="mt-1 break-all rounded-lg bg-[#1A1A2E]/5 px-2 py-1.5 text-[11px] font-mono text-[#1A1A2E]/80">
                    {toFenSafely(initialBoard)}
                  </p>
                </div>
              </div>

              {isSetupLocked ? (
                <p className="text-xs font-medium text-[#C0392B]">
                  已錄製 {lines.reduce((sum, line) => sum + line.length, 0)} 個步驟（含所有線），
                  初始擺位已鎖定。若要修改初始擺位，請先到右側「清空所有線」。
                </p>
              ) : null}
            </div>
          </section>

          {/* ============================================================
              B 區 + C 區
             ============================================================ */}
          <div className="flex flex-col gap-4">
            {/* ---- B 區：走法錄製系統（支援多條正解線） ---- */}
            <section className="rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1A1A2E]">📝 走法錄製系統</h2>
                <button
                  type="button"
                  onClick={handleToggleRecording}
                  className={[
                    "rounded-full px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-transform active:scale-95",
                    isRecording ? "bg-[#C0392B]" : "bg-[#5B8C5A]",
                  ].join(" ")}
                >
                  {isRecording ? "⏹ 停止錄製" : "⏺ 開始錄製解法"}
                </button>
              </div>

              <p className="mt-2 text-xs text-[#1A1A2E]/60">
                {isRecording
                  ? "錄製中：點擊棋盤上的棋子作為起點，再點擊任意目標格子即可記錄一步（不檢查是否合法）。"
                  : "尚未開始錄製。開啟錄製後，在上方棋盤上走的每一步都會依序加入目前選中的這條線。"}
              </p>

              {/* 多條線切換頁籤：同一道殘局如果有兩種以上獲勝走法，
                  可以錄製成多條「替代解法」，學生走任何一條都算對。 */}
              <p className="mt-3 text-xs font-semibold text-[#1A1A2E]/70">正解線</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {lines.map((line, index) => (
                  <div key={index} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => handleSwitchActiveLine(index)}
                      className={[
                        "rounded-l-full px-3 py-1.5 text-xs font-bold transition-transform",
                        index === lines.length - 1 || index !== activeLineIndex ? "rounded-r-full" : "",
                        activeLineIndex === index
                          ? "bg-[#E8B84B] text-[#1A1A2E]"
                          : "bg-white/70 text-[#1A1A2E]/60",
                      ].join(" ")}
                    >
                      {index === 0 ? "主線" : `替代解法 ${index}`}（{line.length} 步）
                    </button>
                    {index > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(index)}
                        aria-label={`刪除替代解法 ${index}`}
                        className={[
                          "rounded-r-full px-2 py-1.5 text-xs font-bold transition-transform",
                          activeLineIndex === index
                            ? "bg-[#E8B84B] text-[#C0392B]"
                            : "bg-white/70 text-[#C0392B]/70",
                        ].join(" ")}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={handleAddAlternativeLine}
                  className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95"
                >
                  ➕ 新增替代解法
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[#1A1A2E]/40">
                替代解法跟主線都是從同一個初始擺位開始，學生走主線或任何一條替代解法都算解開這道題。
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleClearLastMove}
                  disabled={(lines[activeLineIndex]?.length ?? 0) === 0}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  ↩️ 清除最後一步
                </button>
                <button
                  type="button"
                  onClick={handleClearAllMoves}
                  disabled={!isSetupLocked}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  🗑️ 清空所有線
                </button>
              </div>

              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-3">
                <p className="text-xs font-semibold text-[#1A1A2E]/70">
                  {activeLineIndex === 0 ? "主線" : `替代解法 ${activeLineIndex}`}已錄製步驟（
                  {(lines[activeLineIndex] ?? []).length} 步）
                </p>
                {(lines[activeLineIndex]?.length ?? 0) === 0 ? (
                  <p className="mt-1 text-xs text-[#1A1A2E]/50">目前這條線還沒有錄製任何步驟。</p>
                ) : (
                  <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#1A1A2E]">
                    {(lines[activeLineIndex] ?? []).map((notation, index) => (
                      <li key={`${index}-${notation}`} className="tabular-nums">
                        {index + 1}. {notation.slice(0, 2)}-{notation.slice(2, 4)}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            {/* ---- C 區：關卡後設資料與上架 ---- */}
            <section className="rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1A1A2E]">🏷️ 關卡後設資料與上架</h2>
                {editingPuzzleId ? (
                  <button
                    type="button"
                    onClick={resetEditorToBlankState}
                    className="text-xs font-bold text-[#1A1A2E]/60 hover:underline"
                  >
                    ➕ 開始新題目
                  </button>
                ) : null}
              </div>

              {editingPuzzleId ? (
                <p className="mt-2 rounded-xl bg-[#8B5FBF]/10 px-3 py-2 text-xs font-medium text-[#8B5FBF]">
                  ✏️ 正在編輯既有題目「{editingPuzzleId}」，關卡 ID 不能修改。發布會直接覆蓋這一題，
                  不會建立新文件。
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-3">
                <Field label="關卡 ID（將作為 Firestore 文件 ID：puzzles/{id}）">
                  <input
                    type="text"
                    value={puzzleId}
                    onChange={(event) => setPuzzleId(event.target.value)}
                    placeholder="例如：demo-puzzle-002"
                    disabled={editingPuzzleId !== null}
                    className={INPUT_CLASS_NAME}
                  />
                </Field>

                <Field label="關卡名稱">
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="例如：馬後炮絕殺"
                    className={INPUT_CLASS_NAME}
                  />
                </Field>

                <Field label="關卡描述">
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={3}
                    placeholder="給學生的提示或敘述"
                    className={INPUT_CLASS_NAME}
                  />
                </Field>

                <Field label="難度等級（1 級～10 級，直接對應 PuzzleDoc.level）">
                  <select
                    value={level}
                    onChange={(event) => setLevel(Number(event.target.value) as PuzzleLevel)}
                    className={INPUT_CLASS_NAME}
                  >
                    {LEVEL_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option} 級
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {publishError ? (
                <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">
                  {publishError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing}
                className="mt-4 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPublishing
                  ? editingPuzzleId
                    ? "更新中…"
                    : "上架中…"
                  : editingPuzzleId
                    ? "💾 更新題目"
                    : "🚀 一鍵上架"}
              </button>
            </section>
          </div>
        </div>
      </div>

      {/* ---- 成功提示 Toast（不擋住 UI，3 秒後自動消失） ---- */}
      {toastMessage ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="rounded-full bg-[#1A1A2E] px-5 py-2.5 text-sm font-semibold text-white shadow-lg">
            ✅ {toastMessage}
          </div>
        </div>
      ) : null}
    </main>
  );
}

/** 安全地把棋盤編碼成 FEN 字串供畫面顯示，失敗時給出友善訊息而不是讓畫面整個壞掉 */
function toFenSafely(board: BoardGrid): string {
  try {
    return toFen(board);
  } catch (error) {
    console.error("[admin] 棋盤無法編碼成 FEN：", error);
    return "（棋盤格式錯誤，無法產生 FEN）";
  }
}

// ============================================================
// 6. 表單欄位小元件（label + input 包裝）
// ============================================================

// ============================================================
// 6.5 現有題目管理（列出已上架/未上架的題目，可刪除）
// ------------------------------------------------------------
// 之前的版本完全沒有「查看/刪除現有題目」的入口，老師一旦發布
// 就沒辦法收回了。這裡用 inline 兩段式確認（點擊「刪除」先變成
// 「確定刪除？」+「取消」，再點一次才真的執行），不用瀏覽器原生
// confirm()，跟整個 App 的視覺風格保持一致。
// ============================================================

function ExistingPuzzlesSection({
  onEditPuzzle,
}: {
  onEditPuzzle: (puzzle: PuzzleDoc) => void;
}) {
  const [puzzles, setPuzzles] = useState<PuzzleDoc[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchPuzzles();
    // 只在掛載時撈一次；發布/刪除後會在對應的處理函式裡手動更新這份本地列表，
    // 不需要每次操作都重新打一次 getDocs。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPuzzles() {
    setStatus("loading");
    setFetchErrorMessage(null);
    try {
      const snapshot = await getDocs(collection(db, "puzzles"));
      const list = snapshot.docs
        .map((docSnapshot) => docSnapshot.data() as PuzzleDoc)
        .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
      setPuzzles(list);
      setStatus("success");
    } catch (error) {
      console.error("[admin] 讀取現有題目失敗：", error);
      setFetchErrorMessage(
        error instanceof Error ? error.message : "讀取題目列表時發生未知錯誤。"
      );
      setStatus("error");
    }
  }

  async function handleConfirmDelete(puzzleId: string) {
    setDeletingId(puzzleId);
    setDeleteErrorMessage(null);
    try {
      await deleteDoc(doc(db, "puzzles", puzzleId));
      setPuzzles((prev) => prev.filter((puzzle) => puzzle.id !== puzzleId));
    } catch (error) {
      console.error("[admin] 刪除題目失敗：", error);
      setDeleteErrorMessage(
        error instanceof Error ? `刪除失敗：${error.message}` : "刪除時發生未知錯誤，請稍後再試。"
      );
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-[#1A1A2E]">📋 現有題目管理</h2>
        <button
          type="button"
          onClick={fetchPuzzles}
          className="text-xs font-bold text-[#1A1A2E]/60 hover:underline"
        >
          🔄 重新整理
        </button>
      </div>

      {deleteErrorMessage ? (
        <p className="mt-2 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">
          {deleteErrorMessage}
        </p>
      ) : null}

      <div className="mt-3">
        {status === "loading" ? (
          <p className="text-xs text-[#1A1A2E]/50">題目列表載入中…</p>
        ) : status === "error" ? (
          <p className="text-xs text-[#C0392B]">
            {fetchErrorMessage ?? "讀取題目列表失敗，請稍後再試。"}
          </p>
        ) : puzzles.length === 0 ? (
          <p className="text-xs text-[#1A1A2E]/50">目前還沒有任何題目，可以在下方建立第一道題目。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {puzzles.map((puzzle) => {
              const isConfirming = confirmingDeleteId === puzzle.id;
              const isDeleting = deletingId === puzzle.id;

              return (
                <li
                  key={puzzle.id}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[#1A1A2E]">
                      {puzzle.title}
                      <span className="ml-1 text-xs font-normal text-[#1A1A2E]/50">
                        (Lv.{puzzle.level} ・ 主線 {puzzle.moves.length} 步
                        {puzzle.alternativeLines && puzzle.alternativeLines.length > 0
                          ? ` ・ ${puzzle.alternativeLines.length} 條替代解法`
                          : ""}
                        ・ {puzzle.isPublished ? "已上架" : "未上架"})
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-[#1A1A2E]/40">ID: {puzzle.id}</p>
                  </div>

                  {isConfirming ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-bold text-[#C0392B]">確定刪除？</span>
                      <button
                        type="button"
                        onClick={() => handleConfirmDelete(puzzle.id)}
                        disabled={isDeleting}
                        className="rounded-lg bg-[#C0392B] px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {isDeleting ? "刪除中…" : "確定"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(null)}
                        disabled={isDeleting}
                        className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onEditPuzzle(puzzle)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#8B5FBF] ring-1 ring-inset ring-[#8B5FBF]/30 transition-transform active:scale-95"
                      >
                        ✏️ 編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDeleteId(puzzle.id)}
                        className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
                      >
                        🗑️ 刪除
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#1A1A2E]/70">{label}</span>
      {children}
    </label>
  );
}

// ============================================================
// 7. 管理後台專用棋盤渲染元件
// ------------------------------------------------------------
// 視覺樣式對齊 ChessBoard.tsx 的 SVG 交叉點畫法（棋子放在格線交叉點上，
// 不是塞進方格裡；中間 7 條直線在楚河斷開，兩端九宮格有 X 斜線），
// 但點擊語意完全交給外部 onCellClick 決定（擺子 or 錄製走法），
// 本元件本身不持有任何「選取中」狀態，純展示 + 事件轉發。
// ============================================================

const ADMIN_BOARD_CELL = 50;
const ADMIN_BOARD_MARGIN = 32;
const ADMIN_BOARD_WIDTH = ADMIN_BOARD_MARGIN * 2 + ADMIN_BOARD_CELL * 8;
const ADMIN_BOARD_HEIGHT = ADMIN_BOARD_MARGIN * 2 + ADMIN_BOARD_CELL * 9;
const ADMIN_BOARD_LINE_COLOR = "#5C3D0A";

function adminBoardPointOf(row: number, col: number): { x: number; y: number } {
  return { x: ADMIN_BOARD_MARGIN + col * ADMIN_BOARD_CELL, y: ADMIN_BOARD_MARGIN + row * ADMIN_BOARD_CELL };
}

function AdminChessBoard({
  board,
  selectedCell,
  onCellClick,
  disabled,
}: {
  board: BoardGrid;
  selectedCell: Position | null;
  onCellClick: (row: number, col: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      <svg
        viewBox={`0 0 ${ADMIN_BOARD_WIDTH} ${ADMIN_BOARD_HEIGHT}`}
        className="h-auto w-full rounded-2xl border-4 border-[#A9764C] bg-[#E8D5B5] p-1 shadow-inner"
        role="group"
        aria-label="象棋棋盤"
      >
        {/* 橫線：10 條，每條都貫通整個寬度 */}
        {Array.from({ length: 10 }, (_, row) => {
          const y = ADMIN_BOARD_MARGIN + row * ADMIN_BOARD_CELL;
          return (
            <line
              key={`h-${row}`}
              x1={ADMIN_BOARD_MARGIN}
              y1={y}
              x2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 8}
              y2={y}
              stroke={ADMIN_BOARD_LINE_COLOR}
              strokeWidth={1.5}
            />
          );
        })}

        {/* 直線：9 條，最左/最右貫通全高，中間 7 條在楚河斷開 */}
        {Array.from({ length: 9 }, (_, col) => {
          const x = ADMIN_BOARD_MARGIN + col * ADMIN_BOARD_CELL;
          const isOuterEdge = col === 0 || col === 8;

          if (isOuterEdge) {
            return (
              <line
                key={`v-${col}`}
                x1={x}
                y1={ADMIN_BOARD_MARGIN}
                x2={x}
                y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 9}
                stroke={ADMIN_BOARD_LINE_COLOR}
                strokeWidth={1.5}
              />
            );
          }

          return (
            <g key={`v-${col}`}>
              <line
                x1={x}
                y1={ADMIN_BOARD_MARGIN}
                x2={x}
                y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 4}
                stroke={ADMIN_BOARD_LINE_COLOR}
                strokeWidth={1.5}
              />
              <line
                x1={x}
                y1={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 5}
                x2={x}
                y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 9}
                stroke={ADMIN_BOARD_LINE_COLOR}
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* 上方九宮格斜線 */}
        <line
          x1={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL}
          y1={ADMIN_BOARD_MARGIN}
          x2={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL}
          y2={ADMIN_BOARD_MARGIN + 2 * ADMIN_BOARD_CELL}
          stroke={ADMIN_BOARD_LINE_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL}
          y1={ADMIN_BOARD_MARGIN}
          x2={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL}
          y2={ADMIN_BOARD_MARGIN + 2 * ADMIN_BOARD_CELL}
          stroke={ADMIN_BOARD_LINE_COLOR}
          strokeWidth={1.5}
        />

        {/* 下方九宮格斜線 */}
        <line
          x1={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL}
          y1={ADMIN_BOARD_MARGIN + 7 * ADMIN_BOARD_CELL}
          x2={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL}
          y2={ADMIN_BOARD_MARGIN + 9 * ADMIN_BOARD_CELL}
          stroke={ADMIN_BOARD_LINE_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL}
          y1={ADMIN_BOARD_MARGIN + 7 * ADMIN_BOARD_CELL}
          x2={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL}
          y2={ADMIN_BOARD_MARGIN + 9 * ADMIN_BOARD_CELL}
          stroke={ADMIN_BOARD_LINE_COLOR}
          strokeWidth={1.5}
        />

        {/* 楚河漢界文字 */}
        <text
          x={ADMIN_BOARD_MARGIN + 1.5 * ADMIN_BOARD_CELL}
          y={ADMIN_BOARD_MARGIN + 4.5 * ADMIN_BOARD_CELL + 7}
          fontSize={20}
          fill="#A9764C"
          fontWeight="bold"
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          楚河
        </text>
        <text
          x={ADMIN_BOARD_MARGIN + 6.5 * ADMIN_BOARD_CELL}
          y={ADMIN_BOARD_MARGIN + 4.5 * ADMIN_BOARD_CELL + 7}
          fontSize={20}
          fill="#A9764C"
          fontWeight="bold"
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          漢界
        </text>

        {/* 交叉點：點擊熱區 + 選取高光 + 棋子 */}
        {board.map((rowCells, rowIndex) =>
          rowCells.map((cell, colIndex) => {
            const { x, y } = adminBoardPointOf(rowIndex, colIndex);
            const isSelected =
              selectedCell?.row === rowIndex && selectedCell?.col === colIndex;
            const squareLabel = formatSquare({ row: rowIndex, col: colIndex });

            return (
              <g
                key={`${rowIndex}-${colIndex}`}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label={`座標 ${squareLabel}${cell ? `，${cell.color === "r" ? "紅方" : "黑方"}${PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}` : ""}`}
                onClick={() => onCellClick(rowIndex, colIndex)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCellClick(rowIndex, colIndex);
                  }
                }}
                style={{ cursor: disabled ? "not-allowed" : "pointer", outline: "none" }}
              >
                <circle cx={x} cy={y} r={ADMIN_BOARD_CELL * 0.48} fill="transparent" />

                {isSelected ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={ADMIN_BOARD_CELL * 0.42}
                    fill="none"
                    stroke="#E8B84B"
                    strokeWidth={3}
                  />
                ) : null}

                {cell ? (
                  <>
                    <circle
                      cx={x}
                      cy={y}
                      r={ADMIN_BOARD_CELL * 0.38}
                      fill={cell.color === "r" ? "#C0392B" : "#1A1A2E"}
                      stroke={cell.color === "r" ? "#8E2A1F" : "#0F0F1A"}
                      strokeWidth={2}
                    />
                    <text
                      x={x}
                      y={y}
                      fontSize={ADMIN_BOARD_CELL * 0.38}
                      fill="#FDF6E8"
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

// ============================================================
// 8. 預設匯出：包上 RequireAuth 路由守衛（限定 teacher 角色）
// ============================================================

export default function AdminPuzzleEditorPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <AdminPuzzleEditorPageContent />
    </RequireAuth>
  );
}
