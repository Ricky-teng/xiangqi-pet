// src/components/tutorial/TutorialOverlay.tsx
/**
 * 新手教學：全螢幕分頁卡片
 * ------------------------------------------------------------
 * 目的：讓「完全不會下象棋」的學生也能玩這個遊戲。重點放在教象棋
 * 規則本身（棋盤、九宮格、楚河漢界、七種兵種怎麼走、怎麼算贏），
 * 不是教這個 App 的功能操作（養小雞、商店、抽獎那些）——這是刻意
 * 的範圍取捨，避免一次塞太多東西讓新手更混亂。
 *
 * 呈現形式：一頁一個重點的卡片，上一步/下一步切換，右上角可以跳過。
 * 每張卡片可以搭配一個示範棋盤（重用 ChessBoard 元件本身，onMove
 * 傳空函式讓它變成唯讀展示，highlightMove 畫一個示範箭頭）。
 *
 * 觸發時機：見 src/app/page.tsx，只在 user.hasSeenTutorial === false
 * 時顯示（新帳號預設值，見 useAuth.ts）。看完或跳過都會呼叫
 * onFinish，由外層負責把 hasSeenTutorial 寫回 Firestore。
 */

"use client";

import { useState } from "react";
import ChessBoard from "@/components/ChessBoard";
import { formatSquare } from "@/lib/xiangqi/move";
import {
  standardOpeningBoard,
  kingDemoBoard,
  advisorDemoBoard,
  elephantDemoBoard,
  horseDemoBoard,
  chariotDemoBoard,
  cannonDemoBoard,
  pawnBeforeRiverDemoBoard,
} from "@/lib/tutorial/demoBoards";
import type { BoardGrid } from "@/types/xiangqi";

interface TutorialCard {
  emoji: string;
  title: string;
  body: string[];
  board?: BoardGrid;
  highlightMove?: { from: string; to: string } | null;
  boardCaption?: string;
}

const sq = (row: number, col: number) => formatSquare({ row, col });

const CARDS: TutorialCard[] = [
  {
    emoji: "🐣",
    title: "歡迎來到象棋寵物！",
    body: [
      "這是一款「養小雞」+「學下象棋」的遊戲：解開象棋殘局、跟電腦或其他玩家對弈，都可以賺飼料把小雞養大。",
      "完全不會下象棋也沒關係！接下來幾張卡片會帶你認識象棋的基本規則，看完就能上手了。",
    ],
  },
  {
    emoji: "🀄",
    title: "認識棋盤",
    body: [
      "象棋棋盤有 9 條直線、10 條橫線，棋子是下在「線與線的交叉點」上，不是格子裡面。",
      "中間留白的一條叫「楚河漢界」，是雙方的分界線。上下各有一個 3×3 的小方格區域叫「九宮格」，將／帥只能待在自己這邊的九宮格裡。",
    ],
    board: standardOpeningBoard(),
    boardCaption: "這是象棋的標準開局擺法",
  },
  {
    emoji: "🔴",
    title: "你永遠是紅方",
    body: [
      "棋子分紅、黑兩色。在這個遊戲裡，你操作的永遠是紅方（下方），對手（電腦或其他玩家）是黑方（上方）。",
      "紅方先走。接下來介紹每一種棋子的走法時，都會用紅方棋子示範。",
    ],
  },
  {
    emoji: "👑",
    title: "帥／將",
    body: [
      "帥（紅方）／將（黑方）是最重要的棋子，只能在自己的九宮格裡走，一次一格，只能直走不能斜走。",
      "特殊規則：兩邊的帥／將不能在同一條直線上「面對面」、中間沒有任何棋子隔著，這叫「將帥不能對面」。",
    ],
    board: kingDemoBoard(),
    highlightMove: { from: sq(8, 4), to: sq(7, 4) },
    boardCaption: "帥只能在九宮格內直走一格",
  },
  {
    emoji: "🛡️",
    title: "仕／士",
    body: ["仕（紅方）／士（黑方）也只能在九宮格裡活動，一次斜走一格，負責保護帥／將。"],
    board: advisorDemoBoard(),
    highlightMove: { from: sq(9, 3), to: sq(8, 4) },
    boardCaption: "仕只能在九宮格內斜走一格",
  },
  {
    emoji: "🐘",
    title: "相／象",
    body: [
      "相（紅方）／象（黑方）走「田」字型：斜線移動兩格。",
      "有兩個限制：不能過河（只能在自己這一半的棋盤活動），而且如果「田」字中間那一點有棋子擋著（叫「塞象眼」），就不能走。",
    ],
    board: elephantDemoBoard(),
    highlightMove: { from: sq(9, 2), to: sq(7, 4) },
    boardCaption: "相走田字，不能過河",
  },
  {
    emoji: "🐴",
    title: "馬",
    body: [
      "馬走「日」字型：先直走一格、再斜走一格（或反過來）。",
      "如果馬正前方（走直線的那一格）有棋子擋著，就不能往那個方向走，這叫「蹩馬腳」。",
    ],
    board: horseDemoBoard(),
    highlightMove: { from: sq(9, 1), to: sq(7, 2) },
    boardCaption: "馬走日字型（直一格+斜一格）",
  },
  {
    emoji: "🚗",
    title: "車",
    body: ["車是威力最強的棋子之一：可以直走或橫走，只要中間沒有棋子擋著，要走幾格都可以。"],
    board: chariotDemoBoard(),
    highlightMove: { from: sq(9, 0), to: sq(3, 0) },
    boardCaption: "車可以直線走任意格數",
  },
  {
    emoji: "💣",
    title: "炮",
    body: [
      "炮平常走法跟車一樣（直線走任意格數、中間不能擋子）。",
      "但吃子的時候規則不一樣：中間必須剛好隔一顆棋子（不管是自己還是對方的都可以，這顆叫「炮架」），才能跳過去吃掉再過去那顆棋子。",
    ],
    board: cannonDemoBoard(),
    highlightMove: { from: sq(6, 4), to: sq(1, 4) },
    boardCaption: "中間隔一顆「炮架」才能跳吃",
  },
  {
    emoji: "🚶",
    title: "兵／卒",
    body: [
      "兵（紅方）／卒（黑方）過河之前，只能一次往前走一格。",
      "一旦過了河，就多了左右移動的能力（還是一次一格），但不管有沒有過河，永遠不能往後退。",
    ],
    board: pawnBeforeRiverDemoBoard(),
    highlightMove: { from: sq(6, 4), to: sq(5, 4) },
    boardCaption: "過河前：只能往前走一格",
  },
  {
    emoji: "🏆",
    title: "怎麼算贏？",
    body: [
      "把對方的帥／將逼到無路可逃（不管怎麼走都還是會被吃掉）就贏了，這叫「將死」。",
      "遊戲裡的「殘局解謎」就是在練習這種「找出將死對方的關鍵一步」的能力，一步一步累積，你也能看懂整盤棋的攻防。",
    ],
  },
  {
    emoji: "🎮",
    title: "準備好了嗎？",
    body: [
      "在這個 App 裡下棋很簡單：點一下想移動的棋子（會被反白選取），再點一下想移動到的位置，就完成一步了。",
      "殘局解謎會照著提示一步步練習；對電腦下棋、跟其他玩家對戰則是真正自由對局。開始你的象棋小雞冒險吧！",
    ],
  },
];

