// src/components/battle/skillfx/skillFx.ts

/**
 * 24 招技能＋Boss 狂暴的專屬動畫
 * ------------------------------------------------------------
 * 每招都是約 1.3 秒的「施放演出」：蓄力 → 出招 → 命中。
 * 演出期間戰場時間軸是停住的（BattleStage 的 holdTimeline），
 * 演完才會跳出真正的傷害數字、回血數字，所以命中的瞬間（約 1.15～1.3 秒）
 * 剛好接上數字。
 *
 * 施放者的「身體動作」（跳起、劈下、舉手施法）由骨架小雞的 poses 負責，
 * 這裡負責：施放者整隻的位移（跳到目標面前、衝鋒）、所有特效、鏡頭震動、音效。
 *
 * Boss 版本：同一招整體放大 1.4 倍、多一層紅色警示閃光、震得更大力。
 */

import type { SkillId } from "@/lib/rpg/skills";
import { getSkill } from "@/lib/rpg/skills";
import {
  airRing,
  arcSlash,
  at,
  boom,
  bubble,
  crack,
  dizzyStars,
  el,
  ensureDefs,
  fall,
  flameColumn,
  gather,
  glowOrb,
  groundRing,
  group,
  hexWall,
  lightPillar,
  play,
  radial,
  rise,
  rocks,
  shieldDome,
  shoot,
  soundWaves,
  type FxKit,
  type StageAnchor,
} from "@/components/battle/skillfx/stageFx";

/** 演出長度：BattleStage 停住時間軸這麼久，傷害數字在這之後才出來 */
export const SKILL_HOLD_MS = 1300;

/** 骨架小雞要擺的動作 */
export type CasterPose = "skill" | "cast" | "attack";

export interface SkillCast {
  kit: FxKit;
  skillId: SkillId;
  boosted: boolean;
  boss: boolean;
  caster: StageAnchor;
  /** 朝向敵人的方向（我方 1、敵方 −1） */
  dir: 1 | -1;
  targets: StageAnchor[];
  /** 同隊（含自己），全隊技能用 */
  allies: StageAnchor[];
  /** 讓施放者整隻位移（跳到目標前面、衝鋒），frames 是相對原位的 translate */
  moveCaster: (frames: Keyframe[], t0: number, dur: number) => void;
  /** 骨架小雞的動作（怪物沒有骨架，會被忽略） */
  pose: (p: CasterPose) => void;
  /** 骨架小雞的坐騎頭（炮管、象頭）額外的角度，度數 */
  tiltMount?: (deg: number, t0: number, dur: number) => void;
}

/** 這招要擺什麼動作 */
export function getCasterPose(skillId: SkillId): CasterPose {
  const e = getSkill(skillId).effect;
  if (e.kind === "heal" || e.kind === "shield") return "cast";
  if (e.kind === "buff") return e.stat === "guard" ? "cast" : "skill";
  return "skill";
}

// ============================================================
// 共用：施放開場（腳下魔法陣＋蓄力光點＋身上的光）
// ============================================================

function runeCircle(kit: FxKit, a: StageAnchor, color: string, t0: number, dur: number, scale = 1): void {
  const x = a.x;
  const y = a.feetY;
  const r = a.size * 0.62 * scale;
  const g = group(kit, x, y);
  // 壓扁成地面上的橢圓
  const inner = group(kit, x, y, g);
  el(kit, "circle", { cx: x, cy: y, r, fill: "none", stroke: color, "stroke-width": 3 }, inner);
  el(kit, "circle", { cx: x, cy: y, r: r * 0.78, fill: "none", stroke: "#FFFFFF", "stroke-width": 1.6, "stroke-dasharray": "6 5" }, inner);
  el(kit, "circle", { cx: x, cy: y, r: r * 0.92, fill: radial(kit, color), opacity: 0.35 }, inner);
  // 六芒星
  const pts = (rot: number) =>
    Array.from({ length: 3 }, (_, i) => {
      const ang = rot + (i / 3) * Math.PI * 2;
      return `${x + Math.cos(ang) * r * 0.74},${y + Math.sin(ang) * r * 0.74}`;
    }).join(" ");
  el(kit, "polygon", { points: pts(-Math.PI / 2), fill: "none", stroke: color, "stroke-width": 2 }, inner);
  el(kit, "polygon", { points: pts(Math.PI / 2), fill: "none", stroke: color, "stroke-width": 2 }, inner);
  // 外圈符文小點
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2;
    el(kit, "rect", { x: x + Math.cos(ang) * r * 0.86 - 2, y: y + Math.sin(ang) * r * 0.86 - 2, width: 4, height: 4, fill: "#FFFFFF", transform: `rotate(45 ${x + Math.cos(ang) * r * 0.86} ${y + Math.sin(ang) * r * 0.86})` }, inner);
  }
  inner.style.filter = `drop-shadow(0 0 6px ${color})`;
  g.setAttribute("transform", `translate(0 ${y * 0.72}) scale(1 0.28)`);
  play(kit, inner, [{ transform: "rotate(0deg)" }, { transform: "rotate(160deg)" }], t0, dur, { removeAfter: false });
  play(kit, g, [
    { opacity: 0 },
    { opacity: 1, offset: 0.12 },
    { opacity: 1, offset: 0.8 },
    { opacity: 0 },
  ], t0, dur);
}

function opening(c: SkillCast, color: string, gatherMs = 650): void {
  const { kit, caster } = c;
  const s = c.boss ? 1.4 : 1;
  ensureDefs(kit);
  runeCircle(kit, caster, color, 0, SKILL_HOLD_MS, s);
  gather(kit, caster.x, caster.cy, caster.size * 0.9 * s, color, 0, gatherMs, 16);
  glowOrb(kit, caster.x, caster.cy, caster.size * 0.55 * s, color, 0, gatherMs + 200, [
    { transform: "scale(0.6)", opacity: 0 },
    { transform: "scale(1)", opacity: 0.55, offset: 0.7 },
    { transform: "scale(1.3)", opacity: 0 },
  ]);
  if (c.boss) {
    kit.flash("#FF2D46", 0.18, 260);
    kit.sfx("bossRoar");
  }
}

