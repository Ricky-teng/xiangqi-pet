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

/** 快速輸入用的常用 emoji（象棋/校園主題為主，混一些常見表情） */
export const CHAT_QUICK_EMOJIS = [
  "😀", "😂", "😍", "🥳", "😎", "🤔", "😢", "😡",
  "👍", "👏", "🙏", "💪", "❤️", "🔥", "⭐", "🎉",
  "♟️", "🐔", "🏆", "⚔️", "🎁", "😴", "😱", "🙌",
];
