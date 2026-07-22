// src/stores/useGameStore.ts
import { create } from "zustand";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserDoc, PetDoc, DailyTaskDoc } from "@/types/database";
import { resolveStageForXp } from "@/lib/pet/petGrowth";
import { LOW_FULLNESS_THRESHOLD as SICKNESS_CURE_MIN_FULLNESS } from "@/lib/pet/petDecay";
import { CATALOG_ENTRIES, getNextCatalogEntry, getXpNeededForNextJob, isMaxJobLevel } from "@/lib/pet/catalog";
import { getTodayDateString, getTodaysCompletedTaskIds } from "@/lib/tasks/dailyTasks";
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
import { findNewlyEarnedBadges, type BadgeDefinition } from "@/lib/badges/badges";

// 定義我們遊戲總機裡面有哪些資料與開關
interface GameStoreState {
  // 核心狀態
  user: UserDoc | null;
  pet: PetDoc | null;
  isLoading: boolean;

  // 修改資料的動作（Actions）
  setUser: (user: UserDoc | null) => void;
  setPet: (pet: PetDoc | null) => void;
  setLoading: (isLoading: boolean) => void;

  /**
   * 全域「小雞狀態警示」訊息（例如：太久沒醫治，病情加重了）。
   * 由 usePetTimeDecayTicker 在偵測到時間流逝造成的狀態變化時設定，
   * <PetAlertBanner> 元件（掛在 AuthProvider 裡，全站都會顯示）負責呈現。
   */
  petAlertMessage: string | null;
  setPetAlertMessage: (message: string | null) => void;
  
  // 學生本地即時互動邏輯（在寫入 Firebase 之前，前端畫面先動）
  feedPet: () => void;
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
   * 轉生：小雞必須在 master（大師雞）階段，且已經轉職到最後一款
   * （鳳凰雞）才能呼叫。免費。重置小雞回到蛋的狀態（含職業歸零），
   * rebirthCount + 1。圖鑑蒐集紀錄（unlockedCatalogIds）不受影響。
   */
  rebirthPet: () => { success: boolean; message: string };

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
  checkAndAwardBadges: () => BadgeDefinition[];

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
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  user: null,
  pet: null,
  // 初始值為 true：代表「登入狀態尚未檢查完成」，由 useAuthBootstrap
  // 的 onAuthStateChanged 第一次回呼觸發後改為 false（不論是否登入）。
  // RequireAuth 元件依此判斷要顯示載入畫面還是導向 /login。
  isLoading: true,

  setUser: (user) => set({ user }),
  setPet: (pet) => set({ pet }),
  setLoading: (isLoading) => set({ isLoading }),

  petAlertMessage: null,
  setPetAlertMessage: (petAlertMessage) => set({ petAlertMessage }),

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

    // 飽食度 +5 (上限 100)，XP +10
    const newXp = pet.xp + 10;
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
  // 真正把小雞整隻重置回蛋（含職業歸零），rebirthCount + 1。
  rebirthPet: () => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };
    if (pet.stage !== "master") {
      return { success: false, message: "小雞還沒長大成熟（大師雞），無法轉生。" };
    }
    if (!isMaxJobLevel(pet.currentAppearanceId)) {
      const finalEntry = CATALOG_ENTRIES[CATALOG_ENTRIES.length - 1];
      return { success: false, message: `要先轉職到「${finalEntry.name}」才能轉生喔，繼續加油！` };
    }

    const now = Date.now();
    const newRebirthCount = user.rebirthCount + 1;

    const updatedUser: UserDoc = {
      ...user,
      rebirthCount: newRebirthCount,
      updatedAt: now,
    };

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
      notifiedFlags: { lowFullness: false, slightlySick: false, severelySick: false, dead: false },
      currentAppearanceId: null,
      updatedAt: now,
    };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        rebirthCount: updatedUser.rebirthCount,
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
        notifiedFlags: updatedPet.notifiedFlags,
        currentAppearanceId: null,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] rebirthPet 同步寫回 Firestore 失敗：", error);
    });

    return { success: true, message: "轉生成功！小雞重新回到蛋，準備從小兵雞開始新一輪的旅程！" };
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
      notifiedFlags: { lowFullness: false, slightlySick: false, severelySick: false, dead: false },
      currentAppearanceId: null,
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
        notifiedFlags: updatedPet.notifiedFlags,
        currentAppearanceId: null,
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
    // 簽到可能剛好達成「初來乍到」「七日不輟」這類勳章條件，簽到動作
    // 本身結算完（set 完 user）之後才檢查，這樣 checkAndAwardBadges
    // 讀到的 user.checkinHistory 才是最新的。
    get().checkAndAwardBadges();
    return { success: true, message: msg, alreadyDone: false };
  },

  // 6.55 成就勳章：檢查 + 發放 + 存檔（見 @/lib/badges/badges.ts 的說明）
  checkAndAwardBadges: () => {
    const { user } = get();
    if (!user) return [];

    const newlyEarned = findNewlyEarnedBadges(user);
    if (newlyEarned.length === 0) return [];

    const now = Date.now();
    const newEarnedBadgeIds = Array.from(
      new Set([...(user.earnedBadgeIds ?? []), ...newlyEarned.map((b) => b.id)])
    );
    const updatedUser: UserDoc = { ...user, earnedBadgeIds: newEarnedBadgeIds, updatedAt: now };

    set({ user: updatedUser });
    updateDoc(doc(db, "users", user.uid), {
      earnedBadgeIds: newEarnedBadgeIds,
      updatedAt: now,
    }).catch((error) => {
      console.error("[useGameStore] checkAndAwardBadges 同步寫回 Firestore 失敗：", error);
    });

    return newlyEarned;
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

    // 可能剛好達成「初戰告捷」這類跟對弈電腦戰績有關的勳章條件
    get().checkAndAwardBadges();

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
}));
