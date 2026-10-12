// src/components/battle/MonsterArt.tsx
"use client";

/**
 * 程式繪製的怪物（SVG）
 * ------------------------------------------------------------
 * 10 座塔 × 3 種小怪 + 10 隻 Boss = 40 種長相，全部由這一支元件
 * 依「體型 × 屬性」組合出來，不需要任何圖檔：
 *
 *   體型（archetype，決定輪廓跟表情）
 *     tank      坦克型：寬圓殼、背甲三片、小眼濃眉、短腿
 *     attacker  攻擊型：前傾身體、雙角、怒眼、尖牙大嘴、前伸利爪
 *     balanced  均衡型：圓滾身體、大眼、小虎牙、圓耳
 *     boss      Boss：大一號的均衡型 ＋ 王冠、披風、發光眼、胸前紋章、背後光暈
 *
 *   屬性（element，決定配色跟裝飾，見 towerArt.ts）
 *     青草＝頭頂嫩葉／碧水＝背鰭泡泡／黃沙＝背上岩刺條紋／密林＝蘑菇藤蔓
 *     赤炎＝頭頂火焰／寒霜＝冰晶冰柱／雷鳴＝閃電角／幽暗＝煙霧下半身
 *     血月＝蝙蝠翅膀新月印／通天＝光環第三隻眼
 *
 * 所有怪物都「面向左邊」（玩家站在左邊）。
 * viewBox 固定 120 × 120，腳底大約在 y = 108；影子由戰鬥舞台畫，
 * 這裡不畫，這樣 Boss 從天而降的時候影子才會留在地上。
 *
 * 動態（眨眼、火焰閃爍、光暈呼吸）都是 globals.css 裡的 CSS 動畫，
 * 不吃 JS，幾十隻同時在畫面上也不會掉幀。
 */

import { useId } from "react";
import type { MonsterArchetype } from "@/lib/rpg/monsters";
import { getTowerArt, mixColor, withAlpha, type TowerArt } from "@/components/battle/towerArt";

export type MonsterBodyType = MonsterArchetype | "boss";

interface MonsterArtProps {
  tower: number;
  archetype: MonsterArchetype;
  isBoss?: boolean;
  /** 顯示尺寸（px），寬高相同 */
  size: number;
  /** 圖鑑裡還沒打過的怪物用剪影顯示 */
  silhouette?: boolean;
  className?: string;
}

/** 每種體型的關鍵座標：裝飾要黏在頭頂、背上的哪個位置 */
interface BodyAnchors {
  /** 頭頂中心 */
  topX: number;
  topY: number;
  /** 背部（右側，因為面向左）上緣 */
  backX: number;
  backY: number;
  /** 額頭（放新月印、第三隻眼） */
  foreheadX: number;
  foreheadY: number;
  /** 身體中心 */
  cx: number;
  cy: number;
  /** 身體半寬，裝飾縮放用 */
  radius: number;
}

const ANCHORS: Record<MonsterBodyType, BodyAnchors> = {
  balanced: { topX: 56, topY: 45, backX: 88, backY: 58, foreheadX: 52, foreheadY: 56, cx: 60, cy: 77, radius: 34 },
  tank: { topX: 60, topY: 47, backX: 92, backY: 62, foreheadX: 46, foreheadY: 66, cx: 60, cy: 82, radius: 44 },
  attacker: { topX: 58, topY: 38, backX: 92, backY: 54, foreheadX: 50, foreheadY: 52, cx: 62, cy: 74, radius: 36 },
  boss: { topX: 58, topY: 30, backX: 94, backY: 50, foreheadX: 54, foreheadY: 46, cx: 60, cy: 72, radius: 42 },
};

export default function MonsterArt({
  tower,
  archetype,
  isBoss = false,
  size,
  silhouette = false,
  className,
}: MonsterArtProps) {
  // useId 會產生 ":r1:" 這種帶冒號的字串，放進 url(#...) 某些瀏覽器會解析失敗
  const rawId = useId();
  const uid = `m${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const art = getTowerArt(tower);
  const body: MonsterBodyType = isBoss ? "boss" : archetype;
  const a = ANCHORS[body];

  const ids = {
    body: `${uid}-body`,
    belly: `${uid}-belly`,
    glow: `${uid}-glow`,
    flame: `${uid}-flame`,
    aura: `${uid}-aura`,
    gold: `${uid}-gold`,
  };

  // 剪影模式：全部填同一個暗色，保留輪廓讓學生猜「這是什麼」
  const fillBody = silhouette ? "#2A2A3A" : `url(#${ids.body})`;
  // 幽暗塔整個場景都是暗紫色，用暗色描邊會跟背景糊在一起，
  // 改用亮紫色描邊做出「輪廓光」
  const stroke = silhouette ? "#1A1A26" : art.element === "shadow" ? art.bodyLight : art.bodyDark;

  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      style={{ overflow: "visible", display: "block" }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={ids.body} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor={art.bodyLight} />
          <stop offset="48%" stopColor={art.body} />
          <stop offset="100%" stopColor={mixColor(art.body, art.bodyDark, 0.72)} />
        </radialGradient>
        <radialGradient id={ids.belly} cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.flame} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={art.body} />
          <stop offset="55%" stopColor={art.accent} />
          <stop offset="100%" stopColor="#FFFBE6" />
        </linearGradient>
        <radialGradient id={ids.aura} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={art.accent} stopOpacity="0.55" />
          <stop offset="55%" stopColor={art.body} stopOpacity="0.22" />
          <stop offset="100%" stopColor={art.body} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={ids.gold} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFF4C2" />
          <stop offset="45%" stopColor="#F5C542" />
          <stop offset="100%" stopColor="#A8740F" />
        </linearGradient>
        <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ---- Boss 背後的光暈（會呼吸） ---- */}
      {body === "boss" && !silhouette ? (
        <circle cx={60} cy={68} r={58} fill={`url(#${ids.aura})`} className="mon-aura" />
      ) : null}

      {/* ---- 身體後面的裝飾（翅膀、背鰭、披風、光環後半） ---- */}
      {!silhouette ? <ElementBehind art={art} body={body} a={a} ids={ids} /> : null}
      {body === "boss" ? <BossCape art={art} silhouette={silhouette} /> : null}

      {/* ---- 身體 ---- */}
      <BodyShape body={body} fill={fillBody} stroke={stroke} art={art} silhouette={silhouette} ids={ids} />

      {/* ---- 身體前面的裝飾 ---- */}
      {!silhouette ? <ElementFront art={art} body={body} a={a} ids={ids} /> : null}

      {/* ---- Boss 王冠 ---- */}
      {body === "boss" ? <BossCrown a={a} ids={ids} silhouette={silhouette} /> : null}

      {/* ---- 臉 ---- */}
      {!silhouette ? <Face body={body} art={art} ids={ids} /> : <SilhouetteEyes body={body} />}
    </svg>
  );
}

