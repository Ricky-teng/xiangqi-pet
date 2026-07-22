/**
 * src/lib/shopItems.ts
 *
 * 商店道具靜態設定檔
 * 道具定義不存 Firestore，直接在前端維護，老師不需要後台管理。
 * 新增/修改道具只需改這個檔案。
 */

export type ItemCategory = "consumable" | "background" | "board_skin";

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
  /** 棋盤造型圖片路徑（只有 board_skin 類型才有；貼在棋盤木紋底色的
   * 位置，格線/棋子顏色不受影響，見 ChessBoard.tsx 的 boardSkinSrc prop） */
  boardSkinSrc?: string;
  /** 預覽顏色（背景圖載入前的佔位色） */
  previewColor?: string;
  /** 背景/棋盤造型的稀有度（只有 background、board_skin 才有；沒填視為 common） */
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
    description: "小雞死亡後使用，保留死前等級與 XP 原地復活，不重置回蛋；飽食度太低的話會補到安全線，不會復活瞬間又生病。",
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
  {
    id: "lotus_pavilion",
    category: "background",
    name: "蓮池水榭",
    description: "荷花池畔的古典涼亭，棋桌就擺在垂柳與蓮花之間。",
    icon: "🪷",
    price: 300,
    backgroundSrc: "/backgrounds/lotus_pavilion.jpg",
    previewColor: "#5B8C5A",
    rarity: "uncommon",
  },
  {
    id: "sunny_park",
    category: "background",
    name: "陽光綠徑",
    description: "陽光灑落的公園小徑，樹蔭下擺著一張棋桌。",
    icon: "🌳",
    price: 300,
    backgroundSrc: "/backgrounds/sunny_park.jpg",
    previewColor: "#5B8C5A",
    rarity: "uncommon",
  },
  {
    id: "sakura_school",
    category: "background",
    name: "櫻花校園",
    description: "櫻花盛開的校園步道，棋桌就在花瓣飄落的樹下。",
    icon: "🌸",
    price: 300,
    backgroundSrc: "/backgrounds/sakura_school.jpg",
    previewColor: "#F4A9C0",
    rarity: "rare",
  },
  {
    id: "misty_mountain",
    category: "background",
    name: "雲海仙山",
    description: "雲霧繚繞的山巔，小雞站在松樹旁俯瞰群峰。",
    icon: "⛰️",
    price: 300,
    backgroundSrc: "/backgrounds/misty_mountain.jpg",
    previewColor: "#8FA8C4",
    rarity: "legendary",
  },
  {
    id: "sailing_sea",
    category: "background",
    name: "碧海揚帆",
    description: "陽光普照的甲板上，棋盤跟小雞一起乘風破浪。",
    icon: "⛵",
    price: 300,
    backgroundSrc: "/backgrounds/sailing_sea.jpg",
    previewColor: "#2FA8D5",
    rarity: "epic",
  },

  // ---- 棋盤造型（獨立於背景之外的另一套抽獎池，見
  // BOARD_SKIN_GACHA_COST 等常數；圖片檔案還沒準備，先放檔名佔位，
  // 實際圖檔要放到 /public/board-skins/{id}.jpg，規格建議跟背景一樣：
  // 橫向、至少 1200px 寬，木紋/石紋/玉石紋這種「棋盤本體材質」特寫，
  // 不需要留白邊，棋盤本身的格線會直接疊在圖片上面。） ----
  {
    id: "classic_oak",
    category: "board_skin",
    name: "經典原木棋盤",
    description: "淺色橡木紋理，最耐看的基本款棋盤。",
    icon: "🪵",
    price: 300,
    boardSkinSrc: "/board-skins/classic_oak.jpg",
    previewColor: "#E8D5B5",
    rarity: "common",
  },
  {
    id: "dark_walnut",
    category: "board_skin",
    name: "胡桃深木棋盤",
    description: "深色胡桃木紋，沉穩大氣的高級感。",
    icon: "🟫",
    price: 300,
    boardSkinSrc: "/board-skins/dark_walnut.jpg",
    previewColor: "#6B4226",
    rarity: "uncommon",
  },
  {
    id: "bamboo_weave",
    category: "board_skin",
    name: "竹編棋盤",
    description: "手工竹編紋理，清爽自然的棋盤造型。",
    icon: "🎍",
    price: 300,
    boardSkinSrc: "/board-skins/bamboo_weave.jpg",
    previewColor: "#C7A96B",
    rarity: "uncommon",
  },
  {
    id: "jade_stone",
    category: "board_skin",
    name: "翡翠玉石棋盤",
    description: "溫潤翠綠的玉石紋理，價值連城的稀有造型。",
    icon: "💚",
    price: 300,
    boardSkinSrc: "/board-skins/jade_stone.jpg",
    previewColor: "#3A7D5C",
    rarity: "rare",
  },
  {
    id: "marble_white",
    category: "board_skin",
    name: "大理石棋盤",
    description: "純白大理石紋路，帶點金色紋脈的華麗質感。",
    icon: "🤍",
    price: 300,
    boardSkinSrc: "/board-skins/marble_white.jpg",
    previewColor: "#D8D2C4",
    rarity: "super_rare",
  },
  {
    id: "golden_bronze",
    category: "board_skin",
    name: "鎏金古銅棋盤",
    description: "古代青銅器質感，鑲著金色紋飾的傳說級棋盤。",
    icon: "🏆",
    price: 300,
    boardSkinSrc: "/board-skins/golden_bronze.jpg",
    previewColor: "#B8860B",
    rarity: "legendary",
  },
];

