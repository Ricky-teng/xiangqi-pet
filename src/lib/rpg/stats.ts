// src/lib/rpg/stats.ts

/**
 * RPG 擴充：小雞四項數值的計算
 * ------------------------------------------------------------
 * 這個檔案是「一隻小雞到底多強」的唯一真相來源。探險、戰隊、排行榜
 * 顯示的總戰力，全部都從這裡算出來，畫面層不准自己算。
 *
 * 計算順序（很重要，順序錯數字就不對）：
 *   1. 基礎值（BASE_STATS）＋ 裝備加成（武器加攻擊、防具加防禦與 HP）
 *   2. × 職業係數（優勢項看 JOB_ADVANTAGE_MULTIPLIER_BY_STAT；未轉職四項全 0.8）
 *   3. × (1 − 生大病懲罰)（每次大病 −1%，上限 −15%）
 *
 * ⚠️ 職業係數是「最後才乘」的，這一點很重要，而且是模擬跑出來才改的。
 * 一開始寫成「基礎 × 職業 ＋ 裝備」，結果是：第 5 階武器 +780 攻擊，
 * 把攻擊職業的 ×1.3 稀釋成只差 4%；HP 跟防禦同理。但裝備完全不加
 * 速度，所以速度職業的優勢完全沒被稀釋 —— 模擬出來的結果是三三混戰
 * 時速度隊打贏其他所有隊型 100%，防禦隊輸給所有人（0~3%），
 * 「8 種職業一樣強」整個破功。改成最後才乘之後，職業差異在每一階
 * 都維持相同比例，不會被裝備吃掉。
 *
 * 職業係數的四項總和都是 4.0（見 getJobMultipliers），所以 8 種職業
 * 帳面上的總量一樣，只是分配不同。
 *
 * 「正在生病中」不額外扣數值——生病的代價只有那個永久的 −1%，而且
 * 只有生「大病」才算（小病醫好不留疤）。
 */

import type { CombatTraits, EquipmentItem } from "@/lib/rpg/equipment";
import { getEquipmentBonus, getEquipmentSpeedPct, getGemStatPercents } from "@/lib/rpg/equipment";

// ============================================================
// 1. 型別與基礎常數
// ============================================================

/** 四項數值的 key，給迴圈跟 UI 逐項渲染用 */
export type PetStatKey = "hp" | "attack" | "defense" | "speed";

/** 四項數值的顯示順序（UI 橫條圖就照這個順序畫） */
export const PET_STAT_KEYS: PetStatKey[] = ["hp", "attack", "defense", "speed"];

/** 四項數值的中文名稱 */
export const PET_STAT_LABELS: Record<PetStatKey, string> = {
  hp: "體力",
  attack: "攻擊",
  defense: "防禦",
  speed: "速度",
};

export interface PetStats {
  /** 體力：歸零就倒下 */
  hp: number;
  /** 攻擊：決定傷害 */
  attack: number;
  /** 防禦：減少受到的傷害 */
  defense: number;
  /** 速度：決定出手頻率，速度 50 = 每秒 1 下 */
  speed: number;
}

/** 均衡雞（所有係數都是 1.0 時）的基礎數值 */
export const BASE_STATS: PetStats = {
  hp: 500,
  attack: 100,
  defense: 50,
  speed: 50,
};

/** 速度換算成「每秒出手幾次」的基準：速度 50 = 每秒 1 下 */
export const SPEED_PER_ATTACK_PER_SECOND = 50;

// ============================================================
// 2. 職業係數
// ============================================================

/**
 * 各項「優勢職業」的倍率。
 *
 * ⚠️ 四項的數字刻意不一樣，這組數字是用 scripts/rpg-balance-sim.ts
 * 跑三三混戰、座標下降調出來的，不是拍腦袋填的。原本四項統一 ×1.3
 * 的版本，模擬結果是速度隊打贏所有隊型 100%、防禦隊輸給所有人
 * （0~3%）。原因是每一項「+30%」換到的實際戰力完全不同：
 *
 *   - 攻擊 +15% 就是傷害 +15%，最直接，所以給最少
 *   - 防禦因為傷害公式是 攻擊×100÷(100+防禦)，高防禦區邊際效益
 *     嚴重遞減，要給到 ×1.55 才追得上其他三項
 *   - 速度在混戰裡是超線性的（出手多 → 先殺掉一隻 → 對方輸出直接
 *     少三分之一 → 滾雪球），但因為裝備完全不加速度，所以給的
 *     倍率雖然看起來不高，實際貢獻剛好
 *   - HP 介於攻擊與防禦之間
 *
 * 調完之後的三三混戰結果，第 1 階跟第 5 階幾乎一模一樣（這就是目標，
 * 代表平衡不會隨裝備階級跑掉），而且是漂亮的互相剋制：
 *
 *   三攻 打贏 三防（66~74%），對 三速／均衡 五五波
 *   三防 被 三攻 剋，但完克 三速（92~100%）
 *   三血 完克 三速（100%）也吃 均衡（69~71%）
 *   三速 被 三防／三血 剋，對 三攻／均衡 五五波
 *
 * 大部分對戰落在 40~70%，沒有任何一種隊型打得贏所有人。
 *
 * 改這裡的任何一個數字，都要重跑一次模擬腳本確認沒有把平衡打壞。
 * 這組數字對速度特別敏感：速×1.20 時三速的平均勝率是 31%，
 * 調到 1.24 就跳到 85%，不要憑感覺微調。
 */
