// src/components/rpg/SkillPanel.tsx
"use client";

/**
 * 「我的小雞」詳細頁的技能區
 * ------------------------------------------------------------
 *   - 正在養的那隻：沒有技能，提示「收藏之後才會學到」
 *   - 收藏小雞：圖示＋名字＋說明＋冷卻，職業搭配的多一個金色標籤
 *   - 刷新：按一下先問「確定花 200 飼料？」，再按一次才真的扣
 *     （避免小朋友手滑連點把飼料花光）
 */

import { useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import {
  SKILL_REROLL_COST,
  getSkill,
  getSkillCooldown,
  getSkillDescription,
  isSkillBoosted,
  isSkillId,
  type SkillId,
} from "@/lib/rpg/skills";
import SkillIcon from "@/components/rpg/SkillIcon";
import { playSfx } from "@/lib/sound/sfx";

export function SkillSummary({ skillId, jobId, compact = false }: { skillId: SkillId; jobId: string | null; compact?: boolean }) {
  const def = getSkill(skillId);
  const boosted = isSkillBoosted(skillId, jobId);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <SkillIcon skillId={skillId} size={compact ? 38 : 52} boosted={boosted} className="shrink-0" />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className={["font-black text-white", compact ? "text-[12.5px]" : "text-[15px]"].join(" ")}>{def.name}</span>
          {boosted ? (
            <span className="rounded-md bg-[#F5C542]/20 px-1.5 py-0.5 text-[10px] font-black leading-none text-[#FFE58A] ring-1 ring-[#F5C542]/45">職業搭配 效果+30%</span>
          ) : def.job ? null : (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-black leading-none text-white/55">共用</span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] font-bold leading-snug text-white/70">{getSkillDescription(skillId, boosted)}</p>
        <p className="mt-0.5 text-[10.5px] font-bold text-white/45">冷卻 {getSkillCooldown(skillId, boosted)} 秒</p>
      </div>
    </div>
  );
}

export default function SkillPanel({ petId, jobId, skillId, isLiving }: { petId: string; jobId: string | null; skillId: string | null | undefined; isLiving: boolean }) {
  const food = useGameStore((s) => s.user?.foodCount ?? 0);
  const rerollPetSkill = useGameStore((s) => s.rerollPetSkill);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [popKey, setPopKey] = useState(0);

  if (isLiving) {
    return (
      <div className="mt-3 rounded-2xl bg-white/[0.05] p-3 ring-1 ring-white/10">
        <p className="text-[10px] font-bold text-white/45">技能</p>
        <p className="mt-1 text-[12px] font-black text-white/60">收藏之後才會學到技能（隨機一個，可以花飼料刷新）</p>
      </div>
    );
  }

  const valid = isSkillId(skillId) ? skillId : null;

  function handleReroll() {
    if (!confirming) {
      setConfirming(true);
      setMessage(null);
      return;
    }
    setConfirming(false);
    const r = rerollPetSkill(petId);
    setMessage(r.message);
    if (r.success) {
      setPopKey((k) => k + 1);
      playSfx("reveal");
    } else {
      playSfx("error");
    }
  }

  return (
    <div className="mt-3 rounded-2xl p-3 ring-1 ring-[#9F7BFF]/35" style={{ background: "linear-gradient(180deg, rgba(122,95,192,0.22), rgba(255,255,255,0.04))" }}>
      <p className="text-[10px] font-bold text-white/45">技能</p>
      <div key={popKey} className={["mt-1.5", popKey > 0 ? "gem-pop" : ""].join(" ")}>
        {valid ? <SkillSummary skillId={valid} jobId={jobId} /> : <p className="text-[12px] font-black text-white/60">技能整理中，等一下再打開看看</p>}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={handleReroll}
          disabled={food < SKILL_REROLL_COST && !confirming}
          className="flex-1 rounded-xl px-3 py-2 text-[12px] font-black text-white transition-transform active:scale-95 disabled:opacity-40"
          style={{ background: confirming ? "linear-gradient(180deg,#FF8A4D,#C2410C)" : "linear-gradient(180deg,#6A4FC0,#3E2A8A)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3)" }}
        >
          {confirming ? `確定花 ${SKILL_REROLL_COST} 飼料重抽？` : `刷新技能（${SKILL_REROLL_COST} 飼料）`}
        </button>
        {confirming ? (
          <button type="button" onClick={() => setConfirming(false)} className="rounded-xl bg-white/10 px-3 py-2 text-[12px] font-black text-white/80">
            取消
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-[10.5px] font-bold leading-snug text-white/45">
        {jobId ? "有 20% 機率抽到自己職業的專屬技能（效果 +30%、冷卻 −20%）。不會抽到跟現在一樣的。" : "還沒轉職的小雞只會抽到共用技能。不會抽到跟現在一樣的。"}
      </p>
      {message ? <p className="mt-1.5 rounded-xl bg-white/[0.06] px-3 py-1.5 text-center text-[11.5px] font-black text-[#FFE58A]">{message}</p> : null}
    </div>
  );
}
