/**
 * src/components/CheckinModal.tsx
 *
 * 每日簽到彈框：進大廳時自動跳出，含最近 5 週的簽到月曆。
 * 父元件（page.tsx）只需要：
 *   const [showCheckin, setShowCheckin] = useState(false);
 *   // 首頁 useEffect 判斷今天沒簽到就 setShowCheckin(true)
 *   <CheckinModal open={showCheckin} onClose={() => setShowCheckin(false)} />
 */

"use client";

import { useState } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { getTodayDateString, getTodaysCompletedTaskIds } from "@/lib/tasks/dailyTasks";
import type { DailyTaskDoc } from "@/types/database";

interface CheckinModalProps {
  open: boolean;
  onClose: () => void;
  /** 所有啟用中的簽到類型任務（用來一起標記完成 + 給飼料） */
  checkinTasks?: DailyTaskDoc[];
}

/** 產生最近 5 週（35 天）的日期字串陣列，最舊的在最前 */
function getRecentDates(weeksBack = 5): string[] {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 34; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
  }
  return dates;
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export function CheckinModal({ open, onClose, checkinTasks = [] }: CheckinModalProps) {
  const user = useGameStore((s) => s.user);
  const checkin = useGameStore((s) => s.checkin);
  const [done, setDone] = useState(false);

  if (!open || !user) return null;

  const today = getTodayDateString();
  const history = new Set(user.checkinHistory ?? []);
  const alreadyCheckedIn = history.has(today);
  const completedToday = getTodaysCompletedTaskIds(user);
  const dates = getRecentDates();

  const firstDate = new Date(dates[0] + "T00:00:00");
  const startDow = firstDate.getDay();
  const emptySlots = startDow;

  // 今天還沒完成的簽到任務（簽到後要給飼料的）
  const pendingCheckinTasks = checkinTasks.filter((t) => !completedToday.includes(t.id));
  const totalRewardFood = pendingCheckinTasks.reduce((sum, t) => sum + t.rewardFood, 0);

  function handleCheckin() {
    if (!user) return;
    const taskIds = checkinTasks.map((t) => t.id);
    const taskRewards = pendingCheckinTasks.map((t) => t.rewardFood);
    // store 的 checkin() 現在同時處理：標記任務完成 + 發飼料 + 寫 Firestore
    const result = checkin(taskIds, taskRewards);
    if (result.success) setDone(true);
  }

  // 連續簽到天數
  let streak = 0;
  const d = new Date();
  while (true) {
    const str = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (history.has(str)) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">

        {done ? (
          /* ---- 簽到成功畫面 ---- */
          <div className="flex flex-col items-center py-4 text-center">
            <div className="text-6xl animate-bounce">🎉</div>
            <p className="mt-4 text-xl font-extrabold text-[#1A1A2E]">簽到成功！</p>
            <p className="mt-1 text-sm text-[#1A1A2E]/60">
              {/* streak 是用「簽到成功後」最新的 checkinHistory 算出來的，
                  今天已經算在裡面了，這裡直接顯示 streak 就好，
                  不能再 +1（+1 會多算一天，是之前的 bug）。 */}
              連續簽到 <span className="font-extrabold text-[#E8B84B]">{streak}</span> 天
            </p>
            {totalRewardFood > 0 ? (
              <div className="mt-5 flex items-center gap-2 rounded-2xl bg-[#E8B84B]/20 px-6 py-4">
                <span className="text-3xl">🟪</span>
                <span className="text-2xl font-extrabold text-[#5C3D0A]">+{totalRewardFood} 飼料</span>
              </div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="mt-6 w-full rounded-2xl bg-[#E8B84B] px-4 py-3 text-base font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
            >
              太好了！
            </button>
          </div>
        ) : (
          /* ---- 一般簽到畫面 ---- */
          <>
            {/* 標題 */}
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-[#1A1A2E]">📅 每日簽到</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#1A1A2E]/10 px-2.5 py-1 text-xs font-bold text-[#1A1A2E]/60 transition-transform active:scale-95"
              >
                ✕
              </button>
            </div>

            {/* 連續天數 */}
            <p className="mt-1 text-xs text-[#1A1A2E]/50">
              連續簽到 <span className="font-extrabold text-[#E8B84B]">{streak}</span> 天
            </p>

            {/* 最近 5 週月曆 */}
            <div className="mt-4">
              <div className="grid grid-cols-7 gap-1 text-center">
                {WEEKDAY_LABELS.map((l) => (
                  <div key={l} className="text-[10px] font-semibold text-[#1A1A2E]/40">{l}</div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {Array.from({ length: emptySlots }).map((_, i) => (
                  <div key={`empty-${i}`} />
                ))}
                {dates.map((dateStr) => {
                  const isToday = dateStr === today;
                  const checked = history.has(dateStr);
                  const dayNum = parseInt(dateStr.slice(8));
                  return (
                    <div
                      key={dateStr}
                      className={[
                        "flex h-8 w-full items-center justify-center rounded-lg text-xs font-bold",
                        checked
                          ? "bg-[#E8B84B] text-[#5C3D0A]"
                          : isToday
                            ? "bg-[#1A1A2E]/10 text-[#1A1A2E]"
                            : "text-[#1A1A2E]/30",
                      ].join(" ")}
                    >
                      {checked ? "✓" : dayNum}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 簽到按鈕 */}
            <div className="mt-5">
              {alreadyCheckedIn ? (
                <p className="mb-3 rounded-xl bg-[#1A1A2E]/5 px-3 py-2 text-center text-xs font-semibold text-[#1A1A2E]/50">
                  今天已經簽到了，明天再來！
                </p>
              ) : totalRewardFood > 0 ? (
                <p className="mb-3 text-center text-xs font-semibold text-[#8B5FBF]">
                  簽到獎勵：+{totalRewardFood} 飼料
                </p>
              ) : null}
              <button
                type="button"
                onClick={alreadyCheckedIn ? onClose : handleCheckin}
                className={[
                  "w-full rounded-2xl px-4 py-3 text-base font-extrabold shadow-md transition-transform active:scale-95",
                  alreadyCheckedIn
                    ? "bg-[#1A1A2E]/20 text-[#1A1A2E]/40"
                    : "bg-[#E8B84B] text-[#5C3D0A]",
                ].join(" ")}
              >
                {alreadyCheckedIn ? "已簽到" : "✅ 簽到"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
