/**
 * src/lib/badges/badges.ts
 *
 * 成就勳章系統
 * ------------------------------------------------------------
 * 跟圖鑑（轉職/轉生，見 @/lib/pet/catalog.ts）是兩套並存、互不影響的
 * 收藏系統：圖鑑是「養成向」（靠飼料/經驗值養出來的），勳章是
 * 「行為向」（做過某些事情就永久拿到，不會因為小雞死掉或轉生而消失）。
 * 勳章本質上是「長期任務」——完成條件除了拿到勳章本身，也會發一筆
 * 飼料獎勵（見 rewardFood 欄位跟 useGameStore.ts 的 checkAndAwardBadges）。
 *
 * 資料只存「拿到了哪些」：user.earnedBadgeIds（string[]）。判斷邏輯
 * 全部集中在這個檔案的 BADGES 陣列，用宣告式的 check(user) 函式描述
 * 「什麼條件算拿到」——之後要新增/調整勳章，只改這個檔案就好，
 * 不用動資料庫欄位、不用寫 migration。
 *
 * check(user) 的規則：
 *   - 純函式，只能讀 user，不能有副作用（不能寫資料庫、不能呼叫 API）
 *   - 回傳 true 代表「條件已經滿足，可以拿到這個勳章了」
 *   - 用 user 現有的欄位就能判斷的條件都可以放（stats、checkinHistory、
 *     rebirthCount、unlockedCatalogIds…），複雜的跨欄位條件也沒問題，
 *     邏輯全部包在 check 函式裡面即可
 *
 * 實際「檢查並發放」的動作在 @/stores/useGameStore.ts 的
 * checkAndAwardBadges()，目前掛在 checkin()、applyVsComputerResult()、
 * usePuzzleSolver.ts 解題成功、changeJob()/rebirthPet()、
 * applyBattleResult()（殘局作戰）、好友接受成功這幾個時機點呼叫。
 * 之後要在更多時機點檢查，照同樣的 pattern 在該動作完成後呼叫
 * checkAndAwardBadges() 就可以。
 */

import type { UserDoc } from "@/types/database";
import { CATALOG_ENTRIES } from "@/lib/pet/catalog";

export interface BadgeDefinition {
  /** 唯一識別碼，會存進 user.earnedBadgeIds */
  id: string;
  /** 顯示名稱 */
  name: string;
  /** 說明文字（達成條件的白話說明，也會在還沒拿到時當作提示） */
  description: string;
  /** 顯示用 emoji（沒有另外準備圖檔，先用 emoji 快速把架構跑通） */
  icon: string;
  /** 達成時發放的飼料獎勵（勳章本質上是長期任務，完成要給飼料） */
  rewardFood: number;
  /** 純函式：傳入目前的 user，回傳是否已經滿足拿到這個勳章的條件 */
  check: (user: UserDoc) => boolean;
}

/** 算「連續簽到天數」：跟 CheckinModal.tsx 裡的邏輯一致，從今天往回數，
 * 中斷就停止。獨立抽成函式，因為不只一個勳章可能會用到這個計算。 */
function getCheckinStreak(user: UserDoc): number {
  const history = new Set(user.checkinHistory ?? []);
  let streak = 0;
  const d = new Date();
  while (true) {
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (history.has(str)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export const BADGES: BadgeDefinition[] = [
  {
    id: "first_checkin",
    name: "初來乍到",
    description: "完成第一次簽到",
    icon: "📅",
    rewardFood: 50,
    check: (user) => (user.checkinHistory?.length ?? 0) >= 1,
  },
  {
    id: "checkin_streak_7",
    name: "七日不輟",
    description: "連續簽到 7 天",
    icon: "🔥",
    rewardFood: 70,
    check: (user) => getCheckinStreak(user) >= 7,
  },
  {
    id: "puzzle_solver_10",
    name: "小小棋士",
    description: "累計解開 10 道殘局題",
    icon: "🧩",
    rewardFood: 10,
    check: (user) => (user.stats.totalSolved ?? 0) >= 10,
  },
  {
    id: "first_vs_computer_win",
    name: "初戰告捷",
    description: "第一次在對弈電腦中獲勝",
    icon: "🤖",
    rewardFood: 50,
    check: (user) => (user.stats.vsComputerWins ?? 0) >= 1,
  },
  {
    id: "puzzle_solver_100",
    name: "棋藝漸長",
    description: "累計解開 100 道殘局題",
    icon: "📘",
    rewardFood: 100,
    check: (user) => (user.stats.totalSolved ?? 0) >= 100,
  },
  {
    id: "puzzle_solver_500",
    name: "棋壇新秀",
    description: "累計解開 500 道殘局題",
    icon: "📗",
    rewardFood: 500,
    check: (user) => (user.stats.totalSolved ?? 0) >= 500,
  },
  {
    id: "puzzle_solver_1000",
    name: "棋道宗師",
    description: "累計解開 1000 道殘局題",
    icon: "📕",
    rewardFood: 1000,
    check: (user) => (user.stats.totalSolved ?? 0) >= 1000,
  },
  {
    id: "first_friend",
    name: "以棋會友",
    description: "擁有 1 位好友",
    icon: "🤝",
    rewardFood: 100,
    check: (user) => (user.friends?.length ?? 0) >= 1,
  },
  {
    id: "catalog_complete",
    name: "集棋成癖",
    description: "集滿全部圖鑑款式",
    icon: "🏵️",
    rewardFood: 1000,
    check: (user) => (user.unlockedCatalogIds?.length ?? 0) >= CATALOG_ENTRIES.length,
  },
  {
    id: "first_battle",
    name: "沙場初試",
    description: "參加 1 次殘局作戰",
    icon: "⚔️",
    rewardFood: 50,
    check: (user) =>
      (user.stats.battleWins ?? 0) + (user.stats.battleLosses ?? 0) + (user.stats.battleDraws ?? 0) >= 1,
  },
  {
    id: "spender_1000",
    name: "揮金如土",
    description: "累計消費滿 1000 飼料",
    icon: "💰",
    rewardFood: 100,
    check: (user) => (user.totalFoodSpent ?? 0) >= 1000,
  },
];

/**
 * 純函式：依目前的 user 資料，算出「符合條件但還沒拿到」的勳章清單。
 * 不會做任何 IO，呼叫端（useGameStore.ts 的 checkAndAwardBadges）
 * 負責把結果寫回 Firestore、發放 rewardFood。
 */
export function findNewlyEarnedBadges(user: UserDoc): BadgeDefinition[] {
  const earned = new Set(user.earnedBadgeIds ?? []);
  return BADGES.filter((badge) => !earned.has(badge.id) && badge.check(user));
}

export function getBadgeById(id: string): BadgeDefinition | null {
  return BADGES.find((badge) => badge.id === id) ?? null;
}
