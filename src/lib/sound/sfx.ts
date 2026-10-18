// src/lib/sound/sfx.ts

/**
 * 音效引擎（全部用 Web Audio 即時合成，沒有任何音檔）
 * ------------------------------------------------------------
 * 為什麼用合成：不用下載、沒有版權問題、檔案大小是 0。音色偏電子遊戲風。
 *
 * 用法：playSfx("hit")。第一次呼叫時才建立 AudioContext——瀏覽器規定
 * 要等使用者點過畫面才能出聲，所以在那之前呼叫只會安靜失敗，不會報錯。
 *
 * 音量：設定頁的滑桿，存在這台裝置的 localStorage（0 = 靜音，預設 70%）。
 * localStorage 在無痕模式可能讀不到，讀寫都包 try/catch，失敗就用預設值。
 *
 * 防爆音：
 *   - 同一種音效 40ms 內只播一次（×2 加速時一幀可能同時十幾下攻擊）
 *   - 全部音效先進一個總音量節點＋壓縮器，再大聲也不會破音
 */

export type SfxName =
  // 介面
  | "click"
  | "open"
  | "close"
  | "error"
  | "toggle"
  // 戰鬥
  | "hit"
  | "hitHeavy"
  | "crit"
  | "dodge"
  | "shieldHit"
  | "shieldBreak"
  | "thorns"
  | "heal"
  | "drain"
  | "skill"
  | "skillStrike"
  | "explode"
  | "stun"
  | "burn"
  | "buff"
  | "shieldUp"
  | "magic"
  | "whoosh"
  | "death"
  | "bossDeath"
  | "bossRoar"
  | "start"
  | "win"
  | "lose"
  // 結算／掉寶／合成
  | "cardFlip"
  | "drop"
  | "rare"
  | "gem"
  | "fuseCharge"
  | "fuseDone"
  | "reveal"
  | "coin";

const VOLUME_KEY = "xq-sfx-volume";
export const DEFAULT_VOLUME = 0.7;
const THROTTLE_MS = 40;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let cachedVolume: number | null = null;
const lastPlayed = new Map<SfxName, number>();

export function getSfxVolume(): number {
  if (cachedVolume !== null) return cachedVolume;
  let v = DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n)) v = Math.max(0, Math.min(1, n));
    }
  } catch {
    // 讀不到就用預設值
  }
  cachedVolume = v;
  return v;
}

export function setSfxVolume(v: number): void {
  const clamped = Math.max(0, Math.min(1, v));
  cachedVolume = clamped;
  try {
    window.localStorage.setItem(VOLUME_KEY, String(clamped));
  } catch {
    // 存不了就只在這次開著的期間有效
  }
  if (master && ctx) master.gain.setTargetAtTime(clamped * 0.8, ctx.currentTime, 0.02);
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  }
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = getSfxVolume() * 0.8;
  master.connect(comp);

  // 1 秒白噪音，打擊、爆炸、刷刷聲共用
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

// ============================================================
// 合成積木
// ============================================================

interface ToneOpts {
  freq: number;
  /** 滑到這個頻率（音高往上或往下掃） */
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  attack?: number;
}

function tone(o: ToneOpts): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  const peak = o.gain ?? 0.3;
  const attack = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

interface NoiseOpts {
  dur: number;
  /** 濾波器頻率；有 to 的話會掃過去 */
  freq: number;
  to?: number;
  q?: number;
  filter?: BiquadFilterType;
  gain?: number;
  delay?: number;
  attack?: number;
}

function noise(o: NoiseOpts): void {
  if (!ctx || !master || !noiseBuffer) return;
  const t0 = ctx.currentTime + (o.delay ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = o.filter ?? "bandpass";
  f.frequency.setValueAtTime(o.freq, t0);
  if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
  f.Q.value = o.q ?? 1;
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.004));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + o.dur + 0.02);
}

/** 一串音符（琶音） */
function arp(freqs: number[], step: number, o: Omit<ToneOpts, "freq">): void {
  freqs.forEach((freq, i) => tone({ ...o, freq, delay: (o.delay ?? 0) + i * step }));
}

// ============================================================
// 音效表
// ============================================================

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

