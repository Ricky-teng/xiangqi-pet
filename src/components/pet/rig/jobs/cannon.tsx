// src/components/pet/rig/jobs/cannon.tsx
"use client";

/**
 * 炮兵雞（參考 public/image/catalog/cannon.png）
 * ------------------------------------------------------------
 * 原圖：綠色軍盔＋紅色羽冠＋金星徽章、小雞坐在木頭炮車後面、
 * 一門往右上翹的大鐵炮、炮車左邊一顆點著引信的黑色炸彈。
 *
 * 部位對應：legL / legR = 兩個木頭車輪（攻擊時會轉）、mount = 炮車底座＋炸彈、
 * mountHead = 炮管（攻擊、放技能時會後座）。
 * 座標是原圖的 220 格（腳底 y≈194）。
 */

import { jointStyle } from "@/components/pet/rig/ChickRig";
import { ChickGradients, Face, Fluffy, HeldShield, HeldWeapon, INK, KoStars, UnitSpace, inkProps } from "@/components/pet/rig/parts";
import { ChickHead, PropDefs, Scarf, WoodWheel } from "@/components/pet/rig/props";
import { BodyArmor } from "@/components/pet/rig/armor";
import type { RigJobProps } from "@/components/pet/rig/jobs/index";
import { getItemType } from "@/lib/rpg/equipment";

