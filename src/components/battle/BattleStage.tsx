// src/components/battle/BattleStage.tsx
"use client";

/**
 * 戰鬥播放器 2.0（探險與戰隊共用）
 * ------------------------------------------------------------
 * 這個元件「只負責播放」，完全不做任何戰鬥判定。
 *
 * 勝負在按下開始的那一刻就已經由 lib/rpg/battle.ts 的 simulateBattle()
 * 算完了，傳進來的 result 是一整串帶時間戳的事件。播放器推進一個時間
 * 游標，把到期的事件演出來。所以：
 *   - ×1 / ×2 不會改變結果，只是游標跑得快一倍
 *   - 演出時的「暫停」（開場橫幅、Boss 登場、會心頓幀）只是把游標停住，
 *     事件順序跟結果完全不變
 *   - 中途投降是直接以失敗結束（onSurrender），不改寫結果
 *
 * 畫面分層（由下到上）：
 *   場景背景（BattleBackdrop，SVG）
 *   → 單位（DOM，Web Animations API 做衝刺、受擊、倒下、登場）
 *   → 粒子特效（FxEngine，Canvas）
 *   → 飄字（DOM，手遊式描邊漸層數字）
 *   → 畫面閃光、受傷紅框
 *   → HUD（對戰血條、波次、速度、投降）
 *   → 演出橫幅（開戰、BOSS 警示、K.O.／敗北）
 *
 * 為什麼不用 React state 跑動畫：一次攻擊要動到衝刺、閃白、火花、
 * 飄字、震屏好幾樣東西，全部走 state 每一刀都要重繪整棵樹。這裡只有
 * 「血量、誰在場上、誰活著」這種真正影響版面的資料放 state，其餘
 * 全部用 element.animate() 跟 Canvas 直接畫。
 *
 * 一刀的節奏（×1 速度）：
 *   0ms     攻擊者往後一縮（蓄力）
 *   ~90ms   衝出去，留下速度線
 *   180ms   命中：目標閃白後仰、刀光、火花、衝擊波、飄字、震屏
 *   380ms   攻擊者回到原位
 * 會心一擊另外加：金色雙刀光、頓幀 80ms、鏡頭推近、金色閃光。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJobColor } from "@/lib/rpg/jobVisual";
import type { MonsterArchetype } from "@/lib/rpg/monsters";
import type { BattleEvent, BattleResult, BattleSide, BattleUnit } from "@/lib/rpg/battle";
import MonsterArt from "@/components/battle/MonsterArt";
import PetArt from "@/components/rpg/PetArt";
import BattleBackdrop, { HORIZON_RATIO } from "@/components/battle/BattleBackdrop";
import { FxEngine, detectFxQuality } from "@/components/battle/fxEngine";
import { getTowerArt } from "@/components/battle/towerArt";

/** 可選的播放速度。規格只要 ×1 跟 ×2 兩段 */
export const BATTLE_SPEEDS = [1, 2] as const;
export type BattleSpeed = (typeof BATTLE_SPEEDS)[number];

/**
 * 戰鬥單位的顯示資訊。BattleUnit 本身只有數值，畫面需要的
 * 圖、怪物造型由呼叫端一起帶進來。
 */
export interface BattleUnitVisual {
  /** 對應 BattleUnit.id */
  id: string;
  /** 職業 id，有的話畫職業圖＋職業色魔法陣 */
  jobId?: string | null;
  /** 沒有圖的時候顯示的 emoji（後備） */
  emoji?: string;
  /** 怪物：用程式繪製（MonsterArt）。有這個欄位就不看 jobId / emoji */
  monster?: {
    tower: number;
    archetype: MonsterArchetype;
    isBoss: boolean;
  };
}

interface BattleStageProps {
  playerUnits: BattleUnit[];
  enemyUnits: BattleUnit[];
  visuals: BattleUnitVisual[];
  result: BattleResult;
  /** 第幾座塔：決定場景、怪物配色、環境粒子。不給 = 競技場（戰隊） */
  tower?: number | null;
  /** 舊參數，保留相容；場景顏色現在由 tower 決定 */
  accentColor?: string;
  /** 開場橫幅下面那行字，例如「青草塔・第 3 關」 */
  title?: string;
  /** 血條上的名字。不給的話：單隻就用那隻的名字，多隻就是「我方／敵方」 */
  playerLabel?: string;
  enemyLabel?: string;
  /** 播完（或投降）之後呼叫，保證只呼叫一次。surrendered = 中途按投降 */
  onFinish: (outcome: { winner: BattleSide; surrendered: boolean }) => void;
}

interface RuntimeState {
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  onField: Record<string, boolean>;
}

interface LogLine {
  key: number;
  text: string;
  tone: "normal" | "crit" | "kill" | "heal" | "end";
}

type BannerKind = "start" | "boss" | "win" | "lose" | "timeup";
interface Banner {
  kind: BannerKind;
  key: number;
  title?: string;
}

type Entrance = "slideL" | "slideR" | "walk" | "drop";

/** 單位在舞台上的位置（CSS px） */
interface Anchor {
  /** 腳底中心 */
  x: number;
  feetY: number;
  /** 圖的邊長 */
  size: number;
  /** 身體中心（特效打在這裡） */
  cy: number;
  /** 頭頂（飄字從這裡冒出來） */
  headY: number;
}

// ---- 演出時間（ms，×1 速度下） ----
const LUNGE_MS = 380;
const IMPACT_MS = 180;
const DEATH_MS = 560;
const START_BANNER_MS = 1350;
const BOSS_INTRO_MS = 2700;
const KILL_BEAT_MS = 380;
const CRIT_HITSTOP_MS = 80;
const FINISH_BANNER_MS = 1700;

/** 日誌最多留幾行，避免打很久之後 DOM 無限長 */
const MAX_LOG_LINES = 40;

/**
 * 陣型：n 隻同時在場時每一隻站哪裡（以我方＝左半邊為準，敵方鏡像）。
 * x / y 是舞台寬高的比例（y = 腳底），s = 縮放。後排站高一點、
 * 小一點，做出前後排的縱深。
 */
const FORMATIONS: Record<number, { x: number; y: number; s: number }[]> = {
  1: [{ x: 0.25, y: 0.79, s: 1 }],
  2: [
    { x: 0.31, y: 0.71, s: 0.8 },
    { x: 0.17, y: 0.84, s: 0.88 },
  ],
  3: [
    { x: 0.34, y: 0.74, s: 0.76 },
    { x: 0.14, y: 0.66, s: 0.66 },
    { x: 0.21, y: 0.86, s: 0.84 },
  ],
};

/**
 * 圖的「頭頂」在圖框高度的哪裡（0 = 最上面）。怪物的身體不是頂滿
 * 整個圖框的（坦克型很矮），小血條跟飄字要貼著真正的頭頂，不然會
 * 飄在半空中看起來跟那隻怪沒關係。
 */
const HEAD_RATIO: Record<string, number> = {
  tank: 0.36,
  balanced: 0.3,
  attacker: 0.1,
  boss: 0.16,
  pet: 0.06,
};

