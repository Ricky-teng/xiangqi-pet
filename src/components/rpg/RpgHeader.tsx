// src/components/rpg/RpgHeader.tsx
"use client";

/**
 * RPG 區（探險、戰隊、我的小雞、物品）共用的頁首
 * ------------------------------------------------------------
 * 深色玻璃底＋金色標題字，跟戰鬥畫面同一套語言：學生一看就知道
 * 「這裡是遊戲區」，跟養成、解題那些米白色頁面區隔開。
 *
 * 一般使用者背景是亮色圖，深色頁首疊上去對比夠、也不會跟背景圖搶。
 */

interface RpgHeaderProps {
  title: string;
  backLabel?: string;
  onBack: () => void;
  /** 右邊的東西（規則按鈕、次數徽章……） */
  right?: React.ReactNode;
  /** 標題字的漸層主色，預設金色；塔內頁傳塔的主色 */
  accent?: string;
}

export default function RpgHeader({ title, backLabel = "返回", onBack, right, accent }: RpgHeaderProps) {
  const fill = accent
    ? `linear-gradient(180deg,#FFFFFF 10%,${accent} 100%)`
    : "linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)";
  return (
    <header className="rpg-glass flex items-center gap-2 rounded-2xl px-2.5 py-2">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-white/10 px-3 text-xs font-black text-white/90 ring-1 ring-white/15 transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        {backLabel}
      </button>
      <h1 className="min-w-0 flex-1 truncate text-center">
        <span
          className="fx-text text-[19px] font-black"
          data-text={title}
          style={
            {
              ["--fx-fill" as string]: fill,
              ["--fx-stroke" as string]: "5px",
              ["--fx-stroke-color" as string]: "#1A1206",
            } as React.CSSProperties
          }
        >
          {title}
        </span>
      </h1>
      <div className="flex shrink-0 items-center gap-1.5">{right}</div>
    </header>
  );
}

/** 每日次數徽章（閃電＋剩餘/上限） */
export function AttemptsBadge({ left, max, label = "今日剩餘次數" }: { left: number; max: number; label?: string }) {
  const empty = left <= 0;
  return (
    <span
      className="flex h-9 items-center gap-1 rounded-xl px-2.5 ring-1"
      style={{
        background: empty ? "rgba(255,77,94,0.18)" : "rgba(245,197,66,0.16)",
        color: empty ? "#FF9AA6" : "#FFE58A",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1)",
        borderColor: "transparent",
      }}
      aria-label={`${label} ${left} / ${max}`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />
      </svg>
      <span className="font-display text-[14px] leading-none">
        {left}
        <span className="text-[11px] opacity-60">/{max}</span>
      </span>
    </span>
  );
}
