// src/hooks/useChallengeRoomRedirect.ts
/**
 * 全域監聽：我發出的好友戰帖（殘局對戰／配對對弈兩種都涵蓋）一旦被
 * 接受，伺服器（/api/battle/challenge-respond、
 * /api/match/challenge-respond）會把新建立的房間 id 寫進獨立的
 * challengeRedirects/{uid} 文件。這個 hook 掛在 AuthProvider（全站都
 * 會掛載）裡，即時監聽這份文件，一偵測到就自動導去對應的房間，不用
 * 使用者自己手動整理頁面或猜要去哪裡。
 *
 * 只有「接受挑戰的那一方」是自己主動導頁（在好友頁面按下接受後
 * 直接 router.push），這裡處理的是「發出挑戰、正在等對方回應的
 * 那一方」——他可能人根本不在好友頁面上（例如切去解題了），所以
 * 需要一個全域監聽器才抓得到這個時機。
 *
 * ⚠️ 監聽的是 challengeRedirects/{uid}，不是 users/{uid} 本體——
 * users 文件幾乎每個操作都會被寫入（餵食/解題/簽到/購物…），全站
 * 掛載的監聽器如果盯著它，會被這些無關的寫入拖著一起狂燒 Firestore
 * 讀取數。challengeRedirects 文件只有真的被接受戰帖時才會變動，
 * 平常幾乎零成本。
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import type { ChallengeRedirectDoc } from "@/types/database";

export function useChallengeRoomRedirect(): void {
  const router = useRouter();
  const uid = useGameStore((s) => s.user?.uid);
  const handledBattleRoomIdRef = useRef<string | null>(null);
  const handledMatchRoomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid) return;

    const unsubscribe = onSnapshot(doc(db, "challengeRedirects", uid), (snap) => {
      const data = snap.data() as ChallengeRedirectDoc | undefined;
      const battleRoomId = data?.battleRoomId;
      const matchRoomId = data?.matchRoomId;

      if (battleRoomId && battleRoomId !== handledBattleRoomIdRef.current) {
        handledBattleRoomIdRef.current = battleRoomId;
        setDoc(doc(db, "challengeRedirects", uid), { battleRoomId: null }, { merge: true }).catch(() => {});
        router.push(`/battle?room=${battleRoomId}`);
        return;
      }

      if (matchRoomId && matchRoomId !== handledMatchRoomIdRef.current) {
        handledMatchRoomIdRef.current = matchRoomId;
        setDoc(doc(db, "challengeRedirects", uid), { matchRoomId: null }, { merge: true }).catch(() => {});
        router.push(`/match?room=${matchRoomId}`);
      }
    });

    return () => unsubscribe();
  }, [uid, router]);
}
