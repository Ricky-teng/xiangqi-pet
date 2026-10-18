// src/components/CollectPetModal.tsx
"use client";

/**
 * 收藏小雞的取名彈窗
 * ------------------------------------------------------------
 * 首頁按下「收藏」之後跳出來，強制學生取一個名字才能真的收藏。
 * 名字之後不能改，所以這裡把「不能改」寫得很明顯，並且在按下確定
 * 之前再跳一次確認，避免手滑。
 *
 * 彈窗上同時把「這隻收藏起來會是什麼樣子」攤開來給學生看
 * （職業、四項數值、養了幾天、生過幾次大病），因為收藏是不可逆的，
 * 而且收藏前還可以選擇回去繼續養、轉職到更好的職業再收。
 */

import { useMemo, useState } from "react";
import { COLLECTED_PET_NAME_MAX_LENGTH, validatePetName } from "@/lib/collectedPets";
import { getCatalogEntryById } from "@/lib/pet/catalog";
import {
  PET_STAT_KEYS,
  PET_STAT_LABELS,
  getBareStats,
  getSevereSickPenaltyLabel,
  getTotalPower,
} from "@/lib/rpg/stats";

interface CollectPetModalProps {
  /** 收藏當下的職業 id，null = 還沒轉職 */
  jobId: string | null;
  /** 這一世生過幾次大病 */
  severeSickCount: number;
  /** 這一世養了幾天 */
  daysRaised: number;
  /** 按下確定，回傳成功與否的訊息由呼叫端處理 */
  onConfirm: (name: string) => Promise<void>;
  onCancel: () => void;
  /** 正在寫入中（外部控制，避免重複送出） */
  isSubmitting: boolean;
}

/** 四項數值裡最大的那個，拿來當橫條圖的滿格基準 */
function getBarMax(values: number[]): number {
  return Math.max(1, ...values);
}

export default function CollectPetModal({
  jobId,
  severeSickCount,
  daysRaised,
  onConfirm,
  onCancel,
  isSubmitting,
}: CollectPetModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const stats = useMemo(() => getBareStats(jobId, severeSickCount), [jobId, severeSickCount]);
  const totalPower = getTotalPower(stats);
  const sickLabel = getSevereSickPenaltyLabel(severeSickCount);
  const jobEntry = jobId ? getCatalogEntryById(jobId) : null;
  const jobName = jobEntry?.name ?? "未轉職";

  // 橫條圖：HP 的絕對值比其他三項大一個數量級，全部用同一個基準會
  // 讓另外三項幾乎看不見，所以 HP 自己一條基準、其他三項共用一條。
  const otherMax = getBarMax([stats.attack, stats.defense, stats.speed]);

  function handleSubmitName() {
    const nameError = validatePetName(name);
    if (nameError) {
      setError(nameError);
      return;
    }
    setError(null);
    setIsConfirming(true);
  }

  async function handleFinalConfirm() {
    await onConfirm(name.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-3xl bg-[#FDF6E8] p-5 shadow-2xl">
        {!isConfirming ? (
          <>
            <h2 className="text-center text-lg font-extrabold text-[#1A1A2E]">🐣 收藏這隻小雞</h2>
            <p className="mt-1 text-center text-xs text-[#1A1A2E]/60">
              收藏之後牠就定型了，可以派去探險跟戰隊，也不用再餵食、不會生病。
            </p>

            {/* ---- 收藏後長什麼樣子 ---- */}
            <div className="mt-4 rounded-2xl border border-[#E8B84B]/50 bg-white/80 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-extrabold text-[#5C3D0A]">{jobName}</span>
                <span className="rounded-full bg-[#1A1A2E] px-2 py-0.5 text-[10px] font-bold text-[#E8B84B]">
                  總戰力 {totalPower}
                </span>
              </div>

              <div className="mt-2 space-y-1.5">
                {PET_STAT_KEYS.map((key) => {
                  const value = stats[key];
                  const max = key === "hp" ? stats.hp : otherMax;
                  const percent = Math.round((value / max) * 100);
                  return (
                    <div key={key} className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-[10px] font-bold text-[#1A1A2E]/60">
                        {PET_STAT_LABELS[key]}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#1A1A2E]/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#F6D87A] to-[#E8B84B]"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="w-10 shrink-0 text-right text-[10px] font-extrabold text-[#1A1A2E]">
                        {value}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#1A1A2E]/60">
                <span>養了 {daysRaised} 天</span>
                <span>
                  生過 {severeSickCount} 次大病
                  {sickLabel ? <span className="font-bold text-[#C0392B]">（數值 {sickLabel}）</span> : null}
                </span>
              </div>
            </div>

            {jobId === null ? (
              <p className="mt-3 rounded-xl bg-[#C0392B]/10 px-3 py-2 text-[11px] font-bold text-[#C0392B]">
                這隻還沒轉職，四項數值都會少兩成。先回去轉職再收藏會強很多喔！
              </p>
            ) : null}

            {/* ---- 取名 ---- */}
            <label className="mt-4 block text-xs font-bold text-[#1A1A2E]/70">
              幫牠取個名字（<span className="text-[#C0392B]">之後不能改</span>）
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              maxLength={COLLECTED_PET_NAME_MAX_LENGTH}
              placeholder="例如：小金"
              className="mt-1 w-full rounded-xl border border-[#E8B84B] bg-white px-3 py-2 text-sm font-bold text-[#1A1A2E] outline-none focus:border-[#5C3D0A]"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-[#C0392B]">{error ?? ""}</span>
              <span className="text-[10px] text-[#1A1A2E]/40">
                {name.trim().length}/{COLLECTED_PET_NAME_MAX_LENGTH}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1A2E]/70 shadow-sm transition-transform active:scale-95"
              >
                再養一下
              </button>
              <button
                type="button"
                onClick={handleSubmitName}
                className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
              >
                收藏
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-center text-lg font-extrabold text-[#1A1A2E]">確定要收藏嗎？</h2>
            <div className="mt-4 rounded-2xl bg-white/80 p-4 text-center">
              <p className="text-2xl font-extrabold text-[#5C3D0A]">{name.trim()}</p>
              <p className="mt-1 text-xs text-[#1A1A2E]/60">
                {jobName}・總戰力 {totalPower}
              </p>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-[#1A1A2E]/70">
              <li>・名字收藏後<span className="font-bold text-[#C0392B]">不能再改</span></li>
              <li>・四項數值就此定型，不會再變動</li>
              <li>・目前這隻會回到蛋，重新開始養（馬上拿到一顆新蛋）</li>
            </ul>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setIsConfirming(false)}
                className="rounded-xl bg-white px-3 py-2.5 text-sm font-bold text-[#1A1A2E]/70 shadow-sm transition-transform active:scale-95 disabled:opacity-50"
              >
                改名字
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleFinalConfirm}
                className="rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-3 py-2.5 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? "收藏中…" : "確定收藏"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
