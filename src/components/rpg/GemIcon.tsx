// src/components/rpg/GemIcon.tsx
"use client";

/**
 * 寶石圖示（程式繪製）
 * ------------------------------------------------------------
 * 六色各用不同的切割形狀，色弱的學生也分得出來：
 *   紅寶石  圓形明亮式（八角放射切面）
 *   藍寶石  橢圓形
 *   翡翠    祖母綠切（切角長方形、階梯切面）
 *   黃晶    水滴形
 *   紫晶    六角柱水晶
 *   月光石  蛋面（圓頂、沒有切面，中間一道浮動的藍白光）
 *
 * mystery = 還沒揭曉的寶石（準備頁的「首通掉落」），畫成發光的問號寶石。
 */

import { useId } from "react";
import { GEM_TABLE, type GemId } from "@/lib/rpg/gems";

interface GemIconProps {
  gem: GemId;
  size: number;
  /** 還沒揭曉：灰紫色＋問號 */
  mystery?: boolean;
  className?: string;
}

export default function GemIcon({ gem, size, mystery = false, className }: GemIconProps) {
  const raw = useId();
  const uid = `gm${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const info = GEM_TABLE[gem];
  const hi = mystery ? "#E6DCFF" : info.hi;
  const mid = mystery ? "#7A5FC0" : info.mid;
  const lo = mystery ? "#2A1A5A" : info.lo;
  const ids = { body: `${uid}-b`, shine: `${uid}-s`, glow: `${uid}-g` };

  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <defs>
        <linearGradient id={ids.body} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={hi} />
          <stop offset="50%" stopColor={mid} />
          <stop offset="100%" stopColor={lo} />
        </linearGradient>
        <radialGradient id={ids.shine} cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.glow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={mid} stopOpacity="0.55" />
          <stop offset="100%" stopColor={mid} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 外圍光暈 */}
      <circle cx={20} cy={20} r={19} fill={`url(#${ids.glow})`} />

      {mystery ? (
        <MysteryCut ids={ids} lo={lo} />
      ) : (
        <>
          {gem === "ruby" ? <BrilliantCut ids={ids} lo={lo} hi={hi} /> : null}
          {gem === "sapphire" ? <OvalCut ids={ids} lo={lo} hi={hi} /> : null}
          {gem === "emerald" ? <EmeraldCut ids={ids} lo={lo} hi={hi} /> : null}
          {gem === "topaz" ? <PearCut ids={ids} lo={lo} hi={hi} /> : null}
          {gem === "amethyst" ? <CrystalCut ids={ids} lo={lo} hi={hi} /> : null}
          {gem === "moonstone" ? <Cabochon ids={ids} lo={lo} /> : null}
        </>
      )}
    </svg>
  );
}

type Ids = { body: string; shine: string; glow: string };

/** 圓形明亮式：八角外框＋放射切面 */
function BrilliantCut({ ids, lo, hi }: { ids: Ids; lo: string; hi: string }) {
  const pts = Array.from({ length: 8 }, (_, i) => {
    const a = (i * 45 - 22.5) * (Math.PI / 180);
    return [20 + Math.cos(a) * 14, 20 + Math.sin(a) * 14] as const;
  });
  return (
    <g>
      <polygon points={pts.map((p) => p.join(",")).join(" ")} fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} strokeLinejoin="round" />
      <polygon points="20,12 28,20 20,28 12,20" fill={hi} opacity={0.35} stroke={lo} strokeWidth={0.6} />
      {pts.map(([x, y], i) => (
        <line key={i} x1={20} y1={20} x2={x} y2={y} stroke={lo} strokeWidth={0.5} opacity={0.45} />
      ))}
      <ellipse cx={15} cy={14} rx={5} ry={3} fill={`url(#${ids.shine})`} />
      <path d="M13,12 L15,10 L16,13 Z" fill="#FFFFFF" />
    </g>
  );
}

/** 橢圓形：外橢圓＋內橢圓台面 */
function OvalCut({ ids, lo, hi }: { ids: Ids; lo: string; hi: string }) {
  return (
    <g>
      <ellipse cx={20} cy={20} rx={11} ry={15} fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} />
      <ellipse cx={20} cy={20} rx={6} ry={9} fill={hi} opacity={0.3} stroke={lo} strokeWidth={0.6} />
      <path d="M9,20 L14,20 M26,20 L31,20 M20,5 L20,11 M20,29 L20,35" stroke={lo} strokeWidth={0.6} opacity={0.5} />
      <ellipse cx={16} cy={13} rx={3.5} ry={4.5} fill={`url(#${ids.shine})`} />
      <path d="M15,10 L17,8.5 L17.5,11.5 Z" fill="#FFFFFF" />
    </g>
  );
}

