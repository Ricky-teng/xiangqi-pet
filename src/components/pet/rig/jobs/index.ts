// src/components/pet/rig/jobs/index.ts

/**
 * 8 職小雞的繪圖元件對照表（骨架動畫用）
 * 每一職都畫成同一套部位（見 rig/poses.ts 的 RigPart），動作表就能共用。
 */

import type { ComponentType } from "react";
import type { EquipmentItem } from "@/lib/rpg/equipment";
import type { RigPart } from "@/components/pet/rig/poses";
import PawnChick from "@/components/pet/rig/jobs/pawn";
import CannonChick from "@/components/pet/rig/jobs/cannon";
import HorseChick from "@/components/pet/rig/jobs/horse";
import ChariotChick from "@/components/pet/rig/jobs/chariot";
import ElephantChick from "@/components/pet/rig/jobs/elephant";
import AdvisorChick from "@/components/pet/rig/jobs/advisor";
import GeneralChick from "@/components/pet/rig/jobs/general";
import PhoenixChick from "@/components/pet/rig/jobs/phoenix";

export type Expression = "normal" | "blink" | "happy" | "determined" | "shout" | "hurt" | "dizzy" | "ko";

export type RigJobId = "pawn" | "cannon" | "horse" | "chariot" | "elephant" | "advisor" | "general" | "phoenix";

export interface RigJobProps {
  uid: string;
  weapon: EquipmentItem | null;
  armor: EquipmentItem | null;
  expression: Expression;
  partRef: (part: RigPart) => (el: SVGGElement | null) => void;
}

/** 職業 id → 骨架小雞；沒轉職（null）或對不上的就用小兵 */
export function getRigJob(jobId: string | null | undefined): RigJobId {
  return jobId && jobId in RIG_JOBS ? (jobId as RigJobId) : "pawn";
}

export const RIG_JOBS: Record<RigJobId, ComponentType<RigJobProps>> = {
  pawn: PawnChick,
  cannon: CannonChick,
  horse: HorseChick,
  chariot: ChariotChick,
  elephant: ElephantChick,
  advisor: AdvisorChick,
  general: GeneralChick,
  phoenix: PhoenixChick,
};
