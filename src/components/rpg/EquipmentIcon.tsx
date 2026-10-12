// src/components/rpg/EquipmentIcon.tsx
"use client";

/**
 * 裝備圖示（程式繪製的劍與盾）＋ 抽卡風的階級框
 * ------------------------------------------------------------
 * 取代原本的 ⚔️ / 🛡️ emoji。5 階各有自己的材質：
 *
 *   1 粗製  鐵灰       單純的鐵劍、圓釘木盾
 *   2 精良  翠綠       劍身多一道血槽、盾面十字紋
 *   3 稀有  藍鋼       劍身符文、盾面星紋、寶石開始發光
 *   4 史詩  紫晶       護手長出翅膀、盾面雙翼紋
 *   5 傳說  黃金       金色劍身＋光芒、盾面太陽紋、整件會閃
 *
 * 階級愈高細節愈多，學生看圖就分得出是不是好東西，不用讀字。
 *
 * ItemFrame 是外面那個卡框（背包格子、結算掉寶、小雞裝備格共用）：
 * 階級色漸層邊框 ＋ 暗底 ＋ 稀有以上有光澤掃過、傳說有星星。
 */

import { useId } from "react";
import type { EquipmentKind, EquipmentTier } from "@/lib/rpg/equipment";

interface TierMaterial {
  /** 金屬三階：亮／主／暗 */
  hi: string;
  mid: string;
  lo: string;
  /** 寶石 */
  gem: string;
  /** 卡框主色（跟 equipment.ts 的 TIER_FRAME_COLORS 同一套色相） */
  frame: string;
  /** 卡框的亮邊 */
  frameHi: string;
  /** 卡片底色（暗） */
  base: string;
}

export const TIER_MATERIALS: Record<number, TierMaterial> = {
  1: { hi: "#EEF1F5", mid: "#A9B0BA", lo: "#4A5260", gem: "#C9CED6", frame: "#8A929C", frameHi: "#D9DDE3", base: "#2A2E36" },
  2: { hi: "#E2FFD8", mid: "#6FC06A", lo: "#245A28", gem: "#8CFF86", frame: "#4E9A4C", frameHi: "#B8F0A8", base: "#14301A" },
  3: { hi: "#E2F0FF", mid: "#5B9BE0", lo: "#173E70", gem: "#6FD3FF", frame: "#3F7FD0", frameHi: "#A8D4FF", base: "#0F2240" },
  4: { hi: "#F3E8FF", mid: "#A87FE6", lo: "#3E2070", gem: "#E08CFF", frame: "#8B5FD0", frameHi: "#DCC2FF", base: "#22123E" },
  5: { hi: "#FFFBE0", mid: "#F5C542", lo: "#7A4A06", gem: "#FF4D6D", frame: "#E8A912", frameHi: "#FFF0A8", base: "#3A2406" },
};

export function getTierMaterial(tier: number): TierMaterial {
  return TIER_MATERIALS[Math.min(5, Math.max(1, Math.round(tier)))];
}

interface EquipmentIconProps {
  kind: EquipmentKind;
  tier: EquipmentTier;
  size: number;
  className?: string;
}

export default function EquipmentIcon({ kind, tier, size, className }: EquipmentIconProps) {
  const raw = useId();
  const uid = `eq${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const m = getTierMaterial(tier);
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} style={{ display: "block", overflow: "visible" }} aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={m.hi} />
          <stop offset="45%" stopColor={m.mid} />
          <stop offset="100%" stopColor={m.lo} />
        </linearGradient>
        <linearGradient id={`${uid}-edge`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${uid}-gem`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor={m.gem} />
          <stop offset="100%" stopColor={m.lo} />
        </radialGradient>
        <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF4C2" />
          <stop offset="50%" stopColor="#E8B84B" />
          <stop offset="100%" stopColor="#7A4A06" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {kind === "weapon" ? <Sword tier={tier} m={m} uid={uid} /> : <Shield tier={tier} m={m} uid={uid} />}
    </svg>
  );
}

