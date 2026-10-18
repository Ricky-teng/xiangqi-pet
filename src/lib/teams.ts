// src/lib/teams.ts

/**
 * 戰隊的 Firestore 讀寫
 * ------------------------------------------------------------
 * 路徑：teams/{uid}（一個學生一個戰隊，直接用 uid 當文件 id）
 *
 * 為什麼是 top-level collection 而不是使用者底下的子集合：排行榜要
 * 「依積分排序、取前 50」，這種跨使用者的查詢對 top-level collection
 * 最單純（子集合要用 collectionGroup，規則寫起來麻煩很多）。
 *
 * 這個 collection 的內容全部是公開可讀的——對手本來就看得到你的隊伍。
 *
 * ⚠️ 挑戰時要用對手「被挑戰當下的即時狀態」，所以不存數值快照，
 * 只存「指向哪幾隻」的參照（TeamMemberRef），真的要打的時候才去讀
 * 對方的收藏小雞／正在養的那隻。
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getTaipeiDateString } from "@/lib/server/serverDate";
import { CHALLENGE_LIST_MAX_RANK, INITIAL_TEAM_SCORE, getSeasonId } from "@/lib/rpg/teamScore";
import type { PetDoc } from "@/types/database";
import type { CollectedPetDoc, TeamDoc, TeamMemberRef } from "@/types/rpg";
import { LIVING_PET_ID, fromCollectedPet, fromLivingPet, type DeployablePet } from "@/lib/rpg/deploy";

/** 隊名長度上限 */
export const TEAM_NAME_MAX_LENGTH = 10;

function teamRef(uid: string) {
  return doc(db, "teams", uid);
}

export function validateTeamName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "請幫戰隊取個名字";
  if (trimmed.length > TEAM_NAME_MAX_LENGTH) return `隊名最多 ${TEAM_NAME_MAX_LENGTH} 個字`;
  return null;
}

/** 讀自己的戰隊；還沒建立就回 null（第一次進頁會強制取隊名才建立） */
export async function fetchTeam(uid: string): Promise<TeamDoc | null> {
  const snapshot = await getDoc(teamRef(uid));
  if (!snapshot.exists()) return null;
  return normalizeTeam(snapshot.data() as TeamDoc);
}

/**
 * 把一份戰隊資料正規化到「現在」：
 *   - 賽季換了就把積分歸零、記下上一季的排名、重置改名次數
 *   - 跨日就把今天用掉的挑戰次數歸零
 *
 * 賽季歸零刻意在「讀到的時候」做，而不是只靠 cron：cron 只負責發獎
 * 跟記錄名次，就算它某個月掛掉沒跑，學生這邊的積分也不會錯亂。
 */
export function normalizeTeam(team: TeamDoc, now: number = Date.now()): TeamDoc {
  let next = team;
  const currentSeason = getSeasonId(now);
  const today = getTaipeiDateString(new Date(now));

  if (next.seasonId !== currentSeason) {
    next = {
      ...next,
      seasonId: currentSeason,
      score: INITIAL_TEAM_SCORE,
      wins: 0,
      losses: 0,
      winStreak: 0,
      bestWinStreak: 0,
      renameCountThisSeason: 0,
    };
  }
  if (next.dailyAttemptsDate !== today) {
    next = { ...next, dailyAttemptsUsed: 0, dailyAttemptsDate: today };
  }
  return next;
}

