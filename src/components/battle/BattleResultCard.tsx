// src/components/battle/BattleResultCard.tsx
"use client";

/**
 * 戰鬥結算卡片（探險與戰隊共用）
 * ------------------------------------------------------------
 * 卡片式彈窗，不轉頁——小關打完一直跳全螢幕會打斷節奏。
 *
 * 掉落物是一個一個飛進來的（每 180ms 一件），因為「看東西掉出來」
 * 本身就是探險最爽的一段，一次全部出現就沒感覺了。
 *
 * 打輸的時候刻意給「具體」的提示而不是「再接再厲」——探險的勝率
 * 幾乎沒有中間值（回血 30% 讓結果變成確定的），所以學生打輸就是
 * 真的裝備不夠，直接告訴他差在哪比較有用。
 */

import { useEffect, useState } from "react";
import {
  KIND_EMOJIS,
  getEquipmentBonusLabel,
  getEquipmentName,
  getTierColor,
  isTierGlowing,
  type EquipmentItem,
} from "@/lib/rpg/equipment";

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
  /** 目前已經飛進來幾件掉落物 */
  const [revealedDrops, setRevealedDrops] = useState(0);

  useEffect(() => {
    if (drops.length === 0) return;
    // 卡片本身要先彈出來（約 0.5 秒）才開始掉東西，不然會擠在一起
    const timers = drops.map((_, index) =>
      setTimeout(() => setRevealedDrops(index + 1), 500 + index * 180),
    );
    return () => timers.forEach(clearTimeout);
  }, [drops]);

  const headline = surrendered ? "🏳️ 已投降" : won ? "🎉 通關！" : "💀 挑戰失敗";
  const headlineColor = won && !surrendered ? "#E8B84B" : "#C0392B";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-sm rounded-3xl p-5 shadow-2xl"
        style={{
          // 內陰影＋金邊：全站新畫面的質感基調，之後探險/戰隊的卡片
          // 都沿用這一組
          background: "linear-gradient(180deg, #FDF6E8 0%, #F3E6CC 100%)",
          border: "2px solid #E8B84B",
          boxShadow: "inset 0 2px 10px rgba(92,61,10,0.18), 0 18px 40px rgba(0,0,0,0.45)",
          animation: "battle-result-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        }}
      >
        <p className="text-center text-2xl font-extrabold" style={{ color: headlineColor }}>
          {headline}
        </p>
        <p className="mt-0.5 text-center text-xs font-bold text-[#5C3D0A]/70">{title}</p>

        {/* ---- 基本數據 ---- */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/70 px-3 py-2 text-center">
            <p className="text-[10px] font-bold text-[#1A1A2E]/45">花費時間</p>
            <p className="text-sm font-extrabold text-[#1A1A2E]">
              {durationSeconds.toFixed(1)} 秒
            </p>
          </div>
          <div className="rounded-2xl bg-white/70 px-3 py-2 text-center">
            <p className="text-[10px] font-bold text-[#1A1A2E]/45">擊敗</p>
            <p className="text-sm font-extrabold text-[#1A1A2E]">
              {defeated} / {totalEnemies}
            </p>
          </div>
        </div>

        {/* ---- 掉落物 ---- */}
        {drops.length > 0 ? (
          <div className="mt-3 rounded-2xl bg-white/70 px-3 py-3">
            <p className="text-center text-[10px] font-bold text-[#1A1A2E]/45">首通掉落</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {drops.slice(0, revealedDrops).map((item, index) => (
                <div
                  key={item.id}
                  className="flex flex-col items-center rounded-xl border-2 bg-white px-2 py-1.5"
                  style={{
                    borderColor: getTierColor(item.tier),
                    boxShadow: isTierGlowing(item.tier)
                      ? `0 0 12px ${getTierColor(item.tier)}99`
                      : undefined,
                    animation: "battle-drop-fly 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                    animationDelay: `${index * 20}ms`,
                  }}
                >
                  <span className="text-xl">{KIND_EMOJIS[item.kind]}</span>
                  <span
                    className="text-[10px] font-extrabold"
                    style={{ color: getTierColor(item.tier) }}
                  >
                    {getEquipmentName(item)}
                  </span>
                  <span className="text-[9px] text-[#1A1A2E]/50">
                    {getEquipmentBonusLabel(item)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* ---- 額外訊息（積分、解鎖新塔之類） ---- */}
        {extraLines.length > 0 ? (
          <div className="mt-3 space-y-1">
            {extraLines.map((line) => (
              <p
                key={line}
                className="rounded-xl bg-[#5B8C5A]/12 px-3 py-1.5 text-center text-xs font-bold text-[#3E6B3D]"
              >
                {line}
              </p>
            ))}
          </div>
        ) : null}

        {/* ---- 打輸時的具體建議 ---- */}
        {!won && loseHint ? (
          <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-bold text-[#C0392B]">
            {loseHint}
          </p>
        ) : null}

        {/* ---- 按鈕 ---- */}
        <div className={["mt-4 grid gap-2", secondaryLabel ? "grid-cols-2" : "grid-cols-1"].join(" ")}>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={onSecondary}
              className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1A2E]/70 shadow-sm transition-transform active:scale-95"
            >
              {secondaryLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onPrimary}
            className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
            style={{ boxShadow: "inset 0 1px 6px rgba(255,255,255,0.6), 0 4px 10px rgba(92,61,10,0.3)" }}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
