// src/components/pet/rig/props.tsx
"use client";

/**
 * 各職共用的道具零件（參考原圖的畫風重畫）
 * ------------------------------------------------------------
 *   PropDefs       共用漸層：金屬金、銀盔、木頭、紅披風、藍布、象灰、馬棕
 *   GoldWheel      金色車輪（輻條、輪轂、輪框高光）
 *   WoodWheel      木頭車輪（炮兵的炮車）
 *   PawPanel       藍底金框、白色腳印圖案的車身面板（原圖的招牌圖案）
 *   PawFlag        藍色燕尾旗＋金邊＋腳印
 *   CastleTop      金色小城垛（車尾、象轎上的那座小塔）
 *   WingedHelmet   銀色翅膀頭盔＋紅色羽冠＋中間菱形金寶石（戰車、仕官、將軍）
 *   PlumeHelmet    金色頭盔＋紫色羽毛＋紅寶石（馬伕、巨象）
 *   ChickHead      小雞的頭（黃色圓臉＋兩頰蓬毛）
 *   Scarf          藍色領巾（白色紋路）
 *   Cape           紅披風＋白毛邊
 *
 * 全部用 parts.tsx 的墨線（INK / inkProps），8 職筆觸一致。
 */

import { Fluffy, INK, inkProps } from "@/components/pet/rig/parts";