// ============================================================
// 身體輪廓
// ============================================================

function BodyShape({
  body,
  fill,
  stroke,
  art,
  silhouette,
  ids,
}: {
  body: MonsterBodyType;
  fill: string;
  stroke: string;
  art: TowerArt;
  silhouette: boolean;
  ids: Record<string, string>;
}) {
  const shadowSide = silhouette ? "none" : withAlpha(art.bodyDark, 0.28);
  const footFill = silhouette ? "#1A1A26" : mixColor(art.body, art.bodyDark, 0.55);
  // 幽暗塔沒有腳，下半身是煙（煙在 ElementFront 畫）
  const hasFeet = art.element !== "shadow";

  switch (body) {
    case "tank":
      return (
        <g>
          {hasFeet ? (
            <g fill={footFill} stroke={stroke} strokeWidth={2.2}>
              <rect x={22} y={96} width={14} height={13} rx={5} />
              <rect x={40} y={99} width={13} height={11} rx={5} />
              <rect x={70} y={99} width={13} height={11} rx={5} />
              <rect x={86} y={96} width={14} height={13} rx={5} />
            </g>
          ) : null}
          <path
            d="M14,100 C10,72 30,46 62,45 C94,46 112,72 106,100 C96,110 26,110 14,100 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={2.6}
            strokeLinejoin="round"
          />
          {/* 背甲：三片弧形甲殼，每片上緣一道亮邊 */}
          {!silhouette ? (
            <g>
              {[0, 1, 2].map((i) => {
                const x0 = 54 + i * 15;
                return (
                  <g key={i}>
                    <path
                      d={`M${x0},${52 + i * 2} C${x0 + 10},${56 + i * 3} ${x0 + 14},${72 + i * 3} ${x0 + 10},${92}`}
                      fill="none"
                      stroke={art.bodyDark}
                      strokeWidth={3}
                      strokeLinecap="round"
                      opacity={0.55}
                    />
                    <path
                      d={`M${x0 - 2},${53 + i * 2} C${x0 + 7},${57 + i * 3} ${x0 + 11},${70 + i * 3} ${x0 + 8},${86}`}
                      fill="none"
                      stroke={art.bodyLight}
                      strokeWidth={1.4}
                      strokeLinecap="round"
                      opacity={0.6}
                    />
                  </g>
                );
              })}
              <path d="M18,98 C40,108 80,108 102,98" fill="none" stroke={shadowSide} strokeWidth={6} strokeLinecap="round" />
              <ellipse cx={44} cy={90} rx={20} ry={10} fill={`url(#${ids.belly})`} />
            </g>
          ) : null}
        </g>
      );

    case "attacker":
      return (
        <g>
          {hasFeet ? (
            <g fill={footFill} stroke={stroke} strokeWidth={2.2}>
              <path d="M44,100 L40,110 L56,110 L56,100 Z" strokeLinejoin="round" />
              <path d="M74,100 L72,110 L88,110 L84,100 Z" strokeLinejoin="round" />
            </g>
          ) : null}
          {/* 前伸的利爪手臂（在身體後面先畫，身體會蓋住根部） */}
          <g>
            <path
              d="M40,78 C30,80 20,82 13,78"
              fill="none"
              stroke={stroke}
              strokeWidth={9}
              strokeLinecap="round"
            />
            <path d="M40,78 C30,80 20,82 13,78" fill="none" stroke={silhouette ? "#2A2A3A" : art.body} strokeWidth={5.5} strokeLinecap="round" />
            {!silhouette
              ? [-7, 0, 7].map((dy, i) => (
                  <path
                    key={i}
                    d={`M14,${78 + dy * 0.4} L4,${74 + dy} L12,${80 + dy * 0.5} Z`}
                    fill="#FFF6E6"
                    stroke={art.bodyDark}
                    strokeWidth={1.4}
                    strokeLinejoin="round"
                  />
                ))
              : null}
          </g>
          <path
            d="M30,100 C20,82 22,56 42,44 C58,34 82,34 96,48 C108,62 106,88 94,100 C82,110 44,112 30,100 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth={2.6}
            strokeLinejoin="round"
          />
          {/* 雙角 */}
          <g stroke={stroke} strokeWidth={2.2} strokeLinejoin="round" fill={silhouette ? "#2A2A3A" : "#FFF3DC"}>
            <path d="M44,44 C38,32 34,22 26,14 C38,18 48,28 52,40 Z" />
            <path d="M70,38 C72,26 76,16 84,8 C86,20 82,32 78,40 Z" />
          </g>
          {!silhouette ? (
            <g>
              <path d="M28,40 C34,22 30,18 26,14" fill="none" stroke={art.bodyDark} strokeWidth={1} opacity={0.35} />
              <path d="M34,98 C50,108 82,108 94,98" fill="none" stroke={shadowSide} strokeWidth={6} strokeLinecap="round" />
              <ellipse cx={58} cy={86} rx={18} ry={12} fill={`url(#${ids.belly})`} />
            </g>
          ) : null}
        </g>
      );

    case "boss":
      return (
        <g>
          {hasFeet ? (
            <g fill={footFill} stroke={stroke} strokeWidth={2.4}>
              <ellipse cx={42} cy={108} rx={12} ry={6} />
              <ellipse cx={80} cy={108} rx={12} ry={6} />
            </g>
          ) : null}
          <ellipse cx={60} cy={72} rx={42} ry={38} fill={fill} stroke={stroke} strokeWidth={2.8} />
          {!silhouette ? (
            <g>
              <path d="M22,82 C34,108 86,108 98,82" fill="none" stroke={shadowSide} strokeWidth={8} strokeLinecap="round" />
              <ellipse cx={56} cy={84} rx={24} ry={16} fill={`url(#${ids.belly})`} />
              {/* 胸前紋章：金框菱形，中間是屬性色寶石 */}
              <g transform="translate(60 92)">
                <path d="M0,-11 L9,0 L0,11 L-9,0 Z" fill={`url(#${ids.gold})`} stroke="#6E4A08" strokeWidth={1.2} />
                <path d="M0,-6.5 L5.5,0 L0,6.5 L-5.5,0 Z" fill={art.accent} stroke={art.bodyDark} strokeWidth={0.8} />
                <path d="M-2,-3 L0,-5 L1.2,-3.5 Z" fill="#FFFFFF" opacity={0.85} />
              </g>
            </g>
          ) : null}
        </g>
      );

    case "balanced":
    default:
      return (
        <g>
          {hasFeet ? (
            <g fill={footFill} stroke={stroke} strokeWidth={2.2}>
              <ellipse cx={46} cy={107} rx={10} ry={5.5} />
              <ellipse cx={74} cy={107} rx={10} ry={5.5} />
            </g>
          ) : null}
          {/* 圓耳（先畫，被身體蓋住根部） */}
          <g fill={silhouette ? "#2A2A3A" : art.body} stroke={stroke} strokeWidth={2.2}>
            <ellipse cx={36} cy={52} rx={9} ry={11} transform="rotate(-24 36 52)" />
            <ellipse cx={80} cy={50} rx={9} ry={11} transform="rotate(22 80 50)" />
          </g>
          {!silhouette ? (
            <g fill={withAlpha(art.accent === "#FFFFFF" ? art.bodyLight : art.accent, 0.55)}>
              <ellipse cx={36} cy={53} rx={4.5} ry={6} transform="rotate(-24 36 53)" />
              <ellipse cx={80} cy={51} rx={4.5} ry={6} transform="rotate(22 80 51)" />
            </g>
          ) : null}
          <ellipse cx={60} cy={77} rx={34} ry={32} fill={fill} stroke={stroke} strokeWidth={2.6} />
          {!silhouette ? (
            <g>
              <path d="M30,90 C40,108 80,108 90,90" fill="none" stroke={shadowSide} strokeWidth={6} strokeLinecap="round" />
              <ellipse cx={56} cy={88} rx={18} ry={12} fill={`url(#${ids.belly})`} />
            </g>
          ) : null}
        </g>
      );
  }
}

