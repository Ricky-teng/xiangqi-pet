"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { getPetImagePath } from "@/lib/pet/petImagePath";
import { useAppBackground } from "@/lib/useAppBackground";

const FOOD_PER_FEED = 10;
const MAX_FOOD_SHOWN = 5;

function FeedPageContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  const bgStyle = useAppBackground();
  const pet = useGameStore((s) => s.pet);
  const feedPet = useGameStore((s) => s.feedPet);

  const [isDragging, setIsDragging] = useState(false);
  const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
  const [isOverBowl, setIsOverBowl] = useState(false);
  const [bowlBounce, setBowlBounce] = useState(false);
  const [petJump, setPetJump] = useState(false);

  const bowlRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  const canFeed =
    !!user &&
    !!pet &&
    pet.healthStatus !== "dead" &&
    user.foodCount >= FOOD_PER_FEED &&
    (pet.fullness ?? 0) < 100;

  // 飼料數量顯示：用 snapshot 避免拖曳中因 feedPet() 導致 foodShown
  // 立刻減少、key 重建、pointer capture 遺失的問題
  const foodShownRef = useRef(0);
  if (!isDraggingRef.current) {
    foodShownRef.current = Math.min(
      MAX_FOOD_SHOWN,
      user ? Math.floor(user.foodCount / FOOD_PER_FEED) : 0
    );
  }
  const foodShown = foodShownRef.current;

  function isCursorOverBowl(x: number, y: number): boolean {
    if (!bowlRef.current) return false;
    const rect = bowlRef.current.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  // 在 window 上監聽 pointermove / pointerup，不受元素重建影響
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!isDraggingRef.current) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      setIsOverBowl(isCursorOverBowl(e.clientX, e.clientY));
    }
    function onUp(e: PointerEvent) {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      setIsOverBowl(false);

      if (isCursorOverBowl(e.clientX, e.clientY) && canFeed) {
        feedPet();
        setBowlBounce(true);
        setTimeout(() => setBowlBounce(false), 400);
        setPetJump(true);
        setTimeout(() => setPetJump(false), 400);
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  // 每次 canFeed 變化都要重新綁定，確保 closure 讀到最新值
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFeed, user?.foodCount]);

  function handlePointerDown(e: React.PointerEvent) {
    if (!canFeed) return;
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    setDragPos({ x: e.clientX, y: e.clientY });
    setIsOverBowl(false);
  }

  if (!user || !pet) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={bgStyle}>
        <p className="text-sm text-[#1A1A2E]/60">載入中…</p>
      </main>
    );
  }

  const fullnessPercent = Math.min(100, Math.max(0, pet.fullness));

  return (
    <main className="flex h-screen flex-col" style={{ ...bgStyle, touchAction: "none" }}>
      {/* 頂部列 */}
      <header className="flex shrink-0 items-center justify-between px-4 pt-4">
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
      <div className="mx-auto mt-4 w-full max-w-sm shrink-0 px-6">
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

      {/* 小雞 + 碗 區域（放置目標）：flex-1 填滿中間空間，位置固定不跳動 */}
      <div
        ref={bowlRef}
        className={[
"mx-auto mt-4 flex w-full max-w-sm flex-1 flex-col items-center justify-center rounded-3xl px-6 py-6 transition-colors duration-150",
          isOverBowl ? "bg-[#FCE6A0] ring-4 ring-[#E8B84B]" : "bg-white/40",
        ].join(" ")}
      >
        <img
          src={getPetImagePath(pet.stage, pet.healthStatus)}
          alt="小雞"
          className={[
"h-44 w-44 object-contain transition-transform duration-200",
            petJump ? "-translate-y-6 scale-110" : "translate-y-0 scale-100",
            bowlBounce ? "scale-110" : "",
          ].join(" ")}
        />
        <div className="mt-3">
          <span className="text-4xl select-none">
            {bowlBounce ? "✨" : isOverBowl ? "🫙" : "🥣"}
          </span>
        </div>
        <p className="mt-2 text-xs text-[#1A1A2E]/50">
          {!canFeed
            ? pet.healthStatus === "dead"
              ? "小雞已經死了…"
              : user.foodCount < FOOD_PER_FEED
                ? "飼料不足（需要 10 個）"
                : "小雞已吃飽！"
            : isOverBowl
              ? "放開餵食！"
              : "把飼料拖進這裡餵食"}
        </p>
      </div>

      {/* 飼料列：shrink-0 固定在底部，高度不會因上方動畫跳動 */}
      <div className="shrink-0 py-8">
        <p className="mb-4 text-center text-xs text-[#1A1A2E]/40">
          飼料庫存：{user.foodCount} 個（每次 -{FOOD_PER_FEED}）
        </p>
        <div className="flex justify-center gap-4">
          {Array.from({ length: foodShown }, (_, i) => (
            <div
              key={i}
              onPointerDown={handlePointerDown}
              className={[
"flex h-16 w-16 select-none items-center justify-center rounded-2xl bg-white text-3xl shadow-md",
                canFeed ? "cursor-grab active:scale-95" : "cursor-not-allowed opacity-40",
                isDragging ? "opacity-20" : "",
              ].join(" ")}
              style={{ touchAction: "none" }}
            >
              🌾
            </div>
          ))}
          {foodShown === 0 ? (
            <p className="text-sm font-semibold text-[#1A1A2E]/40">沒有足夠的飼料</p>
          ) : null}
        </div>
      </div>

      {/* 拖曳中的飄浮飼料 */}
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
