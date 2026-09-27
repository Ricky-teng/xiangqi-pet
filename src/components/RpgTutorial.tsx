// src/components/RpgTutorial.tsx
"use client";

/**
 * 探險的新手強制教學
 * ------------------------------------------------------------
 * 第一次進探險時強制跑一次，只教到「打完第一關」就放手：
 *
 *   ① 帶去「🎒 物品」買武器
 *   ② 裝到小雞身上
 *   ③ 進探險打第 1 塔第 1 關
 *   ④ 看結算跟掉寶
 *
 * 合成、戰隊刻意不教——讓學生自己碰到，每一頁都有「❓ 規則」可以查。
 * 一次教完會把第一次體驗綁得太久。
 *
 * 實作方式：不用 overlay 圈出畫面上的某個按鈕（那會跟每一頁的版面
 * 綁死，之後改版就壞），改成「一張說明卡片 ＋ 一顆直接跳到該做的
 * 那一頁的按鈕」。學生照著按就會走完整條線。
 *
 * 進度存在 UserDoc.rpgTutorialStep：
 *   undefined / 0 = 還沒開始，1~4 = 進行中，99 = 完成（不再顯示）
 * 每一步完成的條件是「畫面上真的能偵測到的狀態」，不是「按過按鈕」，
 * 所以學生自己先去買了武器再回來，教學會自動跳到下一步。
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { getDeployablePets } from "@/lib/rpg/deploy";

export const RPG_TUTORIAL_DONE = 99;

interface Step {
  title: string;
  body: string;
  actionLabel: string;
  href: string | null;
}

const STEPS: Step[] = [
  {
    title: "① 先買一把武器",
    body: "小雞要有武器才能出去探險。到「🎒 物品」頁的裝備分頁，花 100 飼料買一把粗製武器。",
    actionLabel: "去物品頁買武器",
    href: "/inventory",
  },
  {
    title: "② 把武器裝到小雞身上",
    body: "到「🐣 我的小雞」，點一隻小雞打開詳細頁，再點武器格就能從背包裝上去。上面的數值會馬上跟著變。",
    actionLabel: "去我的小雞裝武器",
    href: "/my-pets",
  },
  {
    title: "③ 打第 1 塔的第 1 關",
    body: "回到探險，點「青草塔」，再點第 1 關。準備頁會自動幫你選最強的那隻，直接按「開始探險」就好。",
    actionLabel: "開始探險",
    href: "/explore",
  },
  {
    title: "④ 看看你拿到什麼",
    body: "打贏之後會跳結算卡片，第一次通關會掉 2 件裝備。3 件同階同類型可以合成 1 件更強的——這就是變強的方法。",
    actionLabel: "我知道了，開始玩！",
    href: null,
  },
];

export default function RpgTutorial() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const livingPet = useGameStore((s) => s.pet);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const exploreProgress = useGameStore((s) => s.exploreProgress);
  const [dismissed, setDismissed] = useState(false);

  const currentStep = user?.rpgTutorialStep ?? 0;

  /**
   * 依「現在的實際狀態」算出應該停在第幾步。這樣學生自己先做完某一步
   * （沒照教學按）也會自動往前跳，不會卡在已經做完的步驟上。
   */
  const detectedStep = useMemo(() => {
    if (!user) return 1;
    const bag = user.equipmentBag ?? [];
    const pets = getDeployablePets(collectedPets, livingPet);

    const hasWeaponAnywhere =
      bag.some((item) => item.kind === "weapon") || pets.some((p) => p.weapon !== null);
    if (!hasWeaponAnywhere) return 1;

    const hasEquippedWeapon = pets.some((p) => p.weapon !== null);
    if (!hasEquippedWeapon) return 2;

    const clearedAny = (exploreProgress?.clearedStageKeys.length ?? 0) > 0;
    if (!clearedAny) return 3;

    return 4;
  }, [user, collectedPets, livingPet, exploreProgress]);

  // 把偵測到的進度寫回去（只往前，不會倒退）
  useEffect(() => {
    if (!user || user.role !== "student") return;
    if (currentStep === RPG_TUTORIAL_DONE) return;
    if (detectedStep <= currentStep) return;

    const next = detectedStep;
    setUser({ ...user, rpgTutorialStep: next });
    void updateDoc(doc(db, "users", user.uid), {
      rpgTutorialStep: next,
      updatedAt: Date.now(),
    }).catch((error) => {
      console.error("[RpgTutorial] 寫回教學進度失敗：", error);
    });
  }, [detectedStep, currentStep, user, setUser]);

  if (!user || user.role !== "student") return null;
  if (currentStep === RPG_TUTORIAL_DONE) return null;
  if (dismissed) return null;
  // 舊帳號第一次進來會先看到 RPG 上線公告（含補發新手雞），
  // 兩個同時出現會擠在一起，等公告看完再開始教學。
  if (user.hasSeenRpgAnnouncement !== true) return null;

  const stepIndex = Math.min(STEPS.length, Math.max(1, detectedStep)) - 1;
  const step = STEPS[stepIndex];

  async function finish() {
    if (!user) return;
    setDismissed(true);
    setUser({ ...user, rpgTutorialStep: RPG_TUTORIAL_DONE });
    try {
      await updateDoc(doc(db, "users", user.uid), {
        rpgTutorialStep: RPG_TUTORIAL_DONE,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error("[RpgTutorial] 寫回教學完成失敗：", error);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[88] px-3 pb-3">
      <div
        className="mx-auto max-w-md rounded-3xl p-4 shadow-2xl"
        style={{
          background: "linear-gradient(180deg, #FDF6E8 0%, #F3E6CC 100%)",
          border: "2px solid #E8B84B",
          boxShadow: "inset 0 2px 10px rgba(92,61,10,0.18), 0 -8px 30px rgba(0,0,0,0.35)",
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-[#5C3D0A]/60">
            新手教學 {stepIndex + 1} / {STEPS.length}
          </span>
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className="h-1.5 w-5 rounded-full"
                style={{ backgroundColor: i <= stepIndex ? "#E8B84B" : "rgba(26,26,46,0.15)" }}
              />
            ))}
          </div>
        </div>

        <p className="mt-2 text-sm font-extrabold text-[#1A1A2E]">{step.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-[#1A1A2E]/70">{step.body}</p>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={finish}
            className="rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#1A1A2E]/55 shadow-sm transition-transform active:scale-95"
          >
            略過教學
          </button>
          <button
            type="button"
            onClick={() => {
              if (step.href) router.push(step.href);
              else void finish();
            }}
            className="flex-1 rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
          >
            {step.actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
