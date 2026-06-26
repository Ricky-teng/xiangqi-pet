/**
 * src/app/manifest.ts
 *
 * PWA Web App Manifest（讓使用者可以「加到主畫面/安裝」這個 App）
 * ------------------------------------------------------------
 * Next.js 的特殊檔案慣例：只要 app/ 目錄下有這個檔案，Next.js 會自動
 * 在 /manifest.webmanifest 提供這份資料，並自動在 <head> 加上對應的
 * <link rel="manifest">，不需要在 layout.tsx 手動加這個 link。
 *
 * icons 指向 public/icons/icon-192.png、icon-512.png，這兩張是從你
 * 提供的「將軍小雞」圖示（原始 1254x1254）縮放生成的，跟瀏覽器分頁
 * 用的 app/favicon.ico、iOS 主畫面用的 app/apple-icon.png 是同一張圖，
 * 整個 App 的圖示現在統一。
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
