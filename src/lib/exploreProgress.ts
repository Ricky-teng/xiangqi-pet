// src/lib/exploreProgress.ts

/**
 * 探險進度的 Firestore 讀寫
 * ------------------------------------------------------------
 * 路徑：users/{uid}/rpg/explore（固定文件 id 的單一文件）
 *
 * 放在子集合底下的固定文件、而不是塞進使用者主文件，是因為探險進度
 * 每打完一關就要寫一次，跟 user 文件分開可以避免每場戰鬥都讓所有
 * 訂閱 user 的畫面重新渲染。
 *
 * 進度永久累積，賽季結束不歸零。
 */

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getTaipeiDateString } from "@/lib/server/serverDate";
import {
  STAGES_PER_TOWER,
  TOWER_COUNT,
  getStageKey,
} from "@/lib/rpg/monsters";
import type { ExploreProgressDoc } from "@/types/rpg";
import { createDefaultExploreProgress } from "@/types/rpg";

function exploreDocRef(uid: string) {
  return doc(db, "users", uid, "rpg", "explore");
}

/**
 * 讀出探險進度；沒有的話回傳一份預設值（但不寫進 Firestore——
 * 等到真的打了第一關才寫，避免只是點進頁面看看就產生一堆空文件）。
 */
export async function fetchExploreProgress(uid: string): Promise<ExploreProgressDoc> {
  const snapshot = await getDoc(exploreDocRef(uid));
  const now = Date.now();
  if (!snapshot.exists()) {
    return createDefaultExploreProgress(uid, now, getTaipeiDateString());
  }
  const data = snapshot.data() as Partial<ExploreProgressDoc>;
  // 逐欄補預設值：這份文件是隨功能長出來的，未來加欄位時舊資料不會爆
  return {
    uid,
    clearedStageKeys: data.clearedStageKeys ?? [],
    unlockedTower: data.unlockedTower ?? 1,
    bossDefeatedCount: data.bossDefeatedCount ?? 0,
    dailyAttemptsUsed: data.dailyAttemptsUsed ?? 0,
    dailyAttemptsDate: data.dailyAttemptsDate ?? getTaipeiDateString(),
    updatedAt: data.updatedAt ?? now,
  };
}

/** 整份寫回。欄位不多，每次全寫比較不容易出現半套狀態 */
export async function saveExploreProgress(progress: ExploreProgressDoc): Promise<void> {
  await setDoc(exploreDocRef(progress.uid), { ...progress, updatedAt: Date.now() });
}

// ============================================================
// 純邏輯：這些不碰 Firestore，方便測試也方便 UI 直接用
// ============================================================

/**
 * 把「今天用掉幾次」正規化到台北時間的今天。跨日之後自動歸零。
 * 每次讀進度、每次要扣次數之前都先過這一層。
 */
export function normalizeDailyAttempts(
  progress: ExploreProgressDoc,
  today: string = getTaipeiDateString(),
): ExploreProgressDoc {
  if (progress.dailyAttemptsDate === today) return progress;
  return { ...progress, dailyAttemptsUsed: 0, dailyAttemptsDate: today };
}

/** 這一關通關過了沒 */
export function isStageCleared(progress: ExploreProgressDoc, tower: number, stage: number): boolean {
  return progress.clearedStageKeys.includes(getStageKey(tower, stage));
}

/** 這座塔解鎖了沒 */
export function isTowerUnlocked(progress: ExploreProgressDoc, tower: number): boolean {
  return tower <= progress.unlockedTower;
}

/** 這座塔全破了沒（10 關都通關） */
export function isTowerCleared(progress: ExploreProgressDoc, tower: number): boolean {
  for (let stage = 1; stage <= STAGES_PER_TOWER; stage++) {
    if (!isStageCleared(progress, tower, stage)) return false;
  }
  return true;
}

/** 某座塔通關了幾關，畫縮圖清單上的進度用 */
export function getTowerClearedCount(progress: ExploreProgressDoc, tower: number): number {
  let count = 0;
  for (let stage = 1; stage <= STAGES_PER_TOWER; stage++) {
    if (isStageCleared(progress, tower, stage)) count += 1;
  }
  return count;
}

/**
 * 這一關現在能不能打。
 *
 * 規則：塔要先解鎖；同一座塔裡面必須依序打（第 1 關或前一關通關過）。
 * 已經通關的關卡隨時可以重打。
 */
export function canPlayStage(
  progress: ExploreProgressDoc,
  tower: number,
  stage: number,
): boolean {
  if (!isTowerUnlocked(progress, tower)) return false;
  if (isStageCleared(progress, tower, stage)) return true;
  if (stage === 1) return true;
  return isStageCleared(progress, tower, stage - 1);
}

/**
 * 打完一關之後算出「新的進度」。純函式，不寫 Firestore——呼叫端
 * 拿到結果才決定要不要存（例如打輸了就只有次數要扣）。
 *
 * @param consumedAttempt 這一場有沒有扣掉每日次數（重打已通關的關卡不扣）
 */
export function applyStageResult(
  progress: ExploreProgressDoc,
  tower: number,
  stage: number,
  won: boolean,
  consumedAttempt: boolean,
): ExploreProgressDoc {
  const today = getTaipeiDateString();
  let next = normalizeDailyAttempts(progress, today);

  if (consumedAttempt) {
    next = { ...next, dailyAttemptsUsed: next.dailyAttemptsUsed + 1 };
  }

  if (!won) return { ...next, updatedAt: Date.now() };

  const key = getStageKey(tower, stage);
  const isFirstClear = !next.clearedStageKeys.includes(key);

  if (isFirstClear) {
    next = {
      ...next,
      clearedStageKeys: [...next.clearedStageKeys, key],
      // 每一關最後都有 Boss，所以通關就等於打倒一隻 Boss
      bossDefeatedCount: next.bossDefeatedCount + 1,
    };
  }

  // 通關某座塔的第 10 關，就解鎖下一座塔
  if (stage === STAGES_PER_TOWER && tower === next.unlockedTower && tower < TOWER_COUNT) {
    next = { ...next, unlockedTower: tower + 1 };
  }

  return { ...next, updatedAt: Date.now() };
}
