// src/components/pet/rig/jobs/pawn.tsx
"use client";

/**
 * 小兵雞（參考 public/image/catalog/pawn.png 重畫成可動的分件 SVG）
 * ------------------------------------------------------------
 * 原圖重點：灰色圓頂鋼盔＋頂上一顆圓球、臉微微朝右（四分之三側臉）、
 * 藍色三角領巾（右下垂、左邊打結）、圓滾滾比頭還寬的黃色身體、
 * 右翅往上揚、左翅往外平伸、短腿穿兩節灰色圓筒靴。
 *
 * 座標系：腳底在 y=226。關節：
 *   root  (110,226) 腳底中心
 *   torso (110,204) 屁股底部
 *   head  (110,146) 脖子
 *   wingL (68,156)  wingR (154,150)
 *   legL  (90,200)  legR  (130,200)
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, Fluff, HeldShield, HeldWeapon, INK, KoStars, inkProps } from "@/components/pet/rig/parts";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { BodyArmor } from "@/components/pet/rig/armor";
import { getItemType } from "@/lib/rpg/equipment";

function Boot({ x, uid }: { x: number; uid: string }) {
  // 兩節圓筒：上面一節窄、下面一節寬（原圖的靴子像疊起來的兩片圓餅）
  return (
    <g>
      <rect x={x + 3} y={205} width={32} height={11} rx={5} fill={`url(#${uid}-boot)`} {...inkProps} />
      <rect x={x} y={213} width={38} height={13} rx={6} fill={`url(#${uid}-boot)`} {...inkProps} />
      <path d={`M${x + 6},${217} Q${x + 14},${215} ${x + 22},${216}`} stroke="#FFFFFF" strokeWidth={2} fill="none" opacity={0.5} strokeLinecap="round" />
      <path d={`M${x + 8},${208} Q${x + 14},${207} ${x + 20},${208}`} stroke="#FFFFFF" strokeWidth={1.6} fill="none" opacity={0.45} strokeLinecap="round" />
    </g>
  );
}

export default function PawnChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <>
      <defs>
        <ChickGradients uid={uid} />
        <linearGradient id={`${uid}-helm`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stopColor="#E4E0D8" />
          <stop offset="40%" stopColor="#ABA59C" />
          <stop offset="100%" stopColor="#6E6861" />
        </linearGradient>
        <linearGradient id={`${uid}-brim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B7B1A8" />
          <stop offset="100%" stopColor="#6A645D" />
        </linearGradient>
        <radialGradient id={`${uid}-knob`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#F2EEE6" />
          <stop offset="60%" stopColor="#B4ADA2" />
          <stop offset="100%" stopColor="#7A746C" />
        </radialGradient>
        <linearGradient id={`${uid}-scarf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8CC8F0" />
          <stop offset="60%" stopColor="#5FA6DA" />
          <stop offset="100%" stopColor="#3D82B8" />
        </linearGradient>
        <linearGradient id={`${uid}-boot`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#D2CCC2" />
          <stop offset="55%" stopColor="#A49D92" />
          <stop offset="100%" stopColor="#7B746A" />
        </linearGradient>
      </defs>

      {/* 地上的影子（不跟著跳） */}
      <ellipse cx={110} cy={226} rx={54} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(110, 226)}>
        {/* ---------- 腳 ---------- */}
        <g ref={partRef("legL")} style={jointStyle(90, 200)}>
          <path d="M86,196 L86,208 L94,208 L94,196 Z" fill={`url(#${uid}-leg)`} {...inkProps} strokeWidth={2} />
          <Boot x={70} uid={uid} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(130, 200)}>
          <path d="M126,196 L126,208 L134,208 L134,196 Z" fill={`url(#${uid}-leg)`} {...inkProps} strokeWidth={2} />
          <Boot x={112} uid={uid} />
        </g>

        {/* ---------- 身體（比頭寬，圓滾滾） ---------- */}
        <g ref={partRef("torso")} style={jointStyle(110, 204)}>
          <Fluffy uid={uid} d="M56,168 C52,140 80,126 110,126 C140,126 170,140 166,168 C164,192 140,203 110,203 C80,203 58,192 56,168 Z" />
          {/* 肚子下緣的蓬毛 */}
          <Fluff pts={[[74, 191], [88, 197], [104, 200], [122, 199]]} fill="#FBCF38" />
          {/* 肚子的亮面 */}
          <ellipse cx={100} cy={170} rx={26} ry={16} fill="#FFFDE0" opacity={0.35} />
        </g>

        {/* ---------- 頭（臉朝右的四分之三側臉） ---------- */}
        <g ref={partRef("head")} style={jointStyle(110, 146)}>
          {/* 兩頰的蓬毛 */}
          <Fluff pts={[[62, 112], [60, 124]]} fill="#FFE94A" />
          <Fluff pts={[[158, 108], [160, 120]]} fill="#FFE94A" />
          <Fluffy uid={uid} d="M108,74 C142,74 160,94 158,118 C156,140 136,150 108,150 C80,150 62,140 62,118 C62,94 76,74 108,74 Z" />
          <Face
            uid={uid}
            expression={expression}
            eyeL={[103, 108]}
            eyeR={[136, 105]}
            beak={[119, 121]}
            cheekL={[86, 124]}
            cheekR={[146, 119]}
            scale={1.08}
            beakScale={1.45}
          />
          {/* 鋼盔：圓頂＋帽沿＋頂上一顆球 */}
          <rect x={98} y={26} width={14} height={14} rx={3} fill="#8A847C" {...inkProps} strokeWidth={2} />
          <circle cx={105} cy={26} r={12} fill={`url(#${uid}-knob)`} {...inkProps} />
          <circle cx={100} cy={21} r={3.4} fill="#FFFFFF" opacity={0.75} />
          <path d="M64,92 C62,58 82,40 106,40 C132,40 152,58 150,92 Z" fill={`url(#${uid}-helm)`} {...inkProps} />
          {/* 鋼盔的反光：左上一個亮點＋一道弧光 */}
          <circle cx={84} cy={58} r={4.5} fill="#FFFFFF" opacity={0.85} />
          <path d="M76,78 C78,64 88,54 100,49" stroke="#FFFFFF" strokeWidth={3} fill="none" opacity={0.42} strokeLinecap="round" />
          <rect x={60} y={86} width={94} height={14} rx={7} fill={`url(#${uid}-brim)`} {...inkProps} />
          <path d="M66,90 L148,90" stroke="#FFFFFF" strokeWidth={1.6} opacity={0.35} strokeLinecap="round" />
        </g>

        {/* ---------- 身體前面那一層：防具、領巾（蓋住頭跟身體的接縫，跟著身體動） ---------- */}
        <g ref={partRef("torsoFront")} style={jointStyle(110, 204)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 110, top: 150, bottom: 204, w: 104 }} />
          </g>
          {/* 領巾：繞脖子一圈，三角形往右下垂，左邊打結 */}
          <path d="M66,138 C84,150 132,150 156,134 L158,144 C134,160 82,160 64,148 Z" fill={`url(#${uid}-scarf)`} {...inkProps} />
          <path d="M96,152 C118,154 140,148 158,138 C156,158 144,172 128,182 C116,172 104,162 96,152 Z" fill={`url(#${uid}-scarf)`} {...inkProps} />
          {/* 領巾上的白點（原圖的腳印圖案） */}
          <g fill="#FFFFFF" opacity={0.95}>
            <circle cx={130} cy={162} r={3.6} />
            <circle cx={123} cy={155} r={1.9} />
            <circle cx={129} cy={153} r={1.9} />
            <circle cx={135} cy={155} r={1.9} />
            <circle cx={142} cy={163} r={2.6} />
            <circle cx={118} cy={166} r={2.2} />
          </g>
          {/* 結 */}
          <path d="M62,140 L40,130 L44,148 Z" fill={`url(#${uid}-scarf)`} {...inkProps} />
          <path d="M62,146 L42,158 L54,162 Z" fill="#4A8FC4" {...inkProps} />
          <circle cx={63} cy={143} r={6.5} fill="#5FA6DA" {...inkProps} />
        </g>

        {/* ---------- 左翅（往外平伸，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(68, 156)}>
          <Fluffy uid={uid} d="M74,148 C60,148 46,150 32,158 C38,162 44,162 48,161 C42,168 46,174 54,171 C54,178 64,180 70,172 C80,170 84,160 80,152 Z" wing />
          <path d="M48,160 Q58,158 68,158 M56,170 Q64,166 74,164" stroke={INK} strokeWidth={1.4} fill="none" opacity={0.55} strokeLinecap="round" />
          <HeldShield item={armorType === "shield" ? armor : null} center={[44, 166]} size={56} />
        </g>

        {/* ---------- 右翅（往上揚，拿武器） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(154, 150)}>
          <g ref={partRef("weapon")} style={jointStyle(182, 128)}>
            <HeldWeapon item={weapon} grip={[182, 128]} size={80} />
          </g>
          <Fluffy uid={uid} d="M150,144 C164,138 178,126 188,116 C192,124 190,130 186,134 C194,134 196,142 190,146 C194,152 188,158 180,156 C172,162 160,164 152,160 Z" wing />
          <path d="M166,144 Q176,138 184,132 M166,154 Q178,150 186,146" stroke={INK} strokeWidth={1.4} fill="none" opacity={0.55} strokeLinecap="round" />
        </g>

        {/* ---------- 特效層：KO 星星 ---------- */}
        <g ref={partRef("fx")} style={{ ...jointStyle(106, 40), opacity: 0 }}>
          <KoStars cx={106} cy={40} />
        </g>
      </g>
    </>
  );
}
