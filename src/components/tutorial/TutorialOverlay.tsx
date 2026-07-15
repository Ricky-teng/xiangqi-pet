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
 * 傳空函式讓它變成唯讀展示，highlightMoves 一次畫出這個棋子所有能走
 * 的路線；只有單一路線可示範的情境則用 highlightMove）。
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
  cannonMovementDemoBoard,
  cannonDemoBoard,
  pawnComparisonDemoBoard,
  chariotCaptureExercise,
  cannonCaptureExercise,
  horseCaptureExercise,
  horseBlockedDemoBoard,
  elephantBlockedDemoBoard,
  applyMove,
} from "@/lib/tutorial/demoBoards";
import type { BoardGrid } from "@/types/xiangqi";

interface TutorialCard {
  emoji: string;
  title: string;
  body: string[];
  board?: BoardGrid;
  highlightMove?: { from: string; to: string } | null;
  /** 一次畫多條箭頭，展示某個棋子所有能走的路線（跟 highlightMove 二選一） */
  highlightMoves?: { from: string; to: string }[];
  boardCaption?: string;
  /**
   * 選用：在主要示範盤面「旁邊」再放一個獨立的小示範盤面，目前用於
   * 蹩馬腳／塞象眼——不會動到、也不影響上面主要的 board/highlightMoves。
   */
  secondaryBoard?: {
    board: BoardGrid;
    blockedPoints: { row: number; col: number }[];
    caption: string;
    /** 順便畫出「這個方向本來可以走，但現在被擋住了」的箭頭+落點虛圈 */
    highlightMoves?: { from: string; to: string }[];
  };
  /**
   * 有這個欄位代表這張卡片是「互動吃子練習」，不是單純展示：
   * board 會變成真的可以點擊的棋盤，玩家要自己點紅棋、點目標
   * 黑棋完成吃子。correctFrom/correctTo 是唯一正解的那一步。
   */
  practice?: {
    correctFrom: string;
    correctTo: string;
    successMessage: string;
  };
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
    highlightMoves: [
      { from: sq(8, 4), to: sq(7, 4) },
      { from: sq(8, 4), to: sq(9, 4) },
      { from: sq(8, 4), to: sq(8, 3) },
      { from: sq(8, 4), to: sq(8, 5) },
    ],
    boardCaption: "帥只能在九宮格內直走一格，圖中是它所有能走的方向",
  },
  {
    emoji: "🛡️",
    title: "仕／士",
    body: ["仕（紅方）／士（黑方）也只能在九宮格裡活動，一次斜走一格，負責保護帥／將。"],
    board: advisorDemoBoard(),
    highlightMoves: [
      { from: sq(8, 4), to: sq(7, 3) },
      { from: sq(8, 4), to: sq(7, 5) },
      { from: sq(8, 4), to: sq(9, 3) },
      { from: sq(8, 4), to: sq(9, 5) },
    ],
    boardCaption: "仕只能在九宮格內斜走一格，圖中是它所有能走的方向",
  },
  {
    emoji: "🐘",
    title: "相／象",
    body: [
      "相（紅方）／象（黑方）走「田」字型：斜線移動兩格。",
      "有兩個限制：不能過河（只能在自己這一半的棋盤活動），而且如果「田」字中間那一點有棋子擋著（叫「塞象眼」），就不能走。",
    ],
    board: elephantDemoBoard(),
    highlightMoves: [
      { from: sq(7, 4), to: sq(5, 2) },
      { from: sq(7, 4), to: sq(5, 6) },
      { from: sq(7, 4), to: sq(9, 2) },
      { from: sq(7, 4), to: sq(9, 6) },
    ],
    boardCaption: "相走田字，不能過河，圖中是它所有能走的方向",
    secondaryBoard: {
      board: elephantBlockedDemoBoard(),
      blockedPoints: [{ row: 6, col: 3 }],
      highlightMoves: [{ from: sq(7, 4), to: sq(5, 2) }],
      caption: "塞象眼：田字中間那一點（叉叉處）被擋住，這個方向就不能走了",
    },
  },
  {
    emoji: "🐴",
    title: "馬",
    body: [
      "馬走「日」字型：先直走一格、再斜走一格（或反過來）。",
      "如果馬正前方（走直線的那一格）有棋子擋著，就不能往那個方向走，這叫「蹩馬腳」。",
    ],
    board: horseDemoBoard(),
    highlightMoves: [
      { from: sq(5, 4), to: sq(3, 3) },
      { from: sq(5, 4), to: sq(3, 5) },
      { from: sq(5, 4), to: sq(4, 2) },
      { from: sq(5, 4), to: sq(4, 6) },
      { from: sq(5, 4), to: sq(6, 2) },
      { from: sq(5, 4), to: sq(6, 6) },
      { from: sq(5, 4), to: sq(7, 3) },
      { from: sq(5, 4), to: sq(7, 5) },
    ],
    boardCaption: "馬走日字型（直一格+斜一格），圖中是它所有能走的方向",
    secondaryBoard: {
      board: horseBlockedDemoBoard(),
      blockedPoints: [{ row: 4, col: 4 }],
      highlightMoves: [
        { from: sq(5, 4), to: sq(3, 3) },
        { from: sq(5, 4), to: sq(3, 5) },
      ],
      caption: "蹩馬腳：正上方（叉叉處）被擋住，往上的兩個方向就不能走了",
    },
  },
  {
    emoji: "🚗",
    title: "車",
    body: ["車是威力最強的棋子之一：可以直走或橫走，只要中間沒有棋子擋著，要走幾格都可以。"],
    board: chariotDemoBoard(),
    highlightMoves: [
      { from: sq(5, 4), to: sq(0, 4) },
      { from: sq(5, 4), to: sq(9, 4) },
      { from: sq(5, 4), to: sq(5, 0) },
      { from: sq(5, 4), to: sq(5, 8) },
    ],
    boardCaption: "車可以直線走任意格數（箭頭畫到底線，示意方向）",
  },
  {
    emoji: "💣",
    title: "炮",
    body: [
      "炮平常走法跟車一樣（直線走任意格數、中間不能擋子）。",
      "但吃子的時候規則不一樣：中間必須剛好隔一顆棋子（不管是自己還是對方的都可以，這顆叫「炮架」），才能跳過去吃掉再過去那顆棋子。",
    ],
    board: cannonMovementDemoBoard(),
    highlightMoves: [
      { from: sq(5, 4), to: sq(0, 4) },
      { from: sq(5, 4), to: sq(9, 4) },
      { from: sq(5, 4), to: sq(5, 0) },
      { from: sq(5, 4), to: sq(5, 8) },
    ],
    boardCaption: "平常走法跟車一樣，吃子時才需要「炮架」（下一張示範）",
  },
  {
    emoji: "💥",
    title: "炮吃子：需要「炮架」",
    body: [
      "吃子的時候，中間必須剛好隔一顆棋子（不管是自己還是對方的都可以，這顆叫「炮架」），才能跳過去吃掉再過去那顆棋子。",
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
      "一旦過了河，就多了左右移動的能力（還是一次一格），但不管有沒有過河，永遠不能往後退。圖中同時放了兩顆：下面那顆還沒過河，上面那顆已經過河了，可以比較看看走法差在哪。",
    ],
    board: pawnComparisonDemoBoard(),
    highlightMoves: [
      // 還沒過河那顆：只有一個方向（往前）
      { from: sq(6, 2), to: sq(5, 2) },
      // 已經過河那顆：前/左/右三個方向都可以
      { from: sq(4, 6), to: sq(3, 6) },
      { from: sq(4, 6), to: sq(4, 5) },
      { from: sq(4, 6), to: sq(4, 7) },
    ],
    boardCaption: "下面：還沒過河（只能往前）／上面：已經過河（前左右都可以）",
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
    emoji: "🎯",
    title: "來練習吃子吧！",
    body: [
      "光看規則還不夠，實際點點看最快！下面是紅車，正前方有一顆黑馬——先點紅車，再點黑馬，試試看能不能吃掉它。",
    ],
    board: chariotCaptureExercise(),
    practice: {
      correctFrom: sq(9, 0),
      correctTo: sq(5, 0),
      successMessage: "🎉 沒錯！車直線吃掉了黑馬！",
    },
  },
  {
    emoji: "🎯",
    title: "再練習一次：炮吃子",
    body: [
      "這次是炮。中間隔著一顆黑子（炮架），再過去才是真正的目標黑馬——記得，炮一定要隔剛好一個子才能吃！",
      "一樣先點紅炮，再點最遠端的黑馬。",
    ],
    board: cannonCaptureExercise(),
    practice: {
      correctFrom: sq(6, 4),
      correctTo: sq(1, 4),
      successMessage: "🎉 答對了！炮跳過炮架，吃掉了黑馬！",
    },
  },
  {
    emoji: "🎯",
    title: "最後一個：馬吃子",
    body: [
      "馬走日字型，吃子的時候也是一樣的走法，沒有像炮那樣的特殊規則。",
      "先點紅馬，再點日字方向上的黑卒，試試看。",
    ],
    board: horseCaptureExercise(),
    practice: {
      correctFrom: sq(6, 4),
      correctTo: sq(4, 5),
      successMessage: "🎉 太棒了！馬走日字型，吃掉了黑卒！",
    },
  },
  {
    emoji: "🍚",
    title: "小雞的飽食度",
    body: [
      "小雞會隨時間變餓：飽食度每小時下降 2%，記得常常回小雞主頁餵食（10 飼料可以恢復 5% 飽食度）。",
      "飽食度歸零，或是殘局解謎連續答錯 3 次，都會讓小雞馬上生病，要特別注意。",
    ],
  },
  {
    emoji: "🤒",
    title: "生病與死亡",
    body: [
      "生小病之後，如果 4 小時內沒有治療，會加重變成大病；大病再拖 4 小時沒治療，小雞就會死掉。",
      "死掉了也別太緊張：花 30 飼料可以復活（重新從蛋開始養），或用商店賣的復活藥水原地滿血復活，不用整個重來。",
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

  // ---- 互動吃子練習的狀態 ----
  // practiceBoard：目前畫面上顯示的盤面（答對時會真的把棋子移過去、
  // 吃掉目標，給視覺回饋）。practiceStatus：idle 還沒動作／wrong 點錯
  // 了／success 答對了。兩者都要在「換卡片」的時候重置，不然切到下一
  // 張練習卡會沿用上一張的殘留狀態。
  const [practiceBoard, setPracticeBoard] = useState<BoardGrid | null>(card.board ?? null);
  const [practiceStatus, setPracticeStatus] = useState<"idle" | "wrong" | "success">("idle");

  function goToIndex(i: number) {
    const target = CARDS[i];
    setPracticeBoard(target.board ?? null);
    setPracticeStatus("idle");
    setIndex(i);
  }

  function goNext() {
    if (isLast) {
      onFinish();
      return;
    }
    goToIndex(Math.min(index + 1, CARDS.length - 1));
  }

  function goPrev() {
    goToIndex(Math.max(index - 1, 0));
  }

  function handlePracticeMove(moveNotation: string) {
    const practice = card.practice;
    if (!practice || practiceStatus === "success") return;
    const expected = practice.correctFrom + practice.correctTo;
    if (moveNotation === expected) {
      setPracticeBoard((prev) => (prev ? applyMove(prev, practice.correctFrom, practice.correctTo) : prev));
      setPracticeStatus("success");
    } else {
      setPracticeStatus("wrong");
    }
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

          {card.practice ? (
            <div className="mt-4">
              <ChessBoard board={practiceBoard ?? card.board!} onMove={handlePracticeMove} />
              <div className="mt-2 text-center text-xs font-bold">
                {practiceStatus === "success" ? (
                  <p className="text-[#5B8C5A]">{card.practice.successMessage}</p>
                ) : practiceStatus === "wrong" ? (
                  <p className="text-[#C0392B]">❌ 還不對喔，再試一次！（先點紅棋子，再點要吃的目標）</p>
                ) : (
                  <p className="text-[#8B5FBF]/70">👆 點紅棋子，再點要吃的黑棋子</p>
                )}
              </div>
            </div>
          ) : card.board ? (
            <div className="mt-4">
              <ChessBoard
                board={card.board}
                onMove={() => {}}
                highlightMove={card.highlightMove ?? null}
                highlightMoves={card.highlightMoves}
              />
              {card.boardCaption ? (
                <p className="mt-2 text-center text-xs font-semibold text-[#8B5FBF]">{card.boardCaption}</p>
              ) : null}

              {card.secondaryBoard ? (
                <div className="mt-4 rounded-2xl bg-[#1A1A2E]/5 p-3">
                  <ChessBoard
                    board={card.secondaryBoard.board}
                    onMove={() => {}}
                    highlightMoves={card.secondaryBoard.highlightMoves}
                    blockedPoints={card.secondaryBoard.blockedPoints}
                  />
                  <p className="mt-2 text-center text-xs font-semibold text-[#C0392B]">
                    {card.secondaryBoard.caption}
                  </p>
                </div>
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
