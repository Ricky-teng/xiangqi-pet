// scripts/rpg-balance-sim.ts

/**
 * RPG 擴充：平衡模擬腳本
 * ------------------------------------------------------------
 * 用法（需要 tsx）：
 *   npx tsx scripts/rpg-balance-sim.ts
 *
 * 這支腳本不會進到正式網站，純粹是開發時用來驗證數值的工具。
 * 它會拿幾種「典型玩家」去打全部 10 塔 × 10 關，印出：
 *   1. 每個玩家配置打得到第幾塔
 *   2. 每座塔第 10 關（最難的一關）需要幾階裝備才過得去
 *   3. 一場典型戰鬥要花幾秒（驗證「1 分鐘/關」合不合理）
 *
 * 每一關都跑 SAMPLE_COUNT 次不同亂數種子取勝率，避免被單一次
 * 的 ±10% 傷害浮動誤導。
 */

import { simulateBattle, type BattleUnit } from "@/lib/rpg/battle";
import { createEquipmentItem, type EquipmentItem, type EquipmentTier } from "@/lib/rpg/equipment";
import {
  HEAL_PERCENT_ON_KILL,
  STAGES_PER_TOWER,
  TOWER_COUNT,
  getStagePlan,
  getTowerTheme,
} from "@/lib/rpg/monsters";
import { getFinalStats, getTotalPower } from "@/lib/rpg/stats";

/** 每一關跑幾次取勝率 */
const SAMPLE_COUNT = 21;
/** 勝率多少以上算「過得去」 */
const PASS_THRESHOLD = 0.6;

interface PlayerProfile {
  label: string;
  jobId: string | null;
  severeSickCount: number;
  weaponTier: EquipmentTier | null;
  armorTier: EquipmentTier | null;
}

const PROFILES: PlayerProfile[] = [
  { label: "新手：未轉職 + 第1階武器", jobId: null, severeSickCount: 0, weaponTier: 1, armorTier: null },
  { label: "新手：未轉職 + 第1階武防", jobId: null, severeSickCount: 0, weaponTier: 1, armorTier: 1 },
  { label: "小兵(HP) + 第2階武防", jobId: "pawn", severeSickCount: 0, weaponTier: 2, armorTier: 2 },
  { label: "炮兵(攻) + 第2階武防", jobId: "cannon", severeSickCount: 0, weaponTier: 2, armorTier: 2 },
  { label: "巨象(防) + 第2階武防", jobId: "elephant", severeSickCount: 0, weaponTier: 2, armorTier: 2 },
  { label: "鳳凰(速) + 第2階武防", jobId: "phoenix", severeSickCount: 0, weaponTier: 2, armorTier: 2 },
  { label: "鳳凰(速) + 第3階武防", jobId: "phoenix", severeSickCount: 0, weaponTier: 3, armorTier: 3 },
  { label: "鳳凰(速) + 第4階武防", jobId: "phoenix", severeSickCount: 0, weaponTier: 4, armorTier: 4 },
  { label: "鳳凰(速) + 第5階武防", jobId: "phoenix", severeSickCount: 0, weaponTier: 5, armorTier: 5 },
  { label: "巨象(防) + 第5階武防", jobId: "elephant", severeSickCount: 0, weaponTier: 5, armorTier: 5 },
  { label: "鳳凰 滿裝 但生過15次大病", jobId: "phoenix", severeSickCount: 15, weaponTier: 5, armorTier: 5 },
];

function makeEquipment(tier: EquipmentTier | null, kind: "weapon" | "armor"): EquipmentItem | null {
  return tier === null ? null : createEquipmentItem(kind, tier, 0);
}

function buildPlayerUnit(profile: PlayerProfile): BattleUnit {
  const stats = getFinalStats(
    profile.jobId,
    profile.severeSickCount,
    makeEquipment(profile.weaponTier, "weapon"),
    makeEquipment(profile.armorTier, "armor"),
  );

  return {
    id: "player",
    side: "player",
    name: profile.label,
    maxHp: stats.hp,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
  };
}

interface StageOutcome {
  winRate: number;
  avgSeconds: number;
}

