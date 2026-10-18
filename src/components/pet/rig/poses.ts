// src/components/pet/rig/poses.ts

/**
 * 小雞骨架的動作表
 * ------------------------------------------------------------
 * 每個動作 = 每個部位一串關鍵影格（Web Animations 的 Keyframe）。
 * 旋轉中心在各職繪圖元件裡用 jointStyle() 設好，這裡只寫角度與位移。
 *
 * 部位的父子關係（畫在誰裡面就跟著誰動）：
 *   root ─┬─ legL / legR
 *         ├─ torso ─ armor（穿在身上的防具）
 *         ├─ head（頭盔、臉在裡面）
 *         ├─ wingL ─（盾牌類防具拿在這隻手）
 *         └─ wingR ─ weapon
 *   fx：跟著 root 的特效層（暈眩星星之類）
 *   mount：坐騎／車子本體（戰車、炮車、馬、象），legL/legR 在有坐騎的職業是車輪或象腳
 *   mountHead：坐騎的頭（馬頭、象頭、炮管）
 *
 * 時間都用 offset（0～1）寫，整段長度是 duration。
 * 動作的節奏照動畫的老規矩：預備（反方向蓄力）→ 出手（很快）→ 收招（慢）。
 */

import type { Expression } from "@/components/pet/rig/jobs/index";

export type RigPart = "root" | "torso" | "torsoFront" | "head" | "wingL" | "wingR" | "legL" | "legR" | "weapon" | "armor" | "fx" | "mount" | "mountFront" | "mountHead";

/** 沒有自己關鍵影格的部位，借用誰的（torsoFront = 畫在頭前面的領巾、盔甲，跟身體一起動） */
export const TRACK_ALIAS: Partial<Record<RigPart, RigPart>> = { torsoFront: "torso", mountFront: "mount" };
export type PoseName = "idle" | "attack" | "skill" | "cast" | "hurt" | "down" | "victory";

export interface PoseDef {
  duration: number;
  easing?: string;
  /** 播完停在最後一格（倒下） */
  hold?: boolean;
  tracks: Partial<Record<RigPart, Keyframe[]>>;
  /** [時間點 0～1, 表情] */
  expressions?: [number, Expression][];
}

const k = (offset: number, transform: string, extra?: Partial<Keyframe>): Keyframe => ({ offset, transform, ...extra });

