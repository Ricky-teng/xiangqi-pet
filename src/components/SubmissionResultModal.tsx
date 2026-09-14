/**
 * src/components/SubmissionResultModal.tsx
 *
 * 投稿審核結果通知彈窗
 * ------------------------------------------------------------
 * 學生下次開 App 時，把「已經審核完但還沒通知過」的投稿結果一次跳出
 * 來告知（通過的話同時顯示拿到多少飼料、題目叫什麼名字；駁回的話顯示
 * 老師寫的原因）。看完按「知道了」就呼叫 ack API 標記成已通知，之後
 * 不會再跳。
 *
 * 掛在 AuthProvider 裡，跟 <PetAlertBanner /> 同一層，所以不管學生
 * 從哪個頁面進 App 都會看到。
 *
 * 成本考量：這會在每次載入 App 時多一次 Firestore 查詢。為了不浪費，
 * 只有「學生」角色才查（老師不會有投稿），而且用 notifiedToStudent
 * == false 這個很窄的條件，撈到的通常是 0 筆。
 */

"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import type { PuzzleSubmissionDoc } from "@/types/database";

export default function SubmissionResultModal() {
  const uid = useGameStore((s) => s.user?.uid);
  const role = useGameStore((s) => s.user?.role);
  const [results, setResults] = useState<PuzzleSubmissionDoc[]>([]);
  const [isDismissing, setIsDismissing] = useState(false);

  useEffect(() => {
    if (!uid || role !== "student") return;
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "puzzleSubmissions"),
            where("studentUid", "==", uid),
            where("notifiedToStudent", "==", false)
          )
        );
        if (cancelled) return;
        setResults(snapshot.docs.map((d) => d.data() as PuzzleSubmissionDoc));
      } catch (error) {
        // 查不到就算了，這只是個通知，不該影響 App 其他功能
        console.error("[SubmissionResultModal] 載入審核結果失敗：", error);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [uid, role]);

  async function handleDismiss() {
    setIsDismissing(true);
    const ids = results.map((r) => r.id);
    // 先關掉彈窗讓學生不用等網路，標記失敗最壞情況就是下次再跳一次
    setResults([]);
    try {
      const token = await auth.currentUser?.getIdToken();
      await fetch("/api/puzzle/submissions/ack", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ submissionIds: ids }),
      });
    } catch (error) {
      console.error("[SubmissionResultModal] 標記已通知失敗：", error);
    } finally {
      setIsDismissing(false);
    }
  }

  if (results.length === 0) return null;

  const approvedCount = results.filter((r) => r.status === "approved").length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-xs rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">
        <p className="text-center text-3xl">{approvedCount > 0 ? "🎉📮" : "📮"}</p>
        <h2 className="mt-2 text-center text-base font-extrabold text-[#1A1A2E]">投稿審核結果</h2>

        <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
          {results.map((result) => (
            <div
              key={result.id}
              className={[
                "rounded-2xl px-3 py-2 text-xs",
                result.status === "approved" ? "bg-[#5B8C5A]/15" : "bg-[#1A1A2E]/5",
              ].join(" ")}
            >
              {result.status === "approved" ? (
                <>
                  <p className="font-extrabold text-[#5B8C5A]">
                    ✅ 通過了！你的題目「{result.createdPuzzleTitle ?? result.studentName}」
                    已經發布給全班挑戰！
                  </p>
                  <p className="mt-1 font-bold text-[#5C3D0A]">
                    🌾 獲得 {result.awardedFood} 飼料獎勵
                  </p>
                </>
              ) : (
                <>
                  <p className="font-extrabold text-[#1A1A2E]/70">這次沒有被採用</p>
                  {result.rejectReason ? (
                    <p className="mt-1 text-[#1A1A2E]/60">老師的建議：{result.rejectReason}</p>
                  ) : null}
                  <p className="mt-1 text-[#1A1A2E]/50">再去找找看更精彩的局面吧！</p>
                </>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          disabled={isDismissing}
          className="mt-4 w-full rounded-2xl bg-[#E8B84B] px-4 py-2.5 text-sm font-bold text-[#5C3D0A] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
