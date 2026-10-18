// src/components/battle/skillfx/stageFx.ts

/**
 * 技能特效的繪圖工具（戰場座標的 SVG 疊層）
 * ------------------------------------------------------------
 * 技能動畫會跨越整個戰場（砲彈從天上掉、火鳥飛向敵人），所以畫在一張
 * 跟戰場同大小的 <svg>（座標＝像素）上，用 Web Animations API 驅動。
 * 每個元素動畫播完自己移除，不會留垃圾。
 *
 * 時間一律用「×1 速度的毫秒」寫，工具內部會除以目前倍速。
 * 粒子（火花、碎屑）交給 Canvas 的 FxEngine，SVG 負責有形狀的東西
 * （光柱、盾、旗子、火鳥、龍、刀光弧線）。
 */

import type { FxEngine } from "@/components/battle/fxEngine";

const NS = "http://www.w3.org/2000/svg";

export interface StageAnchor {
  x: number;
  feetY: number;
  size: number;
  cy: number;
  headY: number;
}

export interface FxKit {
  layer: SVGSVGElement;
  fx: FxEngine | null;
  speed: number;
  /** 畫面效果（由 BattleStage 提供） */
  shake: (intensity: number, ms: number) => void;
  flash: (color: string, alpha: number, ms: number) => void;
  sfx: (name: string) => void;
  /** 低畫質：粒子、殘影少一點 */
  lite: boolean;
}

// ============================================================
// 基本建構
// ============================================================

export function el<K extends keyof SVGElementTagNameMap>(
  kit: FxKit,
  tag: K,
  attrs: Record<string, string | number>,
  parent?: Element,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  (parent ?? kit.layer).appendChild(node);
  return node;
}

/** 一組元素包在 <g> 裡，transform-origin 用像素座標 */
export function group(kit: FxKit, ox = 0, oy = 0, parent?: Element): SVGGElement {
  const g = el(kit, "g", {}, parent);
  g.style.transformOrigin = `${ox}px ${oy}px`;
  g.style.transformBox = "view-box";
  return g;
}

/**
 * 播放動畫：t0 = 開始時間、dur = 長度（×1 毫秒）。
 * removeAfter = 播完把元素移除（預設是）。
 */
export function play(kit: FxKit, node: Element, frames: Keyframe[], t0: number, dur: number, opts?: { removeAfter?: boolean; easing?: string; iterations?: number }): Animation {
  const anim = node.animate(frames, {
    duration: dur / kit.speed,
    delay: t0 / kit.speed,
    fill: "both",
    easing: opts?.easing ?? "linear",
    iterations: opts?.iterations ?? 1,
  });
  if (opts?.removeAfter !== false) {
    anim.onfinish = () => node.remove();
    anim.oncancel = () => node.remove();
  }
  return anim;
}

/** 延後執行（給粒子、音效用） */
export function at(kit: FxKit, t: number, fn: () => void): void {
  window.setTimeout(fn, t / kit.speed);
}

// ============================================================
// 共用漸層、濾鏡（每張疊層建一次）
// ============================================================

const DEFS_ID = "skillfx-defs";

export function ensureDefs(kit: FxKit): void {
  if (kit.layer.querySelector(`#${DEFS_ID}`)) return;
  const defs = el(kit, "defs", { id: DEFS_ID });
  defs.innerHTML = `
    <filter id="sfx-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="sfx-blur" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
    <linearGradient id="sfx-pillar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sfx-beam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="35%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="65%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="sfx-orb" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="35%" stop-color="#FFFFFF" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <pattern id="sfx-hex" width="22" height="19" patternUnits="userSpaceOnUse">
      <path d="M5.5,0 L16.5,0 L22,9.5 L16.5,19 L5.5,19 L0,9.5 Z" fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity="0.6"/>
    </pattern>
    <linearGradient id="sfx-fire" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#E8381A"/>
      <stop offset="50%" stop-color="#FF9A1E"/>
      <stop offset="100%" stop-color="#FFF07A"/>
    </linearGradient>
  `;
}