function runStage(profile: PlayerProfile, tower: number, stage: number): StageOutcome {
  const plan = getStagePlan(tower, stage);
  const enemies: BattleUnit[] = plan.monsters.map((monster, index) => ({
    id: `e${index}`,
    side: "enemy",
    name: monster.name,
    emoji: monster.emoji,
    maxHp: monster.stats.hp,
    attack: monster.stats.attack,
    defense: monster.stats.defense,
    speed: monster.stats.speed,
  }));

  let wins = 0;
  let totalSeconds = 0;

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const result = simulateBattle([buildPlayerUnit(profile)], enemies, {
      mode: "sequential",
      seed: tower * 100000 + stage * 1000 + i,
      healPercentOnKill: HEAL_PERCENT_ON_KILL,
    });
    if (result.winner === "player") wins += 1;
    totalSeconds += result.durationSeconds;
  }

  return { winRate: wins / SAMPLE_COUNT, avgSeconds: totalSeconds / SAMPLE_COUNT };
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`.padStart(4);
}

// ============================================================
// 報表 1：各配置打得到第幾塔
// ============================================================

console.log("\n============================================================");
console.log("報表 1：每個玩家配置能推進到第幾關（依序打，卡住就停）");
console.log("============================================================\n");

for (const profile of PROFILES) {
  const unit = buildPlayerUnit(profile);
  const power = getTotalPower({
    hp: unit.maxHp,
    attack: unit.attack,
    defense: unit.defense,
    speed: unit.speed,
  });

  let reachedTower = 0;
  let reachedStage = 0;
  let stuck = false;

  for (let tower = 1; tower <= TOWER_COUNT && !stuck; tower++) {
    for (let stage = 1; stage <= STAGES_PER_TOWER; stage++) {
      const outcome = runStage(profile, tower, stage);
      if (outcome.winRate < PASS_THRESHOLD) {
        stuck = true;
        break;
      }
      reachedTower = tower;
      reachedStage = stage;
    }
  }

  const where = reachedTower === 0 ? "第 1 塔第 1 關就打不過" : `第 ${reachedTower} 塔第 ${reachedStage} 關`;
  console.log(
    `${profile.label.padEnd(26)} 戰力 ${String(power).padStart(5)}  ` +
      `HP ${String(unit.maxHp).padStart(5)} 攻 ${String(unit.attack).padStart(4)} ` +
      `防 ${String(unit.defense).padStart(4)} 速 ${String(unit.speed).padStart(3)}  →  ${where}`,
  );
}

// ============================================================
// 報表 2：每座塔第 10 關需要幾階裝備
// ============================================================

console.log("\n============================================================");
console.log("報表 2：每座塔第 10 關（最難的一關）的勝率");
console.log("欄位＝鳳凰雞穿第 1 / 2 / 3 / 4 / 5 階武防的勝率");
console.log("============================================================\n");

console.log("塔                第1階 第2階 第3階 第4階 第5階");
for (let tower = 1; tower <= TOWER_COUNT; tower++) {
  const theme = getTowerTheme(tower);
  const cells: string[] = [];

  for (let tier = 1 as EquipmentTier; tier <= 5; tier++) {
    const profile: PlayerProfile = {
      label: "",
      jobId: "phoenix",
      severeSickCount: 0,
      weaponTier: tier as EquipmentTier,
      armorTier: tier as EquipmentTier,
    };
    cells.push(pct(runStage(profile, tower, STAGES_PER_TOWER).winRate));
  }

  console.log(`第${String(tower).padStart(2)}塔 ${theme.name.padEnd(8)} ${cells.join("  ")}`);
}

// ============================================================
// 報表 3：戰鬥時間
// ============================================================

console.log("\n============================================================");
console.log("報表 3：一場戰鬥要跑幾秒（驗證「預設 1 分鐘/關」合不合理）");
console.log("============================================================\n");

/** 每座塔「學生打到這裡時大概會穿的裝備階級」 */
const EXPECTED_TIER_BY_TOWER: EquipmentTier[] = [1, 2, 2, 2, 3, 4, 4, 4, 5, 5];

for (const [tower, stage] of [
  [1, 1],
  [1, 10],
  [3, 10],
  [5, 10],
  [7, 10],
  [10, 1],
  [10, 10],
] as [number, number][]) {
  const tier = EXPECTED_TIER_BY_TOWER[tower - 1];
  const timingProfile: PlayerProfile = {
    label: "",
    jobId: "phoenix",
    severeSickCount: 0,
    weaponTier: tier,
    armorTier: tier,
  };

  const plan = getStagePlan(tower, stage);
  const outcome = runStage(timingProfile, tower, stage);
  console.log(
    `第${String(tower).padStart(2)}塔第${String(stage).padStart(2)}關（${String(plan.monsters.length).padStart(2)}隻・第${tier}階裝）` +
      `  平均 ${outcome.avgSeconds.toFixed(1).padStart(6)} 秒   勝率 ${pct(outcome.winRate)}`,
  );
}

console.log("");
