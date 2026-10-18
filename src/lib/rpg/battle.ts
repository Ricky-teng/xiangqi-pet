// src/lib/rpg/battle.ts

/**
 * RPG 擴充：戰鬥引擎（純邏輯，沒有任何 React / Firestore）
 * ------------------------------------------------------------
 * 這個檔案是整場戰鬥的唯一真相來源，畫面層只負責把這裡吐出來的
 * 事件演出來，自己完全不做任何戰鬥判定。
 *
 * 有了「手動放技能」之後，勝負不能再在按下開始的那一刻就算完，
 * 所以改成「可以一段一段推進」的引擎 BattleEngine：
 *   - 播放器每一幀呼叫 advanceTo(目前播到的秒數)，引擎把這段時間內
 *     該發生的事全部結算掉，事件累積在 engine.events
 *   - 玩家按技能鈕 → castSkill(單位, 目前秒數)，在那個時間點放出去
 *   - AUTO 模式（預設）跟對手：冷卻好就自動放
 *   - 平衡腳本、沒有畫面的地方用 simulateBattle()，一口氣全自動打完
 *
 * 兩種模式：
 *   - sequential（探險）：怪一隻一隻出場，打倒一隻回復最大 HP 的 30%
 *   - melee（戰隊）：六隻同時在場混戰
 *
 * 裝備特殊效果（見 equipment.ts 的 CombatTraits）全部在這裡結算：
 *   爆擊、破甲、先攻（攻擊方）／閃避、反傷（防守方）／吸血、再生
 *   （自己回血）／開場護盾（月光石）。怪物沒有裝備，traits 一律是空的。
 *
 * 技能（見 skills.ts）也在這裡結算：攻擊、全體、連打、無視防禦、暈、
 * 燃燒、回血、增益（攻擊／速度／減傷）、護盾。
 *
 * 亂數用帶種子的 mulberry32，同一個 seed、同樣的操作一定跑出同一場。
 */

import { getAttackIntervalSeconds } from "@/lib/rpg/stats";
import { emptyCombatTraits, type CombatTraits } from "@/lib/rpg/equipment";
import {
  BOSS_SKILL_HP_THRESHOLD,
  SKILL_INITIAL_COOLDOWN_RATIO,
  getSkillCooldown,
  getSkillEffect,
  type SkillEffect,
  type SkillId,
  type UnitSkill,
} from "@/lib/rpg/skills";

// ============================================================
// 1. 型別
// ============================================================

export type BattleSide = "player" | "enemy";

/** 丟進模擬器的一個單位（小雞或怪物都用這個） */
export interface BattleUnit {
  id: string;
  side: BattleSide;
  name: string;
  /** 顯示用的 emoji（怪物目前一律用這個） */
  emoji?: string;
  /** 顯示用的圖片路徑（小雞用職業圖） */
  imagePath?: string;
  /** 職業色光環的顏色，沒有就不畫光環 */
  accentColor?: string;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  /** 裝備帶來的特殊效果；沒給就是全部沒有（怪物） */
  traits?: CombatTraits;
  /** 技能；沒給就沒有（正在養的小雞、小怪） */
  skill?: UnitSkill | null;
}

/** 回血的原因，畫面依這個決定特效跟出現的時間點 */
export type HealReason = "kill" | "lifesteal" | "regen" | "skill";

/** 增益的種類：attack / speed 是加成，guard 是減傷 */
export type BuffStat = "attack" | "speed" | "guard";

