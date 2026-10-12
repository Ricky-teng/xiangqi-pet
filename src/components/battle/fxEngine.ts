// src/components/battle/fxEngine.ts

/**
 * 戰鬥特效引擎（Canvas 2D 粒子系統）
 * ------------------------------------------------------------
 * 完全不經過 React：戰鬥畫面在事件發生時直接呼叫 fx.impact(...)、
 * fx.slash(...) 這類方法，引擎自己跑 requestAnimationFrame 畫。
 * 每一幀幾百顆粒子如果走 React state，手機一定掉幀。
 *
 * 設計重點：
 *   1. 物件池：粒子物件重複使用，不在每一幀 new 物件，避免 GC 卡頓。
 *   2. 發光貼圖快取：發光粒子不在每一幀建 radialGradient，而是每種
 *      顏色預先畫一張 64×64 的發光圖，之後 drawImage 縮放就好。
 *   3. 分兩趟畫：一般混色（煙、碎片）先畫，加亮混色（火花、光）後畫，
 *      減少切換 globalCompositeOperation 的次數。
 *   4. 三段畫質：high / medium / low 決定粒子上限、解析度、環境粒子密度。
 *      啟動時依裝置判斷，跑起來之後如果平均每幀超過 26ms 會自動降一級。
 */

import type { AmbientKind } from "@/components/battle/towerArt";

export type FxQuality = "high" | "medium" | "low";

// ---- 粒子種類 ----
const K_SPARK = 0; // 火花：帶拖尾的線
const K_GLOW = 1; // 光團：會擴散的發光圓
const K_RING = 2; // 衝擊波：擴散的圓環
const K_SLASH = 3; // 刀光：新月形
const K_SHARD = 4; // 碎片：旋轉的三角形，會落地彈跳
const K_SMOKE = 5; // 煙：柔邊圓，往上飄、變大、變淡
const K_MOTE = 6; // 治癒光點：十字形往上飄
const K_LEAF = 7; // 葉子／花瓣：搖擺飄落
const K_BUBBLE = 8; // 泡泡：圓圈往上浮
const K_DOT = 9; // 小點：沙、雪、灰塵
const K_EMBER = 10; // 發光點：火星、孢子，會閃爍
const K_STAR = 11; // 星星：固定位置閃爍
const K_BOLT = 12; // 閃電：折線

interface Particle {
  k: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 重力（px/s²，往下為正） */
  g: number;
  /** 每秒保留的速度比例（0.1 = 一秒後剩 10%） */
  drag: number;
  life: number;
  max: number;
  /** 起始／結束尺寸 */
  s0: number;
  s1: number;
  rot: number;
  vr: number;
  c: string;
  a: number;
  add: boolean;
  /** 擺動相位與幅度（葉子、雪、泡泡） */
  wob: number;
  wobA: number;
  /** 閃電折線的點 [x0,y0,x1,y1,...] */
  pts: number[] | null;
  /** 刀光的弧長（弧度） */
  sweep: number;
  /** 是否屬於環境粒子（不受戰鬥倍速影響、離開畫面就回收） */
  amb: boolean;
}

interface QualityProfile {
  maxParticles: number;
  dprCap: number;
  /** 環境粒子密度倍率 */
  ambient: number;
  /** 爆發類特效的粒子數倍率 */
  burst: number;
}

const QUALITY: Record<FxQuality, QualityProfile> = {
  high: { maxParticles: 720, dprCap: 2, ambient: 1, burst: 1 },
  medium: { maxParticles: 340, dprCap: 1.5, ambient: 0.6, burst: 0.65 },
  low: { maxParticles: 130, dprCap: 1, ambient: 0.3, burst: 0.35 },
};

/** 各種環境粒子每秒生幾顆（high 畫質） */
const AMBIENT_RATE: Record<AmbientKind, number> = {
  leaves: 3.5,
  bubbles: 5,
  sand: 22,
  spores: 6,
  embers: 11,
  snow: 16,
  sparks: 3,
  smoke: 2.6,
  petals: 4.5,
  stars: 0,
  dust: 5,
};

