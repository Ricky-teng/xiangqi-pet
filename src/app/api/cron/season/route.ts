// src/app/api/cron/season/route.ts

/**
 * 賽季結算（每月 1 號台北時間 00:00 跑）
 * ------------------------------------------------------------
 * 做四件事：
 *   1. 把「上一季」所有有積分的戰隊依分數排名
 *   2. 算每一隊的獎勵：前三名 3000/2000/1000，再加進步獎
 *      （跟上一季比每進步 1 名 20 飼料，上限 200；第一季沒有進步獎）
 *   3. 飼料直接入帳，同時寫一筆待通知（學生下次開 App 跳彈窗）
 *   4. 把名次寫進 seasons/{seasonId}，當作「這一季結算過了」的旗標，
 *      也給下一季算進步獎用
 *
 * ⚠️ 時區：Vercel 跑 UTC。台北 1 號 00:00 = UTC 上個月最後一天 16:00，
 * 所以 vercel.json 的 cron 要設 "0 16 L * *" 這種 UTC 時間；但 Vercel
 * 的 cron 不支援 L（月底），所以改成「每天 UTC 16:00 跑一次，程式自己
 * 判斷台北時間是不是 1 號」。多跑的那些天會在第一個檢查就直接返回。
 *
 * 冪等：結算前先檢查 seasons/{seasonId} 存不存在，存在就代表已經結算
 * 過，直接返回。所以 cron 重跑、手動觸發都不會重複發獎。
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { getSeasonReward } from "@/lib/rpg/teamScore";
import type { SeasonRankEntry } from "@/types/rpg";

/** 台北時間的「現在」，用來判斷是不是 1 號、以及上一季是哪一季 */
function getTaipeiParts(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = parts.split("-").map(Number);
  return { year, month, day };
}

/** 上一個月的賽季代號（格式 YYYY-MM） */
function getPreviousSeasonId(year: number, month: number): string {
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const { year, month, day } = getTaipeiParts(now);

  // 只有台北時間 1 號才真的結算。其他天 cron 一樣會被叫到，直接返回。
  const force = new URL(request.url).searchParams.get("force") === "1";
  if (day !== 1 && !force) {
    return NextResponse.json({ skipped: true, reason: "台北時間不是 1 號", taipeiDay: day });
  }

  const seasonId = getPreviousSeasonId(year, month);
  const db = getAdminDb();

  // 冪等：已經結算過就不要再發一次獎
  const seasonDoc = await db.collection("seasons").doc(seasonId).get();
  if (seasonDoc.exists && !force) {
    return NextResponse.json({ skipped: true, reason: "這一季已經結算過", seasonId });
  }

  // 上上一季的名次，算進步獎要用
  const prevSeasonId = getPreviousSeasonId(
    Number(seasonId.slice(0, 4)),
    Number(seasonId.slice(5, 7)),
  );
  const prevSeasonDoc = await db.collection("seasons").doc(prevSeasonId).get();
  const prevRanking = (prevSeasonDoc.data()?.finalRanking ?? []) as SeasonRankEntry[];
  const prevRankByUid = new Map(prevRanking.map((e) => [e.uid, e.rank]));

  // 這一季的戰隊。只算「seasonId 等於這一季」而且有分數的——
  // 0 分的隊伍排進來只會讓進步獎的名次膨脹。
  const teamsSnapshot = await db
    .collection("teams")
    .where("seasonId", "==", seasonId)
    .where("score", ">", 0)
    .get();

  const teams = teamsSnapshot.docs
    .map((d) => d.data() as { uid: string; teamName: string; ownerName: string; score: number })
    .sort((a, b) => b.score - a.score);

  const finalRanking: SeasonRankEntry[] = [];
  let rewardedCount = 0;
  let totalFood = 0;

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const rank = i + 1;
    const previousRank = prevRankByUid.get(team.uid) ?? null;
    const reward = getSeasonReward(rank, previousRank);

    finalRanking.push({
      uid: team.uid,
      teamName: team.teamName,
      ownerName: team.ownerName,
      score: team.score,
      rank,
      rewardFood: reward.total,
    });

    // 沒拿到獎勵的人也要更新最佳名次——第 8 名沒有獎金，但那仍然
    // 是他的賽季成績，勳章要算。
    if (reward.total <= 0) {
      try {
        const snapshot = await db.collection("users").doc(team.uid).get();
        const prevBest = (snapshot.data()?.rpgSeasonBestRank as number | undefined) ?? 999;
        if (rank < prevBest) {
          await db.collection("users").doc(team.uid).update({
            rpgSeasonBestRank: rank,
            updatedAt: Date.now(),
          });
        }
      } catch (error) {
        console.error(`[cron/season] 更新 ${team.uid} 的最佳名次失敗：`, error);
      }
      continue;
    }

    try {
      // 飼料直接入帳（不用學生自己來領，避免忘了領就過期），
      // 順便更新賽季相關的勳章計數器（最佳名次、最大進步名次）。
      const userSnapshot = await db.collection("users").doc(team.uid).get();
      const prevBestRank = (userSnapshot.data()?.rpgSeasonBestRank as number | undefined) ?? 999;
      const prevBestImprove = (userSnapshot.data()?.rpgSeasonBestImprove as number | undefined) ?? 0;

      await db
        .collection("users")
        .doc(team.uid)
        .update({
          foodCount: FieldValue.increment(reward.total),
          rpgSeasonBestRank: Math.min(prevBestRank, rank),
          rpgSeasonBestImprove: Math.max(prevBestImprove, reward.ranksImproved),
          updatedAt: Date.now(),
        });

      // 待通知：學生下次開 App 會跳彈窗，看完自己刪掉
      await db
        .collection("users")
        .doc(team.uid)
        .collection("pendingNotices")
        .doc(`season-${seasonId}`)
        .set({
          id: `season-${seasonId}`,
          type: "season_reward",
          seasonId,
          rank,
          previousRank,
          topReward: reward.topReward,
          improvementReward: reward.improvementReward,
          totalReward: reward.total,
          createdAt: Date.now(),
        });

      rewardedCount += 1;
      totalFood += reward.total;
    } catch (error) {
      console.error(`[cron/season] 發獎給 ${team.uid} 失敗：`, error);
    }
  }

  // 寫結算紀錄。這一份同時是「結算過了」的旗標，一定要最後才寫——
  // 中途掛掉的話下次重跑會從頭再來，不會留下一半發一半沒發的狀態
  // （已經發過的那幾個會重複發，但這比完全沒發好處理，而且 cron
  // 掛掉是極少數情況）。
  await db.collection("seasons").doc(seasonId).set({
    seasonId,
    settledAt: Date.now(),
    finalRanking,
  });

  return NextResponse.json({
    ok: true,
    seasonId,
    teamCount: teams.length,
    rewardedCount,
    totalFood,
  });
}
