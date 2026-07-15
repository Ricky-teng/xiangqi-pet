/**
 * src/lib/shopItems.ts
 *
 * 商店道具靜態設定檔
 * 道具定義不存 Firestore，直接在前端維護，老師不需要後台管理。
 * 新增/修改道具只需改這個檔案。
 */

export type ItemCategory = "consumable" | "background";

/** 背景稀有度，由低到高排序 */
export type BackgroundRarity = "common" | "uncommon" | "rare" | "super_rare" | "epic" | "legendary";

export const RARITY_ORDER: BackgroundRarity[] = ["common", "uncommon", "rare", "super_rare", "epic", "legendary"];

export const RARITY_LABELS: Record<BackgroundRarity, string> = {
  common: "常見",
  uncommon: "普通",
  rare: "稀有",
  super_rare: "超稀有",
  epic: "史詩",
  legendary: "傳說",
};

/** 稀有度標籤配色（沿用既有品牌色系，越稀有越搶眼） */
export const RARITY_COLORS: Record<BackgroundRarity, string> = {
  common: "#9CA3AF",
  uncommon: "#5B8C5A",
  rare: "#3B82F6",
  super_rare: "#8B5FBF",
  epic: "#E8B84B",
  legendary: "#C0392B",
};

/**
 * 每個稀有度的抽獎權重（在「有中獎」的前提下，決定抽到哪個稀有度）。
 * 數字只是相對比例，不用加總到 100；同一稀有度內的所有背景會均分這個權重，
 * 所以款式越多的稀有度，池子裡的「單一款式」中獎機率會被稀釋。
 */
export const RARITY_WEIGHTS: Record<BackgroundRarity, number> = {
  common: 40,
  uncommon: 28,
  rare: 16,
  super_rare: 9,
  epic: 5,
  legendary: 2,
};

export interface ShopItem {
  id: string;
  category: ItemCategory;
  name: string;
  description: string;
  icon: string;
  price: number;
  /** 背景圖片路徑（只有 background 類型才有） */
  backgroundSrc?: string;
  /** 預覽顏色（背景圖載入前的佔位色） */
  previewColor?: string;
  /** 背景稀有度（只有 background 類型才有；沒填視為 common） */
  rarity?: BackgroundRarity;
}

