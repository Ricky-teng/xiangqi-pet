// src/components/pet/rig/jobs/advisor.tsx
"use client";

/**
 * 仕官雞（參考 public/image/catalog/advisor.png）
 * ------------------------------------------------------------
 * 原圖：大大的頭、銀色翅膀頭盔＋紅羽冠、眨一隻眼張嘴笑、坐在矮矮的
 * 金色小車裡（正面藍色腳印面板）、拿長槍（槍頭下綁紅布）＋一面
 * 木頭圓盾（中間金星）。
 *
 * 戰鬥時右翅拿的是裝備的武器；左翅沒有裝備盾牌的話，拿原圖那面金星木盾。
 * 原圖長槍上的紅布改成掛在車身側邊（保留辨識度）。
 *
 * 部位對應：legL = 後輪、legR = 前輪、mountFront = 小車。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { ChickHead, GoldWheel, PawPanel, PropDefs, Scarf, WingedHelmet } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

/** 原圖那面木頭圓盾（金框、中間一顆金星） */
function StarShield({ cx, cy, r, uid }: { cx: number; cy: number; r: number; uid: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${uid}-gold)`} {...inkProps} />
      <circle cx={cx} cy={cy} r={r * 0.82} fill={`url(#${uid}-wood)`} stroke={INK} strokeWidth={1.6} />
      {[-0.4, 0, 0.4].map((t) => (
        <path key={t} d={`M${cx + t * r},${cy - r * 0.78} L${cx + t * r},${cy + r * 0.78}`} stroke="#6E4018" strokeWidth={1.4} opacity={0.6} />
      ))}
      <path
        d={`M${cx},${cy - r * 0.5} L${cx + r * 0.14},${cy - r * 0.16} L${cx + r * 0.5},${cy - r * 0.14} L${cx + r * 0.22},${cy + r * 0.08} L${cx + r * 0.32},${cy + r * 0.45} L${cx},${cy + r * 0.24} L${cx - r * 0.32},${cy + r * 0.45} L${cx - r * 0.22},${cy + r * 0.08} L${cx - r * 0.5},${cy - r * 0.14} L${cx - r * 0.14},${cy - r * 0.16} Z`}
        fill={`url(#${uid}-gold)`}
        stroke={INK}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <path d={`M${cx - r * 0.6},${cy - r * 0.55} A${r * 0.85},${r * 0.85} 0 0 1 ${cx},${cy - r * 0.85}`} stroke="#FFF6CC" strokeWidth={2} fill="none" opacity={0.7} strokeLinecap="round" />
    </g>
  );
}

export default function AdvisorChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={192} scale={1.08}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
      </defs>

      <ellipse cx={100} cy={192} rx={66} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(100, 192)}>
        <g ref={partRef("mount")} style={jointStyle(100, 192)}>
          {/* 車廂內側 */}
          <path d="M48,150 C76,142 122,142 148,150 L146,158 C120,152 78,152 50,158 Z" fill="#8A5A0E" {...inkProps} />
        </g>

        {/* ---------- 身體 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(116, 166)}>
          <Fluffy uid={uid} ellipse={[116, 144, 38, 26]} />
        </g>

        {/* ---------- 頭（大頭） ---------- */}
        <g ref={partRef("head")} style={jointStyle(116, 130)}>
          <ChickHead cx={118} cy={100} rx={42} ry={35} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[105, 98]} eyeR={[134, 94]} beak={[121, 112]} cheekL={[90, 112]} cheekR={[146, 106]} scale={1.08} beakScale={1.4} winkLeft />
          <WingedHelmet cx={116} base={76} w={90} uid={uid} />
        </g>

        <g ref={partRef("torsoFront")} style={jointStyle(116, 166)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 116, top: 132, bottom: 166, w: 62 }} />
          </g>
          <Scarf cx={122} y={130} w={58} uid={uid} tail={0.6} />
        </g>

        {/* ---------- 左翅：盾 ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(84, 144)}>
          <Fluffy uid={uid} d="M86,138 C72,136 60,140 52,148 C56,152 60,152 64,151 C60,158 64,162 70,159 C72,164 80,164 84,158 C90,154 92,142 86,138 Z" wing />
          {armorType === "shield" ? (
            <HeldShield item={armor} center={[54, 148]} size={50} />
          ) : (
            <StarShield cx={52} cy={146} r={22} uid={uid} />
          )}
        </g>

        {/* ---------- 小車＋紅布 ---------- */}
        <g ref={partRef("mountFront")} style={jointStyle(100, 192)}>
          {/* 原圖長槍上的紅布，掛在車身左側 */}
          <path d="M44,150 C34,156 30,170 36,182 C42,176 48,176 52,172 C50,164 52,156 56,152 Z" fill={`url(#${uid}-red)`} {...inkProps} />
          <path d="M48,154 Q40,166 40,178" stroke="#7E1414" strokeWidth={1.4} fill="none" opacity={0.6} />
          <path d="M46,154 C76,146 122,146 152,154 L148,188 C120,194 78,194 50,188 Z" fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M48,158 C78,150 120,150 150,158" stroke="#FFF6CC" strokeWidth={2.4} fill="none" opacity={0.7} strokeLinecap="round" />
          <PawPanel x={92} y={160} w={48} h={26} uid={uid} />
          <path d="M58,170 q6,-6 12,0 q-6,6 -12,0 Z" fill="#FFE07A" stroke={INK} strokeWidth={1} />
        </g>

        <g ref={partRef("legL")} style={jointStyle(58, 180)}>
          <GoldWheel cx={58} cy={180} r={15} uid={uid} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(146, 182)}>
          <GoldWheel cx={146} cy={182} r={12} uid={uid} />
        </g>

        {/* ---------- 右翅：武器 ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(148, 140)}>
          <g ref={partRef("weapon")} style={jointStyle(170, 118)}>
            <HeldWeapon item={weapon} grip={[170, 118]} size={66} />
          </g>
          <Fluffy uid={uid} d="M144,134 C154,128 164,120 172,114 C176,120 174,124 170,127 C176,128 176,134 171,136 C172,142 166,144 160,142 C154,146 146,146 142,142 Z" wing />
          <path d="M154,138 Q162,132 168,126" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(116, 10), opacity: 0 }}>
          <KoStars cx={116} cy={10} />
        </g>
      </g>
    </UnitSpace>
  );
}