// ============================================================
// 臉（眼睛、嘴巴、腮紅）
// ============================================================

function Eye({
  cx,
  cy,
  r,
  pupil,
  angry = 0,
  glow,
  glowFilter,
}: {
  cx: number;
  cy: number;
  r: number;
  pupil: string;
  /** 怒眉角度：>0 往內下壓（兇），0 = 普通 */
  angry?: number;
  /** 發光眼（Boss、幽暗、血月）：瞳孔改成發光色、眼白變暗 */
  glow?: string;
  glowFilter?: string;
}) {
  const sclera = glow ? "#14101F" : "#FFFFFF";
  return (
    <g className="mon-blink" style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r} fill={sclera} stroke="rgba(0,0,0,0.55)" strokeWidth={1.4} />
      <circle
        cx={cx - r * 0.18}
        cy={cy + r * 0.08}
        r={r * 0.56}
        fill={glow ?? pupil}
        filter={glow && glowFilter ? `url(#${glowFilter})` : undefined}
      />
      <circle cx={cx - r * 0.42} cy={cy - r * 0.28} r={r * 0.22} fill="#FFFFFF" />
      <circle cx={cx + r * 0.1} cy={cy + r * 0.3} r={r * 0.1} fill="#FFFFFF" opacity={0.8} />
      {/* 怒眉：一片跟身體同色的眼皮從上方斜切下來 */}
      {angry > 0 ? (
        <path
          d={`M${cx - r - 1},${cy - r * (1 - angry * 0.5)} L${cx + r + 1},${cy - r * (1 + angry * 0.1)} L${cx + r + 1},${cy - r - 4} L${cx - r - 1},${cy - r - 4} Z`}
          fill="currentColor"
        />
      ) : null}
    </g>
  );
}

