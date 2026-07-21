/**
 * src/lib/pet/petImagePath.ts
 *
 * 依小雞成長階段跟健康狀態決定要顯示哪張圖片的路徑。
 * 抽出成獨立檔案，讓首頁跟餵食頁面都能引用，不需要各自重複定義。
 */

import { getCatalogEntryById } from "@/lib/pet/catalog";

export function getPetImagePath(stage: string, healthStatus: string): string {
  if (healthStatus === "slightly_sick") {
    switch (stage) {
      case "egg":    return "/pet/egg_sick.png";
      case "chick":  return "/pet/chick_sick.png";
      case "teen":   return "/pet/teen_sick.png";
      case "master": return "/pet/master_sick.png";
      default:       return "/pet/chick_sick.png";
    }
  }

  if (healthStatus === "severely_sick") {
    switch (stage) {
      case "egg":    return "/pet/egg_serioussick.png";
      case "chick":  return "/pet/chick_serioussick.png";
      case "teen":   return "/pet/teen_serioussick.png";
      case "master": return "/pet/master_serioussick.png";
      default:       return "/pet/chick_serioussick.png";
    }
  }

  if (healthStatus === "dead") {
    switch (stage) {
      case "egg":    return "/pet/egg_dead.png";
      case "chick":  return "/pet/chick_dead.png";
      case "teen":   return "/pet/teen_dead.png";
      case "master": return "/pet/master_dead.png";
      default:       return "/pet/chick_dead.png";
    }
  }

  switch (stage) {
    case "egg":    return "/pet/egg.png";
    case "chick":  return "/pet/chick.png";
    case "teen":   return "/pet/teen.png";
    case "master": return "/pet/master.png";
    default:       return "/pet/chick.png";
  }
}

/**
 * 決定小雞「實際要顯示的圖片路徑」，把職業外觀考慮進去。
 * ------------------------------------------------------------
 * 生病/瀕死/死亡狀態一律用原本的階段圖（沒有職業版的病態圖）；
 * 只有健康狀態正常、而且已經轉職過（currentAppearanceId 有值），
 * 才顯示職業外觀圖（沿用圖鑑的圖檔，見 @/lib/pet/catalog.ts）。
 * 呼叫端如果想在職業圖載入失敗時自動退回階段圖，可以另外用
 * <img onError> 搭配本函式判斷「這張是不是職業圖」來實作
 * （見 src/app/page.tsx 的 LivingPetDisplay、src/app/feed/page.tsx）。
 */
export function getPetDisplaySrc(
  stage: string,
  healthStatus: string,
  currentAppearanceId: string | null
): { src: string; isJobImage: boolean } {
  if (healthStatus === "normal" && currentAppearanceId) {
    const entry = getCatalogEntryById(currentAppearanceId);
    if (entry) return { src: entry.imagePath, isJobImage: true };
  }
  return { src: getPetImagePath(stage, healthStatus), isJobImage: false };
}