/** 祖母綠切：切角長方形＋兩層階梯 */
function EmeraldCut({ ids, lo, hi }: { ids: Ids; lo: string; hi: string }) {
  return (
    <g>
      <polygon points="13,6 27,6 32,11 32,29 27,34 13,34 8,29 8,11" fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} strokeLinejoin="round" />
      <polygon points="15,10 25,10 28,13 28,27 25,30 15,30 12,27 12,13" fill="none" stroke={lo} strokeWidth={0.6} opacity={0.55} />
      <polygon points="17,14 23,14 24,15 24,25 23,26 17,26 16,25 16,15" fill={hi} opacity={0.3} stroke={lo} strokeWidth={0.5} />
      <rect x={12} y={9} width={6} height={4} rx={1} fill={`url(#${ids.shine})`} />
      <path d="M11,10 L14,8 L13,12 Z" fill="#FFFFFF" />
    </g>
  );
}

/** 水滴形 */
function PearCut({ ids, lo, hi }: { ids: Ids; lo: string; hi: string }) {
  return (
    <g>
      <path d="M20,4 C25,12 32,18 32,25 C32,31.5 26.6,36 20,36 C13.4,36 8,31.5 8,25 C8,18 15,12 20,4 Z" fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} strokeLinejoin="round" />
      <path d="M20,13 C23,18 26,21 26,25 C26,28.5 23.3,31 20,31 C16.7,31 14,28.5 14,25 C14,21 17,18 20,13 Z" fill={hi} opacity={0.3} stroke={lo} strokeWidth={0.6} />
      <path d="M20,4 L20,13 M8,25 L14,25 M32,25 L26,25 M20,36 L20,31" stroke={lo} strokeWidth={0.6} opacity={0.5} />
      <ellipse cx={15.5} cy={21} rx={3} ry={4} fill={`url(#${ids.shine})`} />
      <path d="M14.5,18 L16.5,16.5 L16.8,19.5 Z" fill="#FFFFFF" />
    </g>
  );
}

/** 六角柱水晶：尖頂柱狀 */
function CrystalCut({ ids, lo, hi }: { ids: Ids; lo: string; hi: string }) {
  return (
    <g>
      <polygon points="20,3 29,11 29,30 20,37 11,30 11,11" fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} strokeLinejoin="round" />
      <polygon points="20,3 20,37 11,30 11,11" fill={hi} opacity={0.22} />
      <path d="M11,11 L20,16 L29,11 M20,16 L20,37" stroke={lo} strokeWidth={0.7} fill="none" opacity={0.6} />
      <polygon points="20,3 29,11 20,16 11,11" fill={hi} opacity={0.4} />
      <path d="M14,14 L16,13 L16,24 L14,25 Z" fill="#FFFFFF" opacity={0.75} />
    </g>
  );
}

/** 蛋面：圓頂沒有切面，中間一道浮動的藍白光（月光石特有的「游彩」） */
function Cabochon({ ids, lo }: { ids: Ids; lo: string }) {
  return (
    <g>
      <ellipse cx={20} cy={21} rx={14} ry={13} fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} />
      <ellipse cx={21} cy={22} rx={9} ry={6} fill="#CFE8FF" opacity={0.75} className="gem-adularescence" />
      <ellipse cx={15} cy={14} rx={5} ry={3.5} fill={`url(#${ids.shine})`} />
      <circle cx={13.5} cy={13} r={1.4} fill="#FFFFFF" />
    </g>
  );
}

/** 未揭曉：多面體＋問號 */
function MysteryCut({ ids, lo }: { ids: Ids; lo: string }) {
  return (
    <g>
      <polygon points="20,4 33,14 28,34 12,34 7,14" fill={`url(#${ids.body})`} stroke={lo} strokeWidth={1.4} strokeLinejoin="round" />
      <text x={20} y={27} textAnchor="middle" fontSize={16} fontWeight={900} fill="#FFFFFF" style={{ fontFamily: "var(--font-display), system-ui" }}>
        ?
      </text>
    </g>
  );
}

/**
 * 寶石孔：一排小圓孔，鑲了的畫寶石、空的畫凹槽。
 * 卡框底部、裝備格、選擇器都用這個。
 */
export function GemSockets({
  gems,
  sockets,
  size,
  className,
}: {
  gems: GemId[];
  sockets: number;
  /** 每個孔的直徑（px） */
  size: number;
  className?: string;
}) {
  return (
    <div className={["flex items-center justify-center", className ?? ""].join(" ")} style={{ gap: Math.max(1, size * 0.18) }}>
      {Array.from({ length: sockets }, (_, i) => {
        const gem = gems[i];
        return gem ? (
          <GemIcon key={i} gem={gem} size={size} />
        ) : (
          <span
            key={i}
            className="block rounded-full"
            style={{
              width: size * 0.72,
              height: size * 0.72,
              margin: size * 0.14,
              background: "radial-gradient(circle at 50% 35%, rgba(0,0,0,0.75), rgba(0,0,0,0.35))",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.28)",
            }}
          />
        );
      })}
    </div>
  );
}