export type BattleEvent =
  /** 某個單位登場（探險是一隻一隻登場，戰隊是開場全部登場） */
  | { t: number; type: "spawn"; unitId: string }
  /** 一次攻擊（普通攻擊或技能造成的傷害） */
  | {
      t: number;
      type: "attack";
      attackerId: string;
      targetId: string;
      damage: number;
      /** 這一下打完之後目標剩多少血 */
      targetHpAfter: number;
      /** 傷害有沒有偏高（±10% 的上緣），畫面把數字放大一點點 */
      isHigh: boolean;
      /** 爆擊（匕首、紫晶） */
      crit: boolean;
      /** 被閃掉了（皮甲），damage 會是 0 */
      dodged: boolean;
      /** 這一下有破甲（斧） */
      pierce: boolean;
      /** 這一下是先攻（長槍） */
      firstStrike: boolean;
      /** 其中被護盾吸收掉幾點（damage 是總傷害，扣血 = damage − absorbed） */
      absorbed: number;
      /** 打完之後目標剩多少護盾 */
      targetShieldAfter: number;
      /** 技能造成的傷害才有：哪個技能 */
      skillId?: SkillId;
      /** 連打或全體時是第幾下（0 起算），畫面用來錯開時間 */
      hitIndex?: number;
      /** 這一下讓目標暈了幾秒 */
      stun?: number;
    }
  /** 放技能（只是宣告；造成的傷害、回血、護盾另外有事件） */
  | { t: number; type: "skill"; unitId: string; skillId: SkillId; boosted: boolean; targetIds: string[] }
  /** 增益（技能給的） */
  | { t: number; type: "buff"; unitId: string; stat: BuffStat; pct: number; until: number }
  /** 燃燒每秒的傷害 */
  | {
      t: number;
      type: "dot";
      sourceId: string;
      unitId: string;
      damage: number;
      hpAfter: number;
      absorbed: number;
      shieldAfter: number;
    }
  /** 護盾：月光石（開場或探險遇到新怪時）或技能，amount 是套完之後的護盾值 */
  | { t: number; type: "shield"; unitId: string; amount: number }
  /** 反傷（刺甲）：防守方把傷害還給攻擊方 */
  | {
      t: number;
      type: "thorns";
      sourceId: string;
      targetId: string;
      damage: number;
      targetHpAfter: number;
      absorbed: number;
      targetShieldAfter: number;
    }
  /** 某個單位倒下 */
  | { t: number; type: "death"; unitId: string }
  /** 回血：打倒敵人（探險固定 30%）、吸血（法杖）、再生（法袍）、技能 */
  | { t: number; type: "heal"; unitId: string; amount: number; hpAfter: number; reason: HealReason }
  /** 結束 */
  | { t: number; type: "end"; winner: BattleSide };

export interface BattleResult {
  winner: BattleSide;
  /** 依時間排序的事件序列 */
  events: BattleEvent[];
  /** 這場戰鬥在模擬時間軸上總共幾秒（播放器用 ×1 播就是這個長度） */
  durationSeconds: number;
  /** 玩家方打倒了幾隻（探險用來顯示「3 / 12」） */
  enemiesDefeated: number;
  /** 玩家方剩下幾隻活著（戰隊用） */
  playerSurvivors: number;
  /** 撞到安全上限被迫判定的（理論上不該發生，發生代表雙方都打不動對方） */
  timedOut: boolean;
}

export interface SimulateOptions {
  /**
   * sequential：敵方一隻一隻出場（探險）
   * melee：雙方全部同時在場（戰隊）
   */
  mode: "sequential" | "melee";
  /** 亂數種子，同一個 seed 會跑出同一場 */
  seed: number;
  /**
   * sequential 模式下，打倒一隻敵人後玩家回復「最大 HP 的幾成」。
   * melee 模式忽略這個參數。
   */
  healPercentOnKill?: number;
}

/** 畫面上技能鈕要的資訊 */
export interface SkillStatus {
  skillId: SkillId;
  boosted: boolean;
  /** 冷卻總長（秒） */
  cooldown: number;
  /** 什麼時候冷卻好（模擬時間，秒） */
  readyAt: number;
  /** 目前被暈著 */
  stunned: boolean;
  /** 已經倒下或還沒登場 */
  unavailable: boolean;
}

// ============================================================
// 2. 亂數與傷害
// ============================================================

/** mulberry32：小巧的種子亂數，同種子必定同結果 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 傷害浮動的範圍：±10% */
export const DAMAGE_VARIANCE = 0.1;

