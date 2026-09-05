/**
 * src/lib/weather.ts
 *
 * 即時天氣（Open-Meteo，完全免費、不用申請 API key）
 * ------------------------------------------------------------
 * 只在乎「現在有沒有在下雨」這件事，用來驅動全站的下雨背景特效
 * （見 components/GlobalRainOverlay.tsx）。溫度/地點只是順便帶著，
 * 目前沒有地方顯示，之後想加天氣資訊條可以直接用。
 *
 * 定位流程：先用瀏覽器 Geolocation 拿使用者目前經緯度，被拒絕、
 * 逾時、或瀏覽器不支援，一律 fallback 顯示台北天氣（TAIPEI_COORDS），
 * 不會讓整個天氣功能因為定位失敗就掛掉不顯示。
 */

export const TAIPEI_COORDS = { latitude: 25.033, longitude: 121.5654, label: "台北" };

export interface WeatherSnapshot {
  isRaining: boolean;
  temperatureC: number;
  locationLabel: string;
}

/**
 * WMO 天氣代碼（Open-Meteo 用這套標準）裡，算「正在下雨」的範圍：
 * 51-67 毛毛雨/凍雨、80-82 陣雨、95-99 雷雨。其他代碼（晴天、多雲、
 * 下雪等）都不算「下雨」，先不特別處理下雪的視覺效果。
 */
function isRainWeatherCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99);
}

async function fetchWeatherAt(
  latitude: number,
  longitude: number,
  locationLabel: string
): Promise<WeatherSnapshot> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`天氣 API 回應失敗（HTTP ${res.status}）`);
  const data = await res.json();
  const code = data?.current?.weather_code;
  const temperature = data?.current?.temperature_2m;
  return {
    isRaining: typeof code === "number" && isRainWeatherCode(code),
    temperatureC: typeof temperature === "number" ? Math.round(temperature) : 0,
    locationLabel,
  };
}

/** 拿使用者目前位置的經緯度；被拒絕/逾時/不支援都直接 fallback 台北。 */
function getUserLocation(): Promise<{ latitude: number; longitude: number; label: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ...TAIPEI_COORDS });
      return;
    }
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ...TAIPEI_COORDS });
    }, 6000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "目前位置",
        });
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve({ ...TAIPEI_COORDS });
      },
      { timeout: 5000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/** 抓一次目前天氣：定位失敗會 fallback 台北座標；連台北那次 API 呼叫
 * 都失敗的話才整個拋出錯誤（呼叫端在 useWeatherBootstrap 裡會接住，
 * 不會讓整個 App 掛掉，只是這次沒有天氣特效而已）。 */
export async function fetchCurrentWeather(): Promise<WeatherSnapshot> {
  const location = await getUserLocation();
  try {
    return await fetchWeatherAt(location.latitude, location.longitude, location.label);
  } catch (error) {
    console.error("[weather] 取得天氣失敗，改用台北天氣：", error);
    return await fetchWeatherAt(TAIPEI_COORDS.latitude, TAIPEI_COORDS.longitude, TAIPEI_COORDS.label);
  }
}

/** 多久重新抓一次天氣，不用抓得太頻繁（半小時內天氣不太可能一直變）。 */
export const WEATHER_REFRESH_MS = 30 * 60 * 1000;
