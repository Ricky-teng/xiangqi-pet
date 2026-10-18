// src/components/rpg/SkillIcon.tsx
"use client";

/**
 * 技能圖示（程式繪製）
 * ------------------------------------------------------------
 * 六角形徽章＋技能色漸層，中間的符號依效果種類畫：
 *   單體攻擊 → 斬擊刀痕　全體 → 爆炸星　連打 → 三道爪痕
 *   暈 → 星星繞圈　燃燒 → 火焰　回血 → 十字　減傷 → 盾牌
 *   攻擊增益 → 向上箭頭＋刀　速度增益 → 閃電　護盾 → 泡泡
 * 職業搭配（boosted）多一圈金邊跟右上角的星星。
 */

import { useId } from "react";
import { getSkill, type SkillId } from "@/lib/rpg/skills";

type Glyph = "slash" | "burst" | "claws" | "stun" | "flame" | "cross" | "guard" | "power" | "bolt" | "bubble";

function glyphOf(skillId: SkillId): Glyph {
  const e = getSkill(skillId).effect;
  switch (e.kind) {
    case "strike":
      if (e.burn) return "flame";
      if (e.hits && e.hits > 1) return "claws";
      if (e.aoe) return "burst";
      if (e.stun) return "stun";
      return "slash";
    case "heal":
      return "cross";
    case "buff":
      return e.stat === "guard" ? "guard" : e.stat === "attack" ? "power" : "bolt";
    case "shield":
      return "bubble";
  }
}

export default function SkillIcon({
  skillId,
  size,
  boosted = false,
  dim = false,
  className,
}: {
  skillId: SkillId;
  size: number;
  boosted?: boolean;
  /** 冷卻中：整個變暗 */
  dim?: boolean;
  className?: string;
}) {
  const raw = useId();
  const uid = `sk${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const color = getSkill(skillId).color;
  const glyph = glyphOf(skillId);
  const hex = "20,2 36,11 36,29 20,38 4,29 4,11";

  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", overflow: "visible", filter: dim ? "grayscale(0.7) brightness(0.55)" : undefined }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#1A1430" />
        </linearGradient>
        <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={boosted ? "#FFF6C8" : "#FFFFFF"} stopOpacity={boosted ? 1 : 0.7} />
          <stop offset="50%" stopColor={boosted ? "#F5C542" : color} />
          <stop offset="100%" stopColor={boosted ? "#8A5A12" : "#2A2050"} />
        </linearGradient>
      </defs>
      <polygon points={hex} fill={`url(#${uid}-bg)`} stroke={`url(#${uid}-rim)`} strokeWidth={boosted ? 3 : 2} strokeLinejoin="round" />
      <polygon points="20,5 33,12.5 33,20 20,13 7,20 7,12.5" fill="#FFFFFF" opacity={0.16} />
      <g fill="#FFFFFF" stroke="#FFFFFF" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 2px ${color})` }}>
        <GlyphPath glyph={glyph} />
      </g>
      {boosted ? (
        <path d="M34,1 L35.6,4.6 L39.5,5 L36.5,7.6 L37.4,11.4 L34,9.4 L30.6,11.4 L31.5,7.6 L28.5,5 L32.4,4.6 Z" fill="#FFE58A" stroke="#8A5A12" strokeWidth={0.8} />
      ) : null}
    </svg>
  );
}

function GlyphPath({ glyph }: { glyph: Glyph }) {
  switch (glyph) {
    case "slash":
      return <path d="M11,29 Q18,22 29,11 L27,17 Q20,24 13,30 Z" stroke="none" />;
    case "burst":
      return (
        <path
          d="M20,9 L22.5,16 L30,14 L25,20 L30,26 L22.5,24 L20,31 L17.5,24 L10,26 L15,20 L10,14 L17.5,16 Z"
          stroke="none"
        />
      );
    case "claws":
      return (
        <g fill="none" strokeWidth={2.4}>
          <path d="M12,27 Q17,19 22,11" />
          <path d="M16,29 Q21,21 26,13" />
          <path d="M20,31 Q25,23 30,15" />
        </g>
      );
    case "stun":
      return (
        <g>
          <ellipse cx={20} cy={21} rx={10} ry={4} fill="none" strokeWidth={1.6} />
          <path d="M14,13 L15,15.5 L17.6,15.7 L15.6,17.3 L16.3,19.8 L14,18.4 L11.7,19.8 L12.4,17.3 L10.4,15.7 L13,15.5 Z" stroke="none" />
          <path d="M26,22 L26.8,24 L29,24.2 L27.3,25.5 L27.9,27.6 L26,26.4 L24.1,27.6 L24.7,25.5 L23,24.2 L25.2,24 Z" stroke="none" />
        </g>
      );
    case "flame":
      return <path d="M20,9 C24,14 28,17 27,23 C26.5,28 23,31 20,31 C16,31 13,28 13,24 C13,20 16,18 17,14 C18.5,17 19.5,18 20.5,19 C21.5,15 21,12 20,9 Z" stroke="none" />;
    case "cross":
      return <path d="M17,10 L23,10 L23,17 L30,17 L30,23 L23,23 L23,30 L17,30 L17,23 L10,23 L10,17 L17,17 Z" stroke="none" />;
    case "guard":
      return <path d="M20,9 L29,12.5 L29,20 C29,25.5 25,29 20,31 C15,29 11,25.5 11,20 L11,12.5 Z" stroke="none" />;
    case "power":
      return (
        <g stroke="none">
          <path d="M20,8 L27,16 L22.5,16 L22.5,24 L17.5,24 L17.5,16 L13,16 Z" />
          <rect x={13} y={27} width={14} height={3} rx={1.5} />
        </g>
      );
    case "bolt":
      return <path d="M23,8 L13,22 L19,22 L16,32 L27,17 L21,17 Z" stroke="none" />;
    case "bubble":
      return (
        <g>
          <circle cx={20} cy={20} r={10} fill="none" strokeWidth={2.2} />
          <path d="M14.5,17 Q16,13 20,12.5" fill="none" strokeWidth={2} />
        </g>
      );
  }
}