export const JOB_ADVANTAGE_MULTIPLIER_BY_STAT: Record<PetStatKey, number> = {
  hp: 1.25,
  attack: 1.15,
  defense: 1.9,
  speed: 1.2,
};

/** 非優勢三項一律乘這個 */
export const JOB_OTHER_MULTIPLIER = 0.9;

/** 還沒轉職過的小雞，四項全部乘這個 */
export const NO_JOB_MULTIPLIER = 0.8;

/**
 * 每個職業的優勢項。職業 id 跟 lib/pet/catalog.ts 的 CATALOG_ENTRIES
 * 完全一致，新增職業時兩邊都要補。
 *
 * 設計上刻意讓四項各有兩個職業擅長，不會有哪一項沒人要：
 *   HP   → 小兵、將軍
 *   攻擊 → 炮兵、戰車
 *   防禦 → 巨象、仕官
 *   速度 → 馬伕、鳳凰
 */
export const JOB_ADVANTAGE_STAT: Record<string, PetStatKey> = {
  pawn: "hp",
  cannon: "attack",
  horse: "speed",
  chariot: "attack",
  elephant: "defense",
  advisor: "defense",
  general: "hp",
  phoenix: "speed",
};

/**
 * 取得某個職業的四項係數。jobId 傳 null（還沒轉職）或是表上沒有的
 * 值，一律回傳未轉職的 0.8。
 */
export function getJobMultipliers(jobId: string | null): PetStats {
  const advantage = jobId ? JOB_ADVANTAGE_STAT[jobId] : undefined;

  if (!advantage) {
    return {
      hp: NO_JOB_MULTIPLIER,
      attack: NO_JOB_MULTIPLIER,
      defense: NO_JOB_MULTIPLIER,
      speed: NO_JOB_MULTIPLIER,
    };
  }

  const advantageValue = JOB_ADVANTAGE_MULTIPLIER_BY_STAT[advantage];
  const otherValue = JOB_OTHER_MULTIPLIER;

  return {
    hp: advantage === "hp" ? advantageValue : otherValue,
    attack: advantage === "attack" ? advantageValue : otherValue,
    defense: advantage === "defense" ? advantageValue : otherValue,
    speed: advantage === "speed" ? advantageValue : otherValue,
  };
}

// ============================================================
// 3. 生大病懲罰
// ============================================================

/** 每生一次大病，四項一起扣的比例 */
export const SEVERE_SICK_PENALTY_PER_COUNT = 0.01;
/** 生大病懲罰的上限（扣再多也只扣到這裡） */
export const SEVERE_SICK_PENALTY_MAX = 0.15;

/**
 * 依「生過幾次大病」算出要扣的比例（0 ~ 0.15）。
 * 小雞死掉復活後這個計數會歸零，所以這裡只要處理 0 以上的數字。
 */
export function getSevereSickPenalty(severeSickCount: number): number {
  const safeCount = Math.max(0, Math.floor(severeSickCount || 0));
  return Math.min(SEVERE_SICK_PENALTY_MAX, safeCount * SEVERE_SICK_PENALTY_PER_COUNT);
}

/** 給 UI 顯示用：回傳像 "−3%" 這樣的字串，沒扣就回 null */
export function getSevereSickPenaltyLabel(severeSickCount: number): string | null {
  const penalty = getSevereSickPenalty(severeSickCount);
  if (penalty <= 0) return null;
  return `−${Math.round(penalty * 100)}%`;
}

// ============================================================
// 4. 主計算：裸裝數值
// ============================================================

/**
 * 算出一隻小雞「沒穿裝備」時的四項數值。
 * 只是 getFinalStats 在武器防具都是 null 時的特例，給「我的小雞」
 * 詳細頁顯示「裸裝 / 穿上裝備後」的對照用。
 *
 * @param jobId            目前職業（PetDoc.currentAppearanceId / CollectedPetDoc.jobId），
 *                         null 代表還沒轉職
 * @param severeSickCount  生過幾次大病
 */
export function getBareStats(jobId: string | null, severeSickCount: number): PetStats {
  return getFinalStats(jobId, severeSickCount, null, null);
}

// ============================================================
// 5. 加上裝備
// ============================================================