function Face({
  body,
  art,
  ids,
}: {
  body: MonsterBodyType;
  art: TowerArt;
  ids: Record<string, string>;
}) {
  // 這幾座塔的怪物眼睛會發光（暗色天空下比較有壓迫感）
  const glowingEyes = art.element === "shadow" || art.element === "bloodmoon";
  // Boss 的眼睛用點綴色發光；碧水、寒霜兩塔的點綴色是白色，發白光會變成
  // 「翻白眼」，改用金色，在藍色身體上反差也最大
  const bossGlow = art.accent.toUpperCase() === "#FFFFFF" ? "#FFD84B" : art.accent;
  const eyeGlow = body === "boss" ? bossGlow : glowingEyes ? art.pupil : undefined;
  const blush = withAlpha("#FF7A9C", 0.32);

  // 眼皮用 currentColor 畫，所以外層把 color 設成身體色
  switch (body) {
    case "tank":
      return (
        <g style={{ color: art.body }}>
          <Eye cx={36} cy={74} r={6.2} pupil={art.pupil} angry={0.6} glow={eyeGlow} glowFilter={ids.glow} />
          <Eye cx={54} cy={73} r={6.2} pupil={art.pupil} angry={0.6} glow={eyeGlow} glowFilter={ids.glow} />
          {/* 濃眉 */}
          <path d="M28,64 L42,67" stroke={art.bodyDark} strokeWidth={3.4} strokeLinecap="round" />
          <path d="M48,66 L62,63" stroke={art.bodyDark} strokeWidth={3.4} strokeLinecap="round" />
          {/* 平嘴＋往上翹的戽斗牙 */}
          <path d="M34,88 Q45,91 56,88" fill="none" stroke={art.bodyDark} strokeWidth={2.4} strokeLinecap="round" />
          <path d="M38,88 L40,82 L42,88 Z" fill="#FFF8EA" stroke={art.bodyDark} strokeWidth={1} strokeLinejoin="round" />
          <path d="M50,88 L52,82 L54,88 Z" fill="#FFF8EA" stroke={art.bodyDark} strokeWidth={1} strokeLinejoin="round" />
          <ellipse cx={26} cy={84} rx={5} ry={3} fill={blush} />
        </g>
      );

    case "attacker":
      return (
        <g style={{ color: art.body }}>
          <Eye cx={44} cy={64} r={8} pupil={art.pupil} angry={0.85} glow={eyeGlow} glowFilter={ids.glow} />
          <Eye cx={66} cy={62} r={8} pupil={art.pupil} angry={0.85} glow={eyeGlow} glowFilter={ids.glow} />
          {/* 張開的大嘴，上下兩排鋸齒牙 */}
          <path
            d="M34,80 Q52,98 74,80 Q66,90 54,91 Q42,90 34,80 Z"
            fill="#3A0D14"
            stroke={art.bodyDark}
            strokeWidth={2}
            strokeLinejoin="round"
          />
          <path d="M36,81 L40,86 L44,83 L48,88 L52,84 L56,88 L60,84 L64,87 L68,83 L72,81" fill="none" stroke="#FFF8EA" strokeWidth={2.2} strokeLinejoin="round" />
          <path d="M48,90 Q54,94 60,90" fill="#FF7A8A" opacity={0.8} />
        </g>
      );

    case "boss":
      return (
        <g style={{ color: art.body }}>
          <Eye cx={44} cy={62} r={9.5} pupil={art.pupil} angry={0.7} glow={eyeGlow} glowFilter={ids.glow} />
          <Eye cx={70} cy={61} r={9.5} pupil={art.pupil} angry={0.7} glow={eyeGlow} glowFilter={ids.glow} />
          {/* 獠牙嘴 */}
          <path d="M42,80 Q57,90 74,80" fill="none" stroke={art.bodyDark} strokeWidth={2.8} strokeLinecap="round" />
          <path d="M46,81 L49,90 L52,83 Z" fill="#FFF8EA" stroke={art.bodyDark} strokeWidth={1.1} strokeLinejoin="round" />
          <path d="M64,83 L67,90 L70,81 Z" fill="#FFF8EA" stroke={art.bodyDark} strokeWidth={1.1} strokeLinejoin="round" />
          <ellipse cx={32} cy={76} rx={6} ry={3.4} fill={blush} />
          <ellipse cx={84} cy={74} rx={6} ry={3.4} fill={blush} />
        </g>
      );

    case "balanced":
    default:
      return (
        <g style={{ color: art.body }}>
          <Eye cx={46} cy={70} r={9} pupil={art.pupil} glow={eyeGlow} glowFilter={ids.glow} />
          <Eye cx={68} cy={69} r={9} pupil={art.pupil} glow={eyeGlow} glowFilter={ids.glow} />
          {/* 微笑＋一顆小虎牙 */}
          <path d="M48,86 Q57,93 66,86" fill="none" stroke={art.bodyDark} strokeWidth={2.4} strokeLinecap="round" />
          <path d="M51,87.5 L53,92 L55,88.6 Z" fill="#FFF8EA" stroke={art.bodyDark} strokeWidth={0.9} strokeLinejoin="round" />
          <ellipse cx={36} cy={82} rx={5.5} ry={3.2} fill={blush} />
          <ellipse cx={80} cy={81} rx={5.5} ry={3.2} fill={blush} />
        </g>
      );
  }
}

