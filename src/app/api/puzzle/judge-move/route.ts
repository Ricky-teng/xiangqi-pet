/**
 * src/app/api/puzzle/judge-move/route.ts
 *
 * 殘局解題「偏離已知正解線」的判斷 API
 * ------------------------------------------------------------
 * 學生解殘局題時，優先跟題庫存好的正解線（moves + alternativeLines）
 * 比對，完全免費、不用呼叫引擎。只有學生走了一步「所有已知正解線都
 * 沒預期到」的招，才會呼叫這支 API，讓引擎判斷「這步算不算數」。
 *
 * 判斷邏輯：從「學生走完、輪到電腦這方」的局面做一次搜尋。
 *   - mateIn 是負數：電腦這方不管怎麼防守都會被將死，代表學生這步
 *     仍然算數，回傳的 move 同時就是電腦最強防守，前端要用這步當
 *     電腦的回應。還要進一步檢查「將死還需要幾步」有沒有超過剩餘
 *     步數預算，超過預算一樣視為不算數（雖然理論上仍必勝，但不符合
 *     這題的步數限制）。
 *   - mateIn 是正數或 null：電腦守得住，學生這步讓必勝流失掉了，
 *     判定不算數（答錯）。
 *
 * 呼叫端（usePuzzleSolver.ts）一旦進入「偏離已知正解線」的狀態，
 * 之後每一步都要繼續呼叫這支 API 判斷，直到真的將死或超過步數
 * 預算為止——不是「判一次就結束」。
 */

import { NextResponse } from "next/server";
import { judgeDeviatedPuzzleMove } from "@/lib/engine/pikafishProcess";

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

  const { fen, sideToMove, remainingPlies } = body as Record<string, unknown>;

  if (typeof fen !== "string" || fen.trim().length === 0) {
    return NextResponse.json({ error: "缺少或格式錯誤的 fen 參數。" }, { status: 400 });
  }
  if (!isValidSideToMove(sideToMove)) {
    return NextResponse.json({ error: "sideToMove 必須是 \"w\" 或 \"b\"。" }, { status: 400 });
  }
  if (typeof remainingPlies !== "number" || remainingPlies < 0) {
    return NextResponse.json({ error: "remainingPlies 必須是不小於 0 的數字。" }, { status: 400 });
  }

  try {
    const result = await judgeDeviatedPuzzleMove(fen, sideToMove);

    if (result.mateIn === null || result.mateIn > 0) {
      // 電腦守得住（甚至反過來變優勢），學生這步不算數
      return NextResponse.json({ accepted: false });
    }

    const mateIn = Math.abs(result.mateIn);
    // 電腦這方（現在輪到走的這方）會在 mateIn 個自己的回合內被將死：
    // 從「現在」（電腦回合）起算，總共還需要的步數（雙方合計）=
    // 電腦走 mateIn 步 + 學生（將死方）也走 mateIn 步（最後一步就是
    // 將死），兩兩交錯，合計 2*mateIn 步。
    const pliesNeeded = mateIn * 2;

    if (pliesNeeded > remainingPlies) {
      // 理論上仍然必勝，但速度不符合這題的步數預算，一樣視為不算數
      return NextResponse.json({ accepted: false, tooSlow: true, mateIn, pliesNeeded });
    }

    return NextResponse.json({
      accepted: true,
      opponentMove: result.move,
      mateIn,
      pliesNeeded,
    });
  } catch (error) {
    console.error("[api/puzzle/judge-move] 判斷失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "判斷時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
