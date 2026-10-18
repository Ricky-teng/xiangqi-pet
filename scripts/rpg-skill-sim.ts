// scripts/rpg-skill-sim.ts

/**
 * RPG 擴充：職業技能的平衡模擬
 * ------------------------------------------------------------
 * 用法（需要 tsx）：
 *   npx tsx scripts/rpg-skill-sim.ts [all|duel|team|explore|boss]
 *
 * 這支腳本不會進到正式網站，純粹是開發時用來驗證數值的工具。
 * 改了 skills.ts 的 SKILL_TABLE 之後一定要重跑，確認：
 *
 *   ① 1 對 1：拿某個技能的小雞，打「隨機抽技能」的對手（對手跟正常
 *      收藏一樣用 rollSkill 抽）。共用技能要落在 42%～58%；專屬技能
 *      （職業搭配，效果 +30%、冷卻 −20%）本來就該比較強，落在 50%～66%。
 *   ② 3 對 3：同上，但是全隊三隻都拿同一個技能，對手三隻各自隨機。
 *      全體攻擊、全隊增益在這裡才看得出價值。
 *   ③ 探險：每個技能的探險強度（怪物放大到通關率 50% 的倍率），
 *      跟「沒有技能」相比提升多少。
 *   ④ Boss 技能：每座塔第 10 關，Boss 有技能跟沒技能的通關率差多少。
 *
 * 雙方職業都隨機、裝備品質都隨機（鏡像對打幾乎是決定性的，看不出強弱）。
 */

import { simulateBattle, type BattleUnit } from "@/lib/rpg/battle";
import { createEquipmentItem, getCombatTraits, type EquipmentTier } from "@/lib/rpg/equipment";
import { HEAL_PERCENT_ON_KILL, STAGES_PER_TOWER, TOWER_COUNT, getStagePlan } from "@/lib/rpg/monsters";
import { monsterToBattleUnit } from "@/lib/rpg/deploy";
import { getFinalStats } from "@/lib/rpg/stats";
import { JOB_SKILLS, SHARED_SKILLS, SKILL_TABLE, isSkillBoosted, rollSkill, type SkillId } from "@/lib/rpg/skills";

const DUEL_SAMPLES = 500;
const TEAM_SAMPLES = 240;
const EXPLORE_SEEDS = 12;
const JOBS = ["pawn", "cannon", "horse", "chariot", "elephant", "advisor", "general", "phoenix"];
const TIERS: EquipmentTier[] = [1, 3, 5];
const ALL_SKILLS: SkillId[] = [...SHARED_SKILLS, ...Object.values(JOB_SKILLS).flat()];

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pet(id: string, side: "player" | "enemy", jobId: string | null, tier: EquipmentTier, skill: SkillId | null, rng: () => number): BattleUnit {
  const q = () => Math.round((rng() * 0.2 - 0.1) * 100) / 100;
  const weapon = createEquipmentItem("sword", tier, 0, q());
  const armor = createEquipmentItem("shield", tier, 0, q());
  const s = getFinalStats(jobId, 0, weapon, armor);
  return {
    id,
    side,
    name: id,
    maxHp: s.hp,
    attack: s.attack,
    defense: s.defense,
    speed: s.speed,
    traits: getCombatTraits(weapon, armor),
    skill: skill ? { id: skill, boosted: isSkillBoosted(skill, jobId) } : null,
  };
}

/** 這個技能的持有者職業：專屬就是那個職業，共用就隨機 */
function holderJob(skill: SkillId | null, rng: () => number): string {
  const job = skill ? SKILL_TABLE[skill].job : null;
  return job ?? JOBS[Math.floor(rng() * JOBS.length)];
}

/** 對手：跟持有者同職業（把職業本身的強弱拿掉，只比技能），技能照正常規則隨機抽 */
function randomOpponent(id: string, tier: EquipmentTier, rng: () => number, job: string): BattleUnit {
  return pet(id, "enemy", job, tier, rollSkill(job, rng), rng);
}

/** 把持有方的體力、攻擊、防禦一起乘上 k */
function scaled(u: BattleUnit, k: number): BattleUnit {
  return { ...u, maxHp: Math.round(u.maxHp * k), attack: Math.round(u.attack * k), defense: Math.round(u.defense * k) };
}

/**
 * 勝率會被放大（戰鬥幾乎是決定性的，一點點優勢就變成 90%），所以另外算
 * 「等效數值」：持有方要把三項數值打幾折（或加幾成），勝率才會剛好 50%。
 * 例如 +8% 代表這個技能大約等於「四項數值都多 8%」。
 */
