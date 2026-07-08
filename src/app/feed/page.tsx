/**
 * src/app/feed/page.tsx
 *
 * 餵食頁面：拖曳飼料到碗裡讓小雞吃
 * ------------------------------------------------------------
 * 互動流程：
 *   1. 畫面下方有一排飼料圖示（依目前庫存決定顯示幾個，上限5個讓
 *      玩家一次最多拖5個，避免畫面太擠）
 *   2. 長按或開始拖曳飼料圖示，出現拖影跟著手指/游標移動
 *   3. 拖到碗上放開 → 觸發餵食（-10飼料、+5飽食度、+10 XP）
 *      小雞跳一下，碗有「接到了」的回饋動畫
 *   4. 飼料庫存歸零或飽食度到 100 就不能繼續拖
 *
 * 拖曳實作：用 pointer events（pointermove / pointerup）而非
 * HTML5 drag API，因為 drag API 在行動裝置上不支援，而且自訂樣式
 * 很麻煩。pointer events 同時支援滑鼠和觸控，只要一套邏輯。
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { getPetImagePath } from "@/lib/pet/petImagePath";

// 每次餵食消耗的飼料
const FOOD_PER_FEED = 10;
// 畫面上最多同時顯示幾個飼料（避免庫存很多時畫面太擠）
const MAX_FOOD_SHOWN = 5;

// ============================================================
// 主元件
// ============================================================

function FeedPageContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const pet = useGameStore((s) => s.pet);
  const feedPet = useGameStore((s) => s.feedPet);

  // 拖曳狀態
  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [isOverBowl, setIsOverBowl] = useState(false);

  // 碗的「接到了」動畫 + 小雞跳動
  const [bowlBounce, setBowlBounce] = useState(false);
  const [petJump, setPetJump] = useState(false);

  // 拖曳起點（手指/游標按下的位置）
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const bowlRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const canFeed =
    !!user &&
    !!pet &&
    pet.healthStatus !== "dead" &&
    user.foodCount >= FOOD_PER_FEED &&
    (pet.fullness ?? 0) < 100;

  const foodShown = Math.min(
    MAX_FOOD_SHOWN,
    user ? Math.floor(user.foodCount / FOOD_PER_FEED) : 0
  );

  function isCursorOverBowl(x: number, y: number): boolean {
    if (!bowlRef.current) return false;
    const rect = bowlRef.current.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (!canFeed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    setDragPos({ x: e.clientX, y: e.clientY });
    setIsOverBowl(false);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!isDraggingRef.current) return;
    setDragPos({ x: e.clientX, y: e.clientY });
    setIsOverBowl(isCursorOverBowl(e.clientX, e.clientY));
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDragging(false);
    setIsOverBowl(false);

    if (isCursorOverBowl(e.clientX, e.clientY) && canFeed) {
      // 觸發餵食
      feedPet();

      // 碗彈跳動畫
      setBowlBounce(true);
      setTimeout(() => setBowlBounce(false), 400);

      // 小雞跳動動畫
      setPetJump(true);
      setTimeout(() => setPetJump(false), 400);
    }
  }

  if (!user || !pet) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FDF6E8]">
        <p className="text-sm text-[#1A1A2E]/60">載入中…</p>
      </main>
    );
  }

  const fullnessPercent = Math.min(100, Math.max(0, pet.fullness));

  return (
    <main className="flex min-h-screen flex-col bg-[#FDF6E8]">
      {/* 頂部列 */}
      <header className="flex items-center justify-between px-4 pt-4">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] shadow-sm transition-transform active:scale-95"
        >
          ← 返回
        </button>
        <h1 className="text-sm font-bold text-[#1A1A2E]">🍱 餵食</h1>
        <div className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#8B5FBF] shadow-sm">
          🟪 {user.foodCount}
        </div>
      </header>

      {/* 飽食度 */}
      <div className="mx-auto mt-4 w-full max-w-sm px-6">
        <div className="mb-1 flex justify-between text-xs font-medium text-[#1A1A2E]/60">
          <span>飽食度</span>
          <span className="tabular-nums">{fullnessPercent.toFixed(0)}/100</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-[#E5DFCB]">
          <div
            className="h-full rounded-full bg-[#5B8C5A] transition-all duration-500"
            style={{ width: `${fullnessPercent}%` }}
          />
        </div>
        {fullnessPercent >= 100 ? (
          <p className="mt-1 text-center text-xs font-semibold text-[#5B8C5A]">
            已吃飽！不需要再餵了 🎉
          </p>
        ) : null}
      </div>

      {/* 小雞 + 碗 區域：整個圈都是放置目標 */}
      <div
        ref={bowlRef}
        className={[
          "mx-auto mt-6 flex w-full max-w-sm flex-col items-center rounded-3xl px-6 py-6 transition-all duration-150",
          isOverBowl
            ? "bg-[#FCE6A0] ring-4 ring-[#E8B84B]"
            : "bg-white/40",
          bowlBounce ? "scale-105" : "",
        ].join(" ")}
      >
        {/* 小雞圖片 */}
        <img
          src={getPetImagePath(pet.stage, pet.healthStatus)}
          alt="小雞"
          className={[
            "h-44 w-44 object-contain transition-transform duration-200",
            petJump ? "-translate-y-6 scale-110" : "translate-y-0 scale-100",
          ].join(" ")}
        />

        {/* 碗圖示：純裝飾，hit area 是整個外層容器 */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-4xl select-none">
            {bowlBounce ? "✨" : isOverBowl ? "🫙" : "🥣"}
          </span>
        </div>

        <p className="mt-2 text-xs text-[#1A1A2E]/50">
          {canFeed
            ? isOverBowl ? "放開餵食！" : "把飼料拖進這裡餵食"
            : pet.healthStatus === "dead"
              ? "小雞已經死了…"
              : user.foodCount < FOOD_PER_FEED
                ? "飼料不足（需要 10 個）"
                : "小雞已吃飽！"}
        </p>
      </div>

      {/* 飼料列 */}
      <div className="mt-auto pb-12">
        <p className="mb-4 text-center text-xs text-[#1A1A2E]/40">
          飼料庫存：{user.foodCount} 個（每次 -{FOOD_PER_FEED}）
        </p>
        <div className="flex justify-center gap-4">
          {Array.from({ length: foodShown }, (_, i) => (
            <div
              key={i}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className={[
                "flex h-16 w-16 cursor-grab items-center justify-center rounded-2xl bg-white text-3xl shadow-md transition-transform select-none",
                canFeed ? "active:scale-95" : "cursor-not-allowed opacity-40",
                isDragging ? "opacity-0" : "",
              ].join(" ")}
              style={{ touchAction: "none" }}
            >
              🌾
            </div>
          ))}
          {foodShown === 0 ? (
            <p className="text-sm font-semibold text-[#1A1A2E]/40">
              沒有足夠的飼料
            </p>
          ) : null}
        </div>
      </div>

      {/* 拖曳中的飄浮飼料圖示 */}
      {isDragging ? (
        <div
          className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2 text-4xl"
          style={{ left: dragPos.x, top: dragPos.y }}
        >
          🌾
        </div>
      ) : null}
    </main>
  );
}

export default function FeedPage() {
  return (
    <RequireAuth requiredRole="student">
      <FeedPageContent />
    </RequireAuth>
  );
}
