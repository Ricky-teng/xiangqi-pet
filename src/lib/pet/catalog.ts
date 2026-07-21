/**
 * src/lib/pet/catalog.ts
 *
 * 小雞圖鑑（轉職／轉生收藏系統）
 * ------------------------------------------------------------
 * 規則（2026-07-21 三版，改成用「餵食累積 XP」取代一次付清）：
 *   - 小雞第一次長到 master（大師雞）階段後，繼續餵食（跟原本養成
 *     完全同一個動作：/feed 頁面拖拉餵食，10 飼料 +10 XP）會持續累積
 *     xp——master 階段本身沒有上限，xp 不會停在 730，會一直往上加。
 *   - 職業（pawn → cannon → horse → chariot → elephant → advisor →
 *     general → phoenix）依累計 xp 是否跨過對應門檻依序解鎖，門檻是
 *     「上一階門檻 + JOB_XP_COSTS[i]」累加上去的（見
 *     getCumulativeXpForJobLevel），JOB_XP_COSTS 的數字沿用原本談好
 *     的飼料費用表（300/350/.../650），只是現在的意義變成「這一階
 *     總共要多花多少 XP（＝多餵幾次）」，不是一次付清的價錢。
 *   - xp 跨過門檻後，大師雞卡片上的「轉職」按鈕才會真正可以按（按下去
 *     不用再另外扣飼料，因為費用已經在餵食的過程中，用一次次的 10
 *     飼料付掉了）。按下去立刻解鎖對應的圖鑑款式（寫進
 *     user.unlockedCatalogIds），currentAppearanceId 換成新職業。
 *   - 轉到最後一款「鳳凰雞」之後，大師雞階段的按鈕會從「轉職」變回
 *     「轉生」：免費，點下去小雞才真的整隻重置回蛋（stage/xp/fullness/
 *     healthStatus 全部歸零、currentAppearanceId 歸零），同時
 *     user.rebirthCount + 1（這才是真正「轉生次數」的計數，圖鑑
 *     unlockedCatalogIds 不受影響，蒐集進度永久保留）。
 *   - 小雞死掉重新養：stage/xp 回蛋歸零、currentAppearanceId 歸零
 *     （職業重置，連帶職業進度也一起歸零，因為進度就是算在 xp 上面），
 *     但 unlockedCatalogIds（圖鑑蒐集紀錄）不會消失，也不算轉生
 *     （見 useGameStore.ts 的 resurrectPet）。
 *
 * 圖鑑款式以象棋棋子命名，呼應整個 App 的主題。圖片沿用既有的
 * /public/image/catalog/{id}.png（本來就是給圖鑑頁用的），轉職後
 * 小雞展示圖直接換成同一張，不需要另外準備新圖。
 */

import { STAGE_XP_THRESHOLDS } from "@/lib/pet/petGrowth";

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
 * 每一階職業總共需要多花多少 XP（＝多餵幾次，1 XP = 1 次餵食的
 * 1/10，因為 feedPet 一次 +10 XP），依序對應 CATALOG_ENTRIES
 * （index 0 = 轉成小兵雞要多花的 XP，一路遞增到 index 7 = 轉成
 * 鳳凰雞要多花的 XP）。數字沿用原本談好的飼料費用表，只是現在
 * 不是一次付清，是靠餵食一點一點累積上去。轉到鳳凰雞之後的「轉生」
 * 是免費的，不在這張表裡（見 useGameStore.ts 的 rebirthPet）。
 */
export const JOB_XP_COSTS: number[] = [300, 350, 400, 450, 500, 550, 600, 650];

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

/** 是否已經轉到最後一款（鳳凰雞），也就是可以「轉生」而不是「轉職」了 */
export function isMaxJobLevel(currentAppearanceId: string | null): boolean {
  return getJobLevel(currentAppearanceId) >= CATALOG_ENTRIES.length;
}

/**
 * 算出「累計到第 jobLevel 階職業」總共需要多少累計 xp。
 * jobLevel = 0 就是剛好長到大師雞的門檻（沿用 petGrowth.ts 的
 * STAGE_XP_THRESHOLDS.master.to），之後每往上一階就把 JOB_XP_COSTS
 * 對應的數字疊加上去。
 */
export function getCumulativeXpForJobLevel(jobLevel: number): number {
  let total = STAGE_XP_THRESHOLDS.master.to;
  for (let i = 0; i < jobLevel; i++) {
    total += JOB_XP_COSTS[i] ?? 0;
  }
  return total;
}

/**
 * 算出目前這一階職業的 xp 區間（給進度條用）：from 是進入這一階時的
 * 累計 xp，to 是轉下一職需要跨過的累計 xp。已經是鳳凰雞（沒有下一階
 * 可以進度顯示）回傳 null。
 */
export function getJobXpRange(currentAppearanceId: string | null): { from: number; to: number } | null {
  const currentLevel = getJobLevel(currentAppearanceId);
  if (currentLevel >= CATALOG_ENTRIES.length) return null;
  return {
    from: getCumulativeXpForJobLevel(currentLevel),
    to: getCumulativeXpForJobLevel(currentLevel + 1),
  };
}

/**
 * 依目前累計 xp，算出距離轉下一職還差多少 xp（0 表示已經達標，
 * 可以按「轉職」了）。已經是鳳凰雞回傳 null。
 */
export function getXpNeededForNextJob(currentAppearanceId: string | null, xp: number): number | null {
  const range = getJobXpRange(currentAppearanceId);
  if (!range) return null;
  return Math.max(0, range.to - xp);
}

/**
 * 大師雞階段專用的「轉職進度條」百分比（0~100），給首頁/餵食頁的
 * XP 進度條在大師雞階段顯示用——大師雞的成長階段本身沒有進度可言
 * （STAGE_XP_THRESHOLDS.master 只是個固定的 700~730 區間，一旦
 * xp 超過 730 用那個算會永遠卡在 100%），所以改成算「這一階職業
 * 的累計 xp 進度」。已經轉到鳳凰雞（沒有下一階）回傳 100（滿格）。
 */
export function getMasterJobProgressPercent(currentAppearanceId: string | null, xp: number): number {
  const range = getJobXpRange(currentAppearanceId);
  if (!range) return 100;
  const into = Math.max(0, xp - range.from);
  const total = range.to - range.from;
  return total > 0 ? Math.min(100, (into / total) * 100) : 100;
}
