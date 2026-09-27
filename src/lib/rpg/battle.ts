// src/lib/rpg/battle.ts

/**
 * RPG 擴充：戰鬥模擬器（純函式，沒有任何 React / Firestore）
 * ------------------------------------------------------------
 * 這個檔案是整場戰鬥的唯一真相來源。呼叫 simulateBattle() 會「一口氣
 * 把整場打完」，回傳一串帶時間戳的事件序列；畫面層（階段 3 的播放器）
 * 只負責照著時間軸播放這串事件，自己完全不做任何戰鬥判定。
 *
 * 這樣拆的好處：
 *   - 勝負在按下「開始」的那一刻就已經決定，加速 ×2 或投降都不會改變結果
 *   - 平衡調整只改 monsters.ts / stats.ts，播放器一行都不用動
 *   - 可以寫腳本一次跑幾千場來驗證平衡（scripts/rpg-balance-sim.mjs）
 *
 * 兩種模式：
 *   - sequential（探險）：怪一隻一隻出場，打倒一隻回復最大 HP 的 30%
 *   - melee（戰隊）：六隻同時在場混戰
 *
 * 亂數用帶種子的 mulberry32，同一個 seed 一定跑出同一場戰鬥。
 */

import { getAttackIntervalSeconds } from "@/lib/rpg/stats";

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
}

export type BattleEvent =
  /** 某個單位登場（探險是一隻一隻登場，戰隊是開場全部登場） */
  | { t: number; type: "spawn"; unitId: string }
  /** 一次攻擊 */
  | {
      t: number;
      type: "attack";
      attackerId: string;
      targetId: string;
      damage: number;
      /** 這一下打完之後目標剩多少血 */
      targetHpAfter: number;
      /** 傷害有沒有偏高（±10% 的上緣），畫面用不同顏色表現 */
      isHigh: boolean;
    }
  /** 某個單位倒下 */
  | { t: number; type: "death"; unitId: string }
  /** 打倒一隻怪之後的回血（只有 sequential 模式會有） */
  | { t: number; type: "heal"; unitId: string; amount: number; hpAfter: number }
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
// 3. 模擬器
// ============================================================

/** 安全上限：一場戰鬥最多模擬幾秒，避免雙方都打不動對方時無限迴圈 */
const MAX_BATTLE_SECONDS = 300;

/** 比較兩個出手時間是否算「同時」的容差（秒） */
const SIMULTANEOUS_EPSILON = 1e-9;

interface RuntimeUnit extends BattleUnit {
  hp: number;
  /** 下一次出手的絕對時間（秒） */
  nextAt: number;
  /** 站位（melee 模式的相對站位就看這個） */
  slot: number;
  alive: boolean;
  /** 還沒登場（sequential 模式的候補） */
  onField: boolean;
}

function toRuntime(unit: BattleUnit, slot: number, onField: boolean): RuntimeUnit {
  return {
    ...unit,
    hp: unit.maxHp,
    nextAt: getAttackIntervalSeconds(unit.speed),
    slot,
    alive: true,
    onField,
  };
}

/**
 * 跑完一整場戰鬥。
 *
 * @param playerUnits 玩家方（探險 1 隻，戰隊 1~3 隻）
 * @param enemyUnits  敵方（探險是整關的怪物隊列，順序就是出場順序；戰隊是對方 1~3 隻）
 */
