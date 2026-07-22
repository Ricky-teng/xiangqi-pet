/**
 * src/lib/announcements.ts
 *
 * 公告「有沒有未讀」的判斷邏輯，給首頁導覽列的紅點用（比照
 * @/lib/tasks/dailyTasks.ts 的 hasUnclaimedDailyTask 寫法）。
 */

import type { UserDoc } from "@/types/database";

/**
 * @param user 目前登入的使用者
 * @param latestAnnouncementCreatedAt 目前所有公告裡最新一則的 createdAt，
 *   沒有任何公告就傳 0（見 src/app/page.tsx 怎麼抓這個值）
 */
export function hasUnreadAnnouncement(user: UserDoc, latestAnnouncementCreatedAt: number): boolean {
  if (latestAnnouncementCreatedAt <= 0) return false;
  return latestAnnouncementCreatedAt > (user.lastSeenAnnouncementsAt ?? 0);
}
