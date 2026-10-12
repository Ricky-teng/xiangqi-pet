// src/components/battle/towerArt.ts

/**
 * 每座塔的美術設定（戰鬥背景、怪物配色、環境粒子）
 * ------------------------------------------------------------
 * 戰鬥畫面的所有「長相」都從這裡查，數值平衡完全不碰這個檔案。
 *
 * 為什麼每座塔手挑一組顏色、而不是從 accentColor 自動推算：
 * 自動推算（加亮／加暗）出來的配色很平，例如「赤炎塔」需要的是
 * 暗紅天空＋亮橘火光，「寒霜塔」需要的是深藍天空＋接近白的冰，
 * 這種明暗反差用公式推不出來，手挑才有質感。
 *
 * 戰隊對戰沒有塔，用 "arena"（競技場）這一組。
 */

/** 塔的屬性。怪物的造型裝飾、背景道具、環境粒子都依這個分支 */
export type TowerElement =
  | "grass"
  | "water"
  | "sand"
  | "forest"
  | "fire"
  | "frost"
  | "thunder"
  | "shadow"
  | "bloodmoon"
  | "celestial"
  | "arena";

/** 環境粒子的種類（在 fxEngine 裡實作） */
export type AmbientKind =
  | "leaves"
  | "bubbles"
  | "sand"
  | "spores"
  | "embers"
  | "snow"
  | "sparks"
  | "smoke"
  | "petals"
  | "stars"
  | "dust";

export interface TowerArt {
  element: TowerElement;
  /** 怪物身體三階：亮面／主色／暗面（暗面同時當描邊色） */
  bodyLight: string;
  body: string;
  bodyDark: string;
  /** 怪物身上的點綴色（花、蘑菇點、冰晶反光、眼睛發光……） */
  accent: string;
  /** 怪物瞳孔顏色 */
  pupil: string;
  /** 天空漸層：上 → 下 */
  skyTop: string;
  skyBottom: string;
  /** 遠景山脈剪影 */
  farSilhouette: string;
  /** 近景剪影 */
  nearSilhouette: string;
  /** 地面漸層：上（遠）→ 下（近） */
  groundTop: string;
  groundBottom: string;
  /** 天空中的發光天體（太陽／月亮）顏色，null = 不畫 */
  celestialGlow: string | null;
  /** 環境粒子 */
  ambient: AmbientKind;
  /** 環境粒子的顏色（隨機挑） */
  ambientColors: string[];
  /** 打擊火花的顏色（命中時噴出來的） */
  impactColors: string[];
}

