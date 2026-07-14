/**
 * src/app/puzzle/page.tsx
 *
 * 殘局挑戰：選等級頁
 * ------------------------------------------------------------
 * 原本這個頁面是「題目列表」，學生可以看到所有已發布題目的標題、
 * 描述、難度，直接點選想要的那一題。改成「選等級」模式之後：
 *   1. 學生只選要挑戰第幾級（1-10），不會看到題目列表，自然也就
 *      看不到任何題目標題/描述——這正是防止洩漏解法的關鍵，因為
 *      很多題目標題本身就會暗示殺法（例如「馬後炮絕殺」）。
 *   2. 選完等級後，從該等級「已發布」的題目裡用 Math.random() 隨機
 *      抽一題，導向 /puzzle/{id} 進入實際解題（該頁面這次也拿掉了
 *      標題顯示，雙重防止洩漏，見 puzzle/[id]/page.tsx 的改動）。
 *   3. 飼料獎勵公式跟原本完全沒變（calculateFoodReward in
 *      usePuzzleSolver.ts：題目等級跟學生自身等級差距越大，飼料越多），
 *      這裡只是把「題目等級」換成「學生選的等級」來預覽獎勵數字，
 *      讓學生在選等級時就能看到「這個等級大概能拿多少飼料」。
 *
 * 每個等級按鈕會先去 Firestore 數一次「這個等級有幾題已發布」，
 * 沒有題目的等級會被禁用並標示「尚無題目」，避免學生選了之後才
 * 發現抽不到題目。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import type { PuzzleDoc } from "@/types/database";
import type { PuzzleLevel } from "@/types/xiangqi";
import { useAppBackground } from "@/lib/useAppBackground";

const ALL_LEVELS: PuzzleLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * 飼料獎勵預覽公式：必須跟 usePuzzleSolver.ts 的 calculateFoodReward
 * 完全一致，這裡只是為了在選等級畫面先讓學生看到大概數字，重複定義
 * 一份（不是 import，因為那個函式是 module-private，沒有 export），
 * 如果之後改動飼料公式，這兩處要一起改，已在兩邊都加上提醒註解。
 */
function previewFoodReward(userLevel: number, puzzleLevel: number): number {
  if (userLevel === puzzleLevel) return 10;
  if (userLevel < puzzleLevel) return 10 + (puzzleLevel - userLevel) * 5;
  return Math.max(1, 10 - (userLevel - puzzleLevel) * 3);
}

type FetchStatus = "loading" | "success" | "error";

function PuzzleLevelPickerContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  const bgStyle = useAppBackground();

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // 每個等級對應「已發布題目的 id 列表」，用來：(a) 判斷這個等級
  // 有沒有題目可以挑戰、(b) 真正要開始挑戰時從裡面隨機抽一個 id。
  const [puzzleIdsByLevel, setPuzzleIdsByLevel] = useState<Map<number, string[]>>(new Map());
  const [isStartingLevel, setIsStartingLevel] = useState<number | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchPuzzleIds() {
      setStatus("loading");
      try {
        const snapshot = await getDocs(
          query(collection(db, "puzzles"), where("isPublished", "==", true))
        );
        if (isCancelled) return;

        const grouped = new Map<number, string[]>();
        snapshot.docs.forEach((docSnapshot) => {
          const data = docSnapshot.data() as PuzzleDoc;
          const list = grouped.get(data.level) ?? [];
          list.push(docSnapshot.id);
          grouped.set(data.level, list);
        });

        setPuzzleIdsByLevel(grouped);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[puzzle] 讀取題庫等級分布失敗：", error);
        setErrorMessage(
          error instanceof Error ? error.message : "讀取題庫時發生未知錯誤，請稍後再試。"
        );
        setStatus("error");
      }
    }

    fetchPuzzleIds();
    return () => {
      isCancelled = true;
    };
  }, []);

  function handleStartLevel(level: PuzzleLevel) {
    const idsForLevel = puzzleIdsByLevel.get(level) ?? [];
    if (idsForLevel.length === 0) return;

    setIsStartingLevel(level);
    const randomId = idsForLevel[Math.floor(Math.random() * idsForLevel.length)];
    router.push(`/puzzle/${randomId}?level=${level}`);
  }

  return (
    <main className="min-h-screenpb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📚 殘局挑戰</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {status === "loading" ? (
          <p className="mt-4 text-center text-sm text-[#1A1A2E]/60">題庫載入中…</p>
        ) : status === "error" ? (
          <div className="mt-4 rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
            {errorMessage ?? "讀取題庫失敗，請稍後再試。"}
          </div>
        ) : (
          <section className="mt-4 rounded-3xl bg-white/60 px-4 py-6 shadow-sm">
            <h2 className="text-center text-sm font-bold text-[#1A1A2E]">選擇挑戰等級</h2>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/60">
              {user ? `你目前是 ${user.chessLevel} 級。` : ""}
              選好等級後會隨機出一題，不會事先看到題目內容，挑戰比自己等級高的題目飼料更多。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {ALL_LEVELS.map((level) => {
                const idsForLevel = puzzleIdsByLevel.get(level) ?? [];
                const hasPuzzles = idsForLevel.length > 0;
                const isOwnLevel = user ? level === user.chessLevel : false;
                const previewReward = user ? previewFoodReward(user.chessLevel, level) : null;

                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleStartLevel(level)}
                    disabled={!hasPuzzles || isStartingLevel !== null}
                    className={[
"flex flex-col items-center gap-0.5 rounded-2xl px-3 py-3 shadow-sm transition-transform active:scale-95 disabled:opacity-40",
                      isOwnLevel ? "bg-[#E8B84B]/20 ring-2 ring-[#E8B84B]" : "bg-white/80",
                    ].join(" ")}
                  >
                    <span className="text-sm font-bold text-[#1A1A2E]">Lv.{level}</span>
                    {isStartingLevel === level ? (
                      <span className="text-xs font-semibold text-[#1A1A2E]/50">出題中…</span>
                    ) : hasPuzzles ? (
                      <span className="text-xs font-semibold text-[#8B5FBF]">
                        {previewReward !== null ? `過關 +${previewReward}` : ""}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#1A1A2E]/40">尚無題目</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default function PuzzleLevelPickerPage() {
  return (
    <RequireAuth>
      <PuzzleLevelPickerContent />
    </RequireAuth>
  );
}