/** 剪影模式只留兩顆發光小點，比全黑更像「躲在暗處的某個東西」 */
function SilhouetteEyes({ body }: { body: MonsterBodyType }) {
  const pos: Record<MonsterBodyType, [number, number, number, number]> = {
    tank: [36, 74, 54, 73],
    attacker: [44, 64, 66, 62],
    boss: [44, 62, 70, 61],
    balanced: [46, 70, 68, 69],
  };
  const [x1, y1, x2, y2] = pos[body];
  return (
    <g fill="#E8E2FF" opacity={0.7}>
      <ellipse cx={x1} cy={y1} rx={2.6} ry={1.6} />
      <ellipse cx={x2} cy={y2} rx={2.6} ry={1.6} />
    </g>
  );
}

// ============================================================
// Boss 專屬：王冠、披風
// ============================================================

function BossCrown({ a, ids, silhouette }: { a: BodyAnchors; ids: Record<string, string>; silhouette: boolean }) {
  const fill = silhouette ? "#2A2A3A" : `url(#${ids.gold})`;
  const stroke = silhouette ? "#1A1A26" : "#6E4A08";
  const x = a.topX;
  const y = a.topY + 8;
  return (
    <g transform={`translate(${x} ${y}) rotate(-8)`}>
      <path
        d="M-20,4 L-22,-14 L-12,-4 L-6,-20 L0,-6 L6,-20 L12,-4 L22,-14 L20,4 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      {!silhouette ? (
        <g>
          <rect x={-20} y={0} width={40} height={5} rx={1.5} fill={fill} stroke={stroke} strokeWidth={1.2} />
          <circle cx={0} cy={-4} r={2.6} fill="#FF4D6D" stroke="#7A0A1E" strokeWidth={0.8} />
          <circle cx={-12} cy={-1} r={1.8} fill="#4FC3FF" stroke="#0A4A7A" strokeWidth={0.6} />
          <circle cx={12} cy={-1} r={1.8} fill="#4FC3FF" stroke="#0A4A7A" strokeWidth={0.6} />
          <path d="M-17,-1 L17,-1" stroke="#FFF4C2" strokeWidth={0.8} opacity={0.8} />
        </g>
      ) : null}
    </g>
  );
}

function BossCape({ art, silhouette }: { art: TowerArt; silhouette: boolean }) {
  const fill = silhouette ? "#1E1E2C" : mixColor(art.bodyDark, "#000000", 0.25);
  const lining = silhouette ? "#1E1E2C" : mixColor(art.accent, art.bodyDark, 0.35);
  return (
    <g>
      <path
        d="M70,44 C98,40 116,64 114,96 C112,108 106,112 100,110 L96,98 L90,110 L84,100 L78,108 L74,70 Z"
        fill={fill}
        stroke={silhouette ? "#14141F" : art.bodyDark}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <path d="M78,52 C98,52 108,70 108,92" fill="none" stroke={lining} strokeWidth={2.4} opacity={0.75} strokeLinecap="round" />
    </g>
  );
}

// ============================================================
// 屬性裝飾
// ============================================================

/** 畫在身體「後面」的裝飾 */
function ElementBehind({
  art,
  body,
  a,
  ids,
}: {
  art: TowerArt;
  body: MonsterBodyType;
  a: BodyAnchors;
  ids: Record<string, string>;
}) {
  const s = a.radius / 34;
  switch (art.element) {
    case "water":
      // 背鰭＋尾鰭
      return (
        <g stroke={art.bodyDark} strokeWidth={2} strokeLinejoin="round">
          <path
            d={`M${a.backX - 18 * s},${a.backY - 2} C${a.backX - 6 * s},${a.backY - 30 * s} ${a.backX + 12 * s},${a.backY - 28 * s} ${a.backX + 14 * s},${a.backY - 22 * s} C${a.backX + 4 * s},${a.backY - 14 * s} ${a.backX + 2 * s},${a.backY - 4} ${a.backX},${a.backY + 6} Z`}
            fill={art.bodyLight}
          />
          <path
            d={`M${a.cx + a.radius - 4},${a.cy + 6} C${a.cx + a.radius + 14},${a.cy - 10} ${a.cx + a.radius + 22},${a.cy - 4} ${a.cx + a.radius + 20},${a.cy + 4} C${a.cx + a.radius + 24},${a.cy + 14} ${a.cx + a.radius + 16},${a.cy + 22} ${a.cx + a.radius - 4},${a.cy + 14} Z`}
            fill={art.body}
          />
        </g>
      );

    case "bloodmoon":
      // 蝙蝠翅膀（左右各一，膜上畫骨架線）
      return (
        <g stroke={art.bodyDark} strokeWidth={2} strokeLinejoin="round">
          {[-1, 1].map((dir) => {
            const ox = a.cx + dir * (a.radius - 6);
            const oy = a.cy - 10;
            const w = 30 * s;
            return (
              <g key={dir} className="mon-wing" style={{ transformOrigin: `${ox}px ${oy}px` }}>
                <path
                  d={`M${ox},${oy} C${ox + dir * w * 0.4},${oy - w * 0.9} ${ox + dir * w},${oy - w * 0.9} ${ox + dir * w * 1.1},${oy - w * 0.5} L${ox + dir * w * 0.8},${oy - w * 0.1} L${ox + dir * w * 0.7},${oy + w * 0.25} L${ox + dir * w * 0.4},${oy + w * 0.05} L${ox + dir * w * 0.2},${oy + w * 0.35} Z`}
                  fill={mixColor(art.bodyDark, art.body, 0.4)}
                />
                <path
                  d={`M${ox},${oy} L${ox + dir * w * 1.05},${oy - w * 0.5} M${ox},${oy} L${ox + dir * w * 0.78},${oy - w * 0.08} M${ox},${oy} L${ox + dir * w * 0.42},${oy + w * 0.06}`}
                  stroke={art.bodyDark}
                  strokeWidth={1.2}
                  fill="none"
                />
              </g>
            );
          })}
        </g>
      );

    case "celestial":
      // 光環的後半圈（前半圈在 ElementFront，做出「環繞頭部」的立體感）
      return (
        <ellipse
          cx={a.topX + 2}
          cy={a.topY - 8}
          rx={22 * s}
          ry={6 * s}
          fill="none"
          stroke={art.accent}
          strokeWidth={3}
          opacity={0.55}
          className="mon-halo"
          filter={`url(#${ids.glow})`}
        />
      );

    case "shadow":
      // 身後一團拖尾的煙
      return (
        <path
          d={`M${a.cx + 10},${a.cy + 10} C${a.cx + 40},${a.cy} ${a.cx + 54},${a.cy + 18} ${a.cx + 46},${a.cy + 30} C${a.cx + 56},${a.cy + 36} ${a.cx + 40},${a.cy + 44} ${a.cx + 24},${a.cy + 36} Z`}
          fill={withAlpha(art.bodyDark, 0.7)}
          className="mon-wisp"
        />
      );

    default:
      return null;
  }
}

