// src/lib/rpg/skills.ts

/**
 * 職業技能
 * ------------------------------------------------------------
 * 規則（全部是拍板過的）：
 *   - 只有「收藏小雞」有技能，每隻 1 格；正在養的那隻沒有
 *   - 技能池：每個職業 2 個專屬 ＋ 8 個共用；未轉職（新手雞）只從共用抽
 *   - 收藏時隨機給一個；舊的收藏小雞第一次載入時補一個
 *   - 刷新：固定 200 飼料，重新隨機；抽到「自己職業的專屬」機率 20%（再 2 選 1）
 *   - 職業搭配：技能的職業跟小雞的職業一樣 → 效果 +30%、冷卻 −20%
 *     （共用技能沒有職業，所以永遠不會變強）
 *   - 施放限制：冷卻時間。開場先轉一半冷卻，不會一開打就放
 *   - 怪物只有 Boss 有技能：每座塔一個，血量剩一半時第一次放
 *
 * 這個檔案只有資料跟純函式；實際結算在 battle.ts。
 */

/** 技能效果的種類 */
export type SkillEffect =
  /** 攻擊型：倍率是「普通攻擊的幾倍」 */
  | {
      kind: "strike";
      mult: number;
      /** 打全部在場的敵人 */
      aoe?: boolean;
      /** 連打幾下（每下都是 mult） */
      hits?: number;
      /** 無視對方幾成防禦 */
      ignoreDef?: number;
      /** 讓目標暈幾秒（暈的時候不能攻擊、不能放技能） */
      stun?: number;
      /** 燃燒：之後每秒造成「自己攻擊 × ratio」的傷害，持續 secs 秒 */
      burn?: { ratio: number; secs: number };
      /** 自己體力越低越痛：體力 0% 時倍率再 ×(1 + lowHpBonus) */
      lowHpBonus?: number;
      /** 這一下打倒敵人的話，回復自己最大體力的幾成 */
      healOnKill?: number;
    }
  /** 回血型 */
  | {
      kind: "heal";
      ratio: number;
      team?: boolean;
      /** 順便減傷 */
      guard?: { reduce: number; secs: number };
    }
  /** 增益型：attack / speed 是加成比例，guard 是受到傷害減少的比例 */
  | { kind: "buff"; stat: "attack" | "speed" | "guard"; pct: number; secs: number; team?: boolean }
  /** 護盾型：最大體力的幾成 */
  | { kind: "shield"; ratio: number; team?: boolean };

export type SkillId =
  // 共用
  | "smash"
  | "whirlwind"
  | "cure"
  | "ironwall"
  | "gale"
  | "warcry"
  | "quake"
  | "barrier"
  // 小兵
  | "holdfast"
  | "charge"
  // 炮兵
  | "barrage"
  | "bigshot"
  // 馬伕
  | "triplekick"
  | "gallop"
  // 戰車
  | "ram"
  | "ironwheel"
  // 巨象
  | "tuskguard"
  | "stomp"
  // 仕官
  | "guardian"
  | "mend"
  // 將軍
  | "command"
  | "majesty"
  // 鳳凰
  | "rebirth"
  | "inferno"
  // Boss 專用
  | "berserk";

export interface SkillDef {
  id: SkillId;
  name: string;
  /** 專屬職業；null = 共用 */
  job: string | null;
  /** 冷卻秒數（還沒套職業搭配的 −20%） */
  cooldown: number;
  effect: SkillEffect;
  /** 特效主色 */
  color: string;
}

// ============================================================
// 1. 技能表
// ------------------------------------------------------------
// 數字是平衡模擬調過的（scripts/rpg-skill-sim.ts）。普通攻擊大約每
// 1 秒一下，冷卻 10 秒的 250% 重擊 ≈ 每 10 秒多打 1.5 下。
// ============================================================

