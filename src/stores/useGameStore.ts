// src/stores/useGameStore.ts
import { create } from "zustand";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserDoc, PetDoc, DailyTaskDoc } from "@/types/database";
import { resolveStageForXp } from "@/lib/pet/petGrowth";
import { LOW_FULLNESS_THRESHOLD as SICKNESS_CURE_MIN_FULLNESS, getPoopCount, PET_CLEAN_BASE_COST } from "@/lib/pet/petDecay";
import { CATALOG_ENTRIES, getNextCatalogEntry, getXpNeededForNextJob, isMaxJobLevel } from "@/lib/pet/catalog";
import { getTodayDateString, getTodaysCompletedTaskIds } from "@/lib/tasks/dailyTasks";
import { createCollectedPet, fetchCollectedPets, getDaysRaised, validatePetName } from "@/lib/collectedPets";
import type { CollectedPetDoc } from "@/types/rpg";
import {
  BAG_EXPAND_COST,
  BAG_EXPAND_SLOTS,
  EQUIPMENT_SHOP_PRICE,
  EQUIPMENT_SHOP_TIER,
  KIND_LABELS,
  SHOP_TYPE_BY_KIND,
  autoFuse,
  canFitInBag,
  checkFuse,
  createEquipmentItem,
  fuseEquipment,
  getBagCapacity,
  getEquipmentName,
  hasFreeSocket,
  socketGem,
  unsocketGem,
  type EquipmentItem,
  type EquipmentKind,
} from "@/lib/rpg/equipment";
import { GEM_TABLE, addGemsToBag, getGemCount, type GemId } from "@/lib/rpg/gems";
import { addCollectedPetRecord, updateCollectedPetEquipment } from "@/lib/collectedPets";
import {
  applyStageResult,
  fetchExploreProgress,
  isTowerCleared,
  normalizeDailyAttempts,
  saveExploreProgress,
} from "@/lib/exploreProgress";
import { TOWER_COUNT } from "@/lib/rpg/monsters";
import { getTaipeiDateString } from "@/lib/server/serverDate";
import type { ExploreProgressDoc, TeamDoc } from "@/types/rpg";
import {
  createDefaultTeam,
  fetchTeam,
  normalizeTeam,
  patchTeam,
  saveTeam,
  toMemberRefs,
  validateTeamName,
} from "@/lib/teams";
import { TEAM_MAX_MEMBERS, getScoreChange } from "@/lib/rpg/teamScore";
import { getTotalPower } from "@/lib/rpg/stats";
import type { DeployablePet } from "@/lib/rpg/deploy";
import { applyChessLevelPoints, getChessRankLabel, getVsComputerWinPoints } from "@/lib/chessRank";
import {
  calculateWinRewardFood,
  LOSE_PENALTY_FOOD,
  DRAW_REWARD_FOOD,
  type ComputerLevel,
} from "@/lib/engine/computerPlayer";
import {
  BACKGROUND_GACHA_COST,
  BACKGROUND_GACHA_TEN_COST,
  drawBackgroundGachaResult,
  BOARD_SKIN_GACHA_COST,
  BOARD_SKIN_GACHA_TEN_COST,
  drawBoardSkinGachaResult,
  type ItemCategory,
} from "@/lib/shopItems";
import { getBadgeById, type BadgeDefinition } from "@/lib/badges/badges";
import {
  PASTURE_ENTRY_FEE,
  PASTURE_HOURLY_INCOME,
  PASTURE_DAILY_INCOME_CAP,
  PASTURE_BUG_CATCH_REWARD_FOOD,
  PASTURE_BUG_CATCH_DAILY_LIMIT,
  PASTURE_PAT_DAILY_LIMIT,
  PASTURE_EMOJI_DAILY_LIMIT,
} from "@/lib/pasture";

// 定義我們遊戲總機裡面有哪些資料與開關
/**
 * 一件裝備「在哪裡」：背包裡、穿在某隻收藏小雞身上、或穿在正在養的那隻身上。
 * 鑲寶石、拆寶石都要先知道裝備在哪，才知道要寫回哪一份 Firestore 文件。
 */
export type EquipmentTarget =
  | { where: "bag"; itemId: string }
  | { where: "pet"; petId: string; slot: "weapon" | "armor" }
  | { where: "living"; slot: "weapon" | "armor" };

interface GameStoreState {
  // 核心狀態
  user: UserDoc | null;
  pet: PetDoc | null;
  isLoading: boolean;

  /**
   * 收藏小雞（RPG 擴充）。資料實際存在
   * users/{uid}/collectedPets 子集合，這裡是快取。
   *
   * 刻意「不」在開 App 時就載入——大部分頁面根本用不到，而且數量
   * 無上限。由需要的頁面（我的小雞、戰隊編隊、探險準備頁）自己
   * 呼叫 loadCollectedPets()，載過一次之後就留在 store 裡共用。
   */
  collectedPets: CollectedPetDoc[];
  /** 是否已經載入過收藏小雞（區分「還沒載」跟「載過但是空的」） */
  collectedPetsLoaded: boolean;

  // 修改資料的動作（Actions）
  setUser: (user: UserDoc | null) => void;
  setPet: (pet: PetDoc | null) => void;
  setLoading: (isLoading: boolean) => void;

  /**
   * 載入收藏小雞。預設只在還沒載過時才真的去讀 Firestore；
   * 傳 force = true 可以強制重讀（例如換完裝備要刷新）。
   */
  loadCollectedPets: (force?: boolean) => Promise<void>;

  /** 就地更新一隻收藏小雞的快取（換裝備後不用整包重讀） */
  updateCollectedPetInStore: (petId: string, patch: Partial<CollectedPetDoc>) => void;

  /**
   * 全域「小雞狀態警示」訊息（例如：太久沒醫治，病情加重了）。
   * 由 usePetTimeDecayTicker 在偵測到時間流逝造成的狀態變化時設定，
   * <PetAlertBanner> 元件（掛在 AuthProvider 裡，全站都會顯示）負責呈現。
   */
  petAlertMessage: string | null;
  setPetAlertMessage: (message: string | null) => void;

  /**
   * 即時天氣（見 lib/weather.ts），純前端記憶體狀態，不寫進
   * Firestore、也不跟著使用者帳號走——只是給 GlobalRainOverlay 之類
   * 的全站特效讀取用，重新整理頁面就會重新抓一次。
   */
  weather: import("@/lib/weather").WeatherSnapshot | null;
  setWeather: (weather: import("@/lib/weather").WeatherSnapshot | null) => void;

  /**
   * 剛剛升段、還沒播過慶祝動畫的資料。由 addChessLevelPoints 在真的
   * 升級時寫入，全站共用的 <RankUpCelebration /> 監看到就跳出滿版慶祝
   * 頁，關掉後設回 null。
   *
   * 為什麼放在 store 而不是各頁面自己處理：addChessLevelPoints 是所有
   * 升段的唯一入口（解題、贏電腦、殘局對戰、配對對弈都經過它），寫在
   * 這裡就自動涵蓋全部來源——原本對戰勝利升段完全沒有任何提示，就是因為
   * 那兩頁沒有各自接升級 UI。
   */
  pendingRankUp: {
    /** 升級後的段位名稱，例如「七級」 */
    newRankLabel: string;
    /** 升級前的段位名稱，用來顯示「八級 → 七級」的變化 */
    previousRankLabel: string;
    newLevel: number;
    /** 這次一口氣升了幾級（挑戰高難度題目有可能連跳） */
    levelsGained: number;
  } | null;
  clearPendingRankUp: () => void;
  
  // 學生本地即時互動邏輯（在寫入 Firebase 之前，前端畫面先動）
  feedPet: () => void;

  /**
   * 清理小雞旁邊的垃圾/大便：把 pet.lastCleanedTime 重設成現在，重新
   * 開始算垃圾累積（見 lib/pet/petDecay.ts 的 getPoopCount）。費用是
   * 「今天第 N 次清理 = N × PET_CLEAN_BASE_COST」，每天 00:00 重置。
   * 只是清理環境，不會治好已經在生的病——生病了還是要買藥水醫治。
   */
  cleanPetMess: () => { success: boolean; message: string; cost: number };
  buyMedicine: (type: "slightly" | "severely") => { success: boolean; message: string };
  /**
   * 觸發小雞生病（連續答錯 3 次時呼叫）。
   * 接收 puzzleId/wrongCount，在同一次 set() 裡把 healthStatus、
   * sickStartTime、currentWrongPuzzleId、consecutiveWrongCount
   * 一次性原子更新完，避免呼叫端先呼叫這個函式、又緊接著用「呼叫前
   * 捕捉到的舊 pet 物件」再呼叫一次 setPet，把這裡剛設好的生病狀態蓋掉
   * （這正是先前「生小病不會在主頁改變狀態」那個 bug 的根因）。
   */
  triggerSickness: (puzzleId: string, wrongCount: number) => void;

  /**
   * 轉職：小雞必須在 master（大師雞）階段才能呼叫。不是「按一下扣一
   * 大筆飼料」，是要靠持續餵食（跟原本養成同一個動作）累積 xp，
   * 累計 xp 跨過門檻（費用依目前職業等級遞增，見 @/lib/pet/catalog.ts
   * 的 JOB_XP_COSTS）才能真的轉職成功。按下去把 pet.currentAppearanceId
   * 換成圖鑑序列裡的下一款，同時立刻解鎖該款圖鑑；成長階段/xp 不會
   * 重置，職業進度是疊在同一條累計 xp 上面連續往上算。
   * 如果已經是最後一款（鳳凰雞），呼叫這個會失敗，請改呼叫 rebirthPet。
   */
  changeJob: () => { success: boolean; message: string };

  /**
   * 收藏（RPG 擴充，取代原本的「轉生」）。
   *
   * 小雞只要長到 master（大師雞）階段就可以收藏，**不需要**先轉職到
   * 鳳凰雞——這跟舊的轉生規則不一樣，是刻意放寬的：收藏後就定型，
   * 學生自己決定要現在收（拿一隻弱一點的）還是繼續養、轉職到更好的
   * 職業再收。
   *
   * 收藏會做三件事：
   *   1. 依「收藏當下的職業 + 生過幾次大病 + 養了幾天」寫一筆
   *      CollectedPetDoc 到 users/{uid}/collectedPets
   *   2. 把目前這隻小雞重置回蛋（等於馬上拿到一顆新蛋）
   *   3. UserDoc.collectedPetCount + 1（排行榜用）
   *
   * 是 async 的（要等 Firestore 寫完才知道成功與否），跟其他同步的
   * store action 不一樣——因為收藏是不可逆的，不能樂觀更新完才發現
   * 寫失敗、結果小雞歸零了但收藏沒存到。
   *
   * @param name 學生取的名字，收藏後不能改
   */
  collectPet: (name: string) => Promise<{ success: boolean; message: string }>;

  /**
   * 復活：小雞必須在 dead（死亡）狀態才能呼叫，跟「轉生」是兩個不同的
   * 機制——轉生是「養到大師雞、主動選擇重來」的成就型獎勵（會解鎖圖鑑）；
   * 復活是「沒照顧好、小雞死掉了」的補救措施，純粹讓小雞重新從蛋開始，
   * 不會解鎖圖鑑款式、不會增加 rebirthCount。職業（currentAppearanceId）
   * 會歸零重新累積，但已解鎖的圖鑑蒐集紀錄不會消失。需要花費飼料。
   */
  resurrectPet: () => { success: boolean; message: string };

  /**
   * 領取每日任務獎勵。任務定義現在存在 Firestore（DailyTaskDoc），
   * 由呼叫端（tasks/page.tsx）先用 getDocs 抓到完整任務物件後傳進來，
   * 這裡不再自己查表，只負責「能不能領、領了之後怎麼更新資料」這層邏輯。
   * 同一個任務同一天只能領一次，跨天后會重置。
   */
  claimDailyTask: (task: DailyTaskDoc) => { success: boolean; message: string };

  /** 簽到：今天沒簽過才能簽，push 日期到 checkinHistory，並同時標記所有簽到類型的任務完成並發飼料 */
  checkin: (checkinTaskIds?: string[], checkinTaskRewards?: number[]) => { success: boolean; message: string; alreadyDone: boolean };

  /**
   * 成就勳章：檢查目前的 user 資料，把新符合條件的勳章加進
   * earnedBadgeIds、寫回 Firestore，回傳「這次新拿到的勳章」清單
   * （給呼叫端顯示慶祝提示用；沒有新拿到就回傳空陣列）。
   * 勳章定義在 @/lib/badges/badges.ts，這裡只負責「檢查+發放+存檔」
   * 這個機制本身。掛在哪些動作完成後呼叫，見該檔案開頭的說明。
   */
  /**
   * 手動領取一個勳章的獎勵。只有「條件已達成（badge.check(user) 為
   * true）且還沒領過」才能領——領了才會真的發 rewardFood、把 badgeId
   * 加進 earnedBadgeIds。勳章定義在 @/lib/badges/badges.ts。
   */
  claimBadge: (badgeId: string) => { success: boolean; message: string };

  /**
   * 領取「轉生機制改版補償」飼料，只能領一次（見
   * hasClaimedResetCompensation）。金額算法：累計解題數(stats.totalSolved)
   * × 10，超過 1000 題的人直接給 5000（封頂，同時也不用讓玩家反推出
   * 「解題數 x10」這個換算規則）。
   */
  claimResetCompensation: () => { success: boolean; message: string; amount: number };

  /** 取得今天對弈電腦的局數（跨天自動歸零） */
  getDailyVsComputerCount: () => number;

