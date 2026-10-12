// src/components/battle/BattleResultCard.tsx
"use client";

/**
 * 戰鬥結算卡片（探險與戰隊共用）
 * ------------------------------------------------------------
 * 卡片式彈窗，不轉頁——小關打完一直跳全螢幕會打斷節奏。
 *
 * 演出順序（勝利）：
 *   0.0s  背後金色光芒展開、彩帶開始落
 *   0.1s  卡片從下方彈上來
 *   0.15s VICTORY 從大縮小砸下來，關卡名稱緞帶展開
 *   0.6s  時間、擊敗數從 0 跳到實際數字
 *   0.9s  掉寶卡片一張一張「背面朝上」落下，每張停半拍再翻面，
 *         翻面瞬間往上衝一道階級色光柱——就是抽卡的那一下
 *
 * 打輸的時候刻意給「具體」的提示而不是「再接再厲」——探險的勝率
 * 幾乎沒有中間值（回血 30% 讓結果變成確定的），所以學生打輸就是
 * 真的裝備不夠，直接告訴他差在哪比較有用。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getEquipmentBonusLabel,
  getEquipmentName,
  type EquipmentItem,
} from "@/lib/rpg/equipment";
import EquipmentIcon, { ItemFrame, getTierMaterial } from "@/components/rpg/EquipmentIcon";

export interface BattleResultCardProps {
  won: boolean;
  /** 是不是中途投降的（文案要不一樣，不然像在嘲諷） */
  surrendered?: boolean;
  /** 標題，例如「第 3 塔・第 7 關」或對手隊名 */
  title: string;
  /** 打了多久（秒），顯示成「12.4 秒」 */
  durationSeconds: number;
  /** 打倒幾隻 / 總共幾隻 */
  defeated: number;
  totalEnemies: number;
  /** 首通掉落（沒有就傳空陣列） */
  drops?: EquipmentItem[];
  /** 額外要顯示的幾行（例如「積分 +25」「解鎖第 4 塔」） */
  extraLines?: string[];
  /**
   * 打輸時的具體建議。呼叫端算好傳進來，例如
   * 「你的攻擊 203，Boss 防禦 396，傷害被擋掉一半以上」。
   */
  loseHint?: string | null;
  /** 主要按鈕（再打一次 / 下一關） */
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** 第一張掉寶卡落下的時間（ms） */
const DROP_START_MS = 900;
/** 每張卡之間的間隔 */
const DROP_GAP_MS = 520;
/** 卡片落下後多久翻面 */
const FLIP_DELAY_MS = 380;

const CONFETTI_COLORS = ["#F5C542", "#FFFFFF", "#FF4D6D", "#4FC3FF", "#7FE07A", "#C9A0FF"];

