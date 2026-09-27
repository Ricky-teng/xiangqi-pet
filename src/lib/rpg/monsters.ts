// src/lib/rpg/monsters.ts

/**
 * RPG 擴充：探險的塔、關卡與怪物
 * ------------------------------------------------------------
 * 全遊戲的「難度」都集中在這個檔案。要調平衡只改這裡的常數，
 * 不用碰任何 UI 或戰鬥邏輯。
 *
 * 結構：
 *   - 10 座塔，每座 10 關
 *   - 第 1 關 8 隻怪，每關 +1（第 10 關 17 隻）；每座新塔從 8 隻重新開始
 *   - 每座塔有 3 種怪：血牛型 / 攻擊型 / 均衡型（三種強度總和差不多）
 *   - 每關最後一隻是 Boss：HP ×5、攻擊防禦 ×1.1（速度不變）
 *   - 塔難度：每座塔 +25%，也就是第 N 塔 = 基礎 × 1.25^(N−1)
 *
 * ── 一個刻意的例外：速度不隨塔數成長 ──
 * 「每座塔 +25%」如果連速度一起乘，第 10 塔的怪速度會變成 50 × 1.25^9
 * ≈ 372，等於每秒出手 7.4 次，畫面根本看不清楚，而且玩家速度不可能
 * 跟上（裝備完全不加速度）。所以 TOWER_SPEED_SCALE 固定 1.0，塔的
 * 成長只吃 HP / 攻擊 / 防禦三項。如果之後想讓高塔的怪也變快，把
 * TOWER_SPEED_SCALE 調成 1.05 之類的小數字就好。
 */

// ============================================================
// 1. 結構常數
// ============================================================

/** 總共幾座塔 */
export const TOWER_COUNT = 10;
/** 每座塔幾關 */
export const STAGES_PER_TOWER = 10;
/** 全遊戲總關數 */
export const TOTAL_STAGES = TOWER_COUNT * STAGES_PER_TOWER;

/** 第 1 關的怪物數量 */
export const BASE_MONSTER_COUNT = 8;
/** 每往後一關多幾隻 */
export const MONSTER_COUNT_PER_STAGE = 1;

/** 每座塔的難度成長：第 N 塔 = 基礎 × TOWER_SCALE^(N−1) */
export const TOWER_SCALE = 1.25;
/** 速度不隨塔數成長，理由見檔案開頭 */
export const TOWER_SPEED_SCALE = 1.0;

/** Boss 相對同關小怪的倍率 */
export const BOSS_HP_MULTIPLIER = 5;
export const BOSS_ATTACK_MULTIPLIER = 1.1;
export const BOSS_DEFENSE_MULTIPLIER = 1.1;

/** 打倒一隻怪之後，玩家回復「最大 HP 的幾成」 */
export const HEAL_PERCENT_ON_KILL = 0.3;

/** 每天可以打幾次探險（輸贏都扣，已通關的關卡重打不扣） */
export const DAILY_EXPLORE_ATTEMPTS = 10;

// ============================================================
// 2. 掉寶
// ============================================================

/** 小關首通的掉寶機率 */
export const DROP_CHANCE_NORMAL = 0.5;
/** 小關首通掉幾個（含頭尾隨機） */
export const DROP_COUNT_NORMAL_MIN = 1;
export const DROP_COUNT_NORMAL_MAX = 2;

/** Boss 關首通必掉 */
export const DROP_CHANCE_BOSS = 1;
export const DROP_COUNT_BOSS = 2;

/**
 * 算這一關首通會掉幾件（0 代表沒掉）。只有首通才呼叫這個，
 * 重打一律不掉。rng 可注入讓模擬腳本重現結果。
 */
export function rollDropCount(isBossStage: boolean, rng: () => number = Math.random): number {
  if (isBossStage) {
    return rng() < DROP_CHANCE_BOSS ? DROP_COUNT_BOSS : 0;
  }
  if (rng() >= DROP_CHANCE_NORMAL) return 0;
  const span = DROP_COUNT_NORMAL_MAX - DROP_COUNT_NORMAL_MIN + 1;
  return DROP_COUNT_NORMAL_MIN + Math.floor(rng() * span);
}

// ============================================================
// 3. 怪物原型
// ============================================================

export type MonsterArchetype = "tank" | "attacker" | "balanced";

export interface MonsterStats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
}

export interface MonsterTemplate {
  /** 穩定 id，圖鑑用來記「打過沒」：例如 "t3-attacker" */
  id: string;
  name: string;
  emoji: string;
  archetype: MonsterArchetype;
  /** 第幾座塔（1-indexed） */
  tower: number;
  stats: MonsterStats;
}

