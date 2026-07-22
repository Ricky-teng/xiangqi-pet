/**
 * src/app/announcements/page.tsx
 *
 * 學生端公告瀏覽頁面（唯讀）
 * ------------------------------------------------------------
 * 資料來源跟老師後台（/admin/announcements）完全一樣，這裡只讀不寫。
 * 進這個頁面時會把 user.lastSeenAnnouncementsAt 更新成現在時間，
 * 首頁「公告」入口的紅點就是拿這個時間戳跟最新公告的 createdAt 比較
 * （見 src/app/page.tsx 的 hasUnreadAnnouncement）。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import type { AnnouncementDoc } from "@/types/database";
import { useAppBackground } from "@/lib/useAppBackground";

type FetchStatus = "loading" | "success" | "error";

function AnnouncementsContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const bgStyle = useAppBackground();

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);

  useEffect(() => {
    let isCancelled = false;

    async function fetchAnnouncements() {
      setStatus("loading");
      try {
        const snapshot = await getDocs(collection(db, "announcements"));
        if (isCancelled) return;
        const list = snapshot.docs
          .map((docSnapshot) => docSnapshot.data() as AnnouncementDoc)
          .sort((a, b) => b.createdAt - a.createdAt);
        setAnnouncements(list);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[announcements] 讀取公告列表失敗：", error);
        setErrorMessage(error instanceof Error ? error.message : "讀取公告列表時發生未知錯誤。");
        setStatus("error");
      }
    }

    fetchAnnouncements();
    return () => {
      isCancelled = true;
    };
  }, []);

  // 進頁面就標記成「已讀」，首頁的紅點會消失。只在 user 存在、而且
  // 還沒標記過「現在這一刻」時寫一次，避免每次 re-render 都打一次 Firestore。
  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    setUser({ ...user, lastSeenAnnouncementsAt: now });
    updateDoc(doc(db, "users", user.uid), { lastSeenAnnouncementsAt: now }).catch((error) => {
      console.error("[announcements] 標記已讀失敗（不影響瀏覽公告）：", error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button type="button" onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95">
            ← 返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📢 公告</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-center text-xs text-[#1A1A2E]/50">公告載入中…</p>
          ) : status === "error" ? (
            <p className="text-center text-xs text-[#C0392B]">{errorMessage ?? "讀取公告失敗，請稍後再試。"}</p>
          ) : announcements.length === 0 ? (
            <p className="text-center text-xs text-[#1A1A2E]/50">目前還沒有任何公告。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {announcements.map((announcement) => (
                <article key={announcement.id} className="overflow-hidden rounded-3xl bg-white/70 shadow-sm">
                  {announcement.imageDataUrl ? (
                    <img
                      src={announcement.imageDataUrl}
                      alt={announcement.title}
                      className="max-h-64 w-full object-cover"
                    />
                  ) : null}
                  <div className="px-4 py-3">
                    <p className="text-sm font-extrabold text-[#1A1A2E]">{announcement.title}</p>
                    <p className="mt-0.5 text-[11px] text-[#1A1A2E]/40">
                      {announcement.authorName} ・ {new Date(announcement.createdAt).toLocaleString("zh-TW")}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-[#1A1A2E]/80">
                      {announcement.content}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function AnnouncementsPage() {
  return (
    <RequireAuth requiredRole="student">
      <AnnouncementsContent />
    </RequireAuth>
  );
}