/**
 * 傷害公式：
 *   傷害 = 攻擊 × 攻擊 ÷ (攻擊 ＋ 對方防禦)，再乘上 0.9 ~ 1.1 的隨機值
 *
 * 用這種「除以 (攻擊 + 防禦)」的形式而不是直接相減，是為了讓防禦
 * 永遠有效但不會出現「防禦高到完全免傷」的情況：防禦等於對方攻擊時
 * 傷害減半，防禦是對方攻擊的三倍時剩四分之一，永遠遞減但不會歸零。
 *
 * ⚠️ 分母裡的那一項原本是固定的常數 100（也就是
 * `攻擊 × 100 ÷ (100 + 防禦)`），後來改成「攻擊者自己的攻擊力」。
 * 原因是模擬跑出來的問題：防具的防禦加成從第 1 階的 +10 一路漲到
 * 第 5 階的 +390（39 倍），但分母那個 100 不會跟著漲，所以「防禦高
 * 55%」在第 1 階只少受 20% 傷害、在第 5 階卻少受 37%——防禦的價值
 * 會隨裝備階級自己膨脹，攻擊卻不會。結果是第 1 階防禦職業勝率 18%、
 * 第 5 階變成 90%，而且找不到任何一組職業倍率能同時照顧兩端。
 *
 * 改成「攻擊 ÷ (攻擊 + 防禦)」之後，防禦擋掉的比例只取決於它跟
 * 對方攻擊力的相對大小，跟雙方的絕對數值無關，所以同一組職業倍率
 * 在第 1 階到第 5 階都成立。
 *
 * 在基準值（攻擊 100、防禦 50）上兩個公式的結果完全一樣（66.7），
 * 所以這個改動不會動到「一隻基礎小雞打起來的手感」。
 *
 * 最低保證 1 點傷害，避免高防禦單位互毆永遠打不完。
 */
export function computeDamage(attack: number, defense: number, rng: () => number): { damage: number; isHigh: boolean } {
  const safeAttack = Math.max(1, attack);
  const base = (safeAttack * safeAttack) / (safeAttack + Math.max(0, defense));
  const roll = rng(); // 0 ~ 1
  const variance = 1 - DAMAGE_VARIANCE + roll * DAMAGE_VARIANCE * 2; // 0.9 ~ 1.1
  return {
    damage: Math.max(1, Math.floor(base * variance)),
    isHigh: roll > 0.75,
  };
}

// ============================================================
// 3. 引擎
// ============================================================

/** 安全上限：一場戰鬥最多模擬幾秒，避免雙方都打不動對方時無限迴圈 */
const MAX_BATTLE_SECONDS = 300;

/** 比較兩個出手時間是否算「同時」的容差（秒） */
const SIMULTANEOUS_EPSILON = 1e-9;

interface Buff {
  pct: number;
  until: number;
}

interface Burn {
  source: RuntimeUnit;
  target: RuntimeUnit;
  damage: number;
  nextTick: number;
  ticksLeft: number;
}

interface RuntimeUnit extends BattleUnit {
  hp: number;
  /** 下一次出手的絕對時間（秒） */
  nextAt: number;
  /** 站位（melee 模式的相對站位就看這個） */
  slot: number;
  alive: boolean;
  /** 還沒登場（sequential 模式的候補） */
  onField: boolean;
  /** 正規化過的特殊效果（沒有就是全 0） */
  fx: CombatTraits;
  /** 長槍：下一下是先攻 */
  firstStrikeReady: boolean;
  /** 目前的護盾值 */
  shieldHp: number;
  /** 技能冷卻好的時間；沒有技能是 Infinity */
  skillReadyAt: number;
  /** 技能冷卻秒數 */
  skillCooldown: number;
  /** Boss 的技能已經解鎖（血量掉到一半） */
  bossSkillUnlocked: boolean;
  /** 暈到什麼時候 */
  stunUntil: number;
  buffs: Record<BuffStat, Buff>;
}

type Action =
  | { kind: "attack"; at: number; unit: RuntimeUnit }
  | { kind: "skill"; at: number; unit: RuntimeUnit }
  | { kind: "burn"; at: number; burn: Burn };

function toRuntime(unit: BattleUnit, slot: number, onField: boolean): RuntimeUnit {
  const skill = unit.skill ?? null;
  const cooldown = skill ? getSkillCooldown(skill.id, skill.boosted) : 0;
  return {
    ...unit,
    hp: unit.maxHp,
    nextAt: getAttackIntervalSeconds(unit.speed),
    slot,
    alive: true,
    onField,
    fx: unit.traits ?? emptyCombatTraits(),
    firstStrikeReady: false,
    shieldHp: 0,
    skillReadyAt: skill ? cooldown * SKILL_INITIAL_COOLDOWN_RATIO : Infinity,
    skillCooldown: cooldown,
    bossSkillUnlocked: !skill?.bossTrigger,
    stunUntil: 0,
    buffs: { attack: { pct: 0, until: 0 }, speed: { pct: 0, until: 0 }, guard: { pct: 0, until: 0 } },
  };
}

