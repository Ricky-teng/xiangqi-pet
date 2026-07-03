/**
 * src/app/admin/page.tsx
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
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

const PIECE_LABEL: Record<PieceType, { red: string; black: string }> = {
  k: { red: "帥", black: "將" },
  a: { red: "仕", black: "士" },
  e: { red: "相", black: "象" },
  h: { red: "馬", black: "馬" },
  r: { red: "車", black: "車" },
  c: { red: "炮", black: "炮" },
  p: { red: "兵", black: "卒" },
};

const PIECE_TYPES_IN_TRAY_ORDER: PieceType[] = ["k", "a", "e", "h", "r", "c", "p"];
const LEVEL_OPTIONS: PuzzleLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

type TrayTool = { kind: "eraser" } | { kind: "piece"; type: PieceType; color: PieceColor };

function isSameTrayTool(a: TrayTool | null, b: TrayTool): boolean {
  if (!a) return false;
  if (a.kind === "eraser" && b.kind === "eraser") return true;
  if (a.kind === "piece" && b.kind === "piece") {
    return a.type === b.type && a.color === b.color;
  }
  return false;
}

function createEmptyBoard(): BoardGrid {
  return Array.from({ length: 10 }, () => Array<Piece | null>(9).fill(null));
}

function replayMoves(startBoard: BoardGrid, moves: string[]): BoardGrid {
  let board = startBoard;
  for (const notation of moves) {
    board = applyMoveNotation(board, notation).board;
  }
  return board;
}

const INPUT_CLASS_NAME =
  "rounded-lg border border-[#A9764C]/40 bg-white px-3 py-2 text-sm text-[#1A1A2E] focus:border-[#E8B84B] focus:outline-none focus:ring-2 focus:ring-[#E8B84B]/40 disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS_NAME =
  "rounded-xl bg-white px-3 py-2 text-xs font-bold text-[#1A1A2E] shadow-sm ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";

function AdminPuzzleEditorPageContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  const [initialBoard, setInitialBoard] = useState<BoardGrid>(() => createStandardStartBoard());
  const [selectedTrayTool, setSelectedTrayTool] = useState<TrayTool | null>(null);
  const [fenInputValue, setFenInputValue] = useState("");
  const [fenApplyError, setFenApplyError] = useState<string | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [lines, setLines] = useState<string[][]>([[]]);
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [selectedFromForRecording, setSelectedFromForRecording] = useState<Position | null>(null);

  const [puzzleId, setPuzzleId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [level, setLevel] = useState<PuzzleLevel>(5);

  const [editingPuzzleId, setEditingPuzzleId] = useState<string | null>(null);
  const [editingOriginalMeta, setEditingOriginalMeta] = useState<{
    createdBy: string;
    createdAt: number;
  } | null>(null);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const isSetupLocked = lines.some((line) => line.length > 0);
  const liveBoard = replayMoves(initialBoard, lines[activeLineIndex] ?? []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

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

    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

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

  function handleBoardCellClick(row: number, col: number) {
    if (isRecording) {
      handleRecordingClick(row, col);
      return;
    }
    if (isSetupLocked) return;
    handlePlacementClick(row, col);
  }

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
      setSelectedFromForRecording(null);
      return;
    }

    const move: Move = { from: selectedFromForRecording, to: { row, col } };

    try {
      applyMove(liveBoard, move);
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

  function handleAddAlternativeLine() {
    setLines((prev) => [...prev, []]);
    setActiveLineIndex(lines.length);
    setSelectedFromForRecording(null);
  }

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

  async function handlePublish() {
    setPublishError(null);

    const trimmedId = puzzleId.trim();
    const trimmedTitle = title.trim();
    const mainLine = lines[0];
    const alternativeLinesToSave = lines
      .slice(1)
      .filter((line) => line.length > 0)
      .map((line) => ({ moves: line }));

    if (!trimmedId) { setPublishError("請輸入關卡 ID。"); return; }
    if (trimmedId.includes("/")) { setPublishError("關卡 ID 不可包含「/」符號。"); return; }
    if (!trimmedTitle) { setPublishError("請輸入關卡名稱。"); return; }
    if (mainLine.length === 0) { setPublishError("請先在 B 區的「主線」錄製至少一步正解走法，才能上架題目。"); return; }
    if (!user) { setPublishError("找不到目前登入的老師帳號資料，請重新登入後再試。"); return; }

    let fenString: string;
    try {
      fenString = toFen(initialBoard);
    } catch (error) {
      setPublishError(error instanceof Error ? `初始棋盤格式錯誤：${error.message}` : "初始棋盤格式錯誤。");
      return;
    }

    const now = Date.now();
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
      setToastMessage(editingPuzzleId ? `題目「${trimmedTitle}」已成功更新！` : `題目「${trimmedTitle}」已成功上架！`);
      if (editingPuzzleId) {
        setEditingOriginalMeta({ createdBy, createdAt });
      }
    } catch (error) {
      console.error("[admin] 發布題目失敗：", error);
      setPublishError(error instanceof Error ? `發布失敗：${error.message}` : "發布時發生未知錯誤，請稍後再試。");
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-16">
      <div className="mx-auto max-w-6xl px-4 pt-4">
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
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <ExistingPuzzlesSection onEditPuzzle={handleEditPuzzle} />

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
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

            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold text-[#1A1A2E]/70">♟️ 備用棋子置物箱</p>
              <p className="mb-2 text-[11px] text-[#1A1A2E]/50">
                {selectedTrayTool
                  ? selectedTrayTool.kind === "eraser"
                    ? "目前工具：🗑️ 移除棋子（點擊棋盤上的棋子即可移除）"
                    : `目前工具：${selectedTrayTool.color === "r" ? "紅方" : "黑方"}「${PIECE_LABEL[selectedTrayTool.type][selectedTrayTool.color === "r" ? "red" : "black"]}」（點擊棋盤格子放置）`
                  : "尚未選取工具，請先點選下方任一顆棋子，或選擇移除工具"}
              </p>

              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/80 px-3 py-3">
                {PIECE_TYPES_IN_TRAY_ORDER.map((type) => {
                  const tool: TrayTool = { kind: "piece", type, color: "r" };
                  const isActive = isSameTrayTool(selectedTrayTool, tool);
                  return (
                    <button key={`r-${type}`} type="button" onClick={() => handleSelectTrayTool(tool)} disabled={isSetupLocked} aria-label={`紅方${PIECE_LABEL[type].red}`}
                      className={["flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-bold shadow-sm transition-transform", "border-[#8E2A1F] bg-[#C0392B] text-[#FDF6E8]", isActive ? "ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110" : "", isSetupLocked ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:scale-105 active:scale-95"].join(" ")}>
                      {PIECE_LABEL[type].red}
                    </button>
                  );
                })}
                <span className="mx-1 h-9 w-px bg-[#A9764C]/30" aria-hidden="true" />
                {PIECE_TYPES_IN_TRAY_ORDER.map((type) => {
                  const tool: TrayTool = { kind: "piece", type, color: "b" };
                  const isActive = isSameTrayTool(selectedTrayTool, tool);
                  return (
                    <button key={`b-${type}`} type="button" onClick={() => handleSelectTrayTool(tool)} disabled={isSetupLocked} aria-label={`黑方${PIECE_LABEL[type].black}`}
                      className={["flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-bold shadow-sm transition-transform", "border-[#0F0F1A] bg-[#1A1A2E] text-[#FDF6E8]", isActive ? "ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110" : "", isSetupLocked ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:scale-105 active:scale-95"].join(" ")}>
                      {PIECE_LABEL[type].black}
                    </button>
                  );
                })}
                <span className="mx-1 h-9 w-px bg-[#A9764C]/30" aria-hidden="true" />
                {(() => {
                  const eraserTool: TrayTool = { kind: "eraser" };
                  const isActive = isSameTrayTool(selectedTrayTool, eraserTool);
                  return (
                    <button type="button" onClick={() => handleSelectTrayTool(eraserTool)} disabled={isSetupLocked} aria-label="移除棋子工具"
                      className={["flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed text-lg shadow-sm transition-transform", isActive ? "border-[#E8B84B] bg-[#FCE6A0] text-[#5C3D0A] ring-[3px] ring-[#E8B84B] ring-offset-2 scale-110" : "border-[#A9764C]/50 bg-white text-[#1A1A2E]/60", isSetupLocked ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:scale-105 active:scale-95"].join(" ")}>
                      🗑️
                    </button>
                  );
                })()}
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={handleClearBoard} disabled={isSetupLocked} className={SECONDARY_BUTTON_CLASS_NAME}>🗑️ 清空棋盤</button>
                <button type="button" onClick={handleResetToStandardStart} disabled={isSetupLocked} className={SECONDARY_BUTTON_CLASS_NAME}>♻️ 恢復標準開局</button>
              </div>
              <div className="rounded-2xl bg-white/80 px-3 py-3">
                <label className="text-xs font-semibold text-[#1A1A2E]/70">貼上 FEN 字串直接套用</label>
                <div className="mt-1 flex gap-2">
                  <input type="text" value={fenInputValue} onChange={(e) => setFenInputValue(e.target.value)} disabled={isSetupLocked} placeholder="rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR" className={`flex-1 font-mono text-xs ${INPUT_CLASS_NAME}`} />
                  <button type="button" onClick={handleApplyFenInput} disabled={isSetupLocked} className={SECONDARY_BUTTON_CLASS_NAME}>套用</button>
                </div>
                {fenApplyError ? <p className="mt-1 text-xs font-medium text-[#C0392B]">{fenApplyError}</p> : null}
                <div className="mt-3">
                  <p className="text-xs font-semibold text-[#1A1A2E]/70">目前初始盤面 FEN（自動產生，將寫入 initialFen）</p>
                  <p className="mt-1 break-all rounded-lg bg-[#1A1A2E]/5 px-2 py-1.5 text-[11px] font-mono text-[#1A1A2E]/80">{toFenSafely(initialBoard)}</p>
                </div>
              </div>
              {isSetupLocked ? (
                <p className="text-xs font-medium text-[#C0392B]">
                  已錄製 {lines.reduce((sum, line) => sum + line.length, 0)} 個步驟（含所有線），初始擺位已鎖定。若要修改初始擺位，請先到右側「清空所有線」。
                </p>
              ) : null}
            </div>
          </section>

          <div className="flex flex-col gap-4">
            <section className="rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1A1A2E]">📝 走法錄製系統</h2>
                <button type="button" onClick={handleToggleRecording} className={["rounded-full px-4 py-1.5 text-xs font-bold text-white shadow-sm transition-transform active:scale-95", isRecording ? "bg-[#C0392B]" : "bg-[#5B8C5A]"].join(" ")}>
                  {isRecording ? "⏹ 停止錄製" : "⏺ 開始錄製解法"}
                </button>
              </div>
              <p className="mt-2 text-xs text-[#1A1A2E]/60">
                {isRecording ? "錄製中：點擊棋盤上的棋子作為起點，再點擊任意目標格子即可記錄一步（不檢查是否合法）。" : "尚未開始錄製。開啟錄製後，在上方棋盤上走的每一步都會依序加入目前選中的這條線。"}
              </p>
              <p className="mt-3 text-xs font-semibold text-[#1A1A2E]/70">正解線</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {lines.map((line, index) => (
                  <div key={index} className="flex items-center">
                    <button type="button" onClick={() => handleSwitchActiveLine(index)}
                      className={["rounded-l-full px-3 py-1.5 text-xs font-bold transition-transform", index === lines.length - 1 || index !== activeLineIndex ? "rounded-r-full" : "", activeLineIndex === index ? "bg-[#E8B84B] text-[#1A1A2E]" : "bg-white/70 text-[#1A1A2E]/60"].join(" ")}>
                      {index === 0 ? "主線" : `替代解法 ${index}`}（{line.length} 步）
                    </button>
                    {index > 0 ? (
                      <button type="button" onClick={() => handleRemoveLine(index)} aria-label={`刪除替代解法 ${index}`}
                        className={["rounded-r-full px-2 py-1.5 text-xs font-bold transition-transform", activeLineIndex === index ? "bg-[#E8B84B] text-[#C0392B]" : "bg-white/70 text-[#C0392B]/70"].join(" ")}>
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
                <button type="button" onClick={handleAddAlternativeLine} className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 transition-transform active:scale-95">➕ 新增替代解法</button>
              </div>
              <p className="mt-1 text-[11px] text-[#1A1A2E]/40">替代解法跟主線都是從同一個初始擺位開始，學生走主線或任何一條替代解法都算解開這道題。</p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={handleClearLastMove} disabled={(lines[activeLineIndex]?.length ?? 0) === 0} className={SECONDARY_BUTTON_CLASS_NAME}>↩️ 清除最後一步</button>
                <button type="button" onClick={handleClearAllMoves} disabled={!isSetupLocked} className={SECONDARY_BUTTON_CLASS_NAME}>🗑️ 清空所有線</button>
              </div>
              <div className="mt-3 rounded-2xl bg-white/80 px-3 py-3">
                <p className="text-xs font-semibold text-[#1A1A2E]/70">
                  {activeLineIndex === 0 ? "主線" : `替代解法 ${activeLineIndex}`}已錄製步驟（{(lines[activeLineIndex] ?? []).length} 步）
                </p>
                {(lines[activeLineIndex]?.length ?? 0) === 0 ? (
                  <p className="mt-1 text-xs text-[#1A1A2E]/50">目前這條線還沒有錄製任何步驟。</p>
                ) : (
                  <ol className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium text-[#1A1A2E]">
                    {(lines[activeLineIndex] ?? []).map((notation, index) => (
                      <li key={`${index}-${notation}`} className="tabular-nums">{index + 1}. {notation.slice(0, 2)}-{notation.slice(2, 4)}</li>
                    ))}
                  </ol>
                )}
              </div>
            </section>

            <section className="rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1A1A2E]">🏷️ 關卡後設資料與上架</h2>
                {editingPuzzleId ? (
                  <button type="button" onClick={resetEditorToBlankState} className="text-xs font-bold text-[#1A1A2E]/60 hover:underline">➕ 開始新題目</button>
                ) : null}
              </div>
              {editingPuzzleId ? (
                <p className="mt-2 rounded-xl bg-[#8B5FBF]/10 px-3 py-2 text-xs font-medium text-[#8B5FBF]">
                  ✏️ 正在編輯既有題目「{editingPuzzleId}」，關卡 ID 不能修改。發布會直接覆蓋這一題，不會建立新文件。
                </p>
              ) : null}
              <div className="mt-3 flex flex-col gap-3">
                <Field label="關卡 ID（將作為 Firestore 文件 ID：puzzles/{id}）">
                  <input type="text" value={puzzleId} onChange={(e) => setPuzzleId(e.target.value)} placeholder="例如：demo-puzzle-002" disabled={editingPuzzleId !== null} className={INPUT_CLASS_NAME} />
                </Field>
                <Field label="關卡名稱">
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：馬後炮絕殺" className={INPUT_CLASS_NAME} />
                </Field>
                <Field label="關卡描述">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="給學生的提示或敘述" className={INPUT_CLASS_NAME} />
                </Field>
                <Field label="難度等級（1 級～10 級，直接對應 PuzzleDoc.level）">
                  <select value={level} onChange={(e) => setLevel(Number(e.target.value) as PuzzleLevel)} className={INPUT_CLASS_NAME}>
                    {LEVEL_OPTIONS.map((option) => <option key={option} value={option}>{option} 級</option>)}
                  </select>
                </Field>
              </div>
              {publishError ? <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">{publishError}</p> : null}
              <button type="button" onClick={handlePublish} disabled={isPublishing} className="mt-4 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60">
                {isPublishing ? (editingPuzzleId ? "更新中…" : "上架中…") : (editingPuzzleId ? "💾 更新題目" : "🚀 一鍵上架")}
              </button>
            </section>
          </div>
        </div>
      </div>

      {toastMessage ? (
        <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="rounded-full bg-[#1A1A2E] px-5 py-2.5 text-sm font-semibold text-white shadow-lg">✅ {toastMessage}</div>
        </div>
      ) : null}
    </main>
  );
}

function toFenSafely(board: BoardGrid): string {
  try { return toFen(board); }
  catch (error) { console.error("[admin] 棋盤無法編碼成 FEN：", error); return "（棋盤格式錯誤，無法產生 FEN）"; }
}

function ExistingPuzzlesSection({ onEditPuzzle }: { onEditPuzzle: (puzzle: PuzzleDoc) => void }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [puzzles, setPuzzles] = useState<PuzzleDoc[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // 展開時才撈，撈過一次後不再重複撈（除非手動「重新整理」）
  useEffect(() => {
    if (isExpanded && status === "idle") {
      fetchPuzzles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  async function fetchPuzzles() {
    setStatus("loading");
    setFetchErrorMessage(null);
    try {
      const snapshot = await getDocs(collection(db, "puzzles"));
      const list = snapshot.docs
        .map((d) => d.data() as PuzzleDoc)
        .sort((a, b) => a.level - b.level || a.title.localeCompare(b.title));
      setPuzzles(list);
      setStatus("success");
    } catch (error) {
      console.error("[admin] 讀取現有題目失敗：", error);
      setFetchErrorMessage(error instanceof Error ? error.message : "讀取題目列表時發生未知錯誤。");
      setStatus("error");
    }
  }

  async function handleConfirmDelete(puzzleId: string) {
    setDeletingId(puzzleId);
    setDeleteErrorMessage(null);
    try {
      await deleteDoc(doc(db, "puzzles", puzzleId));
      setPuzzles((prev) => prev.filter((p) => p.id !== puzzleId));
    } catch (error) {
      console.error("[admin] 刪除題目失敗：", error);
      setDeleteErrorMessage(error instanceof Error ? `刪除失敗：${error.message}` : "刪除時發生未知錯誤，請稍後再試。");
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  async function handleImportJson(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;

    setImportError(null);
    setImportProgress({ done: 0, total: 0 });

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      setImportError("JSON 格式錯誤，無法解析。");
      setImportProgress(null);
      return;
    }
    if (!Array.isArray(raw) || raw.length === 0) {
      setImportError("JSON 必須是非空陣列。");
      setImportProgress(null);
      return;
    }

    const items = raw as PuzzleDoc[];
    setImportProgress({ done: 0, total: items.length });

    const BATCH_SIZE = 400;
    let done = 0;
    try {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const chunk = items.slice(i, i + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const puzzle of chunk) {
          if (!puzzle.id) continue;
          batch.set(doc(db, "puzzles", puzzle.id), puzzle);
        }
        await batch.commit();
        done += chunk.length;
        setImportProgress({ done, total: items.length });
      }
    } catch (error) {
      setImportError(error instanceof Error ? `匯入失敗：${error.message}` : "匯入時發生未知錯誤。");
      setImportProgress(null);
      return;
    }

    setImportProgress(null);
    // 匯入完成後重新撈，讓列表顯示最新狀態
    setStatus("idle");
    if (isExpanded) fetchPuzzles();
  }

  return (
    <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
      {/* 標題列：折疊開關 + 工具按鈕 */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-sm font-bold text-[#1A1A2E] transition-transform active:scale-95"
        >
          <span className={["transition-transform duration-200", isExpanded ? "rotate-90" : ""].join(" ")}>▶</span>
          📋 現有題目管理
          {status === "success" ? (
            <span className="rounded-full bg-[#1A1A2E]/10 px-2 py-0.5 text-xs font-normal text-[#1A1A2E]/60">
              {puzzles.length} 題
            </span>
          ) : null}
        </button>

        {isExpanded ? (
          <div className="flex items-center gap-3">
            <input ref={importFileRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportJson} />
            <button type="button" onClick={() => importFileRef.current?.click()} disabled={importProgress !== null}
              className="text-xs font-bold text-[#5B8C5A] hover:underline disabled:cursor-not-allowed disabled:opacity-50">
              {importProgress ? `匯入中… ${importProgress.done}/${importProgress.total}` : "📥 上傳 JSON 匯入"}
            </button>
            <button type="button" onClick={() => { setStatus("idle"); fetchPuzzles(); }} className="text-xs font-bold text-[#1A1A2E]/60 hover:underline">
              🔄 重新整理
            </button>
          </div>
        ) : null}
      </div>

      {/* 折疊內容 */}
      {isExpanded ? (
        <div className="mt-3">
          {deleteErrorMessage ? <p className="mb-2 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">{deleteErrorMessage}</p> : null}
          {importError ? <p className="mb-2 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">{importError}</p> : null}

          {status === "idle" || status === "loading" ? (
            <p className="text-xs text-[#1A1A2E]/50">題目列表載入中…</p>
          ) : status === "error" ? (
            <p className="text-xs text-[#C0392B]">{fetchErrorMessage ?? "讀取題目列表失敗，請稍後再試。"}</p>
          ) : puzzles.length === 0 ? (
            <p className="text-xs text-[#1A1A2E]/50">目前還沒有任何題目，可以在下方建立第一道題目。</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {puzzles.map((puzzle) => {
                const isConfirming = confirmingDeleteId === puzzle.id;
                const isDeleting = deletingId === puzzle.id;
                return (
                  <li key={puzzle.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#1A1A2E]">
                        {puzzle.title}
                        <span className="ml-1 text-xs font-normal text-[#1A1A2E]/50">
                          (Lv.{puzzle.level} ・ 主線 {puzzle.moves.length} 步
                          {puzzle.alternativeLines && puzzle.alternativeLines.length > 0 ? ` ・ ${puzzle.alternativeLines.length} 條替代解法` : ""}
                          ・ {puzzle.isPublished ? "已上架" : "未上架"})
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-[#1A1A2E]/40">ID: {puzzle.id}</p>
                    </div>
                    {isConfirming ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-bold text-[#C0392B]">確定刪除？</span>
                        <button type="button" onClick={() => handleConfirmDelete(puzzle.id)} disabled={isDeleting} className="rounded-lg bg-[#C0392B] px-2 py-1 text-xs font-bold text-white disabled:opacity-50">
                          {isDeleting ? "刪除中…" : "確定"}
                        </button>
                        <button type="button" onClick={() => setConfirmingDeleteId(null)} disabled={isDeleting} className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30">
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => onEditPuzzle(puzzle)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#8B5FBF] ring-1 ring-inset ring-[#8B5FBF]/30 transition-transform active:scale-95">✏️ 編輯</button>
                        <button type="button" onClick={() => setConfirmingDeleteId(puzzle.id)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95">🗑️ 刪除</button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
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

const ADMIN_BOARD_CELL = 50;
const ADMIN_BOARD_MARGIN = 32;
const ADMIN_BOARD_WIDTH = ADMIN_BOARD_MARGIN * 2 + ADMIN_BOARD_CELL * 8;
const ADMIN_BOARD_HEIGHT = ADMIN_BOARD_MARGIN * 2 + ADMIN_BOARD_CELL * 9;
const ADMIN_BOARD_LINE_COLOR = "#5C3D0A";

function adminBoardPointOf(row: number, col: number): { x: number; y: number } {
  return { x: ADMIN_BOARD_MARGIN + col * ADMIN_BOARD_CELL, y: ADMIN_BOARD_MARGIN + row * ADMIN_BOARD_CELL };
}

function AdminChessBoard({ board, selectedCell, onCellClick, disabled }: { board: BoardGrid; selectedCell: Position | null; onCellClick: (row: number, col: number) => void; disabled?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <svg viewBox={`0 0 ${ADMIN_BOARD_WIDTH} ${ADMIN_BOARD_HEIGHT}`} className="h-auto w-full rounded-2xl border-4 border-[#A9764C] bg-[#E8D5B5] p-1 shadow-inner" role="group" aria-label="象棋棋盤">
        {Array.from({ length: 10 }, (_, row) => { const y = ADMIN_BOARD_MARGIN + row * ADMIN_BOARD_CELL; return <line key={`h-${row}`} x1={ADMIN_BOARD_MARGIN} y1={y} x2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 8} y2={y} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />; })}
        {Array.from({ length: 9 }, (_, col) => { const x = ADMIN_BOARD_MARGIN + col * ADMIN_BOARD_CELL; const isOuter = col === 0 || col === 8; if (isOuter) return <line key={`v-${col}`} x1={x} y1={ADMIN_BOARD_MARGIN} x2={x} y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 9} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />; return <g key={`v-${col}`}><line x1={x} y1={ADMIN_BOARD_MARGIN} x2={x} y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 4} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} /><line x1={x} y1={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 5} x2={x} y2={ADMIN_BOARD_MARGIN + ADMIN_BOARD_CELL * 9} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} /></g>; })}
        <line x1={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL} y1={ADMIN_BOARD_MARGIN} x2={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL} y2={ADMIN_BOARD_MARGIN + 2 * ADMIN_BOARD_CELL} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />
        <line x1={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL} y1={ADMIN_BOARD_MARGIN} x2={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL} y2={ADMIN_BOARD_MARGIN + 2 * ADMIN_BOARD_CELL} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />
        <line x1={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL} y1={ADMIN_BOARD_MARGIN + 7 * ADMIN_BOARD_CELL} x2={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL} y2={ADMIN_BOARD_MARGIN + 9 * ADMIN_BOARD_CELL} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />
        <line x1={ADMIN_BOARD_MARGIN + 5 * ADMIN_BOARD_CELL} y1={ADMIN_BOARD_MARGIN + 7 * ADMIN_BOARD_CELL} x2={ADMIN_BOARD_MARGIN + 3 * ADMIN_BOARD_CELL} y2={ADMIN_BOARD_MARGIN + 9 * ADMIN_BOARD_CELL} stroke={ADMIN_BOARD_LINE_COLOR} strokeWidth={1.5} />
        <text x={ADMIN_BOARD_MARGIN + 1.5 * ADMIN_BOARD_CELL} y={ADMIN_BOARD_MARGIN + 4.5 * ADMIN_BOARD_CELL + 7} fontSize={20} fill="#A9764C" fontWeight="bold" textAnchor="middle" style={{ userSelect: "none" }}>楚河</text>
        <text x={ADMIN_BOARD_MARGIN + 6.5 * ADMIN_BOARD_CELL} y={ADMIN_BOARD_MARGIN + 4.5 * ADMIN_BOARD_CELL + 7} fontSize={20} fill="#A9764C" fontWeight="bold" textAnchor="middle" style={{ userSelect: "none" }}>漢界</text>
        {board.map((rowCells, rowIndex) => rowCells.map((cell, colIndex) => {
          const { x, y } = adminBoardPointOf(rowIndex, colIndex);
          const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === colIndex;
          const squareLabel = formatSquare({ row: rowIndex, col: colIndex });
          return (
            <g key={`${rowIndex}-${colIndex}`} role="button" tabIndex={disabled ? -1 : 0}
              aria-label={`座標 ${squareLabel}${cell ? `，${cell.color === "r" ? "紅方" : "黑方"}${PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}` : ""}`}
              onClick={() => onCellClick(rowIndex, colIndex)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCellClick(rowIndex, colIndex); } }}
              style={{ cursor: disabled ? "not-allowed" : "pointer", outline: "none" }}>
              <circle cx={x} cy={y} r={ADMIN_BOARD_CELL * 0.48} fill="transparent" />
              {isSelected ? <circle cx={x} cy={y} r={ADMIN_BOARD_CELL * 0.42} fill="none" stroke="#E8B84B" strokeWidth={3} /> : null}
              {cell ? (
                <>
                  <circle cx={x} cy={y} r={ADMIN_BOARD_CELL * 0.38} fill={cell.color === "r" ? "#C0392B" : "#1A1A2E"} stroke={cell.color === "r" ? "#8E2A1F" : "#0F0F1A"} strokeWidth={2} />
                  <text x={x} y={y} fontSize={ADMIN_BOARD_CELL * 0.38} fill="#FDF6E8" fontWeight="bold" textAnchor="middle" dominantBaseline="central" style={{ pointerEvents: "none", userSelect: "none" }}>
                    {PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}
                  </text>
                </>
              ) : null}
            </g>
          );
        }))}
      </svg>
    </div>
  );
}

export default function AdminPuzzleEditorPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <AdminPuzzleEditorPageContent />
    </RequireAuth>
  );
}
