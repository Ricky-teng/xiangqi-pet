/**
 * src/app/leaderboard/page.tsx
 *
 * 學生排行榜
 * ------------------------------------------------------------
 * 提供三種排行依據（解題數／棋藝等級／轉生次數），讓不同強項的
 * 學生都有機會看到自己名次靠前，增加好勝心跟回頭率，不是只比
 * 單一指標。目前使用者的那一列會特別標示出來，即使沒有排進
 * 列表可視範圍，也會在底下另外顯示「你的名次」。
 *
 * 資料來源：一次性 getDocs 撈 users 集合篩 role === "student"，
 * 跟老師監控後台用的是同一份查詢方式。
 *
 * 權限需求（Firestore 安全規則）：
 *   這個頁面需要「任何登入的人都可以讀取 users 集合」，不只是
 *   老師。原本的規則只讓老師讀別人的 users 文件，學生只能讀自己
 *   的——排行榜這個功能本質上就是要讓學生互相看到對方的公開數據，
 *   所以這裡的規則取捨是刻意放寬 users 集合的讀取權限給所有登入
 *   使用者（但 write 仍然只能寫自己），完整規則內容見對話裡的說明。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import type { UserDoc } from "@/types/database";
import { useAppBackground } from "@/lib/useAppBackground";

type FetchStatus = "loading" | "success" | "error";
type SortKey = "totalSolved" | "chessLevel" | "rebirthCount" | "vsComputerWinRate" | "battleWinRate";

interface SortOption {
  key: SortKey;
  label: string;
  icon: string;
  unit: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: "totalSolved",       label: "解題數",     icon: "🧩", unit: "題" },
  { key: "chessLevel",        label: "棋藝等級",   icon: "♟️", unit: "級" },
  { key: "rebirthCount",      label: "轉生次數",   icon: "✨", unit: "次" },
  { key: "vsComputerWinRate", label: "對電腦勝率", icon: "🤖", unit: "%" },
  { key: "battleWinRate",     label: "對戰勝率",   icon: "⚔️", unit: "%" },
];

const RANK_MEDAL: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

/** 對電腦勝率：wins / (wins + losses + draws) */
function getVsComputerWinRate(s: UserDoc): number {
  const total = (s.stats.vsComputerWins ?? 0) + (s.stats.vsComputerLosses ?? 0) + (s.stats.vsComputerDraws ?? 0);
  return total > 0 ? Math.round(((s.stats.vsComputerWins ?? 0) / total) * 100) : 0;
}

/** 殘局對戰勝率：wins / (wins + losses + draws) */
function getBattleWinRate(s: UserDoc): number {
  const total = (s.stats.battleWins ?? 0) + (s.stats.battleLosses ?? 0) + (s.stats.battleDraws ?? 0);
  return total > 0 ? Math.round(((s.stats.battleWins ?? 0) / total) * 100) : 0;
}

function getSortValue(student: UserDoc, key: SortKey): number {
  switch (key) {
    case "totalSolved":       return student.stats.totalSolved;
    case "chessLevel":        return student.chessLevel;
    case "rebirthCount":      return student.rebirthCount;
    case "vsComputerWinRate": return getVsComputerWinRate(student);
    case "battleWinRate":     return getBattleWinRate(student);
  }
}

/** 顯示時補充局數說明，讓百分比更有意義 */
function getRateLabel(student: UserDoc, key: SortKey): string {
  switch (key) {
    case "vsComputerWinRate": {
      const total = (student.stats.vsComputerWins ?? 0) + (student.stats.vsComputerLosses ?? 0) + (student.stats.vsComputerDraws ?? 0);
      return total > 0 ? `${getVsComputerWinRate(student)}%（${total}局）` : "—";
    }
    case "battleWinRate": {
      const total = (student.stats.battleWins ?? 0) + (student.stats.battleLosses ?? 0) + (student.stats.battleDraws ?? 0);
      return total > 0 ? `${getBattleWinRate(student)}%（${total}場）` : "—";
    }
    default: return `${getSortValue(student, key)}`;
  }
}

