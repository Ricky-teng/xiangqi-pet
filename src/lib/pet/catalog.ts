/**
 * src/lib/pet/catalog.ts
 *
 * 小雞圖鑑（轉生收藏系統）
 * ------------------------------------------------------------
 * UserDoc.rebirthCount / unlockedCatalogIds、PetDoc.currentAppearanceId
 * 這三個欄位從專案一開始就存在於型別定義裡，但從來沒有任何程式碼
 * 真正寫入或讀取過——本檔案把這個「圖鑑/轉生」機制實際接上。
 *
 * 規則：
 *   - 小雞長到 master（大師雞）階段後，玩家可以選擇「轉生」：
 *     小雞重新從蛋開始（stage/xp/fullness/healthStatus 全部重置），
 *     同時 user.rebirthCount + 1，並依新的轉生次數解鎖對應的圖鑑款式
 *     （寫進 user.unlockedCatalogIds，同時設成 pet.currentAppearanceId）。
 *   - 圖鑑款式以象棋棋子命名，呼應整個 App 的主題，依轉生次數依序解鎖
 *     （兵 → 炮 → 馬 → 車 → 象 → 仕 → 將，最後是隱藏款「鳳凰雞」）。
 *   - 全部解鎖完之後，再轉生只會重置小雞、不會再解鎖新款式
 *     （見 useGameStore.ts 的 rebirthPet）。
 */

export interface CatalogEntry {
  /** 唯一識別碼，同時也是圖片檔名（不含副檔名） */
  id: string;
  /** 圖鑑顯示名稱 */
  name: string;
  /** 圖鑑說明文字 */
  description: string;
  /** 第幾次轉生解鎖這一款（1-indexed） */
  unlockAtRebirthCount: number;
  /**
   * 圖片路徑：/public/image/catalog/{id}.png
   * 建議規格：512x512px、透明背景 PNG、Q版可愛風格，
   * 跟現有 emoji 小雞一樣走「圓潤、暖色系」路線。
   * 若圖片檔案不存在，畫面會自動退回顯示 emoji，不會壞掉
   * （見 src/app/catalog/page.tsx 的 CatalogImage 元件）。
   */
  imagePath: string;
  /** 圖片載入失敗時的備援 emoji */
  fallbackEmoji: string;
}

export const CATALOG_ENTRIES: CatalogEntry[] = [
  {
    id: "pawn",
    name: "小兵雞",
    description: "第一次轉生解鎖。象棋裡最前線的小兵，雖然渺小但勇往直前。",
    unlockAtRebirthCount: 1,
    imagePath: "/image/catalog/pawn.png",
    fallbackEmoji: "🐤",
  },
  {
    id: "cannon",
    name: "炮兵雞",
    description: "第二次轉生解鎖。隔山打牛，攻擊力十足的砲兵造型。",
    unlockAtRebirthCount: 2,
    imagePath: "/image/catalog/cannon.png",
    fallbackEmoji: "🐥",
  },
  {
    id: "horse",
    name: "馬伕雞",
    description: "第三次轉生解鎖。日字步法，靈活敏捷的馬伕造型。",
    unlockAtRebirthCount: 3,
    imagePath: "/image/catalog/horse.png",
    fallbackEmoji: "🐔",
  },
  {
    id: "chariot",
    name: "戰車雞",
    description: "第四次轉生解鎖。橫衝直撞的戰車造型，氣勢驚人。",
    unlockAtRebirthCount: 4,
    imagePath: "/image/catalog/chariot.png",
    fallbackEmoji: "🐓",
  },
  {
    id: "elephant",
    name: "巨象雞",
    description: "第五次轉生解鎖。穩重厚實的象棋造型。",
    unlockAtRebirthCount: 5,
    imagePath: "/image/catalog/elephant.png",
    fallbackEmoji: "🐔",
  },
  {
    id: "advisor",
    name: "仕官雞",
    description: "第六次轉生解鎖。坐鎮中宮、寸步不離守護的仕官造型。",
    unlockAtRebirthCount: 6,
    imagePath: "/image/catalog/advisor.png",
    fallbackEmoji: "🐓",
  },
  {
    id: "general",
    name: "將軍雞",
    description: "第七次轉生解鎖。一軍統帥，威風凜凜的將軍造型。",
    unlockAtRebirthCount: 7,
    imagePath: "/image/catalog/general.png",
    fallbackEmoji: "🦃",
  },
  {
    id: "phoenix",
    name: "鳳凰雞",
    description: "第八次轉生解鎖。傳說中的隱藏款，集滿全部棋子化身後的究極進化。",
    unlockAtRebirthCount: 8,
    imagePath: "/image/catalog/phoenix.png",
    fallbackEmoji: "🦚",
  },
];

/** 依轉生次數查出這次轉生對應解鎖的圖鑑款式；超出範圍（已蒐集全部）回傳 null */
export function getCatalogEntryForRebirthCount(rebirthCount: number): CatalogEntry | null {
  return CATALOG_ENTRIES.find((entry) => entry.unlockAtRebirthCount === rebirthCount) ?? null;
}

/** 依 id 查出圖鑑項目（給目前小雞外觀顯示用） */
export function getCatalogEntryById(id: string): CatalogEntry | null {
  return CATALOG_ENTRIES.find((entry) => entry.id === id) ?? null;
}
