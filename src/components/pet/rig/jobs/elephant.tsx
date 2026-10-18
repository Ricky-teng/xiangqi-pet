// src/components/pet/rig/jobs/elephant.tsx
"use client";

/**
 * 巨象雞（參考 public/image/catalog/elephant.png）
 * ------------------------------------------------------------
 * 原圖：小雞戴金盔紫羽毛，坐在灰色大象背上的金色象轎裡，轎子後面
 * 一座小城垛＋藍色旗子；大象披著紅金兩色的華麗披布，腳上有金環，
 * 臉朝右、大耳朵、白色象牙、鼻子往下捲。
 *
 * 部位對應：legL = 兩隻後腳、legR = 兩隻前腳、mount = 象身＋披布＋城垛＋旗、
 * mountFront = 象轎前緣、mountHead = 象頭（耳朵、象牙、鼻子）。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { CastleTop, ChickHead, PawFlag, PlumeHelmet, PropDefs, Scarf } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

function Leg({ x, uid }: { x: number; uid: string }) {
  return (
    <g>
      <path d={`M${x - 10},150 L${x - 11},182 Q${x},186 ${x + 11},182 L${x + 10},150 Z`} fill={`url(#${uid}-grey)`} {...inkProps} />
      <rect x={x - 12} y={170} width={24} height={6} rx={3} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.6} />
      <path d={`M${x - 7},183 L${x - 7},179 M${x},184 L${x},180 M${x + 7},183 L${x + 7},179`} stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
    </g>
  );
}

export default function ElephantChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={188} scale={1.1}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
      </defs>

      <ellipse cx={112} cy={188} rx={84} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(112, 188)}>
        {/* ---------- 後腳（被身體擋住一半） ---------- */}
        <g ref={partRef("legL")} style={jointStyle(78, 152)}>
          <Leg x={66} uid={uid} />
          <Leg x={92} uid={uid} />
        </g>

        {/* ---------- 象身＋披布＋城垛＋旗 ---------- */}
        <g ref={partRef("mount")} style={jointStyle(112, 188)}>
          <PawFlag px={58} top={42} bottom={114} uid={uid} />
          <CastleTop x={34} y={84} w={28} h={34} uid={uid} />
          {/* 象身 */}
          <path d="M42,150 C40,120 70,108 110,110 C146,112 164,128 162,152 C160,168 140,174 110,174 C74,174 44,170 42,150 Z" fill={`url(#${uid}-grey)`} {...inkProps} />
          <path d="M44,150 Q40,158 36,152" stroke={INK} strokeWidth={2} fill="none" />
          {/* 紅金披布 */}
          <path d="M50,118 C80,108 130,108 150,120 L146,156 C126,168 74,168 54,156 Z" fill={`url(#${uid}-red)`} {...inkProps} />
          <path d="M56,126 C82,118 126,118 144,128 L141,150 C122,160 78,160 60,150 Z" fill="none" stroke="#F2C14A" strokeWidth={3} />
          <path d="M70,136 q8,-8 16,0 q-8,8 -16,0 Z M100,134 q8,-8 16,0 q-8,8 -16,0 Z" fill="#F2C14A" stroke={INK} strokeWidth={1.2} />
          <circle cx={93} cy={140} r={5} fill={`url(#${uid}-gemOrange)`} stroke={INK} strokeWidth={1.2} />
          {/* 金色流蘇 */}
          {Array.from({ length: 9 }, (_, i) => {
            const x = 58 + i * 11;
            const y = 156 + Math.sin((i / 8) * Math.PI) * 9;
            return <path key={i} d={`M${x},${y} L${x - 2.5},${y + 9} L${x + 2.5},${y + 9} Z`} fill={`url(#${uid}-gold)`} stroke={INK} strokeWidth={1.1} />;
          })}
        </g>

        {/* ---------- 前腳 ---------- */}
        <g ref={partRef("legR")} style={jointStyle(138, 152)}>
          <Leg x={124} uid={uid} />
          <Leg x={148} uid={uid} />
        </g>

        {/* ---------- 象頭 ---------- */}
        <g ref={partRef("mountHead")} style={jointStyle(150, 140)}>
          {/* 鼻子往下捲 */}
          <path d="M176,160 C186,166 190,176 186,186 C184,192 176,192 176,186 C180,184 180,176 172,170 Z" fill={`url(#${uid}-grey)`} {...inkProps} />
          <path d="M180,172 L184,172 M180,178 L185,178" stroke={INK} strokeWidth={1.2} opacity={0.5} />
          <ellipse cx={168} cy={148} rx={24} ry={22} fill={`url(#${uid}-grey)`} {...inkProps} />
          {/* 大耳朵 */}
          <path d="M150,132 C134,126 126,142 130,156 C134,168 146,168 154,160 Z" fill={`url(#${uid}-grey)`} {...inkProps} />
          <path d="M146,138 C138,138 134,148 138,156 C142,160 148,158 150,154 Z" fill="#F2B4B4" opacity={0.7} />
          {/* 頭飾 */}
          <path d="M150,128 C160,122 178,122 188,132 L184,138 C176,132 162,132 154,136 Z" fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
          <circle cx={170} cy={128} r={4} fill={`url(#${uid}-blue)`} stroke={INK} strokeWidth={1.2} />
          {/* 眼睛、腮紅 */}
          <ellipse cx={174} cy={146} rx={4.2} ry={5.4} fill="#17181F" />
          <circle cx={172.6} cy={143.8} r={1.6} fill="#FFFFFF" />
          <ellipse cx={182} cy={156} rx={6} ry={3.4} fill="#FF9A9A" opacity={0.6} />
          {/* 象牙 */}
          <path d="M166,162 C168,170 176,174 184,170 C178,168 174,164 172,160 Z" fill="#FFFDF2" {...inkProps} strokeWidth={1.8} />
        </g>

        {/* ---------- 小雞 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(100, 118)}>
          <Fluffy uid={uid} ellipse={[100, 100, 25, 19]} />
        </g>
        <g ref={partRef("head")} style={jointStyle(100, 86)}>
          <ChickHead cx={102} cy={66} rx={27} ry={23} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[95, 64]} eyeR={[115, 63]} beak={[106, 74]} cheekL={[84, 74]} cheekR={[122, 72]} scale={0.82} beakScale={1.1} />
          <PlumeHelmet cx={102} base={52} w={56} uid={uid} />
        </g>
        <g ref={partRef("torsoFront")} style={jointStyle(100, 118)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 100, top: 86, bottom: 116, w: 46 }} />
          </g>
          <Scarf cx={104} y={84} w={40} uid={uid} tail={0.55} />
        </g>

        {/* ---------- 左翅（扶旗桿，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(80, 98)}>
          <Fluffy uid={uid} d="M82,92 C72,90 64,94 58,100 C62,103 65,103 68,102 C65,108 68,111 73,109 C75,113 81,113 83,108 C88,104 88,96 82,92 Z" wing />
          <HeldShield item={armorType === "shield" ? armor : null} center={[60, 104]} size={40} />
        </g>

        {/* ---------- 象轎前緣 ---------- */}
        <g ref={partRef("mountFront")} style={jointStyle(112, 188)}>
          <path d="M66,104 C88,114 120,114 140,102 L142,114 C120,126 86,126 64,116 Z" fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M70,108 C90,117 118,117 138,106" stroke="#FFF6CC" strokeWidth={2} fill="none" opacity={0.7} strokeLinecap="round" />
          <circle cx={102} cy={116} r={3.4} fill={`url(#${uid}-gemRed)`} stroke={INK} strokeWidth={1.1} />
        </g>

        {/* ---------- 右翅（拿武器） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(120, 96)}>
          <g ref={partRef("weapon")} style={jointStyle(140, 78)}>
            <HeldWeapon item={weapon} grip={[140, 78]} size={56} />
          </g>
          <Fluffy uid={uid} d="M116,92 C124,86 132,80 140,76 C143,81 141,85 138,87 C143,88 142,93 138,94 C139,99 134,101 130,99 C126,103 120,103 116,100 Z" wing />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(102, 0), opacity: 0 }}>
          <KoStars cx={102} cy={0} />
        </g>
      </g>
    </UnitSpace>
  );
}