function LeaderboardContent() {
  const router = useRouter();

  const bgStyle = useAppBackground();
  const currentUser = useGameStore((s) => s.user);

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [students, setStudents] = useState<UserDoc[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("totalSolved");

  useEffect(() => {
    let isCancelled = false;

    async function fetchStudents() {
      setStatus("loading");
      setErrorMessage(null);
      try {
        const snapshot = await getDocs(
          query(collection(db, "users"), where("role", "==", "student"))
        );
        if (isCancelled) return;
        setStudents(snapshot.docs.map((docSnapshot) => docSnapshot.data() as UserDoc));
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[leaderboard] 讀取排行榜失敗：", error);
        setErrorMessage(
          error instanceof Error ? error.message : "讀取排行榜時發生未知錯誤，請稍後再試。"
        );
        setStatus("error");
      }
    }

    fetchStudents();

    return () => {
      isCancelled = true;
    };
  }, []);

  const sortedStudents = [...students].sort(
    (a, b) => getSortValue(b, sortKey) - getSortValue(a, sortKey)
  );

  const currentUserRank = currentUser
    ? sortedStudents.findIndex((student) => student.uid === currentUser.uid) + 1
    : 0;
  const isCurrentUserVisible = currentUserRank > 0 && currentUserRank <= 10;

  const activeSortOption = SORT_OPTIONS.find((option) => option.key === sortKey) ?? SORT_OPTIONS[0];

  return (
    <main className="min-h-screenpb-10" style={bgStyle}>
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
          <h1 className="text-base font-bold text-[#1A1A2E]">🏆 學生排行榜</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {/* 排行依據切換 */}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSortKey(option.key)}
              className={[
"flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-center transition-transform active:scale-95",
                sortKey === option.key ? "bg-[#E8B84B] text-[#1A1A2E]" : "bg-white/60 text-[#1A1A2E]/60",
              ].join(" ")}
            >
              <span className="text-base" aria-hidden="true">
                {option.icon}
              </span>
              <span className="text-[10px] font-bold">{option.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-center text-sm text-[#1A1A2E]/60">排行榜載入中…</p>
          ) : status === "error" ? (
            <div className="rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
              {errorMessage ?? "讀取失敗，請稍後再試。"}
            </div>
          ) : sortedStudents.length === 0 ? (
            <div className="rounded-2xl bg-white/60 px-4 py-8 text-center text-sm text-[#1A1A2E]/60">
              目前還沒有任何學生資料。
            </div>
          ) : (
            <>
              <ol className="flex flex-col gap-2">
                {sortedStudents.slice(0, 10).map((student, index) => {
                  const rank = index + 1;
                  const isCurrentUser = currentUser?.uid === student.uid;
                  return (
                    <li
                      key={student.uid}
                      className={[
"flex items-center justify-between gap-3 rounded-2xl px-4 py-3 shadow-sm",
                        isCurrentUser ? "bg-[#FCE6A0] ring-2 ring-[#E8B84B]" : "bg-white/70",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-7 text-center text-base font-extrabold text-[#1A1A2E]/70">
                          {RANK_MEDAL[rank] ?? rank}
                        </span>
                        <span className="text-sm font-bold text-[#1A1A2E]">
                          {student.displayName}
                          {isCurrentUser ? <span className="ml-1 text-[#C0392B]">（你）</span> : null}
                        </span>
                      </div>
                      <span className="text-sm font-extrabold text-[#5C3D0A] tabular-nums">
                        {["vsComputerWinRate","battleWinRate"].includes(sortKey)
                          ? getRateLabel(student, sortKey)
                          : `${getSortValue(student, sortKey)}${activeSortOption.unit}`}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* 如果使用者不在前 10 名可視範圍內，額外顯示他自己的名次 */}
              {currentUser && currentUserRank > 0 && !isCurrentUserVisible ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-[#FCE6A0] px-4 py-3 shadow-sm ring-2 ring-[#E8B84B]">
                  <div className="flex items-center gap-3">
                    <span className="w-7 text-center text-base font-extrabold text-[#1A1A2E]/70">
                      {currentUserRank}
                    </span>
                    <span className="text-sm font-bold text-[#1A1A2E]">
                      {currentUser.displayName}
                      <span className="ml-1 text-[#C0392B]">（你）</span>
                    </span>
                  </div>
                  <span className="text-sm font-extrabold text-[#5C3D0A] tabular-nums">
                    {["vsComputerWinRate","battleWinRate"].includes(sortKey)
                      ? getRateLabel(currentUser, sortKey)
                      : `${getSortValue(currentUser, sortKey)}${activeSortOption.unit}`}
                  </span>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default function LeaderboardPage() {
  return (
    <RequireAuth>
      <LeaderboardContent />
    </RequireAuth>
  );
}
