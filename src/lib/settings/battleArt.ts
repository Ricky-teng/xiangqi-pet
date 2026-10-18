// src/lib/settings/battleArt.ts

/**
 * 戰鬥畫面的小雞要用哪一種圖（存在這台裝置）
 * ------------------------------------------------------------
 *   svg   ：程式畫的骨架小雞（預設）。會換姿勢、看得到手上的武器跟身上的防具。
 *   image ：原本的職業圖。比較精細，但整張圖只能整隻移動，不會換姿勢。
 * 兩種模式的技能特效都一樣會播。
 *
 * 設定頁跟戰鬥畫面都可以切，用一個小事件讓同一頁裡的其他元件也跟著更新。
 */

import { useEffect, useState } from "react";

export type BattleArtMode = "svg" | "image";

const KEY = "xq-battle-art";
const EVENT = "xq-battle-art-change";

export function getBattleArtMode(): BattleArtMode {
  try {
    return window.localStorage.getItem(KEY) === "image" ? "image" : "svg";
  } catch {
    return "svg";
  }
}

export function setBattleArtMode(mode: BattleArtMode): void {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // 存不了就只在這次開著的期間有效
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

/** 讀目前的模式，別的地方切換時跟著變 */
export function useBattleArtMode(): [BattleArtMode, (m: BattleArtMode) => void] {
  // 伺服器端渲染時讀不到 localStorage，先用預設值，掛上去之後再讀
  const [mode, setMode] = useState<BattleArtMode>("svg");
  useEffect(() => {
    setMode(getBattleArtMode());
    const onChange = (e: Event) => setMode((e as CustomEvent<BattleArtMode>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return [mode, setBattleArtMode];
}
