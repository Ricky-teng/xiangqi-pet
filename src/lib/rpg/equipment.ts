// src/lib/rpg/equipment.ts

/**
 * RPG 擴充：裝備系統
 * ------------------------------------------------------------
 * 規則摘要：
 *   - 每隻小雞有兩個欄位：武器 ×1、防具 ×1，可以隨時卸下換給別隻
 *   - 武器 5 種（劍、匕首、斧、法杖、長槍），防具 5 種（盾、重甲、皮甲、
 *     刺甲、法袍）。每一種的數值取捨跟特殊效果不同，見 EQUIPMENT_TYPES
 *   - 共 5 階。「🎒 物品」頁只賣第 1 階的劍跟盾，各 100 飼料；其他種類
 *     只能靠探險掉寶（每座塔主掉自己解鎖的新種類，見 rollDropEquipment）
 *   - 品質浮動：掉寶的裝備帶 −10%～+10% 的隨機品質，影響這件的數值加成；
 *     商店買的固定是標準值（0%）
 *   - 寶石孔：孔數 = 階級（第 1 階 1 孔 … 第 5 階 5 孔），見 gems.ts
 *   - 合成：同階、同種類 ×3 → 高一階同種類 ×1，必定成功，不另外付飼料。
 *     新的那件繼承 3 件裡最好的品質；素材上的寶石全部退回寶石袋
 *   - 不能賣回
 *   - 出戰必須有武器；防具可穿可不穿
 *
 * 一件第 5 階 = 3^4 = 81 件同種類的第 1 階，這是刻意設計的長期目標。
 *
 * 階級數值刻意設計成「每階約 2.5 倍」，讓每次合成都有明顯的感覺，
 * 但又不會讓第 1 階完全沒用（第 1 階劍 +20 攻擊，對一隻裸裝
 * 攻擊 80 的未轉職小雞來說是 +25%，第一天就很有感）。
 *
 * ⚠️ 舊資料相容：這一版之前的裝備沒有 type / quality / gems 三個欄位。
 * 讀取一律走 getItemType / getItemQuality / getItemGems，缺欄位時
 * 自動當成「劍或盾、標準品質、沒有寶石」，不需要搬資料。
 */

import type { PetStats } from "@/lib/rpg/stats";
import { type GemId, isGemId, sumGems } from "@/lib/rpg/gems";

// ============================================================
// 1. 型別
// ============================================================

/** 裝備部位。武器加攻擊，防具加防禦與 HP */
export type EquipmentKind = "weapon" | "armor";

/** 裝備階級，1 ~ 5 */
export type EquipmentTier = 1 | 2 | 3 | 4 | 5;

/** 武器種類（存進 Firestore 的就是這個字串，不要改名） */
export type WeaponType = "sword" | "dagger" | "axe" | "staff" | "spear";
/** 防具種類 */
export type ArmorType = "shield" | "heavy" | "leather" | "spiked" | "robe";
export type EquipmentType = WeaponType | ArmorType;

export interface EquipmentItem {
  /** 唯一 id（產生方式見 createEquipmentItem） */
  id: string;
  kind: EquipmentKind;
  tier: EquipmentTier;
  /** 取得時間戳（ms），背包排序用 */
  acquiredAt: number;
  /** 種類。舊資料沒有這個欄位，一律用 getItemType 讀 */
  type?: EquipmentType;
  /** 品質 −0.1 ~ +0.1。舊資料沒有，一律用 getItemQuality 讀 */
  quality?: number;
  /** 鑲在上面的寶石（最多 = 階級顆）。一律用 getItemGems 讀 */
  gems?: GemId[];
}

/** 特殊效果 */
export type SpecialEffect =
  /** 爆擊：機率打出 mult 倍傷害 */
  | { kind: "crit"; chance: number; mult: number }
  /** 破甲：計算傷害時無視對方這個比例的防禦 */
  | { kind: "armorPen"; ratio: number }
  /** 吸血：造成傷害的這個比例拿來回自己的血 */
  | { kind: "lifesteal"; ratio: number }
  /**
   * 先攻：每遇到一個新對手，下一下提早出手、而且傷害 ×mult。
   * haste = 提早多少（1 = 立刻出手，0.2 = 只提早 20% 的間隔）
   */
  | { kind: "firstStrike"; mult: number; haste?: number }
  /** 閃避：這個機率完全不吃這一下的傷害 */
  | { kind: "dodge"; chance: number }
  /** 反傷：被打時把吃到傷害的這個比例還給攻擊者 */
  | { kind: "thorns"; ratio: number }
  /** 再生：每次自己出手，回最大體力的這個比例 */
  | { kind: "regen"; ratio: number };