/** 畫在身體「前面」的裝飾 */
function ElementFront({
  art,
  body,
  a,
  ids,
}: {
  art: TowerArt;
  body: MonsterBodyType;
  a: BodyAnchors;
  ids: Record<string, string>;
}) {
  const s = a.radius / 34;
  // 攻擊型頭頂有角，裝飾往角中間擠一點
  const tx = body === "attacker" ? a.topX + 4 : a.topX;
  const ty = body === "boss" ? a.topY - 2 : a.topY;

  switch (art.element) {
    case "grass":
      return (
        <g>
          {/* 兩片嫩葉，葉脈一條亮線 */}
          {[
            { rot: -38, len: 18 },
            { rot: 28, len: 14 },
          ].map((leaf, i) => (
            <g key={i} transform={`translate(${tx} ${ty + 2}) rotate(${leaf.rot})`} className="mon-sway">
              <path
                d={`M0,0 C${-leaf.len * 0.5},${-leaf.len * 0.4} ${-leaf.len * 0.3},${-leaf.len} 0,${-leaf.len * 1.15} C${leaf.len * 0.3},${-leaf.len} ${leaf.len * 0.5},${-leaf.len * 0.4} 0,0 Z`}
                fill={art.bodyLight}
                stroke={art.bodyDark}
                strokeWidth={1.6}
                strokeLinejoin="round"
              />
              <path d={`M0,-2 L0,${-leaf.len}`} stroke={art.body} strokeWidth={1.2} />
            </g>
          ))}
          {body === "boss" ? <Flower x={a.topX - 16} y={a.topY + 4} color={art.accent} /> : null}
          {/* 身上幾點草籽斑 */}
          <g fill={art.bodyDark} opacity={0.25}>
            <circle cx={a.cx + 14} cy={a.cy - 4} r={2} />
            <circle cx={a.cx + 20} cy={a.cy + 6} r={1.6} />
            <circle cx={a.cx + 8} cy={a.cy + 2} r={1.3} />
          </g>
        </g>
      );

    case "water":
      return (
        <g>
          {/* 身上的水光反射 */}
          <path
            d={`M${a.cx - a.radius * 0.55},${a.cy - a.radius * 0.45} C${a.cx - a.radius * 0.35},${a.cy - a.radius * 0.75} ${a.cx},${a.cy - a.radius * 0.8} ${a.cx + a.radius * 0.2},${a.cy - a.radius * 0.7}`}
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.55}
          />
          {/* 幾顆上浮的泡泡 */}
          {[
            { x: a.topX - 22, y: a.topY - 4, r: 4 },
            { x: a.topX - 14, y: a.topY - 16, r: 2.6 },
            { x: a.topX + 18, y: a.topY - 10, r: 3.2 },
          ].map((b, i) => (
            <g key={i} className="mon-bubble" style={{ animationDelay: `${i * 0.7}s` }}>
              <circle cx={b.x} cy={b.y} r={b.r} fill={withAlpha("#FFFFFF", 0.18)} stroke="#FFFFFF" strokeWidth={1} opacity={0.85} />
              <circle cx={b.x - b.r * 0.35} cy={b.y - b.r * 0.35} r={b.r * 0.28} fill="#FFFFFF" />
            </g>
          ))}
        </g>
      );

    case "sand":
      return (
        <g>
          {/* 背上三根岩刺 */}
          {[0, 1, 2].map((i) => {
            const bx = a.backX - 22 * s + i * 12 * s;
            const by = a.backY - 8 + i * 6;
            const h = (14 - i * 2) * s;
            return (
              <path
                key={i}
                d={`M${bx - 6 * s},${by + 4} L${bx + 2 * s},${by - h} L${bx + 8 * s},${by + 6} Z`}
                fill={i % 2 === 0 ? art.bodyLight : mixColor(art.body, art.bodyDark, 0.3)}
                stroke={art.bodyDark}
                strokeWidth={1.8}
                strokeLinejoin="round"
              />
            );
          })}
          {/* 身上的沙紋條 */}
          <g fill="none" stroke={art.bodyDark} strokeWidth={2.4} strokeLinecap="round" opacity={0.3}>
            <path d={`M${a.cx + 4},${a.cy - a.radius * 0.6} C${a.cx + 14},${a.cy - 4} ${a.cx + 14},${a.cy + 8} ${a.cx + 8},${a.cy + a.radius * 0.6}`} />
            <path d={`M${a.cx + 18},${a.cy - a.radius * 0.5} C${a.cx + 26},${a.cy - 2} ${a.cx + 26},${a.cy + 8} ${a.cx + 22},${a.cy + a.radius * 0.5}`} />
          </g>
        </g>
      );

    case "forest":
      return (
        <g>
          {/* 纏身的藤蔓 */}
          <path
            d={`M${a.cx - a.radius + 4},${a.cy + 10} C${a.cx - 10},${a.cy + 24} ${a.cx + 14},${a.cy + 2} ${a.cx + a.radius - 6},${a.cy + 16}`}
            fill="none"
            stroke="#1F5A2F"
            strokeWidth={3.4}
            strokeLinecap="round"
          />
          {[
            [a.cx - 14, a.cy + 17, -30],
            [a.cx + 12, a.cy + 6, 20],
          ].map(([x, y, rot], i) => (
            <path
              key={i}
              transform={`translate(${x} ${y}) rotate(${rot})`}
              d="M0,0 C-4,-3 -3,-8 0,-9 C3,-8 4,-3 0,0 Z"
              fill="#5FBF6E"
              stroke="#1F5A2F"
              strokeWidth={1}
            />
          ))}
          {/* 頭頂一朵蘑菇，傘蓋帶白點 */}
          <g transform={`translate(${tx + 4} ${ty + 4}) rotate(12)`}>
            <rect x={-3.5} y={-8} width={7} height={10} rx={3} fill="#FFF3E0" stroke={art.bodyDark} strokeWidth={1.4} />
            <path d={`M-14,-6 C-12,-22 12,-22 14,-6 Z`} fill={art.accent} stroke={art.bodyDark} strokeWidth={1.6} strokeLinejoin="round" />
            <circle cx={-6} cy={-12} r={2.4} fill="#FFFFFF" />
            <circle cx={4} cy={-15} r={1.8} fill="#FFFFFF" />
            <circle cx={8} cy={-9} r={1.5} fill="#FFFFFF" />
          </g>
        </g>
      );

    case "fire":
      return (
        <g>
          {/* 頭頂三束火焰，各自錯開閃爍 */}
          {[
            { dx: -9, h: 20, rot: -18, delay: 0 },
            { dx: 1, h: 28, rot: 0, delay: 0.15 },
            { dx: 11, h: 18, rot: 20, delay: 0.3 },
          ].map((f, i) => (
            <g key={i} transform={`translate(${tx + f.dx} ${ty + 6}) rotate(${f.rot})`}>
              <path
                className="mon-flicker"
                style={{ animationDelay: `${f.delay}s` }}
                d={`M-7,0 C-9,${-f.h * 0.4} -2,${-f.h * 0.6} 0,${-f.h} C2,${-f.h * 0.6} 9,${-f.h * 0.4} 7,0 Z`}
                fill={`url(#${ids.flame})`}
                stroke={art.bodyDark}
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
            </g>
          ))}
          {/* 臉頰餘燼光 */}
          <circle cx={a.cx - a.radius * 0.7} cy={a.cy + 4} r={5} fill={withAlpha(art.accent, 0.45)} filter={`url(#${ids.glow})`} />
          {/* 身上熔岩裂紋 */}
          <path
            d={`M${a.cx + 8},${a.cy - 10} L${a.cx + 14},${a.cy - 2} L${a.cx + 10},${a.cy + 6} L${a.cx + 18},${a.cy + 14}`}
            fill="none"
            stroke={art.accent}
            strokeWidth={1.8}
            strokeLinejoin="round"
            opacity={0.85}
            filter={`url(#${ids.glow})`}
          />
        </g>
      );

    case "frost":
      return (
        <g>
          {/* 頭頂冰晶 */}
          {[
            { dx: -10, h: 16, rot: -24 },
            { dx: 0, h: 24, rot: -2 },
            { dx: 10, h: 14, rot: 22 },
          ].map((c, i) => (
            <g key={i} transform={`translate(${tx + c.dx} ${ty + 6}) rotate(${c.rot})`}>
              <path
                d={`M0,2 L-4.5,${-c.h * 0.45} L0,${-c.h} L4.5,${-c.h * 0.45} Z`}
                fill="#F4FCFF"
                stroke={art.bodyDark}
                strokeWidth={1.3}
                strokeLinejoin="round"
              />
              <path d={`M0,0 L0,${-c.h * 0.9}`} stroke={art.body} strokeWidth={0.9} />
            </g>
          ))}
          {/* 下巴的小冰柱 */}
          {[a.cx - 16, a.cx - 8, a.cx].map((x, i) => (
            <path
              key={i}
              d={`M${x - 3},${a.cy + a.radius * 0.72} L${x},${a.cy + a.radius * 0.72 + 7 - i} L${x + 3},${a.cy + a.radius * 0.72} Z`}
              fill="#F4FCFF"
              stroke={art.bodyDark}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          ))}
          {/* 霜光斜線 */}
          <path
            d={`M${a.cx + 6},${a.cy - a.radius * 0.6} L${a.cx + 22},${a.cy - a.radius * 0.2}`}
            stroke="#FFFFFF"
            strokeWidth={3}
            strokeLinecap="round"
            opacity={0.7}
          />
        </g>
      );

    case "thunder":
      return (
        <g>
          {/* 兩根閃電角 */}
          {[-1, 1].map((dir) => (
            <path
              key={dir}
              transform={`translate(${tx + dir * 9} ${ty + 6}) scale(${dir} 1)`}
              d="M0,0 L-2,-10 L3,-10 L-1,-22 L8,-8 L3,-8 L5,0 Z"
              fill="#FFF8D0"
              stroke={art.accent}
              strokeWidth={1.4}
              strokeLinejoin="round"
              filter={`url(#${ids.glow})`}
            />
          ))}
          {/* 身上的電紋 */}
          <path
            d={`M${a.cx + 4},${a.cy - 12} L${a.cx + 12},${a.cy - 4} L${a.cx + 6},${a.cy} L${a.cx + 16},${a.cy + 10}`}
            fill="none"
            stroke={art.accent}
            strokeWidth={2}
            strokeLinejoin="round"
            className="mon-zap"
            filter={`url(#${ids.glow})`}
          />
        </g>
      );

    case "shadow":
      return (
        <g>
          {/* 下半身化成煙（蓋住身體下緣） */}
          <path
            d={`M${a.cx - a.radius},${a.cy + a.radius * 0.45} C${a.cx - a.radius * 0.6},${a.cy + a.radius * 1.1} ${a.cx - a.radius * 0.2},${a.cy + a.radius * 0.7} ${a.cx},${a.cy + a.radius * 1.05} C${a.cx + a.radius * 0.25},${a.cy + a.radius * 0.7} ${a.cx + a.radius * 0.6},${a.cy + a.radius * 1.15} ${a.cx + a.radius},${a.cy + a.radius * 0.45} Z`}
            fill={mixColor(art.body, art.bodyDark, 0.55)}
            className="mon-wisp"
          />
          {/* 頭頂一縷飄起的暗煙 */}
          <path
            d={`M${tx},${ty + 4} C${tx - 8},${ty - 6} ${tx + 6},${ty - 12} ${tx - 2},${ty - 22}`}
            fill="none"
            stroke={withAlpha(art.bodyLight, 0.5)}
            strokeWidth={3}
            strokeLinecap="round"
            className="mon-wisp"
          />
        </g>
      );

    case "bloodmoon":
      return (
        <g>
          {/* 額頭的新月印 */}
          <path
            transform={`translate(${a.foreheadX} ${a.foreheadY - 4})`}
            d="M-5,-3 A6,6 0 1,0 5,-3 A4.5,4.5 0 1,1 -5,-3 Z"
            fill={art.accent}
            filter={`url(#${ids.glow})`}
          />
        </g>
      );

    case "celestial":
      return (
        <g>
          {/* 光環前半圈 */}
          <path
            d={`M${a.topX + 2 - 22 * s},${a.topY - 8} A${22 * s},${6 * s} 0 0,0 ${a.topX + 2 + 22 * s},${a.topY - 8}`}
            fill="none"
            stroke={art.accent}
            strokeWidth={3}
            className="mon-halo"
            filter={`url(#${ids.glow})`}
          />
          {/* 第三隻眼 */}
          <g transform={`translate(${a.foreheadX + 6} ${a.foreheadY - 4})`}>
            <ellipse cx={0} cy={0} rx={5.5} ry={3.4} fill="#FFFFFF" stroke={art.bodyDark} strokeWidth={1.2} />
            <circle cx={-0.6} cy={0.2} r={2} fill={art.accent} filter={`url(#${ids.glow})`} />
          </g>
          {/* 環繞的小星星 */}
          {[
            { x: a.cx - a.radius - 6, y: a.cy - 14, r: 4 },
            { x: a.cx + a.radius + 4, y: a.cy - 24, r: 3 },
            { x: a.cx + a.radius - 2, y: a.cy + 18, r: 2.4 },
          ].map((st, i) => (
            <path
              key={i}
              className="mon-twinkle"
              style={{ animationDelay: `${i * 0.5}s`, transformOrigin: `${st.x}px ${st.y}px` }}
              d={`M${st.x},${st.y - st.r * 2} L${st.x + st.r * 0.5},${st.y - st.r * 0.5} L${st.x + st.r * 2},${st.y} L${st.x + st.r * 0.5},${st.y + st.r * 0.5} L${st.x},${st.y + st.r * 2} L${st.x - st.r * 0.5},${st.y + st.r * 0.5} L${st.x - st.r * 2},${st.y} L${st.x - st.r * 0.5},${st.y - st.r * 0.5} Z`}
              fill={art.accent}
            />
          ))}
        </g>
      );

    default:
      return null;
  }
}

/** 青草塔 Boss 頭上的花 */
function Flower({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 72, 144, 216, 288].map((deg) => (
        <ellipse
          key={deg}
          cx={0}
          cy={-5}
          rx={3.4}
          ry={5}
          transform={`rotate(${deg})`}
          fill="#FFFFFF"
          stroke="#E2B93B"
          strokeWidth={0.8}
        />
      ))}
      <circle cx={0} cy={0} r={3.2} fill={color} stroke="#A8740F" strokeWidth={0.8} />
    </g>
  );
}