export class BattleEngine {
  readonly mode: "sequential" | "melee";
  readonly events: BattleEvent[] = [];
  /** 引擎已經結算到的時間（秒） */
  t = 0;
  finished = false;
  winner: BattleSide | null = null;
  timedOut = false;
  enemiesDefeated = 0;

  private readonly rng: () => number;
  private readonly healPercent: number;
  private readonly players: RuntimeUnit[];
  private readonly enemies: RuntimeUnit[];
  private readonly byId = new Map<string, RuntimeUnit>();
  private burns: Burn[] = [];
  /** 我方是不是自動放技能（對手永遠自動） */
  private playerAuto = true;

  constructor(playerUnits: BattleUnit[], enemyUnits: BattleUnit[], options: SimulateOptions) {
    this.mode = options.mode;
    this.rng = createRng(options.seed);
    this.healPercent = options.healPercentOnKill ?? 0;
    const sequential = this.mode === "sequential";
    this.players = playerUnits.map((u, i) => toRuntime(u, i, true));
    this.enemies = enemyUnits.map((u, i) => toRuntime(u, i, !sequential || i === 0));
    for (const u of [...this.players, ...this.enemies]) this.byId.set(u.id, u);

    for (const u of [...this.players, ...this.enemies]) {
      if (u.onField) this.events.push({ t: 0, type: "spawn", unitId: u.id });
    }
    // 開場：雙方都算「遇到新對手」
    this.armFirstStrike(this.players, 0);
    this.armFirstStrike(this.enemies, 0);
    this.raiseShields(this.players, 0);
    this.raiseShields(this.enemies, 0);
    this.checkEnd();
  }

  // ---------------- 對外 ----------------

  setPlayerAuto(auto: boolean): void {
    this.playerAuto = auto;
  }

  getSkillStatus(unitId: string): SkillStatus | null {
    const u = this.byId.get(unitId);
    if (!u?.skill) return null;
    return {
      skillId: u.skill.id,
      boosted: u.skill.boosted,
      cooldown: u.skillCooldown,
      readyAt: u.skillReadyAt,
      stunned: u.stunUntil > this.t,
      unavailable: !u.alive || !u.onField,
    };
  }

  /** 把戰鬥推進到 time 秒（含），回傳有沒有新事件 */
  advanceTo(time: number): boolean {
    const before = this.events.length;
    const limit = Math.min(time, MAX_BATTLE_SECONDS);
    while (!this.finished) {
      const action = this.nextAction();
      if (!action || action.at > limit) break;
      this.t = Math.max(this.t, action.at);
      this.perform(action);
      this.checkEnd();
    }
    if (!this.finished && time >= MAX_BATTLE_SECONDS) {
      this.t = MAX_BATTLE_SECONDS;
      this.forceEnd();
    }
    if (!this.finished) this.t = Math.max(this.t, limit);
    return this.events.length > before;
  }

  /** 手動放技能：在 time 秒放出去。冷卻沒好、被暈、倒下都會失敗 */
  castSkill(unitId: string, time: number): boolean {
    this.advanceTo(time);
    if (this.finished) return false;
    const u = this.byId.get(unitId);
    if (!u || !this.canCast(u, this.t)) return false;
    this.castNow(u);
    this.checkEnd();
    return true;
  }

  /** 全部自動打到結束 */
  runToEnd(): BattleResult {
    while (!this.finished) this.advanceTo(this.t + 30);
    return this.getResult();
  }

  getResult(): BattleResult {
    return {
      winner: this.winner ?? "enemy",
      events: this.events,
      durationSeconds: this.t,
      enemiesDefeated: this.enemiesDefeated,
      playerSurvivors: this.players.filter((u) => u.alive).length,
      timedOut: this.timedOut,
    };
  }

  // ---------------- 排程 ----------------

  private aliveOnField(list: RuntimeUnit[]): RuntimeUnit[] {
    return list.filter((u) => u.alive && u.onField);
  }

