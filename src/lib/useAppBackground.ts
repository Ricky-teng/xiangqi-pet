/**
 * src/lib/useAppBackground.ts
 * ------------------------------------------------------------
 * 取得目前使用者的背景樣式，供各頁面最外層的 <main> 使用。
 *
 * ⚠️ 所有「登入後」的頁面都必須用這支 hook，不要自己手寫
 *    `user.activeBackground ? {...} : {...}`。之前有幾頁複製貼上同一段
 *    邏輯，結果新增頁面時漏掉，學生買的背景在那幾頁就套不上去。
 *    只有 /login、/privacy 這種「還沒有 user」的頁面可以寫死底色。
 *
 * overlay 參數：給需要在使用者背景「之上」再疊一層色調的頁面用
 * （例如探險塔內頁要疊該座塔的主色）。傳入一段合法的 CSS
 * background-image 值（通常是 linear-gradient(...)），它會被畫在
 * 使用者的背景圖上面；使用者沒有背景圖時就直接當底色用。
 */
import { useGameStore } from "@/stores/useGameStore";

/** 沒有背景圖時的系統預設底色 */
export const DEFAULT_APP_BACKGROUND_COLOR = "#FDF6E8";

export function useAppBackground(overlay?: string): React.CSSProperties {
  // 只訂閱 activeBackground 這一個欄位，不要整包 user——
  // 整包訂閱會讓「飼料數量變動」之類的更新也重畫整頁背景。
  const activeBackground = useGameStore((s) => s.user?.activeBackground);

  if (!activeBackground) {
    // 沒有背景圖：底色照舊，有 overlay 就把 overlay 當唯一一層畫上去
    return overlay
      ? {
          backgroundColor: DEFAULT_APP_BACKGROUND_COLOR,
          backgroundImage: overlay,
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
        }
      : { backgroundColor: DEFAULT_APP_BACKGROUND_COLOR };
  }

  const imageUrl = `url(/backgrounds/${activeBackground}.jpg)`;

  // CSS 的 background-image 是「先寫的畫在上面」，所以 overlay 要放前面。
  // size 也要跟著給兩個值：overlay 用 100% 100%（配合 fixed 就是滿一個
  // 視窗），底下的圖維持 cover。
  return {
    backgroundColor: DEFAULT_APP_BACKGROUND_COLOR,
    backgroundImage: overlay ? `${overlay}, ${imageUrl}` : imageUrl,
    backgroundSize: overlay ? "100% 100%, cover" : "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    backgroundAttachment: "fixed",
  };
}