/** 飄字樣式 */
const TEXT_STYLES = {
  // 我方打怪
  dmg: { size: 24, fill: "linear-gradient(180deg,#FFFFFF 30%,#FFE6B8 100%)", stroke: 6, strokeColor: "#3A1500", dur: 900 },
  // 我方被打
  hurt: { size: 22, fill: "linear-gradient(180deg,#FFE3E3 20%,#FF4D5E 100%)", stroke: 6, strokeColor: "#3A0008", dur: 900 },
  // 會心一擊
  crit: { size: 36, fill: "linear-gradient(180deg,#FFFBE0 10%,#FFC93D 55%,#FF7A00 100%)", stroke: 7, strokeColor: "#4A1200", dur: 1150 },
  heal: { size: 22, fill: "linear-gradient(180deg,#F0FFF6 20%,#3DDB84 100%)", stroke: 6, strokeColor: "#053A1C", dur: 1100 },
  // 「會心一擊」「擊破！」這種中文標籤
  label: { size: 15, fill: "linear-gradient(180deg,#FFFBE0 10%,#FFC93D 100%)", stroke: 5, strokeColor: "#4A1200", dur: 1000 },
  kill: { size: 26, fill: "linear-gradient(180deg,#FFFFFF 10%,#FFE07A 50%,#FF9A1F 100%)", stroke: 7, strokeColor: "#3A1500", dur: 1100 },
} as const;
type TextStyle = keyof typeof TEXT_STYLES;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 掃一遍事件，算出某一邊「同時在場」最多幾隻（決定用幾人陣型） */
function maxConcurrent(events: BattleEvent[], ids: Set<string>): number {
  let current = 0;
  let max = 0;
  for (const e of events) {
    if (e.type === "spawn" && ids.has(e.unitId)) {
      current += 1;
      max = Math.max(max, current);
    } else if (e.type === "death" && ids.has(e.unitId)) {
      current -= 1;
    }
  }
  return Math.max(1, Math.min(3, max));
}

// ============================================================
// 子元件
// ============================================================

/** 我方腳下的職業色魔法陣（壓扁的旋轉圓陣，做出地面透視） */
function MagicCircle({ color, size, gold = true }: { color: string; size: number; gold?: boolean }) {
  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: -size * 0.08,
        width: size * 1.16,
        height: size * 1.16,
        top: size * 0.95 - size * 0.58,
        transform: "scaleY(0.3)",
      }}
    >
      <svg viewBox="0 0 100 100" className="spin-slow h-full w-full" style={{ overflow: "visible" }}>
        <circle cx={50} cy={50} r={47} fill="none" stroke={gold ? "#F5C542" : color} strokeWidth={2.4} opacity={0.9} />
        <circle cx={50} cy={50} r={40} fill="none" stroke={color} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.7} />
        <circle cx={50} cy={50} r={44} fill={color} opacity={0.12} />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <path key={deg} d="M50,4 L53,9 L50,14 L47,9 Z" fill={color} transform={`rotate(${deg} 50 50)`} />
        ))}
      </svg>
    </div>
  );
}

/** 小雞（職業圖，沒有圖就用 emoji）。舞台上的版本 */
function PetSprite({ jobId, emoji, size, flip }: { jobId?: string | null; emoji?: string; size: number; flip: boolean }) {
  return <PetArt jobId={jobId} emoji={emoji} size={size} flip={flip} />;
}

/** HUD 裡的小頭像 */
function Portrait({
  visual,
  side,
  size,
}: {
  visual: BattleUnitVisual | undefined;
  side: BattleSide;
  size: number;
}) {
  const ring = side === "player" ? "#5FD3FF" : "#FF4D5E";
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 50% 35%, #3A3F6E 0%, #15162E 100%)",
        boxShadow: `0 0 0 2px #F5C542, 0 0 0 3.5px #2A1A05, 0 0 10px ${ring}`,
      }}
    >
      <div className="absolute inset-0 flex items-end justify-center" style={{ paddingTop: size * 0.08 }}>
        {visual?.monster ? (
          <MonsterArt
            tower={visual.monster.tower}
            archetype={visual.monster.archetype}
            isBoss={visual.monster.isBoss}
            size={size * 1.05}
          />
        ) : (
          <PetSprite jobId={visual?.jobId} emoji={visual?.emoji} size={size * 0.95} flip={side === "enemy"} />
        )}
      </div>
    </div>
  );
}

/** 對戰血條（平行四邊形，帶延遲的白色「削血」殘影） */
function VersusBar({
  side,
  label,
  hp,
  maxHp,
  isBoss,
}: {
  side: BattleSide;
  label: string;
  hp: number;
  maxHp: number;
  isBoss: boolean;
}) {
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0;
  const isPlayer = side === "player";
  const low = pct <= 25;
  const fill = isPlayer
    ? low
      ? "linear-gradient(180deg,#FFE07A 0%,#FF9A1F 100%)"
      : "linear-gradient(180deg,#B8FF9A 0%,#3DDB84 55%,#1E9E5A 100%)"
    : "linear-gradient(180deg,#FFB3B3 0%,#FF4D5E 55%,#B0102A 100%)";
  // 我方：左邊是外側、往右（中間）扣；敵方：右邊是外側、往左扣
  const clip = isPlayer ? "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)" : "polygon(0 0, 100% 0, 100% 100%, 8px 100%)";

  return (
    <div className={["min-w-0 flex-1", isPlayer ? "" : "text-right"].join(" ")}>
      <div className={["flex items-center gap-1", isPlayer ? "" : "flex-row-reverse"].join(" ")}>
        {isBoss ? (
          <span className="font-display rounded-[4px] bg-[#FF2D46] px-1 text-[9px] leading-[14px] text-white shadow-[0_0_8px_#FF2D46]">
            BOSS
          </span>
        ) : null}
        <span
          className="truncate text-[11px] font-black text-white"
          style={{ textShadow: "0 1px 0 #000, 0 0 6px rgba(0,0,0,0.6)" }}
        >
          {label}
        </span>
      </div>
      <div
        className="relative mt-0.5 h-[11px] overflow-hidden"
        style={{ clipPath: clip, background: "rgba(8,8,20,0.75)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)" }}
      >
        {/* 削血殘影：比真正的血條慢半拍才跟上 */}
        <div
          className="absolute inset-y-0"
          style={{
            [isPlayer ? "left" : "right"]: 0,
            width: `${pct}%`,
            background: "#FFFFFF",
            opacity: 0.85,
            transition: "width 520ms cubic-bezier(.4,0,.2,1) 380ms",
          }}
        />
        <div
          className="absolute inset-y-0"
          style={{
            [isPlayer ? "left" : "right"]: 0,
            width: `${pct}%`,
            background: fill,
            transition: "width 140ms ease-out",
            boxShadow: "inset 0 2px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(0,0,0,0.25)",
          }}
        />
        {/* 刻度線，每 10% 一格 */}
        <div
          className="absolute inset-0"
          style={{ backgroundImage: "repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), rgba(0,0,0,0.35) calc(10% - 1px) 10%)" }}
        />
      </div>
      <p
        className="font-display mt-0.5 text-[10px] leading-none text-white/85"
        style={{ textShadow: "0 1px 0 #000" }}
      >
        {Math.max(0, Math.round(hp))} / {Math.round(maxHp)}
      </p>
    </div>
  );
}

// ============================================================
// 主元件
// ============================================================

