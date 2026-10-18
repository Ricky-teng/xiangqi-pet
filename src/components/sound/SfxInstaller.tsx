// src/components/sound/SfxInstaller.tsx
"use client";

/**
 * 掛在 layout 上：讓全站的按鈕都有點擊音效（見 lib/sound/sfx.ts）。
 * 不畫任何東西。
 */

import { useEffect } from "react";
import { installButtonSfx } from "@/lib/sound/sfx";

export default function SfxInstaller() {
  useEffect(() => installButtonSfx(), []);
  return null;
}