/** 數字從 0 跳到目標值 */
function useCountUp(target: number, durationMs: number, delayMs: number, decimals = 0): string {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const timer = window.setTimeout(() => {
      const step = (ts: number) => {
        if (start === null) start = ts;
        const k = Math.min(1, (ts - start) / durationMs);
        // ease-out：前面跳得快、最後慢慢停
        setValue(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs, delayMs]);
  return value.toFixed(decimals);
}

export default function BattleResultCard({
  won,
  surrendered = false,
  title,
  durationSeconds,
  defeated,
  totalEnemies,
  drops = [],
  extraLines = [],
  loseHint,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: BattleResultCardProps) {
  const victory = won && !surrendered;
  /** 已經落下幾張、已經翻開幾張 */
  const [landed, setLanded] = useState(0);
  const [flipped, setFlipped] = useState(0);
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (drops.length === 0) return;
    const timers: number[] = [];
    drops.forEach((_, index) => {
      const t = DROP_START_MS + index * DROP_GAP_MS;
      timers.push(window.setTimeout(() => setLanded(index + 1), t));
      timers.push(window.setTimeout(() => setFlipped(index + 1), t + FLIP_DELAY_MS));
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [drops]);

  // 打開時把焦點放在主要按鈕，鍵盤使用者按 Enter 就能繼續
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true });
  }, []);

  const timeText = useCountUp(durationSeconds, 650, 600, 1);
  const defeatedText = useCountUp(defeated, 650, 600, 0);

  // 彩帶：位置、顏色、延遲都先算好，重繪時不會亂跳
  const confetti = useMemo(
    () =>
      Array.from({ length: 38 }, (_, i) => ({
        left: Math.random() * 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.9,
        dur: 2.2 + Math.random() * 1.6,
        dx: (Math.random() - 0.5) * 160,
        rot: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
        w: 5 + Math.random() * 4,
      })),
    [],
  );

  const titleText = surrendered ? "撤退" : won ? "VICTORY" : "DEFEAT";
  const titleFill = victory
    ? "linear-gradient(180deg,#FFFFFF 8%,#FFE58A 45%,#F5A623 78%,#C26A00 100%)"
    : "linear-gradient(180deg,#F4F6FF 10%,#AEB8D6 55%,#5A6488 100%)";
  const titleStroke = victory ? "#3A1D00" : "#0A0E1E";
  const frame = victory
    ? "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 62%,#F5C542 100%)"
    : "linear-gradient(160deg,#C9D0E6 0%,#6A7396 40%,#2A3050 70%,#8A93B8 100%)";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden px-4"
      style={{ background: "rgba(4,4,14,0.8)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={surrendered ? "已撤退" : won ? "戰鬥勝利" : "戰鬥失敗"}
    >
      {/* ---- 勝利：背後光芒＋彩帶 ---- */}
      {victory ? (
        <>
          <div className="pointer-events-none absolute left-1/2 top-[42%] h-[760px] w-[760px] -translate-x-1/2 -translate-y-1/2">
            {/* 動畫會改 transform，置中的 translate 必須放在外層 */}
            <div className="result-rays absolute inset-0" />
          </div>
          <div className="pointer-events-none absolute inset-0">
            {confetti.map((c, i) => (
              <span
                key={i}
                className="confetti"
                style={
                  {
                    left: `${c.left}%`,
                    width: c.w,
                    background: c.color,
                    ["--delay" as string]: `${c.delay}s`,
                    ["--dur" as string]: `${c.dur}s`,
                    ["--dx" as string]: `${c.dx}px`,
                    ["--rot" as string]: `${c.rot}deg`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        </>
      ) : null}

      <div
        className={["result-card relative w-full max-w-sm rounded-[28px] p-[3px]", victory ? "" : "defeat"].join(" ")}
        style={{ background: frame, boxShadow: victory ? "0 0 40px rgba(245,197,66,0.35), 0 24px 60px rgba(0,0,0,0.6)" : "0 24px 60px rgba(0,0,0,0.6)" }}
      >
        <div
          className="relative overflow-hidden rounded-[25px] px-5 pb-5 pt-6"
          style={{
            background: victory
              ? "radial-gradient(ellipse at 50% 0%, #3A2A5E 0%, #17142E 45%, #0B0A18 100%)"
              : "radial-gradient(ellipse at 50% 0%, #2A3048 0%, #14162A 50%, #0B0A18 100%)",
          }}
        >
          {/* 頂部一圈淡淡的光 */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-32"
            style={{ background: victory ? "radial-gradient(ellipse at 50% 0%, rgba(245,197,66,0.35), transparent 70%)" : "radial-gradient(ellipse at 50% 0%, rgba(140,160,220,0.18), transparent 70%)" }}
          />

          {/* ---- 標題 ---- */}
          <div className="relative text-center">
            <span
              className={["result-title fx-text text-[46px] leading-none", surrendered ? "font-black" : "font-display"].join(" ")}
              data-text={titleText}
              style={
                {
                  ["--fx-fill" as string]: titleFill,
                  ["--fx-stroke" as string]: "8px",
                  ["--fx-stroke-color" as string]: titleStroke,
                } as React.CSSProperties
              }
            >
              {titleText}
            </span>
          </div>

          {/* 關卡名稱緞帶 */}
          <div className="result-ribbon relative mx-auto mt-3 flex w-fit items-center">
            <RibbonTail side="left" victory={victory} />
            <div
              className="px-4 py-1 text-center text-[12px] font-black text-white"
              style={{
                background: victory ? "linear-gradient(180deg,#D8354F,#9A1830)" : "linear-gradient(180deg,#4A5378,#2A3050)",
                textShadow: "0 1px 0 rgba(0,0,0,0.5)",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
              }}
            >
              {title}
            </div>
            <RibbonTail side="right" victory={victory} />
          </div>

          {/* ---- 數據 ---- */}
          <div className="result-fade-up mt-4 grid grid-cols-2 gap-2" style={{ animationDelay: "0.5s" }}>
            <StatChip label="花費時間" value={`${timeText}`} unit="秒" icon={<ClockIcon />} />
            <StatChip label="擊敗" value={`${defeatedText}`} unit={`/ ${totalEnemies}`} icon={<SwordsIcon />} />
          </div>

          {/* ---- 掉落物 ---- */}
          {drops.length > 0 ? (
            <div className="result-fade-up mt-4" style={{ animationDelay: "0.75s" }}>
              <SectionLabel text="首通掉落" />
              <div className="mt-2.5 flex flex-wrap justify-center gap-3" style={{ minHeight: 104 }}>
                {drops.map((item, index) => (
                  <DropCard key={item.id} item={item} landed={index < landed} flipped={index < flipped} />
                ))}
              </div>
            </div>
          ) : null}

          {/* ---- 額外訊息（積分、解鎖新塔之類） ---- */}
          {extraLines.length > 0 ? (
            <div className="result-fade-up mt-3 space-y-1.5" style={{ animationDelay: drops.length > 0 ? `${(DROP_START_MS + drops.length * DROP_GAP_MS) / 1000}s` : "0.8s" }}>
              {extraLines.map((line) => (
                <p
                  key={line}
                  className="rounded-full px-3 py-1.5 text-center text-[12px] font-black"
                  style={{
                    color: "#FFE58A",
                    background: "linear-gradient(90deg, rgba(245,197,66,0), rgba(245,197,66,0.16) 20%, rgba(245,197,66,0.16) 80%, rgba(245,197,66,0))",
                    textShadow: "0 1px 0 rgba(0,0,0,0.6)",
                  }}
                >
                  {line}
                </p>
              ))}
            </div>
          ) : null}

          {/* ---- 打輸時的具體建議 ---- */}
          {!won && loseHint ? (
            <div className="result-fade-up mt-3 rounded-2xl border border-[#FF6A7A]/30 bg-[#FF4D5E]/10 px-3 py-2.5" style={{ animationDelay: "0.8s" }}>
              <p className="text-[10px] font-black text-[#FF9AA6]">怎麼打贏</p>
              <p className="mt-0.5 text-[12px] font-bold leading-relaxed text-white/85">{loseHint}</p>
            </div>
          ) : null}

          {/* ---- 按鈕 ---- */}
          <div
            className={["result-fade-up mt-5 grid gap-2", secondaryLabel ? "grid-cols-[1fr_1.4fr]" : "grid-cols-1"].join(" ")}
            style={{ animationDelay: "0.9s" }}
          >
            {secondaryLabel && onSecondary ? (
              <button
                type="button"
                onClick={onSecondary}
                className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-black text-white/85 ring-1 ring-white/20 transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              >
                {secondaryLabel}
              </button>
            ) : null}
            <button
              ref={primaryRef}
              type="button"
              onClick={onPrimary}
              className="rounded-2xl px-3 py-3 text-[15px] font-black text-[#3A1D00] transition-transform active:translate-y-[2px] active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              style={{
                background: "linear-gradient(180deg,#FFF6CC 0%,#F5C542 50%,#E09A12 100%)",
                boxShadow: "inset 0 2px 0 rgba(255,255,255,0.7), inset 0 -3px 0 rgba(120,60,0,0.35), 0 4px 0 #7A4A06, 0 8px 16px rgba(0,0,0,0.4)",
              }}
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 子元件
// ============================================================

function DropCard({ item, landed, flipped }: { item: EquipmentItem; landed: boolean; flipped: boolean }) {
  const m = getTierMaterial(item.tier);
  const size = 66;
  if (!landed) {
    // 還沒落下：先佔位，版面不會因為卡片一張一張出現而跳動
    return <div style={{ width: size, height: size + 34 }} />;
  }
  return (
    <div className="drop-card-enter relative flex flex-col items-center" style={{ width: size + 8 }}>
      {/* 翻面瞬間的光柱 */}
      {flipped ? (
        <div
          className="drop-pillar pointer-events-none absolute bottom-[34px] h-[150px] w-[46px] origin-bottom"
          style={{ left: "calc(50% - 23px)", background: `linear-gradient(0deg, ${m.frameHi}EE 0%, ${m.frame}66 45%, transparent 100%)`, filter: "blur(2px)" }}
        />
      ) : null}
      <div className="drop-card" style={{ width: size, height: size }}>
        <div className={["drop-card-inner h-full w-full", flipped ? "flipped" : ""].join(" ")}>
          {/* 背面 */}
          <div
            className="drop-face flex items-center justify-center rounded-[14px]"
            style={{
              background: "linear-gradient(145deg,#3A2A6E 0%,#1A1438 100%)",
              border: "2.5px solid #F5C542",
              boxShadow: "inset 0 0 12px rgba(245,197,66,0.35), 0 4px 10px rgba(0,0,0,0.45)",
            }}
          >
            <span className="drop-back-pulse font-display text-[30px] text-[#F5C542]" style={{ textShadow: "0 0 10px rgba(245,197,66,0.8)" }}>
              ?
            </span>
          </div>
          {/* 正面 */}
          <div className="drop-face front">
            <ItemFrame tier={item.tier} size={size}>
              <EquipmentIcon kind={item.kind} tier={item.tier} size={size * 0.72} />
            </ItemFrame>
          </div>
        </div>
      </div>
      <p
        className="mt-1.5 text-center text-[11px] font-black leading-tight transition-opacity duration-300"
        style={{ color: m.frameHi, opacity: flipped ? 1 : 0, textShadow: "0 1px 0 rgba(0,0,0,0.6)" }}
      >
        {getEquipmentName(item)}
      </p>
      <p className="text-center text-[9.5px] font-bold text-white/55 transition-opacity duration-300" style={{ opacity: flipped ? 1 : 0 }}>
        {getEquipmentBonusLabel(item)}
      </p>
    </div>
  );
}

function StatChip({ label, value, unit, icon }: { label: string; value: string; unit: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F5C542]/15 text-[#F5C542]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-white/50">{label}</p>
        <p className="leading-none">
          <span className="font-display text-[20px] text-white">{value}</span>
          <span className="ml-1 text-[11px] font-bold text-white/55">{unit}</span>
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#F5C542]/70" />
      <span className="block h-1.5 w-1.5 rotate-45 bg-[#F5C542]" />
      <span className="text-[12px] font-black text-[#FFE58A]">{text}</span>
      <span className="block h-1.5 w-1.5 rotate-45 bg-[#F5C542]" />
      <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#F5C542]/70" />
    </div>
  );
}

function RibbonTail({ side, victory }: { side: "left" | "right"; victory: boolean }) {
  const color = victory ? "#7A1022" : "#1E2340";
  return (
    <svg width="14" height="28" viewBox="0 0 14 28" aria-hidden="true" style={{ transform: side === "right" ? "scaleX(-1)" : undefined, marginTop: 6 }}>
      <path d="M14,0 L14,22 L0,22 L5,11 L0,0 Z" fill={color} />
      <path d="M14,22 L10,28 L10,22 Z" fill="#000000" opacity={0.5} />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2" />
      <path d="M9 2h6" />
    </svg>
  );
}

function SwordsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
      <path d="M9.5 6.5 14 2h3v3l-4.5 4.5" />
    </svg>
  );
}
