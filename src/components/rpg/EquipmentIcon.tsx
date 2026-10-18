// src/components/rpg/EquipmentIcon.tsx
"use client";

/**
 * 裝備圖示（程式繪製，10 種 × 5 階）＋ 抽卡風的階級框
 * ------------------------------------------------------------
 * 武器：劍、匕首、斧、法杖、長槍；防具：盾、重甲、皮甲、刺甲、法袍。
 * 每一種的輪廓都不一樣，看剪影就知道是什麼。5 階各有自己的材質：
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
import { SHOP_TYPE_BY_KIND, type EquipmentKind, type EquipmentTier, type EquipmentType } from "@/lib/rpg/equipment";
import type { GemId } from "@/lib/rpg/gems";
import { GemSockets } from "@/components/rpg/GemIcon";

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
  /** 種類，不給就用部位的基本款（劍／盾） */
  type?: EquipmentType;
  size: number;
  className?: string;
}

export default function EquipmentIcon({ kind, tier, type, size, className }: EquipmentIconProps) {
  const t = type ?? SHOP_TYPE_BY_KIND[kind];
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
      {t === "sword" ? <Sword tier={tier} m={m} uid={uid} /> : null}
      {t === "dagger" ? <Dagger tier={tier} m={m} uid={uid} /> : null}
      {t === "axe" ? <Axe tier={tier} m={m} uid={uid} /> : null}
      {t === "staff" ? <Staff tier={tier} m={m} uid={uid} /> : null}
      {t === "spear" ? <Spear tier={tier} m={m} uid={uid} /> : null}
      {t === "shield" ? <Shield tier={tier} m={m} uid={uid} /> : null}
      {t === "heavy" ? <HeavyArmor tier={tier} m={m} uid={uid} /> : null}
      {t === "leather" ? <LeatherArmor tier={tier} m={m} uid={uid} /> : null}
      {t === "spiked" ? <SpikedArmor tier={tier} m={m} uid={uid} /> : null}
      {t === "robe" ? <Robe tier={tier} m={m} uid={uid} /> : null}
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
// 新增的 8 種
// ============================================================

/** 共用：握柄（纏布） */
function Grip({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={w / 2.5} fill="#4A2E18" stroke="#1A1208" strokeWidth={1} />
      {Array.from({ length: Math.max(2, Math.floor(h / 3.2)) }, (_, i) => (
        <path key={i} d={`M${x + 0.3},${y + 2 + i * 3.2} L${x + w - 0.3},${y + 3.4 + i * 3.2}`} stroke="#8A5A32" strokeWidth={1.1} />
      ))}
    </g>
  );
}

/** 匕首：短而寬的彎刃（像小彎刀）、刃尖朝左上，跟朝右上的劍一眼分得出來 */
function Dagger({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  const guard = tier >= 5 ? `url(#${uid}-gold)` : tier >= 3 ? m.lo : "#5A3A1E";
  return (
    <g transform="translate(32 32) scale(1.2) rotate(-38) translate(-32 -34)">
      {tier >= 5 ? <path d="M30,8 C42,16 42,30 38,38 L24,38 Z" fill="#FFE07A" opacity={0.5} filter={`url(#${uid}-glow)`} /> : null}
      {/* 寬彎刃：背直、刃口外弧 */}
      <path d="M27,38 L27,18 C27,12 30,8 33,7 C40,14 41,28 37,38 Z" fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M33.5,9 C39,16 39.6,28 36.2,36.5" fill="none" stroke={`url(#${uid}-edge)`} strokeWidth={1.6} />
      {tier >= 2 ? <path d="M29.5,15 L29.5,35" stroke={m.lo} strokeWidth={1.4} opacity={0.5} strokeLinecap="round" /> : null}
      {tier >= 3 ? <circle cx={32} cy={24} r={1.6} fill={m.gem} filter={`url(#${uid}-glow)`} /> : null}
      {/* 寬護手，兩端往刃的方向翹 */}
      <path d="M21,39 C21,36 24,36 26,37.5 L38,37.5 C40,36 43,36 43,39 C43,41.5 40,41.5 38,40.5 L26,40.5 C24,41.5 21,41.5 21,39 Z" fill={guard} stroke="#1A1208" strokeWidth={1.1} />
      {tier >= 4 ? (
        <>
          <path d="M21,39 C17,36 16,32 18,29" fill="none" stroke={guard} strokeWidth={2.6} strokeLinecap="round" />
          <path d="M43,39 C47,36 48,32 46,29" fill="none" stroke={guard} strokeWidth={2.6} strokeLinecap="round" />
        </>
      ) : null}
      <Grip x={29.2} y={41} w={5.6} h={10} />
      <circle cx={32} cy={53.5} r={3.2} fill={tier >= 5 ? `url(#${uid}-gold)` : m.mid} stroke={m.lo} strokeWidth={1} />
      {tier >= 3 ? <circle cx={32} cy={53.5} r={1.3} fill={m.gem} /> : null}
    </g>
  );
}

/** 斧：長柄＋單面寬刃斧頭，高階刃背長出尖刺 */
function Axe({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  return (
    <g transform="translate(32 32) scale(1.08) rotate(30) translate(-32 -32)">
      {tier >= 5 ? <path d="M34,8 C52,10 54,30 36,32 Z" fill="#FFE07A" opacity={0.55} filter={`url(#${uid}-glow)`} /> : null}
      {/* 長柄 */}
      <rect x={29.5} y={8} width={5} height={50} rx={2.4} fill="#6B4A2A" stroke="#1A1208" strokeWidth={1.1} />
      <path d="M30.5,10 L30.5,56" stroke="#9A6E40" strokeWidth={1} opacity={0.7} />
      {[46, 50, 54].map((y) => (
        <path key={y} d={`M29.6,${y} L34.4,${y + 1.6}`} stroke="#3A2410" strokeWidth={1.2} />
      ))}
      {/* 斧頭：弧形刃 */}
      <path d="M34,11 C46,9 54,16 53,24 C52,31 45,34 34,31 Z" fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M48,11.5 C53,15 54.5,21 53,27" fill="none" stroke={`url(#${uid}-edge)`} strokeWidth={2} />
      {/* 刃背：粗製是平的，高階長出尖刺 */}
      {tier >= 3 ? (
        <path d="M29.5,14 L22,10 L25,18 L20,21 L29.5,24 Z" fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={1.1} strokeLinejoin="round" />
      ) : (
        <rect x={25} y={14} width={5} height={10} rx={1.5} fill={m.mid} stroke={m.lo} strokeWidth={1} />
      )}
      {tier >= 2 ? <path d="M38,17 C42,16 45,19 44,23 C43,26 40,27 38,25" fill="none" stroke={m.lo} strokeWidth={1.2} opacity={0.55} /> : null}
      {/* 斧頭跟柄的接合環 */}
      <rect x={28.5} y={12} width={7} height={4} rx={1} fill={tier >= 5 ? `url(#${uid}-gold)` : m.lo} />
      <rect x={28.5} y={27} width={7} height={4} rx={1} fill={tier >= 5 ? `url(#${uid}-gold)` : m.lo} />
      {tier >= 4 ? <circle cx={41} cy={21} r={2.6} fill={`url(#${uid}-gem)`} stroke={m.lo} strokeWidth={0.8} filter={`url(#${uid}-glow)`} /> : null}
    </g>
  );
}

/** 法杖：木杖，頂端彎鉤包住一顆發光的寶珠 */
function Staff({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  const wood = tier >= 5 ? `url(#${uid}-gold)` : tier >= 3 ? "#5A3A6E" : "#7A522C";
  return (
    <g transform="translate(32 32) scale(1.05) rotate(22) translate(-32 -32)">
      {/* 寶珠的光 */}
      <circle cx={32} cy={14} r={tier >= 3 ? 13 : 9} fill={m.gem} opacity={tier >= 3 ? 0.35 : 0.18} filter={`url(#${uid}-glow)`} />
      {/* 杖身 */}
      <path d="M30.5,22 L29.5,60 L34.5,60 L33.5,22 Z" fill={wood} stroke="#1A1208" strokeWidth={1.1} strokeLinejoin="round" />
      <path d="M31,26 L30.4,58" stroke="#FFFFFF" strokeWidth={0.8} opacity={0.25} />
      {/* 纏繞的布條 */}
      {[34, 40].map((y) => (
        <path key={y} d={`M29.6,${y} L34.4,${y + 2.4}`} stroke={tier >= 2 ? m.mid : "#C9B08A"} strokeWidth={2} strokeLinecap="round" />
      ))}
      {/* 頂端的彎鉤，包住寶珠 */}
      <path
        d="M32,23 C24,22 21,14 25,8 C28,4 35,4 38,8 C40,11 39,15 36,16"
        fill="none"
        stroke={wood}
        strokeWidth={3.4}
        strokeLinecap="round"
      />
      <path d="M32,23 C24,22 21,14 25,8 C28,4 35,4 38,8 C40,11 39,15 36,16" fill="none" stroke="#1A1208" strokeWidth={0.8} opacity={0.6} strokeLinecap="round" />
      {/* 寶珠 */}
      <circle cx={31.5} cy={14} r={5.4} fill={`url(#${uid}-gem)`} stroke={m.lo} strokeWidth={1} />
      <circle cx={29.8} cy={12.2} r={1.6} fill="#FFFFFF" opacity={0.9} />
      {/* 4 階以上：環繞的小星 */}
      {tier >= 4
        ? [
            [21, 20],
            [42, 8],
            [41, 22],
          ].map(([x, y], i) => <path key={i} d={`M${x},${y - 2.5} L${x + 0.7},${y - 0.7} L${x + 2.5},${y} L${x + 0.7},${y + 0.7} L${x},${y + 2.5} L${x - 0.7},${y + 0.7} L${x - 2.5},${y} L${x - 0.7},${y - 0.7} Z`} fill={m.hi} />)
        : null}
    </g>
  );
}

/** 長槍：細長的桿＋葉形槍頭，槍頭下綁著流蘇 */
function Spear({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  const tassel = tier >= 5 ? "#FF4D6D" : tier >= 3 ? m.gem : "#C0392B";
  return (
    <g transform="translate(32 32) scale(1.12) rotate(45) translate(-32 -32)">
      {tier >= 5 ? <path d="M32,0 L38,18 L26,18 Z" fill="#FFE07A" opacity={0.55} filter={`url(#${uid}-glow)`} /> : null}
      {/* 桿 */}
      <rect x={30.2} y={18} width={3.6} height={44} rx={1.6} fill={tier >= 4 ? m.lo : "#7A522C"} stroke="#1A1208" strokeWidth={0.9} />
      {/* 葉形槍頭 */}
      <path d="M32,0 C38,7 38.5,14 32,21 C25.5,14 26,7 32,0 Z" fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={1.2} strokeLinejoin="round" />
      <path d="M32,3 L32,18" stroke={m.lo} strokeWidth={0.9} opacity={0.6} />
      <path d="M31,4 C29,8 29,12 31,16" fill="none" stroke="#FFFFFF" strokeWidth={1} opacity={0.8} />
      {/* 3 階以上：兩側的小月牙刃 */}
      {tier >= 3 ? (
        <g fill={`url(#${uid}-metal)`} stroke={m.lo} strokeWidth={0.9}>
          <path d="M30,18 C25,17 23,14 24,11 C25,14 27,15.5 30,16 Z" />
          <path d="M34,18 C39,17 41,14 40,11 C39,14 37,15.5 34,16 Z" />
        </g>
      ) : null}
      {/* 槍頭跟桿的接合環 */}
      <rect x={29.6} y={19} width={4.8} height={3} rx={1} fill={tier >= 5 ? `url(#${uid}-gold)` : m.mid} stroke={m.lo} strokeWidth={0.7} />
      {/* 流蘇 */}
      {[-3, -1, 1, 3].map((dx, i) => (
        <path key={i} d={`M32,22 C${32 + dx},26 ${32 + dx * 1.5},28 ${32 + dx * 1.7},31`} stroke={tassel} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      ))}
      {tier >= 4 ? <circle cx={32} cy={10} r={1.6} fill={m.gem} filter={`url(#${uid}-glow)`} /> : null}
    </g>
  );
}

/** 重甲：寬肩的金屬胸甲，一片一片的板甲 */
function HeavyArmor({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  return (
    <g>
      {tier >= 5 ? <path d="M10,14 L54,14 L50,56 L14,56 Z" fill="#FFE07A" opacity={0.45} filter={`url(#${uid}-glow)`} /> : null}
      {/* 肩甲 */}
      <path d="M6,20 C6,12 14,9 22,10 L24,22 L10,28 Z" fill={`url(#${uid}-metal)`} stroke="#14100A" strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M58,20 C58,12 50,9 42,10 L40,22 L54,28 Z" fill={`url(#${uid}-metal)`} stroke="#14100A" strokeWidth={1.3} strokeLinejoin="round" />
      {/* 胸甲 */}
      <path d="M18,12 L26,10 C28,14 36,14 38,10 L46,12 L48,34 C47,46 40,54 32,57 C24,54 17,46 16,34 Z" fill={`url(#${uid}-metal)`} stroke="#14100A" strokeWidth={1.4} strokeLinejoin="round" />
      {/* 板甲接縫 */}
      <path d="M32,15 L32,55" stroke={m.lo} strokeWidth={1.2} opacity={0.6} />
      {[30, 38, 46].map((y) => (
        <path key={y} d={`M${17 + (y - 30) * 0.15},${y} C24,${y + 3} 40,${y + 3} ${47 - (y - 30) * 0.15},${y}`} fill="none" stroke={m.lo} strokeWidth={1.3} opacity={0.6} />
      ))}
      {/* 鉚釘 */}
      {[
        [22, 20],
        [42, 20],
        [12, 19],
        [52, 19],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={1.4} fill={m.hi} stroke={m.lo} strokeWidth={0.6} />
      ))}
      {tier >= 2 ? <circle cx={32} cy={24} r={tier >= 4 ? 4.6 : 3.6} fill={`url(#${uid}-gem)`} stroke={tier >= 5 ? "#7A4A06" : m.lo} strokeWidth={1} filter={tier >= 3 ? `url(#${uid}-glow)` : undefined} /> : null}
      {tier >= 5 ? <path d="M18,12 L26,10 C28,14 36,14 38,10 L46,12" fill="none" stroke="#FFF4C2" strokeWidth={1.4} /> : null}
      <path d="M20,15 L26,13 L22,24 Z" fill="#FFFFFF" opacity={0.4} />
    </g>
  );
}

/** 皮甲：無袖的皮背心，有縫線跟皮帶扣 */
function LeatherArmor({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  // 皮革本體一律是皮革色，階級表現在縫線、扣環跟寶石
  const hide = tier >= 5 ? "#8A4A1A" : tier >= 3 ? "#6A3A22" : "#8A5A32";
  const hideLight = tier >= 5 ? "#C9864A" : tier >= 3 ? "#A0623A" : "#B88A58";
  return (
    <g>
      {tier >= 5 ? <path d="M14,10 L50,10 L52,56 L12,56 Z" fill="#FFE07A" opacity={0.4} filter={`url(#${uid}-glow)`} /> : null}
      <path
        d="M20,8 L27,8 C28,13 36,13 37,8 L44,8 L52,18 L46,24 L47,54 C40,57 24,57 17,54 L18,24 L12,18 Z"
        fill={hide}
        stroke="#1A0E06"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
      <path d="M20,8 L27,8 C28,13 36,13 37,8 L44,8 L49,15 C40,16 24,16 15,15 Z" fill={hideLight} opacity={0.55} />
      {/* 前襟 */}
      <path d="M32,13 L32,55" stroke="#1A0E06" strokeWidth={1.2} />
      {/* 縫線（虛線） */}
      <path d="M21,22 L21,52 M43,22 L43,52" stroke={tier >= 2 ? m.hi : "#E8D2A8"} strokeWidth={1} strokeDasharray="2 2" opacity={0.85} />
      {/* 交叉綁帶 */}
      {[22, 30, 38].map((y) => (
        <path key={y} d={`M29,${y} L35,${y + 4} M35,${y} L29,${y + 4}`} stroke="#E8D2A8" strokeWidth={1.2} />
      ))}
      {/* 腰帶＋扣環 */}
      <rect x={17} y={45} width={30} height={5} fill="#3A2210" stroke="#1A0E06" strokeWidth={0.9} />
      <rect x={28.5} y={44} width={7} height={7} rx={1.2} fill={tier >= 5 ? `url(#${uid}-gold)` : `url(#${uid}-metal)`} stroke={m.lo} strokeWidth={0.9} />
      {tier >= 3 ? <circle cx={32} cy={47.5} r={1.8} fill={`url(#${uid}-gem)`} filter={`url(#${uid}-glow)`} /> : null}
      <path d="M22,10 L26,10 L20,20 Z" fill="#FFFFFF" opacity={0.3} />
    </g>
  );
}

/** 刺甲：胸甲表面一排排尖刺 */
function SpikedArmor({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  const spikes: [number, number, number][] = [
    [16, 22, -150],
    [48, 22, -30],
    [22, 32, -140],
    [42, 32, -40],
    [19, 42, -160],
    [45, 42, -20],
    [32, 30, -90],
  ];
  return (
    <g>
      {tier >= 5 ? <path d="M8,10 L56,10 L52,58 L12,58 Z" fill="#FFE07A" opacity={0.45} filter={`url(#${uid}-glow)`} /> : null}
      {/* 尖刺（先畫，胸甲蓋住根部） */}
      {spikes.map(([x, y, deg], i) => (
        <path
          key={i}
          transform={`translate(${x} ${y}) rotate(${deg})`}
          d={`M0,-3 L${tier >= 3 ? 11 : 8},0 L0,3 Z`}
          fill={tier >= 5 ? `url(#${uid}-gold)` : m.hi}
          stroke={m.lo}
          strokeWidth={0.9}
          strokeLinejoin="round"
        />
      ))}
      <path d="M17,12 L26,10 C28,14 36,14 38,10 L47,12 L48,36 C46,47 40,54 32,57 C24,54 18,47 16,36 Z" fill={`url(#${uid}-metal)`} stroke="#14100A" strokeWidth={1.4} strokeLinejoin="round" />
      {/* 胸甲上的刺座 */}
      {spikes.map(([x, y], i) => (
        <circle key={i} cx={x + (32 - x) * 0.25} cy={y} r={2.2} fill={m.lo} stroke="#14100A" strokeWidth={0.6} />
      ))}
      {tier >= 2 ? <circle cx={32} cy={42} r={3.6} fill={`url(#${uid}-gem)`} stroke={m.lo} strokeWidth={1} filter={tier >= 3 ? `url(#${uid}-glow)` : undefined} /> : null}
      <path d="M20,15 L26,13 L22,24 Z" fill="#FFFFFF" opacity={0.4} />
    </g>
  );
}

/** 法袍：長袍＋兜帽，衣襬上有符文 */
function Robe({ tier, m, uid }: { tier: number; m: TierMaterial; uid: string }) {
  return (
    <g>
      {tier >= 5 ? <path d="M12,6 L52,6 L58,60 L6,60 Z" fill="#FFE07A" opacity={0.4} filter={`url(#${uid}-glow)`} /> : null}
      {/* 袍身：上窄下寬 */}
      <path d="M22,16 L42,16 L52,58 C40,61 24,61 12,58 Z" fill={`url(#${uid}-metal)`} stroke="#14100A" strokeWidth={1.4} strokeLinejoin="round" />
      {/* 兜帽 */}
      <path d="M20,18 C18,8 24,3 32,3 C40,3 46,8 44,18 C40,15 24,15 20,18 Z" fill={m.lo} stroke="#14100A" strokeWidth={1.3} strokeLinejoin="round" />
      <path d="M24,16 C24,10 28,7 32,7 C36,7 40,10 40,16" fill="#0A0814" opacity={0.8} />
      {/* 前襟滾邊 */}
      <path d="M32,16 L32,59" stroke={tier >= 5 ? "#FFF4C2" : m.hi} strokeWidth={2} opacity={0.8} />
      {/* 腰帶 */}
      <path d="M23,30 C28,32 36,32 41,30" stroke={tier >= 5 ? `url(#${uid}-gold)` : m.lo} strokeWidth={3} fill="none" />
      {/* 衣襬符文（2 階以上） */}
      {tier >= 2 ? (
        <g stroke={m.gem} strokeWidth={1.2} fill="none" opacity={0.9} filter={tier >= 3 ? `url(#${uid}-glow)` : undefined}>
          <circle cx={22} cy={50} r={3} />
          <path d="M22,47 L22,53 M19,50 L25,50" />
          <circle cx={42} cy={50} r={3} />
          <path d="M40,48 L44,52 M44,48 L40,52" />
        </g>
      ) : null}
      {tier >= 3 ? <circle cx={32} cy={31} r={2.6} fill={`url(#${uid}-gem)`} stroke={m.lo} strokeWidth={0.8} /> : null}
      <path d="M24,20 L28,19 L20,44 Z" fill="#FFFFFF" opacity={0.25} />
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
  /** 寶石孔：給了就在卡框下緣畫一排孔（sockets = 孔數） */
  gems?: GemId[];
  sockets?: number;
}

/** 抽卡風的方形卡框：階級色漸層邊、暗色底、稀有以上有光澤掃過 */
export function ItemFrame({ tier, size, children, selected = false, className, count, gems, sockets }: ItemFrameProps) {
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
        <div className="relative" style={sockets && sockets > 0 && size >= 40 ? { transform: `translateY(-${Math.round(size * 0.07)}px) scale(0.9)` } : undefined}>
          {children}
        </div>
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
        {/* 寶石孔：貼在卡框下緣（卡框太小的時候不畫，太擠看不清楚） */}
        {sockets && sockets > 0 && size >= 40 ? (
          <div className="absolute inset-x-0 bottom-[3%]">
            <GemSockets gems={gems ?? []} sockets={sockets} size={Math.max(7, Math.round(size * 0.15))} />
          </div>
        ) : null}
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