export function simulateBattle(
  playerUnits: BattleUnit[],
  enemyUnits: BattleUnit[],
  options: SimulateOptions,
): BattleResult {
  const rng = createRng(options.seed);
  const sequential = options.mode === "sequential";
  const healPercent = options.healPercentOnKill ?? 0;

  const players = playerUnits.map((unit, index) => toRuntime(unit, index, true));
  // sequential 模式只有第一隻敵人在場上，其他排隊等前一隻倒下
  const enemies = enemyUnits.map((unit, index) => toRuntime(unit, index, !sequential || index === 0));

  const events: BattleEvent[] = [];
  let t = 0;
  let enemiesDefeated = 0;
  let timedOut = false;

  // 開場登場事件
  for (const unit of [...players, ...enemies]) {
    if (unit.onField) {
      events.push({ t: 0, type: "spawn", unitId: unit.id });
    }
  }

  const aliveOnField = (list: RuntimeUnit[]) => list.filter((u) => u.alive && u.onField);
  const anyAlive = (list: RuntimeUnit[]) => list.some((u) => u.alive);

  /**
   * 選目標：先打對面站位相對的那隻；那隻已經倒了（或還沒登場）
   * 就從還活著的裡面隨機挑一隻。人少的那邊空位，對面就直接
   * 前進打別人——這正好就是「站位對不到就隨機挑」的效果。
   */
  function pickTarget(attacker: RuntimeUnit, opponents: RuntimeUnit[]): RuntimeUnit | null {
    const candidates = aliveOnField(opponents);
    if (candidates.length === 0) return null;

    const facing = candidates.find((u) => u.slot === attacker.slot);
    if (facing) return facing;

    return candidates[Math.floor(rng() * candidates.length)];
  }

  function resolveAttack(attacker: RuntimeUnit, opponents: RuntimeUnit[]): void {
    const target = pickTarget(attacker, opponents);
    if (!target) return;

    const { damage, isHigh } = computeDamage(attacker.attack, target.defense, rng);
    target.hp = Math.max(0, target.hp - damage);

    events.push({
      t,
      type: "attack",
      attackerId: attacker.id,
      targetId: target.id,
      damage,
      targetHpAfter: target.hp,
      isHigh,
    });

    if (target.hp > 0) return;

    target.alive = false;
    events.push({ t, type: "death", unitId: target.id });

    if (target.side !== "enemy") return;

    enemiesDefeated += 1;

    if (!sequential) return;

    // 探險：打倒一隻之後，玩家回復最大 HP 的 healPercent，下一隻才登場
    for (const player of players) {
      if (!player.alive || healPercent <= 0) continue;
      const before = player.hp;
      player.hp = Math.min(player.maxHp, player.hp + Math.round(player.maxHp * healPercent));
      if (player.hp > before) {
        events.push({ t, type: "heal", unitId: player.id, amount: player.hp - before, hpAfter: player.hp });
      }
    }

    const next = enemies.find((u) => !u.onField);
    if (next) {
      next.onField = true;
      next.nextAt = t + getAttackIntervalSeconds(next.speed);
      events.push({ t, type: "spawn", unitId: next.id });
    }
  }

  /**
   * 事件驅動的主迴圈：每次挑出「下一個該出手的單位」，把時間直接跳到
   * 那一刻，結算完再排下一次。
   *
   * ⚠️ 這裡刻意不用固定時間步長（tick）輪流跑雙方。第一版是用 tick
   * 而且玩家方先結算，模擬出來「完全鏡像的兩隊」挑戰方勝率高達 98%
   * ——因為雙方速度相同時，玩家永遠先落下那一刀，在六隻混戰、火力
   * 集中的情況下這個微小優勢會滾雪球（先手方先少一個敵人，敵方輸出
   * 就先掉三分之一）。改成事件驅動、同時出手隨機決定先後之後，鏡像
   * 對戰才會回到 50% 附近。
   */
  while (t < MAX_BATTLE_SECONDS) {
    if (!anyAlive(players) || !anyAlive(enemies)) break;

    const actors = [...aliveOnField(players), ...aliveOnField(enemies)];
    if (actors.length === 0) break;

    const earliest = Math.min(...actors.map((u) => u.nextAt));
    // 同一時刻出手的（速度一樣的單位一定會一直撞在一起）隨機決定誰先
    const tied = actors.filter((u) => u.nextAt - earliest <= SIMULTANEOUS_EPSILON);
    const actor = tied[Math.floor(rng() * tied.length)];

    t = earliest;
    if (t > MAX_BATTLE_SECONDS) break;

    const opponents = actor.side === "player" ? enemies : players;
    if (anyAlive(opponents)) {
      resolveAttack(actor, opponents);
    }

    // 就算這一刀之後自己被反殺（不會發生，但保險），也要把時間往前推，
    // 否則下一輪又選到同一個人會無限迴圈
    actor.nextAt = t + getAttackIntervalSeconds(actor.speed);
  }

  let winner: BattleSide;
  if (!anyAlive(enemies)) {
    winner = "player";
  } else if (!anyAlive(players)) {
    winner = "enemy";
  } else {
    // 撞到時間上限：比雙方剩餘血量百分比，平手算玩家輸
    timedOut = true;
    const playerRatio = players.reduce((s, u) => s + u.hp, 0) / players.reduce((s, u) => s + u.maxHp, 0);
    const enemyRatio = enemies.reduce((s, u) => s + u.hp, 0) / enemies.reduce((s, u) => s + u.maxHp, 0);
    winner = playerRatio > enemyRatio ? "player" : "enemy";
  }

  events.push({ t, type: "end", winner });

  return {
    winner,
    events,
    durationSeconds: t,
    enemiesDefeated,
    playerSurvivors: players.filter((u) => u.alive).length,
    timedOut,
  };
}
