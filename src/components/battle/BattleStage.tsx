// src/components/battle/BattleStage.tsx
"use client";

/**
 * 橫向捲軸戰鬥播放器（探險與戰隊共用）
 * ------------------------------------------------------------
 * 這個元件「只負責播放」，完全不做任何戰鬥判定。
 *
 * 勝負在按下開始的那一刻就已經由 lib/rpg/battle.ts 的 simulateBattle()
 * 算完了，傳進來的 result 裡面是一整串帶時間戳的事件。播放器做的事
 * 就是推進一個時間游標，把時間到了的事件套用到畫面狀態上。
 *
 * 所以：
 *   - 切換 ×1 / ×2 不會改變結果，只是時間游標跑得快一倍
 *   - 中途投降也不會「改寫」結果，是直接以失敗結束（見 onSurrender）
 *   - 畫面卡頓、分頁被切走都不影響正確性，頂多是動畫不流暢
 *
 * HUD 由上到下：雙方血條（帶數字）→ 舞台 → 進度條「還剩幾隻怪」
 * → 戰鬥日誌（小字滾動）。右上角是投降與速度切換。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogEntryById } from "@/lib/pet/catalog";
import { getJobColor } from "@/lib/rpg/jobVisual";
import type { BattleEvent, BattleResult, BattleSide, BattleUnit } from "@/lib/rpg/battle";

/** 可選的播放速度。規格只要 ×1 跟 ×2 兩段 */
export const BATTLE_SPEEDS = [1, 2] as const;
export type BattleSpeed = (typeof BATTLE_SPEEDS)[number];

/**
 * 戰鬥單位的顯示資訊。BattleUnit 本身只有數值，畫面需要的
 * 圖／emoji／光環顏色由呼叫端一起帶進來。
 */
export interface BattleUnitVisual {
  /** 對應 BattleUnit.id */
  id: string;
  /** 職業 id，有的話畫職業圖＋職業色光環 */
  jobId?: string | null;
  /** 沒有職業圖時顯示的 emoji（怪物一律走這條） */
  emoji?: string;
}

interface BattleStageProps {
  playerUnits: BattleUnit[];
  enemyUnits: BattleUnit[];
  visuals: BattleUnitVisual[];
  result: BattleResult;
  /** 這座塔的主色，用來染背景（探險用；戰隊傳預設值就好） */
  accentColor?: string;
  /** 播完（或投降）之後呼叫。surrendered = 中途按投降 */
  onFinish: (outcome: { winner: BattleSide; surrendered: boolean }) => void;
}

interface RuntimeState {
  hp: Record<string, number>;
  alive: Record<string, boolean>;
  onField: Record<string, boolean>;
  /** 剛剛被打到的單位（畫抖動用），值是觸發時間戳 */
  hitAt: Record<string, number>;
}

interface FloatingNumber {
  key: number;
  unitId: string;
  text: string;
  isHigh: boolean;
  isHeal: boolean;
}

interface LogLine {
  key: number;
  text: string;
}

/** 日誌最多留幾行，避免打很久之後 DOM 無限長 */
const MAX_LOG_LINES = 40;

