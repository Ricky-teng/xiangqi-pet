/**
 * src/components/AuthProvider.tsx
 *
 * 登入狀態總開關
 * ------------------------------------------------------------
 * 純粹的「副作用掛載點」：掛在 root layout（src/app/layout.tsx）裡
 * 包住 {children}，App 啟動時只會掛載一次，負責：
 *   1. useAuthBootstrap()：啟動 Firebase Auth 的 onAuthStateChanged
 *      訂閱，把登入狀態同步進 useGameStore（同時做一次性的小雞
 *      時間衰退補算，見 petDecay.ts）。
 *   2. usePetTimeDecayTicker()：開著 App 期間每分鐘重新檢查一次
 *      小雞的飽食度/生病時間衰退，不用重新整理頁面才會更新。
 *   3. 渲染 <PetAlertBanner />：全站共用的小雞狀態警示彈窗
 *      （太久沒醫治、餓過頭等通知）。
 *   4. useWeatherBootstrap()：抓一次即時天氣（見 lib/weather.ts），
 *      之後每 30 分鐘重新抓一次，結果存進 useGameStore.weather。
 *   5. 渲染 <GlobalRainOverlay />：只要目前天氣真的在下雨，全站
 *      每一頁背景都會疊一層下雨特效。
 *
 * 為什麼要獨立成一個 Client Component，而不是直接在 layout.tsx
 * 裡呼叫這些 Hook：
 *   Next.js App Router 的 layout.tsx 預設是 Server Component，
 *   不能直接使用 React Hook（useEffect/useState 等）。把需要用到
 *   Hook 的部分抽成一個獨立的 "use client" 元件，讓 layout.tsx
 *   保持最小、乾淨，是 App Router 的標準做法。
 */

"use client";

import type { ReactNode } from "react";
import { useAuthBootstrap } from "@/hooks/useAuth";
import { usePetTimeDecayTicker } from "@/hooks/usePetTimeDecayTicker";
import { useChallengeRoomRedirect } from "@/hooks/useChallengeRoomRedirect";
import { useAutoRegisterPush } from "@/hooks/useAutoRegisterPush";
import { useWeatherBootstrap } from "@/hooks/useWeatherBootstrap";
import { useGameStore } from "@/stores/useGameStore";
import PetAlertBanner from "@/components/PetAlertBanner";
import GlobalRainOverlay from "@/components/GlobalRainOverlay";

export default function AuthProvider({ children }: { children: ReactNode }) {
  useAuthBootstrap();
  usePetTimeDecayTicker();
  useChallengeRoomRedirect();
  useWeatherBootstrap();

  const uid = useGameStore((s) => s.user?.uid);
  const role = useGameStore((s) => s.user?.role);
  useAutoRegisterPush(uid, role);
  return (
    <>
      {children}
      <PetAlertBanner />
      <GlobalRainOverlay />
    </>
  );
}
