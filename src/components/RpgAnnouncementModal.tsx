// src/components/RpgAnnouncementModal.tsx
"use client";

/**
 * RPG 上線公告 ＋ 補發新手雞
 * ------------------------------------------------------------
 * 只有「上線前就存在的舊帳號」會看到一次。判斷方式沿用
 * JobChangeAnnouncementModal 那一套：新帳號在 createDefaultUserDoc
 * 明確把 hasSeenRpgAnnouncement 設成 true，舊帳號沒有這個欄位
 * （undefined）就會顯示，看完寫回 true。
 *
 * 為什麼要補發一隻小雞：舊制度的「轉生」會把小雞整隻歸零，那些轉生
 * 掉的小雞在新制度下本來應該變成收藏品，但資料已經沒了、補不回來。
 * 一律送 1 隻未轉職的新手雞，讓舊學生一上線就能進探險，不會因為
 * 「還沒養出第一隻大師雞」而完全玩不到新功能。
 *
 * 送雞跟看公告用兩個不同的旗標（hasClaimedStarterPet / hasSeenRpg-
 * Announcement）：公告只是看過就好，送雞是真的會寫一筆收藏小雞，
 * 必須嚴格只發一次。
 */

import { useEffect, useState } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { createCollectedPet } from "@/lib/collectedPets";
import { getBareStats, getTotalPower } from "@/lib/rpg/stats";

/** 補發的新手雞：固定未轉職、沒生過病，四項是基礎值的 ×0.8 */
const STARTER_PET_NAME = "新手雞";

/**
 * 補發的新手雞用固定的文件 id。這樣寫入逾時、學生下次開 App 再試
 * 一次的時候會覆蓋同一份，不會多生一隻出來。
 */
const STARTER_PET_DOC_ID = "starter";

/** 寫入等多久就認定網路有問題（毫秒） */
const WRITE_TIMEOUT_MS = 8000;

