/**
 * src/components/GlobalRainOverlay.tsx
 *
 * 全站下雨背景特效：只要 useGameStore.weather.isRaining 是 true
 * （見 useWeatherBootstrap.ts + lib/weather.ts），不管在哪一頁都會
 * 疊一層飄落的雨滴，純裝飾、不能點（pointer-events-none），蓋在最
 * 上層但不擋任何操作。掛在 AuthProvider 裡，跟 <PetAlertBanner />
 * 同一個層級，App 生命週期內只會掛載一次。
 */

"use client";

import { useMemo } from "react";
import { useGameStore } from "@/stores/useGameStore";

export default function GlobalRainOverlay() {
  const isRaining = useGameStore((s) => s.weather?.isRaining ?? false);

  // 用 sin 算固定的偽隨機位置/時間差，不用 Math.random()——這樣每次
  // re-render（例如天氣狀態物件變動）雨滴位置不會整個重新洗牌跳動。
  const raindrops = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.round((Math.sin(i * 17.3) * 0.5 + 0.5) * 100),
        duration: 0.9 + ((i * 37) % 60) / 100,
        delay: ((i * 53) % 300) / 100,
      })),
    []
  );

  if (!isRaining) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden opacity-40" aria-hidden="true">
      {raindrops.map((drop) => (
        <span
          key={drop.id}
          className="absolute top-[-5%] text-sm text-[#CFE8FF]"
          style={{
            left: `${drop.left}%`,
            animation: `pasture-rain-fall ${drop.duration}s linear infinite`,
            animationDelay: `${drop.delay}s`,
          }}
        >
          💧
        </span>
      ))}
    </div>
  );
}