const RECIPES: Record<SfxName, () => void> = {
  click: () => {
    tone({ freq: 1400, to: 900, dur: 0.05, type: "triangle", gain: 0.12 });
  },
  open: () => {
    tone({ freq: 500, to: 900, dur: 0.12, type: "sine", gain: 0.12 });
    noise({ dur: 0.12, freq: 2000, to: 5000, gain: 0.04 });
  },
  close: () => {
    tone({ freq: 800, to: 420, dur: 0.1, type: "sine", gain: 0.1 });
  },
  error: () => {
    tone({ freq: 220, dur: 0.12, type: "square", gain: 0.08 });
    tone({ freq: 180, dur: 0.16, type: "square", gain: 0.08, delay: 0.1 });
  },
  toggle: () => {
    tone({ freq: 900, to: 1300, dur: 0.07, type: "triangle", gain: 0.12 });
  },

  hit: () => {
    noise({ dur: 0.09, freq: 1800, to: 600, q: 0.8, gain: 0.35 });
    tone({ freq: 180, to: 70, dur: 0.1, type: "sine", gain: 0.3 });
  },
  hitHeavy: () => {
    noise({ dur: 0.18, freq: 900, to: 200, q: 0.7, gain: 0.45 });
    tone({ freq: 120, to: 40, dur: 0.22, type: "sine", gain: 0.5 });
  },
  crit: () => {
    noise({ dur: 0.16, freq: 3500, to: 800, q: 0.8, gain: 0.45 });
    tone({ freq: 160, to: 45, dur: 0.25, type: "sine", gain: 0.5 });
    tone({ freq: 1800, to: 2600, dur: 0.18, type: "triangle", gain: 0.12, delay: 0.02 });
  },
  dodge: () => {
    noise({ dur: 0.18, freq: 1200, to: 4000, q: 2, gain: 0.18 });
  },
  shieldHit: () => {
    tone({ freq: 1300, to: 1100, dur: 0.18, type: "sine", gain: 0.15 });
    tone({ freq: 1950, to: 1700, dur: 0.15, type: "sine", gain: 0.08 });
  },
  shieldBreak: () => {
    noise({ dur: 0.35, freq: 5000, to: 1500, q: 1.5, gain: 0.3 });
    arp([2200, 1700, 1300, 950], 0.04, { dur: 0.12, type: "triangle", gain: 0.1 });
  },
  thorns: () => {
    noise({ dur: 0.08, freq: 4500, q: 4, gain: 0.25 });
    tone({ freq: 2400, to: 1800, dur: 0.08, type: "square", gain: 0.05 });
  },
  heal: () => {
    arp([C5, E5, G5], 0.06, { dur: 0.22, type: "sine", gain: 0.14 });
  },
  drain: () => {
    tone({ freq: 300, to: 700, dur: 0.3, type: "sine", gain: 0.12 });
    tone({ freq: 450, to: 1000, dur: 0.3, type: "triangle", gain: 0.06 });
  },
  skill: () => {
    // 放技能的「蓄力」：往上掃的光＋一聲亮音
    noise({ dur: 0.35, freq: 600, to: 6000, q: 1.2, gain: 0.12 });
    tone({ freq: 300, to: 1200, dur: 0.3, type: "sawtooth", gain: 0.06 });
    tone({ freq: 1568, dur: 0.35, type: "sine", gain: 0.1, delay: 0.25 });
  },
  skillStrike: () => {
    noise({ dur: 0.25, freq: 2500, to: 400, q: 0.8, gain: 0.5 });
    tone({ freq: 140, to: 40, dur: 0.3, type: "sine", gain: 0.55 });
  },
  explode: () => {
    noise({ dur: 0.6, freq: 1200, to: 80, q: 0.5, filter: "lowpass", gain: 0.6 });
    tone({ freq: 90, to: 30, dur: 0.5, type: "sine", gain: 0.5 });
  },
  stun: () => {
    arp([1800, 2400, 1800, 2400], 0.06, { dur: 0.1, type: "sine", gain: 0.08 });
  },
  burn: () => {
    noise({ dur: 0.25, freq: 900, to: 2500, q: 0.6, gain: 0.18 });
  },
  buff: () => {
    arp([C5, G5, C6], 0.05, { dur: 0.25, type: "triangle", gain: 0.12 });
    noise({ dur: 0.3, freq: 3000, to: 8000, q: 1, gain: 0.05 });
  },
  shieldUp: () => {
    tone({ freq: 600, to: 1500, dur: 0.3, type: "sine", gain: 0.14 });
    tone({ freq: 900, to: 2200, dur: 0.3, type: "sine", gain: 0.06, delay: 0.03 });
  },
  magic: () => {
    tone({ freq: 700, to: 1400, dur: 0.18, type: "sine", gain: 0.12 });
    noise({ dur: 0.18, freq: 4000, q: 3, gain: 0.06 });
  },
  whoosh: () => {
    noise({ dur: 0.16, freq: 700, to: 2500, q: 1.2, gain: 0.14 });
  },
  death: () => {
    tone({ freq: 500, to: 90, dur: 0.4, type: "square", gain: 0.08 });
    noise({ dur: 0.4, freq: 1500, to: 200, q: 0.7, gain: 0.2 });
  },
  bossDeath: () => {
    noise({ dur: 1.2, freq: 1500, to: 60, q: 0.5, filter: "lowpass", gain: 0.6 });
    tone({ freq: 110, to: 30, dur: 1.1, type: "sine", gain: 0.6 });
    arp([C5, E5, G5, C6], 0.09, { dur: 0.4, type: "triangle", gain: 0.1, delay: 0.5 });
  },
  bossRoar: () => {
    tone({ freq: 90, to: 60, dur: 0.9, type: "sawtooth", gain: 0.14, attack: 0.1 });
    tone({ freq: 135, to: 85, dur: 0.9, type: "sawtooth", gain: 0.08, attack: 0.1 });
    noise({ dur: 0.9, freq: 400, q: 0.8, gain: 0.2, attack: 0.1 });
  },
  start: () => {
    arp([392, C5, G5], 0.09, { dur: 0.25, type: "square", gain: 0.07 });
  },
  win: () => {
    arp([C5, E5, G5, C6], 0.1, { dur: 0.3, type: "square", gain: 0.08 });
    tone({ freq: C6, dur: 0.7, type: "triangle", gain: 0.12, delay: 0.42 });
    tone({ freq: G5, dur: 0.7, type: "triangle", gain: 0.08, delay: 0.42 });
  },
  lose: () => {
    arp([G5 / 2, 370, 311, 262], 0.16, { dur: 0.35, type: "triangle", gain: 0.12 });
  },

  cardFlip: () => {
    noise({ dur: 0.1, freq: 2500, to: 5000, q: 1, gain: 0.12 });
    tone({ freq: 900, to: 1300, dur: 0.08, type: "triangle", gain: 0.06 });
  },
  drop: () => {
    tone({ freq: 1200, to: 600, dur: 0.12, type: "triangle", gain: 0.14 });
    tone({ freq: 1800, dur: 0.15, type: "sine", gain: 0.06, delay: 0.08 });
  },
  rare: () => {
    arp([E5, G5, C6, 1318.5], 0.07, { dur: 0.35, type: "triangle", gain: 0.12 });
    noise({ dur: 0.6, freq: 6000, q: 2, gain: 0.05, delay: 0.1 });
  },
  gem: () => {
    tone({ freq: 2093, dur: 0.4, type: "sine", gain: 0.12 });
    tone({ freq: 3136, dur: 0.3, type: "sine", gain: 0.06, delay: 0.05 });
  },
  fuseCharge: () => {
    tone({ freq: 200, to: 900, dur: 0.9, type: "sawtooth", gain: 0.05, attack: 0.3 });
    noise({ dur: 0.9, freq: 500, to: 5000, q: 1.5, gain: 0.08, attack: 0.3 });
  },
  fuseDone: () => {
    noise({ dur: 0.5, freq: 3000, to: 300, q: 0.6, gain: 0.3 });
    arp([C5, E5, G5, C6, 1318.5], 0.06, { dur: 0.4, type: "triangle", gain: 0.11 });
  },
  reveal: () => {
    noise({ dur: 0.25, freq: 1500, to: 6000, q: 1, gain: 0.1 });
    arp([G5, C6], 0.08, { dur: 0.3, type: "sine", gain: 0.12, delay: 0.12 });
  },
  coin: () => {
    tone({ freq: 1975, dur: 0.07, type: "square", gain: 0.06 });
    tone({ freq: 2637, dur: 0.18, type: "square", gain: 0.06, delay: 0.07 });
  },
};