export interface EquipmentTypeInfo {
  id: EquipmentType;
  kind: EquipmentKind;
  name: string;
  /** 第幾座塔開始會掉（1 = 一開始就有） */
  unlockTower: number;
  /** 這一種的攻擊／防禦／體力加成，是同階標準值（劍、盾）的幾倍 */
  attackMult: number;
  defenseMult: number;
  hpMult: number;
  /** 穿上之後速度 ±多少（0.18 = 速度 +18%） */
  speedPct: number;
  special: SpecialEffect | null;
  /** 一句話的取捨說明，給物品頁跟裝備選擇器用 */
  summary: string;
}

// ============================================================
// 2. 常數表
// ============================================================

export const MIN_EQUIPMENT_TIER: EquipmentTier = 1;
export const MAX_EQUIPMENT_TIER: EquipmentTier = 5;

/** 合成需要幾件同階同種類 */
export const FUSE_REQUIRED_COUNT = 3;

/** 商店只賣第 1 階的劍跟盾，同價 */
export const EQUIPMENT_SHOP_TIER: EquipmentTier = 1;
export const EQUIPMENT_SHOP_PRICE = 100;
export const SHOP_TYPE_BY_KIND: Record<EquipmentKind, EquipmentType> = {
  weapon: "sword",
  armor: "shield",
};

/** 背包：起始格數、每次擴充的格數、每次擴充的價格（擴充無上限） */
export const BAG_BASE_SLOTS = 50;
export const BAG_EXPAND_SLOTS = 20;
export const BAG_EXPAND_COST = 1000;

/** 品質浮動的範圍（±10%） */
export const QUALITY_RANGE = 0.1;

/** 爆擊的預設倍率（紫晶給的爆擊率用這個倍率；匕首自帶更高的倍率） */
export const DEFAULT_CRIT_MULT = 1.5;

/**
 * 種類的「速度 ±%」跟「特殊效果」強度隨階級成長（index 0 = 第 1 階）。
 * EQUIPMENT_TYPES 裡寫的是第 5 階（100%）的值。
 *
 * ⚠️ 這張表是平衡的關鍵，不是單純的「成長感」。種類之間的取捨
 * （例如匕首攻擊 ×0.8、速度 +15%）裡，攻擊倍率是乘在「裝備加成」上的，
 * 而裝備加成佔總攻擊的比例會隨階級變（第 1 階 +20／120 ≈ 17%，
 * 第 5 階 +780／880 ≈ 89%）。如果速度跟爆擊這些百分比效果不跟著縮放，
 * 第 1 階匕首的代價幾乎是 0、好處卻是全額，模擬的勝率是 76%；到第 5 階
 * 代價變全額，勝率掉到 8%。讓特效強度跟「裝備佔比」等比例成長之後，
 * 同一組數字在每一階都平衡。
 */
export const SPECIAL_SCALE_BY_TIER: number[] = [0.2, 0.4, 0.6, 0.8, 1];

export function getSpecialScale(tier: EquipmentTier): number {
  return SPECIAL_SCALE_BY_TIER[clampTier(tier) - 1] ?? 1;
}

/** 武器：各階的攻擊加成（index 0 = 第 1 階），這是「劍」的標準值 */
export const WEAPON_ATTACK_BY_TIER: number[] = [20, 50, 125, 310, 780];

/** 防具：各階的防禦加成，這是「盾」的標準值 */
export const ARMOR_DEFENSE_BY_TIER: number[] = [10, 25, 62, 155, 390];

/**
 * 防具：各階的 HP 加成。
 *
 * ⚠️ 這一組刻意等於「武器攻擊加成 × 5」（也就是基礎 HP 500 ÷ 基礎
 * 攻擊 100 的比例），原本是 50/125/310/780/1950。改的原因是模擬：
 * 舊的數字讓 HP 從第 1 階到第 5 階只長 4.5 倍，但攻擊長了 7.3 倍，
 * 所以高階的戰鬥「幾刀就解決一隻」，混戰的滾雪球效應變強，速度
 * 職業在第 5 階的價值暴漲（第 1 階勝率 30%、第 5 階 69%）。
 * 把 HP 跟攻擊的成長率對齊之後，同一組職業倍率在第 1 階到第 5 階
 * 的勝率幾乎一模一樣，平衡才變得可調。
 */
export const ARMOR_HP_BY_TIER: number[] = [100, 250, 625, 1550, 3900];

/**
 * 10 種裝備。
 *
 * 平衡標準（scripts/rpg-equipment-sim.ts）：同階同品質時，
 *   - 1 對 1 對戰：每一種對其他同部位種類的平均勝率落在 40%～60%
 *   - 探險：每一種在「剛好打得過」的關卡，通關率跟劍／盾差不到 15 個百分點
 * 數字改了一定要重跑模擬。
 */
