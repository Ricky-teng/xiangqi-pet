/**
 * src/app/my-submissions/page.tsx
 *
 * 學生查看自己投稿的題目跟審核進度
 * ------------------------------------------------------------
 * 資料來源是 puzzleSubmissions，安全規則允許學生讀「自己的」那幾筆
 * （resource.data.studentUid == request.auth.uid），所以這頁用 client
 * SDK 直接查就好，不用另外開 API。
 *
 * 審核結果的「主動通知」是另一個機制（見 SubmissionResultModal，
 * 下次開 App 會跳彈窗）；這頁是讓學生隨時想看就能回來查的地方。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import { useAppBackground } from "@/lib/useAppBackground";
import { MAX_PENDING_SUBMISSIONS_PER_STUDENT } from "@/lib/puzzleSubmission";
import type { PuzzleSubmissionDoc } from "@/types/database";

function MySubmissionsContent() {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const uid = useGameStore((s) => s.user?.uid);

  const [submissions, setSubmissions] = useState<PuzzleSubmissionDoc[]>([]);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const snapshot = await getDocs(
          query(collection(db, "puzzleSubmissions"), where("studentUid", "==", uid))
        );
        if (cancelled) return;
        // 在前端排序（新的在前）而不是用 orderBy，可以少建一組複合索引
        const list = snapshot.docs
          .map((d) => d.data() as PuzzleSubmissionDoc)
          .sort((a, b) => b.submittedAt - a.submittedAt);
        setSubmissions(list);
        setStatus("success");
      } catch (error) {
        console.error("[my-submissions] 載入失敗：", error);
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const pendingCount = submissions.filter((s) => s.status === "pending").length;
  const approvedCount = submissions.filter((s) => s.status === "approved").length;
  const totalFood = submissions.reduce((sum, s) => sum + (s.awardedFood ?? 0), 0);

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📮 我的投稿</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <section className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white/80 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold text-[#1A1A2E]/50">已被採用</p>
            <p className="text-base font-extrabold text-[#5B8C5A]">{approvedCount}</p>
          </div>
          <div className="rounded-2xl bg-white/80 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold text-[#1A1A2E]/50">審核中</p>
            <p className="text-base font-extrabold text-[#1A1A2E]">
              {pendingCount}/{MAX_PENDING_SUBMISSIONS_PER_STUDENT}
            </p>
          </div>
          <div className="rounded-2xl bg-white/80 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold text-[#1A1A2E]/50">累計獎勵</p>
            <p className="text-base font-extrabold text-[#5C3D0A]">{totalFood}</p>
          </div>
        </section>

        <div className="mt-3 space-y-2">
          {status === "loading" ? (
            <p className="py-10 text-center text-xs text-[#1A1A2E]/50">載入中…</p>
          ) : status === "error" ? (
            <p className="py-10 text-center text-xs text-[#C0392B]">載入失敗，請稍後再試。</p>
          ) : submissions.length === 0 ? (
            <div className="rounded-3xl bg-white/80 px-5 py-8 text-center shadow-sm">
              <p className="text-3xl">📮</p>
              <p className="mt-2 text-sm font-bold text-[#1A1A2E]">還沒有投稿過</p>
              <p className="mt-1 text-xs text-[#1A1A2E]/60">
                去「最近對局」的回放頁面，挑一個你覺得精彩的局面投稿給老師，
                通過審核就能變成全班的題目，還能拿飼料獎勵！
              </p>
              <button
                type="button"
                onClick={() => router.push("/play")}
                className="mt-3 rounded-2xl bg-[#E8B84B] px-4 py-2 text-xs font-bold text-[#5C3D0A] shadow-sm transition-transform active:scale-95"
              >
                去對弈
              </button>
            </div>
          ) : (
            submissions.map((submission) => (
              <section key={submission.id} className="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-[10px] font-bold",
                      submission.status === "approved"
                        ? "bg-[#5B8C5A]/15 text-[#5B8C5A]"
                        : submission.status === "rejected"
                          ? "bg-[#C0392B]/10 text-[#C0392B]"
                          : "bg-[#E8B84B]/25 text-[#5C3D0A]",
                    ].join(" ")}
                  >
                    {submission.status === "approved"
                      ? "✅ 已採用"
                      : submission.status === "rejected"
                        ? "❌ 未採用"
                        : "⏳ 審核中"}
                  </span>
                  <span className="text-[10px] text-[#1A1A2E]/40">
                    {new Date(submission.submittedAt).toLocaleDateString("zh-TW")}
                  </span>
                </div>

                {submission.note ? (
                  <p className="mt-1.5 text-xs text-[#1A1A2E]/70">💬 {submission.note}</p>
                ) : null}

                {submission.status === "approved" ? (
                  <p className="mt-1.5 text-xs font-bold text-[#5B8C5A]">
                    題目「{submission.createdPuzzleTitle ?? submission.studentName}」已發布
                    ・獲得 {submission.awardedFood} 飼料 🌾
                  </p>
                ) : submission.status === "rejected" ? (
                  <p className="mt-1.5 text-xs text-[#1A1A2E]/60">
                    {submission.rejectReason
                      ? `老師的建議：${submission.rejectReason}`
                      : "這次沒有被採用，再去找找看更精彩的局面吧！"}
                  </p>
                ) : (
                  <p className="mt-1.5 text-xs text-[#1A1A2E]/50">老師還在審核中，請耐心等候～</p>
                )}
              </section>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

export default function MySubmissionsPage() {
  return (
    <RequireAuth requiredRole="student">
      <MySubmissionsContent />
    </RequireAuth>
  );
}
