// src/app/explore/[tower]/page.tsx
"use client";

/**
 * 🗺️ 探險 — 第二層：一棟塔的 10 層樓
 * ------------------------------------------------------------
 * 畫面分成三種狀態，由同一頁切換（不轉頁，保持節奏）：
 *
 *   tower  → 一棟塔畫成建築，10 關 = 10 層樓，由下往上爬
 *   prep   → 準備頁：選小雞、看裝備、看這一關有幾隻怪
 *   battle → 戰鬥（BattleStage）→ 結算卡片（BattleResultCard）
 *
 * 重要：勝負在按下「開始」的那一刻就由 simulateBattle 算完了，
 * 之後的畫面只是播放。所以中途投降不會改寫結果，是直接以失敗結束。
 *
 * 次數規則：輸贏都扣一次，但「重打已經通關過的關卡」不扣。
 * 掉寶只有首通會掉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import BattleStage, { type BattleUnitVisual } from "@/components/battle/BattleStage";
import BattleResultCard from "@/components/battle/BattleResultCard";
import { simulateBattle, type BattleResult, type BattleUnit } from "@/lib/rpg/battle";
import { getBagCapacity, rollDropEquipment, type EquipmentItem } from "@/lib/rpg/equipment";
import {
  DAILY_EXPLORE_ATTEMPTS,
  HEAL_PERCENT_ON_KILL,
  STAGES_PER_TOWER,
  TOWER_COUNT,
  getStagePlan,
  getTowerTheme,
  rollDropCount,
} from "@/lib/rpg/monsters";
import {
  canPlayStage,
  isStageCleared,
  isTowerUnlocked,
} from "@/lib/exploreProgress";
import {
  getDeployablePets,
  getLoseHint,
  monsterToBattleUnit,
  monsterToBattleVisual,
  toBattleUnit,
  toBattleVisual,
  type DeployablePet,
} from "@/lib/rpg/deploy";
import { getJobColor } from "@/lib/rpg/jobVisual";

type View = "tower" | "prep" | "battle";

interface BattleSetup {
  stage: number;
  pet: DeployablePet;
  playerUnits: BattleUnit[];
  enemyUnits: BattleUnit[];
  visuals: BattleUnitVisual[];
  result: BattleResult;
  /** 這一場有沒有扣掉每日次數 */
  consumedAttempt: boolean;
  /** 是不是首通（決定掉不掉寶） */
  isFirstClear: boolean;
}

interface FinishedState {
  won: boolean;
  surrendered: boolean;
  drops: EquipmentItem[];
  bagWasFull: boolean;
  unlockedNextTower: boolean;
}

