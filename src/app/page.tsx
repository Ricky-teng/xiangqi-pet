/**
 * src/app/page.tsx
 *
 * 手遊大廳主頁與電子雞狀態控制台
 * ------------------------------------------------------------
 * 畫面分為三大區塊：
 *   (A) 寵物狀態區：小雞外觀（依健康狀態切換 emoji）、飽食度進度條、XP 進度條。
 *   (B) 玩家資產與互動區：飼料數量、「立即餵食」、「商店買藥」按鈕。
 *   (C) 挑戰入口：不再直接嵌入棋盤，改成一個「開始挑戰」按鈕，
 *       點擊後導向 /puzzles 題庫列表頁挑選題目。
 *
 * 視覺方向：
 *   暖米底色（#FDF6E8）營造棋桌氛圍；金色（#E8B84B）標籤是整頁唯一刻意
 *   華麗的「簽名元素」，呼應手遊「總戰力」金牌語彙，放在小雞正下方；
 *   其餘資源條、按鈕保持乾淨克制，避免過度裝飾。
 *
 * 這一版相對前一版的修正：
 *   1. 不再直接在首頁嵌入 <ChessBoard /> + 寫死的示範題目。原因：
 *      首頁應該是「狀態總覽 + 入口」，實際解題流程交給 /puzzle/[id]
 *      （已經接 Firestore 真實題目），首頁重複嵌入一份示範棋盤反而會
 *      讓學生分不清楚到底在哪裡解題、解的是不是「真的」題目。
 *      改成一個「🏆 開始挑戰」按鈕，導向 /puzzles 題庫列表頁。
 *   2. 移除金幣（goldCount）顯示——UserDoc 已經把這個從來沒被任何
 *      地方更新過的欄位整個拿掉了，這裡同步移除對應的 UI。
 *   3. XP 進度條的「各階段門檻」改成從 @/lib/pet/petGrowth 匯入共用常數，
 *      不再自己宣告一份，避免跟 useGameStore.ts 的孵化／進化判斷邏輯
 *      各用各的數字、兩邊對不起來。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDocs, limit, orderBy, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { signOutUser } from "@/hooks/useAuth";
import RequireAuth from "@/components/RequireAuth";
import TutorialOverlay from "@/components/tutorial/TutorialOverlay";
import { JobChangeAnnouncementModal } from "@/components/JobChangeAnnouncementModal";
import { ResetCompensationModal } from "@/components/ResetCompensationModal";
import { hasUnreadAnnouncement } from "@/lib/announcements";
import { STAGE_XP_THRESHOLDS } from "@/lib/pet/petGrowth";
import { SICKNESS_ESCALATION_HOURS } from "@/lib/pet/petDecay";
import { getPetImagePath, getPetDisplaySrc } from "@/lib/pet/petImagePath";
import { getNextCatalogEntry, getXpNeededForNextJob, getMasterJobProgressPercent, isMaxJobLevel } from "@/lib/pet/catalog";
import { hasUnclaimedDailyTask, getTodayDateString } from "@/lib/tasks/dailyTasks";
import { CheckinModal } from "@/components/CheckinModal";
import type { DailyTaskDoc, UserDoc, VsComputerGameDoc } from "@/types/database";

// ============================================================
// 1. 小雞外觀對照（依階段 + 健康狀態）
// ============================================================

/**
 * 依小雞目前階段與健康狀態，決定中央大圖顯示的 emoji。
 * 生病狀態的視覺優先權最高（不論哪個階段，生病時都蓋上對應的不適表情）。
 */
/**
 * 依小雞目前階段與健康狀態，決定中央大圖要顯示哪一張圖片。
 * ------------------------------------------------------------
 * 原本用 emoji 字串（🥚🐣🐥🐓💀🤢🤮），現在改成讀取
 * public/pet/ 底下的圖片檔案，圖片本身由 ChatGPT 生成
 * （prompt 集放在 docs/pet-image-prompts.md）。
 *
 * 死亡時刻意依「死掉當下是哪個成長階段」分別顯示對應的死亡版本圖
 * （蛋死掉/雛雞死掉/青年雞死掉/大師雞死掉長得不一樣），不是像生病
 * 那樣固定一張通用圖——這裡能這樣做是因為 PetDoc.stage 在小雞死亡
 * 時不會被重置或清空（只有 healthStatus 變成 "dead"，stage 維持
 * 死掉當下的值），所以不需要額外的資料欄位記錄「死掉時是第幾階段」，
 * 直接讀現有的 pet.stage 就能組出正確的檔名。
 */
/**
 * 小雞時不時會說的話，依健康狀態分組（不分成長階段——蛋還不會說話，
 * 但蛋的健康狀態理論上一定是 normal，所以共用 normal 那組台詞也沒問題，
 * 邏輯上沒有蛋在喊「我快死了」這種矛盾情況）。每組挑好幾句隨機顯示，
 * 不要每次都講同一句，互動感才不會太呆板。
 */
const PET_DIALOGUE_LINES: Record<string, string[]> = {
  normal: [
    "今天也要加油解題喔！",
    "肚子餓餓的時候要記得餵我～",
    "咕咕咕～感覺今天運氣不錯！",
    "象棋好難，但是好好玩！",
    "陪我散散步嘛～",
  ],
  slightly_sick: [
    "咳咳…我好像有點不舒服…",
    "可以買藥水給我嗎？",
    "感覺懶懶的，不想動…",
  ],
  severely_sick: [
    "嗚…好不舒服…快救救我…",
    "拜託快點買大病藥水…",
    "我快撐不住了…",
  ],
  dead: ["……"],
};

