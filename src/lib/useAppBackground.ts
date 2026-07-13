/**
 * src/lib/useAppBackground.ts
 * 取得目前使用者的背景樣式，供各頁面的 <main> 使用
 */
import { useGameStore } from "@/stores/useGameStore";

export function useAppBackground(): React.CSSProperties {
  const user = useGameStore((s) => s.user);
  if (!user?.activeBackground) return { backgroundColor: "#FDF6E8" };
  return {
    backgroundImage: `url(/backgrounds/${user.activeBackground}.jpg)`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  };
}
