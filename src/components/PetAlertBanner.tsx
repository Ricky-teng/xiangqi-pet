/**
 * src/components/PetAlertBanner.tsx
 *
 * 全域小雞狀態警示彈窗
 * ------------------------------------------------------------
 * 顯示 useGameStore 的 petAlertMessage（由 useAuthBootstrap 的
 * 補算邏輯、或 usePetTimeDecayTicker 的定期檢查設定）。用「需要
 * 手動按確定才會關閉」的置中彈窗，不是會自動消失的小提示——
 * 因為「小雞生大病了」「小雞死掉了」這種訊息夠重要，值得讓學生
 * 確實看到、按下確認，而不是像「上架成功」那種小提示一閃而過。
 *
 * 掛在 AuthProvider 裡，全站任何頁面都會顯示（如果剛好有訊息要顯示）。
 */

"use client";

import { useGameStore } from "@/stores/useGameStore";

export default function PetAlertBanner() {
  const petAlertMessage = useGameStore((s) => s.petAlertMessage);
  const setPetAlertMessage = useGameStore((s) => s.setPetAlertMessage);

  if (!petAlertMessage) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1A1A2E]/60 px-6">
      <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-6 py-6 text-center shadow-xl">
        <p className="text-3xl" aria-hidden="true">
          🐥
        </p>
        <p className="mt-3 whitespace-pre-line text-sm font-semibold text-[#1A1A2E]">
          {petAlertMessage}
        </p>
        <button
          type="button"
          onClick={() => setPetAlertMessage(null)}
          className="mt-4 w-full rounded-2xl bg-[#E8B84B] px-4 py-2.5 text-sm font-bold text-[#1A1A2E] shadow-md transition-transform active:scale-95"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
