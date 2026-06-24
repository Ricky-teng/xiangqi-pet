/**
 * src/app/puzzles/page.tsx
 *
 * 題庫列表頁
 * ------------------------------------------------------------
 * 首頁「🚀 開始挑戰」按鈕的目的地。從 Firestore 撈出所有
 * isPublished === true 的題目，依難度排序列出，點擊任一題
 * 導向 /puzzle/{id} 進入實際解題流程。
 *
 * 範圍說明：刻意保持簡單（沒有分頁、篩選、搜尋），先解決
 * 「首頁不該直接嵌入棋盤」的問題，列表本身之後要加篩選/分頁
 * 都可以在這個檔案上擴充，不影響其他頁面。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import type { PuzzleDoc } from "@/types/database";

type FetchStatus = "loading" | "success" | "error";

function PuzzleListContent() {
  const router = useRouter();
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [puzzles, setPuzzles] = useState<PuzzleDoc[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchPuzzles() {
      setStatus("loading");
      try {
        const snapshot = await getDocs(
          query(collection(db, "puzzles"), where("isPublished", "==", true))
        );

        if (isCancelled) return;

        const list = snapshot.docs
          .map((docSnapshot) => docSnapshot.data() as PuzzleDoc)
          .sort((a, b) => a.level - b.level);

        setPuzzles(list);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[puzzles] 讀取題庫失敗：", error);
        setErrorMessage(
          error instanceof Error ? error.message : "讀取題庫時發生未知錯誤，請稍後再試。"
        );
        setStatus("error");
      }
    }

    fetchPuzzles();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
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
          <h1 className="text-base font-bold text-[#1A1A2E]">📚 殘局題庫</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-center text-sm text-[#1A1A2E]/60">題庫載入中…</p>
          ) : status === "error" ? (
            <div className="rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
              {errorMessage ?? "讀取題庫失敗，請稍後再試。"}
            </div>
          ) : puzzles.length === 0 ? (
            <div className="rounded-2xl bg-white/60 px-4 py-8 text-center text-sm text-[#1A1A2E]/60">
              目前還沒有已上架的題目，請等老師發布新題目。
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {puzzles.map((puzzle) => (
                <li key={puzzle.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/puzzle/${puzzle.id}`)}
                    className="w-full rounded-2xl bg-white/70 px-4 py-3 text-left shadow-sm transition-transform active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#1A1A2E]">{puzzle.title}</span>
                      <span className="rounded-full border border-[#C9962C] bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-2 py-0.5 text-[10px] font-extrabold text-[#5C3D0A]">
                        Lv.{puzzle.level}
                      </span>
                    </div>
                    {puzzle.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-[#1A1A2E]/60">
                        {puzzle.description}
                      </p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

export default function PuzzleListPage() {
  return (
    <RequireAuth>
      <PuzzleListContent />
    </RequireAuth>
  );
}
