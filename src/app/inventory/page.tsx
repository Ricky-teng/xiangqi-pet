// src/app/inventory/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { SHOP_ITEMS } from "@/lib/shopItems";

function InventoryContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const pet = useGameStore((s) => s.pet);
  const useItem = useGameStore((s) => s.useItem);
  const setActiveBackground = useGameStore((s) => s.setActiveBackground);
  const isDoubleRewardActive = useGameStore((s) => s.isDoubleRewardActive);
  const [message, setMessage] = useState<string | null>(null);

  if (!user) return null;

  const doubleActive = isDoubleRewardActive();
  const remainingMin = doubleActive
    ? Math.ceil(((user.doubleRewardExpiry ?? 0) - Date.now()) / 60000)
    : 0;

  const shieldExpiry = pet?.fullnessProtectionUntil ?? 0;
  const shieldActive = shieldExpiry > Date.now();
  const shieldRemainingHours = shieldActive ? Math.ceil((shieldExpiry - Date.now()) / (60 * 60 * 1000)) : 0;

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function handleUse(itemId: string) {
    const result = useItem(itemId);
    showMessage(result.message);
  }

  function handleSetBackground(id: string | null) {
    setActiveBackground(id);
    showMessage(id ? "✅ 背景已套用！" : "✅ 已切換回預設背景");
  }

  const consumables = SHOP_ITEMS.filter((i) => i.category === "consumable");
  const backgrounds = SHOP_ITEMS.filter((i) => i.category === "background");

  return (
    <main
      className="min-h-screen pb-10"
      style={user.activeBackground
        ? { backgroundImage: `url(/backgrounds/${user.activeBackground}.jpg)`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }
        : { backgroundColor: "#FDF6E8" }}
    >
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button type="button" onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95">
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">🎒 裝備</h1>
          <div className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#8B5FBF]">
            🟪 {user.foodCount}
          </div>
        </header>

        {doubleActive ? (
          <div className="mt-3 rounded-2xl bg-[#E8B84B]/20 px-4 py-2.5 text-center text-xs font-bold text-[#5C3D0A]">
            🎟️ 雙倍飼料券生效中！還剩 {remainingMin} 分鐘
          </div>
        ) : null}

        {message ? (
          <div className="mt-3 rounded-2xl bg-[#1A1A2E] px-4 py-2.5 text-center text-xs font-semibold text-white shadow-md">
            {message}
          </div>
        ) : null}

        {/* 消耗道具 */}
        <section className="mt-4 rounded-3xl bg-white/70 px-4 py-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-[#1A1A2E]">🧪 道具</h2>
          <div className="flex flex-col gap-2">
            {consumables.map((item) => {
              const count = user.inventory?.[item.id as keyof typeof user.inventory] ?? 0;
              const isExpiry =
                (item.id === "double_reward_voucher" && doubleActive) ||
                (item.id === "fullness_shield" && shieldActive);
              return (
                <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-[#1A1A2E]">{item.name}</p>
                    <p className="text-xs text-[#1A1A2E]/50">{item.description}</p>
                    {item.id === "double_reward_voucher" && doubleActive ? (
                      <p className="text-xs font-bold text-[#E8B84B]">生效中，還剩 {remainingMin} 分鐘</p>
                    ) : null}
                    {item.id === "fullness_shield" && shieldActive ? (
                      <p className="text-xs font-bold text-[#E8B84B]">生效中，還剩 {shieldRemainingHours} 小時</p>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-sm font-extrabold text-[#8B5FBF]">×{count}</span>
                    <button
                      type="button"
                      onClick={() => handleUse(item.id)}
                      disabled={count === 0 || isExpiry}
                      className={["rounded-xl px-3 py-1.5 text-xs font-bold transition-transform active:scale-95",
                        count > 0 && !isExpiry ? "bg-[#5B8C5A] text-white" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                      ].join(" ")}
                    >
                      使用
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 背景 */}
        <section className="mt-4 rounded-3xl bg-white/70 px-4 py-4 shadow-sm">
          <h2 className="mb-3 text-sm font-bold text-[#1A1A2E]">🎨 背景</h2>

          {/* 預設背景 */}
          <div className="mb-2 flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3">
            <div className="h-12 w-12 rounded-xl flex items-center justify-center text-xl" style={{ backgroundColor: "#FDF6E8" }}>🏠</div>
            <div className="flex-1">
              <p className="text-sm font-bold text-[#1A1A2E]">預設（米黃）</p>
              <p className="text-xs text-[#1A1A2E]/50">系統預設背景</p>
            </div>
            <button
              type="button"
              onClick={() => handleSetBackground(null)}
              className={["rounded-xl px-3 py-1.5 text-xs font-bold transition-transform active:scale-95",
                !user.activeBackground ? "bg-[#E8B84B] text-[#5C3D0A]" : "bg-[#1A1A2E]/10 text-[#1A1A2E]/50",
              ].join(" ")}
            >
              {!user.activeBackground ? "✓ 使用中" : "套用"}
            </button>
          </div>

          {backgrounds.map((item) => {
            const owned = (user.unlockedBackgrounds ?? []).includes(item.id);
            const isActive = user.activeBackground === item.id;
            return (
              <div key={item.id} className="mb-2 overflow-hidden rounded-2xl bg-white/80">
                {owned && item.backgroundSrc ? (
                  <div className="relative h-28 w-full overflow-hidden">
                    <img src={item.backgroundSrc} alt={item.name} className="h-full w-full object-cover object-top" />
                    {isActive ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <span className="rounded-full bg-[#E8B84B] px-3 py-1 text-xs font-extrabold text-[#5C3D0A]">✓ 使用中</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[#1A1A2E]">{item.name}</p>
                    <p className="text-xs text-[#1A1A2E]/50">
                      {owned ? "已擁有" : "尚未擁有（前往商店抽獎取得）"}
                    </p>
                  </div>
                  {owned ? (
                    <button
                      type="button"
                      onClick={() => handleSetBackground(isActive ? null : item.id)}
                      className={["rounded-xl px-3 py-1.5 text-xs font-bold transition-transform active:scale-95",
                        isActive ? "bg-[#1A1A2E]/10 text-[#1A1A2E]/50" : "bg-[#E8B84B] text-[#5C3D0A]",
                      ].join(" ")}
                    >
                      {isActive ? "取消" : "套用"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => router.push("/shop")}
                      className="rounded-xl bg-[#8B5FBF]/20 px-3 py-1.5 text-xs font-bold text-[#8B5FBF] transition-transform active:scale-95">
                      前往抽獎
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}

export default function InventoryPage() {
  return (
    <RequireAuth requiredRole="student">
      <InventoryContent />
    </RequireAuth>
  );
}