/** 一隻小雞／怪物的顯示 */
function UnitSprite({
  unit,
  visual,
  hp,
  alive,
  isHit,
  isTarget,
  compact,
}: {
  unit: BattleUnit;
  visual: BattleUnitVisual | undefined;
  hp: number;
  alive: boolean;
  isHit: boolean;
  isTarget: boolean;
  /** 場上人多的時候（戰隊六隻混戰）縮小，不然第六隻會被擠出畫面 */
  compact: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const entry = visual?.jobId ? getCatalogEntryById(visual.jobId) : null;
  const glowColor = unit.side === "player" ? getJobColor(visual?.jobId) : "#C0392B";
  const hpPercent = Math.max(0, Math.round((hp / unit.maxHp) * 100));
  const boxSize = compact ? 38 : 48;
  const imgSize = compact ? 30 : 40;

  return (
    <div
      className={["relative flex shrink-0 flex-col items-center", compact ? "w-11" : "w-14"].join(" ")}
      style={{
        animation: !alive
          ? "battle-death-fade 0.45s ease-in forwards"
          : isHit
            ? "battle-hit-shake 0.18s ease-in-out"
            : undefined,
      }}
    >
      {/* 小血條：六隻混戰的時候，光看上面的總血條分不出誰快倒了 */}
      <div
        className="mb-0.5 h-1 overflow-hidden rounded-full bg-black/30"
        style={{ width: boxSize - 6 }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-150"
          style={{
            width: `${hpPercent}%`,
            backgroundColor: unit.side === "player" ? "#5B8C5A" : "#C0392B",
          }}
        />
      </div>

      <div
        className="flex items-center justify-center rounded-full"
        style={{
          width: boxSize,
          height: boxSize,
          // 職業色光環。目前正在被攻擊的那一隻光環加亮，
          // 讓學生的視線知道現在該看哪裡。
          boxShadow: alive ? `0 0 ${isTarget ? 18 : 10}px ${glowColor}` : "none",
          backgroundColor: "rgba(255,255,255,0.14)",
        }}
      >
        {entry && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.imagePath}
            alt={unit.name}
            width={imgSize}
            height={imgSize}
            onError={() => setImageFailed(true)}
            style={{
              width: imgSize,
              height: imgSize,
              objectFit: "contain",
              // 敵方（別人的戰隊）水平翻轉，面對我方
              transform: unit.side === "enemy" ? "scaleX(-1)" : undefined,
            }}
          />
        ) : (
          <span
            className={compact ? "text-lg" : "text-2xl"}
            style={{ transform: unit.side === "enemy" ? "scaleX(-1)" : undefined }}
          >
            {visual?.emoji ?? entry?.fallbackEmoji ?? (unit.side === "player" ? "🐔" : "👾")}
          </span>
        )}
      </div>
    </div>
  );
}

