// src/lib/fonts.ts

/**
 * 全站自訂字體
 * ------------------------------------------------------------
 * Lilita One：手遊常見的粗圓體，只用在傷害數字、BOSS / K.O. 這類
 * 英數橫幅。檔案直接放在 src/fonts/（SIL OFL 授權，授權書同資料夾），
 * 用 next/font/local 打包，不向 Google Fonts 發任何請求——學校網路
 * 常常擋外部字型，放本地才保證每台裝置看到的都一樣。
 *
 * 只含拉丁字元（約 20KB），中文字會自動退回系統字體。
 * 用法：className="font-display"（定義在 globals.css）。
 */

import localFont from "next/font/local";

export const displayFont = localFont({
  src: "../fonts/LilitaOne-latin.woff2",
  weight: "400",
  style: "normal",
  display: "swap",
  variable: "--font-display",
  // 只有數字跟英文橫幅用得到，不需要在每一頁開頭就搶先下載
  preload: false,
});
