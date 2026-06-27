/**
 * src/app/login/page.tsx
 *
 * 登入 / 註冊頁面
 * ------------------------------------------------------------
 * 同一個頁面用一個切換按鈕在「登入」「註冊」兩種模式間切換，
 * 而不是拆成兩個路由，原因是兩種模式共用大部分的表單欄位
 * （email、密碼）與卡片版面，拆開反而會重複很多樣式程式碼。
 *
 * 行為：
 *   - 若使用者已經是登入狀態（user 存在），直接導回大廳，
 *     不會讓已登入的人看到登入頁面。
 *   - 登入／註冊成功後導向大廳 "/"。
 *   - 自助註冊一律建立「學生」帳號，不再讓使用者自己選身分
 *     （之前任何人都能自己選「老師」，部署給真實學生用之前必須
 *     拿掉這個漏洞）。要開通老師帳號，由管理者事後在 Firebase
 *     Console 的 Firestore 資料分頁，手動把對應使用者的
 *     users/{uid}.role 欄位改成 "teacher"。
 *
 * 本頁不需要 <RequireAuth> 包裹（它本身就是「未登入時的去處」，
 * 包了反而會造成導頁迴圈）。
 */

"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import { getAuthErrorMessage, signInWithEmail, signUpWithEmail } from "@/hooks/useAuth";

type AuthMode = "login" | "signup";

const INPUT_CLASS_NAME =
  "w-full rounded-lg border border-[#A9764C]/40 bg-white px-3 py-2.5 text-sm text-[#1A1A2E] focus:border-[#E8B84B] focus:outline-none focus:ring-2 focus:ring-[#E8B84B]/40 disabled:cursor-not-allowed disabled:opacity-50";

export default function LoginPage() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const isLoading = useGameStore((s) => s.isLoading);

  const [mode, setMode] = useState<AuthMode>("login");

  // ---- 共用欄位 ----
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ---- 只有註冊模式會用到 ----
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 已經登入的人不該停留在登入頁，直接導回大廳
  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/");
    }
  }, [isLoading, user, router]);

  function handleSwitchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setErrorMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      setErrorMessage("請輸入 Email 與密碼。");
      return;
    }

    if (mode === "signup") {
      const trimmedDisplayName = displayName.trim();

      if (!trimmedDisplayName) {
        setErrorMessage("請輸入顯示名稱。");
        return;
      }
      if (password.length < 6) {
        setErrorMessage("密碼至少需要 6 個字元。");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMessage("兩次輸入的密碼不一致，請再確認一次。");
        return;
      }

      setIsSubmitting(true);
      try {
        // 修正：自助註冊一律建立學生帳號，不再讓使用者自己選身分
        // （否則任何人都能自己選「老師」，拿到出題/刪題/監控其他學生的權限）。
        // 老師帳號改成由管理者事後在 Firebase Console 的 Firestore
        // 資料分頁，手動把對應使用者的 users/{uid}.role 改成 "teacher"。
        await signUpWithEmail(trimmedEmail, password, trimmedDisplayName, "student");
        router.push("/");
      } catch (error) {
        console.error("[login] 註冊失敗：", error);
        setErrorMessage(getAuthErrorMessage(error));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // mode === "login"
    setIsSubmitting(true);
    try {
      await signInWithEmail(trimmedEmail, password);
      router.push("/");
    } catch (error) {
      console.error("[login] 登入失敗：", error);
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FDF6E8] px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl bg-white/70 px-6 py-8 shadow-sm">
        <div className="flex flex-col items-center gap-2">
          <span className="text-5xl" role="img" aria-label="象棋小雞">
            🐣
          </span>
          <h1 className="text-lg font-bold text-[#1A1A2E]">象棋寵物養成</h1>
          <p className="text-xs text-[#1A1A2E]/60">
            {mode === "login" ? "登入你的帳號繼續挑戰殘局" : "建立新帳號，開始養你的第一隻小雞"}
          </p>
        </div>

        {/* ---- 登入／註冊 模式切換 ---- */}
        <div className="mt-6 flex rounded-full bg-[#1A1A2E]/5 p-1">
          <button
            type="button"
            onClick={() => handleSwitchMode("login")}
            className={[
              "flex-1 rounded-full py-1.5 text-sm font-bold transition-colors",
              mode === "login" ? "bg-[#E8B84B] text-[#1A1A2E]" : "text-[#1A1A2E]/50",
            ].join(" ")}
          >
            登入
          </button>
          <button
            type="button"
            onClick={() => handleSwitchMode("signup")}
            className={[
              "flex-1 rounded-full py-1.5 text-sm font-bold transition-colors",
              mode === "signup" ? "bg-[#E8B84B] text-[#1A1A2E]" : "text-[#1A1A2E]/50",
            ].join(" ")}
          >
            註冊
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          {mode === "signup" ? (
            <Field label="顯示名稱">
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="同學們會看到的名字(請填全名)"
                disabled={isSubmitting}
                className={INPUT_CLASS_NAME}
              />
            </Field>
          ) : null}

          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              disabled={isSubmitting}
              className={INPUT_CLASS_NAME}
            />
          </Field>

          <Field label="密碼">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={mode === "signup" ? "至少 6 個字元" : "請輸入密碼"}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              disabled={isSubmitting}
              className={INPUT_CLASS_NAME}
            />
          </Field>

          {mode === "signup" ? (
            <Field label="確認密碼">
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再輸入一次密碼"
                autoComplete="new-password"
                disabled={isSubmitting}
                className={INPUT_CLASS_NAME}
              />
            </Field>
          ) : null}

          {errorMessage ? (
            <p className="rounded-xl bg-[#C0392B]/10 px-3 py-2 text-xs font-medium text-[#C0392B]">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting
              ? mode === "login"
                ? "登入中…"
                : "註冊中…"
              : mode === "login"
                ? "登入"
                : "建立帳號"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[#1A1A2E]/70">{label}</span>
      {children}
    </label>
  );
}
