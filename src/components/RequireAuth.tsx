/**
 * src/components/RequireAuth.tsx
 *
 * 受保護頁面的路由守衛
 * ------------------------------------------------------------
 * 用法：把任何「必須登入才能看」的頁面內容包在 <RequireAuth> 裡：
 *
 *   export default function SomePage() {
 *     return (
 *       <RequireAuth>
 *         ...原本的頁面內容...
 *       </RequireAuth>
 *     );
 *   }
 *
 * 三種狀態：
 *   1. isLoading（登入狀態尚未檢查完成，例如剛重新整理頁面）
 *      -> 顯示載入畫面，不渲染 children、也不急著跳轉，
 *         避免「明明已登入卻被誤判成未登入而被踢出」的閃爍問題。
 *   2. 確定未登入（!isLoading && !user）
 *      -> 導向 /login，並暫時不渲染 children（避免受保護內容
 *         在導頁瞬間閃現）。
 *   3. 已登入，但 requiredRole 指定的角色不符
 *      （例如學生帳號想進老師專用的 /admin）
 *      -> 顯示「權限不足」畫面，附一個返回大廳的按鈕，
 *         不會自動踢出登入狀態，因為使用者確實是合法登入的，
 *         只是這個頁面不適合他的角色。
 *
 * 已登入且角色符合（或沒有指定 requiredRole）-> 正常渲染 children。
 */

"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useGameStore } from "@/stores/useGameStore";
import type { UserDoc } from "@/types/database";

const ROLE_LABEL: Record<UserDoc["role"], string> = {
  student: "學生",
  teacher: "老師",
  system: "系統",
};

export default function RequireAuth({
  children,
  requiredRole,
}: {
  children: ReactNode;
  /** 若指定，只有 user.role 完全相符的使用者才能看到 children */
  requiredRole?: UserDoc["role"];
}) {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const isLoading = useGameStore((s) => s.isLoading);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/login");
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return <AuthCheckingScreen />;
  }

  if (!user) {
    // 上面的 useEffect 正在導向 /login，這裡先不渲染受保護內容
    return null;
  }

  if (requiredRole && user.role !== requiredRole) {
    return (
      <PermissionDeniedScreen
        requiredRoleLabel={ROLE_LABEL[requiredRole]}
        onBackToLobby={() => router.push("/")}
      />
    );
  }

  return <>{children}</>;
}

// ============================================================
// 載入中畫面
// ============================================================

function AuthCheckingScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FDF6E8] px-6">
      <style>{`
        @keyframes auth-checking-hop {
          0%, 100% { transform: translateY(0) rotate(-4deg); }
          50% { transform: translateY(-10px) rotate(4deg); }
        }
      `}</style>
      <span
        role="img"
        aria-label="檢查登入狀態中"
        className="block text-6xl"
        style={{ animation: "auth-checking-hop 1s ease-in-out infinite" }}
      >
        🐣
      </span>
      <p className="text-sm font-semibold text-[#1A1A2E]/70">正在確認登入狀態…</p>
    </main>
  );
}

// ============================================================
// 權限不足畫面
// ============================================================

function PermissionDeniedScreen({
  requiredRoleLabel,
  onBackToLobby,
}: {
  requiredRoleLabel: string;
  onBackToLobby: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#FDF6E8] px-6 text-center">
      <span role="img" aria-label="禁止進入" className="text-6xl">
        🚫
      </span>
      <h1 className="text-lg font-bold text-[#1A1A2E]">這個頁面只給{requiredRoleLabel}使用</h1>
      <p className="max-w-xs text-sm text-[#1A1A2E]/70">
        你目前登入的帳號身分不符合這個頁面的權限，請返回大廳。
      </p>
      <button
        type="button"
        onClick={onBackToLobby}
        className="rounded-full bg-[#E8B84B] px-6 py-2 text-sm font-bold text-[#1A1A2E] shadow-md transition-transform active:scale-95"
      >
        返回大廳
      </button>
    </main>
  );
}