export const EQUIPMENT_TYPES: Record<EquipmentType, EquipmentTypeInfo> = {
  // ---- 武器 ----
  sword: {
    id: "sword",
    kind: "weapon",
    name: "劍",
    unlockTower: 1,
    attackMult: 1,
    defenseMult: 0,
    hpMult: 0,
    speedPct: 0,
    special: null,
    summary: "標準攻擊，沒有特效",
  },
  dagger: {
    id: "dagger",
    kind: "weapon",
    name: "匕首",
    unlockTower: 2,
    attackMult: 0.8,
    defenseMult: 0,
    hpMult: 0,
    speedPct: 0.15,
    special: { kind: "crit", chance: 0.2, mult: 1.8 },
    summary: "攻擊略低、速度快",
  },
  axe: {
    id: "axe",
    kind: "weapon",
    name: "斧",
    unlockTower: 4,
    attackMult: 1.18,
    defenseMult: 0,
    hpMult: 0,
    speedPct: -0.2,
    special: { kind: "armorPen", ratio: 0.15 },
    summary: "攻擊高、速度慢",
  },
  staff: {
    id: "staff",
    kind: "weapon",
    name: "法杖",
    unlockTower: 6,
    attackMult: 0.85,
    defenseMult: 0,
    hpMult: 0,
    speedPct: 0,
    special: { kind: "lifesteal", ratio: 0.18 },
    summary: "攻擊略低",
  },
  spear: {
    id: "spear",
    kind: "weapon",
    name: "長槍",
    unlockTower: 8,
    attackMult: 0.88,
    defenseMult: 0,
    hpMult: 0,
    speedPct: 0,
    special: { kind: "firstStrike", mult: 1.3 },
    summary: "攻擊略低",
  },
  // ---- 防具 ----
  shield: {
    id: "shield",
    kind: "armor",
    name: "盾",
    unlockTower: 1,
    attackMult: 0,
    defenseMult: 1,
    hpMult: 1,
    speedPct: 0,
    special: null,
    summary: "標準防禦與體力，沒有特效",
  },
  heavy: {
    id: "heavy",
    kind: "armor",
    name: "重甲",
    unlockTower: 3,
    attackMult: 0,
    defenseMult: 1.35,
    hpMult: 1.05,
    speedPct: -0.15,
    special: null,
    summary: "防禦跟體力最高、速度慢",
  },
  leather: {
    id: "leather",
    kind: "armor",
    name: "皮甲",
    unlockTower: 5,
    attackMult: 0,
    defenseMult: 0.7,
    hpMult: 0.85,
    speedPct: 0.1,
    special: { kind: "dodge", chance: 0.12 },
    summary: "防禦低、速度快",
  },
  spiked: {
    id: "spiked",
    kind: "armor",
    name: "刺甲",
    unlockTower: 7,
    attackMult: 0,
    defenseMult: 0.75,
    hpMult: 0.9,
    speedPct: 0,
    special: { kind: "thorns", ratio: 0.18 },
    summary: "防禦略低",
  },
  robe: {
    id: "robe",
    kind: "armor",
    name: "法袍",
    unlockTower: 9,
    attackMult: 0,
    defenseMult: 0.5,
    hpMult: 1.05,
    speedPct: 0,
    special: { kind: "regen", ratio: 0.015 },
    summary: "防禦低，會持續回血",
  },
};

/** 種類的固定排列順序（UI、背包排序都照這個） */
export const WEAPON_TYPES: WeaponType[] = ["sword", "dagger", "axe", "staff", "spear"];
export const ARMOR_TYPES: ArmorType[] = ["shield", "heavy", "leather", "spiked", "robe"];
export const ALL_EQUIPMENT_TYPES: EquipmentType[] = [...WEAPON_TYPES, ...ARMOR_TYPES];

/** 各階的名稱 */
export const TIER_NAMES: string[] = ["粗製", "精良", "稀有", "史詩", "傳說"];

/**
 * 各階的框色。沿用全站配色：灰 → 綠 → 藍 → 紫 → 金，
 * 第 5 階的金色在 UI 上會額外加發光效果（見物品頁）。
 */
export const TIER_FRAME_COLORS: string[] = [
  "#9AA0A6", // 1 粗製：灰
  "#5B8C5A", // 2 精良：綠（沿用全站既有的綠）
  "#4A7FB5", // 3 稀有：藍
  "#8B5FBF", // 4 史詩：紫（沿用全站既有的紫）
  "#E8B84B", // 5 傳說：金（沿用全站主色，會發光）
];

/** 部位的中文名稱與圖示 */
export const KIND_LABELS: Record<EquipmentKind, string> = {
  weapon: "武器",
  armor: "防具",
};

export const KIND_EMOJIS: Record<EquipmentKind, string> = {
  weapon: "🗡️",
  armor: "🛡️",
};

// ============================================================
// 3. 查表小工具
// ============================================================

/** 把任意數字夾成合法的階級 */
export function clampTier(tier: number): EquipmentTier {
  const t = Math.round(tier);
  if (t <= MIN_EQUIPMENT_TIER) return MIN_EQUIPMENT_TIER;
  if (t >= MAX_EQUIPMENT_TIER) return MAX_EQUIPMENT_TIER;
  return t as EquipmentTier;
}

