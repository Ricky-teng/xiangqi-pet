// src/components/battle/BattleBackdrop.tsx
"use client";

/**
 * 戰鬥場景背景（純 SVG，依塔的屬性換場景）
 * ------------------------------------------------------------
 * 由遠到近七層：
 *   天空漸層 → 太陽／月亮 → 光束 → 飄移雲霧 → 遠山＋遠方的塔
 *   → 近景道具（每種屬性不同） → 地面（透視線＋舞台光）→ 暗角
 *
 * 「遠方的塔」每一關都在：學生在爬塔，背景裡就該看得到那座塔，
 * 塔頂窗戶亮著該塔的點綴色。戰隊對戰沒有塔，換成競技場看台。
 *
 * 地形用固定種子的亂數產生（種子 = 塔號），同一座塔每次看到的
 * 山形都一樣，不會每打一關背景就變一次。
 *
 * 整張圖 memo 起來，戰鬥中幾百次 state 更新都不會重畫背景。
 */

import { memo, useId, useMemo } from "react";
import { getTowerArt, mixColor, withAlpha, type TowerArt } from "@/components/battle/towerArt";

/** 地平線在畫面高度的比例。BattleStage 依這個放單位、算地面 */
export const HORIZON_RATIO = 0.62;

const W = 400;
const H = 250;
const HORIZON = H * HORIZON_RATIO;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 產生一條起伏的山稜線 path（底部封到 baseY） */
function ridgePath(rng: () => number, baseY: number, minY: number, maxY: number, steps: number, sharp: boolean): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * (W + 40) - 20;
    pts.push([x, minY + rng() * (maxY - minY)]);
  }
  let d = `M-20,${baseY} L${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (sharp) {
      d += ` L${x},${y}`;
    } else {
      const [px, py] = pts[i - 1];
      const mx = (px + x) / 2;
      d += ` Q${px},${py} ${mx},${(py + y) / 2}`;
    }
  }
  d += ` L${W + 20},${baseY} Z`;
  return d;
}

interface BattleBackdropProps {
  tower?: number | null;
  /** 戰鬥失敗時整個場景轉灰（由外層控制） */
  className?: string;
}

function BattleBackdropInner({ tower, className }: BattleBackdropProps) {
  const art = getTowerArt(tower);
  const raw = useId();
  const uid = `bg${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const seed = (tower ?? 99) * 7919;

  const shapes = useMemo(() => {
    const rng = mulberry32(seed);
    const sharp = ["frost", "fire", "thunder", "shadow", "bloodmoon"].includes(art.element);
    return {
      far: ridgePath(rng, HORIZON + 4, HORIZON - 70, HORIZON - 26, 9, sharp),
      mid: ridgePath(rng, HORIZON + 4, HORIZON - 34, HORIZON - 8, 14, sharp),
      clouds: Array.from({ length: 7 }, () => ({
        x: rng() * W,
        y: 18 + rng() * (HORIZON * 0.45),
        rx: 26 + rng() * 40,
        ry: 6 + rng() * 9,
      })),
      towerX: 250 + rng() * 60,
      rngProps: mulberry32(seed + 1),
    };
  }, [seed, art.element]);

  const ids = {
    sky: `${uid}-sky`,
    ground: `${uid}-ground`,
    sun: `${uid}-sun`,
    vignette: `${uid}-vig`,
    spot: `${uid}-spot`,
    fog: `${uid}-fog`,
    ray: `${uid}-ray`,
  };

  const isDark = ["water", "forest", "fire", "thunder", "shadow", "bloodmoon", "celestial", "arena"].includes(art.element);
  const cloudColor = isDark ? mixColor(art.skyTop, art.skyBottom, 0.75) : mixColor(art.skyBottom, "#FFFFFF", 0.6);
  // 遠景往天空色靠（大氣透視）
  const farColor = mixColor(art.farSilhouette, art.skyBottom, 0.35);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMax slice"
      className={className}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={ids.sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={art.skyTop} />
          <stop offset="100%" stopColor={art.skyBottom} />
        </linearGradient>
        <linearGradient id={ids.ground} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={art.groundTop} />
          <stop offset="100%" stopColor={art.groundBottom} />
        </linearGradient>
        <radialGradient id={ids.sun} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={art.celestialGlow ?? "#FFFFFF"} stopOpacity="0.95" />
          <stop offset="30%" stopColor={art.celestialGlow ?? "#FFFFFF"} stopOpacity="0.45" />
          <stop offset="100%" stopColor={art.celestialGlow ?? "#FFFFFF"} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.spot} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={isDark ? 0.2 : 0.28} />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={ids.vignette} cx="50%" cy="46%" r="72%">
          <stop offset="60%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity={isDark ? 0.62 : 0.38} />
        </radialGradient>
        <linearGradient id={ids.fog} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={art.skyBottom} stopOpacity="0" />
          <stop offset="70%" stopColor={art.skyBottom} stopOpacity="0.55" />
          <stop offset="100%" stopColor={art.skyBottom} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={ids.ray} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={art.celestialGlow ?? "#FFFFFF"} stopOpacity="0.5" />
          <stop offset="100%" stopColor={art.celestialGlow ?? "#FFFFFF"} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 1. 天空 */}
      <rect x={0} y={0} width={W} height={H} fill={`url(#${ids.sky})`} />

      {/* 2. 太陽／月亮 */}
      <Celestial art={art} sunId={ids.sun} />

      {/* 3. 光束（亮色場景才有，暗色場景光束會讓畫面變髒） */}
      {art.celestialGlow && !["shadow", "bloodmoon", "thunder", "arena"].includes(art.element) ? (
        <g className="bg-rays" style={{ transformOrigin: "300px 0px" }}>
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M${290 + i * 6},0 L${180 + i * 52},${HORIZON} L${210 + i * 52},${HORIZON} L${296 + i * 6},0 Z`}
              fill={`url(#${ids.ray})`}
              opacity={0.22 - i * 0.03}
            />
          ))}
        </g>
      ) : null}

      {/* 4. 飄移的雲／霧（兩份並排，往左捲一半剛好無縫接上） */}
      <g className="bg-drift">
        {[0, W].map((offset) => (
          <g key={offset} transform={`translate(${offset} 0)`} opacity={isDark ? 0.45 : 0.75}>
            {shapes.clouds.map((c, i) => (
              <g key={i}>
                <ellipse cx={c.x} cy={c.y} rx={c.rx} ry={c.ry} fill={cloudColor} />
                <ellipse cx={c.x - c.rx * 0.35} cy={c.y - c.ry * 0.6} rx={c.rx * 0.5} ry={c.ry * 0.9} fill={cloudColor} />
              </g>
            ))}
          </g>
        ))}
      </g>

      {/* 5. 遠山＋遠方的塔 */}
      <path d={shapes.far} fill={farColor} />
      {art.element === "arena" ? (
        <ArenaStands art={art} />
      ) : (
        <DistantTower art={art} x={shapes.towerX} />
      )}
      <path d={shapes.mid} fill={mixColor(art.nearSilhouette, art.skyBottom, 0.18)} />

      {/* 地平線的霧，把山腳跟地面融在一起 */}
      <rect x={0} y={HORIZON - 26} width={W} height={40} fill={`url(#${ids.fog})`} />

      {/* 6. 地面 */}
      <rect x={0} y={HORIZON} width={W} height={H - HORIZON} fill={`url(#${ids.ground})`} />
      <PerspectiveGrid art={art} />
      <ellipse cx={W / 2} cy={HORIZON + (H - HORIZON) * 0.55} rx={W * 0.48} ry={(H - HORIZON) * 0.42} fill={`url(#${ids.spot})`} />

      {/* 7. 近景道具（左右兩側框住畫面，中間留給戰鬥） */}
      <ForegroundProps art={art} rng={shapes.rngProps} />

      {/* 8. 暗角 */}
      <rect x={0} y={0} width={W} height={H} fill={`url(#${ids.vignette})`} />
    </svg>
  );
}

