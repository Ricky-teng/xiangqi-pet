/**
 * src/lib/pasture.ts
 *
 * 牧場功能共用常數。
 */

/** 一間牧場最多容納幾人（滿了自動分流到新的一間，見 /api/pasture/join） */
export const MAX_PASTURE_MEMBERS = 20;

/**
 * 牧場經濟（見 UserDoc.pastureEconomy）：
 * - PASTURE_ENTRY_FEE：每天第一次進牧場要付的入場費。
 * - PASTURE_HOURLY_INCOME：入場後，每經過一個整小時補發的被動收入。
 * - PASTURE_DAILY_INCOME_CAP：被動收入單日上限，超過就不再增加
 *   （200 / 20 = 最多算到 10 小時份，之後就算一直沒登入也不會繼續累積）。
 * 每天 00:00（本地時間，見 getTodayDateString）重置，重新收一次入場費。
 */
export const PASTURE_ENTRY_FEE = 50;
export const PASTURE_HOURLY_INCOME = 20;
export const PASTURE_DAILY_INCOME_CAP = 200;

/**
 * 找蟲子小遊戲：草地上會冒出可以點的蟲，點到給 PASTURE_BUG_CATCH_REWARD_FOOD
 * 飼料，每天最多抓 PASTURE_BUG_CATCH_DAILY_LIMIT 次，達到上限後蟲子
 * 還是會出現，但點了不會再有效果（前端會停止生成新的蟲）。
 */
export const PASTURE_BUG_CATCH_REWARD_FOOD = 5;
export const PASTURE_BUG_CATCH_DAILY_LIMIT = 5;

/** 送表情可以選的幾個表情，純娛樂用，跟拍拍一樣算一次牧場互動 */
export const PASTURE_POKE_EMOJIS = ["👋", "❤️", "😄", "👍", "🎉"] as const;

/**
 * 拍拍 / 送表情的每日總次數上限（不分對象，是全部加起來的次數）：
 * 拍拍一天只能拍 1 次，送表情一天最多 5 次。
 */
export const PASTURE_PAT_DAILY_LIMIT = 1;
export const PASTURE_EMOJI_DAILY_LIMIT = 5;
