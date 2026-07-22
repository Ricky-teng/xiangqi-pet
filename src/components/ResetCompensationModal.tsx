/**
 * src/components/ResetCompensationModal.tsx
 *
 * 「轉生機制改版補償」彈窗：上次調整轉生機制時把所有人的小雞狀態
 * 重置了，這裡補償一筆飼料，一次性、只能領一次。
 * ------------------------------------------------------------
 * 觸發時機：見 src/app/page.tsx，只在
 * user.hasClaimedResetCompensation 不是 true 時顯示（新帳號在
 * useAuth.ts 建立時就直接設成 true，因為他們沒被那次重置影響過）。
 *
 * 金額算法：累計解題數(stats.totalSolved) x 10，超過 1000 題的人直接
 * 給封頂的 5000（不會在畫面上講「解題數 x10」這個換算規則，只顯示
 * 最終可領取的數字，避免玩家去反推規則）。
 */

"use client";

interface ResetCompensationModalProps {
  open: boolean;
  /** 可領取的飼料數量，由外層（page.tsx）依 user.stats.totalSolved 算好傳進來 */
  amount: number;
  onClaim: () => void;
}

export function ResetCompensationModal({ open, amount, onClaim }: ResetCompensationModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="text-6xl">🎁</div>
          <p className="mt-3 text-lg font-extrabold text-[#1A1A2E]">飼料補償通知</p>
          <p className="mt-2 text-xs leading-relaxed text-[#1A1A2E]/60">
            上次調整轉生機制的時候，不小心把大家的小雞狀態都重置了，
            造成養成進度受到影響，真的很抱歉！這裡補償一筆飼料，
            當作賠罪 🙏
            補償飼料=解題數*10
            上限為5000
          </p>
        </div>

        <div className="mt-4 rounded-2xl bg-[#E8B84B]/20 px-4 py-4 text-center">
          <p className="text-xs font-semibold text-[#1A1A2E]/60">可領取</p>
          <p className="mt-1 text-3xl font-extrabold text-[#5C3D0A]">🟪 {amount}</p>
        </div>

        <button
          type="button"
          onClick={onClaim}
          className="mt-5 w-full rounded-2xl bg-[#5C3D0A] px-4 py-3 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95"
        >
          🎁 領取補償飼料
        </button>
      </div>
    </div>
  );
}