/**
 * 主計算：
 *   ① (基礎 ＋ 裝備固定值)          裝備固定值已含種類倍率跟品質
 *   ② 速度 × (1 ＋ 裝備的速度 ±%)    匕首、皮甲加速；斧、重甲減速
 *   ③ × 職業倍率 × (1 − 生病懲罰)
 *   ④ × (1 ＋ 寶石 %)                紅寶石攻擊、藍寶石防禦、翡翠體力、黃晶速度
 *
 * 職業倍率放在裝備之後乘是平衡模擬的結論（見 claude/rpg-balance-numbers.md）；
 * 寶石放最後，讓「鑲 1 顆紅寶石 = 攻擊 +4%」對學生來說是字面上的意思。
 * 畫面上所有「這隻小雞多強」的地方都叫這一個。
 *
 * weapon / armor 傳 null 代表那個欄位空著（防具可以不穿，但出戰
 * 必須有武器，這個檢查在呼叫端做，不在這裡）。
 */
export function getFinalStats(
  jobId: string | null,
  severeSickCount: number,
  weapon: EquipmentItem | null,
  armor: EquipmentItem | null,
): PetStats {
  const weaponBonus = getEquipmentBonus(weapon);
  const armorBonus = getEquipmentBonus(armor);
  const multipliers = getJobMultipliers(jobId);
  const sickScale = 1 - getSevereSickPenalty(severeSickCount);
  const speedScale = Math.max(0.3, 1 + getEquipmentSpeedPct(weapon) + getEquipmentSpeedPct(armor));
  const gems = getGemStatPercents(weapon, armor);

  const raw: PetStats = {
    hp: BASE_STATS.hp + weaponBonus.hp + armorBonus.hp,
    attack: BASE_STATS.attack + weaponBonus.attack + armorBonus.attack,
    defense: BASE_STATS.defense + weaponBonus.defense + armorBonus.defense,
    speed: (BASE_STATS.speed + weaponBonus.speed + armorBonus.speed) * speedScale,
  };

  return {
    hp: Math.round(raw.hp * multipliers.hp * sickScale * (1 + gems.hp)),
    attack: Math.round(raw.attack * multipliers.attack * sickScale * (1 + gems.attack)),
    defense: Math.round(raw.defense * multipliers.defense * sickScale * (1 + gems.defense)),
    speed: Math.round(raw.speed * multipliers.speed * sickScale * (1 + gems.speed)),
  };
}

/**
 * 總戰力：把四項壓成一個數字給排行榜跟卡片顯示用。
 *
 *   總戰力 = HP ÷ 5 ＋ 攻擊 ＋ 防禦 ＋ 速度
 *
 * HP 要除以 5 的原因：HP 的絕對值比其他三項大一個數量級（500 對 50），
 * 不除的話總戰力等於只在看 HP，防具會變得不合理地重要。除以 5 之後
 * 四項對總戰力的貢獻大致相當。
 *
 * 這個數字只用於顯示與排序，戰鬥實際結果一律以四項分開計算為準——
 * 總戰力高不保證打得贏（攻高防低的可能被肉盾磨死）。
 */
export function getTotalPower(stats: PetStats, traits?: CombatTraits | null): number {
  const base = stats.hp / 5 + stats.attack + stats.defense + stats.speed;
  if (!traits) return Math.round(base);
  return Math.round(base + getTraitPowerBonus(stats, traits));
}

/**
 * 特殊效果換算成「大概值多少戰力」，讓排行榜跟選雞畫面的總戰力
 * 能反映匕首、法杖這些裝備的價值。只是估計值，戰鬥本身不看這個數字。
 *
 * 換算方式：把每個效果折算成「等效多了幾 % 的攻擊或體力」。
 * 爆擊：期望傷害多 機率×(倍率−1)；破甲：粗估等於攻擊多 比例×0.4；
 * 吸血、再生、閃避、反傷、護盾：粗估等於體力變多。
 */
export function getTraitPowerBonus(stats: PetStats, traits: CombatTraits): number {
  const attackPct =
    traits.critChance * (traits.critMult - 1) + traits.armorPen * 0.4 + (traits.firstStrikeMult > 0 ? 0.06 : 0);
  const hpPct = traits.lifesteal * 0.6 + traits.regen * 8 + traits.dodge * 1.1 + traits.thorns * 0.5 + traits.shield * 1.2;
  return stats.attack * attackPct + (stats.hp / 5) * hpPct;
}

/** 戰隊總戰力：把隊上每一隻的總戰力相加（空位不算） */
export function getTeamTotalPower(memberStats: PetStats[]): number {
  return memberStats.reduce((sum, stats) => sum + getTotalPower(stats), 0);
}

// ============================================================
// 7. 出手頻率
// ============================================================

/**
 * 速度換算成「每秒出手幾次」。速度 50 = 每秒 1 下。
 * 速度低到 0 以下會被夾到一個極小值，避免除以零讓戰鬥永遠打不完。
 */
export function getAttacksPerSecond(speed: number): number {
  return Math.max(0.1, speed) / SPEED_PER_ATTACK_PER_SECOND;
}

/** 兩次出手之間相隔幾秒（戰鬥模擬器直接用這個當冷卻時間） */
export function getAttackIntervalSeconds(speed: number): number {
  return 1 / getAttacksPerSecond(speed);
}
