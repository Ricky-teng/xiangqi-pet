// src/components/pet/rig/parts.tsx
"use client";

/**
 * 各職小雞共用的零件：臉（表情）、拿在手上的武器、身上的防具、羽毛小撮
 * ------------------------------------------------------------
 * 墨線色、線寬統一在這裡，8 職畫出來的筆觸才會一致。
 */

import EquipmentIcon from "@/components/rpg/EquipmentIcon";
import { getItemType, type EquipmentItem } from "@/lib/rpg/equipment";
import type { Expression } from "@/components/pet/rig/jobs/index";

/** 墨線顏色、粗細（可愛風：深咖啡、圓頭圓角） */
export const INK = "#3E2A1E";
export const LINE = 2.6;
export const LINE_THIN = 1.6;

export const inkProps = {
  stroke: INK,
  strokeWidth: LINE,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

/** 小雞身體的黃色漸層（每一職共用，讓 8 隻一看就是同一家人） */
export function ChickGradients({ uid }: { uid: string }) {
  return (
    <>
      <radialGradient id={`${uid}-body`} cx="38%" cy="30%" r="75%">
        <stop offset="0%" stopColor="#FFF9B8" />
        <stop offset="35%" stopColor="#FFEB45" />
        <stop offset="80%" stopColor="#FBCB33" />
        <stop offset="100%" stopColor="#EFA92A" />
      </radialGradient>
      <radialGradient id={`${uid}-wing`} cx="35%" cy="25%" r="85%">
        <stop offset="0%" stopColor="#FFFBC8" />
        <stop offset="50%" stopColor="#FFE94A" />
        <stop offset="100%" stopColor="#F2B42E" />
      </radialGradient>
      <linearGradient id={`${uid}-leg`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#F7B043" />
        <stop offset="100%" stopColor="#D9862A" />
      </linearGradient>
      {/* 手繪質感：羽毛筆觸紋理（小弧線）、邊緣暗一圈的立體感 */}
      <pattern id={`${uid}-fur`} width="18" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">
        <path d="M1,9 q4,-5 8,0" stroke="#E2A024" strokeWidth="1.1" fill="none" strokeLinecap="round" opacity="0.55" />
        <path d="M10,3 q3.5,-4 7,0" stroke="#E2A024" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.45" />
        <path d="M6,13 q2.5,-3 5,0" stroke="#FFF7C0" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.7" />
      </pattern>
      <radialGradient id={`${uid}-rim`} cx="42%" cy="36%" r="68%">
        <stop offset="62%" stopColor="#E08A12" stopOpacity="0" />
        <stop offset="88%" stopColor="#E08A12" stopOpacity="0.22" />
        <stop offset="100%" stopColor="#B8620A" stopOpacity="0.5" />
      </radialGradient>
      <filter id={`${uid}-ink`} x="-15%" y="-15%" width="130%" height="130%">
        {/* 線條微微抖動（像手畫的）＋一層很淡的紙張顆粒 */}
        <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="3" result="wob" />
        <feDisplacementMap in="SourceGraphic" in2="wob" scale="2.2" xChannelSelector="R" yChannelSelector="G" result="disp" />
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed="9" result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 0.55 -0.18" result="grainA" />
        <feComposite in="grainA" in2="disp" operator="in" result="grainIn" />
        <feMerge>
          <feMergeNode in="disp" />
          <feMergeNode in="grainIn" />
        </feMerge>
      </filter>
      <radialGradient id={`${uid}-cheek`} cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#FF9A3C" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#FF9A3C" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

// ============================================================
// 臉
// ============================================================

interface FaceProps {
  /** 兩眼中心 */
  eyeL: [number, number];
  eyeR: [number, number];
  /** 嘴巴（鳥嘴）中心 */
  beak: [number, number];
  /** 腮紅中心 */
  cheekL: [number, number];
  cheekR: [number, number];
  /** 眼睛大小倍率 */
  scale?: number;
  expression: Expression;
  uid: string;
  /** 單眼眨（原圖有幾職是眨一隻眼） */
  winkRight?: boolean;
  winkLeft?: boolean;
  /** 嘴巴大小倍率（不給就跟眼睛一樣） */
  beakScale?: number;
}

export function Face({ eyeL, eyeR, beak, cheekL, cheekR, scale = 1, expression, uid, winkRight = false, winkLeft = false, beakScale }: FaceProps) {
  const s = scale;
  return (
    <g>
      {/* 腮紅 */}
      <ellipse cx={cheekL[0]} cy={cheekL[1]} rx={10 * s} ry={6 * s} fill={`url(#${uid}-cheek)`} />
      <ellipse cx={cheekR[0]} cy={cheekR[1]} rx={10 * s} ry={6 * s} fill={`url(#${uid}-cheek)`} />
      <Eye cx={eyeL[0]} cy={eyeL[1]} s={s} expression={expression === "normal" && winkLeft ? "happy" : expression} side="L" />
      <Eye cx={eyeR[0]} cy={eyeR[1]} s={s} expression={expression === "normal" && winkRight ? "happy" : expression} side="R" />
      {expression === "determined" || expression === "shout" ? (
        <>
          {/* 眉毛：往中間壓下來 */}
          <path d={`M${eyeL[0] - 8 * s},${eyeL[1] - 11 * s} L${eyeL[0] + 6 * s},${eyeL[1] - 7 * s}`} {...inkProps} strokeWidth={3.2 * s} fill="none" />
          <path d={`M${eyeR[0] + 8 * s},${eyeR[1] - 11 * s} L${eyeR[0] - 6 * s},${eyeR[1] - 7 * s}`} {...inkProps} strokeWidth={3.2 * s} fill="none" />
        </>
      ) : null}
      <Beak x={beak[0]} y={beak[1]} s={beakScale ?? s} expression={expression} />
      {expression === "hurt" ? (
        // 受傷：額頭一滴汗
        <path
          d={`M${eyeR[0] + 14 * s},${eyeR[1] - 16 * s} q${4 * s},${7 * s} 0,${10 * s} q${-4 * s},${-3 * s} 0,${-10 * s} Z`}
          fill="#9FE0FF"
          stroke={INK}
          strokeWidth={1.2}
        />
      ) : null}
    </g>
  );
}

function Eye({ cx, cy, s, expression, side }: { cx: number; cy: number; s: number; expression: Expression; side: "L" | "R" }) {
  const sign = side === "L" ? 1 : -1;
  switch (expression) {
    case "blink":
      return <path d={`M${cx - 6 * s},${cy} Q${cx},${cy + 4 * s} ${cx + 6 * s},${cy}`} {...inkProps} strokeWidth={2.8 * s} fill="none" />;
    case "happy":
      return <path d={`M${cx - 6.5 * s},${cy + 2 * s} Q${cx},${cy - 7 * s} ${cx + 6.5 * s},${cy + 2 * s}`} {...inkProps} strokeWidth={3 * s} fill="none" />;
    case "hurt":
      // > <
      return (
        <path
          d={`M${cx - 6 * s * sign},${cy - 6 * s} L${cx + 5 * s * sign},${cy} L${cx - 6 * s * sign},${cy + 6 * s}`}
          {...inkProps}
          strokeWidth={3 * s}
          fill="none"
        />
      );
    case "dizzy": {
      // 螺旋眼
      const r = 6.5 * s;
      return (
        <path
          d={`M${cx},${cy} m${-r * 0.2},0 a${r * 0.25},${r * 0.25} 0 1,1 ${r * 0.45},0 a${r * 0.55},${r * 0.55} 0 1,1 ${-r * 0.95},0 a${r * 0.85},${r * 0.85} 0 1,1 ${r * 1.6},0`}
          {...inkProps}
          strokeWidth={2 * s}
          fill="none"
        />
      );
    }
    case "ko":
      return (
        <g {...inkProps} strokeWidth={3 * s}>
          <path d={`M${cx - 5.5 * s},${cy - 5.5 * s} L${cx + 5.5 * s},${cy + 5.5 * s}`} />
          <path d={`M${cx + 5.5 * s},${cy - 5.5 * s} L${cx - 5.5 * s},${cy + 5.5 * s}`} />
        </g>
      );
    case "determined":
    case "shout":
      return (
        <g>
          <ellipse cx={cx} cy={cy + 1 * s} rx={5.8 * s} ry={5.4 * s} fill="#17181F" />
          <circle cx={cx - 1.8 * s} cy={cy - 1.2 * s} r={2 * s} fill="#FFFFFF" />
        </g>
      );
    default:
      return (
        <g>
          <ellipse cx={cx} cy={cy} rx={6 * s} ry={7.2 * s} fill="#17181F" />
          <circle cx={cx - 2 * s} cy={cy - 2.6 * s} r={2.4 * s} fill="#FFFFFF" />
          <circle cx={cx + 2.2 * s} cy={cy + 2.6 * s} r={1.1 * s} fill="#FFFFFF" opacity={0.85} />
        </g>
      );
  }
}

/** 鳥嘴：上喙橘色、張開時看得到紅色嘴巴跟舌頭 */
function Beak({ x, y, s, expression }: { x: number; y: number; s: number; expression: Expression }) {
  const open = expression === "normal" || expression === "blink" || expression === "happy" ? 1.3 : expression === "shout" ? 1.7 : expression === "ko" ? 1.1 : 0.35;
  const top = `M${x - 9 * s},${y - 1 * s} Q${x},${y - 9 * s} ${x + 9 * s},${y - 1 * s} Q${x + 4 * s},${y + 3 * s} ${x},${y + 3 * s} Q${x - 4 * s},${y + 3 * s} ${x - 9 * s},${y - 1 * s} Z`;
  const mouthH = 9 * s * open;
  return (
    <g>
      {open > 0.4 ? (
        <>
          <path
            d={`M${x - 7 * s},${y + 1 * s} Q${x},${y + 1 * s + mouthH * 1.6} ${x + 7 * s},${y + 1 * s} Z`}
            fill="#C8341C"
            {...inkProps}
            strokeWidth={LINE_THIN}
          />
          <ellipse cx={x + 0.5 * s} cy={y + 1 * s + mouthH * 0.7} rx={3.6 * s} ry={2.2 * s * Math.min(1.4, open)} fill="#FF7A6A" />
        </>
      ) : (
        <path d={`M${x - 6 * s},${y + 2 * s} Q${x},${y + 6 * s} ${x + 6 * s},${y + 2 * s}`} fill="#F08A1E" {...inkProps} strokeWidth={LINE_THIN} />
      )}
      <path d={top} fill="#F7A02A" {...inkProps} strokeWidth={LINE_THIN + 0.4} />
      <path d={`M${x - 4 * s},${y - 3.5 * s} Q${x},${y - 6 * s} ${x + 3 * s},${y - 4 * s}`} stroke="#FFE2A8" strokeWidth={1.4 * s} fill="none" strokeLinecap="round" />
      {expression === "ko" ? (
        // KO：舌頭吐出來
        <path d={`M${x + 1 * s},${y + 8 * s} q${3 * s},${7 * s} ${7 * s},${3 * s}`} fill="#FF7A6A" stroke={INK} strokeWidth={1.2} />
      ) : null}
    </g>
  );
}

// ============================================================
// 武器、防具
// ============================================================

/**
 * 拿在翅膀上的武器。
 * EquipmentIcon 的圖是「握把在左下、刀尖朝右上」，grip 是翅膀握住的點，
 * size 是武器長度（viewBox 單位）。
 */
export function HeldWeapon({ item, grip, size = 70, angle = 0 }: { item: EquipmentItem | null; grip: [number, number]; size?: number; angle?: number }) {
  if (!item) return null;
  // 圖示裡握把大約在 (0.28, 0.72) 的位置（直立的劍柄轉 45° 之後）
  const gx = grip[0] - size * 0.28;
  const gy = grip[1] - size * 0.72;
  return (
    <g transform={`rotate(${angle} ${grip[0]} ${grip[1]})`}>
      <svg x={gx} y={gy} width={size} height={size} viewBox="0 0 64 64" overflow="visible">
        <EquipmentIcon kind="weapon" type={getItemType(item)} tier={item.tier} size={64} />
      </svg>
    </g>
  );
}

/** 拿在另一隻翅膀上的盾 */
export function HeldShield({ item, center, size = 54 }: { item: EquipmentItem | null; center: [number, number]; size?: number }) {
  if (!item || getItemType(item) !== "shield") return null;
  return (
    <svg x={center[0] - size / 2} y={center[1] - size / 2} width={size} height={size} viewBox="0 0 64 64" overflow="visible">
      <EquipmentIcon kind="armor" type="shield" tier={item.tier} size={64} />
    </svg>
  );
}

/** 小撮羽毛（身體邊緣蓬蓬的感覺），pts 是羽毛尖端 */
export function Fluff({ pts, fill }: { pts: [number, number][]; fill: string }) {
  return (
    <g>
      {pts.map(([x, y], i) => (
        <path key={i} d={`M${x - 5},${y + 6} Q${x - 2},${y + 1} ${x},${y} Q${x + 1},${y + 4} ${x + 5},${y + 7} Z`} fill={fill} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      ))}
    </g>
  );
}

/** KO 時頭上轉圈的星星（放在 fx 部位，倒下動畫最後才出現） */
export function KoStars({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <g className="stun-orbit" style={{ transformOrigin: `${cx}px ${cy}px`, transformBox: "view-box" }}>
        {[0, 120, 240].map((deg) => {
          const a = (deg * Math.PI) / 180;
          const x = cx + Math.cos(a) * 26;
          const y = cy + Math.sin(a) * 8;
          return (
            <path
              key={deg}
              d={`M${x},${y - 7} L${x + 2},${y - 2} L${x + 7},${y - 2} L${x + 3},${y + 1.5} L${x + 4.5},${y + 6.5} L${x},${y + 3.5} L${x - 4.5},${y + 6.5} L${x - 3},${y + 1.5} L${x - 7},${y - 2} L${x - 2},${y - 2} Z`}
              fill="#FFE04A"
              stroke={INK}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
          );
        })}
      </g>
    </g>
  );
}

/**
 * 「單位座標」：小兵以外的 7 職是照原圖的 220×220 格子畫的（腳底約在 y=bottom），
 * 用一層巢狀 <svg> 把它擺到骨架的標準位置（腳底對齊 y=226、整體放大 scale 倍）。
 * 巢狀 svg 會建立新的座標系，裡面的 jointStyle 關節座標直接用格子座標就好。
 */
export function UnitSpace({ bottom, scale = 1.1, children }: { bottom: number; scale?: number; children: React.ReactNode }) {
  const size = 220 * scale;
  return (
    <svg x={110 - size / 2} y={226 - bottom * scale} width={size} height={size} viewBox="0 0 220 220" overflow="visible">
      {children}
    </svg>
  );
}

/**
 * 毛茸茸的身體：底色 → 羽毛筆觸 → 邊緣陰影 → 墨線。
 * 給 d（任意形狀）或 ellipse（[cx, cy, rx, ry]）其中一個。
 */
export function Fluffy({ uid, d, ellipse, wing = false }: { uid: string; d?: string; ellipse?: [number, number, number, number]; wing?: boolean }) {
  const shape = (props: React.SVGProps<SVGPathElement> & React.SVGProps<SVGEllipseElement>) =>
    ellipse ? <ellipse cx={ellipse[0]} cy={ellipse[1]} rx={ellipse[2]} ry={ellipse[3]} {...props} /> : <path d={d} {...props} />;
  return (
    <g>
      {shape({ fill: `url(#${uid}-${wing ? "wing" : "body"})` })}
      {shape({ fill: `url(#${uid}-fur)` })}
      {shape({ fill: `url(#${uid}-rim)` })}
      {shape({ fill: "none", ...inkProps })}
    </g>
  );
}
