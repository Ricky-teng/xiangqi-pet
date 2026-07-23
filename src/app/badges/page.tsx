/**
 * src/app/badges/page.tsx
 *
 * 成就勳章頁面
 * ------------------------------------------------------------
 * 顯示所有勳章（見 @/lib/badges/badges.ts），每個勳章有三種狀態：
 *   1. 鎖定：條件還沒達成，灰階鎖頭 + 說明文字（讓學生知道要做什麼
 *      才能解鎖，跟圖鑑「未解鎖顯示？？？」的隱藏式設計刻意不同——
 *      勳章是「行為向」的引導，希望學生知道目標是什麼）
 *   2. 可領取：條件已經達成，但還沒按過「領取」，顯示彩色圖示 +
 *      「領取」按鈕，按了才會真的拿到飼料（見 useGameStore.ts 的
 *      claimBadge）
 *   3. 已領取：按過「領取」了，顯示彩色圖示 +「✓ 已領取」，不能再按
 *
 * 只有學生會有勳章資料（老師沒有 stats/checkinHistory 這些行為紀錄），
 * 所以限定 requiredRole="student"。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { BADGES, type BadgeDefinition } from "@/lib/badges/badges";
import { useAppBackground } from "@/lib/useAppBackground";

function BadgesContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const claimBadge = useGameStore((s) => s.claimBadge);

  const bgStyle = useAppBackground();
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  if (!user) {
    // RequireAuth 已經保證 user 存在，這裡純粹是型別防呆
    return null;
  }

  const claimedSet = new Set(user.earnedBadgeIds ?? []);

  function handleClaim(badgeId: string) {
    setClaimingId(badgeId);
    const result = claimBadge(badgeId);
    setToastMessage(result.message);
    setClaimingId(null);
    setTimeout(() => setToastMessage(null), 2500);
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
          <h1 className="text-base font-bold text-[#1A1A2E]">🎖️ 成就勳章</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <p className="mt-3 text-center text-xs font-semibold text-[#1A1A2E]/60">
          已領取 {claimedSet.size} / {BADGES.length} 枚
        </p>

        {toastMessage ? (
          <div className="mt-3 rounded-2xl bg-[#1A1A2E] px-4 py-2.5 text-center text-xs font-semibold text-white shadow-md">
            {toastMessage}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3">
          {BADGES.map((badge) => {
            const isClaimed = claimedSet.has(badge.id);
            const isUnlocked = isClaimed || badge.check(user);
            return (
              <BadgeCard
                key={badge.id}
                badge={badge}
                isClaimed={isClaimed}
                isUnlocked={isUnlocked}
                isClaiming={claimingId === badge.id}
                onClaim={() => handleClaim(badge.id)}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

function BadgeCard({
  badge,
  isClaimed,
  isUnlocked,
  isClaiming,
  onClaim,
}: {
  badge: BadgeDefinition;
  isClaimed: boolean;
  isUnlocked: boolean;
  isClaiming: boolean;
  onClaim: () => void;
}) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center shadow-sm",
        isUnlocked ? "bg-white/80" : "bg-white/40",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-16 w-16 items-center justify-center rounded-full text-3xl",
          isUnlocked ? "bg-[#E8B84B]/20" : "bg-[#1A1A2E]/10 grayscale",
        ].join(" ")}
      >
        {isUnlocked ? badge.icon : "🔒"}
      </div>
      <div>
        <p className="text-xs font-bold text-[#1A1A2E]">{badge.name}</p>
        <p className="mt-0.5 text-[10px] text-[#1A1A2E]/50">{badge.description}</p>
        <p className="mt-1 text-[10px] font-bold text-[#8B5FBF]">🟪 {badge.rewardFood}</p>
      </div>

      {isClaimed ? (
        <span className="mt-1 rounded-full bg-[#5B8C5A]/15 px-3 py-1 text-[10px] font-extrabold text-[#5B8C5A]">
          ✓ 已領取
        </span>
      ) : isUnlocked ? (
        <button
          type="button"
          onClick={onClaim}
          disabled={isClaiming}
          className="mt-1 w-full rounded-xl bg-[#E8B84B] px-3 py-1.5 text-[11px] font-extrabold text-[#5C3D0A] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
        >
          {isClaiming ? "領取中…" : "🎁 領取"}
        </button>
      ) : null}
    </div>
  );
}

export default function BadgesPage() {
  return (
    <RequireAuth requiredRole="student">
      <BadgesContent />
    </RequireAuth>
  );
}
