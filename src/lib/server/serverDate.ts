/**
 * src/lib/server/serverDate.ts
 *
 * 伺服器端的「今天」日期字串
 * ------------------------------------------------------------
 * 不能直接用 lib/tasks/dailyTasks.ts 的 getTodayDateString()——那支是
 * 用「執行環境的本地時區」算的，在瀏覽器上是學生所在時區（台灣）沒問
 * 題，但在 Vercel 的伺服器上是 UTC，會跟台灣差 8 小時。
 *
 * 影響很實際：學生在台灣時間早上 7 點投稿，UTC 還是前一天的 23 點，
 * 伺服器會把進度記在「昨天」，學生端用台灣時間去比對就會看到進度是 0，
 * 每日任務永遠領不到。
 *
 * 所以伺服器端一律用明確指定的 Asia/Taipei 來算，跟學生端的本地時間
 * 對得起來。
 */

const TAIPEI_TIME_ZONE = "Asia/Taipei";

/** 取得台北時區的「今天」日期字串（YYYY-MM-DD） */
export function getTaipeiDateString(date: Date = new Date()): string {
  // en-CA 的日期格式剛好就是 YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
