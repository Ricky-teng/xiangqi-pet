// src/components/battle/BattleStage.tsx
"use client";

/**
 * 戰鬥播放器 2.0（探險與戰隊共用）
 * ------------------------------------------------------------
 * 這個元件「只負責播放」，完全不做任何戰鬥判定。
 *
 * 戰鬥判定全部在 lib/rpg/battle.ts 的 BattleEngine。播放器推進一個時間
 * 游標，每一幀叫引擎「結算到現在」，再把新冒出來的事件演出來。所以：
 *   - ×1 / ×2 只是游標跑得快一倍
 *   - 演出時的「暫停」（開場橫幅、Boss 登場、爆擊頓幀）只是把游標停住，
 *     引擎也跟著停，不會偷跑
 *   - 手動放技能：按鈕 → engine.castSkill(單位, 目前游標)，在那一刻放出去
 *   - 中途投降是直接以失敗結束，不再推進引擎
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
 * 爆擊另外加：金色雙刀光、頓幀 80ms、鏡頭推近、金色閃光。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getJobColor } from "@/lib/rpg/jobVisual";
import type { MonsterArchetype } from "@/lib/rpg/monsters";
import type { BattleEngine, BattleEvent, BattleResult, BattleSide, BattleUnit, BuffStat } from "@/lib/rpg/battle";
import { getSkill, getSkillEffect } from "@/lib/rpg/skills";
import SkillIcon from "@/components/rpg/SkillIcon";
import { playSfx, type SfxName } from "@/lib/sound/sfx";
import ChickRig, { RIG_BODY, RIG_VIEWBOX, type ChickRigHandle } from "@/components/pet/rig/ChickRig";
import { getRigJob } from "@/components/pet/rig/jobs/index";
import { SKILL_HOLD_MS, getCasterPose, playSkillFx } from "@/components/battle/skillfx/skillFx";
import { chomp, type FxKit, type StageAnchor } from "@/components/battle/skillfx/stageFx";
import { useBattleArtMode } from "@/lib/settings/battleArt";
import MonsterArt from "@/components/battle/MonsterArt";
import PetArt from "@/components/rpg/PetArt";
import BattleBackdrop, { HORIZON_RATIO } from "@/components/battle/BattleBackdrop";
import { FxEngine, detectFxQuality } from "@/components/battle/fxEngine";
import { getTowerArt } from "@/components/battle/towerArt";
import type { ArmorType, EquipmentItem, WeaponType } from "@/lib/rpg/equipment";

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
  /** 武器／防具種類：換刀光樣式、閃避與反傷特效 */
  weaponType?: WeaponType | null;
  armorType?: ArmorType | null;
  /** 實際的裝備（骨架小雞畫在手上、身上用：階級顏色、寶石） */
  weapon?: EquipmentItem | null;
  armor?: EquipmentItem | null;
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
  /** 戰鬥引擎（呼叫端 new 好傳進來；這個元件負責推進它） */
  engine: BattleEngine;
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
  onFinish: (outcome: { winner: BattleSide; surrendered: boolean; result: BattleResult }) => void;
}

interface RuntimeState {
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  onField: Record<string, boolean>;
  /** 護盾剩多少（月光石開場護盾） */
  shield: Record<string, number>;
  /** 護盾一開始有多少（畫泡泡的透明度用） */
  shieldMax: Record<string, number>;
  /** 正在暈 */
  stunned: Record<string, boolean>;
  /** 正在燒（身上冒火） */
  burning: Record<string, boolean>;
  /** 身上的增益（頭上的小圖示） */
  buffs: Record<string, BuffStat[]>;
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
/** 骨架小雞的倒下動作（往後倒、彈一下、躺著轉星星） */
const RIG_DOWN_MS = 1900;
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
  // 技能名（中文）
  skill: { size: 17, fill: "linear-gradient(180deg,#FFFFFF 10%,#BFE9FF 55%,#7FB8FF 100%)", stroke: 5, strokeColor: "#0A1A40", dur: 1100 },
  // 燃燒
  burn: { size: 18, fill: "linear-gradient(180deg,#FFF3C8 15%,#FF8A3D 100%)", stroke: 5, strokeColor: "#3A0E00", dur: 800 },
  // 被閃掉
  miss: { size: 20, fill: "linear-gradient(180deg,#FFFFFF 20%,#B9C4D6 100%)", stroke: 5, strokeColor: "#1A2236", dur: 850 },
  // 打在護盾上（吸收量）
  shield: { size: 20, fill: "linear-gradient(180deg,#F2FBFF 20%,#7FD3FF 100%)", stroke: 5, strokeColor: "#062A40", dur: 900 },
  // 爆擊
  crit: { size: 36, fill: "linear-gradient(180deg,#FFFBE0 10%,#FFC93D 55%,#FF7A00 100%)", stroke: 7, strokeColor: "#4A1200", dur: 1150 },
  heal: { size: 22, fill: "linear-gradient(180deg,#F0FFF6 20%,#3DDB84 100%)", stroke: 6, strokeColor: "#053A1C", dur: 1100 },
  // 「爆擊！」「先攻！」「擊破！」這種中文標籤
  label: { size: 15, fill: "linear-gradient(180deg,#FFFBE0 10%,#FFC93D 100%)", stroke: 5, strokeColor: "#4A1200", dur: 1000 },
  kill: { size: 26, fill: "linear-gradient(180deg,#FFFFFF 10%,#FFE07A 50%,#FF9A1F 100%)", stroke: 7, strokeColor: "#3A1500", dur: 1100 },
} as const;
type TextStyle = keyof typeof TEXT_STYLES;

/** 增益圖示的顏色 */
const BUFF_COLORS: Record<BuffStat, string> = { attack: "#FF7A5C", speed: "#7FE8A8", guard: "#C9D3E0" };
const BUFF_GLYPH: Record<BuffStat, string> = { attack: "攻", speed: "速", guard: "防" };

/** 我方 AUTO 開關記在這台裝置（預設開） */
const AUTO_KEY = "xq-battle-auto";
/** 攻擊動畫的樣式：小雞看武器種類，怪物一律爪擊 */
type AttackStyle = WeaponType | "claw";

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
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

/**
 * 骨架小雞（SVG 模式）：把 ChickRig 擺到單位格子裡，腳底對齊。
 * size = 格子的邊長；小雞本體高度約佔 0.92。
 */
function RigSprite({
  size,
  flip,
  jobId,
  weapon,
  armor,
  rigRef,
  texture,
}: {
  texture: boolean;
  size: number;
  flip: boolean;
  jobId: string | null;
  weapon: EquipmentItem | null;
  armor: EquipmentItem | null;
  rigRef: (h: ChickRigHandle | null) => void;
}) {
  const body = size * 0.92;
  const vb = RIG_VIEWBOX;
  const h = (body * vb.h) / RIG_BODY.height;
  const w = (h * vb.w) / vb.h;
  const fx = (RIG_BODY.cx - vb.x) / vb.w;
  const fy = (RIG_BODY.feetY - vb.y) / vb.h;
  return (
    <div
      className="pointer-events-none absolute"
      style={{ left: size / 2 - (flip ? 1 - fx : fx) * w, top: size * 0.95 - fy * h, width: w, height: h }}
    >
      <ChickRig ref={rigRef} job={getRigJob(jobId)} weapon={weapon} armor={armor} size={body} flip={flip} texture={texture} />
    </div>
  );
}

