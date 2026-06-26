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
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { signOutUser } from "@/hooks/useAuth";
import RequireAuth from "@/components/RequireAuth";
import { STAGE_XP_THRESHOLDS } from "@/lib/pet/petGrowth";
import { SICKNESS_ESCALATION_HOURS } from "@/lib/pet/petDecay";
import { hasUnclaimedDailyTask } from "@/lib/tasks/dailyTasks";
import type { DailyTaskDoc, UserDoc } from "@/types/database";

// ============================================================
// 1. 小雞外觀對照（依階段 + 健康狀態）
// ============================================================

/**
 * 依小雞目前階段與健康狀態，決定中央大圖顯示的 emoji。
 * 生病狀態的視覺優先權最高（不論哪個階段，生病時都蓋上對應的不適表情）。
 */
function getPetEmoji(stage: string, healthStatus: string): string {
  if (healthStatus === "dead") return "💀";
  if (healthStatus === "severely_sick") return "🤮";
  if (healthStatus === "slightly_sick") return "🤢";

  switch (stage) {
    case "egg":
      return "🥚";
    case "chick":
      return "🐣";
    case "teen":
      return "🐥";
    case "master":
      return "🐓";
    default:
      return "🐣";
  }
}

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
        </div>
      </div>
    </main>
  );
}

// ============================================================
// 2.2 學生首頁：完整的小雞養成 + 挑戰入口（原本的內容，未改動邏輯）
// ============================================================

