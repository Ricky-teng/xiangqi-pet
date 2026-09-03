/**
 * src/app/pasture/page.tsx
 *
 * 牧場：可以看到同一間牧場（見 PastureDoc，最多 MAX_PASTURE_MEMBERS 人）
 * 裡所有人的小雞，在草地上隨機漫步。
 * ------------------------------------------------------------
 * 【重要設計決定：走動是「純前端動畫、不同步」】
 * 每隻小雞的座標只在「這台裝置上」隨機產生跟移動，不會即時同步給
 * 其他正在看牧場的人（也就是說，你看到的小雞位置跟別人看到的不會
 * 一樣）。這是刻意的取捨：如果要做成大家看到完全同步的座標，需要
 * 持續不斷把每隻小雞的位置廣播給所有人，成本會跟聊天室/對戰房間
 * 那種即時連線一樣高，而且是「所有人同時盯著同一群移動物件」，人一
 * 多讀取量會爆炸性成長。純前端動畫視覺上一樣熱鬧，但幾乎零額外成本
 * ——只需要在進頁面時抓一次「這間牧場有哪些人、他們小雞現在長怎樣」
 * 就好，之後完全不用再連伺服器。
 *
 * 資料抓取：全部一次性讀取（getDocs/getDoc），不用 onSnapshot 即時
 * 監聽——牧場本來就不需要「別人小雞的健康狀態即時更新」這種即時性，
 * 進頁面抓一次現況就夠了。
 *
 * 【2026-07 加強互動感】原本只有小雞走來走去，太單調，加了三個純前端
 * 效果（都不需要額外的伺服器成本）：
 *   1. 點小雞看資訊卡片（職業、健康狀態、累計解題數——這些資料本來
 *      就已經抓回來了，只是原本沒有拿出來用）。
 *   2. 小雞會隨機冒出對話泡泡，講幾句可愛的話。
 *   3. 「找到我的小雞」按鈕，讓自己的小雞閃爍幾秒方便一眼找到。
 *   4. 背景加幾朵緩慢飄動的雲，純裝飾。
 *
 * 【2026-09 再加強互動感】新增五個東西：
 *   1. 拍拍小雞：在資訊卡片裡按「🤚 拍拍」，冒愛心動畫，純前端零成本；
 *      拍別人的小雞算一次「牧場互動」（見 recordPastureInteraction）。
 *   2. 送表情：資訊卡片裡選一個表情送出去，除了跟拍拍一樣算一次互動，
 *      還會呼叫 /api/notifications/notify 通知對方（新增的
 *      "pasture_poke" 通知類型）。
 *   3. 牧場每日任務：跟 N 隻不同小雞互動可以在 /tasks 頁面領獎勵
 *      （見 DailyTaskType 的 "pasture_interact"）。
 *   4. 找蟲子小遊戲：草地上會冒出可以點的蟲，點到給少量飼料，每天有
 *      次數上限（PASTURE_BUG_CATCH_DAILY_LIMIT）。跟第 5 點的裝飾蟲蟲
 *      故意做成不同外觀，一眼就能分辨「這隻蟲可以點」跟「這只是裝飾」。
 *   5. 天氣/時段變化：依現在時間換草地的光線色調（清晨/白天/傍晚/
 *      夜晚），偶爾隨機下雨或出彩虹，純前端算，每次進頁面才重新抽一次。
 *   6. 裝飾用的蟲蟲/食物物件：漂浮的蝴蝶、掉落的穀粒，純裝飾不能點，
 *      跟找蟲子小遊戲的蟲外觀刻意做出區隔（見 PastureField 裡的
 *      DecorativeCritters）。
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { arrayUnion, collection, doc, documentId, getDoc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { useAppBackground } from "@/lib/useAppBackground";
import { getPetDisplaySrc, getPetImagePath } from "@/lib/pet/petImagePath";
import { getCatalogEntryById } from "@/lib/pet/catalog";
import {
  PASTURE_ENTRY_FEE,
  PASTURE_HOURLY_INCOME,
  PASTURE_DAILY_INCOME_CAP,
  PASTURE_BUG_CATCH_REWARD_FOOD,
  PASTURE_BUG_CATCH_DAILY_LIMIT,
  PASTURE_POKE_EMOJIS,
  PASTURE_PAT_DAILY_LIMIT,
  PASTURE_EMOJI_DAILY_LIMIT,
} from "@/lib/pasture";
import { getTodayDateString } from "@/lib/tasks/dailyTasks";
import type { PastureDoc, PetDoc, UserDoc } from "@/types/database";

interface PastureChickenData {
  uid: string;
  displayName: string;
  stage: string;
  healthStatus: string;
  currentAppearanceId: string | null;
  totalSolved: number;
  rebirthCount: number;
  isSelf: boolean;
}

const HEALTH_LABEL: Record<string, string> = {
  normal: "健康",
  slightly_sick: "小病中",
  severely_sick: "大病中",
  dead: "已死亡",
};

const STAGE_LABEL: Record<string, string> = {
  egg: "蛋",
  chick: "雛雞",
  teen: "青年雞",
  master: "大師雞",
};

/** 小雞偶爾冒出來的對話泡泡台詞（純裝飾，不代表任何真實資料） */
const SPEECH_BUBBLES = [
  "咕咕～",
  "今天有解題嗎？",
  "曬太陽好舒服",
  "誰要跟我下棋？",
  "肚子餓了 🌾",
  "這片草好綠！",
  "咕咕咕",
  "今天天氣真好",
  "要不要一起玩？",
  "我在找蟲蟲",
];

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 發推播通知，失敗不影響主要操作，靜默失敗就好（送表情/加好友共用） */
async function notify(toUid: string, type: string) {
  try {
    const headers = await getAuthHeader();
    await fetch("/api/notifications/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ toUid, type }),
    });
  } catch (error) {
    console.error("[pasture] 發送通知失敗（不影響主要操作）：", error);
  }
}