function TowerContent() {
  const router = useRouter();
  const params = useParams<{ tower: string }>();
  const towerNumber = Math.min(TOWER_COUNT, Math.max(1, Number(params.tower) || 1));
  const theme = getTowerTheme(towerNumber);

  const user = useGameStore((s) => s.user);
  const livingPet = useGameStore((s) => s.pet);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const loadCollectedPets = useGameStore((s) => s.loadCollectedPets);
  const progress = useGameStore((s) => s.exploreProgress);
  const progressLoaded = useGameStore((s) => s.exploreProgressLoaded);
  const loadExploreProgress = useGameStore((s) => s.loadExploreProgress);
  const finishExploreStage = useGameStore((s) => s.finishExploreStage);

  const [view, setView] = useState<View>("tower");
  const [prepStage, setPrepStage] = useState<number | null>(null);
  const [selectedPetId, setSelectedPetId] = useState<string | null>(null);
  const [setup, setSetup] = useState<BattleSetup | null>(null);
  const [finished, setFinished] = useState<FinishedState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * 這一場的結算有沒有處理過。
   *
   * BattleStage 的 onFinish 是靠 useEffect + setTimeout 呼叫的，而
   * handleBattleFinish 每次重新算（它的 useCallback 相依於 progress，
   * 而結算本身就會改 progress）身分就會變，effect 於是重跑、又排一次
   * timeout——結果同一場戰鬥結算好幾次，每次都再扣一次每日次數。
   * 實測是一場打完直接從 7 次剩餘掉到 0。用 ref 擋掉重複進入。
   */
  const finishHandledRef = useRef(false);

  useEffect(() => {
    void loadCollectedPets();
    void loadExploreProgress();
  }, [loadCollectedPets, loadExploreProgress]);

  const deployables = useMemo(
    () => getDeployablePets(collectedPets, livingPet),
    [collectedPets, livingPet],
  );

  // 預設選「能出戰的裡面總戰力最高的那隻」——學生九成是想派最強的，
  // 不該每次都要自己重選一遍。
  useEffect(() => {
    if (selectedPetId) return;
    const best = [...deployables]
      .filter((p) => p.blockReason === null)
      .sort((a, b) => b.totalPower - a.totalPower)[0];
    if (best) setSelectedPetId(best.id);
    else if (deployables.length > 0) setSelectedPetId(deployables[0].id);
  }, [deployables, selectedPetId]);

  const selectedPet = deployables.find((p) => p.id === selectedPetId) ?? null;
  const attemptsLeft = progress
    ? Math.max(0, DAILY_EXPLORE_ATTEMPTS - progress.dailyAttemptsUsed)
    : 0;

  const handleStart = useCallback(() => {
    if (!progress || !selectedPet || prepStage === null) return;

    const alreadyCleared = isStageCleared(progress, towerNumber, prepStage);
    const consumedAttempt = !alreadyCleared;

    if (consumedAttempt && attemptsLeft <= 0) {
      setErrorMessage("今天的探險次數用完了，明天台北時間 00:00 會重置。");
      return;
    }
    if (selectedPet.blockReason) {
      setErrorMessage(selectedPet.blockReason);
      return;
    }

    const plan = getStagePlan(towerNumber, prepStage);
    const playerUnits = [toBattleUnit(selectedPet, "p0", "player")];
    const enemyUnits = plan.monsters.map((m, i) => monsterToBattleUnit(m, `e${i}`));
    const visuals: BattleUnitVisual[] = [
      toBattleVisual(selectedPet, "p0"),
      ...plan.monsters.map((m, i) => monsterToBattleVisual(m, `e${i}`)),
    ];

    const result = simulateBattle(playerUnits, enemyUnits, {
      mode: "sequential",
      // 種子帶上時間，讓同一關每次重打的 ±10% 浮動不一樣
      seed: (towerNumber * 1000 + prepStage) * 7919 + (Date.now() % 100000),
      healPercentOnKill: HEAL_PERCENT_ON_KILL,
    });

    setSetup({
      stage: prepStage,
      pet: selectedPet,
      playerUnits,
      enemyUnits,
      visuals,
      result,
      consumedAttempt,
      isFirstClear: !alreadyCleared,
    });
    finishHandledRef.current = false;
    setErrorMessage(null);
    setView("battle");
  }, [attemptsLeft, prepStage, progress, selectedPet, towerNumber]);

  const handleBattleFinish = useCallback(
    (outcome: { winner: string; surrendered: boolean }) => {
      if (!setup || !progress) return;
      if (finishHandledRef.current) return;
      finishHandledRef.current = true;

      const won = outcome.winner === "player" && !outcome.surrendered;

      // 掉寶只有首通會掉，而且一律第 1 階
      const drops: EquipmentItem[] = [];
      if (won && setup.isFirstClear) {
        // 每一關最後都有 Boss，所以通關一律走 Boss 的掉落率（100% 掉 2 個）
        const count = rollDropCount(true);
        for (let i = 0; i < count; i++) drops.push(rollDropEquipment(Date.now() + i));
      }

      // 背包塞不下的多出來的直接丟掉。在這裡就先算好，結算卡片才能
      // 立刻顯示真正拿到的那幾件。
      const bag = user?.equipmentBag ?? [];
      const free = Math.max(0, getBagCapacity(user?.bagExpandCount ?? 0) - bag.length);
      const accepted = drops.slice(0, free);
      const bagWasFull = accepted.length < drops.length;

      const willUnlockNextTower =
        won &&
        setup.isFirstClear &&
        setup.stage === STAGES_PER_TOWER &&
        towerNumber === progress.unlockedTower &&
        towerNumber < TOWER_COUNT;

      // ⚠️ 先把結算卡片顯示出來，寫 Firestore 丟到背景跑。
      // 原本是 await 寫入完成才顯示卡片，實測在離線／網路不穩的時候
      // Firebase SDK 會把寫入排進佇列、promise 遲遲不 resolve，學生就
      // 一直卡在打完的戰鬥畫面，什麼都沒發生。結算資料本來就已經在
      // 本地算完了，沒有理由等網路。
      setFinished({
        won,
        surrendered: outcome.surrendered,
        drops: accepted,
        bagWasFull,
        unlockedNextTower: willUnlockNextTower,
      });

      void finishExploreStage({
        tower: towerNumber,
        stage: setup.stage,
        won,
        consumedAttempt: setup.consumedAttempt,
        drops: accepted,
        petId: setup.pet.isLiving ? null : setup.pet.id,
      });
    },
    [finishExploreStage, progress, setup, towerNumber, user],
  );

  function backToTower() {
    setFinished(null);
    setSetup(null);
    setPrepStage(null);
    setView("tower");
  }

  function goNextStage() {
    if (!setup) return;
    const next = setup.stage + 1;
    setFinished(null);
    setSetup(null);
    if (next > STAGES_PER_TOWER) {
      setView("tower");
      setPrepStage(null);
      return;
    }
    setPrepStage(next);
    setView("prep");
  }

  if (!user) return null;

  if (!progressLoaded || !progress) {
    return (
      <main className="min-h-screen bg-[#FDF6E8] pb-10">
        <p className="pt-20 text-center text-sm text-[#1A1A2E]/50">載入中…</p>
      </main>
    );
  }

  if (!isTowerUnlocked(progress, towerNumber)) {
    return (
      <main className="min-h-screen bg-[#FDF6E8] pb-10">
        <div className="mx-auto max-w-md px-4 pt-10 text-center">
          <p className="text-4xl">🔒</p>
          <p className="mt-2 text-sm font-bold text-[#1A1A2E]">這座塔還沒解鎖</p>
          <p className="mt-1 text-xs text-[#1A1A2E]/55">
            要先通關第 {towerNumber - 1} 塔的第 {STAGES_PER_TOWER} 關。
          </p>
          <button
            type="button"
            onClick={() => router.push("/explore")}
            className="mt-4 rounded-xl bg-[#1A1A2E] px-4 py-2.5 text-sm font-bold text-[#FDF6E8] shadow-md"
          >
            返回塔清單
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(180deg, ${theme.accentColor}22 0%, #FDF6E8 45%)`,
      }}
    >
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* ---- 頁首 ---- */}
        <header className="flex items-center justify-between rounded-2xl bg-white/75 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => (view === "tower" ? router.push("/explore") : backToTower())}
            className="rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← {view === "tower" ? "塔清單" : "返回"}
          </button>
          <h1 className="text-base font-bold" style={{ color: theme.accentColor }}>
            {theme.name}
          </h1>
          <span className="rounded-full bg-[#1A1A2E] px-2.5 py-1 text-[10px] font-bold text-[#E8B84B]">
            {attemptsLeft}/{DAILY_EXPLORE_ATTEMPTS}
          </span>
        </header>

        {errorMessage ? (
          <p className="mt-3 rounded-2xl bg-[#C0392B] px-4 py-2.5 text-center text-xs font-bold text-white shadow-md">
            {errorMessage}
          </p>
        ) : null}

        {/* ============================================================
            塔：10 層樓，由下往上爬
           ============================================================ */}
        {view === "tower" ? (
          <section className="mt-3">
            {/* 塔頂 */}
            {/* 塔頂：刻意用負的下邊距讓它跟塔身接在一起，中間不留縫 */}
            <div
              className="relative z-10 mx-auto -mb-2 h-7 w-24 rounded-t-2xl"
              style={{
                background: `linear-gradient(180deg, ${theme.accentColor} 0%, ${theme.accentColor}CC 100%)`,
                boxShadow: `0 0 20px ${theme.accentColor}88`,
              }}
            />
            <div
              className="overflow-hidden rounded-2xl"
              style={{
                border: `2px solid ${theme.accentColor}`,
                boxShadow: `inset 0 2px 14px ${theme.accentColor}33, 0 8px 20px rgba(0,0,0,0.2)`,
              }}
            >
              {/* 由上往下畫第 10 關到第 1 關，視覺上就是一棟由下往上爬的塔 */}
              {Array.from({ length: STAGES_PER_TOWER }, (_, i) => STAGES_PER_TOWER - i).map(
                (stage) => {
                  const cleared = isStageCleared(progress, towerNumber, stage);
                  const playable = canPlayStage(progress, towerNumber, stage);
                  const plan = getStagePlan(towerNumber, stage);
                  const isTop = stage === STAGES_PER_TOWER;

                  return (
                    <button
                      key={stage}
                      type="button"
                      disabled={!playable}
                      onClick={() => {
                        setPrepStage(stage);
                        setErrorMessage(null);
                        setView("prep");
                      }}
                      className="flex w-full items-center gap-3 border-b border-white/10 px-3 py-2.5 text-left transition-colors last:border-b-0 disabled:cursor-not-allowed"
                      style={{
                        // 可玩的樓層用塔的主色打光，上鎖的是一片死沉的
                        // 深色。第一版寫成半透明的深藍黑，疊在淺色頁面
                        // 背景上反而比可玩的還亮，看起來像「上鎖的才是
                        // 開著的」，所以改成不透明。
                        // 亮的那一側放在右邊（Boss 圖示那邊），左邊
                        // 留深色，樓層編號的金色徽章才不會糊在亮底上
                        background: playable
                          ? `linear-gradient(90deg, #1A1A2E 0%, #1A1A2E 55%, ${theme.accentColor}44 100%)`
                          : "linear-gradient(90deg, #14141F 0%, #0E0E18 100%)",
                      }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-extrabold"
                        style={{
                          backgroundColor: cleared ? theme.accentColor : "rgba(255,255,255,0.12)",
                          color: cleared ? "#1A1A2E" : "rgba(255,255,255,0.5)",
                        }}
                      >
                        {stage}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-white">
                          第 {stage} 關
                          {isTop ? (
                            <span className="ml-1 text-[10px] font-bold text-[#E8B84B]">塔頂</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-white/45">
                          {playable
                            ? `${plan.normalCount} 隻怪 ＋ ${theme.bossEmoji} ${theme.name}之主`
                            : "通關前一關才會開啟"}
                        </p>
                      </div>

                      <span className="shrink-0 text-base">
                        {cleared ? "✅" : playable ? theme.bossEmoji : "🔒"}
                      </span>
                    </button>
                  );
                },
              )}
            </div>
          </section>
        ) : null}

        {/* ============================================================
            準備頁
           ============================================================ */}
        {view === "prep" && prepStage !== null ? (
          <section className="mt-3">
            {(() => {
              const plan = getStagePlan(towerNumber, prepStage);
              const cleared = isStageCleared(progress, towerNumber, prepStage);
              const willConsume = !cleared;
              const noAttempts = willConsume && attemptsLeft <= 0;
              const blockReason = !selectedPet
                ? "還沒選小雞"
                : selectedPet.blockReason
                  ? selectedPet.blockReason
                  : noAttempts
                    ? "今天的探險次數用完了"
                    : null;

              return (
                <>
                  <div className="rounded-3xl bg-white/75 px-4 py-3 shadow-sm">
                    <p className="text-sm font-extrabold text-[#1A1A2E]">
                      {theme.name}・第 {prepStage} 關
                    </p>
                    <p className="mt-0.5 text-xs text-[#1A1A2E]/55">
                      {plan.normalCount} 隻怪，最後是 {theme.bossEmoji}{" "}
                      <span className="font-bold">{theme.name}之主</span>
                    </p>
                    <p className="mt-1 text-[10px] text-[#1A1A2E]/45">
                      {cleared
                        ? "已通關過，重打不扣次數、也不會再掉裝備"
                        : "首通會掉 2 件第 1 階裝備・輸贏都扣 1 次"}
                    </p>
                  </div>

                  {/* 選小雞 */}
                  <div className="mt-3 rounded-3xl bg-white/75 px-4 py-3 shadow-sm">
                    <p className="text-xs font-bold text-[#1A1A2E]/60">派誰去（只能派 1 隻）</p>
                    {deployables.length === 0 ? (
                      <p className="mt-3 rounded-2xl bg-white/70 px-3 py-4 text-center text-xs text-[#1A1A2E]/50">
                        還沒有可以出戰的小雞。把小雞養到大師雞就能派牠去探險。
                      </p>
                    ) : (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {deployables.map((pet) => {
                          const selected = pet.id === selectedPetId;
                          return (
                            <button
                              key={pet.id}
                              type="button"
                              onClick={() => setSelectedPetId(pet.id)}
                              className="relative rounded-2xl border-2 bg-white/90 px-1.5 py-2 text-center transition-transform active:scale-95"
                              style={{
                                // 選中一律用全站的金色，不要用職業色——
                                // 攻擊型職業是紅色，紅框看起來像「這個
                                // 選項有問題」，完全相反的意思。
                                // 職業用左上角一個小色點表示就好。
                                borderColor: selected ? "#E8B84B" : "rgba(26,26,46,0.12)",
                                boxShadow: selected ? "0 0 12px #E8B84B88" : undefined,
                              }}
                            >
                              <span
                                className="absolute left-1.5 top-1.5 h-2 w-2 rounded-full"
                                style={{ backgroundColor: getJobColor(pet.jobId) }}
                              />
                              {selected ? (
                                <span className="absolute right-1 top-0.5 text-[10px]">✓</span>
                              ) : null}
                              <p className="truncate text-[11px] font-extrabold text-[#1A1A2E]">
                                {pet.name}
                              </p>
                              <p className="text-[10px] font-bold text-[#5C3D0A]">
                                戰力 {pet.totalPower}
                              </p>
                              {pet.blockReason ? (
                                <p className="text-[9px] font-bold text-[#C0392B]">
                                  {pet.blockReason}
                                </p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {selectedPet ? (
                      <div className="mt-2 grid grid-cols-4 gap-1 rounded-2xl bg-[#FDF6E8] px-2 py-2 text-center">
                        <div>
                          <p className="text-[9px] text-[#1A1A2E]/45">體力</p>
                          <p className="text-[11px] font-extrabold text-[#1A1A2E]">
                            {selectedPet.stats.hp}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-[#1A1A2E]/45">攻擊</p>
                          <p className="text-[11px] font-extrabold text-[#1A1A2E]">
                            {selectedPet.stats.attack}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-[#1A1A2E]/45">防禦</p>
                          <p className="text-[11px] font-extrabold text-[#1A1A2E]">
                            {selectedPet.stats.defense}
                          </p>
                        </div>
                        <div>
                          <p className="text-[9px] text-[#1A1A2E]/45">速度</p>
                          <p className="text-[11px] font-extrabold text-[#1A1A2E]">
                            {selectedPet.stats.speed}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* 開始按鈕：不能出戰時灰掉＋寫原因＋放快捷連結 */}
                  <button
                    type="button"
                    disabled={blockReason !== null}
                    onClick={handleStart}
                    className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3.5 text-base font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
                    style={{
                      boxShadow:
                        blockReason === null
                          ? "inset 0 1px 6px rgba(255,255,255,0.6), 0 6px 14px rgba(92,61,10,0.3)"
                          : undefined,
                    }}
                  >
                    ⚔️ 開始探險
                  </button>

                  {blockReason ? (
                    <div className="mt-2 rounded-2xl bg-[#C0392B]/10 px-3 py-2.5 text-center">
                      <p className="text-xs font-bold text-[#C0392B]">{blockReason}</p>
                      {blockReason === "還差一把武器" ? (
                        <button
                          type="button"
                          onClick={() => router.push("/inventory")}
                          className="mt-1.5 rounded-xl bg-[#C0392B] px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95"
                        >
                          去物品頁買武器
                        </button>
                      ) : blockReason === "還沒選小雞" ? (
                        <button
                          type="button"
                          onClick={() => router.push("/my-pets")}
                          className="mt-1.5 rounded-xl bg-[#C0392B] px-3 py-1.5 text-[11px] font-bold text-white transition-transform active:scale-95"
                        >
                          去我的小雞
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </>
              );
            })()}
          </section>
        ) : null}

        {/* ============================================================
            戰鬥
           ============================================================ */}
        {view === "battle" && setup ? (
          <section className="mt-3">
            <p className="mb-2 text-center text-xs font-bold text-[#1A1A2E]/55">
              {theme.name}・第 {setup.stage} 關
            </p>
            <BattleStage
              playerUnits={setup.playerUnits}
              enemyUnits={setup.enemyUnits}
              visuals={setup.visuals}
              result={setup.result}
              accentColor={theme.accentColor}
              onFinish={handleBattleFinish}
            />
          </section>
        ) : null}
      </div>

      {/* ---- 結算卡片 ---- */}
      {finished && setup ? (
        <BattleResultCard
          won={finished.won}
          surrendered={finished.surrendered}
          title={`${theme.name}・第 ${setup.stage} 關`}
          durationSeconds={setup.result.durationSeconds}
          defeated={setup.result.enemiesDefeated}
          totalEnemies={setup.enemyUnits.length}
          drops={finished.drops}
          extraLines={[
            ...(finished.unlockedNextTower ? [`🔓 解鎖第 ${towerNumber + 1} 塔！`] : []),
            ...(finished.bagWasFull ? ["⚠️ 背包滿了，有裝備沒撿到"] : []),
            ...(finished.won && !setup.isFirstClear ? ["重打不掉裝備，也不扣次數"] : []),
          ]}
          loseHint={
            !finished.won && !finished.surrendered
              ? getLoseHint(setup.pet, getStagePlan(towerNumber, setup.stage).monsters.at(-1)!)
              : null
          }
          primaryLabel={
            finished.won && setup.stage < STAGES_PER_TOWER ? "下一關" : "再打一次"
          }
          onPrimary={() => {
            if (finished.won && setup.stage < STAGES_PER_TOWER) goNextStage();
            else {
              const stage = setup.stage;
              setFinished(null);
              setSetup(null);
              setPrepStage(stage);
              setView("prep");
            }
          }}
          secondaryLabel="返回塔"
          onSecondary={backToTower}
        />
      ) : null}
    </main>
  );
}

export default function ExploreTowerPage() {
  return (
    <RequireAuth>
      <TowerContent />
    </RequireAuth>
  );
}
