/**
 * src/lib/chat.ts
 *
 * 好友聊天共用工具
 * ------------------------------------------------------------
 * chatId 用兩個 uid 字母排序後接起來，這樣不管是誰先開聊天室，
 * 同一對好友永遠對應同一個 chatId，不會產生兩份重複的聊天紀錄。
 */

export function getChatId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join("_");
}

/** 一則聊天訊息文字上限（純防呆，避免有人貼超長文字塞爆畫面/資料庫） */
export const CHAT_MESSAGE_MAX_LENGTH = 300;

/**
 * 聊天記錄只保留半年：開聊天室時只會撈「半年內」的訊息（見
 * chat/[friendUid]/page.tsx 的 messagesQuery），超過半年的訊息還在
 * Firestore 裡、只是不會被撈出來顯示——這是故意的簡化（見對話裡的
 * 說明：真的刪除舊訊息需要額外的 batch delete 或排程，這裡先用
 * 「查詢範圍」擋住越聊越貴的讀取量就好）。
 */
export const CHAT_HISTORY_RETENTION_MS = 180 * 24 * 60 * 60 * 1000; // 180 天

/** 快速輸入用的常用 emoji（象棋/校園主題為主，混一些常見表情） */
export const CHAT_QUICK_EMOJIS = [
  "😀", "😂", "😍", "🥳", "😎", "🤔", "😢", "😡",
  "👍", "👏", "🙏", "💪", "❤️", "🔥", "⭐", "🎉",
  "♟️", "🐔", "🏆", "⚔️", "🎁", "😴", "😱", "🙌",
];