const ARTS: Record<TowerElement, TowerArt> = {
  grass: {
    element: "grass",
    bodyLight: "#C9F08F",
    body: "#7FC25A",
    bodyDark: "#2F6B22",
    accent: "#FFD84B",
    pupil: "#1F3A12",
    skyTop: "#8FD3F5",
    skyBottom: "#E6F6D2",
    farSilhouette: "#9CC9A8",
    nearSilhouette: "#5E9A4A",
    groundTop: "#78B44E",
    groundBottom: "#2F5A22",
    celestialGlow: "#FFF6C8",
    ambient: "leaves",
    ambientColors: ["#9BD26B", "#CFEA8A", "#6FB548"],
    impactColors: ["#FFFFFF", "#E6FFB0", "#9BD26B"],
  },
  water: {
    element: "water",
    bodyLight: "#B5EEFF",
    body: "#4FB3D9",
    bodyDark: "#14577A",
    accent: "#FFFFFF",
    pupil: "#0B2C40",
    skyTop: "#082E4D",
    skyBottom: "#2E93B8",
    farSilhouette: "#1C5F82",
    nearSilhouette: "#0F4563",
    groundTop: "#1F6E8C",
    groundBottom: "#062234",
    celestialGlow: "#BFF4FF",
    ambient: "bubbles",
    ambientColors: ["#BFF4FF", "#7FDBFF", "#FFFFFF"],
    impactColors: ["#FFFFFF", "#BFF4FF", "#4FC3F7"],
  },
  sand: {
    element: "sand",
    bodyLight: "#FBE2A4",
    body: "#E0A84A",
    bodyDark: "#8A5517",
    accent: "#D2452F",
    pupil: "#3B1F05",
    skyTop: "#F0A24E",
    skyBottom: "#FCE6B6",
    farSilhouette: "#E9B877",
    nearSilhouette: "#C98A3E",
    groundTop: "#E2A957",
    groundBottom: "#9A5F22",
    celestialGlow: "#FFF0C2",
    ambient: "sand",
    ambientColors: ["#F7D58B", "#E9B877", "#FFF0C2"],
    impactColors: ["#FFFFFF", "#FFE7A8", "#F0A24E"],
  },
  forest: {
    element: "forest",
    bodyLight: "#8EDBA0",
    body: "#3E8E5A",
    bodyDark: "#143A22",
    accent: "#EF6F96",
    pupil: "#0B1F12",
    skyTop: "#0C2416",
    skyBottom: "#2D6A44",
    farSilhouette: "#1D4A30",
    nearSilhouette: "#10301E",
    groundTop: "#2A5A38",
    groundBottom: "#0B1D12",
    celestialGlow: "#D9FFB8",
    ambient: "spores",
    ambientColors: ["#D4FF8A", "#9CFFB8", "#F7FFC2"],
    impactColors: ["#FFFFFF", "#D4FF8A", "#8EDBA0"],
  },
  fire: {
    element: "fire",
    bodyLight: "#FFB36B",
    body: "#E0442E",
    bodyDark: "#6E140B",
    accent: "#FFD23F",
    pupil: "#2A0603",
    skyTop: "#1E0606",
    skyBottom: "#9A2E10",
    farSilhouette: "#4A120A",
    nearSilhouette: "#2A0A05",
    groundTop: "#4A1608",
    groundBottom: "#120402",
    celestialGlow: "#FF8A3D",
    ambient: "embers",
    ambientColors: ["#FFD23F", "#FF8A3D", "#FF5A1F"],
    impactColors: ["#FFFFFF", "#FFE07A", "#FF8A3D"],
  },
  frost: {
    element: "frost",
    bodyLight: "#F2FBFF",
    body: "#8FD3F0",
    bodyDark: "#2F6C94",
    accent: "#FFFFFF",
    pupil: "#0E2A40",
    skyTop: "#14253F",
    skyBottom: "#6FA8D0",
    farSilhouette: "#4F7FA6",
    nearSilhouette: "#BFD9EC",
    groundTop: "#DDEFFA",
    groundBottom: "#7FA9C8",
    celestialGlow: "#E6F7FF",
    ambient: "snow",
    ambientColors: ["#FFFFFF", "#E6F7FF", "#CDEBFF"],
    impactColors: ["#FFFFFF", "#E6F7FF", "#8FD3F0"],
  },
  thunder: {
    element: "thunder",
    bodyLight: "#FFF4B0",
    body: "#F2C94C",
    bodyDark: "#7A5A0A",
    accent: "#7FDBFF",
    pupil: "#231A02",
    skyTop: "#100E26",
    skyBottom: "#3A3472",
    farSilhouette: "#25204E",
    nearSilhouette: "#171433",
    groundTop: "#2A2652",
    groundBottom: "#0B0A1C",
    celestialGlow: null,
    ambient: "sparks",
    ambientColors: ["#FFF4B0", "#7FDBFF", "#FFFFFF"],
    impactColors: ["#FFFFFF", "#FFF4B0", "#7FDBFF"],
  },
  shadow: {
    element: "shadow",
    bodyLight: "#B392E0",
    body: "#6B4593",
    bodyDark: "#22123A",
    accent: "#7CFFCB",
    pupil: "#7CFFCB",
    skyTop: "#07050F",
    skyBottom: "#2A1B44",
    farSilhouette: "#1C1230",
    nearSilhouette: "#0E0819",
    groundTop: "#1C1230",
    groundBottom: "#05030A",
    celestialGlow: "#7CFFCB",
    ambient: "smoke",
    ambientColors: ["#4A3270", "#6B4593", "#2E1A47"],
    impactColors: ["#FFFFFF", "#7CFFCB", "#B392E0"],
  },
  bloodmoon: {
    element: "bloodmoon",
    bodyLight: "#F08AA6",
    body: "#A8304F",
    bodyDark: "#3E0A1C",
    accent: "#FFD9A0",
    pupil: "#FFD9A0",
    skyTop: "#12040A",
    skyBottom: "#5E1029",
    farSilhouette: "#3A0A1A",
    nearSilhouette: "#1C050D",
    groundTop: "#30091A",
    groundBottom: "#0A0205",
    celestialGlow: "#FF4D5E",
    ambient: "petals",
    ambientColors: ["#FF4D6D", "#C9184A", "#FF8FA3"],
    impactColors: ["#FFFFFF", "#FFD9A0", "#FF4D6D"],
  },
  celestial: {
    element: "celestial",
    bodyLight: "#F1E4FF",
    body: "#B78BE0",
    bodyDark: "#4E2C80",
    accent: "#FFE58A",
    pupil: "#2A1550",
    skyTop: "#08061F",
    skyBottom: "#3B2A7A",
    farSilhouette: "#2A1F5C",
    nearSilhouette: "#171238",
    groundTop: "#2C2266",
    groundBottom: "#0A0820",
    celestialGlow: "#FFE58A",
    ambient: "stars",
    ambientColors: ["#FFFFFF", "#FFE58A", "#D9C2FF"],
    impactColors: ["#FFFFFF", "#FFE58A", "#D9C2FF"],
  },
  arena: {
    element: "arena",
    bodyLight: "#FFE0A8",
    body: "#C98A4B",
    bodyDark: "#5A3412",
    accent: "#F5C542",
    pupil: "#2A1606",
    skyTop: "#1C120C",
    skyBottom: "#7A4524",
    farSilhouette: "#4A2C18",
    nearSilhouette: "#2E1B0E",
    groundTop: "#8A5E36",
    groundBottom: "#2E1D0F",
    celestialGlow: "#FFC870",
    ambient: "dust",
    ambientColors: ["#FFE0A8", "#F5C542", "#E8B84B"],
    impactColors: ["#FFFFFF", "#FFE9A3", "#F5C542"],
  },
};

/** 第 N 座塔 → 屬性。順序對應 monsters.ts 的 TOWER_THEMES */
const TOWER_ELEMENTS: TowerElement[] = [
  "grass",
  "water",
  "sand",
  "forest",
  "fire",
  "frost",
  "thunder",
  "shadow",
  "bloodmoon",
  "celestial",
];

/** 查某座塔的美術設定；tower 不給（戰隊）就回傳競技場 */
export function getTowerArt(tower?: number | null): TowerArt {
  if (!tower) return ARTS.arena;
  const index = Math.min(TOWER_ELEMENTS.length, Math.max(1, Math.round(tower))) - 1;
  return ARTS[TOWER_ELEMENTS[index]];
}

/**
 * 把兩個 #RRGGBB 顏色依比例混合。t = 0 回傳 a，t = 1 回傳 b。
 * 用在背景的大氣透視（遠景往天空色靠）跟光暈。
 */
export function mixColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const k = Math.min(1, Math.max(0, t));
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * k);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * k);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * k);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** #RRGGBB → rgba(r,g,b,alpha) 字串 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${Math.min(1, Math.max(0, alpha))})`;
}

function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
