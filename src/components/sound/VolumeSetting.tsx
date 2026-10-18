// src/components/sound/VolumeSetting.tsx
"use client";

/**
 * 設定頁的音效音量滑桿（存在這台裝置，預設 70%，拉到 0 就是靜音）。
 * 放開滑桿時播一聲，讓學生聽得到現在多大聲。
 */

import { useEffect, useState } from "react";
import { DEFAULT_VOLUME, getSfxVolume, playSfx, setSfxVolume } from "@/lib/sound/sfx";

export default function VolumeSetting() {
  // 伺服器端渲染時讀不到 localStorage，先顯示預設值，掛上去之後再讀真正的設定
  // （直接在 useState 初始值讀會造成 hydration 不一致）
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  useEffect(() => {
    setVolume(getSfxVolume());
  }, []);
  const pct = Math.round(volume * 100);

  return (
    <div className="mt-3 w-full rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[#1A1A2E]">{pct === 0 ? "🔇" : pct < 40 ? "🔈" : "🔊"} 音效音量</span>
        <span className="text-xs font-bold text-[#8B5FBF]">{pct === 0 ? "靜音" : `${pct}%`}</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => {
          const v = Number(e.target.value) / 100;
          setVolume(v);
          setSfxVolume(v);
        }}
        onPointerUp={() => playSfx("coin")}
        onKeyUp={() => playSfx("coin")}
        className="mt-2 w-full accent-[#8B5FBF]"
        aria-label="音效音量"
      />
      <p className="mt-1 text-[11px] text-[#1A1A2E]/50">只影響這台裝置。上課時可以拉到 0 靜音。</p>
    </div>
  );
}