function Sword({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  // 整把劍斜放（左下 → 右上），所有座標畫成直立再整組旋轉 45°
  const guardFill = tier >= 5 ? `url(#${uid}-gold)` : tier >= 3 ? m.lo : "#6B4A2A";
  return (
    // 斜放之後四個角會空出來，整把放大 12% 填滿卡框
    <g transform="translate(32 32) scale(1.12) rotate(45) translate(-32 -32)">
      {/* 傳說：劍身後面一層光 */}
      {tier >= 5 ? <path d="M32,2 L38,40 L26,40 Z" fill="#FFE07A" opacity={0.55} filter={`url(#${uid}-glow)`} /> : null}
      {/* 劍身 */}
      <path d="M32,4 L36.5,12 L36.5,40 L27.5,40 L27.5,12 Z" fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={1.2} strokeLinejoin="round" />
      {/* 刃口亮線 */}
      <path d="M32,5 L28.6,12 L28.6,39" fill="none" stroke={`url(#${uid}-edge)`} strokeWidth={1.4} />
      {/* 血槽（2 階以上） */}
      {tier >= 2 ? <path d="M32,12 L32,37" stroke={m.lo} strokeWidth={1.4} opacity={0.6} strokeLinecap="round" /> : null}
      {/* 符文（3 階以上），會發光 */}
      {tier >= 3 ? (
        <g fill={m.gem} filter={`url(#${uid}-glow)`}>
          <rect x={31} y={16} width={2} height={2} transform="rotate(45 32 17)" />
          <rect x={31} y={23} width={2} height={2} transform="rotate(45 32 24)" />
          <rect x={31} y={30} width={2} height={2} transform="rotate(45 32 31)" />
        </g>
      ) : null}
      {/* 護手 */}
      {tier >= 4 ? (
        // 史詩以上：翅膀形護手
        <path
          d="M32,40 C26,38 18,36 14,30 C18,40 24,44 30,44 L34,44 C40,44 46,40 50,30 C46,36 38,38 32,40 Z"
          fill={guardFill}
          stroke={tier >= 5 ? "#7A4A06" : "#14081E"}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      ) : (
        <rect x={20} y={39} width={24} height={5.5} rx={2.6} fill={guardFill} stroke="#1A1208" strokeWidth={1.2} />
      )}
      {/* 護手中央寶石 */}
      <circle cx={32} cy={42} r={3.2} fill={`url(#${uid}-gem)`} stroke={m.lo} strokeWidth={0.8} />
      {/* 握柄（纏布） */}
      <rect x={29.2} y={44.5} width={5.6} height={12} rx={2} fill="#4A2E18" stroke="#1A1208" strokeWidth={1} />
      {[47, 50, 53].map((y) => (
        <path key={y} d={`M29.4,${y} L34.6,${y + 1.6}`} stroke="#8A5A32" strokeWidth={1.2} />
      ))}
      {/* 柄頭 */}
      <circle cx={32} cy={59} r={3.4} fill={tier >= 5 ? `url(#${uid}-gold)` : m.mid} stroke={m.lo} strokeWidth={1} />
      {tier >= 3 ? <circle cx={32} cy={59} r={1.4} fill={m.gem} /> : null}
    </g>
  );
}

function Shield({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  const face = tier === 1 ? "#8A5A32" : `url(#${uid}-metal)`;
  return (
    <g>
      {tier >= 5 ? <path d="M32,4 L56,12 L54,34 C52,48 42,56 32,61 C22,56 12,48 10,34 L8,12 Z" fill="#FFE07A" opacity={0.5} filter={`url(#${uid}-glow)`} /> : null}
      {/* 外框（金屬邊） */}
      <path
        d="M32,6 L54,13 L52.5,34 C51,46 42,54 32,59 C22,54 13,46 11.5,34 L10,13 Z"
        fill={tier >= 5 ? `url(#${uid}-gold)` : m.lo}
        stroke="#14100A"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      {/* 盾面 */}
      <path d="M32,11 L49,16.5 L47.8,33.5 C46.6,43 39.5,49.5 32,53.5 C24.5,49.5 17.4,43 16.2,33.5 L15,16.5 Z" fill={face} />
      {/* 粗製：木紋＋鉚釘 */}
      {tier === 1 ? (
        <g>
          {[22, 28, 34, 40].map((x) => (
            <path key={x} d={`M${x},14 L${x},50`} stroke="#5A3A1E" strokeWidth={1} opacity={0.6} />
          ))}
          {[
            [19, 19],
            [45, 19],
            [20, 36],
            [44, 36],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill={m.mid} stroke={m.lo} strokeWidth={0.6} />
          ))}
        </g>
      ) : null}
      {/* 盾面紋章（依階級） */}
      {tier === 2 ? <path d="M32,15 L32,50 M18,28 L46,28" stroke={m.lo} strokeWidth={4} strokeLinecap="round" opacity={0.75} /> : null}
      {tier === 3 ? (
        <path
          d="M32,17 L35.5,27.5 L46,27.5 L37.5,34 L41,45 L32,38 L23,45 L26.5,34 L18,27.5 L28.5,27.5 Z"
          fill={m.lo}
          opacity={0.8}
        />
      ) : null}
      {tier === 4 ? (
        <g fill={m.lo} opacity={0.85}>
          <path d="M32,24 C26,20 18,20 15,24 C20,26 24,30 28,34 L32,36 Z" />
          <path d="M32,24 C38,20 46,20 49,24 C44,26 40,30 36,34 L32,36 Z" />
        </g>
      ) : null}
      {tier === 5 ? (
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M32,31 L33.4,19 L30.6,19 Z" fill="#FFF6C8" opacity={0.85} transform={`rotate(${i * 30} 32 31)`} />
          ))}
        </g>
      ) : null}
      {/* 中央寶石（2 階以上） */}
      {tier >= 2 ? (
        <circle cx={32} cy={31} r={tier >= 4 ? 5.2 : 4.4} fill={`url(#${uid}-gem)`} stroke={tier >= 5 ? "#7A4A06" : m.lo} strokeWidth={1.2} filter={tier >= 3 ? `url(#${uid}-glow)` : undefined} />
      ) : (
        <circle cx={32} cy={31} r={4} fill={m.mid} stroke={m.lo} strokeWidth={1} />
      )}
      {/* 左上反光 */}
      <path d="M17,17 L28,13.5 L18,22 Z" fill="#FFFFFF" opacity={0.45} />
    </g>
  );
}

