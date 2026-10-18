// src/components/rpg/PetArt.tsx
"use client";

/**
 * 小雞的圖（職業圖，載入失敗就退回 emoji）
 * ------------------------------------------------------------
 * 戰鬥舞台、探險準備頁、戰隊編隊、我的小雞都用這一支，
 * 圖片失敗時的退路只需要寫一次。
 */

import { useState } from "react";
import { getCatalogEntryById } from "@/lib/pet/catalog";

interface PetArtProps {
  jobId?: string | null;
  /** 沒有職業圖時的後備 emoji */
  emoji?: string;
  size: number;
  /** 水平翻轉（面向左） */
  flip?: boolean;
  /** 加一層腳下的陰影感（舞台上用） */
  dropShadow?: boolean;
  className?: string;
}

export default function PetArt({ jobId, emoji, size, flip = false, dropShadow = true, className }: PetArtProps) {
  const [failed, setFailed] = useState(false);
  const entry = jobId ? getCatalogEntryById(jobId) : null;
  if (entry && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={entry.imagePath}
        alt=""
        draggable={false}
        onError={() => setFailed(true)}
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          objectPosition: "50% 100%",
          transform: flip ? "scaleX(-1)" : undefined,
          filter: dropShadow ? "drop-shadow(0 2px 0 rgba(0,0,0,0.35))" : undefined,
          display: "block",
        }}
      />
    );
  }
  return (
    <span
      className={["flex items-end justify-center", className ?? ""].join(" ")}
      style={{ width: size, height: size, fontSize: size * 0.72, lineHeight: 1, transform: flip ? "scaleX(-1)" : undefined }}
    >
      {emoji ?? entry?.fallbackEmoji ?? "🐔"}
    </span>
  );
}
