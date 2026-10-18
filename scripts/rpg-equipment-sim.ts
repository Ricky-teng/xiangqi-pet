// scripts/rpg-equipment-sim.ts

/**
 * RPG 擴充：裝備種類與寶石的平衡模擬
 * ------------------------------------------------------------
 * 用法（需要 tsx）：
 *   npx tsx scripts/rpg-equipment-sim.ts
 *   （跑全部約 1～2 分鐘；只想看某一段可以加參數，見最下面）
 *
 * 這支腳本不會進到正式網站，純粹是開發時用來驗證數值的工具。
 * 改了 equipment.ts 的 EQUIPMENT_TYPES 或 gems.ts 的 GEM_TABLE 之後
 * 一定要重跑，確認：
 *
 *   ① 武器 1 對 1：雙方同職業、同盾、同階，只有武器種類不同。
 *      每一種對其他四種的平均勝率要落在 40%～60%。
 *   ② 防具 1 對 1：同上，只換防具種類（武器都是劍）。
 *   ③ 25 種武防組合循環賽：沒有任何一個組合平均勝率超過 62%。
 *   ④ 探險：每一種的「探險強度」跟劍／盾差距不超過 ±12%。探險強度 =
 *      把怪物數值一起放大，通關率剛好掉到 50% 時的放大倍率。
 *   ⑤ 寶石：全身鑲滿同一色，六色互打的平均勝率落在 40%～60%，
 *      探險強度也不能差太多。
 *
 * 參數：npx tsx scripts/rpg-equipment-sim.ts [all|duel|combo|explore|gem]
 *
 * 職業會輪流換（未轉職＋各種優勢職業），避免某一種裝備剛好跟
 * 某一個職業特別合而看不出來。
 */

import { simulateBattle, type BattleUnit } from "@/lib/rpg/battle";
import {
  ARMOR_TYPES,
  WEAPON_TYPES,
  createEquipmentItem,
  getCombatTraits,
  type EquipmentItem,
  type EquipmentTier,
  type EquipmentType,
} from "@/lib/rpg/equipment";
import { GEM_IDS, type GemId } from "@/lib/rpg/gems";
import { HEAL_PERCENT_ON_KILL, STAGES_PER_TOWER, TOWER_COUNT, getStagePlan } from "@/lib/rpg/monsters";
import { monsterToBattleUnit } from "@/lib/rpg/deploy";
import { getFinalStats } from "@/lib/rpg/stats";

const DUEL_SAMPLES = 360;
const EXPLORE_SEEDS = 14;
const JOBS: (string | null)[] = [null, "pawn", "cannon", "horse", "elephant", "phoenix"];
const EXPLORE_JOBS = ["cannon", "elephant", "phoenix"];
const TIERS: EquipmentTier[] = [1, 3, 5];

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

function item(type: EquipmentType, tier: EquipmentTier, gems: GemId[] = [], quality = 0): EquipmentItem {
  return { ...createEquipmentItem(type, tier, 0, quality), gems };
}

function unit(
  id: string,
  side: "player" | "enemy",
  jobId: string | null,
  weapon: EquipmentItem | null,
  armor: EquipmentItem | null,
): BattleUnit {
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
  };
}

interface Loadout {
  weapon: EquipmentType;
  armor: EquipmentType | null;
  tier: EquipmentTier;
  gems?: GemId[];
}

function build(l: Loadout, rng: () => number, randomQuality: boolean): { weapon: EquipmentItem; armor: EquipmentItem | null } {
  const q = () => (randomQuality ? Math.round((rng() * 0.2 - 0.1) * 100) / 100 : 0);
  const gems = l.gems ?? [];
  return {
    weapon: item(l.weapon, l.tier, gems.slice(0, l.tier), q()),
    armor: l.armor ? item(l.armor, l.tier, gems.slice(l.tier, l.tier * 2), q()) : null,
  };
}

/**
 * A 對 B 打 1 對 1，回傳 A 的勝率。
 * 每一場雙方「各自隨機」挑職業、各自隨機品質——鏡像對打（同職業、同品質）
 * 幾乎是決定性的，任何一點點差距都會被放大成 0% 或 100%，看不出真正的強弱。
 */
