// src/components/pet/rig/jobs/horse.tsx
"use client";

/**
 * 馬伕雞（參考 public/image/catalog/horse.png）
 * ------------------------------------------------------------
 * 原圖：金色頭盔＋紫羽毛＋紅寶石、站在金色馬車裡、車尾一座小城垛＋
 * 一面藍色燕尾旗、前面拉車的是一匹玩具感的棕色小馬（胸前藍色盾徽）。
 *
 * 部位對應：legL = 大車輪、legR = 小馬的前腳、mount = 車身＋城垛＋旗、
 * mountFront = 車身前緣、mountHead = 馬頭。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { CastleTop, ChickHead, GoldWheel, Paw, PawFlag, PlumeHelmet, PropDefs } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

/** 白色波浪紋的藍色圍兜（原圖馬伕胸前那條） */
function Bib({ uid }: { uid: string }) {
  return (
    <g>
      <path d="M94,106 C104,112 132,112 144,104 C146,118 138,132 120,136 C102,134 94,120 94,106 Z" fill={`url(#${uid}-blue)`} {...inkProps} />
      <path d="M98,108 C104,114 112,110 118,114 C124,110 132,114 140,108" stroke="#FFFFFF" strokeWidth={2.2} fill="none" strokeLinecap="round" />
      <g fill="#FFFFFF">
        <circle cx={110} cy={122} r={2.6} />
        <circle cx={120} cy={126} r={3.2} />
        <circle cx={130} cy={121} r={2.4} />
        <circle cx={116} cy={118} r={1.4} />
        <circle cx={125} cy={118} r={1.4} />
      </g>
    </g>
  );
}

