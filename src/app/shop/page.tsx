"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { SHOP_ITEMS, type ShopItem } from "@/lib/shopItems";

function ShopContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const buyShopItem = useGameStore((s) => s.buyShopItem);
  const useItem = useGameStore((s) => s.useItem);
  const setActiveBackground = useGameStore((s) => s.setActiveBackground);
  const isDoubleRewardActive = useGameStore((s) => s.isDoubleRewardActive);

  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"consumable" | "background">("consumable");

  if (!user) return null;

  const doubleActive = isDoubleRewardActive();
  const expiryMs = user.doubleRewardExpiry ?? 0;
  const remainingMin = doubleActive ? Math.ceil((expiryMs - Date.now()) / 60000) : 0;

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function handleBuy(item: ShopItem) {
    const result = buyShopItem(item.id, item.price, item.category);
    showMessage(result.message);
  }

  function handleUse(itemId: string) {
    const result = useItem(itemId);
    showMessage(result.message);
  }

  function handleSetBackground(id: string | null) {
    setActiveBackground(id);
    showMessage(id ? "✅ 背景已套用！" : "✅ 已切換回預設背景");
  }

  const items = SHOP_ITEMS.filter((i) => i.category === activeTab);

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button type="button" onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95">
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">🏪 商店</h1>
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

        <div className="mt-4 grid grid-cols-2 gap-2">
          {(["consumable", "background"] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)}
              className={["rounded-2xl py-2.5 text-sm font-bold transition-transform active:scale-95",
                activeTab === tab ? "bg-[#E8B84B] text-[#5C3D0A] shadow-md" : "bg-white/60 text-[#1A1A2E]/60",
              ].join(" ")}>
              {tab === "consumable" ? "🎒 道具" : "🎨 背景"}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {items.map((item) => {
            const owned = item.category === "background"
              ? (user.unlockedBackgrounds ?? []).includes(item.id)
              : (user.inventory?.[item.id as keyof typeof user.inventory] ?? 0) > 0;
            const count = item.category === "consumable"
              ? (user.inventory?.[item.id as keyof typeof user.inventory] ?? 0)
              : 0;
            const isActive = user.activeBackground === item.id;
            const canAfford = user.foodCount >= item.price;

            return (
              <div key={item.id} className="overflow-hidden rounded-3xl bg-white/70 shadow-sm">
                {item.category === "background" && item.backgroundSrc ? (
                  <div className="relative h-40 w-full overflow-hidden">
                    <img src={item.backgroundSrc} alt={item.name} className="h-full w-full object-cover object-top" />
                    {isActive ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="rounded-full bg-[#E8B84B] px-3 py-1 text-xs font-extrabold text-[#5C3D0A]">✓ 使用中</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex items-start gap-3 px-4 py-4">
                  <span className="text-3xl">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[#1A1A2E] text-sm">
                      {item.name}
                      {count > 0 ? (
                        <span className="ml-2 rounded-full bg-[#8B5FBF]/20 px-2 py-0.5 text-[10px] font-extrabold text-[#8B5FBF]">×{count}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-[#1A1A2E]/60 leading-relaxed">{item.description}</p>
                    <p className="mt-1 text-xs font-bold text-[#E8B84B]">🟪 {item.price} 飼料</p>
                  </div>
                </div>

                <div className="flex gap-2 border-t border-[#1A1A2E]/5 px-4 py-3">
                  {item.category === "background" && owned ? (
                    isActive ? (
                      <button type="button" onClick={() => handleSetBackground(null)}
                        className="flex-1 rounded-xl bg-[#1A1A2E]/10 py-2 text-xs font-bold text-[#1A1A2E]/50 transition-transform active:scale-95">
                        取消套用
                      </button>
                    ) : (
                      <button type="button" onClick={() => handleSetBackground(item.id)}
                        className="flex-1 rounded-xl bg-[#E8B84B] py-2 text-xs font-bold text-[#5C3D0A] transition-transform active:scale-95">
                        套用背景
                      </button>
                    )
                  ) : item.category === "consumable" && count > 0 ? (
                    <button type="button" onClick={() => handleUse(item.id)}
                      className="flex-1 rounded-xl bg-[#5B8C5A] py-2 text-xs font-bold text-white transition-transform active:scale-95">
                      使用
                    </button>
                  ) : null}

                  {!(item.category === "background" && owned) ? (
                    <button type="button" onClick={() => handleBuy(item)} disabled={!canAfford}
                      className={["flex-1 rounded-xl py-2 text-xs font-bold transition-transform active:scale-95",
                        canAfford ? "bg-[#8B5FBF] text-white" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                      ].join(" ")}>
                      {canAfford ? `購買 ${item.price} 🟪` : "飼料不足"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {activeTab === "consumable" ? (
          <div className="mt-4 rounded-2xl bg-white/60 px-4 py-3">
            <p className="text-xs font-bold text-[#1A1A2E]/60">🎒 背包</p>
            <div className="mt-2 flex gap-3">
              {[{ id: "revival_potion", icon: "⚗️", name: "復活藥水" }, { id: "double_reward_voucher", icon: "🎟️", name: "雙倍飼料券" }].map(({ id, icon, name }) => (
                <div key={id} className="flex flex-col items-center gap-1 rounded-xl bg-white/80 px-3 py-2 text-center">
                  <span className="text-2xl">{icon}</span>
                  <span className="text-[10px] text-[#1A1A2E]/60">{name}</span>
                  <span className="text-sm font-extrabold text-[#8B5FBF]">×{user.inventory?.[id as keyof typeof user.inventory] ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function ShopPage() {
  return (
    <RequireAuth requiredRole="student">
      <ShopContent />
    </RequireAuth>
  );
}
