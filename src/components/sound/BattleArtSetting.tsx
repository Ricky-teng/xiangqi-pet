// src/components/sound/BattleArtSetting.tsx
"use client";

/**
 * 設定頁：戰鬥畫面的小雞要用「動畫版」（程式畫的、會換姿勢、看得到裝備）
 * 還是「原圖版」（原本的職業圖，比較精細但不會換姿勢）。技能特效兩種都有。
 */

import { useBattleArtMode, type BattleArtMode } from "@/lib/settings/battleArt";

const OPTIONS: { mode: BattleArtMode; title: string; desc: string }[] = [
  { mode: "svg", title: "動畫版", desc: "會出招、受傷、倒下，看得到手上的武器跟身上的防具" },
  { mode: "image", title: "原圖版", desc: "用原本的職業圖，比較精細，但不會換姿勢" },
];

export default function BattleArtSetting() {
  const [mode, setMode] = useBattleArtMode();
  return (
    <div className="mt-3 w-full rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
      <p className="text-sm font-bold text-[#1A1A2E]">⚔️ 戰鬥畫面的小雞</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            onClick={() => setMode(o.mode)}
            aria-pressed={mode === o.mode}
            className={[
              "rounded-xl px-3 py-2 text-left transition-transform active:scale-95",
              mode === o.mode ? "bg-[#8B5FBF] text-white shadow" : "bg-[#1A1A2E]/5 text-[#1A1A2E]",
            ].join(" ")}
          >
            <span className="block text-[13px] font-black">{o.title}</span>
            <span className={["mt-0.5 block text-[10.5px] leading-snug", mode === o.mode ? "text-white/80" : "text-[#1A1A2E]/55"].join(" ")}>{o.desc}</span>
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-[#1A1A2E]/50">只影響這台裝置。戰鬥畫面右下角也可以切換。</p>
    </div>
  );
}
