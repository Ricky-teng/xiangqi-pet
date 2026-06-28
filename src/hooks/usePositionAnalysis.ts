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
        console.error("[usePositionAnalysis] 分析失敗：", error);
        setAnalyzeError(error instanceof Error ? error.message : "分析時發生未知錯誤，請稍後再試。");
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

/** 把紅方視角分數換算成「黑優202分」「紅優100分」這種一看就懂的格式 */
export function formatScoreLabel(redPerspectiveScore: number): string {
  if (redPerspectiveScore === 0) return "勢均力敵";
  const side = redPerspectiveScore > 0 ? "紅優" : "黑優";
  return `${side}${Math.abs(redPerspectiveScore)}分`;
}