/** 健康狀態的中文顯示文字 */
const HEALTH_STATUS_LABEL: Record<string, string> = {
  normal: "健康",
  slightly_sick: "生小病",
  severely_sick: "生大病",
  dead: "已死亡",
};

/** 寵物階段的中文顯示文字（給「開始挑戰」按鈕上方的小提示用） */
const STAGE_LABEL: Record<string, string> = {
  egg: "蛋",
  chick: "雛雞",
  teen: "青年雞",
  master: "大師雞",
};

// ============================================================
// 2. 主體頁面內容（實際的大廳畫面，包在 RequireAuth 裡才會被渲染）
// ============================================================

// ============================================================
// 2. 主體頁面內容（包在 RequireAuth 裡才會被渲染，依角色分流）
// ------------------------------------------------------------
// 老師不需要養小雞，不會用到餵食/藥水/挑戰這些區塊，所以拆成
// 兩個完全不同的畫面：老師看到的是「兩個大按鈕的導覽頁」，
// 學生才看到完整的養成 + 挑戰大廳。
// ============================================================

function HomePageContent() {
  const user = useGameStore((s) => s.user);

  // ---- 使用者資料尚未載入完成的保護性渲染 ----
  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FDF6E8]">
        <p className="text-[#1A1A2E]">資料載入中…</p>
      </main>
    );
  }

  if (user.role === "teacher") {
    return <TeacherHomeContent user={user} />;
  }

  return <StudentHomeContent user={user} />;
}

// ============================================================
// 2.1 老師首頁：只留登出 + 兩個導覽大按鈕，沒有寵物養成相關區塊
// ============================================================

