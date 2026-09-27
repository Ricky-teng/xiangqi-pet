// src/lib/rpg/equipment.ts

/**
 * RPG 擴充：裝備系統
 * ------------------------------------------------------------
 * 規則摘要：
 *   - 每隻小雞有兩個欄位：武器 ×1、防具 ×1，可以隨時卸下換給別隻
 *   - 共 5 階。商店（實際上是「🎒 物品」頁）只賣第 1 階，武器/防具各 100 飼料
 *   - 合成：同階同類型 ×3 → 高一階同類型 ×1，必定成功，不另外付飼料
 *   - 不能賣回
 *   - 出戰必須有武器；防具可穿可不穿
 *
 * 一件第 5 階 = 3^4 = 81 件第 1 階，這是刻意設計的長期目標。
 *
 * 階級數值刻意設計成「每階約 2.5 倍」，讓每次合成都有明顯的感覺，
 * 但又不會讓第 1 階完全沒用（第 1 階武器 +20 攻擊，對一隻裸裝
 * 攻擊 80 的未轉職小雞來說是 +25%，第一天就很有感）。
 */

import type { PetStats } from "@/lib/rpg/stats";

// ============================================================
// 1. 型別
// ============================================================

/** 裝備類型。武器加攻擊，防具加防禦與 HP */
export type EquipmentKind = "weapon" | "armor";

/** 裝備階級，1 ~ 5 */
export type EquipmentTier = 1 | 2 | 3 | 4 | 5;

export interface EquipmentItem {
  /** 唯一 id（產生方式見 createEquipmentItem） */
  id: string;
  kind: EquipmentKind;
  tier: EquipmentTier;
  /** 取得時間戳（ms），背包排序用 */
  acquiredAt: number;
}

// ============================================================
// 2. 常數表
// ============================================================

export const MIN_EQUIPMENT_TIER: EquipmentTier = 1;
export const MAX_EQUIPMENT_TIER: EquipmentTier = 5;

/** 合成需要幾件同階同類型 */
export const FUSE_REQUIRED_COUNT = 3;

/** 商店只賣第 1 階，武器/防具同價 */
export const EQUIPMENT_SHOP_TIER: EquipmentTier = 1;
export const EQUIPMENT_SHOP_PRICE = 100;

/** 背包：起始格數、每次擴充的格數、每次擴充的價格（擴充無上限） */
export const BAG_BASE_SLOTS = 50;
export const BAG_EXPAND_SLOTS = 20;
export const BAG_EXPAND_COST = 1000;

/** 武器：各階的攻擊加成（index 0 = 第 1 階） */
export const WEAPON_ATTACK_BY_TIER: number[] = [20, 50, 125, 310, 780];

/** 防具：各階的防禦加成 */
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

/** 類型的中文名稱與圖示 */
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

/** 裝備的完整顯示名稱，例如「傳說武器」 */
export function getEquipmentName(item: EquipmentItem): string {
  return `${getTierName(item.tier)}${KIND_LABELS[item.kind]}`;
}

// ============================================================
// 4. 數值加成
// ============================================================

/**
 * 一件裝備提供的四項加成。傳 null（欄位空著）回傳全 0，
 * 呼叫端就不用到處寫 if。
 */
export function getEquipmentBonus(item: EquipmentItem | null | undefined): PetStats {
  if (!item) {
    return { hp: 0, attack: 0, defense: 0, speed: 0 };
  }

  const index = clampTier(item.tier) - 1;

  if (item.kind === "weapon") {
    return {
      hp: 0,
      attack: WEAPON_ATTACK_BY_TIER[index] ?? 0,
      defense: 0,
      speed: 0,
    };
  }

  return {
    hp: ARMOR_HP_BY_TIER[index] ?? 0,
    attack: 0,
    defense: ARMOR_DEFENSE_BY_TIER[index] ?? 0,
    speed: 0,
  };
}

/** 給物品頁的說明文字用，例如「攻擊 +125」「防禦 +62・體力 +310」 */
export function getEquipmentBonusLabel(item: EquipmentItem): string {
  const bonus = getEquipmentBonus(item);
  if (item.kind === "weapon") {
    return `攻擊 +${bonus.attack}`;
  }
  return `防禦 +${bonus.defense}・體力 +${bonus.hp}`;
}

// ============================================================
// 5. 產生裝備
// ============================================================

/**
 * 產生一件新裝備。id 用「時間戳 + 亂數」組成，不靠 Firestore 的
 * auto id，因為整個背包是存在 user 文件底下的一個陣列，不是子集合
 * （裝備數量最多幾百件，放陣列讀寫一次搞定，比開子集合省很多次讀取）。
 */
export function createEquipmentItem(
  kind: EquipmentKind,
  tier: EquipmentTier,
  now: number = Date.now(),
): EquipmentItem {
  const random = Math.random().toString(36).slice(2, 8);
  return {
    id: `${kind}-${tier}-${now}-${random}`,
    kind,
    tier: clampTier(tier),
    acquiredAt: now,
  };
}

/**
 * 探險掉寶用：隨機產生一件第 1 階裝備，武器/防具各一半機率。
 * rng 可以注入，讓測試與模擬腳本能重現同一組結果。
 */