export default function HorseChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={184} scale={1.12}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
      </defs>

      <ellipse cx={112} cy={184} rx={82} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(112, 184)}>
        {/* ---------- 車身後半：車廂、城垛、旗子 ---------- */}
        <g ref={partRef("mount")} style={jointStyle(112, 184)}>
          <PawFlag px={64} top={40} bottom={120} uid={uid} />
          <CastleTop x={30} y={98} w={42} h={30} uid={uid} />
          <path d="M26,122 L100,118 L104,162 L30,168 Z" fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M32,130 L98,126" stroke="#9A6614" strokeWidth={2} opacity={0.6} />
          <path d="M32,146 L100,142" stroke="#9A6614" strokeWidth={2} opacity={0.6} />
          <path d="M30,126 L30,162" stroke="#FFF6CC" strokeWidth={2.4} opacity={0.6} strokeLinecap="round" />
        </g>

        {/* ---------- 小雞 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(120, 160)}>
          <Fluffy uid={uid} ellipse={[120, 132, 30, 28]} />
        </g>

        <g ref={partRef("head")} style={jointStyle(120, 112)}>
          <ChickHead cx={120} cy={86} rx={30} ry={26} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[112, 84]} eyeR={[134, 83]} beak={[124, 95]} cheekL={[100, 96]} cheekR={[143, 93]} scale={0.9} beakScale={1.25} />
          <PlumeHelmet cx={120} base={70} w={64} uid={uid} />
        </g>

        <g ref={partRef("torsoFront")} style={jointStyle(120, 160)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 120, top: 112, bottom: 152, w: 56 }} />
          </g>
          <Bib uid={uid} />
        </g>

        {/* ---------- 左翅（往後扶著城垛，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(96, 124)}>
          <Fluffy uid={uid} d="M100,118 C88,114 76,116 66,122 C70,126 74,126 78,126 C74,132 78,136 84,133 C86,138 94,138 98,132 C104,128 104,120 100,118 Z" wing />
          <HeldShield item={armorType === "shield" ? armor : null} center={[72, 130]} size={46} />
        </g>

        {/* ---------- 車身前緣（蓋住小雞的下半身） ---------- */}
        <g ref={partRef("mountFront")} style={jointStyle(112, 184)}>
          <path d="M40,146 C70,160 120,160 152,140 L156,156 C124,176 70,178 38,162 Z" fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M44,152 C74,164 118,164 150,146" stroke="#FFF6CC" strokeWidth={2.2} fill="none" opacity={0.65} strokeLinecap="round" />
          {[60, 90, 120].map((x) => (
            <circle key={x} cx={x} cy={x === 90 ? 166 : x === 60 ? 162 : 162} r={2.4} fill="#FFF0A0" stroke={INK} strokeWidth={1} />
          ))}
        </g>

        {/* ---------- 大車輪 ---------- */}
        <g ref={partRef("legL")} style={jointStyle(58, 162)}>
          <GoldWheel cx={58} cy={162} r={24} uid={uid} />
        </g>

        {/* ---------- 小馬：身體＋前腳＋頭 ---------- */}
        <g ref={partRef("legR")} style={jointStyle(172, 168)}>
          <path d="M160,164 L158,182 L168,182 L168,166 Z" fill={`url(#${uid}-horse)`} {...inkProps} strokeWidth={2} />
          <path d="M176,164 L176,182 L186,182 L184,164 Z" fill={`url(#${uid}-horse)`} {...inkProps} strokeWidth={2} />
          <rect x={156} y={178} width={14} height={6} rx={2} fill="#5A3A1E" {...inkProps} strokeWidth={1.6} />
          <rect x={174} y={178} width={14} height={6} rx={2} fill="#5A3A1E" {...inkProps} strokeWidth={1.6} />
        </g>
        <g ref={partRef("mountHead")} style={jointStyle(168, 148)}>
          {/* 胸口 */}
          <path d="M148,140 C150,126 170,122 184,130 C194,138 194,160 186,170 C172,176 156,172 150,162 Z" fill={`url(#${uid}-horse)`} {...inkProps} />
          {/* 胸前藍色盾徽 */}
          <path d="M162,146 L182,146 L182,158 Q172,170 162,158 Z" fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
          <path d="M165,149 L179,149 L179,158 Q172,166 165,158 Z" fill={`url(#${uid}-blue)`} />
          <Paw x={172} y={155} s={0.45} />
          {/* 頭：圓圓的玩偶馬頭，臉朝右 */}
          <path d="M160,112 C150,116 148,130 152,140 C156,134 160,130 166,128 Z" fill={`url(#${uid}-mane)`} {...inkProps} strokeWidth={1.8} />
          <ellipse cx={176} cy={118} rx={22} ry={19} fill={`url(#${uid}-horse)`} {...inkProps} />
          <ellipse cx={196} cy={128} rx={13} ry={10.5} fill="#F6D9A4" {...inkProps} />
          <ellipse cx={200} cy={126} rx={1.8} ry={2.4} fill={INK} />
          <ellipse cx={194} cy={131} rx={1.6} ry={2} fill={INK} />
          <path d="M188,134 Q194,138 200,134" stroke={INK} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          {/* 眼睛 */}
          <ellipse cx={182} cy={113} rx={4.6} ry={5.6} fill="#17181F" />
          <circle cx={180.6} cy={110.6} r={1.8} fill="#FFFFFF" />
          <ellipse cx={172} cy={124} rx={5} ry={3} fill="#FF9A6A" opacity={0.45} />
          {/* 耳朵 */}
          <path d="M166,104 L162,88 L175,99 Z" fill={`url(#${uid}-horse)`} {...inkProps} strokeWidth={1.8} />
          <path d="M166,101 L164,92 L171,99 Z" fill="#F2B49A" />
          {/* 頭頂一撮捲捲的鬃毛 */}
          <path d="M160,108 C154,96 162,86 174,88 C172,92 176,94 182,92 C180,98 184,100 188,100 C182,104 176,100 172,104 C168,102 164,104 164,110 Z" fill={`url(#${uid}-mane)`} {...inkProps} strokeWidth={1.8} />
          {/* 韁繩 */}
          <path d="M192,138 L184,124 L196,108" stroke="#8E1414" strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </g>

        {/* ---------- 右翅（往前拉韁繩，拿武器） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(142, 118)}>
          <g ref={partRef("weapon")} style={jointStyle(156, 92)}>
            <HeldWeapon item={weapon} grip={[156, 92]} size={64} />
          </g>
          <Fluffy uid={uid} d="M138,114 C146,104 152,94 158,86 C162,92 162,96 158,100 C164,100 164,106 159,108 C161,114 155,117 150,115 C146,120 140,122 136,120 Z" wing />
          <path d="M146,110 Q152,104 156,98" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(120, 20), opacity: 0 }}>
          <KoStars cx={120} cy={20} />
        </g>
      </g>
    </UnitSpace>
  );
}
