/**
 * src/hooks/useWeatherBootstrap.ts
 *
 * App 啟動時抓一次即時天氣，之後每 WEATHER_REFRESH_MS 重新抓一次，
 * 結果存進 useGameStore.weather，給 GlobalRainOverlay 等全站特效
 * 讀取。掛在 AuthProvider 裡，App 生命週期內只會掛載一次。
 */

"use client";

import { useEffect } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { fetchCurrentWeather, WEATHER_REFRESH_MS } from "@/lib/weather";

export function useWeatherBootstrap() {
  const setWeather = useGameStore((s) => s.setWeather);

  useEffect(() => {
    let isCancelled = false;

    async function load() {
      try {
        const snapshot = await fetchCurrentWeather();
        if (!isCancelled) setWeather(snapshot);
      } catch (error) {
        console.error("[useWeatherBootstrap] 抓天氣失敗，這次先不顯示天氣特效：", error);
      }
    }

    load();
    const intervalId = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [setWeather]);
}
