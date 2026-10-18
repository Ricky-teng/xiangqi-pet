// src/types/rpg.ts

/**
 * RPG 擴充：Firestore 資料結構
 * ------------------------------------------------------------
 * 刻意獨立成一個檔案而不是塞進 database.ts——database.ts 已經很長，
 * 而這一整組型別（收藏小雞、裝備背包、探險進度、戰隊、賽季）是同一
 * 個功能的東西，放一起比較好維護。database.ts 只需要在 PetDoc 跟
 * UserDoc 上各加幾個欄位（見檔案最下方的說明）。
 *
 * Firestore 的兩個限制在這裡都有考慮到：
 *   1. 不能存巢狀陣列 → 所有陣列裡面放的都是物件或字串，不會有
 *      array of array
 *   2. 沒有欄位級安全規則 → 任何「不想讓對手看到」的東西都得放到
 *      另一個 collection。目前戰隊資料全部都是公開的（對手本來就
 *      看得到你的隊伍），所以沒有這個問題
 */

import type { EquipmentItem } from "@/lib/rpg/equipment";

// ============================================================
// 1. 收藏小雞
// ------------------------------------------------------------
// 路徑：users/{uid}/collectedPets/{petId}
//
// 開子集合而不是塞進 user 文件的陣列，因為收藏數量無上限，養久了
// 可能幾十上百隻，塞進 user 文件會讓每次讀使用者資料都拖一大包。
// 子集合可以分頁讀，而且戰隊對戰只需要讀對手「上場那 3 隻」。
// ============================================================

export interface CollectedPetDoc {
  /** 文件 id */
  id: string;
  /** 擁有者 */
  uid: string;

  /** 收藏時學生取的名字，之後不能改 */
  name: string;

  /**
   * 收藏當下的職業 id（對應 lib/pet/catalog.ts 的 CATALOG_ENTRIES）。
   * null 代表收藏時還沒轉職過，四項數值會吃 ×0.8 的未轉職懲罰。
   * 收藏後就定型，不會再變。
   */
  jobId: string | null;

  /** 收藏當下生過幾次大病（影響四項數值，每次 −1%、上限 −15%） */
  severeSickCount: number;

  /** 這一世總共養了幾天（收藏當下算好存起來，之後不會變） */
  daysRaised: number;

  /** 目前穿著的武器；null = 沒穿（沒穿就不能出戰） */
  weapon: EquipmentItem | null;
  /** 目前穿著的防具；null = 沒穿（可以不穿） */
  armor: EquipmentItem | null;

  /** 這隻的戰績，探險跟戰隊都會累加 */
  record: CollectedPetRecord;

  /** 收藏時間戳（ms），列表預設依這個由新到舊排 */
  collectedAt: number;
  updatedAt: number;
}

export interface CollectedPetRecord {
  /** 探險打過幾關（含失敗） */
  exploreStagesPlayed: number;
  /** 探險通關幾關 */
  exploreStagesCleared: number;
  /** 戰隊出場的勝場 */
  teamWins: number;
  /** 戰隊出場的敗場 */
  teamLosses: number;
}

export function createEmptyPetRecord(): CollectedPetRecord {
  return {
    exploreStagesPlayed: 0,
    exploreStagesCleared: 0,
    teamWins: 0,
    teamLosses: 0,
  };
}

// ============================================================
// 2. 探險進度
// ------------------------------------------------------------
// 路徑：users/{uid}/rpg/explore（固定 id 的單一文件）
//
// 放在子集合底下的固定文件而不是 user 文件，是因為探險進度會被
// 頻繁寫入（每打一關就寫），跟使用者主文件分開可以避免每次戰鬥
// 都讓所有訂閱 user 文件的畫面重新渲染。
// ============================================================

export interface ExploreProgressDoc {
  uid: string;

  /**
   * 已經通關過的關卡 key 清單（key 格式見 lib/rpg/monsters.ts 的
   * getStageKey，例如 "t3s7"）。用陣列而不是巢狀物件，因為
   * Firestore 的 arrayUnion 可以原子性地加入，不用先讀再寫。
   * 100 關滿破也才 100 個短字串，容量完全不是問題。
   */
  clearedStageKeys: string[];

  /** 目前解鎖到第幾座塔（1 ~ 10）。通關某塔第 10 關才會 +1 */
  unlockedTower: number;

  /** 累計擊敗幾隻 Boss（「屠龍者」勳章用） */
  bossDefeatedCount: number;

  /** 今天已經用掉幾次探險次數 */
  dailyAttemptsUsed: number;
  /** dailyAttemptsUsed 是哪一天的（台北時間 YYYY-MM-DD） */
  dailyAttemptsDate: string;

  /**
   * 今天用掉幾次「重打掉落名額」（贏了已通關的關卡才算），每天前 10 次
   * 才有機會掉寶石跟裝備，見 lib/rpg/loot.ts。跟 dailyAttemptsUsed
   * 同一天重置（共用 dailyAttemptsDate）。
   */
  dailyReplayLootUsed: number;

  updatedAt: number;
}

export function createDefaultExploreProgress(uid: string, now: number, taipeiDate: string): ExploreProgressDoc {
  return {
    uid,
    clearedStageKeys: [],
    unlockedTower: 1,
    bossDefeatedCount: 0,
    dailyAttemptsUsed: 0,
    dailyAttemptsDate: taipeiDate,
    dailyReplayLootUsed: 0,
    updatedAt: now,
  };
}