export function getTierName(tier: EquipmentTier): string {
  return TIER_NAMES[tier - 1] ?? TIER_NAMES[0];
}

export function getTierColor(tier: EquipmentTier): string {
  return TIER_FRAME_COLORS[tier - 1] ?? TIER_FRAME_COLORS[0];
}

/** 第 5 階要發光，UI 用這個判斷要不要加光暈 */
export function isTierGlowing(tier: EquipmentTier): boolean {
  return tier >= MAX_EQUIPMENT_TIER;
}

/** 這件的種類。舊資料沒有 type 欄位：武器當劍、防具當盾 */
export function getItemType(item: Pick<EquipmentItem, "kind" | "type">): EquipmentType {
  const type = item.type;
  if (type && EQUIPMENT_TYPES[type] && EQUIPMENT_TYPES[type].kind === item.kind) return type;
  return SHOP_TYPE_BY_KIND[item.kind];
}

export function getTypeInfo(type: EquipmentType): EquipmentTypeInfo {
  return EQUIPMENT_TYPES[type];
}

/** 這件的品質（−0.1 ~ +0.1）。舊資料沒有就是 0，夾在合法範圍內防髒資料 */
export function getItemQuality(item: Pick<EquipmentItem, "quality">): number {
  const q = item.quality;
  if (typeof q !== "number" || !Number.isFinite(q)) return 0;
  return Math.max(-QUALITY_RANGE, Math.min(QUALITY_RANGE, q));
}

/** 這件鑲著的寶石。過濾掉不認得的值、超過孔數的部分 */
export function getItemGems(item: Pick<EquipmentItem, "gems" | "tier">): GemId[] {
  const raw = Array.isArray(item.gems) ? item.gems : [];
  return raw.filter(isGemId).slice(0, getSocketCount(item.tier));
}

/** 孔數 = 階級 */
export function getSocketCount(tier: EquipmentTier): number {
  return clampTier(tier);
}

/** 裝備的完整顯示名稱，例如「稀有匕首」 */
export function getEquipmentName(item: Pick<EquipmentItem, "kind" | "type" | "tier">): string {
  return `${getTierName(item.tier)}${EQUIPMENT_TYPES[getItemType(item)].name}`;
}

/** 品質的顯示文字，例如「+7%」「−3%」「標準」 */
export function getQualityLabel(item: Pick<EquipmentItem, "quality">): string {
  const pct = Math.round(getItemQuality(item) * 100);
  if (pct === 0) return "標準";
  return pct > 0 ? `+${pct}%` : `−${Math.abs(pct)}%`;
}

/** 特殊效果的說明文字 */
export function getSpecialLabel(special: SpecialEffect | null): string | null {
  if (!special) return null;
  switch (special.kind) {
    case "crit":
      return `爆擊：${pct(special.chance)} 機率打出 ${special.mult} 倍傷害`;
    case "armorPen":
      return `破甲：無視對方 ${pct(special.ratio)} 防禦`;
    case "lifesteal":
      return `吸血：造成傷害的 ${pct(special.ratio)} 回自己的血`;
    case "firstStrike":
      return (special.haste ?? 1) >= 0.999
        ? `先攻：遇到新對手立刻出手，第一下 ${special.mult.toFixed(2)} 倍傷害`
        : `先攻：遇到新對手提早出手，第一下 ${special.mult.toFixed(2)} 倍傷害`;
    case "dodge":
      return `閃避：${pct(special.chance)} 機率完全不吃傷害`;
    case "thorns":
      return `反傷：被打時把 ${pct(special.ratio)} 傷害還回去`;
    case "regen":
      return `再生：每次出手回 ${pct(special.ratio, 1)} 體力`;
  }
}

/** 特殊效果的短名（「爆擊」「破甲」…），給小標籤用 */
export function getSpecialShortName(special: SpecialEffect | null): string | null {
  if (!special) return null;
  const map: Record<SpecialEffect["kind"], string> = {
    crit: "爆擊",
    armorPen: "破甲",
    lifesteal: "吸血",
    firstStrike: "先攻",
    dodge: "閃避",
    thorns: "反傷",
    regen: "再生",
  };
  return map[special.kind];
}

function pct(value: number, digits = 0): string {
  const v = value * 100;
  // 小於 10% 的顯示一位小數，不然第 1 階的「爆擊 4%」會被四捨五入得很粗
  const d = digits > 0 ? digits : v < 10 && Math.round(v) !== v ? 1 : 0;
  return `${v.toFixed(d)}%`;
}

// ============================================================
// 4. 數值加成
// ============================================================

/**
 * 一件裝備提供的「固定值」加成（攻擊／防禦／體力）。傳 null（欄位空著）
 * 回傳全 0，呼叫端就不用到處寫 if。
 *
 * 計算：同階標準值 × 種類倍率 × (1 + 品質)，四捨五入。
 * 速度的百分比加成跟寶石不在這裡（要在職業倍率前後套用），見
 * stats.ts 的 getFinalStats。
 */
