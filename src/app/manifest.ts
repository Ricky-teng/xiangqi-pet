/**
 * src/app/manifest.ts
 *
 * PWA Web App Manifest（讓使用者可以「加到主畫面/安裝」這個 App）
 * ------------------------------------------------------------
 * Next.js 的特殊檔案慣例：只要 app/ 目錄下有這個檔案，Next.js 會自動
 * 在 /manifest.webmanifest 提供這份資料，並自動在 <head> 加上對應的
 * <link rel="manifest">，不需要在 layout.tsx 手動加這個 link。
 *
 * 【需要美術提供的圖片】
 * icons 陣列指向兩張還不存在的圖片：
 *   public/icons/icon-192.png（192x192px）
 *   public/icons/icon-512.png（512x512px）
 * 規格建議：正方形、PNG，建議無透明背景（純色或滿版插圖），因為
 * Android 安裝後的主畫面圖示是裁切成圓形/圓角方形顯示，透明區域在
 * 某些桌布上可能不好看。圖片不存在時不會讓網站壞掉，只是「加到主
 * 畫面」後圖示會顯示瀏覽器預設的破圖示，不影響其他功能。
 */

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "象棋小雞",
    short_name: "象棋小雞",
    description: "解開象棋殘局，養大你的小雞夥伴！",
    start_url: "/",
    display: "standalone",
    background_color: "#FDF6E8",
    theme_color: "#E8B84B",
    orientation: "portrait",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
