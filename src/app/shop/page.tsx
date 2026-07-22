// src/app/shop/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { SHOP_ITEMS, BACKGROUND_GACHA_COST, BACKGROUND_GACHA_WIN_RATE, getBackgroundGachaPool, RARITY_LABELS, RARITY_COLORS, RARITY_ORDER, type ShopItem } from "@/lib/shopItems";
import GachaEgg, { type GachaPhase, type GachaResultData } from "@/components/shop/GachaEgg";
import { getTodayDateString } from "@/lib/tasks/dailyTasks";

function ShopContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const buyShopItem = useGameStore((s) => s.buyShopItem);
  const drawBackgroundGacha = useGameStore((s) => s.drawBackgroundGacha);
  const drawBackgroundGachaTen = useGameStore((s) => s.drawBackgroundGachaTen);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"consumable" | "background">("consumable");
  const [isDrawing, setIsDrawing] = useState(false);
  const [gachaPhase, setGachaPhase] = useState<GachaPhase>("idle");
  const [gachaResult, setGachaResult] = useState<GachaResultData | null>(null);
  const [drawSeq, setDrawSeq] = useState(0);
  const [isDrawingTen, setIsDrawingTen] = useState(false);
  const [tenDrawResults, setTenDrawResults] = useState<{ itemId: string | null; isDuplicate: boolean }[] | null>(null);

  if (!user) return null;

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  function handleBuy(item: ShopItem) {
    const result = buyShopItem(item.id, item.price, item.category);
    showMessage(result.message);
  }

  function handleDraw() {
    setTenDrawResults(null);
    setIsDrawing(true);
    setGachaResult(null);
    setDrawSeq((n) => n + 1);
    setGachaPhase("shaking");

    // 搖晃醞釀期待感（時長需對齊 GachaEgg 的 gacha-shake 動畫：0.9s）
    setTimeout(() => {
      const result = drawBackgroundGacha();

      if (!result.success) {
        // 沒扣成功（例如飼料不夠時被卡在按鈕，理論上不會發生，防呆用）
        showMessage(result.message);
        setGachaPhase("idle");
        setIsDrawing(false);
        return;
      }

      const resultData: GachaResultData = result.itemId
        ? { item: getBackgroundGachaPool().find((i) => i.id === result.itemId) ?? null, isDuplicate: !!result.isDuplicate, missed: false }
        : { item: null, isDuplicate: false, missed: true };

      setGachaPhase("cracking");

      // 蛋殼裂開飛散（時長需對齊 gacha-crack-top/bottom 動畫：0.5s），
      // 結束後才揭曉結果卡片跟文字訊息，讓視覺跟文字同步出現
      setTimeout(() => {
        setGachaResult(resultData);
        setGachaPhase("revealed");
        showMessage(result.message);
        setIsDrawing(false);
      }, 500);
    }, 900);
  }

  function handleDrawTen() {
    // 十連抽不用單抽那套「搖晃→裂開」動畫（跑 10 次太慢），改成一次
    // 抽完直接用結果格子呈現，比較符合十連抽「快速看到一整批結果」的
    // 期待。清掉單抽的結果，避免兩種呈現方式同時疊在畫面上。
    setGachaResult(null);
    setGachaPhase("idle");
    setIsDrawingTen(true);
    setTenDrawResults(null);

    setTimeout(() => {
      const result = drawBackgroundGachaTen();
      if (!result.success) {
        showMessage(result.message);
        setIsDrawingTen(false);
        return;
      }
      setTenDrawResults(result.results);
      showMessage(result.message);
      setIsDrawingTen(false);
    }, 600);
  }

  const items = SHOP_ITEMS.filter((i) => i.category === activeTab);
  const gachaPool = getBackgroundGachaPool();
  const canAffordGacha = user.foodCount >= BACKGROUND_GACHA_COST;
  const canAffordGachaTen = user.foodCount >= BACKGROUND_GACHA_COST * 10;

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
          <h1 className="text-base font-bold text-[#1A1A2E]">🏪 商店</h1>
          <div className="flex items-center gap-1 rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-[#8B5FBF]">
            🟪 {user.foodCount}
          </div>
        </header>

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
              {tab === "consumable" ? "🧪 道具" : "🎨 背景"}
            </button>
          ))}
        </div>

        {activeTab === "consumable" ? (
          <div className="mt-4 flex flex-col gap-2">
            {items.map((item) => {
              const count = user.inventory?.[item.id as keyof typeof user.inventory] ?? 0;
              const boughtToday = item.id === "double_reward_voucher" && user.lastDoubleVoucherPurchaseDate === getTodayDateString();
              const canAfford = user.foodCount >= item.price && !boughtToday;

              return (
                <div key={item.id} className="flex items-center gap-2.5 rounded-2xl bg-white/70 px-3 py-2.5 shadow-sm">
                  <span className="shrink-0 text-2xl">{item.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-[#1A1A2E]">
                      <span className="truncate">{item.name}</span>
                      {count > 0 ? (
                        <span className="shrink-0 rounded-full bg-[#8B5FBF]/20 px-1.5 py-0.5 text-[9px] font-extrabold text-[#8B5FBF]">×{count}</span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[#1A1A2E]/50">{item.description}</p>
                  </div>
                  <button type="button" onClick={() => handleBuy(item)} disabled={!canAfford}
                    className={["shrink-0 rounded-xl px-3 py-2 text-[11px] font-bold leading-tight transition-transform active:scale-95",
                      canAfford ? "bg-[#8B5FBF] text-white" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                    ].join(" ")}>
                    {boughtToday ? "已買過" : canAfford ? `🟪${item.price}` : "不足"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {/* 抽獎主卡片 */}
            <div className="overflow-hidden rounded-3xl bg-white/70 p-5 text-center shadow-sm">
              <p className="text-sm font-bold text-[#1A1A2E]">背景抽獎</p>
              <p className="mt-1 text-xs text-[#1A1A2E]/60 leading-relaxed">
                每次有 {Math.round(BACKGROUND_GACHA_WIN_RATE * 100)}% 機率抽中任一款背景（均等機率），其餘會銘謝惠顧。
                <br />抽到已擁有的背景，飼料會全額退還！
              </p>

              <GachaEgg key={drawSeq} phase={gachaPhase} result={gachaResult} />

              <button type="button" onClick={handleDraw} disabled={!canAffordGacha || isDrawing || isDrawingTen}
                className={["mt-2 w-full rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95",
                  canAffordGacha && !isDrawing && !isDrawingTen ? "bg-[#8B5FBF] text-white" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                ].join(" ")}>
                {isDrawing ? "抽獎中…" : canAffordGacha ? `抽一次 🟪 ${BACKGROUND_GACHA_COST}` : "飼料不足"}
              </button>

              <button type="button" onClick={handleDrawTen} disabled={!canAffordGachaTen || isDrawing || isDrawingTen}
                className={["mt-2 w-full rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95",
                  canAffordGachaTen && !isDrawing && !isDrawingTen ? "bg-[#E8B84B] text-[#5C3D0A]" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                ].join(" ")}>
                {isDrawingTen ? "十連抽中…" : canAffordGachaTen ? `十連抽 🟪 ${BACKGROUND_GACHA_COST * 10}` : "飼料不足（十連抽）"}
              </button>

              {/* 十連抽結果：不用單抽那套開蛋動畫，直接用 5x2 格子攤開
                  10 個結果，每格顯示是不是新款/重複/銘謝惠顧。 */}
              {tenDrawResults ? (
                <div className="mt-3 grid grid-cols-5 gap-1.5">
                  {tenDrawResults.map((r, index) => {
                    const item = r.itemId ? gachaPool.find((i) => i.id === r.itemId) ?? null : null;
                    return (
                      <div
                        key={index}
                        className={[
                          "flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center",
                          !item ? "bg-[#1A1A2E]/5" : r.isDuplicate ? "bg-[#1A1A2E]/10" : "bg-[#E8B84B]/25",
                        ].join(" ")}
                      >
                        <span className="text-lg">{item ? item.icon : "💨"}</span>
                        <span className="text-[9px] font-bold leading-tight text-[#1A1A2E]/70">
                          {!item ? "銘謝惠顧" : r.isDuplicate ? "重複退還" : "🎉新款"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* 抽獎池一覽（依稀有度由低到高排序） */}
            <div className="flex flex-col gap-3">
              {[...gachaPool]
                .sort((a, b) => RARITY_ORDER.indexOf(a.rarity ?? "common") - RARITY_ORDER.indexOf(b.rarity ?? "common"))
                .map((item) => {
                const owned = (user.unlockedBackgrounds ?? []).includes(item.id);
                const rarity = item.rarity ?? "common";
                return (
                  <div key={item.id} className="overflow-hidden rounded-3xl bg-white/70 shadow-sm">
                    {item.backgroundSrc ? (
                      <div className="relative h-32 w-full overflow-hidden">
                        <img
                          src={item.backgroundSrc}
                          alt={item.name}
                          className={["h-full w-full object-cover object-top", owned ? "" : "grayscale opacity-50"].join(" ")}
                        />
                        <span
                          className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white shadow"
                          style={{ backgroundColor: RARITY_COLORS[rarity] }}
                        >
                          {RARITY_LABELS[rarity]}
                        </span>
                        {owned ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="rounded-full bg-[#E8B84B] px-3 py-1 text-xs font-extrabold text-[#5C3D0A]">✓ 已擁有</span>
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-[#1A1A2E]/60">❓ 尚未抽到</span>
                          </div>
                        )}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-2xl">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1A1A2E]">{item.name}</p>
                        <p className="text-xs text-[#1A1A2E]/50">{item.description}</p>
                      </div>
                      {owned ? (
                        <button type="button" onClick={() => router.push("/inventory")}
                          className="rounded-xl bg-[#E8B84B] px-3 py-1.5 text-xs font-bold text-[#5C3D0A] transition-transform active:scale-95">
                          前往物品
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
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
