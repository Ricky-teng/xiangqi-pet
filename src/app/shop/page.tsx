// src/app/shop/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { SHOP_ITEMS, BACKGROUND_GACHA_COST, BACKGROUND_GACHA_TEN_COST, BACKGROUND_GACHA_WIN_RATE, getBackgroundGachaPool, BOARD_SKIN_GACHA_COST, BOARD_SKIN_GACHA_TEN_COST, BOARD_SKIN_GACHA_WIN_RATE, getBoardSkinGachaPool, RARITY_LABELS, RARITY_COLORS, RARITY_ORDER, type ShopItem } from "@/lib/shopItems";
import GachaEgg, { type GachaPhase, type GachaResultData } from "@/components/shop/GachaEgg";
import { getTodayDateString } from "@/lib/tasks/dailyTasks";

function ShopContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const buyShopItem = useGameStore((s) => s.buyShopItem);
  const drawBackgroundGacha = useGameStore((s) => s.drawBackgroundGacha);
  const drawBackgroundGachaTen = useGameStore((s) => s.drawBackgroundGachaTen);
  const drawBoardSkinGacha = useGameStore((s) => s.drawBoardSkinGacha);
  const drawBoardSkinGachaTen = useGameStore((s) => s.drawBoardSkinGachaTen);
  const setActiveBoardSkin = useGameStore((s) => s.setActiveBoardSkin);
  const [message, setMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"consumable" | "background" | "board_skin">("consumable");
  const [isDrawing, setIsDrawing] = useState(false);
  const [gachaPhase, setGachaPhase] = useState<GachaPhase>("idle");
  const [gachaResult, setGachaResult] = useState<GachaResultData | null>(null);
  const [drawSeq, setDrawSeq] = useState(0);
  const [isDrawingTen, setIsDrawingTen] = useState(false);
  const [tenDrawResults, setTenDrawResults] = useState<{ itemId: string | null; isDuplicate: boolean }[] | null>(null);

  // 棋盤造型抽獎：獨立於背景之外的另一套狀態，UI 邏輯完全比照背景
  // （單抽用開蛋動畫、十連抽用彈窗），只是資料來源、飼料常數各自獨立。
  const [isDrawingSkin, setIsDrawingSkin] = useState(false);
  const [skinGachaPhase, setSkinGachaPhase] = useState<GachaPhase>("idle");
  const [skinGachaResult, setSkinGachaResult] = useState<GachaResultData | null>(null);
  const [skinDrawSeq, setSkinDrawSeq] = useState(0);
  const [isDrawingSkinTen, setIsDrawingSkinTen] = useState(false);
  const [tenSkinDrawResults, setTenSkinDrawResults] = useState<{ itemId: string | null; isDuplicate: boolean }[] | null>(null);

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
      // 結果直接用彈窗呈現（見下面 tenDrawResults 的 JSX），不用再
      // 額外跳一個小提示，避免同樣的資訊重複出現兩次。
      setTenDrawResults(result.results);
      setIsDrawingTen(false);
    }, 600);
  }

  function handleDrawSkin() {
    setTenSkinDrawResults(null);
    setIsDrawingSkin(true);
    setSkinGachaResult(null);
    setSkinDrawSeq((n) => n + 1);
    setSkinGachaPhase("shaking");

    setTimeout(() => {
      const result = drawBoardSkinGacha();

      if (!result.success) {
        showMessage(result.message);
        setSkinGachaPhase("idle");
        setIsDrawingSkin(false);
        return;
      }

      const resultData: GachaResultData = result.itemId
        ? { item: getBoardSkinGachaPool().find((i) => i.id === result.itemId) ?? null, isDuplicate: !!result.isDuplicate, missed: false }
        : { item: null, isDuplicate: false, missed: true };

      setSkinGachaPhase("cracking");

      setTimeout(() => {
        setSkinGachaResult(resultData);
        setSkinGachaPhase("revealed");
        showMessage(result.message);
        setIsDrawingSkin(false);
      }, 500);
    }, 900);
  }

  function handleDrawSkinTen() {
    setSkinGachaResult(null);
    setSkinGachaPhase("idle");
    setIsDrawingSkinTen(true);
    setTenSkinDrawResults(null);

    setTimeout(() => {
      const result = drawBoardSkinGachaTen();
      if (!result.success) {
        showMessage(result.message);
        setIsDrawingSkinTen(false);
        return;
      }
      setTenSkinDrawResults(result.results);
      setIsDrawingSkinTen(false);
    }, 600);
  }

  const items = SHOP_ITEMS.filter((i) => i.category === activeTab);
  const gachaPool = getBackgroundGachaPool();
  const canAffordGacha = user.foodCount >= BACKGROUND_GACHA_COST;
  const canAffordGachaTen = user.foodCount >= BACKGROUND_GACHA_TEN_COST;
  const skinGachaPool = getBoardSkinGachaPool();
  const canAffordSkinGacha = user.foodCount >= BOARD_SKIN_GACHA_COST;
  const canAffordSkinGachaTen = user.foodCount >= BOARD_SKIN_GACHA_TEN_COST;

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

        <div className="mt-4 grid grid-cols-3 gap-2">
          {(["consumable", "background", "board_skin"] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setActiveTab(tab)}
              className={["rounded-2xl py-2.5 text-xs font-bold transition-transform active:scale-95",
                activeTab === tab ? "bg-[#E8B84B] text-[#5C3D0A] shadow-md" : "bg-white/60 text-[#1A1A2E]/60",
              ].join(" ")}>
              {tab === "consumable" ? "🧪 道具" : tab === "background" ? "🎨 背景" : "♟️ 棋盤"}
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
        ) : activeTab === "background" ? (
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
                {isDrawingTen ? "十連抽中…" : canAffordGachaTen ? `十連抽 🟪 ${BACKGROUND_GACHA_TEN_COST}` : "飼料不足（十連抽）"}
              </button>
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
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            {/* 棋盤造型抽獎主卡片：UI 完全比照背景抽獎，只是資料/常數
                各自獨立（見 handleDrawSkin / handleDrawSkinTen） */}
            <div className="overflow-hidden rounded-3xl bg-white/70 p-5 text-center shadow-sm">
              <p className="text-sm font-bold text-[#1A1A2E]">棋盤造型抽獎</p>
              <p className="mt-1 text-xs text-[#1A1A2E]/60 leading-relaxed">
                每次有 {Math.round(BOARD_SKIN_GACHA_WIN_RATE * 100)}% 機率抽中任一款棋盤造型（均等機率），其餘會銘謝惠顧。
                <br />抽到已擁有的造型，飼料會全額退還！跟背景抽獎是各自獨立的池子。
              </p>

              <GachaEgg key={skinDrawSeq} phase={skinGachaPhase} result={skinGachaResult} />

              <button type="button" onClick={handleDrawSkin} disabled={!canAffordSkinGacha || isDrawingSkin || isDrawingSkinTen}
                className={["mt-2 w-full rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95",
                  canAffordSkinGacha && !isDrawingSkin && !isDrawingSkinTen ? "bg-[#8B5FBF] text-white" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                ].join(" ")}>
                {isDrawingSkin ? "抽獎中…" : canAffordSkinGacha ? `抽一次 🟪 ${BOARD_SKIN_GACHA_COST}` : "飼料不足"}
              </button>

              <button type="button" onClick={handleDrawSkinTen} disabled={!canAffordSkinGachaTen || isDrawingSkin || isDrawingSkinTen}
                className={["mt-2 w-full rounded-xl py-2.5 text-sm font-bold transition-transform active:scale-95",
                  canAffordSkinGachaTen && !isDrawingSkin && !isDrawingSkinTen ? "bg-[#E8B84B] text-[#5C3D0A]" : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/30",
                ].join(" ")}>
                {isDrawingSkinTen ? "十連抽中…" : canAffordSkinGachaTen ? `十連抽 🟪 ${BOARD_SKIN_GACHA_TEN_COST}` : "飼料不足（十連抽）"}
              </button>
            </div>

            {/* 抽獎池一覽（依稀有度由低到高排序），棋盤造型用小圖預覽
                材質（用 boardSkinSrc），已擁有的可以直接切換使用 */}
            <div className="flex flex-col gap-3">
              {[...skinGachaPool]
                .sort((a, b) => RARITY_ORDER.indexOf(a.rarity ?? "common") - RARITY_ORDER.indexOf(b.rarity ?? "common"))
                .map((item) => {
                const owned = (user.unlockedBoardSkins ?? []).includes(item.id);
                const isActive = user.activeBoardSkin === item.id;
                const rarity = item.rarity ?? "common";
                return (
                  <div key={item.id} className="overflow-hidden rounded-3xl bg-white/70 shadow-sm">
                    {item.boardSkinSrc ? (
                      <div className="relative h-24 w-full overflow-hidden">
                        <img
                          src={item.boardSkinSrc}
                          alt={item.name}
                          className={["h-full w-full object-cover", owned ? "" : "grayscale opacity-50"].join(" ")}
                        />
                        <span
                          className="absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white shadow"
                          style={{ backgroundColor: RARITY_COLORS[rarity] }}
                        >
                          {RARITY_LABELS[rarity]}
                        </span>
                        {!owned ? (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-extrabold text-[#1A1A2E]/60">❓ 尚未抽到</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="flex items-center gap-3 px-4 py-3">
                      <span className="text-2xl">{item.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#1A1A2E]">{item.name}</p>
                        <p className="text-xs text-[#1A1A2E]/50">{item.description}</p>
                      </div>
                      {owned ? (
                        <button
                          type="button"
                          onClick={() => setActiveBoardSkin(isActive ? null : item.id)}
                          className={["shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-transform active:scale-95",
                            isActive ? "bg-[#5B8C5A] text-white" : "bg-[#E8B84B] text-[#5C3D0A]",
                          ].join(" ")}
                        >
                          {isActive ? "✓ 使用中" : "套用"}
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

      {/* 十連抽結果彈窗：一次跳出來看整批戰果，比塞在頁面裡的小格子
          清楚很多。點「知道了」或背景才會關閉，不會自動消失，
          避免學生還沒看清楚就被收掉。 */}
      {tenDrawResults ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">
            <p className="text-center text-lg font-extrabold text-[#1A1A2E]">🎉 十連抽結果</p>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/50">
              獲得 {tenDrawResults.filter((r) => r.itemId && !r.isDuplicate).length} 款新背景
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {tenDrawResults.map((r, index) => {
                const item = r.itemId ? gachaPool.find((i) => i.id === r.itemId) ?? null : null;
                const rarity = item?.rarity ?? "common";
                return (
                  <div
                    key={index}
                    className={[
                      "flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center",
                      !item
                        ? "bg-[#1A1A2E]/5 shadow-sm"
                        : r.isDuplicate
                          ? "bg-[#1A1A2E]/10 shadow-sm"
                          : "border-2 border-[#E8B84B] bg-[#F6D87A] shadow-md ring-2 ring-[#E8B84B]/40",
                    ].join(" ")}
                  >
                    <span className="text-3xl">{item ? item.icon : "💨"}</span>
                    <span className={["text-xs font-bold leading-tight", !item || r.isDuplicate ? "text-[#1A1A2E]" : "text-[#5C3D0A]"].join(" ")}>
                      {item ? item.name : "銘謝惠顧"}
                    </span>
                    {item ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-extrabold text-white"
                        style={{ backgroundColor: RARITY_COLORS[rarity] }}
                      >
                        {r.isDuplicate ? "重複退還" : `🎉新款・${RARITY_LABELS[rarity]}`}
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-[#1A1A2E]/40">沒中獎</span>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setTenDrawResults(null)}
              className="mt-5 w-full rounded-2xl bg-[#5C3D0A] px-4 py-3 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95"
            >
              知道了！
            </button>
          </div>
        </div>
      ) : null}

      {/* 棋盤造型十連抽結果彈窗：UI 完全比照背景十連抽彈窗 */}
      {tenSkinDrawResults ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">
            <p className="text-center text-lg font-extrabold text-[#1A1A2E]">🎉 十連抽結果</p>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/50">
              獲得 {tenSkinDrawResults.filter((r) => r.itemId && !r.isDuplicate).length} 款新棋盤造型
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {tenSkinDrawResults.map((r, index) => {
                const item = r.itemId ? skinGachaPool.find((i) => i.id === r.itemId) ?? null : null;
                const rarity = item?.rarity ?? "common";
                return (
                  <div
                    key={index}
                    className={[
                      "flex flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center",
                      !item
                        ? "bg-[#1A1A2E]/5 shadow-sm"
                        : r.isDuplicate
                          ? "bg-[#1A1A2E]/10 shadow-sm"
                          : "border-2 border-[#E8B84B] bg-[#F6D87A] shadow-md ring-2 ring-[#E8B84B]/40",
                    ].join(" ")}
                  >
                    <span className="text-3xl">{item ? item.icon : "💨"}</span>
                    <span className={["text-xs font-bold leading-tight", !item || r.isDuplicate ? "text-[#1A1A2E]" : "text-[#5C3D0A]"].join(" ")}>
                      {item ? item.name : "銘謝惠顧"}
                    </span>
                    {item ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-extrabold text-white"
                        style={{ backgroundColor: RARITY_COLORS[rarity] }}
                      >
                        {r.isDuplicate ? "重複退還" : `🎉新款・${RARITY_LABELS[rarity]}`}
                      </span>
                    ) : (
                      <span className="text-[9px] font-semibold text-[#1A1A2E]/40">沒中獎</span>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setTenSkinDrawResults(null)}
              className="mt-5 w-full rounded-2xl bg-[#5C3D0A] px-4 py-3 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95"
            >
              知道了！
            </button>
          </div>
        </div>
      ) : null}
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