const BattleBackdrop = memo(BattleBackdropInner);
export default BattleBackdrop;

// ============================================================
// 各層
// ============================================================

function Celestial({ art, sunId }: { art: TowerArt; sunId: string }) {
  if (!art.celestialGlow) {
    // 雷鳴塔：沒有天體，改畫壓低的雷雲
    return (
      <g opacity={0.9}>
        {[40, 140, 250, 350].map((x, i) => (
          <ellipse key={i} cx={x} cy={22 + (i % 2) * 8} rx={80} ry={22} fill={mixColor(art.skyTop, "#000000", 0.3)} />
        ))}
      </g>
    );
  }
  const big = art.element === "bloodmoon";
  const cx = big ? 300 : 316;
  const cy = big ? 64 : 48;
  const r = big ? 36 : art.element === "celestial" ? 14 : 20;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r * 4} fill={`url(#${sunId})`} />
      <circle cx={cx} cy={cy} r={r} fill={mixColor(art.celestialGlow, "#FFFFFF", 0.35)} />
      {big ? (
        // 血月：月面上幾塊暗斑
        <g fill={mixColor(art.celestialGlow, "#000000", 0.35)} opacity={0.45}>
          <circle cx={cx - 10} cy={cy - 6} r={8} />
          <circle cx={cx + 12} cy={cy + 10} r={6} />
          <circle cx={cx + 4} cy={cy - 16} r={4} />
        </g>
      ) : null}
      {art.element === "celestial" ? (
        // 通天塔：弦月
        <circle cx={cx + 6} cy={cy - 4} r={r * 0.92} fill={art.skyTop} />
      ) : null}
    </g>
  );
}

