/**
 * src/hooks/usePositionAnalysis.ts
 *
 * 「分析這個局面」的共用邏輯（學生回顧頁面、老師後台回放視窗都用
 * 同一份，不要各自複製貼上一份容易日後改一邊忘了改另一邊）。
 * ------------------------------------------------------------
 * 呼叫端只要提供「目前要分析哪個局面」（fen + sideToMove），這個
 * Hook 就會處理：開關自動分析模式、局面一變就自動重新呼叫
 * /api/analyze-position、避免較慢的舊請求蓋掉較新的結果。
 */

import { useEffect, useState } from "react";

export interface AnalysisResult {
  move: string;
  scoreCp: number;
  depth: number;
  mateIn: number | null;
}

export function usePositionAnalysis(fen: string | null, sideToMove: "w" | "b") {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  useEffect(() => {
    // 局面一變，舊的分析結果（跟箭頭）就對不上了，先清掉。
    setAnalysis(null);
    setAnalyzeError(null);

    if (!autoAnalyze || !fen) return;

    let isCancelled = false;
    setIsAnalyzing(true);

    (async () => {
      try {
        const response = await fetch("/api/analyze-position", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen, sideToMove }),
        });
        if (!response.ok) {
          const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errorBody?.error ?? `分析失敗（狀態碼 ${response.status}）`);
        }
        const data = (await response.json()) as AnalysisResult;
        if (isCancelled) return;
        setAnalysis(data);
      } catch (error) {
        if (isCancelled) return;
        const rawMessage = error instanceof Error ? error.message : "";
        // 「沒有合法走法」代表這個局面本身就是終局（將死/困斃），不是
        // 真正的系統錯誤——分析這種局面本來就問不出結果，換成比較
        // 平靜、好理解的訊息，不用印 console.error 嚇自己。
        if (rawMessage.includes("沒有合法走法")) {
          setAnalyzeError("這個局面已經是終局（將死或無棋可走），沒有走法可以分析。");
        } else {
          console.error("[usePositionAnalysis] 分析失敗：", error);
          setAnalyzeError(rawMessage || "分析時發生未知錯誤，請稍後再試。");
        }
      } finally {
        if (!isCancelled) setIsAnalyzing(false);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [fen, sideToMove, autoAnalyze]);

  return {
    analysis,
    isAnalyzing,
    analyzeError,
    autoAnalyze,
    toggleAutoAnalyze: () => setAutoAnalyze((prev) => !prev),
  };
}

/** 把引擎分數（永遠是「目前局面輪走方」的視角）換算成「紅方視角」 */
export function toRedPerspectiveScore(scoreCp: number, sideToMove: "w" | "b"): number {
  return sideToMove === "w" ? scoreCp : -scoreCp;
}

/** 把「目前局面輪走方」視角的 mateIn 換算成「紅方視角」（跟分數的換算邏輯一樣對稱） */
export function toRedPerspectiveMateIn(mateIn: number | null, sideToMove: "w" | "b"): number | null {
  if (mateIn === null) return null;
  return sideToMove === "w" ? mateIn : -mateIn;
}

export type ScoreDisplayVariant = "red-mate" | "black-mate" | "red-advantage" | "black-advantage" | "even";

export interface ScoreDisplay {
  label: string;
  variant: ScoreDisplayVariant;
}

/**
 * 把紅方視角的分數/將死步數換算成顯示用的文字跟顏色種類。
 * 有強制將死時優先顯示「X步殺」，不顯示分數（將死比分數更明確，沒有
 * 必要兩個都顯示）；沒有強制將死才顯示「黑優202分」這種一般分數格式。
 */
export function getScoreDisplay(redPerspectiveScoreCp: number, redPerspectiveMateIn: number | null): ScoreDisplay {
  if (redPerspectiveMateIn !== null) {
    const movesToMate = Math.abs(redPerspectiveMateIn);
    return redPerspectiveMateIn > 0
      ? { label: `紅方 ${movesToMate} 步殺！`, variant: "red-mate" }
      : { label: `黑方 ${movesToMate} 步殺！`, variant: "black-mate" };
  }
  if (redPerspectiveScoreCp === 0) return { label: "勢均力敵", variant: "even" };
  return redPerspectiveScoreCp > 0
    ? { label: `紅優${redPerspectiveScoreCp}分`, variant: "red-advantage" }
    : { label: `黑優${Math.abs(redPerspectiveScoreCp)}分`, variant: "black-advantage" };
}

/** 各種分數顯示種類對應的底色/文字色，學生回顧頁面、老師後台回放都共用同一套配色 */
export const SCORE_DISPLAY_STYLES: Record<ScoreDisplayVariant, string> = {
  "red-mate": "bg-[#C0392B] text-white",
  "black-mate": "bg-[#1A1A2E] text-white",
  "red-advantage": "bg-[#C0392B]/10 text-[#C0392B]",
  "black-advantage": "bg-[#1A1A2E]/10 text-[#1A1A2E]",
  even: "bg-[#1A1A2E] text-[#FDF6E8]",
};