function equivalence(winRate: (k: number) => number): number {
  let lo = 0.6;
  let hi = 1.6;
  for (let i = 0; i < 10; i++) {
    const mid = Math.sqrt(lo * hi);
    if (winRate(mid) >= 0.5) hi = mid;
    else lo = mid;
  }
  return 1 / Math.sqrt(lo * hi) - 1;
}

function duelAt(skill: SkillId | null, tier: EquipmentTier, k: number, samples: number): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const rng = mulberry(i * 2654435761 + tier * 31);
    const job = holderJob(skill, rng);
    const a = scaled(pet("A", "player", job, tier, skill, rng), k);
    const b = randomOpponent("B", tier, rng, job);
    if (simulateBattle([a], [b], { mode: "melee", seed: i * 7919 + 13 }).winner === "player") wins += 1;
  }
  return wins / samples;
}

function teamAt(skill: SkillId | null, tier: EquipmentTier, k: number, samples: number): number {
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    const rng = mulberry(i * 40503 + tier * 977);
    const jobs = [0, 1, 2].map(() => holderJob(skill, rng));
    const players = jobs.map((job, n) => scaled(pet(`A${n}`, "player", job, tier, skill, rng), k));
    const enemies = jobs.map((job, n) => randomOpponent(`B${n}`, tier, rng, job));
    if (simulateBattle(players, enemies, { mode: "melee", seed: i * 7919 + 7 }).winner === "player") wins += 1;
  }
  return wins / samples;
}

function duel(skill: SkillId | null, tier: EquipmentTier): number {
  let wins = 0;
  for (let i = 0; i < DUEL_SAMPLES; i++) {
    const rng = mulberry(i * 2654435761 + tier * 31);
    const job = holderJob(skill, rng);
    const a = pet("A", "player", job, tier, skill, rng);
    const b = randomOpponent("B", tier, rng, job);
    if (simulateBattle([a], [b], { mode: "melee", seed: i * 7919 + 13 }).winner === "player") wins += 1;
  }
  return wins / DUEL_SAMPLES;
}

function team(skill: SkillId | null, tier: EquipmentTier): number {
  let wins = 0;
  for (let i = 0; i < TEAM_SAMPLES; i++) {
    const rng = mulberry(i * 40503 + tier * 977);
    const jobs = [0, 1, 2].map(() => holderJob(skill, rng));
    const players = jobs.map((job, k) => pet(`A${k}`, "player", job, tier, skill, rng));
    const enemies = jobs.map((job, k) => randomOpponent(`B${k}`, tier, rng, job));
    if (simulateBattle(players, enemies, { mode: "melee", seed: i * 7919 + 7 }).winner === "player") wins += 1;
  }
  return wins / TEAM_SAMPLES;
}

function clearRate(skill: SkillId | null, jobId: string, tower: number, scale: number, bossSkill = true): number {
  const plan = getStagePlan(tower, STAGES_PER_TOWER);
  const tier = Math.min(5, Math.max(1, Math.ceil(tower / 2))) as EquipmentTier;
  const enemies: BattleUnit[] = plan.monsters.map((m, i) => {
    const u = monsterToBattleUnit(m, `e${i}`);
    return {
      ...u,
      skill: bossSkill ? u.skill : null,
      maxHp: Math.round(u.maxHp * scale),
      attack: Math.round(u.attack * scale),
      defense: Math.round(u.defense * scale),
    };
  });
  let wins = 0;
  for (let seed = 1; seed <= EXPLORE_SEEDS; seed++) {
    const p = pet("p", "player", jobId, tier, skill, () => 0.5);
    const r = simulateBattle([p], enemies, { mode: "sequential", seed: seed * 104729 + tower, healPercentOnKill: HEAL_PERCENT_ON_KILL });
    if (r.winner === "player") wins += 1;
  }
  return wins / EXPLORE_SEEDS;
}

function exploreStrength(skill: SkillId | null, tower: number, jobs: string[]): number {
  let total = 0;
  for (const job of jobs) {
    let lo = 0.2;
    let hi = 6;
    for (let i = 0; i < 11; i++) {
      const mid = Math.sqrt(lo * hi);
      if (clearRate(skill, job, tower, mid) >= 0.5) lo = mid;
      else hi = mid;
    }
    total += Math.log(Math.sqrt(lo * hi));
  }
  return Math.exp(total / jobs.length);
}