export const SHOP_ITEMS: ShopItem[] = [
  // ---- 消耗道具 ----
  {
    id: "slight_sick_potion",
    category: "consumable",
    name: "小病藥水",
    description: "小雞生小病時使用，立刻治癒恢復健康。",
    icon: "💊",
    price: 20,
  },
  {
    id: "severe_sick_potion",
    category: "consumable",
    name: "大病藥水",
    description: "小雞生大病時使用，立刻治癒恢復健康。",
    icon: "🧪",
    price: 40,
  },
  {
    id: "revival_potion",
    category: "consumable",
    name: "復活藥水",
    description: "小雞死亡後使用，保留死前所有狀態（等級、飽食度、XP）原地復活，不重置回蛋。",
    icon: "⚗️",
    price: 700,
  },
  {
    id: "double_reward_voucher",
    category: "consumable",
    name: "雙倍飼料券",
    description: "使用後 30 分鐘內，所有解題與對弈的飼料獎勵變成兩倍。效果不可疊加，每天限購一次。",
    icon: "🎟️",
    price: 300,
  },
  {
    id: "fullness_shield",
    category: "consumable",
    name: "飽食護盾",
    description: "使用後 3 天內，小雞飽食度不會下降，也不會因為太餓而生病。",
    icon: "🛡️",
    price: 400,
  },

  // ---- 背景 ----
  // 【注意】背景已改為「抽獎」取得，不能在商店直接花飼料購買。
  // 這裡的 price 欄位保留但不再用於購買，只作為歷史參考／未來若要
  // 顯示「等值」時使用。實際抽獎花費請看下面的 BACKGROUND_GACHA_COST。
  {
    id: "bamboo_forest",
    category: "background",
    name: "竹林秘境",
    description: "清幽竹林，小熊貓守護的秘密基地。",
    icon: "🎋",
    price: 300,
    backgroundSrc: "/backgrounds/bamboo_forest.jpg",
    previewColor: "#5B8C5A",
    rarity: "common", // TODO: 先暫定「常見」，Ricky 確認後可調整
  },
  {
    id: "classic_red",
    category: "background",
    name: "古典棋院",
    description: "紅木棋桌、紅燈籠，象棋大師的秘密道場。",
    icon: "🏮",
    price: 300,
    backgroundSrc: "/backgrounds/classic_red.jpg",
    previewColor: "#8B0000",
    rarity: "common", // TODO: 先暫定「常見」，Ricky 確認後可調整
  },
  {
    id: "starry_night",
    category: "background",
    name: "星空夜語",
    description: "月下小雞仰望銀河，夜晚的象棋最有感覺。",
    icon: "🌙",
    price: 300,
    backgroundSrc: "/backgrounds/starry_night.jpg",
    previewColor: "#1A1A6E",
    rarity: "uncommon", // TODO: 先暫定「普通」，Ricky 確認後可調整
  },
  {
    id: "maple_forest",
    category: "background",
    name: "楓林秘境",
    description: "楓紅滿地的秋日森林，小雞在石板路旁撿楓葉。",
    icon: "🍁",
    price: 300,
    backgroundSrc: "/backgrounds/maple_forest.jpg",
    previewColor: "#C0392B",
    rarity: "super_rare",
  },
  {
    id: "snowy_night_chess",
    category: "background",
    name: "雪夜棋院",
    description: "白雪覆蓋的古典棋院，紅燈籠在雪夜裡靜靜發光。",
    icon: "❄️",
    price: 300,
    backgroundSrc: "/backgrounds/snowy_night_chess.jpg",
    previewColor: "#1A1A6E",
    rarity: "epic",
  },
];

/** 取得單一道具資料 */
export function getShopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

/** 判斷用戶是否已解鎖某個背景 */
export function isBackgroundUnlocked(userId: string, itemId: string, unlockedIds: string[]): boolean {
  return unlockedIds.includes(itemId);
}

// ============================================================
// 背景抽獎（取代直接購買）
// ============================================================

/** 抽一次背景要花多少飼料 */
export const BACKGROUND_GACHA_COST = 20;

/** 抽中「任一款背景」的機率（其餘機率是銘謝惠顧，飼料照扣但沒有背景） */
export const BACKGROUND_GACHA_WIN_RATE = 0.15;

/** 抽獎池：目前就是全部的背景款式，中獎時機率均等 */
export function getBackgroundGachaPool(): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === "background");
}

/**
 * 從抽獎池中依「稀有度權重」隨機抽出一款背景。
 * 同稀有度的所有背景均分該稀有度的權重，所以同一級距內每款機率相等，
 * 但級距之間會照 RARITY_WEIGHTS 的比例拉開差距。
 */
export function drawRandomBackground(): ShopItem {
  const pool = getBackgroundGachaPool();

  const countByRarity = new Map<BackgroundRarity, number>();
  for (const item of pool) {
    const r = item.rarity ?? "common";
    countByRarity.set(r, (countByRarity.get(r) ?? 0) + 1);
  }

  const weighted = pool.map((item) => {
    const r = item.rarity ?? "common";
    const itemsInRarity = countByRarity.get(r) ?? 1;
    return { item, weight: RARITY_WEIGHTS[r] / itemsInRarity };
  });

  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.item;
  }
  return weighted[weighted.length - 1].item; // 浮點數誤差保險 fallback
}

/**
 * 完整抽一次的結果：先擲一次 BACKGROUND_GACHA_WIN_RATE 機率判斷有沒有中獎，
 * 沒中回傳 null（銘謝惠顧），中了才從池子裡均等抽一款出來。
 */
export function drawBackgroundGachaResult(): ShopItem | null {
  if (Math.random() >= BACKGROUND_GACHA_WIN_RATE) return null;
  return drawRandomBackground();
}