export default function BattleStage({
  playerUnits,
  enemyUnits,
  visuals,
  result,
  accentColor = "#E8B84B",
  onFinish,
}: BattleStageProps) {
  const allUnits = useMemo(() => [...playerUnits, ...enemyUnits], [playerUnits, enemyUnits]);
  const unitById = useMemo(() => {
    const map: Record<string, BattleUnit> = {};
    for (const u of allUnits) map[u.id] = u;
    return map;
  }, [allUnits]);
  const visualById = useMemo(() => {
    const map: Record<string, BattleUnitVisual> = {};
    for (const v of visuals) map[v.id] = v;
    return map;
  }, [visuals]);

  const initialState = useCallback((): RuntimeState => {
    const hp: Record<string, number> = {};
    const alive: Record<string, boolean> = {};
    const onField: Record<string, boolean> = {};
    for (const u of allUnits) {
      hp[u.id] = u.maxHp;
      alive[u.id] = true;
      onField[u.id] = false;
    }
    return { hp, alive, onField, hitAt: {} };
  }, [allUnits]);

  const [state, setState] = useState<RuntimeState>(initialState);
  const [speed, setSpeed] = useState<BattleSpeed>(1);
  const [floats, setFloats] = useState<FloatingNumber[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [currentTarget, setCurrentTarget] = useState<string | null>(null);
  const [defeated, setDefeated] = useState(0);
  const [isDone, setIsDone] = useState(false);

  // 下一個還沒播的事件索引。用 ref 而不是 state，因為每一幀都會動，
  // 放 state 會讓每一幀都排一次重繪。
  const eventIndexRef = useRef(0);
  const elapsedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const keyRef = useRef(0);
  const logBottomRef = useRef<HTMLDivElement | null>(null);

  const totalEnemies = enemyUnits.length;

  const unitName = useCallback(
    (id: string) => unitById[id]?.name ?? "？",
    [unitById],
  );

  /** 把一個事件套用到畫面狀態上 */
  const applyEvent = useCallback(
    (event: BattleEvent) => {
      keyRef.current += 1;
      const key = keyRef.current;

      switch (event.type) {
        case "spawn":
          setState((prev) => ({ ...prev, onField: { ...prev.onField, [event.unitId]: true } }));
          break;

        case "attack": {
          setState((prev) => ({
            ...prev,
            hp: { ...prev.hp, [event.targetId]: event.targetHpAfter },
            hitAt: { ...prev.hitAt, [event.targetId]: key },
          }));
          setCurrentTarget(event.targetId);
          // 同一隻身上只留最新的一個數字。六隻混戰時每秒好幾刀，
          // 不這樣做的話數字會疊成一團完全看不清楚。
          setFloats((prev) => [
            ...prev.filter((f) => f.unitId !== event.targetId).slice(-6),
            { key, unitId: event.targetId, text: `-${event.damage}`, isHigh: event.isHigh, isHeal: false },
          ]);
          setLogs((prev) =>
            [
              ...prev,
              {
                key,
                text: `${unitName(event.attackerId)} 攻擊 ${unitName(event.targetId)}，造成 ${event.damage} 點傷害`,
              },
            ].slice(-MAX_LOG_LINES),
          );
          break;
        }

        case "death":
          setState((prev) => ({ ...prev, alive: { ...prev.alive, [event.unitId]: false } }));
          // 倒下動畫播完（0.45 秒）就把它從場上移除。
          // 一定要移除，不能只是變透明：探險一關有 9~18 隻怪，屍體
          // 留在場上會一路把還活著的那隻往旁邊擠，打到後面正在打的
          // 怪會跑到畫面外面去。
          setTimeout(() => {
            setState((prev) => ({ ...prev, onField: { ...prev.onField, [event.unitId]: false } }));
          }, 460);
          if (unitById[event.unitId]?.side === "enemy") {
            setDefeated((prev) => prev + 1);
          }
          setLogs((prev) =>
            [...prev, { key, text: `💥 ${unitName(event.unitId)} 倒下了！` }].slice(-MAX_LOG_LINES),
          );
          break;

        case "heal":
          setState((prev) => ({ ...prev, hp: { ...prev.hp, [event.unitId]: event.hpAfter } }));
          setFloats((prev) => [
            ...prev.filter((f) => f.unitId !== event.unitId).slice(-6),
            { key, unitId: event.unitId, text: `+${event.amount}`, isHigh: false, isHeal: true },
          ]);
          setLogs((prev) =>
            [...prev, { key, text: `💚 ${unitName(event.unitId)} 回復了 ${event.amount} 點體力` }].slice(
              -MAX_LOG_LINES,
            ),
          );
          break;

        case "end":
          setLogs((prev) =>
            [
              ...prev,
              { key, text: event.winner === "player" ? "🎉 戰鬥勝利！" : "💀 戰鬥失敗……" },
            ].slice(-MAX_LOG_LINES),
          );
          break;
      }
    },
    [unitById, unitName],
  );

  // ---- 主迴圈：每一幀推進時間游標，把到期的事件播出來 ----
  useEffect(() => {
    let lastTs: number | null = null;

    function frame(ts: number) {
      if (lastTs === null) lastTs = ts;
      const deltaSeconds = ((ts - lastTs) / 1000) * speed;
      lastTs = ts;
      elapsedRef.current += deltaSeconds;

      // 一幀可能跨過好幾個事件（尤其 ×2 或掉幀時），要一次全部補完
      while (
        eventIndexRef.current < result.events.length &&
        result.events[eventIndexRef.current].t <= elapsedRef.current
      ) {
        applyEvent(result.events[eventIndexRef.current]);
        eventIndexRef.current += 1;
      }

      if (eventIndexRef.current >= result.events.length) {
        setIsDone(true);
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [applyEvent, result.events, speed]);

  // 播完之後把結果交回去。刻意多留一拍，讓最後一隻倒下的動畫播完。
  useEffect(() => {
    if (!isDone) return;
    const timer = setTimeout(() => {
      onFinish({ winner: result.winner, surrendered: false });
    }, 600);
    return () => clearTimeout(timer);
  }, [isDone, onFinish, result.winner]);

  // 日誌永遠捲到最新一行
  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [logs]);

  // 飄出來的傷害數字一秒後自己消失
  useEffect(() => {
    if (floats.length === 0) return;
    const timer = setTimeout(() => setFloats((prev) => prev.slice(1)), 900);
    return () => clearTimeout(timer);
  }, [floats]);

  const playerTotalHp = playerUnits.reduce((sum, u) => sum + (state.hp[u.id] ?? 0), 0);
  const playerMaxHp = playerUnits.reduce((sum, u) => sum + u.maxHp, 0);
  const enemyOnField = enemyUnits.filter((u) => state.onField[u.id] && state.alive[u.id]);
  const enemyTotalHp = enemyOnField.reduce((sum, u) => sum + (state.hp[u.id] ?? 0), 0);
  const enemyMaxHp = enemyOnField.reduce((sum, u) => sum + u.maxHp, 0);

  /** 場上（雙方合計）同時有幾隻，超過 4 隻就縮小 */
  const onFieldCount = allUnits.filter((u) => state.onField[u.id]).length;
  const compact = onFieldCount > 4;

  function renderSide(units: BattleUnit[], side: BattleSide) {
    const shown = units.filter((u) => state.onField[u.id]);
    return (
      <div className={["flex items-end gap-1", side === "enemy" ? "flex-row-reverse" : ""].join(" ")}>
        {shown.map((unit) => (
          <div
            key={unit.id}
            className="relative"
            style={{ animation: "battle-spawn-in 0.3s ease-out" }}
          >
            <UnitSprite
              unit={unit}
              visual={visualById[unit.id]}
              hp={state.hp[unit.id] ?? 0}
              alive={state.alive[unit.id] ?? true}
              isHit={false}
              isTarget={currentTarget === unit.id}
              compact={compact}
            />
            {/* 飄字掛在單位正上方 */}
            {floats
              .filter((f) => f.unitId === unit.id)
              .map((f) => (
                <span
                  key={f.key}
                  className="pointer-events-none absolute left-1/2 top-0 text-sm font-extrabold"
                  style={{
                    color: f.isHeal ? "#7FD37E" : f.isHigh ? "#FFD84B" : "#FFFFFF",
                    textShadow: "0 1px 3px rgba(0,0,0,0.8)",
                    animation: "battle-damage-float 0.9s ease-out forwards",
                  }}
                >
                  {f.text}
                </span>
              ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-[#1A1A2E] p-3 shadow-lg">
      {/* ---- 上方：雙方血條 ＋ 控制 ---- */}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-bold text-[#5B8C5A]">我方</span>
            <span className="text-[10px] font-extrabold text-white/80">
              {playerTotalHp} / {playerMaxHp}
            </span>
          </div>
          <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-[#5B8C5A] transition-[width] duration-150"
              style={{ width: `${playerMaxHp > 0 ? (playerTotalHp / playerMaxHp) * 100 : 0}%` }}
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] font-extrabold text-white/80">
              {enemyTotalHp} / {enemyMaxHp}
            </span>
            <span className="text-[10px] font-bold text-[#C0392B]">敵方</span>
          </div>
          <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/15">
            <div
              className="ml-auto h-full rounded-full bg-[#C0392B] transition-[width] duration-150"
              style={{ width: `${enemyMaxHp > 0 ? (enemyTotalHp / enemyMaxHp) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* ---- 舞台 ---- */}
      <div
        className="relative mt-2 flex h-32 items-end justify-between overflow-hidden rounded-2xl px-2 pb-3"
        style={{
          background: `linear-gradient(180deg, ${accentColor}22 0%, #0E0E1A 100%)`,
        }}
      >
        {/* 地面：橫向捲動的紋理，做出「一直往前走」的感覺 */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 opacity-40"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${accentColor}55 0 2px, transparent 2px 48px)`,
            animation: "battle-ground-scroll 1.2s linear infinite",
          }}
        />
        {/* 敵方那半邊鋪一層極淡的紅，六隻長得像的小雞混戰時才分得出
            哪一半是自己的。中間再加一條細分隔線當「戰線」。 */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[#C0392B]/10" />
        <div className="pointer-events-none absolute inset-y-2 left-1/2 w-px bg-white/15" />
        {renderSide(playerUnits, "player")}
        {renderSide(enemyUnits, "enemy")}
      </div>

      {/* ---- 進度條：還剩幾隻怪 ---- */}
      <div className="mt-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-bold text-white/50">進度</span>
          <span className="text-[10px] font-extrabold text-[#E8B84B]">
            {defeated} / {totalEnemies}
          </span>
        </div>
        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full rounded-full bg-[#E8B84B] transition-[width] duration-300"
            style={{ width: `${totalEnemies > 0 ? (defeated / totalEnemies) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* ---- 控制列 ---- */}
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSpeed(speed === 1 ? 2 : 1)}
          className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-extrabold text-[#E8B84B] transition-transform active:scale-95"
        >
          ×{speed}
        </button>
        <button
          type="button"
          onClick={() => onFinish({ winner: "enemy", surrendered: true })}
          className="ml-auto rounded-xl bg-white/10 px-3 py-1.5 text-xs font-bold text-white/70 transition-transform active:scale-95"
        >
          🏳️ 投降
        </button>
      </div>

      {/* ---- 戰鬥日誌 ---- */}
      <div className="mt-2 h-16 overflow-y-auto rounded-xl bg-black/25 px-2.5 py-1.5">
        {logs.map((line) => (
          <p key={line.key} className="text-[10px] leading-relaxed text-white/60">
            {line.text}
          </p>
        ))}
        <div ref={logBottomRef} />
      </div>
    </div>
  );
}