function TeacherHomeContent({ user }: { user: UserDoc }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutUser();
    } catch (error) {
      console.error("[home] 登出失敗：", error);
      setIsSigningOut(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#FDF6E8] px-4 pt-4 pb-10">
      <div className="mx-auto w-full max-w-md flex-1">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-[#1A1A2E]/60">
            👋 {user.displayName}（老師）
          </p>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="text-xs font-bold text-[#C0392B] hover:underline disabled:opacity-50"
          >
            {isSigningOut ? "登出中…" : "登出"}
          </button>
        </div>

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <span className="text-5xl" role="img" aria-label="老師">
            🐔
          </span>
          <h1 className="text-lg font-bold text-[#1A1A2E]">歡迎回來，{user.displayName}</h1>
          <p className="text-xs text-[#1A1A2E]/60">選擇下面其中一項繼續</p>
        </div>

        <div className="mt-8 flex flex-col gap-4">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="flex flex-col items-center gap-1 rounded-3xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-6 shadow-md transition-transform active:scale-95"
          >
            <span className="text-3xl" aria-hidden="true">♟️</span>
            <span className="text-base font-extrabold text-[#5C3D0A]">視覺化擺子出題後台</span>
            <span className="text-xs font-medium text-[#5C3D0A]/70">建立、管理、上架／刪除殘局題目</span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/admin/dashboard")}
            className="flex flex-col items-center gap-1 rounded-3xl bg-white/70 px-4 py-6 shadow-sm transition-transform active:scale-95"
          >
            <span className="text-3xl" aria-hidden="true">📊</span>
            <span className="text-base font-extrabold text-[#1A1A2E]">學生答題監控後台</span>
            <span className="text-xs font-medium text-[#1A1A2E]/60">查看所有學生的解題狀況</span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/admin/tasks")}
            className="flex flex-col items-center gap-1 rounded-3xl bg-white/70 px-4 py-6 shadow-sm transition-transform active:scale-95"
          >
            <span className="text-3xl" aria-hidden="true">📋</span>
            <span className="text-base font-extrabold text-[#1A1A2E]">每日任務管理</span>
            <span className="text-xs font-medium text-[#1A1A2E]/60">新增、編輯、停用每日任務</span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/admin/announcements")}
            className="flex flex-col items-center gap-1 rounded-3xl bg-white/70 px-4 py-6 shadow-sm transition-transform active:scale-95"
          >
            <span className="text-3xl" aria-hidden="true">📢</span>
            <span className="text-base font-extrabold text-[#1A1A2E]">公告管理</span>
            <span className="text-xs font-medium text-[#1A1A2E]/60">發布、編輯、刪除公告（可附圖）</span>
          </button>
        </div>
      </div>
    </main>
  );
}

// ============================================================
// 2.2 學生首頁：完整的小雞養成 + 挑戰入口（原本的內容，未改動邏輯）
// ============================================================

const OUTCOME_LABEL: Record<"win" | "lose" | "draw", string> = {
  win: "🏆 獲勝",
  lose: "😢 落敗",
  draw: "🤝 和棋",
};

function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 小雞展示元件：圖片 + 左右走動動畫 + 不定時跳出對話框說話。
 * ------------------------------------------------------------
 * 【走動動畫】小雞在一個固定寬度的舞台範圍內，每隔一段隨機時間，
 * 隨機挑一個新的水平位置走過去（用 CSS transition 做平滑移動，
 * 不需要逐幀手動算位置）。面向方向（用 scaleX(-1) 翻轉圖片）依
 * 「這次要往左走還是往右走」決定，讓小雞看起來真的在走，不是用
 * 同一個固定姿勢瞬間移動。
 *
 * 死掉的小雞（healthStatus === "dead"）不會走動、不會說話，靜靜
 * 待在原地——這個狀態的小雞理論上就是「沒在動」，繼續播放走動動畫
 * 在情境上會很奇怪。
 *
 * 【對話框】每隔一段隨機時間（8~16 秒），從對應健康狀態的台詞池
 * 裡隨機挑一句，用對話框顯示幾秒後自動消失。
 */
/**
 * 小雞展示元件：固定不動的圖片 + 不定時跳出對話框說話 + 跳動特效。
 * ------------------------------------------------------------
 * triggerJump：外部呼叫這個函式時，小雞會做一次「跳一下」的動畫
 * （用 CSS keyframe translate-y 上下彈跳，大約 400ms）。
 * 餵食按鈕跟點擊小雞本身都會觸發這個特效。
 */
function LivingPetDisplay({
  stage,
  healthStatus,
  currentAppearanceId,
}: {
  stage: string;
  healthStatus: string;
  currentAppearanceId: string | null;
}) {
  const isAlive = healthStatus !== "dead";
  const [isJumping, setIsJumping] = useState(false);
  const [dialogueText, setDialogueText] = useState<string | null>(null);

  // 生病/瀕死/死亡狀態一律用原本的階段圖，只有健康狀態正常、而且
  // 已經轉職過，才顯示職業外觀圖（見 @/lib/pet/petImagePath.ts）。
  // 職業圖沿用圖鑑的圖檔，萬一哪天圖檔壞掉/被移除，載入失敗會自動
  // 退回原本的階段圖，不會讓小雞整隻消失不見。
  const [jobImageFailed, setJobImageFailed] = useState(false);
  const { src: resolvedSrc, isJobImage } = getPetDisplaySrc(stage, healthStatus, currentAppearanceId);
  const petImageSrc = isJobImage && jobImageFailed ? getPetImagePath(stage, healthStatus) : resolvedSrc;

  function triggerJump() {
    if (!isAlive) return;
    setIsJumping(true);
    setTimeout(() => setIsJumping(false), 400);
  }

  useEffect(() => {
    setJobImageFailed(false);
  }, [currentAppearanceId]);

  useEffect(() => {
    if (!isAlive) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    function scheduleNextLine() {
      const delayMs = 8000 + Math.random() * 8000;
      timeoutId = setTimeout(() => {
        const pool = PET_DIALOGUE_LINES[healthStatus] ?? PET_DIALOGUE_LINES.normal;
        const line = pool[Math.floor(Math.random() * pool.length)];
        setDialogueText(line);
        setTimeout(() => setDialogueText(null), 3500);
        scheduleNextLine();
      }, delayMs);
    }
    scheduleNextLine();
    return () => clearTimeout(timeoutId);
  }, [isAlive, healthStatus]);

  return (
    <div className="relative flex h-40 w-full items-end justify-center">
      {dialogueText ? (
        <div className="pointer-events-none absolute top-0 z-10 max-w-[80%] rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-[#1A1A2E] shadow-md">
          {dialogueText}
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-white" />
        </div>
      ) : null}

      <img
        src={petImageSrc}
        alt={`小雞，目前狀態：${HEALTH_STATUS_LABEL[healthStatus] ?? healthStatus}`}
        onClick={triggerJump}
        onError={() => {
          if (isJobImage && !jobImageFailed) setJobImageFailed(true);
        }}
        className={[
          "h-32 w-32 cursor-pointer object-contain transition-transform",
          isJumping ? "-translate-y-6 scale-110" : "translate-y-0 scale-100",
          "duration-200 ease-out",
        ].join(" ")}
        style={{ transitionProperty: "transform" }}
      />
    </div>
  );
}

function StudentHomeContent({ user }: { user: UserDoc }) {
  const router = useRouter();

  const pet = useGameStore((s) => s.pet);
  const claimDailyGrant = useGameStore((s) => s.claimDailyGrant);
  const setUser = useGameStore((s) => s.setUser);

  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [dailyGrantMessage, setDailyGrantMessage] = useState<string | null>(null);

  // ---- 每日任務：只為了首頁的「有未領取任務」紅點提示，抓一次啟用中
  // 的任務列表就好，不需要任務的完整內容（那是 /tasks 頁面的事）。
  // dailyTasksLoaded 額外用來擋下面的「自動彈出簽到視窗」——這個
  // Firestore 查詢是非同步的，簽到彈窗如果搶先彈出來，這時候
  // activeDailyTasks 還是空陣列，傳給 CheckinModal 的 checkinTasks
  // 也會是空的，導致簽到當下沒有任何任務可以發飼料（簽到記錄照樣寫入，
  // 但飼料是 0，要另外去 /tasks 頁面才能領到）——這是之前的 bug，
  // 修法是讓簽到彈窗也等這個查詢跑完才會自動彈出。這段要放在下面的
  // 簽到彈窗 useEffect 前面，因為那個 effect 要引用 dailyTasksLoaded。
  const [activeDailyTasks, setActiveDailyTasks] = useState<DailyTaskDoc[]>([]);
  const [dailyTasksLoaded, setDailyTasksLoaded] = useState(false);
  useEffect(() => {
    let isCancelled = false;
    getDocs(query(collection(db, "dailyTasks"), where("isActive", "==", true)))
      .then((snapshot) => {
        if (isCancelled) return;
        setActiveDailyTasks(snapshot.docs.map((docSnapshot) => docSnapshot.data() as DailyTaskDoc));
      })
      .catch((error) => {
        console.error("[home] 讀取每日任務列表失敗（不影響其他功能，只是紅點提示不會顯示）：", error);
      })
      .finally(() => {
        if (!isCancelled) setDailyTasksLoaded(true);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // 只為了首頁「公告」入口的紅點提示，抓最新一則公告的 createdAt 就好，
  // 不需要抓完整公告列表（那是 /announcements 頁面的事）。查詢失敗
  // 不影響其他功能，紅點就是不顯示而已。
  const [latestAnnouncementCreatedAt, setLatestAnnouncementCreatedAt] = useState(0);
  useEffect(() => {
    let isCancelled = false;
    getDocs(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(1)))
      .then((snapshot) => {
        if (isCancelled) return;
        const latest = snapshot.docs[0]?.data()?.createdAt ?? 0;
        setLatestAnnouncementCreatedAt(latest);
      })
      .catch((error) => {
        console.error("[home] 讀取最新公告時間失敗（不影響其他功能，只是紅點提示不會顯示）：", error);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // 新手教學：只有 hasSeenTutorial 明確是 false（新帳號）才會顯示，
  // 舊帳號沒有這個欄位（undefined）不會被強制看教學。
  const [showTutorial, setShowTutorial] = useState(user.hasSeenTutorial === false);

  function finishTutorial() {
    setShowTutorial(false);
    const now = Date.now();
    setUser({ ...user, hasSeenTutorial: true, updatedAt: now });
    updateDoc(doc(db, "users", user.uid), { hasSeenTutorial: true, updatedAt: now }).catch(console.error);
  }

  // 進大廳時：今天還沒簽到、而且每日任務列表也已經載入完成，
  // 才自動跳出簽到彈框（教學顯示期間、任務列表還沒載入完成時都先不跳，
  // 避免簽到當下 checkinTasks 是空的導致沒發到飼料——見上面
  // dailyTasksLoaded 的說明）。
  useEffect(() => {
    if (showTutorial || !dailyTasksLoaded) return;
    const today = getTodayDateString();
    const history = user.checkinHistory ?? [];
    if (!history.includes(today)) {
      setShowCheckinModal(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTutorial, dailyTasksLoaded]);

  // 轉職系統改版公告：排在教學、簽到彈框都關閉之後才顯示，避免多個
  // 全螢幕彈窗疊在一起。只有舊帳號（hasSeenJobChangeAnnouncement
  // 不是 true）才會看到，看完按「知道了」才寫回 Firestore。
  const [showJobChangeAnnouncement, setShowJobChangeAnnouncement] = useState(false);
  useEffect(() => {
    if (showTutorial || showCheckinModal) return;
    if (user.hasSeenJobChangeAnnouncement !== true) {
      setShowJobChangeAnnouncement(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTutorial, showCheckinModal]);

  function finishJobChangeAnnouncement() {
    setShowJobChangeAnnouncement(false);
    const now = Date.now();
    setUser({ ...user, hasSeenJobChangeAnnouncement: true, updatedAt: now });
    updateDoc(doc(db, "users", user.uid), { hasSeenJobChangeAnnouncement: true, updatedAt: now }).catch(console.error);
  }

  // 轉生機制改版補償：排在教學、簽到、轉職公告都關閉之後才顯示，
  // 避免多個全螢幕彈窗疊在一起。只有舊帳號
  // （hasClaimedResetCompensation 不是 true）才會看到，按「領取」
  // 才會真的發飼料、寫回 Firestore（見 useGameStore.ts 的
  // claimResetCompensation）。
  const claimResetCompensation = useGameStore((s) => s.claimResetCompensation);
  const [showResetCompensation, setShowResetCompensation] = useState(false);
  useEffect(() => {
    if (showTutorial || showCheckinModal || showJobChangeAnnouncement) return;
    if (user.hasClaimedResetCompensation !== true) {
      setShowResetCompensation(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTutorial, showCheckinModal, showJobChangeAnnouncement]);

  function handleClaimResetCompensation() {
    claimResetCompensation();
    setShowResetCompensation(false);
  }

  function handleStartBattle() {
    // 按下配對時才檢查救助金——飼料不足 50 且今天還沒領過，先補再進
    const result = claimDailyGrant();
    if (result.granted) {
      setDailyGrantMessage("🎁 每日救助金 +50 飼料！讓你可以參加今天的作戰！");
      setTimeout(() => setDailyGrantMessage(null), 5000);
      // 給 state 更新一個 tick 的時間後再跳轉
      setTimeout(() => router.push("/battle"), 50);
    } else {
      router.push("/battle");
    }
  }

  function handleStartMatch() {
    const result = claimDailyGrant();
    if (result.granted) {
      setDailyGrantMessage("🎁 每日救助金 +50 飼料！讓你可以參加今天的對局！");
      setTimeout(() => setDailyGrantMessage(null), 5000);
      setTimeout(() => router.push("/match"), 50);
    } else {
      router.push("/match");
    }
  }

  const changeJob = useGameStore((s) => s.changeJob);
  const rebirthPet = useGameStore((s) => s.rebirthPet);
  const resurrectPet = useGameStore((s) => s.resurrectPet);
  // ---- 轉職（圖鑑收藏系統）相關狀態 ----
  const [jobChangeMessage, setJobChangeMessage] = useState<string | null>(null);
  const [isChangingJob, setIsChangingJob] = useState(false);

  function handleChangeJob() {
    setIsChangingJob(true);
    const result = changeJob();
    setJobChangeMessage(result.message);
    setIsChangingJob(false);
  }

  // ---- 轉生（圖鑑收藏系統）相關狀態 ----
  const [rebirthMessage, setRebirthMessage] = useState<string | null>(null);
  const [isRebirthing, setIsRebirthing] = useState(false);

  function handleRebirth() {
    setIsRebirthing(true);
    const result = rebirthPet();
    setRebirthMessage(result.message);
    setIsRebirthing(false);
  }

  // ---- 復活（死亡後的補救措施，跟轉生是兩個不同機制）相關狀態 ----
  const [resurrectMessage, setResurrectMessage] = useState<string | null>(null);
  const [isResurrecting, setIsResurrecting] = useState(false);

  function handleResurrect() {
    setIsResurrecting(true);
    const result = resurrectPet();
    setResurrectMessage(result.message);
    setIsResurrecting(false);
  }

  // ---- 寵物資料尚未載入完成的保護性渲染 ----
  if (!pet) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FDF6E8]">
        <p className="text-[#1A1A2E]">資料載入中…</p>
      </main>
    );
  }

  // ---- 計算飽食度、XP 進度條所需數值 ----
  const nextJobEntry = getNextCatalogEntry(pet.currentAppearanceId);
  const xpNeededForNextJob = getXpNeededForNextJob(pet.currentAppearanceId, pet.xp);
  const fullnessPercent = Math.max(0, Math.min(100, pet.fullness));
  // 畫面顯示用：只取到小數點後兩位。fullnessPercent 本身維持完整精度
  // （拿去算進度條寬度用），因為 petDecay.ts 是用「每小時 -2%」連續計算，
  // 數值天生就會帶一長串小數，只在「顯示給人看」這一層四捨五入即可，
  // 不需要、也不應該動到底層儲存/計算邏輯的精度。
  const fullnessDisplay = fullnessPercent.toFixed(2);

  const threshold = STAGE_XP_THRESHOLDS[pet.stage] ?? { from: 0, to: 100 };
  const stageRange = threshold.to - threshold.from;
  const xpIntoStage = Math.max(0, pet.xp - threshold.from);
  // 大師雞階段的成長區間（700~730）一旦被超過就永遠 100%，沒有意義，
  // 改用「這一階職業的轉職進度」取代，讓 XP 條在轉職期間持續有進度。
  const xpPercent = pet.stage === "master"
    ? getMasterJobProgressPercent(pet.currentAppearanceId, pet.xp)
    : (stageRange > 0 ? Math.min(100, (xpIntoStage / stageRange) * 100) : 0);

  // 修正：user.stats.winRate 這個欄位從來沒有任何地方真正寫入過
  // （usePuzzleSolver.ts 的 grantSolveReward 只 increment totalSolved/
  // totalAttempts，從未計算/寫回 winRate），永遠停在初始值 0。
  // 改成直接用 totalSolved/totalAttempts 即時算出來，不依賴那個
  // 從未同步更新的儲存欄位，就不會有兩邊算出來的數字對不上的問題。
  const winRatePercent =
    user.stats.totalAttempts > 0
      ? Math.round((user.stats.totalSolved / user.stats.totalAttempts) * 100)
      : 0;

  return (
    <>
      {showTutorial ? <TutorialOverlay onFinish={finishTutorial} /> : null}
    <main
      className="min-h-screen pb-10"
      style={user.activeBackground
        ? { backgroundImage: `url(/backgrounds/${user.activeBackground}.jpg)`, backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }
        : { backgroundColor: "#FDF6E8" }
      }
    >
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* ============================================================
            A. 頂部狀態列：顯示名稱在左，飼料數量＋設定入口在右，
               合併成同一條列（原本分兩列，改成同一個白底卡片）。
           ============================================================ */}
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-2 shadow-sm">
          <p className="text-xs font-medium text-[#1A1A2E]/60">
            👋 {user.displayName}（學生）
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-sm font-semibold text-[#8B5FBF]">
              <span aria-hidden="true">🟪</span>
              <span className="tabular-nums">{user.foodCount}</span>
            </div>
            <button
              type="button"
              onClick={() => router.push("/settings")}
              className="flex items-center gap-1 text-xs font-bold text-[#1A1A2E]/60 hover:underline"
            >
              ⚙️ 設定
            </button>
          </div>
        </header>

        {/* ============================================================
            A2. 主導覽 Tab Bar
            8 個項目用 4 欄排版（4+4 兩排，剛好填滿，不會有空格）。
           ============================================================ */}
        <nav className="mt-3 grid grid-cols-4 gap-1 rounded-2xl bg-white/70 p-1.5 shadow-sm">
          {[
            { href: "/shop", icon: "🏪", label: "商店" },
            { href: "/inventory", icon: "🎒", label: "物品" },
            { href: "/tasks", icon: "📋", label: "任務", badge: hasUnclaimedDailyTask(user, activeDailyTasks) },
            { href: "/leaderboard", icon: "🏆", label: "排行榜" },
            { href: "/catalog", icon: "📖", label: "圖鑑" },
            { href: "/badges", icon: "🎖️", label: "勳章" },
            { href: "/friends", icon: "👥", label: "好友" },
            { href: "/announcements", icon: "📢", label: "公告", badge: hasUnreadAnnouncement(user, latestAnnouncementCreatedAt) },
          ].map(({ href, icon, label, badge }) => (
            <button
              key={href}
              type="button"
              onClick={() => router.push(href)}
              className="relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 text-[#1A1A2E] transition-transform active:scale-95 hover:bg-[#E8B84B]/20"
            >
              <span className="text-lg">{icon}</span>
              <span className="text-[10px] font-bold">{label}</span>
              {badge ? (
                <span className="absolute right-1.5 top-1 h-2 w-2 rounded-full bg-[#C0392B]" />
              ) : null}
            </button>
          ))}
        </nav>

        {/* ============================================================
            B. 小雞展示區（獨立卡片，給小雞圖像足夠的呼吸空間）
            ------------------------------------------------------------
            原本這個 emoji 跟金色等級牌、三大屬性、兩條進度條全部擠在
            同一個 <section> 裡垂直堆疊，金色等級牌還用負邊距
            （-mt-2）往上貼，視覺上直接吃掉小雞圖像下緣的空間，看起來
            像被等級牌「擋住」。現在把「小雞長什麼樣子」這件事獨立成
            一張卡片，字級從 text-6xl 加大到 text-8xl，並給足夠的
            padding，其餘狀態資訊（等級、屬性、進度條）移到下面
            B'. 成長狀態區，兩者用各自獨立的卡片呈現，不再共用一個
            容器、不再互相擠壓。
           ============================================================ */}
        <section className="mt-3 flex flex-col items-center rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
          <LivingPetDisplay
            stage={pet.stage}
            healthStatus={pet.healthStatus}
            currentAppearanceId={pet.currentAppearanceId}
          />

          {/* 生病加重倒數提示 */}
          {pet.healthStatus === "slightly_sick" && pet.sickStartTime !== null ? (
            <SicknessCountdownBadge
              startTime={pet.sickStartTime}
              label="生小病"
              nextLabel="生大病"
            />
          ) : pet.healthStatus === "severely_sick" && pet.severeSickStartTime !== null ? (
            <SicknessCountdownBadge
              startTime={pet.severeSickStartTime}
              label="生大病"
              nextLabel="死亡"
            />
          ) : null}

          {/* 餵食按鈕：放在小雞正下方，一眼就找得到 */}
          <button
            type="button"
            onClick={() => router.push("/feed")}
            disabled={user.foodCount < 10 || pet.healthStatus === "dead" || pet.fullness >= 100}
            className={[
              "mt-3 rounded-2xl px-8 py-2.5 text-sm font-bold text-white shadow-md transition-transform active:scale-95",
              user.foodCount < 10 || pet.healthStatus === "dead" || pet.fullness >= 100
                ? "cursor-not-allowed bg-[#A9764C]/40"
                : "bg-[#C0392B]",
            ].join(" ")}
          >
            🍱 餵食小雞
          </button>
        </section>

        {/* ============================================================
            B'. 成長狀態區：三大屬性、飽食度/經驗值進度條、
                轉生/復活相關區塊。跟上面的小雞展示區分開。
                （原本這裡有顯示棋藝等級數字的金色等級牌，改成學生不
                直接看到自己的等級數字，所以拿掉了；等級仍在背景
                運作，只是不再用這個徽章展示出來。）
           ============================================================ */}
        <section className="mt-3 flex flex-col items-center rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
          {/* 三大屬性數值條 */}
          <div className="grid w-full grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/80 px-2 py-1.5">
              <div className="text-base" aria-hidden="true">
                ❤️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">
                {fullnessDisplay}/100
              </div>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-1.5">
              <div className="text-base" aria-hidden="true">
                ⚔️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">{winRatePercent}%</div>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-1.5">
              <div className="text-base" aria-hidden="true">
                🛡️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">
                {user.rebirthCount} 隻
              </div>
            </div>
          </div>

          {/* 飽食度進度條 */}
          <div className="mt-3 w-full">
            <div className="mb-1 flex justify-between text-xs font-medium text-[#1A1A2E]/70">
              <span>飽食度</span>
              <span className="tabular-nums">{fullnessDisplay}/100</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E5DFCB]">
              <div
                className="h-full rounded-full bg-[#5B8C5A] transition-all duration-300"
                style={{ width: `${fullnessPercent}%` }}
              />
            </div>
          </div>

          {/* XP 進度條：egg/chick/teen 階段顯示成長進度；master 階段
              改顯示轉職進度（見上面 xpPercent 的計算） */}
          <div className="mt-2 w-full">
            <div className="mb-1 flex justify-between text-xs font-medium text-[#1A1A2E]/70">
              <span>
                {pet.stage === "master" && nextJobEntry
                  ? `轉職進度：距離${nextJobEntry.name}（${pet.xp} XP）`
                  : `${STAGE_LABEL[pet.stage] ?? pet.stage}成長經驗值（${pet.xp} XP）`}
              </span>
              <span className="tabular-nums">{Math.round(xpPercent)}%</span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E5DFCB]">
              <div
                className="h-full rounded-full bg-[#E8B84B] transition-all duration-300"
                style={{ width: `${xpPercent}%` }}
              />
            </div>
          </div>

          {/* 轉職/轉生入口：只有大師雞（完全長大）才會出現。
              還沒轉到鳳凰雞之前顯示「轉職」——不是按一下扣一大筆飼料，
              是靠持續餵食累積 xp（大師雞之後 xp 不會停在 730，會一直
              往上加），累計 xp 跨過門檻按鈕才會真的能按（見
              @/lib/pet/catalog.ts 的 getXpNeededForNextJob）；轉到
              鳳凰雞之後顯示「轉生」（免費，真正把小雞重置回蛋，
              職業歸零，圖鑑蒐集紀錄不會消失）。 */}
          {pet.stage === "master" ? (
            isMaxJobLevel(pet.currentAppearanceId) ? (
              <div className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-2.5 text-center shadow-md">
                <p className="text-sm font-bold text-[#5C3D0A]">🦚 小雞已經轉職成鳳凰雞了！</p>
                <p className="mt-0.5 text-xs text-[#5C3D0A]/70">
                  轉生會讓小雞重新從蛋開始成長，準備下一輪轉職旅程（圖鑑蒐集紀錄不會消失）。
                </p>
                <button
                  type="button"
                  onClick={handleRebirth}
                  disabled={isRebirthing}
                  className="mt-2 w-full rounded-xl bg-[#5C3D0A] px-4 py-2 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                >
                  {isRebirthing ? "轉生中…" : "✨ 轉生"}
                </button>
              </div>
            ) : (
              <div className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-2.5 text-center shadow-md">
                <p className="text-sm font-bold text-[#5C3D0A]">🎉 小雞已經完全長大成熟了！</p>
                <p className="mt-0.5 text-xs text-[#5C3D0A]/70">
                  {nextJobEntry
                    ? xpNeededForNextJob !== null && xpNeededForNextJob > 0
                      ? `繼續餵食累積經驗值，還差 ${xpNeededForNextJob} 點就能轉職成${nextJobEntry.name}！`
                      : `經驗值已經足夠了，可以轉職成${nextJobEntry.name}了！`
                    : ""}
                </p>
                <button
                  type="button"
                  onClick={handleChangeJob}
                  disabled={isChangingJob || xpNeededForNextJob === null || xpNeededForNextJob > 0}
                  className="mt-2 w-full rounded-xl bg-[#5C3D0A] px-4 py-2 text-sm font-bold text-[#FDF6E8] shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                >
                  {isChangingJob ? "轉職中…" : `⚔️ 轉職成${nextJobEntry?.name ?? ""}`}
                </button>
              </div>
            )
          ) : null}

          {/* 復活入口：小雞死亡時出現。跟轉生是兩個不同機制（見 store 裡
              resurrectPet 的註解），死亡是沒照顧好的後果，復活是付費補救，
              不會解鎖圖鑑、不會增加轉生次數。 */}
          {pet.healthStatus === "dead" ? (
            <div className="mt-3 w-full rounded-2xl bg-[#1A1A2E]/5 px-4 py-2.5 text-center shadow-md">
              <p className="text-sm font-bold text-[#1A1A2E]">💔 小雞沒有得到及時醫治，已經死掉了……</p>
              <p className="mt-0.5 text-xs text-[#1A1A2E]/60">
                花費 30 飼料復活小雞，會重新從蛋開始養（不會解鎖圖鑑、不計入轉生次數）。
              </p>
              <button
                type="button"
                onClick={handleResurrect}
                disabled={isResurrecting || user.foodCount < 30}
                className="mt-2 w-full rounded-xl bg-[#8B5FBF] px-4 py-2 text-sm font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
              >
                {isResurrecting ? "復活中…" : "💔 復活（30 飼料）"}
              </button>
            </div>
          ) : null}

          {/* 轉職結果訊息：跟轉生訊息同樣理由放在 master 判斷區塊「外面」，
              轉職成功後 currentAppearanceId 會立刻改變，畫面文案也會
              跟著換下一個職業，訊息放外面才不會被新的 banner 內容蓋掉。 */}
          {jobChangeMessage ? (
            <p className="mt-3 w-full rounded-xl bg-white/80 px-3 py-2 text-center text-xs font-medium text-[#5C3D0A]">
              {jobChangeMessage}
            </p>
          ) : null}

          {/* 轉生結果訊息：刻意放在 master 判斷區塊「外面」，
              因為轉生成功的瞬間 pet.stage 會立刻變成 egg，
              如果訊息放在上面那個 master-only 區塊裡，
              訊息會跟著 banner 一起消失，玩家根本看不到剛解鎖了什麼。 */}
          {rebirthMessage ? (
            <p className="mt-3 w-full rounded-xl bg-white/80 px-3 py-2 text-center text-xs font-medium text-[#5C3D0A]">
              {rebirthMessage}
            </p>
          ) : null}

          {/* 復活結果訊息：同樣理由，放在 dead 判斷區塊「外面」，
              復活成功後 pet.healthStatus 會變回 normal，banner 會立刻消失。 */}
          {resurrectMessage ? (
            <p className="mt-3 w-full rounded-xl bg-white/80 px-3 py-2 text-center text-xs font-medium text-[#8B5FBF]">
              {resurrectMessage}
            </p>
          ) : null}
        </section>

        {/* ============================================================
            C~E2. 四個遊戲入口（殘局挑戰／電腦對弈／殘局作戰／配對對弈）
            合併成一個 2x2 緊湊格子，取代原本四張各自獨立、標題+說明+
            大按鈕的滿版卡片——內容一樣，只是不再各自佔一整排。
            殘局作戰／配對對弈的「飼料不足」提示縮短成一行小字，直接
            放在按鈕正下方，不再是獨立的一大塊提示框。
           ============================================================ */}
        {dailyGrantMessage ? (
          <div className="mt-3 rounded-2xl bg-[#5B8C5A] px-4 py-2.5 text-center text-sm font-bold text-white shadow-md">
            {dailyGrantMessage}
          </div>
        ) : null}
        <section className="mt-3 rounded-3xl bg-white/60 px-3 py-3 shadow-sm">
          {(() => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const canGetGrant = user.foodCount < 20 && user.lastDailyGrantDate !== todayStr;
            const effectiveFoodCount = canGetGrant ? user.foodCount + 50 : user.foodCount;
            const canBattleOrMatch = effectiveFoodCount >= 20;
            const shortageHint = !canBattleOrMatch
              ? "飼料不足，無法參賽"
              : user.foodCount < 20
                ? "🎁 會自動領今日救助金"
                : null;

            return (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/puzzle")}
                  className="flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-2 py-3 shadow-md transition-transform active:scale-95"
                >
                  <span className="text-2xl">🚀</span>
                  <span className="text-xs font-extrabold text-[#5C3D0A]">殘局挑戰</span>
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/play")}
                  className="flex flex-col items-center gap-1 rounded-2xl bg-gradient-to-b from-[#8B5FBF] to-[#6B4593] px-2 py-3 shadow-md transition-transform active:scale-95"
                >
                  <span className="text-2xl">♟️</span>
                  <span className="text-xs font-extrabold text-white">電腦對弈</span>
                </button>

                <button
                  type="button"
                  onClick={handleStartBattle}
                  disabled={!canBattleOrMatch}
                  className="flex flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-b from-[#C0392B] to-[#922B21] px-2 py-3 shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-2xl">⚔️</span>
                  <span className="text-xs font-extrabold text-white">殘局作戰</span>
                  <span className="text-[9px] font-medium text-white/80">
                    {shortageHint ?? "入場 20 飼料"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleStartMatch}
                  disabled={!canBattleOrMatch}
                  className="flex flex-col items-center gap-0.5 rounded-2xl bg-gradient-to-b from-[#8B5FBF] to-[#6B4593] px-2 py-3 shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-2xl">♟️</span>
                  <span className="text-xs font-extrabold text-white">配對對弈</span>
                  <span className="text-[9px] font-medium text-white/80">
                    {shortageHint ?? "入場 20 飼料"}
                  </span>
                </button>
              </div>
            );
          })()}
        </section>

        {/* ============================================================
            F. 最近對局：學生自己的對弈紀錄，點進去可以回顧+分析+推演
           ============================================================ */}
        <RecentGamesSection userUid={user.uid} />
      </div>

      {/* 每日簽到彈框 */}
      <CheckinModal
        open={showCheckinModal}
        onClose={() => setShowCheckinModal(false)}
        checkinTasks={activeDailyTasks.filter((t) => t.taskType === "checkin")}
      />

      {/* 轉職系統改版公告：只有舊帳號會看到一次 */}
      <JobChangeAnnouncementModal
        open={showJobChangeAnnouncement}
        onClose={finishJobChangeAnnouncement}
      />

      {/* 轉生機制改版補償：只有舊帳號會看到一次，金額依累計解題數算好傳進去 */}
      <ResetCompensationModal
        open={showResetCompensation}
        amount={(() => {
          const totalSolved = user.stats?.totalSolved ?? 0;
          return totalSolved > 1000 ? 5000 : totalSolved * 10;
        })()}
        onClaim={handleClaimResetCompensation}
      />
    </main>
    </>
  );
}

/** 學生自己的最近對局列表，點一筆進去可以回顧/分析/推演（見 /play/review/[gameId]） */
function RecentGamesSection({ userUid }: { userUid: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [games, setGames] = useState<VsComputerGameDoc[]>([]);

  useEffect(() => {
    let isCancelled = false;

    async function fetchRecentGames() {
      try {
        const snapshot = await getDocs(
          query(
            collection(db, "users", userUid, "vsComputerGames"),
            orderBy("playedAt", "desc"),
            limit(5)
          )
        );
        if (isCancelled) return;
        setGames(snapshot.docs.map((docSnapshot) => docSnapshot.data() as VsComputerGameDoc));
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[home] 讀取最近對局失敗：", error);
        setStatus("error");
      }
    }

    fetchRecentGames();
    return () => {
      isCancelled = true;
    };
  }, [userUid]);

  if (status === "loading") return null; // 安靜載入，不需要額外的轉圈圈打斷首頁節奏
  if (status === "error") return null; // 讀不到就不顯示這個區塊，不影響首頁其他功能

  return (
    <section className="mt-3 rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
      <h2 className="mb-2 text-center text-sm font-bold text-[#1A1A2E]">📺 最近對局</h2>
      {games.length === 0 ? (
        <p className="text-center text-xs text-[#1A1A2E]/50">還沒有對弈紀錄，去跟電腦下一局吧！</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {games.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                onClick={() => router.push(`/play/review/${game.id}`)}
                className="flex w-full items-center justify-between rounded-2xl bg-white/80 px-4 py-3 text-left shadow-sm transition-transform active:scale-95"
              >
                <span>
                  <span className="block text-sm font-bold text-[#1A1A2E]">
                    {OUTCOME_LABEL[game.outcome]}
                    <span className="ml-1 text-xs font-normal text-[#1A1A2E]/50">
                      對手 Lv.{game.opponentLevel}・{game.moveHistory.length}手
                    </span>
                  </span>
                  <span className="text-xs text-[#1A1A2E]/40">{formatTimestamp(game.playedAt)}</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-[#8B5FBF]">回顧 ›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ============================================================
// 3. 預設匯出：包上 RequireAuth 路由守衛
// ------------------------------------------------------------
// 大廳首頁任何角色（學生／老師）登入後都能看，所以不指定 requiredRole，
// 實際依角色顯示不同內容的邏輯在 HomePageContent 裡處理。
// ============================================================

export default function HomePage() {
  return (
    <RequireAuth>
      <HomePageContent />
    </RequireAuth>
  );
}

// ============================================================
// 4. 生病惡化倒數提示小元件
// ------------------------------------------------------------
// 顯示「已經生病多久」+「還剩多久會惡化成下一階段」，讓學生平時
// 在主頁就能持續看到警示，不是只在剛好惡化的那一刻才被通知到。
// ============================================================

function SicknessCountdownBadge({
  startTime,
  label,
  nextLabel,
}: {
  /** 這次生病（或加重）開始的時間戳記 */
  startTime: number;
  /** 目前病況的中文顯示文字，例如「生小病」 */
  label: string;
  /** 再惡化下去會變成的下一個狀態，例如「生大病」 */
  nextLabel: string;
}) {
  const hoursElapsed = (Date.now() - startTime) / (60 * 60 * 1000);
  const hoursRemaining = Math.max(0, SICKNESS_ESCALATION_HOURS - hoursElapsed);

  // 用「時:分」格式顯示剩餘時間，比小數點的小時數更好讀
  const totalMinutesRemaining = Math.round(hoursRemaining * 60);
  const hoursPart = Math.floor(totalMinutesRemaining / 60);
  const minutesPart = totalMinutesRemaining % 60;

  return (
    <div className="mt-1 rounded-full bg-[#C0392B]/10 px-3 py-1 text-center text-[11px] font-semibold text-[#C0392B]">
      🤒 目前{label}中，再過 {hoursPart} 時 {minutesPart} 分沒醫治會變成{nextLabel}！
    </div>
  );
}
