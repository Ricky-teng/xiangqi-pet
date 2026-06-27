/**
 * src/app/api/engine-move/route.ts
 *
 * 對弈電腦的「真正引擎」API
 * ------------------------------------------------------------
 * 只能在伺服器端執行（Pikafish 是原生執行檔，瀏覽器不能直接跑），
 * 前端（/play 頁面）改成呼叫這個 API 取得電腦這一步要走哪裡，取代
 * 原本 computerPlayer.ts 裡的隨機選棋佔位版本。
 *
 * 設定 maxDuration：難度等級最高的思考時間上限是 5 秒（見
 * pikafishProcess.ts 的 LEVEL_SEARCH_CONFIG），加上子程序啟動跟
 * 權重檔載入的時間，這裡保留充足餘裕，避免在比較慢的執行環境下
 * 被 Vercel 提前砍斷。
 */

import { NextResponse } from "next/server";
import { getPikafishMove } from "@/lib/engine/pikafishProcess";
import { COMPUTER_LEVELS, type ComputerLevel } from "@/lib/engine/computerPlayer";

export const maxDuration = 30;

function isValidSideToMove(value: unknown): value is "w" | "b" {
  return value === "w" || value === "b";
}

function isValidLevel(value: unknown): value is ComputerLevel {
  return typeof value === "number" && (COMPUTER_LEVELS as number[]).includes(value);
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

  const { fen, sideToMove, level } = body as Record<string, unknown>;

  if (typeof fen !== "string" || fen.trim().length === 0) {
    return NextResponse.json({ error: "缺少或格式錯誤的 fen 參數。" }, { status: 400 });
  }
  if (!isValidSideToMove(sideToMove)) {
    return NextResponse.json({ error: "sideToMove 必須是 \"w\" 或 \"b\"。" }, { status: 400 });
  }
  if (!isValidLevel(level)) {
    return NextResponse.json({ error: "level 必須是 1-10 之間的整數。" }, { status: 400 });
  }

  try {
    const result = await getPikafishMove(fen, sideToMove, level);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/engine-move] Pikafish 引擎執行失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "引擎執行時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