/** 遠方那座塔：上窄下寬的塔身、尖頂、一排會亮的窗 */
function DistantTower({ art, x }: { art: TowerArt; x: number }) {
  const base = HORIZON - 10;
  const top = 40;
  const body = mixColor(art.farSilhouette, art.skyTop, 0.25);
  const edge = mixColor(body, "#FFFFFF", 0.12);
  const floors = 7;
  return (
    <g>
      <path
        d={`M${x - 16},${base} L${x - 9},${top + 26} L${x + 9},${top + 26} L${x + 16},${base} Z`}
        fill={body}
      />
      {/* 塔身的亮邊（受光面） */}
      <path d={`M${x - 9},${top + 26} L${x - 16},${base} L${x - 13},${base} L${x - 7},${top + 26} Z`} fill={edge} />
      {/* 尖頂 */}
      <path d={`M${x - 12},${top + 28} L${x},${top} L${x + 12},${top + 28} Z`} fill={mixColor(body, "#000000", 0.15)} />
      <circle cx={x} cy={top - 2} r={2.4} fill={art.accent} />
      <circle cx={x} cy={top - 2} r={7} fill={art.accent} opacity={0.25} />
      {/* 每層一扇亮窗 */}
      {Array.from({ length: floors }, (_, i) => {
        const y = top + 34 + i * ((base - top - 40) / floors);
        return <rect key={i} x={x - 1.6} y={y} width={3.2} height={4.5} rx={1} fill={art.accent} opacity={0.55 + (i % 2) * 0.3} />;
      })}
    </g>
  );
}

