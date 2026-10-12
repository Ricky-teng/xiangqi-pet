// src/app/team/page.tsx
"use client";

/**
 * ⚔️ 戰隊
 * ------------------------------------------------------------
 * 版面：上方自己的戰隊（3 個站位）＋ 中間一顆大「挑戰」＋ 下方收藏
 * 網格，從網格「拖」上去編隊。排行榜不佔版面，按下挑戰才從下往上
 * 滑出半屏彈窗。
 *
 * 拖拉刻意不用 HTML5 drag-and-drop：那一套在 iOS Safari 幾乎不能用。
 * 改成自己接 touch/pointer 事件，長按 0.3 秒才啟動拖曳，避免跟頁面
 * 捲動打架（手指一放上去就攔截的話，學生想往下滑看收藏會滑不動）。
 *
 * 出戰條件跟探險不一樣：戰隊是「整隊至少一隻有武器」就能出戰。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import BattleStage, { type BattleUnitVisual } from "@/components/battle/BattleStage";
import BattleResultCard from "@/components/battle/BattleResultCard";
import { simulateBattle, type BattleResult, type BattleUnit } from "@/lib/rpg/battle";
import { getTeamDeployBlockReason } from "@/lib/rpg/equipment";
import {
  DAILY_TEAM_ATTEMPTS,
  TEAM_MAX_MEMBERS,
  getMillisecondsUntilSeasonEnd,
  getSeasonId,
  getSeasonLabel,
  previewScoreChange,
} from "@/lib/rpg/teamScore";
import {
  TEAM_NAME_MAX_LENGTH,
  fetchLeaderboard,
  getMyRank,
  resolveLocalMembers,
  resolveTeamMembers,
} from "@/lib/teams";
import {
  getDeployablePets,
  toBattleUnit,
  toBattleVisual,
  type DeployablePet,
} from "@/lib/rpg/deploy";
import { getJobColor } from "@/lib/rpg/jobVisual";
import RulesButton from "@/components/RulesButton";
import type { TeamDoc } from "@/types/rpg";
import { useAppBackground } from "@/lib/useAppBackground";
import PetArt from "@/components/rpg/PetArt";
import RpgHeader, { AttemptsBadge } from "@/components/rpg/RpgHeader";
import BattleBackdrop from "@/components/battle/BattleBackdrop";

/** 長按幾毫秒才啟動拖曳 */
const DRAG_HOLD_MS = 300;

interface BattleSetup {
  opponent: TeamDoc;
  opponentRank: number;
  myRank: number;
  playerUnits: BattleUnit[];
  enemyUnits: BattleUnit[];
  visuals: BattleUnitVisual[];
  result: BattleResult;
  myPets: DeployablePet[];
}

function TeamContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const livingPet = useGameStore((s) => s.pet);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const loadCollectedPets = useGameStore((s) => s.loadCollectedPets);
  const team = useGameStore((s) => s.team);
  const teamLoaded = useGameStore((s) => s.teamLoaded);
  const loadTeam = useGameStore((s) => s.loadTeam);
  const createTeam = useGameStore((s) => s.createTeam);
  const renameTeam = useGameStore((s) => s.renameTeam);
  const saveTeamMembers = useGameStore((s) => s.saveTeamMembers);
  const finishTeamBattle = useGameStore((s) => s.finishTeamBattle);
  const bgStyle = useAppBackground();

  const [nameInput, setNameInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showRename, setShowRename] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<TeamDoc[] | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [setup, setSetup] = useState<BattleSetup | null>(null);
  const [finished, setFinished] = useState<{ won: boolean; surrendered: boolean; delta: number; newScore: number } | null>(null);

  /** 目前上陣的三個站位（null = 空位） */
  const [slots, setSlots] = useState<(DeployablePet | null)[]>([null, null, null]);

  const finishHandledRef = useRef(false);

  useEffect(() => {
    void loadCollectedPets();
    void loadTeam();
  }, [loadCollectedPets, loadTeam]);

  const deployables = useMemo(
    () => getDeployablePets(collectedPets, livingPet),
    [collectedPets, livingPet],
  );

  // 從 Firestore 存的參照還原成實際的小雞，塞進三個站位
  useEffect(() => {
    if (!team) return;
    const resolved = resolveLocalMembers(team.members, collectedPets, livingPet);
    setSlots([resolved[0] ?? null, resolved[1] ?? null, resolved[2] ?? null]);
  }, [team, collectedPets, livingPet]);

  const onFieldPets = slots.filter((p): p is DeployablePet => p !== null);
  const teamBlockReason = getTeamDeployBlockReason(onFieldPets.map((p) => p.weapon));
  const attemptsLeft = team ? Math.max(0, DAILY_TEAM_ATTEMPTS - team.dailyAttemptsUsed) : 0;
  const teamPower = onFieldPets.reduce((sum, p) => sum + p.totalPower, 0);

  // ---- 拖拉編隊 ----
  const [dragging, setDragging] = useState<DeployablePet | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotRefs = useRef<(HTMLDivElement | null)[]>([]);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const startHold = useCallback(
    (pet: DeployablePet, x: number, y: number) => {
      cancelHold();
      holdTimerRef.current = setTimeout(() => {
        setDragging(pet);
        setDragPos({ x, y });
      }, DRAG_HOLD_MS);
    },
    [cancelHold],
  );

  const endDrag = useCallback(
    (x: number, y: number) => {
      cancelHold();
      if (!dragging) return;

      // 放開的位置落在哪一個站位上
      let target = -1;
      slotRefs.current.forEach((el, index) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) target = index;
      });

      if (target >= 0) {
        setSlots((prev) => {
          // 同一隻不能重複上陣：先把牠從別的站位拿掉
          const next = prev.map((p) => (p && p.id === dragging.id ? null : p));
          next[target] = dragging;
          return next;
        });
      }
      setDragging(null);
      setDragPos(null);
    },
    [cancelHold, dragging],
  );

  // 拖曳中要擋掉頁面捲動，不然手指移動會同時捲頁面
  useEffect(() => {
    if (!dragging) return;
    function onMove(e: PointerEvent) {
      e.preventDefault();
      setDragPos({ x: e.clientX, y: e.clientY });
    }
    function onUp(e: PointerEvent) {
      endDrag(e.clientX, e.clientY);
    }
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, endDrag]);

  async function handleSaveMembers() {
    const result = await saveTeamMembers(onFieldPets);
    setMessage(result.message);
  }

  async function handleOpenLeaderboard() {
    if (teamBlockReason) {
      setMessage(teamBlockReason);
      return;
    }
    if (attemptsLeft <= 0) {
      setMessage("今天的挑戰次數用完了，明天台北時間 00:00 會重置。");
      return;
    }
    // 開榜之前先把編隊存起來，不然學生調完陣容直接挑戰，對手看到的
    // 還是舊陣容（而且自己打的也會是舊的）。
    // ⚠️ 刻意不 await：Firebase SDK 在離線／網路不穩時會把寫入排進
    // 佇列、promise 遲遲不 resolve，await 的話學生按下「挑戰」會完全
    // 沒反應。編隊存檔失敗最壞情況只是這一場用到舊陣容，不該擋住
    // 整個挑戰流程。
    void saveTeamMembers(onFieldPets);
    setShowLeaderboard(true);
    setIsLoadingBoard(true);
    try {
      const board = await fetchLeaderboard();
      setLeaderboard(board);
    } catch (error) {
      console.error("[team] 載入排行榜失敗：", error);
      setMessage("排行榜載入失敗，請檢查網路。");
      setShowLeaderboard(false);
    } finally {
      setIsLoadingBoard(false);
    }
  }

  async function handleChallenge(opponent: TeamDoc, opponentRank: number) {
    if (!user || !team || !leaderboard) return;
    setShowLeaderboard(false);

    // 用對手「被挑戰當下的即時狀態」——所以這裡才去讀他的小雞，
    // 不吃排行榜上那份冗餘的 totalPower
    let enemyPets: DeployablePet[];
    try {
      enemyPets = await resolveTeamMembers(opponent.uid, opponent.members);
    } catch (error) {
      console.error("[team] 讀取對手隊伍失敗：", error);
      setMessage("讀不到對手的隊伍，請稍後再試。");
      return;
    }

    if (enemyPets.length === 0) {
      setMessage("對手目前沒有可以上場的小雞，換一個對手吧。");
      return;
    }

    const playerUnits = onFieldPets.map((p, i) => toBattleUnit(p, `p${i}`, "player"));
    const enemyUnits = enemyPets.map((p, i) => toBattleUnit(p, `e${i}`, "enemy"));
    const visuals: BattleUnitVisual[] = [
      ...onFieldPets.map((p, i) => toBattleVisual(p, `p${i}`)),
      ...enemyPets.map((p, i) => toBattleVisual(p, `e${i}`)),
    ];
    const result = simulateBattle(playerUnits, enemyUnits, {
      mode: "melee",
      seed: Date.now() % 1000000,
    });

    finishHandledRef.current = false;
    setSetup({
      opponent,
      opponentRank,
      myRank: getMyRank(leaderboard, user.uid),
      playerUnits,
      enemyUnits,
      visuals,
      result,
      myPets: onFieldPets,
    });
  }

  const handleBattleFinish = useCallback(
    (outcome: { winner: string; surrendered: boolean }) => {
      if (!setup) return;
      if (finishHandledRef.current) return;
      finishHandledRef.current = true;

      const won = outcome.winner === "player" && !outcome.surrendered;
      void finishTeamBattle({
        won,
        myRank: setup.myRank,
        opponentRank: setup.opponentRank,
        memberPetIds: setup.myPets.filter((p) => !p.isLiving).map((p) => p.id),
      }).then((r) => {
        setFinished({ won, surrendered: outcome.surrendered, delta: r.delta, newScore: r.newScore });
      });
    },
    [finishTeamBattle, setup],
  );

  if (!user) return null;

  // ---- 還沒有戰隊：強制取隊名 ----
  if (teamLoaded && !team) {
    return (
      <main className="min-h-screen pb-10" style={bgStyle}>
        <div className="mx-auto max-w-md px-4 pt-6">
          <div className="overflow-hidden rounded-[26px] p-[3px]" style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 60%,#F5C542 100%)" }}>
            <div className="overflow-hidden rounded-[23px] bg-[#0B0A18]">
              <div className="relative h-[170px]">
                <BattleBackdrop />
                <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1">
                  {deployables.slice(0, 3).map((pet) => (
                    <div key={pet.id} className="unit-idle">
                      <PetArt jobId={pet.jobId} size={70} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-5 pb-5 pt-4 text-center">
                <h1>
                  <span
                    className="fx-text text-[26px] font-black"
                    data-text="成立你的戰隊"
                    style={fxStyle("linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)", 6, "#1A1206")}
                  >
                    成立你的戰隊
                  </span>
                </h1>
                <p className="mt-1.5 text-[12px] leading-relaxed text-white/65">
                  派 3 隻小雞挑戰別人的戰隊，每個月結算一次，前三名有飼料獎勵。
                </p>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={TEAM_NAME_MAX_LENGTH}
                  placeholder="幫戰隊取個名字"
                  className="mt-4 w-full rounded-2xl bg-white/[0.07] px-3 py-3 text-center text-[15px] font-black text-white outline-none ring-2 ring-[#F5C542]/50 placeholder:text-white/30 focus:ring-[#F5C542]"
                />
                <p className="mt-1.5 text-[10.5px] text-white/40">之後每一季可以改一次（最多 {TEAM_NAME_MAX_LENGTH} 個字）</p>
                {message ? <p className="mt-2 text-[12px] font-black text-[#FF8A96]">{message}</p> : null}
                <button
                  type="button"
                  onClick={async () => {
                    const r = await createTeam(nameInput);
                    setMessage(r.message);
                  }}
                  className="btn-gold mt-4 w-full rounded-2xl px-4 py-3.5 text-[16px] font-black"
                >
                  成立戰隊
                </button>
                <button type="button" onClick={() => router.push("/")} className="mt-2 w-full rounded-2xl px-4 py-2.5 text-[12px] font-black text-white/50">
                  先不要
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!teamLoaded || !team) {
    return (
      <main className="min-h-screen" style={bgStyle}>
        <div className="pt-20 text-center">
          <span className="rpg-glass inline-block rounded-2xl px-4 py-2 text-sm font-black text-white/80">載入中…</span>
        </div>
      </main>
    );
  }

  const daysLeft = Math.ceil(getMillisecondsUntilSeasonEnd() / 86400000);
  const canChallenge = teamBlockReason === null && attemptsLeft > 0;

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <RpgHeader
          title="戰隊"
          onBack={() => router.push("/")}
          right={
            <>
              <RulesButton topic="team" variant="dark" />
              <AttemptsBadge left={attemptsLeft} max={DAILY_TEAM_ATTEMPTS} />
            </>
          }
        />

        {message ? (
          <p className="rpg-glass mt-3 rounded-2xl px-4 py-2.5 text-center text-[12px] font-black text-white">{message}</p>
        ) : null}

        {/* ---- 賽季資訊 ---- */}
        <div className="rpg-panel mt-3 flex items-center gap-3 rounded-2xl px-3.5 py-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: "radial-gradient(circle at 35% 30%, #FFF6CC, #F5C542 55%, #A8740F)" }}>
            <TrophyIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-black text-white">{getSeasonLabel(getSeasonId())}</p>
            <p className="text-[10.5px] font-bold text-white/50">還有 {daysLeft} 天結算・前三名有飼料獎勵</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-white/50">積分</p>
            <p className="font-display text-[26px] leading-none text-[#FFE58A]" style={{ textShadow: "0 0 12px rgba(245,197,66,0.5)" }}>
              {team.score}
            </p>
          </div>
        </div>

        {/* ---- 自己的戰隊：編隊舞台 ---- */}
        <section className="mt-3 overflow-hidden rounded-[24px] p-[2.5px]" style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 62%,#F5C542 100%)" }}>
          <div className="overflow-hidden rounded-[21.5px] bg-[#0B0A18]">
            <div className="relative h-[232px]">
              <BattleBackdrop />
              {/* 隊名＋戰績 */}
              <div className="absolute inset-x-0 top-0 flex items-start justify-between px-3 pb-6 pt-2.5" style={{ background: "linear-gradient(180deg, rgba(5,5,16,0.8), rgba(5,5,16,0))" }}>
                <div className="min-w-0">
                  <p className="truncate leading-none">
                    <span className="fx-text text-[20px] font-black" data-text={team.teamName} style={fxStyle("linear-gradient(180deg,#FFFFFF 10%,#FFE58A 100%)", 5, "#1A1206")}>
                      {team.teamName}
                    </span>
                  </p>
                  <p className="mt-1 flex items-center gap-2 text-[11px] font-black">
                    <span className="text-[#7FE8A8]">{team.wins} 勝</span>
                    <span className="text-[#FF8A96]">{team.losses} 敗</span>
                    <span className="text-white/50">
                      總戰力 <span className="font-display text-[13px] text-white">{teamPower}</span>
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(team.teamName);
                    setShowRename(true);
                  }}
                  className="shrink-0 rounded-xl bg-black/45 px-2.5 py-1.5 text-[10.5px] font-black text-white/80 ring-1 ring-white/20 transition-transform active:scale-95"
                >
                  改隊名
                </button>
              </div>

              {/* 三個站位 */}
              <div className="absolute inset-x-2 bottom-2 grid grid-cols-3 gap-1.5">
                {slots.map((pet, index) => (
                  <div
                    key={index}
                    ref={(el) => {
                      slotRefs.current[index] = el;
                    }}
                    className="relative flex h-[150px] flex-col items-center justify-end rounded-2xl pb-1.5 transition-colors"
                    style={{
                      background: dragging ? "rgba(245,197,66,0.12)" : undefined,
                      boxShadow: dragging ? "inset 0 0 0 2px rgba(245,197,66,0.8)" : undefined,
                    }}
                  >
                    {/* 地上的光陣 */}
                    <div
                      className="pointer-events-none absolute bottom-7 left-1/2 h-6 w-[88%] -translate-x-1/2 rounded-[50%]"
                      style={{
                        background: pet
                          ? `radial-gradient(closest-side, ${getJobColor(pet.jobId)}AA, ${getJobColor(pet.jobId)}00)`
                          : "radial-gradient(closest-side, rgba(255,255,255,0.22), rgba(255,255,255,0))",
                        boxShadow: pet ? undefined : "inset 0 0 0 1.5px rgba(255,255,255,0.35)",
                      }}
                    />
                    {pet ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setSlots((prev) => prev.map((p, i) => (i === index ? null : p)))}
                          className="absolute right-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-[11px] font-black text-white/80 ring-1 ring-white/25"
                          aria-label={`把 ${pet.name} 移出戰隊`}
                        >
                          ✕
                        </button>
                        <div className="unit-idle relative mb-1" style={{ animationDelay: `${index * -0.4}s` }}>
                          <PetArt jobId={pet.jobId} size={76} />
                        </div>
                        <div className="relative w-full rounded-lg bg-black/60 px-1 py-1 text-center ring-1 ring-white/15">
                          <p className="truncate text-[11px] font-black text-white">{pet.name}</p>
                          <p className="font-display text-[12px] leading-none text-[#FFE58A]">{pet.totalPower}</p>
                          {!pet.weapon ? <p className="text-[9px] font-black text-[#FF8A96]">沒有武器</p> : null}
                        </div>
                      </>
                    ) : (
                      <div className="relative mb-9 flex flex-col items-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-dashed border-white/40 text-[22px] font-black text-white/60">
                          +
                        </span>
                        <span className="mt-1.5 text-[10.5px] font-black text-white/60">空位 {index + 1}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
              <p className="min-w-0 flex-1 text-[10.5px] font-bold text-white/45">長按下方的小雞，拖到上面的空位</p>
              <button
                type="button"
                onClick={handleSaveMembers}
                className="shrink-0 rounded-xl bg-white/10 px-3 py-1.5 text-[11px] font-black text-white/85 ring-1 ring-white/20 transition-transform active:scale-95"
              >
                儲存編隊
              </button>
            </div>
          </div>
        </section>

        {/* ---- 大挑戰按鈕 ---- */}
        <button
          type="button"
          disabled={!canChallenge}
          onClick={handleOpenLeaderboard}
          className="btn-gold mt-3 flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-4 text-[18px] font-black tracking-[0.12em]"
        >
          <CrossedSwordsIcon />
          挑戰
        </button>
        {teamBlockReason ? (
          <div className="mt-2 rounded-2xl bg-[#B0102A]/90 px-3 py-2.5 text-center ring-1 ring-[#FF6A7A]/50">
            <p className="text-[12px] font-black text-white">{teamBlockReason}</p>
            <button
              type="button"
              onClick={() => router.push("/inventory")}
              className="mt-1.5 rounded-xl bg-white px-3 py-1.5 text-[11px] font-black text-[#B0102A]"
            >
              去物品頁買武器
            </button>
          </div>
        ) : attemptsLeft <= 0 ? (
          <p className="mt-2 text-center">
            <span className="rpg-glass inline-block rounded-full px-3 py-1 text-[11px] font-bold text-white/80">今天的挑戰次數用完了，明天 00:00 重置</span>
          </p>
        ) : null}

        {/* ---- 下方收藏網格（拖到上面編隊） ---- */}
        <section className="rpg-panel mt-3 rounded-2xl px-3 py-3">
          <p className="px-1 text-[12px] font-black text-white/70">我的小雞</p>
          {deployables.length === 0 ? (
            <p className="mt-3 rounded-xl bg-white/[0.05] px-3 py-4 text-center text-[12px] font-bold text-white/55">
              還沒有可以上場的小雞。把小雞養到大師雞就能編進戰隊。
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {deployables.map((pet) => {
                const onField = slots.some((s) => s?.id === pet.id);
                const jobColor = getJobColor(pet.jobId);
                return (
                  <div
                    key={pet.id}
                    onPointerDown={(e) => startHold(pet, e.clientX, e.clientY)}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    className="relative select-none rounded-xl p-[1.5px]"
                    style={{
                      background: `linear-gradient(160deg, ${jobColor}CC, #2A2850)`,
                      opacity: onField ? 0.5 : 1,
                      touchAction: "pan-y",
                    }}
                  >
                    <div className="flex flex-col items-center rounded-[10px] px-1 pb-1.5 pt-1" style={{ background: `radial-gradient(circle at 50% 30%, ${jobColor}44 0%, #14132A 72%)` }}>
                      <PetArt jobId={pet.jobId} size={44} />
                      <span className="w-full truncate text-center text-[10px] font-black text-white">{pet.name}</span>
                      <span className="font-display text-[11px] leading-none text-[#FFE58A]">{pet.totalPower}</span>
                      {!pet.weapon ? <span className="text-[8.5px] font-black text-[#FF8A96]">沒有武器</span> : null}
                    </div>
                    {onField ? (
                      <span className="absolute inset-x-[1.5px] top-[1.5px] rounded-t-[10px] bg-[#F5C542] py-0.5 text-center text-[9.5px] font-black text-[#3A1D00]">上場中</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2.5 px-1 text-[10.5px] leading-relaxed text-white/45">
            整隊只要至少一隻有武器就能出戰，空手的小雞也能上去當肉盾。
          </p>
        </section>
      </div>

      {/* ---- 拖曳中的浮動影像 ---- */}
      {dragging && dragPos ? (
        <div
          className="pointer-events-none fixed z-[80] flex flex-col items-center rounded-2xl px-2 py-1.5"
          style={{
            left: dragPos.x - 34,
            top: dragPos.y - 44,
            background: "linear-gradient(180deg,#2A2850,#14132A)",
            boxShadow: "0 0 0 2px #F5C542, 0 0 18px rgba(245,197,66,0.7), 0 12px 24px rgba(0,0,0,0.5)",
            transform: "rotate(-4deg) scale(1.08)",
          }}
        >
          <PetArt jobId={dragging.jobId} size={46} />
          <span className="text-[10px] font-black text-white">{dragging.name}</span>
        </div>
      ) : null}

      {/* ---- 改隊名 ---- */}
      {showRename ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 px-4">
          <div className="result-card w-full max-w-sm rounded-[26px] p-[3px]" style={{ background: "linear-gradient(160deg,#FFF1B8 0%,#E8B84B 30%,#8A5A12 62%,#F5C542 100%)" }}>
            <div className="rounded-[23px] bg-gradient-to-b from-[#221F48] to-[#0E0D1E] p-5">
              <h3 className="text-center">
                <span className="fx-text text-[20px] font-black" data-text="改隊名" style={fxStyle("linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)", 5, "#1A1206")}>
                  改隊名
                </span>
              </h3>
              <p className="mt-1 text-center text-[11.5px] text-white/60">
                {team.renameCountThisSeason >= 1 ? "這一季已經改過一次了，下一季才能再改。" : "每一季只能改一次，改完這一季就不能再改。"}
              </p>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={TEAM_NAME_MAX_LENGTH}
                disabled={team.renameCountThisSeason >= 1}
                className="mt-3 w-full rounded-2xl bg-white/[0.07] px-3 py-3 text-center text-[15px] font-black text-white outline-none ring-2 ring-[#F5C542]/50 focus:ring-[#F5C542] disabled:opacity-40"
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setShowRename(false)}
                  className="rounded-2xl bg-white/10 px-3 py-3 text-sm font-black text-white/80 ring-1 ring-white/20"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={team.renameCountThisSeason >= 1}
                  onClick={async () => {
                    const r = await renameTeam(nameInput);
                    setMessage(r.message);
                    if (r.success) setShowRename(false);
                  }}
                  className="btn-gold rounded-2xl px-3 py-3 text-sm font-black"
                >
                  確定
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- 排行榜半屏彈窗 ---- */}
      {showLeaderboard ? (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/65" onClick={() => setShowLeaderboard(false)}>
          <div
            className="rules-sheet max-h-[76vh] w-full overflow-y-auto rounded-t-[28px] px-4 pb-6 pt-4"
            style={{ background: "linear-gradient(180deg,#221F48 0%,#0E0D1E 100%)", boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="選一個對手"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="text-center">
              <span className="fx-text text-[21px] font-black" data-text="選一個對手" style={fxStyle("linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)", 5, "#1A1206")}>
                選一個對手
              </span>
            </h3>
            <p className="mt-1 text-center text-[11px] text-white/50">挑戰排名比你高的隊伍，贏了加比較多分</p>

            {isLoadingBoard || !leaderboard ? (
              <p className="py-10 text-center text-sm font-black text-white/50">載入中…</p>
            ) : leaderboard.length === 0 ? (
              <p className="py-10 text-center text-sm font-black text-white/50">目前還沒有任何戰隊上榜</p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {leaderboard.map((t, index) => {
                  const rank = index + 1;
                  const isMe = t.uid === user.uid;
                  const myRank = getMyRank(leaderboard, user.uid);
                  const preview = previewScoreChange(myRank, rank, team.score);
                  const medal = rank <= 3 ? MEDALS[rank - 1] : null;
                  return (
                    <div
                      key={t.uid}
                      className="flex items-center gap-2.5 rounded-2xl px-2.5 py-2"
                      style={{
                        background: isMe
                          ? "linear-gradient(90deg, rgba(79,195,255,0.22), rgba(79,195,255,0.06))"
                          : medal
                            ? `linear-gradient(90deg, ${medal.glow}30, rgba(255,255,255,0.03))`
                            : "rgba(255,255,255,0.05)",
                        boxShadow: isMe ? "inset 0 0 0 1.5px rgba(79,195,255,0.6)" : medal ? `inset 0 0 0 1px ${medal.glow}66` : "inset 0 0 0 1px rgba(255,255,255,0.06)",
                      }}
                    >
                      {medal ? (
                        <span
                          className="font-display flex h-8 w-8 shrink-0 items-center justify-center text-[15px] leading-none"
                          style={{ clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)", background: medal.fill, color: "#2A1600" }}
                        >
                          {rank}
                        </span>
                      ) : (
                        <span className="font-display w-8 shrink-0 text-center text-[15px] text-white/55">{rank}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-black text-white">
                          {t.teamName}
                          {isMe ? <span className="ml-1.5 text-[10px] font-black text-[#7FD3FF]">你</span> : null}
                        </p>
                        <p className="truncate text-[10.5px] font-bold text-white/45">
                          {t.ownerName}・戰力 <span className="font-display text-[11px] text-white/70">{t.totalPower}</span>
                        </p>
                      </div>
                      <span className="font-display shrink-0 text-[16px] text-[#FFE58A]">{t.score}</span>
                      {isMe ? (
                        <span className="w-[68px] shrink-0" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleChallenge(t, rank)}
                          className="btn-gold w-[68px] shrink-0 rounded-xl px-1.5 py-1.5 text-[12px] font-black leading-tight"
                        >
                          挑戰
                          <span className="block text-[9.5px] font-black">
                            <span className="text-[#1E6B2E]">+{preview.onWin}</span>
                            <span className="text-[#3A1D00]/50"> / </span>
                            <span className="text-[#8A1020]">{preview.onLose}</span>
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ---- 戰鬥 ---- */}
      {setup && !finished ? (
        <div
          className="fixed inset-0 z-[75] flex items-center overflow-y-auto px-3 py-4"
          style={{ background: "radial-gradient(ellipse at 50% 30%, #2A1C12 0%, #0B0A18 70%)" }}
        >
          <div className="mx-auto w-full max-w-md">
            <BattleStage
              playerUnits={setup.playerUnits}
              enemyUnits={setup.enemyUnits}
              visuals={setup.visuals}
              result={setup.result}
              title={`${team.teamName} vs ${setup.opponent.teamName}`}
              playerLabel={team.teamName}
              enemyLabel={setup.opponent.teamName}
              onFinish={handleBattleFinish}
            />
          </div>
        </div>
      ) : null}

      {/* ---- 結算 ---- */}
      {finished && setup ? (
        <BattleResultCard
          won={finished.won}
          surrendered={finished.surrendered}
          title={`對手：${setup.opponent.teamName}（第 ${setup.opponentRank} 名）`}
          durationSeconds={setup.result.durationSeconds}
          defeated={setup.result.enemiesDefeated}
          totalEnemies={setup.enemyUnits.length}
          extraLines={[
            finished.delta >= 0
              ? `積分 +${finished.delta}（目前 ${finished.newScore} 分）`
              : `積分 ${finished.delta}（目前 ${finished.newScore} 分）`,
          ]}
          loseHint={
            !finished.won && !finished.surrendered
              ? "對手的隊伍比較強。去合成更高階的裝備，或換幾隻戰力更高的小雞上陣。"
              : null
          }
          primaryLabel="再挑戰"
          onPrimary={() => {
            setFinished(null);
            setSetup(null);
            void handleOpenLeaderboard();
          }}
          secondaryLabel="回戰隊"
          onSecondary={() => {
            setFinished(null);
            setSetup(null);
          }}
        />
      ) : null}
    </main>
  );
}

// ============================================================
// 小工具
// ============================================================

/** 前三名的獎牌配色：金、銀、銅 */
const MEDALS = [
  { fill: "linear-gradient(180deg,#FFF6CC 0%,#F5C542 55%,#B47A0A 100%)", glow: "#F5C542" },
  { fill: "linear-gradient(180deg,#FFFFFF 0%,#C9D0DC 55%,#7A8494 100%)", glow: "#C9D0DC" },
  { fill: "linear-gradient(180deg,#FFE0C2 0%,#D9864A 55%,#8A4A1A 100%)", glow: "#D9864A" },
];

/** 特效字的 CSS 變數 */
function fxStyle(fill: string, stroke: number, strokeColor: string): React.CSSProperties {
  return {
    ["--fx-fill" as string]: fill,
    ["--fx-stroke" as string]: `${stroke}px`,
    ["--fx-stroke-color" as string]: strokeColor,
  } as React.CSSProperties;
}

function TrophyIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="#3A1D00" aria-hidden="true">
      <path d="M7 3h10v3h3v2a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V17h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V6h3V3zm-1 5a2 2 0 0 0 1.2 1.8A6 6 0 0 1 7 8V8H6zm11 0v0a6 6 0 0 1-.2 1.8A2 2 0 0 0 18 8h-1z" />
    </svg>
  );
}

function CrossedSwordsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
      <path d="M9.5 6.5 14 2h3v3l-4.5 4.5" />
      <path d="m5 14 6 6M7 17l-3 3M3 19l2 2" />
    </svg>
  );
}

export default function TeamPage() {
  return (
    <RequireAuth>
      <TeamContent />
    </RequireAuth>
  );
}
