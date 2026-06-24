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
 *   1.【棋盤狀態改用「歷史堆疊」，不再用「重播推導」】
 *      上一版是維護一個固定的 initialBoard，每次要顯示「目前棋盤」
 *      時，都用 rebuildBoardFromMoves() 從 initialBoard 重新依序套用
 *      所有 recordedMoves 重新計算一次。這一版改成維護一個
 *      boardHistory: BoardGrid[] 陣列，index 0 是初始擺位、
 *      最後一個元素永遠是「目前畫面該顯示的棋盤」，且恒等式
 *      boardHistory.length === recordedMoves.length + 1 永遠成立：
 *        - 錄製一步：直接把「這一步执行後的新棋盤」push 進陣列尾端。
 *        - 清除最後一步／清空所有步驟：直接從陣列尾端 pop／截斷回
 *          只剩 boardHistory[0]。
 *      這樣「目前棋盤」永遠是陣列最後一項，純粹陣列存取，不需要
 *      任何 useMemo 重新計算或 try/catch 防呆，邏輯更直接、更不容易
 *      因為某個邊界情況而讓畫面顯示不出東西。
 *
 *   2.【棋子置物箱改成圓形帶框按鈕，視覺對齊棋盤上的棋子】
 *      依需求把棋子置物箱的按鈕改成跟棋盤上棋子一樣的「圓形 + 雙層
 *      邊框」造型（紅方深紅底、黑方深黑底），而不是上一版的圓角矩形，
 *      視覺上更接近「棋子實體」的質感。
 *
 *   3.【完全移除「獎勵金幣」欄位】
 *      表單、狀態、寫入 Firestore 的 payload 都已徹底移除
 *      rewardCoins／獎勵金幣相關的所有程式碼，因為目前的解題機制
 *      （usePuzzleSolver.ts 的 calculateFoodReward）完全不會用到這個
 *      固定欄位。
 *
 *   4.【難度等級改成 1~10 級下拉選單，直接對應 PuzzleLevel】
 *      不再用「簡單/中等/困難」三段式 + 對照表映射，下拉選單直接
 *      列出 1 級 ~ 10 級，選了哪個數字，寫進 Firestore 的
 *      PuzzleDoc.level 欄位就是那個數字，型別 100% 直接契合
 *      （不需要任何中間映射層）。
 *
 *   5.【其餘高水準邏輯全部保留】
 *      開始錄製解法開關、已錄製步驟列表（畫面顯示用破折號格式，
 *      實際存檔仍是 lib/xiangqi/move.ts 要求的四字元記號，理由同上一版：
 *      parseMoveNotation() 要求剛好四個字元，存成帶破折號的字串會讓
 *      學生端解題 Hook 直接解析失敗）、清除最後一步、清空所有步驟、
 *      一旦開始錄製就鎖定擺子工具與 FEN 貼上、setDoc 寫入 puzzles/{id}，
 *      全部維持不變。
 *
 *   6.【不修改既有檔案】
 *      依需求，本頁不匯入也不修改 usePuzzleSolver.ts、database.ts、
 *      ChessBoard.tsx。象棋型別與 parseFen/toFen/applyMove/
 *      formatMoveNotation 等工具函式直接從專案既有的 lib/types 匯入
 *      重用；棋盤渲染與擺子/錄製邏輯則是本檔案內自己實作的
 *      <AdminChessBoard />，因為這裡的點擊語意（擺子 vs. 錄製走法）
 *      跟學生端「選起點→選終點直接送出」不同，硬塞進同一個元件的
 *      props 介面會很彆扭。
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { createStandardStartBoard, parseFen, toFen } from "@/lib/xiangqi/fen";
import { applyMove, formatMoveNotation, formatSquare } from "@/lib/xiangqi/move";
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

  // ---- A 區：棋盤歷史堆疊 ----
  // boardHistory[0]＝初始擺位（將寫入 initialFen）
  // boardHistory[boardHistory.length-1]＝目前畫面顯示的棋盤
  // 恆等式：boardHistory.length === recordedMoves.length + 1
  const [boardHistory, setBoardHistory] = useState<BoardGrid[]>(() => [
    createStandardStartBoard(),
  ]);
  const [selectedTrayTool, setSelectedTrayTool] = useState<TrayTool | null>(null);
  const [fenInputValue, setFenInputValue] = useState("");
  const [fenApplyError, setFenApplyError] = useState<string | null>(null);

  // ---- B 區：走法錄製 ----
  const [isRecording, setIsRecording] = useState(false);
  const [recordedMoves, setRecordedMoves] = useState<string[]>([]);
  const [selectedFromForRecording, setSelectedFromForRecording] = useState<Position | null>(
    null
  );

  // ---- C 區：表單欄位（已移除獎勵金幣欄位） ----
  const [puzzleId, setPuzzleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<PuzzleLevel>(5);

  // ---- 上架狀態 ----
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // 已有錄製步驟時，鎖定 A 區的初始擺位編輯（理由見檔案頂部說明）
  const isSetupLocked = recordedMoves.length > 0;

  // 目前畫面該顯示的棋盤／初始擺位：都只是陣列存取，不需要任何重新計算
  const liveBoard = boardHistory[boardHistory.length - 1];
  const initialBoard = boardHistory[0];

  // 成功提示 Toast：3 秒後自動消失，不擋住 UI
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // ============================================================
  // A 區操作
  // ============================================================

  function handleSelectTrayTool(tool: TrayTool) {
    if (isSetupLocked) return;
    setSelectedTrayTool((prev) => (isSameTrayTool(prev, tool) ? null : tool));
  }

  function handleClearBoard() {
    if (isSetupLocked) return;
    setBoardHistory([createEmptyBoard()]);
    setFenApplyError(null);
  }

  function handleResetToStandardStart() {
    if (isSetupLocked) return;
    setBoardHistory([createStandardStartBoard()]);
    setFenApplyError(null);
  }

  function handleApplyFenInput() {
    if (isSetupLocked) return;
    setFenApplyError(null);
    try {
      const parsedBoard = parseFen(fenInputValue.trim());
      setBoardHistory([parsedBoard]);
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

    setBoardHistory((prev) => {
      const current = prev[0];
      const next = current.map((rowCells) => rowCells.slice());
      next[row][col] =
        selectedTrayTool.kind === "eraser"
          ? null
          : { type: selectedTrayTool.type, color: selectedTrayTool.color };
      return [next];
    });
  }

  /** 錄製模式：第一次點擊選起點（必須有棋子），第二次點擊選終點並記錄一步 */
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
      const { board: nextBoard } = applyMove(liveBoard, move);
      const notation = formatMoveNotation(move);
      setBoardHistory((prev) => [...prev, nextBoard]);
      setRecordedMoves((prev) => [...prev, notation]);
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
    setBoardHistory((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    setRecordedMoves((prev) => prev.slice(0, -1));
    setSelectedFromForRecording(null);
  }

  function handleClearAllMoves() {
    setBoardHistory((prev) => [prev[0]]);
    setRecordedMoves([]);
    setSelectedFromForRecording(null);
  }

  // ============================================================
  // C 區：一鍵上架
  // ============================================================

  async function handlePublish() {
    setPublishError(null);

    const trimmedId = puzzleId.trim();
    const trimmedTitle = title.trim();

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
    if (recordedMoves.length === 0) {
      setPublishError("請先在 B 區錄製至少一步正解走法，才能上架題目。");
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

    const puzzlePayload: PuzzleDoc = {
      id: trimmedId,
      level,
      title: trimmedTitle,
      description: description.trim(),
      initialFen: fenString,
      moves: recordedMoves,
      totalSteps: recordedMoves.length,
      createdBy: user.uid,
      isPublished: true,
      createdAt: now,
      updatedAt: now,
    };

    setIsPublishing(true);
    try {
      await setDoc(doc(db, "puzzles", trimmedId), puzzlePayload);
      setToastMessage(`題目「${trimmedTitle}」已成功上架！`);
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
        <ExistingPuzzlesSection />

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
                  已錄製 {recordedMoves.length} 個步驟，初始擺位已鎖定。若要修改初始擺位，
                  請先到右側「清空所有步驟」。
                </p>
              ) : null}
            </div>
          </section>

          {/* ============================================================
              B 區 + C 區
             ============================================================ */}
          <div className="flex flex-col gap-4">
            {/* ---- B 區：走法錄製系統 ---- */}
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
                  : "尚未開始錄製。開啟錄製後，在上方棋盤上走的每一步都會依序加入正解序列。"}
              </p>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleClearLastMove}
                  disabled={recordedMoves.length === 0}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  ↩️ 清除最後一步
                </button>
                <button
                  type="button"
                  onClick={handleClearAllMoves}
                  disabled={recordedMoves.length === 0}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  🗑️ 清空所有步驟
                </button>
              </div>

              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-3">
                <p className="text-xs font-semibold text-[#1A1A2E]/70">
                  已錄製步驟（{recordedMoves.length} 步）
                </p>
                {recordedMoves.length === 0 ? (
                  <p className="mt-1 text-xs text-[#1A1A2E]/50">目前還沒有錄製任何步驟。</p>
                ) : (
                  <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#1A1A2E]">
                    {recordedMoves.map((notation, index) => (
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
              <h2 className="text-sm font-bold text-[#1A1A2E]">🏷️ 關卡後設資料與上架</h2>

              <div className="mt-3 flex flex-col gap-3">
                <Field label="關卡 ID（將作為 Firestore 文件 ID：puzzles/{id}）">
                  <input
                    type="text"
                    value={puzzleId}
                    onChange={(event) => setPuzzleId(event.target.value)}
                    placeholder="例如：demo-puzzle-002"
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
                {isPublishing ? "上架中…" : "🚀 一鍵上架"}
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

function ExistingPuzzlesSection() {
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
                        (Lv.{puzzle.level} ・ {puzzle.moves.length} 步 ・{" "}
                        {puzzle.isPublished ? "已上架" : "未上架"})
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
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(puzzle.id)}
                      className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
                    >
                      🗑️ 刪除
                    </button>
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