function PastureContent() {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);
  const payPastureEntry = useGameStore((s) => s.payPastureEntry);
  const claimPastureIncome = useGameStore((s) => s.claimPastureIncome);
  const recordPastureInteraction = useGameStore((s) => s.recordPastureInteraction);
  const catchPastureBug = useGameStore((s) => s.catchPastureBug);

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [chickens, setChickens] = useState<PastureChickenData[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [selectedChicken, setSelectedChicken] = useState<PastureChickenData | null>(null);
  const [findMeSignal, setFindMeSignal] = useState(0);
  const [economyMessage, setEconomyMessage] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  // 每次拍拍/送表情，遞增這個訊號並附上目標小雞 uid，讓
  // <PastureField> 對那隻小雞播放一次對應的飄浮動畫。
  const [interactionSignal, setInteractionSignal] = useState<{ uid: string; kind: string; seq: number } | null>(null);
  const [bugCatchRemaining, setBugCatchRemaining] = useState(PASTURE_BUG_CATCH_DAILY_LIMIT);

  // 今天是否已經付過入場費——沒付過就先不載入牧場成員名單（省一次
  // Firestore 讀取），改顯示規則說明 + 付費入場的畫面。
  const hasEnteredToday = !!user?.pastureEconomy && user.pastureEconomy.date === getTodayDateString();
  const todaysPastureIncome = hasEnteredToday ? user!.pastureEconomy!.incomeClaimedToday : null;

  // 今天已經抓過幾隻蟲，一開始就從 user 資料算好，之後每抓一隻就
  // 在本地遞減，不用重新整理頁面也能即時看到剩餘次數。
  useEffect(() => {
    if (!user) return;
    const today = getTodayDateString();
    const prog = user.dailyBugCatchProgress;
    const caughtToday = prog?.date === today ? prog.count : 0;
    setBugCatchRemaining(Math.max(0, PASTURE_BUG_CATCH_DAILY_LIMIT - caughtToday));
  }, [user?.uid, user?.dailyBugCatchProgress]);

  // 今天還能拍拍/送表情幾次（不分對象的總次數上限），從 user 資料
  // 直接算，不用另外存 state。
  const todayInteractProg =
    user?.dailyPastureInteractProgress?.date === getTodayDateString() ? user.dailyPastureInteractProgress : null;
  const patRemaining = Math.max(0, PASTURE_PAT_DAILY_LIMIT - (todayInteractProg?.patCount ?? 0));
  const emojiRemaining = Math.max(0, PASTURE_EMOJI_DAILY_LIMIT - (todayInteractProg?.emojiCount ?? 0));

  function handlePatChicken(chicken: PastureChickenData) {
    // 拍自己的小雞毫無意義，按鈕在 UI 上就不會出現，這裡是防呆。
    if (chicken.isSelf) return;
    const result = recordPastureInteraction(chicken.uid, "pat");
    if (!result.allowed) {
      setEconomyMessage("🤚 今天已經拍拍過了，明天再來吧！");
      return;
    }
    setInteractionSignal({ uid: chicken.uid, kind: "pat", seq: Date.now() });
    setEconomyMessage(`🤚 拍拍了 ${chicken.displayName} 的小雞！`);
  }

  function handleSendEmoji(chicken: PastureChickenData, emoji: string) {
    if (chicken.isSelf) return;
    const result = recordPastureInteraction(chicken.uid, "emoji");
    if (!result.allowed) {
      setEconomyMessage("😄 今天的表情額度用完了，明天再來吧！");
      return;
    }
    setInteractionSignal({ uid: chicken.uid, kind: emoji, seq: Date.now() });
    notify(chicken.uid, "pasture_poke");
    setEconomyMessage(`${emoji} 送給了 ${chicken.displayName} 一個招呼！`);
  }

  async function handleAddFriend(chicken: PastureChickenData) {
    if (!user || chicken.isSelf) return;
    const friends = user.friends ?? [];
    const outgoing = user.outgoingFriendRequestUids ?? [];
    if (friends.includes(chicken.uid) || outgoing.includes(chicken.uid)) return;

    const newOutgoing = [...outgoing, chicken.uid];
    setUser({ ...user, outgoingFriendRequestUids: newOutgoing });
    try {
      await updateDoc(doc(db, "users", user.uid), { outgoingFriendRequestUids: arrayUnion(chicken.uid) });
      await notify(chicken.uid, "friend_request");
      setEconomyMessage(`➕ 已經送出好友邀請給 ${chicken.displayName}！`);
    } catch (error) {
      console.error("[pasture] 送出好友邀請失敗：", error);
      setEconomyMessage("送出好友邀請失敗，請稍後再試。");
    }
  }

  function handleCatchBug() {
    const result = catchPastureBug();
    if (result.success) {
      setBugCatchRemaining(result.remainingToday);
      setEconomyMessage(`🐛 抓到一隻蟲！+${result.foodGained} 飼料（今天還能抓 ${result.remainingToday} 次）`);
    }
    return result.success;
  }

  function handlePayEntry() {
    setIsPaying(true);
    setPayError(null);
    const result = payPastureEntry();
    setIsPaying(false);
    if (!result.success) {
      setPayError(result.message);
      return;
    }
    if (!result.alreadyPaid) {
      setEconomyMessage(result.message);
    }
    // 付費成功後，下面的 effect 會偵測到 hasEnteredToday 變 true，
    // 自動去載入牧場成員名單，這裡不用手動觸發。
  }

  // 已經入場的狀態下，進頁面順便結算一次被動收入（背景累積的部分）。
  useEffect(() => {
    if (!user || !hasEnteredToday) return;
    const result = claimPastureIncome();
    if (result.incomeGained > 0) {
      setEconomyMessage(
        `💰 被動收入 +${result.incomeGained} 飼料（今日 ${result.incomeClaimedToday}/${PASTURE_DAILY_INCOME_CAP}）`
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, hasEnteredToday]);

  useEffect(() => {
    if (!user || !hasEnteredToday) return;
    let isCancelled = false;

    async function loadPasture() {
      setStatus("loading");
      setErrorMessage(null);
      try {
        let pastureId = user!.pastureId;
        if (!pastureId) {
          const headers = await getAuthHeader();
          const res = await fetch("/api/pasture/join", { method: "POST", headers });
          if (!res.ok) throw new Error("分配牧場失敗，請稍後再試。");
          const data = (await res.json()) as { pastureId: string };
          pastureId = data.pastureId;
          if (isCancelled) return;
          setUser({ ...user!, pastureId });
        }

        const pastureSnap = await getDoc(doc(db, "pastures", pastureId));
        if (!pastureSnap.exists()) throw new Error("找不到牧場資料。");
        const pasture = pastureSnap.data() as PastureDoc;
        if (isCancelled) return;
        setMemberCount(pasture.memberCount);

        const memberUids = pasture.memberUids;
        if (memberUids.length === 0) {
          setChickens([]);
          setStatus("success");
          return;
        }

        const [petsSnap, usersSnap] = await Promise.all([
          getDocs(query(collection(db, "pets"), where(documentId(), "in", memberUids))),
          getDocs(query(collection(db, "users"), where(documentId(), "in", memberUids))),
        ]);
        if (isCancelled) return;

        const userDataByUid = new Map<string, UserDoc>();
        usersSnap.docs.forEach((d) => {
          userDataByUid.set(d.id, d.data() as UserDoc);
        });

        const list: PastureChickenData[] = petsSnap.docs.map((d) => {
          const pet = d.data() as PetDoc;
          const userData = userDataByUid.get(d.id);
          return {
            uid: d.id,
            displayName: userData?.displayName ?? "同學",
            stage: pet.stage,
            healthStatus: pet.healthStatus,
            currentAppearanceId: pet.currentAppearanceId ?? null,
            totalSolved: userData?.stats?.totalSolved ?? 0,
            rebirthCount: userData?.rebirthCount ?? 0,
            isSelf: d.id === user!.uid,
          };
        });

        setChickens(list);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[pasture] 載入牧場失敗：", error);
        setErrorMessage(error instanceof Error ? error.message : "載入牧場時發生未知錯誤。");
        setStatus("error");
      }
    }

    loadPasture();
    return () => {
      isCancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, hasEnteredToday]);

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">🚜 牧場</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        {!hasEnteredToday ? (
          <PastureEntryGate
            foodCount={user?.foodCount ?? 0}
            isPaying={isPaying}
            payError={payError}
            onPay={handlePayEntry}
          />
        ) : (
          <>
            {economyMessage ? (
              <div className="mt-2 rounded-2xl bg-[#5B8C5A] px-4 py-2 text-center text-xs font-bold text-white shadow-md">
                {economyMessage}
              </div>
            ) : null}

            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-[#1A1A2E]/50">
                {status === "success" ? `這間牧場目前有 ${memberCount} 位同學` : "\u00A0"}
              </p>
              {todaysPastureIncome !== null ? (
                <span className="text-[10px] font-bold text-[#1A1A2E]/40">
                  🌾 今日被動收入 {todaysPastureIncome}/{PASTURE_DAILY_INCOME_CAP}
                </span>
              ) : null}
              {status === "success" && chickens.some((c) => c.isSelf) ? (
                <button
                  type="button"
                  onClick={() => setFindMeSignal((n) => n + 1)}
                  className="rounded-full bg-[#E8B84B] px-3 py-1 text-[11px] font-bold text-[#5C3D0A] shadow-sm transition-transform active:scale-95"
                >
                  📍 找到我的小雞
                </button>
              ) : null}
            </div>

            <div className="mt-2">
              {status === "loading" ? (
                <p className="py-20 text-center text-xs text-[#1A1A2E]/50">牧場載入中…</p>
              ) : status === "error" ? (
                <p className="py-20 text-center text-xs text-[#C0392B]">{errorMessage ?? "載入失敗，請稍後再試。"}</p>
              ) : (
                <PastureField
                  chickens={chickens}
                  onSelectChicken={setSelectedChicken}
                  findMeSignal={findMeSignal}
                  interactionSignal={interactionSignal}
                  bugCatchRemaining={bugCatchRemaining}
                  onCatchBug={handleCatchBug}
                />
              )}
            </div>

            <p className="mt-2 text-center text-[10px] text-[#1A1A2E]/30">
              點小雞可以看牠的狀態卡片，草地上的蟲可以點來抓（今天還能抓 {bugCatchRemaining} 次）
            </p>
          </>
        )}
      </div>

      {selectedChicken ? (
        <ChickenInfoCard
          chicken={selectedChicken}
          onClose={() => setSelectedChicken(null)}
          onPat={handlePatChicken}
          onSendEmoji={handleSendEmoji}
          onAddFriend={handleAddFriend}
          patRemaining={patRemaining}
          emojiRemaining={emojiRemaining}
          friendStatus={
            selectedChicken.isSelf
              ? "self"
              : (user?.friends ?? []).includes(selectedChicken.uid)
              ? "friend"
              : (user?.outgoingFriendRequestUids ?? []).includes(selectedChicken.uid)
              ? "pending"
              : "none"
          }
        />
      ) : null}
    </main>
  );
}

/**
 * 入場規則說明 + 付費入場按鈕。今天還沒付過入場費時顯示這個畫面，
 * 取代整個牧場草地——先讓學生看清楚規則（入場費多少、被動收入怎麼
 * 算、什麼時候重置），按下去才真的扣飼料、正式入場。
 */
function PastureEntryGate({
  foodCount,
  isPaying,
  payError,
  onPay,
}: {
  foodCount: number;
  isPaying: boolean;
  payError: string | null;
  onPay: () => void;
}) {
  const canAfford = foodCount >= PASTURE_ENTRY_FEE;

  return (
    <div className="mt-4 rounded-3xl bg-white/80 px-5 py-6 text-center shadow-sm">
      <p className="text-3xl">🚜🐣</p>
      <h2 className="mt-2 text-base font-extrabold text-[#1A1A2E]">歡迎來到牧場！</h2>
      <p className="mt-1 text-xs text-[#1A1A2E]/60">
        付一次入場費，小雞就能在草地上跟同學們一起跑一整天。
      </p>

      <div className="mt-4 space-y-2 rounded-2xl bg-[#FDF6E8] px-4 py-3 text-left text-xs text-[#1A1A2E]/80">
        <p>
          🎫 <span className="font-bold">入場費 {PASTURE_ENTRY_FEE} 飼料</span>：每天只收一次，付過之後今天都能自由進出。
        </p>
        <p>
          💰 <span className="font-bold">被動收入每小時 +{PASTURE_HOURLY_INCOME} 飼料</span>：入場後開始累積，就算沒開著頁面也照算，下次回來一次補發。
        </p>
        <p>
          📈 <span className="font-bold">單日上限 {PASTURE_DAILY_INCOME_CAP} 飼料</span>：被動收入最多算到這裡，之後要等明天重新開始。
        </p>
        <p>
          🕛 <span className="font-bold">每天 00:00 重置</span>：入場費跟被動收入額度都會重新來一次，要記得再付一次入場費。
        </p>
      </div>

      <p className="mt-3 text-xs text-[#1A1A2E]/50">目前飼料：{foodCount}</p>

      {payError ? (
        <p className="mt-2 text-xs font-bold text-[#C0392B]">{payError}</p>
      ) : null}

      <button
        type="button"
        onClick={onPay}
        disabled={isPaying || !canAfford}
        className={[
          "mt-4 w-full rounded-2xl px-4 py-3 text-sm font-bold shadow-sm transition-transform active:scale-95",
          canAfford
            ? "bg-[#E8B84B] text-[#5C3D0A]"
            : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/40",
        ].join(" ")}
      >
        {isPaying ? "入場中…" : canAfford ? `🎫 付費入場（-${PASTURE_ENTRY_FEE} 飼料）` : "飼料不足，無法入場"}
      </button>
    </div>
  );
}

/** 依現在時間分四個時段，決定草地的光線色調（純前端，每次進頁面重算一次） */
type TimeOfDay = "dawn" | "day" | "dusk" | "night";

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

const TIME_OF_DAY_GRADIENT: Record<TimeOfDay, string> = {
  dawn: "linear-gradient(180deg, #FFD9A0 0%, #B7D98A 45%, #8FBF6F 100%)",
  day: "linear-gradient(180deg, #A8D97F 0%, #8FBF6F 55%, #7CAE5E 100%)",
  dusk: "linear-gradient(180deg, #F0A85C 0%, #C98F6F 40%, #6E8F5C 100%)",
  night: "linear-gradient(180deg, #2B3A55 0%, #3E5240 45%, #37502F 100%)",
};

type Weather = "sunny" | "rainy" | "rainbow";

/** 一次進頁面抽一次天氣：大部分時候晴天，偶爾下雨，白天才有機會出彩虹 */
function rollWeather(timeOfDay: TimeOfDay): Weather {
  const roll = Math.random();
  if (roll < 0.15) return "rainy";
  if ((timeOfDay === "day" || timeOfDay === "dawn") && roll < 0.27) return "rainbow";
  return "sunny";
}

/**
 * 草地本體 + 所有小雞 + 背景飄動的雲 + 天氣 + 找蟲子小遊戲 + 裝飾用的
 * 蟲蟲/食物物件。小雞的隨機漫步邏輯全部包在 <WanderingChicken> 裡
 * （見那個元件開頭的說明），這裡負責畫布局跟所有背景/前景裝飾層。
 */
function PastureField({
  chickens,
  onSelectChicken,
  findMeSignal,
  interactionSignal,
  bugCatchRemaining,
  onCatchBug,
}: {
  chickens: PastureChickenData[];
  onSelectChicken: (chicken: PastureChickenData) => void;
  findMeSignal: number;
  interactionSignal: { uid: string; kind: string; seq: number } | null;
  bugCatchRemaining: number;
  onCatchBug: () => boolean;
}) {
  const decorations = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => ({
        id: i,
        left: Math.round((Math.sin(i * 12.9) * 0.5 + 0.5) * 100),
        top: Math.round((Math.sin(i * 37.3) * 0.5 + 0.5) * 100),
        emoji: ["🌼", "🌿", "☘️", "🌾"][i % 4],
      })),
    []
  );

  const clouds = useMemo(
    () =>
      Array.from({ length: 4 }, (_, i) => ({
        id: i,
        top: 5 + i * 8 + Math.sin(i * 5.1) * 4,
        duration: 40 + i * 15,
        delay: -i * 10,
        scale: 0.7 + (i % 3) * 0.25,
      })),
    []
  );

  // 天氣/時段：只在這個元件掛載時算一次，不會每次 re-render 重抽，
  // 不然雨會一直忽有忽無很奇怪。
  const timeOfDay = useMemo(() => getTimeOfDay(), []);
  const weather = useMemo(() => rollWeather(timeOfDay), [timeOfDay]);
  const isNight = timeOfDay === "night";

  const raindrops = useMemo(
    () =>
      weather === "rainy"
        ? Array.from({ length: 24 }, (_, i) => ({
            id: i,
            left: Math.round((Math.sin(i * 17.3) * 0.5 + 0.5) * 100),
            duration: 0.7 + Math.random() * 0.5,
            delay: Math.random() * 2,
          }))
        : [],
    [weather]
  );

  return (
    <div
      className="relative h-[70vh] min-h-[420px] w-full overflow-hidden rounded-3xl border-4 border-[#8FBF6F] shadow-inner"
      style={{ background: TIME_OF_DAY_GRADIENT[timeOfDay] }}
    >
      {/* 夜晚加一輪月亮、白天/清晨加太陽，純裝飾角落小圖示 */}
      <span className="pointer-events-none absolute right-4 top-3 select-none text-2xl opacity-80" aria-hidden="true">
        {isNight ? "🌙" : timeOfDay === "dusk" ? "🌇" : "☀️"}
      </span>

      {weather === "rainbow" ? (
        <span
          className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 select-none text-4xl opacity-70"
          aria-hidden="true"
        >
          🌈
        </span>
      ) : null}

      {weather === "rainy" ? (
        <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-60" aria-hidden="true">
          {raindrops.map((drop) => (
            <span
              key={drop.id}
              className="absolute top-[-5%] text-xs text-[#CFE8FF]"
              style={{
                left: `${drop.left}%`,
                animation: `pasture-rain-fall ${drop.duration}s linear infinite`,
                animationDelay: `${drop.delay}s`,
              }}
            >
              💧
            </span>
          ))}
        </div>
      ) : null}

      {/* 背景飄動的雲，純裝飾，跟小雞的漫步邏輯完全獨立 */}
      {clouds.map((cloud) => (
        <span
          key={cloud.id}
          className="pointer-events-none absolute select-none text-3xl opacity-40"
          style={{
            top: `${cloud.top}%`,
            left: "-15%",
            transform: `scale(${cloud.scale})`,
            animation: `pasture-cloud-drift ${cloud.duration}s linear infinite`,
            animationDelay: `${cloud.delay}s`,
          }}
          aria-hidden="true"
        >
          ☁️
        </span>
      ))}

      {decorations.map((d) => (
        <span
          key={d.id}
          className="absolute select-none text-lg opacity-70"
          style={{ left: `${d.left}%`, top: `${d.top}%` }}
          aria-hidden="true"
        >
          {d.emoji}
        </span>
      ))}

      {/* 純裝飾用的蟲蟲/食物物件：緩慢漂浮的蝴蝶、掉落的穀粒，不能點，
          外觀刻意跟下面「可以點來抓」的找蟲子小遊戲做出區隔。 */}
      <DecorativeCritters />

      {/* 找蟲子小遊戲：會冒出可以點的蟲，點到給飼料，每天有次數上限 */}
      <BugHuntLayer remaining={bugCatchRemaining} onCatch={onCatchBug} />

      {chickens.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white/80">
          這間牧場還沒有其他小雞 🐣
        </p>
      ) : (
        chickens.map((chicken) => (
          <WanderingChicken
            key={chicken.uid}
            chicken={chicken}
            onSelect={() => onSelectChicken(chicken)}
            findMeSignal={chicken.isSelf ? findMeSignal : 0}
            interactionSignal={interactionSignal?.uid === chicken.uid ? interactionSignal : null}
          />
        ))
      )}

      <style jsx>{`
        @keyframes pasture-cloud-drift {
          from {
            transform: translateX(0) scale(var(--cloud-scale, 1));
          }
          to {
            transform: translateX(130vw) scale(var(--cloud-scale, 1));
          }
        }
        @keyframes pasture-rain-fall {
          from {
            transform: translateY(0);
          }
          to {
            transform: translateY(75vh);
          }
        }
        @keyframes pasture-drift-float {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          50% {
            transform: translate(6px, -10px) rotate(8deg);
          }
          100% {
            transform: translate(-6px, 0) rotate(-4deg);
          }
        }
        @keyframes pasture-bug-wiggle {
          0%,
          100% {
            transform: translate(0, 0);
          }
          25% {
            transform: translate(3px, -2px);
          }
          75% {
            transform: translate(-3px, 2px);
          }
        }
      `}</style>
    </div>
  );
}

