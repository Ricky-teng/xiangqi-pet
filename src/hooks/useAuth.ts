/**
 * src/hooks/useAuth.ts
 *
 * 登入系統核心邏輯
 * ------------------------------------------------------------
 * 職責：
 *   1. useAuthBootstrap()：訂閱 Firebase Auth 的 onAuthStateChanged，
 *      只要登入狀態改變（登入、登出、重新整理頁面後恢復登入狀態），
 *      就同步把對應的 users/{uid}、pets/{uid} Firestore 文件
 *      載入到 useGameStore（呼叫既有的 setUser/setPet）。
 *      第一次登入（Firestore 還沒有對應文件）時，會自動建立預設的
 *      使用者與寵物資料。
 *   2. signInWithEmail / signUpWithEmail / signOutUser：
 *      提供給 /login 頁面呼叫的純動作函式，本身不是 React Hook，
 *      可以在事件處理函式（onClick）裡直接呼叫。
 *
 * 重要設計說明：
 *   - useAuthBootstrap() 應該只在整個 App 裡呼叫「一次」
 *     （見 src/components/AuthProvider.tsx，掛在 root layout），
 *     而不是在每個頁面各自呼叫一次，否則會重複訂閱
 *     onAuthStateChanged，造成不必要的重複 Firestore 讀取。
 *   - 「使用者剛註冊」與「Firestore 還沒有對應文件」這兩種情況都會
 *     觸發自動建立預設文件的邏輯，但正常的註冊流程
 *     （signUpWithEmail）會在 createUserWithEmailAndPassword 成功後，
 *     立刻以使用者實際填寫的 displayName/role 寫入 Firestore，
 *     所以 useAuthBootstrap() 裡的「自動建立預設文件」分支，
 *     實務上主要是給「透過 Firebase Console 手動建立帳號」或
 *     「未來其他登入方式（例如 Google 登入）第一次登入」這類情況
 *     兜底用，一般註冊流程不會真的走到這個分支
 *     （因為文件早一步就已經被 signUpWithEmail 寫好了）。
 *   - chessLevel、stage 等遊戲數值欄位的「預設新手數值」集中寫在
 *     本檔案的 createDefaultUserDoc/createDefaultPetDoc，
 *     之後要調整新手初始數值，只需要改這兩個函式。
 *   - 本檔案不修改 usePuzzleSolver.ts、database.ts 既有檔案，
 *     型別全部直接從 @/types/database 匯入重用。
 */

import { useEffect } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import { applyPetTimeDecay } from "@/lib/pet/petDecay";
import type { PetDoc, UserDoc } from "@/types/database";

// ============================================================
// 1. 新帳號預設資料
// ============================================================

