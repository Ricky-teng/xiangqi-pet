/**
 * src/lib/pet/petImagePath.ts
 *
 * 依小雞成長階段跟健康狀態決定要顯示哪張圖片的路徑。
 * 抽出成獨立檔案，讓首頁跟餵食頁面都能引用，不需要各自重複定義。
 */

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
