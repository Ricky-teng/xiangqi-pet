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

  // ---- 背景 ----
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