/** 建立新使用者第一次登入時的預設 UserDoc（新手数值） */
function createDefaultUserDoc(
  uid: string,
  displayName: string,
  role: UserDoc["role"]
): UserDoc {
  const now = Date.now();
  return {
    uid,
    displayName,
    role,
    chessLevel: 1,
    foodCount: 20,
    stamina: {
      current: 40,
      max: 40,
      lastRefillTime: now,
    },
    stats: {
      totalSolved: 0,
      totalAttempts: 0,
      winRate: 0,
    },
    unlockedCatalogIds: [],
    rebirthCount: 0,
    fcmTokens: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 建立新使用者第一次登入時的預設 PetDoc（一顆剛誕生的蛋） */
function createDefaultPetDoc(uid: string): PetDoc {
  const now = Date.now();
  return {
    uid,
    stage: "egg",
    xp: 0,
    fullness: 100,
    healthStatus: "normal",
    currentWrongPuzzleId: null,
    consecutiveWrongCount: 0,
    lastFedTime: now,
    sickStartTime: null,
    severeSickStartTime: null,
    notifiedFlags: {
      lowFullness: false,
      slightlySick: false,
      severelySick: false,
      dead: false,
    },
    currentAppearanceId: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================
// 2. useAuthBootstrap：訂閱登入狀態、同步 Firestore -> Zustand
// ============================================================

/**
 * 訂閱 Firebase Auth 的登入狀態變化，並同步對應的 users/{uid}、
 * pets/{uid} 文件到 useGameStore。應該只在 App 裡掛載一次
 * （見 AuthProvider.tsx）。
 */
export function useAuthBootstrap(): void {
  const setUser = useGameStore((s) => s.setUser);
  const setPet = useGameStore((s) => s.setPet);
  const setLoading = useGameStore((s) => s.setLoading);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        // 已登出，或從未登入過
        setUser(null);
        setPet(null);
        setLoading(false);
        return;
      }

      try {
        const userRef = doc(db, "users", firebaseUser.uid);
        const petRef = doc(db, "pets", firebaseUser.uid);

        const [userSnapshot, petSnapshot] = await Promise.all([
          getDoc(userRef),
          getDoc(petRef),
        ]);

        let userDoc: UserDoc;
        if (userSnapshot.exists()) {
          userDoc = userSnapshot.data() as UserDoc;
        } else {
          // 兜底：理論上 signUpWithEmail 已經寫過這份文件，
          // 走到這裡通常代表帳號是透過其他方式建立的（見檔案頂部說明）。
          userDoc = createDefaultUserDoc(
            firebaseUser.uid,
            firebaseUser.displayName ?? "新玩家",
            "student"
          );
          await setDoc(userRef, userDoc);
        }

        let petDoc: PetDoc | null;
        if (petSnapshot.exists()) {
          petDoc = petSnapshot.data() as PetDoc;
        } else if (userDoc.role === "student") {
          // 只有學生需要寵物資料；老師帳號刻意不建立（理由見 signUpWithEmail 註解）。
          petDoc = createDefaultPetDoc(firebaseUser.uid);
          await setDoc(petRef, petDoc);
        } else {
          petDoc = null;
        }

        // 補算「離線期間」流逝的時間：飽食度下降、生病加重。
        // 每次登入/重新整理頁面都會走到這裡，所以即使學生很久沒開 App，
        // 重新打開的瞬間就會一次性補上正確的狀態（見 petDecay.ts 檔案頂部
        // 對這個「純前端補算」做法的限制說明）。
        if (petDoc) {
          const decayResult = applyPetTimeDecay(petDoc, Date.now());
          if (decayResult.changed) {
            petDoc = decayResult.pet;
            updateDoc(petRef, {
              fullness: petDoc.fullness,
              lastFedTime: petDoc.lastFedTime,
              healthStatus: petDoc.healthStatus,
              sickStartTime: petDoc.sickStartTime,
              severeSickStartTime: petDoc.severeSickStartTime,
              notifiedFlags: petDoc.notifiedFlags,
              updatedAt: petDoc.updatedAt,
            }).catch((error) => {
              console.error("[useAuthBootstrap] 補算時間流逝後寫回 Firestore 失敗：", error);
            });
          }
          if (decayResult.notifications.length > 0) {
            useGameStore.getState().setPetAlertMessage(decayResult.notifications.join("\n"));
          }
        }

        setUser(userDoc);
        setPet(petDoc);
      } catch (error) {
        console.error("[useAuthBootstrap] 載入使用者／寵物資料失敗：", error);
        setUser(null);
        setPet(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
    // setUser/setPet/setLoading 是 Zustand 的 action，參照穩定不會變動，
    // 放進 deps 純粹是為了符合 lint 規則，不會造成重複訂閱。
  }, [setUser, setPet, setLoading]);
}

// ============================================================
// 3. 登入 / 註冊 / 登出 動作函式（給 /login 頁面呼叫）
// ============================================================

/** Email / 密碼登入 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email, password);
  // 登入成功後，onAuthStateChanged 會自動觸發 useAuthBootstrap 同步資料，
  // 這裡不需要、也不應該手動再呼叫 setUser/setPet。
}

/**
 * Email / 密碼註冊。
 * 成功建立帳號後，立刻依使用者填寫的 displayName / role 寫入
 * users/{uid}、pets/{uid} 兩份 Firestore 文件（而不是等
 * useAuthBootstrap 用預設值兜底），確保新帳號的身分／顯示名稱
 * 是老師或學生在註冊表單上實際選擇/填寫的內容。
 *
 * 注意：只有 role === "student" 才會建立 pets/{uid} 文件。
 * 老師帳號不需要養小雞，刻意不建立寵物資料，首頁也會依角色
 * 顯示完全不同的畫面（見 src/app/page.tsx 的 TeacherHomeContent）。
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName: string,
  role: UserDoc["role"]
): Promise<void> {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  const uid = credential.user.uid;

  // 把顯示名稱也同步寫回 Firebase Auth 的個人資料，方便日後其他地方
  // （例如未來的忘記密碼信件、後台管理列表）直接從 Auth 端讀到名字。
  await updateProfile(credential.user, { displayName });

  const userDoc = createDefaultUserDoc(uid, displayName, role);

  const writes = [setDoc(doc(db, "users", uid), userDoc)];
  if (role === "student") {
    writes.push(setDoc(doc(db, "pets", uid), createDefaultPetDoc(uid)));
  }

  await Promise.all(writes);
  // 寫入完成後，onAuthStateChanged 會接著觸發、讀到上面剛寫好的文件，
  // 同步進 useGameStore。
}

/** 登出 */
export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // 登出後 onAuthStateChanged 會自動把 user/pet 清成 null。
}

// ============================================================
// 4. Firebase Auth 錯誤碼 -> 友善中文訊息
// ============================================================

/**
 * 將 Firebase Auth 拋出的錯誤（具有 .code 屬性，例如
 * "auth/wrong-password"）轉換成給使用者看的繁體中文訊息。
 * 涵蓋不到的錯誤碼則回傳通用訊息，不會讓使用者看到原始英文錯誤碼。
 */
export function getAuthErrorMessage(error: unknown): string {
  const code = isFirebaseAuthError(error) ? error.code : null;

  switch (code) {
    case "auth/email-already-in-use":
      return "這個 Email 已經被註冊過了，請改用登入，或換一個 Email 註冊。";
    case "auth/invalid-email":
      return "Email 格式不正確，請再檢查一次。";
    case "auth/weak-password":
      return "密碼太短了，至少需要 6 個字元。";
    case "auth/user-not-found":
    case "auth/invalid-credential":
      return "找不到這個帳號，請確認 Email 是否正確，或先註冊一個新帳號。";
    case "auth/wrong-password":
      return "密碼不正確，請再試一次。";
    case "auth/too-many-requests":
      return "嘗試次數過多，請稍後再試一次。";
    case "auth/network-request-failed":
      return "網路連線異常，請檢查網路後再試一次。";
    default:
      return error instanceof Error ? error.message : "發生未知錯誤，請稍後再試。";
  }
}

function isFirebaseAuthError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}
