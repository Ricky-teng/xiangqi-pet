// src/components/EquipmentSection.tsx
"use client";

/**
 * 「🎒 物品」頁的裝備分頁
 * ------------------------------------------------------------
 * 三個區塊，由上而下：
 *   1. 購買  — 第 1 階武器／防具各 100 飼料、背包擴充 +20 格 1000 飼料
 *   2. 背包  — 同階同類型折疊顯示，但格數照算（一件一格）
 *   3. 合成  — 手動選 3 件（有光效）＋ 一鍵合成（先跳確認頁）
 *
 * 折疊顯示的重點：畫面上只出現「粗製武器 ×27」一個圖示，但格數
 * 仍然是 27 格。所以卡片上同時寫著數量跟「佔 27 格」，不然學生會
 * 以為折疊等於只佔一格，背包爆掉的時候搞不清楚為什麼。
 */

import { useMemo, useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import RulesButton from "@/components/RulesButton";
import {
  BAG_EXPAND_COST,
  BAG_EXPAND_SLOTS,
  EQUIPMENT_SHOP_PRICE,
  FUSE_REQUIRED_COUNT,
  KIND_EMOJIS,
  KIND_LABELS,
  MAX_EQUIPMENT_TIER,
  autoFuse,
  getBagCapacity,
  getEquipmentBonusLabel,
  getEquipmentName,
  getTierColor,
  getTierName,
  groupBag,
  isTierGlowing,
  type BagGroup,
  type EquipmentItem,
  type EquipmentKind,
} from "@/lib/rpg/equipment";

interface EquipmentSectionProps {
  /** 統一交給物品頁顯示訊息，跟道具／背景分頁共用同一條提示列 */
  onMessage: (message: string) => void;
}

/** 一格裝備的方塊（框色依階級，第 5 階發光） */
function EquipmentTile({
  item,
  count,
  selectedCount,
  onClick,
  disabled,
}: {
  item: EquipmentItem;
  count: number;
  selectedCount: number;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const color = getTierColor(item.tier);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative flex flex-col items-center gap-0.5 rounded-2xl border-2 bg-white/90 px-1 py-2 transition-transform active:scale-95 disabled:opacity-40"
      style={{
        borderColor: color,
        boxShadow: isTierGlowing(item.tier) ? `0 0 10px ${color}99` : undefined,
      }}
    >
      <span className="text-xl">{KIND_EMOJIS[item.kind]}</span>
      <span className="text-[9px] font-extrabold leading-tight" style={{ color }}>
        {getTierName(item.tier)}
      </span>
      <span className="text-[9px] font-bold text-[#1A1A2E]/55">{KIND_LABELS[item.kind]}</span>
      {count > 1 ? (
        <span className="absolute -right-1 -top-1 rounded-full bg-[#1A1A2E] px-1.5 py-0.5 text-[9px] font-extrabold text-[#E8B84B]">
          ×{count}
        </span>
      ) : null}
      {selectedCount > 0 ? (
        <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#5B8C5A] text-[10px] font-extrabold text-white">
          {selectedCount}
        </span>
      ) : null}
    </button>
  );
}

export default function EquipmentSection({ onMessage }: EquipmentSectionProps) {
  const user = useGameStore((s) => s.user);
  const buyEquipment = useGameStore((s) => s.buyEquipment);
  const expandBag = useGameStore((s) => s.expandBag);
  const fuseEquipmentItems = useGameStore((s) => s.fuseEquipmentItems);
  const autoFuseBag = useGameStore((s) => s.autoFuseBag);

  /** 手動合成槽：存的是背包裡的 item id，最多 FUSE_REQUIRED_COUNT 件 */
  const [fuseSlots, setFuseSlots] = useState<string[]>([]);
  /** 一鍵合成的確認頁（null = 沒在確認） */
  const [autoFusePreview, setAutoFusePreview] = useState<{ fuseCount: number; produced: EquipmentItem[] } | null>(null);
  /** 合成成功的光效（放一下就消失） */
  const [fuseFlash, setFuseFlash] = useState(false);

  const bag = useMemo(() => user?.equipmentBag ?? [], [user]);
  const expandCount = user?.bagExpandCount ?? 0;
  const capacity = getBagCapacity(expandCount);
  const groups = useMemo(() => groupBag(bag), [bag]);

  if (!user) return null;

  const isBagFull = bag.length >= capacity;

  /** 合成槽裡目前選了哪些（轉成實際物件） */
  const fusePicked = fuseSlots
    .map((id) => bag.find((item) => item.id === id))
    .filter((item): item is EquipmentItem => Boolean(item));

  /** 這一組（同階同類型）目前在合成槽裡被選了幾件 */
  function getSelectedCount(group: BagGroup): number {
    return fusePicked.filter((item) => item.kind === group.kind && item.tier === group.tier).length;
  }

  function handleBuy(kind: EquipmentKind) {
    const result = buyEquipment(kind);
    onMessage(result.message);
  }

  function handleExpand() {
    const result = expandBag();
    onMessage(result.message);
  }

  /** 點背包裡的一組：從那組裡挑一件還沒被選的丟進合成槽 */
  function handlePickForFuse(group: BagGroup) {
    if (group.tier >= MAX_EQUIPMENT_TIER) {
      onMessage(`${getTierName(MAX_EQUIPMENT_TIER)}已經是最高階，不能再合成。`);
      return;
    }
    if (fuseSlots.length >= FUSE_REQUIRED_COUNT) {
      onMessage(`合成槽只能放 ${FUSE_REQUIRED_COUNT} 件，先按「清空」再重選。`);
      return;
    }
    // 已經選了東西的話，後面只能選同階同類型的，不然一定合不成
    if (fusePicked.length > 0) {
      const first = fusePicked[0];
      if (first.kind !== group.kind || first.tier !== group.tier) {
        onMessage("合成要 3 件同階同類型的裝備喔。");
        return;
      }
    }
    const next = group.items.find((item) => !fuseSlots.includes(item.id));
    if (!next) {
      onMessage("這一組已經全部放進合成槽了。");
      return;
    }
    setFuseSlots([...fuseSlots, next.id]);
  }

  function handleFuse() {
    const result = fuseEquipmentItems(fuseSlots);
    onMessage(result.message);
    if (result.success) {
      setFuseSlots([]);
      setFuseFlash(true);
      setTimeout(() => setFuseFlash(false), 700);
    }
  }

  function handleOpenAutoFuse() {
    const preview = autoFuse(bag, Date.now());
    if (preview.fuseCount === 0) {
      onMessage("沒有任何同階同類型湊滿 3 件的裝備可以合成。");
      return;
    }
    setAutoFusePreview({ fuseCount: preview.fuseCount, produced: preview.produced });
  }

  function handleConfirmAutoFuse() {
    const result = autoFuseBag();
    onMessage(result.message);
    setAutoFusePreview(null);
    setFuseSlots([]);
    if (result.success) {
      setFuseFlash(true);
      setTimeout(() => setFuseFlash(false), 700);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* ============================================================
          1. 購買
         ============================================================ */}
      <section className="rounded-3xl bg-white/70 px-4 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#1A1A2E]">🏪 購買裝備</h2>
          <RulesButton topic="equipment" />
        </div>
        <p className="mt-0.5 text-[11px] text-[#1A1A2E]/50">
          商店只賣第 1 階，更高階要靠合成（3 件同階同類型 → 1 件高一階）
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["weapon", "armor"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => handleBuy(kind)}
              disabled={user.foodCount < EQUIPMENT_SHOP_PRICE || isBagFull}
              className="flex flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-2 py-3 shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-2xl">{KIND_EMOJIS[kind]}</span>
              <span className="text-xs font-extrabold text-[#5C3D0A]">
                粗製{KIND_LABELS[kind]}
              </span>
              <span className="text-[10px] font-bold text-[#5C3D0A]/70">
                {kind === "weapon" ? "攻擊 +20" : "防禦 +10・體力 +100"}
              </span>
              <span className="mt-0.5 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-extrabold text-[#5C3D0A]">
                🌾 {EQUIPMENT_SHOP_PRICE}
              </span>
            </button>
          ))}
        </div>

        {isBagFull ? (
          <p className="mt-2 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-[11px] font-bold text-[#C0392B]">
            背包滿了（{bag.length}/{capacity}），先合成幾件或擴充背包才能再買。
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleExpand}
          disabled={user.foodCount < BAG_EXPAND_COST}
          className="mt-2 w-full rounded-xl bg-[#1A1A2E] px-4 py-2.5 text-xs font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          📦 背包 +{BAG_EXPAND_SLOTS} 格（🌾 {BAG_EXPAND_COST}）
        </button>
      </section>

      {/* ============================================================
          2. 背包
         ============================================================ */}
      <section className="rounded-3xl bg-white/70 px-4 py-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-[#1A1A2E]">📦 背包</h2>
          <span
            className={[
              "text-xs font-extrabold",
              bag.length >= capacity ? "text-[#C0392B]" : "text-[#1A1A2E]/60",
            ].join(" ")}
          >
            {bag.length} / {capacity} 格
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-[#1A1A2E]/50">
          同階同類型會折疊成一格顯示，但<span className="font-bold">格數是一件一格</span>算的
        </p>

        {groups.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white/60 px-3 py-6 text-center text-xs text-[#1A1A2E]/45">
            背包是空的。先買一件武器，才能派小雞去探險。
          </p>
        ) : (
          <div
            className={[
              "mt-3 grid grid-cols-4 gap-2 transition-all",
              fuseFlash ? "scale-[1.02] brightness-110" : "",
            ].join(" ")}
          >
            {groups.map((group) => (
              <div key={`${group.kind}-${group.tier}`} className="flex flex-col items-center gap-0.5">
                <EquipmentTile
                  item={group.items[0]}
                  count={group.count}
                  selectedCount={getSelectedCount(group)}
                  onClick={() => handlePickForFuse(group)}
                />
                <span className="text-[9px] text-[#1A1A2E]/40">佔 {group.count} 格</span>
              </div>
            ))}
          </div>
        )}

        {groups.length > 0 ? (
          <p className="mt-2 text-[10px] text-[#1A1A2E]/40">
            點一下把裝備放進下面的合成槽。要換裝到小雞身上請到「🐣 我的小雞」。
          </p>
        ) : null}
      </section>

      {/* ============================================================
          3. 合成
         ============================================================ */}
      <section className="rounded-3xl bg-white/70 px-4 py-4 shadow-sm">
        <h2 className="text-sm font-bold text-[#1A1A2E]">⚒️ 合成</h2>
        <p className="mt-0.5 text-[11px] text-[#1A1A2E]/50">
          {FUSE_REQUIRED_COUNT} 件同階同類型 → 1 件高一階，必定成功，不用額外花飼料
        </p>

        {/* 合成槽 */}
        <div className="mt-3 flex items-center justify-center gap-2">
          {Array.from({ length: FUSE_REQUIRED_COUNT }).map((_, index) => {
            const item = fusePicked[index];
            return (
              <div
                key={index}
                className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed"
                style={{
                  borderColor: item ? getTierColor(item.tier) : "rgba(26,26,46,0.2)",
                  backgroundColor: item ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.4)",
                  boxShadow: fuseFlash ? "0 0 16px #E8B84B" : undefined,
                }}
              >
                {item ? (
                  <div className="flex flex-col items-center">
                    <span className="text-xl">{KIND_EMOJIS[item.kind]}</span>
                    <span
                      className="text-[9px] font-extrabold"
                      style={{ color: getTierColor(item.tier) }}
                    >
                      {getTierName(item.tier)}
                    </span>
                  </div>
                ) : (
                  <span className="text-lg text-[#1A1A2E]/20">＋</span>
                )}
              </div>
            );
          })}
        </div>

        {fusePicked.length === FUSE_REQUIRED_COUNT ? (
          <p className="mt-2 text-center text-xs font-bold text-[#5B8C5A]">
            會合成出：{getTierName((fusePicked[0].tier + 1) as 2 | 3 | 4 | 5)}
            {KIND_LABELS[fusePicked[0].kind]}
          </p>
        ) : (
          <p className="mt-2 text-center text-[11px] text-[#1A1A2E]/45">
            從上面的背包點選 {FUSE_REQUIRED_COUNT - fusePicked.length} 件
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFuseSlots([])}
            disabled={fuseSlots.length === 0}
            className="rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#1A1A2E]/70 shadow-sm transition-transform active:scale-95 disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            onClick={handleFuse}
            disabled={fusePicked.length !== FUSE_REQUIRED_COUNT}
            className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-xs font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:opacity-40"
          >
            ⚒️ 合成
          </button>
        </div>

        <button
          type="button"
          onClick={handleOpenAutoFuse}
          disabled={bag.length < FUSE_REQUIRED_COUNT}
          className="mt-2 w-full rounded-xl bg-[#5B8C5A] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-40"
        >
          ⚡ 一鍵合成（能合的全部合到底）
        </button>
      </section>

      {/* ============================================================
          一鍵合成的確認頁
         ============================================================ */}
      {autoFusePreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-[#FDF6E8] p-5 shadow-2xl">
            <h3 className="text-center text-base font-extrabold text-[#1A1A2E]">⚡ 一鍵合成</h3>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/60">
              會合成 {autoFusePreview.fuseCount} 次，合出下面這些：
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {autoFusePreview.produced.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col items-center rounded-xl border-2 bg-white/90 px-2 py-1.5"
                  style={{ borderColor: getTierColor(item.tier) }}
                >
                  <span className="text-lg">{KIND_EMOJIS[item.kind]}</span>
                  <span
                    className="text-[10px] font-extrabold"
                    style={{ color: getTierColor(item.tier) }}
                  >
                    {getEquipmentName(item)}
                  </span>
                  <span className="text-[9px] text-[#1A1A2E]/50">{getEquipmentBonusLabel(item)}</span>
                </div>
              ))}
            </div>

            <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[11px] text-[#1A1A2E]/60">
              合成是從低階往高階跑的，所以 9 件粗製武器會變成 1 件稀有武器，
              而不是停在 3 件精良武器。
            </p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAutoFusePreview(null)}
                className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1A2E]/70 shadow-sm transition-transform active:scale-95"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirmAutoFuse}
                className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
              >
                確定合成
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
