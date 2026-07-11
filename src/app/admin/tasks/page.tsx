/**
 * src/app/admin/tasks/page.tsx
 *
 * 老師管理每日任務後台
 * ------------------------------------------------------------
 * 任務定義存在 Firestore 的 dailyTasks collection（DailyTaskDoc），
 * 這個頁面讓老師新增/編輯/停用（啟用）/刪除任務，不需要再讓開發者
 * 改程式碼才能調整任務內容。
 *
 * 版面跟 /admin（題目編輯後台）、/admin/dashboard 走同一套視覺語言：
 * 上方表單建立/編輯，下方列出現有任務 + 操作按鈕。
 */

"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import type { DailyTaskDoc } from "@/types/database";

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

function AdminTasksContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);

  // ---- 任務列表 ----
  const [status, setStatus] = useState<FetchStatus>("loading");
  const [fetchErrorMessage, setFetchErrorMessage] = useState<string | null>(null);
  const [tasks, setTasks] = useState<DailyTaskDoc[]>([]);

  // ---- 表單欄位 ----
  const [taskId, setTaskId] = useState("");
  const [taskType, setTaskType] = useState<"checkin" | "vs_computer">("checkin");
  const [requiredCount, setRequiredCount] = useState(1);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📅");
  const [rewardFood, setRewardFood] = useState(50);

  // ---- 編輯模式：null 代表「建立新任務」，非 null 代表「正在編輯這個任務」 ----
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingOriginalMeta, setEditingOriginalMeta] = useState<{
    createdBy: string;
    createdAt: number;
  } | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // ---- 刪除二段式確認 ----
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  async function fetchTasks() {
    setStatus("loading");
    setFetchErrorMessage(null);
    try {
      const snapshot = await getDocs(collection(db, "dailyTasks"));
      const list = snapshot.docs
        .map((docSnapshot) => docSnapshot.data() as DailyTaskDoc)
        .sort((a, b) => a.createdAt - b.createdAt);
      setTasks(list);
      setStatus("success");
    } catch (error) {
      console.error("[admin/tasks] 讀取任務列表失敗：", error);
      setFetchErrorMessage(
        error instanceof Error ? error.message : "讀取任務列表時發生未知錯誤。"
      );
      setStatus("error");
    }
  }

  function resetFormToBlankState() {
    setTaskId("");
    setTaskType("checkin");
    setRequiredCount(1);
    setTitle("");
    setDescription("");
    setIcon("📅");
    setRewardFood(50);
    setEditingTaskId(null);
    setEditingOriginalMeta(null);
    setSaveError(null);
  }

  function handleEditTask(task: DailyTaskDoc) {
    setTaskId(task.id);
    setTaskType(task.taskType ?? "checkin");
    setRequiredCount(task.requiredCount ?? 1);
    setTitle(task.title);
    setDescription(task.description);
    setIcon(task.icon);
    setRewardFood(task.rewardFood);
    setEditingTaskId(task.id);
    setEditingOriginalMeta({ createdBy: task.createdBy, createdAt: task.createdAt });
    setSaveError(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleSaveTask() {
    setSaveError(null);

    const trimmedId = taskId.trim();
    const trimmedTitle = title.trim();
    const trimmedIcon = icon.trim();

    if (!trimmedId) {
      setSaveError("請輸入任務 ID。");
      return;
    }
    if (trimmedId.includes("/")) {
      setSaveError("任務 ID 不可包含「/」符號（Firestore 文件路徑限制）。");
      return;
    }
    if (!trimmedTitle) {
      setSaveError("請輸入任務名稱。");
      return;
    }
    if (!trimmedIcon) {
      setSaveError("請輸入一個 emoji 當作任務圖示。");
      return;
    }
    if (!Number.isFinite(rewardFood) || rewardFood <= 0) {
      setSaveError("獎勵飼料數量請輸入大於 0 的數字。");
      return;
    }
    if (!user) {
      setSaveError("找不到目前登入的老師帳號資料，請重新登入後再試。");
      return;
    }

    const now = Date.now();
    const createdBy = editingOriginalMeta?.createdBy ?? user.uid;
    const createdAt = editingOriginalMeta?.createdAt ?? now;
    // 編輯既有任務時保留原本的 isActive 狀態（用「啟用/停用」按鈕單獨控制，
    // 不要被「更新任務」這個操作意外改動）；建立新任務預設為啟用。
    const existingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) : null;
    const isActive = existingTask?.isActive ?? true;

    const payload: DailyTaskDoc = {
      id: trimmedId,
      taskType,
      requiredCount: taskType === "vs_computer" ? requiredCount : 1,
      title: trimmedTitle,
      description: description.trim(),
      icon: trimmedIcon,
      rewardFood,
      isActive,
      createdBy,
      createdAt,
      updatedAt: now,
    };

    setIsSaving(true);
    try {
      await setDoc(doc(db, "dailyTasks", trimmedId), payload);
      setToastMessage(
        editingTaskId ? `任務「${trimmedTitle}」已更新！` : `任務「${trimmedTitle}」已建立！`
      );
      await fetchTasks();
      if (!editingTaskId) {
        resetFormToBlankState();
      } else {
        setEditingOriginalMeta({ createdBy, createdAt });
      }
    } catch (error) {
      console.error("[admin/tasks] 儲存任務失敗：", error);
      setSaveError(error instanceof Error ? `儲存失敗：${error.message}` : "儲存時發生未知錯誤。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleToggleActive(task: DailyTaskDoc) {
    try {
      await updateDoc(doc(db, "dailyTasks", task.id), {
        isActive: !task.isActive,
        updatedAt: Date.now(),
      });
      setTasks((prev) =>
        prev.map((existing) =>
          existing.id === task.id ? { ...existing, isActive: !existing.isActive } : existing
        )
      );
    } catch (error) {
      console.error("[admin/tasks] 切換啟用狀態失敗：", error);
      setToastMessage("切換啟用狀態失敗，請稍後再試。");
    }
  }

  async function handleConfirmDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, "dailyTasks", id));
      setTasks((prev) => prev.filter((task) => task.id !== id));
      if (editingTaskId === id) {
        resetFormToBlankState();
      }
    } catch (error) {
      console.error("[admin/tasks] 刪除任務失敗：", error);
      setToastMessage("刪除失敗，請稍後再試。");
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-16">
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📋 每日任務管理</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {toastMessage ? (
          <div className="mt-3 rounded-xl bg-[#5B8C5A]/10 px-4 py-2 text-center text-sm font-semibold text-[#5B8C5A]">
            {toastMessage}
          </div>
        ) : null}

        {/* ---- 建立/編輯表單 ---- */}
        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1A1A2E]">
              {editingTaskId ? "✏️ 編輯任務" : "➕ 建立新任務"}
            </h2>
            {editingTaskId ? (
              <button
                type="button"
                onClick={resetFormToBlankState}
                className="text-xs font-bold text-[#1A1A2E]/60 hover:underline"
              >
                ➕ 建立新任務
              </button>
            ) : null}
          </div>

          {editingTaskId ? (
            <p className="mt-2 rounded-xl bg-[#8B5FBF]/10 px-3 py-2 text-xs font-medium text-[#8B5FBF]">
              ✏️ 正在編輯既有任務「{editingTaskId}」，任務 ID 不能修改。
            </p>
          ) : null}

          <div className="mt-3 flex flex-col gap-3">
            <Field label="任務類型">
              <select
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as "checkin" | "vs_computer")}
                disabled={editingTaskId !== null}
                className={INPUT_CLASS_NAME}
              >
                <option value="checkin">📅 每日簽到</option>
                <option value="vs_computer">🤖 對弈電腦</option>
              </select>
            </Field>

            {taskType === "vs_computer" ? (
              <Field label="需要對弈幾局">
                <input
                  type="number"
                  min={1}
                  value={requiredCount}
                  onChange={(e) => setRequiredCount(Number(e.target.value))}
                  className={INPUT_CLASS_NAME}
                />
              </Field>
            ) : null}

            <Field label="任務 ID（將作為 Firestore 文件 ID：dailyTasks/{id}）">
              <input
                type="text"
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                placeholder="例如：daily_checkin"
                disabled={editingTaskId !== null}
                className={INPUT_CLASS_NAME}
              />
            </Field>

            <Field label="任務名稱">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：每日簽到"
                className={INPUT_CLASS_NAME}
              />
            </Field>

            <Field label="任務說明">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="給學生看的任務說明文字"
                rows={2}
                className={INPUT_CLASS_NAME}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="圖示（直接輸入一個 emoji）">
                <input
                  type="text"
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  placeholder="📅"
                  className={INPUT_CLASS_NAME}
                />
              </Field>
              <Field label="獎勵飼料數量">
                <input
                  type="number"
                  min={1}
                  value={rewardFood}
                  onChange={(event) => setRewardFood(Number(event.target.value))}
                  className={INPUT_CLASS_NAME}
                />
              </Field>
            </div>
          </div>

          {saveError ? (
            <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">
              {saveError}
            </p>
          ) : null}

          <button
            type="button"
            onClick={handleSaveTask}
            disabled={isSaving}
            className="mt-4 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "儲存中…" : editingTaskId ? "💾 更新任務" : "🚀 建立任務"}
          </button>
        </section>

        {/* ---- 現有任務列表 ---- */}
        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#1A1A2E]">📋 現有任務</h2>
            <button
              type="button"
              onClick={fetchTasks}
              className="text-xs font-bold text-[#1A1A2E]/60 hover:underline"
            >
              🔄 重新整理
            </button>
          </div>

          <div className="mt-3">
            {status === "loading" ? (
              <p className="text-xs text-[#1A1A2E]/50">任務列表載入中…</p>
            ) : status === "error" ? (
              <p className="text-xs text-[#C0392B]">
                {fetchErrorMessage ?? "讀取任務列表失敗，請稍後再試。"}
              </p>
            ) : tasks.length === 0 ? (
              <p className="text-xs text-[#1A1A2E]/50">目前還沒有任何任務，在上方建立第一個任務吧。</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {tasks.map((task) => {
                  const isConfirming = confirmingDeleteId === task.id;
                  const isDeleting = deletingId === task.id;

                  return (
                    <li
                      key={task.id}
                      className={[
                        "flex items-center justify-between gap-3 rounded-2xl px-3 py-2",
                        task.isActive ? "bg-white/80" : "bg-white/40",
                      ].join(" ")}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="text-2xl" aria-hidden="true">
                          {task.icon}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#1A1A2E]">
                            {task.title}
                            <span className="ml-1 text-xs font-normal text-[#1A1A2E]/50">
                              (+{task.rewardFood} 飼料 ・ {task.isActive ? "啟用中" : "已停用"})
                            </span>
                          </p>
                          <p className="truncate text-[11px] text-[#1A1A2E]/40">ID: {task.id}</p>
                        </div>
                      </div>

                      {isConfirming ? (
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs font-bold text-[#C0392B]">確定刪除？</span>
                          <button
                            type="button"
                            onClick={() => handleConfirmDelete(task.id)}
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
                            onClick={() => handleToggleActive(task)}
                            className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#5B8C5A] ring-1 ring-inset ring-[#5B8C5A]/30 transition-transform active:scale-95"
                          >
                            {task.isActive ? "⏸ 停用" : "▶️ 啟用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditTask(task)}
                            className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#8B5FBF] ring-1 ring-inset ring-[#8B5FBF]/30 transition-transform active:scale-95"
                          >
                            ✏️ 編輯
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(task.id)}
                            className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-[#C0392B] ring-1 ring-inset ring-[#C0392B]/30 transition-transform active:scale-95"
                          >
                            🗑️
                          </button>
                        </div>
                      )}
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

export default function AdminTasksPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <AdminTasksContent />
    </RequireAuth>
  );
}