/**
 * 依裝置推測一開始該用哪個畫質。
 * 這只是起點，實際跑起來太慢會再自動降級（見 tickWatchdog）。
 */
export function detectFxQuality(): FxQuality {
  if (typeof window === "undefined") return "medium";
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return "low";
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency ?? 4;
  const memory = nav.deviceMemory ?? 4;
  if (cores <= 2 || memory <= 2) return "low";
  if (cores <= 4 || memory <= 3) return "medium";
  return "high";
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export class FxEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private pool: Particle[] = [];
  private active: Particle[] = [];
  private quality: FxQuality;
  private profile: QualityProfile;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private groundY = 0;
  private raf: number | null = null;
  private lastTs: number | null = null;
  private timeScale = 1;
  private clock = 0;
  private ambientKind: AmbientKind | null = null;
  private ambientColors: string[] = ["#FFFFFF"];
  private ambientAcc = 0;
  private nextBoltAt = 0;
  private glowCache = new Map<string, HTMLCanvasElement>();
  private softCache = new Map<string, HTMLCanvasElement>();
  // 效能監測：最近 N 幀的平均耗時
  private frameTimes: number[] = [];
  private onQualityChange?: (q: FxQuality) => void;

  constructor(canvas: HTMLCanvasElement, quality: FxQuality, onQualityChange?: (q: FxQuality) => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D 不可用");
    this.ctx = ctx;
    this.quality = quality;
    this.profile = QUALITY[quality];
    this.onQualityChange = onQualityChange;
  }

  getQuality(): FxQuality {
    return this.quality;
  }

  /** 舞台尺寸改變時呼叫（CSS px） */
  resize(width: number, height: number, groundY: number): void {
    this.width = width;
    this.height = height;
    this.groundY = groundY;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.profile.dprCap);
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.ambientKind === "stars") this.seedStars();
  }

  /** 戰鬥倍速：爆發類特效跟著加快，環境粒子不受影響 */
  setTimeScale(scale: number): void {
    this.timeScale = scale;
  }

  setAmbient(kind: AmbientKind, colors: string[]): void {
    this.ambientKind = kind;
    this.ambientColors = colors.length > 0 ? colors : ["#FFFFFF"];
    this.active = this.active.filter((p) => {
      if (p.amb) this.pool.push(p);
      return !p.amb;
    });
    if (kind === "stars") this.seedStars();
    // 一開場就先鋪一層，不要讓畫面從空的開始慢慢長出粒子
    const prewarm = Math.round(AMBIENT_RATE[kind] * 3 * this.profile.ambient);
    for (let i = 0; i < prewarm; i++) this.spawnAmbient(true);
  }

  start(): void {
    if (this.raf !== null) return;
    this.lastTs = null;
    const loop = (ts: number) => {
      this.frame(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  destroy(): void {
    this.stop();
    this.active = [];
    this.pool = [];
    this.glowCache.clear();
    this.softCache.clear();
  }

  // ============================================================
  // 對外的特效
  // ============================================================

  /** 命中：中心閃光 ＋ 放射火花 ＋ 衝擊波 */
  impact(
    x: number,
    y: number,
    opts: { colors: string[]; power?: number; crit?: boolean; dir?: number },
  ): void {
    const power = opts.power ?? 1;
    const crit = opts.crit ?? false;
    const dir = opts.dir ?? 0; // 0 = 四面八方；±1 = 偏向往右／左噴
    const n = Math.round((crit ? 26 : 14) * power * this.profile.burst);

    this.emit(K_GLOW, x, y, {
      s0: 10 * power,
      s1: (crit ? 80 : 52) * power,
      max: crit ? 0.32 : 0.22,
      c: crit ? "#FFE07A" : opts.colors[0],
      a: crit ? 1 : 0.85,
      add: true,
    });
    this.emit(K_RING, x, y, {
      s0: 6 * power,
      s1: (crit ? 70 : 42) * power,
      max: crit ? 0.36 : 0.26,
      c: crit ? "#FFF4C2" : "#FFFFFF",
      a: 0.9,
      add: true,
    });
    if (crit) {
      this.emit(K_RING, x, y, { s0: 4, s1: 110 * power, max: 0.5, c: "#FFB020", a: 0.6, add: true });
    }

    for (let i = 0; i < n; i++) {
      const angle = dir === 0 ? rand(0, Math.PI * 2) : (dir > 0 ? 0 : Math.PI) + rand(-1.1, 1.1);
      const speed = rand(160, crit ? 520 : 360) * power;
      this.emit(K_SPARK, x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        g: 520,
        drag: 0.04,
        max: rand(0.22, crit ? 0.55 : 0.4),
        s0: rand(1.6, crit ? 3.4 : 2.6),
        s1: 0.4,
        c: crit && Math.random() < 0.6 ? pick(["#FFE07A", "#FFB020", "#FFFFFF"]) : pick(opts.colors),
        a: 1,
        add: true,
      });
    }
  }

  /**
   * 刀光：一道新月形的弧，沿著 angle 方向劈下去。
   * crit = 兩道交叉的金色刀光。
   */
  slash(x: number, y: number, opts: { angle: number; color: string; crit?: boolean; size?: number }): void {
    const size = opts.size ?? 46;
    this.emit(K_SLASH, x, y, {
      s0: size,
      s1: size * 1.12,
      rot: opts.angle,
      sweep: 1.9,
      max: 0.22,
      c: opts.crit ? "#FFE07A" : opts.color,
      a: 1,
      add: true,
    });
    if (opts.crit) {
      this.emit(K_SLASH, x, y, {
        s0: size * 1.1,
        s1: size * 1.3,
        rot: opts.angle + Math.PI * 0.62,
        sweep: 2.1,
        max: 0.28,
        c: "#FFFFFF",
        a: 1,
        add: true,
      });
    }
  }

  /** 倒下：大爆炸 ＋ 碎片落地 ＋ 煙 ＋ 兩圈衝擊波 */
  death(x: number, y: number, opts: { colors: string[]; size: number; boss?: boolean }): void {
    const boss = opts.boss ?? false;
    const scale = (opts.size / 80) * (boss ? 1.6 : 1);
    const b = this.profile.burst;

    this.emit(K_GLOW, x, y, { s0: 20 * scale, s1: 120 * scale, max: 0.45, c: "#FFFFFF", a: 1, add: true });
    this.emit(K_GLOW, x, y, { s0: 10 * scale, s1: 90 * scale, max: 0.6, c: opts.colors[0], a: 0.9, add: true });
    this.emit(K_RING, x, y, { s0: 10, s1: 120 * scale, max: 0.5, c: "#FFFFFF", a: 0.9, add: true });
    this.emit(K_RING, x, y, { s0: 6, s1: 80 * scale, max: 0.7, c: opts.colors[0], a: 0.7, add: true });

    const sparks = Math.round((boss ? 70 : 34) * b);
    for (let i = 0; i < sparks; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(180, 620) * scale;
      this.emit(K_SPARK, x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 120,
        g: 680,
        drag: 0.06,
        max: rand(0.35, 0.8),
        s0: rand(2, 4),
        s1: 0.5,
        c: pick(opts.colors),
        a: 1,
        add: true,
      });
    }

    const shards = Math.round((boss ? 26 : 12) * b);
    for (let i = 0; i < shards; i++) {
      const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05);
      const speed = rand(140, 420) * scale;
      this.emit(K_SHARD, x, y, {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        g: 900,
        drag: 0.5,
        max: rand(0.7, 1.3),
        s0: rand(3, 7) * Math.min(1.6, scale),
        s1: rand(2, 5),
        rot: rand(0, Math.PI * 2),
        vr: rand(-14, 14),
        c: pick(opts.colors),
        a: 1,
        add: false,
      });
    }

    const smokes = Math.round((boss ? 14 : 7) * b);
    for (let i = 0; i < smokes; i++) {
      this.emit(K_SMOKE, x + rand(-14, 14) * scale, y + rand(-8, 10) * scale, {
        vx: rand(-60, 60),
        vy: rand(-90, -30),
        drag: 0.3,
        max: rand(0.7, 1.2),
        s0: rand(12, 20) * scale,
        s1: rand(34, 56) * scale,
        c: "#3A3550",
        a: 0.42,
        add: false,
      });
    }
  }

  /** 回血：綠色十字光點往上飄 ＋ 腳下一圈光 */
  heal(x: number, y: number, size: number): void {
    const n = Math.round(16 * this.profile.burst);
    this.emit(K_RING, x, y + size * 0.42, { s0: size * 0.2, s1: size * 0.7, max: 0.6, c: "#6BE39A", a: 0.8, add: true });
    this.emit(K_GLOW, x, y, { s0: size * 0.3, s1: size * 0.9, max: 0.55, c: "#6BE39A", a: 0.55, add: true });
    for (let i = 0; i < n; i++) {
      this.emit(K_MOTE, x + rand(-size * 0.45, size * 0.45), y + rand(-size * 0.1, size * 0.45), {
        vx: rand(-14, 14),
        vy: rand(-110, -50),
        drag: 0.5,
        max: rand(0.6, 1.1),
        s0: rand(3, 6),
        s1: 1,
        c: pick(["#6BE39A", "#B8FFD0", "#FFFFFF"]),
        a: 1,
        add: true,
      });
    }
  }

  /** 腳下揚起一圈塵土（登場、落地、衝刺起步） */
  dust(x: number, y: number, size: number, color = "#D9C9A8"): void {
    const n = Math.round(10 * this.profile.burst);
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.emit(K_SMOKE, x + side * rand(0, size * 0.3), y - rand(0, 6), {
        vx: side * rand(60, 160),
        vy: rand(-50, -10),
        drag: 0.08,
        max: rand(0.45, 0.8),
        s0: rand(6, 10) * (size / 80),
        s1: rand(18, 30) * (size / 80),
        c: color,
        a: 0.5,
        add: false,
      });
    }
  }

  /** 地面衝擊波（Boss 落地） */
  shockwave(x: number, y: number, color: string, size: number): void {
    this.emit(K_RING, x, y, { s0: 10, s1: size * 2.4, max: 0.6, c: color, a: 1, add: true });
    this.emit(K_RING, x, y, { s0: 6, s1: size * 1.6, max: 0.45, c: "#FFFFFF", a: 0.9, add: true });
    this.dust(x, y, size * 1.6);
  }

  /** 一道閃電，從 (x1,y1) 劈到 (x2,y2) */
  bolt(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const pts = makeBoltPoints(x1, y1, x2, y2, 7, Math.hypot(x2 - x1, y2 - y1) * 0.12);
    this.emit(K_BOLT, x1, y1, { pts, max: 0.28, s0: 3.2, s1: 1, c: color, a: 1, add: true });
  }

  /** 速度線（衝刺時的殘影），從攻擊者往目標方向畫幾條細線 */
  speedLines(x: number, y: number, dir: number, size: number, color: string): void {
    const n = Math.round(6 * this.profile.burst);
    for (let i = 0; i < n; i++) {
      this.emit(K_SPARK, x - dir * rand(0, size * 0.4), y + rand(-size * 0.4, size * 0.3), {
        vx: -dir * rand(500, 800),
        vy: 0,
        drag: 0.02,
        max: rand(0.12, 0.2),
        s0: rand(1, 2),
        s1: 0.5,
        c: color,
        a: 0.7,
        add: true,
      });
    }
  }

  // ============================================================
  // 內部
  // ============================================================

  private emit(k: number, x: number, y: number, opts: Partial<Particle>): void {
    if (this.active.length >= this.profile.maxParticles) {
      // 滿了：把最舊的環境粒子讓出來（戰鬥特效比較重要）
      const idx = this.active.findIndex((p) => p.amb);
      if (idx === -1) return;
      this.pool.push(this.active[idx]);
      this.active.splice(idx, 1);
    }
    const p = this.pool.pop() ?? ({} as Particle);
    p.k = k;
    p.x = x;
    p.y = y;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.g = opts.g ?? 0;
    p.drag = opts.drag ?? 1;
    p.life = 0;
    p.max = opts.max ?? 0.5;
    p.s0 = opts.s0 ?? 4;
    p.s1 = opts.s1 ?? p.s0;
    p.rot = opts.rot ?? 0;
    p.vr = opts.vr ?? 0;
    p.c = opts.c ?? "#FFFFFF";
    p.a = opts.a ?? 1;
    p.add = opts.add ?? false;
    p.wob = opts.wob ?? Math.random() * Math.PI * 2;
    p.wobA = opts.wobA ?? 0;
    p.pts = opts.pts ?? null;
    p.sweep = opts.sweep ?? 1.8;
    p.amb = opts.amb ?? false;
    this.active.push(p);
  }

  private seedStars(): void {
    this.active = this.active.filter((p) => {
      if (p.k === K_STAR) this.pool.push(p);
      return p.k !== K_STAR;
    });
    if (this.width === 0) return;
    const n = Math.round(34 * this.profile.ambient) + 6;
    for (let i = 0; i < n; i++) {
      this.emit(K_STAR, rand(0, this.width), rand(0, this.groundY * 0.72), {
        max: Number.POSITIVE_INFINITY,
        s0: rand(0.8, 2.4),
        c: pick(this.ambientColors),
        a: rand(0.5, 1),
        wob: rand(0, Math.PI * 2),
        wobA: rand(1.2, 3.2),
        add: true,
        amb: true,
      });
    }
  }

  /** 生一顆環境粒子。prewarm = 開場預鋪，位置隨機散在畫面中 */
  private spawnAmbient(prewarm = false): void {
    const kind = this.ambientKind;
    if (!kind || this.width === 0) return;
    const w = this.width;
    const h = this.height;
    const c = pick(this.ambientColors);
    const anyY = rand(0, h);
    const anyX = rand(0, w);

    switch (kind) {
      case "leaves":
      case "petals":
        this.emit(K_LEAF, prewarm ? anyX : rand(-20, w), prewarm ? anyY : -12, {
          vx: rand(14, 40),
          vy: rand(26, 52),
          max: 14,
          s0: kind === "petals" ? rand(3, 5) : rand(4, 7),
          rot: rand(0, Math.PI * 2),
          vr: rand(-2.4, 2.4),
          wobA: rand(18, 36),
          c,
          a: rand(0.7, 0.95),
          amb: true,
        });
        break;
      case "snow":
        this.emit(K_DOT, prewarm ? anyX : rand(-20, w), prewarm ? anyY : -6, {
          vx: rand(-8, 16),
          vy: rand(24, 60),
          max: 16,
          s0: rand(1, 3),
          wobA: rand(8, 20),
          c,
          a: rand(0.6, 1),
          amb: true,
        });
        break;
      case "sand":
        this.emit(K_DOT, prewarm ? anyX : -8, rand(h * 0.2, h), {
          vx: rand(160, 300),
          vy: rand(-12, 12),
          max: 6,
          s0: rand(0.8, 1.8),
          wobA: 6,
          c,
          a: rand(0.35, 0.75),
          amb: true,
        });
        break;
      case "dust":
        this.emit(K_DOT, prewarm ? anyX : rand(0, w), prewarm ? anyY : h + 4, {
          vx: rand(-10, 10),
          vy: rand(-26, -10),
          max: 12,
          s0: rand(1, 2.4),
          wobA: rand(6, 14),
          c,
          a: rand(0.25, 0.55),
          amb: true,
        });
        break;
      case "bubbles":
        this.emit(K_BUBBLE, prewarm ? anyX : rand(0, w), prewarm ? anyY : h + 8, {
          vx: 0,
          vy: rand(-46, -22),
          max: 16,
          s0: rand(2, 6),
          wobA: rand(8, 16),
          c,
          a: rand(0.4, 0.8),
          amb: true,
        });
        break;
      case "spores":
        this.emit(K_EMBER, prewarm ? anyX : rand(0, w), prewarm ? anyY : h + 4, {
          vx: rand(-8, 8),
          vy: rand(-18, -6),
          max: 16,
          s0: rand(1.4, 3),
          wobA: rand(10, 22),
          c,
          a: rand(0.5, 0.9),
          add: true,
          amb: true,
        });
        break;
      case "embers":
        this.emit(K_EMBER, prewarm ? anyX : rand(0, w), prewarm ? anyY : h + 4, {
          vx: rand(-14, 20),
          vy: rand(-90, -40),
          max: 8,
          s0: rand(1, 2.6),
          wobA: rand(10, 30),
          c,
          a: 1,
          add: true,
          amb: true,
        });
        break;
      case "smoke":
        this.emit(K_SMOKE, prewarm ? anyX : rand(-30, w), prewarm ? rand(h * 0.5, h) : h + 10, {
          vx: rand(6, 22),
          vy: rand(-16, -6),
          drag: 1,
          max: 9,
          s0: rand(18, 30),
          s1: rand(50, 80),
          c,
          a: 0.32,
          amb: true,
        });
        break;
      case "sparks":
        this.emit(K_EMBER, prewarm ? anyX : rand(0, w), prewarm ? anyY : rand(0, h), {
          vx: rand(-30, 30),
          vy: rand(-30, 30),
          max: rand(0.3, 0.8),
          s0: rand(1, 2.2),
          wobA: 0,
          c,
          a: 1,
          add: true,
          amb: true,
        });
        break;
      case "stars":
        break;
    }
  }

  private frame(ts: number): void {
    const realDt = this.lastTs === null ? 0 : Math.min(0.05, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    this.tickWatchdog(realDt);
    this.clock += realDt;

    // ---- 環境粒子 ----
    if (this.ambientKind) {
      const rate = AMBIENT_RATE[this.ambientKind] * this.profile.ambient;
      this.ambientAcc += realDt * rate;
      while (this.ambientAcc >= 1) {
        this.ambientAcc -= 1;
        this.spawnAmbient();
      }
      // 雷鳴塔：每隔幾秒遠方劈一道閃電
      if (this.ambientKind === "sparks" && this.clock >= this.nextBoltAt && this.width > 0) {
        this.nextBoltAt = this.clock + rand(2.6, 5.5);
        const bx = rand(this.width * 0.1, this.width * 0.9);
        this.bolt(bx, 0, bx + rand(-40, 40), this.groundY * rand(0.35, 0.6), pick(this.ambientColors));
      }
    }

    // ---- 更新 ----
    const burstDt = realDt * this.timeScale;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      const dt = p.amb ? realDt : burstDt;
      p.life += dt;
      if (p.life >= p.max) {
        this.recycle(i);
        continue;
      }
      if (p.drag !== 1) {
        const keep = Math.pow(p.drag, dt);
        p.vx *= keep;
        p.vy *= keep;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.wobA > 0 && p.k !== K_STAR) {
        p.x += Math.sin(p.wob + p.life * 2.2) * p.wobA * dt;
      }
      p.rot += p.vr * dt;

      // 碎片落地彈一下
      if (p.k === K_SHARD && p.y > this.groundY && p.vy > 0) {
        p.y = this.groundY;
        p.vy *= -0.32;
        p.vx *= 0.6;
        p.vr *= 0.5;
      }
      // 環境粒子飄出畫面就回收
      if (p.amb && p.k !== K_STAR) {
        if (p.y < -40 || p.y > this.height + 40 || p.x < -60 || p.x > this.width + 60) {
          this.recycle(i);
        }
      }
    }

    // ---- 繪製 ----
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    ctx.globalCompositeOperation = "source-over";
    for (const p of this.active) if (!p.add) this.draw(p);
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.active) if (p.add) this.draw(p);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  private recycle(index: number): void {
    const p = this.active[index];
    const last = this.active.length - 1;
    this.active[index] = this.active[last];
    this.active.pop();
    this.pool.push(p);
  }

  private draw(p: Particle): void {
    const ctx = this.ctx;
    const t = Number.isFinite(p.max) ? p.life / p.max : 0;
    const size = p.s0 + (p.s1 - p.s0) * t;

    switch (p.k) {
      case K_SPARK: {
        const len = Math.min(26, Math.hypot(p.vx, p.vy) * 0.045);
        const ang = Math.atan2(p.vy, p.vx);
        ctx.globalAlpha = p.a * (1 - t);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = Math.max(0.5, size);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        break;
      }
      case K_GLOW: {
        ctx.globalAlpha = p.a * (1 - t) * (1 - t);
        const img = this.glowSprite(p.c);
        ctx.drawImage(img, p.x - size, p.y - size, size * 2, size * 2);
        break;
      }
      case K_RING: {
        ctx.globalAlpha = p.a * (1 - t);
        ctx.strokeStyle = p.c;
        ctx.lineWidth = Math.max(0.6, 5 * (1 - t));
        ctx.beginPath();
        // 地面衝擊波壓扁成橢圓，比較有透視感
        ctx.ellipse(p.x, p.y, size, size * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case K_SLASH: {
        // 前 35% 揮出（弧長從 0 長到全長），之後原地淡出、略微變粗
        const grow = Math.min(1, t / 0.35);
        const fade = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
        const sweep = p.sweep * grow;
        const start = p.rot - p.sweep / 2;
        const thickness = size * 0.22 * (0.6 + 0.4 * fade);
        ctx.globalAlpha = p.a * fade;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, start, start + sweep, false);
        ctx.arc(p.x + Math.cos(p.rot) * thickness, p.y + Math.sin(p.rot) * thickness, size - thickness * 0.4, start + sweep, start, true);
        ctx.closePath();
        ctx.fill();
        // 刀光核心一條白線
        ctx.globalAlpha = p.a * fade * 0.9;
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = Math.max(1, thickness * 0.25);
        ctx.beginPath();
        ctx.arc(p.x, p.y, size - thickness * 0.15, start + sweep * 0.08, start + sweep * 0.92, false);
        ctx.stroke();
        break;
      }
      case K_SHARD: {
        ctx.globalAlpha = p.a * Math.min(1, (1 - t) * 2.5);
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.lineTo(size * 0.8, size * 0.7);
        ctx.lineTo(-size * 0.8, size * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        break;
      }
      case K_SMOKE: {
        const fadeIn = Math.min(1, t * 6);
        ctx.globalAlpha = p.a * fadeIn * (1 - t);
        const img = this.softSprite(p.c);
        ctx.drawImage(img, p.x - size, p.y - size, size * 2, size * 2);
        break;
      }
      case K_MOTE: {
        ctx.globalAlpha = p.a * (1 - t);
        ctx.fillStyle = p.c;
        const s = size;
        ctx.fillRect(p.x - s * 0.22, p.y - s, s * 0.44, s * 2);
        ctx.fillRect(p.x - s, p.y - s * 0.22, s * 2, s * 0.44);
        break;
      }
      case K_LEAF: {
        ctx.globalAlpha = p.a * Math.min(1, (p.max - p.life) * 2);
        ctx.fillStyle = p.c;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // 用 scaleX 模擬葉子在空中翻面
        ctx.scale(Math.cos(p.life * 3 + p.wob), 1);
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.5, size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
      case K_BUBBLE: {
        ctx.globalAlpha = p.a;
        ctx.strokeStyle = p.c;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = p.c;
        ctx.globalAlpha = p.a * 0.8;
        ctx.beginPath();
        ctx.arc(p.x - size * 0.35, p.y - size * 0.35, size * 0.25, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case K_DOT: {
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.c;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case K_EMBER: {
        const flicker = 0.65 + 0.35 * Math.sin(p.life * 18 + p.wob);
        ctx.globalAlpha = p.a * flicker * Math.min(1, (p.max - p.life) * 1.5);
        const img = this.glowSprite(p.c);
        ctx.drawImage(img, p.x - size * 3, p.y - size * 3, size * 6, size * 6);
        break;
      }
      case K_STAR: {
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(p.wob + this.clock * p.wobA * 0.5));
        ctx.globalAlpha = p.a * tw;
        ctx.fillStyle = p.c;
        const s = p.s0 * (0.7 + tw * 0.6);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y - s * 2.6);
        ctx.lineTo(p.x + s * 0.5, p.y - s * 0.5);
        ctx.lineTo(p.x + s * 2.6, p.y);
        ctx.lineTo(p.x + s * 0.5, p.y + s * 0.5);
        ctx.lineTo(p.x, p.y + s * 2.6);
        ctx.lineTo(p.x - s * 0.5, p.y + s * 0.5);
        ctx.lineTo(p.x - s * 2.6, p.y);
        ctx.lineTo(p.x - s * 0.5, p.y - s * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case K_BOLT: {
        if (!p.pts) break;
        // 閃電會快速閃兩下
        const flick = t < 0.2 || (t > 0.35 && t < 0.55) ? 1 : 0.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        for (const [width, color, alpha] of [
          [size * 3.2, p.c, 0.35],
          [size, "#FFFFFF", 1],
        ] as const) {
          ctx.globalAlpha = alpha * flick * (1 - t * 0.6);
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(p.pts[0], p.pts[1]);
          for (let j = 2; j < p.pts.length; j += 2) ctx.lineTo(p.pts[j], p.pts[j + 1]);
          ctx.stroke();
        }
        break;
      }
    }
  }

  /** 每種顏色一張預先畫好的發光圖（中心亮、外圍透明） */
  private glowSprite(color: string): HTMLCanvasElement {
    const cached = this.glowCache.get(color);
    if (cached) return cached;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, "#FFFFFF");
      grad.addColorStop(0.18, color);
      grad.addColorStop(0.5, hexToRgba(color, 0.35));
      grad.addColorStop(1, hexToRgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    this.glowCache.set(color, c);
    return c;
  }

  /** 柔邊圓（煙、塵土）：沒有白色亮心 */
  private softSprite(color: string): HTMLCanvasElement {
    const cached = this.softCache.get(color);
    if (cached) return cached;
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    if (g) {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, hexToRgba(color, 0.9));
      grad.addColorStop(0.55, hexToRgba(color, 0.45));
      grad.addColorStop(1, hexToRgba(color, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    this.softCache.set(color, c);
    return c;
  }

  /**
   * 效能看門狗：最近 90 幀平均超過 26ms（低於約 38fps）就降一級畫質，
   * 降級後清空紀錄重新觀察，最低降到 low。
   */
  private tickWatchdog(dt: number): void {
    if (dt <= 0) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((s, v) => s + v, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.026 && this.quality !== "low") {
      this.quality = this.quality === "high" ? "medium" : "low";
      this.profile = QUALITY[this.quality];
      this.resize(this.width, this.height, this.groundY);
      this.onQualityChange?.(this.quality);
    }
  }
}

/** 中點位移法產生一道鋸齒閃電 */
function makeBoltPoints(x1: number, y1: number, x2: number, y2: number, segments: number, jitter: number): number[] {
  const pts: number[] = [x1, y1];
  for (let i = 1; i < segments; i++) {
    const k = i / segments;
    const nx = -(y2 - y1);
    const ny = x2 - x1;
    const len = Math.hypot(nx, ny) || 1;
    const off = rand(-jitter, jitter);
    pts.push(x1 + (x2 - x1) * k + (nx / len) * off, y1 + (y2 - y1) * k + (ny / len) * off);
  }
  pts.push(x2, y2);
  return pts;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