export function rollDropEquipment(
  now: number = Date.now(),
  rng: () => number = Math.random,
): EquipmentItem {
  const kind: EquipmentKind = rng() < 0.5 ? "weapon" : "armor";
  return createEquipmentItem(kind, 1, now);
}

// ============================================================
// 6. 合成
// ============================================================

/** 合成前的檢查結果 */
export type FuseCheck =
  | { ok: true; kind: EquipmentKind; fromTier: EquipmentTier; toTier: EquipmentTier }
  | { ok: false; reason: string };

/**
 * 檢查這 3 件能不能合。必須「剛好 3 件、同類型、同階、且不是第 5 階」。
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
  if (items.some((item) => item.tier !== first.tier)) {
    return { ok: false, reason: "要同一個階級才能合成" };
  }
  if (first.tier >= MAX_EQUIPMENT_TIER) {
    return { ok: false, reason: `${getTierName(MAX_EQUIPMENT_TIER)}已經是最高階，不能再合` };
  }

  return {
    ok: true,
    kind: first.kind,
    fromTier: first.tier,
    toTier: clampTier(first.tier + 1),
  };
}

/**
 * 實際合成：吃 3 件，吐出 1 件高一階的。必定成功，不扣飼料。
 * 呼叫端負責把這 3 件從背包移除、把回傳的那件加進去。
 * 檢查沒過會丟例外——UI 應該先用 checkFuse 擋掉，不該走到這裡。
 */
export function fuseEquipment(items: EquipmentItem[], now: number = Date.now()): EquipmentItem {
  const check = checkFuse(items);
  if (!check.ok) {
    throw new Error(`[fuseEquipment] 合成條件不符：${check.reason}`);
  }
  return createEquipmentItem(check.kind, check.toTier, now);
}

// ============================================================
// 7. 一鍵合成
// ============================================================

export interface AutoFuseResult {
  /** 合成後的完整背包 */
  bag: EquipmentItem[];
  /** 總共合成了幾次 */
  fuseCount: number;
  /** 這次合出了哪些東西（依階級由低到高），給確認頁跟結算動畫用 */
  produced: EquipmentItem[];
}

/**
 * 一鍵合成：從第 1 階往上，只要某個「類型＋階級」湊滿 3 件就合，
 * 合出來的高階品會再參與下一輪，所以一路合到底。
 *
 * 刻意由低階往高階跑，這樣 9 件第 1 階武器會變成 1 件第 3 階，
 * 而不是停在 3 件第 2 階。
 *
 * 這個函式是純的——不會改動傳進來的 bag，回傳一份新的。
 * UI 應該先用它算出結果給使用者看確認頁，按下確定才真的寫回。
 */
export function autoFuse(bag: EquipmentItem[], now: number = Date.now()): AutoFuseResult {
  // 被穿在小雞身上的裝備不會出現在 bag 裡，所以這裡不用另外排除
  let working = [...bag];
  const produced: EquipmentItem[] = [];
  let fuseCount = 0;

  for (let tier = MIN_EQUIPMENT_TIER; tier < MAX_EQUIPMENT_TIER; tier++) {
    for (const kind of ["weapon", "armor"] as EquipmentKind[]) {
      // 每一輪都重新篩，因為上一輪可能剛好合出這一階的東西
      let candidates = working.filter((item) => item.kind === kind && item.tier === tier);

      while (candidates.length >= FUSE_REQUIRED_COUNT) {
        // 先用舊的（acquiredAt 小的）合掉，讓背包裡留下來的是新取得的
        candidates.sort((a, b) => a.acquiredAt - b.acquiredAt);
        const consumed = candidates.slice(0, FUSE_REQUIRED_COUNT);
        const consumedIds = new Set(consumed.map((item) => item.id));

        const newItem = fuseEquipment(consumed, now);
        working = working.filter((item) => !consumedIds.has(item.id)).concat(newItem);
        produced.push(newItem);
        fuseCount += 1;

        candidates = working.filter((item) => item.kind === kind && item.tier === tier);
      }
    }
  }

  return { bag: working, fuseCount, produced };
}

// ============================================================
// 8. 背包
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
 * 背包的折疊顯示：同類型同階合成一組。
 * 注意這只是「畫面上折疊」，格數仍然是一件一格——所以每一組要同時
 * 帶著 count（顯示 ×27）跟實際的 items（合成時要挑出其中 3 件）。
 */
export interface BagGroup {
  kind: EquipmentKind;
  tier: EquipmentTier;
  count: number;
  items: EquipmentItem[];
}

/** 依「類型 → 階級（高階在前）」分組，給物品頁的背包區渲染用 */
export function groupBag(bag: EquipmentItem[]): BagGroup[] {
  const map = new Map<string, BagGroup>();

  for (const item of bag) {
    const key = `${item.kind}-${item.tier}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(item);
    } else {
      map.set(key, { kind: item.kind, tier: item.tier, count: 1, items: [item] });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "weapon" ? -1 : 1;
    return b.tier - a.tier;
  });
}

// ============================================================
// 9. 出戰資格
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
