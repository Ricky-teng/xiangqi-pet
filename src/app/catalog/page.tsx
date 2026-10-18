/**
 * src/app/catalog/page.tsx
 *
 * 小雞圖鑑頁面
 * ------------------------------------------------------------
 * 顯示所有圖鑑款式（見 @/lib/pet/catalog.ts），已解鎖的顯示彩色圖片
 * 跟名稱，未解鎖的顯示灰階鎖頭佔位。圖片載入失敗（檔案還沒提供）
 * 時自動退回顯示備援 emoji，不會讓畫面壞掉。
 *
 * ⚠️ 解鎖條件在 RPG 擴充改過：以前是「轉職過就解鎖」（存在
 * user.unlockedCatalogIds），現在改成「**收藏過**該職業的小雞才算
 * 解鎖」。理由是轉職只是路過，收藏才代表你真的養出了一隻那個職業的
 * 小雞——圖鑑要記錄的是後者。
 *
 * 舊的 unlockedCatalogIds 欄位還留著（轉職時仍然會寫入），只是圖鑑
 * 不再看它；之後如果要做「曾經轉職過的職業」之類的統計還用得到。
 *
 * 只有學生會有圖鑑資料（老師沒有寵物系統），所以限定
 * requiredRole="student"。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { CATALOG_ENTRIES, type CatalogEntry } from "@/lib/pet/catalog";
import { useAppBackground } from "@/lib/useAppBackground";
import {
  TOWER_COUNT,
  getStageKey,
  getTowerBoss,
  getTowerMonsters,
  getTowerTheme,
  type MonsterTemplate,
} from "@/lib/rpg/monsters";
import { STAGES_PER_TOWER } from "@/lib/rpg/monsters";

function CatalogContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const collectedPetsLoaded = useGameStore((s) => s.collectedPetsLoaded);
  const loadCollectedPets = useGameStore((s) => s.loadCollectedPets);
  const exploreProgress = useGameStore((s) => s.exploreProgress);
  const loadExploreProgress = useGameStore((s) => s.loadExploreProgress);
  const [tab, setTab] = useState<"job" | "monster">("job");

  const bgStyle = useAppBackground();

  useEffect(() => {
    void loadCollectedPets();
    void loadExploreProgress();
  }, [loadCollectedPets, loadExploreProgress]);

  /**
   * 怪物圖鑑的解鎖條件：打過那一座塔的任何一關就算見過那座塔的
   * 3 種小怪；通關過該塔任一關就算打過 Boss（因為每一關最後都有
   * 同一隻 Boss）。
   *
   * 刻意用「塔」而不是「關」當粒度：同一座塔的 3 種怪是輪流出場的，
   * 打完第 1 關就一定三種都見過了，再細分沒有意義。
   */
  const clearedTowers = useMemo(() => {
    const set = new Set<number>();
    for (const key of exploreProgress?.clearedStageKeys ?? []) {
      for (let tower = 1; tower <= TOWER_COUNT; tower++) {
        for (let stage = 1; stage <= STAGES_PER_TOWER; stage++) {
          if (getStageKey(tower, stage) === key) set.add(tower);
        }
      }
    }
    return set;
  }, [exploreProgress]);

  // 解鎖 = 收藏過至少一隻該職業的小雞。未轉職就收藏的小雞 jobId 是
  // null，不會解鎖任何一款（那本來就不是一個職業）。
  const unlockedSet = useMemo(() => {
    const set = new Set<string>();
    for (const pet of collectedPets) {
      if (pet.jobId) set.add(pet.jobId);
    }
    return set;
  }, [collectedPets]);

  if (!user) {
    // RequireAuth 已經保證 user 存在，這裡純粹是型別防呆
    return null;
  }

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
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
          <h1 className="text-base font-bold text-[#1A1A2E]">📖 圖鑑</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["job", "monster"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={[
                "rounded-2xl py-2.5 text-xs font-bold transition-transform active:scale-95",
                tab === t ? "bg-[#E8B84B] text-[#5C3D0A] shadow-md" : "bg-white/60 text-[#1A1A2E]/60",
              ].join(" ")}
            >
              {t === "job" ? "🐔 職業" : "👾 怪物"}
            </button>
          ))}
        </div>

        {tab === "job" ? (
          <>
            <p className="mt-3 text-center text-xs font-semibold text-[#1A1A2E]/60">
              {!collectedPetsLoaded
                ? "載入中…"
                : `已收集 ${unlockedSet.size} / ${CATALOG_ENTRIES.length} 款`}
              {collectedPetsLoaded && unlockedSet.size === 0
                ? "　（收藏一隻轉職過的小雞就能解鎖第一款！）"
                : ""}
            </p>
            <p className="mt-1 text-center text-[10px] text-[#1A1A2E]/40">
              收藏過該職業的小雞才會解鎖，只有轉職過不算
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {CATALOG_ENTRIES.map((entry) => (
                <CatalogCard key={entry.id} entry={entry} isUnlocked={unlockedSet.has(entry.id)} />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="mt-3 text-center text-xs font-semibold text-[#1A1A2E]/60">
              已見過 {clearedTowers.size} / {TOWER_COUNT} 座塔的怪物
            </p>
            <p className="mt-1 text-center text-[10px] text-[#1A1A2E]/40">
              通關過那一座塔的任何一關，牠的怪物就會解鎖
            </p>

            <div className="mt-4 flex flex-col gap-3">
              {Array.from({ length: TOWER_COUNT }, (_, i) => i + 1).map((tower) => {
                const theme = getTowerTheme(tower);
                const seen = clearedTowers.has(tower);
                const monsters = [...getTowerMonsters(tower), getTowerBoss(tower)];
                return (
                  <section
                    key={tower}
                    className="rounded-2xl px-3 py-3"
                    style={{
                      background: `linear-gradient(140deg, ${theme.accentColor}22 0%, rgba(255,255,255,0.75) 60%)`,
                      border: `1.5px solid ${seen ? theme.accentColor : "rgba(26,26,46,0.12)"}`,
                    }}
                  >
                    <p className="text-xs font-extrabold" style={{ color: theme.accentColor }}>
                      第 {tower} 塔・{theme.name}
                    </p>
                    <div className="mt-2 grid grid-cols-4 gap-2">
                      {monsters.map((m) => (
                        <MonsterCard key={m.id} monster={m} isSeen={seen} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

/** 怪物圖鑑的一格。沒見過就只顯示問號，連名字都不給——留一點神祕感 */
function MonsterCard({ monster, isSeen }: { monster: MonsterTemplate; isSeen: boolean }) {
  const isBoss = monster.id.endsWith("-boss");
  return (
    <div
      className="rounded-xl bg-white/80 px-1 py-2 text-center"
      style={{ border: isBoss ? "1.5px solid #E8B84B" : "1px solid rgba(26,26,46,0.1)" }}
    >
      <p className="text-xl" style={{ filter: isSeen ? undefined : "grayscale(1) opacity(0.3)" }}>
        {isSeen ? monster.emoji : "❓"}
      </p>
      <p className="mt-0.5 truncate text-[9px] font-bold text-[#1A1A2E]/70">
        {isSeen ? monster.name : "？？？"}
      </p>
      {isSeen ? (
        <p className="text-[8px] leading-tight text-[#1A1A2E]/45">
          體{monster.stats.hp}・攻{monster.stats.attack}
          <br />
          防{monster.stats.defense}・速{monster.stats.speed}
        </p>
      ) : null}
      {isBoss ? (
        <p className="mt-0.5 text-[8px] font-extrabold text-[#E8B84B]">BOSS</p>
      ) : null}
    </div>
  );
}

function CatalogCard({ entry, isUnlocked }: { entry: CatalogEntry; isUnlocked: boolean }) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center shadow-sm",
        isUnlocked ? "bg-white/80" : "bg-white/40",
      ].join(" ")}
    >
      <div className="relative h-16 w-16">
        {isUnlocked ? (
          <CatalogImage src={entry.imagePath} alt={entry.name} fallbackEmoji={entry.fallbackEmoji} />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-full bg-[#1A1A2E]/10 text-2xl grayscale">
            🔒
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-bold text-[#1A1A2E]">{isUnlocked ? entry.name : "？？？"}</p>
        <p className="mt-0.5 text-[10px] text-[#1A1A2E]/50">
          {isUnlocked ? `第 ${entry.unlockAtJobLevel} 次轉職解鎖` : `轉職 ${entry.unlockAtJobLevel} 次解鎖`}
        </p>
      </div>
    </div>
  );
}

/** 圖片載入失敗（檔案還不存在）時自動退回顯示 emoji，避免畫面壞掉 */
function CatalogImage({
  src,
  alt,
  fallbackEmoji,
}: {
  src: string;
  alt: string;
  fallbackEmoji: string;
}) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <span className="flex h-full w-full items-center justify-center text-4xl" role="img" aria-label={alt}>
        {fallbackEmoji}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="64px"
      className="object-contain"
      onError={() => setHasError(true)}
    />
  );
}

export default function CatalogPage() {
  return (
    <RequireAuth requiredRole="student">
      <CatalogContent />
    </RequireAuth>
  );
}