export const SKILL_TABLE: Record<SkillId, SkillDef> = {
  // ---- 共用 ----
  smash: { id: "smash", name: "重擊", job: null, cooldown: 10, color: "#FFB347", effect: { kind: "strike", mult: 2.3 } },
  whirlwind: { id: "whirlwind", name: "旋風斬", job: null, cooldown: 12, color: "#9FE8FF", effect: { kind: "strike", mult: 1.2, aoe: true } },
  cure: { id: "cure", name: "治癒", job: null, cooldown: 14, color: "#7FE8A8", effect: { kind: "heal", ratio: 0.22 } },
  ironwall: { id: "ironwall", name: "鐵壁", job: null, cooldown: 14, color: "#C9D3E0", effect: { kind: "buff", stat: "guard", pct: 0.45, secs: 6 } },
  gale: { id: "gale", name: "疾風", job: null, cooldown: 14, color: "#B9F5D0", effect: { kind: "buff", stat: "speed", pct: 0.6, secs: 6 } },
  warcry: { id: "warcry", name: "怒吼", job: null, cooldown: 15, color: "#FF7A5C", effect: { kind: "buff", stat: "attack", pct: 0.4, secs: 7 } },
  quake: { id: "quake", name: "震擊", job: null, cooldown: 12, color: "#E0B26A", effect: { kind: "strike", mult: 1.5, stun: 1.2 } },
  barrier: { id: "barrier", name: "護盾術", job: null, cooldown: 14, color: "#9FE0FF", effect: { kind: "shield", ratio: 0.22 } },

  // ---- 小兵 ----
  holdfast: { id: "holdfast", name: "堅守", job: "pawn", cooldown: 14, color: "#7FE8A8", effect: { kind: "heal", ratio: 0.13, guard: { reduce: 0.3, secs: 4 } } },
  charge: { id: "charge", name: "衝鋒", job: "pawn", cooldown: 11, color: "#FF9A3D", effect: { kind: "strike", mult: 2, lowHpBonus: 1 } },
  // ---- 炮兵 ----
  barrage: { id: "barrage", name: "轟炸", job: "cannon", cooldown: 16, color: "#FF6A3D", effect: { kind: "strike", mult: 1.0, aoe: true } },
  bigshot: { id: "bigshot", name: "蓄力炮", job: "cannon", cooldown: 12, color: "#FFD23D", effect: { kind: "strike", mult: 1.85, ignoreDef: 0.3 } },
  // ---- 馬伕 ----
  triplekick: { id: "triplekick", name: "連踢", job: "horse", cooldown: 10, color: "#FFE58A", effect: { kind: "strike", mult: 0.7, hits: 3 } },
  gallop: { id: "gallop", name: "奔襲", job: "horse", cooldown: 13, color: "#B9F5D0", effect: { kind: "buff", stat: "speed", pct: 0.7, secs: 6 } },
  // ---- 戰車 ----
  ram: { id: "ram", name: "衝撞", job: "chariot", cooldown: 12, color: "#E0B26A", effect: { kind: "strike", mult: 1.7, stun: 0.8 } },
  ironwheel: { id: "ironwheel", name: "鐵輪", job: "chariot", cooldown: 14, color: "#FF7A5C", effect: { kind: "buff", stat: "attack", pct: 0.6, secs: 6 } },
  // ---- 巨象 ----
  tuskguard: { id: "tuskguard", name: "象牙盾", job: "elephant", cooldown: 14, color: "#DFF6FF", effect: { kind: "shield", ratio: 0.18 } },
  stomp: { id: "stomp", name: "踐踏", job: "elephant", cooldown: 14, color: "#C9A26A", effect: { kind: "strike", mult: 1.1, aoe: true, stun: 1 } },
  // ---- 仕官 ----
  guardian: { id: "guardian", name: "守護", job: "advisor", cooldown: 15, color: "#9FE0FF", effect: { kind: "shield", ratio: 0.15, team: true } },
  mend: { id: "mend", name: "療癒", job: "advisor", cooldown: 15, color: "#7FE8A8", effect: { kind: "heal", ratio: 0.15, team: true } },
  // ---- 將軍 ----
  command: { id: "command", name: "號令", job: "general", cooldown: 15, color: "#FFD23D", effect: { kind: "buff", stat: "attack", pct: 0.3, secs: 7, team: true } },
  majesty: { id: "majesty", name: "將威", job: "general", cooldown: 11, color: "#FFB347", effect: { kind: "strike", mult: 2, healOnKill: 0.15 } },
  // ---- 鳳凰 ----
  rebirth: { id: "rebirth", name: "浴火", job: "phoenix", cooldown: 15, color: "#FF9A3D", effect: { kind: "heal", ratio: 0.3 } },
  inferno: { id: "inferno", name: "烈焰", job: "phoenix", cooldown: 12, color: "#FF4D2E", effect: { kind: "strike", mult: 1.6, burn: { ratio: 0.2, secs: 3 } } },

  // ---- Boss 專用 ----
  berserk: { id: "berserk", name: "狂暴", job: null, cooldown: 16, color: "#FF2D46", effect: { kind: "buff", stat: "speed", pct: 0.5, secs: 6 } },
};

