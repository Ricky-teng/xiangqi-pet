/**
 * src/components/ChessBoard.tsx
 *
 * 前端棋盤 UI 元件
 * ------------------------------------------------------------
 * 職責：
 *   1. 將 10x9 的 BoardGrid 渲染成可互動的棋盤。
 *   2. 採用「點選式」走棋：先點起點（高亮顯示），再點終點，
 *      組合成四字元走法記號（例如 "h2e2"）後呼叫 onMove。
 *
 * 【這一版的關鍵修正：棋子畫在「線條交叉點」上，不是塞進方格裡】
 *   真正的象棋棋盤是「9 條直線 x 10 條橫線」交織出的格線，棋子放在
 *   線與線的交叉點上（跟圍棋盤一樣），不是像西洋棋/跳棋那樣放在
 *   一格一格的方塊裡。上一版用 CSS Grid 畫出 9x10 個方塊、棋子置中
 *   填滿在方塊裡，視覺上看起來完全不對。這一版改用 SVG 直接畫線：
 *     - 10 條橫線：每條都是貫通整個寬度的直線（橫線不會被楚河中斷）。
 *     - 9 條直線：最左、最右兩條直線貫通全高；中間 7 條直線在楚河
 *       （row 4 與 row 5 之間）斷開，留出「楚河漢界」的視覺空白帶，
 *       這正是象棋棋盤的標誌性外觀。
 *     - 上下各一個九宮格（將/帥所在區域）有 X 形斜線。
 *     - 棋子是畫在交叉點正中心的圓形 + 文字，而不是填滿某個方格。
 *   點擊判定範圍是以交叉點為圓心的隱藏熱區（比視覺上的棋子圓圈再大
 *   一些，方便手指點擊），語意完全沒變：點起點、點終點、送出記號。
 *
 * 設計說明：
 *   - 本元件是純展示 + 互動收集層，不做任何象棋規則驗證
 *     （不檢查棋子能不能那樣走），完全對應後端 Hook 的策略：
 *     「比對是否等於正解序列當前步」由 usePuzzleSolver 負責，
 *     ChessBoard 只負責把「玩家點了哪兩個交叉點」轉成記號丟出去。
 *   - 棋子視覺採用圓形文字標籤（將/帥/車/馬/炮/相/仕/兵 等中文字），
 *     紅黑配色對比清楚，符合手遊風格的可愛感。
 *   - 點起點後再點同一格＝取消選取；點起點後點任意其他格＝視為終點並送出。
 *   - 對外的 props 介面（ChessBoardProps）完全沒變，呼叫端
 *     （puzzle/[id]/page.tsx 的 PuzzleSolverSection）不需要修改。
 */

"use client";

import { useState, type KeyboardEvent } from "react";
import type { BoardGrid } from "@/types/xiangqi";
import { PIECE_LABEL } from "@/types/xiangqi";
import { formatSquare } from "@/lib/xiangqi/move";

// ============================================================
// 1. 棋子顯示文字對照表
// ============================================================

// ============================================================
// 2. 棋盤幾何常數
// ------------------------------------------------------------
// CELL：交叉點之間的間距；MARGIN：棋盤四周留白。
// 9 條直線 = 8 個欄間距；10 條橫線 = 9 個列間距。
// ============================================================

const CELL = 50;
const MARGIN = 32;
const BOARD_WIDTH = MARGIN * 2 + CELL * 8;
const BOARD_HEIGHT = MARGIN * 2 + CELL * 9;
const LINE_COLOR = "#5C3D0A";
const RIVER_ROW_TOP = 4; // 楚河上緣（row 4 這條橫線之下開始是河面）
const RIVER_ROW_BOTTOM = 5; // 楚河下緣

function pointOf(row: number, col: number): { x: number; y: number } {
  return { x: MARGIN + col * CELL, y: MARGIN + row * CELL };
}

// ============================================================
// 3. Props 定義
// ============================================================

export interface ChessBoardProps {
  /** 目前棋盤狀態（10x9，grid[row][col]） */
  board: BoardGrid;
  /** 學生完成一次「起點+終點」點選後呼叫，傳入四字元走法記號（例如 "h2e2"） */
  onMove: (moveNotation: string) => void;
  /**
   * 選用：在棋盤上畫一條箭頭標示某一步走法（給「分析」功能顯示引擎
   * 建議走法用）。格式跟 onMove 一樣是這個 App 的座標記號，但拆成
   * from/to 兩段字串（例如 from:"h9", to:"g7"）。不提供就不畫箭頭，
   * 不影響其他既有用法（解題、對弈、回放都不需要這個 prop）。
   */
  highlightMove?: { from: string; to: string } | null;
  /**
   * 選用：標示「剛剛走的這一步」（起點+終點的格子各畫一個淡色外框）。
   * 跟 highlightMove（分析建議的箭頭）是不同用途、可以同時存在：這個
   * 是「剛剛實際發生的事」，highlightMove 是「引擎建議接下來怎麼走」。
   * 主要解決「電腦走完棋，學生看不出電腦剛剛動了哪顆子」的問題——
   * 棋子是瞬間換到新位置的（沒有滑動動畫），如果沒有額外標示，
   * 在棋子比較密集的局面裡很容易看漏電腦剛剛走的是哪一步。
   */
  lastMove?: { from: string; to: string } | null;
}

