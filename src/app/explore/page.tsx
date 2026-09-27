// src/app/explore/page.tsx
"use client";

/**
 * 🗺️ 探險 — 第一層：10 棟塔的縮圖清單
 * ------------------------------------------------------------
 * 一頁列出 10 棟塔，每一棟顯示通關進度（0~10 關）。已全破的打勾、
 * 還沒解鎖的上鎖。點進去才看那一棟的 10 層樓（見 [tower]/page.tsx）。
 *
 * 為什麼不是一路往上滑的長地圖：10 棟 × 10 關 = 100 個節點，全部串成
 * 一條路要滑很久，而且學生想回去重打前面的關卡會很痛苦。分兩層之後
 * 「我在哪一棟」一眼就看得到。
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import {
  DAILY_EXPLORE_ATTEMPTS,
  STAGES_PER_TOWER,
  TOWER_COUNT,
  getTowerTheme,
} from "@/lib/rpg/monsters";
import {
  getTowerClearedCount,
  isTowerCleared,
  isTowerUnlocked,
} from "@/lib/exploreProgress";
import { useAppBackground } from "@/lib/useAppBackground";
import RulesButton from "@/components/RulesButton";
import RpgTutorial from "@/components/RpgTutorial";

function ExploreContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const progress = useGameStore((s) => s.exploreProgress);
  const loaded = useGameStore((s) => s.exploreProgressLoaded);
  const loadExploreProgress = useGameStore((s) => s.loadExploreProgress);
  const bgStyle = useAppBackground();

  useEffect(() => {
    void loadExploreProgress();
  }, [loadExploreProgress]);

  if (!user) return null;

  const attemptsLeft = progress
    ? Math.max(0, DAILY_EXPLORE_ATTEMPTS - progress.dailyAttemptsUsed)
    : DAILY_EXPLORE_ATTEMPTS;
  const totalCleared = progress?.clearedStageKeys.length ?? 0;

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">🗺️ 探險</h1>
          <div className="flex items-center gap-1.5">
            <RulesButton topic="explore" />
            <span className="rounded-full bg-[#1A1A2E] px-2.5 py-1 text-[10px] font-bold text-[#E8B84B]">
              {attemptsLeft}/{DAILY_EXPLORE_ATTEMPTS}
            </span>
          </div>
        </header>

        <div className="mt-3 rounded-2xl bg-white/60 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-bold text-[#1A1A2E]/60">總進度</span>
            <span className="text-xs font-extrabold text-[#5C3D0A]">
              {totalCleared} / {TOWER_COUNT * STAGES_PER_TOWER} 關
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#1A1A2E]/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#F6D87A] to-[#E8B84B]"
              style={{ width: `${(totalCleared / (TOWER_COUNT * STAGES_PER_TOWER)) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-[#1A1A2E]/45">
            每天 {DAILY_EXPLORE_ATTEMPTS} 次（台北時間 00:00 重置）・已通關的關卡重打不扣次數
          </p>
        </div>

        {!loaded || !progress ? (
          <div className="mt-6 text-center">
            <span className="inline-block rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold text-[#1A1A2E] shadow-sm backdrop-blur-sm">載入中…</span>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            {Array.from({ length: TOWER_COUNT }, (_, i) => i + 1).map((tower) => {
              const theme = getTowerTheme(tower);
              const unlocked = isTowerUnlocked(progress, tower);
              const cleared = getTowerClearedCount(progress, tower);
              const allCleared = isTowerCleared(progress, tower);

              return (
                <button
                  key={tower}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => router.push(`/explore/${tower}`)}
                  className="relative overflow-hidden rounded-3xl px-3 py-4 text-center shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed"
                  style={{
                    // 每座塔一個主色：底色仍是全站的深藍黑，主色只做
                    // 漸層跟邊框，一眼就知道自己爬到哪一區
                    background: unlocked
                      ? `linear-gradient(160deg, ${theme.accentColor}33 0%, #1A1A2E 85%)`
                      : "linear-gradient(160deg, rgba(26,26,46,0.35) 0%, rgba(26,26,46,0.55) 100%)",
                    border: `2px solid ${unlocked ? theme.accentColor : "rgba(255,255,255,0.12)"}`,
                    boxShadow: unlocked
                      ? `inset 0 1px 8px ${theme.accentColor}44, 0 6px 14px rgba(0,0,0,0.25)`
                      : undefined,
                  }}
                >
                  <p className="text-[10px] font-bold text-white/50">第 {tower} 塔</p>
                  <p
                    className="mt-0.5 text-base font-extrabold"
                    style={{ color: unlocked ? theme.accentColor : "rgba(255,255,255,0.35)" }}
                  >
                    {unlocked ? theme.name : "？？？"}
                  </p>

                  {unlocked ? (
                    <>
                      <div className="mx-auto mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${(cleared / STAGES_PER_TOWER) * 100}%`,
                            backgroundColor: theme.accentColor,
                          }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] font-bold text-white/70">
                        {allCleared ? "✅ 全破" : `${cleared} / ${STAGES_PER_TOWER} 關`}
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 text-xl">🔒</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 新手強制教學：只在探險頁顯示，教到打完第一關就放手 */}
      <RpgTutorial />
    </main>
  );
}

export default function ExplorePage() {
  return (
    <RequireAuth>
      <ExploreContent />
    </RequireAuth>
  );
}
