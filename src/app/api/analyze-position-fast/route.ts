/**
 * src/app/api/analyze-position-fast/route.ts
 *
 * 快速版棋局分析 API（給「整局每步好壞標記」批次分析用）
 * ------------------------------------------------------------
 * 跟 /api/analyze-position 不一樣：那個是給學生在回放頁按「分析這個
 * 局面」時，用引擎最強設定（8.5秒／個）換取最準確的單一局面分析。
 * 這裡是對局結束後要在背景把「整局」40~60+ 個局面都分析一輪，
 * 用引擎最強設定跑會要 6~9 分鐘不可行，所以犧牲一點準確度換速度
 * （見 @/lib/engine/pikafishProcess.ts 的 FAST_BATCH_ANALYSIS_CONFIG）。
 *
 * 呼叫端（@/lib/engine/moveQuality.ts）會依序、一次一個局面地呼叫
 * 這個 API，不會同時發送多個請求，避免同時開太多 Pikafish 子程序。
 */

import { NextResponse } from "next/server";
import { analyzePositionFast } from "@/lib/engine/pikafishProcess";

export const maxDuration = 15;

function isValidSideToMove(value: unknown): value is "w" | "b" {
  return value === "w" || value === "b";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤，應為 JSON。" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "請求格式錯誤，應為 JSON 物件。" }, { status: 400 });
  }

  const { fen, sideToMove } = body as Record<string, unknown>;

  if (typeof fen !== "string" || fen.trim().length === 0) {
    return NextResponse.json({ error: "缺少或格式錯誤的 fen 參數。" }, { status: 400 });
  }
  if (!isValidSideToMove(sideToMove)) {
    return NextResponse.json({ error: "sideToMove 必須是 \"w\" 或 \"b\"。" }, { status: 400 });
  }

  try {
    const result = await analyzePositionFast(fen, sideToMove);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/analyze-position-fast] Pikafish 快速分析失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分析時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