/** 純裝飾、不能點的漂浮蝴蝶 + 掉落穀粒，跟找蟲子小遊戲的蟲外觀刻意不同 */
function DecorativeCritters() {
  const critters = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        id: i,
        left: 5 + ((i * 19) % 90),
        top: 8 + ((i * 23) % 70),
        emoji: ["🦋", "🌾", "🍃", "🌾", "🦋"][i],
        duration: 4 + (i % 3),
        delay: i * 0.6,
      })),
    []
  );

  return (
    <>
      {critters.map((c) => (
        <span
          key={c.id}
          className="pointer-events-none absolute select-none text-sm opacity-50"
          style={{
            left: `${c.left}%`,
            top: `${c.top}%`,
            animation: `pasture-drift-float ${c.duration}s ease-in-out infinite`,
            animationDelay: `${c.delay}s`,
          }}
          aria-hidden="true"
        >
          {c.emoji}
        </span>
      ))}
    </>
  );
}

const BUG_EMOJIS = ["🐛", "🦗", "🐞"];
const BUG_LIFETIME_MS = 6000;
const BUG_RESPAWN_DELAY_MS = 2500;

interface ActiveBug {
  id: number;
  left: number;
  top: number;
  emoji: string;
}

/**
 * 找蟲子小遊戲：草地上每隔一段時間冒出一隻可以點的蟲，點到呼叫
 * onCatch()（實際發不發飼料由 store 那邊的每日次數上限決定），蟲會
 * 立刻消失並播放一個小動畫，過一段時間在別的地方重新冒出來。今天
 * 次數用完之後蟲就不會再冒出來了（remaining <= 0）。
 */
