// src/components/rpg/ItemDetail.tsx
"use client";

/**
 * 單件裝備的共用元件
 * ------------------------------------------------------------
 *   ItemTile        卡框＋裝備圖＋寶石孔（背包、選擇器、裝備格都用）
 *   QualityBadge    品質標籤（+7% 綠、−3% 紅、標準 灰）
 *   ItemInfoLines   名稱＋品質＋數值＋特殊效果的說明文字
 *   GemSocketSheet  鑲／拆寶石的面板（物品頁、我的小雞共用）
 *
 * 鑲寶石的面板只需要知道「這件裝備在哪裡」（EquipmentTarget），
 * 每次都從 store 重新找出最新的那件，所以鑲完一顆畫面馬上更新，
 * 不會拿著過期的物件。
 */

import { useState } from "react";
import { useGameStore, type EquipmentTarget } from "@/stores/useGameStore";
import {
  getEquipmentBonusLabel,
  getEquipmentName,
  getItemGems,
  getItemQuality,
  getItemSpecial,
  getItemType,
  getQualityLabel,
  getSocketCount,
  getSpecialLabel,
  type EquipmentItem,
} from "@/lib/rpg/equipment";
import { GEM_IDS, GEM_TABLE, getGemCount, type GemId } from "@/lib/rpg/gems";
import EquipmentIcon, { ItemFrame, getTierMaterial } from "@/components/rpg/EquipmentIcon";
import GemIcon from "@/components/rpg/GemIcon";

export function ItemTile({
  item,
  size,
  selected,
  count,
  showSockets = true,
}: {
  item: EquipmentItem;
  size: number;
  selected?: boolean;
  count?: number;
  showSockets?: boolean;
}) {
  return (
    <ItemFrame
      tier={item.tier}
      size={size}
      selected={selected}
      count={count}
      sockets={showSockets ? getSocketCount(item.tier) : undefined}
      gems={getItemGems(item)}
    >
      <EquipmentIcon kind={item.kind} type={getItemType(item)} tier={item.tier} size={Math.round(size * 0.7)} />
    </ItemFrame>
  );
}

export function QualityBadge({ item, className }: { item: EquipmentItem; className?: string }) {
  const q = getItemQuality(item);
  const tone = q > 0.005 ? { bg: "rgba(61,219,132,0.18)", fg: "#7FE8A8" } : q < -0.005 ? { bg: "rgba(255,77,94,0.18)", fg: "#FF9AA6" } : { bg: "rgba(255,255,255,0.1)", fg: "rgba(255,255,255,0.6)" };
  return (
    <span className={["inline-block rounded-md px-1.5 py-0.5 text-[10px] font-black leading-none", className ?? ""].join(" ")} style={{ background: tone.bg, color: tone.fg }}>
      品質 {getQualityLabel(item)}
    </span>
  );
}

export function ItemInfoLines({ item, compact = false }: { item: EquipmentItem; compact?: boolean }) {
  const special = getSpecialLabel(getItemSpecial(item));
  const m = getTierMaterial(item.tier);
  return (
    <div className="min-w-0">
      <p className="flex flex-wrap items-center gap-1.5">
        <span className={["font-black", compact ? "text-[12px]" : "text-[14px]"].join(" ")} style={{ color: m.frameHi }}>
          {getEquipmentName(item)}
        </span>
        <QualityBadge item={item} />
      </p>
      <p className="mt-0.5 text-[11px] font-bold text-white/70">{getEquipmentBonusLabel(item)}</p>
      {special ? <p className="mt-0.5 text-[11px] font-bold text-[#FFE58A]">{special}</p> : null}
    </div>
  );
}

/**
 * 鑲／拆寶石的面板。
 * 上方：大圖＋每個孔（點已鑲的就拆下來）
 * 下方：寶石袋（點一色就鑲進下一個空孔）
 */
