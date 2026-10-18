// src/lib/rpg/gems.ts

/**
 * RPG 擴充：寶石
 * ------------------------------------------------------------
 * 規則摘要：
 *   - 6 色，不分等級。同一顆寶石不管鑲在哪裡效果都一樣
 *   - 裝備的孔數 = 階級（第 1 階 1 孔 … 第 5 階 5 孔），武器防具都能鑲
 *   - 任何顏色都能鑲在任何裝備上，同色可以疊加
 *   - 隨時可以免費拆下來，拆下的寶石回到寶石袋
 *   - 裝備合成時，素材上的寶石全部退回寶石袋，不會損失
 *   - 來源只有探險：首通必掉 1 顆；重打（每天前 10 次贏的）有機率掉
 *   - 六色：紅寶石攻擊、藍寶石防禦、翡翠體力、黃晶速度、紫晶爆擊率、
 *     月光石開場護盾
 *
 * 寶石袋存在 UserDoc.gemBag，是「顏色 → 數量」的對照表，不佔裝備
 * 背包的格數（寶石不分等級，同色就是同一種東西，記數量就夠了）。
 *
 * 數值全部集中在 GEM_TABLE，平衡只要改這一張表。現在的數字是用
 * scripts/rpg-equipment-sim.ts 跑出來的，標準是「全身鑲同一色時，
 * 六色之間的對戰勝率都落在 40%～60%」。
 */

/** 寶石顏色 id（存進 Firestore 的就是這個字串，不要改名） */
export type GemId = "ruby" | "sapphire" | "emerald" | "topaz" | "amethyst" | "moonstone";

export const GEM_IDS: GemId[] = ["ruby", "sapphire", "emerald", "topaz", "amethyst", "moonstone"];

/** 一顆寶石加的是哪一種效果 */
export type GemEffect =
  /** 四項數值的百分比加成 */
  | "attack"
  | "defense"
  | "hp"
  | "speed"
  /** 爆擊率（打出 1.5 倍傷害的機率；匕首是 1.8 倍） */
  | "critChance"
  /**
   * 開場護盾（最大體力的百分比）：每場對戰開場、探險每遇到一隻新怪，
   * 先拿到一層護盾，傷害先扣護盾再扣血。
   *
   * ⚠️ 原本的設計是「擊倒回血」，模擬發現完全沒用：探險打倒一隻怪本來
   * 就固定回 30%，多回的大多溢出浪費；而學生真正會輸是輸在最後的
   * Boss，打倒小怪回再多血都救不了。改成護盾之後每一隻怪都有效。
   */
  | "shield";

export interface GemInfo {
  id: GemId;
  name: string;
  effect: GemEffect;
  /** 一顆的效果量（0.04 = 4%） */
  value: number;
  /** 效果的中文說明，例如「攻擊 +4%」 */
  label: string;
  /** 畫圖用的三階色：亮／主／暗 */
  hi: string;
  mid: string;
  lo: string;
}

/**
 * 寶石數值表。
 *
 * 為什麼四項數值的百分比不一樣（攻擊 4%、防禦 6%……）：同樣的百分比
 * 在不同數值上「值」的東西不一樣。速度 +1% 等於整體出手數 +1%，是
 * 純粹的輸出跟續航提升，所以給最少；防禦在傷害公式裡是被稀釋的
 * （攻擊² ÷ (攻擊 + 防禦)），要給比較多才追得上。實際數字見模擬。
 */
export const GEM_TABLE: Record<GemId, GemInfo> = {
  ruby: { id: "ruby", name: "紅寶石", effect: "attack", value: 0.025, label: "攻擊 +2.5%", hi: "#FFC2CC", mid: "#E8243F", lo: "#6E0716" },
  sapphire: { id: "sapphire", name: "藍寶石", effect: "defense", value: 0.085, label: "防禦 +8.5%", hi: "#C2E0FF", mid: "#2E6FE0", lo: "#0A2560" },
  emerald: { id: "emerald", name: "翡翠", effect: "hp", value: 0.035, label: "體力 +3.5%", hi: "#C6FFD8", mid: "#1FB45C", lo: "#064A22" },
  topaz: { id: "topaz", name: "黃晶", effect: "speed", value: 0.03, label: "速度 +3%", hi: "#FFF4BF", mid: "#F2B71C", lo: "#7A5304" },
  amethyst: { id: "amethyst", name: "紫晶", effect: "critChance", value: 0.075, label: "爆擊率 +7.5%", hi: "#EFD6FF", mid: "#9B4DE0", lo: "#3A1266" },
  moonstone: { id: "moonstone", name: "月光石", effect: "shield", value: 0.03, label: "開場護盾 +3%", hi: "#FFFFFF", mid: "#B9D4EE", lo: "#4A6A8E" },
};

export function getGemInfo(id: GemId): GemInfo {
  return GEM_TABLE[id];
}

export function isGemId(value: unknown): value is GemId {
  return typeof value === "string" && (GEM_IDS as string[]).includes(value);
}

// ============================================================
// 寶石袋
// ============================================================

/** 寶石袋：顏色 → 數量。沒出現的顏色等於 0 顆 */
export type GemBag = Partial<Record<GemId, number>>;

/** 讀某一色有幾顆（保證回傳非負整數，防 Firestore 髒資料） */
export function getGemCount(bag: GemBag | null | undefined, id: GemId): number {
  const n = bag?.[id] ?? 0;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** 寶石袋總共幾顆 */
export function getGemTotal(bag: GemBag | null | undefined): number {
  return GEM_IDS.reduce((sum, id) => sum + getGemCount(bag, id), 0);
}

/**
 * 把一串寶石加進寶石袋（或用 sign = -1 扣掉），回傳新的寶石袋。
 * 純函式，不改傳進來的物件。數量 0 的顏色直接拿掉，Firestore 文件
 * 比較乾淨。
 */
export function addGemsToBag(bag: GemBag | null | undefined, gems: GemId[], sign: 1 | -1 = 1): GemBag {
  const next: GemBag = { ...(bag ?? {}) };
  for (const id of gems) {
    const value = getGemCount(next, id) + sign;
    if (value > 0) next[id] = value;
    else delete next[id];
  }
  return next;
}

// ============================================================
// 掉落
// ============================================================

/** 首通必掉幾顆寶石 */
export const GEM_DROP_FIRST_CLEAR = 1;
/** 重打（每天前 N 次贏的）掉 1 顆寶石的機率 */
export const GEM_DROP_CHANCE_REPLAY = 0.2;

/** 隨機一色，六色機率相同。rng 可注入讓模擬重現 */
export function rollGem(rng: () => number = Math.random): GemId {
  return GEM_IDS[Math.floor(rng() * GEM_IDS.length) % GEM_IDS.length];
}

// ============================================================
// 效果加總
// ============================================================

/** 一組寶石加總後的效果（全部是小數，0.12 = 12%） */
export interface GemTotals {
  attack: number;
  defense: number;
  hp: number;
  speed: number;
  critChance: number;
  shield: number;
}

export function emptyGemTotals(): GemTotals {
  return { attack: 0, defense: 0, hp: 0, speed: 0, critChance: 0, shield: 0 };
}

/** 把一串寶石的效果加起來 */
export function sumGems(gems: GemId[]): GemTotals {
  const totals = emptyGemTotals();
  for (const id of gems) {
    const info = GEM_TABLE[id];
    if (!info) continue;
    totals[info.effect] += info.value;
  }
  return totals;
}