export function getEquipmentBonus(item: EquipmentItem | null | undefined): PetStats {
  if (!item) {
    return { hp: 0, attack: 0, defense: 0, speed: 0 };
  }
  const index = clampTier(item.tier) - 1;
  const info = EQUIPMENT_TYPES[getItemType(item)];
  const q = 1 + getItemQuality(item);
  if (item.kind === "weapon") {
    return {
      hp: 0,
      attack: Math.round((WEAPON_ATTACK_BY_TIER[index] ?? 0) * info.attackMult * q),
      defense: 0,
      speed: 0,
    };
  }
  return {
    hp: Math.round((ARMOR_HP_BY_TIER[index] ?? 0) * info.hpMult * q),
    attack: 0,
    defense: Math.round((ARMOR_DEFENSE_BY_TIER[index] ?? 0) * info.defenseMult * q),
    speed: 0,
  };
}

/** 一件裝備對速度的百分比影響（匕首 +15%、斧 −15%…） */
export function getEquipmentSpeedPct(item: EquipmentItem | null | undefined): number {
  if (!item) return 0;
  return EQUIPMENT_TYPES[getItemType(item)].speedPct * getSpecialScale(item.tier);
}

/** 這一件「實際」的特殊效果（已依階級縮放），沒有特效回傳 null */
export function getItemSpecial(item: Pick<EquipmentItem, "kind" | "type" | "tier">): SpecialEffect | null {
  const special = EQUIPMENT_TYPES[getItemType(item)].special;
  return special ? scaleSpecial(special, getSpecialScale(item.tier)) : null;
}

function scaleSpecial(special: SpecialEffect, k: number): SpecialEffect {
  switch (special.kind) {
    case "crit":
      // 爆擊倍率不縮（不然低階匕首的爆擊會比紫晶還弱），縮的是機率
      return { ...special, chance: special.chance * k };
    case "armorPen":
    case "lifesteal":
    case "thorns":
    case "regen":
      return { ...special, ratio: special.ratio * k };
    case "dodge":
      return { ...special, chance: special.chance * k };
    case "firstStrike":
      return { ...special, mult: 1 + (special.mult - 1) * k, haste: k };
  }
}

/** 給物品頁的說明文字用，例如「攻擊 +125」「防禦 +62・體力 +310」 */
export function getEquipmentBonusLabel(item: EquipmentItem): string {
  const bonus = getEquipmentBonus(item);
  const speed = getEquipmentSpeedPct(item);
  const speedText = speed === 0 ? "" : `・速度 ${speed > 0 ? "+" : "−"}${Math.round(Math.abs(speed) * 100)}%`;
  if (item.kind === "weapon") {
    return `攻擊 +${bonus.attack}${speedText}`;
  }
  return `防禦 +${bonus.defense}・體力 +${bonus.hp}${speedText}`;
}

// ============================================================
// 5. 戰鬥特性（特殊效果＋寶石）
// ============================================================

/** 一隻小雞帶進戰鬥的所有特殊效果，由武器、防具、寶石合起來 */
export interface CombatTraits {
  /** 爆擊率（0 ~ 1）與爆擊倍率 */
  critChance: number;
  critMult: number;
  /** 破甲比例 */
  armorPen: number;
  /** 吸血比例 */
  lifesteal: number;
  /** 先攻：遇到新對手的第一下傷害倍率（0 = 沒有先攻） */
  firstStrikeMult: number;
  /** 先攻：提早出手的比例（1 = 立刻出手） */
  firstStrikeHaste: number;
  /** 閃避率 */
  dodge: number;
  /** 反傷比例 */
  thorns: number;
  /** 每次出手回最大體力的比例 */
  regen: number;
  /** 開場護盾：最大體力的比例（月光石） */
  shield: number;
}

export function emptyCombatTraits(): CombatTraits {
  return {
    critChance: 0,
    critMult: DEFAULT_CRIT_MULT,
    armorPen: 0,
    lifesteal: 0,
    firstStrikeMult: 0,
    firstStrikeHaste: 0,
    dodge: 0,
    thorns: 0,
    regen: 0,
    shield: 0,
  };
}

/** 爆擊率上限：不管鑲幾顆紫晶，最多 60%，避免「每一下都爆擊」 */
export const CRIT_CHANCE_CAP = 0.6;

