/**
 * src/lib/shopItems.ts
 *
 * 商店道具靜態設定檔
 * 道具定義不存 Firestore，直接在前端維護，老師不需要後台管理。
 * 新增/修改道具只需改這個檔案。
 */

export type ItemCategory = "consumable" | "background";

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
    description: "使用後 2 小時內，所有解題與對弈的飼料獎勵變成兩倍。效果不可疊加。",
    icon: "🎟️",
    price: 500,
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

/** 從抽獎池中隨機抽出一款背景（均等機率，只在「有中獎」時呼叫） */
export function drawRandomBackground(): ShopItem {
  const pool = getBackgroundGachaPool();
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
}

/**
 * 完整抽一次的結果：先擲一次 BACKGROUND_GACHA_WIN_RATE 機率判斷有沒有中獎，
 * 沒中回傳 null（銘謝惠顧），中了才從池子裡均等抽一款出來。
 */
export function drawBackgroundGachaResult(): ShopItem | null {
  if (Math.random() >= BACKGROUND_GACHA_WIN_RATE) return null;
  return drawRandomBackground();
}