/** 依顏色做一個「中心亮、外圈透明」的放射漸層（快取） */
export function radial(kit: FxKit, color: string): string {
  const id = `sfx-rad-${color.replace("#", "")}`;
  if (!kit.layer.querySelector(`#${id}`)) {
    const defs = kit.layer.querySelector(`#${DEFS_ID}`) ?? el(kit, "defs", { id: DEFS_ID });
    const g = el(kit, "radialGradient", { id, cx: "50%", cy: "50%", r: "50%" }, defs);
    el(kit, "stop", { offset: "0%", "stop-color": "#FFFFFF", "stop-opacity": 1 }, g);
    el(kit, "stop", { offset: "30%", "stop-color": color, "stop-opacity": 0.9 }, g);
    el(kit, "stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, g);
  }
  return `url(#${id})`;
}

/** 依顏色做一個「直的光柱」漸層（左右透明、中間亮） */
export function pillarGrad(kit: FxKit, color: string): string {
  const id = `sfx-pil-${color.replace("#", "")}`;
  if (!kit.layer.querySelector(`#${id}`)) {
    const defs = kit.layer.querySelector(`#${DEFS_ID}`) ?? el(kit, "defs", { id: DEFS_ID });
    const g = el(kit, "linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 0 }, defs);
    el(kit, "stop", { offset: "0%", "stop-color": color, "stop-opacity": 0 }, g);
    el(kit, "stop", { offset: "35%", "stop-color": color, "stop-opacity": 0.85 }, g);
    el(kit, "stop", { offset: "50%", "stop-color": "#FFFFFF", "stop-opacity": 1 }, g);
    el(kit, "stop", { offset: "65%", "stop-color": color, "stop-opacity": 0.85 }, g);
    el(kit, "stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }, g);
  }
  return `url(#${id})`;
}

// ============================================================
// 常用的效果積木
// ============================================================

/** 地面上往外擴散的橢圓光環 */
export function groundRing(kit: FxKit, x: number, y: number, r: number, color: string, t0: number, dur = 500, width = 4): void {
  const e = el(kit, "ellipse", { cx: x, cy: y, rx: r, ry: r * 0.22, fill: "none", stroke: color, "stroke-width": width });
  e.style.transformOrigin = `${x}px ${y}px`;
  play(kit, e, [
    { transform: "scale(0.1)", opacity: 0 },
    { transform: "scale(0.25)", opacity: 1, offset: 0.05 },
    { transform: "scale(1)", opacity: 0 },
  ], t0, dur, { easing: "cubic-bezier(.2,.8,.3,1)" });
}

/** 空中擴散的圓形光環 */
export function airRing(kit: FxKit, x: number, y: number, r: number, color: string, t0: number, dur = 450, width = 4): void {
  const e = el(kit, "circle", { cx: x, cy: y, r, fill: "none", stroke: color, "stroke-width": width });
  e.style.transformOrigin = `${x}px ${y}px`;
  play(kit, e, [
    { transform: "scale(0.15)", opacity: 0 },
    { transform: "scale(0.3)", opacity: 1, offset: 0.06 },
    { transform: "scale(1)", opacity: 0 },
  ], t0, dur, { easing: "cubic-bezier(.2,.8,.3,1)" });
}

/** 發光的光團（蓄力、命中點） */
export function glowOrb(kit: FxKit, x: number, y: number, r: number, color: string, t0: number, dur: number, frames?: Keyframe[]): SVGCircleElement {
  const e = el(kit, "circle", { cx: x, cy: y, r, fill: radial(kit, color) });
  e.style.transformOrigin = `${x}px ${y}px`;
  play(kit, e, frames ?? [
    { transform: "scale(0.2)", opacity: 0 },
    { transform: "scale(1.1)", opacity: 1, offset: 0.3 },
    { transform: "scale(0.9)", opacity: 0.85, offset: 0.7 },
    { transform: "scale(1.4)", opacity: 0 },
  ], t0, dur);
  return e;
}

/** 從天而降的光柱 */
export function lightPillar(kit: FxKit, x: number, bottom: number, width: number, color: string, t0: number, dur = 700): void {
  const h = bottom + 40;
  const e = el(kit, "rect", { x: x - width / 2, y: bottom - h, width, height: h, fill: pillarGrad(kit, color) });
  e.style.transformOrigin = `${x}px ${bottom}px`;
  play(kit, e, [
    { transform: "scaleX(0) scaleY(0.2)", opacity: 0 },
    { transform: "scaleX(1.4) scaleY(1)", opacity: 1, offset: 0.15 },
    { transform: "scaleX(1) scaleY(1)", opacity: 0.85, offset: 0.55 },
    { transform: "scaleX(0.2) scaleY(1)", opacity: 0 },
  ], t0, dur);
}

/** 蓄力：光點從四周往中心聚 */
export function gather(kit: FxKit, x: number, y: number, radius: number, color: string, t0: number, dur = 600, count = 14): void {
  const n = kit.lite ? Math.ceil(count / 2) : count;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const r = radius * (0.8 + Math.random() * 0.5);
    const sx = x + Math.cos(a) * r;
    const sy = y + Math.sin(a) * r * 0.8;
    const dot = el(kit, "circle", { cx: sx, cy: sy, r: 2.4 + Math.random() * 2.4, fill: "#FFFFFF" });
    dot.style.filter = `drop-shadow(0 0 4px ${color})`;
    play(kit, dot, [
      { transform: "translate(0,0) scale(0.3)", opacity: 0 },
      { transform: "translate(0,0) scale(1)", opacity: 1, offset: 0.2 },
      { transform: `translate(${x - sx}px,${y - sy}px) scale(0.4)`, opacity: 1, offset: 0.92 },
      { transform: `translate(${x - sx}px,${y - sy}px) scale(0)`, opacity: 0 },
    ], t0 + (i % 4) * 30, dur, { easing: "cubic-bezier(.5,0,.8,.4)" });
  }
}

/** 往上飄的光粒 */
export function rise(kit: FxKit, x: number, y: number, spread: number, color: string, t0: number, dur = 900, count = 12, shape: "spark" | "plus" | "leaf" | "feather" | "ember" = "spark"): void {
  const n = kit.lite ? Math.ceil(count / 2) : count;
  for (let i = 0; i < n; i++) {
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.3) * spread * 0.3;
    let node: SVGElement;
    if (shape === "plus") {
      node = el(kit, "path", { d: `M${sx - 3},${sy - 9} h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 v-6 h6 Z`, fill: "#7FE8A8", stroke: "#1F6B3A", "stroke-width": 1.4 });
    } else if (shape === "leaf") {
      node = el(kit, "path", { d: `M${sx},${sy - 7} Q${sx + 6},${sy} ${sx},${sy + 7} Q${sx - 6},${sy} ${sx},${sy - 7} Z`, fill: "#8CF0A8", stroke: "#1F6B3A", "stroke-width": 1 });
    } else if (shape === "feather") {
      node = el(kit, "path", { d: `M${sx},${sy - 10} Q${sx + 5},${sy - 2} ${sx + 1},${sy + 9} Q${sx - 4},${sy - 1} ${sx},${sy - 10} Z`, fill: color, stroke: "#8A5A0E", "stroke-width": 1 });
    } else if (shape === "ember") {
      node = el(kit, "path", { d: `M${sx},${sy - 6} Q${sx + 3},${sy} ${sx},${sy + 5} Q${sx - 3},${sy} ${sx},${sy - 6} Z`, fill: "#FFB43A" });
    } else {
      const s = 2 + Math.random() * 3;
      node = el(kit, "path", { d: `M${sx},${sy - s * 2} L${sx + s * 0.6},${sy} L${sx},${sy + s * 2} L${sx - s * 0.6},${sy} Z`, fill: "#FFFFFF" });
      node.style.filter = `drop-shadow(0 0 3px ${color})`;
    }
    node.style.transformOrigin = `${sx}px ${sy}px`;
    const drift = (Math.random() - 0.5) * 30;
    const spin = (Math.random() - 0.5) * 360;
    play(kit, node, [
      { transform: "translate(0,0) rotate(0deg) scale(0.4)", opacity: 0 },
      { transform: `translate(${drift * 0.3}px,-14px) rotate(${spin * 0.2}deg) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${drift}px,${-70 - Math.random() * 50}px) rotate(${spin}deg) scale(0.7)`, opacity: 0 },
    ], t0 + Math.random() * 250, dur);
  }
}

/** 從天上往下飄落（羽毛、葉子） */
export function fall(kit: FxKit, x: number, top: number, bottom: number, spread: number, color: string, t0: number, dur = 1000, count = 10, shape: "feather" | "leaf" = "feather"): void {
  const n = kit.lite ? Math.ceil(count / 2) : count;
  for (let i = 0; i < n; i++) {
    const sx = x + (Math.random() - 0.5) * spread;
    const d =
      shape === "feather"
        ? `M${sx},${top - 12} Q${sx + 6},${top - 3} ${sx + 1},${top + 10} Q${sx - 5},${top - 2} ${sx},${top - 12} Z`
        : `M${sx},${top - 8} Q${sx + 7},${top} ${sx},${top + 8} Q${sx - 7},${top} ${sx},${top - 8} Z`;
    const node = el(kit, "path", { d, fill: color, stroke: shape === "feather" ? "#8A5A0E" : "#1F6B3A", "stroke-width": 1.1 });
    node.style.transformOrigin = `${sx}px ${top}px`;
    node.style.filter = `drop-shadow(0 0 4px ${color})`;
    const sway = 14 + Math.random() * 14;
    play(kit, node, [
      { transform: "translate(0,0) rotate(-20deg)", opacity: 0 },
      { transform: `translate(${sway}px,${(bottom - top) * 0.3}px) rotate(25deg)`, opacity: 1, offset: 0.3 },
      { transform: `translate(${-sway}px,${(bottom - top) * 0.65}px) rotate(-25deg)`, opacity: 1, offset: 0.65 },
      { transform: `translate(0,${bottom - top}px) rotate(10deg) scale(0.6)`, opacity: 0 },
    ], t0 + i * (dur * 0.04) + Math.random() * 120, dur, { easing: "ease-in-out" });
  }
}

/** 一道弧形刀光（中心 x,y、半徑 r、從角度 a0 掃到 a1，單位度） */
export function arcSlash(kit: FxKit, x: number, y: number, r: number, a0: number, a1: number, color: string, t0: number, dur = 260, width = 14): void {
  const rad = (d: number) => (d * Math.PI) / 180;
  const p = (a: number, rr: number) => `${x + Math.cos(rad(a)) * rr},${y + Math.sin(rad(a)) * rr}`;
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  // 月牙形：外弧 r、內弧 r - width（兩端收尖）
  const d = `M${p(a0, r)} A${r},${r} 0 ${large} ${sweep} ${p(a1, r)} A${r - width},${r - width * 0.4} 0 ${large} ${1 - sweep} ${p(a0, r)} Z`;
  const g = group(kit, x, y);
  const glow = el(kit, "path", { d, fill: color, opacity: 0.7 }, g);
  glow.setAttribute("filter", "url(#sfx-blur)");
  el(kit, "path", { d, fill: "#FFFFFF" }, g);
  play(kit, g, [
    { opacity: 0, transform: `rotate(${(a0 - a1) * 0.4}deg) scale(0.9)` },
    { opacity: 1, transform: "rotate(0deg) scale(1)", offset: 0.35 },
    { opacity: 0, transform: `rotate(${(a1 - a0) * 0.15}deg) scale(1.08)` },
  ], t0, dur, { easing: "cubic-bezier(.2,.9,.3,1)" });
}

/** 地面裂痕 */
export function crack(kit: FxKit, x: number, y: number, size: number, color: string, t0: number, dur = 900): void {
  const g = group(kit, x, y);
  const lines = [
    [-1, 0.2, -0.6, 0.35, -0.95, 0.25],
    [1, 0.25, 0.55, 0.4, 0.95, 0.3],
    [-0.3, 0.45, -0.1, 0.7, 0.15, 0.6],
    [0.4, 0.5, 0.25, 0.75, 0.55, 0.85],
  ];
  for (const [ax, ay, bx, by, cx2, cy2] of lines) {
    const pth = el(kit, "path", {
      d: `M${x},${y} L${x + ax * size * 0.4},${y + ay * size * 0.12} L${x + bx * size},${y + by * size * 0.14} L${x + cx2 * size * 1.1},${y + cy2 * size * 0.16}`,
      fill: "none",
      stroke: color,
      "stroke-width": 3,
      "stroke-linecap": "round",
      "stroke-dasharray": 200,
    }, g);
    pth.style.filter = `drop-shadow(0 0 3px ${color})`;
    play(kit, pth, [
      { strokeDashoffset: 200, opacity: 1 },
      { strokeDashoffset: 0, opacity: 1, offset: 0.25 },
      { strokeDashoffset: 0, opacity: 0.8, offset: 0.7 },
      { strokeDashoffset: 0, opacity: 0 },
    ], t0, dur, { removeAfter: false });
  }
  play(kit, g, [{ opacity: 1 }, { opacity: 1 }], t0, dur);
}

/** 碎石彈飛 */
export function rocks(kit: FxKit, x: number, y: number, size: number, t0: number, count = 8, color = "#A49D92"): void {
  const n = kit.lite ? Math.ceil(count / 2) : count;
  for (let i = 0; i < n; i++) {
    const dx = (Math.random() - 0.5) * size * 1.6;
    const up = size * (0.4 + Math.random() * 0.6);
    const s = 3 + Math.random() * 5;
    const r = el(kit, "path", { d: `M${x},${y} l${s},${-s * 0.6} l${s * 0.8},${s * 0.8} l${-s * 0.5},${s} l${-s},${-s * 0.2} Z`, fill: color, stroke: "#3E2A1E", "stroke-width": 1.2 });
    r.style.transformOrigin = `${x}px ${y}px`;
    const spin = (Math.random() - 0.5) * 540;
    play(kit, r, [
      { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.6}px,${-up}px) rotate(${spin * 0.5}deg)`, opacity: 1, offset: 0.45, easing: "ease-in" },
      { transform: `translate(${dx}px,6px) rotate(${spin}deg)`, opacity: 0 },
    ], t0, 650 + Math.random() * 250, { easing: "ease-out" });
  }
}

/** 一顆往目標飛的光球（帶拖尾）。curve > 0 會往上拋成弧線 */
export function shoot(kit: FxKit, from: [number, number], to: [number, number], color: string, t0: number, dur: number, size = 10, curve = 0): void {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const g = group(kit, x1, y1);
  el(kit, "circle", { cx: x1, cy: y1, r: size * 2.2, fill: radial(kit, color) }, g);
  el(kit, "circle", { cx: x1, cy: y1, r: size * 0.7, fill: "#FFFFFF" }, g);
  const frames: Keyframe[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lift = curve * 4 * t * (1 - t);
    frames.push({ transform: `translate(${(x2 - x1) * t}px,${(y2 - y1) * t - lift}px)`, opacity: i === steps ? 0.9 : 1, offset: t });
  }
  play(kit, g, frames, t0, dur);
  if (kit.fx) {
    const fx = kit.fx;
    at(kit, t0, () => fx.projectile(x1, y1, x2, y2, color, dur / 1000));
  }
}

/** 六角形能量牆（鐵壁） */
export function hexWall(kit: FxKit, x: number, bottom: number, w: number, h: number, color: string, t0: number, dur: number): void {
  const g = group(kit, x, bottom);
  const d = `M${x - w / 2},${bottom} L${x - w / 2},${bottom - h * 0.8} Q${x},${bottom - h * 1.1} ${x + w / 2},${bottom - h * 0.8} L${x + w / 2},${bottom} Z`;
  el(kit, "path", { d, fill: color, opacity: 0.22 }, g);
  el(kit, "path", { d, fill: "url(#sfx-hex)" }, g);
  const edge = el(kit, "path", { d, fill: "none", stroke: "#FFFFFF", "stroke-width": 2.4 }, g);
  edge.style.filter = `drop-shadow(0 0 6px ${color})`;
  play(kit, g, [
    { transform: "scaleY(0)", opacity: 0 },
    { transform: "scaleY(1.08)", opacity: 1, offset: 0.12, easing: "ease-out" },
    { transform: "scaleY(1)", opacity: 1, offset: 0.2 },
    { transform: "scaleY(1)", opacity: 0.9, offset: 0.8 },
    { transform: "scaleY(1) scaleX(1.05)", opacity: 0 },
  ], t0, dur);
}

/** 盾形光罩（從地面長出來包住目標） */
export function shieldDome(kit: FxKit, a: StageAnchor, color: string, t0: number, dur: number, emblem = true): void {
  const w = a.size * 1.05;
  const top = a.feetY - a.size * 1.12;
  const x = a.x;
  const b = a.feetY + a.size * 0.06;
  const d = `M${x},${top} C${x + w * 0.2},${top + 4} ${x + w * 0.42},${top + 10} ${x + w / 2},${top + 16} L${x + w / 2},${top + (b - top) * 0.45} C${x + w / 2},${top + (b - top) * 0.75} ${x + w * 0.25},${b - 8} ${x},${b} C${x - w * 0.25},${b - 8} ${x - w / 2},${top + (b - top) * 0.75} ${x - w / 2},${top + (b - top) * 0.45} L${x - w / 2},${top + 16} C${x - w * 0.42},${top + 10} ${x - w * 0.2},${top + 4} ${x},${top} Z`;
  const g = group(kit, x, b);
  el(kit, "path", { d, fill: color, opacity: 0.2 }, g);
  el(kit, "path", { d, fill: "url(#sfx-hex)", opacity: 0.8 }, g);
  const edge = el(kit, "path", { d, fill: "none", stroke: "#FFFFFF", "stroke-width": 2.6 }, g);
  edge.style.filter = `drop-shadow(0 0 7px ${color})`;
  if (emblem) {
    el(kit, "path", { d: `M${x},${top + 4} L${x + 9},${top + 16} L${x},${top + 28} L${x - 9},${top + 16} Z`, fill: "#FFF4C2", stroke: color, "stroke-width": 2 }, g);
  }
  play(kit, g, [
    { transform: "scale(0.3,0)", opacity: 0 },
    { transform: "scale(1.06,1.08)", opacity: 1, offset: 0.14, easing: "cubic-bezier(.2,.8,.3,1)" },
    { transform: "scale(0.98,0.97)", opacity: 1, offset: 0.22 },
    { transform: "scale(1,1)", opacity: 1, offset: 0.3 },
    { transform: "scale(1,1)", opacity: 0.85, offset: 0.8 },
    { transform: "scale(1.06,1.06)", opacity: 0 },
  ], t0, dur);
  // 表面掃過一道光
  const sweep = el(kit, "rect", { x: x - w / 2, y: top, width: w, height: 30, fill: "url(#sfx-beam)", opacity: 0.8 });
  const clip = `sfx-clip-${Math.random().toString(36).slice(2)}`;
  const cp = el(kit, "clipPath", { id: clip });
  el(kit, "path", { d }, cp);
  sweep.setAttribute("clip-path", `url(#${clip})`);
  play(kit, sweep, [
    { transform: `translateY(${b - top}px)`, opacity: 0 },
    { transform: `translateY(${b - top - 20}px)`, opacity: 1, offset: 0.1 },
    { transform: "translateY(-30px)", opacity: 1, offset: 0.9 },
    { transform: "translateY(-30px)", opacity: 0 },
  ], t0 + dur * 0.2, dur * 0.45);
  at(kit, t0 + dur + 50, () => cp.remove());
}

/** 泡泡護盾（護盾術、象牙盾的內層） */
export function bubble(kit: FxKit, a: StageAnchor, color: string, t0: number, dur: number): void {
  const r = a.size * 0.55;
  const g = group(kit, a.x, a.cy);
  const c = el(kit, "circle", { cx: a.x, cy: a.cy, r, fill: radial(kit, color), opacity: 0.35 }, g);
  c.setAttribute("fill-opacity", "0.6");
  const rim = el(kit, "circle", { cx: a.x, cy: a.cy, r, fill: "none", stroke: "#FFFFFF", "stroke-width": 2.4 }, g);
  rim.style.filter = `drop-shadow(0 0 8px ${color})`;
  el(kit, "path", { d: `M${a.x - r * 0.6},${a.cy - r * 0.35} Q${a.x - r * 0.4},${a.cy - r * 0.8} ${a.x + r * 0.05},${a.cy - r * 0.85}`, fill: "none", stroke: "#FFFFFF", "stroke-width": 3, "stroke-linecap": "round", opacity: 0.8 }, g);
  play(kit, g, [
    { transform: "scale(0)", opacity: 0 },
    { transform: "scale(1.15)", opacity: 1, offset: 0.18, easing: "cubic-bezier(.2,.8,.3,1)" },
    { transform: "scale(0.95)", opacity: 1, offset: 0.28 },
    { transform: "scale(1)", opacity: 1, offset: 0.36 },
    { transform: "scale(1)", opacity: 0.8, offset: 0.85 },
    { transform: "scale(1.1)", opacity: 0 },
  ], t0, dur);
}

/** 音波（怒吼）：一圈圈弧線往 dir 方向擴散 */
export function soundWaves(kit: FxKit, x: number, y: number, dir: number, color: string, t0: number, count = 4): void {
  for (let i = 0; i < count; i++) {
    const r = 30;
    const d = `M${x + dir * r * 0.4},${y - r} Q${x + dir * r * 1.2},${y} ${x + dir * r * 0.4},${y + r}`;
    const p = el(kit, "path", { d, fill: "none", stroke: color, "stroke-width": 6, "stroke-linecap": "round" });
    p.style.transformOrigin = `${x}px ${y}px`;
    p.style.filter = `drop-shadow(0 0 6px ${color})`;
    play(kit, p, [
      { transform: "scale(0.4)", opacity: 0 },
      { transform: "scale(0.7)", opacity: 1, offset: 0.15 },
      { transform: "scale(3.2)", opacity: 0 },
    ], t0 + i * 140, 600, { easing: "ease-out" });
  }
}

/** 火焰柱（浴火、狂暴） */
export function flameColumn(kit: FxKit, a: StageAnchor, t0: number, dur: number, colorTop = "#FFF07A", scale = 1): void {
  const n = kit.lite ? 7 : 14;
  for (let i = 0; i < n; i++) {
    const x = a.x + (Math.random() - 0.5) * a.size * 0.8 * scale;
    const y = a.feetY - Math.random() * a.size * 0.2;
    const h = a.size * (0.5 + Math.random() * 0.6) * scale;
    const w = 10 + Math.random() * 12;
    const d = `M${x - w},${y} Q${x - w * 0.6},${y - h * 0.5} ${x},${y - h} Q${x + w * 0.6},${y - h * 0.5} ${x + w},${y} Z`;
    const f = el(kit, "path", { d, fill: "url(#sfx-fire)" });
    f.style.transformOrigin = `${x}px ${y}px`;
    f.style.mixBlendMode = "screen";
    f.style.filter = `drop-shadow(0 0 6px ${colorTop})`;
    play(kit, f, [
      { transform: "scaleY(0)", opacity: 0 },
      { transform: "scaleY(1.15)", opacity: 1, offset: 0.25 },
      { transform: "scaleY(0.9) scaleX(0.9)", opacity: 0.9, offset: 0.6 },
      { transform: "scaleY(1.2) scaleX(0.6) translateY(-10px)", opacity: 0 },
    ], t0 + Math.random() * dur * 0.3, dur * (0.55 + Math.random() * 0.3));
  }
}

/** 星星繞圈（暈） */
export function dizzyStars(kit: FxKit, x: number, y: number, t0: number, dur = 900): void {
  const g = group(kit, x, y);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const sx = x + Math.cos(a) * 18;
    const sy = y + Math.sin(a) * 6;
    el(kit, "path", {
      d: `M${sx},${sy - 7} L${sx + 2},${sy - 2} L${sx + 7},${sy - 2} L${sx + 3},${sy + 1.5} L${sx + 4.5},${sy + 6.5} L${sx},${sy + 3.5} L${sx - 4.5},${sy + 6.5} L${sx - 3},${sy + 1.5} L${sx - 7},${sy - 2} L${sx - 2},${sy - 2} Z`,
      fill: "#FFE04A",
      stroke: "#3E2A1E",
      "stroke-width": 1.2,
    }, g);
  }
  play(kit, g, [
    { transform: "rotate(0deg) scale(0)", opacity: 0 },
    { transform: "rotate(120deg) scale(1)", opacity: 1, offset: 0.2 },
    { transform: "rotate(540deg) scale(1)", opacity: 1, offset: 0.85 },
    { transform: "rotate(640deg) scale(0.5)", opacity: 0 },
  ], t0, dur);
}

/** 衝擊爆炸（亮核＋外圈＋碎片），boss 時放大 */
export function boom(kit: FxKit, x: number, y: number, size: number, color: string, t0: number, colors?: string[]): void {
  glowOrb(kit, x, y, size * 0.6, color, t0, 380, [
    { transform: "scale(0.2)", opacity: 0 },
    { transform: "scale(1.3)", opacity: 1, offset: 0.2 },
    { transform: "scale(1.6)", opacity: 0 },
  ]);
  airRing(kit, x, y, size * 0.9, "#FFFFFF", t0, 420, 5);
  airRing(kit, x, y, size * 1.2, color, t0 + 60, 520, 3);
  if (kit.fx) {
    const fx = kit.fx;
    at(kit, t0, () => fx.impact(x, y, { colors: colors ?? ["#FFFFFF", color, "#FFE07A"], crit: true, dir: 0, power: Math.min(1.8, size / 60) }));
  }
}

/** 撲咬：上下兩排白牙往中間一咬（攻擊型怪物的普通攻擊） */
export function chomp(kit: FxKit, x: number, y: number, size: number, t0: number): void {
  ensureDefs(kit);
  const w = size * 0.7;
  const teeth = (top: boolean) => {
    const n = 5;
    let d = `M${x - w / 2},${y}`;
    for (let i = 0; i < n; i++) {
      const x0 = x - w / 2 + (i / n) * w;
      const x1 = x - w / 2 + ((i + 0.5) / n) * w;
      const x2 = x - w / 2 + ((i + 1) / n) * w;
      d += ` L${x0},${y} L${x1},${y + (top ? 1 : -1) * size * 0.16} L${x2},${y}`;
    }
    const back = top ? y - size * 0.12 : y + size * 0.12;
    d += ` L${x + w / 2},${back} Q${x},${back + (top ? -1 : 1) * size * 0.1} ${x - w / 2},${back} Z`;
    return d;
  };
  for (const top of [true, false]) {
    const jaw = el(kit, "path", { d: teeth(top), fill: "#FFFFFF", stroke: "#3E2A1E", "stroke-width": 2, "stroke-linejoin": "round" });
    jaw.style.filter = "drop-shadow(0 0 6px #FF4D5E)";
    const off = (top ? -1 : 1) * size * 0.32;
    play(kit, jaw, [
      { transform: `translateY(${off}px)`, opacity: 0 },
      { transform: `translateY(${off}px)`, opacity: 1, offset: 0.35 },
      { transform: "translateY(0)", opacity: 1, offset: 0.55, easing: "ease-in" },
      { transform: "translateY(0)", opacity: 1, offset: 0.75 },
      { transform: `translateY(${off * 0.3}px)`, opacity: 0 },
    ], t0, 420);
  }
}
