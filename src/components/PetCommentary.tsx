/**
 * src/components/PetCommentary.tsx
 *
 * 小雞在解題/對戰/對弈頁面旁邊的即時講話元件
 * ------------------------------------------------------------
 * 使用方式：
 *   <PetCommentary trigger={trigger} lines={lines} />
 *
 * trigger 每次換新值（或從 null 變成任意值）就會觸發顯示一句話，
 * 從 lines 陣列隨機挑一句，顯示 3 秒後自動消失。
 * lines 是空陣列時元件靜默不動作（佔位不佔空間）。
 */

"use client";

import { useEffect, useState } from "react";
import { getPetImagePath } from "@/lib/pet/petImagePath";

export type PetCommentaryTrigger =
  | { kind: "correct" }       // 解題答對
  | { kind: "wrong" }         // 解題答錯
  | { kind: "score"; cp: number } // 對弈局面分數（正=紅優，負=黑優）
  | { kind: "battle" }        // 殘局對戰進場
  | null;

export interface PetCommentaryLines {
  correct: string[];     // 解題答對時說的話
  wrong: string[];       // 解題答錯時說的話
  advantage: string[];   // 對弈分析：我方優勢時說的話
  disadvantage: string[]; // 對弈分析：我方劣勢時說的話
  balanced: string[];    // 對弈分析：局面平衡時說的話
  battle: string[];      // 殘局對戰進場時說的話
}

/** 空台詞組，等老師填入內容 */
export const EMPTY_COMMENTARY_LINES: PetCommentaryLines = {
  correct: [],
  wrong: [],
  advantage: [],
  disadvantage: [],
  balanced: [],
  battle: [],
};

function pickRandom(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

function resolveLine(trigger: PetCommentaryTrigger, lines: PetCommentaryLines): string | null {
  if (!trigger) return null;
  switch (trigger.kind) {
    case "correct":     return pickRandom(lines.correct);
    case "wrong":       return pickRandom(lines.wrong);
    case "battle":      return pickRandom(lines.battle);
    case "score": {
      const cp = trigger.cp;
      if (cp > 150)  return pickRandom(lines.advantage);
      if (cp < -150) return pickRandom(lines.disadvantage);
      return pickRandom(lines.balanced);
    }
  }
}

interface PetCommentaryProps {
  stage: string;
  healthStatus: string;
  trigger: PetCommentaryTrigger;
  lines: PetCommentaryLines;
}

export function PetCommentary({ stage, healthStatus, trigger, lines }: PetCommentaryProps) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!trigger) return;
    const line = resolveLine(trigger, lines);
    if (!line) return;

    setText(line);
    const timer = setTimeout(() => setText(null), 3500);
    return () => clearTimeout(timer);
  // trigger 換新物件參照就重新觸發，所以用 JSON.stringify 比較內容
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(trigger)]);

  return (
    <div className="flex items-end gap-2 rounded-2xl bg-white/60 px-3 py-2 shadow-sm">
      {/* 小雞縮圖 */}
      <img
        src={getPetImagePath(stage, healthStatus)}
        alt="小雞"
        className="h-12 w-12 shrink-0 object-contain"
      />
      {/* 對話框 */}
      <div className="relative min-h-[2.5rem] flex-1">
        {text ? (
          <div className="rounded-2xl rounded-bl-none bg-[#1A1A2E] px-3 py-2 text-xs font-semibold text-white shadow-md">
            {text}
          </div>
        ) : (
          <div className="rounded-2xl rounded-bl-none bg-[#1A1A2E]/10 px-3 py-2 text-xs text-[#1A1A2E]/30">
            …
          </div>
        )}
      </div>
    </div>
  );
}
