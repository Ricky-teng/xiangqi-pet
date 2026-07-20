/**
 * src/app/api/cron/reminders/route.ts
 *
 * 排程提醒：小雞餓了/生病了、每日任務還沒領。由 Vercel Cron 定時打
 * 這支 API（設定見專案根目錄 vercel.json），不是使用者觸發的。
 *
 * 安全性：這支 API 沒有登入狀態可以驗證（Cron 不是「使用者」），
 * 改用一個共用密鑰 CRON_SECRET，Vercel Cron 呼叫時會自動帶上
 * Authorization: Bearer <CRON_SECRET>（在 vercel.json 設定），這裡
 * 檢查密鑰是否吻合，防止外部亂打這支 API 濫發推播。
 *
 * 冷卻機制：每個使用者都有 lastPetReminderSentAt / lastTaskReminderSentAt，
 * 同一種提醒至少間隔 REMINDER_COOLDOWN_MS 才會再發一次，避免 Cron 每次
 * 執行都對同一批人重複轟炸。
 */

import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { sendPushToUser } from "@/lib/server/push";
import { FULLNESS_DECAY_PERCENT_PER_HOUR } from "@/lib/pet/petDecay";
import { getTodayDateString } from "@/lib/tasks/dailyTasks";

const REMINDER_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 同一種提醒至少間隔 12 小時
const HOUR_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getAdminDb();
  const now = Date.now();
  const today = getTodayDateString();

  let petReminders = 0;
  let taskReminders = 0;

  try {
    // ---- 1. 小雞餓了/生病了提醒 ----
    const petsSnap = await db.collection("pets").get();
    for (const petDoc of petsSnap.docs) {
      const pet = petDoc.data();
      const uid = petDoc.id;
      if (pet.healthStatus === "dead") continue;

      // 估算「現在」的飽食度（跟 petDecay.ts 同一套算法，但這裡不用真的寫回
      // pet 文件，只是為了判斷要不要提醒，所以就地算一次就好）
      const isProtected = !!pet.fullnessProtectionUntil && now < pet.fullnessProtectionUntil;
      const hoursSinceLastFed = (now - (pet.lastFedTime ?? now)) / HOUR_MS;
      const estimatedFullness = isProtected
        ? pet.fullness
        : Math.max(0, pet.fullness - hoursSinceLastFed * FULLNESS_DECAY_PERCENT_PER_HOUR);

      const needsReminder = estimatedFullness <= 20 || pet.healthStatus === "slightly_sick" || pet.healthStatus === "severely_sick";
      if (!needsReminder) continue;

      const userSnap = await db.collection("users").doc(uid).get();
      if (!userSnap.exists) continue;
      const user = userSnap.data()!;
      if (user.role !== "student") continue;

      const lastSent = user.lastPetReminderSentAt ?? 0;
      if (now - lastSent < REMINDER_COOLDOWN_MS) continue;

      const isSick = pet.healthStatus === "slightly_sick" || pet.healthStatus === "severely_sick";
      await sendPushToUser(uid, {
        title: isSick ? "🤒 小雞生病了" : "🍚 小雞肚子餓了",
        body: isSick ? "快回去照顧牠，別讓病情變嚴重了！" : "飽食度快見底了，記得回去餵飼料！",
        url: "/",
      });
      await db.collection("users").doc(uid).update({ lastPetReminderSentAt: now });
      petReminders++;
    }

    // ---- 2. 每日任務還沒領提醒 ----
    const usersSnap = await db.collection("users").where("role", "==", "student").get();
    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data();
      const uid = userDoc.id;

      const history: string[] = user.checkinHistory ?? [];
      const alreadyCheckedIn = history.includes(today);
      if (alreadyCheckedIn) continue; // 已經簽到/領過今天的任務就不用提醒

      const lastSent = user.lastTaskReminderSentAt ?? 0;
      if (now - lastSent < REMINDER_COOLDOWN_MS) continue;

      await sendPushToUser(uid, {
        title: "📋 今天的任務還沒領喔",
        body: "簽到跟每日任務都還沒完成，別忘記回來看看！",
        url: "/",
      });
      await db.collection("users").doc(uid).update({ lastTaskReminderSentAt: now });
      taskReminders++;
    }

    return NextResponse.json({ success: true, petReminders, taskReminders });
  } catch (error) {
    console.error("[api/cron/reminders] 失敗：", error);
    return NextResponse.json({ error: "排程提醒執行失敗。" }, { status: 500 });
  }
}
