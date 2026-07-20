// src/hooks/useChallengeRoomRedirect.ts
/**
 * 全域監聽：我發出的好友對戰挑戰一旦被接受，伺服器（/api/battle/
 * challenge-respond）會把新建立的 battleRoom id 寫進我自己文件的
 * lastChallengeRoomId 欄位（見 UserDoc 型別註解）。這個 hook 掛在
 * AuthProvider（全站都會掛載）裡，即時監聽這個欄位變化，一偵測到
 * 就自動導去對戰房間，不用使用者自己手動整理頁面或猜要去哪裡。
 *
 * 只有「接受挑戰的那一方」是自己主動導頁（在好友頁面按下接受後
 * 直接 router.push），這裡處理的是「發出挑戰、正在等對方回應的
 * 那一方」——他可能人根本不在好友頁面上（例如切去解題了），所以
 * 需要一個全域監聽器才抓得到這個時機。
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";

export function useChallengeRoomRedirect(): void {
  const router = useRouter();
  const uid = useGameStore((s) => s.user?.uid);
  const handledRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) return;

    const unsubscribe = onSnapshot(doc(db, "users", uid), (snap) => {
      const roomId = snap.data()?.lastChallengeRoomId as string | null | undefined;
      if (!roomId || roomId === handledRoomIdRef.current) return;

      handledRoomIdRef.current = roomId;
      // 清掉欄位，避免下次重新整理/重新訂閱時被同一個 roomId 重複導頁
      updateDoc(doc(db, "users", uid), { lastChallengeRoomId: null }).catch(() => {});
      router.push(`/battle?room=${roomId}`);
    });

    return () => unsubscribe();
  }, [uid, router]);
}
