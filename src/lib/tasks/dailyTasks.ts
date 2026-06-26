/**
 * src/lib/tasks/dailyTasks.ts
 *
 * 每日任務系統（純邏輯部分）
 * ------------------------------------------------------------
 * 任務「定義」本身已經改成存在 Firestore 的 dailyTasks collection
 * （見 @/types/database.ts 的 DailyTaskDoc），老師透過 /admin/tasks
 * 後台新增/編輯/刪除，不再是寫死在這個檔案裡的固定陣列。
 *
 * 這個檔案只保留「跟任務定義內容無關」的純邏輯：完成狀態怎麼用
 * 「日期字串 + 已完成任務 id 陣列」追蹤、怎麼判斷今天有沒有未完成
 * 的任務。呼叫端（tasks/page.tsx、page.tsx 首頁）負責用 getDocs 抓出
 * 目前啟用中的任務列表，再傳進這裡的函式做比對。
 */

import type { DailyTaskDoc, UserDoc } from "@/types/database";

/** 取得「今天」的本地日期字串（YYYY-MM-DD），用瀏覽器所在時區，不是 UTC */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 取得「今天已完成的任務 id 列表」。如果使用者的 dailyTaskProgress
 * 記錄的日期不是今天（或完全沒有這個欄位），代表還沒跨過今天的任何
 * 任務紀錄，回傳空陣列（全部視為尚未完成）。
 */
export function getTodaysCompletedTaskIds(user: UserDoc): string[] {
  const today = getTodayDateString();
  if (!user.dailyTaskProgress || user.dailyTaskProgress.date !== today) {
    return [];
  }
  return user.dailyTaskProgress.completedTaskIds;
}

/**
 * 今天還有沒有任何一個（啟用中的）任務尚未完成，給首頁顯示「有任務
 * 可以領」的紅點提示用。activeTasks 由呼叫端先用 getDocs 篩
 * isActive == true 撈出來，這個函式不會自己連 Firestore。
 */
export function hasUnclaimedDailyTask(user: UserDoc, activeTasks: DailyTaskDoc[]): boolean {
  const completedToday = getTodaysCompletedTaskIds(user);
  return activeTasks.some((task) => !completedToday.includes(task.id));
}
