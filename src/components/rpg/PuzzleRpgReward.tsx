// src/components/rpg/PuzzleRpgReward.tsx
"use client";

/**
 * 解題完成畫面的「RPG 收穫」小卡（見 lib/rpg/chessLink.ts）：
 *   - 今天解了幾題 → 探險加成 +幾%、多了幾次探險、再解幾題多 1 次
 *   - 這題掉了寶石
 *   - 解開了哪座塔的封印殘局（送 2 顆寶石）
 * 解題頁是亮色主題，這張卡跟著用亮色。
 */

import { useEffect } from "react";
import {
  PUZZLE_BONUS_MAX,
  getExtraExploreAttempts,
  getPuzzleStatBonus,
  getPuzzlesUntilNextAttempt,
} from "@/lib/rpg/chessLink";
import { GEM_TABLE, type GemId } from "@/lib/rpg/gems";
import GemIcon from "@/components/rpg/GemIcon";
import { playSfx } from "@/lib/sound/sfx";

export default function PuzzleRpgReward({
  gem,
  sealTowers,
  sealGems,
  solvedToday,
}: {
  gem: GemId | null;
  sealTowers: number[];
  sealGems: GemId[];
  solvedToday: number;
}) {
  const bonus = getPuzzleStatBonus(solvedToday);
  const extra = getExtraExploreAttempts(solvedToday);
  const untilNext = getPuzzlesUntilNextAttempt(solvedToday);

  // 有寶石或封印就叮一聲（只在出現時播一次）
  useEffect(() => {
    if (sealTowers.length > 0) playSfx("rare");
    else if (gem) playSfx("gem");
  }, [gem, sealTowers.length]);

  return (
    <div className="rounded-2xl bg-[#2A2050]/[0.06] px-4 py-3 ring-1 ring-[#6A4FC0]/25">
      <p className="text-[12px] font-black text-[#3E2A8A]">⚔️ 探險收穫（今天解對 {solvedToday} 題）</p>
      <p className="mt-1 text-[12px] font-bold leading-relaxed text-[#1A1A2E]/75">
        探險四項 +{Math.round(bonus * 100)}%{bonus >= PUZZLE_BONUS_MAX ? "（已達上限）" : ""}・額外探險 +{extra} 次
        {untilNext !== null ? `（再解 ${untilNext} 題多 1 次）` : "（已達上限）"}
      </p>
      {gem ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] font-black text-[#3E2A8A]">
          <span className="gem-pop">
            <GemIcon gem={gem} size={26} />
          </span>
          掉了一顆{GEM_TABLE[gem].name}！
        </p>
      ) : null}
      {sealTowers.length > 0 ? (
        <div className="mt-2 rounded-xl bg-[#F5C542]/20 px-3 py-2 ring-1 ring-[#E8B84B]/60">
          <p className="text-[12.5px] font-black text-[#5C3D0A]">🔓 解開了第 {sealTowers.join("、")} 塔的封印殘局！</p>
          <div className="mt-1 flex items-center gap-1.5">
            {sealGems.map((g, i) => (
              <span key={i} className="gem-pop" style={{ animationDelay: `${i * 0.15}s` }}>
                <GemIcon gem={g} size={26} />
              </span>
            ))}
            <span className="text-[11.5px] font-bold text-[#5C3D0A]/80">獲得 {sealGems.length} 顆寶石</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
