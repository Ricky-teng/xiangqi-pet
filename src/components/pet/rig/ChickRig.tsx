// src/components/pet/rig/ChickRig.tsx
"use client";

/**
 * 可動的小雞（骨架動畫）
 * ------------------------------------------------------------
 * 每一職的小雞都畫成「分件」的 SVG：身體、頭、左右翅膀、左右腳、
 * 手上的武器、身上的防具、臉（眼睛、嘴巴會換表情）。每一件包在自己的
 * <g> 裡，旋轉中心（關節）固定，動畫用 Web Animations API 直接驅動
 * 每一件的 transform——跟遊戲裡的骨架動畫是同一個概念。
 *
 * 這支只負責「骨架＋動作」，長相由各職的繪圖元件提供（見 rig/jobs/*）。
 * 動作表在 rig/poses.ts，每個動作是一組「每個部位的關鍵影格」。
 *
 * 用法：
 *   const ref = useRef<ChickRigHandle>(null);
 *   <ChickRig ref={ref} job="pawn" weapon={...} armor={...} size={160} />
 *   ref.current?.play("attack");
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useId, useRef, useState } from "react";
import type { EquipmentItem } from "@/lib/rpg/equipment";
import { POSES, TRACK_ALIAS, type PoseDef, type PoseName, type RigPart } from "@/components/pet/rig/poses";
import { RIG_JOBS, type Expression, type RigJobId } from "@/components/pet/rig/jobs/index";

export interface ChickRigHandle {
  /** 播一個動作，回傳播完的 Promise（idle 會一直循環，不會 resolve） */
  play: (pose: PoseName, opts?: { speed?: number }) => Promise<void>;
  /** 直接換表情 */
  setExpression: (e: Expression) => void;
  /** 停掉所有動作，回到站姿 */
  reset: () => void;
  /** 單獨動某一個部位（例如炮管抬高、象頭揚起），不影響其他部位 */
  animatePart: (part: RigPart, frames: Keyframe[], durationMs: number) => void;
}

interface ChickRigProps {
  job: RigJobId;
  weapon?: EquipmentItem | null;
  armor?: EquipmentItem | null;
  size: number;
  /** 面向左（戰鬥畫面右邊的敵方小雞） */
  flip?: boolean;
  /** 沒有在播別的動作時自動待機（呼吸、眨眼） */
  autoIdle?: boolean;
  className?: string;
  /** 跟小雞同一個座標系的特效層（技能特效），畫在小雞前面 */
  children?: React.ReactNode;
  /** 畫在小雞後面的特效層 */
  behind?: React.ReactNode;
  /** 手繪質感（線條微抖＋紙張顆粒）；低階手機關掉省效能 */
  texture?: boolean;
}

/** viewBox 比圖本身大一圈，讓舉起的武器、倒下的身體不會被切掉 */
export const RIG_VIEWBOX = { x: -60, y: -40, w: 320, h: 300 };
/** 小雞本體大約佔 viewBox 的這個範圍（給外面算腳的位置用） */
export const RIG_BODY = { cx: 100, feetY: 226, height: 200 };

const PARTS: RigPart[] = ["root", "torso", "torsoFront", "head", "wingL", "wingR", "legL", "legR", "weapon", "armor", "fx", "mount", "mountFront", "mountHead"];

function framesFor(pose: PoseDef, part: RigPart): Keyframe[] | undefined {
  const alias = TRACK_ALIAS[part];
  return pose.tracks[part] ?? (alias ? pose.tracks[alias] : undefined);
}

