/**
 * src/components/RankUpCelebration.tsx
 *
 * 棋力升段的滿版慶祝頁
 * ------------------------------------------------------------
 * 原本升段只在解題結果下面顯示一行小字，學生反應「太不明顯」；而且
 * 殘局對戰／配對對弈升段時「完全沒有任何提示」（那兩頁沒有各自接
 * 升級 UI）。
 *
 * 改法：慶祝頁掛在 AuthProvider（全站），監看 store 的 pendingRankUp。
 * 因為 addChessLevelPoints 是所有升段的唯一入口，不管學生是在解題、
 * 贏電腦、還是贏真人對戰時升段，都會跳出同一套滿版慶祝，不用每個
 * 頁面各自處理。
 *
 * 分享功能：用 canvas 合成一張「升段卡」圖片再透過系統分享面板送出
 * （Web Share API）。不支援分享檔案的裝置（多數桌機瀏覽器）會自動
 * 退回下載圖片，不會讓按鈕按了沒反應。
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { getPetDisplaySrc, getPetImagePath } from "@/lib/pet/petImagePath";

/** 彩帶顏色：沿用 App 既有的配色，不另外引入新色系 */
const CONFETTI_COLORS = ["#E8B84B", "#F6D87A", "#5B8C5A", "#8B5FBF", "#C0392B", "#FFFFFF"];