// ============================================================
// 3. 戰隊
// ------------------------------------------------------------
// 路徑：teams/{uid}（一個學生一個戰隊，直接用 uid 當文件 id）
//
// 獨立成 top-level collection 的原因：排行榜要「依積分排序、取前 50」，
// 這種跨使用者的查詢沒辦法對子集合做（collectionGroup 查詢雖然可以，
// 但規則寫起來麻煩很多）。
//
// 這個 collection 的內容全部是公開可讀的——對手本來就看得到你的隊伍。
// ============================================================

export interface TeamDoc {
  /** 文件 id = 擁有者 uid */
  uid: string;
  /** 冗餘存一份學生名字，排行榜才不用再去讀 users 文件 */
  ownerName: string;

  /** 隊名。第一次進戰隊頁強制取名，所以不會是空字串 */
  teamName: string;

  /**
   * 上場的 3 隻。存的是「來源指標」而不是數值快照——因為被挑戰時
   * 要用對方的「即時狀態」，包含他剛換的裝備、剛轉的職。
   */
  members: TeamMemberRef[];

  /** 目前賽季積分 */
  score: number;
  /** 這個積分屬於哪一季（格式見 lib/rpg/teamScore.ts 的 getSeasonId） */
  seasonId: string;

  /** 上一季的最終排名，第一季或上季沒參加是 null（沒有進步獎） */
  previousSeasonRank: number | null;

  /** 這一季改過幾次隊名（一季只能改一次；第一次取名不算） */
  renameCountThisSeason: number;

  /** 賽季內的戰績 */
  wins: number;
  losses: number;
  /** 目前連勝（「五連勝」勳章用），輸一場歸零 */
  winStreak: number;
  /** 這一季最高連勝 */
  bestWinStreak: number;

  /** 今天已經挑戰幾次 */
  dailyAttemptsUsed: number;
  /** dailyAttemptsUsed 是哪一天的（台北時間 YYYY-MM-DD） */
  dailyAttemptsDate: string;

  /**
   * 冗餘存一份總戰力，排行榜直接讀這個欄位顯示，不用為了畫一列
   * 榜單就去讀對方的 3 隻收藏小雞。換裝備、換隊員時一起更新。
   * 真正對戰時仍然是即時重算，不看這個欄位。
   */
  totalPower: number;

  createdAt: number;
  updatedAt: number;
}

export interface TeamMemberRef {
  /**
   * "collected" = 收藏小雞（讀 users/{uid}/collectedPets/{petId}）
   * "living"    = 目前正在養的那隻（讀 pets/{uid}）
   */
  source: "collected" | "living";
  /** source 是 collected 時才有值，指向 collectedPets 的文件 id */
  petId: string | null;
  /** 站位 0 ~ 2，決定 melee 戰鬥時面對誰 */
  slot: number;
}

// ============================================================
// 4. 賽季結算
// ------------------------------------------------------------
// 路徑：seasons/{seasonId}
//
// 每月 1 號的 cron 跑完結算之後寫一份，用途有二：
//   1. 當成「這一季已經結算過了」的旗標，避免 cron 重跑時重複發獎
//   2. 保留名次歷史，下一季算進步獎時要用
// ============================================================

export interface SeasonDoc {
  /** 文件 id，格式 "2026-09" */
  seasonId: string;
  /** 結算完成的時間戳 */
  settledAt: number;
  /** 這一季的最終排名（依序，只存有積分的隊伍） */
  finalRanking: SeasonRankEntry[];
}

export interface SeasonRankEntry {
  uid: string;
  teamName: string;
  ownerName: string;
  score: number;
  rank: number;
  /** 這一季實際發出去的飼料（前三名獎 + 進步獎） */
  rewardFood: number;
}

// ============================================================
// 5. 待通知的獎勵
// ------------------------------------------------------------
// 路徑：users/{uid}/pendingNotices/{noticeId}
//
// 沿用投稿審核結果那一套：cron 在半夜結算完直接把飼料入帳，同時寫
// 一筆待通知，學生下次開 App 時彈窗告知、看完就刪掉。
// ============================================================

export interface SeasonRewardNoticeDoc {
  id: string;
  type: "season_reward";
  seasonId: string;
  rank: number;
  previousRank: number | null;
  topReward: number;
  improvementReward: number;
  totalReward: number;
  createdAt: number;
}

// ============================================================
// 6. database.ts 需要補的欄位
// ------------------------------------------------------------
// 這一段只是說明，實際欄位要加在 src/types/database.ts 上。
//
// PetDoc 新增兩個欄位（都是選填，舊資料不會壞）：
//
//   /** 這一世生過幾次大病。死掉復活或轉生重來時歸零。 */
//   severeSickCount?: number;
//
//   /** 這一世是什麼時候開始的（ms）。收藏時用來算「養了幾天」。 */
//   lifeStartedAt?: number;
//
// UserDoc 新增四個欄位（都是選填）：
//
//   /** 裝備背包。穿在小雞身上的不在這裡面。 */
//   equipmentBag?: EquipmentItem[];
//
//   /** 背包擴充過幾次（每次 +20 格，無上限）。 */
//   bagExpandCount?: number;
//
//   /** 收藏小雞總數（排行榜用，避免為了排名去 count 子集合）。 */
//   collectedPetCount?: number;
//
//   /** 是否看過 RPG 上線公告（判斷式沿用 hasSeenJobChangeAnnouncement 那一套）。 */
//   hasSeenRpgAnnouncement?: boolean;
//
// ============================================================
