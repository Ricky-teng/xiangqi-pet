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