const ChickRig = forwardRef<ChickRigHandle, ChickRigProps>(function ChickRig(
  { job, weapon = null, armor = null, size, flip = false, autoIdle = true, className, children, behind, texture = true },
  ref,
) {
  const raw = useId();
  const uid = `rig${raw.replace(/[^a-zA-Z0-9]/g, "")}`;
  const els = useRef<Partial<Record<RigPart, SVGGElement | null>>>({});
  const running = useRef<Animation[]>([]);
  const idleRunning = useRef<Animation[]>([]);
  const [expression, setExpression] = useState<Expression>("normal");
  const busy = useRef(false);
  const blinkTimer = useRef<number | null>(null);

  const stopAll = useCallback((list: React.MutableRefObject<Animation[]>) => {
    for (const a of list.current) a.cancel();
    list.current = [];
  }, []);

  const startIdle = useCallback(() => {
    stopAll(idleRunning);
    const idle = POSES.idle;
    for (const part of PARTS) {
      const frames = framesFor(idle, part);
      const el = els.current[part];
      if (!frames || !el) continue;
      idleRunning.current.push(el.animate(frames, { duration: idle.duration, iterations: Infinity, easing: "ease-in-out" }));
    }
  }, [stopAll]);

  const play = useCallback(
    (name: PoseName, opts?: { speed?: number }): Promise<void> => {
      const pose = POSES[name];
      const speed = opts?.speed ?? 1;
      if (name === "idle") {
        busy.current = false;
        stopAll(running);
        startIdle();
        return new Promise(() => undefined);
      }
      busy.current = true;
      stopAll(running);
      stopAll(idleRunning);
      const list: Animation[] = [];
      for (const part of PARTS) {
        const frames = framesFor(pose, part);
        const el = els.current[part];
        if (!frames || !el) continue;
        list.push(el.animate(frames, { duration: pose.duration / speed, easing: pose.easing ?? "linear", fill: pose.hold ? "forwards" : "none" }));
      }
      running.current = list;
      // 表情跟著動作的時間軸換
      const timers: number[] = [];
      for (const [at, e] of pose.expressions ?? []) {
        timers.push(window.setTimeout(() => setExpression(e), (at * pose.duration) / speed));
      }
      return new Promise((resolve) => {
        window.setTimeout(() => {
          timers.forEach((t) => window.clearTimeout(t));
          if (!pose.hold) {
            setExpression("normal");
            busy.current = false;
            if (autoIdle) startIdle();
          }
          resolve();
        }, pose.duration / speed);
      });
    },
    [autoIdle, startIdle, stopAll],
  );

  useImperativeHandle(
    ref,
    () => ({
      play,
      setExpression,
      reset: () => {
        stopAll(running);
        setExpression("normal");
        busy.current = false;
        if (autoIdle) startIdle();
      },
      animatePart: (part, frames, durationMs) => {
        const el = els.current[part];
        if (!el) return;
        el.animate(frames, { duration: durationMs, easing: "ease-in-out", composite: "add" });
      },
    }),
    [autoIdle, play, startIdle, stopAll],
  );

  // 待機：呼吸＋每 2～5 秒眨一次眼
  useEffect(() => {
    if (autoIdle) startIdle();
    const loop = () => {
      blinkTimer.current = window.setTimeout(() => {
        if (!busy.current) {
          setExpression((e) => (e === "normal" ? "blink" : e));
          window.setTimeout(() => setExpression((e) => (e === "blink" ? "normal" : e)), 130);
        }
        loop();
      }, 2000 + Math.random() * 3000);
    };
    loop();
    return () => {
      if (blinkTimer.current) window.clearTimeout(blinkTimer.current);
      stopAll(idleRunning);
      stopAll(running);
    };
  }, [autoIdle, startIdle, stopAll]);

  const Job = RIG_JOBS[job];
  const setRef = (part: RigPart) => (el: SVGGElement | null) => {
    els.current[part] = el;
  };

  const vb = RIG_VIEWBOX;
  const height = (size * vb.h) / RIG_BODY.height;
  const width = (height * vb.w) / vb.h;

  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={width}
      height={height}
      className={className}
      style={{ display: "block", overflow: "visible", transform: flip ? "scaleX(-1)" : undefined }}
      aria-hidden="true"
    >
      {behind}
      <g filter={texture ? `url(#${uid}-ink)` : undefined}>
        <Job uid={uid} weapon={weapon} armor={armor} expression={expression} partRef={setRef} />
      </g>
      {children}
    </svg>
  );
});

export default ChickRig;

/** 部位共用的樣式：關節位置（transform-origin）用 viewBox 座標 */
export function jointStyle(x: number, y: number): React.CSSProperties {
  return { transformOrigin: `${x}px ${y}px`, transformBox: "view-box" };
}
