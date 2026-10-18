// src/components/pet/rig/jobs/chariot.tsx
"use client";

/**
 * 戰車雞（參考 public/image/catalog/chariot.png）
 * ------------------------------------------------------------
 * 原圖：銀色翅膀頭盔＋紅羽冠、眨一隻眼、坐在金色戰車裡、綠色戰袍、
 * 左肩紅披風白毛邊、右手舉一把小劍、車身正面藍色腳印面板。
 *
 * 部位對應：legL = 後輪、legR = 前輪、mount = 車廂內側、mountFront = 車身外殼。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { Cape, ChickHead, GoldWheel, PawPanel, PropDefs, Scarf, WingedHelmet } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

export default function ChariotChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={190} scale={1.12}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
      </defs>

      <ellipse cx={88} cy={190} rx={74} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(88, 190)}>
        {/* ---------- 車廂內側（暗面） ---------- */}
        <g ref={partRef("mount")} style={jointStyle(88, 190)}>
          <path d="M26,122 C60,112 116,112 142,122 L140,132 C112,124 60,124 28,132 Z" fill="#8A5A0E" {...inkProps} />
        </g>

        {/* ---------- 身體：綠色戰袍 ---------- */}
        <g ref={partRef("torso")} style={jointStyle(86, 150)}>
          <ellipse cx={86} cy={124} rx={32} ry={24} fill={`url(#${uid}-tunic)`} {...inkProps} />
          <path d="M60,118 Q86,128 112,118" stroke="#F2C14A" strokeWidth={3} fill="none" />
          <circle cx={86} cy={130} r={4} fill={`url(#${uid}-gold)`} stroke={INK} strokeWidth={1.2} />
        </g>

        {/* ---------- 頭 ---------- */}
        <g ref={partRef("head")} style={jointStyle(86, 104)}>
          <ChickHead cx={86} cy={76} rx={32} ry={27} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[76, 74]} eyeR={[100, 72]} beak={[90, 85]} cheekL={[66, 86]} cheekR={[108, 82]} scale={0.92} beakScale={1.1} winkLeft />
          <WingedHelmet cx={86} base={58} w={72} uid={uid} />
        </g>

        {/* ---------- 領巾、披風、防具 ---------- */}
        <g ref={partRef("torsoFront")} style={jointStyle(86, 150)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 88, top: 104, bottom: 140, w: 56 }} />
          </g>
          <Scarf cx={90} y={100} w={44} uid={uid} tail={0.6} />
          <Cape x={52} y={104} len={30} w={42} uid={uid} />
        </g>

        {/* ---------- 左翅（藏在披風後面，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(60, 118)}>
          <Fluffy uid={uid} d="M62,112 C50,110 40,114 32,120 C36,124 40,124 44,123 C40,130 44,134 50,131 C52,136 60,136 63,130 C68,126 68,116 62,112 Z" wing />
          <HeldShield item={armorType === "shield" ? armor : null} center={[36, 124]} size={46} />
        </g>

        {/* ---------- 車身外殼＋藍色面板 ---------- */}
        <g ref={partRef("mountFront")} style={jointStyle(88, 190)}>
          <path d="M22,128 C58,120 116,120 146,128 L140,176 C110,184 60,184 30,176 Z" fill={`url(#${uid}-gold)`} {...inkProps} />
          <path d="M24,132 C58,124 114,124 144,132" stroke="#FFF6CC" strokeWidth={2.4} fill="none" opacity={0.7} strokeLinecap="round" />
          <path d="M26,144 L142,144" stroke="#9A6614" strokeWidth={2} opacity={0.5} />
          <path d="M30,166 C60,172 110,172 140,166" stroke="#9A6614" strokeWidth={2} fill="none" opacity={0.5} />
          {/* 車身上的金色渦紋 */}
          <path d="M36,152 q6,-6 12,0 q-6,6 -12,0 Z M56,154 q6,-6 12,0 q-6,6 -12,0 Z" fill="#FFE07A" stroke={INK} strokeWidth={1} />
          <PawPanel x={84} y={140} w={50} h={30} uid={uid} />
        </g>

        {/* ---------- 車輪 ---------- */}
        <g ref={partRef("legL")} style={jointStyle(42, 170)}>
          <GoldWheel cx={42} cy={170} r={21} uid={uid} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(138, 172)}>
          <GoldWheel cx={138} cy={172} r={17} uid={uid} />
        </g>

        {/* ---------- 右翅（舉劍） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(110, 116)}>
          <g ref={partRef("weapon")} style={jointStyle(128, 96)}>
            <HeldWeapon item={weapon} grip={[128, 96]} size={60} angle={-10} />
          </g>
          <Fluffy uid={uid} d="M106,112 C114,104 122,98 130,94 C134,100 132,104 128,106 C134,108 132,114 127,115 C128,121 122,123 117,121 C112,125 106,124 104,120 Z" wing />
          <path d="M114,114 Q120,110 126,104" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(86, 6), opacity: 0 }}>
          <KoStars cx={86} cy={6} />
        </g>
      </g>
    </UnitSpace>
  );
}