function duel(a: Loadout, b: Loadout, salt = 0): number {
  let wins = 0;
  for (let i = 0; i < DUEL_SAMPLES; i++) {
    const rng = mulberry(i * 2654435761 + salt);
    const ja = JOBS[Math.floor(rng() * JOBS.length)];
    const jb = JOBS[Math.floor(rng() * JOBS.length)];
    const ea = build(a, rng, true);
    const eb = build(b, rng, true);
    const r = simulateBattle([unit("A", "player", ja, ea.weapon, ea.armor)], [unit("B", "enemy", jb, eb.weapon, eb.armor)], {
      mode: "melee",
      seed: i * 7919 + 13,
    });
    if (r.winner === "player") wins += 1;
  }
  return wins / DUEL_SAMPLES;
}

/** 某個怪物強度倍率下，這個配置打第 tower 塔第 10 關的通關率 */
function clearRate(l: Loadout, jobId: string, tower: number, scale: number): number {
  const plan = getStagePlan(tower, STAGES_PER_TOWER);
  const { weapon, armor } = build(l, mulberry(1), false);
  const enemies: BattleUnit[] = plan.monsters.map((m, i) => {
    const u = monsterToBattleUnit(m, `e${i}`);
    return { ...u, maxHp: Math.round(u.maxHp * scale), attack: Math.round(u.attack * scale), defense: Math.round(u.defense * scale) };
  });
  let wins = 0;
  for (let seed = 1; seed <= EXPLORE_SEEDS; seed++) {
    const r = simulateBattle([unit("p", "player", jobId, weapon, armor)], enemies, {
      mode: "sequential",
      seed: seed * 104729 + tower,
      healPercentOnKill: HEAL_PERCENT_ON_KILL,
    });
    if (r.winner === "player") wins += 1;
  }
  return wins / EXPLORE_SEEDS;
}

/**
 * 探險強度：把怪物的三項數值一起乘上倍率 m，二分搜尋「通關率剛好 50%」
 * 的 m。m 越大代表能扛越強的怪。比「能通關幾關」細很多（後者一次跳 10 關）。
 */
function exploreStrength(l: Loadout): number {
  const tower = Math.min(TOWER_COUNT, l.tier * 2);
  let total = 0;
  for (const job of EXPLORE_JOBS) {
    let lo = 0.2;
    let hi = 6;
    for (let i = 0; i < 12; i++) {
      const mid = Math.sqrt(lo * hi);
      if (clearRate(l, job, tower, mid) >= 0.5) lo = mid;
      else hi = mid;
    }
    total += Math.log(Math.sqrt(lo * hi));
  }
  return Math.exp(total / EXPLORE_JOBS.length);
}

function fmt(n: number): string {
  return `${(n * 100).toFixed(1).padStart(5)}%`;
}

function flag(rate: number, lo = 0.4, hi = 0.6): string {
  return rate < lo || rate > hi ? " ⚠️" : "";
}

function rel(n: number, base: number): string {
  const d = (n / base - 1) * 100;
  const text = `${d >= 0 ? "+" : ""}${d.toFixed(0)}%`;
  return `${text.padStart(5)}${Math.abs(d) > 12 ? "⚠️" : ""}`;
}

const mode = process.argv[2] ?? "all";

// ============================================================
// ① 武器 1 對 1
// ============================================================
if (mode === "all" || mode === "duel") {
  console.log("\n① 武器 1 對 1（防具都是同階的盾；雙方隨機職業、隨機品質）—— 對其他四種的平均勝率");
  for (const tier of TIERS) {
    const line = WEAPON_TYPES.map((a) => {
      let sum = 0;
      for (const b of WEAPON_TYPES) if (a !== b) sum += duel({ weapon: a, armor: "shield", tier }, { weapon: b, armor: "shield", tier });
      const avg = sum / (WEAPON_TYPES.length - 1);
      return `${a.padEnd(6)}${fmt(avg)}${flag(avg)}`;
    });
    console.log(`  第 ${tier} 階  ${line.join("  ")}`);
  }

  console.log("\n② 防具 1 對 1（武器都是同階的劍）—— 對其他四種的平均勝率");
  for (const tier of TIERS) {
    const line = ARMOR_TYPES.map((a) => {
      let sum = 0;
      for (const b of ARMOR_TYPES) if (a !== b) sum += duel({ weapon: "sword", armor: a, tier }, { weapon: "sword", armor: b, tier });
      const avg = sum / (ARMOR_TYPES.length - 1);
      return `${a.padEnd(7)}${fmt(avg)}${flag(avg)}`;
    });
    console.log(`  第 ${tier} 階  ${line.join("  ")}`);
  }
}