function StudentHomeContent({ user }: { user: UserDoc }) {
  const router = useRouter();

  const pet = useGameStore((s) => s.pet);
  const feedPet = useGameStore((s) => s.feedPet);
  const buyMedicine = useGameStore((s) => s.buyMedicine);
  const rebirthPet = useGameStore((s) => s.rebirthPet);
  const resurrectPet = useGameStore((s) => s.resurrectPet);

  // ---- 每日任務：只為了首頁的「有未領取任務」紅點提示，抓一次啟用中
  // 的任務列表就好，不需要任務的完整內容（那是 /tasks 頁面的事）。
  const [activeDailyTasks, setActiveDailyTasks] = useState<DailyTaskDoc[]>([]);
  useEffect(() => {
    let isCancelled = false;
    getDocs(query(collection(db, "dailyTasks"), where("isActive", "==", true)))
      .then((snapshot) => {
        if (isCancelled) return;
        setActiveDailyTasks(snapshot.docs.map((docSnapshot) => docSnapshot.data() as DailyTaskDoc));
      })
      .catch((error) => {
        console.error("[home] 讀取每日任務列表失敗（不影響其他功能，只是紅點提示不會顯示）：", error);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // ---- 登出狀態 ----
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await signOutUser();
      // 登出後 onAuthStateChanged 會把 user 設成 null，
      // 外層 <RequireAuth> 的 useEffect 偵測到後會自動導向 /login，
      // 這裡不需要、也不應該手動 router.push("/login")，
      // 避免跟 RequireAuth 的導頁邏輯互相搶跑。
    } catch (error) {
      console.error("[home] 登出失敗：", error);
      setIsSigningOut(false);
    }
  }

  // ---- 商店購買藥水後的提示訊息（短暫顯示用） ----
  const [shopMessage, setShopMessage] = useState<string | null>(null);

  /** 處理購買藥水按鈕點擊 */
  function handleBuyMedicine(type: "slightly" | "severely") {
    const result = buyMedicine(type);
    setShopMessage(result.message);
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
  const fullnessPercent = Math.max(0, Math.min(100, pet.fullness));
  // 畫面顯示用：只取到小數點後兩位。fullnessPercent 本身維持完整精度
  // （拿去算進度條寬度用），因為 petDecay.ts 是用「每小時 -2%」連續計算，
  // 數值天生就會帶一長串小數，只在「顯示給人看」這一層四捨五入即可，
  // 不需要、也不應該動到底層儲存/計算邏輯的精度。
  const fullnessDisplay = fullnessPercent.toFixed(2);

  const threshold = STAGE_XP_THRESHOLDS[pet.stage] ?? { from: 0, to: 100 };
  const stageRange = threshold.to - threshold.from;
  const xpIntoStage = Math.max(0, pet.xp - threshold.from);
  const xpPercent = stageRange > 0 ? Math.min(100, (xpIntoStage / stageRange) * 100) : 0;

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
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* ============================================================
            登入身分列：顯示名稱、登出
           ============================================================ */}
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-[#1A1A2E]/60">
            👋 {user.displayName}（學生）
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/tasks")}
              className="relative text-xs font-bold text-[#1A1A2E]/70 hover:underline"
            >
              📋 任務
              {hasUnclaimedDailyTask(user, activeDailyTasks) ? (
                <span
                  aria-label="有未領取的任務"
                  className="absolute -right-1.5 -top-1.5 h-2 w-2 rounded-full bg-[#C0392B]"
                />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => router.push("/leaderboard")}
              className="text-xs font-bold text-[#1A1A2E]/70 hover:underline"
            >
              🏆 排行榜
            </button>
            <button
              type="button"
              onClick={() => router.push("/catalog")}
              className="text-xs font-bold text-[#1A1A2E]/70 hover:underline"
            >
              📖 圖鑑
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="text-xs font-bold text-[#C0392B] hover:underline disabled:opacity-50"
            >
              {isSigningOut ? "登出中…" : "登出"}
            </button>
          </div>
        </div>

        {/* ============================================================
            A. 頂部狀態列
           ============================================================ */}
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-2 shadow-sm">
          <div className="flex items-center gap-1 text-sm font-semibold text-[#1A1A2E]">
            <span aria-hidden="true">⚡</span>
            <span className="tabular-nums">
              {user.stamina.current}/{user.stamina.max}
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm font-semibold text-[#8B5FBF]">
            <span aria-hidden="true">🟪</span>
            <span className="tabular-nums">{user.foodCount}</span>
          </div>
        </header>

        {/* ============================================================
            B. 中央舞台與狀態圖卡區
           ============================================================ */}
        <section className="mt-4 flex flex-col items-center rounded-3xl bg-white/60 px-4 py-6 shadow-sm">
          <div className="text-6xl" role="img" aria-label={`小雞，目前狀態：${HEALTH_STATUS_LABEL[pet.healthStatus]}`}>
            {getPetEmoji(pet.stage, pet.healthStatus)}
          </div>

          {/* 生病加重倒數提示：不是只在「剛好加重的那一刻」跳一次通知，
              平時待在這個頁面就能持續看到「還剩多久會惡化」，提醒要趕快去買藥。
              這裡用 SICKNESS_ESCALATION_HOURS 跟 sickStartTime/severeSickStartTime
              即時算出剩餘時間，數字每次畫面重新渲染就會重算一次
              （usePetTimeDecayTicker 每分鐘觸發一次重渲染，所以大約每分鐘會更新）。 */}
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

          {/* 金色等級牌（仿手遊「總戰力」標籤，本頁的簽名視覺元素） */}
          <div className="-mt-2 rounded-full border-2 border-[#C9962C] bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-5 py-1 text-sm font-extrabold text-[#5C3D0A] shadow-md">
            學生目前象棋等級：{user.chessLevel} 級
          </div>

          {/* 三大屬性數值條 */}
          <div className="mt-4 grid w-full grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <div className="text-lg" aria-hidden="true">
                ❤️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">
                {fullnessDisplay}/100
              </div>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <div className="text-lg" aria-hidden="true">
                ⚔️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">{winRatePercent}%</div>
            </div>
            <div className="rounded-xl bg-white/80 px-2 py-2">
              <div className="text-lg" aria-hidden="true">
                🛡️
              </div>
              <div className="text-xs font-semibold text-[#1A1A2E]">
                {user.rebirthCount} 隻
              </div>
            </div>
          </div>

          {/* 飽食度進度條 */}
          <div className="mt-4 w-full">
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

          {/* XP 進度條（依目前階段顯示階段內進度，門檻來自共用的 petGrowth.ts） */}
          <div className="mt-3 w-full">
            <div className="mb-1 flex justify-between text-xs font-medium text-[#1A1A2E]/70">
              <span>
                {STAGE_LABEL[pet.stage] ?? pet.stage}成長經驗值（{pet.xp} XP）
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

          {/* 轉生入口：只有大師雞（完全長大）才會出現 */}
          {pet.stage === "master" ? (
            <div className="mt-4 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-center shadow-md">
              <p className="text-sm font-bold text-[#5C3D0A]">🎉 小雞已經完全長大成熟了！</p>
              <p className="mt-0.5 text-xs text-[#5C3D0A]/70">
                轉生可以解鎖新的圖鑑款式，小雞會重新從蛋開始長大。
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
          ) : null}

          {/* 復活入口：小雞死亡時出現。跟轉生是兩個不同機制（見 store 裡
              resurrectPet 的註解），死亡是沒照顧好的後果，復活是付費補救，
              不會解鎖圖鑑、不會增加轉生次數。 */}
          {pet.healthStatus === "dead" ? (
            <div className="mt-4 w-full rounded-2xl bg-[#1A1A2E]/5 px-4 py-3 text-center shadow-md">
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
            B'. 玩家資產與互動區（立即餵食 / 商店買藥）
           ============================================================ */}
        <section className="mt-4 flex flex-col gap-3 rounded-3xl bg-white/60 px-4 py-4 shadow-sm">
          <button
            type="button"
            onClick={() => feedPet()}
            disabled={user.foodCount < 10}
            className={[
              "w-full rounded-2xl px-4 py-3 text-base font-bold text-white shadow-md transition-transform",
              user.foodCount < 10
                ? "cursor-not-allowed bg-[#A9764C]/50"
                : "bg-[#C0392B] active:scale-95",
            ].join(" ")}
          >
            🍚 立即餵食（消耗 10 飼料）
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleBuyMedicine("slightly")}
              disabled={pet.healthStatus !== "slightly_sick" || user.foodCount < 20}
              className={[
                "rounded-2xl px-3 py-2 text-sm font-bold text-white shadow-md transition-transform",
                pet.healthStatus !== "slightly_sick" || user.foodCount < 20
                  ? "cursor-not-allowed bg-[#5B8C5A]/40"
                  : "bg-[#5B8C5A] active:scale-95",
              ].join(" ")}
            >
              💊 小病藥水（20 飼料）
            </button>
            <button
              type="button"
              onClick={() => handleBuyMedicine("severely")}
              disabled={pet.healthStatus !== "severely_sick" || user.foodCount < 40}
              className={[
                "rounded-2xl px-3 py-2 text-sm font-bold text-white shadow-md transition-transform",
                pet.healthStatus !== "severely_sick" || user.foodCount < 40
                  ? "cursor-not-allowed bg-[#8B5FBF]/40"
                  : "bg-[#8B5FBF] active:scale-95",
              ].join(" ")}
            >
              🧪 大病藥水（40 飼料）
            </button>
          </div>

          {pet.healthStatus === "normal" || pet.healthStatus === "dead" ? (
            <p className="text-center text-[11px] text-[#1A1A2E]/40">
              小雞目前不需要吃藥，藥水按鈕已鎖定。
            </p>
          ) : null}

          {shopMessage ? (
            <p className="text-center text-xs font-medium text-[#1A1A2E]/70">{shopMessage}</p>
          ) : null}
        </section>

        {/* ============================================================
            C. 挑戰入口（不再內嵌棋盤，改成導向題庫列表頁）
           ============================================================ */}
        <section className="mt-4 rounded-3xl bg-white/60 px-4 py-5 shadow-sm">
          <h2 className="mb-3 text-center text-sm font-bold text-[#1A1A2E]">🏆 殘局挑戰</h2>
          <p className="mb-4 text-center text-xs text-[#1A1A2E]/60">
            前往題庫挑選一道殘局題目，解開它讓{STAGE_LABEL[pet.stage] ?? "小雞"}獲得飼料獎勵！
          </p>
          <button
            type="button"
            onClick={() => router.push("/puzzle")}
            className="w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-base font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
          >
            🚀 開始挑戰
          </button>
        </section>
      </div>
    </main>
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