  private canCast(u: RuntimeUnit, now: number): boolean {
    return Boolean(u.skill) && u.alive && u.onField && u.bossSkillUnlocked && now + SIMULTANEOUS_EPSILON >= u.skillReadyAt && u.stunUntil <= now + SIMULTANEOUS_EPSILON;
  }

  /** 自動施放的時機。回血類等到真的需要才放，其他冷卻好就放 */
  private autoCastTime(u: RuntimeUnit): number | null {
    if (!u.skill || !u.alive || !u.onField || !u.bossSkillUnlocked) return null;
    if (u.side === "player" && !this.playerAuto) return null;
    const effect = getSkillEffect(u.skill.id, u.skill.boosted);
    if (effect.kind === "heal") {
      const allies = effect.team ? this.aliveOnField(u.side === "player" ? this.players : this.enemies) : [u];
      const needs = allies.some((a) => a.maxHp - a.hp >= a.maxHp * effect.ratio * 0.7);
      if (!needs) return null;
    }
    return Math.max(u.skillReadyAt, u.stunUntil, this.t);
  }

  private nextAction(): Action | null {
    let best: Action | null = null;
    const consider = (a: Action) => {
      if (!best || a.at < best.at - SIMULTANEOUS_EPSILON) best = a;
      else if (Math.abs(a.at - best.at) <= SIMULTANEOUS_EPSILON && this.rng() < 0.5) best = a;
    };
    const actors = [...this.aliveOnField(this.players), ...this.aliveOnField(this.enemies)];
    // 同時出手的人裡隨機挑一個先動，避免「迴圈固定先處理我方」造成的
    // 先手優勢——這個 bug 曾經讓鏡像對戰的挑戰方勝率衝到 98%
    for (const u of actors) {
      consider({ kind: "attack", at: Math.max(u.nextAt, u.stunUntil), unit: u });
      const castAt = this.autoCastTime(u);
      if (castAt !== null) consider({ kind: "skill", at: castAt, unit: u });
    }
    for (const b of this.burns) {
      if (b.ticksLeft > 0 && b.target.alive) consider({ kind: "burn", at: b.nextTick, burn: b });
    }
    return best;
  }

  private perform(action: Action): void {
    if (action.kind === "attack") {
      const u = action.unit;
      const opponents = u.side === "player" ? this.enemies : this.players;
      if (this.aliveOnField(opponents).length > 0) this.resolveAttack(u, opponents);
      u.nextAt = this.t + this.intervalOf(u);
    } else if (action.kind === "skill") {
      if (this.canCast(action.unit, this.t)) this.castNow(action.unit);
    } else {
      this.tickBurn(action.burn);
    }
  }

  private checkEnd(): void {
    if (this.finished) return;
    const playersAlive = this.players.some((u) => u.alive);
    const enemiesAlive = this.enemies.some((u) => u.alive);
    if (playersAlive && enemiesAlive) return;
    this.finished = true;
    this.winner = enemiesAlive ? "enemy" : "player";
    this.events.push({ t: this.t, type: "end", winner: this.winner });
  }

  /** 撞到安全上限：比剩餘 HP 比例。正常數值下不會走到這裡 */
  private forceEnd(): void {
    this.timedOut = true;
    const ratio = (list: RuntimeUnit[]) => list.reduce((s, u) => s + u.hp, 0) / list.reduce((s, u) => s + u.maxHp, 0);
    this.winner = ratio(this.players) > ratio(this.enemies) ? "player" : "enemy";
    this.finished = true;
    this.events.push({ t: this.t, type: "end", winner: this.winner });
  }

  // ---------------- 數值 ----------------

  private buffOf(u: RuntimeUnit, stat: BuffStat): number {
    const b = u.buffs[stat];
    return b.until > this.t ? b.pct : 0;
  }

  private intervalOf(u: RuntimeUnit): number {
    return getAttackIntervalSeconds(u.speed * (1 + this.buffOf(u, "speed")));
  }

  private attackOf(u: RuntimeUnit): number {
    return u.attack * (1 + this.buffOf(u, "attack"));
  }

  // ---------------- 裝備效果 ----------------

