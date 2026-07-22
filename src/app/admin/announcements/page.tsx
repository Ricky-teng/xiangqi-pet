/**
 * src/app/admin/announcements/page.tsx
 *
 * 老師管理公告後台
 * ------------------------------------------------------------
 * 公告存在 Firestore 的 announcements collection（AnnouncementDoc），
 * 這個頁面讓老師新增/編輯/刪除公告，可以選填一張圖片（瀏覽器端壓縮成
 * base64 JPEG 直接存進文件本身，見 @/lib/image/compressImage.ts 的
 * 說明——這個專案沒有另外設定 Firebase Storage）。
 *
 * 版面跟 /admin/tasks（每日任務後台）走同一套版面：上方表單建立/編輯，
 * 下方列出現有公告 + 操作按鈕。
 */

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import type { AnnouncementDoc } from "@/types/database";
import { compressImageToDataUrl } from "@/lib/image/compressImage";

type FetchStatus = "loading" | "success" | "error";

const INPUT_CLASS_NAME =
  "w-full rounded-xl bg-white/80 px-3 py-2 text-sm text-[#1A1A2E] ring-1 ring-inset ring-[#A9764C]/30 placeholder:text-[#1A1A2E]/30 focus:outline-none focus:ring-2 focus:ring-[#E8B84B] disabled:opacity-60";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#1A1A2E]/70">{label}</span>
      {children}
    </label>
  );
}

function AdminAnnouncementsContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- 公告列表 ----
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);
  const [announcements, setAnnouncements] = useState<AnnouncementDoc[]>([]);

  // ---- 表單欄位 ----
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // ---- 編輯模式：null 代表「建立新公告」，非 null 代表「正在編輯這則公告」 ----
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingOriginalMeta, setEditingOriginalMeta] = useState<{
    authorUid: string;
    authorName: string;
    createdAt: number;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ---- 刪除二段式確認 ----
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnouncements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  async function fetchAnnouncements() {
    setStatus("loading");
    setFetchErrorMessage(null);
    try {
      const snapshot = await getDocs(collection(db, "announcements"));
      const list = snapshot.docs
        .map((docSnapshot) => docSnapshot.data() as AnnouncementDoc)
        .sort((a, b) => b.createdAt - a.createdAt); // 最新的排最上面
      setAnnouncements(list);
      setStatus("success");
    } catch (error) {
      console.error("[admin/announcements] 讀取公告列表失敗：", error);
      setFetchErrorMessage(
        error instanceof Error ? error.message : "讀取公告列表時發生未知錯誤。"
      );
      setStatus("error");
    }
  }

  function resetFormToBlankState() {
    setTitle("");
    setContent("");
    setImageDataUrl(null);
    setImageError(null);
    setEditingId(null);
    setEditingOriginalMeta(null);
    setSaveError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleEditAnnouncement(announcement: AnnouncementDoc) {
    setTitle(announcement.title);
    setContent(announcement.content);
    setImageDataUrl(announcement.imageDataUrl ?? null);
    setImageError(null);
    setEditingId(announcement.id);
    setEditingOriginalMeta({
      authorUid: announcement.authorUid,
      authorName: announcement.authorName,
      createdAt: announcement.createdAt,
    });
    setSaveError(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handlePickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageError(null);
    setIsCompressingImage(true);
    try {
      const compressed = await compressImageToDataUrl(file);
      setImageDataUrl(compressed);
    } catch (error) {
      console.error("[admin/announcements] 圖片壓縮失敗：", error);
      setImageError(error instanceof Error ? error.message : "圖片處理失敗，請換一張圖片試試。");
    } finally {
      setIsCompressingImage(false);
    }
  }

  function handleRemoveImage() {
    setImageDataUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSaveAnnouncement() {
    setSaveError(null);

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle) {
      setSaveError("請輸入公告標題。");
      return;
    }
    if (!trimmedContent) {
      setSaveError("請輸入公告內容。");
      return;
    }
    if (!user) {
      setSaveError("找不到目前登入的老師帳號資料，請重新登入後再試。");
      return;
    }

    const now = Date.now();
    const id = editingId ?? doc(collection(db, "announcements")).id;
    const authorUid = editingOriginalMeta?.authorUid ?? user.uid;
    const authorName = editingOriginalMeta?.authorName ?? user.displayName;
    const createdAt = editingOriginalMeta?.createdAt ?? now;

    const payload: AnnouncementDoc = {
      id,
      title: trimmedTitle,
      content: trimmedContent,
      imageDataUrl,
      authorUid,
      authorName,
      createdAt,
      updatedAt: now,
    };

    setIsSaving(true);
    try {
      await setDoc(doc(db, "announcements", id), payload);
      setToastMessage(editingId ? `公告「${trimmedTitle}」已更新！` : `公告「${trimmedTitle}」已發布！`);
      await fetchAnnouncements();
      resetFormToBlankState();
    } catch (error) {
      console.error("[admin/announcements] 儲存公告失敗：", error);
      setSaveError(error instanceof Error ? `儲存失敗：${error.message}` : "儲存時發生未知錯誤。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConfirmDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, "announcements", id));
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      setToastMessage("公告已刪除。");
      if (editingId === id) resetFormToBlankState();
    } catch (error) {
      console.error("[admin/announcements] 刪除公告失敗：", error);
      setToastMessage("刪除失敗，請稍後再試。");
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button type="button" onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95">
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📢 公告管理</h1>
          <span className="w-[52px]" aria-hidden="true" />
        </header>

        {toastMessage ? (
          <div className="mt-3 rounded-2xl bg-[#5B8C5A] px-4 py-2.5 text-center text-xs font-bold text-white shadow-md">
            {toastMessage}
          </div>
        ) : null}

        {/* ---- 建立/編輯表單 ---- */}
        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1A1A2E]">
              {editingId ? "✏️ 編輯公告" : "📢 發布新公告"}
            </h2>
            {editingId ? (
              <button type="button" onClick={resetFormToBlankState} className="text-xs font-bold text-[#1A1A2E]/60 hover:underline">
                ➕ 發布新公告
              </button>
            ) : null}
          </div>

          {editingId ? (
            <p className="mt-2 rounded-xl bg-[#8B5FBF]/10 px-3 py-2 text-xs font-medium text-[#8B5FBF]">
              ✏️ 正在編輯既有公告，儲存後會直接更新，學生看到的是最新版本。
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-3">
            <Field label="公告標題">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：這週六暫停上課"
                className={INPUT_CLASS_NAME}
              />
            </Field>

            <Field label="公告內容">
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="給學生看的公告內容，可以換行"
                rows={5}
                className={INPUT_CLASS_NAME}
              />
            </Field>

            <Field label="附圖（選填）">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePickImage}
                disabled={isCompressingImage}
                className="text-xs text-[#1A1A2E]/70 file:mr-3 file:rounded-lg file:border-0 file:bg-[#E8B84B] file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-[#5C3D0A]"
              />
              {isCompressingImage ? (
                <p className="text-xs text-[#8B5FBF]">圖片處理中…</p>
              ) : null}
              {imageError ? (
                <p className="text-xs text-[#C0392B]">{imageError}</p>
              ) : null}
              {imageDataUrl ? (
                <div className="relative mt-1 w-full overflow-hidden rounded-xl">
                  <img src={imageDataUrl} alt="公告附圖預覽" className="max-h-48 w-full object-cover" />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-xs font-bold text-white"
                  >
                    ✕ 移除
                  </button>
                </div>
              ) : null}
            </Field>
          </div>

          {saveError ? (
            <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">
              {saveError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSaveAnnouncement}
            disabled={isSaving || isCompressingImage}
            className="mt-4 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "儲存中…" : editingId ? "💾 更新公告" : "🚀 發布公告"}
          </button>
        </section>

        {/* ---- 現有公告列表 ---- */}
        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1A1A2E]">📋 現有公告</h2>
            <button type="button" onClick={fetchAnnouncements} className="text-xs font-bold text-[#1A1A2E]/60 hover:underline">
              🔄 重新整理
            </button>
          </div>

          <div className="mt-3">
            {status === "loading" ? (
              <p className="text-xs text-[#1A1A2E]/50">公告列表載入中…</p>
            ) : status === "error" ? (
              <p className="text-xs text-[#C0392B]">{fetchErrorMessage ?? "讀取公告列表失敗，請稍後再試。"}</p>
            ) : announcements.length === 0 ? (
              <p className="text-xs text-[#1A1A2E]/50">目前還沒有任何公告，在上方發布第一則公告吧。</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {announcements.map((announcement) => {
                  const isConfirming = confirmingDeleteId === announcement.id;
                  const isDeleting = deletingId === announcement.id;

                  return (
                    <li key={announcement.id} className="overflow-hidden rounded-2xl bg-white/80">
                      {announcement.imageDataUrl ? (
                        <img src={announcement.imageDataUrl} alt={announcement.title} className="h-24 w-full object-cover" />
                      ) : null}
                      <div className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-[#1A1A2E]">{announcement.title}</p>
                          <p className="truncate text-[11px] text-[#1A1A2E]/40">
                            {announcement.authorName} ・ {new Date(announcement.createdAt).toLocaleString("zh-TW")}
                            {" ・ "}👀 {(announcement.viewedByUids ?? []).length} 人已讀
                          </p>
                        </div>

                        {isConfirming ? (
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-xs font-bold text-[#C0392B]">確定刪除？</span>
                            <button
                              type="button"
                              onClick={() => handleConfirmDelete(announcement.id)}
                              disabled={isDeleting}
                              className="rounded-lg bg-[#C0392B] px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
                            >
                              {isDeleting ? "刪除中…" : "確定"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(null)}
                              disabled={isDeleting}
                              className="rounded-lg bg-white px-2 py-1 text-xs font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleEditAnnouncement(announcement)}
                              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#8B5FBF] ring-1 ring-inset ring-[#8B5FBF]/30 transition-transform active:scale-95"
                            >
                              ✏️ 編輯
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(announcement.id)}
                              className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function AdminAnnouncementsPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <AdminAnnouncementsContent />
    </RequireAuth>
  );
}
