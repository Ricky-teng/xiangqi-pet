// src/components/pet/rig/armor.tsx
"use client";

/**
 * 穿在小雞身上的防具（盾是拿在手上的，見 parts.tsx 的 HeldShield）
 * ------------------------------------------------------------
 *   重甲：整片金屬胸甲＋橫向分段＋鉚釘＋腰帶
 *   皮甲：咖啡色皮背心＋縫線＋交叉皮帶＋扣環
 *   刺甲：深色金屬胸甲，邊緣一圈尖刺
 *   法袍：布料長袍蓋住肚子，下擺金邊，腰上綁一條帶子
 *
 * 金屬的顏色跟背包圖示同一套（灰→綠→藍→紫→金），一看就知道幾階；
 * 3 階以上胸口多一顆寶石，5 階會發光。
 * torso 是身體可以畫防具的範圍（各職身體大小不同，由各職傳進來）。
 */

import { getTierMaterial } from "@/components/rpg/EquipmentIcon";
import type { EquipmentType } from "@/lib/rpg/equipment";
import { INK, inkProps } from "@/components/pet/rig/parts";

interface TorsoBox {
  cx: number;
  top: number;
  bottom: number;
  w: number;
}

export function BodyArmor({ type, tier, uid, torso }: { type: EquipmentType | null; tier: number; uid: string; torso: TorsoBox }) {
  if (!type || type === "shield") return null;
  const m = getTierMaterial(tier);
  const { cx, top, bottom, w } = torso;
  const h = bottom - top;
  const l = cx - w / 2;
  const r = cx + w / 2;
  const id = `${uid}-arm`;
  const gem = tier >= 3 ? <ChestGem x={cx} y={top + h * 0.35} color={m.gem} glow={tier >= 5} /> : null;

  return (
    <g>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor={m.hi} />
          <stop offset="45%" stopColor={m.mid} />
          <stop offset="100%" stopColor={m.lo} />
        </linearGradient>
        <linearGradient id={`${id}-leather`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#C98B4E" />
          <stop offset="60%" stopColor="#9A5E2C" />
          <stop offset="100%" stopColor="#6A3C18" />
        </linearGradient>
        <linearGradient id={`${id}-dark`} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#8A8F9A" />
          <stop offset="50%" stopColor="#4A505C" />
          <stop offset="100%" stopColor="#23272F" />
        </linearGradient>
        <linearGradient id={`${id}-cloth`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={m.hi} />
          <stop offset="35%" stopColor={m.mid} />
          <stop offset="100%" stopColor={m.lo} />
        </linearGradient>
      </defs>

      {type === "heavy" ? (
        <g>
          {/* 胸甲本體 */}
          <path
            d={`M${l + 6},${top + 6} Q${cx},${top - 6} ${r - 6},${top + 6} L${r - 2},${top + h * 0.62} Q${cx},${bottom + 2} ${l + 2},${top + h * 0.62} Z`}
            fill={`url(#${id}-metal)`}
            {...inkProps}
          />
          {/* 橫向分段 */}
          <path d={`M${l + 6},${top + h * 0.42} Q${cx},${top + h * 0.52} ${r - 6},${top + h * 0.42}`} stroke={m.lo} strokeWidth={2} fill="none" />
          <path d={`M${l + 8},${top + h * 0.62} Q${cx},${top + h * 0.72} ${r - 8},${top + h * 0.62}`} stroke={m.lo} strokeWidth={2} fill="none" />
          {/* 中線＋亮面 */}
          <path d={`M${cx},${top + 2} L${cx},${top + h * 0.8}`} stroke={m.lo} strokeWidth={1.6} opacity={0.6} />
          <path d={`M${l + 14},${top + 10} Q${l + 20},${top + h * 0.3} ${l + 16},${top + h * 0.5}`} stroke="#FFFFFF" strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
          {/* 鉚釘 */}
          {[0.2, 0.8].map((fx) => (
            <circle key={fx} cx={l + w * fx} cy={top + 10} r={2.6} fill={m.hi} stroke={INK} strokeWidth={1.2} />
          ))}
          {/* 肩甲 */}
          <ellipse cx={l + 4} cy={top + 6} rx={12} ry={8} fill={`url(#${id}-metal)`} {...inkProps} />
          <ellipse cx={r - 4} cy={top + 6} rx={12} ry={8} fill={`url(#${id}-metal)`} {...inkProps} />
          {gem}
        </g>
      ) : null}

      {type === "leather" ? (
        <g>
          {/* 背心：左右兩片，中間露出一點肚子 */}
          <path d={`M${l + 4},${top + 4} Q${cx - 10},${top} ${cx - 6},${top + 4} L${cx - 8},${bottom - 14} Q${l + 14},${bottom - 10} ${l + 6},${top + h * 0.6} Z`} fill={`url(#${id}-leather)`} {...inkProps} />
          <path d={`M${r - 4},${top + 4} Q${cx + 10},${top} ${cx + 6},${top + 4} L${cx + 8},${bottom - 14} Q${r - 14},${bottom - 10} ${r - 6},${top + h * 0.6} Z`} fill={`url(#${id}-leather)`} {...inkProps} />
          {/* 縫線 */}
          <path d={`M${l + 10},${top + 10} L${cx - 12},${top + 10} M${r - 10},${top + 10} L${cx + 12},${top + 10}`} stroke="#F1D1A0" strokeWidth={1.4} strokeDasharray="3 3" />
          <path d={`M${l + 10},${top + h * 0.55} Q${l + 18},${bottom - 18} ${cx - 12},${bottom - 18}`} stroke="#F1D1A0" strokeWidth={1.4} strokeDasharray="3 3" fill="none" />
          <path d={`M${r - 10},${top + h * 0.55} Q${r - 18},${bottom - 18} ${cx + 12},${bottom - 18}`} stroke="#F1D1A0" strokeWidth={1.4} strokeDasharray="3 3" fill="none" />
          {/* 交叉皮帶＋扣環（扣環用階級色） */}
          <path d={`M${cx - 8},${top + h * 0.3} L${cx + 8},${top + h * 0.3} M${cx - 8},${top + h * 0.55} L${cx + 8},${top + h * 0.55}`} stroke="#5A3414" strokeWidth={4} strokeLinecap="round" />
          <rect x={cx - 4} y={top + h * 0.3 - 4} width={8} height={8} rx={1.5} fill={m.mid} stroke={INK} strokeWidth={1.2} />
          <rect x={cx - 4} y={top + h * 0.55 - 4} width={8} height={8} rx={1.5} fill={m.mid} stroke={INK} strokeWidth={1.2} />
          {tier >= 3 ? <ChestGem x={l + 18} y={top + h * 0.3} color={m.gem} glow={tier >= 5} small /> : null}
        </g>
      ) : null}

      {type === "spiked" ? (
        <g>
          {/* 尖刺先畫，胸甲蓋在上面 */}
          {[0.08, 0.3, 0.5, 0.7, 0.92].map((fx, i) => {
            const x = l + w * fx;
            const y = top + (i === 0 || i === 4 ? 10 : 2);
            return <path key={fx} d={`M${x - 5},${y + 4} L${x},${y - 12} L${x + 5},${y + 4} Z`} fill={m.hi} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />;
          })}
          {[0.25, 0.55].map((fy) => (
            <g key={fy}>
              <path d={`M${l + 6},${top + h * fy - 5} L${l - 10},${top + h * fy} L${l + 6},${top + h * fy + 5} Z`} fill={m.hi} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
              <path d={`M${r - 6},${top + h * fy - 5} L${r + 10},${top + h * fy} L${r - 6},${top + h * fy + 5} Z`} fill={m.hi} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
            </g>
          ))}
          <path
            d={`M${l + 6},${top + 6} Q${cx},${top - 4} ${r - 6},${top + 6} L${r - 4},${top + h * 0.6} Q${cx},${bottom} ${l + 4},${top + h * 0.6} Z`}
            fill={`url(#${id}-dark)`}
            {...inkProps}
          />
          {/* 階級色的鑲邊 */}
          <path d={`M${l + 10},${top + 9} Q${cx},${top} ${r - 10},${top + 9}`} stroke={m.mid} strokeWidth={3} fill="none" strokeLinecap="round" />
          <path d={`M${l + 8},${top + h * 0.6} Q${cx},${bottom - 4} ${r - 8},${top + h * 0.6}`} stroke={m.mid} strokeWidth={3} fill="none" strokeLinecap="round" />
          {/* 胸口三根小刺 */}
          {[-12, 0, 12].map((dx) => (
            <path key={dx} d={`M${cx + dx - 3},${top + h * 0.45} L${cx + dx},${top + h * 0.45 - 9} L${cx + dx + 3},${top + h * 0.45} Z`} fill={m.hi} stroke={INK} strokeWidth={1.2} />
          ))}
          {gem}
        </g>
      ) : null}

      {type === "robe" ? (
        <g>
          {/* 長袍：從胸口一路蓋到腳邊，下擺有波浪 */}
          <path
            d={`M${l + 2},${top + 4} Q${cx},${top - 4} ${r - 2},${top + 4} L${r + 8},${bottom + 8} Q${r - 6},${bottom + 2} ${cx + w * 0.2},${bottom + 9} Q${cx},${bottom + 2} ${cx - w * 0.2},${bottom + 9} Q${l + 6},${bottom + 2} ${l - 8},${bottom + 8} Z`}
            fill={`url(#${id}-cloth)`}
            {...inkProps}
          />
          {/* 前襟的金邊 */}
          <path d={`M${cx},${top + 2} L${cx},${bottom + 4}`} stroke="#F5C542" strokeWidth={4} />
          <path d={`M${cx},${top + 2} L${cx},${bottom + 4}`} stroke={INK} strokeWidth={1} opacity={0.4} />
          {/* 下擺金邊 */}
          <path
            d={`M${l - 6},${bottom + 5} Q${l + 6},${bottom - 1} ${cx - w * 0.2},${bottom + 6} Q${cx},${bottom - 1} ${cx + w * 0.2},${bottom + 6} Q${r - 6},${bottom - 1} ${r + 6},${bottom + 5}`}
            stroke="#F5C542"
            strokeWidth={3}
            fill="none"
          />
          {/* 腰帶 */}
          <path d={`M${l + 4},${top + h * 0.5} Q${cx},${top + h * 0.6} ${r - 4},${top + h * 0.5}`} stroke="#7A2A2A" strokeWidth={6} fill="none" strokeLinecap="round" />
          <path d={`M${cx + 6},${top + h * 0.56} q4,10 -2,18 M${cx + 10},${top + h * 0.55} q8,8 4,18`} stroke="#7A2A2A" strokeWidth={3} fill="none" strokeLinecap="round" />
          {/* 布的皺褶 */}
          <path d={`M${l + 14},${top + h * 0.7} Q${l + 16},${bottom - 4} ${l + 10},${bottom + 4} M${r - 14},${top + h * 0.7} Q${r - 16},${bottom - 4} ${r - 10},${bottom + 4}`} stroke={m.lo} strokeWidth={1.6} fill="none" opacity={0.6} />
          {tier >= 3 ? <ChestGem x={cx} y={top + h * 0.28} color={m.gem} glow={tier >= 5} small /> : null}
        </g>
      ) : null}
    </g>
  );
}

function ChestGem({ x, y, color, glow, small = false }: { x: number; y: number; color: string; glow: boolean; small?: boolean }) {
  const r = small ? 4.5 : 6;
  return (
    <g>
      {glow ? <circle cx={x} cy={y} r={r * 2.4} fill={color} opacity={0.35} className="gem-adularescence" /> : null}
      <path d={`M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`} fill={color} stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={`M${x - r * 0.4},${y - r * 0.2} L${x},${y - r * 0.7}`} stroke="#FFFFFF" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}