// ============================================================
// ③ 25 種組合循環賽
// ============================================================
if (mode === "all" || mode === "combo") {
  for (const tier of [1, 5] as EquipmentTier[]) {
    console.log(`\n③ 25 種武防組合循環賽（第 ${tier} 階）—— 最高與最低各 4 個`);
    const combos = WEAPON_TYPES.flatMap((w) => ARMOR_TYPES.map((a) => ({ w, a })));
    const rates = combos.map((x) => {
      let sum = 0;
      for (const y of combos) if (x !== y) sum += duel({ weapon: x.w, armor: x.a, tier }, { weapon: y.w, armor: y.a, tier });
      return { label: `${x.w}+${x.a}`, rate: sum / (combos.length - 1) };
    });
    rates.sort((p, q) => q.rate - p.rate);
    for (const r of [...rates.slice(0, 4), ...rates.slice(-4)]) {
      console.log(`  ${r.label.padEnd(16)}${fmt(r.rate)}${flag(r.rate, 0.38, 0.62)}`);
    }
  }
}

// ============================================================
// ④ 探險強度
// ============================================================
if (mode === "all" || mode === "explore") {
  console.log("\n④ 探險強度（相對於劍＋盾；正數 = 能扛更強的怪）");
  for (const tier of TIERS) {
    const base = exploreStrength({ weapon: "sword", armor: "shield", tier });
    const w = WEAPON_TYPES.slice(1).map((t) => `${t}${rel(exploreStrength({ weapon: t, armor: "shield", tier }), base)}`);
    const a = ARMOR_TYPES.slice(1).map((t) => `${t}${rel(exploreStrength({ weapon: "sword", armor: t, tier }), base)}`);
    console.log(`  第 ${tier} 階（基準 ×${base.toFixed(2)}）  武器 ${w.join("  ")}`);
    console.log(`  ${" ".repeat(20)}  防具 ${a.join("  ")}`);
  }
}

// ============================================================
// ⑤ 寶石
// ============================================================
if (mode === "all" || mode === "gem") {
  console.log("\n⑤ 寶石：劍＋盾鑲滿同一色（第 1 階 2 顆、第 3 階 6 顆、第 5 階 10 顆）");
  for (const tier of TIERS) {
    const loadout = (g: GemId | null): Loadout => ({ weapon: "sword", armor: "shield", tier, gems: g ? Array(tier * 2).fill(g) : [] });
    const duelLine = GEM_IDS.map((g) => {
      let sum = 0;
      for (const h of GEM_IDS) if (g !== h) sum += duel(loadout(g), loadout(h));
      const avg = sum / (GEM_IDS.length - 1);
      return `${g}${fmt(avg)}${flag(avg)}`;
    });
    console.log(`  第 ${tier} 階 對戰  ${duelLine.join("  ")}`);
    const vsNone = duel(loadout("ruby"), loadout(null));
    // 寶石本來就該比沒寶石強，所以這裡比的是「各色之間」：
    // 每一色的探險加成跟六色平均差超過 4 個百分點才警告
    const base = exploreStrength(loadout(null));
    const gains = GEM_IDS.map((g) => (exploreStrength(loadout(g)) / base - 1) * 100);
    const mean = gains.reduce((sum, v) => sum + v, 0) / gains.length;
    const exploreLine = GEM_IDS.map((g, i) => `${g} +${gains[i].toFixed(0)}%${Math.abs(gains[i] - mean) > 4 ? "⚠️" : ""}`);
    console.log(`  第 ${tier} 階 探險  ${exploreLine.join("  ")}   （紅寶石 vs 沒寶石 勝率 ${fmt(vsNone)}）`);
  }
}
console.log("");