const fmt = (n: number) => `${(n * 100).toFixed(1).padStart(5)}%`;
const name = (s: SkillId | null) => (s ? `${SKILL_TABLE[s].name}${SKILL_TABLE[s].job ? "★" : ""}` : "（無）");
function flag(skill: SkillId | null, rate: number): string {
  if (!skill) return "";
  const exclusive = SKILL_TABLE[skill].job !== null;
  const [lo, hi] = exclusive ? [0.5, 0.66] : [0.42, 0.58];
  return rate < lo || rate > hi ? " ⚠️" : "";
}

const mode = process.argv[2] ?? "all";

if (mode === "all" || mode === "eq") {
  console.log("\n⓪ 等效數值：這個技能約等於四項數值 +多少（1 對 1 ／ 3 對 3，第 3 階）");
  const rows: string[] = [];
  for (const s of [null, ...ALL_SKILLS]) {
    const d = equivalence((k) => duelAt(s, 3, k, 160));
    const t = equivalence((k) => teamAt(s, 3, k, 90));
    rows.push(`${name(s).padEnd(5, "　")}${(d * 100).toFixed(0).padStart(4)}% /${(t * 100).toFixed(0).padStart(4)}%`);
  }
  for (let i = 0; i < rows.length; i += 4) console.log("    " + rows.slice(i, i + 4).join("   "));
}

if (mode === "all" || mode === "duel") {
  console.log("\n① 1 對 1：拿這個技能打「隨機抽技能」的對手（★ = 專屬，已套職業搭配）");
  for (const tier of TIERS) {
    const rows = [null, ...ALL_SKILLS].map((s) => {
      const r = duel(s, tier);
      return `${name(s).padEnd(5, "　")}${fmt(r)}${flag(s, r)}`;
    });
    console.log(`  第 ${tier} 階`);
    for (let i = 0; i < rows.length; i += 5) console.log("    " + rows.slice(i, i + 5).join("  "));
  }
}

if (mode === "all" || mode === "team") {
  console.log("\n② 3 對 3：全隊都拿這個技能，打三隻各自隨機的對手");
  for (const tier of [1, 5] as EquipmentTier[]) {
    const rows = [null, ...ALL_SKILLS].map((s) => {
      const r = team(s, tier);
      return `${name(s).padEnd(5, "　")}${fmt(r)}${flag(s, r)}`;
    });
    console.log(`  第 ${tier} 階`);
    for (let i = 0; i < rows.length; i += 5) console.log("    " + rows.slice(i, i + 5).join("  "));
  }
}

if (mode === "all" || mode === "explore") {
  console.log("\n③ 探險強度（跟沒有技能比，第 6 塔第 10 關）");
  const tower = 6;
  const jobsFor = (s: SkillId | null) => (s && SKILL_TABLE[s].job ? [SKILL_TABLE[s].job as string] : ["cannon", "elephant", "phoenix"]);
  const base = exploreStrength(null, tower, ["cannon", "elephant", "phoenix"]);
  const rows: string[] = [];
  for (const s of ALL_SKILLS) {
    const job = jobsFor(s);
    const b = job.length === 1 ? exploreStrength(null, tower, job) : base;
    const v = exploreStrength(s, tower, job);
    rows.push(`${name(s).padEnd(5, "　")}${((v / b - 1) * 100).toFixed(0).padStart(4)}%`);
  }
  for (let i = 0; i < rows.length; i += 6) console.log("    " + rows.slice(i, i + 6).join("  "));
}

if (mode === "all" || mode === "boss") {
  console.log("\n④ Boss 技能：每座塔第 10 關，探險強度（有技能 / 沒技能）");
  for (let tower = 1; tower <= TOWER_COUNT; tower++) {
    const jobs = ["cannon", "elephant", "phoenix"];
    let withSkill = 0;
    let without = 0;
    for (const job of jobs) {
      let lo = 0.2, hi = 6, lo2 = 0.2, hi2 = 6;
      for (let i = 0; i < 10; i++) {
        const m = Math.sqrt(lo * hi);
        if (clearRate(null, job, tower, m, true) >= 0.5) lo = m; else hi = m;
        const m2 = Math.sqrt(lo2 * hi2);
        if (clearRate(null, job, tower, m2, false) >= 0.5) lo2 = m2; else hi2 = m2;
      }
      withSkill += Math.log(Math.sqrt(lo * hi));
      without += Math.log(Math.sqrt(lo2 * hi2));
    }
    const ratio = Math.exp((withSkill - without) / jobs.length);
    const skill = monsterToBattleUnit(getStagePlan(tower, STAGES_PER_TOWER).monsters.slice(-1)[0], "b").skill?.id ?? null;
    console.log(`  第 ${String(tower).padStart(2)} 塔 Boss ${name(skill).padEnd(4, "　")} 變難 ${((1 - ratio) * 100).toFixed(1)}%`);
  }
}