/**
 * 第 1 座塔的均衡型怪物基準值，所有怪物都是從這組數字長出來的。
 *
 * 這組數字是用 scripts/rpg-balance-sim.ts 反覆模擬調出來的，標準是
 * 「一隻未轉職（四項 ×0.8）、只買得起一把第 1 階武器的新手，要能
 * 穩穩通過第 1 塔第 1 關」——因為新手強制教學的最後一步就是打這一關，
 * 如果這關會輸，教學會直接卡死。
 *
 * 原本抓 hp 200 / attack 40，模擬出來新手在第 1 塔第 1 關的勝率是 0%
 * （Boss HP 1000 打不完，被磨死），所以往下修到現在這組。
 */
export const MONSTER_BASE_STATS: MonsterStats = {
  hp: 160,
  attack: 34,
  defense: 18,
  speed: 50,
};

/**
 * 三種原型的係數。刻意讓三種的「HP × 攻擊」大致相當，
 * 所以不會有哪一種明顯比較好打，只是打起來的感覺不同：
 *   - 血牛：很耐打但傷害低，考驗你的攻擊夠不夠
 *   - 攻擊：很脆但很痛，考驗你的防禦與 HP
 *   - 均衡：中規中矩
 */
export const ARCHETYPE_MULTIPLIERS: Record<MonsterArchetype, MonsterStats> = {
  tank: { hp: 2.0, attack: 0.7, defense: 1.3, speed: 0.8 },
  attacker: { hp: 0.6, attack: 1.5, defense: 0.8, speed: 1.2 },
  balanced: { hp: 1.0, attack: 1.0, defense: 1.0, speed: 1.0 },
};

// ============================================================
// 4. 每座塔的外觀
// ============================================================

export interface TowerTheme {
  tower: number;
  name: string;
  /** 這座塔的主色（畫面主視覺仍是深藍黑＋金，這個色是點綴與光暈） */
  accentColor: string;
  /** 三種怪的 emoji，依序對應 tank / attacker / balanced */
  monsterEmojis: [string, string, string];
  bossEmoji: string;
}

/**
 * 10 座塔的主題。怪物目前一律用 emoji，之後換成圖檔時只要改
 * 這張表（再加一個 imagePath 欄位）就好，戰鬥邏輯完全不用動。
 */
export const TOWER_THEMES: TowerTheme[] = [
  { tower: 1, name: "青草塔", accentColor: "#7FB069", monsterEmojis: ["🐛", "🐝", "🐌"], bossEmoji: "🦗" },
  { tower: 2, name: "碧水塔", accentColor: "#4FA3C4", monsterEmojis: ["🐢", "🦐", "🐟"], bossEmoji: "🦑" },
  { tower: 3, name: "黃沙塔", accentColor: "#D9A441", monsterEmojis: ["🦂", "🐍", "🦎"], bossEmoji: "🐫" },
  { tower: 4, name: "密林塔", accentColor: "#3E8E5A", monsterEmojis: ["🦍", "🕷️", "🦇"], bossEmoji: "🐊" },
  { tower: 5, name: "赤炎塔", accentColor: "#C0392B", monsterEmojis: ["🦊", "🐗", "🦂"], bossEmoji: "🐉" },
  { tower: 6, name: "寒霜塔", accentColor: "#7EC8E3", monsterEmojis: ["🐧", "🦭", "🐻‍❄️"], bossEmoji: "🦣" },
  { tower: 7, name: "雷鳴塔", accentColor: "#E8C547", monsterEmojis: ["🦅", "🦂", "🐆"], bossEmoji: "🦖" },
  { tower: 8, name: "幽暗塔", accentColor: "#6B4593", monsterEmojis: ["🦇", "🕸️", "🦉"], bossEmoji: "👹" },
  { tower: 9, name: "血月塔", accentColor: "#A03050", monsterEmojis: ["🦂", "🐺", "🦅"], bossEmoji: "👺" },
  { tower: 10, name: "通天塔", accentColor: "#B78BE0", monsterEmojis: ["🌀", "⚡", "🔮"], bossEmoji: "🐲" },
];

export const ARCHETYPE_NAMES: Record<MonsterArchetype, string> = {
  tank: "壯碩",
  attacker: "兇猛",
  balanced: "尋常",
};

