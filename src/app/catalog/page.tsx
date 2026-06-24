/**
 * src/app/catalog/page.tsx
 *
 * 小雞圖鑑頁面
 * ------------------------------------------------------------
 * 顯示所有圖鑑款式（見 @/lib/pet/catalog.ts），已解鎖的顯示彩色圖片
 * 跟名稱，未解鎖的顯示灰階鎖頭佔位。圖片載入失敗（檔案還沒提供）
 * 時自動退回顯示備援 emoji，不會讓畫面壞掉。
 *
 * 只有學生會有圖鑑資料（老師沒有寵物/轉生機制），所以限定
 * requiredRole="student"。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { CATALOG_ENTRIES, type CatalogEntry } from "@/lib/pet/catalog";

function CatalogContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  if (!user) {
    // RequireAuth 已經保證 user 存在，這裡純粹是型別防呆
    return null;
  }

  const unlockedSet = new Set(user.unlockedCatalogIds);

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
          <h1 className="text-base font-bold text-[#1A1A2E]">📖 小雞圖鑑</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <p className="mt-3 text-center text-xs font-semibold text-[#1A1A2E]/60">
          已收集 {unlockedSet.size} / {CATALOG_ENTRIES.length} 款
          {unlockedSet.size === 0 ? "　（小雞長大成熟後可以轉生解鎖第一款！）" : ""}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {CATALOG_ENTRIES.map((entry) => (
            <CatalogCard key={entry.id} entry={entry} isUnlocked={unlockedSet.has(entry.id)} />
          ))}
        </div>
      </div>
    </main>
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
          {isUnlocked ? `第 ${entry.unlockAtRebirthCount} 次轉生解鎖` : `轉生 ${entry.unlockAtRebirthCount} 次解鎖`}
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
