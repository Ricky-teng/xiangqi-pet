// src/components/SeasonRewardModal.tsx
"use client";

/**
 * 賽季獎勵通知彈窗
 * ------------------------------------------------------------
 * 賽季結算的 cron 在每月 1 號半夜跑完之後，會把飼料直接入帳，同時在
 * users/{uid}/pendingNotices 寫一筆通知。學生下次開 App 時這個元件
 * 讀到就跳彈窗，按「收下」之後把那筆通知刪掉。
 *
 * 飼料是「已經入帳」才通知，不是「按了才給」——學生忘記按、或是在
 * 彈窗跳出來之前就關掉 App，獎勵都不會不見。這個彈窗純粹是告知。
 *
 * 做法沿用投稿審核結果那一套（見 SubmissionResultModal）。
 */

import { useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { getSeasonLabel } from "@/lib/rpg/teamScore";
import type { SeasonRewardNoticeDoc } from "@/types/rpg";

export default function SeasonRewardModal() {
  const uid = useGameStore((s) => s.user?.uid);
  const role = useGameStore((s) => s.user?.role);
  const [notices, setNotices] = useState<SeasonRewardNoticeDoc[]>([]);

  useEffect(() => {
    if (!uid || role !== "student") return;
    let cancelled = false;

    async function load() {
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "users", uid!, "pendingNotices"),
            where("type", "==", "season_reward"),
          ),
        );
        if (cancelled) return;
        setNotices(snapshot.docs.map((d) => d.data() as SeasonRewardNoticeDoc));
      } catch (error) {
        // 讀不到就算了，這只是通知，不該擋住 App 其他功能
        console.error("[SeasonRewardModal] 載入賽季獎勵通知失敗：", error);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [uid, role]);

  if (notices.length === 0 || !uid) return null;
  const notice = notices[0];

  async function handleDismiss() {
    // 先關彈窗讓學生不用等網路；刪除失敗最壞的情況就是下次再跳一次
    setNotices((prev) => prev.slice(1));
    try {
      await deleteDoc(doc(db, "users", uid!, "pendingNotices", notice.id));
    } catch (error) {
      console.error("[SeasonRewardModal] 刪除通知失敗：", error);
    }
  }

  const improved =
    notice.previousRank !== null && notice.previousRank > notice.rank
      ? notice.previousRank - notice.rank
      : 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-sm rounded-3xl p-5 text-center shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #FDF6E8 0%, #F3E6CC 100%)",
          border: "2px solid #E8B84B",
          boxShadow: "inset 0 2px 10px rgba(92,61,10,0.18), 0 18px 40px rgba(0,0,0,0.45)",
          animation: "battle-result-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
        }}
      >
        <p className="text-3xl">
          {notice.rank === 1 ? "🥇" : notice.rank === 2 ? "🥈" : notice.rank === 3 ? "🥉" : "🏅"}
        </p>
        <h2 className="mt-1 text-lg font-extrabold text-[#1A1A2E]">賽季結算</h2>
        <p className="text-xs font-bold text-[#5C3D0A]/70">{getSeasonLabel(notice.seasonId)}</p>

        <div className="mt-4 rounded-2xl bg-white/75 px-4 py-3">
          <p className="text-[10px] font-bold text-[#1A1A2E]/45">最終名次</p>
          <p className="text-2xl font-extrabold text-[#1A1A2E]">第 {notice.rank} 名</p>
          {improved > 0 ? (
            <p className="mt-0.5 text-[11px] font-bold text-[#5B8C5A]">
              比上一季（第 {notice.previousRank} 名）進步了 {improved} 名 📈
            </p>
          ) : null}
        </div>

        <div className="mt-3 space-y-1.5">
          {notice.topReward > 0 ? (
            <p className="rounded-xl bg-[#E8B84B]/20 px-3 py-2 text-xs font-bold text-[#5C3D0A]">
              前三名獎勵 🌾 {notice.topReward}
            </p>
          ) : null}
          {notice.improvementReward > 0 ? (
            <p className="rounded-xl bg-[#5B8C5A]/15 px-3 py-2 text-xs font-bold text-[#3E6B3D]">
              進步獎 🌾 {notice.improvementReward}
            </p>
          ) : null}
        </div>

        <p className="mt-3 text-sm font-extrabold text-[#1A1A2E]">
          共獲得 🌾 {notice.totalReward} 飼料
        </p>
        <p className="mt-0.5 text-[10px] text-[#1A1A2E]/45">飼料已經直接入帳囉</p>

        <button
          type="button"
          onClick={handleDismiss}
          className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
        >
          收下
        </button>
      </div>
    </div>
  );
}