export default function CannonChick({ uid, weapon, armor, expression, partRef }: RigJobProps) {
  const armorType = armor ? getItemType(armor) : null;
  return (
    <UnitSpace bottom={194} scale={1.12}>
      <defs>
        <ChickGradients uid={uid} />
        <PropDefs uid={uid} />
        <radialGradient id={`${uid}-bomb`} cx="35%" cy="30%" r="70%">
          <stop offset="0%" stopColor="#7A808C" />
          <stop offset="50%" stopColor="#2E323A" />
          <stop offset="100%" stopColor="#0E1014" />
        </radialGradient>
      </defs>

      <ellipse cx={122} cy={194} rx={74} ry={7} fill="#000" opacity={0.16} />

      <g ref={partRef("root")} style={jointStyle(122, 194)}>
        {/* ---------- 炮車底座＋炸彈 ---------- */}
        <g ref={partRef("mount")} style={jointStyle(122, 194)}>
          {/* 炸彈＋引信＋火花 */}
          <circle cx={58} cy={164} r={17} fill={`url(#${uid}-bomb)`} {...inkProps} />
          <ellipse cx={52} cy={157} rx={5} ry={3.5} fill="#FFFFFF" opacity={0.45} />
          <rect x={52} y={142} width={12} height={8} rx={2} fill="#4A4F58" {...inkProps} strokeWidth={1.8} />
          <path d="M58,142 Q52,130 44,128" stroke="#C8A06A" strokeWidth={2.4} fill="none" strokeLinecap="round" />
          <g className="fuse-spark" style={jointStyle(42, 126)}>
            <path d="M42,114 L44.5,122 L53,124 L45,127 L46,136 L41,129 L33,132 L38,125 L33,118 L40,121 Z" fill="#FFE04A" stroke="#C86A0A" strokeWidth={1.2} strokeLinejoin="round" />
            <circle cx={42} cy={125} r={2.5} fill="#FFFFFF" />
          </g>
          {/* 炮車木樑 */}
          <path d="M66,154 L176,140 L184,160 L72,174 Z" fill={`url(#${uid}-wood)`} {...inkProps} />
          <path d="M70,160 L178,146" stroke="#FFE2B0" strokeWidth={2} opacity={0.5} strokeLinecap="round" />
          {[86, 118, 150].map((x, i) => (
            <circle key={x} cx={x} cy={166 - i * 4} r={2.6} fill={`url(#${uid}-gold)`} stroke={INK} strokeWidth={1.2} />
          ))}
          {/* 炮耳架 */}
          <path d="M118,150 L126,128 L142,128 L146,148 Z" fill={`url(#${uid}-wood)`} {...inkProps} />
        </g>

        {/* ---------- 小雞身體（坐在炮車後面，只露出上半身） ---------- */}
        <g ref={partRef("torso")} style={jointStyle(104, 158)}>
          <Fluffy uid={uid} ellipse={[102, 140, 38, 28]} />
          <ellipse cx={94} cy={134} rx={16} ry={9} fill="#FFFDE0" opacity={0.35} />
        </g>

        {/* ---------- 頭＋軍盔 ---------- */}
        <g ref={partRef("head")} style={jointStyle(110, 124)}>
          <ChickHead cx={114} cy={98} rx={34} ry={30} uid={uid} />
          <Face uid={uid} expression={expression} eyeL={[106, 98]} eyeR={[132, 96]} beak={[120, 110]} cheekL={[92, 110]} cheekR={[142, 106]} scale={0.95} beakScale={1.25} />
          {/* 紅羽冠 */}
          <path d="M98,58 C92,34 112,24 130,30 C140,34 142,46 136,54 C128,46 118,44 112,50 C108,54 104,58 102,62 Z" fill={`url(#${uid}-red)`} {...inkProps} />
          <path d="M104,52 Q112,36 128,36 M108,56 Q118,44 132,44" stroke="#8E1414" strokeWidth={1.4} fill="none" opacity={0.6} />
          {/* 軍盔 */}
          <path d="M76,92 C72,58 98,46 116,46 C138,46 156,60 152,90 Z" fill={`url(#${uid}-armyGreen)`} {...inkProps} />
          <path d="M84,74 C88,60 100,52 112,50" stroke="#C8D8A0" strokeWidth={3} fill="none" opacity={0.5} strokeLinecap="round" />
          <path d="M72,90 Q114,82 156,88 L156,96 Q114,90 72,98 Z" fill="#4A5A2A" {...inkProps} />
          {/* 金星徽章 */}
          <path d="M126,62 L128.5,68.5 L135.5,69 L130,73.5 L132,80 L126,76.2 L120,80 L122,73.5 L116.5,69 L123.5,68.5 Z" fill={`url(#${uid}-gold)`} stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
        </g>

        {/* ---------- 領巾＋防具 ---------- */}
        <g ref={partRef("torsoFront")} style={jointStyle(104, 158)}>
          <g ref={partRef("armor")}>
            <BodyArmor type={armorType} tier={armor?.tier ?? 1} uid={uid} torso={{ cx: 104, top: 126, bottom: 156, w: 66 }} />
          </g>
          <Scarf cx={108} y={124} w={62} uid={uid} tail={0.7} />
        </g>

        {/* ---------- 左翅（搭在炮車上，拿盾） ---------- */}
        <g ref={partRef("wingL")} style={jointStyle(78, 138)}>
          <Fluffy uid={uid} d="M82,130 C68,130 56,136 48,146 C54,150 58,148 62,147 C58,154 62,158 68,155 C70,160 78,160 82,152 C90,148 90,136 82,130 Z" wing />
          <path d="M60,148 Q70,144 80,142" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
          <HeldShield item={armorType === "shield" ? armor : null} center={[56, 148]} size={48} />
        </g>

        {/* ---------- 炮管（往右上翹，會後座） ---------- */}
        <g ref={partRef("mountHead")} style={jointStyle(132, 140)}>
          <g transform="rotate(-24 132 140)">
            <circle cx={84} cy={140} r={9} fill={`url(#${uid}-gun)`} {...inkProps} />
            <path d="M92,123 L188,126 Q194,140 188,154 L92,157 Q82,140 92,123 Z" fill={`url(#${uid}-gun)`} {...inkProps} />
            <path d="M96,128 L184,130" stroke="#D8DEE8" strokeWidth={3} opacity={0.55} strokeLinecap="round" />
            {[112, 150].map((x) => (
              <rect key={x} x={x} y={x === 112 ? 121 : 123} width={9} height={x === 112 ? 38 : 34} rx={3} fill={`url(#${uid}-gun)`} {...inkProps} strokeWidth={2} />
            ))}
            <ellipse cx={190} cy={140} rx={8} ry={20} fill={`url(#${uid}-gun)`} {...inkProps} />
            <ellipse cx={192} cy={140} rx={4.5} ry={13} fill="#0E1014" />
            <ellipse cx={186} cy={128} rx={2} ry={4} fill="#FFFFFF" opacity={0.5} />
          </g>
        </g>

        {/* ---------- 車輪 ---------- */}
        <g ref={partRef("legL")} style={jointStyle(104, 176)}>
          <WoodWheel cx={104} cy={176} r={19} uid={uid} />
        </g>
        <g ref={partRef("legR")} style={jointStyle(164, 172)}>
          <WoodWheel cx={164} cy={172} r={17} uid={uid} />
        </g>

        {/* ---------- 右翅（扶在炮管上，拿武器） ---------- */}
        <g ref={partRef("wingR")} style={jointStyle(136, 128)}>
          <g ref={partRef("weapon")} style={jointStyle(160, 112)}>
            <HeldWeapon item={weapon} grip={[160, 112]} size={66} />
          </g>
          <Fluffy uid={uid} d="M132,122 C144,116 156,108 166,104 C168,110 166,114 162,117 C168,118 168,124 163,126 C164,132 158,134 152,132 C146,136 138,136 132,132 Z" wing />
          <path d="M146,124 Q154,120 160,116" stroke={INK} strokeWidth={1.3} fill="none" opacity={0.5} />
        </g>

        <g ref={partRef("fx")} style={{ ...jointStyle(114, 30), opacity: 0 }}>
          <KoStars cx={114} cy={30} />
        </g>
      </g>
    </UnitSpace>
  );
}
