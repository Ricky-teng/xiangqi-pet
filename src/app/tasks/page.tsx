/**
 * src/app/tasks/page.tsx
 *
 * 每日任務頁面
 * ------------------------------------------------------------
 * 任務定義現在存在 Firestore 的 dailyTasks collection（老師透過
 * /admin/tasks 後台管理），這個頁面用 getDocs 篩 isActive == true
 * 動態抓出目前啟用中的任務列表，不再 import 寫死的陣列。
 * 已完成的顯示「已完成」灰階狀態，尚未完成的顯示「領取獎勵」按鈕。
 * 只有學生會用到（老師沒有飼料經濟系統），限定
 * requiredRole="student"，跟 /catalog 的做法一致。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { getTodaysCompletedTaskIds } from "@/lib/tasks/dailyTasks";
import type { DailyTaskDoc } from "@/types/database";

type FetchStatus = "loading" | "success" | "error";

function TasksContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const claimDailyTask = useGameStore((s) => s.claimDailyTask);

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<DailyTaskDoc[]>([]);

  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);
  const [taskMessage, setTaskMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchTasks() {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const snapshot = await getDocs(
          query(collection(db, "dailyTasks"), where("isActive", "==", true))
        );
        if (isCancelled) return;
        setTasks(snapshot.docs.map((docSnapshot) => docSnapshot.data() as DailyTaskDoc));
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[tasks] 讀取每日任務失敗：", error);
        setErrorMessage(
          error instanceof Error ? error.message : "讀取每日任務時發生未知錯誤，請稍後再試。"
        );
        setStatus("error");
      }
    }

    fetchTasks();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!user) {
    // RequireAuth 已經保證 user 存在，這裡純粹是型別防呆
    return null;
  }

  const completedToday = getTodaysCompletedTaskIds(user);

  function handleClaim(task: DailyTaskDoc) {
    setClaimingTaskId(task.id);
    const result = claimDailyTask(task);
    setTaskMessage(result.message);
    setClaimingTaskId(null);
  }

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📋 每日任務</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <p className="mt-3 text-center text-xs text-[#1A1A2E]/60">
          每天午夜（你所在時區的午夜）任務會重新整理，記得每天都來看看！
        </p>

        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-center text-sm text-[#1A1A2E]/60">任務載入中…</p>
          ) : status === "error" ? (
            <div className="rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
              {errorMessage ?? "讀取失敗，請稍後再試。"}
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-2xl bg-white/60 px-4 py-8 text-center text-sm text-[#1A1A2E]/60">
              目前還沒有任何啟用中的任務，問問老師有沒有開放新任務！
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {tasks.map((task) => {
                const isCompleted = completedToday.includes(task.id);
                const isClaiming = claimingTaskId === task.id;

                return (
                  <div
                    key={task.id}
                    className={[
                      "flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm",
                      isCompleted ? "bg-white/40" : "bg-white/80",
                    ].join(" ")}
                  >
                    <span
                      className={["text-3xl", isCompleted ? "opacity-40" : ""].join(" ")}
                      aria-hidden="true"
                    >
                      {task.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[#1A1A2E]">{task.title}</p>
                      <p className="text-xs text-[#1A1A2E]/60">{task.description}</p>
                      <p className="mt-0.5 text-xs font-semibold text-[#8B5FBF]">
                        +{task.rewardFood} 飼料
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleClaim(task)}
                      disabled={isCompleted || isClaiming}
                      className={[
                        "shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition-transform active:scale-95",
                        isCompleted
                          ? "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/40"
                          : "bg-[#E8B84B] text-[#1A1A2E]",
                      ].join(" ")}
                    >
                      {isCompleted ? "✅ 已完成" : isClaiming ? "領取中…" : "領取獎勵"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {taskMessage ? (
          <p className="mt-4 rounded-xl bg-white/80 px-3 py-2 text-center text-xs font-medium text-[#5B8C5A]">
            {taskMessage}
          </p>
        ) : null}
      </div>
    </main>
  );
}

export default function TasksPage() {
  return (
    <RequireAuth requiredRole="student">
      <TasksContent />
    </RequireAuth>
  );
}
