/**
 * src/app/api/puzzle/verify-mate/route.ts
 *
 * 投稿局面的自動判斷：檢查「紅方」能不能在 N 步內強制將死。
 * ------------------------------------------------------------
 * 給 /admin/submissions 的老師審核頁用：
 *   - 找得到速勝 → 回傳所有找到的殺法線（用 MultiPV 一次撈多解），
 *                  老師按一下就自動填進主線答案欄跟其他解法欄
 *   - 找不到     → 告訴老師這個局面不適合當殘局題，建議駁回
 *
 * 為什麼固定用紅方：這個 App 的殘局題都是「學生執紅方解殺」的形式
 * （見 usePuzzleSolver 從 moves[0] 起點推斷先手方的邏輯），所以判斷
 * 基準就是紅方。如果局面其實是黑方佔優，那正好就是該駁回的局面。
 *
 * 權限：只有老師能呼叫——這支 API 會實際啟動 Pikafish 子程序，是很
 * 吃 CPU 的操作，開放給所有登入者等於開放一個消耗伺服器資源的管道。
 */

import { NextResponse } from "next/server";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { findMateSequence } from "@/lib/engine/pikafishProcess";

// 搜尋本身最多 6 秒，加上子程序啟動跟 NNUE 載入的開銷，抓 30 秒保險
export const maxDuration = 30;

/** 題目最多接受幾步殺（超過這個步數對小學生來說太長了） */
const MAX_MATE_IN = 10;

export async function POST(request: Request) {
  let uid: string;
  try {
    uid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const db = getAdminDb();
  const reviewerSnapshot = await db.collection("users").doc(uid).get();
  if (reviewerSnapshot.data()?.role !== "teacher") {
    return NextResponse.json({ error: "只有老師可以使用自動判斷。" }, { status: 403 });
  }

  let body: { fen?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const { fen } = body;
  if (typeof fen !== "string" || fen.trim() === "") {
    return NextResponse.json({ error: "缺少局面資料" }, { status: 400 });
  }

  try {
    const result = await findMateSequence(fen.trim(), "w", MAX_MATE_IN);

    if (result.hasMateButIncomplete) {
      return NextResponse.json({
        hasMate: true,
        mateIn: result.mateIn,
        lines: [],
        message: `偵測到 ${result.mateIn} 步殺，但引擎這次沒有回報完整的殺法序列，請再按一次，或自行填寫答案。`,
      });
    }

    if (!result.hasMate) {
      return NextResponse.json({
        hasMate: false,
        maxMateIn: MAX_MATE_IN,
        lines: [],
        // mateIn 是負數代表紅方反而會被將死，這個資訊對老師判斷有用
        beingMated: result.mateIn !== null && result.mateIn < 0,
        message:
          result.mateIn !== null && result.mateIn < 0
            ? `紅方在這個局面反而會被黑方在 ${Math.abs(result.mateIn)} 步內將死，不適合當殘局題，建議駁回。`
            : `紅方在 ${MAX_MATE_IN} 步內找不到強制勝，不適合當殘局題，建議駁回。`,
      });
    }

    const [mainLine, ...alternatives] = result.lines;
    const alternativeNote =
      alternatives.length > 0
        ? `，另外找到 ${alternatives.length} 種其他解法（${alternatives
            .map((l) => `${l.mateIn} 步`)
            .join("、")}）也一併填入`
        : "";

    return NextResponse.json({
      hasMate: true,
      mateIn: mainLine.mateIn,
      lines: result.lines,
      message: `✅ 紅方 ${mainLine.mateIn} 步殺，已自動填入主線答案（共 ${mainLine.moves.length} 個半步）${alternativeNote}。`,
    });
  } catch (error) {
    console.error("[api/puzzle/verify-mate] 分析失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分析時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
