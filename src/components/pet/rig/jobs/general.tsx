// src/components/pet/rig/jobs/general.tsx
"use client";

/**
 * 將軍雞（參考 public/image/catalog/general.png）
 * ------------------------------------------------------------
 * 原圖：銀色翅膀頭盔＋紅羽冠＋菱形寶石、眨一隻眼、白毛邊的大紅披風
 * 從肩膀拖到地上、綠色戰裙＋金色腰帶＋圓形金扣、藍色褲子、
 * 右手握著劍柄（金色）、站著（腳露出來）。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { ChickHead, PropDefs, Scarf, WingedHelmet } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

function Foot({ x, uid }: { x: number; uid: string }) {
  return (
    <g>
      <path d={`M${x - 4},168 L${x - 4},180 L${x + 4},180 L${x + 4},168 Z`} fill={`url(#${uid}-leg)`} {...inkProps} strokeWidth={2} />
      <path d={`M${x - 12},186 Q${x - 10},178 ${x},178 Q${x + 10},178 ${x + 12},186 Z`} fill={`url(#${uid}-leg)`} {...inkProps} strokeWidth={2} />
    </g>
  );
}

export default function GeneralChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={188} scale={1.08}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
        <linearGradient id={`${uid}-pants`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5A8AD0" />
          <stop offset="100%" stopColor="#2A4E8A" />
        </linearGradient>
      </defs>

      <ellipse cx={108} cy={188} rx={70} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(108, 188)}>
        {/* ---------- 大紅披風（在身體後面，拖到地上） ---------- */}
        <g ref={partRef("mount")} style={jointStyle(80, 104)}>
          <path d="M84,100 C50,104 22,140 12,178 C30,186 60,186 80,180 C76,160 78,130 92,110 Z" fill={`url(#${uid}-red)`} {...inkProps} />
          <path d="M60,118 Q40,150 34,178 M74,124 Q60,152 58,180" stroke="#7E1414" strokeWidth={1.6} fill="none" opacity={0.6} />
          {/* 披風裡面的白毛邊（下擺） */}
          <path d="M12,178 C30,186 60,186 80,180 L80,186 C60,192 28,192 10,184 Z" fill="#FFFFFF" {...inkProps} strokeWidth={1.8} />
        </g>

        {/* ---------- 腳 ---------- */}
        <g ref={partRef("legL")} style={jointStyle(98, 168)}>
          <Foot x={98} uid={uid} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(126, 168)}>
          <Foot x={126} uid={uid} />
        </g>

        {/* ---------- 身體：藍褲＋綠戰裙＋金腰帶 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(112, 176)}>
          <Fluffy uid={uid} d="M76,150 C76,128 92,112 112,112 C134,112 150,128 150,150 C150,166 136,176 112,176 C88,176 76,166 76,150 Z" />
          <path d="M80,160 C88,176 136,176 146,160 L146,170 C136,182 88,182 80,170 Z" fill={`url(#${uid}-pants)`} {...inkProps} />
          <path d="M80,134 C96,144 128,144 146,134 L148,162 C130,172 96,172 78,162 Z" fill={`url(#${uid}-tunic)`} {...inkProps} />
          {/* 戰裙的金邊、分片 */}
          <path d="M79,160 C96,170 130,170 147,160" stroke="#F2C14A" strokeWidth={3} fill="none" />
          {[94, 112, 130].map((x) => (
            <path key={x} d={`M${x},146 L${x},166`} stroke="#2E4E22" strokeWidth={1.4} opacity={0.7} />
          ))}
          {/* 金腰帶＋圓扣 */}
          <path d="M80,134 C96,144 128,144 146,134 L146,142 C128,152 96,152 80,142 Z" fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={2} />
          <circle cx={114} cy={146} r={7} fill={`url(#${uid}-gold)`} {...inkProps} strokeWidth={1.8} />
          <circle cx={114} cy={146} r={3} fill={`url(#${uid}-gemOrange)`} />
        </g>

        {/* ---------- 頭 ---------- */}
        <g ref={partRef("head")} style={jointStyle(112, 114)}>
          <ChickHead cx={112} cy={80} rx={38} ry={32} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[100, 78]} eyeR={[126, 76]} beak={[114, 92]} cheekL={[86, 90]} cheekR={[138, 88]} scale={1} beakScale={1.4} winkLeft />
          <WingedHelmet cx={110} base={60} w={84} uid={uid} />
        </g>

        {/* ---------- 領巾、肩上的白毛、防具 ---------- */}
        <g ref={partRef("torsoFront")} style={jointStyle(112, 176)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 113, top: 116, bottom: 168, w: 66 }} />
          </g>
          {/* 披風的白毛領 */}
          <path d="M70,108 C76,96 96,96 110,104 C124,98 146,98 154,108 C150,116 140,118 132,114 C124,120 104,120 94,114 C86,118 74,118 70,108 Z" fill="#FFFFFF" {...inkProps} />
          <g fill="#3E2A1E" opacity={0.7}>
            <ellipse cx={82} cy={108} rx={1.3} ry={2.1} />
            <ellipse cx={142} cy={108} rx={1.3} ry={2.1} />
          </g>
          <Scarf cx={114} y={112} w={44} uid={uid} tail={0.55} />
        </g>

        {/* ---------- 左翅（披風下，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(80, 128)}>
          <Fluffy uid={uid} d="M82,122 C70,122 60,128 52,136 C56,139 60,139 64,138 C60,145 64,149 70,146 C72,151 79,151 83,145 C89,140 90,128 82,122 Z" wing />
          <HeldShield item={armorType === "shield" ? armor : null} center={[54, 140]} size={48} />
        </g>

        {/* ---------- 右翅（握劍） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(144, 126)}>
          <g ref={partRef("weapon")} style={jointStyle(162, 106)}>
            <HeldWeapon item={weapon} grip={[162, 106]} size={66} />
          </g>
          <Fluffy uid={uid} d="M140,120 C150,114 160,106 168,100 C172,106 170,110 166,113 C172,114 172,120 167,122 C168,128 162,130 156,128 C150,132 142,132 138,128 Z" wing />
          <path d="M150,124 Q158,118 164,112" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(110, 8), opacity: 0 }}>
          <KoStars cx={110} cy={8} />
        </g>
      </g>
    </UnitSpace>
  );
}
