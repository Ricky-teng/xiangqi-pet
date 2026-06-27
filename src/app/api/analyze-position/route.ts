/**
 * src/app/api/analyze-position/route.ts
 *
 * 棋局分析 API（給「最近對局」回顧功能用）
 * ------------------------------------------------------------
 * 跟 /api/engine-move 不一樣：那個是「電腦對弈時，電腦這一步要走
 * 哪裡」（會套用難度對應的「送子」隨機性），這個是「不管是誰問、不管
 * 原本是第幾級的對局，永遠用引擎最強設定給出真正最佳的走法跟評分」，
 * 給學生/老師回顧棋局時看「這裡其實有更好的走法」用。
 */

import { NextResponse } from "next/server";
import { analyzePosition } from "@/lib/engine/pikafishProcess";

export const maxDuration = 30;

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
    const result = await analyzePosition(fen, sideToMove);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/analyze-position] Pikafish 分析失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分析時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
