// src/hooks/useChallengeRoomRedirect.ts
/**
 * 全域監聽：我發出的好友戰帖（殘局對戰 lastChallengeRoomId、配對對弈
 * lastMatchChallengeRoomId 兩種都涵蓋）一旦被接受，伺服器
 * （/api/battle/challenge-respond、/api/match/challenge-respond）
 * 會把新建立的房間 id 寫回我自己文件對應的欄位。這個 hook 掛在
 * AuthProvider（全站都會掛載）裡，即時監聽這兩個欄位變化，一偵測到
 * 就自動導去對應的房間，不用使用者自己手動整理頁面或猜要去哪裡。
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
  const handledBattleRoomIdRef = useRef<string | null>(null);
  const handledMatchRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) return;

    const unsubscribe = onSnapshot(doc(db, "users", uid), (snap) => {
      const data = snap.data();
      const battleRoomId = data?.lastChallengeRoomId as string | null | undefined;
      const matchRoomId = data?.lastMatchChallengeRoomId as string | null | undefined;

      if (battleRoomId && battleRoomId !== handledBattleRoomIdRef.current) {
        handledBattleRoomIdRef.current = battleRoomId;
        updateDoc(doc(db, "users", uid), { lastChallengeRoomId: null }).catch(() => {});
        router.push(`/battle?room=${battleRoomId}`);
        return;
      }

      if (matchRoomId && matchRoomId !== handledMatchRoomIdRef.current) {
        handledMatchRoomIdRef.current = matchRoomId;
        updateDoc(doc(db, "users", uid), { lastMatchChallengeRoomId: null }).catch(() => {});
        router.push(`/match?room=${matchRoomId}`);
      }
    });

    return () => unsubscribe();
  }, [uid, router]);
}