function parseSquareLabel(square: string): { row: number; col: number } {
  const col = square.charCodeAt(0) - "a".charCodeAt(0);
  const row = Number(square[1]);
  return { row, col };
}

// ============================================================
// 4. 主體元件
// ============================================================

export default function ChessBoard({ board, onMove, highlightMove, lastMove }: ChessBoardProps) {
  const [selectedFrom, setSelectedFrom] = useState<{ row: number; col: number } | null>(null);

  function handleCellClick(row: number, col: number) {
    const cellPiece = board[row]?.[col];

    if (!selectedFrom) {
      if (cellPiece) {
        setSelectedFrom({ row, col });
      }
      return;
    }

    const isSameCell = selectedFrom.row === row && selectedFrom.col === col;

    if (isSameCell) {
      setSelectedFrom(null);
      return;
    }

    const fromNotation = formatSquare(selectedFrom);
    const toNotation = formatSquare({ row, col });
    onMove(`${fromNotation}${toNotation}`);

    setSelectedFrom(null);
  }

  function handleCellKeyDown(event: KeyboardEvent<SVGGElement>, row: number, col: number) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCellClick(row, col);
    }
  }

  return (
    <div className="relative w-full max-w-md mx-auto">
      <svg
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        className="h-auto w-full rounded-2xl border-4 border-[#A9764C] bg-[#E8D5B5] p-1 shadow-inner"
        role="group"
        aria-label="象棋棋盤"
      >
        {/* ---- 橫線：10 條，每條都貫通整個寬度 ---- */}
        {Array.from({ length: 10 }, (_, row) => {
          const y = MARGIN + row * CELL;
          return (
            <line
              key={`h-${row}`}
              x1={MARGIN}
              y1={y}
              x2={MARGIN + CELL * 8}
              y2={y}
              stroke={LINE_COLOR}
              strokeWidth={1.5}
            />
          );
        })}

        {/* ---- 直線：9 條。最左/最右貫通全高；中間 7 條在楚河斷開 ---- */}
        {Array.from({ length: 9 }, (_, col) => {
          const x = MARGIN + col * CELL;
          const isOuterEdge = col === 0 || col === 8;

          if (isOuterEdge) {
            return (
              <line
                key={`v-${col}`}
                x1={x}
                y1={MARGIN}
                x2={x}
                y2={MARGIN + CELL * 9}
                stroke={LINE_COLOR}
                strokeWidth={1.5}
              />
            );
          }

          return (
            <g key={`v-${col}`}>
              <line
                x1={x}
                y1={MARGIN}
                x2={x}
                y2={MARGIN + CELL * RIVER_ROW_TOP}
                stroke={LINE_COLOR}
                strokeWidth={1.5}
              />
              <line
                x1={x}
                y1={MARGIN + CELL * RIVER_ROW_BOTTOM}
                x2={x}
                y2={MARGIN + CELL * 9}
                stroke={LINE_COLOR}
                strokeWidth={1.5}
              />
            </g>
          );
        })}

        {/* ---- 上方九宮格斜線（黑方將的保護區，row 0~2、col 3~5） ---- */}
        <line
          x1={MARGIN + 3 * CELL}
          y1={MARGIN}
          x2={MARGIN + 5 * CELL}
          y2={MARGIN + 2 * CELL}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={MARGIN + 5 * CELL}
          y1={MARGIN}
          x2={MARGIN + 3 * CELL}
          y2={MARGIN + 2 * CELL}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
        />

        {/* ---- 下方九宮格斜線（紅方帥的保護區，row 7~9、col 3~5） ---- */}
        <line
          x1={MARGIN + 3 * CELL}
          y1={MARGIN + 7 * CELL}
          x2={MARGIN + 5 * CELL}
          y2={MARGIN + 9 * CELL}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
        />
        <line
          x1={MARGIN + 5 * CELL}
          y1={MARGIN + 7 * CELL}
          x2={MARGIN + 3 * CELL}
          y2={MARGIN + 9 * CELL}
          stroke={LINE_COLOR}
          strokeWidth={1.5}
        />

        {/* ---- 楚河漢界文字 ---- */}
        <text
          x={MARGIN + 1.5 * CELL}
          y={MARGIN + 4.5 * CELL + 7}
          fontSize={20}
          fill="#A9764C"
          fontWeight="bold"
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          楚河
        </text>
        <text
          x={MARGIN + 6.5 * CELL}
          y={MARGIN + 4.5 * CELL + 7}
          fontSize={20}
          fill="#A9764C"
          fontWeight="bold"
          textAnchor="middle"
          style={{ userSelect: "none" }}
        >
          漢界
        </text>

        {/* ---- 剛剛走的這一步：起點/終點各畫一個淡色方塊，解決電腦
            走完棋、學生看不出剛剛動了哪顆子的問題（棋子是瞬間換位置，
            沒有滑動動畫，密集局面很容易看漏）。畫在棋子下面（這段在
            棋子渲染迴圈之前），不會蓋住棋子本身。 ---- */}
        {lastMove
          ? [parseSquareLabel(lastMove.from), parseSquareLabel(lastMove.to)].map((square, index) => {
              const { x, y } = pointOf(square.row, square.col);
              return (
                <rect
                  key={`last-move-${index}`}
                  x={x - CELL * 0.42}
                  y={y - CELL * 0.42}
                  width={CELL * 0.84}
                  height={CELL * 0.84}
                  fill="#E8B84B"
                  opacity={0.35}
                  rx={CELL * 0.12}
                  style={{ pointerEvents: "none" }}
                />
              );
            })
          : null}

        {/* ---- 交叉點：點擊熱區 + 選取高光 + 棋子 ---- */}
        {board.map((rowCells, rowIndex) =>
          rowCells.map((cell, colIndex) => {
            const { x, y } = pointOf(rowIndex, colIndex);
            const isSelected =
              selectedFrom?.row === rowIndex && selectedFrom?.col === colIndex;
            const squareLabel = formatSquare({ row: rowIndex, col: colIndex });

            return (
              <g
                key={`${rowIndex}-${colIndex}`}
                role="button"
                tabIndex={0}
                aria-label={`座標 ${squareLabel}${cell ? `，${cell.color === "r" ? "紅方" : "黑方"}${PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}` : ""}`}
                onClick={() => handleCellClick(rowIndex, colIndex)}
                onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex)}
                style={{ cursor: "pointer", outline: "none" }}
              >
                {/* 隱藏點擊熱區：比實際棋子稍大，方便手指點擊交叉點 */}
                <circle cx={x} cy={y} r={CELL * 0.48} fill="transparent" />

                {isSelected ? (
                  <circle
                    cx={x}
                    cy={y}
                    r={CELL * 0.48}
                    fill="#E8B84B"
                    opacity={0.25}
                  />
                ) : null}

                {cell ? (
                  <g
                    style={{
                      filter: isSelected ? "drop-shadow(0 2px 6px rgba(0,0,0,0.5))" : "none",
                    }}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={CELL * 0.38}
                      fill={cell.color === "r" ? "#C0392B" : "#1A1A2E"}
                      stroke={isSelected ? "#E8B84B" : (cell.color === "r" ? "#8E2A1F" : "#0F0F1A")}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    <text
                      x={x}
                      y={y}
                      fontSize={CELL * 0.38}
                      fill="#FDF6E8"
                      fontWeight="bold"
                      textAnchor="middle"
                      dominantBaseline="central"
                      style={{ pointerEvents: "none", userSelect: "none" }}
                    >
                      {PIECE_LABEL[cell.type][cell.color === "r" ? "red" : "black"]}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })
        )}

        {/* 分析建議走法箭頭：用 marker 畫箭頭尖端，從起點畫到終點，
            終點稍微往回縮一點距離，不要整個箭頭蓋住棋子本身。 */}
        {highlightMove ? (
          <g style={{ pointerEvents: "none" }}>
            <defs>
              <marker
                id="analysis-arrow-head"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#8B5FBF" />
              </marker>
            </defs>
            {(() => {
              const fromSquare = parseSquareLabel(highlightMove.from);
              const toSquare = parseSquareLabel(highlightMove.to);
              const fromPoint = pointOf(fromSquare.row, fromSquare.col);
              const toPoint = pointOf(toSquare.row, toSquare.col);
              // 終點往回縮短一點距離，讓箭頭尖端停在棋子外緣附近，
              // 不會完全蓋住目的地的棋子。
              const dx = toPoint.x - fromPoint.x;
              const dy = toPoint.y - fromPoint.y;
              const length = Math.hypot(dx, dy) || 1;
              const shrink = CELL * 0.42;
              const trimmedToX = toPoint.x - (dx / length) * shrink;
              const trimmedToY = toPoint.y - (dy / length) * shrink;
              return (
                <line
                  x1={fromPoint.x}
                  y1={fromPoint.y}
                  x2={trimmedToX}
                  y2={trimmedToY}
                  stroke="#8B5FBF"
                  strokeWidth={CELL * 0.12}
                  strokeLinecap="round"
                  markerEnd="url(#analysis-arrow-head)"
                  opacity={0.85}
                />
              );
            })()}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
