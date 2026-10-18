// src/app/my-pets/page.tsx
"use client";

/**
 * 🐣 我的小雞（收藏）
 * ------------------------------------------------------------
 * 收藏的小雞以「角色卡」的樣子排成三欄：職業色外框、職業圖、
 * 名字、總戰力、兩件裝備的小圖。點開是角色檔案：
 *   大圖站在職業色魔法陣上 → 四項數值（裝備加成另外標綠字）
 *   → 兩個裝備格（點了從背包挑） → 養成紀錄 → 戰績
 *
 * 正在養的那一隻（長到大師雞才會出現）放在最上面自成一區，因為牠
 * 的數值還會變（轉職、生病），跟已經定型的收藏不同。
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import { getCatalogEntryById } from "@/lib/pet/catalog";
import {
  KIND_LABELS,
  getEquipmentBonusLabel,
  getCombatTraits,
  getItemGems,
  getItemQuality,
  getItemType,
  getSocketCount,
  getEquipmentName,
  getDeployBlockReason,
  type EquipmentItem,
} from "@/lib/rpg/equipment";
import {
  PET_STAT_KEYS,
  PET_STAT_LABELS,
  getFinalStats,
  getSevereSickPenaltyLabel,
  getTotalPower,
} from "@/lib/rpg/stats";
import { STAT_COLORS, getJobColor } from "@/lib/rpg/jobVisual";
import { createEmptyPetRecord, type CollectedPetDoc } from "@/types/rpg";
import { useAppBackground } from "@/lib/useAppBackground";
import { getDaysRaised } from "@/lib/collectedPets";
import { LIVING_PET_ID } from "@/lib/rpg/deploy";
import PetArt from "@/components/rpg/PetArt";
import RpgHeader from "@/components/rpg/RpgHeader";
import EquipmentIcon, { ItemFrame } from "@/components/rpg/EquipmentIcon";
import { GemSocketSheet, ItemInfoLines, ItemTile } from "@/components/rpg/ItemDetail";

/** 特效字的 CSS 變數 */
function fxStyle(fill: string, stroke: number, strokeColor: string): React.CSSProperties {
  return {
    ["--fx-fill" as string]: fill,
    ["--fx-stroke" as string]: `${stroke}px`,
    ["--fx-stroke-color" as string]: strokeColor,
  } as React.CSSProperties;
}

function jobNameOf(jobId: string | null): string {
  return jobId ? (getCatalogEntryById(jobId)?.name ?? "未知職業") : "未轉職";
}

// ============================================================
// 裝備選擇器
// ============================================================

/**
 * 從背包挑一件裝備換上的選擇器。只列出符合這一格類型的裝備，
 * 依階級由高到低排（想換裝的人通常是要換更好的）。
 */