export function GemSocketSheet({ target, onClose }: { target: EquipmentTarget; onClose: () => void }) {
  const user = useGameStore((s) => s.user);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const livingPet = useGameStore((s) => s.pet);
  const socketGemInto = useGameStore((s) => s.socketGemInto);
  const unsocketGemFrom = useGameStore((s) => s.unsocketGemFrom);
  const [message, setMessage] = useState<string | null>(null);
  const [popIndex, setPopIndex] = useState<number | null>(null);

  // 每次 render 都從 store 找最新的那件（derived，不另外存 state）
  const item: EquipmentItem | null = (() => {
    if (!user) return null;
    if (target.where === "bag") return (user.equipmentBag ?? []).find((i) => i.id === target.itemId) ?? null;
    if (target.where === "pet") {
      const p = collectedPets.find((c) => c.id === target.petId);
      return (target.slot === "weapon" ? p?.weapon : p?.armor) ?? null;
    }
    return (target.slot === "weapon" ? livingPet?.weapon : livingPet?.armor) ?? null;
  })();

  if (!user || !item) return null;

  const gems = getItemGems(item);
  const sockets = getSocketCount(item.tier);
  const full = gems.length >= sockets;

  async function handleSocket(gem: GemId) {
    const r = await socketGemInto(target, gem);
    setMessage(r.message);
    if (r.success) setPopIndex(gems.length);
  }

  async function handleUnsocket(index: number) {
    const r = await unsocketGemFrom(target, index);
    setMessage(r.message);
    setPopIndex(null);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 sm:items-center" onClick={onClose}>
      <div
        className="rules-sheet max-h-[86vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] px-5 pb-6 pt-4 sm:rounded-[28px]"
        style={{ background: "linear-gradient(180deg,#221F48 0%,#0E0D1E 100%)", boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="鑲嵌寶石"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />

        <div className="flex items-center gap-3">
          <ItemTile item={item} size={76} showSockets={false} />
          <ItemInfoLines item={item} />
        </div>

        {/* 孔 */}
        <div className="mt-4 rounded-2xl bg-black/30 px-3 py-3 ring-1 ring-white/10">
          <p className="text-[11px] font-black text-white/60">
            寶石孔 {gems.length} / {sockets}
            <span className="ml-1.5 font-bold text-white/40">點已鑲的寶石可以免費拆下來</span>
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-2.5">
            {Array.from({ length: sockets }, (_, i) => {
              const gem = gems[i];
              return gem ? (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleUnsocket(i)}
                  className={["flex h-[52px] w-[52px] items-center justify-center rounded-full transition-transform active:scale-90", popIndex === i ? "gem-pop" : ""].join(" ")}
                  style={{ background: "radial-gradient(circle at 50% 40%, #2A2850, #0B0A18)", boxShadow: `0 0 0 2px ${GEM_TABLE[gem].mid}, 0 0 12px ${GEM_TABLE[gem].mid}88` }}
                  aria-label={`拆下${GEM_TABLE[gem].name}`}
                >
                  <GemIcon gem={gem} size={34} />
                </button>
              ) : (
                <span
                  key={i}
                  className="flex h-[52px] w-[52px] items-center justify-center rounded-full text-[18px] font-black text-white/25"
                  style={{ background: "radial-gradient(circle at 50% 40%, rgba(0,0,0,0.7), rgba(0,0,0,0.35))", boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8), 0 0 0 1.5px rgba(255,255,255,0.2)" }}
                >
                  +
                </span>
              );
            })}
          </div>
        </div>

        {/* 寶石袋 */}
        <p className="mt-4 text-[12px] font-black text-white/70">{full ? "孔已經滿了，先拆下一顆才能鑲新的" : "點一顆寶石鑲進去"}</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {GEM_IDS.map((g) => {
            const n = getGemCount(user.gemBag, g);
            const disabled = n <= 0 || full;
            return (
              <button
                key={g}
                type="button"
                disabled={disabled}
                onClick={() => handleSocket(g)}
                className="flex flex-col items-center rounded-2xl bg-white/[0.06] px-1 pb-2 pt-2.5 ring-1 ring-white/10 transition-transform active:scale-95 disabled:opacity-35"
              >
                <span className="relative">
                  <GemIcon gem={g} size={34} />
                  <span className="font-display absolute -bottom-1 -right-3 rounded-full bg-black/70 px-1.5 text-[11px] leading-[16px] text-white ring-1 ring-white/20">×{n}</span>
                </span>
                <span className="mt-1.5 text-[11.5px] font-black text-white">{GEM_TABLE[g].name}</span>
                <span className="text-[10px] font-bold text-white/55">{GEM_TABLE[g].label}</span>
              </button>
            );
          })}
        </div>

        {message ? <p className="mt-3 rounded-xl bg-white/[0.06] px-3 py-2 text-center text-[12px] font-black text-[#FFE58A]">{message}</p> : null}

        <button type="button" onClick={onClose} className="btn-gold mt-4 w-full rounded-2xl px-4 py-3 text-sm font-black">
          完成
        </button>
      </div>
    </div>
  );
}