export function createDefaultTeam(
  uid: string,
  ownerName: string,
  teamName: string,
  now: number = Date.now(),
): TeamDoc {
  return {
    uid,
    ownerName,
    teamName: teamName.trim(),
    members: [],
    score: INITIAL_TEAM_SCORE,
    seasonId: getSeasonId(now),
    previousSeasonRank: null,
    renameCountThisSeason: 0,
    wins: 0,
    losses: 0,
    winStreak: 0,
    bestWinStreak: 0,
    dailyAttemptsUsed: 0,
    dailyAttemptsDate: getTaipeiDateString(new Date(now)),
    totalPower: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function saveTeam(team: TeamDoc): Promise<void> {
  await setDoc(teamRef(team.uid), { ...team, updatedAt: Date.now() });
}

export async function patchTeam(uid: string, patch: Partial<TeamDoc>): Promise<void> {
  await updateDoc(teamRef(uid), { ...patch, updatedAt: Date.now() });
}

// ============================================================
// 排行榜
// ============================================================

/**
 * 排行榜：全校一個榜，依積分由高到低取前 CHALLENGE_LIST_MAX_RANK 名。
 * 不足 50 人就有幾個列幾個（前 50 只是上限）。
 *
 * 只取「這一季」的隊伍——上一季留下來、這學期沒再打開過 App 的人，
 * 他的 seasonId 還停在舊的，不該佔著榜單的位置。
 */
export async function fetchLeaderboard(now: number = Date.now()): Promise<TeamDoc[]> {

  const snapshot = await getDocs(
    query(
      collection(db, "teams"),
      where("seasonId", "==", getSeasonId(now)),
      orderBy("score", "desc"),
      fsLimit(CHALLENGE_LIST_MAX_RANK),
    ),
  );
  return snapshot.docs.map((d) => d.data() as TeamDoc);
}

/** 自己在榜上第幾名（1-indexed）；不在榜上回傳榜單長度 + 1 */
export function getMyRank(leaderboard: TeamDoc[], uid: string): number {
  const index = leaderboard.findIndex((t) => t.uid === uid);
  return index >= 0 ? index + 1 : leaderboard.length + 1;
}

// ============================================================
// 把「指向哪幾隻」還原成實際可以打的小雞
// ============================================================

/**
 * 讀出某個人戰隊裡實際上場的小雞（即時狀態）。
 *
 * 「已經不能出戰」的成員會自動被拿掉，少人照打：
 *   - 指向的收藏小雞被刪掉了
 *   - 指向「正在養的那隻」，但他剛收藏掉、現在是一顆蛋
 * 這跟生病中的規則一致（生病仍可出戰，所以不算失效）。
 */
export async function resolveTeamMembers(
  uid: string,
  members: TeamMemberRef[],
): Promise<DeployablePet[]> {
  const sorted = [...members].sort((a, b) => a.slot - b.slot);
  const resolved: DeployablePet[] = [];

  for (const ref of sorted) {
    if (ref.source === "living") {
      const snapshot = await getDoc(doc(db, "pets", uid));
      if (!snapshot.exists()) continue;
      const pet = fromLivingPet(snapshot.data() as PetDoc);
      if (pet) resolved.push(pet);
      continue;
    }
    if (!ref.petId) continue;
    const snapshot = await getDoc(doc(db, "users", uid, "collectedPets", ref.petId));
    if (!snapshot.exists()) continue;
    resolved.push(fromCollectedPet({ ...(snapshot.data() as CollectedPetDoc), id: snapshot.id }));
  }

  return resolved;
}

/** 把 DeployablePet 陣列轉回要存進 TeamDoc 的參照 */
export function toMemberRefs(pets: DeployablePet[]): TeamMemberRef[] {
  return pets.map((pet, slot) => ({
    source: pet.isLiving ? ("living" as const) : ("collected" as const),
    petId: pet.isLiving ? null : pet.id,
    slot,
  }));
}

/** 本地端把參照還原成小雞（自己的戰隊頁用，不用再讀一次 Firestore） */
export function resolveLocalMembers(
  members: TeamMemberRef[],
  collected: CollectedPetDoc[],
  living: PetDoc | null,
): DeployablePet[] {
  const livingPet = fromLivingPet(living);
  return [...members]
    .sort((a, b) => a.slot - b.slot)
    .map((ref) => {
      if (ref.source === "living") return livingPet;
      const found = collected.find((p) => p.id === ref.petId);
      return found ? fromCollectedPet(found) : null;
    })
    .filter((p): p is DeployablePet => p !== null);
}

export { LIVING_PET_ID };