/** 播一個音效。音量 0、沒有 Web Audio、還沒互動過，都會安靜地什麼都不做 */
export function playSfx(name: SfxName): void {
  if (typeof window === "undefined") return;
  if (getSfxVolume() <= 0) return;
  const now = performance.now();
  const last = lastPlayed.get(name) ?? -Infinity;
  if (now - last < THROTTLE_MS) return;
  lastPlayed.set(name, now);
  const c = ensureContext();
  if (!c) return;
  try {
    RECIPES[name]();
  } catch {
    // 合成失敗不影響遊戲
  }
}

/**
 * 全站按鈕音效：在 document 上聽點擊，點到 button 或連結就「嗒」一聲。
 * 個別按鈕可以用 data-sfx="none" 關掉，或 data-sfx="open" 換成別的音效。
 * 回傳解除監聽的函式。
 */
export function installButtonSfx(): () => void {
  const handler = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.("button, a[href], [role='button']");
    if (!el) return;
    if ((el as HTMLButtonElement).disabled) return;
    const custom = el.getAttribute("data-sfx");
    if (custom === "none") return;
    playSfx(custom && custom in RECIPES ? (custom as SfxName) : "click");
  };
  document.addEventListener("pointerdown", handler, { capture: true, passive: true });
  return () => document.removeEventListener("pointerdown", handler, { capture: true });
}