/** 競技場看台：遠景一圈拱門，看台上一排一排的觀眾小點 */
function ArenaStands({ art }: { art: TowerArt }) {
  const wall = mixColor(art.farSilhouette, art.skyBottom, 0.2);
  const arch = mixColor(art.skyTop, "#000000", 0.3);
  const rng = mulberry32(42);
  return (
    <g>
      <rect x={0} y={HORIZON - 64} width={W} height={60} fill={wall} />
      {/* 兩層拱門 */}
      {[0, 1].map((row) =>
        Array.from({ length: 16 }, (_, i) => {
          const x = 8 + i * 25 + row * 12;
          const y = HORIZON - 58 + row * 26;
          return <path key={`${row}-${i}`} d={`M${x},${y + 20} L${x},${y + 8} Q${x + 7},${y} ${x + 14},${y + 8} L${x + 14},${y + 20} Z`} fill={arch} />;
        }),
      )}
      {/* 觀眾：隨機顏色的小點 */}
      {Array.from({ length: 120 }, (_, i) => (
        <circle
          key={i}
          cx={rng() * W}
          cy={HORIZON - 70 + rng() * 10}
          r={1.4}
          fill={["#F5C542", "#E8E2D0", "#C0392B", "#4A7FB5"][Math.floor(rng() * 4)]}
          opacity={0.7}
        />
      ))}
      {/* 頂上的旗子 */}
      {[60, 200, 340].map((x) => (
        <g key={x}>
          <rect x={x} y={HORIZON - 92} width={1.6} height={24} fill={arch} />
          <path d={`M${x + 1.6},${HORIZON - 92} L${x + 16},${HORIZON - 88} L${x + 1.6},${HORIZON - 84} Z`} fill={art.accent} />
        </g>
      ))}
    </g>
  );
}

/** 地面透視線：往地平線中心收束，做出「舞台有深度」的感覺 */
function PerspectiveGrid({ art }: { art: TowerArt }) {
  const line = withAlpha(mixColor(art.groundTop, "#FFFFFF", 0.3), 0.16);
  const vx = W / 2;
  const lines = [];
  for (let i = -8; i <= 8; i++) {
    lines.push(<line key={`v${i}`} x1={vx + i * 8} y1={HORIZON} x2={vx + i * 70} y2={H} stroke={line} strokeWidth={1} />);
  }
  // 橫線愈近愈疏（等比級數）
  for (let i = 1; i <= 6; i++) {
    const y = HORIZON + (H - HORIZON) * Math.pow(i / 6, 1.8);
    lines.push(<line key={`h${i}`} x1={0} y1={y} x2={W} y2={y} stroke={line} strokeWidth={1} />);
  }
  return <g>{lines}</g>;
}

