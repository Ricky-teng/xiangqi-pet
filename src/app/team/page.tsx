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
import { getCatalogEntryById } from "@/lib/pet/catalog";
import RulesButton from "@/components/RulesButton";
import type { TeamDoc } from "@/types/rpg";

/** 長按幾毫秒才啟動拖曳 */
const DRAG_HOLD_MS = 300;

function PetAvatar({ jobId, size }: { jobId: string | null; size: number }) {
  const entry = jobId ? getCatalogEntryById(jobId) : null;
  const [failed, setFailed] = useState(false);
  if (!entry || failed) {
    return <span style={{ fontSize: size * 0.72 }}>{entry?.fallbackEmoji ?? "🐔"}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.imagePath}
      alt={entry.name}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

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
      <main className="min-h-screen bg-[#FDF6E8] pb-10">
        <div className="mx-auto max-w-md px-4 pt-6">
          <div className="rounded-3xl bg-white/80 px-5 py-6 text-center shadow-sm">
            <p className="text-3xl">⚔️</p>
            <h1 className="mt-2 text-lg font-extrabold text-[#1A1A2E]">成立你的戰隊</h1>
            <p className="mt-1 text-xs text-[#1A1A2E]/55">
              派 3 隻小雞挑戰別人的戰隊，每個月結算一次，前三名有飼料獎勵。
            </p>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={TEAM_NAME_MAX_LENGTH}
              placeholder="幫戰隊取個名字"
              className="mt-4 w-full rounded-xl border border-[#E8B84B] bg-white px-3 py-2.5 text-center text-sm font-bold text-[#1A1A2E] outline-none focus:border-[#5C3D0A]"
            />
            <p className="mt-1 text-[10px] text-[#1A1A2E]/40">
              之後每一季可以改一次（最多 {TEAM_NAME_MAX_LENGTH} 個字）
            </p>
            {message ? (
              <p className="mt-2 text-[11px] font-bold text-[#C0392B]">{message}</p>
            ) : null}
            <button
              type="button"
              onClick={async () => {
                const r = await createTeam(nameInput);
                setMessage(r.message);
              }}
              className="mt-4 w-full rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
            >
              成立戰隊
            </button>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="mt-2 w-full rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-[#1A1A2E]/60"
            >
              先不要
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (!teamLoaded || !team) {
    return (
      <main className="min-h-screen bg-[#FDF6E8]">
        <p className="pt-20 text-center text-sm text-[#1A1A2E]/50">載入中…</p>
      </main>
    );
  }

  const daysLeft = Math.ceil(getMillisecondsUntilSeasonEnd() / 86400000);

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">⚔️ 戰隊</h1>
          <div className="flex items-center gap-1.5">
            <RulesButton topic="team" />
            <span className="rounded-full bg-[#1A1A2E] px-2.5 py-1 text-[10px] font-bold text-[#E8B84B]">
              {attemptsLeft}/{DAILY_TEAM_ATTEMPTS}
            </span>
          </div>
        </header>

        {message ? (
          <p className="mt-3 rounded-2xl bg-[#1A1A2E] px-4 py-2.5 text-center text-xs font-bold text-white shadow-md">
            {message}
          </p>
        ) : null}

        {/* ---- 賽季資訊 ---- */}
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-white/60 px-3 py-2">
          <div>
            <p className="text-[10px] font-bold text-[#1A1A2E]/45">
              {getSeasonLabel(getSeasonId())}
            </p>
            <p className="text-[10px] text-[#1A1A2E]/45">還有 {daysLeft} 天結算</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-[#1A1A2E]/45">目前積分</p>
            <p className="text-base font-extrabold text-[#5C3D0A]">{team.score}</p>
          </div>
        </div>

        {/* ---- 自己的戰隊 ---- */}
        <section className="mt-3 rounded-3xl bg-white/75 px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold text-[#1A1A2E]">{team.teamName}</p>
              <p className="text-[10px] text-[#1A1A2E]/45">
                {team.wins} 勝 {team.losses} 敗・總戰力 {teamPower}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNameInput(team.teamName);
                setShowRename(true);
              }}
              className="shrink-0 rounded-lg bg-[#1A1A2E]/5 px-2 py-1 text-[10px] font-bold text-[#1A1A2E]/60"
            >
              改隊名
            </button>
          </div>

          {/* 三個站位 */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {slots.map((pet, index) => (
              <div
                key={index}
                ref={(el) => {
                  slotRefs.current[index] = el;
                }}
                className={[
                  "relative flex h-24 flex-col items-center justify-center rounded-2xl border-2",
                  // 虛線只留給「空位／可放置」，有雞的站位是實線。
                  // 兩種都用虛線的話，滿編的隊伍看起來像三個都還沒放好。
                  pet && !dragging ? "" : "border-dashed",
                ].join(" ")}
                style={{
                  borderColor: dragging
                    ? "#E8B84B"
                    : pet
                      ? getJobColor(pet.jobId)
                      : "rgba(26,26,46,0.18)",
                  backgroundColor: pet ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)",
                  boxShadow: dragging ? "0 0 12px #E8B84B88" : undefined,
                }}
              >
                {pet ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSlots((prev) => prev.map((p, i) => (i === index ? null : p)))}
                      className="absolute right-1 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#1A1A2E]/10 text-[10px] font-bold text-[#1A1A2E]/50"
                      aria-label="移除"
                    >
                      ✕
                    </button>
                    <PetAvatar jobId={pet.jobId} size={36} />
                    <span className="mt-0.5 w-full truncate px-1 text-center text-[10px] font-extrabold text-[#1A1A2E]">
                      {pet.name}
                    </span>
                    <span className="text-[9px] font-bold text-[#5C3D0A]">戰力 {pet.totalPower}</span>
                    {!pet.weapon ? (
                      <span className="text-[8px] font-bold text-[#C0392B]">無武器</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-xs text-[#1A1A2E]/25">空位 {index + 1}</span>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSaveMembers}
            className="mt-2 w-full rounded-xl bg-[#1A1A2E]/5 px-3 py-1.5 text-[11px] font-bold text-[#1A1A2E]/60"
          >
            儲存編隊
          </button>
        </section>

        {/* ---- 大挑戰按鈕 ---- */}
        <button
          type="button"
          disabled={teamBlockReason !== null || attemptsLeft <= 0}
          onClick={handleOpenLeaderboard}
          className="mt-3 w-full rounded-2xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-3.5 text-base font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
          style={{
            boxShadow:
              teamBlockReason === null && attemptsLeft > 0
                ? "inset 0 1px 6px rgba(255,255,255,0.6), 0 6px 14px rgba(92,61,10,0.3)"
                : undefined,
          }}
        >
          ⚔️ 挑戰
        </button>
        {teamBlockReason ? (
          <div className="mt-2 rounded-2xl bg-[#C0392B]/10 px-3 py-2.5 text-center">
            <p className="text-xs font-bold text-[#C0392B]">{teamBlockReason}</p>
            <button
              type="button"
              onClick={() => router.push("/inventory")}
              className="mt-1.5 rounded-xl bg-[#C0392B] px-3 py-1.5 text-[11px] font-bold text-white"
            >
              去物品頁買武器
            </button>
          </div>
        ) : null}

        {/* ---- 下方收藏網格（拖到上面編隊） ---- */}
        <section className="mt-3 rounded-3xl bg-white/75 px-4 py-3 shadow-sm">
          <p className="text-xs font-bold text-[#1A1A2E]/60">
            我的小雞（長按拖到上面的空位）
          </p>
          {deployables.length === 0 ? (
            <p className="mt-3 rounded-2xl bg-white/70 px-3 py-4 text-center text-xs text-[#1A1A2E]/50">
              還沒有可以上場的小雞。把小雞養到大師雞就能編進戰隊。
            </p>
          ) : (
            <div className="mt-2 grid grid-cols-4 gap-2">
              {deployables.map((pet) => {
                const onField = slots.some((s) => s?.id === pet.id);
                return (
                  <div
                    key={pet.id}
                    onPointerDown={(e) => startHold(pet, e.clientX, e.clientY)}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    className="flex select-none flex-col items-center rounded-2xl border bg-white/90 px-1 py-2 text-center"
                    style={{
                      borderColor: onField ? getJobColor(pet.jobId) : "rgba(26,26,46,0.1)",
                      opacity: onField ? 0.45 : 1,
                      touchAction: "pan-y",
                    }}
                  >
                    <PetAvatar jobId={pet.jobId} size={28} />
                    <span className="w-full truncate text-[9px] font-extrabold text-[#1A1A2E]">
                      {pet.name}
                    </span>
                    <span className="text-[9px] text-[#5C3D0A]">{pet.totalPower}</span>
                    {!pet.weapon ? (
                      <span className="text-[8px] font-bold text-[#C0392B]">無武器</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 text-[10px] text-[#1A1A2E]/40">
            戰隊只要「整隊至少一隻有武器」就能出戰，空手的小雞也能上去當肉盾
          </p>
        </section>
      </div>

      {/* ---- 拖曳中的浮動影像 ---- */}
      {dragging && dragPos ? (
        <div
          className="pointer-events-none fixed z-[80] flex flex-col items-center rounded-2xl bg-white px-2 py-1.5 shadow-2xl"
          style={{
            left: dragPos.x - 28,
            top: dragPos.y - 34,
            border: `2px solid ${getJobColor(dragging.jobId)}`,
          }}
        >
          <PetAvatar jobId={dragging.jobId} size={30} />
          <span className="text-[9px] font-extrabold text-[#1A1A2E]">{dragging.name}</span>
        </div>
      ) : null}

      {/* ---- 改隊名 ---- */}
      {showRename ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-3xl bg-[#FDF6E8] p-5 shadow-2xl">
            <h3 className="text-center text-base font-extrabold text-[#1A1A2E]">改隊名</h3>
            <p className="mt-1 text-center text-[11px] text-[#1A1A2E]/55">
              {team.renameCountThisSeason >= 1
                ? "這一季已經改過一次了，下一季才能再改。"
                : "每一季只能改一次，改完這一季就不能再改。"}
            </p>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={TEAM_NAME_MAX_LENGTH}
              disabled={team.renameCountThisSeason >= 1}
              className="mt-3 w-full rounded-xl border border-[#E8B84B] bg-white px-3 py-2.5 text-center text-sm font-bold text-[#1A1A2E] outline-none disabled:opacity-50"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowRename(false)}
                className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1A2E]/70 shadow-sm"
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
                className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md disabled:opacity-40"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- 排行榜半屏彈窗 ---- */}
      {showLeaderboard ? (
        <div
          className="fixed inset-0 z-[70] flex items-end bg-black/60"
          onClick={() => setShowLeaderboard(false)}
        >
          <div
            className="max-h-[72vh] w-full overflow-y-auto rounded-t-3xl bg-[#FDF6E8] px-4 pb-6 pt-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#1A1A2E]/15" />
            <h3 className="text-center text-base font-extrabold text-[#1A1A2E]">選一個對手</h3>
            <p className="mt-0.5 text-center text-[10px] text-[#1A1A2E]/45">
              挑戰比自己排名高的人，贏了加比較多分
            </p>

            {isLoadingBoard || !leaderboard ? (
              <p className="py-10 text-center text-sm text-[#1A1A2E]/50">載入中…</p>
            ) : leaderboard.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#1A1A2E]/50">
                目前還沒有任何戰隊上榜
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {leaderboard.map((t, index) => {
                  const rank = index + 1;
                  const isMe = t.uid === user.uid;
                  const myRank = getMyRank(leaderboard, user.uid);
                  const preview = previewScoreChange(myRank, rank, team.score);
                  return (
                    <div
                      key={t.uid}
                      className="flex items-center gap-2 rounded-2xl bg-white/85 px-3 py-2"
                      style={{ opacity: isMe ? 0.5 : 1 }}
                    >
                      <span className="w-6 shrink-0 text-center text-xs font-extrabold text-[#5C3D0A]">
                        {rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-extrabold text-[#1A1A2E]">
                          {t.teamName}
                        </p>
                        <p className="truncate text-[10px] text-[#1A1A2E]/45">
                          {t.ownerName}・戰力 {t.totalPower}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-extrabold text-[#1A1A2E]">
                        {t.score}
                      </span>
                      {isMe ? (
                        <span className="w-16 shrink-0 text-center text-[10px] font-bold text-[#1A1A2E]/40">
                          你自己
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleChallenge(t, rank)}
                          className="w-16 shrink-0 rounded-lg bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-2 py-1.5 text-[10px] font-extrabold text-[#5C3D0A] shadow-sm transition-transform active:scale-95"
                        >
                          挑戰
                          <span className="block text-[8px] font-bold text-[#5C3D0A]/70">
                            +{preview.onWin} / {preview.onLose}
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
        <div className="fixed inset-0 z-[75] overflow-y-auto bg-[#FDF6E8] px-4 py-4">
          <div className="mx-auto max-w-md">
            <p className="mb-2 text-center text-xs font-bold text-[#1A1A2E]/55">
              {team.teamName} vs {setup.opponent.teamName}
            </p>
            <BattleStage
              playerUnits={setup.playerUnits}
              enemyUnits={setup.enemyUnits}
              visuals={setup.visuals}
              result={setup.result}
              accentColor="#A9764C"
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

export default function TeamPage() {
  return (
    <RequireAuth>
      <TeamContent />
    </RequireAuth>
  );
}