function EquipmentPicker({
  slot,
  current,
  bag,
  onPick,
  onClose,
  isSaving,
}: {
  slot: "weapon" | "armor";
  current: EquipmentItem | null;
  bag: EquipmentItem[];
  onPick: (item: EquipmentItem | null) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const candidates = useMemo(
    () => bag.filter((item) => item.kind === slot).sort((a, b) => b.tier - a.tier || getItemQuality(b) - getItemQuality(a)),
    [bag, slot],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 sm:items-center" onClick={onClose}>
      <div
        className="rules-sheet max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] px-5 pb-6 pt-4 sm:rounded-[28px]"
        style={{ background: "linear-gradient(180deg,#221F48 0%,#0E0D1E 100%)", boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`選擇${KIND_LABELS[slot]}`}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
        <h3 className="text-center">
          <span className="fx-text text-[20px] font-black" data-text={`選擇${KIND_LABELS[slot]}`} style={fxStyle("linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)", 5, "#1A1206")}>
            選擇{KIND_LABELS[slot]}
          </span>
        </h3>

        {current ? (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onPick(null)}
            className="mt-3 w-full rounded-2xl bg-[#FF4D5E]/12 px-3 py-2.5 text-[12px] font-black text-[#FF9AA6] ring-1 ring-[#FF4D5E]/40 transition-transform active:scale-95 disabled:opacity-50"
          >
            卸下目前的{getEquipmentName(current)}（放回背包）
          </button>
        ) : null}

        {candidates.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white/[0.05] px-3 py-6 text-center text-[12px] font-bold leading-relaxed text-white/55">
            背包裡沒有{KIND_LABELS[slot]}。
            <br />
            到「物品」頁的裝備分頁買一件吧。
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {candidates.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isSaving}
                onClick={() => onPick(item)}
                className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-2.5 py-2 text-left ring-1 ring-white/10 transition-transform active:scale-[0.98] disabled:opacity-50"
                aria-label={`${getEquipmentName(item)}，${getEquipmentBonusLabel(item)}`}
              >
                <ItemTile item={item} size={56} />
                <ItemInfoLines item={item} compact />
              </button>
            ))}
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-5 w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-black text-white/80 ring-1 ring-white/20 transition-transform active:scale-95">
          取消
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 角色檔案
// ============================================================

function PetDetail({
  pet,
  isLiving,
  onClose,
}: {
  pet: CollectedPetDoc;
  /** true = 這是「目前正在養的那一隻」，換裝備要寫到 pets/{uid} */
  isLiving: boolean;
  onClose: () => void;
}) {
  const bag = useGameStore((s) => s.user?.equipmentBag ?? []);
  const equipToPet = useGameStore((s) => s.equipToPet);
  const equipToLivingPet = useGameStore((s) => s.equipToLivingPet);
  const [pickerSlot, setPickerSlot] = useState<"weapon" | "armor" | null>(null);
  const [socketSlot, setSocketSlot] = useState<"weapon" | "armor" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [equipMessage, setEquipMessage] = useState<string | null>(null);

  async function handlePick(item: EquipmentItem | null) {
    if (!pickerSlot) return;
    setIsSaving(true);
    const result = isLiving ? await equipToLivingPet(pickerSlot, item) : await equipToPet(pet.id, pickerSlot, item);
    setIsSaving(false);
    setEquipMessage(result.message);
    if (result.success) setPickerSlot(null);
  }

  const stats = useMemo(() => getFinalStats(pet.jobId, pet.severeSickCount, pet.weapon, pet.armor), [pet]);
  const bare = useMemo(() => getFinalStats(pet.jobId, pet.severeSickCount, null, null), [pet]);
  const traits = useMemo(() => getCombatTraits(pet.weapon, pet.armor), [pet]);
  const totalPower = getTotalPower(stats, traits);
  const sickLabel = getSevereSickPenaltyLabel(pet.severeSickCount);
  const jobColor = getJobColor(pet.jobId);

  // HP 的數量級比其他三項大很多，共用同一個基準會讓另外三項幾乎
  // 看不見，所以 HP 自己滿格、其他三項共用一個基準。
  const otherMax = Math.max(1, stats.attack, stats.defense, stats.speed);

  const record = pet.record;
  const teamTotal = record.teamWins + record.teamLosses;
  const deployBlockReason = getDeployBlockReason(pet.weapon);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 sm:items-center" onClick={onClose}>
      <div
        className="rules-sheet max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] sm:rounded-[28px]"
        style={{ background: "linear-gradient(180deg,#1E1B40 0%,#0B0A18 100%)", boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${pet.name} 的檔案`}
      >
        {/* ---- 主視覺：站在職業色魔法陣上 ---- */}
        <div className="relative h-[210px] overflow-hidden" style={{ background: `radial-gradient(ellipse at 50% 70%, ${jobColor}66 0%, ${jobColor}1A 45%, transparent 75%)` }}>
          {/* 放射光：用圓形遮罩淡出，不然方形的邊會露出來 */}
          <div className="absolute left-1/2 top-[58%] h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 opacity-50" style={{ WebkitMaskImage: "radial-gradient(circle, #000 15%, transparent 62%)", maskImage: "radial-gradient(circle, #000 15%, transparent 62%)" }}>
            <div className="item-rays absolute inset-0" />
          </div>
          {/* 腳下的魔法陣：外層負責置中＋壓扁，裡面的 svg 才能自由旋轉 */}
          <div className="absolute bottom-[14px] left-1/2 h-[190px] w-[190px]" style={{ transform: "translateX(-50%) translateY(50%) scaleY(0.3)" }}>
            <svg viewBox="0 0 100 100" className="spin-slow h-full w-full" aria-hidden="true">
              <circle cx={50} cy={50} r={47} fill="none" stroke="#F5C542" strokeWidth={2} />
              <circle cx={50} cy={50} r={39} fill="none" stroke={jobColor} strokeWidth={1.4} strokeDasharray="5 4" />
              <circle cx={50} cy={50} r={44} fill={jobColor} opacity={0.18} />
              {[0, 60, 120, 180, 240, 300].map((deg) => (
                <path key={deg} d="M50,4 L53,9 L50,14 L47,9 Z" fill="#F5C542" transform={`rotate(${deg} 50 50)`} />
              ))}
            </svg>
          </div>
          {/* 置中用外層 div；待機動畫放裡層（動畫的 transform 會蓋掉外層的 translate） */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
            <div className="unit-idle">
              <PetArt jobId={pet.jobId} size={150} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white/80 ring-1 ring-white/20"
            aria-label="關閉"
          >
            ✕
          </button>
          <span className="absolute left-3 top-3 rounded-lg px-2 py-1 text-[11px] font-black text-white ring-1 ring-white/20" style={{ background: `${jobColor}CC` }}>
            {jobNameOf(pet.jobId)}
          </span>
        </div>

        <div className="px-5 pb-6">
          {/* 名字＋戰力 */}
          <div className="-mt-1 text-center">
            <p>
              <span className="fx-text text-[26px] font-black" data-text={pet.name} style={fxStyle("linear-gradient(180deg,#FFFFFF 10%,#FFE58A 100%)", 6, "#1A1206")}>
                {pet.name}
              </span>
            </p>
            <p className="mt-1 flex items-center justify-center gap-1.5">
              <span className="text-[11px] font-black text-white/50">總戰力</span>
              <span className="font-display text-[24px] leading-none text-[#FFE58A]" style={{ textShadow: "0 0 12px rgba(245,197,66,0.55)" }}>
                {totalPower}
              </span>
            </p>
            {isLiving ? <p className="mt-1 text-[10.5px] font-bold text-[#C9A0FF]">還在養，轉職跟生病都會讓數值變動；收藏之後才定型</p> : null}
          </div>

          {/* ---- 四項數值 ---- */}
          <div className="mt-4 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
            <div className="space-y-2.5">
              {PET_STAT_KEYS.map((key) => {
                const value = stats[key];
                const bonus = value - bare[key];
                const max = key === "hp" ? stats.hp : otherMax;
                const color = STAT_COLORS[key];
                return (
                  <div key={key}>
                    <div className="flex items-baseline justify-between">
                      <span className="flex items-center gap-1.5 text-[12px] font-black text-white/80">
                        <span className="block h-2 w-2 rotate-45" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                        {PET_STAT_LABELS[key]}
                      </span>
                      <span className="leading-none">
                        <span className="font-display text-[15px] text-white">{value}</span>
                        {bonus > 0 ? <span className="ml-1 text-[11px] font-black text-[#7FE8A8]">裝備 +{bonus}</span> : null}
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-black/40">
                      {/* 裸數值的部分實色，裝備加成的部分亮綠 */}
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.round((value / max) * 100)}%`, background: "#7FE8A8" }} />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{ width: `${Math.round(((value - Math.max(0, bonus)) / max) * 100)}%`, background: `linear-gradient(90deg, ${color}AA, ${color})` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ---- 裝備格：每一格可以換裝備，也可以鑲寶石 ---- */}
          <div className="mt-3 flex flex-col gap-2">
            {(["weapon", "armor"] as const).map((slot) => {
              const item = slot === "weapon" ? pet.weapon : pet.armor;
              return (
                <div key={slot} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-2.5 ring-1 ring-white/10">
                  <button
                    type="button"
                    onClick={() => setPickerSlot(slot)}
                    className="shrink-0 transition-transform active:scale-95"
                    aria-label={item ? `更換${KIND_LABELS[slot]}，目前是${getEquipmentName(item)}` : `裝上${KIND_LABELS[slot]}`}
                  >
                    {item ? (
                      <ItemTile item={item} size={60} />
                    ) : (
                      <span className="flex h-[60px] w-[60px] items-center justify-center rounded-[12px] border-2 border-dashed border-white/25 text-[22px] font-black text-white/40">+</span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold text-white/45">{KIND_LABELS[slot]}</p>
                    {item ? <ItemInfoLines item={item} compact /> : <p className="text-[12px] font-black text-white/45">點左邊的格子裝上</p>}
                  </div>
                  {item ? (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button type="button" onClick={() => setPickerSlot(slot)} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-black text-white/85 transition-transform active:scale-95">
                        更換
                      </button>
                      <button
                        type="button"
                        onClick={() => setSocketSlot(slot)}
                        className="rounded-lg px-2.5 py-1.5 text-[11px] font-black text-white transition-transform active:scale-95"
                        style={{ background: "linear-gradient(180deg,#6A4FC0,#3E2A8A)" }}
                      >
                        寶石 {getItemGems(item).length}/{getSocketCount(item.tier)}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {/* 特殊效果合計（爆擊率含紫晶、護盾含月光石） */}
          <TraitSummary pet={pet} />
          {equipMessage ? <p className="mt-2 rounded-xl bg-white/[0.06] px-3 py-1.5 text-center text-[11.5px] font-black text-[#FFE58A]">{equipMessage}</p> : null}
          {deployBlockReason ? (
            <p className="mt-2 rounded-xl bg-[#FF4D5E]/12 px-3 py-2 text-center text-[11.5px] font-black text-[#FF9AA6] ring-1 ring-[#FF4D5E]/35">
              {deployBlockReason}，沒有武器不能派去探險或戰隊
            </p>
          ) : (
            <p className="mt-2 rounded-xl bg-[#3DDB84]/12 px-3 py-2 text-center text-[11.5px] font-black text-[#7FE8A8] ring-1 ring-[#3DDB84]/35">可以出戰</p>
          )}

          {/* ---- 養成紀錄＋戰績 ---- */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <RecordChip label="養了" value={`${pet.daysRaised}`} unit="天" />
            <RecordChip label="生大病" value={`${pet.severeSickCount}`} unit="次" tone={pet.severeSickCount > 0 ? "bad" : "good"} />
            {!isLiving ? (
              <>
                <RecordChip label="探險通關" value={`${record.exploreStagesCleared}`} unit={`/ ${record.exploreStagesPlayed} 關`} />
                <RecordChip label="戰隊" value={teamTotal === 0 ? "—" : `${record.teamWins}`} unit={teamTotal === 0 ? "還沒上場" : `勝 ${record.teamLosses} 敗`} />
              </>
            ) : null}
          </div>
          <p className="mt-2 text-center text-[11px] font-bold leading-relaxed" style={{ color: sickLabel ? "#FF9AA6" : "#7FE8A8" }}>
            {sickLabel ? `因為生過 ${pet.severeSickCount} 次大病，四項數值 ${sickLabel}` : "從來沒生過大病，數值沒有任何折損"}
          </p>
        </div>
      </div>

      {socketSlot ? (
        <GemSocketSheet
          target={isLiving ? { where: "living", slot: socketSlot } : { where: "pet", petId: pet.id, slot: socketSlot }}
          onClose={() => setSocketSlot(null)}
        />
      ) : null}

      {pickerSlot ? (
        <EquipmentPicker
          slot={pickerSlot}
          current={pickerSlot === "weapon" ? pet.weapon : pet.armor}
          bag={bag}
          isSaving={isSaving}
          onPick={handlePick}
          onClose={() => setPickerSlot(null)}
        />
      ) : null}
    </div>
  );
}

/** 特殊效果合計：把武器、防具、寶石的特效加起來列成一排小標籤 */
function TraitSummary({ pet }: { pet: CollectedPetDoc }) {
  const t = getCombatTraits(pet.weapon, pet.armor);
  const chips: string[] = [];
  const p = (v: number) => `${(v * 100).toFixed(v * 100 < 10 && Math.round(v * 100) !== v * 100 ? 1 : 0)}%`;
  if (t.critChance > 0) chips.push(`爆擊 ${p(t.critChance)}（${t.critMult} 倍）`);
  if (t.armorPen > 0) chips.push(`破甲 ${p(t.armorPen)}`);
  if (t.lifesteal > 0) chips.push(`吸血 ${p(t.lifesteal)}`);
  if (t.firstStrikeMult > 0) chips.push(`先攻 ×${t.firstStrikeMult.toFixed(2)}`);
  if (t.dodge > 0) chips.push(`閃避 ${p(t.dodge)}`);
  if (t.thorns > 0) chips.push(`反傷 ${p(t.thorns)}`);
  if (t.regen > 0) chips.push(`再生 ${p(t.regen)}／次`);
  if (t.shield > 0) chips.push(`開場護盾 ${p(t.shield)}`);
  if (chips.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1.5">
      {chips.map((c) => (
        <span key={c} className="rounded-full bg-[#F5C542]/12 px-2.5 py-1 text-[10.5px] font-black text-[#FFE58A] ring-1 ring-[#F5C542]/35">
          {c}
        </span>
      ))}
    </div>
  );
}

function RecordChip({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: "good" | "bad" }) {
  const color = tone === "bad" ? "#FF9AA6" : tone === "good" ? "#7FE8A8" : "#FFFFFF";
  return (
    <div className="rounded-xl bg-white/[0.05] px-3 py-2 ring-1 ring-white/10">
      <p className="text-[10px] font-bold text-white/45">{label}</p>
      <p className="leading-none">
        <span className="font-display text-[18px]" style={{ color }}>
          {value}
        </span>
        <span className="ml-1 text-[11px] font-bold text-white/55">{unit}</span>
      </p>
    </div>
  );
}

// ============================================================
// 角色卡
// ============================================================

function PetCard({ pet, onClick, wide = false }: { pet: CollectedPetDoc; onClick: () => void; wide?: boolean }) {
  const stats = getFinalStats(pet.jobId, pet.severeSickCount, pet.weapon, pet.armor);
  const power = getTotalPower(stats, getCombatTraits(pet.weapon, pet.armor));
  const jobColor = getJobColor(pet.jobId);
  const noWeapon = !pet.weapon;

  if (wide) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="relative flex w-full items-center gap-3 rounded-[20px] p-[2px] text-left transition-transform active:scale-[0.98]"
        style={{ background: `linear-gradient(120deg, #E6D2FF 0%, ${jobColor} 40%, #2A2850 100%)` }}
      >
        <span className="flex w-full items-center gap-3 rounded-[18px] px-3 py-2.5" style={{ background: `radial-gradient(circle at 15% 50%, ${jobColor}55 0%, #14132A 60%)` }}>
          <span className="unit-idle">
            <PetArt jobId={pet.jobId} size={64} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black text-[#C9A0FF]">養成中・數值還會變動</span>
            <span className="block truncate text-[15px] font-black text-white">{pet.name}</span>
            <span className="block text-[11px] font-bold text-white/55">{noWeapon ? "還沒有武器，不能出戰" : "可以出戰"}</span>
          </span>
          <span className="text-right">
            <span className="block text-[10px] font-bold text-white/45">戰力</span>
            <span className="font-display text-[22px] leading-none text-[#FFE58A]">{power}</span>
          </span>
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-[18px] p-[2px] text-center transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      style={{ background: `linear-gradient(160deg, #FFFFFF 0%, ${jobColor} 35%, #1E1C3C 100%)`, boxShadow: `0 6px 14px rgba(0,0,0,0.25), 0 0 10px ${jobColor}44` }}
      aria-label={`${pet.name}，戰力 ${power}`}
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-[16px]" style={{ background: `radial-gradient(circle at 50% 40%, ${jobColor}66 0%, #14132A 70%)` }}>
        {/* 職業名小標 */}
        <span className="absolute left-1.5 top-1.5 rounded-md px-1 py-0.5 text-[9px] font-black text-white" style={{ background: `${jobColor}DD` }}>
          {jobNameOf(pet.jobId)}
        </span>
        {/* 兩件裝備小圖 */}
        <span className="absolute right-1 top-1 flex flex-col gap-0.5">
          {(["weapon", "armor"] as const).map((kind) => {
            const item = pet[kind];
            return item ? (
              <ItemFrame key={kind} tier={item.tier} size={20}>
                <EquipmentIcon kind={kind} type={getItemType(item)} tier={item.tier} size={14} />
              </ItemFrame>
            ) : (
              <span key={kind} className="block h-5 w-5 rounded-[4px] border border-dashed border-white/25" />
            );
          })}
        </span>
        <div className="absolute inset-x-0 top-[16%] flex justify-center">
          <PetArt jobId={pet.jobId} size={70} />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-1 pb-1.5 pt-4" style={{ background: "linear-gradient(0deg, rgba(5,5,16,0.92), rgba(5,5,16,0))" }}>
          <p className="truncate text-[11.5px] font-black text-white">{pet.name}</p>
          <p className="font-display text-[15px] leading-none text-[#FFE58A]">{power}</p>
        </div>
        {noWeapon ? <span className="absolute inset-x-0 top-[58%] bg-[#B0102A]/90 py-0.5 text-[9px] font-black text-white">沒有武器</span> : null}
      </div>
    </button>
  );
}

// ============================================================
// 頁面
// ============================================================

function MyPetsContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const livingPet = useGameStore((s) => s.pet);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const collectedPetsLoaded = useGameStore((s) => s.collectedPetsLoaded);
  const loadCollectedPets = useGameStore((s) => s.loadCollectedPets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bgStyle = useAppBackground();

  useEffect(() => {
    void loadCollectedPets();
  }, [loadCollectedPets]);

  /**
   * 把「正在養的那一隻」包成跟收藏小雞一樣的形狀，這樣詳細頁、
   * 數值計算、裝備格全部可以共用同一套元件，不用寫兩份。
   *
   * 只有長到大師雞才會出現在這一頁——蛋跟雛雞本來就不能出戰，
   * 列在這裡只會讓學生以為可以派牠去打。
   */
  const livingAsCollected: CollectedPetDoc | null = useMemo(() => {
    if (!livingPet || !user) return null;
    if (livingPet.stage !== "master" || livingPet.healthStatus === "dead") return null;
    return {
      id: LIVING_PET_ID,
      uid: user.uid,
      name: "養成中的小雞",
      jobId: livingPet.currentAppearanceId,
      severeSickCount: livingPet.severeSickCount ?? 0,
      daysRaised: getDaysRaised(livingPet.lifeStartedAt ?? livingPet.createdAt, Date.now()),
      weapon: livingPet.weapon ?? null,
      armor: livingPet.armor ?? null,
      record: createEmptyPetRecord(),
      collectedAt: livingPet.createdAt,
      updatedAt: livingPet.updatedAt,
    };
  }, [livingPet, user]);

  const selected =
    selectedId === LIVING_PET_ID ? livingAsCollected : (collectedPets.find((p) => p.id === selectedId) ?? null);

  if (!user) return null;

  return (
    // 最外層一定要吃 bgStyle，學生買的背景才會套進來
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <RpgHeader
          title="我的小雞"
          onBack={() => router.push("/")}
          right={
            <span className="flex h-9 items-center rounded-xl bg-white/10 px-2.5 ring-1 ring-white/15">
              <span className="font-display text-[14px] leading-none text-[#FFE58A]">{collectedPets.length}</span>
              <span className="ml-1 text-[10.5px] font-black text-white/60">隻</span>
            </span>
          }
        />

        <p className="rpg-glass mt-3 rounded-2xl px-3.5 py-2.5 text-[11.5px] font-bold leading-relaxed text-white/75">
          養到大師雞之後按「收藏」，小雞就會永久留在這裡。收藏的小雞不用餵食、不會生病，可以派去探險跟戰隊。
        </p>

        {livingAsCollected ? (
          <section className="mt-3">
            <PetCard pet={livingAsCollected} wide onClick={() => setSelectedId(LIVING_PET_ID)} />
          </section>
        ) : null}

        {!collectedPetsLoaded ? (
          <div className="mt-8 text-center">
            <span className="rpg-glass inline-block rounded-2xl px-4 py-2 text-sm font-black text-white/80">載入中…</span>
          </div>
        ) : collectedPets.length === 0 ? (
          <div className="rpg-panel mt-4 rounded-[22px] px-5 py-8 text-center">
            <p className="text-4xl">🥚</p>
            <p className="mt-2 text-[15px] font-black text-white">還沒有收藏任何小雞</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-white/60">
              把小雞餵到大師雞，首頁就會出現「收藏」按鈕。
              <br />
              收藏前可以先轉職，收藏當下的職業就是牠的永久職業。
            </p>
            <button type="button" onClick={() => router.push("/feed")} className="btn-gold mt-4 rounded-2xl px-5 py-3 text-sm font-black">
              去餵小雞
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            {collectedPets.map((pet) => (
              <PetCard key={pet.id} pet={pet} onClick={() => setSelectedId(pet.id)} />
            ))}
          </div>
        )}

        {selected ? <PetDetail pet={selected} isLiving={selected.id === LIVING_PET_ID} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </main>
  );
}

export default function MyPetsPage() {
  return (
    <RequireAuth>
      <MyPetsContent />
    </RequireAuth>
  );
}
