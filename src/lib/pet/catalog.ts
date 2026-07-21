/**
 * src/lib/pet/catalog.ts
 *
 * 小雞圖鑑（轉職／轉生收藏系統）
 * ------------------------------------------------------------
 * 規則（2026-07 改版，從「養到大師雞就整隻重置轉生」改成「轉職」）：
 *   - 小雞第一次長到 master（大師雞）階段後，玩家可以花飼料「轉職」：
 *     不影響成長階段（還是大師雞），只是 pet.currentAppearanceId
 *     依序換成圖鑑款式（小兵雞 → 砲兵雞 → 馬伕雞 → 戰車雞 → 巨象雞
 *     → 仕官雞 → 將軍雞 → 鳳凰雞），每轉職一次飼料費用就往上加一階
 *     （見 JOB_CHANGE_FOOD_COSTS），同時立刻解鎖對應的圖鑑款式
 *     （寫進 user.unlockedCatalogIds）。
 *   - 只有小雞當下處於 master 階段才能轉職（跟原本轉生的規則一樣）。
 *   - 轉到最後一款「鳳凰雞」之後，大師雞階段的按鈕會從「轉職」變回
 *     「轉生」：免費，點下去小雞才真的整隻重置回蛋（stage/xp/fullness/
 *     healthStatus 全部歸零、currentAppearanceId 歸零），同時
 *     user.rebirthCount + 1（這才是真正「轉生次數」的計數，圖鑑
 *     unlockedCatalogIds 不受影響，蒐集進度永久保留）。
 *   - 小雞死掉重新養：currentAppearanceId 歸零（職業重置），但
 *     unlockedCatalogIds（圖鑑蒐集紀錄）不會消失，也不算轉生
 *     （見 useGameStore.ts 的 resurrectPet）。
 *
 * 圖鑑款式以象棋棋子命名，呼應整個 App 的主題。圖片沿用既有的
 * /public/image/catalog/{id}.png（本來就是給圖鑑頁用的），轉職後
 * 小雞展示圖直接換成同一張，不需要另外準備新圖。
 */

export interface CatalogEntry {
  /** 唯一識別碼，同時也是圖片檔名（不含副檔名） */
  id: string;
  /** 圖鑑顯示名稱 */
  name: string;
  /** 圖鑑說明文字 */
  description: string;
  /** 第幾次轉職解鎖這一款（1-indexed，也是職業等級：1 = 小兵雞…8 = 鳳凰雞） */
  unlockAtJobLevel: number;
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
    description: "第一次轉職解鎖。象棋裡最前線的小兵，雖然渺小但勇往直前。",
    unlockAtJobLevel: 1,
    imagePath: "/image/catalog/pawn.png",
    fallbackEmoji: "🐤",
  },
  {
    id: "cannon",
    name: "炮兵雞",
    description: "第二次轉職解鎖。隔山打牛，攻擊力十足的砲兵造型。",
    unlockAtJobLevel: 2,
    imagePath: "/image/catalog/cannon.png",
    fallbackEmoji: "🐥",
  },
  {
    id: "horse",
    name: "馬伕雞",
    description: "第三次轉職解鎖。日字步法，靈活敏捷的馬伕造型。",
    unlockAtJobLevel: 3,
    imagePath: "/image/catalog/horse.png",
    fallbackEmoji: "🐔",
  },
  {
    id: "chariot",
    name: "戰車雞",
    description: "第四次轉職解鎖。橫衝直撞的戰車造型，氣勢驚人。",
    unlockAtJobLevel: 4,
    imagePath: "/image/catalog/chariot.png",
    fallbackEmoji: "🐓",
  },
  {
    id: "elephant",
    name: "巨象雞",
    description: "第五次轉職解鎖。穩重厚實的象棋造型。",
    unlockAtJobLevel: 5,
    imagePath: "/image/catalog/elephant.png",
    fallbackEmoji: "🐔",
  },
  {
    id: "advisor",
    name: "仕官雞",
    description: "第六次轉職解鎖。坐鎮中宮、寸步不離守護的仕官造型。",
    unlockAtJobLevel: 6,
    imagePath: "/image/catalog/advisor.png",
    fallbackEmoji: "🐓",
  },
  {
    id: "general",
    name: "將軍雞",
    description: "第七次轉職解鎖。一軍統帥，威風凜凜的將軍造型。",
    unlockAtJobLevel: 7,
    imagePath: "/image/catalog/general.png",
    fallbackEmoji: "🦃",
  },
  {
    id: "phoenix",
    name: "鳳凰雞",
    description: "第八次轉職解鎖。傳說中的隱藏款，集滿全部棋子化身後的究極進化。轉到這一款之後就能真正「轉生」了。",
    unlockAtJobLevel: 8,
    imagePath: "/image/catalog/phoenix.png",
    fallbackEmoji: "🦚",
  },
];

/**
 * 每次轉職要花的飼料，依序對應 CATALOG_ENTRIES（index 0 = 轉成小兵雞的花費，
 * 一路遞增到 index 7 = 轉成鳳凰雞的花費）。轉到鳳凰雞之後的「轉生」是
 * 免費的，不在這張表裡（見 useGameStore.ts 的 rebirthPet）。
 */
export const JOB_CHANGE_FOOD_COSTS: number[] = [300, 350, 400, 450, 500, 550, 600, 650];

/** 依目前的 currentAppearanceId 算出職業等級（0 = 還沒轉職過，1~8 對應圖鑑順序） */
export function getJobLevel(currentAppearanceId: string | null): number {
  if (!currentAppearanceId) return 0;
  const index = CATALOG_ENTRIES.findIndex((entry) => entry.id === currentAppearanceId);
  return index === -1 ? 0 : index + 1;
}

/** 依職業等級查出對應的圖鑑款式；超出範圍回傳 null */
export function getCatalogEntryForJobLevel(jobLevel: number): CatalogEntry | null {
  return CATALOG_ENTRIES.find((entry) => entry.unlockAtJobLevel === jobLevel) ?? null;
}

/** 依 id 查出圖鑑項目（給目前小雞外觀顯示用） */
export function getCatalogEntryById(id: string): CatalogEntry | null {
  return CATALOG_ENTRIES.find((entry) => entry.id === id) ?? null;
}

/** 依目前的 currentAppearanceId 算出「下一個」要轉職成的款式；已經是鳳凰雞（頂點）回傳 null */
export function getNextCatalogEntry(currentAppearanceId: string | null): CatalogEntry | null {
  const currentLevel = getJobLevel(currentAppearanceId);
  return getCatalogEntryForJobLevel(currentLevel + 1);
}

/** 依目前的 currentAppearanceId 算出「轉下一職」要花多少飼料；已經是鳳凰雞（該轉生了）回傳 null */
export function getNextJobChangeCost(currentAppearanceId: string | null): number | null {
  const currentLevel = getJobLevel(currentAppearanceId);
  if (currentLevel >= CATALOG_ENTRIES.length) return null;
  return JOB_CHANGE_FOOD_COSTS[currentLevel] ?? null;
}

/** 是否已經轉到最後一款（鳳凰雞），也就是可以「轉生」而不是「轉職」了 */
export function isMaxJobLevel(currentAppearanceId: string | null): boolean {
  return getJobLevel(currentAppearanceId) >= CATALOG_ENTRIES.length;
}
