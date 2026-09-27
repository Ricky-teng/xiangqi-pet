// src/app/my-pets/page.tsx
"use client";

/**
 * 🐣 我的小雞
 * ------------------------------------------------------------
 * 收藏小雞的列表與詳細頁。
 *
 * 列表：一行三隻的網格，只顯示圖、名字、總戰力——養到幾十隻的時候
 * 才不用一直滑。點開才看四項數值、養成紀錄、戰績、裝備。
 *
 * 裝備格點下去會從背包挑一件換上（同一格原本穿的那件會回到背包），
 * 上面的四項數值橫條會即時跟著變。裝備本身在「🎒 物品」頁的裝備分頁
 * 買跟合成。
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import { useGameStore } from "@/stores/useGameStore";
import { getCatalogEntryById } from "@/lib/pet/catalog";
import {
  KIND_EMOJIS,
  KIND_LABELS,
  getEquipmentBonusLabel,
  getEquipmentName,
  getTierColor,
  getDeployBlockReason,
  getTierName,
  isTierGlowing,
  type EquipmentItem,
} from "@/lib/rpg/equipment";
import {
  PET_STAT_KEYS,
  PET_STAT_LABELS,
  getFinalStats,
  getSevereSickPenaltyLabel,
  getTotalPower,
} from "@/lib/rpg/stats";
import { createEmptyPetRecord, type CollectedPetDoc } from "@/types/rpg";
import { useAppBackground } from "@/lib/useAppBackground";
import { getDaysRaised } from "@/lib/collectedPets";
import { LIVING_PET_ID } from "@/lib/rpg/deploy";

/** 職業圖沿用圖鑑的圖檔；載入失敗自動退回 emoji，畫面不會壞掉 */
function PetAvatar({ jobId, size }: { jobId: string | null; size: number }) {
  const entry = jobId ? getCatalogEntryById(jobId) : null;
  const [failed, setFailed] = useState(false);

  if (!entry || failed) {
    return (
      <span style={{ fontSize: size * 0.7 }} aria-hidden="true">
        {entry?.fallbackEmoji ?? "🐔"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.imagePath}
      alt={entry.name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

/**
 * 從背包挑一件裝備換上的選擇器。只列出符合這一格類型的裝備，
 * 依階級由高到低排（想換裝的人通常是要換更好的）。
 */
function EquipmentPicker({
  slot,
  current,
  bag,
  onPick,
  onClose,
  isSaving,
}: {
  slot: "weapon" | "armor";
  current: EquipmentItem | null;
  bag: EquipmentItem[];
  onPick: (item: EquipmentItem | null) => void;
  onClose: () => void;
  isSaving: boolean;
}) {
  const candidates = useMemo(
    () => bag.filter((item) => item.kind === slot).sort((a, b) => b.tier - a.tier),
    [bag, slot],
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-[#FDF6E8] p-5 shadow-2xl sm:rounded-3xl">
        <h3 className="text-center text-base font-extrabold text-[#1A1A2E]">
          {KIND_EMOJIS[slot]} 選擇{KIND_LABELS[slot]}
        </h3>

        {current ? (
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onPick(null)}
            className="mt-3 w-full rounded-xl bg-white px-3 py-2.5 text-xs font-bold text-[#C0392B] shadow-sm transition-transform active:scale-95 disabled:opacity-50"
          >
            卸下目前的{getEquipmentName(current)}（放回背包）
          </button>
        ) : null}

        {candidates.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-white/70 px-3 py-6 text-center text-xs text-[#1A1A2E]/45">
            背包裡沒有{KIND_LABELS[slot]}。
            <br />
            到「🎒 物品」頁的裝備分頁買一件吧。
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {candidates.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isSaving}
                onClick={() => onPick(item)}
                className="flex flex-col items-center gap-0.5 rounded-2xl border-2 bg-white/90 px-1 py-2 transition-transform active:scale-95 disabled:opacity-50"
                style={{
                  borderColor: getTierColor(item.tier),
                  boxShadow: isTierGlowing(item.tier) ? `0 0 10px ${getTierColor(item.tier)}99` : undefined,
                }}
              >
                <span className="text-xl">{KIND_EMOJIS[item.kind]}</span>
                <span
                  className="text-[9px] font-extrabold"
                  style={{ color: getTierColor(item.tier) }}
                >
                  {getTierName(item.tier)}
                </span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[#1A1A2E] px-4 py-2.5 text-sm font-bold text-[#FDF6E8] shadow-md transition-transform active:scale-95"
        >
          取消
        </button>
      </div>
    </div>
  );
}

function PetDetail({
  pet,
  isLiving,
  onClose,
}: {
  pet: CollectedPetDoc;
  /** true = 這是「目前正在養的那一隻」，換裝備要寫到 pets/{uid} */
  isLiving: boolean;
  onClose: () => void;
}) {
  const bag = useGameStore((s) => s.user?.equipmentBag ?? []);
  const equipToPet = useGameStore((s) => s.equipToPet);
  const equipToLivingPet = useGameStore((s) => s.equipToLivingPet);
  const [pickerSlot, setPickerSlot] = useState<"weapon" | "armor" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [equipMessage, setEquipMessage] = useState<string | null>(null);

  async function handlePick(item: EquipmentItem | null) {
    if (!pickerSlot) return;
    setIsSaving(true);
    const result = isLiving
      ? await equipToLivingPet(pickerSlot, item)
      : await equipToPet(pet.id, pickerSlot, item);
    setIsSaving(false);
    setEquipMessage(result.message);
    if (result.success) setPickerSlot(null);
  }

  const stats = useMemo(
    () => getFinalStats(pet.jobId, pet.severeSickCount, pet.weapon, pet.armor),
    [pet],
  );
  const bare = useMemo(
    () => getFinalStats(pet.jobId, pet.severeSickCount, null, null),
    [pet],
  );
  const totalPower = getTotalPower(stats);
  const sickLabel = getSevereSickPenaltyLabel(pet.severeSickCount);
  const jobName = pet.jobId ? (getCatalogEntryById(pet.jobId)?.name ?? "未知職業") : "未轉職";

  // HP 的數量級比其他三項大很多，共用同一個基準會讓另外三項幾乎
  // 看不見，所以 HP 自己滿格、其他三項共用一個基準。
  const otherMax = Math.max(1, stats.attack, stats.defense, stats.speed);

  const record = pet.record;
  const teamTotal = record.teamWins + record.teamLosses;
  const deployBlockReason = getDeployBlockReason(pet.weapon);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[88vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-[#FDF6E8] p-5 shadow-2xl sm:rounded-3xl">
        <div className="flex items-start gap-3">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-white/80">
            <PetAvatar jobId={pet.jobId} size={64} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-extrabold text-[#1A1A2E]">{pet.name}</p>
            <p className="text-xs font-bold text-[#5C3D0A]">{jobName}</p>
            <p className="mt-1 inline-block rounded-full bg-[#1A1A2E] px-2 py-0.5 text-[10px] font-bold text-[#E8B84B]">
              總戰力 {totalPower}
            </p>
            {isLiving ? (
              <p className="mt-1 text-[10px] font-bold text-[#8B5FBF]">
                還在養，轉職跟生病都會讓數值變動；收藏之後才定型
              </p>
            ) : null}
          </div>
        </div>

        {/* ---- 四項數值橫條圖 ---- */}
        <div className="mt-4 rounded-2xl bg-white/80 p-3">
          <p className="text-[10px] font-bold text-[#1A1A2E]/40">四項數值</p>
          <div className="mt-2 space-y-2">
            {PET_STAT_KEYS.map((key) => {
              const value = stats[key];
              const bareValue = bare[key];
              const bonus = value - bareValue;
              const max = key === "hp" ? stats.hp : otherMax;
              return (
                <div key={key}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] font-bold text-[#1A1A2E]/70">
                      {PET_STAT_LABELS[key]}
                    </span>
                    <span className="text-[11px] font-extrabold text-[#1A1A2E]">
                      {value}
                      {bonus > 0 ? (
                        <span className="ml-1 text-[10px] font-bold text-[#5B8C5A]">
                          （裝備 +{bonus}）
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-[#1A1A2E]/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#F6D87A] to-[#E8B84B]"
                      style={{ width: `${Math.round((value / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- 裝備格 ---- */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["weapon", "armor"] as const).map((slot) => {
            const item = slot === "weapon" ? pet.weapon : pet.armor;
            const emptyLabel = slot === "weapon" ? "沒有武器" : "沒有防具";
            return (
              <button
                key={slot}
                type="button"
                onClick={() => setPickerSlot(slot)}
                className="rounded-2xl border-2 bg-white/80 p-2.5 text-center transition-transform active:scale-95"
                style={{
                  borderColor: item ? getTierColor(item.tier) : "rgba(26,26,46,0.15)",
                  boxShadow: item && isTierGlowing(item.tier) ? `0 0 12px ${getTierColor(item.tier)}80` : undefined,
                }}
              >
                <p className="text-lg">{slot === "weapon" ? "🗡️" : "🛡️"}</p>
                {item ? (
                  <>
                    <p
                      className="mt-0.5 text-[11px] font-extrabold"
                      style={{ color: getTierColor(item.tier) }}
                    >
                      {getEquipmentName(item)}
                    </p>
                    <p className="text-[9px] font-bold text-[#1A1A2E]/60">
                      {getEquipmentBonusLabel(item)}
                    </p>
                  </>
                ) : (
                  <p className="mt-0.5 text-[11px] font-bold text-[#1A1A2E]/35">{emptyLabel}</p>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-center text-[10px] text-[#1A1A2E]/40">
          點裝備格就能換，裝備在「🎒 物品」頁的裝備分頁買跟合成
        </p>
        {equipMessage ? (
          <p className="mt-1 rounded-xl bg-white/80 px-3 py-1.5 text-center text-[11px] font-bold text-[#5C3D0A]">
            {equipMessage}
          </p>
        ) : null}
        {deployBlockReason ? (
          <p className="mt-1 rounded-xl bg-[#C0392B]/10 px-3 py-1.5 text-center text-[11px] font-bold text-[#C0392B]">
            ⚠️ {deployBlockReason}，沒有武器不能派去探險或戰隊
          </p>
        ) : (
          <p className="mt-1 rounded-xl bg-[#5B8C5A]/10 px-3 py-1.5 text-center text-[11px] font-bold text-[#5B8C5A]">
            ✅ 可以出戰
          </p>
        )}

        {/* ---- 養成紀錄 ---- */}
        <div className="mt-3 rounded-2xl bg-white/80 p-3">
          <p className="text-[10px] font-bold text-[#1A1A2E]/40">養成紀錄</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[#1A1A2E]/50">養了</span>{" "}
              <span className="font-extrabold text-[#1A1A2E]">{pet.daysRaised} 天</span>
            </div>
            <div>
              <span className="text-[#1A1A2E]/50">生大病</span>{" "}
              <span className="font-extrabold text-[#1A1A2E]">{pet.severeSickCount} 次</span>
            </div>
          </div>
          {sickLabel ? (
            <p className="mt-1.5 rounded-lg bg-[#C0392B]/10 px-2 py-1 text-[10px] font-bold text-[#C0392B]">
              因為生過 {pet.severeSickCount} 次大病，四項數值 {sickLabel}
            </p>
          ) : (
            <p className="mt-1.5 rounded-lg bg-[#5B8C5A]/10 px-2 py-1 text-[10px] font-bold text-[#5B8C5A]">
              從來沒生過大病，數值沒有任何折損 👍
            </p>
          )}
        </div>

        {/* ---- 戰績（正在養的那隻還沒有獨立戰績，不顯示） ---- */}
        <div className={["mt-3 rounded-2xl bg-white/80 p-3", isLiving ? "hidden" : ""].join(" ")}>
          <p className="text-[10px] font-bold text-[#1A1A2E]/40">戰績</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[#1A1A2E]/50">探險通關</span>{" "}
              <span className="font-extrabold text-[#1A1A2E]">
                {record.exploreStagesCleared} / {record.exploreStagesPlayed} 關
              </span>
            </div>
            <div>
              <span className="text-[#1A1A2E]/50">戰隊</span>{" "}
              <span className="font-extrabold text-[#1A1A2E]">
                {teamTotal === 0 ? "還沒上過場" : `${record.teamWins} 勝 ${record.teamLosses} 敗`}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-[#1A1A2E] px-4 py-2.5 text-sm font-bold text-[#FDF6E8] shadow-md transition-transform active:scale-95"
        >
          關閉
        </button>
      </div>

      {pickerSlot ? (
        <EquipmentPicker
          slot={pickerSlot}
          current={pickerSlot === "weapon" ? pet.weapon : pet.armor}
          bag={bag}
          isSaving={isSaving}
          onPick={handlePick}
          onClose={() => setPickerSlot(null)}
        />
      ) : null}
    </div>
  );
}

function MyPetsContent() {
  const router = useRouter();
  const user = useGameStore((s) => s.user);
  const livingPet = useGameStore((s) => s.pet);
  const collectedPets = useGameStore((s) => s.collectedPets);
  const collectedPetsLoaded = useGameStore((s) => s.collectedPetsLoaded);
  const loadCollectedPets = useGameStore((s) => s.loadCollectedPets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const bgStyle = useAppBackground();

  useEffect(() => {
    void loadCollectedPets();
  }, [loadCollectedPets]);

  /**
   * 把「正在養的那一隻」包成跟收藏小雞一樣的形狀，這樣詳細頁、
   * 數值計算、裝備格全部可以共用同一套元件，不用寫兩份。
   *
   * 只有長到大師雞才會出現在這一頁——蛋跟雛雞本來就不能出戰，
   * 列在這裡只會讓學生以為可以派牠去打。
   */
  const livingAsCollected: CollectedPetDoc | null = useMemo(() => {
    if (!livingPet || !user) return null;
    if (livingPet.stage !== "master" || livingPet.healthStatus === "dead") return null;
    return {
      id: LIVING_PET_ID,
      uid: user.uid,
      name: "養成中的小雞",
      jobId: livingPet.currentAppearanceId,
      severeSickCount: livingPet.severeSickCount ?? 0,
      daysRaised: getDaysRaised(livingPet.lifeStartedAt ?? livingPet.createdAt, Date.now()),
      weapon: livingPet.weapon ?? null,
      armor: livingPet.armor ?? null,
      record: createEmptyPetRecord(),
      collectedAt: livingPet.createdAt,
      updatedAt: livingPet.updatedAt,
    };
  }, [livingPet, user]);

  const selected =
    selectedId === LIVING_PET_ID
      ? livingAsCollected
      : (collectedPets.find((p) => p.id === selectedId) ?? null);

  if (!user) return null;

  return (
    // 最外層一定要吃 bgStyle，學生買的背景才會套進來
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-xl bg-white/70 px-3 py-1.5 text-sm font-bold text-[#1A1A2E] shadow-sm transition-transform active:scale-95"
          >
            ← 返回
          </button>
          <h1 className="text-lg font-extrabold text-[#1A1A2E]">🐣 我的小雞</h1>
        </div>

        <p className="mt-2 rounded-2xl bg-white/60 px-3 py-2 text-xs text-[#1A1A2E]/60">
          養到大師雞之後按「收藏」，小雞就會永久留在這裡。收藏的小雞不用餵食、不會生病，
          可以派去探險跟戰隊。
        </p>

        {/* 正在養的那一隻：長到大師雞之後就能穿裝備、派出去打，
            所以也要能在這一頁換裝。放在收藏清單「上面」自成一區，
            因為牠的數值還會變（轉職、生病），跟已經定型的收藏不同。 */}
        {livingAsCollected ? (
          <section className="mt-3 rounded-3xl bg-[#8B5FBF]/10 px-3 py-3">
            <p className="text-[11px] font-bold text-[#8B5FBF]">養成中（數值還會變動）</p>
            <button
              type="button"
              onClick={() => setSelectedId(LIVING_PET_ID)}
              className="mt-1.5 flex w-full items-center gap-3 rounded-2xl bg-white/85 px-3 py-2.5 text-left shadow-sm transition-transform active:scale-95"
            >
              <PetAvatar jobId={livingAsCollected.jobId} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-[#1A1A2E]">
                  {livingAsCollected.name}
                </p>
                <p className="text-[10px] text-[#1A1A2E]/55">
                  {getDeployBlockReason(livingAsCollected.weapon) ?? "可以出戰"}
                </p>
              </div>
              <span className="rounded-full bg-[#1A1A2E] px-2 py-0.5 text-[10px] font-bold text-[#E8B84B]">
                {getTotalPower(
                  getFinalStats(
                    livingAsCollected.jobId,
                    livingAsCollected.severeSickCount,
                    livingAsCollected.weapon,
                    livingAsCollected.armor,
                  ),
                )}
              </span>
            </button>
          </section>
        ) : null}

        {!collectedPetsLoaded ? (
          <p className="mt-6 text-center text-sm text-[#1A1A2E]/50">載入中…</p>
        ) : collectedPets.length === 0 ? (
          <div className="mt-6 rounded-3xl bg-white/70 px-4 py-8 text-center shadow-sm">
            <p className="text-3xl">🥚</p>
            <p className="mt-2 text-sm font-bold text-[#1A1A2E]">還沒有收藏任何小雞</p>
            <p className="mt-1 text-xs text-[#1A1A2E]/55">
              把小雞餵到大師雞，首頁就會出現「收藏」按鈕。
              <br />
              收藏前可以先轉職，收藏當下的職業就是牠的永久職業。
            </p>
            <button
              type="button"
              onClick={() => router.push("/feed")}
              className="mt-4 rounded-xl bg-gradient-to-b from-[#F6D87A] to-[#E8B84B] px-4 py-2 text-sm font-extrabold text-[#5C3D0A] shadow-md transition-transform active:scale-95"
            >
              🌾 去餵小雞
            </button>
          </div>
        ) : (
          <>
            <p className="mt-3 inline-block rounded-full bg-white/70 px-2.5 py-1 text-xs font-bold text-[#1A1A2E]/70 shadow-sm">
              共 {collectedPets.length} 隻
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {collectedPets.map((pet) => {
                const stats = getFinalStats(pet.jobId, pet.severeSickCount, pet.weapon, pet.armor);
                return (
                  <button
                    key={pet.id}
                    type="button"
                    onClick={() => setSelectedId(pet.id)}
                    className="flex flex-col items-center gap-0.5 rounded-2xl bg-white/80 px-1.5 py-2.5 shadow-sm transition-transform active:scale-95"
                  >
                    <PetAvatar jobId={pet.jobId} size={44} />
                    <span className="w-full truncate text-center text-[11px] font-extrabold text-[#1A1A2E]">
                      {pet.name}
                    </span>
                    <span className="rounded-full bg-[#1A1A2E] px-1.5 py-0.5 text-[9px] font-bold text-[#E8B84B]">
                      {getTotalPower(stats)}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {selected ? (
          <PetDetail
            pet={selected}
            isLiving={selected.id === LIVING_PET_ID}
            onClose={() => setSelectedId(null)}
          />
        ) : null}
      </div>
    </main>
  );
}

export default function MyPetsPage() {
  return (
    <RequireAuth>
      <MyPetsContent />
    </RequireAuth>
  );
}