  /**
   * 對弈電腦結束後，依結果（贏/輸/和）跟「對手等級 vs 學生自己等級」的
   * 差距結算飼料獎懲，並更新 foodCount。見
   * @/lib/engine/computerPlayer.ts 的 calculateWinRewardFood。
   */
  applyVsComputerResult: (
    outcome: "win" | "lose" | "draw",
    opponentLevel: ComputerLevel
  ) => { success: boolean; message: string; foodDelta: number };

  /**
   * 每日救助金：當天飼料低於 50 時發放一次 50 飼料。
   * 首頁載入時呼叫，同一天第二次呼叫時什麼都不做。
   * 回傳 granted=true 代表這次真的發放了，可以顯示提示給學生。
   */
  claimDailyGrant: () => { granted: boolean };

  /**
   * 付費入場牧場：使用者在牧場規則說明頁按下「付費入場」才會呼叫，
   * 不會自動觸發。今天已經付過的話直接回傳 alreadyPaid=true（防呆，
   * 正常 UI 流程不會讓已入場的人再看到這顆按鈕）。成功入場會把被動
   * 收入計時器歸零、從這一刻開始起算。
   */
  payPastureEntry: () => { success: boolean; message: string; alreadyPaid: boolean };

  /**
   * 結算牧場被動收入：只有「今天已經付過入場費」才有效，算「距離上次
   * 結算過了幾個整小時 × PASTURE_HOURLY_INCOME」，封頂
   * PASTURE_DAILY_INCOME_CAP。進牧場頁面、確認已入場後呼叫一次即可，
   * 同一小時內重複呼叫不會重複發放。
   */
  claimPastureIncome: () => { incomeGained: number; incomeClaimedToday: number };

  /**
   * 加棋力積分並結算升級（見 lib/chessRank.ts）。解題／贏電腦／贏對戰
   * 三個地方共用這一個入口，避免升級邏輯散落在各處。
   * 回傳 levelsGained > 0 代表這次有升級，呼叫端可以據此顯示升級慶祝。
   */
  addChessLevelPoints: (points: number) => { levelsGained: number; newLevel: number; newRankLabel: string };

  /**
   * 牧場互動當天進度（拍拍或送表情都算，見
   * UserDoc.dailyPastureInteractProgress），給 /tasks 頁面顯示進度、
   * 給 claimDailyTask 驗證 pasture_interact 任務用。
   */
  getDailyPastureInteractCount: () => number;

  /** 當天已投稿幾題殘局（給 /tasks 顯示進度、claimDailyTask 驗證用）。
   *  進度由伺服器端的 /api/puzzle/submit 寫入，這裡只負責讀。 */
  getDailyPuzzleSubmitCount: () => number;
  /** 今天探險了幾次（每日任務 explore 用） */
  getDailyExploreCount: () => number;
  /** 今天戰隊挑戰了幾次（每日任務 team_battle 用） */
  getDailyTeamBattleCount: () => number;

  /**
   * 記錄一次牧場互動（拍拍 / 送表情共用這個 function，用 kind 區分）。
   * targetUid 是自己的話直接擋掉（allowed=false, reason="self"）——
   * 拍自己的小雞毫無意義，不該被允許。拍拍每天限 1 次、送表情每天
   * 限 5 次（不分對象，是總次數），超過上限一樣 allowed=false。
   */
  recordPastureInteraction: (
    targetUid: string,
    kind: "pat" | "emoji"
  ) => { allowed: boolean; isNewChicken: boolean; remaining: number; reason?: "self" | "limit_reached" };

  /**
   * 找蟲子小遊戲：抓到一隻蟲。當天次數達到 PASTURE_BUG_CATCH_DAILY_LIMIT
   * 就不會再發飼料（success=false），前端可以照樣播放抓蟲動畫，只是
   * 不會再增加飼料。
   */
  catchPastureBug: () => { success: boolean; foodGained: number; remainingToday: number };

  /** 購買消耗道具（背景、棋盤造型都改為抽獎取得，不再走這個函式） */
  buyShopItem: (itemId: string, price: number, category: ItemCategory) => { success: boolean; message: string };

  /**
   * 抽一次背景（花費 BACKGROUND_GACHA_COST 飼料）。
   * 抽到已擁有的背景時全額退還飼料（等於沒扣錢），抽到新的則加入 unlockedBackgrounds。
   */
  drawBackgroundGacha: () => { success: boolean; message: string; itemId?: string; isDuplicate?: boolean };

  /**
   * 十連抽：一次抽 10 次，邏輯跟單抽完全一樣（各自獨立判定機率、
   * 各自可能重複退還），只是合併成一次 Firestore 寫入（不是連續呼叫
   * 10 次 drawBackgroundGacha，那樣會產生 10 次網路請求，沒必要）。
   */
  drawBackgroundGachaTen: () => {
    success: boolean;
    message: string;
    results: { itemId: string | null; isDuplicate: boolean }[];
  };

  /**
   * 棋盤造型抽獎：機制跟背景抽獎完全一樣（見上面兩個函式），只是
   * 獨立的一套池子（unlockedBoardSkins），飼料花費也各自獨立算，
   * 不會互相影響。
   */
  drawBoardSkinGacha: () => { success: boolean; message: string; itemId?: string; isDuplicate?: boolean };
  drawBoardSkinGachaTen: () => {
    success: boolean;
    message: string;
    results: { itemId: string | null; isDuplicate: boolean }[];
  };

  /** 使用消耗道具（雙倍券/復活藥水/飽食護盾） */
  useItem: (itemId: string) => { success: boolean; message: string };

  /** 切換使用中的背景 */
  setActiveBackground: (backgroundId: string | null) => void;

  /** 切換使用中的棋盤造型 */
  setActiveBoardSkin: (boardSkinId: string | null) => void;

  /** 取得目前雙倍飼料券是否有效 */
  isDoubleRewardActive: () => boolean;

  // ============================================================
  // RPG 擴充：裝備
  // ------------------------------------------------------------
  // 背包（UserDoc.equipmentBag）是一個陣列，穿在小雞身上的裝備
  // 「不在」裡面——換裝備就是在「背包陣列」跟「收藏小雞的欄位」
  // 之間搬移同一個物件。這樣同一件裝備永遠只存在一個地方，不會
  // 出現「背包裡有一把、小雞身上也有一把」的複製 bug。
  // ============================================================

  /** 買一件第 1 階裝備（武器或防具），各 100 飼料 */
  buyEquipment: (kind: EquipmentKind) => { success: boolean; message: string };

  /** 花 1000 飼料把背包 +20 格（無上限） */
  expandBag: () => { success: boolean; message: string };

  /**
   * 手動合成：挑 3 件同階同類型，合成 1 件高一階的。
   * 傳的是背包裡的 item id。
   */
  fuseEquipmentItems: (itemIds: string[]) => { success: boolean; message: string };

  /**
   * 一鍵合成：從第 1 階往上，只要湊滿 3 件就合，一路合到底。
   * 呼叫端應該先用 lib/rpg/equipment.ts 的 autoFuse 算一次結果給
   * 使用者看確認頁，按下確定才呼叫這個。
   */
  autoFuseBag: () => { success: boolean; message: string };

  /**
   * 換裝備。把 item 從背包穿到某隻收藏小雞身上；該格原本穿的那件
   * 會回到背包。item 傳 null 代表卸下。
   *
   * 是 async 的，因為要等 Firestore 寫完——換裝備會同時動到
   * users/{uid}（背包）跟 users/{uid}/collectedPets/{petId}（裝備欄），
   * 兩邊不同步的話會讓裝備憑空消失或複製。
   */
  equipToPet: (
    petId: string,
    slot: "weapon" | "armor",
    item: EquipmentItem | null,
  ) => Promise<{ success: boolean; message: string }>;

  /**
   * 鑲寶石：從寶石袋拿一顆鑲進某件裝備的空孔。
   * 那件裝備可以在背包裡、穿在收藏小雞身上、或穿在正在養的那隻身上。
   */
  socketGemInto: (target: EquipmentTarget, gem: GemId) => Promise<{ success: boolean; message: string }>;

  /** 拆寶石：把某件裝備第 index 顆寶石拆下來放回寶石袋（免費） */
  unsocketGemFrom: (target: EquipmentTarget, index: number) => Promise<{ success: boolean; message: string }>;

  /**
   * 幫「目前正在養的那一隻」換裝備。規則跟 equipToPet 完全一樣，
   * 只是對象是 pets/{uid} 這份文件而不是收藏小雞的子集合。
   *
   * 正在養的那隻也能出戰（探險、戰隊），而出戰必須有武器，所以牠
   * 也需要裝備欄。收藏時這兩件會一起被帶進收藏小雞裡。
   */
  equipToLivingPet: (
    slot: "weapon" | "armor",
    item: EquipmentItem | null,
  ) => Promise<{ success: boolean; message: string }>;

  // ============================================================
  // RPG 擴充：探險
  // ============================================================

  /** 探險進度（10 塔 × 10 關打到哪、今天用掉幾次） */
  exploreProgress: ExploreProgressDoc | null;
  exploreProgressLoaded: boolean;

  /** 載入探險進度。預設只在還沒載過時才讀，force = true 強制重讀 */
  loadExploreProgress: (force?: boolean) => Promise<void>;

  /**
   * 打完一關之後結算：寫進度、發掉落物、累加那隻小雞的戰績。
   *
   * @param consumedAttempt 這一場有沒有扣每日次數（重打已通關的關卡不扣）
   * @param drops           掉落的裝備（呼叫端先用 lib/rpg/loot.ts 的 rollStageLoot 算好），沒有就傳空陣列
   * @param gemDrops        掉落的寶石
   * @param usedReplayLoot  這一場有沒有用掉一次「重打掉落名額」
   * @param petId           出戰的收藏小雞 id；派的是「正在養的那隻」就傳 null
   */
  finishExploreStage: (args: {
    tower: number;
    stage: number;
    won: boolean;
    consumedAttempt: boolean;
    drops: EquipmentItem[];
    gemDrops: GemId[];
    usedReplayLoot: boolean;
    petId: string | null;
  }) => Promise<{ droppedCount: number; bagWasFull: boolean }>;

  // ============================================================
  // RPG 擴充：戰隊
  // ============================================================

  /** 自己的戰隊。null = 還沒建立（第一次進戰隊頁會強制取隊名） */
  team: TeamDoc | null;
  teamLoaded: boolean;

  loadTeam: (force?: boolean) => Promise<void>;

  /** 第一次取隊名並建立戰隊 */
  createTeam: (teamName: string) => Promise<{ success: boolean; message: string }>;

  /** 改隊名。一季只能改一次（第一次取名不算） */
  renameTeam: (teamName: string) => Promise<{ success: boolean; message: string }>;

  /** 存編隊結果（最多 3 隻，順序就是站位） */
  saveTeamMembers: (pets: DeployablePet[]) => Promise<{ success: boolean; message: string }>;

  /**
   * 記錄一場戰隊對戰的結果。只動「挑戰方」——被挑戰方不加不減、
   * 也不會收到通知（規格拍板）。
   */
  finishTeamBattle: (args: {
    won: boolean;
    myRank: number;
    opponentRank: number;
    memberPetIds: string[];
  }) => Promise<{ delta: number; newScore: number }>;
}

// ============================================================
// RPG 擴充：寶石鑲嵌的共用流程
// ------------------------------------------------------------
// 鑲／拆寶石會同時動到「寶石袋（users/{uid}）」跟「那件裝備所在的文件」
// （背包也在 users/{uid}、收藏小雞在 collectedPets、正在養的在 pets）。
//
// 採「先更新畫面、背景寫入」：Firestore 在離線時寫入不會 reject、會
// 一直 pending 等連線，如果 await 它，學生按下去會卡在處理中（這個坑
// 在探險結算、戰隊挑戰、送新手雞都踩過）。SDK 會把兩筆寫入排進佇列，
// 恢復連線後一起送出，不會只寫一半。
// ============================================================

type StoreGet = () => GameStoreState;
type StoreSet = (partial: Partial<GameStoreState>) => void;

function locateEquipment(state: GameStoreState, target: EquipmentTarget): EquipmentItem | null {
  const { user, collectedPets, pet } = state;
  if (!user) return null;
  if (target.where === "bag") return (user.equipmentBag ?? []).find((i) => i.id === target.itemId) ?? null;
  if (target.where === "pet") {
    const p = collectedPets.find((c) => c.id === target.petId);
    return (target.slot === "weapon" ? p?.weapon : p?.armor) ?? null;
  }
  return (target.slot === "weapon" ? pet?.weapon : pet?.armor) ?? null;
}