/** 武器、防具、兩件身上的寶石，合成一份戰鬥特性 */
export function getCombatTraits(
  weapon: EquipmentItem | null | undefined,
  armor: EquipmentItem | null | undefined,
): CombatTraits {
  const traits = emptyCombatTraits();
  for (const item of [weapon, armor]) {
    if (!item) continue;
    const special = getItemSpecial(item);
    if (!special) continue;
    switch (special.kind) {
      case "crit":
        traits.critChance += special.chance;
        traits.critMult = Math.max(traits.critMult, special.mult);
        break;
      case "armorPen":
        traits.armorPen += special.ratio;
        break;
      case "lifesteal":
        traits.lifesteal += special.ratio;
        break;
      case "firstStrike":
        traits.firstStrikeMult = Math.max(traits.firstStrikeMult, special.mult);
        traits.firstStrikeHaste = Math.max(traits.firstStrikeHaste, special.haste ?? 1);
        break;
      case "dodge":
        traits.dodge += special.chance;
        break;
      case "thorns":
        traits.thorns += special.ratio;
        break;
      case "regen":
        traits.regen += special.ratio;
        break;
    }
  }
  const gems = sumGems([...(weapon ? getItemGems(weapon) : []), ...(armor ? getItemGems(armor) : [])]);
  traits.critChance = Math.min(CRIT_CHANCE_CAP, traits.critChance + gems.critChance);
  traits.shield += gems.shield;
  return traits;
}

/** 兩件裝備上所有寶石的數值百分比加成（攻防體速） */
export function getGemStatPercents(
  weapon: EquipmentItem | null | undefined,
  armor: EquipmentItem | null | undefined,
): { hp: number; attack: number; defense: number; speed: number } {
  const totals = sumGems([...(weapon ? getItemGems(weapon) : []), ...(armor ? getItemGems(armor) : [])]);
  return { hp: totals.hp, attack: totals.attack, defense: totals.defense, speed: totals.speed };
}

// ============================================================
// 6. 產生裝備
// ============================================================

/**
 * 產生一件新裝備。id 用「時間戳 + 亂數」組成，不靠 Firestore 的
 * auto id，因為整個背包是存在 user 文件底下的一個陣列，不是子集合
 * （裝備數量最多幾百件，放陣列讀寫一次搞定，比開子集合省很多次讀取）。
 */
export function createEquipmentItem(
  type: EquipmentType,
  tier: EquipmentTier,
  now: number = Date.now(),
  quality = 0,
): EquipmentItem {
  const random = Math.random().toString(36).slice(2, 8);
  const kind = EQUIPMENT_TYPES[type].kind;
  return {
    id: `${type}-${tier}-${now}-${random}`,
    kind,
    type,
    tier: clampTier(tier),
    quality: Math.round(Math.max(-QUALITY_RANGE, Math.min(QUALITY_RANGE, quality)) * 100) / 100,
    gems: [],
    acquiredAt: now,
  };
}

/** 隨機品質：−10% ~ +10% 均勻分布，取到整數百分比 */
export function rollQuality(rng: () => number = Math.random): number {
  return Math.round((rng() * 2 - 1) * QUALITY_RANGE * 100) / 100;
}

/** 第 N 座塔已經解鎖哪些種類（unlockTower ≤ N） */
export function getUnlockedTypes(tower: number): EquipmentType[] {
  return ALL_EQUIPMENT_TYPES.filter((t) => EQUIPMENT_TYPES[t].unlockTower <= tower);
}

/** 第 N 座塔「新解鎖」的種類（第 1 塔是劍跟盾；第 10 塔沒有新種類） */
export function getNewTypesAtTower(tower: number): EquipmentType[] {
  return ALL_EQUIPMENT_TYPES.filter((t) => EQUIPMENT_TYPES[t].unlockTower === tower);
}

/** 掉寶時主掉這座塔新種類的機率 */
export const DROP_NEW_TYPE_CHANCE = 0.6;

/**
 * 探險掉寶：在第 tower 座塔掉一件第 1 階裝備，品質隨機。
 *
 * 種類：60% 是這座塔新解鎖的種類（想要斧頭就去打第 4 塔，比較好湊齊
 * 3 件合成），40% 從其他已解鎖的種類平均抽。第 10 塔沒有新種類，
 * 所有種類平均掉。rng 可以注入，讓測試與模擬腳本能重現同一組結果。
 */
export function rollDropEquipment(
  tower: number,
  now: number = Date.now(),
  rng: () => number = Math.random,
): EquipmentItem {
  const fresh = getNewTypesAtTower(tower);
  const others = getUnlockedTypes(tower).filter((t) => !fresh.includes(t));
  const pool = fresh.length > 0 && (others.length === 0 || rng() < DROP_NEW_TYPE_CHANCE) ? fresh : others;
  const type = pool[Math.floor(rng() * pool.length) % pool.length];
  return createEquipmentItem(type, 1, now, rollQuality(rng));
}

// ============================================================
// 7. 寶石鑲嵌
// ============================================================

/** 還有沒有空孔 */
export function hasFreeSocket(item: EquipmentItem): boolean {
  return getItemGems(item).length < getSocketCount(item.tier);
}

/** 鑲一顆寶石，回傳新的裝備（純函式）。沒有空孔時丟例外，UI 應先擋 */
export function socketGem(item: EquipmentItem, gem: GemId): EquipmentItem {
  const gems = getItemGems(item);
  if (gems.length >= getSocketCount(item.tier)) {
    throw new Error("[socketGem] 已經沒有空孔了");
  }
  return { ...item, gems: [...gems, gem] };
}

