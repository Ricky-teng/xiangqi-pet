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
import { getTodayDateString } from "@/lib/tasks/dailyTasks";

interface CheckinModalProps {
  open: boolean;
  onClose: () => void;
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

export function CheckinModal({ open, onClose }: CheckinModalProps) {
  const user = useGameStore((s) => s.user);
  const checkin = useGameStore((s) => s.checkin);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open || !user) return null;

  const today = getTodayDateString();
  const history = new Set(user.checkinHistory ?? []);
  const alreadyCheckedIn = history.has(today);
  const dates = getRecentDates();

  // 月曆起始要對齊星期幾，第一天是 dates[0]
  const firstDate = new Date(dates[0] + "T00:00:00");
  const startDow = firstDate.getDay(); // 0=日
  // 補空格讓第一格對齊
  const emptySlots = startDow;

  function handleCheckin() {
    const result = checkin();
    setMessage(result.message);
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
          {/* 星期標題 */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((l) => (
              <div key={l} className="text-[10px] font-semibold text-[#1A1A2E]/40">{l}</div>
            ))}
          </div>
          {/* 日期格 */}
          <div className="mt-1 grid grid-cols-7 gap-1">
            {/* 補空格對齊 */}
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
          {message ? (
            <p className="mb-2 rounded-xl bg-[#5B8C5A]/10 px-3 py-2 text-center text-xs font-semibold text-[#5B8C5A]">
              {message}
            </p>
          ) : null}
          <button
            type="button"
            onClick={alreadyCheckedIn || done ? onClose : handleCheckin}
            className={[
              "w-full rounded-2xl px-4 py-3 text-base font-extrabold text-white shadow-md transition-transform active:scale-95",
              alreadyCheckedIn || done ? "bg-[#1A1A2E]/40" : "bg-[#E8B84B] text-[#5C3D0A]",
            ].join(" ")}
          >
            {alreadyCheckedIn || done ? "今天已簽到 ✓" : "✅ 簽到"}
          </button>
        </div>
      </div>
    </div>
  );
}
