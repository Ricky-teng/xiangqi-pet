/**
 * src/hooks/useRulesEngine.ts
 *
 * 載入 @/lib/engine/rulesEngine.ts 的 React Hook 包裝
 * ------------------------------------------------------------
 * createRulesEngine() 本身已經把 WASM 模組載入做成單例（只會真正載入
 * 一次），這個 Hook 只是讓元件能用 useState/useEffect 的方式知道
 * 「現在引擎準備好了沒」，避免畫面在引擎還沒載入完成時就允許下棋互動。
 */

import { useEffect, useState } from "react";
import { createRulesEngine, type RulesEngineApi } from "@/lib/engine/rulesEngine";

export function useRulesEngine() {
  const [engine, setEngine] = useState<RulesEngineApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    createRulesEngine()
      .then((api) => {
        if (!isCancelled) setEngine(api);
      })
      .catch((err) => {
        if (isCancelled) return;
        console.error("[useRulesEngine] 規則引擎載入失敗：", err);
        setError(err instanceof Error ? err.message : "規則引擎載入失敗，請重新整理頁面再試一次。");
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return {
    engine,
    error,
    isLoading: !engine && !error,
  };
}