/** 依塔數取得主題，塔數超出範圍時退回第 1 塔，畫面不會壞掉 */
export function getTowerTheme(tower: number): TowerTheme {
  return TOWER_THEMES[tower - 1] ?? TOWER_THEMES[0];
}

// ============================================================
// 5. 產生怪物
// ============================================================

/** 第 N 座塔的難度係數 */
export function getTowerScale(tower: number): number {
  return Math.pow(TOWER_SCALE, Math.max(0, tower - 1));
}

const ARCHETYPE_ORDER: MonsterArchetype[] = ["tank", "attacker", "balanced"];

/** 某座塔的 3 種小怪 */
export function getTowerMonsters(tower: number): MonsterTemplate[] {
  const theme = getTowerTheme(tower);
  const scale = getTowerScale(tower);
  const speedScale = Math.pow(TOWER_SPEED_SCALE, Math.max(0, tower - 1));

  return ARCHETYPE_ORDER.map((archetype, index) => {
    const mult = ARCHETYPE_MULTIPLIERS[archetype];
    return {
      id: `t${tower}-${archetype}`,
      name: `${ARCHETYPE_NAMES[archetype]}${theme.name.slice(0, 2)}獸`,
      emoji: theme.monsterEmojis[index],
      archetype,
      tower,
      stats: {
        hp: Math.round(MONSTER_BASE_STATS.hp * mult.hp * scale),
        attack: Math.round(MONSTER_BASE_STATS.attack * mult.attack * scale),
        defense: Math.round(MONSTER_BASE_STATS.defense * mult.defense * scale),
        speed: Math.round(MONSTER_BASE_STATS.speed * mult.speed * speedScale),
      },
    };
  });
}

/** 某座塔的 Boss：以該塔的均衡型為底，套 Boss 倍率 */
export function getTowerBoss(tower: number): MonsterTemplate {
  const theme = getTowerTheme(tower);
  const balanced = getTowerMonsters(tower).find((m) => m.archetype === "balanced")!;

  return {
    id: `t${tower}-boss`,
    name: `${theme.name}之主`,
    emoji: theme.bossEmoji,
    archetype: "balanced",
    tower,
    stats: {
      hp: Math.round(balanced.stats.hp * BOSS_HP_MULTIPLIER),
      attack: Math.round(balanced.stats.attack * BOSS_ATTACK_MULTIPLIER),
      defense: Math.round(balanced.stats.defense * BOSS_DEFENSE_MULTIPLIER),
      speed: balanced.stats.speed,
    },
  };
}

/** 圖鑑用：全部 10 塔 × 3 怪 + 10 Boss，共 40 筆 */
export function getAllMonsterTemplates(): MonsterTemplate[] {
  const all: MonsterTemplate[] = [];
  for (let tower = 1; tower <= TOWER_COUNT; tower++) {
    all.push(...getTowerMonsters(tower), getTowerBoss(tower));
  }
  return all;
}

// ============================================================
// 6. 關卡
// ============================================================

/** 這一關有幾隻怪（不含 Boss） */
export function getMonsterCountForStage(stage: number): number {
  return BASE_MONSTER_COUNT + (Math.max(1, stage) - 1) * MONSTER_COUNT_PER_STAGE;
}

/** 每一關最後都有 Boss（規格：「每一關最後會有一個 boss」） */
export function isBossStage(_stage: number): boolean {
  return true;
}

export interface StagePlan {
  tower: number;
  stage: number;
  /** 依序出場的怪物（最後一隻是 Boss） */
  monsters: MonsterTemplate[];
  normalCount: number;
}

/**
 * 產生一關的完整怪物隊列。小怪從該塔的 3 種裡輪流取（用取餘數，
 * 不用亂數，這樣同一關每次打的組成一樣，學生可以針對性地換裝備），
 * 最後補上 Boss。
 */
export function getStagePlan(tower: number, stage: number): StagePlan {
  const pool = getTowerMonsters(tower);
  const normalCount = getMonsterCountForStage(stage);

  const monsters: MonsterTemplate[] = [];
  for (let i = 0; i < normalCount; i++) {
    monsters.push(pool[i % pool.length]);
  }
  monsters.push(getTowerBoss(tower));

  return { tower, stage, monsters, normalCount };
}

/** 把 (塔, 關) 壓成一個穩定的 key，存進度用 */
export function getStageKey(tower: number, stage: number): string {
  return `t${tower}s${stage}`;
}

/** 全域第幾關（1 ~ 100），給進度條顯示用 */
export function getGlobalStageIndex(tower: number, stage: number): number {
  return (tower - 1) * STAGES_PER_TOWER + stage;
}