/** 共用技能（未轉職只能抽這些） */
export const SHARED_SKILLS: SkillId[] = ["smash", "whirlwind", "cure", "ironwall", "gale", "warcry", "quake", "barrier"];

/** 每個職業的 2 個專屬 */
export const JOB_SKILLS: Record<string, SkillId[]> = {
  pawn: ["holdfast", "charge"],
  cannon: ["barrage", "bigshot"],
  horse: ["triplekick", "gallop"],
  chariot: ["ram", "ironwheel"],
  elephant: ["tuskguard", "stomp"],
  advisor: ["guardian", "mend"],
  general: ["command", "majesty"],
  phoenix: ["rebirth", "inferno"],
};

/** 每座塔 Boss 的技能（第 1 塔 → 第 10 塔） */
export const BOSS_SKILL_BY_TOWER: SkillId[] = [
  "smash",
  "warcry",
  "cure",
  "quake",
  "barrier",
  "whirlwind",
  "gale",
  "ironwall",
  "inferno",
  "berserk",
];

/** 刷新技能的價格 */
export const SKILL_REROLL_COST = 200;
/** 抽到自己職業專屬的機率 */
export const JOB_SKILL_CHANCE = 0.2;
/** 職業搭配：效果倍率、冷卻倍率 */
export const JOB_MATCH_EFFECT_MULT = 1.3;
export const JOB_MATCH_COOLDOWN_MULT = 0.8;
/** 開場先轉掉多少冷卻（0.5 = 開打後過半個冷卻才能第一次放） */
export const SKILL_INITIAL_COOLDOWN_RATIO = 0.3;
/** Boss 第一次放技能的血量門檻 */
export const BOSS_SKILL_HP_THRESHOLD = 0.5;

// ============================================================
// 2. 查詢
// ============================================================

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === "string" && value in SKILL_TABLE;
}

export function getSkill(id: SkillId): SkillDef {
  return SKILL_TABLE[id];
}

/** 這隻小雞的職業跟技能有沒有搭配上 */
export function isSkillBoosted(skillId: SkillId, jobId: string | null): boolean {
  const job = SKILL_TABLE[skillId].job;
  return job !== null && job === jobId;
}

/** 套用職業搭配之後的冷卻秒數 */
export function getSkillCooldown(skillId: SkillId, boosted: boolean): number {
  const base = SKILL_TABLE[skillId].cooldown;
  return boosted ? Math.round(base * JOB_MATCH_COOLDOWN_MULT * 10) / 10 : base;
}

/**
 * 套用職業搭配之後的效果數值。
 * 「效果 +30%」套在每個效果的主要數字上：倍率、回復量、增益比例、
 * 護盾量、暈眩秒數、燃燒傷害。持續時間不變。
 */