export const POSES: Record<PoseName, PoseDef> = {
  // ---------------- 待機：呼吸、頭輕輕晃、翅膀拍 ----------------
  idle: {
    duration: 1800,
    tracks: {
      torso: [k(0, "scale(1,1)"), k(0.5, "scale(1.03,0.97)"), k(1, "scale(1,1)")],
      head: [k(0, "translateY(0) rotate(-1.5deg)"), k(0.5, "translateY(2.5px) rotate(1.5deg)"), k(1, "translateY(0) rotate(-1.5deg)")],
      wingL: [k(0, "rotate(0deg)"), k(0.5, "rotate(-7deg)"), k(1, "rotate(0deg)")],
      wingR: [k(0, "rotate(0deg)"), k(0.5, "rotate(9deg)"), k(1, "rotate(0deg)")],
      weapon: [k(0, "rotate(0deg)"), k(0.5, "rotate(-4deg)"), k(1, "rotate(0deg)")],
      mountHead: [k(0, "rotate(0deg)"), k(0.5, "rotate(-3deg)"), k(1, "rotate(0deg)")],
      mount: [k(0, "translateY(0)"), k(0.5, "translateY(0.8px)"), k(1, "translateY(0)")],
    },
  },

  // ---------------- 普通攻擊：往後拉 → 一刀劈下 → 收 ----------------
  attack: {
    duration: 620,
    tracks: {
      root: [
        k(0, "translate(0,0) rotate(0deg)"),
        k(0.28, "translate(-10px,2px) rotate(-6deg)"),
        k(0.4, "translate(18px,0) rotate(8deg)"),
        k(0.62, "translate(12px,0) rotate(4deg)"),
        k(1, "translate(0,0) rotate(0deg)"),
      ],
      torso: [k(0, "scale(1,1)"), k(0.28, "scale(0.94,1.06)"), k(0.4, "scale(1.08,0.93)"), k(1, "scale(1,1)")],
      head: [k(0, "rotate(0deg)"), k(0.28, "rotate(-8deg)"), k(0.4, "rotate(6deg)"), k(1, "rotate(0deg)")],
      wingR: [
        k(0, "rotate(0deg)"),
        k(0.28, "rotate(-125deg)"),
        k(0.4, "rotate(70deg)"),
        k(0.62, "rotate(55deg)"),
        k(1, "rotate(0deg)"),
      ],
      wingL: [k(0, "rotate(0deg)"), k(0.28, "rotate(20deg)"), k(0.4, "rotate(-25deg)"), k(1, "rotate(0deg)")],
      legL: [k(0, "rotate(0deg)"), k(0.4, "rotate(-14deg)"), k(1, "rotate(0deg)")],
      legR: [k(0, "rotate(0deg)"), k(0.4, "rotate(12deg)"), k(1, "rotate(0deg)")],
      mount: [k(0, "translateX(0)"), k(0.28, "translateX(-4px)"), k(0.4, "translateX(6px)"), k(1, "translateX(0)")],
      mountHead: [k(0, "rotate(0deg)"), k(0.28, "rotate(6deg)"), k(0.4, "rotate(-10deg)"), k(1, "rotate(0deg)")],
    },
    expressions: [
      [0.2, "determined"],
      [0.38, "shout"],
    ],
  },

  // ---------------- 放技能：蹲 → 跳起高舉 → 重重插下 → 英雄站姿 ----------------
  skill: {
    duration: 2000,
    tracks: {
      root: [
        k(0, "translate(0,0) rotate(0deg)"),
        k(0.14, "translate(0,8px) rotate(0deg)"),
        k(0.3, "translate(0,-46px) rotate(-5deg)"),
        k(0.38, "translate(0,-50px) rotate(-6deg)"),
        k(0.46, "translate(0,4px) rotate(2deg)"),
        k(0.52, "translate(0,0) rotate(0deg)"),
        k(0.9, "translate(0,0) rotate(0deg)"),
        k(1, "translate(0,0) rotate(0deg)"),
      ],
      torso: [
        k(0, "scale(1,1)"),
        k(0.14, "scale(1.14,0.86)"),
        k(0.3, "scale(0.9,1.12)"),
        k(0.46, "scale(1.18,0.84)"),
        k(0.54, "scale(0.97,1.04)"),
        k(0.62, "scale(1,1)"),
        k(1, "scale(1,1)"),
      ],
      head: [
        k(0, "translate(0,0) rotate(0deg)"),
        k(0.14, "translate(0,8px) rotate(4deg)"),
        k(0.3, "translate(0,-4px) rotate(-8deg)"),
        k(0.46, "translate(0,8px) rotate(3deg)"),
        k(0.56, "translate(0,-2px) rotate(-6deg)"),
        k(0.9, "translate(0,-2px) rotate(-6deg)"),
        k(1, "translate(0,0) rotate(0deg)"),
      ],
      wingR: [
        k(0, "rotate(0deg)"),
        k(0.14, "rotate(30deg)"),
        k(0.3, "rotate(-160deg)"),
        k(0.4, "rotate(-170deg)"),
        k(0.47, "rotate(55deg)"),
        k(0.56, "rotate(40deg)"),
        k(0.9, "rotate(40deg)"),
        k(1, "rotate(0deg)"),
      ],
      wingL: [
        k(0, "rotate(0deg)"),
        k(0.14, "rotate(-20deg)"),
        k(0.3, "rotate(35deg)"),
        k(0.47, "rotate(-30deg)"),
        k(0.56, "rotate(-55deg)"),
        k(0.9, "rotate(-55deg)"),
        k(1, "rotate(0deg)"),
      ],
      legL: [k(0, "rotate(0deg)"), k(0.3, "rotate(18deg)"), k(0.46, "rotate(-10deg)"), k(0.56, "rotate(-6deg)"), k(0.9, "rotate(-6deg)"), k(1, "rotate(0deg)")],
      legR: [k(0, "rotate(0deg)"), k(0.3, "rotate(-14deg)"), k(0.46, "rotate(10deg)"), k(0.56, "rotate(6deg)"), k(0.9, "rotate(6deg)"), k(1, "rotate(0deg)")],
      mountHead: [k(0, "rotate(0deg)"), k(0.14, "rotate(6deg)"), k(0.3, "rotate(-14deg)"), k(0.46, "rotate(8deg)"), k(0.56, "rotate(-8deg)"), k(0.9, "rotate(-8deg)"), k(1, "rotate(0deg)")],
    },
    expressions: [
      [0.1, "determined"],
      [0.44, "shout"],
      [0.62, "determined"],
      [0.92, "happy"],
    ],
  },

  // ---------------- 施法（法杖、回血類）：雙翅張開往上舉、身體浮起 ----------------
  cast: {
    duration: 1400,
    tracks: {
      root: [k(0, "translate(0,0)"), k(0.25, "translate(0,-14px)"), k(0.75, "translate(0,-18px)"), k(1, "translate(0,0)")],
      torso: [k(0, "scale(1,1)"), k(0.25, "scale(0.95,1.06)"), k(0.75, "scale(0.96,1.05)"), k(1, "scale(1,1)")],
      head: [k(0, "rotate(0deg)"), k(0.25, "rotate(-8deg)"), k(0.75, "rotate(-10deg)"), k(1, "rotate(0deg)")],
      wingL: [k(0, "rotate(0deg)"), k(0.25, "rotate(-70deg)"), k(0.5, "rotate(-80deg)"), k(0.75, "rotate(-70deg)"), k(1, "rotate(0deg)")],
      wingR: [k(0, "rotate(0deg)"), k(0.25, "rotate(-110deg)"), k(0.5, "rotate(-120deg)"), k(0.75, "rotate(-110deg)"), k(1, "rotate(0deg)")],
      legL: [k(0, "rotate(0deg)"), k(0.25, "rotate(12deg)"), k(0.75, "rotate(14deg)"), k(1, "rotate(0deg)")],
      legR: [k(0, "rotate(0deg)"), k(0.25, "rotate(-10deg)"), k(0.75, "rotate(-12deg)"), k(1, "rotate(0deg)")],
    },
    expressions: [
      [0.15, "happy"],
      [0.85, "normal"],
    ],
  },

  // ---------------- 受傷：被打得往後仰、翅膀亂揮 ----------------
  hurt: {
    duration: 520,
    tracks: {
      root: [
        k(0, "translate(0,0) rotate(0deg)", { filter: "brightness(1)" }),
        k(0.12, "translate(-16px,-4px) rotate(-12deg)", { filter: "brightness(2.4) saturate(0.4)" }),
        k(0.3, "translate(-12px,0) rotate(-8deg)", { filter: "brightness(1.2)" }),
        k(0.55, "translate(-4px,0) rotate(3deg)", { filter: "brightness(1)" }),
        k(1, "translate(0,0) rotate(0deg)", { filter: "brightness(1)" }),
      ],
      torso: [k(0, "scale(1,1)"), k(0.12, "scale(0.9,1.08)"), k(0.4, "scale(1.04,0.97)"), k(1, "scale(1,1)")],
      head: [k(0, "rotate(0deg)"), k(0.12, "rotate(-18deg)"), k(0.4, "rotate(-6deg)"), k(1, "rotate(0deg)")],
      wingL: [k(0, "rotate(0deg)"), k(0.12, "rotate(-60deg)"), k(0.3, "rotate(-20deg)"), k(0.45, "rotate(-40deg)"), k(1, "rotate(0deg)")],
      wingR: [k(0, "rotate(0deg)"), k(0.12, "rotate(-70deg)"), k(0.3, "rotate(-30deg)"), k(0.45, "rotate(-50deg)"), k(1, "rotate(0deg)")],
      legL: [k(0, "rotate(0deg)"), k(0.12, "rotate(20deg)"), k(1, "rotate(0deg)")],
      legR: [k(0, "rotate(0deg)"), k(0.12, "rotate(-8deg)"), k(1, "rotate(0deg)")],
      mountHead: [k(0, "rotate(0deg)"), k(0.12, "rotate(-14deg)"), k(0.4, "rotate(4deg)"), k(1, "rotate(0deg)")],
    },
    expressions: [[0.02, "hurt"]],
  },

  // ---------------- 倒下：被打 → 搖搖晃晃 → 往後倒 → 彈一下 → 躺平 ----------------
  down: {
    duration: 1700,
    hold: true,
    tracks: {
      root: [
        k(0, "translate(0,0) rotate(0deg)", { filter: "brightness(1)" }),
        k(0.06, "translate(-14px,-4px) rotate(-12deg)", { filter: "brightness(2.4) saturate(0.4)" }),
        k(0.16, "translate(-8px,0) rotate(-4deg)", { filter: "brightness(1)" }),
        k(0.26, "translate(-6px,0) rotate(9deg)"),
        k(0.36, "translate(-10px,0) rotate(-10deg)"),
        k(0.44, "translate(-8px,0) rotate(6deg)"),
        k(0.62, "translate(-34px,4px) rotate(-92deg)"),
        k(0.7, "translate(-32px,-6px) rotate(-80deg)"),
        k(0.78, "translate(-34px,4px) rotate(-90deg)"),
        k(1, "translate(-34px,4px) rotate(-90deg)", { filter: "brightness(1)" }),
      ],
      torso: [k(0, "scale(1,1)"), k(0.06, "scale(0.9,1.08)"), k(0.62, "scale(1,1)"), k(0.66, "scale(1.08,0.92)"), k(0.74, "scale(1,1)"), k(1, "scale(1,1)")],
      head: [
        k(0, "rotate(0deg)"),
        k(0.06, "rotate(-18deg)"),
        k(0.26, "rotate(10deg)"),
        k(0.36, "rotate(-12deg)"),
        k(0.62, "rotate(8deg)"),
        k(0.72, "rotate(-6deg)"),
        k(1, "rotate(4deg)"),
      ],
      wingL: [k(0, "rotate(0deg)"), k(0.06, "rotate(-60deg)"), k(0.3, "rotate(-30deg)"), k(0.62, "rotate(-100deg)"), k(0.72, "rotate(-70deg)"), k(1, "rotate(-85deg)")],
      wingR: [k(0, "rotate(0deg)"), k(0.06, "rotate(-70deg)"), k(0.3, "rotate(-40deg)"), k(0.62, "rotate(-120deg)"), k(0.72, "rotate(-90deg)"), k(1, "rotate(-100deg)")],
      legL: [k(0, "rotate(0deg)"), k(0.44, "rotate(10deg)"), k(0.62, "rotate(40deg)"), k(0.7, "rotate(60deg)"), k(1, "rotate(35deg)")],
      legR: [k(0, "rotate(0deg)"), k(0.44, "rotate(-6deg)"), k(0.62, "rotate(20deg)"), k(0.7, "rotate(45deg)"), k(1, "rotate(25deg)")],
      weapon: [k(0, "translate(0,0) rotate(0deg)"), k(0.5, "translate(0,0) rotate(0deg)"), k(0.62, "translate(30px,-30px) rotate(80deg)"), k(0.78, "translate(40px,10px) rotate(140deg)"), k(1, "translate(40px,10px) rotate(140deg)")],
      fx: [k(0, "scale(0)", { opacity: 0 }), k(0.74, "scale(0)", { opacity: 0 }), k(0.82, "scale(1.2)", { opacity: 1 }), k(0.9, "scale(1)", { opacity: 1 }), k(1, "scale(1)", { opacity: 1 })],
    },
    expressions: [
      [0.02, "hurt"],
      [0.2, "dizzy"],
      [0.62, "ko"],
    ],
  },

  // ---------------- 勝利：跳兩下、武器舉高 ----------------
  victory: {
    duration: 1200,
    tracks: {
      root: [k(0, "translate(0,0)"), k(0.2, "translate(0,-30px)"), k(0.4, "translate(0,0)"), k(0.6, "translate(0,-24px)"), k(0.8, "translate(0,0)"), k(1, "translate(0,0)")],
      torso: [k(0, "scale(1,1)"), k(0.1, "scale(1.1,0.9)"), k(0.2, "scale(0.94,1.06)"), k(0.4, "scale(1.1,0.9)"), k(0.6, "scale(0.95,1.05)"), k(0.8, "scale(1.08,0.92)"), k(1, "scale(1,1)")],
      wingR: [k(0, "rotate(0deg)"), k(0.2, "rotate(-140deg)"), k(0.8, "rotate(-140deg)"), k(1, "rotate(0deg)")],
      wingL: [k(0, "rotate(0deg)"), k(0.2, "rotate(-40deg)"), k(0.4, "rotate(-10deg)"), k(0.6, "rotate(-40deg)"), k(1, "rotate(0deg)")],
      head: [k(0, "rotate(0deg)"), k(0.2, "rotate(-6deg)"), k(0.6, "rotate(6deg)"), k(1, "rotate(0deg)")],
      mountHead: [k(0, "rotate(0deg)"), k(0.2, "rotate(-10deg)"), k(0.4, "rotate(4deg)"), k(0.6, "rotate(-10deg)"), k(1, "rotate(0deg)")],
    },
    expressions: [[0.05, "happy"]],
  },
};