/** 燃燒中的單位身上冒的火（CSS 動畫，跟著單位走） */
function BurningFlames({ size }: { size: number }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[0.3, 0.5, 0.7, 0.42, 0.6].map((fx, i) => (
        <span
          key={i}
          className="burn-flame absolute block"
          style={{
            left: size * fx - size * 0.08,
            top: size * (0.45 + (i % 2) * 0.18),
            width: size * 0.16,
            height: size * 0.26,
            animationDelay: `${i * 0.13}s`,
          }}
        />
      ))}
    </div>
  );
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
  engine,
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

  // 幾人陣型：探險的怪一隻一隻上（敵方 1 格），戰隊全部同時在場
  const playerSlots = Math.max(1, Math.min(3, playerUnits.length));
  const enemySlots = engine.mode === "sequential" ? 1 : Math.max(1, Math.min(3, enemyUnits.length));
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
    return { hp, alive, onField, shield: {}, shieldMax: {}, stunned: {}, buffs: {}, burning: {} };
  }, [allUnits]);

  const [state, setState] = useState<RuntimeState>(initialState);
  const [speed, setSpeed] = useState<BattleSpeed>(1);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [defeated, setDefeated] = useState(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [lost, setLost] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** 放技能時畫面一側滑過的技能名橫條 */
  const [skillCut, setSkillCut] = useState<{ key: number; name: string; color: string; side: BattleSide; boosted: boolean } | null>(null);
  /** 我方是不是自動放技能 */
  const [auto, setAuto] = useState(true);
  /** 手動模式下每 0.1 秒更新一次「游標現在幾秒」，技能鈕的冷卻圈靠這個重畫 */
  const [nowSim, setNowSim] = useState(0);
  const hasPlayerSkill = playerUnits.some((u) => u.skill);
  /** 戰鬥畫面的小雞：SVG（會動）或原圖 */
  const [artMode, setArtMode] = useBattleArtMode();
  /** 省電模式（偵測到卡頓）：骨架小雞關掉手繪質感濾鏡 */
  const [lite, setLite] = useState(false);

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
  /** 每個攻擊者最近打的是誰（吸血的光點要從那隻飛回來） */
  const lastTargetRef = useRef(new Map<string, string>());
  /** 暈、增益什麼時候結束（performance.now 的時間）：被刷新過就不要提早拿掉 */
  const stunUntilRef = useRef(new Map<string, number>());
  const buffUntilRef = useRef(new Map<string, number>());
  /** 最近一下打在這隻身上的延遲（連打技能用） */
  const hitDelayRef = useRef(new Map<string, number>());
  /** 骨架小雞（SVG 模式才有） */
  const rigRefs = useRef(new Map<string, ChickRigHandle>());
  const rigRefCache = useRef(new Map<string, (h: ChickRigHandle | null) => void>());
  const rigRefFor = useCallback((id: string) => {
    let fn = rigRefCache.current.get(id);
    if (!fn) {
      fn = (h: ChickRigHandle | null) => {
        if (h) rigRefs.current.set(id, h);
        else rigRefs.current.delete(id);
      };
      rigRefCache.current.set(id, fn);
    }
    return fn;
  }, []);
  /** 技能特效疊層（戰場座標的 SVG）、技能特寫時壓暗畫面的那一層 */
  const skillLayerRef = useRef<SVGSVGElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const burnUntilRef = useRef(new Map<string, number>());
  /** 卡頓偵測：連續掉幀就切到省電特效 */
  const liteRef = useRef(false);
  const slowFramesRef = useRef(0);
  const entranceRef = useRef(new Map<string, Entrance>());
  const anchorsRef = useRef<Record<string, Anchor>>({});
  const textSlotRef = useRef<Record<string, number>>({});

  const eventIndexRef = useRef(0);
  const elapsedRef = useRef(0);
  const pauseUntilRef = useRef(0);
  /** 技能特寫期間：連同一時間點的事件也先不處理（傷害數字要等演出完） */
  const skillPauseUntilRef = useRef(0);
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

  // AUTO：讀上次的選擇（掛上去之後才讀，避免 SSR 不一致）
  useEffect(() => {
    try {
      if (window.localStorage.getItem(AUTO_KEY) === "0") setAuto(false);
    } catch {
      // 讀不到就維持預設的自動
    }
  }, []);

  useEffect(() => {
    engine.setPlayerAuto(auto);
    if (auto) return;
    const id = window.setInterval(() => setNowSim(elapsedRef.current), 100);
    return () => window.clearInterval(id);
  }, [auto, engine]);

  function toggleAuto() {
    const next = !auto;
    setAuto(next);
    setNowSim(elapsedRef.current);
    try {
      window.localStorage.setItem(AUTO_KEY, next ? "1" : "0");
    } catch {
      // 存不了就只有這場有效
    }
  }

  function handleCast(unitId: string) {
    if (finishedRef.current || stoppedRef.current) return;
    const ok = engine.castSkill(unitId, elapsedRef.current);
    if (!ok) playSfx("error");
    setNowSim(elapsedRef.current);
  }

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
      const chinese = style === "label" || style === "skill";
      y = Math.max(y, chinese ? 116 : 140);
      const el = document.createElement("span");
      el.className = chinese ? "fx-text" : "fx-text font-display";
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
      onFinish({ winner, surrendered, result: engine.getResult() });
    },
    [engine, onFinish],
  );

  const bossIntro = useCallback(
    (unitId: string, delayMs: number) => {
      holdTimeline(delayMs + BOSS_INTRO_MS);
      later(delayMs, () => {
        keyRef.current += 1;
        setBanner({ kind: "boss", key: keyRef.current, title: unitName(unitId) });
        flash("#FF2D46", 0.25, 500);
        playSfx("bossRoar");
      });
      later(delayMs + 1500, () => {
        entranceRef.current.set(unitId, "drop");
        setState((prev) => ({ ...prev, onField: { ...prev.onField, [unitId]: true } }));
      });
      later(delayMs + BOSS_INTRO_MS - 200, () => setBanner((b) => (b?.kind === "boss" ? null : b)));
    },
    [flash, holdTimeline, later, unitName],
  );

  /** 技能特效要用的工具箱 */
  const makeKit = useCallback((): FxKit | null => {
    const layer = skillLayerRef.current;
    if (!layer) return null;
    return {
      layer,
      fx: fxRef.current,
      speed: speedRef.current,
      shake,
      flash,
      sfx: (name: string) => playSfx(name as SfxName),
      lite: liteRef.current,
    };
  }, [flash, shake]);

  /**
   * 技能特寫：畫面變暗、鏡頭推近施放者跟目標之間、參與的單位浮到暗幕上面。
   * 長度跟 SKILL_HOLD_MS 對齊（演出期間時間軸是停住的）。
   */
  const cinematic = useCallback(
    (ids: string[], focus: { x: number; y: number }) => {
      const sp = speedRef.current;
      const total = (SKILL_HOLD_MS + 260) / sp;
      dimRef.current?.animate(
        [
          { opacity: 0 },
          { opacity: 0.78, offset: 0.12 },
          { opacity: 0.78, offset: 0.8 },
          { opacity: 0 },
        ],
        { duration: total, easing: "ease-in-out" },
      );
      for (const id of ids) {
        const outer = outerEls.current.get(id);
        if (!outer) continue;
        const before = outer.style.zIndex;
        outer.style.zIndex = String(700 + Number(before || 0) / 1000);
        window.setTimeout(() => {
          outer.style.zIndex = before;
        }, total);
      }
      const z = zoomRef.current;
      if (z && !reduceMotion) {
        z.style.transformOrigin = `${focus.x}px ${focus.y}px`;
        z.animate(
          [
            { transform: "scale(1)" },
            { transform: "scale(1.28)", offset: 0.22, easing: "ease-out" },
            { transform: "scale(1.24)", offset: 0.7 },
            { transform: "scale(1.06)", offset: 0.9 },
            { transform: "scale(1)" },
          ],
          { duration: total, easing: "ease-in-out" },
        );
      }
    },
    [reduceMotion],
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
          const crit = event.crit;
          // 技能造成的傷害：連打、全體的第 2 下之後不再衝刺，命中時間往後錯開
          const skillDef = event.skillId ? getSkill(event.skillId) : null;
          const skillEff = event.skillId ? getSkillEffect(event.skillId, false) : null;
          const aoeSkill = skillEff?.kind === "strike" && Boolean(skillEff.aoe);
          const hitDelay = (event.hitIndex ?? 0) * 110;
          // 技能的位移、出招都在 skill 事件的特寫裡演完了，這裡只演命中
          const doLunge = !skillDef;
          const attackerVisual = visualById[event.attackerId];
          // 攻擊方式：怪物用爪子，小雞看手上的武器種類
          const style: AttackStyle = attackerVisual?.monster ? "claw" : (attackerVisual?.weaponType ?? "sword");
          const jobColor = getJobColor(attackerVisual?.jobId);
          lastTargetRef.current.set(event.attackerId, event.targetId);
          hitDelayRef.current.set(event.targetId, hitDelay);

          // ---- 攻擊者動作 ----
          const outer = outerEls.current.get(event.attackerId);
          // 怪物的出招動作（依體型）：血牛型頭槌、攻擊型飛撲咬、均衡型揮爪、Boss 大力蓄力
          const monster = attackerVisual?.monster;
          if (monster && doLunge) {
            const amid = midEls.current.get(event.attackerId);
            const d = dir;
            const frames: Keyframe[] = monster.isBoss
              ? [
                  { transform: "scale(1) rotate(0deg)", filter: "brightness(1)" },
                  { transform: `scale(1.12,0.9) rotate(${-d * 10}deg)`, filter: "brightness(1.4) drop-shadow(0 0 10px #FF2D46)", offset: 0.3 },
                  { transform: `scale(0.92,1.12) rotate(${d * 14}deg) translateY(-6%)`, filter: "brightness(1.2)", offset: 0.48 },
                  { transform: "scale(1) rotate(0deg)", filter: "brightness(1)" },
                ]
              : monster.archetype === "tank"
                ? [
                    { transform: "rotate(0deg) scale(1)" },
                    { transform: `rotate(${-d * 14}deg) scale(0.95,1.05)`, offset: 0.3 },
                    { transform: `rotate(${d * 16}deg) scale(1.1,0.92)`, offset: 0.48 },
                    { transform: "rotate(0deg) scale(1)" },
                  ]
                : monster.archetype === "attacker"
                  ? [
                      { transform: "translateY(0) rotate(0deg) scale(1)" },
                      { transform: `translateY(4%) rotate(${-d * 6}deg) scale(1.08,0.9)`, offset: 0.22 },
                      { transform: `translateY(-26%) rotate(${d * 12}deg) scale(0.94,1.08)`, offset: 0.4 },
                      { transform: `translateY(0) rotate(${d * 4}deg) scale(1.08,0.94)`, offset: 0.55 },
                      { transform: "translateY(0) rotate(0deg) scale(1)" },
                    ]
                  : [
                      { transform: "rotate(0deg) scale(1)" },
                      { transform: `rotate(${-d * 18}deg) scale(1.04,0.98)`, offset: 0.28 },
                      { transform: `rotate(${d * 20}deg) scale(1.06,0.96)`, offset: 0.46 },
                      { transform: "rotate(0deg) scale(1)" },
                    ];
            amid?.animate(frames, { duration: LUNGE_MS / speedRef.current, easing: "ease-out" });
            if (monster.archetype === "attacker" && !monster.isBoss) {
              const kit = makeKit();
              if (kit) chomp(kit, T.x, T.cy, T.size, IMPACT_MS - 120);
            }
          }
          if (outer && doLunge) {
            void rigRefs.current.get(event.attackerId)?.play("attack", { speed: 1.2 });
            lungeAnims.current.get(event.attackerId)?.cancel();
            const oneOnOne = playerSlots === 1 && enemySlots === 1;
            const contact = (A.size + T.size) * (style === "spear" ? 0.42 : 0.3);
            const dx = oneOnOne ? T.x - A.x - dir * contact : (T.x - A.x) * (style === "spear" ? 0.34 : 0.42);
            const dy = oneOnOne ? 0 : (T.feetY - A.feetY) * 0.42;
            const hit = IMPACT_MS / LUNGE_MS;
            let frames: Keyframe[];
            if (style === "staff") {
              // 法杖：原地施法，往後一縮再往前一推，不衝過去
              frames = [
                { transform: "translate(0,0)" },
                { transform: `translate(${-dir * A.size * 0.08}px,0) scale(0.96,1.05)`, offset: hit * 0.5 },
                { transform: `translate(${dir * A.size * 0.06}px,0) scale(1.06,0.96)`, offset: hit },
                { transform: "translate(0,0)" },
              ];
            } else if (style === "axe") {
              // 斧：蓄力往後拉大一點，砸下去壓扁
              frames = [
                { transform: "translate(0,0)" },
                { transform: `translate(${-dir * A.size * 0.16}px,${-A.size * 0.06}px) scale(0.92,1.1)`, offset: 0.24 },
                { transform: `translate(${dx}px,${dy}px) scale(1.14,0.88)`, offset: hit },
                { transform: `translate(${dx * 0.97}px,${dy * 0.97}px)`, offset: 0.66 },
                { transform: "translate(0,0)" },
              ];
            } else if (style === "spear") {
              // 長槍：拉長身體直直刺出去
              frames = [
                { transform: "translate(0,0)" },
                { transform: `translate(${-dir * A.size * 0.12}px,0) scale(0.92,1.04)`, offset: 0.22 },
                { transform: `translate(${dx}px,${dy}px) scale(1.16,0.92)`, offset: hit },
                { transform: `translate(${dx * 0.9}px,${dy * 0.9}px)`, offset: 0.6 },
                { transform: "translate(0,0)" },
              ];
            } else {
              frames = [
                { transform: "translate(0,0)" },
                { transform: `translate(${-dir * A.size * 0.1}px,0) scale(0.94,1.06)`, offset: 0.2 },
                { transform: `translate(${dx}px,${dy}px) scale(1.08,0.94)`, offset: hit },
                { transform: `translate(${dx * 0.96}px,${dy * 0.96}px)`, offset: 0.62 },
                { transform: "translate(0,0)" },
              ];
            }
            const anim = outer.animate(frames, { duration: LUNGE_MS / speedRef.current, easing: "cubic-bezier(.3,.7,.3,1)" });
            lungeAnims.current.set(event.attackerId, anim);
          }

          if (!doLunge) {
            // 技能的後續段數／全體攻擊：不衝刺，直接在目標身上炸開
          } else if (style === "staff") {
            // 法杖：從杖頭射出一顆法球
            playSfx("magic");
            later(40, () => {
              const a = anchorsRef.current[event.attackerId];
              const t = anchorsRef.current[event.targetId] ?? T;
              if (a && fx) fx.projectile(a.x + dir * a.size * 0.3, a.cy - a.size * 0.1, t.x, t.cy, jobColor, (IMPACT_MS - 40) / 1000);
            });
          } else {
            later(80, () => {
              const a = anchorsRef.current[event.attackerId];
              if (a && fx) fx.speedLines(a.x, a.cy, dir, a.size, event.firstStrike ? "#FFE58A" : "#FFFFFF");
            });
          }

          // ---- 命中 ----
          later(IMPACT_MS + hitDelay, () => {
            const t = anchorsRef.current[event.targetId] ?? T;
            const targetIsPlayer = target.side === "player";
            const offset = nextTextOffset(event.targetId);

            // 被閃掉：目標往旁邊一閃，沒有傷害
            if (event.dodged) {
              const mid = midEls.current.get(event.targetId);
              mid?.animate(
                [
                  { transform: "translateX(0)", opacity: 1 },
                  { transform: `translateX(${dir * t.size * 0.32}px) skewX(${-dir * 10}deg)`, opacity: 0.55, offset: 0.3 },
                  { transform: `translateX(${dir * t.size * 0.22}px)`, opacity: 0.85, offset: 0.6 },
                  { transform: "translateX(0)", opacity: 1 },
                ],
                { duration: 380 / speedRef.current, easing: "cubic-bezier(.2,.8,.3,1)" },
              );
              if (fx) fx.speedLines(t.x, t.cy, dir, t.size * 0.7, "#DDE6F5");
              spawnText(t.x + offset, t.headY - 14, "閃避", "miss", { dx: offset * 0.5 });
              playSfx("dodge");
              pushLog(`${unitName(event.targetId)} 閃過了 ${unitName(event.attackerId)} 的攻擊`, "normal");
              return;
            }

            setState((prev) => ({
              ...prev,
              hp: { ...prev.hp, [event.targetId]: event.targetHpAfter },
              shield: event.absorbed > 0 ? { ...prev.shield, [event.targetId]: event.targetShieldAfter } : prev.shield,
            }));

            const colors = targetIsPlayer ? ["#FFFFFF", "#FF9A9A", "#FF4D5E"] : art.impactColors;
            const slashColor = mixSlashColor(targetIsPlayer ? "#FF6A7A" : attacker.side === "player" ? jobColor : "#FFFFFF");
            const heavy = crit || style === "axe" || Boolean(skillDef);

            if (fx) {
              fx.impact(t.x, t.cy, { colors, crit: heavy, dir, power: Math.min(1.5, t.size / 90) * (style === "dagger" ? 0.8 : 1) });
              const baseAngle = dir > 0 ? Math.PI * 0.82 : Math.PI * 0.18;
              const sx = t.x - dir * t.size * 0.05;
              switch (style) {
                case "dagger": {
                  // 匕首：兩刀交叉、快
                  fx.slash(sx, t.cy - t.size * 0.06, { angle: baseAngle + rand(-0.15, 0.15), color: slashColor, crit, size: t.size * 0.38 });
                  later(70, () => fx.slash(sx, t.cy + t.size * 0.06, { angle: Math.PI - baseAngle + rand(-0.15, 0.15), color: slashColor, crit, size: t.size * 0.38 }));
                  break;
                }
                case "axe": {
                  // 斧：一刀大的往下劈，腳下一圈震波
                  fx.slash(sx, t.cy, { angle: Math.PI / 2 + dir * 0.35, color: slashColor, crit: true, size: t.size * 0.62 });
                  fx.shockwave(t.x, t.feetY, slashColor, t.size * 0.8);
                  break;
                }
                case "staff": {
                  // 法杖：法球炸開的魔力圈
                  fx.shockwave(t.x, t.cy, jobColor, t.size * 0.7);
                  break;
                }
                case "spear": {
                  // 長槍：一道直線突刺
                  fx.thrust(t.x - dir * t.size * 0.2, t.cy, dir, t.size * 0.9, slashColor);
                  break;
                }
                case "claw": {
                  // 怪物：三道平行爪痕
                  for (let i = -1; i <= 1; i++) {
                    fx.slash(sx + i * t.size * 0.06, t.cy + i * t.size * 0.12, { angle: baseAngle + 0.2, color: slashColor, crit, size: t.size * 0.32 });
                  }
                  break;
                }
                default: {
                  fx.slash(sx, t.cy, { angle: baseAngle + rand(-0.25, 0.25), color: slashColor, crit, size: t.size * 0.48 });
                }
              }
              // 技能：在目標身上再炸一圈技能色
              if (skillDef) {
                fx.shockwave(t.x, aoeSkill ? t.feetY : t.cy, skillDef.color, t.size * (aoeSkill ? 1 : 0.7));
                fx.impact(t.x, t.cy, { colors: [skillDef.color, "#FFFFFF"], crit: true, dir, power: Math.min(1.5, t.size / 90) });
              }
              // 打在護盾上
              if (event.absorbed > 0) fx.shieldHit(t.x, t.cy, t.size, event.targetShieldAfter <= 0);
            }
            if (event.absorbed > 0) playSfx(event.targetShieldAfter <= 0 ? "shieldBreak" : "shieldHit");
            if (skillDef) playSfx(aoeSkill ? "explode" : "skillStrike");
            else playSfx(crit ? "crit" : heavy ? "hitHeavy" : "hit");

            // 暈：頭上轉星星
            if (event.stun) {
              const stunMs = event.stun * 1000;
              setState((prev) => ({ ...prev, stunned: { ...prev.stunned, [event.targetId]: true } }));
              stunUntilRef.current.set(event.targetId, performance.now() + stunMs / speedRef.current);
              later(stunMs, () => {
                if ((stunUntilRef.current.get(event.targetId) ?? 0) > performance.now() + 30) return;
                setState((prev) => ({ ...prev, stunned: { ...prev.stunned, [event.targetId]: false } }));
              });
              spawnText(t.x, t.headY - 58, "暈眩", "label", { dx: 0 });
              playSfx("stun");
            }

            // 骨架小雞：被打的動作（打死的由 death 事件播倒下）
            if (event.targetHpAfter > 0) void rigRefs.current.get(event.targetId)?.play("hurt");

            // 目標閃白後仰
            const mid = midEls.current.get(event.targetId);
            mid?.animate(
              [
                { transform: "translateX(0) scale(1)", filter: "brightness(1)" },
                { transform: `translateX(${dir * t.size * (heavy ? 0.13 : 0.09)}px) scale(0.94,1.04)`, filter: "brightness(2.6) saturate(0.3)", offset: 0.16 },
                { transform: `translateX(${dir * t.size * 0.04}px)`, filter: "brightness(1.2)", offset: 0.45 },
                { transform: "translateX(0) scale(1)", filter: "brightness(1)" },
              ],
              { duration: 300 / speedRef.current, easing: "ease-out" },
            );

            // 飄字：扣血的數字；被護盾吃掉的另外用藍字
            const hpDamage = event.damage - event.absorbed;
            const labels = [event.firstStrike ? "先攻！" : null, crit ? "爆擊！" : null].filter(Boolean).join(" ");
            if (labels) spawnText(t.x + offset, t.headY - 40, labels, "label");
            if (event.absorbed > 0) {
              spawnText(t.x + offset - (hpDamage > 0 ? 34 : 0), t.headY - (hpDamage > 0 ? 44 : 14), `◇${event.absorbed}`, "shield", { dx: offset * 0.5 - 8, scale: hpDamage > 0 ? 0.85 : 1 });
            }
            if (hpDamage > 0) {
              if (crit) spawnText(t.x + offset, t.headY - 14, `${hpDamage}`, "crit", { dx: offset * 0.5 });
              else spawnText(t.x + offset, t.headY - 14, `${hpDamage}`, targetIsPlayer ? "hurt" : "dmg", { dx: offset * 0.5, scale: skillDef ? 1.3 : event.isHigh ? 1.15 : 1 });
            }

            if (crit) {
              holdTimeline(CRIT_HITSTOP_MS);
              shake(7, 320);
              zoomPunch(1.045, t.x, t.cy, 320);
              flash("#FFD84B", 0.22, 200);
            } else if (style === "axe") {
              shake(targetIsPlayer ? 6 : 4.5, 260);
            } else {
              shake(targetIsPlayer ? 4 : 2.5, 220);
            }

            // 我方被打掉一大截血：畫面四周紅一下
            if (targetIsPlayer && hpDamage >= target.maxHp * 0.12) hurtVignette();

            const tags = [skillDef ? skillDef.name : "", event.firstStrike ? "先攻" : "", crit ? "爆擊" : "", event.pierce ? "破甲" : ""].filter(Boolean).join("・");
            pushLog(
              `${unitName(event.attackerId)} → ${unitName(event.targetId)}　${tags ? `${tags} ` : ""}${event.damage}${event.absorbed > 0 ? `（護盾吸收 ${event.absorbed}）` : ""}`,
              crit ? "crit" : "normal",
            );
          });
          break;
        }

        case "thorns": {
          // 刺甲：被打的那隻把傷害扎回攻擊者
          later(IMPACT_MS + 20, () => {
            const s = anchorsRef.current[event.sourceId];
            const a = anchorsRef.current[event.targetId];
            const victim = unitById[event.targetId];
            if (!a || !victim) return;
            setState((prev) => ({
              ...prev,
              hp: { ...prev.hp, [event.targetId]: event.targetHpAfter },
              shield: event.absorbed > 0 ? { ...prev.shield, [event.targetId]: event.targetShieldAfter } : prev.shield,
            }));
            if (fx && s) fx.spikes(s.x, s.cy, a.x >= s.x ? 1 : -1);
            playSfx("thorns");
            if (fx && event.absorbed > 0) fx.shieldHit(a.x, a.cy, a.size, event.targetShieldAfter <= 0);
            const hpDamage = event.damage - event.absorbed;
            const offset = nextTextOffset(event.targetId);
            if (hpDamage > 0) spawnText(a.x + offset, a.headY - 14, `${hpDamage}`, victim.side === "player" ? "hurt" : "dmg", { dx: offset * 0.5, scale: 0.85 });
            if (event.absorbed > 0) spawnText(a.x + offset - 20, a.headY - 30, `◇${event.absorbed}`, "shield", { dx: offset * 0.5 - 8, scale: 0.85 });
            pushLog(`${unitName(event.sourceId)} 的尖刺反彈 ${event.damage} 給 ${unitName(event.targetId)}`, "normal");
          });
          break;
        }

        case "shield": {
          // 月光石開場護盾、技能護盾：套上泡泡。amount 是套完之後的總量
          const apply = () =>
            setState((prev) => ({
              ...prev,
              shield: { ...prev.shield, [event.unitId]: event.amount },
              shieldMax: {
                ...prev.shieldMax,
                [event.unitId]: Math.max(event.amount, (prev.shield[event.unitId] ?? 0) > 0 ? prev.shieldMax[event.unitId] ?? 0 : 0),
              },
            }));
          if (event.t === 0) {
            apply();
            break;
          }
          later(200, () => {
            apply();
            const a = anchorsRef.current[event.unitId];
            if (a && fx) fx.shieldHit(a.x, a.cy, a.size, false);
            playSfx("shieldUp");
          });
          break;
        }

        case "skill": {
          // 放技能：約 1.3 秒的特寫演出（每招專屬動畫見 skillfx/skillFx.ts），
          // 演完才會跳出傷害、回血數字
          const caster = unitById[event.unitId];
          const a = anchorsRef.current[event.unitId];
          if (!caster || !a) break;
          const def = getSkill(event.skillId);
          const boss = isBossUnit(event.unitId);
          const dir: 1 | -1 = caster.side === "player" ? 1 : -1;
          holdTimeline(SKILL_HOLD_MS);
          skillPauseUntilRef.current = performance.now() + SKILL_HOLD_MS / speedRef.current;
          const strike = getSkillEffect(event.skillId, false).kind === "strike";
          const listed = event.targetIds.map((id) => anchorsRef.current[id]).filter((x): x is StageAnchor => Boolean(x));
          const targets = strike ? listed : [];
          const allies = strike ? [a] : listed.length ? listed : [a];
          const focusT = targets[0];
          cinematic([event.unitId, ...event.targetIds], {
            x: focusT ? a.x + (focusT.x - a.x) * 0.35 : a.x,
            y: focusT ? a.cy + (focusT.cy - a.cy) * 0.35 : a.cy,
          });

          spawnText(a.x, a.headY - 46, `${def.name}${event.boosted ? "★" : ""}`, "skill", { dx: 0, scale: 1.15 });
          keyRef.current += 1;
          setSkillCut({ key: keyRef.current, name: def.name, color: def.color, side: caster.side, boosted: event.boosted });
          const cutKey = keyRef.current;
          later(1100, () => setSkillCut((c) => (c?.key === cutKey ? null : c)));
          playSfx("skill");
          pushLog(`${unitName(event.unitId)} 使出「${def.name}」`, "crit");

          const kit = makeKit();
          const rig = rigRefs.current.get(event.unitId);
          const outer = outerEls.current.get(event.unitId);
          const mid = midEls.current.get(event.unitId);
          if (kit) {
            playSkillFx({
              kit,
              skillId: event.skillId,
              boosted: event.boosted,
              boss,
              caster: a,
              dir,
              targets,
              allies,
              moveCaster: (frames, t0, dur) => {
                lungeAnims.current.get(event.unitId)?.cancel();
                const anim = outer?.animate(frames, { duration: dur / speedRef.current, delay: t0 / speedRef.current, easing: "linear" });
                if (anim) lungeAnims.current.set(event.unitId, anim);
              },
              pose: (p) => {
                if (rig) {
                  void rig.play(p, { speed: 1 });
                } else {
                  // 原圖模式／怪物：整張圖發光、蹲下再彈起
                  mid?.animate(
                    [
                      { transform: "scale(1)", filter: "brightness(1)" },
                      { transform: "scale(1.12,0.88)", filter: `brightness(1.6) drop-shadow(0 0 12px ${def.color})`, offset: 0.3 },
                      { transform: "scale(0.92,1.1) translateY(-10%)", filter: `brightness(2) drop-shadow(0 0 16px ${def.color})`, offset: 0.55 },
                      { transform: "scale(1)", filter: "brightness(1)" },
                    ],
                    { duration: 1300 / speedRef.current, easing: "ease-out" },
                  );
                }
              },
              tiltMount: (deg, t0, dur) => {
                if (!rig) return;
                later(t0, () =>
                  rig.animatePart(
                    "mountHead",
                    [
                      { transform: "rotate(0deg)" },
                      { transform: `rotate(${deg}deg)`, offset: 0.3 },
                      { transform: `rotate(${deg}deg)`, offset: 0.7 },
                      { transform: "rotate(0deg)" },
                    ],
                    dur / speedRef.current,
                  ),
                );
              },
            });
          }
          break;
        }

        case "buff": {
          // 增益：頭上掛小圖示，時間到自己拿掉
          const untilMs = (event.until - event.t) * 1000;
          const key = `${event.unitId}:${event.stat}`;
          later(200, () => {
            setState((prev) => {
              const cur = prev.buffs[event.unitId] ?? [];
              return cur.includes(event.stat) ? prev : { ...prev, buffs: { ...prev.buffs, [event.unitId]: [...cur, event.stat] } };
            });
            const a = anchorsRef.current[event.unitId];
            if (a) {
              const label = event.stat === "attack" ? "攻擊↑" : event.stat === "speed" ? "速度↑" : "減傷";
              spawnText(a.x + 16, a.headY - 14, label, "label", { dx: 6 });
              if (fx) fx.shockwave(a.x, a.cy, BUFF_COLORS[event.stat], a.size * 0.6);
            }
            playSfx("buff");
          });
          buffUntilRef.current.set(key, performance.now() + untilMs / speedRef.current);
          later(untilMs + 200, () => {
            if ((buffUntilRef.current.get(key) ?? 0) > performance.now() + 30) return;
            setState((prev) => ({
              ...prev,
              buffs: { ...prev.buffs, [event.unitId]: (prev.buffs[event.unitId] ?? []).filter((b) => b !== event.stat) },
            }));
          });
          break;
        }

        case "dot": {
          // 燃燒：每秒一小口，身上一直冒火直到燒完
          burnUntilRef.current.set(event.unitId, performance.now() + 1300 / speedRef.current);
          setState((prev) => (prev.burning[event.unitId] ? prev : { ...prev, burning: { ...prev.burning, [event.unitId]: true } }));
          later(1350, () => {
            if ((burnUntilRef.current.get(event.unitId) ?? 0) > performance.now() + 30) return;
            setState((prev) => ({ ...prev, burning: { ...prev.burning, [event.unitId]: false } }));
          });
          later(80, () => {
            setState((prev) => ({
              ...prev,
              hp: { ...prev.hp, [event.unitId]: event.hpAfter },
              shield: event.absorbed > 0 ? { ...prev.shield, [event.unitId]: event.shieldAfter } : prev.shield,
            }));
            const a = anchorsRef.current[event.unitId];
            if (a) {
              if (fx) fx.impact(a.x, a.cy, { colors: ["#FFE07A", "#FF8A3D", "#FF4D2E"], crit: false, dir: 0, power: 0.6 });
              const offset = nextTextOffset(event.unitId);
              spawnText(a.x + offset, a.headY - 14, `${event.damage - event.absorbed}`, "burn", { dx: offset * 0.5 });
            }
            playSfx("burn");
          });
          break;
        }

        case "death": {
          const unit = unitById[event.unitId];
          if (!unit) break;
          const boss = isBossUnit(event.unitId);
          if (unit.side === "enemy") holdTimeline(boss ? 900 : KILL_BEAT_MS);
          // 連打技能的最後一下才打死的話，倒下要等那一下演完
          const extraDelay = hitDelayRef.current.get(event.unitId) ?? 0;

          later(IMPACT_MS + 40 + extraDelay, () => {
            setState((prev) => ({ ...prev, alive: { ...prev.alive, [event.unitId]: false } }));
            playSfx(boss ? "bossDeath" : "death");
            const a = anchorsRef.current[event.unitId];
            const mid = midEls.current.get(event.unitId);
            const visual = visualById[event.unitId];
            const deathColors = visual?.monster
              ? [art.body, art.bodyLight, art.accent, "#FFFFFF"]
              : [getJobColor(visual?.jobId), "#FFFFFF", "#FFE07A"];

            const rig = rigRefs.current.get(event.unitId);
            if (rig) {
              // 骨架小雞：搖搖晃晃往後倒、頭上轉星星，躺一下再淡出
              void rig.play("down");
              mid?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], {
                duration: RIG_DOWN_MS / speedRef.current,
                fill: "forwards",
              });
            } else {
              mid?.animate(
                [
                  { transform: "scale(1) translateY(0)", filter: "brightness(1)", opacity: 1 },
                  { transform: "scale(1.14,0.86) translateY(0)", filter: "brightness(3.2) saturate(0)", opacity: 1, offset: 0.22 },
                  { transform: "scale(0.85,1.15) translateY(-8%)", filter: "brightness(4)", opacity: 0.9, offset: 0.45 },
                  { transform: "scale(0.2,1.6) translateY(-30%)", filter: "brightness(6)", opacity: 0 },
                ],
                { duration: (boss ? 900 : DEATH_MS) / speedRef.current, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
              );
            }

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
            later((rig ? RIG_DOWN_MS : boss ? 900 : DEATH_MS) + 20, () => {
              setState((prev) => ({ ...prev, onField: { ...prev.onField, [event.unitId]: false } }));
            });
          });
          break;
        }

        case "heal": {
          const apply = (scale: number) => {
            setState((prev) => ({ ...prev, hp: { ...prev.hp, [event.unitId]: event.hpAfter } }));
            const a = anchorsRef.current[event.unitId];
            if (a && fx) fx.heal(a.x, a.cy, a.size * scale);
            if (a) spawnText(a.x + 18, a.headY - 14, `+${event.amount}`, "heal", { dx: 6, scale: scale < 1 ? 0.85 : 1 });
          };
          if (event.reason === "lifesteal") {
            // 吸血（法杖）：紅色光點從被打的那隻飛回來
            later(IMPACT_MS + 30, () => {
              const a = anchorsRef.current[event.unitId];
              const victimId = lastTargetRef.current.get(event.unitId);
              const v = victimId ? anchorsRef.current[victimId] : undefined;
              if (a && v && fx) fx.drain(v.x, v.cy, a.x, a.cy);
            });
            later(IMPACT_MS + 330, () => {
              apply(0.6);
              playSfx("drain");
              pushLog(`${unitName(event.unitId)} 吸血 ${event.amount}`, "heal");
            });
          } else if (event.reason === "skill") {
            // 技能回血：放出去之後馬上補
            later(220, () => {
              apply(1);
              playSfx("heal");
              pushLog(`${unitName(event.unitId)} 回復 ${event.amount}`, "heal");
            });
          } else if (event.reason === "regen") {
            // 再生（法袍）：每次出手後小補一口
            later(IMPACT_MS + 80, () => {
              apply(0.5);
              pushLog(`${unitName(event.unitId)} 再生 ${event.amount}`, "heal");
            });
          } else {
            later(IMPACT_MS + DEATH_MS - 200, () => {
              apply(1);
              playSfx("heal");
              pushLog(`${unitName(event.unitId)} 回復 ${event.amount}`, "heal");
            });
          }
          break;
        }

        case "end": {
          const won = event.winner === "player";
          later(IMPACT_MS + DEATH_MS + 200, () => {
            keyRef.current += 1;
            setBanner({ kind: engine.timedOut ? "timeup" : won ? "win" : "lose", key: keyRef.current });
            playSfx(won ? "win" : "lose");
            if (!won) setLost(true);
            if (won) flash("#FFFFFF", 0.35, 360);
            // 贏的那一邊還站著的骨架小雞跳起來慶祝
            for (const u of event.winner === "player" ? playerUnits : enemyUnits) {
              void rigRefs.current.get(u.id)?.play("victory");
            }
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
      cinematic,
      enemySlots,
      enemyUnits,
      finish,
      makeKit,
      playerUnits,
      flash,
      holdTimeline,
      hurtVignette,
      isBossUnit,
      later,
      nextTextOffset,
      playerSlots,
      pushLog,
      engine,
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
    playSfx("start");
    holdTimeline(START_BANNER_MS);
    later(START_BANNER_MS, () => setBanner((b) => (b?.kind === "start" ? null : b)));

    let lastTs: number | null = null;
    function frame(ts: number) {
      if (lastTs === null) lastTs = ts;
      const realDt = ts - lastTs;
      const dt = (realDt / 1000) * speedRef.current;
      lastTs = ts;
      // 卡頓偵測：累計 40 幀以上低於 30fps 就切省電特效（粒子、殘影減半）
      if (realDt > 34 && realDt < 500) slowFramesRef.current += 1;
      else if (slowFramesRef.current > 0) slowFramesRef.current -= 0.25;
      if (!liteRef.current && slowFramesRef.current > 40) {
        liteRef.current = true;
        setLite(true);
      }
      if (performance.now() >= pauseUntilRef.current) {
        elapsedRef.current += Math.min(dt, 0.1);
      }
      // 叫引擎結算到目前的游標
      engine.advanceTo(elapsedRef.current);
      const events = engine.events;
      // 一幀可能跨過好幾個事件（×2 或掉幀時），要一次補完。
      // 但遇到「會把游標停住」的事件就先停，下一幀再繼續。
      while (
        performance.now() >= skillPauseUntilRef.current &&
        eventIndexRef.current < events.length &&
        events[eventIndexRef.current].t <= elapsedRef.current + 1e-9
      ) {
        applyRef.current(events[eventIndexRef.current]);
        eventIndexRef.current += 1;
        if (performance.now() < pauseUntilRef.current) break;
      }
      if (engine.finished && eventIndexRef.current >= events.length) {
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

                      {/* 護盾泡泡（月光石） */}
                      {alive && (state.shield[unit.id] ?? 0) > 0 ? (
                        <div
                          className="shield-bubble pointer-events-none absolute rounded-full"
                          style={{
                            left: a.size * 0.06,
                            top: a.size * 0.08,
                            width: a.size * 0.88,
                            height: a.size * 0.88,
                            opacity: 0.35 + 0.6 * Math.min(1, (state.shield[unit.id] ?? 0) / Math.max(1, state.shieldMax[unit.id] ?? 1)),
                            background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.45) 0%, rgba(160,225,255,0.12) 38%, rgba(120,200,255,0.05) 62%, rgba(159,224,255,0.55) 100%)",
                            boxShadow: "0 0 12px rgba(127,211,255,0.55), inset 0 0 10px rgba(191,239,255,0.5)",
                            zIndex: 2,
                          }}
                        />
                      ) : null}

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

                      {/* 增益小圖示（血條上方） */}
                      {alive && (state.buffs[unit.id]?.length ?? 0) > 0 ? (
                        <div
                          className="pointer-events-none absolute flex justify-center gap-[2px]"
                          style={{ left: 0, width: a.size, top: a.headY - (a.feetY - a.size * 0.95) - 26, zIndex: 3 }}
                        >
                          {state.buffs[unit.id].map((b) => (
                            <span
                              key={b}
                              className="buff-chip flex h-[13px] min-w-[13px] items-center justify-center rounded-[4px] px-[2px] text-[8.5px] font-black leading-none text-[#14132A]"
                              style={{ background: BUFF_COLORS[b], boxShadow: `0 0 6px ${BUFF_COLORS[b]}` }}
                            >
                              {BUFF_GLYPH[b]}↑
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {/* 暈眩：頭上轉圈的星星 */}
                      {alive && state.stunned[unit.id] ? (
                        <div
                          className="pointer-events-none absolute"
                          style={{ left: a.size * 0.3, width: a.size * 0.4, height: a.size * 0.16, top: a.headY - (a.feetY - a.size * 0.95) - 4, zIndex: 4 }}
                        >
                          <div className="stun-orbit absolute inset-0">
                            {[0, 120, 240].map((deg) => (
                              <span key={deg} className="absolute text-[11px] leading-none text-[#FFE58A]" style={{ left: "50%", top: "50%", transform: `rotate(${deg}deg) translateX(${a.size * 0.18}px) rotate(-${deg}deg) translate(-50%,-50%)`, textShadow: "0 0 4px #FFB300" }}>
                                ★
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div ref={midRefFor(unit.id)} className="absolute inset-0" style={{ transformOrigin: "50% 95%" }}>
                        <div
                          className={[visual?.monster || artMode !== "svg" ? "unit-idle" : "", "absolute inset-0 flex items-end justify-center"].join(" ")}
                          style={{ animationDelay: `${(unit.id.charCodeAt(unit.id.length - 1) % 7) * -0.23}s` }}
                        >
                          {visual?.monster ? (
                            <MonsterArt
                              tower={visual.monster.tower}
                              archetype={visual.monster.archetype}
                              isBoss={visual.monster.isBoss}
                              size={a.size}
                            />
                          ) : artMode === "svg" ? (
                            <RigSprite
                              size={a.size}
                              flip={!isPlayer}
                              jobId={visual?.jobId ?? null}
                              weapon={visual?.weapon ?? null}
                              armor={visual?.armor ?? null}
                              rigRef={rigRefFor(unit.id)}
                              texture={!lite}
                            />
                          ) : (
                            <PetSprite jobId={visual?.jobId} emoji={visual?.emoji} size={a.size * 0.94} flip={!isPlayer} />
                          )}
                        </div>
                        {/* 燃燒中：身上一直冒火 */}
                        {alive && state.burning[unit.id] ? <BurningFlames size={a.size} /> : null}
                      </div>
                    </div>
                  );
                })}
                {/* 技能特寫的暗幕（參與的單位會浮到上面） */}
                <div ref={dimRef} className="pointer-events-none absolute inset-0" style={{ zIndex: 650, opacity: 0, background: "radial-gradient(ellipse at center, rgba(5,4,16,0.55) 0%, rgba(5,4,16,0.92) 100%)" }} />
              </div>

              {/* 技能特效（SVG，座標＝像素） */}
              <svg
                ref={skillLayerRef}
                className="pointer-events-none absolute inset-0"
                width={size.w || 1}
                height={size.h || 1}
                viewBox={`0 0 ${size.w || 1} ${size.h || 1}`}
                style={{ zIndex: 880, overflow: "visible" }}
                aria-hidden="true"
              />

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
              onClick={() => setArtMode(artMode === "svg" ? "image" : "svg")}
              data-sfx="toggle"
              aria-label={artMode === "svg" ? "目前是會動的 SVG 小雞，點一下換成原圖" : "目前是原圖，點一下換成會動的 SVG 小雞"}
              className="h-8 rounded-full bg-black/45 px-2.5 text-[10.5px] font-black text-white/85 ring-1 ring-white/20 transition-transform active:scale-95"
            >
              {artMode === "svg" ? "動畫版" : "原圖版"}
            </button>
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

          {/* ---- 技能名橫條：從施放者那一側滑進來 ---- */}
          {skillCut ? (
            <div key={skillCut.key} className="pointer-events-none absolute inset-x-0 top-[38%] flex" style={{ zIndex: 975, justifyContent: skillCut.side === "player" ? "flex-start" : "flex-end" }}>
              <div
                className={skillCut.side === "player" ? "skill-cut-l" : "skill-cut-r"}
                style={{
                  background: `linear-gradient(${skillCut.side === "player" ? 90 : 270}deg, ${skillCut.color}EE 0%, ${skillCut.color}99 60%, transparent 100%)`,
                  padding: "6px 34px 6px 16px",
                }}
              >
                <span className="fx-text text-[20px] font-black" data-text={skillCut.name} style={{ ["--fx-fill" as string]: "linear-gradient(180deg,#FFFFFF 20%,#FFF2B0 100%)", ["--fx-stroke" as string]: "5px", ["--fx-stroke-color" as string]: "#1A1206" }}>
                  {skillCut.name}
                </span>
                {skillCut.boosted ? <span className="ml-1.5 align-top text-[10px] font-black text-[#FFE58A]">職業搭配★</span> : null}
              </div>
            </div>
          ) : null}

          {/* ---- 演出橫幅 ---- */}
          {banner ? <BattleBanner banner={banner} /> : null}
        </div>

        {/* ---- 技能列：AUTO 開關；關掉之後出現每隻小雞的技能鈕 ---- */}
        {hasPlayerSkill ? (
          <div className="flex items-center gap-2 border-t border-white/10 bg-[#100E22] px-2.5 py-2">
            <button
              type="button"
              onClick={toggleAuto}
              data-sfx="toggle"
              aria-pressed={auto}
              className="flex h-10 shrink-0 flex-col items-center justify-center rounded-xl px-2.5 transition-transform active:scale-95"
              style={{
                background: auto ? "linear-gradient(180deg,#7FE8A8,#2E9E5E)" : "linear-gradient(180deg,#3A3760,#24223F)",
                boxShadow: auto ? "0 0 10px rgba(127,232,168,0.5), inset 0 1px 0 rgba(255,255,255,0.4)" : "inset 0 1px 0 rgba(255,255,255,0.15)",
              }}
            >
              <span className={["font-display text-[13px] leading-none", auto ? "text-[#0B2A18]" : "text-white/70"].join(" ")}>AUTO</span>
              <span className={["mt-0.5 text-[9px] font-black leading-none", auto ? "text-[#0B2A18]/80" : "text-white/45"].join(" ")}>{auto ? "自動放技能" : "手動"}</span>
            </button>
            {auto ? (
              <p className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-white/50">技能冷卻好就自動放。關掉 AUTO 可以自己抓時機按。</p>
            ) : (
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                {playerUnits.map((u) => {
                  const st = engine.getSkillStatus(u.id);
                  if (!st) return null;
                  const remain = Math.max(0, st.readyAt - nowSim);
                  const pct = st.cooldown > 0 ? Math.min(1, remain / st.cooldown) : 0;
                  const ready = remain <= 0 && !st.stunned && !st.unavailable && !engine.finished;
                  const def = getSkill(st.skillId);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      data-sfx="none"
                      disabled={st.unavailable || engine.finished}
                      onClick={() => handleCast(u.id)}
                      className={["relative flex shrink-0 items-center gap-1.5 rounded-xl py-1 pl-1 pr-2.5 transition-transform active:scale-95 disabled:opacity-35", ready ? "skill-ready" : ""].join(" ")}
                      style={{ background: ready ? `linear-gradient(180deg, ${def.color}55, rgba(255,255,255,0.06))` : "rgba(255,255,255,0.06)", boxShadow: ready ? `0 0 0 1.5px ${def.color}, 0 0 12px ${def.color}88` : "0 0 0 1px rgba(255,255,255,0.12)" }}
                      aria-label={`${u.name}：${def.name}${ready ? "（可以放）" : `（冷卻 ${Math.ceil(remain)} 秒）`}`}
                    >
                      <span className="relative block">
                        <SkillIcon skillId={st.skillId} size={36} boosted={st.boosted} dim={!ready} />
                        {!ready && pct > 0 ? (
                          <span
                            className="absolute inset-0 rounded-full"
                            style={{ background: `conic-gradient(rgba(0,0,0,0.6) ${Math.round(pct * 360)}deg, transparent 0deg)`, WebkitMaskImage: "radial-gradient(circle, #000 64%, transparent 66%)", maskImage: "radial-gradient(circle, #000 64%, transparent 66%)" }}
                          />
                        ) : null}
                        {st.stunned && !st.unavailable ? (
                          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-black text-[#FFE58A]" style={{ textShadow: "0 1px 2px #000" }}>
                            暈
                          </span>
                        ) : null}
                        {!ready && !st.stunned && remain > 0 ? (
                          <span className="font-display absolute inset-0 flex items-center justify-center text-[13px] text-white" style={{ textShadow: "0 1px 2px #000" }}>
                            {Math.ceil(remain)}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-left">
                        <span className="block max-w-[64px] truncate text-[9.5px] font-bold leading-tight text-white/55">{u.name}</span>
                        <span className="block text-[12px] font-black leading-tight text-white">{def.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

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