export function getSkillEffect(skillId: SkillId, boosted: boolean): SkillEffect {
  const e = SKILL_TABLE[skillId].effect;
  if (!boosted) return e;
  const m = JOB_MATCH_EFFECT_MULT;
  switch (e.kind) {
    case "strike":
      return {
        ...e,
        mult: e.mult * m,
        stun: e.stun ? e.stun * m : undefined,
        burn: e.burn ? { ratio: e.burn.ratio * m, secs: e.burn.secs } : undefined,
        healOnKill: e.healOnKill ? e.healOnKill * m : undefined,
      };
    case "heal":
      return { ...e, ratio: e.ratio * m, guard: e.guard ? { reduce: Math.min(0.8, e.guard.reduce * m), secs: e.guard.secs } : undefined };
    case "buff":
      return { ...e, pct: e.stat === "guard" ? Math.min(0.8, e.pct * m) : e.pct * m };
    case "shield":
      return { ...e, ratio: e.ratio * m };
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
function secs(n: number): string {
  return `${Math.round(n * 10) / 10} 秒`;
}

/** 技能說明文字（已套職業搭配） */
export function getSkillDescription(skillId: SkillId, boosted: boolean): string {
  const e = getSkillEffect(skillId, boosted);
  switch (e.kind) {
    case "strike": {
      const parts: string[] = [];
      const who = e.aoe ? "所有敵人" : "目標";
      parts.push(e.hits && e.hits > 1 ? `連打 ${e.hits} 下，每下 ${pct(e.mult)} 傷害` : `對${who}造成 ${pct(e.mult)} 傷害`);
      if (e.ignoreDef) parts.push(`無視 ${pct(e.ignoreDef)} 防禦`);
      if (e.stun) parts.push(`暈 ${secs(e.stun)}`);
      if (e.burn) parts.push(`燃燒 ${e.burn.secs} 秒、每秒 ${pct(e.burn.ratio)} 攻擊`);
      if (e.lowHpBonus) parts.push(`自己體力越低越痛（最多再 +${pct(e.lowHpBonus)}）`);
      if (e.healOnKill) parts.push(`打倒敵人回 ${pct(e.healOnKill)} 體力`);
      return parts.join("，");
    }
    case "heal": {
      const base = e.team ? `全隊回復 ${pct(e.ratio)} 最大體力` : `回復 ${pct(e.ratio)} 最大體力`;
      return e.guard ? `${base}，${secs(e.guard.secs)}內受到傷害 −${pct(e.guard.reduce)}` : base;
    }
    case "buff": {
      const who = e.team ? "全隊" : "";
      if (e.stat === "guard") return `${secs(e.secs)}內${who}受到傷害 −${pct(e.pct)}`;
      return `${secs(e.secs)}內${who}${e.stat === "attack" ? "攻擊" : "速度"} +${pct(e.pct)}`;
    }
    case "shield":
      return `${e.team ? "全隊" : ""}得到 ${pct(e.ratio)} 最大體力的護盾`;
  }
}

// ============================================================
// 3. 抽技能
// ============================================================

/**
 * 隨機抽一個技能。
 *   - 有職業：20% 抽自己職業的 2 個專屬（2 選 1），80% 抽共用 8 個
 *   - 未轉職：只抽共用
 *   - exclude：刷新時排除目前這個，避免花了 200 飼料抽到一模一樣的
 */
export function rollSkill(jobId: string | null, rng: () => number = Math.random, exclude?: SkillId | null): SkillId {
  const jobPool = jobId ? JOB_SKILLS[jobId] ?? [] : [];
  const useJob = jobPool.length > 0 && rng() < JOB_SKILL_CHANCE;
  let pool = useJob ? jobPool : SHARED_SKILLS;
  if (exclude) {
    const filtered = pool.filter((id) => id !== exclude);
    if (filtered.length > 0) pool = filtered;
  }
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/** Boss 的技能 */
export function getBossSkill(tower: number): SkillId {
  return BOSS_SKILL_BY_TOWER[Math.max(0, Math.min(BOSS_SKILL_BY_TOWER.length - 1, tower - 1))];
}

/** 給戰鬥模擬器的技能設定 */
export interface UnitSkill {
  id: SkillId;
  boosted: boolean;
  /** Boss：血量掉到一半才第一次放 */
  bossTrigger?: boolean;
}