  /**
   * 先攻：遇到新對手時，帶長槍的單位下一下提早出手（第 5 階是立刻出手，
   * 低階只提早一部分，見 equipment.ts 的 SPECIAL_SCALE_BY_TIER）
   */
  private armFirstStrike(units: RuntimeUnit[], now: number): void {
    for (const u of units) {
      if (!u.alive || !u.onField || u.fx.firstStrikeMult <= 0) continue;
      u.firstStrikeReady = true;
      const interval = this.intervalOf(u);
      u.nextAt = Math.min(u.nextAt, now + interval * (1 - Math.min(1, u.fx.firstStrikeHaste)));
    }
  }

  /** 月光石：套上（或補滿到）開場護盾 */
  private raiseShields(units: RuntimeUnit[], now: number): void {
    for (const u of units) {
      if (!u.alive || !u.onField || u.fx.shield <= 0) continue;
      const amount = Math.round(u.maxHp * u.fx.shield);
      if (amount <= u.shieldHp) continue;
      u.shieldHp = amount;
      this.events.push({ t: now, type: "shield", unitId: u.id, amount });
    }
  }

  /** 對某個單位造成傷害：先扣護盾再扣血，回傳吸收量 */
  private applyDamage(unit: RuntimeUnit, damage: number): number {
    const absorbed = Math.min(unit.shieldHp, damage);
    unit.shieldHp -= absorbed;
    unit.hp = Math.max(0, unit.hp - (damage - absorbed));
    return absorbed;
  }

