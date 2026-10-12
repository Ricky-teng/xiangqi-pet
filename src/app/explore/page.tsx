// src/app/explore/page.tsx
"use client";

/**
 * 🗺️ 探險 — 第一層：10 座塔的選關畫面
 * ------------------------------------------------------------
 * 一頁列出 10 座塔，每一張卡片就是那座塔的「縮小版戰場」：
 * 該塔的天空與地形（跟戰鬥畫面同一張 BattleBackdrop）＋ 站在中間
 * 的塔主 Boss。沒解鎖的塔，Boss 只顯示剪影——學生會想知道
 * 「後面那隻長怎樣」，這就是往上爬的動力。
 *
 * 卡片狀態：
 *   上鎖    整張壓暗、Boss 剪影、寫出解鎖條件
 *   挑戰中  目前解鎖到的最高那座、還沒全破：金框呼吸＋「挑戰中」
 *   全破    右上角金色「制霸」徽章
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
import RpgHeader, { AttemptsBadge } from "@/components/rpg/RpgHeader";
import BattleBackdrop from "@/components/battle/BattleBackdrop";
import MonsterArt from "@/components/battle/MonsterArt";

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
  const totalStages = TOWER_COUNT * STAGES_PER_TOWER;
  const totalCleared = progress?.clearedStageKeys.length ?? 0;

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <RpgHeader
          title="探險"
          onBack={() => router.push("/")}
          right={
            <>
              <RulesButton topic="explore" variant="dark" />
              <AttemptsBadge left={attemptsLeft} max={DAILY_EXPLORE_ATTEMPTS} />
            </>
          }
        />

        {/* ---- 總進度 ---- */}
        <div className="rpg-panel mt-3 rounded-2xl px-4 py-3">
          <div className="flex items-end justify-between">
            <span className="text-[12px] font-black text-white/70">總進度</span>
            <span className="leading-none">
              <span className="font-display text-[22px] text-[#FFE58A]">{totalCleared}</span>
              <span className="font-display text-[13px] text-white/45"> / {totalStages}</span>
            </span>
          </div>
          <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(totalCleared / totalStages) * 100}%`,
                background: "linear-gradient(180deg,#FFF0A8 0%,#F5C542 50%,#C98A0A 100%)",
                boxShadow: "0 0 10px rgba(245,197,66,0.6)",
              }}
            />
            {/* 每座塔一格的刻度 */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,0.45) calc(10% - 1px) 10%)" }}
            />
          </div>
          <p className="mt-1.5 text-[10.5px] text-white/45">
            每天 {DAILY_EXPLORE_ATTEMPTS} 次，台北時間 00:00 重置。打過的關卡重打不扣次數。
          </p>
        </div>

        {!loaded || !progress ? (
          <div className="mt-8 text-center">
            <span className="rpg-glass inline-block rounded-2xl px-4 py-2 text-sm font-black text-white/80">載入中…</span>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {Array.from({ length: TOWER_COUNT }, (_, i) => i + 1).map((tower) => {
              const theme = getTowerTheme(tower);
              const unlocked = isTowerUnlocked(progress, tower);
              const cleared = getTowerClearedCount(progress, tower);
              const allCleared = isTowerCleared(progress, tower);
              const isCurrent = unlocked && !allCleared && tower === progress.unlockedTower;

              return (
                <button
                  key={tower}
                  type="button"
                  disabled={!unlocked}
                  onClick={() => router.push(`/explore/${tower}`)}
                  aria-label={unlocked ? `第 ${tower} 塔 ${theme.name}，已通關 ${cleared} 關` : `第 ${tower} 塔，尚未解鎖`}
                  className={[
                    "group relative rounded-[22px] p-[2.5px] text-left transition-transform active:scale-[0.97] disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
                    isCurrent ? "floor-current" : "",
                  ].join(" ")}
                  style={{
                    background: unlocked
                      ? `linear-gradient(160deg, #FFFFFF 0%, ${theme.accentColor} 35%, #1A1A2E 100%)`
                      : "linear-gradient(160deg, #4A4A5E 0%, #1E1E2C 100%)",
                    boxShadow: unlocked ? `0 8px 18px rgba(0,0,0,0.28), 0 0 14px ${theme.accentColor}55` : "0 6px 14px rgba(0,0,0,0.25)",
                  }}
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-[19.5px] bg-[#0B0A18]">
                    {/* 縮小版戰場 */}
                    <div className="absolute inset-0" style={{ filter: unlocked ? undefined : "grayscale(1) brightness(0.45)" }}>
                      <BattleBackdrop tower={tower} />
                    </div>

                    {/* 塔主 */}
                    <div className="absolute inset-x-0 bottom-[16%] flex justify-center">
                      <div className={unlocked ? "unit-idle" : ""}>
                        <MonsterArt tower={tower} archetype="balanced" isBoss size={92} silhouette={!unlocked} />
                      </div>
                    </div>

                    {/* 上方：第幾塔 */}
                    <span className="font-display absolute left-2 top-2 rounded-lg bg-black/55 px-1.5 py-0.5 text-[11px] leading-none text-white/90 ring-1 ring-white/15">
                      {tower}
                    </span>
                    {isCurrent ? (
                      <span className="absolute right-2 top-2 rounded-lg px-1.5 py-0.5 text-[10px] font-black text-[#3A1D00]" style={{ background: "linear-gradient(180deg,#FFF6CC,#F5C542)" }}>
                        挑戰中
                      </span>
                    ) : null}
                    {allCleared ? <ConqueredBadge /> : null}

                    {/* 下方：塔名＋10 格進度 */}
                    <div className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6" style={{ background: "linear-gradient(0deg, rgba(5,5,16,0.88) 0%, rgba(5,5,16,0) 100%)" }}>
                      {unlocked ? (
                        <>
                          <p className="leading-none">
                            <span
                              className="fx-text text-[17px] font-black"
                              data-text={theme.name}
                              style={
                                {
                                  ["--fx-fill" as string]: `linear-gradient(180deg,#FFFFFF 20%,${theme.accentColor} 100%)`,
                                  ["--fx-stroke" as string]: "4px",
                                  ["--fx-stroke-color" as string]: "#0B0A18",
                                } as React.CSSProperties
                              }
                            >
                              {theme.name}
                            </span>
                          </p>
                          <div className="mt-1.5 flex gap-[2px]">
                            {Array.from({ length: STAGES_PER_TOWER }, (_, s) => (
                              <span
                                key={s}
                                className="h-1.5 flex-1 rounded-[2px]"
                                style={{
                                  background: s < cleared ? theme.accentColor : "rgba(255,255,255,0.16)",
                                  boxShadow: s < cleared ? `0 0 4px ${theme.accentColor}` : undefined,
                                }}
                              />
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <LockIcon />
                          <span className="text-[10.5px] font-bold leading-tight text-white/60">
                            通關第 {tower - 1} 塔頂樓解鎖
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
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

/** 全破徽章：右上角的金色緞帶 */
function ConqueredBadge() {
  return (
    <span
      className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg px-1.5 py-0.5 text-[10px] font-black text-[#3A1D00]"
      style={{
        background: "linear-gradient(180deg,#FFF6CC 0%,#F5C542 60%,#C98A0A 100%)",
        boxShadow: "0 0 10px rgba(245,197,66,0.8)",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 18h18l-1.5-10-4.5 4-3-7-3 7-4.5-4z" />
      </svg>
      制霸
    </span>
  );
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2.5" fill="rgba(255,255,255,0.12)" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function ExplorePage() {
  return (
    <RequireAuth>
      <ExploreContent />
    </RequireAuth>
  );
}