export function PropDefs({ uid }: { uid: string }) {
  return (
    <>
      <linearGradient id={`${uid}-gold`} x1="0.1" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#FFF3B0" />
        <stop offset="35%" stopColor="#F2C14A" />
        <stop offset="75%" stopColor="#C88A1E" />
        <stop offset="100%" stopColor="#8A5A0E" />
      </linearGradient>
      <linearGradient id={`${uid}-goldV`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#FFF0A0" />
        <stop offset="45%" stopColor="#E8B33C" />
        <stop offset="100%" stopColor="#9A6614" />
      </linearGradient>
      <linearGradient id={`${uid}-silver`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#FFFFFF" />
        <stop offset="40%" stopColor="#CFD6E0" />
        <stop offset="100%" stopColor="#7C8696" />
      </linearGradient>
      <linearGradient id={`${uid}-wood`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#D9A060" />
        <stop offset="55%" stopColor="#A86A30" />
        <stop offset="100%" stopColor="#6E4018" />
      </linearGradient>
      <linearGradient id={`${uid}-red`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#F2504A" />
        <stop offset="60%" stopColor="#C42A2A" />
        <stop offset="100%" stopColor="#7E1414" />
      </linearGradient>
      <linearGradient id={`${uid}-blue`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#8CC8F0" />
        <stop offset="60%" stopColor="#4E9AD4" />
        <stop offset="100%" stopColor="#2E6EA6" />
      </linearGradient>
      <linearGradient id={`${uid}-purple`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#C6A2F2" />
        <stop offset="55%" stopColor="#8E5FD0" />
        <stop offset="100%" stopColor="#5A3492" />
      </linearGradient>
      <linearGradient id={`${uid}-grey`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#E2E2E6" />
        <stop offset="50%" stopColor="#B4B4BC" />
        <stop offset="100%" stopColor="#7E7E88" />
      </linearGradient>
      <linearGradient id={`${uid}-horse`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#F6D79A" />
        <stop offset="55%" stopColor="#D9A55A" />
        <stop offset="100%" stopColor="#A06A2A" />
      </linearGradient>
      <linearGradient id={`${uid}-mane`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#B07040" />
        <stop offset="100%" stopColor="#6A3A18" />
      </linearGradient>
      <linearGradient id={`${uid}-gun`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#9AA0AC" />
        <stop offset="40%" stopColor="#5E6470" />
        <stop offset="100%" stopColor="#2A2E36" />
      </linearGradient>
      <linearGradient id={`${uid}-armyGreen`} x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#8EA060" />
        <stop offset="50%" stopColor="#5E7038" />
        <stop offset="100%" stopColor="#36441E" />
      </linearGradient>
      <linearGradient id={`${uid}-tunic`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#7FA85A" />
        <stop offset="100%" stopColor="#3E6A2E" />
      </linearGradient>
      <radialGradient id={`${uid}-gemRed`} cx="35%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#FFD0C8" />
        <stop offset="45%" stopColor="#E8322E" />
        <stop offset="100%" stopColor="#7A0C0C" />
      </radialGradient>
      <radialGradient id={`${uid}-gemOrange`} cx="35%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#FFF2C0" />
        <stop offset="45%" stopColor="#F59A1E" />
        <stop offset="100%" stopColor="#9A4A06" />
      </radialGradient>
    </>
  );
}

/** 金色車輪：外框＋8 根輻條＋輪轂。spin 用 rotate 轉的時候以 (cx,cy) 為中心 */
export function GoldWheel({ cx, cy, r, uid, spokes = 8 }: { cx: number; cy: number; r: number; uid: string; spokes?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-gold)`} {...inkProps} />
      <circle cx={cx} cy={cy} r={r * 0.78} fill="#7A4E12" stroke={INK} strokeWidth={1.6} />
      {Array.from({ length: spokes }, (_, i) => {
        const a = (i / spokes) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M${cx + Math.cos(a) * r * 0.2},${cy + Math.sin(a) * r * 0.2} L${cx + Math.cos(a) * r * 0.78},${cy + Math.sin(a) * r * 0.78}`}
            stroke={`url(#${uid}-goldV)`}
            strokeWidth={r * 0.14}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.24} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
      <circle cx={cx} cy={cy} r={r * 0.09} fill="#7A4E12" />
      <path d={`M${cx - r * 0.75},${cy - r * 0.45} A${r * 0.9},${r * 0.9} 0 0 1 ${cx - r * 0.1},${cy - r * 0.88}`} stroke="#FFF6CC" strokeWidth={2.2} fill="none" opacity={0.8} strokeLinecap="round" />
    </g>
  );
}

/** 木頭車輪（炮車） */
export function WoodWheel({ cx, cy, r, uid }: { cx: number; cy: number; r: number; uid: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-wood)`} {...inkProps} />
      <circle cx={cx} cy={cy} r={r * 0.74} fill="#5A3412" stroke={INK} strokeWidth={1.4} />
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <path
            key={i}
            d={`M${cx},${cy} L${cx + Math.cos(a) * r * 0.74},${cy + Math.sin(a) * r * 0.74}`}
            stroke="#C88A48"
            strokeWidth={r * 0.18}
            strokeLinecap="round"
          />
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.3} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.6} />
      {/* 鐵釘 */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        return <circle key={i} cx={cx + Math.cos(a) * r * 0.88} cy={cy + Math.sin(a) * r * 0.88} r={1.4} fill="#3E2A1E" />;
      })}
    </g>
  );
}

/** 腳印圖案（白色），原圖車身、領巾上都有 */
export function Paw({ x, y, s = 1, fill = "#FFFFFF" }: { x: number; y: number; s?: number; fill?: string }) {
  return (
    <g fill={fill}>
      <ellipse cx={x} cy={y + 2 * s} rx={5 * s} ry={4.2 * s} />
      <circle cx={x - 5.5 * s} cy={y - 4 * s} r={2.2 * s} />
      <circle cx={x - 1.8 * s} cy={y - 6.5 * s} r={2.2 * s} />
      <circle cx={x + 2.2 * s} cy={y - 6.5 * s} r={2.2 * s} />
      <circle cx={x + 5.8 * s} cy={y - 4 * s} r={2.2 * s} />
    </g>
  );
}

/** 藍底金框、白腳印的車身面板 */
export function PawPanel({ x, y, w, h, uid }: { x: number; y: number; w: number; h: number; uid: string }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={`url(#${uid}-gold)`} {...inkProps} />
      <path
        d={`M${x + 4},${y + 4} L${x + w - 4},${y + 4} L${x + w - 4},${y + h - 8} Q${x + w / 2},${y + h + 2} ${x + 4},${y + h - 8} Z`}
        fill={`url(#${uid}-blue)`}
        stroke={INK}
        strokeWidth={1.4}
      />
      <Paw x={x + w / 2} y={y + h / 2} s={Math.min(w, h) / 26} />
    </g>
  );
}

/** 藍色燕尾旗＋金邊＋腳印。旗桿從 (px,top) 往下到 bottom，旗面往左飄 */
export function PawFlag({ px, top, bottom, uid, flip = false, flagRef }: { px: number; top: number; bottom: number; uid: string; flip?: boolean; flagRef?: (el: SVGGElement | null) => void }) {
  const dir = flip ? 1 : -1;
  const w = 44;
  return (
    <g>
      <rect x={px - 2.5} y={top} width={5} height={bottom - top} rx={2} fill={`url(#${uid}-goldV)`} {...inkProps} strokeWidth={1.8} />
      <path d={`M${px},${top - 12} L${px + 4},${top - 2} L${px - 4},${top - 2} Z`} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.6} />
      <circle cx={px} cy={top} r={3.6} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.6} />
      <g ref={flagRef} style={{ transformOrigin: `${px}px ${top + 14}px`, transformBox: "view-box" }}>
        <path
          d={`M${px},${top + 6} L${px + dir * w},${top + 4} L${px + dir * (w - 10)},${top + 18} L${px + dir * w},${top + 32} L${px},${top + 30} Z`}
          fill={`url(#${uid}-blue)`}
          {...inkProps}
        />
        <path d={`M${px},${top + 8} L${px + dir * (w - 2)},${top + 6}`} stroke="#F2C14A" strokeWidth={3} />
        <path d={`M${px},${top + 28} L${px + dir * (w - 4)},${top + 30}`} stroke="#F2C14A" strokeWidth={3} />
        <Paw x={px + dir * 18} y={top + 19} s={0.6} />
        <circle cx={px + dir * 30} cy={top + 15} r={1.6} fill="#FFFFFF" />
        <circle cx={px + dir * 30} cy={top + 23} r={1.6} fill="#FFFFFF" />
      </g>
    </g>
  );
}

/** 金色小城垛 */
export function CastleTop({ x, y, w, h, uid }: { x: number; y: number; w: number; h: number; uid: string }) {
  const n = 3;
  const mw = w / (n * 2 - 1);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${uid}-gold)`} {...inkProps} />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={x + i * mw * 2} y={y - mw * 0.9} width={mw} height={mw} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
      ))}
      <rect x={x + w / 2 - 3} y={y + h * 0.35} width={6} height={h * 0.4} rx={3} fill="#7A4E12" stroke={INK} strokeWidth={1.2} />
      <path d={`M${x + 3},${y + 3} L${x + 3},${y + h - 3}`} stroke="#FFF6CC" strokeWidth={2} opacity={0.7} strokeLinecap="round" />
    </g>
  );
}

/** 小雞的頭：圓臉＋兩頰蓬毛（臉、帽子另外疊） */
export function ChickHead({ cx, cy, rx, ry, uid }: { cx: number; cy: number; rx: number; ry: number; uid: string }) {
  return (
    <g>
      {[-1, 1].map((side) => (
        <g key={side}>
          {[0, 1].map((k) => {
            const x = cx + side * (rx + 1);
            const y = cy + 4 + k * 11;
            return (
              <path
                key={k}
                d={`M${x - side * 6},${y - 6} Q${x + side * 2},${y - 3} ${x + side * 5},${y} Q${x + side * 1},${y + 2} ${x - side * 5},${y + 5} Z`}
                fill="#FFE94A"
                stroke={INK}
                strokeWidth={1.5}
                strokeLinejoin="round"
              />
            );
          })}
        </g>
      ))}
      <Fluffy uid={uid} ellipse={[cx, cy, rx, ry]} />
      <ellipse cx={cx - rx * 0.3} cy={cy - ry * 0.1} rx={rx * 0.35} ry={ry * 0.2} fill="#FFFDE0" opacity={0.35} />
    </g>
  );
}

/** 藍色領巾：繞脖子＋右下垂一角 */
export function Scarf({ cx, y, w, uid, tail = 1 }: { cx: number; y: number; w: number; uid: string; tail?: number }) {
  const l = cx - w / 2;
  const r = cx + w / 2;
  return (
    <g>
      <path d={`M${l},${y - 4} C${l + w * 0.2},${y + 6} ${r - w * 0.2},${y + 6} ${r},${y - 6} L${r + 2},${y + 4} C${r - w * 0.2},${y + 16} ${l + w * 0.2},${y + 16} ${l - 2},${y + 6} Z`} fill={`url(#${uid}-blue)`} {...inkProps} />
      <path
        d={`M${cx - w * 0.12},${y + 10} C${cx + w * 0.12},${y + 12} ${r - w * 0.1},${y + 8} ${r},${y} C${r - 2},${y + 18 * tail} ${r - w * 0.18},${y + 30 * tail} ${cx + w * 0.16},${y + 38 * tail} C${cx + w * 0.04},${y + 28 * tail} ${cx - w * 0.06},${y + 18 * tail} ${cx - w * 0.12},${y + 10} Z`}
        fill={`url(#${uid}-blue)`}
        {...inkProps}
      />
      <g fill="#FFFFFF" opacity={0.95}>
        <circle cx={cx + w * 0.16} cy={y + 20 * tail} r={3} />
        <circle cx={cx + w * 0.08} cy={y + 14 * tail} r={1.6} />
        <circle cx={cx + w * 0.16} cy={y + 12 * tail} r={1.6} />
        <circle cx={cx + w * 0.24} cy={y + 14 * tail} r={1.6} />
        <circle cx={cx - w * 0.3} cy={y + 6} r={1.8} />
        <circle cx={cx - w * 0.1} cy={y + 8} r={1.8} />
      </g>
    </g>
  );
}

/**
 * 銀色翅膀頭盔：圓頂＋兩側銀翅＋紅色羽冠＋中間菱形金寶石
 * cx,cy = 頭盔圓頂中心底邊；w = 頭盔寬
 */
export function WingedHelmet({ cx, base, w, uid }: { cx: number; base: number; w: number; uid: string }) {
  const h = w * 0.44;
  const l = cx - w / 2;
  const r = cx + w / 2;
  const top = base - h * 1.05;
  return (
    <g>
      {/* 紅色羽冠：像羅馬頭盔那樣，從額頭沿著頭頂刷到後腦 */}
      <path
        d={`M${cx - w * 0.3},${top + w * 0.06} C${cx - w * 0.34},${top - w * 0.3} ${cx + w * 0.3},${top - w * 0.42} ${cx + w * 0.5},${top + w * 0.02} C${cx + w * 0.3},${top - w * 0.14} ${cx - w * 0.08},${top - w * 0.12} ${cx - w * 0.16},${top + w * 0.1} Z`}
        fill={`url(#${uid}-red)`}
        {...inkProps}
      />
      {[-0.22, -0.08, 0.06, 0.2, 0.34].map((t, i) => (
        <path key={i} d={`M${cx + w * t},${top - w * 0.02} L${cx + w * (t + 0.04)},${top - w * (0.26 - Math.abs(t - 0.06) * 0.35)}`} stroke="#8E1414" strokeWidth={1.4} opacity={0.55} strokeLinecap="round" />
      ))}
      {/* 兩側銀翅：像小天使翅膀往外上方張開，下緣三片羽毛 */}
      {[-1, 1].map((side) => {
        const rx = side < 0 ? l + 5 : r - 5;
        const ox = (v: number) => rx + side * v;
        return (
          <g key={side}>
            <path
              d={`M${ox(0)},${base - h * 0.8} C${ox(w * 0.1)},${base - h * 1.1} ${ox(w * 0.2)},${base - h * 1.25} ${ox(w * 0.3)},${base - h * 1.3} Q${ox(w * 0.26)},${base - h * 0.98} ${ox(w * 0.22)},${base - h * 0.9} Q${ox(w * 0.24)},${base - h * 0.74} ${ox(w * 0.16)},${base - h * 0.66} Q${ox(w * 0.17)},${base - h * 0.48} ${ox(w * 0.08)},${base - h * 0.44} Q${ox(w * 0.06)},${base - h * 0.28} ${ox(0)},${base - h * 0.24} Z`}
              fill={`url(#${uid}-silver)`}
              {...inkProps}
              strokeWidth={2}
            />
            <path d={`M${ox(w * 0.04)},${base - h * 0.62} Q${ox(w * 0.14)},${base - h * 0.95} ${ox(w * 0.26)},${base - h * 1.18}`} stroke="#8C96A6" strokeWidth={1.2} fill="none" opacity={0.8} />
            <path d={`M${ox(w * 0.04)},${base - h * 0.42} Q${ox(w * 0.1)},${base - h * 0.6} ${ox(w * 0.15)},${base - h * 0.7}`} stroke="#8C96A6" strokeWidth={1.2} fill="none" opacity={0.8} />
          </g>
        );
      })}
      {/* 圓頂 */}
      <path d={`M${l},${base} C${l},${base - h * 1.4} ${r},${base - h * 1.4} ${r},${base} Z`} fill={`url(#${uid}-silver)`} {...inkProps} />
      <path d={`M${l + w * 0.12},${base - h * 0.5} C${l + w * 0.2},${base - h * 0.9} ${cx - w * 0.1},${base - h * 1.0} ${cx},${base - h * 1.02}`} stroke="#FFFFFF" strokeWidth={2.4} fill="none" opacity={0.7} strokeLinecap="round" />
      {/* 金色帽沿 */}
      <path d={`M${l - 3},${base - 2} Q${cx},${base - 10} ${r + 3},${base - 2} L${r + 3},${base + 7} Q${cx},${base - 1} ${l - 3},${base + 7} Z`} fill={`url(#${uid}-gold)`} {...inkProps} />
      {/* 中間菱形金框＋寶石 */}
      <path d={`M${cx},${base - h * 1.0} L${cx + w * 0.1},${base - h * 0.45} L${cx},${base + 5} L${cx - w * 0.1},${base - h * 0.45} Z`} fill={`url(#${uid}-gold)`} {...inkProps} />
      <path d={`M${cx},${base - h * 0.8} L${cx + w * 0.06},${base - h * 0.42} L${cx},${base - h * 0.04} L${cx - w * 0.06},${base - h * 0.42} Z`} fill={`url(#${uid}-gemOrange)`} stroke={INK} strokeWidth={1.2} />
    </g>
  );
}

/** 金色頭盔＋紫色羽毛＋紅寶石＋兩側護頰 */
export function PlumeHelmet({ cx, base, w, uid }: { cx: number; base: number; w: number; uid: string }) {
  const h = w * 0.55;
  const l = cx - w / 2;
  const r = cx + w / 2;
  return (
    <g>
      {/* 紫羽毛，從頂上往後垂 */}
      {/* 蓬鬆的大羽毛：三層羽片疊起來 */}
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${cx - w * 0.12 + i * 4},${base - h + 4} C${cx - w * 0.3 + i * 6},${base - h - w * (0.45 - i * 0.06)} ${cx + w * (0.25 + i * 0.08)},${base - h - w * (0.5 - i * 0.08)} ${cx + w * (0.58 + i * 0.06)},${base - h * (0.7 - i * 0.12)} C${cx + w * 0.42},${base - h * 0.8} ${cx + w * 0.28},${base - h * 0.86} ${cx + w * 0.14},${base - h * 0.9} Z`}
          fill={`url(#${uid}-purple)`}
          {...inkProps}
          strokeWidth={i === 0 ? 2.6 : 1.8}
          opacity={i === 0 ? 1 : 0.92}
        />
      ))}
      {[0.05, 0.18, 0.3].map((t, i) => (
        <path key={i} d={`M${cx + w * t},${base - h - w * 0.08} Q${cx + w * (t + 0.12)},${base - h - w * 0.18} ${cx + w * (t + 0.24)},${base - h * 0.95}`} stroke="#4A2878" strokeWidth={1.3} fill="none" opacity={0.6} />
      ))}
      {/* 護頰（臉兩側往下） */}
      {[-1, 1].map((side) => {
        const x = side < 0 ? l : r;
        return (
          <path
            key={side}
            d={`M${x},${base - 4} L${x - side * 2},${base + h * 0.7} Q${x - side * 10},${base + h * 0.85} ${x - side * 12},${base + h * 0.4} L${x - side * 10},${base - 2} Z`}
            fill={`url(#${uid}-gold)`}
            {...inkProps}
          />
        );
      })}
      {/* 圓頂 */}
      <path d={`M${l},${base} C${l - 2},${base - h * 1.3} ${r + 2},${base - h * 1.3} ${r},${base} Z`} fill={`url(#${uid}-gold)`} {...inkProps} />
      <path d={`M${cx},${base - h * 0.98} L${cx},${base}`} stroke="#9A6614" strokeWidth={2} opacity={0.7} />
      <path d={`M${l + w * 0.14},${base - h * 0.45} C${l + w * 0.2},${base - h * 0.8} ${cx - w * 0.12},${base - h * 0.92} ${cx - w * 0.02},${base - h * 0.94}`} stroke="#FFF6CC" strokeWidth={2.4} fill="none" opacity={0.75} strokeLinecap="round" />
      {/* 帽沿 */}
      <rect x={l - 3} y={base - 5} width={w + 6} height={9} rx={4.5} fill={`url(#${uid}-goldV)`} {...inkProps} />
      {/* 紅寶石 */}
      <circle cx={cx} cy={base - h * 0.62} r={w * 0.07} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.6} />
      <circle cx={cx} cy={base - h * 0.62} r={w * 0.045} fill={`url(#${uid}-gemRed)`} />
    </g>
  );
}

/** 紅披風（白色毛邊）：從肩膀 (x,y) 往左下披下來，len 是長度 */
export function Cape({ x, y, len, w, uid }: { x: number; y: number; len: number; w: number; uid: string }) {
  return (
    <g>
      <path
        d={`M${x + w * 0.3},${y} C${x - w * 0.4},${y + len * 0.1} ${x - w * 0.9},${y + len * 0.55} ${x - w * 0.8},${y + len} C${x - w * 0.4},${y + len * 0.96} ${x},${y + len * 1.02} ${x + w * 0.4},${y + len * 0.95} C${x + w * 0.2},${y + len * 0.6} ${x + w * 0.3},${y + len * 0.3} ${x + w * 0.5},${y + len * 0.1} Z`}
        fill={`url(#${uid}-red)`}
        {...inkProps}
      />
      <path d={`M${x - w * 0.55},${y + len * 0.35} Q${x - w * 0.6},${y + len * 0.7} ${x - w * 0.45},${y + len * 0.95}`} stroke="#7E1414" strokeWidth={1.6} fill="none" opacity={0.6} />
      <path d={`M${x - w * 0.15},${y + len * 0.25} Q${x - w * 0.2},${y + len * 0.65} ${x - w * 0.05},${y + len * 0.97}`} stroke="#7E1414" strokeWidth={1.6} fill="none" opacity={0.6} />
      {/* 白色毛邊（肩膀一圈蓬蓬的） */}
      <path
        d={`M${x - w * 0.55},${y + 4} C${x - w * 0.45},${y - 8} ${x + w * 0.1},${y - 10} ${x + w * 0.55},${y - 2} C${x + w * 0.6},${y + 6} ${x + w * 0.5},${y + 12} ${x + w * 0.35},${y + 12} C${x},${y + 6} ${x - w * 0.4},${y + 14} ${x - w * 0.58},${y + 12} Z`}
        fill="#FFFFFF"
        {...inkProps}
      />
      <g fill="#3E2A1E" opacity={0.75}>
        <ellipse cx={x - w * 0.3} cy={y + 2} rx={1.4} ry={2.2} />
        <ellipse cx={x + w * 0.05} cy={y} rx={1.4} ry={2.2} />
        <ellipse cx={x + w * 0.32} cy={y + 3} rx={1.4} ry={2.2} />
      </g>
    </g>
  );
}