export default function BattleStage({
  playerUnits,
  enemyUnits,
  visuals,
  result,
  tower = null,
  title,
  playerLabel,
  enemyLabel,
  onFinish,
}: BattleStageProps) {
  const art = getTowerArt(tower);
  const allUnits = useMemo(() => [...playerUnits, ...enemyUnits], [playerUnits, enemyUnits]);
  const unitById = useMemo(() => {
    const map: Record<string, BattleUnit> = {};
    for (const u of allUnits) map[u.id] = u;
    return map;
  }, [allUnits]);
  const visualById = useMemo(() => {
    const map: Record<string, BattleUnitVisual> = {};
    for (const v of visuals) map[v.id] = v;
    return map;
  }, [visuals]);
  const enemyIndex = useMemo(() => {
    const map: Record<string, number> = {};
    enemyUnits.forEach((u, i) => (map[u.id] = i));
    return map;
  }, [enemyUnits]);
  const playerIndex = useMemo(() => {
    const map: Record<string, number> = {};
    playerUnits.forEach((u, i) => (map[u.id] = i));
    return map;
  }, [playerUnits]);

  const playerSlots = useMemo(
    () => maxConcurrent(result.events, new Set(playerUnits.map((u) => u.id))),
    [result.events, playerUnits],
  );
  const enemySlots = useMemo(
    () => maxConcurrent(result.events, new Set(enemyUnits.map((u) => u.id))),
    [result.events, enemyUnits],
  );
  /** 探險：怪物一隻一隻上；血條顯示「目前這隻」而不是全隊加總 */
  const isWaveMode = enemySlots === 1 && enemyUnits.length > 1;

  const isBossUnit = useCallback((id: string) => Boolean(visualById[id]?.monster?.isBoss), [visualById]);

  // ---- 畫面狀態（只放真正影響版面的） ----
  const initialState = useMemo((): RuntimeState => {
    const hp: Record<string, number> = {};
    const alive: Record<string, boolean> = {};
    const onField: Record<string, boolean> = {};
    for (const u of allUnits) {
      hp[u.id] = u.maxHp;
      alive[u.id] = true;
      onField[u.id] = false;
    }
    return { hp, alive, onField };
  }, [allUnits]);

  const [state, setState] = useState<RuntimeState>(initialState);
  const [speed, setSpeed] = useState<BattleSpeed>(1);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [defeated, setDefeated] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [lost, setLost] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // ---- refs ----
  const frameRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<HTMLDivElement | null>(null);
  const shakeRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const flashRef = useRef<HTMLDivElement | null>(null);
  const hurtRef = useRef<HTMLDivElement | null>(null);
  const logBottomRef = useRef<HTMLDivElement | null>(null);
  const fxRef = useRef<FxEngine | null>(null);
  const outerEls = useRef(new Map<string, HTMLDivElement>());
  const midEls = useRef(new Map<string, HTMLDivElement>());
  const lungeAnims = useRef(new Map<string, Animation>());
  const entranceRef = useRef(new Map<string, Entrance>());
  const anchorsRef = useRef<Record<string, Anchor>>({});
  const textSlotRef = useRef<Record<string, number>>({});

  const eventIndexRef = useRef(0);
  const elapsedRef = useRef(0);
  const pauseUntilRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const keyRef = useRef(0);
  const speedRef = useRef<number>(1);
  const timersRef = useRef(new Set<number>());
  const finishedRef = useRef(false);
  const stoppedRef = useRef(false);

  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    [],
  );

  // ============================================================
  // 版面量測
  // ============================================================

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      // 高度跟著寬度走：手機約 300px，平板最多 400px
      const h = Math.round(Math.min(400, Math.max(290, w * 0.86)));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** 每一隻單位的站位（依陣型＋是不是 Boss） */
  const anchors = useMemo(() => {
    const result: Record<string, Anchor> = {};
    if (size.w === 0) return result;
    const base = Math.min(size.w * 0.34, size.h * 0.44);
    const place = (unit: BattleUnit, slotCount: number, slotIndex: number, side: BattleSide) => {
      const f = FORMATIONS[slotCount][slotIndex % slotCount];
      const boss = isBossUnit(unit.id);
      const s = base * f.s * (boss ? 1.32 : 1);
      const x = (side === "player" ? f.x : 1 - f.x) * size.w;
      const feetY = f.y * size.h;
      const m = visualById[unit.id]?.monster;
      const headKey = m ? (m.isBoss ? "boss" : m.archetype) : "pet";
      const top = feetY - s * 0.95;
      const headY = top + s * HEAD_RATIO[headKey];
      result[unit.id] = { x, feetY, size: s, cy: (headY + feetY) / 2, headY };
    };
    for (const u of playerUnits) place(u, playerSlots, playerIndex[u.id], "player");
    for (const u of enemyUnits) place(u, enemySlots, enemySlots === 1 ? 0 : enemyIndex[u.id], "enemy");
    return result;
  }, [size, playerUnits, enemyUnits, playerSlots, enemySlots, playerIndex, enemyIndex, isBossUnit, visualById]);

  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  // ============================================================
  // 特效引擎
  // ============================================================

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: FxEngine;
    try {
      engine = new FxEngine(canvas, detectFxQuality());
    } catch {
      return; // 沒有 Canvas 就沒有粒子，戰鬥照樣播
    }
    fxRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      fxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const fx = fxRef.current;
    if (!fx || size.w === 0) return;
    fx.resize(size.w, size.h, size.h * 0.9);
  }, [size]);

  useEffect(() => {
    const fx = fxRef.current;
    if (!fx || size.w === 0) return;
    fx.setAmbient(art.ambient, art.ambientColors);
    // 只在換場景時重設環境粒子，跟尺寸無關
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art.ambient, size.w > 0]);

  useEffect(() => {
    speedRef.current = speed;
    fxRef.current?.setTimeScale(speed);
  }, [speed]);

  // ============================================================
  // 排程工具
  // ============================================================

  /** 依目前倍速延遲執行；元件卸載時一起清掉 */
  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      if (!stoppedRef.current) fn();
    }, ms / speedRef.current);
    timersRef.current.add(id);
  }, []);

  /** 把時間游標停住一段時間（演出用，不影響結果） */
  const holdTimeline = useCallback((ms: number) => {
    pauseUntilRef.current = Math.max(pauseUntilRef.current, performance.now() + ms / speedRef.current);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    // 開發模式的 StrictMode 會「掛載 → 卸載 → 再掛載」一次。卸載時把
    // stoppedRef 設成 true，再掛載時一定要放回 false，否則之後排程的
    // 命中、倒下全部會被跳過（畫面只剩衝刺，血永遠不會扣）
    stoppedRef.current = false;
    return () => {
      stoppedRef.current = true;
      for (const id of timers) window.clearTimeout(id);
      timers.clear();
    };
  }, []);

  // ============================================================
  // 鏡頭與畫面效果
  // ============================================================

  const shake = useCallback(
    (intensity: number, duration = 300) => {
      const el = shakeRef.current;
      if (!el || reduceMotion || intensity <= 0) return;
      const frames: Keyframe[] = [];
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const k = intensity * (1 - i / steps);
        frames.push({ transform: `translate(${rand(-k, k).toFixed(1)}px, ${rand(-k, k).toFixed(1)}px)` });
      }
      frames.push({ transform: "translate(0px, 0px)" });
      el.animate(frames, { duration: duration / speedRef.current, easing: "linear" });
    },
    [reduceMotion],
  );

  const zoomPunch = useCallback(
    (scale: number, originX: number, originY: number, duration = 300) => {
      const el = zoomRef.current;
      if (!el || reduceMotion) return;
      el.style.transformOrigin = `${originX}px ${originY}px`;
      el.animate([{ transform: `scale(${scale})` }, { transform: "scale(1)" }], {
        duration: duration / speedRef.current,
        easing: "cubic-bezier(.2,.8,.2,1)",
      });
    },
    [reduceMotion],
  );

  const flash = useCallback(
    (color: string, alpha: number, duration = 220) => {
      const el = flashRef.current;
      if (!el) return;
      const a = reduceMotion ? alpha * 0.35 : alpha;
      el.animate(
        [
          { backgroundColor: color, opacity: a },
          { backgroundColor: color, opacity: 0 },
        ],
        { duration: duration / speedRef.current, easing: "ease-out" },
      );
    },
    [reduceMotion],
  );

  const hurtVignette = useCallback(() => {
    hurtRef.current?.animate([{ opacity: 0.9 }, { opacity: 0 }], {
      duration: 520 / speedRef.current,
      easing: "ease-out",
    });
  }, []);

  /** 在舞台上冒一個特效字 */
  const spawnText = useCallback(
    (x: number, yIn: number, text: string, style: TextStyle, opts?: { scale?: number; dx?: number }) => {
      let y = yIn;
      const layer = textLayerRef.current;
      if (!layer) return;
      const st = TEXT_STYLES[style];
      const scale = opts?.scale ?? 1;
      // 字會往上飄約 50px，起點太高會飄進上方血條底下被蓋住
      // （上方 HUD 約 80px 高）
      y = Math.max(y, style === "label" ? 116 : 140);
      const el = document.createElement("span");
      el.className = style === "label" ? "fx-text" : "fx-text font-display";
      el.textContent = text;
      el.dataset.text = text;
      el.style.cssText = [
        "position:absolute",
        `left:${x}px`,
        `top:${y}px`,
        `font-size:${Math.round(st.size * scale)}px`,
        "font-weight:900",
        "line-height:1",
        `--fx-fill:${st.fill}`,
        `--fx-stroke:${st.stroke}px`,
        `--fx-stroke-color:${st.strokeColor}`,
        "pointer-events:none",
        "will-change:transform,opacity",
        "z-index:5",
      ].join(";");
      layer.appendChild(el);

      const dx = opts?.dx ?? rand(-8, 8);
      const big = style === "crit" || style === "kill";
      const frames: Keyframe[] = big
        ? [
            { transform: "translate(-50%,-50%) scale(2.6) rotate(-6deg)", opacity: 0 },
            { transform: "translate(-50%,-50%) scale(0.86) rotate(2deg)", opacity: 1, offset: 0.14 },
            { transform: "translate(-50%,-50%) scale(1.08) rotate(0deg)", opacity: 1, offset: 0.24 },
            { transform: `translate(calc(-50% + ${dx}px),calc(-50% - 30px)) scale(1)`, opacity: 1, offset: 0.72 },
            { transform: `translate(calc(-50% + ${dx * 1.3}px),calc(-50% - 50px)) scale(0.9)`, opacity: 0 },
          ]
        : [
            { transform: "translate(-50%,-50%) scale(0.3)", opacity: 0 },
            { transform: "translate(-50%,-50%) scale(1.4)", opacity: 1, offset: 0.12 },
            { transform: "translate(-50%,-50%) scale(1)", opacity: 1, offset: 0.24 },
            { transform: `translate(calc(-50% + ${dx}px),calc(-50% - 34px)) scale(1)`, opacity: 1, offset: 0.7 },
            { transform: `translate(calc(-50% + ${dx * 1.3}px),calc(-50% - 52px)) scale(0.85)`, opacity: 0 },
          ];
      const anim = el.animate(frames, {
        duration: st.dur / speedRef.current,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "forwards",
      });
      anim.onfinish = () => el.remove();
    },
    [],
  );

  /** 同一隻身上連續冒字時左右錯開，不疊成一團 */
  const nextTextOffset = useCallback((unitId: string) => {
    const n = (textSlotRef.current[unitId] ?? 0) + 1;
    textSlotRef.current[unitId] = n;
    return [0, -16, 16, -8, 8][n % 5];
  }, []);

  // ============================================================
  // 單位的動畫
  // ============================================================

  const playEntrance = useCallback(
    (id: string, mid: HTMLDivElement, kind: Entrance) => {
      const a = anchorsRef.current[id];
      const fx = fxRef.current;
      const sp = speedRef.current;
      switch (kind) {
        case "slideL":
        case "slideR": {
          const dir = kind === "slideL" ? -1 : 1;
          mid.animate(
            [
              { transform: `translateX(${dir * 160}%)`, opacity: 0 },
              { transform: `translateX(${dir * 20}%) translateY(-12%)`, opacity: 1, offset: 0.6 },
              { transform: "translateX(0) translateY(0) scale(1.08,0.9)", offset: 0.85 },
              { transform: "translateX(0) translateY(0) scale(1)" },
            ],
            { duration: 620 / sp, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" },
          );
          if (a && fx) window.setTimeout(() => fx.dust(a.x, a.feetY, a.size), 520 / sp);
          break;
        }
        case "walk": {
          // 下一隻怪：從右邊兩段跳進場
          mid.animate(
            [
              { transform: "translateX(110%) translateY(0)", opacity: 0 },
              { transform: "translateX(60%) translateY(-18%)", opacity: 1, offset: 0.3 },
              { transform: "translateX(30%) translateY(0) scale(1.06,0.92)", offset: 0.5 },
              { transform: "translateX(10%) translateY(-12%)", offset: 0.75 },
              { transform: "translateX(0) translateY(0) scale(1.08,0.9)", offset: 0.92 },
              { transform: "translateX(0) translateY(0) scale(1)" },
            ],
            { duration: 560 / sp, easing: "ease-out", fill: "backwards" },
          );
          if (a && fx) window.setTimeout(() => fx.dust(a.x, a.feetY, a.size), 500 / sp);
          break;
        }
        case "drop": {
          // Boss：從天而降，落地瞬間壓扁＋衝擊波＋重震
          mid.animate(
            [
              { transform: "translateY(-260%) scale(0.9,1.15)", opacity: 1 },
              { transform: "translateY(0) scale(0.9,1.15)", offset: 0.55, easing: "ease-in" },
              { transform: "translateY(0) scale(1.25,0.72)", offset: 0.68 },
              { transform: "translateY(-6%) scale(0.95,1.06)", offset: 0.84 },
              { transform: "translateY(0) scale(1)" },
            ],
            { duration: 900 / sp, fill: "backwards" },
          );
          window.setTimeout(() => {
            if (stoppedRef.current) return;
            const anchor = anchorsRef.current[id];
            if (anchor && fx) fx.shockwave(anchor.x, anchor.feetY, "#FF4D5E", anchor.size);
            shake(14, 520);
            flash("#FFFFFF", 0.45, 260);
          }, (900 * 0.55) / sp);
          break;
        }
      }
    },
    [flash, shake],
  );

  /** ref callback 快取：同一個 id 永遠拿到同一個函式，避免每次重繪都重掛 */
  const outerRefCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const midRefCache = useRef(new Map<string, (el: HTMLDivElement | null) => void>());

  const outerRefFor = useCallback((id: string) => {
    let fn = outerRefCache.current.get(id);
    if (!fn) {
      fn = (el: HTMLDivElement | null) => {
        if (el) outerEls.current.set(id, el);
        else outerEls.current.delete(id);
      };
      outerRefCache.current.set(id, fn);
    }
    return fn;
  }, []);

  const midRefFor = useCallback(
    (id: string) => {
      let fn = midRefCache.current.get(id);
      if (!fn) {
        fn = (el: HTMLDivElement | null) => {
          if (!el) {
            midEls.current.delete(id);
            return;
          }
          midEls.current.set(id, el);
          const entrance = entranceRef.current.get(id);
          if (entrance) {
            entranceRef.current.delete(id);
            playEntrance(id, el, entrance);
          }
        };
        midRefCache.current.set(id, fn);
      }
      return fn;
    },
    [playEntrance],
  );

  // ============================================================
  // 日誌
  // ============================================================

  const pushLog = useCallback((text: string, tone: LogLine["tone"]) => {
    keyRef.current += 1;
    const key = keyRef.current;
    setLogs((prev) => [...prev, { key, text, tone }].slice(-MAX_LOG_LINES));
  }, []);

  const unitName = useCallback((id: string) => unitById[id]?.name ?? "？", [unitById]);

  // ============================================================
  // 事件 → 演出
  // ============================================================

  const finish = useCallback(
    (winner: BattleSide, surrendered: boolean) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onFinish({ winner, surrendered });
    },
    [onFinish],
  );

  const bossIntro = useCallback(
    (unitId: string, delayMs: number) => {
      holdTimeline(delayMs + BOSS_INTRO_MS);
      later(delayMs, () => {
        keyRef.current += 1;
        setBanner({ kind: "boss", key: keyRef.current, title: unitName(unitId) });
        flash("#FF2D46", 0.25, 500);
      });
      later(delayMs + 1500, () => {
        entranceRef.current.set(unitId, "drop");
        setState((prev) => ({ ...prev, onField: { ...prev.onField, [unitId]: true } }));
      });
      later(delayMs + BOSS_INTRO_MS - 200, () => setBanner((b) => (b?.kind === "boss" ? null : b)));
    },
    [flash, holdTimeline, later, unitName],
  );

  const applyEvent = useCallback(
    (event: BattleEvent) => {
      const fx = fxRef.current;

      switch (event.type) {
        case "spawn": {
          const unit = unitById[event.unitId];
          if (!unit) break;
          const isInitial = event.t === 0;
          if (isBossUnit(event.unitId)) {
            bossIntro(event.unitId, isInitial ? START_BANNER_MS : IMPACT_MS + DEATH_MS);
            break;
          }
          const entrance: Entrance = isInitial ? (unit.side === "player" ? "slideL" : "slideR") : "walk";
          const show = () => {
            entranceRef.current.set(event.unitId, entrance);
            setState((prev) => ({ ...prev, onField: { ...prev.onField, [event.unitId]: true } }));
          };
          if (isInitial) show();
          else later(IMPACT_MS + DEATH_MS - 120, show);
          break;
        }

        case "attack": {
          const anchors = anchorsRef.current;
          const A = anchors[event.attackerId];
          const T = anchors[event.targetId];
          const attacker = unitById[event.attackerId];
          const target = unitById[event.targetId];
          if (!A || !T || !attacker || !target) break;
          const dir = T.x >= A.x ? 1 : -1;
          const crit = event.isHigh;

          // ---- 攻擊者衝刺 ----
          const outer = outerEls.current.get(event.attackerId);
          if (outer) {
            lungeAnims.current.get(event.attackerId)?.cancel();
            const oneOnOne = playerSlots === 1 && enemySlots === 1;
            const contact = (A.size + T.size) * 0.3;
            const dx = oneOnOne ? T.x - A.x - dir * contact : (T.x - A.x) * 0.42;
            const dy = oneOnOne ? 0 : (T.feetY - A.feetY) * 0.42;
            const anim = outer.animate(
              [
                { transform: "translate(0,0)" },
                { transform: `translate(${-dir * A.size * 0.1}px,0) scale(0.94,1.06)`, offset: 0.2 },
                { transform: `translate(${dx}px,${dy}px) scale(1.08,0.94)`, offset: IMPACT_MS / LUNGE_MS },
                { transform: `translate(${dx * 0.96}px,${dy * 0.96}px)`, offset: 0.62 },
                { transform: "translate(0,0)" },
              ],
              { duration: LUNGE_MS / speedRef.current, easing: "cubic-bezier(.3,.7,.3,1)" },
            );
            lungeAnims.current.set(event.attackerId, anim);
          }
          later(80, () => {
            const a = anchorsRef.current[event.attackerId];
            if (a && fx) fx.speedLines(a.x, a.cy, dir, a.size, "#FFFFFF");
          });

          // ---- 命中 ----
          later(IMPACT_MS, () => {
            setState((prev) => ({ ...prev, hp: { ...prev.hp, [event.targetId]: event.targetHpAfter } }));
            const t = anchorsRef.current[event.targetId] ?? T;
            const targetIsPlayer = target.side === "player";
            const colors = targetIsPlayer ? ["#FFFFFF", "#FF9A9A", "#FF4D5E"] : art.impactColors;
            const slashColor = targetIsPlayer ? "#FF6A7A" : attacker.side === "player" ? getJobColor(visualById[event.attackerId]?.jobId) : "#FFFFFF";

            if (fx) {
              fx.impact(t.x, t.cy, { colors, crit, dir, power: Math.min(1.5, t.size / 90) });
              fx.slash(t.x - dir * t.size * 0.05, t.cy, {
                angle: (dir > 0 ? Math.PI * 0.82 : Math.PI * 0.18) + rand(-0.25, 0.25),
                color: mixSlashColor(slashColor),
                crit,
                size: t.size * 0.48,
              });
            }

            // 目標閃白後仰
            const mid = midEls.current.get(event.targetId);
            mid?.animate(
              [
                { transform: "translateX(0) scale(1)", filter: "brightness(1)" },
                { transform: `translateX(${dir * t.size * 0.09}px) scale(0.94,1.04)`, filter: "brightness(2.6) saturate(0.3)", offset: 0.16 },
                { transform: `translateX(${dir * t.size * 0.04}px)`, filter: "brightness(1.2)", offset: 0.45 },
                { transform: "translateX(0) scale(1)", filter: "brightness(1)" },
              ],
              { duration: 300 / speedRef.current, easing: "ease-out" },
            );

            // 飄字
            const offset = nextTextOffset(event.targetId);
            if (crit) {
              spawnText(t.x + offset, t.headY - 40, "會心一擊", "label");
              spawnText(t.x + offset, t.headY - 14, `${event.damage}`, "crit", { dx: offset * 0.5 });
              holdTimeline(CRIT_HITSTOP_MS);
              shake(7, 320);
              zoomPunch(1.045, t.x, t.cy, 320);
              flash("#FFD84B", 0.22, 200);
            } else {
              spawnText(t.x + offset, t.headY - 14, `${event.damage}`, targetIsPlayer ? "hurt" : "dmg", { dx: offset * 0.5 });
              shake(targetIsPlayer ? 4 : 2.5, 220);
            }

            // 我方被打掉一大截血：畫面四周紅一下
            if (targetIsPlayer && event.damage >= target.maxHp * 0.12) hurtVignette();

            pushLog(
              `${unitName(event.attackerId)} → ${unitName(event.targetId)}　${crit ? "會心 " : ""}${event.damage}`,
              crit ? "crit" : "normal",
            );
          });
          break;
        }

        case "death": {
          const unit = unitById[event.unitId];
          if (!unit) break;
          const boss = isBossUnit(event.unitId);
          if (unit.side === "enemy") holdTimeline(boss ? 900 : KILL_BEAT_MS);

          later(IMPACT_MS + 40, () => {
            setState((prev) => ({ ...prev, alive: { ...prev.alive, [event.unitId]: false } }));
            const a = anchorsRef.current[event.unitId];
            const mid = midEls.current.get(event.unitId);
            const visual = visualById[event.unitId];
            const deathColors = visual?.monster
              ? [art.body, art.bodyLight, art.accent, "#FFFFFF"]
              : [getJobColor(visual?.jobId), "#FFFFFF", "#FFE07A"];

            mid?.animate(
              [
                { transform: "scale(1) translateY(0)", filter: "brightness(1)", opacity: 1 },
                { transform: "scale(1.14,0.86) translateY(0)", filter: "brightness(3.2) saturate(0)", opacity: 1, offset: 0.22 },
                { transform: "scale(0.85,1.15) translateY(-8%)", filter: "brightness(4)", opacity: 0.9, offset: 0.45 },
                { transform: "scale(0.2,1.6) translateY(-30%)", filter: "brightness(6)", opacity: 0 },
              ],
              { duration: (boss ? 900 : DEATH_MS) / speedRef.current, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
            );

            if (a && fx) {
              if (boss) {
                // Boss：三連爆
                fx.death(a.x, a.cy, { colors: deathColors, size: a.size, boss: true });
                later(220, () => fx.death(a.x - a.size * 0.25, a.cy - a.size * 0.2, { colors: deathColors, size: a.size * 0.7 }));
                later(440, () => fx.death(a.x + a.size * 0.2, a.cy + a.size * 0.1, { colors: deathColors, size: a.size * 0.8 }));
              } else {
                fx.death(a.x, a.cy, { colors: deathColors, size: a.size });
              }
            }

            if (unit.side === "enemy") {
              setDefeated((prev) => prev + 1);
              // 「擊破！」放在身體正中間，不要跟頭頂往上飄的傷害數字撞在一起
              if (a) spawnText(a.x, a.cy + a.size * 0.1, boss ? "討伐成功！" : "擊破！", boss ? "kill" : "label", { scale: boss ? 1 : 1.5, dx: 0 });
              shake(boss ? 16 : 8, boss ? 700 : 360);
              flash("#FFFFFF", boss ? 0.6 : 0.28, boss ? 420 : 220);
              if (a) zoomPunch(boss ? 1.08 : 1.03, a.x, a.cy, boss ? 600 : 300);
            } else {
              flash("#FF2D46", 0.3, 400);
              hurtVignette();
              shake(10, 420);
            }
            pushLog(`${unitName(event.unitId)} 倒下了！`, "kill");

            // 倒下動畫播完就從場上移除（不能只是變透明，屍體會擋到後面的怪）
            later((boss ? 900 : DEATH_MS) + 20, () => {
              setState((prev) => ({ ...prev, onField: { ...prev.onField, [event.unitId]: false } }));
            });
          });
          break;
        }

        case "heal": {
          later(IMPACT_MS + DEATH_MS - 200, () => {
            setState((prev) => ({ ...prev, hp: { ...prev.hp, [event.unitId]: event.hpAfter } }));
            const a = anchorsRef.current[event.unitId];
            if (a && fx) fx.heal(a.x, a.cy, a.size);
            if (a) spawnText(a.x + 18, a.headY - 14, `+${event.amount}`, "heal", { dx: 6 });
            pushLog(`${unitName(event.unitId)} 回復 ${event.amount}`, "heal");
          });
          break;
        }

        case "end": {
          const won = event.winner === "player";
          later(IMPACT_MS + DEATH_MS + 200, () => {
            keyRef.current += 1;
            setBanner({ kind: result.timedOut ? "timeup" : won ? "win" : "lose", key: keyRef.current });
            if (!won) setLost(true);
            if (won) flash("#FFFFFF", 0.35, 360);
            pushLog(won ? "戰鬥勝利！" : "戰鬥失敗……", "end");
          });
          later(IMPACT_MS + DEATH_MS + 200 + FINISH_BANNER_MS, () => finish(event.winner, false));
          break;
        }
      }
    },
    [
      art,
      bossIntro,
      enemySlots,
      finish,
      flash,
      holdTimeline,
      hurtVignette,
      isBossUnit,
      later,
      nextTextOffset,
      playerSlots,
      pushLog,
      result.timedOut,
      shake,
      spawnText,
      unitById,
      unitName,
      visualById,
      zoomPunch,
    ],
  );

  // ---- 主迴圈：推進時間游標，把到期的事件演出來 ----
  // 用 ref 存 applyEvent，避免它的依賴變動時整個迴圈重啟（重啟會讓
  // lastTs 歸零、時間游標跳一下）
  const applyRef = useRef(applyEvent);
  useEffect(() => {
    applyRef.current = applyEvent;
  }, [applyEvent]);

  useEffect(() => {
    if (size.w === 0) return; // 版面還沒量好，站位算不出來
    // 開場橫幅：先把游標停住，t=0 的登場事件照樣在第一幀播
    keyRef.current += 1;
    setBanner({ kind: "start", key: keyRef.current, title });
    holdTimeline(START_BANNER_MS);
    later(START_BANNER_MS, () => setBanner((b) => (b?.kind === "start" ? null : b)));

    let lastTs: number | null = null;
    function frame(ts: number) {
      if (lastTs === null) lastTs = ts;
      const dt = ((ts - lastTs) / 1000) * speedRef.current;
      lastTs = ts;
      if (performance.now() >= pauseUntilRef.current) {
        elapsedRef.current += Math.min(dt, 0.1);
      }
      const events = result.events;
      // 一幀可能跨過好幾個事件（×2 或掉幀時），要一次補完。
      // 但遇到「會把游標停住」的事件就先停，下一幀再繼續。
      while (eventIndexRef.current < events.length && events[eventIndexRef.current].t <= elapsedRef.current) {
        applyRef.current(events[eventIndexRef.current]);
        eventIndexRef.current += 1;
        if (performance.now() < pauseUntilRef.current) break;
      }
      if (eventIndexRef.current >= events.length) {
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // 只在版面第一次量好時啟動一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w > 0]);

  function handleSurrender() {
    stoppedRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current.clear();
    finish("enemy", true);
  }

  // 日誌永遠捲到最新一行
  useEffect(() => {
    if (logOpen) logBottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs, logOpen]);

  // ============================================================
  // HUD 的資料
  // ============================================================

  const playerHp = playerUnits.reduce((s, u) => s + (state.hp[u.id] ?? 0), 0);
  const playerMax = playerUnits.reduce((s, u) => s + u.maxHp, 0);

  // 探險：目前場上那一隻（含正在倒下的）；戰隊：全隊加總
  // 兩隻怪之間的空檔（上一隻剛倒、下一隻還沒進場）繼續顯示剛倒下
  // 那一隻（血條 0），不要閃成空白或跳出不相干的頭像
  const currentEnemy =
    enemyUnits.find((u) => state.onField[u.id] && state.alive[u.id]) ??
    enemyUnits.find((u) => state.onField[u.id]) ??
    (defeated > 0 ? enemyUnits[Math.min(defeated, enemyUnits.length) - 1] : null) ??
    enemyUnits[0] ??
    null;
  const enemyHp = isWaveMode
    ? currentEnemy
      ? state.hp[currentEnemy.id] ?? 0
      : 0
    : enemyUnits.reduce((s, u) => s + (state.hp[u.id] ?? 0), 0);
  const enemyMax = isWaveMode ? currentEnemy?.maxHp ?? 1 : enemyUnits.reduce((s, u) => s + u.maxHp, 0);
  const enemyIsBoss = Boolean(currentEnemy && isBossUnit(currentEnemy.id) && isWaveMode);

  const resolvedPlayerLabel = playerLabel ?? (playerUnits.length === 1 ? playerUnits[0].name : "我方");
  const resolvedEnemyLabel =
    enemyLabel ?? (isWaveMode ? currentEnemy?.name ?? "……" : enemyUnits.length === 1 ? enemyUnits[0].name : "敵方");

  const playerPortrait = visualById[playerUnits[0]?.id];
  const enemyPortrait = visualById[(isWaveMode ? currentEnemy?.id : enemyUnits[0]?.id) ?? ""];

  const fieldUnits = allUnits
    .filter((u) => state.onField[u.id] && anchors[u.id])
    .sort((a, b) => anchors[a.id].feetY - anchors[b.id].feetY);

  return (
    <div
      className="rounded-[26px] p-[3px] shadow-[0_14px_40px_rgba(0,0,0,0.45)]"
      style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 60%,#F5C542 100%)" }}
    >
      <div className="overflow-hidden rounded-[23px] bg-[#0B0A18]">
        <div ref={frameRef} className="relative w-full select-none" style={{ height: size.h || 300, touchAction: "manipulation" }}>
          {/* ---- 世界（會被鏡頭推近、震動） ---- */}
          <div ref={zoomRef} className="absolute inset-0">
            <div ref={shakeRef} className="absolute inset-0">
              <div
                className="absolute inset-0 transition-[filter] duration-700"
                style={{ filter: lost ? "grayscale(0.85) brightness(0.6)" : undefined }}
              >
                <BattleBackdrop tower={tower} />

                {/* 單位 */}
                {fieldUnits.map((unit) => {
                  const a = anchors[unit.id];
                  const visual = visualById[unit.id];
                  const alive = state.alive[unit.id] ?? true;
                  const hpPct = Math.max(0, Math.min(100, ((state.hp[unit.id] ?? 0) / unit.maxHp) * 100));
                  const isPlayer = unit.side === "player";
                  const boss = isBossUnit(unit.id);
                  return (
                    <div
                      key={unit.id}
                      ref={outerRefFor(unit.id)}
                      className="absolute"
                      style={{
                        left: a.x - a.size / 2,
                        top: a.feetY - a.size * 0.95,
                        width: a.size,
                        height: a.size,
                        zIndex: Math.round(a.feetY),
                      }}
                    >
                      {/* 地上的影子 */}
                      <div
                        className="pointer-events-none absolute"
                        style={{
                          left: a.size * 0.14,
                          width: a.size * 0.72,
                          top: a.size * 0.95 - a.size * 0.07,
                          height: a.size * 0.14,
                          borderRadius: "50%",
                          background: "radial-gradient(closest-side, rgba(0,0,0,0.55), rgba(0,0,0,0))",
                          opacity: alive ? 1 : 0,
                          transition: "opacity 300ms",
                        }}
                      />
                      {isPlayer && alive ? <MagicCircle color={getJobColor(visual?.jobId)} size={a.size} /> : null}
                      {boss && alive ? <MagicCircle color="#FF2D46" size={a.size} gold={false} /> : null}
                      {/* 戰隊對戰：對手也是小雞，腳下給一圈紅色陣，一眼分得出敵我 */}
                      {!isPlayer && !visual?.monster && alive ? <MagicCircle color="#FF4D5E" size={a.size} gold={false} /> : null}

                      {/* 頭上的小血條（混戰時才分得出誰快倒了） */}
                      {alive ? (
                        <div
                          className="pointer-events-none absolute overflow-hidden rounded-full"
                          style={{
                            left: a.size * 0.2,
                            width: a.size * 0.6,
                            top: a.headY - (a.feetY - a.size * 0.95) - 12,
                            height: 5,
                            background: "rgba(0,0,0,0.6)",
                            boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
                          }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${hpPct}%`,
                              background: isPlayer ? "linear-gradient(90deg,#3DDB84,#B8FF9A)" : "linear-gradient(90deg,#B0102A,#FF4D5E)",
                              transition: "width 160ms ease-out",
                            }}
                          />
                        </div>
                      ) : null}

                      <div ref={midRefFor(unit.id)} className="absolute inset-0" style={{ transformOrigin: "50% 95%" }}>
                        <div
                          className="unit-idle absolute inset-0 flex items-end justify-center"
                          style={{ animationDelay: `${(unit.id.charCodeAt(unit.id.length - 1) % 7) * -0.23}s` }}
                        >
                          {visual?.monster ? (
                            <MonsterArt
                              tower={visual.monster.tower}
                              archetype={visual.monster.archetype}
                              isBoss={visual.monster.isBoss}
                              size={a.size}
                            />
                          ) : (
                            <PetSprite jobId={visual?.jobId} emoji={visual?.emoji} size={a.size * 0.94} flip={!isPlayer} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 粒子 */}
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 900 }} />
              {/* 飄字 */}
              <div ref={textLayerRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 950, isolation: "isolate" }} />
            </div>
          </div>

          {/* ---- 畫面效果 ---- */}
          <div ref={flashRef} className="pointer-events-none absolute inset-0 opacity-0" style={{ zIndex: 960 }} />
          <div
            ref={hurtRef}
            className="pointer-events-none absolute inset-0 opacity-0"
            style={{ zIndex: 961, background: "radial-gradient(ellipse at center, rgba(255,0,40,0) 55%, rgba(255,20,50,0.55) 100%)" }}
          />

          {/* ---- HUD：上方對戰血條 ---- */}
          <div
            className="absolute inset-x-0 top-0 px-2.5 pb-4 pt-2"
            style={{ zIndex: 970, background: "linear-gradient(180deg, rgba(5,5,16,0.78) 0%, rgba(5,5,16,0.35) 70%, rgba(5,5,16,0) 100%)" }}
          >
            <div className="flex items-center gap-1.5">
              <Portrait visual={playerPortrait} side="player" size={34} />
              <VersusBar side="player" label={resolvedPlayerLabel} hp={playerHp} maxHp={playerMax} isBoss={false} />
              <div
                className="font-display relative mx-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[13px] text-[#2A1A05]"
                style={{
                  background: "radial-gradient(circle at 35% 30%, #FFF6CC 0%, #F5C542 45%, #A8740F 100%)",
                  boxShadow: "0 0 0 1.5px #2A1A05, 0 0 12px rgba(245,197,66,0.65)",
                }}
              >
                VS
              </div>
              <VersusBar side="enemy" label={resolvedEnemyLabel} hp={enemyHp} maxHp={enemyMax} isBoss={enemyIsBoss} />
              <Portrait visual={enemyPortrait} side="enemy" size={34} />
            </div>
          </div>

          {/* ---- HUD：下方波次＋控制 ---- */}
          <div
            className="absolute inset-x-0 bottom-0 flex items-end gap-2 px-2.5 pb-2 pt-6"
            style={{ zIndex: 970, background: "linear-gradient(0deg, rgba(5,5,16,0.72) 0%, rgba(5,5,16,0) 100%)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black text-white/90" style={{ textShadow: "0 1px 0 #000" }}>
                {isWaveMode ? "討伐進度" : "擊倒"}
                <span className="font-display ml-1.5 text-[12px] text-[#FFD84B]">
                  {defeated} / {enemyUnits.length}
                </span>
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-[3px]">
                {enemyUnits.map((u, i) => {
                  const done = i < defeated;
                  const boss = isBossUnit(u.id);
                  const current = !done && currentEnemy?.id === u.id;
                  return (
                    <span
                      key={u.id}
                      className="block rotate-45"
                      style={{
                        width: boss ? 9 : 6,
                        height: boss ? 9 : 6,
                        background: done ? (boss ? "#FF4D5E" : "#FFD84B") : boss ? "rgba(255,77,94,0.25)" : "rgba(255,255,255,0.18)",
                        boxShadow: current ? "0 0 0 1.5px #FFFFFF, 0 0 6px #FFFFFF" : done ? "0 0 6px rgba(255,216,75,0.8)" : undefined,
                        transition: "background 300ms, box-shadow 300ms",
                      }}
                    />
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSpeed(speed === 1 ? 2 : 1)}
              aria-label={`播放速度 ${speed} 倍，點一下切換`}
              className="font-display h-8 min-w-[44px] rounded-full px-3 text-[13px] text-[#2A1A05] shadow-[0_2px_0_#6E4A08] transition-transform active:translate-y-[1px] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              style={{ background: speed === 2 ? "linear-gradient(180deg,#FFF6CC,#F5C542)" : "linear-gradient(180deg,#FFFFFF,#D9D4C4)" }}
            >
              ×{speed}
            </button>
            <button
              type="button"
              onClick={handleSurrender}
              className="h-8 rounded-full bg-black/45 px-3 text-[11px] font-black text-white/80 ring-1 ring-white/20 transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              投降
            </button>
          </div>

          {/* ---- 演出橫幅 ---- */}
          {banner ? <BattleBanner banner={banner} /> : null}
        </div>

        {/* ---- 戰鬥日誌：平常只顯示最新兩行，點開看完整 ---- */}
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          className="block w-full border-t border-white/10 bg-[#0B0A18] px-3 py-1.5 text-left"
          aria-expanded={logOpen}
        >
          <div className={["overflow-y-auto transition-[max-height] duration-300", logOpen ? "max-h-40" : "max-h-[30px]"].join(" ")}>
            {(logOpen ? logs : logs.slice(-2)).map((line, i, arr) => (
              <p
                key={line.key}
                className="truncate text-[10.5px] leading-[15px]"
                style={{
                  color:
                    line.tone === "crit"
                      ? "#FFD84B"
                      : line.tone === "kill"
                        ? "#FF9A6A"
                        : line.tone === "heal"
                          ? "#7FE8A8"
                          : line.tone === "end"
                            ? "#FFFFFF"
                            : "rgba(255,255,255,0.6)",
                  opacity: !logOpen && i < arr.length - 1 ? 0.55 : 1,
                }}
              >
                {line.text}
              </p>
            ))}
            {logs.length === 0 ? <p className="text-[10.5px] leading-[15px] text-white/35">戰鬥紀錄會出現在這裡</p> : null}
            <div ref={logBottomRef} />
          </div>
        </button>
      </div>
    </div>
  );
}

/** 刀光顏色：太暗的職業色（例如防禦藍）在暗背景上看不到，往白色拉一點 */
function mixSlashColor(hex: string): string {
  const clean = hex.replace("#", "");
  const n = parseInt(clean.slice(0, 6), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const k = 0.45;
  const mix = (v: number) => Math.round(v + (255 - v) * k);
  return `#${[mix(r), mix(g), mix(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ============================================================
// 演出橫幅
// ============================================================

function BattleBanner({ banner }: { banner: Banner }) {
  switch (banner.kind) {
    case "start":
      return (
        <div key={banner.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 980 }}>
          <div className="banner-band absolute inset-x-0 h-[76px]" />
          <div className="relative text-center">
            <span className="fx-text font-display banner-start-text text-[38px]" data-text="BATTLE START" style={fxVars("linear-gradient(180deg,#FFFFFF 15%,#FFE07A 60%,#FF9A1F 100%)", 7, "#2A1200")}>
              BATTLE START
            </span>
            {banner.title ? (
              <p className="banner-sub mt-1 text-[12px] font-black tracking-[0.2em] text-white" style={{ textShadow: "0 1px 0 #000, 0 0 8px rgba(0,0,0,0.8)" }}>
                {banner.title}
              </p>
            ) : null}
          </div>
        </div>
      );

    case "boss":
      return (
        <div key={banner.key} className="boss-overlay pointer-events-none absolute inset-0" style={{ zIndex: 980 }}>
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(60,0,10,0.25) 30%, rgba(80,0,15,0.85) 100%)" }} />
          {/* 上下兩條警示斜紋帶，文字往相反方向跑 */}
          {(["top", "bottom"] as const).map((pos) => (
            <div key={pos} className="boss-hazard-wrap absolute inset-x-0 h-[26px] overflow-hidden" style={{ [pos]: pos === "top" ? 52 : 50 }}>
              <div className="boss-hazard absolute inset-0 opacity-90" />
              <div className={["boss-marquee absolute inset-y-0 flex w-[200%] items-center", pos === "bottom" ? "reverse" : ""].join(" ")}>
                {Array.from({ length: 12 }, (_, i) => (
                  <span key={i} className="font-display mx-3 text-[14px] text-white" style={{ textShadow: "0 0 6px #FF2D46, 0 1px 0 #000" }}>
                    WARNING
                  </span>
                ))}
              </div>
            </div>
          ))}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="boss-title fx-text font-display text-[64px] leading-none" data-text="BOSS" style={fxVars("linear-gradient(180deg,#FFFFFF 5%,#FF9AA6 40%,#FF2D46 70%,#7A0010 100%)", 9, "#1A0004")}>
              BOSS
            </span>
            <div className="boss-name mt-2 rounded-full px-5 py-1" style={{ background: "linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,0.75) 20%, rgba(0,0,0,0.75) 80%, rgba(0,0,0,0))" }}>
              <span className="fx-text text-[18px] font-black" data-text={banner.title ?? ""} style={fxVars("linear-gradient(180deg,#FFFFFF 20%,#FFD84B 100%)", 5, "#2A0008")}>
                {banner.title}
              </span>
            </div>
          </div>
        </div>
      );

    case "win":
      return (
        <div key={banner.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 980 }}>
          <div className="ko-rays absolute h-[520px] w-[520px]" />
          <span className="ko-text fx-text font-display text-[84px] leading-none" data-text="K.O." style={fxVars("linear-gradient(180deg,#FFFFFF 10%,#FFE07A 50%,#FF8A00 100%)", 10, "#2A1200")}>
            K.O.
          </span>
        </div>
      );

    case "lose":
    case "timeup":
      return (
        <div key={banner.key} className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ zIndex: 980 }}>
          <div className="absolute inset-0 bg-black/35" />
          <span
            className="lose-text fx-text text-[52px] font-black leading-none"
            data-text={banner.kind === "timeup" ? "時間到" : "敗北"}
            style={fxVars("linear-gradient(180deg,#E8E8F0 10%,#8A8AA0 60%,#4A4A60 100%)", 8, "#0A0A14")}
          >
            {banner.kind === "timeup" ? "時間到" : "敗北"}
          </span>
        </div>
      );
  }
}

/** 特效字的 CSS 變數（漸層、描邊粗細、描邊色） */
function fxVars(fill: string, stroke: number, strokeColor: string): React.CSSProperties {
  return {
    ["--fx-fill" as string]: fill,
    ["--fx-stroke" as string]: `${stroke}px`,
    ["--fx-stroke-color" as string]: strokeColor,
  } as React.CSSProperties;
}
