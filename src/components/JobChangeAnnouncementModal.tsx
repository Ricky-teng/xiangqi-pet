/**
 * src/components/JobChangeAnnouncementModal.tsx
 *
 * 「轉生機制改版」公告彈窗：一次性跟舊帳號使用者說明「轉生」
 * 改成「轉職」的新玩法。
 * ------------------------------------------------------------
 * 觸發時機：見 src/app/page.tsx，只在 user.hasSeenJobChangeAnnouncement
 * 不是 true 時顯示（既有舊帳號 Firestore 資料沒有這個欄位，預設就是
 * undefined，所以會顯示一次）。新帳號在 useAuth.ts 建立時就直接把這
 * 個欄位設成 true，不需要看到這則公告——因為他們沒有用過舊的轉生
 * 機制，長到大師雞的時候看到「轉職」按鈕，本來就是遊戲原本的樣子，
 * 不需要特別解釋「改版了」。
 *
 * 看完按「知道了」會呼叫 onClose，由外層負責把
 * hasSeenJobChangeAnnouncement 寫回 Firestore。
 */

"use client";

interface JobChangeAnnouncementModalProps {
  open: boolean;
  onClose: () => void;
}

export function JobChangeAnnouncementModal({ open, onClose }: JobChangeAnnouncementModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] px-5 py-6 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="text-6xl">⚔️</div>
          <p className="mt-3 text-lg font-extrabold text-[#1A1A2E]">轉生系統改版了！</p>
          <p className="mt-1 text-xs text-[#1A1A2E]/60">
            養到大師雞之後，「轉生」變成「轉職」，玩法更豐富了：
          </p>
        </div>

        <div className="mt-4 space-y-2.5">
          <div className="flex items-start gap-2.5 rounded-2xl bg-white/70 px-3 py-2.5">
            <span className="text-lg leading-none">1️⃣</span>
            <p className="text-xs leading-relaxed text-[#1A1A2E]">
              小雞養到<span className="font-bold">大師雞</span>之後，按鈕會變成
              <span className="font-bold text-[#5C3D0A]">「轉職」</span>：花飼料就能直接變成下一個職業，
              不用重新養、成長階段也不會變。
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-2xl bg-white/70 px-3 py-2.5">
            <span className="text-lg leading-none">2️⃣</span>
            <p className="text-xs leading-relaxed text-[#1A1A2E]">
              職業依序是：小兵雞 → 砲兵雞 → 馬伕雞 → 戰車雞 → 巨象雞 → 仕官雞 → 將軍雞 → 鳳凰雞，
              越後面要花的飼料越多，每轉職一次就會立刻解鎖對應的圖鑑款式。
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-2xl bg-white/70 px-3 py-2.5">
            <span className="text-lg leading-none">3️⃣</span>
            <p className="text-xs leading-relaxed text-[#1A1A2E]">
              轉職到<span className="font-bold">鳳凰雞</span>之後，按鈕才會變回
              <span className="font-bold text-[#5C3D0A]">「轉生」</span>：免費，小雞才會真正重置回蛋，
              準備開始下一輪職業旅程。
            </p>
          </div>
          <div className="flex items-start gap-2.5 rounded-2xl bg-white/70 px-3 py-2.5">
            <span className="text-lg leading-none">💔</span>
            <p className="text-xs leading-relaxed text-[#1A1A2E]">
              小雞如果沒照顧好死掉了，重新養的話職業會歸零，但<span className="font-bold">圖鑑蒐集紀錄不會消失</span>，
              放心！
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-[#5C3D0A] px-4 py-3 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95"
        >
          知道了！
        </button>
      </div>
    </div>
  );
}
