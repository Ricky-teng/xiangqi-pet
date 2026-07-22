/**
 * src/app/badges/page.tsx
 *
 * 成就勳章頁面
 * ------------------------------------------------------------
 * 顯示所有勳章（見 @/lib/badges/badges.ts），已拿到的顯示彩色圖示跟
 * 名稱，還沒拿到的顯示灰階鎖頭 + 說明文字（讓學生知道要做什麼才能
 * 拿到，跟圖鑑「未解鎖顯示？？？」的隱藏式設計刻意不同——勳章是
 * 「行為向」的引導，希望學生知道目標是什麼）。
 *
 * 只有學生會有勳章資料（老師沒有 stats/checkinHistory 這些行為紀錄），
 * 所以限定 requiredRole="student"。
 */

"use client";

import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { BADGES, type BadgeDefinition } from "@/lib/badges/badges";
import { useAppBackground } from "@/lib/useAppBackground";

function BadgesContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  const bgStyle = useAppBackground();

  if (!user) {
    // RequireAuth 已經保證 user 存在，這裡純粹是型別防呆
    return null;
  }

  const earnedSet = new Set(user.earnedBadgeIds ?? []);

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
          已獲得 {earnedSet.size} / {BADGES.length} 枚
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {BADGES.map((badge) => (
            <BadgeCard key={badge.id} badge={badge} isEarned={earnedSet.has(badge.id)} />
          ))}
        </div>
      </div>
    </main>
  );
}

function BadgeCard({ badge, isEarned }: { badge: BadgeDefinition; isEarned: boolean }) {
  return (
    <div
      className={[
        "flex flex-col items-center gap-2 rounded-2xl px-3 py-4 text-center shadow-sm",
        isEarned ? "bg-white/80" : "bg-white/40",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-16 w-16 items-center justify-center rounded-full text-3xl",
          isEarned ? "bg-[#E8B84B]/20" : "bg-[#1A1A2E]/10 grayscale",
        ].join(" ")}
      >
        {isEarned ? badge.icon : "🔒"}
      </div>
      <div>
        <p className="text-xs font-bold text-[#1A1A2E]">{badge.name}</p>
        <p className="mt-0.5 text-[10px] text-[#1A1A2E]/50">{badge.description}</p>
      </div>
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