function BugHuntLayer({ remaining, onCatch }: { remaining: number; onCatch: () => boolean }) {
  const [bug, setBug] = useState<ActiveBug | null>(null);
  const [caughtEffect, setCaughtEffect] = useState<{ left: number; top: number; seq: number } | null>(null);
  const bugIdRef = useRef(0);

  useEffect(() => {
    if (remaining <= 0) {
      setBug(null);
      return;
    }

    let lifeTimer: ReturnType<typeof setTimeout>;
    let respawnTimer: ReturnType<typeof setTimeout>;

    function spawnBug() {
      bugIdRef.current += 1;
      setBug({
        id: bugIdRef.current,
        left: 10 + Math.random() * 80,
        top: 15 + Math.random() * 70,
        emoji: BUG_EMOJIS[Math.floor(Math.random() * BUG_EMOJIS.length)],
      });
      lifeTimer = setTimeout(() => {
        setBug(null);
        respawnTimer = setTimeout(spawnBug, BUG_RESPAWN_DELAY_MS);
      }, BUG_LIFETIME_MS);
    }

    const initialDelay = setTimeout(spawnBug, 1200);

    return () => {
      clearTimeout(initialDelay);
      clearTimeout(lifeTimer);
      clearTimeout(respawnTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining <= 0]);

  function handleClick() {
    if (!bug) return;
    const success = onCatch();
    if (success) {
      setCaughtEffect({ left: bug.left, top: bug.top, seq: Date.now() });
      setTimeout(() => setCaughtEffect(null), 900);
    }
    setBug(null);
  }

  return (
    <>
      {bug ? (
        <button
          type="button"
          onClick={handleClick}
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2 select-none text-2xl drop-shadow"
          style={{
            left: `${bug.left}%`,
            top: `${bug.top}%`,
            animation: "pasture-bug-wiggle 0.6s ease-in-out infinite",
          }}
          aria-label="抓蟲"
        >
          {bug.emoji}
        </button>
      ) : null}

      {caughtEffect ? (
        <span
          key={caughtEffect.seq}
          className="pointer-events-none absolute z-10 -translate-x-1/2 select-none text-xs font-bold text-[#5B8C5A]"
          style={{
            left: `${caughtEffect.left}%`,
            top: `${caughtEffect.top}%`,
            animation: "pasture-float-up 0.9s ease-out forwards",
          }}
        >
          +{PASTURE_BUG_CATCH_REWARD_FOOD} 🌾
        </span>
      ) : null}
    </>
  );
}

/**
 * 單隻小雞的隨機漫步動畫 + 對話泡泡 + 點擊互動。
 * ------------------------------------------------------------
 * 走動邏輯（用 requestAnimationFrame 驅動，直接操作 DOM transform，
 * 不經過 React state 更新，效能才夠同時跑 20 隻）維持原本設計不變；
 * 這次新增的是「對話泡泡」（每隔一段隨機時間冒出一句台詞，過幾秒
 * 自動消失）跟「找到我的小雞」信號（findMeSignal 每次遞增，觸發一次
 * 閃爍動畫）。
 */
function WanderingChicken({
  chicken,
  onSelect,
  findMeSignal,
  interactionSignal,
}: {
  chicken: PastureChickenData;
  onSelect: () => void;
  findMeSignal: number;
  interactionSignal: { uid: string; kind: string; seq: number } | null;
}) {
  const wrapperRef = useRef<HTMLButtonElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [jobImageFailed, setJobImageFailed] = useState(false);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [floatingEffect, setFloatingEffect] = useState<{ symbol: string; seq: number } | null>(null);

  // 拍拍 / 送表情：對應到這隻小雞的互動訊號進來時，播放一次飄浮動畫
  // （拍拍固定飄愛心，送表情就飄那個表情本身）。
  useEffect(() => {
    if (!interactionSignal) return;
    const symbol = interactionSignal.kind === "pat" ? "💕" : interactionSignal.kind;
    setFloatingEffect({ symbol, seq: interactionSignal.seq });
    const timer = setTimeout(() => setFloatingEffect(null), 1100);
    return () => clearTimeout(timer);
  }, [interactionSignal]);

  const { src: resolvedSrc, isJobImage } = getPetDisplaySrc(
    chicken.stage,
    chicken.healthStatus,
    chicken.currentAppearanceId
  );
  const petImageSrc =
    isJobImage && jobImageFailed ? getPetImagePath(chicken.stage, chicken.healthStatus) : resolvedSrc;

  // 走動動畫
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const img = imgRef.current;
    if (!wrapper || !img) return;

    if (chicken.healthStatus === "dead") {
      const x = 10 + Math.random() * 80;
      const y = 10 + Math.random() * 80;
      wrapper.style.left = `${x}%`;
      wrapper.style.top = `${y}%`;
      return;
    }

    let x = 10 + Math.random() * 80;
    let y = 10 + Math.random() * 80;
    let targetX = x;
    let targetY = y;
    let pauseUntil = 0;
    const speedPerSecond = chicken.healthStatus === "normal" ? 4 + Math.random() * 3 : 1.5 + Math.random() * 1.5;

    function pickNewTarget() {
      targetX = 8 + Math.random() * 84;
      targetY = 10 + Math.random() * 82;
      pauseUntil = Math.random() < 0.3 ? performance.now() + (1000 + Math.random() * 3000) : 0;
    }
    pickNewTarget();

    let lastTimestamp = performance.now();
    let rafId = 0;

    function tick(now: number) {
      const deltaSeconds = Math.min(0.1, (now - lastTimestamp) / 1000);
      lastTimestamp = now;

      if (now >= pauseUntil) {
        const dx = targetX - x;
        const dy = targetY - y;
        const distance = Math.hypot(dx, dy);

        if (distance < 1) {
          pickNewTarget();
        } else {
          const step = speedPerSecond * deltaSeconds;
          x += (dx / distance) * step;
          y += (dy / distance) * step;

          if (img) {
            img.style.transform = dx < 0 ? "scaleX(-1)" : "scaleX(1)";
          }
        }
      }

      if (wrapper) {
        wrapper.style.left = `${x}%`;
        wrapper.style.top = `${y}%`;
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chicken.uid, chicken.healthStatus]);

  // 對話泡泡：活著的小雞每隔一段隨機時間（8~20 秒）冒出一句話，
  // 顯示 2.5 秒後自動消失
  useEffect(() => {
    if (chicken.healthStatus === "dead") return;
    let bubbleTimer: ReturnType<typeof setTimeout>;
    let hideTimer: ReturnType<typeof setTimeout>;

    function scheduleNextBubble() {
      const delay = 8000 + Math.random() * 12000;
      bubbleTimer = setTimeout(() => {
        setBubbleText(SPEECH_BUBBLES[Math.floor(Math.random() * SPEECH_BUBBLES.length)]);
        hideTimer = setTimeout(() => {
          setBubbleText(null);
          scheduleNextBubble();
        }, 2500);
      }, delay);
    }
    scheduleNextBubble();

    return () => {
      clearTimeout(bubbleTimer);
      clearTimeout(hideTimer);
    };
  }, [chicken.uid, chicken.healthStatus]);

  // 「找到我的小雞」：訊號遞增時觸發一次閃爍效果
  useEffect(() => {
    if (findMeSignal === 0) return;
    setIsHighlighted(true);
    const timer = setTimeout(() => setIsHighlighted(false), 2400);
    return () => clearTimeout(timer);
  }, [findMeSignal]);

  return (
    <button
      type="button"
      ref={wrapperRef}
      onClick={onSelect}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-none"
      style={{ left: "50%", top: "50%" }}
    >
      {bubbleText ? (
        <span className="absolute -top-7 whitespace-nowrap rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#1A1A2E] shadow-md">
          {bubbleText}
          <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-white" />
        </span>
      ) : null}

      {floatingEffect ? (
        <span
          key={floatingEffect.seq}
          className="pointer-events-none absolute -top-2 left-1/2 select-none text-lg"
          style={{ animation: "pasture-float-up 1.1s ease-out forwards" }}
          aria-hidden="true"
        >
          {floatingEffect.symbol}
        </span>
      ) : null}

      {chicken.isSelf ? (
        <span className="absolute -top-2 h-3 w-3 animate-pulse rounded-full bg-[#E8B84B] ring-2 ring-white" />
      ) : null}

      <div
        className={[
          "rounded-full transition-shadow",
          isHighlighted ? "animate-bounce ring-4 ring-[#E8B84B] ring-offset-2" : "",
        ].join(" ")}
      >
        <img
          ref={imgRef}
          src={petImageSrc}
          alt={chicken.displayName}
          onError={() => {
            if (isJobImage && !jobImageFailed) setJobImageFailed(true);
          }}
          className={[
            "h-9 w-9 object-contain drop-shadow-md",
            chicken.healthStatus === "dead" ? "opacity-60 grayscale" : "",
          ].join(" ")}
        />
      </div>
      <span
        className={[
          "mt-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow-sm",
          chicken.isSelf ? "bg-[#E8B84B] text-[#5C3D0A]" : "bg-white/90 text-[#1A1A2E]",
        ].join(" ")}
      >
        {chicken.displayName}
      </span>
      {chicken.healthStatus !== "normal" ? (
        <span className="mt-0.5 rounded-full bg-[#C0392B]/90 px-1.5 py-0.5 text-[8px] font-bold text-white">
          {HEALTH_LABEL[chicken.healthStatus] ?? chicken.healthStatus}
        </span>
      ) : null}
    </button>
  );
}

/** 點小雞跳出來的資訊卡片：職業、成長階段、健康狀態、累計解題數、轉生次數，
 *  外加拍拍 / 送表情兩個互動按鈕（拍別人的小雞或送表情都會算一次牧場互動）。 */
function ChickenInfoCard({
  chicken,
  onClose,
  onPat,
  onSendEmoji,
  onAddFriend,
  patRemaining,
  emojiRemaining,
  friendStatus,
}: {
  chicken: PastureChickenData;
  onClose: () => void;
  onPat: (chicken: PastureChickenData) => void;
  onSendEmoji: (chicken: PastureChickenData, emoji: string) => void;
  onAddFriend: (chicken: PastureChickenData) => void;
  patRemaining: number;
  emojiRemaining: number;
  friendStatus: "self" | "friend" | "pending" | "none";
}) {
  const jobEntry = chicken.currentAppearanceId ? getCatalogEntryById(chicken.currentAppearanceId) : null;
  const { src: petImageSrc } = getPetDisplaySrc(chicken.stage, chicken.healthStatus, chicken.currentAppearanceId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-3xl bg-[#FDF6E8] px-5 py-6 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={petImageSrc}
          alt={chicken.displayName}
          className={["mx-auto h-20 w-20 object-contain", chicken.healthStatus === "dead" ? "opacity-60 grayscale" : ""].join(" ")}
        />
        <p className="mt-2 text-base font-extrabold text-[#1A1A2E]">
          {chicken.displayName}
          {chicken.isSelf ? <span className="ml-1 text-xs font-bold text-[#E8B84B]">（我）</span> : null}
        </p>

        {friendStatus === "none" ? (
          <button
            type="button"
            onClick={() => onAddFriend(chicken)}
            className="mt-1.5 rounded-full bg-[#5B8C5A] px-3 py-1 text-[11px] font-bold text-white shadow-sm transition-transform active:scale-95"
          >
            ➕ 加好友
          </button>
        ) : friendStatus === "pending" ? (
          <span className="mt-1.5 inline-block rounded-full bg-[#1A1A2E]/10 px-3 py-1 text-[11px] font-bold text-[#1A1A2E]/50">
            ⏳ 邀請已送出
          </span>
        ) : friendStatus === "friend" ? (
          <span className="mt-1.5 inline-block rounded-full bg-[#E8B84B]/30 px-3 py-1 text-[11px] font-bold text-[#5C3D0A]">
            ✅ 已經是好友
          </span>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2 text-left text-xs">
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <p className="text-[10px] text-[#1A1A2E]/50">職業</p>
            <p className="font-bold text-[#1A1A2E]">{jobEntry ? jobEntry.name : "尚未轉職"}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <p className="text-[10px] text-[#1A1A2E]/50">成長階段</p>
            <p className="font-bold text-[#1A1A2E]">{STAGE_LABEL[chicken.stage] ?? chicken.stage}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <p className="text-[10px] text-[#1A1A2E]/50">健康狀態</p>
            <p className="font-bold text-[#1A1A2E]">{HEALTH_LABEL[chicken.healthStatus] ?? chicken.healthStatus}</p>
          </div>
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <p className="text-[10px] text-[#1A1A2E]/50">累計解題</p>
            <p className="font-bold text-[#1A1A2E]">{chicken.totalSolved} 題</p>
          </div>
          <div className="col-span-2 rounded-xl bg-white/70 px-3 py-2">
            <p className="text-[10px] text-[#1A1A2E]/50">轉生次數</p>
            <p className="font-bold text-[#1A1A2E]">{chicken.rebirthCount} 次</p>
          </div>
        </div>

        {chicken.isSelf ? (
          <p className="mt-4 rounded-xl bg-white/50 px-3 py-2 text-xs text-[#1A1A2E]/50">
            😊 這是你自己的小雞，跟同學的小雞互動才能累積牧場任務進度喔！
          </p>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPat(chicken)}
                disabled={patRemaining <= 0}
                className={[
                  "flex-1 rounded-2xl px-3 py-2.5 text-sm font-bold shadow-sm transition-transform active:scale-95",
                  patRemaining > 0
                    ? "bg-[#E8B84B] text-[#5C3D0A]"
                    : "cursor-not-allowed bg-[#1A1A2E]/10 text-[#1A1A2E]/40",
                ].join(" ")}
              >
                {patRemaining > 0 ? "🤚 拍拍" : "🤚 今天拍過了"}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-center gap-1.5">
              {PASTURE_POKE_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onSendEmoji(chicken, emoji)}
                  disabled={emojiRemaining <= 0}
                  className={[
                    "flex h-9 w-9 items-center justify-center rounded-full text-lg shadow-sm transition-transform active:scale-90",
                    emojiRemaining > 0 ? "bg-white/70" : "cursor-not-allowed bg-white/30 opacity-40",
                  ].join(" ")}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-[#1A1A2E]/40">
              今天還能拍拍 {patRemaining} 次、送表情 {emojiRemaining} 次
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full rounded-2xl bg-[#5C3D0A] px-4 py-2.5 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95"
        >
          關閉
        </button>
      </div>
    </div>
  );
}

export default function PasturePage() {
  return (
    <RequireAuth requiredRole="student">
      <PastureContent />
    </RequireAuth>
  );
}