// ============================================================
// 卡框
// ============================================================

interface ItemFrameProps {
  tier: EquipmentTier;
  /** 外框邊長（px） */
  size: number;
  children: React.ReactNode;
  /** 被選中（合成選取、裝備中） */
  selected?: boolean;
  className?: string;
  /** 右下角的小數字（背包折疊的數量） */
  count?: number;
}

/** 抽卡風的方形卡框：階級色漸層邊、暗色底、稀有以上有光澤掃過 */
export function ItemFrame({ tier, size, children, selected = false, className, count }: ItemFrameProps) {
  const m = getTierMaterial(tier);
  const radius = Math.round(size * 0.2);
  return (
    <div
      className={["relative shrink-0", className ?? ""].join(" ")}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        padding: Math.max(2, Math.round(size * 0.045)),
        background: `linear-gradient(145deg, ${m.frameHi} 0%, ${m.frame} 40%, ${m.lo} 100%)`,
        boxShadow: [
          selected ? `0 0 0 2.5px #FFFFFF, 0 0 14px ${m.frameHi}` : "",
          tier >= 5 ? `0 0 16px ${m.frame}AA` : tier >= 3 ? `0 0 8px ${m.frame}66` : "",
          "0 2px 4px rgba(0,0,0,0.35)",
        ]
          .filter(Boolean)
          .join(", "),
        transition: "box-shadow 160ms",
      }}
    >
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden"
        style={{
          borderRadius: radius - 2,
          background: `radial-gradient(circle at 50% 38%, ${m.frame}66 0%, ${m.base} 72%)`,
          boxShadow: "inset 0 2px 6px rgba(0,0,0,0.45)",
        }}
      >
        {/* 背景放射線（傳說才有） */}
        {tier >= 5 ? <div className="item-rays absolute inset-[-40%]" /> : null}
        <div className="relative">{children}</div>
        {/* 光澤掃過（稀有以上） */}
        {tier >= 3 ? <div className="item-shine pointer-events-none absolute inset-0" /> : null}
        {/* 階級點：左上角 1~5 顆小菱形 */}
        <div className="absolute left-[6%] top-[6%] flex gap-[1px]">
          {Array.from({ length: tier }, (_, i) => (
            <span
              key={i}
              className="block rotate-45"
              style={{
                width: Math.max(3, size * 0.06),
                height: Math.max(3, size * 0.06),
                background: m.frameHi,
                boxShadow: `0 0 3px ${m.frameHi}`,
              }}
            />
          ))}
        </div>
        {count !== undefined && count > 1 ? (
          <span
            className="font-display absolute bottom-[4%] right-[7%] leading-none text-white"
            style={{ fontSize: Math.max(10, size * 0.2), textShadow: "0 1px 0 #000, 0 0 3px #000" }}
          >
            ×{count}
          </span>
        ) : null}
      </div>
      {/* 傳說：四角星光 */}
      {tier >= 5 ? (
        <>
          <span className="item-twinkle absolute -right-1 -top-1 text-[10px] text-[#FFF6C8]">✦</span>
          <span className="item-twinkle absolute -bottom-1 -left-1 text-[8px] text-[#FFF6C8]" style={{ animationDelay: "0.7s" }}>
            ✦
          </span>
        </>
      ) : null}
    </div>
  );
}