/** 跳到目標面前（劈、踢、撞）：t0 起跳、land 落地、回到原位 */
function leapTo(c: SkillCast, target: StageAnchor, t0: number, land: number, back: number, arc = 0.5): void {
  const dx = target.x - c.caster.x - c.dir * (c.caster.size + target.size) * 0.3;
  const dy = target.feetY - c.caster.feetY;
  const up = c.caster.size * arc;
  c.moveCaster(
    [
      { transform: "translate(0,0)", offset: 0 },
      { transform: "translate(0,0)", offset: t0 / back },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - up}px)`, offset: (t0 + (land - t0) * 0.55) / back },
      { transform: `translate(${dx}px,${dy}px)`, offset: land / back },
      { transform: `translate(${dx}px,${dy}px)`, offset: (land + (back - land) * 0.45) / back },
      { transform: "translate(0,0)", offset: 1 },
    ],
    0,
    back,
  );
}

/** 筆直衝過去（衝鋒、衝撞） */
function dashTo(c: SkillCast, target: StageAnchor, t0: number, hit: number, back: number): void {
  const dx = target.x - c.caster.x - c.dir * (c.caster.size + target.size) * 0.22;
  const dy = target.feetY - c.caster.feetY;
  c.moveCaster(
    [
      { transform: "translate(0,0)", offset: 0 },
      { transform: `translate(${-c.dir * 14}px,0)`, offset: t0 / back },
      { transform: `translate(${dx}px,${dy}px)`, offset: hit / back, easing: "ease-out" },
      { transform: `translate(${dx - c.dir * 10}px,${dy}px)`, offset: (hit + 120) / back },
      { transform: "translate(0,0)", offset: 1 },
    ],
    0,
    back,
  );
}

// ============================================================
// 技能表
// ============================================================

type SkillFn = (c: SkillCast) => void;

const first = (c: SkillCast): StageAnchor => c.targets[0] ?? c.caster;

const SKILL_FX: Record<SkillId, SkillFn> = {
  // ---------- 重擊：舉高蓄力 → 跳過去往下劈 → 地裂石飛 ----------
  smash(c) {
    const color = "#FFB347";
    opening(c, color, 700);
    const t = first(c);
    c.pose("skill");
    leapTo(c, t, 300, 900, 1500, 0.7);
    const k = c.kit;
    glowOrb(k, c.caster.x + c.dir * c.caster.size * 0.35, c.caster.headY - 10, 14, "#FFE07A", 300, 600);
    at(k, 900, () => {
      k.shake(c.boss ? 16 : 11, 420);
      k.flash("#FFFFFF", 0.3, 160);
      k.sfx("skillStrike");
    });
    arcSlash(k, t.x, t.cy, t.size * 0.7, -150, 40, color, 860, 300, 18);
    crack(k, t.x, t.feetY, t.size * 1.2, "#FFD23D", 900, 1000);
    rocks(k, t.x, t.feetY, t.size, 900, 10);
    groundRing(k, t.x, t.feetY, t.size * 1.6, color, 900, 520, 5);
    boom(k, t.x, t.cy, t.size * 0.7, color, 900);
  },

  // ---------- 旋風斬：衝到場中央轉圈，旋風捲過所有敵人 ----------
  whirlwind(c) {
    const color = "#9FE8FF";
    opening(c, color, 500);
    c.pose("attack");
    const k = c.kit;
    const midX = c.targets.length ? c.targets.reduce((s, t) => s + t.x, 0) / c.targets.length : c.caster.x;
    const dx = (midX - c.caster.x) * 0.55;
    c.moveCaster(
      [
        { transform: "translate(0,0) rotate(0deg)", offset: 0 },
        { transform: `translate(${dx}px,0) rotate(0deg)`, offset: 0.35 },
        { transform: `translate(${dx}px,0) rotate(${c.dir * 720}deg)`, offset: 0.75 },
        { transform: "translate(0,0) rotate(0deg)", offset: 1 },
      ],
      0,
      1500,
    );
    const cx = c.caster.x + dx;
    for (let i = 0; i < 4; i++) {
      arcSlash(k, cx, c.caster.cy, c.caster.size * (0.6 + i * 0.1), i * 90, i * 90 + 300, color, 520 + i * 120, 300, 12);
    }
    at(k, 520, () => k.sfx("whoosh"));
    // 旋風：一團旋轉的橢圓從施放者往每個敵人掃過去
    for (const t of c.targets) {
      const g = group(k, cx, c.caster.cy);
      for (let i = 0; i < 4; i++) {
        el(k, "ellipse", { cx, cy: c.caster.cy - i * 12, rx: 24 + i * 9, ry: 7 + i * 2, fill: "none", stroke: i % 2 ? "#FFFFFF" : color, "stroke-width": 3, opacity: 0.85 }, g);
      }
      play(k, g, [
        { transform: "translate(0,0) scale(0.5)", opacity: 0 },
        { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0.15 },
        { transform: `translate(${t.x - cx}px,${t.cy - c.caster.cy}px) scale(1.25)`, opacity: 1, offset: 0.85 },
        { transform: `translate(${t.x - cx}px,${t.cy - c.caster.cy}px) scale(1.6)`, opacity: 0 },
      ], 700, 560, { easing: "ease-in" });
      airRing(k, t.x, t.cy, t.size * 0.9, color, 1200, 380);
    }
    at(k, 1200, () => {
      k.shake(c.boss ? 12 : 7, 320);
      k.sfx("explode");
    });
  },

  // ---------- 治癒：天降光柱＋綠葉繞身 ----------
  cure(c) {
    const color = "#7FE8A8";
    opening(c, color, 500);
    c.pose("cast");
    const k = c.kit;
    lightPillar(k, c.caster.x, c.caster.feetY, c.caster.size * 0.8, color, 300, 1000);
    // 葉子繞身轉一圈往上
    for (let i = 0; i < (k.lite ? 5 : 10); i++) {
      const ang = (i / 10) * Math.PI * 2;
      const lx = c.caster.x + Math.cos(ang) * c.caster.size * 0.5;
      const ly = c.caster.cy + Math.sin(ang) * c.caster.size * 0.15;
      const leaf = el(k, "path", { d: `M${lx},${ly - 8} Q${lx + 7},${ly} ${lx},${ly + 8} Q${lx - 7},${ly} ${lx},${ly - 8} Z`, fill: "#8CF0A8", stroke: "#1F6B3A", "stroke-width": 1.2 });
      leaf.style.transformOrigin = `${c.caster.x}px ${c.caster.cy}px`;
      play(k, leaf, [
        { transform: "rotate(0deg) translateY(30px)", opacity: 0 },
        { transform: "rotate(120deg) translateY(10px)", opacity: 1, offset: 0.3 },
        { transform: "rotate(300deg) translateY(-30px)", opacity: 1, offset: 0.8 },
        { transform: "rotate(400deg) translateY(-50px)", opacity: 0 },
      ], 300 + i * 30, 1000);
    }
    glowOrb(k, c.caster.x, c.caster.cy, c.caster.size * 0.7, color, 1050, 450);
    rise(k, c.caster.x, c.caster.cy, c.caster.size, color, 1050, 900, 10, "plus");
    at(k, 1050, () => k.sfx("heal"));
  },

  // ---------- 鐵壁：地面升起六角能量牆 ----------
  ironwall(c) {
    const color = "#C9D3E0";
    opening(c, color, 500);
    c.pose("cast");
    const k = c.kit;
    hexWall(k, c.caster.x + c.dir * c.caster.size * 0.55, c.caster.feetY + 4, c.caster.size * 0.5, c.caster.size * 1.2, "#9FC8FF", 600, 1600);
    at(k, 620, () => {
      k.shake(5, 220);
      k.sfx("shieldUp");
    });
    rocks(k, c.caster.x + c.dir * c.caster.size * 0.55, c.caster.feetY, c.caster.size * 0.4, 600, 6);
    groundRing(k, c.caster.x + c.dir * c.caster.size * 0.55, c.caster.feetY, c.caster.size * 0.8, "#FFFFFF", 600, 400);
  },

  // ---------- 疾風：綠色風環＋殘影 ----------
  gale(c) {
    const color = "#B9F5D0";
    opening(c, color, 450);
    c.pose("skill");
    const k = c.kit;
    for (let i = 0; i < 3; i++) groundRing(k, c.caster.x, c.caster.feetY - i * c.caster.size * 0.3, c.caster.size * 1.2, color, 600 + i * 120, 600, 4);
    // 風刃從身邊往後刷
    for (let i = 0; i < (k.lite ? 4 : 8); i++) {
      const y = c.caster.headY + (i / 8) * c.caster.size * 0.9;
      const ln = el(k, "path", { d: `M${c.caster.x},${y} l${-c.dir * c.caster.size},${-6}`, stroke: i % 2 ? "#FFFFFF" : color, "stroke-width": 3, "stroke-linecap": "round" });
      play(k, ln, [
        { transform: "translateX(0)", opacity: 0 },
        { transform: `translateX(${c.dir * 10}px)`, opacity: 1, offset: 0.2 },
        { transform: `translateX(${-c.dir * 60}px)`, opacity: 0 },
      ], 700 + i * 50, 420);
    }
    if (k.fx) {
      const fx = k.fx;
      at(k, 700, () => fx.speedLines(c.caster.x, c.caster.cy, c.dir, c.caster.size, color));
      at(k, 900, () => fx.speedLines(c.caster.x, c.caster.cy, c.dir, c.caster.size, "#FFFFFF"));
    }
    at(k, 650, () => k.sfx("buff"));
  },

  // ---------- 怒吼：紅色音波＋怒氣 ----------
  warcry(c) {
    const color = "#FF5C3C";
    opening(c, color, 500);
    c.pose("skill");
    const k = c.kit;
    soundWaves(k, c.caster.x + c.dir * c.caster.size * 0.3, c.caster.headY + c.caster.size * 0.25, c.dir, color, 700, 5);
    flameColumn(k, c.caster, 650, 800, "#FF7A5C", 0.8);
    at(k, 700, () => {
      k.shake(c.boss ? 14 : 8, 500);
      k.flash("#FF3C2E", 0.16, 300);
      k.sfx("bossRoar");
    });
    // 「怒」字的感嘆符號
    const ex = el(k, "text", { x: c.caster.x + c.dir * c.caster.size * 0.4, y: c.caster.headY, "font-size": 30, "font-weight": 900, fill: "#FF3C2E", stroke: "#3A0800", "stroke-width": 2, "text-anchor": "middle" });
    ex.textContent = "!!";
    ex.style.transformOrigin = `${c.caster.x + c.dir * c.caster.size * 0.4}px ${c.caster.headY}px`;
    play(k, ex, [
      { transform: "scale(0)", opacity: 0 },
      { transform: "scale(1.4)", opacity: 1, offset: 0.25 },
      { transform: "scale(1)", opacity: 1, offset: 0.7 },
      { transform: "scale(1.2) translateY(-10px)", opacity: 0 },
    ], 680, 700);
  },

  // ---------- 震擊：重砸地面，衝擊波沿地面衝向目標 ----------
  quake(c) {
    const color = "#E0B26A";
    opening(c, color, 600);
    c.pose("skill");
    const k = c.kit;
    const t = first(c);
    at(k, 900, () => {
      k.shake(c.boss ? 14 : 9, 400);
      k.sfx("skillStrike");
    });
    crack(k, c.caster.x, c.caster.feetY, c.caster.size, "#FFD23D", 900, 700);
    groundRing(k, c.caster.x, c.caster.feetY, c.caster.size * 1.4, color, 900, 500, 5);
    // 一路往目標冒出石錐
    const n = k.lite ? 4 : 7;
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      const x = c.caster.x + (t.x - c.caster.x) * p;
      const y = c.caster.feetY + (t.feetY - c.caster.feetY) * p;
      const h = 14 + p * 20;
      const spike = el(k, "path", { d: `M${x - 8},${y} L${x - 2},${y - h} L${x + 3},${y - h * 0.7} L${x + 8},${y} Z`, fill: "#B89A6A", stroke: "#3E2A1E", "stroke-width": 1.6 });
      spike.style.transformOrigin = `${x}px ${y}px`;
      play(k, spike, [
        { transform: "scaleY(0)", opacity: 1 },
        { transform: "scaleY(1.2)", opacity: 1, offset: 0.3 },
        { transform: "scaleY(1)", opacity: 1, offset: 0.6 },
        { transform: "scaleY(0.2)", opacity: 0 },
      ], 920 + i * 45, 500);
      rocks(k, x, y, 20, 920 + i * 45, 2);
    }
    boom(k, t.x, t.feetY - t.size * 0.3, t.size * 0.6, color, 1250);
    dizzyStars(k, t.x, t.headY - 6, 1250, 900);
  },

  // ---------- 護盾術：泡泡由小變大包住全身 ----------
  barrier(c) {
    const color = "#9FE0FF";
    opening(c, color, 500);
    c.pose("cast");
    const k = c.kit;
    bubble(k, c.caster, color, 550, 1500);
    rise(k, c.caster.x, c.caster.cy, c.caster.size, color, 600, 900, 10);
    at(k, 560, () => k.sfx("shieldUp"));
  },

  // ---------- 小兵・堅守：插旗＋金色盾形光罩＋光柱 ----------
  holdfast(c) {
    const color = "#FFD23D";
    opening(c, color, 600);
    c.pose("skill");
    const k = c.kit;
    const a = c.caster;
    at(k, 920, () => {
      k.shake(8, 360);
      k.sfx("skillStrike");
    });
    crack(k, a.x, a.feetY, a.size, color, 920, 900);
    rocks(k, a.x, a.feetY, a.size * 0.8, 920, 8);
    groundRing(k, a.x, a.feetY, a.size * 1.5, "#FFF4C2", 920, 500, 5);
    // 軍旗從地面升起
    const fx0 = a.x - c.dir * a.size * 0.62;
    const flag = group(k, fx0, a.feetY);
    el(k, "rect", { x: fx0 - 2.5, y: a.feetY - a.size * 1.15, width: 5, height: a.size * 1.15, rx: 2, fill: "#C8962A", stroke: "#3E2A1E", "stroke-width": 1.8 }, flag);
    el(k, "circle", { cx: fx0, cy: a.feetY - a.size * 1.17, r: 5, fill: "#FFE07A", stroke: "#3E2A1E", "stroke-width": 1.6 }, flag);
    const bx = fx0 + c.dir * 2.5;
    const by = a.feetY - a.size * 1.1;
    const banner = el(k, "path", { d: `M${bx},${by} L${bx + c.dir * 44},${by + 4} L${bx + c.dir * 34},${by + 20} L${bx + c.dir * 46},${by + 38} L${bx},${by + 36} Z`, fill: "#5FA6DA", stroke: "#3E2A1E", "stroke-width": 2 }, flag);
    banner.style.transformOrigin = `${bx}px ${by + 18}px`;
    play(k, banner, [{ transform: "skewY(0deg)" }, { transform: "skewY(-8deg)" }, { transform: "skewY(4deg)" }, { transform: "skewY(0deg)" }], 900, 600, { removeAfter: false, iterations: 3 });
    play(k, flag, [
      { transform: "translateY(40px) scaleY(0.2)", opacity: 0 },
      { transform: "translateY(40px) scaleY(0.2)", opacity: 0, offset: 0.4 },
      { transform: "translateY(-8px) scaleY(1.08)", opacity: 1, offset: 0.5, easing: "ease-out" },
      { transform: "translateY(0) scaleY(1)", opacity: 1, offset: 0.56 },
      { transform: "translateY(0) scaleY(1)", opacity: 1, offset: 0.9 },
      { transform: "translateY(6px) scaleY(1)", opacity: 0 },
    ], 0, 2300);
    lightPillar(k, a.x, a.feetY, a.size * 0.9, color, 950, 900);
    shieldDome(k, a, color, 980, 1500);
    rise(k, a.x, a.cy, a.size, color, 1000, 900, 12);
    rise(k, a.x, a.cy, a.size * 0.8, color, 1100, 800, 4, "plus");
  },

  // ---------- 小兵・衝鋒：化成一道光衝過去撞飛 ----------
  charge(c) {
    const color = "#FF9A3D";
    opening(c, color, 700);
    c.pose("attack");
    const k = c.kit;
    const t = first(c);
    dashTo(c, t, 650, 950, 1500);
    glowOrb(k, c.caster.x, c.caster.cy, c.caster.size * 0.6, color, 350, 600);
    // 拖尾的光帶
    const len = Math.abs(t.x - c.caster.x);
    const trail = el(k, "rect", { x: Math.min(c.caster.x, t.x), y: c.caster.cy - c.caster.size * 0.22, width: len, height: c.caster.size * 0.44, rx: c.caster.size * 0.22, fill: "url(#sfx-beam)" });
    trail.style.transformOrigin = `${c.caster.x}px ${c.caster.cy}px`;
    trail.style.filter = `drop-shadow(0 0 10px ${color})`;
    play(k, trail, [
      { transform: "scaleX(0)", opacity: 0 },
      { transform: "scaleX(0)", opacity: 0.9, offset: 0.25 },
      { transform: "scaleX(1)", opacity: 0.9, offset: 0.5 },
      { transform: "scaleX(1) scaleY(0.3)", opacity: 0 },
    ], 650, 650);
    if (k.fx) {
      const fx = k.fx;
      at(k, 700, () => fx.speedLines(c.caster.x, c.caster.cy, c.dir, c.caster.size * 1.4, color));
    }
    at(k, 950, () => {
      k.shake(c.boss ? 16 : 12, 420);
      k.flash("#FFFFFF", 0.32, 160);
      k.sfx("skillStrike");
    });
    boom(k, t.x, t.cy, t.size * 0.8, color, 950);
    rocks(k, t.x, t.feetY, t.size, 950, 6);
  },

  // ---------- 炮兵・轟炸：朝天連發，砲彈從天而降炸滿全場 ----------
  barrage(c) {
    const color = "#FF6A3D";
    opening(c, color, 450);
    c.pose("attack");
    c.tiltMount?.(-40, 200, 1000);
    const k = c.kit;
    const muzzle: [number, number] = [c.caster.x + c.dir * c.caster.size * 0.55, c.caster.cy - c.caster.size * 0.3];
    for (let i = 0; i < 5; i++) {
      const t0 = 380 + i * 90;
      glowOrb(k, muzzle[0], muzzle[1], 18, "#FFE07A", t0, 220);
      at(k, t0, () => {
        k.shake(4, 120);
        k.sfx("explode");
      });
      shoot(k, muzzle, [muzzle[0] + c.dir * 30, -40], "#FFB347", t0, 280, 7);
    }
    c.targets.forEach((t, i) => {
      const t0 = 950 + i * 90;
      // 落下的砲彈
      const ball = group(k, t.x, -30);
      el(k, "circle", { cx: t.x, cy: -30, r: 9, fill: "#2E323A", stroke: "#FFB347", "stroke-width": 2 }, ball);
      el(k, "path", { d: `M${t.x},${-30 - 9} L${t.x},${-30 - 40}`, stroke: "#FFE07A", "stroke-width": 4, "stroke-linecap": "round", opacity: 0.7 }, ball);
      play(k, ball, [
        { transform: "translateY(0)", opacity: 1 },
        { transform: `translateY(${t.cy + 30}px)`, opacity: 1 },
      ], t0 - 260, 260, { easing: "ease-in" });
      boom(k, t.x, t.cy, t.size * 0.9, color, t0, ["#FFFFFF", "#FFE07A", "#FF6A3D", "#5A4A40"]);
      groundRing(k, t.x, t.feetY, t.size * 1.3, "#FFB347", t0, 450);
      rocks(k, t.x, t.feetY, t.size * 0.8, t0, 5, "#5A4A40");
      at(k, t0, () => {
        k.shake(c.boss ? 14 : 9, 260);
        k.sfx("explode");
      });
    });
  },

  // ---------- 炮兵・蓄力炮：炮口吸光 → 粗光束貫穿 ----------
  bigshot(c) {
    const color = "#FFD23D";
    opening(c, color, 400);
    c.pose("cast");
    c.tiltMount?.(8, 200, 1000);
    const k = c.kit;
    const t = first(c);
    const mx = c.caster.x + c.dir * c.caster.size * 0.6;
    const my = c.caster.cy - c.caster.size * 0.2;
    gather(k, mx, my, c.caster.size * 0.9, color, 200, 700, 20);
    glowOrb(k, mx, my, 26, color, 300, 700, [
      { transform: "scale(0.2)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.8 },
      { transform: "scale(1.6)", opacity: 0 },
    ]);
    // 光束
    const len = Math.hypot(t.x - mx, t.cy - my) + 60;
    const ang = (Math.atan2(t.cy - my, t.x - mx) * 180) / Math.PI;
    const beam = group(k, mx, my);
    beam.setAttribute("transform", `rotate(${ang} ${mx} ${my})`);
    const core = el(k, "rect", { x: mx, y: my - 16, width: len, height: 32, fill: "url(#sfx-beam)" }, beam);
    core.style.filter = `drop-shadow(0 0 14px ${color})`;
    el(k, "rect", { x: mx, y: my - 30, width: len, height: 60, fill: color, opacity: 0.25, filter: "url(#sfx-blur)" }, beam);
    const inner = group(k, mx, my, beam);
    inner.appendChild(core);
    play(k, inner, [
      { transform: "scaleX(0) scaleY(1)", opacity: 1 },
      { transform: "scaleX(1) scaleY(1.2)", opacity: 1, offset: 0.2 },
      { transform: "scaleX(1) scaleY(0.8)", opacity: 1, offset: 0.6 },
      { transform: "scaleX(1) scaleY(0)", opacity: 0 },
    ], 950, 450, { removeAfter: false });
    play(k, beam, [{ opacity: 1 }, { opacity: 1 }], 950, 460);
    // 光束上的光環
    for (let i = 0; i < 3; i++) {
      const p = 0.3 + i * 0.25;
      airRing(k, mx + (t.x - mx) * p, my + (t.cy - my) * p, 34, "#FFFFFF", 980 + i * 60, 300, 3);
    }
    at(k, 950, () => {
      k.shake(c.boss ? 16 : 12, 450);
      k.flash(color, 0.25, 200);
      k.sfx("skillStrike");
    });
    boom(k, t.x, t.cy, t.size * 1, color, 1050);
  },

  // ---------- 馬伕・連踢：小馬揚蹄，衝過去三連踢 ----------
  triplekick(c) {
    const color = "#FFE58A";
    opening(c, color, 500);
    c.pose("attack");
    c.tiltMount?.(-25, 200, 500);
    const k = c.kit;
    const t = first(c);
    leapTo(c, t, 300, 700, 1500, 0.3);
    for (let i = 0; i < 3; i++) {
      const t0 = 760 + i * 170;
      const hx = t.x + (i - 1) * t.size * 0.12;
      const hy = t.cy + (i - 1) * t.size * 0.18;
      // 馬蹄印
      const hoof = group(k, hx, hy);
      el(k, "path", { d: `M${hx - 12},${hy + 10} C${hx - 16},${hy - 8} ${hx - 6},${hy - 16} ${hx},${hy - 16} C${hx + 6},${hy - 16} ${hx + 16},${hy - 8} ${hx + 12},${hy + 10} L${hx + 6},${hy + 10} C${hx + 8},${hy - 2} ${hx + 4},${hy - 8} ${hx},${hy - 8} C${hx - 4},${hy - 8} ${hx - 8},${hy - 2} ${hx - 6},${hy + 10} Z`, fill: "#FFFFFF", stroke: color, "stroke-width": 2 }, hoof);
      hoof.style.filter = `drop-shadow(0 0 6px ${color})`;
      play(k, hoof, [
        { transform: `rotate(${(i - 1) * 25}deg) scale(2)`, opacity: 0 },
        { transform: `rotate(${(i - 1) * 25}deg) scale(1)`, opacity: 1, offset: 0.2 },
        { transform: `rotate(${(i - 1) * 25}deg) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `rotate(${(i - 1) * 25}deg) scale(1.3)`, opacity: 0 },
      ], t0, 500);
      airRing(k, hx, hy, t.size * 0.5, color, t0, 300);
      at(k, t0, () => {
        k.shake(5 + i * 2, 160);
        k.sfx("hitHeavy");
      });
      if (k.fx) {
        const fx = k.fx;
        at(k, t0, () => fx.impact(hx, hy, { colors: ["#FFFFFF", color], crit: i === 2, dir: c.dir, power: 1 }));
      }
    }
  },

  // ---------- 馬伕・奔襲：塵土＋金色速度線＋殘影 ----------
  gallop(c) {
    const color = "#B9F5D0";
    opening(c, color, 450);
    c.pose("skill");
    c.tiltMount?.(-20, 300, 600);
    const k = c.kit;
    if (k.fx) {
      const fx = k.fx;
      for (let i = 0; i < 4; i++) at(k, 500 + i * 120, () => fx.dust(c.caster.x - c.dir * c.caster.size * 0.3, c.caster.feetY, c.caster.size * 1.2));
      for (let i = 0; i < 3; i++) at(k, 700 + i * 150, () => fx.speedLines(c.caster.x, c.caster.cy, c.dir, c.caster.size * 1.3, i % 2 ? "#FFE58A" : "#FFFFFF"));
    }
    for (let i = 0; i < 3; i++) groundRing(k, c.caster.x, c.caster.feetY, c.caster.size * (1 + i * 0.3), "#FFE58A", 600 + i * 130, 500, 3);
    rise(k, c.caster.x, c.caster.cy, c.caster.size, "#FFE58A", 700, 700, 10);
    at(k, 600, () => k.sfx("buff"));
  },

  // ---------- 戰車・衝撞：車輪噴火往前衝 ----------
  ram(c) {
    const color = "#FF8A3D";
    opening(c, color, 500);
    c.pose("attack");
    const k = c.kit;
    const t = first(c);
    flameColumn(k, c.caster, 400, 600, "#FF8A3D", 0.6);
    dashTo(c, t, 600, 900, 1500);
    if (k.fx) {
      const fx = k.fx;
      at(k, 650, () => fx.speedLines(c.caster.x, c.caster.cy, c.dir, c.caster.size * 1.4, color));
      for (let i = 0; i < 3; i++) at(k, 620 + i * 90, () => fx.dust(c.caster.x + c.dir * i * 30, c.caster.feetY, c.caster.size, "#FFB070"));
    }
    at(k, 900, () => {
      k.shake(c.boss ? 16 : 12, 420);
      k.flash("#FFFFFF", 0.3, 160);
      k.sfx("skillStrike");
    });
    boom(k, t.x, t.cy, t.size * 0.85, color, 900, ["#FFFFFF", "#FFE07A", "#FF8A3D", "#E8381A"]);
    dizzyStars(k, t.x, t.headY - 6, 1100, 800);
  },

  // ---------- 戰車・鐵輪：車輪燒紅、噴火星 ----------
  ironwheel(c) {
    const color = "#FF5C2E";
    opening(c, color, 500);
    c.pose("skill");
    const k = c.kit;
    for (const side of [-1, 1]) {
      const wx = c.caster.x + side * c.caster.size * 0.35;
      const wy = c.caster.feetY - c.caster.size * 0.12;
      const ring = group(k, wx, wy);
      el(k, "circle", { cx: wx, cy: wy, r: c.caster.size * 0.2, fill: "none", stroke: "#FF5C2E", "stroke-width": 6, "stroke-dasharray": "10 6" }, ring);
      el(k, "circle", { cx: wx, cy: wy, r: c.caster.size * 0.2, fill: radial(k, "#FF8A3D"), opacity: 0.6 }, ring);
      ring.style.filter = "drop-shadow(0 0 8px #FF5C2E)";
      play(k, ring, [
        { transform: "rotate(0deg) scale(0.5)", opacity: 0 },
        { transform: "rotate(360deg) scale(1)", opacity: 1, offset: 0.3 },
        { transform: "rotate(1440deg) scale(1)", opacity: 1, offset: 0.85 },
        { transform: "rotate(1620deg) scale(1.2)", opacity: 0 },
      ], 500, 1100);
      rise(k, wx, wy, 30, "#FF8A3D", 600, 700, 8, "ember");
    }
    flameColumn(k, c.caster, 700, 700, "#FF5C2E", 0.7);
    at(k, 700, () => {
      k.shake(6, 300);
      k.sfx("burn");
    });
  },

  // ---------- 巨象・象牙盾：兩支大象牙交叉成盾 ----------
  tuskguard(c) {
    const color = "#DFF6FF";
    opening(c, color, 450);
    c.pose("cast");
    c.tiltMount?.(-20, 200, 700);
    const k = c.kit;
    const a = c.caster;
    const cx = a.x + c.dir * a.size * 0.45;
    for (const side of [-1, 1]) {
      const tusk = group(k, cx, a.feetY);
      el(k, "path", {
        d: `M${cx + side * 22},${a.feetY} C${cx + side * 30},${a.feetY - a.size * 0.5} ${cx - side * 10},${a.feetY - a.size * 0.9} ${cx - side * 30},${a.feetY - a.size * 1.05} C${cx - side * 4},${a.feetY - a.size * 0.8} ${cx + side * 12},${a.feetY - a.size * 0.45} ${cx + side * 8},${a.feetY} Z`,
        fill: "#FFFDF2",
        stroke: "#3E2A1E",
        "stroke-width": 2.4,
      }, tusk);
      tusk.style.filter = "drop-shadow(0 0 8px #DFF6FF)";
      play(k, tusk, [
        { transform: `translateY(${a.size * 0.5}px) rotate(${side * 30}deg)`, opacity: 0 },
        { transform: `translateY(-6px) rotate(${-side * 4}deg)`, opacity: 1, offset: 0.25, easing: "ease-out" },
        { transform: "translateY(0) rotate(0deg)", opacity: 1, offset: 0.35 },
        { transform: "translateY(0) rotate(0deg)", opacity: 1, offset: 0.85 },
        { transform: "translateY(4px) rotate(0deg)", opacity: 0 },
      ], 550, 1500);
    }
    at(k, 620, () => {
      k.shake(7, 260);
      k.sfx("shieldUp");
    });
    bubble(k, a, color, 700, 1300);
    rocks(k, cx, a.feetY, a.size * 0.5, 600, 6);
  },

  // ---------- 巨象・踐踏：抬腳重踩，全場地震 ----------
  stomp(c) {
    const color = "#C9A26A";
    opening(c, color, 600);
    c.pose("skill");
    c.tiltMount?.(-30, 200, 800);
    const k = c.kit;
    at(k, 920, () => {
      k.shake(c.boss ? 22 : 16, 650);
      k.flash("#FFFFFF", 0.25, 160);
      k.sfx("explode");
    });
    crack(k, c.caster.x, c.caster.feetY, c.caster.size * 1.4, "#FFD23D", 920, 900);
    for (let i = 0; i < 3; i++) groundRing(k, c.caster.x, c.caster.feetY, c.caster.size * (2 + i * 1.2), i ? "#FFFFFF" : color, 920 + i * 100, 700, 6 - i);
    for (const t of c.targets) {
      rocks(k, t.x, t.feetY, t.size, 1050, 8);
      groundRing(k, t.x, t.feetY, t.size * 1.2, color, 1050, 450);
      dizzyStars(k, t.x, t.headY - 6, 1200, 900);
    }
  },

  // ---------- 仕官・守護：每個隊友腳下升起金色盾紋 ----------
  guardian(c) {
    const color = "#9FE0FF";
    opening(c, color, 500);
    c.pose("cast");
    const k = c.kit;
    lightPillar(k, c.caster.x, c.caster.feetY, c.caster.size * 0.6, "#FFD23D", 400, 700);
    c.allies.forEach((a, i) => {
      const t0 = 650 + i * 120;
      shieldDome(k, a, "#FFD23D", t0, 1300);
      groundRing(k, a.x, a.feetY, a.size * 1.2, "#FFD23D", t0, 500);
      // 光從施放者飛過去
      if (a !== c.caster) shoot(k, [c.caster.x, c.caster.headY], [a.x, a.cy], "#FFD23D", t0 - 250, 250, 7, 40);
    });
    at(k, 650, () => k.sfx("shieldUp"));
  },

  // ---------- 仕官・療癒：天上落下金色羽毛，碰到隊友變回血光 ----------
  mend(c) {
    const color = "#FFE07A";
    opening(c, color, 500);
    c.pose("cast");
    const k = c.kit;
    for (const a of c.allies) {
      fall(k, a.x, a.headY - 120, a.cy, a.size, color, 300, 900, 8, "feather");
      glowOrb(k, a.x, a.cy, a.size * 0.6, "#7FE8A8", 1100, 420);
      rise(k, a.x, a.cy, a.size, "#7FE8A8", 1100, 800, 6, "plus");
    }
    at(k, 1100, () => k.sfx("heal"));
  },

  // ---------- 將軍・號令：舉劍指天，金色旗光擴散到全隊 ----------
  command(c) {
    const color = "#FFD23D";
    opening(c, color, 500);
    c.pose("skill");
    const k = c.kit;
    const sx = c.caster.x + c.dir * c.caster.size * 0.25;
    const sy = c.caster.headY - c.caster.size * 0.5;
    // 劍尖的光芒
    const star = el(k, "path", { d: `M${sx},${sy - 30} L${sx + 6},${sy - 6} L${sx + 30},${sy} L${sx + 6},${sy + 6} L${sx},${sy + 30} L${sx - 6},${sy + 6} L${sx - 30},${sy} L${sx - 6},${sy - 6} Z`, fill: "#FFFFFF" });
    star.style.transformOrigin = `${sx}px ${sy}px`;
    star.style.filter = `drop-shadow(0 0 10px ${color})`;
    play(k, star, [
      { transform: "scale(0) rotate(0deg)", opacity: 0 },
      { transform: "scale(1.3) rotate(45deg)", opacity: 1, offset: 0.3 },
      { transform: "scale(1) rotate(90deg)", opacity: 1, offset: 0.7 },
      { transform: "scale(0) rotate(135deg)", opacity: 0 },
    ], 550, 700);
    lightPillar(k, sx, c.caster.feetY, 40, color, 600, 800);
    // 金色旗幟（大大的徽記浮在半空）
    const bx = c.caster.x;
    const by = c.caster.headY - c.caster.size * 0.7;
    const emblem = group(k, bx, by);
    el(k, "path", { d: `M${bx - 26},${by - 30} L${bx + 26},${by - 30} L${bx + 26},${by + 18} L${bx},${by + 34} L${bx - 26},${by + 18} Z`, fill: "#C42A2A", stroke: "#FFD23D", "stroke-width": 4 }, emblem);
    el(k, "path", { d: `M${bx},${by - 18} L${bx + 4},${by - 6} L${bx + 16},${by - 5} L${bx + 7},${by + 3} L${bx + 10},${by + 15} L${bx},${by + 8} L${bx - 10},${by + 15} L${bx - 7},${by + 3} L${bx - 16},${by - 5} L${bx - 4},${by - 6} Z`, fill: "#FFD23D", stroke: "#7A4A06", "stroke-width": 1.4 }, emblem);
    emblem.style.filter = `drop-shadow(0 0 10px ${color})`;
    play(k, emblem, [
      { transform: "translateY(20px) scale(0)", opacity: 0 },
      { transform: "translateY(0) scale(1.2)", opacity: 1, offset: 0.3, easing: "ease-out" },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.45 },
      { transform: "translateY(-6px) scale(1)", opacity: 1, offset: 0.85 },
      { transform: "translateY(-12px) scale(1.3)", opacity: 0 },
    ], 650, 1100);
    at(k, 900, () => {
      k.flash(color, 0.18, 260);
      k.sfx("buff");
    });
    for (const a of c.allies) {
      groundRing(k, a.x, a.feetY, a.size * 1.4, color, 950, 520);
      flameColumn(k, a, 980, 600, "#FFD23D", 0.6);
    }
  },

  // ---------- 將軍・將威：劍光化成金龍斬過去 ----------
  majesty(c) {
    const color = "#FFB347";
    opening(c, color, 600);
    c.pose("skill");
    const k = c.kit;
    const t = first(c);
    const x0 = c.caster.x + c.dir * c.caster.size * 0.3;
    const y0 = c.caster.cy - c.caster.size * 0.2;
    // 龍身：一條波浪的金色長帶，帶著頭往目標飛
    const dx = t.x - x0;
    const dy = t.cy - y0;
    const g = group(k, x0, y0);
    const segs = 9;
    let body = `M${x0},${y0}`;
    for (let i = 1; i <= segs; i++) {
      const p = i / segs;
      body += ` Q${x0 + dx * (p - 0.06)},${y0 + dy * p + (i % 2 ? -26 : 26)} ${x0 + dx * p},${y0 + dy * p}`;
    }
    const bodyPath = el(k, "path", { d: body, fill: "none", stroke: "#FFD23D", "stroke-width": 16, "stroke-linecap": "round", "stroke-dasharray": 2000, "stroke-dashoffset": 2000 }, g);
    bodyPath.style.filter = "drop-shadow(0 0 10px #FFB347)";
    const scales = el(k, "path", { d: body, fill: "none", stroke: "#FFF4C2", "stroke-width": 4, "stroke-dasharray": "6 8" }, g);
    play(k, bodyPath, [{ strokeDashoffset: 2000 }, { strokeDashoffset: 0 }], 750, 420, { removeAfter: false, easing: "ease-in" });
    play(k, scales, [{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }], 750, 420, { removeAfter: false });
    play(k, g, [{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], 750, 750);
    // 龍頭
    const hx = t.x;
    const hy = t.cy;
    const head = group(k, hx, hy);
    const s = c.dir;
    el(k, "path", { d: `M${hx - s * 30},${hy - 14} L${hx + s * 10},${hy - 18} L${hx + s * 26},${hy - 4} L${hx + s * 10},${hy + 2} L${hx + s * 22},${hy + 12} L${hx - s * 6},${hy + 12} L${hx - s * 30},${hy + 6} Z`, fill: "#FFD23D", stroke: "#7A4A06", "stroke-width": 2 }, head);
    el(k, "path", { d: `M${hx - s * 20},${hy - 14} L${hx - s * 34},${hy - 34} L${hx - s * 10},${hy - 18} Z M${hx - s * 6},${hy - 16} L${hx - s * 12},${hy - 38} L${hx + s * 4},${hy - 18} Z`, fill: "#FFF4C2", stroke: "#7A4A06", "stroke-width": 1.6 }, head);
    el(k, "circle", { cx: hx + s * 4, cy: hy - 8, r: 3, fill: "#C42A2A" }, head);
    head.style.filter = "drop-shadow(0 0 10px #FFB347)";
    play(k, head, [
      { transform: `translate(${-dx}px,${-dy}px) scale(0.5)`, opacity: 0 },
      { transform: `translate(${-dx * 0.9}px,${-dy * 0.9}px) scale(1)`, opacity: 1, offset: 0.1 },
      { transform: "translate(0,0) scale(1.2)", opacity: 1, offset: 0.65, easing: "ease-in" },
      { transform: "translate(0,0) scale(1.6)", opacity: 0 },
    ], 750, 600);
    arcSlash(k, t.x, t.cy, t.size * 0.75, -140, 60, "#FFD23D", 1150, 300, 18);
    at(k, 1150, () => {
      k.shake(c.boss ? 16 : 12, 420);
      k.flash("#FFE07A", 0.3, 200);
      k.sfx("skillStrike");
    });
    boom(k, t.x, t.cy, t.size * 0.8, "#FFD23D", 1150);
  },

  // ---------- 鳳凰・浴火：全身燃起火焰，羽毛重生 ----------
  rebirth(c) {
    const color = "#FF9A3D";
    opening(c, color, 450);
    c.pose("cast");
    const k = c.kit;
    flameColumn(k, c.caster, 400, 1000, "#FFF07A", 1.2);
    lightPillar(k, c.caster.x, c.caster.feetY, c.caster.size, "#FF9A3D", 700, 800);
    rise(k, c.caster.x, c.caster.cy, c.caster.size * 1.2, "#FFB43A", 900, 900, 14, "feather");
    glowOrb(k, c.caster.x, c.caster.cy, c.caster.size * 0.8, "#FFE07A", 1000, 500);
    at(k, 450, () => k.sfx("burn"));
    at(k, 1000, () => {
      k.flash("#FFB43A", 0.25, 260);
      k.sfx("heal");
    });
  },

  // ---------- 鳳凰・烈焰：火鳥飛撲目標 ----------
  inferno(c) {
    const color = "#FF4D2E";
    opening(c, color, 550);
    c.pose("cast");
    const k = c.kit;
    const t = first(c);
    const x0 = c.caster.x + c.dir * c.caster.size * 0.3;
    const y0 = c.caster.headY;
    const bird = group(k, x0, y0);
    const s = c.dir;
    // 火鳥：身體＋大翅膀＋長尾
    el(k, "path", { d: `M${x0 - s * 46},${y0 + 4} Q${x0 - s * 20},${y0 - 2} ${x0},${y0} Q${x0 - s * 20},${y0 + 8} ${x0 - s * 46},${y0 + 14} Z`, fill: "url(#sfx-fire)" }, bird);
    const wingUp = el(k, "path", { d: `M${x0 - s * 6},${y0 - 2} Q${x0 - s * 20},${y0 - 40} ${x0 - s * 44},${y0 - 44} Q${x0 - s * 26},${y0 - 22} ${x0 - s * 18},${y0} Z`, fill: "url(#sfx-fire)" }, bird);
    wingUp.style.transformOrigin = `${x0 - s * 8}px ${y0}px`;
    el(k, "path", { d: `M${x0 - s * 6},${y0 + 4} Q${x0 - s * 22},${y0 + 32} ${x0 - s * 40},${y0 + 36} Q${x0 - s * 24},${y0 + 18} ${x0 - s * 18},${y0 + 4} Z`, fill: "url(#sfx-fire)" }, bird);
    el(k, "path", { d: `M${x0 + s * 12},${y0 + 2} Q${x0},${y0 - 12} ${x0 - s * 10},${y0 - 2} Q${x0},${y0 + 12} ${x0 + s * 12},${y0 + 2} Z`, fill: "#FFF07A" }, bird);
    el(k, "circle", { cx: x0 + s * 2, cy: y0 - 2, r: 2, fill: "#7A0C0C" }, bird);
    bird.style.filter = "drop-shadow(0 0 12px #FF7A1E)";
    play(k, wingUp, [{ transform: "scaleY(1)" }, { transform: "scaleY(-0.6)" }, { transform: "scaleY(1)" }], 650, 200, { removeAfter: false, iterations: 3 });
    const dx = t.x - x0;
    const dy = t.cy - y0;
    play(k, bird, [
      { transform: "translate(0,0) scale(0.3)", opacity: 0 },
      { transform: `translate(${-s * 10}px,-30px) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 50}px) scale(1.15)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${dx}px,${dy}px) scale(1.3)`, opacity: 1, offset: 0.92, easing: "ease-in" },
      { transform: `translate(${dx}px,${dy}px) scale(1.8)`, opacity: 0 },
    ], 550, 650);
    if (k.fx) {
      const fx = k.fx;
      at(k, 700, () => fx.projectile(x0, y0 - 30, t.x, t.cy, "#FF7A1E", 0.45));
    }
    at(k, 1150, () => {
      k.shake(c.boss ? 16 : 11, 420);
      k.flash("#FF7A1E", 0.3, 220);
      k.sfx("explode");
    });
    boom(k, t.x, t.cy, t.size * 0.9, color, 1150, ["#FFF07A", "#FF9A1E", "#FF4D2E", "#7A1A0A"]);
    flameColumn(k, t, 1150, 600, "#FF9A1E", 0.9);
  },

  // ---------- Boss・狂暴：黑紅氣焰、眼睛發光、地面紅色裂痕 ----------
  berserk(c) {
    const color = "#FF2D46";
    opening(c, color, 500);
    const k = c.kit;
    flameColumn(k, c.caster, 300, 1100, "#FF2D46", 1.4);
    crack(k, c.caster.x, c.caster.feetY, c.caster.size * 1.6, "#FF2D46", 600, 900);
    for (let i = 0; i < 3; i++) groundRing(k, c.caster.x, c.caster.feetY, c.caster.size * (1.6 + i * 0.8), "#FF2D46", 600 + i * 120, 600, 5);
    // 發光的紅眼
    for (const side of [-1, 1]) {
      glowOrb(k, c.caster.x + side * c.caster.size * 0.12, c.caster.headY + c.caster.size * 0.2, 12, "#FF2D46", 500, 900);
    }
    at(k, 600, () => {
      k.shake(18, 700);
      k.flash("#3A0008", 0.35, 400);
      k.sfx("bossRoar");
    });
  },
};

/** 播一招的施放演出（BattleStage 在收到 skill 事件時呼叫） */
export function playSkillFx(c: SkillCast): void {
  const fn = SKILL_FX[c.skillId];
  if (!fn) return;
  if (c.boss) {
    // Boss：整個演出放大（位移、尺寸都用 Boss 自己的 anchor，已經比較大），
    // 這裡額外加一層紅色邊框警示
    c.kit.flash("#FF2D46", 0.2, 300);
  }
  fn(c);
}