export default function RankUpCelebration() {
  const pendingRankUp = useGameStore((s) => s.pendingRankUp);
  const clearPendingRankUp = useGameStore((s) => s.clearPendingRankUp);
  const user = useGameStore((s) => s.user);
  const pet = useGameStore((s) => s.pet);

  const [shareState, setShareState] = useState<"idle" | "working" | "downloaded" | "error">("idle");
  const petImgRef = useRef<HTMLImageElement>(null);

  // 彩帶/星星的位置用固定的偽隨機（sin）算，不用 Math.random()——
  // 否則每次 re-render（例如按下分享改變 state）整片彩帶會重新洗牌跳動。
  const confetti = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        id: i,
        left: Math.round((Math.sin(i * 12.9898) * 0.5 + 0.5) * 100),
        delay: ((i * 37) % 250) / 100,
        duration: 2.4 + ((i * 53) % 180) / 100,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        isRound: i % 3 === 0,
      })),
    []
  );

  const sparkles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: Math.round((Math.sin(i * 7.31) * 0.5 + 0.5) * 92) + 4,
        top: Math.round((Math.sin(i * 4.77) * 0.5 + 0.5) * 70) + 8,
        delay: ((i * 29) % 200) / 100,
      })),
    []
  );

  // 慶祝頁出現時鎖住背景捲動，關掉後還原
  useEffect(() => {
    if (!pendingRankUp) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingRankUp]);

  // 每次跳出新的慶祝就重置分享狀態，不然會殘留上一次的「已下載」字樣
  useEffect(() => {
    if (pendingRankUp) setShareState("idle");
  }, [pendingRankUp]);

  if (!pendingRankUp) return null;

  const displayName = user?.displayName ?? "同學";
  const petDisplay = pet ? getPetDisplaySrc(pet.stage, pet.healthStatus, pet.currentAppearanceId) : null;

  /** 把升段卡畫成一張 1080x1350 的圖（直式，適合限動/貼文） */
  async function buildShareImage(): Promise<Blob | null> {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // 背景漸層
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#2B1F08");
    bg.addColorStop(0.5, "#5C3D0A");
    bg.addColorStop(1, "#2B1F08");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 中央放射光暈
    const glow = ctx.createRadialGradient(540, 560, 40, 540, 560, 520);
    glow.addColorStop(0, "rgba(232, 184, 75, 0.55)");
    glow.addColorStop(1, "rgba(232, 184, 75, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = "center";

    // 標題
    ctx.fillStyle = "#F6D87A";
    ctx.font = "bold 58px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText("棋力升段！", 540, 220);

    // 段位徽章（金色圓盤 + 段位文字）
    ctx.beginPath();
    ctx.arc(540, 560, 230, 0, Math.PI * 2);
    const badge = ctx.createLinearGradient(310, 330, 770, 790);
    badge.addColorStop(0, "#F6D87A");
    badge.addColorStop(1, "#E8B84B");
    ctx.fillStyle = badge;
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#FDF6E8";
    ctx.stroke();

    ctx.fillStyle = "#5C3D0A";
    ctx.font = "bold 190px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(pendingRankUp!.newRankLabel, 540, 625);

    // 段位變化
    ctx.fillStyle = "#FDF6E8";
    ctx.font = "bold 52px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(`${pendingRankUp!.previousRankLabel}  →  ${pendingRankUp!.newRankLabel}`, 540, 900);

    // 玩家名字
    ctx.fillStyle = "#F6D87A";
    ctx.font = "bold 62px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText(displayName, 540, 1010);

    // 小雞圖（載入失敗就跳過，不讓整張圖失敗）
    const petSrc = petImgRef.current?.src;
    if (petSrc) {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const size = 190;
          ctx.drawImage(img, 540 - size / 2, 1060, size, size);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = petSrc;
      });
    }

    // 頁尾
    ctx.fillStyle = "rgba(253, 246, 232, 0.65)";
    ctx.font = "bold 38px 'Noto Sans TC', system-ui, sans-serif";
    ctx.fillText("象棋小雞", 540, 1290);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function handleShare() {
    setShareState("working");
    const shareText = `我在象棋小雞升到「${pendingRankUp!.newRankLabel}」了！`;

    try {
      const blob = await buildShareImage();
      if (blob) {
        const file = new File([blob], `xiangqi-rank-${pendingRankUp!.newLevel}.png`, {
          type: "image/png",
        });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text: shareText });
          setShareState("idle");
          return;
        }

        // 不支援分享檔案（多數桌機瀏覽器）→ 退回下載，至少讓學生拿得到圖
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setShareState("downloaded");
        return;
      }
      throw new Error("產生圖片失敗");
    } catch (error) {
      // 使用者在系統分享面板按「取消」也會走到這裡（AbortError），
      // 那不是錯誤，靜靜回到原狀就好，不要跳紅字嚇到人。
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareState("idle");
        return;
      }
      console.error("[RankUpCelebration] 分享失敗：", error);
      setShareState("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden px-6">
      {/* 深色底 + 中央光暈 */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg, #2B1F08 0%, #5C3D0A 50%, #2B1F08 100%)" }}
      />
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[120vmin] w-[120vmin] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(232,184,75,0.38) 0%, rgba(232,184,75,0) 70%)",
        }}
        aria-hidden="true"
      />

      {/* 背後緩慢旋轉的放射光線 */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 h-[150vmax] w-[150vmax] opacity-[0.16]"
        style={{
          background:
            "repeating-conic-gradient(from 0deg, #F6D87A 0deg 8deg, transparent 8deg 22deg)",
          animation: "rankup-rays-spin 26s linear infinite",
        }}
        aria-hidden="true"
      />

      {/* 彩帶 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {confetti.map((piece) => (
          <span
            key={piece.id}
            className="absolute top-0 block"
            style={{
              left: `${piece.left}%`,
              width: piece.isRound ? 10 : 8,
              height: piece.isRound ? 10 : 18,
              backgroundColor: piece.color,
              borderRadius: piece.isRound ? "9999px" : "2px",
              animation: `rankup-confetti-fall ${piece.duration}s linear ${piece.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* 閃爍星星 */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {sparkles.map((sparkle) => (
          <span
            key={sparkle.id}
            className="absolute text-lg"
            style={{
              left: `${sparkle.left}%`,
              top: `${sparkle.top}%`,
              animation: `rankup-sparkle 2.2s ease-in-out ${sparkle.delay}s infinite`,
            }}
          >
            ✨
          </span>
        ))}
      </div>

      {/* ---- 主要內容 ---- */}
      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <p
          className="text-sm font-bold tracking-[0.35em] text-[#F6D87A]"
          style={{ animation: "rankup-rise-in 0.5s ease-out 0.15s both" }}
        >
          棋力升段
        </p>

        {pendingRankUp.levelsGained > 1 ? (
          <p
            className="mt-1 rounded-full bg-[#C0392B] px-3 py-0.5 text-xs font-extrabold text-white shadow-lg"
            style={{ animation: "rankup-rise-in 0.5s ease-out 0.25s both" }}
          >
            🔥 一口氣連升 {pendingRankUp.levelsGained} 級！
          </p>
        ) : null}

        {/* 段位徽章 */}
        <div className="relative mt-6 flex h-52 w-52 items-center justify-center">
          <span
            className="absolute left-1/2 top-1/2 h-60 w-60 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(246,216,122,0.75) 0%, rgba(246,216,122,0) 70%)",
              animation: "rankup-halo-pulse 2.6s ease-in-out infinite",
            }}
            aria-hidden="true"
          />
          <div
            className="relative flex h-44 w-44 items-center justify-center rounded-full border-[6px] border-[#FDF6E8] shadow-2xl"
            style={{
              background: "linear-gradient(135deg, #F6D87A 0%, #E8B84B 100%)",
              animation: "rankup-badge-pop 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) both",
            }}
          >
            <span className="text-5xl font-black text-[#5C3D0A]">{pendingRankUp.newRankLabel}</span>
          </div>
        </div>

        {/* 段位變化 */}
        <p
          className="mt-6 text-base font-bold text-[#FDF6E8]/80"
          style={{ animation: "rankup-rise-in 0.5s ease-out 0.75s both" }}
        >
          {pendingRankUp.previousRankLabel}
          <span className="mx-2 text-[#F6D87A]">→</span>
          <span className="text-xl font-black text-[#F6D87A]">{pendingRankUp.newRankLabel}</span>
        </p>

        <p
          className="mt-2 text-sm text-[#FDF6E8]/60"
          style={{ animation: "rankup-rise-in 0.5s ease-out 0.85s both" }}
        >
          {displayName}，你的棋力又進步了！
        </p>

        {/* 小雞（也拿來當合成分享圖的來源） */}
        {petDisplay ? (
          <img
            ref={petImgRef}
            src={petDisplay.src}
            alt=""
            onError={(e) => {
              // 職業外觀圖載入失敗就退回階段圖，跟其他頁面同一套防呆
              if (pet && petDisplay.isJobImage) {
                e.currentTarget.src = getPetImagePath(pet.stage, pet.healthStatus);
              }
            }}
            className="mt-4 h-20 w-20 object-contain drop-shadow-2xl"
            style={{ animation: "rankup-rise-in 0.5s ease-out 0.95s both" }}
          />
        ) : null}

        {/* ---- 按鈕 ---- */}
        <div
          className="mt-8 flex w-full flex-col gap-2"
          style={{ animation: "rankup-rise-in 0.5s ease-out 1.05s both" }}
        >
          <button
            type="button"
            onClick={handleShare}
            disabled={shareState === "working"}
            className="w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3.5 text-base font-extrabold text-[#5C3D0A] shadow-xl transition-transform active:scale-95 disabled:opacity-70"
          >
            {shareState === "working" ? "製作分享圖中…" : "📤 分享炫耀一下"}
          </button>

          {shareState === "downloaded" ? (
            <p className="text-xs text-[#FDF6E8]/70">
              這個裝置不支援直接分享，已經把升段卡下載下來了！
            </p>
          ) : shareState === "error" ? (
            <p className="text-xs text-[#FFB4A8]">分享失敗，請稍後再試。</p>
          ) : null}

          <button
            type="button"
            onClick={clearPendingRankUp}
            className="w-full rounded-2xl bg-white/10 px-4 py-3 text-sm font-bold text-[#FDF6E8] transition-transform active:scale-95"
          >
            繼續挑戰
          </button>
        </div>
      </div>
    </div>
  );
}
