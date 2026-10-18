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
 * 戰鬥判定在 BattleEngine（lib/rpg/battle.ts）；BattleStage 一邊播一邊
 * 推進它，手動放技能也是透過它。中途投降是直接以失敗結束。
 *
 * 次數規則：輸贏都扣一次，但「重打已經通關過的關卡」不扣。
 * 掉寶只有首通會掉。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import BattleStage, { type BattleUnitVisual } from "@/components/battle/BattleStage";
import { getExtraExploreAttempts, getPuzzleStatBonus, getTodayPuzzleDaily } from "@/lib/rpg/chessLink";
import { getTaipeiDateString } from "@/lib/server/serverDate";
import SkillIcon from "@/components/rpg/SkillIcon";
import BattleResultCard from "@/components/battle/BattleResultCard";
import { BattleEngine, type BattleResult, type BattleUnit } from "@/lib/rpg/battle";
import { getBagCapacity, getItemType, type EquipmentItem } from "@/lib/rpg/equipment";
import { getReplayLootLeft, rollStageLoot, REPLAY_LOOT_DAILY_LIMIT } from "@/lib/rpg/loot";
import type { GemId } from "@/lib/rpg/gems";
import {
  DAILY_EXPLORE_ATTEMPTS,
  HEAL_PERCENT_ON_KILL,
  STAGES_PER_TOWER,
  TOWER_COUNT,
  getStagePlan,
  getTowerTheme,
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
import { useAppBackground } from "@/lib/useAppBackground";
import RpgHeader, { AttemptsBadge } from "@/components/rpg/RpgHeader";
import BattleBackdrop from "@/components/battle/BattleBackdrop";
import MonsterArt from "@/components/battle/MonsterArt";
import PetArt from "@/components/rpg/PetArt";
import EquipmentIcon, { ItemFrame } from "@/components/rpg/EquipmentIcon";
import GemIcon from "@/components/rpg/GemIcon";

type View = "tower" | "prep" | "battle";

interface BattleSetup {
  stage: number;
  pet: DeployablePet;
  playerUnits: BattleUnit[];
  enemyUnits: BattleUnit[];
  visuals: BattleUnitVisual[];
  engine: BattleEngine;
  /** 這一場有沒有扣掉每日次數 */
  consumedAttempt: boolean;
  /** 是不是首通（決定掉不掉寶） */
  isFirstClear: boolean;
}

interface FinishedState {
  won: boolean;
  /** 打完（或投降當下）的戰鬥結果：花多久、打倒幾隻 */
  result: BattleResult;
  surrendered: boolean;
  drops: EquipmentItem[];
  gemDrops: GemId[];
  /** 這一場是不是用掉了一次重打掉落名額（結算卡片要提示剩幾次） */
  usedReplayLoot: boolean;
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

  /**
   * 塔內頁除了使用者的背景，還要在上面疊一層該座塔的主色，讓學生一眼
   * 知道自己在哪一區。沒有背景圖的人就只看到這層漸層（跟改動前一樣）。
   * 上緣濃、45% 之後完全透明，不會蓋掉背景圖的主體。
   */
  const towerTint = `linear-gradient(180deg, ${theme.accentColor}33 0%, ${theme.accentColor}00 45%)`;
  const bgStyle = useAppBackground(towerTint);
  /** 載入中／未解鎖這種沒有塔景的畫面，不疊主色 */
  const plainBgStyle = useAppBackground();

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
  // 解題 × RPG：今天解對的題數 → 探險加成、額外次數（見 lib/rpg/chessLink.ts）
  const puzzleSolvedToday = getTodayPuzzleDaily(user?.puzzleRpgDaily, getTaipeiDateString()).solved;
  const puzzleBonus = getPuzzleStatBonus(puzzleSolvedToday);
  const maxAttempts = DAILY_EXPLORE_ATTEMPTS + getExtraExploreAttempts(puzzleSolvedToday);
  const attemptsLeft = progress
    ? Math.max(0, maxAttempts - progress.dailyAttemptsUsed)
    : 0;

  // Boss 首通過的塔，替它挑一題封印殘局（已經挑過的不會重挑）
  const ensureSealPuzzles = useGameStore((s) => s.ensureSealPuzzles);
  const bossClearedTowers = useMemo(() => {
    if (!progress) return [];
    const list: number[] = [];
    for (let t = 1; t <= TOWER_COUNT; t++) if (isStageCleared(progress, t, STAGES_PER_TOWER)) list.push(t);
    return list;
  }, [progress]);
  useEffect(() => {
    if (bossClearedTowers.length > 0) void ensureSealPuzzles(bossClearedTowers);
  }, [bossClearedTowers, ensureSealPuzzles]);
  const seal = user?.sealPuzzles?.[String(towerNumber)] ?? null;
  const bossCleared = bossClearedTowers.includes(towerNumber);
  const replayLootLeft = getReplayLootLeft(progress?.dailyReplayLootUsed ?? 0);

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
    const playerUnits = [toBattleUnit(selectedPet, "p0", "player", puzzleBonus)];
    const enemyUnits = plan.monsters.map((m, i) => monsterToBattleUnit(m, `e${i}`));
    const visuals: BattleUnitVisual[] = [
      toBattleVisual(selectedPet, "p0"),
      ...plan.monsters.map((m, i) => monsterToBattleVisual(m, `e${i}`)),
    ];

    const engine = new BattleEngine(playerUnits, enemyUnits, {
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
      engine,
      consumedAttempt,
      isFirstClear: !alreadyCleared,
    });
    finishHandledRef.current = false;
    setErrorMessage(null);
    setView("battle");
  }, [attemptsLeft, prepStage, progress, puzzleBonus, selectedPet, towerNumber]);

  const handleBattleFinish = useCallback(
    (outcome: { winner: string; surrendered: boolean; result: BattleResult }) => {
      if (!setup || !progress) return;
      if (finishHandledRef.current) return;
      finishHandledRef.current = true;

      const won = outcome.winner === "player" && !outcome.surrendered;

      // 掉落：首通 2 件裝備＋1 顆寶石；重打只有每天前 10 次贏的有機會掉
      // （規則全部在 lib/rpg/loot.ts）
      const loot = rollStageLoot({
        tower: towerNumber,
        won,
        isFirstClear: setup.isFirstClear,
        replayLootUsedToday: progress.dailyReplayLootUsed ?? 0,
      });
      const drops: EquipmentItem[] = loot.equipment;

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
        result: outcome.result,
        surrendered: outcome.surrendered,
        drops: accepted,
        gemDrops: loot.gems,
        usedReplayLoot: loot.usedReplayLoot,
        bagWasFull,
        unlockedNextTower: willUnlockNextTower,
      });

      void finishExploreStage({
        tower: towerNumber,
        stage: setup.stage,
        won,
        consumedAttempt: setup.consumedAttempt,
        drops: accepted,
        gemDrops: loot.gems,
        usedReplayLoot: loot.usedReplayLoot,
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
      <main className="min-h-screen pb-10" style={plainBgStyle}>
        <div className="pt-20 text-center">
          <span className="inline-block rounded-2xl bg-white/80 px-4 py-2 text-sm font-bold text-[#1A1A2E] shadow-sm backdrop-blur-sm">載入中…</span>
        </div>
      </main>
    );
  }

  if (!isTowerUnlocked(progress, towerNumber)) {
    return (
      <main className="min-h-screen pb-10" style={plainBgStyle}>
        <div className="mx-auto max-w-md px-4 pt-10">
          {/* 整塊包成白卡，否則在亮色的背景圖上讀不到 */}
          <div className="rounded-3xl bg-white/80 px-5 py-6 text-center shadow-sm backdrop-blur-sm">
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
        </div>
      </main>
    );
  }

  const towerCleared = Array.from({ length: STAGES_PER_TOWER }, (_, i) => i + 1).filter((st) =>
    isStageCleared(progress, towerNumber, st),
  ).length;
  /** 目前該打的那一層：最低的、可以打、還沒通關的那層 */
  const currentStage =
    Array.from({ length: STAGES_PER_TOWER }, (_, i) => i + 1).find(
      (st) => canPlayStage(progress, towerNumber, st) && !isStageCleared(progress, towerNumber, st),
    ) ?? null;
  const leadPet = selectedPet ?? deployables[0] ?? null;

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        {/* ---- 頁首（戰鬥中不顯示，畫面全部留給戰場） ---- */}
        {view !== "battle" ? (
          <RpgHeader
            title={theme.name}
            accent={theme.accentColor}
            backLabel={view === "tower" ? "塔清單" : "返回"}
            onBack={() => (view === "tower" ? router.push("/explore") : backToTower())}
            right={<AttemptsBadge left={attemptsLeft} max={maxAttempts} />}
          />
        ) : null}

        {errorMessage ? (
          <p className="mt-3 rounded-2xl bg-[#B0102A]/90 px-4 py-2.5 text-center text-xs font-black text-white shadow-lg ring-1 ring-[#FF6A7A]/50">
            {errorMessage}
          </p>
        ) : null}

        {/* ============================================================
            塔：10 層樓，由下往上爬
           ============================================================ */}
        {view === "tower" ? (
          <section className="mt-3">
            {/* ---- 主視覺：這座塔的戰場＋塔主 ---- */}
            <div className="relative h-[150px] overflow-hidden rounded-[22px] ring-2" style={{ ["--tw-ring-color" as string]: theme.accentColor }}>
              <BattleBackdrop tower={towerNumber} />
              <div className="absolute bottom-1 right-3">
                <div className="unit-idle">
                  <MonsterArt tower={towerNumber} archetype="balanced" isBoss size={118} />
                </div>
              </div>
              <div className="absolute inset-y-0 left-0 flex w-[62%] flex-col justify-end px-3.5 pb-3" style={{ background: "linear-gradient(90deg, rgba(5,5,16,0.82) 0%, rgba(5,5,16,0.5) 65%, rgba(5,5,16,0) 100%)" }}>
                <p className="font-display text-[12px] leading-none text-white/60">TOWER {towerNumber}</p>
                <p className="mt-1 leading-none">
                  <span
                    className="fx-text text-[28px] font-black"
                    data-text={theme.name}
                    style={
                      {
                        ["--fx-fill" as string]: `linear-gradient(180deg,#FFFFFF 15%,${theme.accentColor} 100%)`,
                        ["--fx-stroke" as string]: "6px",
                        ["--fx-stroke-color" as string]: "#0B0A18",
                      } as React.CSSProperties
                    }
                  >
                    {theme.name}
                  </span>
                </p>
                <p className="mt-1.5 text-[11px] font-black text-white/80">
                  塔主「{theme.name}之主」
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex flex-1 gap-[2px]">
                    {Array.from({ length: STAGES_PER_TOWER }, (_, i) => (
                      <span
                        key={i}
                        className="h-1.5 flex-1 rounded-[2px]"
                        style={{ background: i < towerCleared ? theme.accentColor : "rgba(255,255,255,0.18)", boxShadow: i < towerCleared ? `0 0 4px ${theme.accentColor}` : undefined }}
                      />
                    ))}
                  </div>
                  <span className="font-display text-[12px] leading-none text-white">
                    {towerCleared}
                    <span className="text-white/50">/{STAGES_PER_TOWER}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* ---- 塔頂 ---- */}
            <TowerRoof color={theme.accentColor} />

            {/* ---- 塔身：由上往下畫第 10 層到第 1 層 ---- */}
            <div
              className="relative -mt-px overflow-hidden px-2 py-2"
              style={{
                background: "linear-gradient(90deg,#14132A 0%,#1E1C3C 50%,#14132A 100%)",
                boxShadow: `inset 3px 0 0 ${theme.accentColor}66, inset -3px 0 0 ${theme.accentColor}66, 0 10px 24px rgba(0,0,0,0.3)`,
              }}
            >
              {/* 磚紋 */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.07]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, #FFFFFF 0 1px, transparent 1px 22px), repeating-linear-gradient(90deg, #FFFFFF 0 1px, transparent 1px 44px)",
                }}
              />
              <div className="relative flex flex-col gap-1.5">
                {Array.from({ length: STAGES_PER_TOWER }, (_, i) => STAGES_PER_TOWER - i).map((stage) => {
                  const cleared = isStageCleared(progress, towerNumber, stage);
                  const playable = canPlayStage(progress, towerNumber, stage);
                  const isCurrent = stage === currentStage;
                  const plan = getStagePlan(towerNumber, stage);
                  const isTop = stage === STAGES_PER_TOWER;
                  // 這一層會出現哪幾種小怪（依出場順序去重）
                  const normals = plan.monsters.slice(0, plan.normalCount);
                  const kinds = Array.from(new Map(normals.map((m) => [m.archetype, m])).values());

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
                      aria-label={`第 ${stage} 層${cleared ? "，已通關" : playable ? "，可以挑戰" : "，尚未開放"}`}
                      className={[
                        "relative flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-transform active:scale-[0.98] disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
                        isCurrent ? "floor-current" : "",
                      ].join(" ")}
                      style={{
                        background: isCurrent
                          ? `linear-gradient(90deg, ${theme.accentColor}38 0%, rgba(30,28,60,0.95) 55%)`
                          : playable
                            ? "linear-gradient(90deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03))"
                            : "rgba(0,0,0,0.3)",
                        boxShadow: !isCurrent && playable ? "inset 0 0 0 1px rgba(255,255,255,0.08)" : undefined,
                      }}
                    >
                      <FloorMedallion stage={stage} cleared={cleared} current={isCurrent} locked={!playable} accent={theme.accentColor} />

                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-[13px] font-black" style={{ color: playable ? "#FFFFFF" : "rgba(255,255,255,0.35)" }}>
                          第 {stage} 層
                          {isTop ? (
                            <span className="rounded-md px-1 text-[9.5px] font-black text-[#3A1D00]" style={{ background: "linear-gradient(180deg,#FFF6CC,#F5C542)" }}>
                              頂樓
                            </span>
                          ) : null}
                        </p>
                        {playable ? (
                          <div className="mt-0.5 flex items-center gap-0.5">
                            {kinds.map((m) => (
                              <MonsterArt key={m.id} tower={towerNumber} archetype={m.archetype} size={22} />
                            ))}
                            <span className="font-display ml-0.5 text-[11px] text-white/55">×{plan.normalCount}</span>
                            <span className="mx-1 text-[10px] text-white/30">＋</span>
                            <MonsterArt tower={towerNumber} archetype="balanced" isBoss size={26} />
                          </div>
                        ) : (
                          <p className="mt-0.5 text-[10.5px] font-bold text-white/30">通關下一層才會開放</p>
                        )}
                      </div>

                      {isCurrent ? (
                        <span className="flex items-center gap-1.5">
                          {leadPet ? <PetArt jobId={leadPet.jobId} size={30} /> : null}
                          <span className="btn-gold nudge-bounce rounded-full px-3 py-1.5 text-[12px] font-black">挑戰</span>
                        </span>
                      ) : cleared ? (
                        <span className="flex items-center gap-1 text-[11px] font-black text-[#FFE58A]">
                          <StarIcon />
                          重打
                        </span>
                      ) : !playable ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                          <rect x="5" y="11" width="14" height="10" rx="2.5" />
                          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                        </svg>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ---- 塔基 ---- */}
            <div
              className="relative mx-[-6px] h-7 rounded-b-xl"
              style={{ background: "linear-gradient(180deg,#2A2752 0%,#14132A 100%)", boxShadow: `inset 0 2px 0 ${theme.accentColor}55, 0 8px 18px rgba(0,0,0,0.3)` }}
            >
              <span className="absolute inset-0 flex items-center justify-center text-[10.5px] font-black tracking-[0.3em] text-white/45">入口</span>
            </div>

            {/* ---- Boss 封印殘局：首通 Boss 之後解鎖一題，解開送 2 顆寶石 ---- */}
            <div className="rpg-panel mt-4 flex items-center gap-3 rounded-2xl px-3.5 py-3">
              <span
                className={["flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[24px]", bossCleared && seal && !seal.claimed ? "skill-ready" : ""].join(" ")}
                style={{ background: bossCleared ? "linear-gradient(145deg,#6A4FC0,#24184F)" : "rgba(255,255,255,0.06)", boxShadow: bossCleared && seal && !seal.claimed ? "0 0 14px rgba(159,123,255,0.7)" : undefined }}
                aria-hidden="true"
              >
                {!bossCleared ? "🔒" : seal?.claimed ? "📜" : "♟️"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-black text-white">封印殘局</p>
                <p className="mt-0.5 text-[11px] font-bold leading-snug text-white/60">
                  {!bossCleared
                    ? "打倒第 10 層的首領，就會解鎖一題這座塔的殘局（難度 " + towerNumber + "），第一次解開送 2 顆寶石。"
                    : !seal
                      ? "正在從題庫挑題目…"
                      : seal.claimed
                        ? "已經解開了！還是可以再挑戰一次當練習。"
                        : "解開它就能拿到 2 顆寶石！"}
                </p>
              </div>
              {bossCleared && seal ? (
                <button
                  type="button"
                  onClick={() => router.push(`/puzzle/${seal.puzzleId}`)}
                  className="btn-gold shrink-0 rounded-xl px-3 py-2 text-[12px] font-black"
                >
                  {seal.claimed ? "再解一次" : "去解題"}
                </button>
              ) : null}
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
              const boss = plan.monsters[plan.monsters.length - 1];
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
                  {/* ---- 對決主視覺 ---- */}
                  <div className="relative h-[220px] overflow-hidden rounded-[22px] ring-2" style={{ ["--tw-ring-color" as string]: theme.accentColor }}>
                    <BattleBackdrop tower={towerNumber} />
                    <div className="absolute left-3 top-3 rounded-lg bg-black/55 px-2 py-1 text-[11px] font-black text-white ring-1 ring-white/15">
                      第 {prepStage} 層
                    </div>
                    {/* 我方 */}
                    <div className="absolute bottom-7 left-[6%] flex flex-col items-center">
                      <div className="relative">
                        <div className="absolute -bottom-2 left-1/2 h-5 w-28 -translate-x-1/2 rounded-[50%]" style={{ background: "radial-gradient(closest-side, rgba(245,197,66,0.55), rgba(245,197,66,0))" }} />
                        <div className="unit-idle relative">
                          {selectedPet ? <PetArt jobId={selectedPet.jobId} size={104} /> : <div style={{ width: 104, height: 104 }} />}
                        </div>
                      </div>
                    </div>
                    {/* 首領 */}
                    <div className="absolute bottom-6 right-[4%]">
                      <div className="absolute -bottom-1 left-1/2 h-5 w-32 -translate-x-1/2 rounded-[50%]" style={{ background: "radial-gradient(closest-side, rgba(255,45,70,0.55), rgba(255,45,70,0))" }} />
                      <div className="unit-idle relative">
                        <MonsterArt tower={towerNumber} archetype={boss.archetype} isBoss size={124} />
                      </div>
                    </div>
                    {/* VS */}
                    <div className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2">
                      <span
                        className="fx-text font-display text-[40px] italic leading-none"
                        data-text="VS"
                        style={
                          {
                            ["--fx-fill" as string]: "linear-gradient(180deg,#FFFFFF 10%,#FFE07A 55%,#FF8A00 100%)",
                            ["--fx-stroke" as string]: "7px",
                            ["--fx-stroke-color" as string]: "#2A1200",
                          } as React.CSSProperties
                        }
                      >
                        VS
                      </span>
                    </div>
                    {/* 底部名牌 */}
                    <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-3 pb-1.5 pt-6" style={{ background: "linear-gradient(0deg, rgba(5,5,16,0.85), rgba(5,5,16,0))" }}>
                      <span className="max-w-[45%] truncate text-[13px] font-black text-white">{selectedPet?.name ?? "選一隻小雞"}</span>
                      <span className="flex items-center gap-1">
                        <span className="font-display rounded-[4px] bg-[#FF2D46] px-1 text-[9px] leading-[14px] text-white">BOSS</span>
                        <span className="text-[13px] font-black text-white">{boss.name}</span>
                      </span>
                    </div>
                  </div>

                  {/* ---- 這一關的資訊 ---- */}
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <InfoChip label="敵人">
                      <span className="font-display text-[18px] text-white">{plan.normalCount}</span>
                      <span className="ml-0.5 text-[10px] font-bold text-white/55">隻＋首領</span>
                    </InfoChip>
                    <InfoChip label={cleared ? "重打掉落" : "首通掉落"}>
                      {cleared ? (
                        <span className="leading-none">
                          <span className="font-display text-[18px] text-white">{replayLootLeft}</span>
                          <span className="ml-0.5 text-[10px] font-bold text-white/55">/ {REPLAY_LOOT_DAILY_LIMIT} 次</span>
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          {[0, 1].map((k) => (
                            <span key={k} className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-black text-[#F5C542] ring-1 ring-[#F5C542]/60" style={{ background: "linear-gradient(145deg,#3A2A6E,#1A1438)" }}>
                              ?
                            </span>
                          ))}
                          <GemIcon gem="amethyst" size={20} mystery />
                        </span>
                      )}
                    </InfoChip>
                    <InfoChip label="消耗">
                      {willConsume ? (
                        <>
                          <span className="font-display text-[18px] text-white">1</span>
                          <span className="ml-0.5 text-[10px] font-bold text-white/55">次</span>
                        </>
                      ) : (
                        <span className="text-[11px] font-black text-[#7FE8A8]">不扣次數</span>
                      )}
                    </InfoChip>
                  </div>

                  {/* ---- 解題加成：今天解的題越多，探險越強 ---- */}
                  <button
                    type="button"
                    onClick={() => router.push("/puzzle")}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left ring-1 ring-[#9F7BFF]/45 transition-transform active:scale-[0.98]"
                    style={{ background: "linear-gradient(180deg, rgba(42,32,96,0.94), rgba(20,16,48,0.94))" }}
                  >
                    <span className="text-[16px]" aria-hidden="true">📖</span>
                    <span className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-white/75">
                      今天解對 {puzzleSolvedToday} 題：探險四項
                      <span className="font-black text-[#7FE8A8]"> +{Math.round(puzzleBonus * 100)}%</span>
                      （最多 +5%），多 {maxAttempts - DAILY_EXPLORE_ATTEMPTS} 次探險
                    </span>
                    <span className="shrink-0 text-[11px] font-black text-[#C9B6FF]">去解題 ›</span>
                  </button>

                  {/* ---- 選小雞 ---- */}
                  <div className="rpg-panel mt-3 rounded-2xl px-3 py-3">
                    <p className="px-1 text-[12px] font-black text-white/70">派誰出戰（只能派 1 隻）</p>
                    {deployables.length === 0 ? (
                      <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-4 text-center text-[12px] font-bold text-white/55">
                        還沒有可以出戰的小雞。把小雞養到大師雞就能派牠去探險。
                      </p>
                    ) : (
                      <div className="-mx-1 mt-2 flex snap-x gap-2 overflow-x-auto px-1 pb-1" style={{ scrollbarWidth: "none" }}>
                        {deployables.map((pet) => (
                          <PetPickCard key={pet.id} pet={pet} selected={pet.id === selectedPetId} onSelect={() => setSelectedPetId(pet.id)} />
                        ))}
                      </div>
                    )}

                    {/* 數值對照：我方 vs 首領 */}
                    {selectedPet ? (
                      <div className="mt-3 rounded-xl bg-black/25 px-3 py-2.5">
                        <div className="mb-1.5 flex items-center justify-between text-[10px] font-black">
                          <span className="text-[#7FD3FF]">{selectedPet.name}</span>
                          <span className="text-white/40">數值對照</span>
                          <span className="text-[#FF8A96]">首領</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {(
                            [
                              ["hp", "體力"],
                              ["attack", "攻擊"],
                              ["defense", "防禦"],
                              ["speed", "速度"],
                            ] as const
                          ).map(([key, label]) => (
                            <StatCompare key={key} label={label} mine={selectedPet.stats[key]} theirs={boss.stats[key]} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* ---- 出發 ---- */}
                  <button
                    type="button"
                    disabled={blockReason !== null}
                    onClick={handleStart}
                    className="btn-gold mt-3 w-full rounded-2xl px-4 py-4 text-[18px] font-black tracking-[0.15em]"
                  >
                    出發！
                  </button>
                  <p className="mt-2 text-center">
                    {/* 墊一層深色玻璃：使用者背景是照片時，裸字會看不到 */}
                    <span className="rpg-glass inline-block rounded-full px-3 py-1 text-[10.5px] font-bold text-white/80">
                      {cleared
                        ? replayLootLeft > 0
                          ? `重打不扣次數。贏了有機會掉寶石跟裝備（今天還剩 ${replayLootLeft} 次機會）`
                          : `重打不扣次數。今天 ${REPLAY_LOOT_DAILY_LIMIT} 次重打掉落用完了，打贏也不會掉東西`
                        : `首通必掉 2 件裝備＋1 顆寶石。輸贏都會扣 1 次（今天還剩 ${attemptsLeft} 次）`}
                    </span>
                  </p>

                  {blockReason ? (
                    <div className="mt-2 rounded-2xl bg-[#B0102A]/90 px-3 py-2.5 text-center ring-1 ring-[#FF6A7A]/50">
                      <p className="text-[12px] font-black text-white">{blockReason}</p>
                      {blockReason === "還差一把武器" ? (
                        <button
                          type="button"
                          onClick={() => router.push("/inventory")}
                          className="mt-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-black text-[#B0102A] transition-transform active:scale-95"
                        >
                          去物品頁買武器
                        </button>
                      ) : blockReason === "還沒選小雞" ? (
                        <button
                          type="button"
                          onClick={() => router.push("/my-pets")}
                          className="mt-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-black text-[#B0102A] transition-transform active:scale-95"
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
          // 戰鬥時整個畫面換成深色全螢幕，戰場置中——手機上不會只佔
          // 上半截、下面露出一大片背景圖，學生的注意力全部在戰場上
          <section
            className="fixed inset-0 z-[60] flex items-center overflow-y-auto px-3 py-4"
            style={{ background: `radial-gradient(ellipse at 50% 35%, ${theme.accentColor}40 0%, #0B0A18 70%)` }}
          >
            <div className="mx-auto w-full max-w-md">
            <BattleStage
              playerUnits={setup.playerUnits}
              enemyUnits={setup.enemyUnits}
              visuals={setup.visuals}
              engine={setup.engine}
              tower={towerNumber}
              title={`${theme.name}・第 ${setup.stage} 關`}
              playerLabel={setup.pet.name}
              onFinish={handleBattleFinish}
            />
            </div>
          </section>
        ) : null}
      </div>

      {/* ---- 結算卡片 ---- */}
      {finished && setup ? (
        <BattleResultCard
          won={finished.won}
          surrendered={finished.surrendered}
          title={`${theme.name}・第 ${setup.stage} 關`}
          durationSeconds={finished.result.durationSeconds}
          defeated={finished.result.enemiesDefeated}
          totalEnemies={setup.enemyUnits.length}
          drops={finished.drops}
          extraLines={[
            ...(finished.unlockedNextTower ? [`🔓 解鎖第 ${towerNumber + 1} 塔！`] : []),
            ...(finished.bagWasFull ? ["⚠️ 背包滿了，有裝備沒撿到"] : []),
            ...(finished.won && !setup.isFirstClear
              ? finished.usedReplayLoot
                ? [`重打不扣次數・今天重打掉落還剩 ${getReplayLootLeft(progress.dailyReplayLootUsed ?? 0)} 次`]
                : [`今天 ${REPLAY_LOOT_DAILY_LIMIT} 次重打掉落用完了，明天再來`]
              : []),
          ]}
          gems={finished.gemDrops}
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

// ============================================================
// 子元件
// ============================================================

/** 塔頂：尖頂＋發光寶珠，接在塔身上方 */
function TowerRoof({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 400 64" className="mt-3 block w-full" style={{ height: 56 }} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="roof-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#14132A" />
        </linearGradient>
        <radialGradient id="roof-orb" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="40%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={200} cy={12} r={14} fill="url(#roof-orb)" />
      <path d="M200,10 L246,40 L380,52 L392,64 L8,64 L20,52 L154,40 Z" fill="url(#roof-grad)" />
      <path d="M200,10 L246,40 L380,52 L392,64" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx={200} cy={12} r={4.5} fill="#FFFFFF" />
    </svg>
  );
}

/** 樓層編號徽章 */
function FloorMedallion({
  stage,
  cleared,
  current,
  locked,
  accent,
}: {
  stage: number;
  cleared: boolean;
  current: boolean;
  locked: boolean;
  accent: string;
}) {
  const bg = cleared
    ? "linear-gradient(180deg,#FFF6CC 0%,#F5C542 55%,#B47A0A 100%)"
    : current
      ? `linear-gradient(180deg,#FFFFFF 0%,${accent} 100%)`
      : locked
        ? "linear-gradient(180deg,#2A2840,#16152A)"
        : "linear-gradient(180deg,#4A4870,#2A2850)";
  return (
    <span
      className="font-display relative flex h-10 w-10 shrink-0 items-center justify-center text-[17px] leading-none"
      style={{
        clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
        background: bg,
        color: cleared || current ? "#2A1600" : locked ? "rgba(255,255,255,0.3)" : "#FFFFFF",
      }}
    >
      {stage}
    </span>
  );
}

function StarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2 6.1 20.5l1.4-6.6-5-4.5 6.6-.7z" fill="#F5C542" stroke="#7A4A06" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function InfoChip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rpg-panel flex flex-col items-center justify-center rounded-2xl px-2 py-2">
      <span className="text-[10px] font-black text-white/50">{label}</span>
      <span className="mt-0.5 flex h-7 items-center leading-none">{children}</span>
    </div>
  );
}

/** 準備頁的小雞選擇卡（像抽卡遊戲的角色卡） */
function PetPickCard({ pet, selected, onSelect }: { pet: DeployablePet; selected: boolean; onSelect: () => void }) {
  const jobColor = getJobColor(pet.jobId);
  const blocked = pet.blockReason !== null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="relative w-[96px] shrink-0 snap-start rounded-2xl p-[2px] text-center transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      style={{
        background: selected ? "linear-gradient(160deg,#FFF6CC,#F5C542 45%,#B47A0A)" : `linear-gradient(160deg, ${jobColor}AA, #2A2850)`,
        boxShadow: selected ? "0 0 14px rgba(245,197,66,0.7)" : undefined,
      }}
    >
      <div className="relative overflow-hidden rounded-[14px] px-1.5 pb-2 pt-1.5" style={{ background: `radial-gradient(circle at 50% 30%, ${jobColor}55 0%, #14132A 70%)` }}>
        {selected ? (
          <span className="absolute right-1 top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-[#F5C542] text-[10px] font-black text-[#3A1D00]">✓</span>
        ) : null}
        <div className="flex justify-center" style={{ filter: blocked ? "grayscale(0.8) brightness(0.7)" : undefined }}>
          <PetArt jobId={pet.jobId} size={58} />
        </div>
        <p className="mt-1 truncate text-[11.5px] font-black text-white">{pet.name}</p>
        <p className="font-display text-[14px] leading-none text-[#FFE58A]">{pet.totalPower}</p>
        <div className="mt-1.5 flex justify-center gap-1">
          {(["weapon", "armor"] as const).map((kind) => {
            const item = pet[kind];
            return item ? (
              <ItemFrame key={kind} tier={item.tier} size={22}>
                <EquipmentIcon kind={kind} type={getItemType(item)} tier={item.tier} size={15} />
              </ItemFrame>
            ) : (
              <span key={kind} className="block h-[22px] w-[22px] rounded-[5px] border border-dashed border-white/25" />
            );
          })}
          {pet.skillId ? <SkillIcon skillId={pet.skillId} size={22} boosted={pet.skillBoosted} /> : null}
        </div>
        {blocked ? (
          <span className="absolute inset-x-0 bottom-0 bg-[#B0102A] py-0.5 text-[9.5px] font-black text-white">{pet.blockReason}</span>
        ) : null}
      </div>
    </button>
  );
}

/** 一項數值的我方 vs 首領對照條 */
function StatCompare({ label, mine, theirs }: { label: string; mine: number; theirs: number }) {
  const max = Math.max(1, mine, theirs);
  const ahead = mine >= theirs;
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="flex items-center justify-end gap-1.5">
        <span className="font-display text-[12px] leading-none" style={{ color: ahead ? "#7FD3FF" : "rgba(127,211,255,0.7)" }}>
          {mine}
        </span>
        <div className="h-2 w-full max-w-[90px] overflow-hidden rounded-full bg-white/10">
          <div className="ml-auto h-full rounded-full" style={{ width: `${(mine / max) * 100}%`, background: "linear-gradient(90deg,#1E7FD0,#7FD3FF)" }} />
        </div>
      </div>
      <span className="w-8 text-center text-[10.5px] font-black text-white/60">{label}</span>
      <div className="flex items-center gap-1.5">
        <div className="h-2 w-full max-w-[90px] overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full" style={{ width: `${(theirs / max) * 100}%`, background: "linear-gradient(90deg,#FF8A96,#C0102A)" }} />
        </div>
        <span className="font-display text-[12px] leading-none" style={{ color: !ahead ? "#FF8A96" : "rgba(255,138,150,0.7)" }}>
          {theirs}
        </span>
      </div>
    </div>
  );
}

export default function ExploreTowerPage() {
  return (
    <RequireAuth>
      <TowerContent />
    </RequireAuth>
  );
}