/** 拆下第 index 顆寶石，回傳新的裝備跟拆下來的寶石 */
export function unsocketGem(item: EquipmentItem, index: number): { item: EquipmentItem; gem: GemId | null } {
  const gems = getItemGems(item);
  const gem = gems[index] ?? null;
  if (!gem) return { item, gem: null };
  return { item: { ...item, gems: gems.filter((_, i) => i !== index) }, gem };
}

// ============================================================
// 8. 合成
// ============================================================

/** 合成前的檢查結果 */
export type FuseCheck =
  | { ok: true; kind: EquipmentKind; type: EquipmentType; fromTier: EquipmentTier; toTier: EquipmentTier }
  | { ok: false; reason: string };

/**
 * 檢查這 3 件能不能合。必須「剛好 3 件、同種類、同階、且不是第 5 階」。
 * 回傳 ok: false 時附上給使用者看的中文理由。
 */
export function checkFuse(items: EquipmentItem[]): FuseCheck {
  if (items.length !== FUSE_REQUIRED_COUNT) {
    return { ok: false, reason: `要剛好 ${FUSE_REQUIRED_COUNT} 件才能合成` };
  }
  const [first] = items;
  if (items.some((item) => item.kind !== first.kind)) {
    return { ok: false, reason: "武器跟防具不能合在一起" };
  }
  const type = getItemType(first);
  if (items.some((item) => getItemType(item) !== type)) {
    return { ok: false, reason: "要同一種裝備才能合成（例如 3 把匕首）" };
  }
  if (items.some((item) => item.tier !== first.tier)) {
    return { ok: false, reason: "要同一個階級才能合成" };
  }
  if (first.tier >= MAX_EQUIPMENT_TIER) {
    return { ok: false, reason: `${getTierName(MAX_EQUIPMENT_TIER)}已經是最高階，不能再合` };
  }
  return {
    ok: true,
    kind: first.kind,
    type,
    fromTier: first.tier,
    toTier: clampTier(first.tier + 1),
  };
}

export interface FuseResult {
  item: EquipmentItem;
  /** 素材上拆下來、要退回寶石袋的寶石 */
  returnedGems: GemId[];
}

/**
 * 實際合成：吃 3 件，吐出 1 件高一階的。必定成功，不扣飼料。
 * 新的那件繼承 3 件裡最好的品質，孔是空的；素材上的寶石全部退回。
 * 呼叫端負責把這 3 件從背包移除、把回傳的那件加進去、寶石加回寶石袋。
 * 檢查沒過會丟例外——UI 應該先用 checkFuse 擋掉，不該走到這裡。
 */
export function fuseEquipment(items: EquipmentItem[], now: number = Date.now()): FuseResult {
  const check = checkFuse(items);
  if (!check.ok) {
    throw new Error(`[fuseEquipment] 合成條件不符：${check.reason}`);
  }
  const bestQuality = Math.max(...items.map(getItemQuality));
  return {
    item: createEquipmentItem(check.type, check.toTier, now, bestQuality),
    returnedGems: items.flatMap(getItemGems),
  };
}

// ============================================================
// 9. 一鍵合成
// ============================================================

export interface AutoFuseResult {
  /** 合成後的完整背包 */
  bag: EquipmentItem[];
  /** 總共合成了幾次 */
  fuseCount: number;
  /** 這次合出了哪些東西（依階級由低到高），給確認頁跟結算動畫用 */
  produced: EquipmentItem[];
  /** 素材上退回來的寶石 */
  returnedGems: GemId[];
}

/**
 * 一鍵合成：從第 1 階往上，只要某個「種類＋階級」湊滿 3 件就合，
 * 合出來的高階品會再參與下一輪，所以一路合到底。
 *
 * 刻意由低階往高階跑，這樣 9 把第 1 階匕首會變成 1 把第 3 階，
 * 而不是停在 3 把第 2 階。同一組裡先用品質差的合（合出來會繼承
 * 最好的品質，所以先拿差的當素材，留下來的是好的）。
 *
 * 這個函式是純的——不會改動傳進來的 bag，回傳一份新的。
 * UI 應該先用它算出結果給使用者看確認頁，按下確定才真的寫回。
 */
