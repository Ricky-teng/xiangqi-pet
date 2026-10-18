// src/components/pet/rig/jobs/phoenix.tsx
"use client";

/**
 * 鳳凰雞（參考 public/image/catalog/phoenix.png）
 * ------------------------------------------------------------
 * 原圖：全身金黃、頭頂火焰羽冠＋金色小王冠（橘寶石）、一隻眼瞇起來、
 * 兩邊張開的大火焰翅膀、胸前火焰色的羽毛、站在金邊白石台座上，
 * 身邊飄著火星。
 *
 * 部位對應：legL / legR = 台座上的兩撮尾羽火焰、mount = 石台座。
 * 火焰會自己一直輕輕晃（CSS 動畫 .flame-flicker），火星往上飄（.ember-float）。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { PropDefs } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

/**
 * 一片火焰羽毛（彎彎的葉子形）：從 root 長到 tip，bend 決定往哪邊彎。
 * 外層橘紅、中間一條亮黃，尖端會輕輕晃。
 */
function FeatherLobe({ root, tip, w, bend, uid, delay = 0 }: { root: [number, number]; tip: [number, number]; w: number; bend: number; uid: string; delay?: number }) {
  const [x1, y1] = root;
  const [x2, y2] = tip;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  // 中段往法線方向鼓起，bend 讓整片往一邊彎
  const mx = x1 + dx * 0.55 + nx * bend;
  const my = y1 + dy * 0.55 + ny * bend;
  const d = `M${x1 + nx * w * 0.35},${y1 + ny * w * 0.35} Q${mx + nx * w},${my + ny * w} ${x2},${y2} Q${mx - nx * w * 0.7},${my - ny * w * 0.7} ${x1 - nx * w * 0.35},${y1 - ny * w * 0.35} Z`;
  const inner = `M${x1},${y1} Q${mx + nx * w * 0.2},${my + ny * w * 0.2} ${x1 + dx * 0.86 + nx * bend * 0.4},${y1 + dy * 0.86 + ny * bend * 0.4}`;
  return (
    <g className="flame-flicker" style={{ ...jointStyle(x1, y1), animationDelay: `${delay}s` }}>
      <path d={d} fill={`url(#${uid}-fire)`} stroke="#B8420A" strokeWidth={2} strokeLinejoin="round" />
      <path d={inner} stroke="#FFF3A0" strokeWidth={w * 0.32} fill="none" strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

/** 左翼：5 片長羽由外往內疊，尖端都往上彎；右翼鏡像 */
const WING_LOBES: { tip: [number, number]; w: number; bend: number }[] = [
  { tip: [40, 140], w: 18, bend: -10 },
  { tip: [18, 108], w: 22, bend: -14 },
  { tip: [14, 70], w: 25, bend: -18 },
  { tip: [28, 34], w: 25, bend: -18 },
  { tip: [54, 12], w: 22, bend: -14 },
  { tip: [78, 24], w: 16, bend: -8 },
];

function FlameWing({ uid, mirror = false }: { uid: string; mirror?: boolean }) {
  const root: [number, number] = [92, 114];
  return (
    <g transform={mirror ? "translate(232 0) scale(-1 1)" : undefined}>
      {WING_LOBES.map((l, i) => (
        <FeatherLobe key={i} root={root} tip={l.tip} w={l.w} bend={mirror ? l.bend : l.bend} uid={uid} delay={i * 0.11} />
      ))}
    </g>
  );
}

/** 一根火焰羽毛：從根部 (x,y) 往 angle 方向長 len，寬 w */
function FlameFeather({ x, y, angle, len, w, uid, delay = 0 }: { x: number; y: number; angle: number; len: number; w: number; uid: string; delay?: number }) {
  const a = (angle * Math.PI) / 180;
  const tx = x + Math.cos(a) * len;
  const ty = y + Math.sin(a) * len;
  const nx = -Math.sin(a) * w;
  const ny = Math.cos(a) * w;
  const mx = x + Math.cos(a) * len * 0.45;
  const my = y + Math.sin(a) * len * 0.45;
  const d = `M${x + nx * 0.4},${y + ny * 0.4} Q${mx + nx * 1.2},${my + ny * 1.2} ${tx},${ty} Q${mx - nx * 0.6},${my - ny * 0.6} ${x - nx * 0.4},${y - ny * 0.4} Z`;
  const inner = `M${x + nx * 0.2},${y + ny * 0.2} Q${mx + nx * 0.55},${my + ny * 0.55} ${x + Math.cos(a) * len * 0.8},${y + Math.sin(a) * len * 0.8} Q${mx - nx * 0.2},${my - ny * 0.2} ${x - nx * 0.2},${y - ny * 0.2} Z`;
  return (
    <g className="flame-flicker" style={{ ...jointStyle(x, y), animationDelay: `${delay}s` }}>
      <path d={d} fill={`url(#${uid}-fire)`} stroke="#B8420A" strokeWidth={1.8} strokeLinejoin="round" />
      <path d={inner} fill="#FFF3A0" opacity={0.85} />
    </g>
  );
}

const EMBERS = [
  [26, 70, 0],
  [196, 64, 0.6],
  [40, 128, 1.2],
  [186, 136, 0.3],
  [150, 40, 0.9],
  [66, 34, 1.5],
] as const;

export default function PhoenixChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={182} scale={0.98}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
        <linearGradient id={`${uid}-fire`} x1="0" y1="1" x2="0.4" y2="0">
          <stop offset="0%" stopColor="#E8501A" />
          <stop offset="45%" stopColor="#FF9A1E" />
          <stop offset="100%" stopColor="#FFE04A" />
        </linearGradient>
        <linearGradient id={`${uid}-stone`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor="#E4DCCC" />
          <stop offset="100%" stopColor="#B8AC96" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFD23D" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FF7A1E" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx={116} cy={182} rx={52} ry={6} fill="#000" opacity={0.16} />
      {/* 背後的火光 */}
      <ellipse cx={116} cy={100} rx={100} ry={80} fill={`url(#${uid}-glow)`} className="flame-glow" />

      <g ref={partRef("root")} style={jointStyle(116, 182)}>
        {/* ---------- 石台座 ---------- */}
        <g ref={partRef("mount")} style={jointStyle(116, 182)}>
          <ellipse cx={116} cy={176} rx={44} ry={8} fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M84,152 L148,152 L152,174 L80,174 Z" fill={`url(#${uid}-stone)`} {...inkProps} />
          <path d="M80,174 Q116,182 152,174" stroke="#C88A1E" strokeWidth={3} fill="none" />
          <ellipse cx={116} cy={152} rx={34} ry={7} fill={`url(#${uid}-gold)`} {...inkProps} />
          <ellipse cx={116} cy={151} rx={28} ry={4.5} fill="#FFFDF2" stroke={INK} strokeWidth={1.2} />
          <path d="M90,160 L90,170 M142,160 L142,170" stroke="#FFFFFF" strokeWidth={2.4} opacity={0.8} strokeLinecap="round" />
        </g>

        {/* ---------- 尾羽火焰（站在台座上） ---------- */}
        <g ref={partRef("legL")} style={jointStyle(96, 148)}>
          <FlameFeather x={98} y={146} angle={160} len={34} w={9} uid={uid} delay={0.2} />
          <FlameFeather x={98} y={150} angle={185} len={28} w={7} uid={uid} delay={0.5} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(136, 148)}>
          <FlameFeather x={134} y={146} angle={20} len={30} w={8} uid={uid} delay={0.35} />
        </g>

        {/* ---------- 左翼（大火焰翅膀） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(84, 104)}>
          <FlameWing uid={uid} />
          <HeldShield item={armorType === "shield" ? armor : null} center={[52, 110]} size={46} />
        </g>

        {/* ---------- 身體 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(116, 150)}>
          <Fluffy uid={uid} d="M76,122 C74,98 92,86 116,86 C142,86 160,98 158,124 C156,144 140,154 116,154 C92,154 78,144 76,122 Z" />
          {/* 胸前火焰色羽毛 */}
          <path d="M96,124 C104,134 128,136 140,122 C138,138 128,146 116,148 C104,146 96,138 96,124 Z" fill={`url(#${uid}-fire)`} {...inkProps} strokeWidth={1.8} />
          <path d="M104,130 L110,140 M116,132 L116,144 M128,130 L122,140" stroke="#FFF3A0" strokeWidth={2} strokeLinecap="round" opacity={0.85} />
        </g>

        {/* ---------- 頭：火焰羽冠＋小王冠 ---------- */}
        <g ref={partRef("head")} style={jointStyle(118, 118)}>
          {/* 羽冠 */}
          {[
            [94, 80, 228, 24, 15],
            [102, 72, 246, 30, 17],
            [112, 68, 262, 34, 18],
            [122, 68, 276, 33, 18],
            [132, 70, 292, 30, 17],
            [142, 76, 310, 25, 15],
            [148, 84, 330, 20, 12],
          ].map(([x, y, ang, len, w], i) => (
            <FlameFeather key={i} x={x} y={y} angle={ang} len={len} w={w} uid={uid} delay={i * 0.12} />
          ))}
          <Fluffy uid={uid} d="M74,98 C74,70 96,60 118,60 C142,60 162,72 160,100 C158,122 140,128 118,128 C96,128 74,122 74,98 Z" />
          {/* 小王冠 */}
          <path d="M104,72 L108,60 L114,68 L120,56 L126,68 L132,60 L134,72 Q119,76 104,72 Z" fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
          <circle cx={119} cy={68} r={4} fill={`url(#${uid}-gemOrange)`} stroke={INK} strokeWidth={1.1} />
          <Face uid={uid} expression={expression} eyeL={[108, 94]} eyeR={[134, 92]} beak={[121, 106]} cheekL={[94, 106]} cheekR={[146, 102]} scale={1.12} beakScale={1.35} winkRight />
        </g>

        {/* ---------- 防具（穿在胸前） ---------- */}
        <g ref={partRef("torsoFront")} style={jointStyle(116, 150)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 117, top: 122, bottom: 150, w: 56 }} />
          </g>
        </g>

        {/* ---------- 右翼（大火焰翅膀，拿武器） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(150, 104)}>
          <FlameWing uid={uid} mirror />
          <g ref={partRef("weapon")} style={jointStyle(176, 100)}>
            <HeldWeapon item={weapon} grip={[176, 100]} size={62} />
          </g>
        </g>

        {/* ---------- 火星 ---------- */}
        <g pointerEvents="none">
          {EMBERS.map(([x, y, d], i) => (
            <path key={i} className="ember-float" style={{ animationDelay: `${d}s` }} d={`M${x},${y - 5} Q${x + 3},${y} ${x},${y + 4} Q${x - 3},${y} ${x},${y - 5} Z`} fill="#FFB43A" />
          ))}
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(118, 20), opacity: 0 }}>
          <KoStars cx={118} cy={20} />
        </g>
      </g>
    </UnitSpace>
  );
}
