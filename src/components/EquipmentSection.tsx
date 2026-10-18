// src/components/EquipmentSection.tsx
"use client";

/**
 * 「🎒 物品」頁的裝備分頁
 * ------------------------------------------------------------
 * 四個區塊，由上而下：
 *   1. 購買    — 第 1 階劍／盾各 100 飼料（其他種類只能靠探險掉）、背包擴充
 *   2. 寶石袋  — 六色寶石各有幾顆（寶石不佔背包格數）
 *   3. 背包    — 同種類同階折疊成一格，點開看每一件的品質跟寶石，
 *                可以「放進合成」或「鑲寶石」
 *   4. 合成    — 手動選 3 件同種類同階（有合成陣光效）＋ 一鍵合成
 *
 * 折疊顯示的重點：畫面上只出現「粗製匕首 ×27」一個圖示，但格數
 * 仍然是 27 格。所以卡片上同時寫著數量跟「佔 27 格」，不然學生會
 * 以為折疊等於只佔一格，背包爆掉的時候搞不清楚為什麼。
 *
 * 合成成功時播一段「合成儀式」（FuseCeremony）：三件素材往中間
 * 聚攏 → 爆光 → 新裝備背面朝上落下再翻面、光柱衝上去。
 */

import { playSfx } from "@/lib/sound/sfx";
import { useEffect, useMemo, useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import RulesButton from "@/components/RulesButton";
import {
  BAG_EXPAND_COST,
  BAG_EXPAND_SLOTS,
  EQUIPMENT_SHOP_PRICE,
  EQUIPMENT_TYPES,
  FUSE_REQUIRED_COUNT,
  MAX_EQUIPMENT_TIER,
  SHOP_TYPE_BY_KIND,
  autoFuse,
  getBagCapacity,
  getEquipmentBonusLabel,
  getEquipmentName,
  getItemGems,
  getItemQuality,
  getItemType,
  getQualityLabel,
  getSocketCount,
  getTierName,
  groupBag,
  type BagGroup,
  type EquipmentItem,
  type EquipmentKind,
  type EquipmentTier,
  type EquipmentType,
} from "@/lib/rpg/equipment";
import { GEM_IDS, GEM_TABLE, getGemCount, getGemTotal } from "@/lib/rpg/gems";
import EquipmentIcon, { ItemFrame, getTierMaterial } from "@/components/rpg/EquipmentIcon";
import GemIcon from "@/components/rpg/GemIcon";
import { GemSocketSheet, ItemInfoLines, ItemTile, QualityBadge } from "@/components/rpg/ItemDetail";

interface EquipmentSectionProps {
  /** 統一交給物品頁顯示訊息，跟道具／背景分頁共用同一條提示列 */
  onMessage: (message: string) => void;
}

/** 合成儀式要演的內容 */
interface FuseShow {
  key: number;
  /** 素材（只用來畫聚攏的那三件） */
  material: { kind: EquipmentKind; type: EquipmentType; tier: EquipmentTier };
  /** 合出來的東西（一鍵合成可能好幾件） */
  produced: EquipmentItem[];
}

/** 合成陣的幾何：圓心、半徑、三個槽的角度（正上方開始，每 120°） */
const FUSE_CX = 120;
const FUSE_CY = 96;
const FUSE_R = 66;
function fuseAngle(index: number): number {
  return ((-90 + index * 120) * Math.PI) / 180;
}

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[14px] font-black text-white">
        <span className="block h-2 w-2 rotate-45 bg-[#F5C542] shadow-[0_0_6px_#F5C542]" />
        {children}
      </h2>
      {right}
    </div>
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
  const [autoFusePreview, setAutoFusePreview] = useState<{ fuseCount: number; produced: EquipmentItem[]; gemsBack: number } | null>(null);
  /** 正在播的合成儀式 */
  const [fuseShow, setFuseShow] = useState<FuseShow | null>(null);
  /** 剛買到的那一格閃一下 */
  const [boughtKind, setBoughtKind] = useState<EquipmentKind | null>(null);
  /** 點開來看的那一組（用 key 記，背包變動後重新從 groups 找） */
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);
  /** 正在鑲寶石的那一件 */
  const [socketItemId, setSocketItemId] = useState<string | null>(null);

  const bag = useMemo(() => user?.equipmentBag ?? [], [user]);
  const expandCount = user?.bagExpandCount ?? 0;
  const capacity = getBagCapacity(expandCount);
  const groups = useMemo(() => groupBag(bag), [bag]);

  if (!user) return null;

  const isBagFull = bag.length >= capacity;
  const usedPct = Math.min(100, (bag.length / Math.max(1, capacity)) * 100);
  const gemTotal = getGemTotal(user.gemBag);
  const openGroup = openGroupKey ? groups.find((g) => groupKey(g) === openGroupKey) ?? null : null;

  /** 合成槽裡目前選了哪些（轉成實際物件） */
  const fusePicked = fuseSlots
    .map((id) => bag.find((item) => item.id === id))
    .filter((item): item is EquipmentItem => Boolean(item));

  /** 這一組（同種類同階）目前在合成槽裡被選了幾件 */
  function getSelectedCount(group: BagGroup): number {
    return fusePicked.filter((item) => getItemType(item) === group.type && item.tier === group.tier).length;
  }

  function handleBuy(kind: EquipmentKind) {
    const result = buyEquipment(kind);
    onMessage(result.message);
    if (result.success) {
      setBoughtKind(kind);
      window.setTimeout(() => setBoughtKind(null), 700);
    }
  }

  function handleExpand() {
    const result = expandBag();
    onMessage(result.message);
  }

  /** 把一件放進合成槽（從清單裡的「放進合成」按鈕） */
  function addToFuse(item: EquipmentItem): boolean {
    if (item.tier >= MAX_EQUIPMENT_TIER) {
      onMessage(`${getTierName(MAX_EQUIPMENT_TIER)}已經是最高階，不能再合成。`);
      return false;
    }
    if (fuseSlots.includes(item.id)) {
      setFuseSlots(fuseSlots.filter((id) => id !== item.id));
      return true;
    }
    if (fuseSlots.length >= FUSE_REQUIRED_COUNT) {
      onMessage(`合成槽只能放 ${FUSE_REQUIRED_COUNT} 件，先按「清空」再重選。`);
      return false;
    }
    // 已經選了東西的話，後面只能選同種類同階的，不然一定合不成
    if (fusePicked.length > 0) {
      const first = fusePicked[0];
      if (getItemType(first) !== getItemType(item) || first.tier !== item.tier) {
        onMessage(`合成要 3 件同種類、同階的裝備，例如 3 把${getEquipmentName(first)}。`);
        return false;
      }
    }
    setFuseSlots([...fuseSlots, item.id]);
    return true;
  }

  /** 一次把這一組放滿合成槽（品質差的先，留下好的） */
  function fillFuseFromGroup(group: BagGroup) {
    if (group.tier >= MAX_EQUIPMENT_TIER) {
      onMessage(`${getTierName(MAX_EQUIPMENT_TIER)}已經是最高階，不能再合成。`);
      return;
    }
    if (group.count < FUSE_REQUIRED_COUNT) {
      onMessage(`這一組只有 ${group.count} 件，要湊滿 ${FUSE_REQUIRED_COUNT} 件才能合成。`);
      return;
    }
    // 合出來會繼承最好的品質，所以拿「最好的 1 件 ＋ 最差的 2 件」
    const best = group.items[0];
    const worst = group.items.slice(-2);
    setFuseSlots([best.id, ...worst.map((i) => i.id)]);
    setOpenGroupKey(null);
    onMessage(`已經放進 3 件${getEquipmentName(best)}（最好的一件 ＋ 最差的兩件），合出來會繼承最好的品質。`);
  }

  function handleFuse() {
    const first = fusePicked[0];
    const before = new Set(bag.map((i) => i.id));
    const result = fuseEquipmentItems(fuseSlots);
    onMessage(result.message);
    if (result.success && first) {
      setFuseSlots([]);
      const latest = useGameStore.getState().user?.equipmentBag ?? [];
      const produced = latest.filter((i) => !before.has(i.id));
      setFuseShow({
        key: Date.now(),
        material: { kind: first.kind, type: getItemType(first), tier: first.tier },
        produced,
      });
    }
  }

  function handleOpenAutoFuse() {
    const preview = autoFuse(bag, Date.now());
    if (preview.fuseCount === 0) {
      onMessage("沒有任何同種類、同階湊滿 3 件的裝備可以合成。");
      return;
    }
    setAutoFusePreview({ fuseCount: preview.fuseCount, produced: preview.produced, gemsBack: preview.returnedGems.length });
  }

  function handleConfirmAutoFuse() {
    const before = new Set(bag.map((i) => i.id));
    const result = autoFuseBag();
    onMessage(result.message);
    setAutoFusePreview(null);
    setFuseSlots([]);
    if (result.success) {
      const latest = useGameStore.getState().user?.equipmentBag ?? [];
      const produced = latest.filter((i) => !before.has(i.id)).sort((a, b) => a.tier - b.tier);
      if (produced.length > 0) {
        const lowest = produced[0];
        setFuseShow({
          key: Date.now(),
          material: { kind: lowest.kind, type: getItemType(lowest), tier: Math.max(1, lowest.tier - 1) as EquipmentTier },
          produced,
        });
      }
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {/* ============================================================
          1. 購買
         ============================================================ */}
      <section className="rpg-panel rounded-[22px] px-4 py-4">
        <SectionTitle right={<RulesButton topic="equipment" variant="dark" />}>購買裝備</SectionTitle>
        <p className="mt-1 text-[11.5px] leading-relaxed text-white/55">
          商店只賣第 1 階的劍跟盾。匕首、斧頭這些其他種類要去探險打，每座塔主要掉自己的新種類。
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {(["weapon", "armor"] as const).map((kind) => {
            const disabled = user.foodCount < EQUIPMENT_SHOP_PRICE || isBagFull;
            const type = SHOP_TYPE_BY_KIND[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => handleBuy(kind)}
                disabled={disabled}
                className="relative flex flex-col items-center rounded-[18px] p-[2px] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 35%,#8A5A12 100%)" }}
              >
                <span className="flex w-full flex-col items-center rounded-[16px] px-2 pb-2.5 pt-3" style={{ background: "radial-gradient(circle at 50% 30%, #4A3A7A 0%, #17142E 75%)" }}>
                  <span className={boughtKind === kind ? "drop-card-enter" : ""}>
                    <ItemFrame tier={1} size={60}>
                      <EquipmentIcon kind={kind} type={type} tier={1} size={42} />
                    </ItemFrame>
                  </span>
                  <span className="mt-2 text-[13px] font-black text-white">粗製{EQUIPMENT_TYPES[type].name}</span>
                  <span className="text-[10.5px] font-bold text-white/55">{kind === "weapon" ? "攻擊 +20" : "防禦 +10・體力 +100"}</span>
                  <span className="mt-2 flex items-center gap-1 rounded-full px-3 py-1" style={{ background: "linear-gradient(180deg,#FFF6CC,#F5C542)" }}>
                    <WheatIcon />
                    <span className="font-display text-[13px] leading-none text-[#3A1D00]">{EQUIPMENT_SHOP_PRICE}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {isBagFull ? (
          <p className="mt-2.5 rounded-xl bg-[#FF4D5E]/12 px-3 py-2 text-[11.5px] font-black text-[#FF9AA6] ring-1 ring-[#FF4D5E]/35">
            背包滿了（{bag.length}/{capacity}），先合成幾件或擴充背包才能再買。
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleExpand}
          disabled={user.foodCount < BAG_EXPAND_COST}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.07] px-4 py-3 text-[12.5px] font-black text-white/90 ring-1 ring-white/15 transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          背包 +{BAG_EXPAND_SLOTS} 格
          <span className="flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5">
            <WheatIcon />
            <span className="font-display text-[12px] leading-none text-[#FFE58A]">{BAG_EXPAND_COST}</span>
          </span>
        </button>
      </section>

      {/* ============================================================
          2. 寶石袋
         ============================================================ */}
      <section className="rpg-panel rounded-[22px] px-4 py-4">
        <SectionTitle
          right={
            <span className="leading-none">
              <span className="font-display text-[16px] text-[#FFE58A]">{gemTotal}</span>
              <span className="ml-1 text-[11px] font-black text-white/50">顆</span>
            </span>
          }
        >
          寶石袋
        </SectionTitle>
        <p className="mt-1 text-[11.5px] leading-relaxed text-white/55">
          探險首通必掉 1 顆。裝備幾階就有幾個孔，在背包點開裝備就能鑲；隨時可以免費拆下來。
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {GEM_IDS.map((g) => {
            const n = getGemCount(user.gemBag, g);
            return (
              <div key={g} className="flex flex-col items-center rounded-2xl bg-white/[0.05] px-1 pb-2 pt-2.5 ring-1 ring-white/10" style={{ opacity: n > 0 ? 1 : 0.5 }}>
                <span className="relative">
                  <GemIcon gem={g} size={34} />
                  <span className="font-display absolute -bottom-1 -right-3 rounded-full bg-black/70 px-1.5 text-[11px] leading-[16px] text-white ring-1 ring-white/20">×{n}</span>
                </span>
                <span className="mt-1.5 text-[11.5px] font-black text-white">{GEM_TABLE[g].name}</span>
                <span className="text-[10px] font-bold text-white/55">{GEM_TABLE[g].label}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============================================================
          3. 背包
         ============================================================ */}
      <section className="rpg-panel rounded-[22px] px-4 py-4">
        <SectionTitle
          right={
            <span className="leading-none">
              <span className="font-display text-[16px]" style={{ color: isBagFull ? "#FF8A96" : "#FFE58A" }}>
                {bag.length}
              </span>
              <span className="font-display text-[12px] text-white/45"> / {capacity}</span>
            </span>
          }
        >
          背包
        </SectionTitle>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${usedPct}%`, background: isBagFull ? "linear-gradient(90deg,#FF4D5E,#FF8A96)" : "linear-gradient(90deg,#C98A0A,#FFE58A)" }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-white/50">同種類同階會疊成一格顯示，但格數是一件一格算的。點一下看每一件。</p>

        {groups.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white/[0.05] px-3 py-6 text-center text-[12px] font-bold text-white/55">背包是空的。先買一把劍，才能派小雞去探險。</p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3">
            {groups.map((group) => {
              const selected = getSelectedCount(group);
              const m = getTierMaterial(group.tier);
              const best = group.items[0];
              const anyGems = group.items.some((i) => getItemGems(i).length > 0);
              return (
                <button
                  key={groupKey(group)}
                  type="button"
                  onClick={() => setOpenGroupKey(groupKey(group))}
                  className="relative flex flex-col items-center transition-transform active:scale-95"
                  aria-label={`${getTierName(group.tier)}${EQUIPMENT_TYPES[group.type].name} ${group.count} 件`}
                >
                  <ItemFrame tier={group.tier} size={64} count={group.count} selected={selected > 0}>
                    <EquipmentIcon kind={group.kind} type={group.type} tier={group.tier} size={44} />
                  </ItemFrame>
                  {selected > 0 ? (
                    <span className="absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black text-[#3A1D00] shadow" style={{ background: "linear-gradient(180deg,#FFF6CC,#F5C542)" }}>
                      {selected}
                    </span>
                  ) : null}
                  {anyGems ? (
                    <span className="absolute -right-1 -top-1 z-10">
                      <GemIcon gem={getItemGems(group.items.find((i) => getItemGems(i).length > 0)!)[0]} size={16} />
                    </span>
                  ) : null}
                  <span className="mt-1 text-[10.5px] font-black" style={{ color: m.frameHi }}>
                    {getTierName(group.tier)}
                    {EQUIPMENT_TYPES[group.type].name}
                  </span>
                  <span className="text-[9.5px] font-bold text-white/40">
                    最好 {getQualityLabel(best)}・佔 {group.count} 格
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {groups.length > 0 ? <p className="mt-3 text-[10.5px] leading-relaxed text-white/45">要換裝到小雞身上請到「我的小雞」。</p> : null}
      </section>

      {/* ============================================================
          4. 合成
         ============================================================ */}
      <section className="rpg-panel relative overflow-hidden rounded-[22px] px-4 py-4">
        <SectionTitle>合成</SectionTitle>
        <p className="mt-1 text-[11.5px] text-white/55">
          {FUSE_REQUIRED_COUNT} 件同種類、同階 → 1 件高一階。必定成功、不花飼料；新的那件繼承 3 件裡最好的品質，素材上的寶石會退回寶石袋。
        </p>

        {/* 合成陣：三個槽剛好坐在圓環上，連線從中心往外指向各槽 */}
        <div className="relative mx-auto mt-3 h-[184px] w-[240px]">
          <svg viewBox="0 0 240 184" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <circle
              cx={FUSE_CX}
              cy={FUSE_CY}
              r={FUSE_R}
              fill="none"
              stroke="rgba(245,197,66,0.35)"
              strokeWidth={1.4}
              strokeDasharray="4 5"
              className={fusePicked.length > 0 ? "spin-slow" : ""}
              style={{ transformOrigin: `${FUSE_CX}px ${FUSE_CY}px` }}
            />
            {[0, 1, 2].map((i) => {
              const a = fuseAngle(i);
              const filled = i < fusePicked.length;
              return (
                <line
                  key={i}
                  x1={FUSE_CX + Math.cos(a) * 28}
                  y1={FUSE_CY + Math.sin(a) * 28}
                  x2={FUSE_CX + Math.cos(a) * (FUSE_R - 30)}
                  y2={FUSE_CY + Math.sin(a) * (FUSE_R - 30)}
                  stroke={filled ? "#FFE58A" : "rgba(255,255,255,0.15)"}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  style={{ filter: filled ? "drop-shadow(0 0 4px #F5C542)" : undefined }}
                />
              );
            })}
          </svg>
          {Array.from({ length: FUSE_REQUIRED_COUNT }).map((_, index) => {
            const item = fusePicked[index];
            const a = fuseAngle(index);
            const x = FUSE_CX + Math.cos(a) * FUSE_R - 26;
            const y = FUSE_CY + Math.sin(a) * FUSE_R - 26;
            return (
              <div key={index} className="absolute" style={{ left: x, top: y }}>
                {item ? (
                  <button type="button" onClick={() => setFuseSlots(fuseSlots.filter((id) => id !== item.id))} aria-label="從合成槽拿出來">
                    <ItemTile item={item} size={52} showSockets={false} />
                  </button>
                ) : (
                  <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[11px] border-2 border-dashed border-white/25 bg-[#14132A] text-[18px] font-black text-white/30">+</span>
                )}
              </div>
            );
          })}
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: FUSE_CX, top: FUSE_CY }}>
            {fusePicked.length === FUSE_REQUIRED_COUNT ? (
              <div className="drop-back-pulse">
                <ItemFrame tier={(fusePicked[0].tier + 1) as EquipmentTier} size={46}>
                  <EquipmentIcon kind={fusePicked[0].kind} type={getItemType(fusePicked[0])} tier={(fusePicked[0].tier + 1) as EquipmentTier} size={32} />
                </ItemFrame>
              </div>
            ) : (
              <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-black/30 text-[20px] font-black text-white/20 ring-1 ring-white/10">?</span>
            )}
          </div>
        </div>

        {fusePicked.length === FUSE_REQUIRED_COUNT ? (
          <p className="mt-1 text-center text-[12px] font-black text-[#FFE58A]">
            會合成出：{getTierName((fusePicked[0].tier + 1) as EquipmentTier)}
            {EQUIPMENT_TYPES[getItemType(fusePicked[0])].name}（品質 {getQualityLabel({ quality: Math.max(...fusePicked.map(getItemQuality)) })}）
          </p>
        ) : (
          <p className="mt-1 text-center text-[11.5px] font-bold text-white/50">
            {fusePicked.length === 0 ? "在背包點開一組裝備，按「放進合成」" : `再放 ${FUSE_REQUIRED_COUNT - fusePicked.length} 件同種類同階的`}
          </p>
        )}

        <div className="mt-3 grid grid-cols-[1fr_1.6fr] gap-2">
          <button
            type="button"
            onClick={() => setFuseSlots([])}
            disabled={fuseSlots.length === 0}
            className="rounded-2xl bg-white/10 px-3 py-3 text-[13px] font-black text-white/80 ring-1 ring-white/15 transition-transform active:scale-95 disabled:opacity-35"
          >
            清空
          </button>
          <button type="button" onClick={handleFuse} disabled={fusePicked.length !== FUSE_REQUIRED_COUNT} className="btn-gold rounded-2xl px-3 py-3 text-[15px] font-black">
            合成
          </button>
        </div>

        <button
          type="button"
          onClick={handleOpenAutoFuse}
          disabled={bag.length < FUSE_REQUIRED_COUNT}
          className="mt-2 w-full rounded-2xl px-4 py-3 text-[12.5px] font-black text-white transition-transform active:scale-[0.98] disabled:opacity-35"
          style={{ background: "linear-gradient(180deg,#6A4FC0 0%,#3E2A8A 100%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 3px 0 #22145A" }}
        >
          一鍵合成（能合的全部合到底）
        </button>
      </section>

      {/* ============================================================
          某一組的單件清單
         ============================================================ */}
      {openGroup ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 sm:items-center" onClick={() => setOpenGroupKey(null)}>
          <div
            className="rules-sheet max-h-[82vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] px-4 pb-6 pt-4 sm:rounded-[28px]"
            style={{ background: "linear-gradient(180deg,#221F48 0%,#0E0D1E 100%)", boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${getTierName(openGroup.tier)}${EQUIPMENT_TYPES[openGroup.type].name}`}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between px-1">
              <p className="text-[15px] font-black text-white">
                {getTierName(openGroup.tier)}
                {EQUIPMENT_TYPES[openGroup.type].name}
                <span className="ml-1.5 text-[12px] text-white/50">× {openGroup.count}</span>
              </p>
              {openGroup.count >= FUSE_REQUIRED_COUNT && openGroup.tier < MAX_EQUIPMENT_TIER ? (
                <button type="button" onClick={() => fillFuseFromGroup(openGroup)} className="btn-gold rounded-xl px-3 py-1.5 text-[11.5px] font-black">
                  放 3 件進合成
                </button>
              ) : null}
            </div>
            <p className="mt-1 px-1 text-[11px] font-bold text-white/45">{EQUIPMENT_TYPES[openGroup.type].summary}</p>

            <div className="mt-3 flex flex-col gap-2">
              {openGroup.items.map((item) => {
                const inFuse = fuseSlots.includes(item.id);
                return (
                  <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-2.5 py-2.5 ring-1" style={{ ["--tw-ring-color" as string]: inFuse ? "#F5C542" : "rgba(255,255,255,0.1)" }}>
                    <ItemTile item={item} size={58} selected={inFuse} />
                    <div className="min-w-0 flex-1">
                      <ItemInfoLines item={item} compact />
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => addToFuse(item)}
                        disabled={item.tier >= MAX_EQUIPMENT_TIER}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-black transition-transform active:scale-95 disabled:opacity-30"
                        style={inFuse ? { background: "#F5C542", color: "#3A1D00" } : { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.85)" }}
                      >
                        {inFuse ? "取消合成" : "放進合成"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSocketItemId(item.id)}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-black text-white transition-transform active:scale-95"
                        style={{ background: "linear-gradient(180deg,#6A4FC0,#3E2A8A)" }}
                      >
                        鑲寶石 {getItemGems(item).length}/{getSocketCount(item.tier)}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button type="button" onClick={() => setOpenGroupKey(null)} className="mt-4 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white/80 ring-1 ring-white/20">
              關閉
            </button>
          </div>
        </div>
      ) : null}

      {socketItemId ? <GemSocketSheet target={{ where: "bag", itemId: socketItemId }} onClose={() => setSocketItemId(null)} /> : null}

      {/* ============================================================
          一鍵合成的確認頁
         ============================================================ */}
      {autoFusePreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4">
          <div className="result-card w-full max-w-sm rounded-[26px] p-[3px]" style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 62%,#F5C542 100%)" }}>
            <div className="max-h-[80vh] overflow-y-auto rounded-[23px] bg-gradient-to-b from-[#221F48] to-[#0E0D1E] p-5" role="dialog" aria-modal="true" aria-label="一鍵合成">
              <h3 className="text-center">
                <span className="fx-text text-[21px] font-black" data-text="一鍵合成" style={fxStyle("linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)", 5, "#1A1206")}>
                  一鍵合成
                </span>
              </h3>
              <p className="mt-1 text-center text-[12px] text-white/60">會合成 {autoFusePreview.fuseCount} 次，最後會得到：</p>

              <div className="mt-3 flex flex-wrap justify-center gap-3">
                {autoFusePreview.produced.map((item) => (
                  <div key={item.id} className="flex w-[76px] flex-col items-center">
                    <ItemTile item={item} size={60} showSockets={false} />
                    <span className="mt-1 text-center text-[10.5px] font-black" style={{ color: getTierMaterial(item.tier).frameHi }}>
                      {getEquipmentName(item)}
                    </span>
                    <QualityBadge item={item} className="mt-0.5" />
                    <span className="mt-0.5 text-center text-[9px] font-bold leading-tight text-white/50">{getEquipmentBonusLabel(item)}</span>
                  </div>
                ))}
              </div>

              <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-2 text-[11px] leading-relaxed text-white/60">
                合成是從低階往高階跑的，所以 9 把粗製匕首會變成 1 把稀有匕首，而不是停在 3 把精良匕首。每次合成都會留下品質最好的那件。
                {autoFusePreview.gemsBack > 0 ? `素材上的 ${autoFusePreview.gemsBack} 顆寶石會退回寶石袋。` : ""}
              </p>

              <div className="mt-4 grid grid-cols-[1fr_1.4fr] gap-2">
                <button type="button" onClick={() => setAutoFusePreview(null)} className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-black text-white/80 ring-1 ring-white/20">
                  取消
                </button>
                <button type="button" onClick={handleConfirmAutoFuse} className="btn-gold rounded-2xl px-3 py-3 text-sm font-black">
                  確定合成
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {fuseShow ? <FuseCeremony key={fuseShow.key} show={fuseShow} onClose={() => setFuseShow(null)} /> : null}
    </div>
  );
}

function groupKey(group: Pick<BagGroup, "type" | "tier">): string {
  return `${group.type}-${group.tier}`;
}

// ============================================================
// 合成儀式
// ============================================================

/**
 * 三件素材往中間聚攏（0 ~ 0.7s）→ 白光爆開（0.7s）→ 新裝備背面朝上
 * 出現，停半拍再翻面＋光柱（1.0 ~ 1.5s）→ 「合成成功」字樣＋按鈕。
 * 一鍵合成合出好幾件時，翻面一張接一張。
 */
function FuseCeremony({ show, onClose }: { show: FuseShow; onClose: () => void }) {
  const [phase, setPhase] = useState<"gather" | "reveal">("gather");
  const [flipped, setFlipped] = useState(0);

  useEffect(() => {
    const timers: number[] = [];
    playSfx("fuseCharge");
    timers.push(
      window.setTimeout(() => {
        setPhase("reveal");
        playSfx("fuseDone");
      }, 800),
    );
    show.produced.forEach((_, i) => {
      timers.push(
        window.setTimeout(() => {
          setFlipped(i + 1);
          playSfx("cardFlip");
        }, 1250 + i * 380),
      );
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [show]);

  const best = Math.max(...show.produced.map((p) => p.tier));
  const bestM = getTierMaterial(best);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden px-4" style={{ background: "rgba(4,4,14,0.86)" }} role="dialog" aria-modal="true" aria-label="合成結果">
      {/* 背後光芒，顏色跟著合出來最高的那一階 */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2">
        {/* 動畫會改 transform，置中的 translate 必須放在外層 */}
        <div className="result-rays absolute inset-0" style={{ background: `repeating-conic-gradient(from 0deg, ${bestM.frameHi}38 0deg 7deg, transparent 7deg 20deg)` }} />
      </div>

      {phase === "gather" ? (
        <div className="relative h-[220px] w-[220px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="fuse-gather absolute left-1/2 top-1/2" style={{ ["--a" as string]: `${-90 + i * 120}deg` } as React.CSSProperties}>
              <ItemFrame tier={show.material.tier} size={58}>
                <EquipmentIcon kind={show.material.kind} type={show.material.type} tier={show.material.tier} size={40} />
              </ItemFrame>
            </div>
          ))}
          <div className="fuse-burst absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full" />
        </div>
      ) : (
        <div className="relative flex flex-col items-center">
          <span className="result-title fx-text text-[34px] font-black" data-text="合成成功！" style={fxStyle(`linear-gradient(180deg,#FFFFFF 10%,${bestM.frameHi} 55%,${bestM.frame} 100%)`, 7, "#1A1206")}>
            合成成功！
          </span>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            {show.produced.map((item, i) => {
              const m = getTierMaterial(item.tier);
              const isFlipped = i < flipped;
              return (
                <div key={item.id} className="drop-card-enter relative flex flex-col items-center" style={{ animationDelay: `${i * 0.08}s` }}>
                  {isFlipped ? (
                    <div
                      className="drop-pillar pointer-events-none absolute bottom-[38px] h-[200px] w-[60px] origin-bottom"
                      style={{ left: "calc(50% - 30px)", background: `linear-gradient(0deg, ${m.frameHi}EE 0%, ${m.frame}66 45%, transparent 100%)`, filter: "blur(3px)" }}
                    />
                  ) : null}
                  <div className="drop-card" style={{ width: 92, height: 92 }}>
                    <div className={["drop-card-inner h-full w-full", isFlipped ? "flipped" : ""].join(" ")}>
                      <div className="drop-face flex items-center justify-center rounded-[18px]" style={{ background: "linear-gradient(145deg,#3A2A6E 0%,#1A1438 100%)", border: "3px solid #F5C542", boxShadow: "inset 0 0 14px rgba(245,197,66,0.35)" }}>
                        <span className="drop-back-pulse font-display text-[40px] text-[#F5C542]" style={{ textShadow: "0 0 12px rgba(245,197,66,0.8)" }}>
                          ?
                        </span>
                      </div>
                      <div className="drop-face front">
                        <ItemTile item={item} size={92} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-[13px] font-black transition-opacity duration-300" style={{ color: m.frameHi, opacity: isFlipped ? 1 : 0 }}>
                    {getEquipmentName(item)}
                  </p>
                  <span className="transition-opacity duration-300" style={{ opacity: isFlipped ? 1 : 0 }}>
                    <QualityBadge item={item} />
                  </span>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={onClose} className="btn-gold result-fade-up mt-7 rounded-2xl px-10 py-3 text-[15px] font-black" style={{ animationDelay: `${1.3 + show.produced.length * 0.38}s` }}>
            太好了
          </button>
        </div>
      )}
    </div>
  );
}

function WheatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#A8740F" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 22V8" />
      <path d="M12 8c-2-1-3-3-3-5 2 0 3 1 3 3 0-2 1-3 3-3 0 2-1 4-3 5z" fill="#F5C542" />
      <path d="M12 13c-2-1-4-1-5-3 2-1 4 0 5 2 1-2 3-3 5-2-1 2-3 2-5 3z" fill="#F5C542" />
      <path d="M12 18c-2-1-4-1-5-3 2-1 4 0 5 2 1-2 3-3 5-2-1 2-3 2-5 3z" fill="#F5C542" />
    </svg>
  );
}

function fxStyle(fill: string, stroke: number, strokeColor: string): React.CSSProperties {
  return {
    ["--fx-fill" as string]: fill,
    ["--fx-stroke" as string]: `${stroke}px`,
    ["--fx-stroke-color" as string]: strokeColor,
  } as React.CSSProperties;
}