  /**
   * 挑目標：優先打「正對面」那一隻（同一個 slot），對面已經倒了才
   * 隨機挑一隻活著的。這讓戰隊的站位有意義：你把肉盾放在對方主力
   * 的正對面，就能替隊友擋刀。
   */
  private pickTarget(attacker: RuntimeUnit, opponents: RuntimeUnit[]): RuntimeUnit | null {
    const candidates = this.aliveOnField(opponents);
    if (candidates.length === 0) return null;
    const facing = candidates.find((u) => u.slot === attacker.slot);
    if (facing) return facing;
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  private heal(unit: RuntimeUnit, amount: number, reason: HealReason): void {
    if (!unit.alive || amount <= 0) return;
    const before = unit.hp;
    unit.hp = Math.min(unit.maxHp, unit.hp + Math.round(amount));
    if (unit.hp > before) {
      this.events.push({ t: this.t, type: "heal", unitId: unit.id, amount: unit.hp - before, hpAfter: unit.hp, reason });
    }
  }

  /** 處理某個單位倒下：事件、計數、探險的回血與下一隻怪登場 */
  private handleDeath(victim: RuntimeUnit): void {
    if (!victim.alive) return;
    victim.alive = false;
    this.events.push({ t: this.t, type: "death", unitId: victim.id });
    this.burns = this.burns.filter((b) => b.target !== victim);
    if (victim.side !== "enemy") return;

    this.enemiesDefeated += 1;

    if (this.mode === "sequential") {
      // 探險：打倒一隻，全體回固定比例
      for (const player of this.players) {
        this.heal(player, player.maxHp * this.healPercent, "kill");
      }
      const next = this.enemies.find((u) => !u.onField);
      if (next) {
        next.onField = true;
        next.nextAt = this.t + getAttackIntervalSeconds(next.speed);
        next.skillReadyAt = next.skill ? this.t + next.skillCooldown * SKILL_INITIAL_COOLDOWN_RATIO : Infinity;
        this.events.push({ t: this.t, type: "spawn", unitId: next.id });
        this.armFirstStrike(this.players, this.t);
        this.raiseShields(this.players, this.t);
      }
    }
  }

  /** Boss：血量掉到一半，技能解鎖並立刻可以放 */
  private checkBossTrigger(u: RuntimeUnit): void {
    if (u.bossSkillUnlocked || !u.alive) return;
    if (u.hp <= u.maxHp * BOSS_SKILL_HP_THRESHOLD) {
      u.bossSkillUnlocked = true;
      u.skillReadyAt = Math.min(u.skillReadyAt, this.t);
    }
  }

  /**
   * 一下傷害（普通攻擊跟技能共用）：閃避、破甲、爆擊、先攻、護盾、
   * 減傷、吸血、反傷全部在這裡。回傳實際造成的傷害。
   */
  private hit(
    attacker: RuntimeUnit,
    target: RuntimeUnit,
    opts: { mult: number; skillId?: SkillId; hitIndex?: number; ignoreDef?: number; stun?: number; canDodge: boolean; useFirstStrike: boolean },
  ): number {
    const firstStrike = opts.useFirstStrike && attacker.firstStrikeReady;
    if (opts.useFirstStrike) attacker.firstStrikeReady = false;

    const dodged = opts.canDodge && target.fx.dodge > 0 && this.rng() < target.fx.dodge;
    let damage = 0;
    let isHigh = false;
    let crit = false;
    const pierce = attacker.fx.armorPen > 0;
    if (!dodged) {
      const defScale = (1 - Math.min(0.9, attacker.fx.armorPen)) * (1 - Math.min(0.9, opts.ignoreDef ?? 0));
      const rolled = computeDamage(this.attackOf(attacker), target.defense * defScale, this.rng);
      isHigh = rolled.isHigh;
      let mult = opts.mult;
      if (attacker.fx.critChance > 0 && this.rng() < attacker.fx.critChance) {
        crit = true;
        mult *= attacker.fx.critMult;
      }
      if (firstStrike) mult *= attacker.fx.firstStrikeMult;
      mult *= 1 - this.buffOf(target, "guard");
      damage = Math.max(1, Math.floor(rolled.damage * mult));
    }

    const absorbed = this.applyDamage(target, damage);
    const stun = !dodged && opts.stun ? opts.stun : undefined;
    if (stun && target.alive && target.hp > 0) {
      target.stunUntil = Math.max(target.stunUntil, this.t + stun);
      target.nextAt = Math.max(target.nextAt, target.stunUntil);
    }
    this.events.push({
      t: this.t,
      type: "attack",
      attackerId: attacker.id,
      targetId: target.id,
      damage,
      targetHpAfter: target.hp,
      isHigh,
      crit,
      dodged,
      pierce: pierce && !dodged,
      firstStrike: firstStrike && !dodged,
      absorbed,
      targetShieldAfter: target.shieldHp,
      ...(opts.skillId ? { skillId: opts.skillId } : {}),
      ...(opts.hitIndex !== undefined ? { hitIndex: opts.hitIndex } : {}),
      ...(stun ? { stun } : {}),
    });

    // ---- 吸血 ----
    if (damage > 0 && attacker.fx.lifesteal > 0) {
      this.heal(attacker, damage * attacker.fx.lifesteal, "lifesteal");
    }

    // ---- 反傷（被打的人就算這一下倒了，刺還是會扎到攻擊者） ----
    if (damage > 0 && target.fx.thorns > 0 && attacker.alive) {
      const reflected = Math.max(1, Math.floor(damage * target.fx.thorns));
      const reflectAbsorbed = this.applyDamage(attacker, reflected);
      this.events.push({
        t: this.t,
        type: "thorns",
        sourceId: target.id,
        targetId: attacker.id,
        damage: reflected,
        targetHpAfter: attacker.hp,
        absorbed: reflectAbsorbed,
        targetShieldAfter: attacker.shieldHp,
      });
    }

    this.checkBossTrigger(target);
    if (target.hp <= 0) this.handleDeath(target);
    if (attacker.hp <= 0) this.handleDeath(attacker); // 被刺甲扎死
    return damage;
  }

  private resolveAttack(attacker: RuntimeUnit, opponents: RuntimeUnit[]): void {
    const target = this.pickTarget(attacker, opponents);
    if (!target) return;
    this.hit(attacker, target, { mult: 1, canDodge: true, useFirstStrike: true });
    if (!attacker.alive) return;

    // ---- 再生：每次出手回一點 ----
    if (attacker.fx.regen > 0) {
      this.heal(attacker, attacker.maxHp * attacker.fx.regen, "regen");
    }
  }

  // ---------------- 技能 ----------------

  private castNow(u: RuntimeUnit): void {
    const skill = u.skill;
    if (!skill) return;
    u.skillReadyAt = this.t + u.skillCooldown;
    const effect = getSkillEffect(skill.id, skill.boosted);
    const allies = this.aliveOnField(u.side === "player" ? this.players : this.enemies);
    const opponents = u.side === "player" ? this.enemies : this.players;

    const targets = this.skillTargets(u, effect, allies, opponents);
    this.events.push({ t: this.t, type: "skill", unitId: u.id, skillId: skill.id, boosted: skill.boosted, targetIds: targets.map((x) => x.id) });

    switch (effect.kind) {
      case "strike": {
        const hits = effect.hits ?? 1;
        let index = 0;
        for (const target of targets) {
          for (let h = 0; h < hits; h++) {
            if (!target.alive || !u.alive) break;
            let mult = effect.mult;
            if (effect.lowHpBonus) mult *= 1 + effect.lowHpBonus * (1 - u.hp / u.maxHp);
            this.hit(u, target, {
              mult,
              skillId: skill.id,
              hitIndex: index,
              ignoreDef: effect.ignoreDef,
              stun: effect.stun,
              canDodge: false,
              useFirstStrike: false,
            });
            index += 1;
          }
          if (effect.burn && target.alive) {
            const dmg = Math.max(1, Math.round(this.attackOf(u) * effect.burn.ratio));
            this.burns = this.burns.filter((b) => !(b.target === target && b.source === u));
            this.burns.push({ source: u, target, damage: dmg, nextTick: this.t + 1, ticksLeft: Math.round(effect.burn.secs) });
          }
          if (effect.healOnKill && !target.alive && u.alive) {
            this.heal(u, u.maxHp * effect.healOnKill, "skill");
          }
        }
        break;
      }
      case "heal": {
        for (const a of targets) {
          this.heal(a, a.maxHp * effect.ratio, "skill");
          if (effect.guard) this.giveBuff(a, "guard", effect.guard.reduce, effect.guard.secs);
        }
        break;
      }
      case "buff": {
        for (const a of targets) this.giveBuff(a, effect.stat, effect.pct, effect.secs);
        break;
      }
      case "shield": {
        for (const a of targets) {
          const amount = Math.round(a.maxHp * effect.ratio);
          a.shieldHp += amount;
          this.events.push({ t: this.t, type: "shield", unitId: a.id, amount: a.shieldHp });
        }
        break;
      }
    }
  }

  private skillTargets(u: RuntimeUnit, effect: SkillEffect, allies: RuntimeUnit[], opponents: RuntimeUnit[]): RuntimeUnit[] {
    if (effect.kind === "strike") {
      if (effect.aoe) return this.aliveOnField(opponents);
      const t = this.pickTarget(u, opponents);
      return t ? [t] : [];
    }
    return effect.team ? allies : [u];
  }

  /** 同一種增益不疊加：取比較大的那個，時間取比較晚的那個 */
  private giveBuff(u: RuntimeUnit, stat: BuffStat, pct: number, secs: number): void {
    const cur = u.buffs[stat];
    const active = cur.until > this.t;
    const next = { pct: active ? Math.max(cur.pct, pct) : pct, until: Math.max(active ? cur.until : 0, this.t + secs) };
    u.buffs[stat] = next;
    this.events.push({ t: this.t, type: "buff", unitId: u.id, stat, pct: next.pct, until: next.until });
    // 加速：下一下也跟著提早
    if (stat === "speed") {
      u.nextAt = Math.min(u.nextAt, this.t + this.intervalOf(u));
    }
  }

  private tickBurn(b: Burn): void {
    b.ticksLeft -= 1;
    b.nextTick += 1;
    if (!b.target.alive) return;
    const absorbed = this.applyDamage(b.target, b.damage);
    this.events.push({
      t: this.t,
      type: "dot",
      sourceId: b.source.id,
      unitId: b.target.id,
      damage: b.damage,
      hpAfter: b.target.hp,
      absorbed,
      shieldAfter: b.target.shieldHp,
    });
    this.checkBossTrigger(b.target);
    if (b.target.hp <= 0) this.handleDeath(b.target);
    if (b.ticksLeft <= 0) this.burns = this.burns.filter((x) => x !== b);
  }
}

/**
 * 全自動打完一整場（平衡腳本、沒有畫面的地方用）。
 *
 * @param playerUnits 玩家方（探險 1 隻，戰隊 1~3 隻）
 * @param enemyUnits  敵方（探險是整關的怪物隊列，順序就是出場順序；戰隊是對方 1~3 隻）
 */
export function simulateBattle(playerUnits: BattleUnit[], enemyUnits: BattleUnit[], options: SimulateOptions): BattleResult {
  return new BattleEngine(playerUnits, enemyUnits, options).runToEnd();
}