export default function TutorialOverlay({ onFinish }: { onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const card = CARDS[index];
  const isFirst = index === 0;
  const isLast = index === CARDS.length - 1;

  function goNext() {
    if (isLast) {
      onFinish();
      return;
    }
    setIndex((i) => Math.min(i + 1, CARDS.length - 1));
  }

  function goPrev() {
    setIndex((i) => Math.max(i - 1, 0));
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#FDF6E8]">
      {/* ---- 頂部：進度點 + 跳過 ---- */}
      <div className="flex items-center justify-between px-4 pt-4">
        <div className="flex gap-1">
          {CARDS.map((_, i) => (
            <span
              key={i}
              className={[
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-[#8B5FBF]" : "w-1.5 bg-[#8B5FBF]/25",
              ].join(" ")}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onFinish}
          className="rounded-full bg-[#1A1A2E]/5 px-3 py-1 text-xs font-bold text-[#1A1A2E]/50 transition-transform active:scale-95"
        >
          跳過教學
        </button>
      </div>

      {/* ---- 卡片內容 ---- */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto px-6 pb-4 pt-6">
        <div className="mx-auto w-full max-w-md">
          <p className="text-center text-5xl" aria-hidden="true">
            {card.emoji}
          </p>
          <h1 className="mt-3 text-center text-xl font-extrabold text-[#1A1A2E]">{card.title}</h1>

          <div className="mt-3 flex flex-col gap-2">
            {card.body.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-[#1A1A2E]/80">
                {paragraph}
              </p>
            ))}
          </div>

          {card.board ? (
            <div className="mt-4">
              <ChessBoard board={card.board} onMove={() => {}} highlightMove={card.highlightMove ?? null} />
              {card.boardCaption ? (
                <p className="mt-2 text-center text-xs font-semibold text-[#8B5FBF]">{card.boardCaption}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* ---- 底部：上一步／下一步 ---- */}
      <div className="flex gap-3 px-6 pb-8 pt-2">
        {!isFirst ? (
          <button
            type="button"
            onClick={goPrev}
            className="flex-1 rounded-2xl bg-[#1A1A2E]/10 py-3 text-sm font-bold text-[#1A1A2E]/60 transition-transform active:scale-95"
          >
            上一步
          </button>
        ) : null}
        <button
          type="button"
          onClick={goNext}
          className="flex-[2] rounded-2xl bg-[#8B5FBF] py-3 text-sm font-bold text-white transition-transform active:scale-95"
        >
          {isLast ? "開始遊戲！🐣" : "下一步"}
        </button>
      </div>
    </div>
  );
}