function commitEquipmentChange(
  get: StoreGet,
  set: StoreSet,
  target: EquipmentTarget,
  updatedItem: EquipmentItem,
  gemBag: UserDoc["gemBag"],
  logLabel: string,
): void {
  const { user, pet } = get();
  if (!user) return;
  const now = Date.now();
  const writes: Promise<unknown>[] = [];

  if (target.where === "bag") {
    const bag = (user.equipmentBag ?? []).map((i) => (i.id === updatedItem.id ? updatedItem : i));
    set({ user: { ...user, equipmentBag: bag, gemBag, updatedAt: now } });
    writes.push(updateDoc(doc(db, "users", user.uid), { equipmentBag: bag, gemBag, updatedAt: now }));
  } else if (target.where === "pet") {
    const patch: Partial<CollectedPetDoc> = target.slot === "weapon" ? { weapon: updatedItem } : { armor: updatedItem };
    set({ user: { ...user, gemBag, updatedAt: now } });
    get().updateCollectedPetInStore(target.petId, patch);
    writes.push(updateDoc(doc(db, "users", user.uid), { gemBag, updatedAt: now }));
    writes.push(updateCollectedPetEquipment(user.uid, target.petId, patch));
  } else {
    if (!pet) return;
    set({ user: { ...user, gemBag, updatedAt: now }, pet: { ...pet, [target.slot]: updatedItem, updatedAt: now } });
    writes.push(updateDoc(doc(db, "users", user.uid), { gemBag, updatedAt: now }));
    writes.push(updateDoc(doc(db, "pets", user.uid), { [target.slot]: updatedItem, updatedAt: now }));
  }

  Promise.all(writes).catch((error) => {
    console.error(`[useGameStore] ${logLabel} 寫回 Firestore 失敗：`, error);
  });
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  user: null,
  pet: null,
  // 初始值為 true：代表「登入狀態尚未檢查完成」，由 useAuthBootstrap
  // 的 onAuthStateChanged 第一次回呼觸發後改為 false（不論是否登入）。
  // RequireAuth 元件依此判斷要顯示載入畫面還是導向 /login。
  isLoading: true,

  collectedPets: [],
  collectedPetsLoaded: false,
  exploreProgress: null,
  exploreProgressLoaded: false,
  team: null,
  teamLoaded: false,

  setUser: (user) => set({ user }),
  setPet: (pet) => set({ pet }),
  setLoading: (isLoading) => set({ isLoading }),

  loadCollectedPets: async (force = false) => {
    const { user, collectedPetsLoaded } = get();
    if (!user) return;
    if (collectedPetsLoaded && !force) return;

    try {
      const pets = await fetchCollectedPets(user.uid);
      set({ collectedPets: pets, collectedPetsLoaded: true });
    } catch (error) {
      console.error("[useGameStore] loadCollectedPets 失敗：", error);
      // 失敗時不要把 collectedPetsLoaded 設成 true，下次進頁面才會重試
    }
  },

  updateCollectedPetInStore: (petId, patch) => {
    set({
      collectedPets: get().collectedPets.map((p) =>
        p.id === petId ? { ...p, ...patch, updatedAt: Date.now() } : p
      ),
    });
  },

  petAlertMessage: null,
  setPetAlertMessage: (petAlertMessage) => set({ petAlertMessage }),

  weather: null,
  setWeather: (weather) => set({ weather }),

  pendingRankUp: null,
  clearPendingRankUp: () => set({ pendingRankUp: null }),

  // 1. 立即餵食按鈕邏輯
  feedPet: () => {
    const { user, pet } = get();
    if (!user || !pet || pet.healthStatus === "dead") return;
    if (user.foodCount < 10) return; // 飼料不足

    const now = Date.now();

    // 扣 10 飼料
    const updatedUser = {
      ...user,
      foodCount: Math.max(0, user.foodCount - 10),
      totalFoodSpent: (user.totalFoodSpent ?? 0) + 10,
      updatedAt: now,
    };

    // 飽食度 +5 (上限 100)，XP +10（再乘上轉生印記加成，見
    // RPG 擴充把「轉生印記」制度整個拿掉了（轉生改成收藏，收藏本身
    // 就是獎勵），所以餵食固定 +10 XP，不再有任何倍率。
    const xpGain = 10;
    const newXp = pet.xp + xpGain;
    // 修正：XP 累積到門檻時，要實際推進孵化／進化階段，
    // 不能只加 XP 數字卻讓 stage 原地不動（之前這裡有留 TODO 註解，
    // 現在補上：依新的累計 xp 重新判斷該停留在哪一階）。
    const newStage = resolveStageForXp(pet.stage, newXp);

    const updatedPet = {
      ...pet,
      fullness: Math.min(100, pet.fullness + 5),
      xp: newXp,
      stage: newStage,
      lastFedTime: now,
      updatedAt: now,
    };

    // 先讓畫面立刻反應（樂觀更新），背景再同步寫回 Firestore。
    // 修正：之前這裡只有 set()，從未寫回 Firestore，導致重新整理頁面、
    // useAuthBootstrap 重新從 Firestore 撈資料時，把這次餵食的效果
    // （飽食度、XP、孵化進度）整個蓋掉，看起來就像「小雞的狀況重整就沒了」。
    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        foodCount: updatedUser.foodCount,
        updatedAt: now,
      }),
      updateDoc(doc(db, "pets", user.uid), {
        fullness: updatedPet.fullness,
        xp: updatedPet.xp,
        stage: updatedPet.stage,
        lastFedTime: now,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] feedPet 同步寫回 Firestore 失敗：", error);
    });
  },

  cleanPetMess: () => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料", cost: 0 };
    if (pet.healthStatus === "dead") {
      return { success: false, message: "小雞已經不在了，沒有東西可以清理。", cost: 0 };
    }

    const today = getTodayDateString();
    const prevProg = user.dailyPetCleanProgress;
    const prevCount = prevProg?.date === today ? prevProg.count : 0;
    const cost = (prevCount + 1) * PET_CLEAN_BASE_COST;

    if (user.foodCount < cost) {
      return { success: false, message: `這次清理需要 ${cost} 飼料，飼料不夠喔！`, cost };
    }

    const now = Date.now();
    const foodCount = user.foodCount - cost;
    const totalFoodSpent = (user.totalFoodSpent ?? 0) + cost;
    const newProg = { date: today, count: prevCount + 1 };

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      totalFoodSpent,
      dailyPetCleanProgress: newProg,
      updatedAt: now,
    };
    const updatedPet: PetDoc = { ...pet, lastCleanedTime: now, updatedAt: now };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        foodCount,
        totalFoodSpent,
        dailyPetCleanProgress: newProg,
        updatedAt: now,
      }),
      updateDoc(doc(db, "pets", user.uid), {
        lastCleanedTime: now,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] cleanPetMess 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `🧹 清理完成！花了 ${cost} 飼料。`, cost };
  },

  // 2. 商店買藥水邏輯
  // 修正：之前完全沒檢查 pet.healthStatus，導致小雞明明健康，
  // 「小病藥水」「大病藥水」兩個按鈕還是可以亂按（白白浪費飼料，
  // 且畫面上按鈕從來沒有依生病狀態鎖起來）。現在要求買對應的藥才有效：
  // 小病藥水只能治「生小病」，大病藥水只能治「生大病」。
  buyMedicine: (type) => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };

    const requiredHealthStatus = type === "slightly" ? "slightly_sick" : "severely_sick";

    if (pet.healthStatus !== requiredHealthStatus) {
      if (pet.healthStatus === "normal") {
        return { success: false, message: "小雞很健康，不需要吃藥喔！" };
      }
      if (pet.healthStatus === "dead") {
        return { success: false, message: "小雞已經死掉了，藥水沒有用…" };
      }
      // 生病中，但買錯藥水（例如生小病卻買大病藥水）
      return { success: false, message: "這種藥水對小雞目前的病沒有效，請買對應的藥水。" };
    }

    const cost = type === "slightly" ? 20 : 40;
    if (user.foodCount < cost) {
      return { success: false, message: "飼料不夠喔！" };
    }

    const now = Date.now();

    const updatedUser = {
      ...user,
      foodCount: user.foodCount - cost,
      totalFoodSpent: (user.totalFoodSpent ?? 0) + cost,
      updatedAt: now,
    };

    const updatedPet = {
      ...pet,
      healthStatus: "normal" as const, // 治好變正常
      sickStartTime: null,
      severeSickStartTime: null,
      // 治好後重置生病相關的通知旗標，下次再生病才會重新通知一次
      // （否則旗標一直停在 true，之後真的又生大病/死掉也不會再跳提示）。
      notifiedFlags: { ...pet.notifiedFlags, slightlySick: false, severelySick: false, dead: false },
      updatedAt: now,
    };

    // 同樣修正：之前只有 set()，沒有寫回 Firestore，治好的效果重新整理後會消失。
    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        foodCount: updatedUser.foodCount,
        totalFoodSpent: updatedUser.totalFoodSpent,
        updatedAt: now,
      }),
      updateDoc(doc(db, "pets", user.uid), {
        healthStatus: "normal",
        sickStartTime: null,
        severeSickStartTime: null,
        notifiedFlags: updatedPet.notifiedFlags,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] buyMedicine 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: "醫好小雞了！" };
  },

  // 3. 連續錯 3 次強制生病邏輯
  // 修正：原本呼叫端（usePuzzleSolver.ts）會在呼叫這個函式之後，
  // 緊接著再呼叫一次 setPet(用呼叫前就捕捉到的舊 pet 物件)去更新
  // currentWrongPuzzleId/consecutiveWrongCount，結果那次呼叫把這裡
  // 剛設好的 healthStatus 蓋回 "normal"，造成「明明連續答錯三次，
  // 主頁卻沒有變成生病」的 bug。現在這個函式直接接收 puzzleId/
  // wrongCount，把所有欄位放在同一次 set() 裡一起更新，
  // 呼叫端不需要、也不應該再額外呼叫 setPet。
  triggerSickness: (puzzleId, wrongCount) => {
    const { pet } = get();
    if (!pet || pet.healthStatus !== "normal") return;

    const now = Date.now();

    const updatedPet = {
      ...pet,
      healthStatus: "slightly_sick" as const, // 變生小病
      sickStartTime: now, // 記錄生小病的時間
      currentWrongPuzzleId: puzzleId,
      consecutiveWrongCount: wrongCount,
      notifiedFlags: { ...pet.notifiedFlags, slightlySick: true },
      updatedAt: now,
    };

    set({ pet: updatedPet });

    updateDoc(doc(db, "pets", pet.uid), {
      healthStatus: "slightly_sick",
      sickStartTime: now,
      currentWrongPuzzleId: puzzleId,
      consecutiveWrongCount: wrongCount,
      notifiedFlags: updatedPet.notifiedFlags,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] triggerSickness 同步寫回 Firestore 失敗：", error);
    });
  },

  // 4. 轉職（圖鑑收藏系統，2026-07-21 三版：改成餵食累積 XP）
  // 費用不是「按一下扣一大筆飼料」，是跟原本養成一樣，靠 feedPet
  // 持續累積 xp（大師雞之後 xp 不會停在 730，會一直往上加，見
  // feedPet 跟 petGrowth.ts 的說明），累計 xp 跨過門檻
  // （見 @/lib/pet/catalog.ts 的 getXpNeededForNextJob）才能真的按下去
  // 轉職——按下去本身不用再扣飼料，因為費用已經在餵食過程中一次次的
  // 10 飼料付掉了。成長階段/xp 完全不重置，職業進度就是疊在同一條
  // 累計 xp 上面連續往上算。
  changeJob: () => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };
    if (pet.stage !== "master") {
      return { success: false, message: "小雞還沒長大成熟（大師雞），無法轉職。" };
    }

    const nextEntry = getNextCatalogEntry(pet.currentAppearanceId);
    if (!nextEntry) {
      return { success: false, message: "已經轉職到鳳凰雞了，沒有下一個職業可以轉了，直接轉生吧！" };
    }
    const xpNeeded = getXpNeededForNextJob(pet.currentAppearanceId, pet.xp);
    if (xpNeeded === null) {
      return { success: false, message: "已經轉職到鳳凰雞了，沒有下一個職業可以轉了，直接轉生吧！" };
    }
    if (xpNeeded > 0) {
      return { success: false, message: `還要再累積 ${xpNeeded} 點經驗值才能轉職成${nextEntry.name}，回去餵食小雞吧！` };
    }

    const now = Date.now();
    const newUnlockedCatalogIds = Array.from(new Set([...user.unlockedCatalogIds, nextEntry.id]));

    const updatedUser: UserDoc = {
      ...user,
      unlockedCatalogIds: newUnlockedCatalogIds,
      totalJobChanges: (user.totalJobChanges ?? 0) + 1,
      updatedAt: now,
    };

    // 只換職業外觀，成長階段/xp 完全不動——職業進度就是疊在同一條
    // 累計 xp 上面連續往上算，重置的話下一階的門檻就再也算不出來了。
    const updatedPet: PetDoc = {
      ...pet,
      currentAppearanceId: nextEntry.id,
      updatedAt: now,
    };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        unlockedCatalogIds: updatedUser.unlockedCatalogIds,
        totalJobChanges: updatedUser.totalJobChanges,
        updatedAt: now,
      }),
      updateDoc(doc(db, "pets", user.uid), {
        currentAppearanceId: updatedPet.currentAppearanceId,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] changeJob 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `轉職成功！小雞變成了${nextEntry.name}！` };
  },

  // 4.5 轉生：只有轉職到最後一款（鳳凰雞）之後才能呼叫，免費，
  // 收藏（取代原本的轉生）：把這一隻存成永久的收藏小雞，目前這隻
  // 重置回蛋。詳細說明見上面介面的註解。
  collectPet: async (name: string) => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };
    if (pet.stage !== "master") {
      return { success: false, message: "小雞還沒長大成熟（大師雞），還不能收藏。" };
    }
    if (pet.healthStatus === "dead") {
      return { success: false, message: "小雞已經死掉了，要先復活才能收藏。" };
    }

    const nameError = validatePetName(name);
    if (nameError) return { success: false, message: nameError };

    const now = Date.now();
    const daysRaised = getDaysRaised(pet.lifeStartedAt ?? pet.createdAt, now);
    const severeSickCount = pet.severeSickCount ?? 0;

    // 先把收藏寫進 Firestore，成功了才敢把小雞歸零。順序反過來的話，
    // 寫入失敗就等於憑空弄丟一隻養了很久的小雞。
    let created;
    try {
      created = await createCollectedPet({
        uid: user.uid,
        name,
        jobId: pet.currentAppearanceId,
        severeSickCount,
        daysRaised,
        // 身上穿的裝備跟著收藏走——不然換回蛋之後那兩件會憑空消失
        weapon: pet.weapon ?? null,
        armor: pet.armor ?? null,
      });
    } catch (error) {
      console.error("[useGameStore] collectPet 寫入收藏小雞失敗：", error);
      return { success: false, message: "收藏失敗，請檢查網路後再試一次（小雞還在，沒有消失）。" };
    }

    // collectedJobIds 給「八職集齊」勳章用。未轉職收藏的 jobId 是
    // null，不算任何一個職業。
    const jobIds = new Set(user.collectedJobIds ?? []);
    if (pet.currentAppearanceId) jobIds.add(pet.currentAppearanceId);

    const updatedUser: UserDoc = {
      ...user,
      collectedPetCount: (user.collectedPetCount ?? 0) + 1,
      collectedJobIds: [...jobIds],
      updatedAt: now,
    };

    // 重置成一顆全新的蛋。severeSickCount 跟 lifeStartedAt 一起歸零／
    // 重設，新的這一隻才是從頭算起的。
    const updatedPet: PetDoc = {
      ...pet,
      stage: "egg",
      xp: 0,
      fullness: 100,
      healthStatus: "normal",
      currentWrongPuzzleId: null,
      consecutiveWrongCount: 0,
      sickStartTime: null,
      severeSickStartTime: null,
      lastFedTime: now,
      lastCleanedTime: now,
      notifiedFlags: { lowFullness: false, slightlySick: false, severelySick: false, dead: false },
      currentAppearanceId: null,
      severeSickCount: 0,
      lifeStartedAt: now,
      // 裝備已經跟著收藏走了，新的蛋是空手的
      weapon: null,
      armor: null,
      updatedAt: now,
    };

    set({
      user: updatedUser,
      pet: updatedPet,
      collectedPets: [created, ...get().collectedPets],
    });

    // collectedPetCount 在 createCollectedPet 裡面已經 increment 過了，
    // 這裡只補寫 collectedJobIds
    void updateDoc(doc(db, "users", user.uid), {
      collectedJobIds: updatedUser.collectedJobIds,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] collectPet 寫回 collectedJobIds 失敗：", error);
    });

    try {
      await updateDoc(doc(db, "pets", user.uid), {
        stage: "egg",
        xp: 0,
        fullness: 100,
        healthStatus: "normal",
        currentWrongPuzzleId: null,
        consecutiveWrongCount: 0,
        sickStartTime: null,
        severeSickStartTime: null,
        lastFedTime: now,
        lastCleanedTime: now,
        notifiedFlags: updatedPet.notifiedFlags,
        currentAppearanceId: null,
        severeSickCount: 0,
        lifeStartedAt: now,
        weapon: null,
        armor: null,
        updatedAt: now,
      });
    } catch (error) {
      console.error("[useGameStore] collectPet 重置小雞寫回 Firestore 失敗：", error);
    }

    return {
      success: true,
      message: `「${created.name}」已經收藏起來了！牠會永遠留在你的小雞收藏裡，可以派去探險跟戰隊。一顆新的蛋已經送到你手上囉 🥚`,
    };
  },

  // 5. 復活（跟轉生不同：理由見 GameStoreState 介面裡 resurrectPet 的註解）
  resurrectPet: () => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };
    if (pet.healthStatus !== "dead") {
      return { success: false, message: "小雞還活著，不需要復活。" };
    }

    // 復活費用：介於小病藥水（20）跟大病藥水（40）之間，反映「死亡」
    // 比生病更嚴重，但又不能貴到讓人完全付不起（尤其死亡後還能繼續
    // 解題賺飼料，理由見 usePuzzleSolver.ts 頂部說明：生病/死亡不會
    // 鎖定解題功能，所以這裡收費不會造成「沒錢復活、又賺不到錢」的死循環）。
    const cost = 30;
    if (user.foodCount < cost) {
      return { success: false, message: `復活需要 ${cost} 飼料，飼料不夠喔！` };
    }

    const now = Date.now();

    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount - cost,
      totalFoodSpent: (user.totalFoodSpent ?? 0) + cost,
      updatedAt: now,
    };

    // 復活後重新從蛋開始（跟死亡前養到哪個階段無關），不增加
    // rebirthCount、不解鎖圖鑑款式——這是補救措施，不是成就獎勵。
    // currentAppearanceId（職業）也一併歸零重新累積，但 unlockedCatalogIds
    // （圖鑑蒐集紀錄）完全不動，蒐集進度不會因為死掉而消失。
    const updatedPet: PetDoc = {
      ...pet,
      stage: "egg",
      xp: 0,
      fullness: 100,
      healthStatus: "normal",
      currentWrongPuzzleId: null,
      consecutiveWrongCount: 0,
      sickStartTime: null,
      severeSickStartTime: null,
      lastFedTime: now,
      lastCleanedTime: now,
      notifiedFlags: { lowFullness: false, slightlySick: false, severelySick: false, dead: false },
      currentAppearanceId: null,
      // RPG 擴充：復活等於重新養一隻，生大病次數歸零、養成天數重新算
      severeSickCount: 0,
      lifeStartedAt: now,
      updatedAt: now,
    };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        foodCount: updatedUser.foodCount,
        totalFoodSpent: updatedUser.totalFoodSpent,
        updatedAt: now,
      }),
      updateDoc(doc(db, "pets", user.uid), {
        stage: "egg",
        xp: 0,
        fullness: 100,
        healthStatus: "normal",
        currentWrongPuzzleId: null,
        consecutiveWrongCount: 0,
        sickStartTime: null,
        severeSickStartTime: null,
        lastFedTime: now,
        lastCleanedTime: now,
        notifiedFlags: updatedPet.notifiedFlags,
        currentAppearanceId: null,
        severeSickCount: 0,
        lifeStartedAt: now,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] resurrectPet 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: "小雞復活了！要重新從蛋開始好好照顧牠喔。" };
  },

  // 6. 每日任務領取
  claimDailyTask: (task) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const today = getTodayDateString();
    const completedToday = getTodaysCompletedTaskIds(user);

    if (completedToday.includes(task.id)) {
      return { success: false, message: "今天已經完成這個任務了，明天再來！" };
    }

    // 驗證 vs_computer 任務是否達標
    if (task.taskType === "vs_computer") {
      const prog = user.dailyVsComputerProgress;
      const todayCount = prog?.date === today ? prog.count : 0;
      if (todayCount < (task.requiredCount ?? 1)) {
        return {
          success: false,
          message: `今天還需要再對弈 ${(task.requiredCount ?? 1) - todayCount} 局才能領取！`,
        };
      }
    }

    // 驗證 puzzle_submit 任務是否達標
    if (task.taskType === "puzzle_submit") {
      const prog = user.dailyPuzzleSubmitProgress;
      const todayCount = prog?.date === today ? prog.count : 0;
      if (todayCount < (task.requiredCount ?? 1)) {
        return {
          success: false,
          message: `今天還需要再投稿 ${(task.requiredCount ?? 1) - todayCount} 題才能領取！`,
        };
      }
    }

    // 驗證 explore / team_battle 任務是否達標
    if (task.taskType === "explore") {
      const prog = user.dailyExploreProgress;
      const todayCount = prog?.date === today ? prog.count : 0;
      if (todayCount < (task.requiredCount ?? 1)) {
        return {
          success: false,
          message: `今天還需要再探險 ${(task.requiredCount ?? 1) - todayCount} 次才能領取！`,
        };
      }
    }
    if (task.taskType === "team_battle") {
      const prog = user.dailyTeamBattleProgress;
      const todayCount = prog?.date === today ? prog.count : 0;
      if (todayCount < (task.requiredCount ?? 1)) {
        return {
          success: false,
          message: `今天還需要再挑戰 ${(task.requiredCount ?? 1) - todayCount} 次才能領取！`,
        };
      }
    }

    // 驗證 pasture_interact 任務是否達標
    if (task.taskType === "pasture_interact") {
      const prog = user.dailyPastureInteractProgress;
      const todayCount = prog?.date === today ? prog.interactedUids.length : 0;
      if (todayCount < (task.requiredCount ?? 1)) {
        return {
          success: false,
          message: `今天還需要再跟 ${(task.requiredCount ?? 1) - todayCount} 隻不同的小雞互動才能領取！`,
        };
      }
    }

    const now = Date.now();
    const updatedDailyTaskProgress = {
      date: today,
      completedTaskIds: [...completedToday, task.id],
    };

    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount + task.rewardFood,
      dailyTaskProgress: updatedDailyTaskProgress,
      updatedAt: now,
    };

    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: updatedUser.foodCount,
      dailyTaskProgress: updatedDailyTaskProgress,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] claimDailyTask 同步寫回 Firestore 失敗：", error);
    });

    return {
      success: true,
      message: `完成「${task.title}」，獲得 ${task.rewardFood} 飼料！`,
    };
  },

  // 6.5 簽到
  checkin: (checkinTaskIds = [], checkinTaskRewards = []) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", alreadyDone: false };

    const today = getTodayDateString();
    const history = user.checkinHistory ?? [];

    if (history.includes(today)) {
      return { success: false, message: "今天已經簽到了！", alreadyDone: true };
    }

    const now = Date.now();
    const newHistory = [...history, today];

    // 同時把所有簽到任務標記為完成（跟任務頁共用同一個 completedTaskIds）
    const completedToday = getTodaysCompletedTaskIds(user);
    const newCompletedIds = Array.from(new Set([...completedToday, ...checkinTaskIds]));
    const updatedDailyTaskProgress = {
      date: today,
      completedTaskIds: newCompletedIds,
    };

    // 發放所有簽到任務的飼料獎勵（跟 claimDailyTask 等效，避免學生在彈框
    // 簽到後，任務面顯示「已完成」但沒有收到飼料的問題）
    const totalRewardFood = checkinTaskRewards.reduce((sum, r) => sum + r, 0);
    const newFoodCount = user.foodCount + totalRewardFood;

    const updatedUser: UserDoc = {
      ...user,
      foodCount: newFoodCount,
      checkinHistory: newHistory,
      dailyTaskProgress: updatedDailyTaskProgress,
      updatedAt: now,
    };

    set({ user: updatedUser });

    setDoc(doc(db, "users", user.uid), {
      foodCount: newFoodCount,
      checkinHistory: newHistory,
      dailyTaskProgress: updatedDailyTaskProgress,
      updatedAt: now,
    }, { merge: true }).catch((error) => {
      console.error("[useGameStore] checkin 同步寫回 Firestore 失敗：", error);
    });

    const msg = totalRewardFood > 0
      ? `簽到成功！獲得 ${totalRewardFood} 飼料！`
      : "簽到成功！";
    return { success: true, message: msg, alreadyDone: false };
  },

  // 6.55 成就勳章：檢查 + 發放 + 存檔（見 @/lib/badges/badges.ts 的說明）
  // 6.55b 手動領取勳章獎勵（見介面宣告的說明）
  claimBadge: (badgeId) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const badge = getBadgeById(badgeId);
    if (!badge) return { success: false, message: "找不到這個勳章" };

    if ((user.earnedBadgeIds ?? []).includes(badgeId)) {
      return { success: false, message: "這個勳章已經領過了" };
    }
    if (!badge.check(user)) {
      return { success: false, message: "還沒達成這個勳章的條件" };
    }

    const now = Date.now();
    const newEarnedBadgeIds = [...(user.earnedBadgeIds ?? []), badgeId];
    const newFoodCount = user.foodCount + badge.rewardFood;
    const updatedUser: UserDoc = {
      ...user,
      earnedBadgeIds: newEarnedBadgeIds,
      foodCount: newFoodCount,
      updatedAt: now,
    };

    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      earnedBadgeIds: newEarnedBadgeIds,
      foodCount: newFoodCount,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] claimBadge 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `🎉 領取成功！獲得 ${badge.rewardFood} 飼料！` };
  },

  // 6.55b 領取「轉生機制改版補償」飼料（一次性）
  claimResetCompensation: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", amount: 0 };
    if (user.hasClaimedResetCompensation === true) {
      return { success: false, message: "已經領過補償飼料了", amount: 0 };
    }

    const totalSolved = user.stats?.totalSolved ?? 0;
    // 超過 1000 題直接給封頂的 5000，不用讓玩家反推出「解題數 x10」
    // 這個換算規則（見介面宣告的說明）。
    const amount = totalSolved > 1000 ? 5000 : totalSolved * 10;

    const now = Date.now();
    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount + amount,
      hasClaimedResetCompensation: true,
      updatedAt: now,
    };

    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      foodCount: updatedUser.foodCount,
      hasClaimedResetCompensation: true,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] claimResetCompensation 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `補償飼料已到帳！獲得 ${amount} 飼料！`, amount };
  },

  // 6.6 取得今天對弈電腦局數
  getDailyVsComputerCount: () => {
    const { user } = get();
    if (!user) return 0;
    const today = getTodayDateString();
    const prog = user.dailyVsComputerProgress;
    return prog?.date === today ? prog.count : 0;
  },

  // 7. 對弈電腦結算
  applyVsComputerResult: (outcome, opponentLevel) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", foodDelta: 0 };

    const baseWinReward = calculateWinRewardFood(opponentLevel, user.chessLevel);
    // 雙倍飼料券：只在贏的情況下加倍（輸/和的懲罰/獎勵不加倍）
    const isDoubleActive = (user.doubleRewardExpiry ?? 0) > Date.now();
    const winRewardFood = isDoubleActive ? baseWinReward * 2 : baseWinReward;
    const foodDelta = outcome === "win" ? winRewardFood : outcome === "draw" ? DRAW_REWARD_FOOD : -LOSE_PENALTY_FOOD;

    const newFoodCount = Math.max(0, user.foodCount + foodDelta);
    const now = Date.now();

    const statsDelta =
      outcome === "win"
        ? { vsComputerWins: (user.stats.vsComputerWins ?? 0) + 1 }
        : outcome === "draw"
          ? { vsComputerDraws: (user.stats.vsComputerDraws ?? 0) + 1 }
          : { vsComputerLosses: (user.stats.vsComputerLosses ?? 0) + 1 };

    // 更新當天對弈局數（用於對弈任務進度追蹤）
    const today = getTodayDateString();
    const prevProg = user.dailyVsComputerProgress;
    const newVsCount = prevProg?.date === today ? prevProg.count + 1 : 1;
    const newVsProg = { date: today, count: newVsCount };

    const updatedUser: UserDoc = {
      ...user,
      foodCount: newFoodCount,
      stats: { ...user.stats, ...statsDelta },
      dailyVsComputerProgress: newVsProg,
      updatedAt: now,
    };

    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: newFoodCount,
      [`stats.${Object.keys(statsDelta)[0]}`]: Object.values(statsDelta)[0],
      dailyVsComputerProgress: newVsProg,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] applyVsComputerResult 同步寫回 Firestore 失敗：", error);
    });

    const message =
      outcome === "win"
        ? `恭喜獲勝！獲得 ${winRewardFood} 飼料！`
        : outcome === "draw"
          ? `和棋，獲得 ${DRAW_REWARD_FOOD} 飼料安慰獎。`
          : `這局輸了，扣 ${LOSE_PENALTY_FOOD} 飼料，再接再厲！`;

    // 棋力積分：只有贏才加分（和棋/輸不扣分，見 chessRank.ts 的只升不降）。
    // 放在 set() 之後呼叫，addChessLevelPoints 會讀取剛更新完的 user
    // 再往上疊，不會蓋掉上面的飼料/戰績。
    // 升段的慶祝由 addChessLevelPoints 寫入 pendingRankUp、再由全站的
    // RankUpCelebration 跳滿版慶祝頁，這裡不用再往訊息裡塞升級字串
    // （塞了會變成小字提示跟滿版慶祝同時出現，重複又雜亂）。
    if (outcome === "win") {
      get().addChessLevelPoints(getVsComputerWinPoints(user.chessLevel, opponentLevel));
    }

    return { success: true, message, foodDelta };
  },

  claimDailyGrant: () => {
    const { user } = get();
    if (!user) return { granted: false };

    const DAILY_GRANT_AMOUNT = 50;
    const BATTLE_ENTRY_COST = 20;
    const todayStr = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    // 已經領過了，不重複發
    if (user.lastDailyGrantDate === todayStr) return { granted: false };
    // 飼料還夠，不需要補助
    if (user.foodCount >= BATTLE_ENTRY_COST) return { granted: false };

    const newFoodCount = user.foodCount + DAILY_GRANT_AMOUNT;
    const now = Date.now();
    const updatedUser: UserDoc = {
      ...user,
      foodCount: newFoodCount,
      lastDailyGrantDate: todayStr,
      updatedAt: now,
    };

    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: newFoodCount,
      lastDailyGrantDate: todayStr,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] claimDailyGrant 同步寫回 Firestore 失敗：", error);
    });

    return { granted: true };
  },

  payPastureEntry: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", alreadyPaid: false };

    const today = getTodayDateString();
    const now = Date.now();

    // 今天已經付過了：不重複收費，直接視為成功（防呆用，正常 UI 流程
    // 不會讓已入場的人再看到付費按鈕）。
    if (user.pastureEconomy?.date === today) {
      return { success: true, message: "今天已經入場過了！", alreadyPaid: true };
    }

    if (user.foodCount < PASTURE_ENTRY_FEE) {
      return {
        success: false,
        message: `飼料不足，入場需要 ${PASTURE_ENTRY_FEE} 飼料，先去解題或對弈賺一點吧！`,
        alreadyPaid: false,
      };
    }

    const foodCount = user.foodCount - PASTURE_ENTRY_FEE;
    const totalFoodSpent = (user.totalFoodSpent ?? 0) + PASTURE_ENTRY_FEE;
    // lastIncomeAt 設成現在，被動收入從入場這一刻才開始起算。
    const economy = { date: today, lastIncomeAt: now, incomeClaimedToday: 0 };

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      totalFoodSpent,
      pastureEconomy: economy,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount,
      totalFoodSpent,
      pastureEconomy: economy,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] payPastureEntry 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `🎫 入場費 -${PASTURE_ENTRY_FEE} 飼料，小雞開心地跑進牧場！`, alreadyPaid: false };
  },

  claimPastureIncome: () => {
    const { user } = get();
    if (!user) return { incomeGained: 0, incomeClaimedToday: 0 };

    const today = getTodayDateString();
    const economy = user.pastureEconomy;

    // 今天還沒付入場費：沒有計時器可以結算，直接回傳 0（頁面應該先讓
    // 使用者看到付費入場的畫面，不會走到這裡）。
    if (!economy || economy.date !== today) {
      return { incomeGained: 0, incomeClaimedToday: economy?.incomeClaimedToday ?? 0 };
    }

    // 被動收入結算：算「距離上次結算過了幾個整小時」，不足一小時的
    // 零頭留到下次繼續累計（lastIncomeAt 只往前推進整小時的份量）。
    const HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();
    const elapsedHours = Math.floor((now - economy.lastIncomeAt) / HOUR_MS);
    if (elapsedHours <= 0) {
      return { incomeGained: 0, incomeClaimedToday: economy.incomeClaimedToday };
    }

    const remainingCap = Math.max(0, PASTURE_DAILY_INCOME_CAP - economy.incomeClaimedToday);
    const incomeGained = Math.min(elapsedHours * PASTURE_HOURLY_INCOME, remainingCap);
    const updatedEconomy = {
      ...economy,
      lastIncomeAt: economy.lastIncomeAt + elapsedHours * HOUR_MS,
      incomeClaimedToday: economy.incomeClaimedToday + incomeGained,
    };
    const foodCount = user.foodCount + incomeGained;

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      pastureEconomy: updatedEconomy,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount,
      pastureEconomy: updatedEconomy,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] claimPastureIncome 同步寫回 Firestore 失敗：", error);
    });

    return { incomeGained, incomeClaimedToday: updatedEconomy.incomeClaimedToday };
  },

  getDailyPastureInteractCount: () => {
    const { user } = get();
    if (!user) return 0;
    const today = getTodayDateString();
    const prog = user.dailyPastureInteractProgress;
    return prog?.date === today ? prog.interactedUids.length : 0;
  },

  getDailyPuzzleSubmitCount: () => {
    const { user } = get();
    if (!user) return 0;
    const today = getTodayDateString();
    const prog = user.dailyPuzzleSubmitProgress;
    return prog?.date === today ? prog.count : 0;
  },

  // 探險跟戰隊的每日進度刻意用「台北時間」的日期，跟這兩個功能的
  // 每日次數重置基準一致（見 exploreProgress.ts / teams.ts）。
  // 上面那幾個舊任務用的是瀏覽器本地時區，沒有一起改是因為改了會
  // 讓現有任務在跨日那一刻的行為變動，不值得在這次一起動。
  getDailyExploreCount: () => {
    const { user } = get();
    if (!user) return 0;
    const prog = user.dailyExploreProgress;
    return prog?.date === getTaipeiDateString() ? prog.count : 0;
  },

  getDailyTeamBattleCount: () => {
    const { user } = get();
    if (!user) return 0;
    const prog = user.dailyTeamBattleProgress;
    return prog?.date === getTaipeiDateString() ? prog.count : 0;
  },

  recordPastureInteraction: (targetUid, kind) => {
    const { user } = get();
    if (!user) return { allowed: false, isNewChicken: false, remaining: 0 };

    // 拍自己的小雞毫無意義，直接擋掉——UI 那邊也會把按鈕藏起來，這裡
    // 是防呆用的第二層檢查。
    if (targetUid === user.uid) {
      return { allowed: false, isNewChicken: false, remaining: 0, reason: "self" };
    }

    const today = getTodayDateString();
    const prevProg = user.dailyPastureInteractProgress;
    const isToday = prevProg?.date === today;
    const prevUids = isToday ? prevProg.interactedUids : [];
    const prevPatCount = isToday ? prevProg.patCount ?? 0 : 0;
    const prevEmojiCount = isToday ? prevProg.emojiCount ?? 0 : 0;

    const limit = kind === "pat" ? PASTURE_PAT_DAILY_LIMIT : PASTURE_EMOJI_DAILY_LIMIT;
    const currentCount = kind === "pat" ? prevPatCount : prevEmojiCount;

    if (currentCount >= limit) {
      return { allowed: false, isNewChicken: false, remaining: 0, reason: "limit_reached" };
    }

    const newPatCount = kind === "pat" ? prevPatCount + 1 : prevPatCount;
    const newEmojiCount = kind === "emoji" ? prevEmojiCount + 1 : prevEmojiCount;
    const isNewChicken = !prevUids.includes(targetUid);
    const newUids = isNewChicken ? [...prevUids, targetUid] : prevUids;
    const newProg = { date: today, interactedUids: newUids, patCount: newPatCount, emojiCount: newEmojiCount };
    const now = Date.now();

    const updatedUser: UserDoc = { ...user, dailyPastureInteractProgress: newProg, updatedAt: now };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      dailyPastureInteractProgress: newProg,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] recordPastureInteraction 同步寫回 Firestore 失敗：", error);
    });

    const remaining = limit - (kind === "pat" ? newPatCount : newEmojiCount);
    return { allowed: true, isNewChicken, remaining };
  },

  catchPastureBug: () => {
    const { user } = get();
    if (!user) return { success: false, foodGained: 0, remainingToday: 0 };

    const today = getTodayDateString();
    const prevProg = user.dailyBugCatchProgress;
    const prevCount = prevProg?.date === today ? prevProg.count : 0;

    if (prevCount >= PASTURE_BUG_CATCH_DAILY_LIMIT) {
      return { success: false, foodGained: 0, remainingToday: 0 };
    }

    const newCount = prevCount + 1;
    const newProg = { date: today, count: newCount };
    const foodCount = user.foodCount + PASTURE_BUG_CATCH_REWARD_FOOD;
    const now = Date.now();

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      dailyBugCatchProgress: newProg,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount,
      dailyBugCatchProgress: newProg,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] catchPastureBug 同步寫回 Firestore 失敗：", error);
    });

    return {
      success: true,
      foodGained: PASTURE_BUG_CATCH_REWARD_FOOD,
      remainingToday: PASTURE_BUG_CATCH_DAILY_LIMIT - newCount,
    };
  },

  addChessLevelPoints: (points) => {
    const { user } = get();
    if (!user || points <= 0) {
      return {
        levelsGained: 0,
        newLevel: user?.chessLevel ?? 1,
        newRankLabel: getChessRankLabel(user?.chessLevel ?? 1),
      };
    }

    const result = applyChessLevelPoints(user.chessLevel, user.chessLevelPoints ?? 0, points);
    const now = Date.now();

    const updatedUser: UserDoc = {
      ...user,
      chessLevel: result.chessLevel as UserDoc["chessLevel"],
      chessLevelPoints: result.chessLevelPoints,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      chessLevel: result.chessLevel,
      chessLevelPoints: result.chessLevelPoints,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] addChessLevelPoints 同步寫回 Firestore 失敗：", error);
    });

    // 真的升級了才觸發全站的滿版慶祝頁（見 pendingRankUp 的說明）
    if (result.levelsGained > 0) {
      set({
        pendingRankUp: {
          newRankLabel: getChessRankLabel(result.chessLevel),
          previousRankLabel: getChessRankLabel(user.chessLevel),
          newLevel: result.chessLevel,
          levelsGained: result.levelsGained,
        },
      });
    }

    return {
      levelsGained: result.levelsGained,
      newLevel: result.chessLevel,
      newRankLabel: getChessRankLabel(result.chessLevel),
    };
  },

  buyShopItem: (itemId, price, category) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    // 背景、棋盤造型都改為抽獎取得，不再支援直接花飼料購買
    // （見 drawBackgroundGacha / drawBoardSkinGacha）
    if (category === "background") {
      return { success: false, message: "背景已改為抽獎取得，請到商店的抽獎區試試手氣！" };
    }
    if (category === "board_skin") {
      return { success: false, message: "棋盤造型已改為抽獎取得，請到商店的抽獎區試試手氣！" };
    }

    if (user.foodCount < price) return { success: false, message: `飼料不足，需要 ${price} 飼料` };

    // 雙倍飼料券：每天限購一次，防止用飼料一直買來壓縮遊戲節奏
    const todayStr = getTodayDateString();
    if (itemId === "double_reward_voucher" && user.lastDoubleVoucherPurchaseDate === todayStr) {
      return { success: false, message: "今天已經買過雙倍飼料券了，明天再來吧！" };
    }

    const now = Date.now();

    // 消耗道具：加進背包
    // 用 setDoc + merge 而不是 updateDoc dotted path，
    // 避免 inventory 欄位不存在時靜默失敗（舊帳號沒有這個欄位）
    const currentCount = user.inventory?.[itemId as keyof typeof user.inventory] ?? 0;
    const newInventory = { ...(user.inventory ?? {}), [itemId]: currentCount + 1 };
    const purchaseDateUpdate = itemId === "double_reward_voucher" ? { lastDoubleVoucherPurchaseDate: todayStr } : {};
    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount - price,
      totalFoodSpent: (user.totalFoodSpent ?? 0) + price,
      inventory: newInventory,
      ...purchaseDateUpdate,
      updatedAt: now,
    };
    set({ user: updatedUser });
    setDoc(doc(db, "users", user.uid), {
      foodCount: updatedUser.foodCount,
      totalFoodSpent: updatedUser.totalFoodSpent,
      inventory: newInventory,
      ...purchaseDateUpdate,
      updatedAt: now,
    }, { merge: true }).catch(console.error);

    return { success: true, message: "購買成功！" };
  },

  drawBackgroundGacha: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };
    if (user.foodCount < BACKGROUND_GACHA_COST) {
      return { success: false, message: `飼料不足，抽一次需要 ${BACKGROUND_GACHA_COST} 飼料` };
    }

    const now = Date.now();

    // 飼料無論有沒有中獎都會先扣（銘謝惠顧不退還，只有「抽中但已擁有」才退還）
    const foodAfterDraw = user.foodCount - BACKGROUND_GACHA_COST;
    const spentAfterDraw = (user.totalFoodSpent ?? 0) + BACKGROUND_GACHA_COST;
    const drawn = drawBackgroundGachaResult();

    if (!drawn) {
      // 沒中獎：銘謝惠顧
      set({ user: { ...user, foodCount: foodAfterDraw, totalFoodSpent: spentAfterDraw, updatedAt: now } });
      updateDoc(doc(db, "users", user.uid), { foodCount: foodAfterDraw, totalFoodSpent: spentAfterDraw, updatedAt: now }).catch(console.error);
      return {
        success: true,
        message: `😢 銘謝惠顧，什麼都沒抽到，扣了 ${BACKGROUND_GACHA_COST} 飼料`,
        isDuplicate: false,
      };
    }

    const alreadyOwned = (user.unlockedBackgrounds ?? []).includes(drawn.id);

    if (alreadyOwned) {
      // 中獎但抽到重複的背景：全額退還飼料，等於沒扣錢（也不計入消費排行），只是換一次手氣
      set({ user: { ...user, updatedAt: now } });
      updateDoc(doc(db, "users", user.uid), { updatedAt: now }).catch(console.error);
      return {
        success: true,
        message: `${drawn.icon} 抽到「${drawn.name}」，但你已經擁有了，飼料全額退還！`,
        itemId: drawn.id,
        isDuplicate: true,
      };
    }

    const newUnlocked = [...(user.unlockedBackgrounds ?? []), drawn.id];
    const updatedUser: UserDoc = {
      ...user,
      foodCount: foodAfterDraw,
      totalFoodSpent: spentAfterDraw,
      unlockedBackgrounds: newUnlocked,
      updatedAt: now,
    };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      foodCount: foodAfterDraw,
      totalFoodSpent: spentAfterDraw,
      unlockedBackgrounds: newUnlocked,
      updatedAt: now,
    }).catch(console.error);

    return {
      success: true,
      message: `🎉 恭喜抽到新背景「${drawn.name}」！`,
      itemId: drawn.id,
      isDuplicate: false,
    };
  },

  // 十連抽：邏輯完全比照單抽（見上面 drawBackgroundGacha 的註解），
  // 只是迴圈跑 10 次、最後合併成一次 set + 一次 Firestore 寫入，
  // 不會產生 10 次網路請求。總價是優惠價 BACKGROUND_GACHA_TEN_COST
  // （比單抽 x10 便宜），平均分攤到每一抽（90/10 = 9），這樣「抽到
  // 重複退還」的邏輯才能維持跟單抽一樣的比例，不會因為十連抽有優惠
  // 就讓重複退還的金額對不上。
  drawBackgroundGachaTen: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", results: [] };

    if (user.foodCount < BACKGROUND_GACHA_TEN_COST) {
      return { success: false, message: `飼料不足，十連抽需要 ${BACKGROUND_GACHA_TEN_COST} 飼料`, results: [] };
    }

    const now = Date.now();
    const perDrawCost = BACKGROUND_GACHA_TEN_COST / 10;
    let foodCount = user.foodCount;
    let totalFoodSpent = user.totalFoodSpent ?? 0;
    let unlockedBackgrounds = [...(user.unlockedBackgrounds ?? [])];
    const results: { itemId: string | null; isDuplicate: boolean }[] = [];
    let newCount = 0;

    for (let i = 0; i < 10; i++) {
      // 飼料無論有沒有中獎都會先扣（銘謝惠顧不退還，只有「抽中但已擁有」才退還）
      foodCount -= perDrawCost;
      totalFoodSpent += perDrawCost;

      const drawn = drawBackgroundGachaResult();
      if (!drawn) {
        results.push({ itemId: null, isDuplicate: false });
        continue;
      }

      const alreadyOwned = unlockedBackgrounds.includes(drawn.id);
      if (alreadyOwned) {
        // 中獎但重複：這一抽全額退還，等於沒扣錢
        foodCount += perDrawCost;
        totalFoodSpent -= perDrawCost;
        results.push({ itemId: drawn.id, isDuplicate: true });
      } else {
        unlockedBackgrounds = [...unlockedBackgrounds, drawn.id];
        newCount += 1;
        results.push({ itemId: drawn.id, isDuplicate: false });
      }
    }

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      totalFoodSpent,
      unlockedBackgrounds,
      updatedAt: now,
    };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      foodCount,
      totalFoodSpent,
      unlockedBackgrounds,
      updatedAt: now,
    }).catch(console.error);

    const message =
      newCount > 0
        ? `🎉 十連抽完成！獲得 ${newCount} 款新背景！`
        : "😢 十連抽完成，這次都沒抽到新背景，再試試手氣吧！";

    return { success: true, message, results };
  },

  // 棋盤造型單抽：邏輯完全比照 drawBackgroundGacha，只是換成獨立的
  // unlockedBoardSkins 欄位跟棋盤造型專屬的常數/池子。
  drawBoardSkinGacha: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };
    if (user.foodCount < BOARD_SKIN_GACHA_COST) {
      return { success: false, message: `飼料不足，抽一次需要 ${BOARD_SKIN_GACHA_COST} 飼料` };
    }

    const now = Date.now();
    const foodAfterDraw = user.foodCount - BOARD_SKIN_GACHA_COST;
    const spentAfterDraw = (user.totalFoodSpent ?? 0) + BOARD_SKIN_GACHA_COST;
    const drawn = drawBoardSkinGachaResult();

    if (!drawn) {
      set({ user: { ...user, foodCount: foodAfterDraw, totalFoodSpent: spentAfterDraw, updatedAt: now } });
      updateDoc(doc(db, "users", user.uid), { foodCount: foodAfterDraw, totalFoodSpent: spentAfterDraw, updatedAt: now }).catch(console.error);
      return {
        success: true,
        message: `😢 銘謝惠顧，什麼都沒抽到，扣了 ${BOARD_SKIN_GACHA_COST} 飼料`,
        isDuplicate: false,
      };
    }

    const alreadyOwned = (user.unlockedBoardSkins ?? []).includes(drawn.id);

    if (alreadyOwned) {
      set({ user: { ...user, updatedAt: now } });
      updateDoc(doc(db, "users", user.uid), { updatedAt: now }).catch(console.error);
      return {
        success: true,
        message: `${drawn.icon} 抽到「${drawn.name}」，但你已經擁有了，飼料全額退還！`,
        itemId: drawn.id,
        isDuplicate: true,
      };
    }

    const newUnlocked = [...(user.unlockedBoardSkins ?? []), drawn.id];
    const updatedUser: UserDoc = {
      ...user,
      foodCount: foodAfterDraw,
      totalFoodSpent: spentAfterDraw,
      unlockedBoardSkins: newUnlocked,
      updatedAt: now,
    };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      foodCount: foodAfterDraw,
      totalFoodSpent: spentAfterDraw,
      unlockedBoardSkins: newUnlocked,
      updatedAt: now,
    }).catch(console.error);

    return {
      success: true,
      message: `🎉 恭喜抽到新棋盤造型「${drawn.name}」！`,
      itemId: drawn.id,
      isDuplicate: false,
    };
  },

  // 棋盤造型十連抽：邏輯完全比照 drawBackgroundGachaTen。
  drawBoardSkinGachaTen: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", results: [] };

    if (user.foodCount < BOARD_SKIN_GACHA_TEN_COST) {
      return { success: false, message: `飼料不足，十連抽需要 ${BOARD_SKIN_GACHA_TEN_COST} 飼料`, results: [] };
    }

    const now = Date.now();
    const perDrawCost = BOARD_SKIN_GACHA_TEN_COST / 10;
    let foodCount = user.foodCount;
    let totalFoodSpent = user.totalFoodSpent ?? 0;
    let unlockedBoardSkins = [...(user.unlockedBoardSkins ?? [])];
    const results: { itemId: string | null; isDuplicate: boolean }[] = [];
    let newCount = 0;

    for (let i = 0; i < 10; i++) {
      foodCount -= perDrawCost;
      totalFoodSpent += perDrawCost;

      const drawn = drawBoardSkinGachaResult();
      if (!drawn) {
        results.push({ itemId: null, isDuplicate: false });
        continue;
      }

      const alreadyOwned = unlockedBoardSkins.includes(drawn.id);
      if (alreadyOwned) {
        foodCount += perDrawCost;
        totalFoodSpent -= perDrawCost;
        results.push({ itemId: drawn.id, isDuplicate: true });
      } else {
        unlockedBoardSkins = [...unlockedBoardSkins, drawn.id];
        newCount += 1;
        results.push({ itemId: drawn.id, isDuplicate: false });
      }
    }

    const updatedUser: UserDoc = {
      ...user,
      foodCount,
      totalFoodSpent,
      unlockedBoardSkins,
      updatedAt: now,
    };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      foodCount,
      totalFoodSpent,
      unlockedBoardSkins,
      updatedAt: now,
    }).catch(console.error);

    const message =
      newCount > 0
        ? `🎉 十連抽完成！獲得 ${newCount} 款新棋盤造型！`
        : "😢 十連抽完成，這次都沒抽到新造型，再試試手氣吧！";

    return { success: true, message, results };
  },

  useItem: (itemId) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const count = user.inventory?.[itemId as keyof typeof user.inventory] ?? 0;
    if (count <= 0) return { success: false, message: "背包裡沒有這個道具" };

    const now = Date.now();

    if (itemId === "slight_sick_potion") {
      const { pet } = get();
      if (!pet) return { success: false, message: "找不到寵物資料" };
      if (pet.healthStatus !== "slightly_sick") return { success: false, message: "小雞目前沒有生小病" };
      // 生病是「飽食度歸零」觸發的（見 petDecay.ts），治病如果沒有一併
      // 補一點飽食度，治好的下一秒（下次重新計算時）又會因為飽食度還是
      // 0 而立刻復發。補到剛好脫離「快餓死」門檻（20）之上，不算真的
      // 餵飽，但至少不會治好瞬間又生病。
      const restoredFullness = Math.max(pet.fullness, SICKNESS_CURE_MIN_FULLNESS);
      const healedPet = {
        ...pet,
        healthStatus: "normal" as const,
        sickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: { ...pet.notifiedFlags, lowFullness: false },
        updatedAt: now,
      };
      const newInventory = { ...(user.inventory ?? {}), slight_sick_potion: count - 1 };
      set({ pet: healedPet, user: { ...user, inventory: newInventory, updatedAt: now } });
      updateDoc(doc(db, "pets", user.uid), {
        healthStatus: "normal",
        sickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: healedPet.notifiedFlags,
        updatedAt: now,
      }).catch(console.error);
      setDoc(doc(db, "users", user.uid), { inventory: newInventory, updatedAt: now }, { merge: true }).catch(console.error);
      return { success: true, message: "💊 小雞的小病治好了！" };
    }

    if (itemId === "severe_sick_potion") {
      const { pet } = get();
      if (!pet) return { success: false, message: "找不到寵物資料" };
      if (pet.healthStatus !== "severely_sick") return { success: false, message: "小雞目前沒有生大病" };
      // 理由同小病藥水：不補飽食度的話，治好的瞬間又會因為飽食度是 0
      // 立刻復發生病。
      const restoredFullness = Math.max(pet.fullness, SICKNESS_CURE_MIN_FULLNESS);
      const healedPet = {
        ...pet,
        healthStatus: "normal" as const,
        sickStartTime: null,
        severeSickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: { ...pet.notifiedFlags, lowFullness: false },
        updatedAt: now,
      };
      const newInventory = { ...(user.inventory ?? {}), severe_sick_potion: count - 1 };
      set({ pet: healedPet, user: { ...user, inventory: newInventory, updatedAt: now } });
      updateDoc(doc(db, "pets", user.uid), {
        healthStatus: "normal",
        sickStartTime: null,
        severeSickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: healedPet.notifiedFlags,
        updatedAt: now,
      }).catch(console.error);
      setDoc(doc(db, "users", user.uid), { inventory: newInventory, updatedAt: now }, { merge: true }).catch(console.error);
      return { success: true, message: "🧪 小雞的大病治好了！" };
    }

    if (itemId === "revival_potion") {
      const { pet } = get();
      if (!pet) return { success: false, message: "找不到寵物資料" };
      if (pet.healthStatus !== "dead") return { success: false, message: "小雞還沒有死，不需要使用復活藥水" };

      // 保留死前所有狀態，只把 healthStatus 改回 normal，清除計時器。
      // 死亡幾乎都是飽食度長期歸零累積出來的（見 petDecay.ts），如果
      // 飽食度原封不動保留在 0，復活的下一秒又會立刻因為飽食度歸零
      // 重新生病，等於白花 700 飼料——理由跟小病/大病藥水一樣，補到
      // 安全線之上，其餘狀態（等級、XP）才是真的「保留死前所有狀態」。
      const restoredFullness = Math.max(pet.fullness, SICKNESS_CURE_MIN_FULLNESS);
      const revivedPet = {
        ...pet,
        healthStatus: "normal" as const,
        sickStartTime: null,
        severeSickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: { ...pet.notifiedFlags, lowFullness: false },
        updatedAt: now,
      };
      const newInventory = { ...(user.inventory ?? {}), revival_potion: count - 1 };
      set({
        pet: revivedPet,
        user: { ...user, inventory: newInventory, updatedAt: now },
      });
      updateDoc(doc(db, "pets", user.uid), {
        healthStatus: "normal",
        sickStartTime: null,
        severeSickStartTime: null,
        fullness: restoredFullness,
        notifiedFlags: revivedPet.notifiedFlags,
        updatedAt: now,
      }).catch(console.error);
      setDoc(doc(db, "users", user.uid), { inventory: newInventory, updatedAt: now }, { merge: true }).catch(console.error);
      return { success: true, message: "✨ 小雞復活了！所有狀態都保留下來了！" };
    }

    if (itemId === "fullness_shield") {
      const { pet } = get();
      if (!pet) return { success: false, message: "找不到寵物資料" };
      if (pet.healthStatus === "dead") return { success: false, message: "小雞已經死掉了，護盾對它沒用" };

      const currentProtection = pet.fullnessProtectionUntil ?? 0;
      if (currentProtection > now) {
        return { success: false, message: "飽食護盾還在生效中！不需要再使用" };
      }

      const newProtection = now + 3 * 24 * 60 * 60 * 1000; // 3 天
      const updatedPet = { ...pet, fullnessProtectionUntil: newProtection, updatedAt: now };
      const newInventory = { ...(user.inventory ?? {}), fullness_shield: count - 1 };
      set({ pet: updatedPet, user: { ...user, inventory: newInventory, updatedAt: now } });
      updateDoc(doc(db, "pets", user.uid), {
        fullnessProtectionUntil: newProtection,
        updatedAt: now,
      }).catch(console.error);
      setDoc(doc(db, "users", user.uid), { inventory: newInventory, updatedAt: now }, { merge: true }).catch(console.error);
      return { success: true, message: "🛡️ 飽食護盾啟動！3 天內飽食度不會下降！" };
    }

    if (itemId === "double_reward_voucher") {
      const currentExpiry = user.doubleRewardExpiry ?? 0;
      if (currentExpiry > now) return { success: false, message: "雙倍飼料券效果還在生效中！不需要再使用" };

      const newExpiry = now + 30 * 60 * 1000; // 30 分鐘
      const newInventory = { ...(user.inventory ?? {}), double_reward_voucher: count - 1 };
      const updatedUser = {
        ...user,
        inventory: newInventory,
        doubleRewardExpiry: newExpiry,
        updatedAt: now,
      };
      set({ user: updatedUser });
      setDoc(doc(db, "users", user.uid), {
        inventory: newInventory,
        doubleRewardExpiry: newExpiry,
        updatedAt: now,
      }, { merge: true }).catch(console.error);
      return { success: true, message: "🎟️ 雙倍飼料券已啟動！30 分鐘內獎勵 ×2！" };
    }

    return { success: false, message: "未知道具" };
  },

  setActiveBackground: (backgroundId) => {
    const { user } = get();
    if (!user) return;
    const updatedUser = { ...user, activeBackground: backgroundId, updatedAt: Date.now() };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      activeBackground: backgroundId ?? null,
      updatedAt: Date.now(),
    }).catch(console.error);
  },

  setActiveBoardSkin: (boardSkinId) => {
    const { user } = get();
    if (!user) return;
    const updatedUser = { ...user, activeBoardSkin: boardSkinId, updatedAt: Date.now() };
    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      activeBoardSkin: boardSkinId ?? null,
      updatedAt: Date.now(),
    }).catch(console.error);
  },

  isDoubleRewardActive: () => {
    const { user } = get();
    if (!user) return false;
    const expiry = user.doubleRewardExpiry ?? 0;
    return expiry > Date.now();
  },

  // ============================================================
  // RPG 擴充：裝備
  // ============================================================

  buyEquipment: (kind) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const bag = user.equipmentBag ?? [];
    const expandCount = user.bagExpandCount ?? 0;

    if (!canFitInBag(bag, expandCount, 1)) {
      return {
        success: false,
        message: `背包滿了（${bag.length}/${getBagCapacity(expandCount)}）。先合成幾件，或花 ${BAG_EXPAND_COST} 飼料擴充背包。`,
      };
    }
    if (user.foodCount < EQUIPMENT_SHOP_PRICE) {
      return { success: false, message: `需要 ${EQUIPMENT_SHOP_PRICE} 飼料，飼料不夠喔！` };
    }

    const now = Date.now();
    // 商店只賣劍跟盾，品質固定是標準值（只有探險掉的才有浮動）
    const item = createEquipmentItem(SHOP_TYPE_BY_KIND[kind], EQUIPMENT_SHOP_TIER, now, 0);
    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount - EQUIPMENT_SHOP_PRICE,
      totalFoodSpent: (user.totalFoodSpent ?? 0) + EQUIPMENT_SHOP_PRICE,
      equipmentBag: [...bag, item],
      bagExpandCount: expandCount,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: updatedUser.foodCount,
      totalFoodSpent: updatedUser.totalFoodSpent,
      equipmentBag: updatedUser.equipmentBag,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] buyEquipment 寫回 Firestore 失敗：", error);
    });

    return { success: true, message: `買到一件${getEquipmentName(item)}！` };
  },

  expandBag: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };
    if (user.foodCount < BAG_EXPAND_COST) {
      return { success: false, message: `擴充背包需要 ${BAG_EXPAND_COST} 飼料，飼料不夠喔！` };
    }

    const now = Date.now();
    const newExpandCount = (user.bagExpandCount ?? 0) + 1;
    const updatedUser: UserDoc = {
      ...user,
      foodCount: user.foodCount - BAG_EXPAND_COST,
      totalFoodSpent: (user.totalFoodSpent ?? 0) + BAG_EXPAND_COST,
      bagExpandCount: newExpandCount,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: updatedUser.foodCount,
      totalFoodSpent: updatedUser.totalFoodSpent,
      bagExpandCount: newExpandCount,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] expandBag 寫回 Firestore 失敗：", error);
    });

    return {
      success: true,
      message: `背包 +${BAG_EXPAND_SLOTS} 格！現在可以放 ${getBagCapacity(newExpandCount)} 件。`,
    };
  },

  fuseEquipmentItems: (itemIds) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const bag = user.equipmentBag ?? [];
    const picked = itemIds
      .map((id) => bag.find((item) => item.id === id))
      .filter((item): item is EquipmentItem => Boolean(item));

    if (picked.length !== itemIds.length) {
      return { success: false, message: "有裝備已經不在背包裡了，請重新選擇。" };
    }

    const check = checkFuse(picked);
    if (!check.ok) return { success: false, message: check.reason };

    const now = Date.now();
    const { item: newItem, returnedGems } = fuseEquipment(picked, now);
    const pickedIds = new Set(itemIds);
    const updatedBag = bag.filter((item) => !pickedIds.has(item.id)).concat(newItem);
    // 素材上鑲的寶石全部退回寶石袋
    const gemBag = addGemsToBag(user.gemBag, returnedGems);

    const fuseCount = (user.rpgFuseCount ?? 0) + 1;
    const maxTier = Math.max(user.rpgMaxTier ?? 0, newItem.tier);
    const updatedUser: UserDoc = {
      ...user,
      equipmentBag: updatedBag,
      gemBag,
      rpgFuseCount: fuseCount,
      rpgMaxTier: maxTier,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      equipmentBag: updatedBag,
      gemBag,
      rpgFuseCount: fuseCount,
      rpgMaxTier: maxTier,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] fuseEquipmentItems 寫回 Firestore 失敗：", error);
    });

    const gemNote = returnedGems.length > 0 ? `素材上的 ${returnedGems.length} 顆寶石已退回寶石袋。` : "";
    return { success: true, message: `合成出一件${getEquipmentName(newItem)}！${gemNote}` };
  },

  autoFuseBag: () => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const bag = user.equipmentBag ?? [];
    const now = Date.now();
    const result = autoFuse(bag, now);

    if (result.fuseCount === 0) {
      return { success: false, message: "沒有任何同階、同種類湊滿 3 件的裝備可以合成。" };
    }
    const gemBag = addGemsToBag(user.gemBag, result.returnedGems);

    const fuseCount = (user.rpgFuseCount ?? 0) + result.fuseCount;
    const maxTier = result.produced.reduce(
      (max, item) => Math.max(max, item.tier),
      user.rpgMaxTier ?? 0,
    );
    const updatedUser: UserDoc = {
      ...user,
      equipmentBag: result.bag,
      gemBag,
      rpgFuseCount: fuseCount,
      rpgMaxTier: maxTier,
      updatedAt: now,
    };
    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      equipmentBag: result.bag,
      gemBag,
      rpgFuseCount: fuseCount,
      rpgMaxTier: maxTier,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] autoFuseBag 寫回 Firestore 失敗：", error);
    });

    return {
      success: true,
      message: `合成了 ${result.fuseCount} 次，背包剩下 ${result.bag.length} 件。${
        result.returnedGems.length > 0 ? `${result.returnedGems.length} 顆寶石已退回寶石袋。` : ""
      }`,
    };
  },

  equipToPet: async (petId, slot, item) => {
    const { user, collectedPets } = get();
    if (!user) return { success: false, message: "找不到資料" };

    const pet = collectedPets.find((p) => p.id === petId);
    if (!pet) return { success: false, message: "找不到這隻小雞，請重新整理頁面。" };

    const bag = user.equipmentBag ?? [];
    const expandCount = user.bagExpandCount ?? 0;
    const previous = slot === "weapon" ? pet.weapon : pet.armor;

    // 型別不符的裝備不能穿進去（例如把防具塞進武器格）
    if (item && item.kind !== slot) {
      return { success: false, message: `${KIND_LABELS[slot]}格只能放${KIND_LABELS[slot]}。` };
    }

    // 要穿的那件必須真的在背包裡，避免畫面資料過期造成裝備憑空複製
    if (item && !bag.some((b) => b.id === item.id)) {
      return { success: false, message: "這件裝備已經不在背包裡了，請重新整理頁面。" };
    }

    // 卸下時要確認背包塞得下。穿新的同時卸舊的是一進一出，不會變多，
    // 所以只有「純卸下」跟「空手穿上（背包 -1）」兩種情況要檢查——
    // 前者背包 +1，後者背包 -1，只有前者可能爆。
    if (!item && previous && !canFitInBag(bag, expandCount, 1)) {
      return {
        success: false,
        message: `背包滿了（${bag.length}/${getBagCapacity(expandCount)}），沒有空間放卸下來的裝備。`,
      };
    }

    const now = Date.now();
    let updatedBag = bag;
    if (item) updatedBag = updatedBag.filter((b) => b.id !== item.id);
    if (previous) updatedBag = [...updatedBag, previous];

    const updatedUser: UserDoc = { ...user, equipmentBag: updatedBag, updatedAt: now };
    const patch: Partial<CollectedPetDoc> = slot === "weapon" ? { weapon: item } : { armor: item };

    // 先寫 Firestore 再更新畫面。換裝備牽涉兩份文件，如果先樂觀更新
    // 畫面、寫入才失敗，學生會看到一件裝備在畫面上，重新整理後卻不見。
    try {
      await Promise.all([
        updateDoc(doc(db, "users", user.uid), {
          equipmentBag: updatedBag,
          updatedAt: now,
        }),
        updateCollectedPetEquipment(user.uid, petId, patch),
      ]);
    } catch (error) {
      console.error("[useGameStore] equipToPet 寫回 Firestore 失敗：", error);
      return { success: false, message: "換裝備失敗，請檢查網路後再試一次。" };
    }

    set({ user: updatedUser });
    get().updateCollectedPetInStore(petId, patch);

    if (!item) {
      return { success: true, message: `已卸下${previous ? getEquipmentName(previous) : "裝備"}。` };
    }
    return { success: true, message: `${pet.name} 裝上了${getEquipmentName(item)}！` };
  },

  socketGemInto: async (target, gem) => {
    const state = get();
    const { user } = state;
    if (!user) return { success: false, message: "找不到資料" };
    const item = locateEquipment(state, target);
    if (!item) return { success: false, message: "找不到這件裝備，請重新整理頁面。" };
    if (getGemCount(user.gemBag, gem) <= 0) {
      return { success: false, message: `寶石袋裡沒有${GEM_TABLE[gem].name}了。` };
    }
    if (!hasFreeSocket(item)) {
      return { success: false, message: "這件裝備的孔已經滿了，先拆下一顆再鑲。" };
    }
    const updated = socketGem(item, gem);
    const gemBag = addGemsToBag(user.gemBag, [gem], -1);
    commitEquipmentChange(get, set, target, updated, gemBag, "socketGemInto");
    return { success: true, message: `鑲上了${GEM_TABLE[gem].name}（${GEM_TABLE[gem].label}）！` };
  },

  unsocketGemFrom: async (target, index) => {
    const state = get();
    const { user } = state;
    if (!user) return { success: false, message: "找不到資料" };
    const item = locateEquipment(state, target);
    if (!item) return { success: false, message: "找不到這件裝備，請重新整理頁面。" };
    const { item: updated, gem } = unsocketGem(item, index);
    if (!gem) return { success: false, message: "這個孔是空的。" };
    const gemBag = addGemsToBag(user.gemBag, [gem], 1);
    commitEquipmentChange(get, set, target, updated, gemBag, "unsocketGemFrom");
    return { success: true, message: `拆下了${GEM_TABLE[gem].name}，放回寶石袋。` };
  },

  equipToLivingPet: async (slot, item) => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };

    const bag = user.equipmentBag ?? [];
    const expandCount = user.bagExpandCount ?? 0;
    const previous = (slot === "weapon" ? pet.weapon : pet.armor) ?? null;

    if (item && item.kind !== slot) {
      return { success: false, message: `${KIND_LABELS[slot]}格只能放${KIND_LABELS[slot]}。` };
    }
    if (item && !bag.some((b) => b.id === item.id)) {
      return { success: false, message: "這件裝備已經不在背包裡了，請重新整理頁面。" };
    }
    if (!item && previous && !canFitInBag(bag, expandCount, 1)) {
      return {
        success: false,
        message: `背包滿了（${bag.length}/${getBagCapacity(expandCount)}），沒有空間放卸下來的裝備。`,
      };
    }

    const now = Date.now();
    let updatedBag = bag;
    if (item) updatedBag = updatedBag.filter((b) => b.id !== item.id);
    if (previous) updatedBag = [...updatedBag, previous];

    try {
      await Promise.all([
        updateDoc(doc(db, "users", user.uid), { equipmentBag: updatedBag, updatedAt: now }),
        updateDoc(doc(db, "pets", user.uid), {
          [slot]: item,
          updatedAt: now,
        }),
      ]);
    } catch (error) {
      console.error("[useGameStore] equipToLivingPet 寫回 Firestore 失敗：", error);
      return { success: false, message: "換裝備失敗，請檢查網路後再試一次。" };
    }

    set({
      user: { ...user, equipmentBag: updatedBag, updatedAt: now },
      pet: { ...pet, [slot]: item, updatedAt: now },
    });

    if (!item) {
      return { success: true, message: `已卸下${previous ? getEquipmentName(previous) : "裝備"}。` };
    }
    return { success: true, message: `裝上了${getEquipmentName(item)}！` };
  },

  // ============================================================
  // RPG 擴充：探險
  // ============================================================

  loadExploreProgress: async (force = false) => {
    const { user, exploreProgressLoaded } = get();
    if (!user) return;
    if (exploreProgressLoaded && !force) return;

    try {
      const progress = await fetchExploreProgress(user.uid);
      // 讀進來就先把「今天用掉幾次」正規化到台北時間的今天，
      // 不然跨日之後畫面會顯示昨天的次數
      set({ exploreProgress: normalizeDailyAttempts(progress), exploreProgressLoaded: true });
    } catch (error) {
      console.error("[useGameStore] loadExploreProgress 失敗：", error);
    }
  },

  finishExploreStage: async ({ tower, stage, won, consumedAttempt, drops, gemDrops, usedReplayLoot, petId }) => {
    const { user, exploreProgress } = get();
    if (!user || !exploreProgress) return { droppedCount: 0, bagWasFull: false };

    const now = Date.now();
    const afterStage = applyStageResult(exploreProgress, tower, stage, won, consumedAttempt);
    // 重打掉落名額：每天前 10 次贏的重打才有機會掉東西（見 lib/rpg/loot.ts）
    const nextProgress = usedReplayLoot
      ? { ...afterStage, dailyReplayLootUsed: (afterStage.dailyReplayLootUsed ?? 0) + 1 }
      : afterStage;
    // 寶石不佔背包格數，掉多少收多少
    const gemBag = gemDrops.length > 0 ? addGemsToBag(user.gemBag, gemDrops) : user.gemBag ?? {};

    // 呼叫端（探險頁）已經先依背包剩餘空間截過一次了，這裡再截一次
    // 只是防呆：萬一兩次之間背包被別的分頁塞滿，也不會超過上限。
    const bag = user.equipmentBag ?? [];
    const expandCount = user.bagExpandCount ?? 0;
    const free = getBagCapacity(expandCount) - bag.length;
    const accepted = drops.slice(0, Math.max(0, free));
    const bagWasFull = accepted.length < drops.length;

    const updatedBag = accepted.length > 0 ? [...bag, ...accepted] : bag;

    // 勳章計數器（見 types/database.ts 的說明）。全破幾座塔直接從
    // 新的進度重算，不用自己記——100 關的判斷很便宜，而且永遠不會
    // 跟真相來源對不上。
    let towersCleared = 0;
    for (let tower = 1; tower <= TOWER_COUNT; tower++) {
      if (isTowerCleared(nextProgress, tower)) towersCleared += 1;
    }

    // 每日任務「探險 N 次」的進度。只算真的扣到次數的那幾場，
    // 重打已通關的關卡不算，不然刷第 1 關就能完成任務。
    const today = getTaipeiDateString();
    const prevExplore = user.dailyExploreProgress;
    const exploreCount =
      (prevExplore?.date === today ? prevExplore.count : 0) + (consumedAttempt ? 1 : 0);
    const dailyExploreProgress = { date: today, count: exploreCount };

    const updatedUser: UserDoc = {
      ...user,
      equipmentBag: updatedBag,
      gemBag,
      rpgBossDefeated: nextProgress.bossDefeatedCount,
      rpgTowersCleared: towersCleared,
      dailyExploreProgress,
      updatedAt: now,
    };

    set({ exploreProgress: nextProgress, user: updatedUser });

    const writes: Promise<unknown>[] = [
      saveExploreProgress(nextProgress),
      updateDoc(doc(db, "users", user.uid), {
        equipmentBag: updatedBag,
        gemBag,
        rpgBossDefeated: updatedUser.rpgBossDefeated,
        rpgTowersCleared: updatedUser.rpgTowersCleared,
        dailyExploreProgress,
        updatedAt: now,
      }),
    ];
    // 出戰的是收藏小雞才累加戰績；「正在養的那隻」沒有獨立的戰績欄位
    if (petId) {
      writes.push(
        addCollectedPetRecord(user.uid, petId, {
          exploreStagesPlayed: 1,
          exploreStagesCleared: won ? 1 : 0,
        }),
      );
      get().updateCollectedPetInStore(petId, {});
    }

    try {
      await Promise.all(writes);
    } catch (error) {
      console.error("[useGameStore] finishExploreStage 寫回 Firestore 失敗：", error);
    }

    // 收藏小雞的戰績是用 increment 寫的，本地快取拿不到新值，
    // 下次進「我的小雞」頁再重讀就好
    if (petId) set({ collectedPetsLoaded: false });

    return { droppedCount: accepted.length, bagWasFull };
  },

  // ============================================================
  // RPG 擴充：戰隊
  // ============================================================

  loadTeam: async (force = false) => {
    const { user, teamLoaded } = get();
    if (!user) return;
    if (teamLoaded && !force) return;

    try {
      const team = await fetchTeam(user.uid);
      // 讀到就先正規化到「現在」：換季歸零、跨日重置挑戰次數。
      // 如果真的有變動就順便寫回去，不然學生每次開 App 都會看到
      // 正確的數字、但資料庫裡還是舊的。
      if (team) {
        const normalized = normalizeTeam(team);
        set({ team: normalized, teamLoaded: true });
        if (normalized !== team) {
          void saveTeam(normalized);
        }
      } else {
        set({ team: null, teamLoaded: true });
      }
    } catch (error) {
      console.error("[useGameStore] loadTeam 失敗：", error);
    }
  },

  createTeam: async (teamName) => {
    const { user, team } = get();
    if (!user) return { success: false, message: "找不到資料" };
    if (team) return { success: false, message: "已經有戰隊了" };

    const nameError = validateTeamName(teamName);
    if (nameError) return { success: false, message: nameError };

    const created = createDefaultTeam(user.uid, user.displayName, teamName);
    try {
      await saveTeam(created);
    } catch (error) {
      console.error("[useGameStore] createTeam 失敗：", error);
      return { success: false, message: "建立戰隊失敗，請檢查網路後再試一次。" };
    }
    set({ team: created, teamLoaded: true });
    return { success: true, message: `「${created.teamName}」成立了！` };
  },

  renameTeam: async (teamName) => {
    const { user, team } = get();
    if (!user || !team) return { success: false, message: "還沒有戰隊" };

    const nameError = validateTeamName(teamName);
    if (nameError) return { success: false, message: nameError };
    if (team.renameCountThisSeason >= 1) {
      return { success: false, message: "這一季已經改過一次隊名了，下一季才能再改。" };
    }

    const next: TeamDoc = {
      ...team,
      teamName: teamName.trim(),
      renameCountThisSeason: team.renameCountThisSeason + 1,
      updatedAt: Date.now(),
    };
    set({ team: next });
    try {
      await patchTeam(user.uid, {
        teamName: next.teamName,
        renameCountThisSeason: next.renameCountThisSeason,
      });
    } catch (error) {
      console.error("[useGameStore] renameTeam 失敗：", error);
    }
    return { success: true, message: `隊名改成「${next.teamName}」了！這一季不能再改囉。` };
  },

  saveTeamMembers: async (pets) => {
    const { user, team } = get();
    if (!user || !team) return { success: false, message: "還沒有戰隊" };

    const members = toMemberRefs(pets.slice(0, TEAM_MAX_MEMBERS));
    // 冗餘存一份總戰力給排行榜顯示用。真正對戰時仍然即時重算，
    // 不看這個欄位（對手的裝備隨時可能換）。
    const totalPower = pets.reduce((sum, p) => sum + getTotalPower(p.stats), 0);

    const next: TeamDoc = { ...team, members, totalPower, updatedAt: Date.now() };
    set({ team: next });
    try {
      await patchTeam(user.uid, { members, totalPower });
    } catch (error) {
      console.error("[useGameStore] saveTeamMembers 失敗：", error);
      return { success: false, message: "存檔失敗，請檢查網路後再試一次。" };
    }
    return { success: true, message: "編隊已儲存" };
  },

  finishTeamBattle: async ({ won, myRank, opponentRank, memberPetIds }) => {
    const { user, team } = get();
    if (!user || !team) return { delta: 0, newScore: 0 };

    const change = getScoreChange(myRank, opponentRank, team.score, won);
    const newStreak = won ? team.winStreak + 1 : 0;

    const next: TeamDoc = {
      ...team,
      score: change.newScore,
      wins: team.wins + (won ? 1 : 0),
      losses: team.losses + (won ? 0 : 1),
      winStreak: newStreak,
      bestWinStreak: Math.max(team.bestWinStreak, newStreak),
      dailyAttemptsUsed: team.dailyAttemptsUsed + 1,
      updatedAt: Date.now(),
    };
    set({ team: next });

    // 寫入丟背景跑，不要讓結算卡片等網路（跟探險同一個理由：
    // Firebase SDK 離線時會把寫入排進佇列，promise 不會 resolve）
    void patchTeam(user.uid, {
      score: next.score,
      wins: next.wins,
      losses: next.losses,
      winStreak: next.winStreak,
      bestWinStreak: next.bestWinStreak,
      dailyAttemptsUsed: next.dailyAttemptsUsed,
      dailyAttemptsDate: next.dailyAttemptsDate,
    }).catch((error) => {
      console.error("[useGameStore] finishTeamBattle 寫回 Firestore 失敗：", error);
    });

    // 勳章計數器 ＋ 每日任務「戰隊挑戰 N 次」的進度
    const today = getTaipeiDateString();
    const prevTeamProgress = user.dailyTeamBattleProgress;
    const teamCount = (prevTeamProgress?.date === today ? prevTeamProgress.count : 0) + 1;
    const dailyTeamBattleProgress = { date: today, count: teamCount };
    const rpgTeamWins = (user.rpgTeamWins ?? 0) + (won ? 1 : 0);
    const rpgTeamBestStreak = Math.max(user.rpgTeamBestStreak ?? 0, newStreak);

    set({
      user: {
        ...user,
        rpgTeamWins,
        rpgTeamBestStreak,
        dailyTeamBattleProgress,
        updatedAt: Date.now(),
      },
    });
    void updateDoc(doc(db, "users", user.uid), {
      rpgTeamWins,
      rpgTeamBestStreak,
      dailyTeamBattleProgress,
      updatedAt: Date.now(),
    }).catch((error) => {
      console.error("[useGameStore] finishTeamBattle 寫回使用者計數失敗：", error);
    });

    // 上場的收藏小雞累加戰績（「正在養的那隻」沒有獨立戰績欄位）
    for (const petId of memberPetIds) {
      void addCollectedPetRecord(user.uid, petId, {
        teamWins: won ? 1 : 0,
        teamLosses: won ? 0 : 1,
      }).catch(() => undefined);
    }
    if (memberPetIds.length > 0) set({ collectedPetsLoaded: false });

    return { delta: change.delta, newScore: change.newScore };
  },
}));
