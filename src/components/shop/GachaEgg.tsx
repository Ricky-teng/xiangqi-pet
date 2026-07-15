// src/components/shop/GachaEgg.tsx
"use client";

import { useMemo } from "react";
import type { ShopItem } from "@/lib/shopItems";

export type GachaPhase = "idle" | "shaking" | "cracking" | "revealed";

export interface GachaResultData {
  item: ShopItem | null;
  isDuplicate: boolean;
  missed: boolean;
}

const CONFETTI_COLORS = ["#E8B84B", "#8B5FBF", "#5B8C5A", "#C0392B", "#F6D87A"];

/**
 * 抽獎用的蛋：idle 時輕輕呼吸浮動，shaking 時劇烈搖晃醞釀期待感，
 * cracking 時蛋殼裂成兩半飛開，revealed 時中間彈出結果卡片。
 * 只有「抽到全新背景」才會噴彩帶，抽到重複或銘謝惠顧時刻意收斂，
 * 讓「中獎」跟「沒中」的情緒回饋有明顯落差。
 *
 * 用法：父層在每次開始抽獎時換一個新的 key（例如遞增的 drawSeq）掛在
 * <GachaEgg key={drawSeq} .../> 上，讓元件重新掛載、彩帶角度重新計算，
 * 也確保同一個 phase 值不會因為「沒有變化」而卡住動畫。
 */