/** 近景：左右兩側的屬性道具，深色剪影＋一點點受光邊 */
function ForegroundProps({ art, rng }: { art: TowerArt; rng: () => number }) {
  const dark = art.nearSilhouette;
  const rim = mixColor(art.nearSilhouette, art.accent === "#FFFFFF" ? art.bodyLight : art.accent, 0.35);

  switch (art.element) {
    case "grass":
      return (
        <g>
          {/* 左右兩坨草叢 */}
          {[
            [0, 1],
            [W, -1],
          ].map(([x0, dir]) => (
            <g key={x0}>
              {Array.from({ length: 9 }, (_, i) => {
                const x = x0 + dir * (i * 7);
                const h = 18 + rng() * 22;
                return (
                  <path
                    key={i}
                    d={`M${x - 4},${H} Q${x + dir * 2},${H - h * 0.6} ${x + dir * 6},${H - h} Q${x + dir * 4},${H - h * 0.5} ${x + 5},${H} Z`}
                    fill={i % 2 ? art.groundBottom : mixColor(art.groundTop, art.groundBottom, 0.4)}
                  />
                );
              })}
            </g>
          ))}
          {/* 幾朵小花 */}
          {[30, 52, 360, 378].map((x, i) => (
            <circle key={i} cx={x} cy={H - 20 - (i % 2) * 8} r={2.4} fill={i % 2 ? "#FFFFFF" : "#FFD84B"} />
          ))}
        </g>
      );

    case "water":
      return (
        <g>
          {/* 搖曳的海草＋珊瑚 */}
          {[14, 34, 368, 388].map((x, i) => (
            <path
              key={i}
              d={`M${x},${H} C${x - 10},${H - 30} ${x + 12},${H - 50} ${x - 2},${H - 76 + i * 6}`}
              fill="none"
              stroke={i % 2 ? dark : mixColor(dark, art.body, 0.4)}
              strokeWidth={6}
              strokeLinecap="round"
              className="mon-sway"
            />
          ))}
          <path d={`M330,${H} C334,${H - 24} 344,${H - 30} 348,${H - 40} M340,${H - 20} L356,${H - 32}`} stroke="#E86A92" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.85} />
          {/* 水面光紋 */}
          {[0, 1, 2].map((i) => (
            <path key={i} d={`M${40 + i * 120},${18 + i * 6} q20,-6 40,0 t40,0`} stroke="#BFF4FF" strokeWidth={1.4} fill="none" opacity={0.35} />
          ))}
        </g>
      );

    case "sand":
      return (
        <g>
          {/* 仙人掌剪影 */}
          {[
            [26, 1],
            [372, -1],
          ].map(([x, dir]) => (
            <g key={x} fill={dark}>
              <rect x={x - 5} y={H - 70} width={10} height={70} rx={5} />
              <path d={`M${x},${H - 40} q${dir * -16},0 ${dir * -16},-16 v-10`} stroke={dark} strokeWidth={8} strokeLinecap="round" fill="none" />
              <path d={`M${x},${H - 52} q${dir * 14},0 ${dir * 14},-12 v-6`} stroke={dark} strokeWidth={7} strokeLinecap="round" fill="none" />
            </g>
          ))}
          {/* 前景沙丘 */}
          <path d={`M0,${H} Q60,${H - 26} 130,${H - 6} L0,${H} Z`} fill={mixColor(art.groundBottom, "#000000", 0.1)} />
          <path d={`M${W},${H} Q${W - 70},${H - 30} ${W - 140},${H - 4} L${W},${H} Z`} fill={mixColor(art.groundBottom, "#000000", 0.1)} />
        </g>
      );

    case "forest":
      return (
        <g>
          {/* 左右兩棵大樹框住畫面 */}
          {[
            [10, 1],
            [W - 10, -1],
          ].map(([x, dir]) => (
            <g key={x}>
              <path d={`M${x - 12},${H} L${x - 6},${40} L${x + 8},${40} L${x + 14},${H} Z`} fill={dark} />
              <ellipse cx={x + dir * 10} cy={30} rx={50} ry={34} fill={dark} />
              <ellipse cx={x + dir * 34} cy={54} rx={30} ry={20} fill={mixColor(dark, art.groundTop, 0.3)} />
              <path d={`M${x + 8},60 Q${x + dir * 30},90 ${x + dir * 24},130`} stroke={mixColor(dark, "#000000", 0.2)} strokeWidth={3} fill="none" />
            </g>
          ))}
          {/* 發光蘑菇 */}
          {[48, 60, 346].map((x, i) => (
            <g key={i}>
              <rect x={x - 1.5} y={H - 14} width={3} height={8} fill="#F4F0E0" />
              <ellipse cx={x} cy={H - 15} rx={6} ry={4} fill={art.accent} />
              <ellipse cx={x} cy={H - 15} rx={12} ry={8} fill={art.accent} opacity={0.18} />
            </g>
          ))}
        </g>
      );

    case "fire":
      return (
        <g>
          {/* 鋸齒火山岩 */}
          <path d={`M0,${H} L0,${H - 60} L18,${H - 44} L28,${H - 78} L44,${H - 36} L60,${H} Z`} fill={dark} />
          <path d={`M${W},${H} L${W},${H - 70} L${W - 20},${H - 50} L${W - 34},${H - 86} L${W - 52},${H - 40} L${W - 70},${H} Z`} fill={dark} />
          {/* 熔岩裂縫（發光） */}
          {[
            `M0,${H - 10} L40,${H - 18} L80,${H - 8} L130,${H - 16}`,
            `M${W},${H - 12} L${W - 50},${H - 20} L${W - 90},${H - 10}`,
            `M150,${HORIZON + 30} L190,${HORIZON + 36} L230,${HORIZON + 28}`,
          ].map((d, i) => (
            <g key={i}>
              <path d={d} stroke={art.accent} strokeWidth={6} fill="none" opacity={0.25} />
              <path d={d} stroke="#FFE07A" strokeWidth={1.8} fill="none" />
            </g>
          ))}
        </g>
      );

    case "frost":
      return (
        <g>
          {/* 冰柱叢 */}
          {[
            [0, 1],
            [W, -1],
          ].map(([x0, dir]) => (
            <g key={x0}>
              {Array.from({ length: 5 }, (_, i) => {
                const x = x0 + dir * (6 + i * 12);
                const h = 30 + rng() * 50;
                return (
                  <g key={i}>
                    <path d={`M${x - 7},${H} L${x},${H - h} L${x + 7},${H} Z`} fill={i % 2 ? "#E6F7FF" : "#BFE3F7"} />
                    <path d={`M${x},${H - h} L${x + 7},${H} L${x + 2},${H} Z`} fill="#8FC3E3" opacity={0.7} />
                  </g>
                );
              })}
            </g>
          ))}
          {/* 雪堆 */}
          <ellipse cx={W / 2} cy={H + 6} rx={W * 0.6} ry={14} fill="#FFFFFF" opacity={0.55} />
        </g>
      );

    case "thunder":
      return (
        <g>
          {/* 兩根岩柱，柱頂纏著電光 */}
          {[22, W - 22].map((x, i) => (
            <g key={x}>
              <path d={`M${x - 14},${H} L${x - 9},${H - 100} L${x + 9},${H - 106} L${x + 14},${H} Z`} fill={dark} />
              <path d={`M${x - 9},${H - 100} L${x - 4},${H - 100} L${x - 8},${H}  L${x - 14},${H} Z`} fill={rim} opacity={0.4} />
              <path
                d={`M${x - 6},${H - 104} L${x + 2},${H - 116} L${x - 2},${H - 112} L${x + 8},${H - 126}`}
                stroke={art.accent}
                strokeWidth={2}
                fill="none"
                className="mon-zap"
                style={{ animationDelay: `${i * 0.6}s` }}
              />
            </g>
          ))}
        </g>
      );

    case "shadow":
      return (
        <g>
          {/* 扭曲的枯樹 */}
          {[
            [16, 1],
            [W - 16, -1],
          ].map(([x, dir]) => (
            <g key={x} stroke={dark} fill="none" strokeLinecap="round">
              <path d={`M${x},${H} C${x + dir * 4},${H - 60} ${x - dir * 10},${H - 90} ${x + dir * 6},${H - 140}`} strokeWidth={10} />
              <path d={`M${x + dir * 2},${H - 90} C${x + dir * 20},${H - 104} ${x + dir * 30},${H - 98} ${x + dir * 44},${H - 120}`} strokeWidth={5} />
              <path d={`M${x + dir * 4},${H - 120} C${x - dir * 10},${H - 132} ${x - dir * 16},${H - 140} ${x - dir * 10},${H - 156}`} strokeWidth={4} />
              <path d={`M${x + dir * 30},${H - 112} L${x + dir * 40},${H - 96}`} strokeWidth={3} />
            </g>
          ))}
          {/* 地上一層貼地的霧 */}
          <rect x={0} y={H - 30} width={W} height={30} fill={art.ambientColors[1] ?? "#6B4593"} opacity={0.25} />
          {/* 暗處的眼睛 */}
          {[
            [70, HORIZON + 12],
            [330, HORIZON + 8],
          ].map(([x, y], i) => (
            <g key={i} fill={art.accent} opacity={0.75} className="mon-blink" style={{ transformOrigin: `${x}px ${y}px` }}>
              <ellipse cx={x - 3} cy={y} rx={1.6} ry={1} />
              <ellipse cx={x + 3} cy={y} rx={1.6} ry={1} />
            </g>
          ))}
        </g>
      );

    case "bloodmoon":
      return (
        <g>
          {/* 城堡尖塔剪影 */}
          {[
            [10, 1],
            [W - 10, -1],
          ].map(([x, dir]) => (
            <g key={x} fill={dark}>
              <rect x={x - 14} y={H - 110} width={28} height={110} />
              <path d={`M${x - 18},${H - 110} L${x},${H - 150} L${x + 18},${H - 110} Z`} />
              <rect x={x + dir * 24 - 9} y={H - 70} width={18} height={70} />
              <path d={`M${x + dir * 24 - 12},${H - 70} L${x + dir * 24},${H - 96} L${x + dir * 24 + 12},${H - 70} Z`} />
              <rect x={x - 3} y={H - 90} width={6} height={10} rx={3} fill={art.accent} opacity={0.8} />
            </g>
          ))}
          {/* 遠方的蝙蝠群 */}
          {[
            [200, 40],
            [222, 52],
            [180, 58],
          ].map(([x, y], i) => (
            <path key={i} d={`M${x - 6},${y} q3,-4 6,0 q3,-4 6,0`} stroke="#1C050D" strokeWidth={1.6} fill="none" />
          ))}
        </g>
      );

    case "celestial":
      return (
        <g>
          {/* 漂浮的小島 */}
          {[
            [40, HORIZON - 70, 26],
            [356, HORIZON - 96, 20],
            [110, HORIZON - 120, 12],
          ].map(([x, y, r], i) => (
            <g key={i}>
              <ellipse cx={x} cy={y} rx={r} ry={r * 0.28} fill={mixColor(art.groundTop, "#FFFFFF", 0.1)} />
              <path d={`M${x - r},${y} L${x},${y + r * 0.9} L${x + r},${y} Z`} fill={dark} />
              <ellipse cx={x} cy={y - 1} rx={r * 0.9} ry={r * 0.18} fill={art.accent} opacity={0.25} />
            </g>
          ))}
          {/* 地上的發光符文圈 */}
          <ellipse cx={W / 2} cy={HORIZON + (H - HORIZON) * 0.62} rx={150} ry={22} fill="none" stroke={art.accent} strokeWidth={1.2} opacity={0.4} />
          <ellipse cx={W / 2} cy={HORIZON + (H - HORIZON) * 0.62} rx={120} ry={16} fill="none" stroke={art.accent} strokeWidth={0.8} strokeDasharray="4 6" opacity={0.5} />
        </g>
      );

    case "arena":
      return (
        <g>
          {/* 兩側的火盆 */}
          {[30, W - 30].map((x) => (
            <g key={x}>
              <rect x={x - 3} y={H - 60} width={6} height={60} fill={dark} />
              <path d={`M${x - 14},${H - 62} L${x + 14},${H - 62} L${x + 9},${H - 52} L${x - 9},${H - 52} Z`} fill={dark} />
              <path className="mon-flicker" d={`M${x - 9},${H - 62} C${x - 8},${H - 74} ${x - 2},${H - 76} ${x},${H - 88} C${x + 2},${H - 76} ${x + 8},${H - 74} ${x + 9},${H - 62} Z`} fill="#FFB020" />
              <circle cx={x} cy={H - 70} r={22} fill="#FFB020" opacity={0.18} />
            </g>
          ))}
          {/* 沙地上的競技場圈線 */}
          <ellipse cx={W / 2} cy={HORIZON + (H - HORIZON) * 0.6} rx={170} ry={30} fill="none" stroke="#F5C542" strokeWidth={1.2} opacity={0.3} />
        </g>
      );

    default:
      return null;
  }
}