export function autoFuse(bag: EquipmentItem[], now: number = Date.now()): AutoFuseResult {
  // 被穿在小雞身上的裝備不會出現在 bag 裡，所以這裡不用另外排除
  let working = [...bag];
  const produced: EquipmentItem[] = [];
  const returnedGems: GemId[] = [];
  let fuseCount = 0;

  for (let tier = MIN_EQUIPMENT_TIER; tier < MAX_EQUIPMENT_TIER; tier++) {
    for (const type of ALL_EQUIPMENT_TYPES) {
      // 每一輪都重新篩，因為上一輪可能剛好合出這一階的東西
      const pickCandidates = () => working.filter((item) => item.tier === tier && getItemType(item) === type);
      let candidates = pickCandidates();

      while (candidates.length >= FUSE_REQUIRED_COUNT) {
        // 3 件合 1 件會繼承最好的品質，所以「最好的那件」一定要放進
        // 這一組，另外兩件拿最差的。這樣不管怎麼合，品質都不會浪費。
        candidates.sort((a, b) => getItemQuality(b) - getItemQuality(a) || a.acquiredAt - b.acquiredAt);
        const consumed = [candidates[0], ...candidates.slice(-2)];
        const consumedIds = new Set(consumed.map((item) => item.id));

        const result = fuseEquipment(consumed, now + fuseCount);
        working = working.filter((item) => !consumedIds.has(item.id)).concat(result.item);
        produced.push(result.item);
        returnedGems.push(...result.returnedGems);
        fuseCount += 1;

        candidates = pickCandidates();
      }
    }
  }

  // produced 裡可能有「中途合出、之後又被拿去當素材」的東西，只留最後還在背包裡的
  const finalIds = new Set(working.map((item) => item.id));
  const survivors = produced.filter((item) => finalIds.has(item.id)).sort((a, b) => a.tier - b.tier);

  return { bag: working, fuseCount, produced: survivors, returnedGems };
}

// ============================================================
// 10. 背包
// ============================================================

/** 目前的背包上限：基礎 50 格 + 擴充過幾次 × 20 格 */
export function getBagCapacity(expandCount: number): number {
  return BAG_BASE_SLOTS + Math.max(0, Math.floor(expandCount || 0)) * BAG_EXPAND_SLOTS;
}

/** 背包還剩幾格 */
export function getBagFreeSlots(bag: EquipmentItem[], expandCount: number): number {
  return Math.max(0, getBagCapacity(expandCount) - bag.length);
}

/** 還塞不塞得下 count 件 */
export function canFitInBag(bag: EquipmentItem[], expandCount: number, count: number): boolean {
  return getBagFreeSlots(bag, expandCount) >= count;
}

/**
 * 背包的折疊顯示：同種類同階合成一組。
 * 注意這只是「畫面上折疊」，格數仍然是一件一格——所以每一組要同時
 * 帶著 count（顯示 ×27）跟實際的 items（點開看每一件的品質跟寶石）。
 */
export interface BagGroup {
  kind: EquipmentKind;
  type: EquipmentType;
  tier: EquipmentTier;
  count: number;
  /** 依品質由好到差排好 */
  items: EquipmentItem[];
}

/** 依「部位 → 種類 → 階級（高階在前）」分組，給物品頁的背包區渲染用 */
export function groupBag(bag: EquipmentItem[]): BagGroup[] {
  const map = new Map<string, BagGroup>();

  for (const item of bag) {
    const type = getItemType(item);
    const key = `${type}-${item.tier}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(item);
    } else {
      map.set(key, { kind: item.kind, type, tier: item.tier, count: 1, items: [item] });
    }
  }

  const order = (t: EquipmentType) => ALL_EQUIPMENT_TYPES.indexOf(t);
  const groups = [...map.values()];
  for (const g of groups) {
    g.items.sort((a, b) => getItemQuality(b) - getItemQuality(a) || b.acquiredAt - a.acquiredAt);
  }
  return groups.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "weapon" ? -1 : 1;
    if (a.tier !== b.tier) return b.tier - a.tier;
    return order(a.type) - order(b.type);
  });
}

// ============================================================
// 11. 出戰資格
// ============================================================

/**
 * 探險的出戰條件：**那一隻必須有武器**。防具可穿可不穿。
 *
 * 探險只派 1 隻，所以「整隊要有武器」跟「這一隻要有武器」是同一件事。
 * 回傳 null 代表可以出戰，回傳字串就是給學生看的原因（準備頁直接把
 * 它印在灰掉的「開始」按鈕下面）。
 */
export function getDeployBlockReason(weapon: EquipmentItem | null | undefined): string | null {
  if (!weapon) return "還差一把武器";
  return null;
}

/** 方便在條件式裡直接用的版本 */
export function canDeploy(weapon: EquipmentItem | null | undefined): boolean {
  return getDeployBlockReason(weapon) === null;
}

/**
 * 戰隊的出戰條件：**整隊至少一隻有武器**就能出戰。
 *
 * 跟探險不一樣是刻意的：戰隊要湊 3 隻，如果每一隻都得自備武器，
 * 新手要先存 300 飼料才排得出一支隊伍，門檻太高。整隊一把的設計
 * 讓空手的小雞也能上去當肉盾（牠們攻擊很低，本來就不強勢）。
 *
 * 回傳 null 代表可以出戰。
 */
export function getTeamDeployBlockReason(
  weapons: (EquipmentItem | null | undefined)[],
): string | null {
  if (weapons.length === 0) return "還沒有編隊";
  if (!weapons.some((w) => Boolean(w))) return "整隊至少要有一隻帶武器";
  return null;
}