export default function GachaEgg({ phase, result }: { phase: GachaPhase; result: GachaResultData | null }) {
  const isWin = phase === "revealed" && !!result && !result.missed && !result.isDuplicate;

  // 彩帶只在掛載當下算一次，避免父層重新渲染時角度一直跳動
  const confetti = useMemo(() => {
    if (!isWin) return [];
    return Array.from({ length: 16 }).map((_, i) => {
      const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      const distance = 70 + Math.random() * 46;
      return {
        tx: Math.cos(angle) * distance,
        ty: Math.sin(angle) * distance,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.12,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="gacha-egg-stage">
      {/* shaking / cracking 階段的光暈脈衝，堆疊期待感 */}
      {(phase === "shaking" || phase === "cracking") && (
        <>
          <span className="gacha-ring" style={{ animationDelay: "0s" }} />
          <span className="gacha-ring" style={{ animationDelay: "0.25s" }} />
          <span className="gacha-ring" style={{ animationDelay: "0.5s" }} />
        </>
      )}

      {/* 蛋殼本體：頂/底兩半，idle 時完全重疊看起來像一顆完整的蛋 */}
      <div className={`gacha-egg gacha-egg--${phase}`}>
        <div className="gacha-egg-half gacha-egg-half--top" />
        <div className="gacha-egg-crack-line" />
        <div className="gacha-egg-half gacha-egg-half--bottom" />
      </div>

      {/* 裂開瞬間的閃光 */}
      {phase === "cracking" && <span className="gacha-flash" />}

      {/* 揭曉結果 */}
      {phase === "revealed" && result ? (
        <div className="gacha-result-pop">
          {result.missed ? (
            <div className="gacha-result-card gacha-result-card--miss">
              <span className="text-3xl">😢</span>
              <p className="mt-1 text-xs font-bold text-[#1A1A2E]/60">銘謝惠顧</p>
            </div>
          ) : result.item ? (
            <div className="gacha-result-card">
              {result.item.backgroundSrc ? (
                <img src={result.item.backgroundSrc} alt={result.item.name} className="h-24 w-24 rounded-2xl object-cover object-top" />
              ) : (
                <span className="text-3xl">{result.item.icon}</span>
              )}
              <p className="mt-1 max-w-[120px] text-center text-xs font-bold text-[#1A1A2E]">
                {result.isDuplicate ? "🔁 重複了" : "🎉 全新背景"}
              </p>
              <p className="text-center text-[11px] font-semibold text-[#8B5FBF]">{result.item.name}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 彩帶：只有全新中獎才噴 */}
      {isWin
        ? confetti.map((c, i) => (
            <span
              key={i}
              className="gacha-confetti"
              style={{
                background: c.color,
                animationDelay: `${c.delay}s`,
                ["--tx" as string]: `${c.tx}px`,
                ["--ty" as string]: `${c.ty}px`,
              }}
            />
          ))
        : null}

      <style jsx>{`
        .gacha-egg-stage {
          position: relative;
          width: 140px;
          height: 160px;
          margin: 8px auto 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .gacha-ring {
          position: absolute;
          width: 90px;
          height: 90px;
          border-radius: 9999px;
          border: 2px solid #e8b84b;
          opacity: 0;
          animation: gacha-ring-pulse 1.1s ease-out infinite;
        }

        @keyframes gacha-ring-pulse {
          0% {
            transform: scale(0.6);
            opacity: 0.55;
          }
          100% {
            transform: scale(1.9);
            opacity: 0;
          }
        }

        .gacha-egg {
          position: absolute;
          width: 104px;
          height: 130px;
          transform-origin: 50% 88%;
        }

        .gacha-egg--idle {
          animation: gacha-idle-float 2.6s ease-in-out infinite;
        }

        .gacha-egg--shaking {
          animation: gacha-shake 0.9s ease-in-out;
        }

        .gacha-egg--cracking .gacha-egg-half--top {
          animation: gacha-crack-top 0.5s cubic-bezier(0.32, 0.8, 0.4, 1) forwards;
        }
        .gacha-egg--cracking .gacha-egg-half--bottom {
          animation: gacha-crack-bottom 0.5s cubic-bezier(0.32, 0.8, 0.4, 1) forwards;
        }

        .gacha-egg--revealed .gacha-egg-half--top,
        .gacha-egg--revealed .gacha-egg-half--bottom {
          opacity: 0;
        }

        .gacha-egg-half {
          position: absolute;
          inset: 0;
          border-radius: 50% 50% 46% 46% / 62% 62% 38% 38%;
          background: linear-gradient(155deg, #fffdf8 0%, #fce6a0 55%, #f6d87a 100%);
          box-shadow:
            inset -10px -12px 18px rgba(92, 61, 10, 0.16),
            inset 6px 8px 12px rgba(255, 255, 255, 0.6),
            0 10px 18px rgba(26, 26, 46, 0.16);
        }
        .gacha-egg-half--top {
          clip-path: inset(0 0 48% 0);
        }
        .gacha-egg-half--bottom {
          clip-path: inset(48% 0 0 0);
        }

        .gacha-egg-crack-line {
          position: absolute;
          left: 8%;
          right: 8%;
          top: 47%;
          height: 6%;
          opacity: 0;
          transition: opacity 0.25s ease;
          clip-path: polygon(
            0% 50%, 8% 10%, 16% 60%, 24% 5%, 32% 55%, 40% 15%,
            48% 65%, 56% 10%, 64% 55%, 72% 5%, 80% 60%, 88% 15%,
            100% 50%, 100% 62%, 88% 27%, 80% 72%, 72% 17%, 64% 67%,
            56% 22%, 48% 77%, 40% 27%, 32% 67%, 24% 17%, 16% 72%, 8% 22%, 0% 62%
          );
          background: #5c3d0a;
        }
        .gacha-egg--shaking .gacha-egg-crack-line,
        .gacha-egg--cracking .gacha-egg-crack-line {
          opacity: 0.85;
        }

        @keyframes gacha-idle-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }

        @keyframes gacha-shake {
          0%,
          100% {
            transform: rotate(0deg) translateX(0);
          }
          10% {
            transform: rotate(-5deg) translateX(-2px);
          }
          20% {
            transform: rotate(5deg) translateX(2px);
          }
          30% {
            transform: rotate(-6deg) translateX(-3px);
          }
          40% {
            transform: rotate(6deg) translateX(3px);
          }
          50% {
            transform: rotate(-8deg) translateX(-4px);
          }
          60% {
            transform: rotate(8deg) translateX(4px);
          }
          70% {
            transform: rotate(-9deg) translateX(-5px);
          }
          80% {
            transform: rotate(9deg) translateX(5px);
          }
          90% {
            transform: rotate(-5deg) translateX(-2px);
          }
        }

        @keyframes gacha-crack-top {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate(-42px, -50px) rotate(-38deg);
            opacity: 0;
          }
        }
        @keyframes gacha-crack-bottom {
          0% {
            transform: translate(0, 0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate(42px, 50px) rotate(35deg);
            opacity: 0;
          }
        }

        .gacha-flash {
          position: absolute;
          width: 140px;
          height: 140px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(255, 253, 248, 0.95) 0%, rgba(232, 184, 75, 0.5) 45%, rgba(232, 184, 75, 0) 75%);
          animation: gacha-flash-pop 0.5s ease-out forwards;
        }
        @keyframes gacha-flash-pop {
          0% {
            transform: scale(0.2);
            opacity: 0;
          }
          35% {
            transform: scale(1.1);
            opacity: 1;
          }
          100% {
            transform: scale(1.6);
            opacity: 0;
          }
        }

        .gacha-result-pop {
          position: absolute;
          animation: gacha-pop-in 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) both;
          animation-delay: 0.35s;
          opacity: 0;
        }
        @keyframes gacha-pop-in {
          0% {
            transform: scale(0.35);
            opacity: 0;
          }
          65% {
            transform: scale(1.08);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .gacha-result-card {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .gacha-confetti {
          position: absolute;
          top: 46%;
          left: 50%;
          width: 8px;
          height: 8px;
          margin: -4px 0 0 -4px;
          border-radius: 2px;
          animation: gacha-confetti-fly 0.75s ease-out forwards;
          animation-delay: 0.35s;
          opacity: 0;
        }
        @keyframes gacha-confetti-fly {
          0% {
            transform: translate(0, 0) scale(1) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translate(var(--tx), var(--ty)) scale(0.4) rotate(240deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