/**
 * Firestore 的寫入在離線時不會 reject，promise 會一直 pending（SDK
 * 把它排進佇列等連線）。如果直接 await，學生會看到按鈕卡在「處理中」
 * 永遠不動。所以這裡加一層逾時，超過就當作「還沒成功」處理。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms)),
  ]);
}

export default function RpgAnnouncementModal() {
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const [visible, setVisible] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [claimedPetName, setClaimedPetName] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!user || user.role !== "student") return;
    // 明確是 false / undefined 才顯示；true 代表看過了（或是新帳號）
    if (user.hasSeenRpgAnnouncement === true) return;
    setVisible(true);
  }, [user]);

  if (!visible || !user) return null;

  const stats = getBareStats(null, 0);
  const needsStarterPet = user.hasClaimedStarterPet !== true;

  async function handleConfirm() {
    if (!user) return;
    setIsClaiming(true);

    let starterName: string | null = null;

    if (needsStarterPet) {
      try {
        const created = await withTimeout(
          createCollectedPet({
            uid: user.uid,
            name: STARTER_PET_NAME,
            jobId: null, // 未轉職，四項 ×0.8
            severeSickCount: 0,
            daysRaised: 1,
            docId: STARTER_PET_DOC_ID,
          }),
          WRITE_TIMEOUT_MS,
        );
        if (created === "timeout") {
          // 不寫旗標，下次開 App 會再試一次（文件 id 固定，不會重複生）
          setIsClaiming(false);
          setTimedOut(true);
          return;
        }
        starterName = created.name;
      } catch (error) {
        // 送雞失敗就不要把旗標寫成 true，下次開 App 會再試一次。
        // 公告可以晚點看，但小雞不能憑空消失。
        console.error("[RpgAnnouncementModal] 補發新手雞失敗：", error);
        setIsClaiming(false);
        setTimedOut(true);
        return;
      }
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        hasSeenRpgAnnouncement: true,
        hasClaimedStarterPet: true,
        // 補發走的是固定 docId，createCollectedPet 不會自己加計數，
        // 所以在這裡一起補上（跟旗標同一次寫入，不會重複加）
        ...(starterName ? { collectedPetCount: (user.collectedPetCount ?? 0) + 1 } : {}),
        updatedAt: Date.now(),
      });
      setUser({
        ...user,
        hasSeenRpgAnnouncement: true,
        hasClaimedStarterPet: true,
        collectedPetCount: (user.collectedPetCount ?? 0) + (starterName ? 1 : 0),
      });
    } catch (error) {
      console.error("[RpgAnnouncementModal] 寫回旗標失敗：", error);
    }

    setIsClaiming(false);
    if (starterName) {
      // 先讓學生看到「拿到了什麼」，按第二次才關掉
      setClaimedPetName(starterName);
      // 收藏清單要重讀才看得到新的那一隻
      useGameStore.setState({ collectedPetsLoaded: false });
    } else {
      setVisible(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
      <div
        className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-3xl p-5 shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #FDF6E8 0%, #F3E6CC 100%)",
          border: "2px solid #E8B84B",
          boxShadow: "inset 0 2px 10px rgba(92,61,10,0.18), 0 18px 40px rgba(0,0,0,0.45)",
        }}
      >
        {claimedPetName ? (
          <>
            <p className="text-center text-4xl">🐣</p>
            <h2 className="mt-2 text-center text-lg font-extrabold text-[#1A1A2E]">
              收到一隻「{claimedPetName}」！
            </h2>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/60">
              牠在「🐣 我的小雞」裡。記得先去「🎒 物品」買一把武器，
              <br />
              裝上去才能派牠出去探險。
            </p>
            <button
              type="button"
              onClick={() => setVisible(false)}
              className="mt-5 w-full rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
            >
              知道了
            </button>
          </>
        ) : (
          <>
            <p className="text-center text-3xl">🗺️ ⚔️</p>
            <h2 className="mt-2 text-center text-lg font-extrabold text-[#1A1A2E]">
              新玩法上線了
            </h2>

            <div className="mt-4 space-y-2 text-xs text-[#1A1A2E]/75">
              <p className="rounded-xl bg-white/70 px-3 py-2">
                <span className="font-extrabold text-[#5C3D0A]">🐣 轉生改成「收藏」</span>
                <br />
                小雞養到大師雞之後按「收藏」，牠會永久留在你的「我的小雞」，
                不用再餵食、不會生病，而且可以派出去打仗。你會馬上拿到一顆新蛋。
              </p>
              <p className="rounded-xl bg-white/70 px-3 py-2">
                <span className="font-extrabold text-[#5C3D0A]">🗺️ 探險</span>
                <br />
                10 座塔、每座 10 關，打贏會掉裝備。裝備可以 3 件合 1 件往上升階。
              </p>
              <p className="rounded-xl bg-white/70 px-3 py-2">
                <span className="font-extrabold text-[#5C3D0A]">⚔️ 戰隊</span>
                <br />
                派 3 隻小雞挑戰同學的戰隊。每個月結算一次，前三名有飼料獎勵，
                比上個月進步也有進步獎。
              </p>
            </div>

            {needsStarterPet ? (
              <div className="mt-3 rounded-2xl bg-[#E8B84B]/20 px-3 py-3">
                <p className="text-xs font-extrabold text-[#5C3D0A]">
                  🎁 送你一隻新手雞，馬上就能開始探險
                </p>
                <p className="mt-1 text-[11px] text-[#5C3D0A]/75">
                  以前轉生掉的小雞沒辦法補回來（那時候還沒有收藏系統），
                  所以一律送 1 隻未轉職的新手雞給大家。
                </p>
                <p className="mt-1.5 text-[10px] font-bold text-[#5C3D0A]/60">
                  體力 {stats.hp}・攻擊 {stats.attack}・防禦 {stats.defense}・速度 {stats.speed}
                  （總戰力 {getTotalPower(stats)}）
                </p>
              </div>
            ) : null}

            {timedOut ? (
              <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-[11px] font-bold text-[#C0392B]">
                網路好像不太穩，新手雞還沒送出去。可以先關掉，下次開 App 會自動再試一次
                （不會重複送）。
              </p>
            ) : null}

            <button
              type="button"
              disabled={isClaiming}
              onClick={handleConfirm}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:opacity-60"
            >
              {isClaiming ? "處理中…" : timedOut ? "再試一次" : needsStarterPet ? "領取並開始" : "知道了"}
            </button>
            {timedOut ? (
              <button
                type="button"
                onClick={() => setVisible(false)}
                className="mt-2 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-[#1A1A2E]/55"
              >
                先關掉
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
