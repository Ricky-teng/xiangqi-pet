// src/app/settings/page.tsx
/**
 * 個人設定頁面
 * ------------------------------------------------------------
 * 從首頁移過來的登出功能 + 新增：修改顯示名稱、帳號資訊、統計總覽。
 * 統計總覽把原本分散在首頁/排行榜各處的數字集中顯示一次，方便學生
 * 一次看完自己的所有戰績，不用到處點。
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { updateProfile } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { signOutUser } from "@/hooks/useAuth";
import { useAppBackground } from "@/lib/useAppBackground";
import { getVsComputerWinRate, getBattleWinRate, getPuzzlePassRate } from "@/lib/stats";
import { registerPushNotifications } from "@/lib/notifications/registerPush";

const ROLE_LABELS: Record<string, string> = {
  student: "學生",
  teacher: "老師",
  system: "系統帳號",
};

/** "2026-07-15T08:00:00.000Z" 時間戳轉成 "2026/07/15" 這種好讀的格式 */
function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function SettingsContent() {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user?.displayName ?? "");
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameMessage, setNameMessage] = useState<string | null>(null);

  const [isSigningOut, setIsSigningOut] = useState(false);

  const [isResettingTutorial, setIsResettingTutorial] = useState(false);
  const [isRegisteringPush, setIsRegisteringPush] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  async function handleEnablePush() {
    if (!user) return;
    setIsRegisteringPush(true);
    setPushMessage(null);
    const result = await registerPushNotifications(user.uid);
    if (result.status === "success") {
      setPushMessage("✅ 推播通知已開啟！");
    } else {
      setPushMessage(result.message);
    }
    setIsRegisteringPush(false);
  }

  if (!user) return null;

  async function handleRewatchTutorial() {
    setIsResettingTutorial(true);
    try {
      const now = Date.now();
      await updateDoc(doc(db, "users", user!.uid), { hasSeenTutorial: false, updatedAt: now });
      setUser({ ...user!, hasSeenTutorial: false, updatedAt: now });
      router.push("/");
    } catch (error) {
      console.error("[settings] 重設新手教學狀態失敗：", error);
      setIsResettingTutorial(false);
    }
  }

  function startEditingName() {
    setNameInput(user!.displayName);
    setNameMessage(null);
    setIsEditingName(true);
  }

  async function saveDisplayName() {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameMessage("名稱不能是空的喔！");
      return;
    }
    if (trimmed.length > 20) {
      setNameMessage("名稱最多 20 個字。");
      return;
    }
    if (trimmed === user!.displayName) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    setNameMessage(null);
    try {
      const now = Date.now();
      await updateDoc(doc(db, "users", user!.uid), { displayName: trimmed, updatedAt: now });
      // 同步更新 Firebase Auth 的 profile，跟 Firestore 資料保持一致
      // （不是功能必要，但避免兩邊顯示名稱之後對不上）
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName: trimmed }).catch(() => {
          // Auth profile 同步失敗不影響主要功能（Firestore 才是實際讀取來源），靜默即可
        });
      }
      setUser({ ...user!, displayName: trimmed, updatedAt: now });
      setIsEditingName(false);
    } catch (error) {
      console.error("[settings] 更新顯示名稱失敗：", error);
      setNameMessage("更新失敗，請稍後再試。");
    } finally {
      setIsSavingName(false);
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutUser();
      // 登出後 onAuthStateChanged 會把 user 設成 null，
      // 外層 <RequireAuth> 的 useEffect 偵測到後會自動導向 /login。
    } catch (error) {
      console.error("[settings] 登出失敗：", error);
      setIsSigningOut(false);
    }
  }

  const vsComputerTotal = (user.stats.vsComputerWins ?? 0) + (user.stats.vsComputerLosses ?? 0) + (user.stats.vsComputerDraws ?? 0);
  const battleTotal = (user.stats.battleWins ?? 0) + (user.stats.battleLosses ?? 0) + (user.stats.battleDraws ?? 0);

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">⚙️ 個人設定</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {/* ---- 顯示名稱 ---- */}
        <section className="mt-4 rounded-3xl bg-white/70 p-4 shadow-sm">
          <h2 className="text-xs font-bold text-[#1A1A2E]/50">顯示名稱</h2>
          {isEditingName ? (
            <div className="mt-2">
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={20}
                autoFocus
                className="w-full rounded-xl border border-[#1A1A2E]/10 bg-white px-3 py-2 text-sm font-bold text-[#1A1A2E] outline-none focus:border-[#8B5FBF]"
              />
              {nameMessage ? <p className="mt-1 text-xs font-semibold text-[#C0392B]">{nameMessage}</p> : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={saveDisplayName}
                  disabled={isSavingName}
                  className="flex-1 rounded-xl bg-[#8B5FBF] py-2 text-xs font-bold text-white transition-transform active:scale-95 disabled:opacity-50"
                >
                  {isSavingName ? "儲存中…" : "儲存"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  disabled={isSavingName}
                  className="flex-1 rounded-xl bg-[#1A1A2E]/10 py-2 text-xs font-bold text-[#1A1A2E]/60 transition-transform active:scale-95"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm font-bold text-[#1A1A2E]">{user.displayName}</p>
              <button
                type="button"
                onClick={startEditingName}
                className="rounded-xl bg-[#8B5FBF]/20 px-3 py-1.5 text-xs font-bold text-[#8B5FBF] transition-transform active:scale-95"
              >
                修改
              </button>
            </div>
          )}
        </section>

        {/* ---- 帳號資訊 ---- */}
        <section className="mt-3 rounded-3xl bg-white/70 p-4 shadow-sm">
          <h2 className="text-xs font-bold text-[#1A1A2E]/50">帳號資訊</h2>
          <dl className="mt-2 flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-[#1A1A2E]/50">信箱</dt>
              <dd className="font-semibold text-[#1A1A2E]">{auth.currentUser?.email ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[#1A1A2E]/50">目前身分</dt>
              <dd className="font-semibold text-[#1A1A2E]">{ROLE_LABELS[user.role] ?? user.role}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-[#1A1A2E]/50">加入日期</dt>
              <dd className="font-semibold text-[#1A1A2E]">{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
        </section>

        {/* ---- 統計總覽 ---- */}
        <section className="mt-3 rounded-3xl bg-white/70 p-4 shadow-sm">
          <h2 className="text-xs font-bold text-[#1A1A2E]/50">統計總覽</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">✨ 轉生次數</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">{user.rebirthCount} 次</p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">🧩 解題數</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">{user.stats.totalSolved} 題</p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">🎯 一次通過率</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">
                {user.stats.totalAttempts > 0 ? `${getPuzzlePassRate(user)}%` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">🤖 對電腦勝率</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">
                {vsComputerTotal > 0 ? `${getVsComputerWinRate(user)}%（${vsComputerTotal}局）` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">⚔️ 對戰勝率</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">
                {battleTotal > 0 ? `${getBattleWinRate(user)}%（${battleTotal}場）` : "—"}
              </p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">🟪 目前飼料</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">{user.foodCount}</p>
            </div>
            <div className="rounded-2xl bg-[#FDF6E8] px-3 py-2">
              <p className="text-[10px] font-semibold text-[#1A1A2E]/50">💸 累計消費</p>
              <p className="text-base font-extrabold text-[#1A1A2E]">{user.totalFoodSpent ?? 0}</p>
            </div>
          </div>
        </section>

        {/* ---- 開啟推播通知 ---- */}
        <button
          type="button"
          onClick={handleEnablePush}
          disabled={isRegisteringPush}
          className="mt-3 w-full rounded-2xl bg-[#5B8C5A] py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          {isRegisteringPush ? "開啟中…" : "🔔 開啟推播通知"}
        </button>
        {pushMessage ? <p className="mt-2 text-center text-xs text-[#1A1A2E]/60">{pushMessage}</p> : null}

        {/* ---- 重新觀看新手教學 ---- */}
        <button
          type="button"
          onClick={handleRewatchTutorial}
          disabled={isResettingTutorial}
          className="mt-3 w-full rounded-2xl bg-[#8B5FBF] py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          {isResettingTutorial ? "準備中…" : "🀄 重新觀看新手教學"}
        </button>

        {/* ---- 登出 ---- */}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="mt-3 w-full rounded-2xl bg-[#C0392B] py-3 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50"
        >
          {isSigningOut ? "登出中…" : "登出"}
        </button>
      </div>
    </main>
  );
}

export default function SettingsPage() {
  return (
    <RequireAuth requiredRole="student">
      <SettingsContent />
    </RequireAuth>
  );
}