/** 取得單一道具資料 */
export function getShopItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === id);
}

/**
 * 依使用者目前選用的棋盤造型 ID，查出對應的圖片路徑，給
 * <ChessBoard boardSkinSrc={...} /> 用。找不到（沒選、id 不存在）
 * 回傳 null，ChessBoard 會自動退回預設木紋色。
 */
export function getActiveBoardSkinSrc(activeBoardSkin: string | null | undefined): string | null {
  if (!activeBoardSkin) return null;
  const item = SHOP_ITEMS.find((i) => i.category === "board_skin" && i.id === activeBoardSkin);
  return item?.boardSkinSrc ?? null;
}

/** 判斷用戶是否已解鎖某個背景 */
export function isBackgroundUnlocked(userId: string, itemId: string, unlockedIds: string[]): boolean {
  return unlockedIds.includes(itemId);
}

// ============================================================
// 背景抽獎（取代直接購買）
// ============================================================

/** 抽一次背景要花多少飼料 */
export const BACKGROUND_GACHA_COST = 10;

/** 十連抽優惠總價（比單抽 x10 便宜一點，是抽獎機常見的「整批優惠」） */
export const BACKGROUND_GACHA_TEN_COST = 90;

/** 抽中「任一款背景」的機率（其餘機率是銘謝惠顧，飼料照扣但沒有背景） */
export const BACKGROUND_GACHA_WIN_RATE = 0.25;

/** 抽獎池：目前就是全部的背景款式，中獎時機率均等 */
export function getBackgroundGachaPool(): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === "background");
}

/**
 * 依「稀有度權重」從指定池子中隨機抽出一款——背景抽獎、棋盤造型抽獎
 * 共用同一套演算法，只是池子不同。同稀有度的所有款式均分該稀有度的
 * 權重，所以同一級距內每款機率相等，但級距之間會照 RARITY_WEIGHTS
 * 的比例拉開差距。
 */
function drawRandomFromPool(pool: ShopItem[]): ShopItem {
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

/** 從抽獎池中依「稀有度權重」隨機抽出一款背景 */
export function drawRandomBackground(): ShopItem {
  return drawRandomFromPool(getBackgroundGachaPool());
}

/**
 * 完整抽一次的結果：先擲一次 BACKGROUND_GACHA_WIN_RATE 機率判斷有沒有中獎，
 * 沒中回傳 null（銘謝惠顧），中了才從池子裡均等抽一款出來。
 */
export function drawBackgroundGachaResult(): ShopItem | null {
  if (Math.random() >= BACKGROUND_GACHA_WIN_RATE) return null;
  return drawRandomBackground();
}

// ============================================================
// 棋盤造型抽獎（獨立於背景之外的另一套抽獎池，機制完全比照背景，
// 只是池子、費用常數各自獨立，飼料花費不互通）
// ============================================================

/** 抽一次棋盤造型要花多少飼料 */
export const BOARD_SKIN_GACHA_COST = 10;

/** 棋盤造型十連抽優惠總價 */
export const BOARD_SKIN_GACHA_TEN_COST = 90;

/** 抽中「任一款棋盤造型」的機率（其餘機率是銘謝惠顧） */
export const BOARD_SKIN_GACHA_WIN_RATE = 0.25;

/** 抽獎池：目前就是全部的棋盤造型款式 */
export function getBoardSkinGachaPool(): ShopItem[] {
  return SHOP_ITEMS.filter((item) => item.category === "board_skin");
}

/** 從抽獎池中依「稀有度權重」隨機抽出一款棋盤造型 */
export function drawRandomBoardSkin(): ShopItem {
  return drawRandomFromPool(getBoardSkinGachaPool());
}

/**
 * 完整抽一次的結果：先擲一次 BOARD_SKIN_GACHA_WIN_RATE 機率判斷有沒有
 * 中獎，沒中回傳 null（銘謝惠顧），中了才從池子裡均等抽一款出來。
 */
export function drawBoardSkinGachaResult(): ShopItem | null {
  if (Math.random() >= BOARD_SKIN_GACHA_WIN_RATE) return null;
  return drawRandomBoardSkin();
}
