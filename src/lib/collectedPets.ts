// src/lib/collectedPets.ts

/**
 * 收藏小雞的 Firestore 讀寫
 * ------------------------------------------------------------
 * 路徑：users/{uid}/collectedPets/{petId}
 *
 * 為什麼開子集合而不是塞進 user 文件的陣列：收藏數量無上限，養久了
 * 可能幾十上百隻，塞進 user 文件會讓每一次讀使用者資料（每次開 App、
 * 每個頁面）都拖一大包用不到的資料。子集合可以只在「我的小雞」頁跟
 * 戰隊對戰時才讀。
 *
 * 排行榜要的「收藏幾隻」不從這裡 count（子集合的數量沒辦法拿去排序），
 * 而是在 UserDoc.collectedPetCount 冗餘存一份，收藏時一起 +1。
 */

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { CollectedPetDoc, CollectedPetRecord } from "@/types/rpg";
import { createEmptyPetRecord } from "@/types/rpg";
import type { EquipmentItem } from "@/lib/rpg/equipment";

/** 一天有幾毫秒，算「養了幾天」用 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 名字長度上限（收藏時強制取名，之後不能改） */
export const COLLECTED_PET_NAME_MAX_LENGTH = 10;

function collectedPetsRef(uid: string) {
  return collection(db, "users", uid, "collectedPets");
}

/**
 * 算「養了幾天」。至少回傳 1，因為「養了 0 天」看起來像 bug，
 * 而且當天養成當天收藏本來就該算一天。
 */
export function getDaysRaised(lifeStartedAt: number | undefined, now: number): number {
  if (!lifeStartedAt || lifeStartedAt > now) return 1;
  return Math.max(1, Math.floor((now - lifeStartedAt) / DAY_MS) + 1);
}

/**
 * 檢查學生輸入的名字能不能用。回傳 null 代表沒問題，
 * 回傳字串就是給學生看的中文錯誤訊息。
 */
export function validatePetName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "請幫小雞取個名字";
  if (trimmed.length > COLLECTED_PET_NAME_MAX_LENGTH) {
    return `名字最多 ${COLLECTED_PET_NAME_MAX_LENGTH} 個字`;
  }
  return null;
}

/**
 * 讀出一位使用者的全部收藏小雞，依收藏時間由新到舊。
 * 「我的小雞」頁、戰隊編隊都用這一支。
 */
export async function fetchCollectedPets(uid: string): Promise<CollectedPetDoc[]> {
  const snapshot = await getDocs(query(collectedPetsRef(uid), orderBy("collectedAt", "desc")));
  return snapshot.docs.map((d) => ({ ...(d.data() as CollectedPetDoc), id: d.id }));
}

/** 讀單一隻。戰隊對戰只需要對方上場的那幾隻時用這支，不用整包撈 */
export async function fetchCollectedPet(uid: string, petId: string): Promise<CollectedPetDoc | null> {
  const snapshot = await getDoc(doc(db, "users", uid, "collectedPets", petId));
  if (!snapshot.exists()) return null;
  return { ...(snapshot.data() as CollectedPetDoc), id: snapshot.id };
}

export interface CreateCollectedPetInput {
  uid: string;
  name: string;
  /** 收藏當下的職業，null = 還沒轉職過（四項吃 ×0.8） */
  jobId: string | null;
  /** 收藏當下生過幾次大病 */
  severeSickCount: number;
  /** 這一世養了幾天 */
  daysRaised: number;
  /** 收藏當下就先穿好的裝備，預設兩個都空著 */
  weapon?: EquipmentItem | null;
  armor?: EquipmentItem | null;
  /** 戰績，預設全 0；上線送新手雞時也是全 0 */
  record?: CollectedPetRecord;
  /**
   * 指定文件 id。只有「一次性補發」才會用到（例如 RPG 上線送的新手雞
   * 固定用 "starter"）——這樣萬一寫入逾時、學生下次開 App 再試一次，
   * 會覆蓋同一份文件而不是多生一隻出來。
   * 一般收藏不要傳，讓 Firestore 自動產生 id。
   */
  docId?: string;
}

/**
 * 寫入一隻新的收藏小雞，並把 UserDoc.collectedPetCount +1。
 *
 * 刻意不用 transaction：兩個寫入分屬不同文件、彼此沒有讀取相依，
 * 就算 count 偶爾對不上也只是排行榜數字差一，不值得為它付
 * transaction 的成本。真正的資料仍以子集合為準。
 */
export async function createCollectedPet(input: CreateCollectedPetInput): Promise<CollectedPetDoc> {
  const now = Date.now();
  const ref = input.docId
    ? doc(db, "users", input.uid, "collectedPets", input.docId)
    : doc(collectedPetsRef(input.uid));

  const petDoc: CollectedPetDoc = {
    id: ref.id,
    uid: input.uid,
    name: input.name.trim(),
    jobId: input.jobId,
    severeSickCount: Math.max(0, input.severeSickCount),
    daysRaised: Math.max(1, input.daysRaised),
    weapon: input.weapon ?? null,
    armor: input.armor ?? null,
    record: input.record ?? createEmptyPetRecord(),
    collectedAt: now,
    updatedAt: now,
  };

  await setDoc(ref, petDoc);

  // 排行榜用的冗餘計數。失敗不擋收藏本身——小雞已經寫進去了，
  // 這裡只是讓排行榜的數字跟上。
  // 指定 docId 的（補發）不加計數：那是冪等重試用的，重試時再 +1
  // 會讓數字愈加愈多。補發的計數由呼叫端自己處理。
  if (input.docId) return petDoc;

  try {
    await updateDoc(doc(db, "users", input.uid), {
      collectedPetCount: increment(1),
      updatedAt: now,
    });
  } catch (error) {
    console.error("[collectedPets] 更新 collectedPetCount 失敗（不影響收藏本身）：", error);
  }

  return petDoc;
}

/**
 * 換裝備。weapon / armor 傳 undefined 代表「不動這個欄位」，
 * 傳 null 代表「卸下」。
 */
export async function updateCollectedPetEquipment(
  uid: string,
  petId: string,
  changes: { weapon?: EquipmentItem | null; armor?: EquipmentItem | null },
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: Date.now() };
  if (changes.weapon !== undefined) payload.weapon = changes.weapon;
  if (changes.armor !== undefined) payload.armor = changes.armor;
  await updateDoc(doc(db, "users", uid, "collectedPets", petId), payload);
}

/** 累加戰績。探險打完一關、戰隊打完一場之後呼叫 */
export async function addCollectedPetRecord(
  uid: string,
  petId: string,
  delta: Partial<CollectedPetRecord>,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: Date.now() };
  for (const [key, value] of Object.entries(delta)) {
    if (typeof value === "number" && value !== 0) {
      payload[`record.${key}`] = increment(value);
    }
  }
  await updateDoc(doc(db, "users", uid, "collectedPets", petId), payload);
}

/**
 * 刪除一隻收藏小雞。目前規格沒有「放生」功能，這支只給後台／
 * 測試用，正式流程不會呼叫。
 */
export async function deleteCollectedPet(uid: string, petId: string): Promise<void> {
  await deleteDoc(doc(db, "users", uid, "collectedPets", petId));
  try {
    await updateDoc(doc(db, "users", uid), {
      collectedPetCount: increment(-1),
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error("[collectedPets] 更新 collectedPetCount 失敗：", error);
  }
}
