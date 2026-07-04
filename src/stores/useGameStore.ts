// src/stores/useGameStore.ts
import { create } from "zustand";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { UserDoc, PetDoc, DailyTaskDoc } from "@/types/database";
import { resolveStageForXp } from "@/lib/pet/petGrowth";
import { getCatalogEntryForRebirthCount } from "@/lib/pet/catalog";
import { getTodayDateString, getTodaysCompletedTaskIds } from "@/lib/tasks/dailyTasks";
import {
  calculateWinRewardFood,
  LOSE_PENALTY_FOOD,
  DRAW_REWARD_FOOD,
  type ComputerLevel,
} from "@/lib/engine/computerPlayer";

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
   * 轉生：小雞必須在 master（大師雞）階段才能呼叫。
   * 重置小雞回到蛋的狀態，rebirthCount + 1，並依新的轉生次數
   * 解鎖對應的圖鑑款式（見 @/lib/pet/catalog.ts）。
   */
  rebirthPet: () => { success: boolean; message: string };

  /**
   * 復活：小雞必須在 dead（死亡）狀態才能呼叫，跟「轉生」是兩個不同的
   * 機制——轉生是「養到大師雞、主動選擇重來」的成就型獎勵（會解鎖圖鑑）；
   * 復活是「沒照顧好、小雞死掉了」的補救措施，純粹讓小雞重新從蛋開始，
   * 不會解鎖圖鑑款式、不會增加 rebirthCount。需要花費飼料。
   */
  resurrectPet: () => { success: boolean; message: string };

  /**
   * 領取每日任務獎勵。任務定義現在存在 Firestore（DailyTaskDoc），
   * 由呼叫端（tasks/page.tsx）先用 getDocs 抓到完整任務物件後傳進來，
   * 這裡不再自己查表，只負責「能不能領、領了之後怎麼更新資料」這層邏輯。
   * 同一個任務同一天只能領一次，跨天后會重置。
   */
  claimDailyTask: (task: DailyTaskDoc) => { success: boolean; message: string };

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

  // 4. 轉生（圖鑑收藏系統）
  // user.rebirthCount / unlockedCatalogIds、pet.currentAppearanceId
  // 這三個欄位本來就存在於型別定義裡，這裡是第一次真正寫入它們。
  rebirthPet: () => {
    const { user, pet } = get();
    if (!user || !pet) return { success: false, message: "找不到資料" };
    if (pet.stage !== "master") {
      return { success: false, message: "小雞還沒長大成熟（大師雞），無法轉生。" };
    }

    const newRebirthCount = user.rebirthCount + 1;
    const unlockedEntry = getCatalogEntryForRebirthCount(newRebirthCount);
    const now = Date.now();

    const newUnlockedCatalogIds = unlockedEntry
      ? Array.from(new Set([...user.unlockedCatalogIds, unlockedEntry.id]))
      : user.unlockedCatalogIds;

    const updatedUser: UserDoc = {
      ...user,
      rebirthCount: newRebirthCount,
      unlockedCatalogIds: newUnlockedCatalogIds,
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
      currentAppearanceId: unlockedEntry ? unlockedEntry.id : pet.currentAppearanceId,
      updatedAt: now,
    };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        rebirthCount: updatedUser.rebirthCount,
        unlockedCatalogIds: updatedUser.unlockedCatalogIds,
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
        currentAppearanceId: updatedPet.currentAppearanceId,
        updatedAt: now,
      }),
    ]).catch((error) => {
      console.error("[useGameStore] rebirthPet 同步寫回 Firestore 失敗：", error);
    });

    return {
      success: true,
      message: unlockedEntry
        ? `轉生成功！解鎖了新圖鑑款式：${unlockedEntry.name}！`
        : "轉生成功！你已經蒐集完所有圖鑑款式了，太強了！",
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
      updatedAt: now,
    };

    // 復活後重新從蛋開始（跟死亡前養到哪個階段無關），不增加
    // rebirthCount、不解鎖圖鑑款式——這是補救措施，不是成就獎勵。
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
      updatedAt: now,
    };

    set({ user: updatedUser, pet: updatedPet });

    Promise.all([
      updateDoc(doc(db, "users", user.uid), {
        foodCount: updatedUser.foodCount,
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

  // 7. 對弈電腦結算
  applyVsComputerResult: (outcome, opponentLevel) => {
    const { user } = get();
    if (!user) return { success: false, message: "找不到資料", foodDelta: 0 };

    const winRewardFood = calculateWinRewardFood(opponentLevel, user.chessLevel);
    const foodDelta = outcome === "win" ? winRewardFood : outcome === "draw" ? DRAW_REWARD_FOOD : -LOSE_PENALTY_FOOD;

    // 飼料不會扣到負數，避免顯示出奇怪的負數庫存
    const newFoodCount = Math.max(0, user.foodCount + foodDelta);
    const now = Date.now();

    const updatedUser: UserDoc = {
      ...user,
      foodCount: newFoodCount,
      updatedAt: now,
    };

    set({ user: updatedUser });

    updateDoc(doc(db, "users", user.uid), {
      foodCount: newFoodCount,
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

    return { success: true, message, foodDelta };
  },

  claimDailyGrant: () => {
    const { user } = get();
    if (!user) return { granted: false };

    const DAILY_GRANT_AMOUNT = 50;
    const BATTLE_ENTRY_COST = 50;
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
}));
