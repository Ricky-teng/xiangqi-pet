// src/app/friends/page.tsx
/**
 * 好友頁面
 * ------------------------------------------------------------
 * 資料模型設計（詳細理由見 src/types/database.ts 的 UserDoc 好友相關
 * 欄位註解）：完全不開新的 Firestore collection，全部靠 users 集合
 * 本身的「誰都能讀、只能寫自己」規則組出來——
 *   - 送邀請 / 送戰帖：自己寫自己的 outgoingFriendRequestUids /
 *     outgoingBattleChallengeUid（自己決定要跟誰互動，一定合法）。
 *   - 收邀請 / 收戰帖：反過來查「誰指定了我」（array-contains / ==
 *     查詢，只需要讀取權限）。
 *   - 接受邀請 / 接受戰帖：需要同時動到兩個人的文件，一般 client SDK
 *     做不到，這兩個操作打的是 /api/friends/accept 跟
 *     /api/battle/challenge-respond 這兩支用 Admin SDK 的伺服器 API。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  query,
  updateDoc,
  where,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { getVsComputerWinRate, getBattleWinRate } from "@/lib/stats";
import { useAppBackground } from "@/lib/useAppBackground";
import type { UserDoc } from "@/types/database";

const STAGE_EMOJI: Record<string, string> = {
  egg: "🥚",
  chick: "🐤",
  teen: "🐓",
  master: "👑",
};

interface FriendProfile {
  uid: string;
  displayName: string;
  stats: UserDoc["stats"];
  rebirthCount: number;
  petStage: string;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function notify(toUid: string, type: string) {
  try {
    const headers = await getAuthHeader();
    await fetch("/api/notifications/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ toUid, type }),
    });
  } catch (error) {
    console.error("[friends] 發送通知失敗（不影響主要操作）：", error);
  }
}

function FriendsPageContent() {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);
  const setUser = useGameStore((s) => s.setUser);

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<UserDoc[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [incomingRequesters, setIncomingRequesters] = useState<UserDoc[]>([]);
  const [incomingChallenger, setIncomingChallenger] = useState<UserDoc | null>(null);
  const [incomingMatchChallenger, setIncomingMatchChallenger] = useState<UserDoc | null>(null);
  const [friendProfiles, setFriendProfiles] = useState<FriendProfile[]>([]);
  const [outgoingProfiles, setOutgoingProfiles] = useState<UserDoc[]>([]);
  const [isRespondingChallenge, setIsRespondingChallenge] = useState(false);
  const [isRespondingMatchChallenge, setIsRespondingMatchChallenge] = useState(false);
  const [matchChallengeTarget, setMatchChallengeTarget] = useState<{ uid: string; name: string } | null>(null);
  const [matchBaseMinutes, setMatchBaseMinutes] = useState(15);
  const [matchIncrementSeconds, setMatchIncrementSeconds] = useState(5);

  const myUid = user?.uid ?? "";

  function showMessage(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3000);
  }

  // ---- 即時監聽自己的文件 ----
  // 好友/邀請的狀態變化（自己送出邀請被接受/拒絕、被移除好友等）
  // 光靠登入時讀一次的 user store 會是舊資料，這裡額外訂閱一份即時
  // 更新，確保這個頁面看到的 outgoingFriendRequestUids / friends
  // 隨時是最新的（同時也會順便更新回全站共用的 user store）。
  useEffect(() => {
    if (!myUid) return;
    const unsubscribe = onSnapshot(doc(db, "users", myUid), (snap) => {
      if (!snap.exists()) return;
      setUser(snap.data() as UserDoc);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid]);

  // ---- 收到的好友邀請：誰的 outgoingFriendRequestUids 裡有我 ----
  useEffect(() => {
    if (!myUid) return;
    const q = query(collection(db, "users"), where("outgoingFriendRequestUids", "array-contains", myUid));
    const unsubscribe = onSnapshot(q, (snap) => {
      const dismissed = user?.dismissedFriendRequestUids ?? [];
      const list = snap.docs
        .map((d) => d.data() as UserDoc)
        .filter((u) => !dismissed.includes(u.uid));
      setIncomingRequesters(list);
    });
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUid, user?.dismissedFriendRequestUids]);

  // ---- 收到的對戰挑戰：誰的 outgoingBattleChallengeUid 指定了我 ----
  useEffect(() => {
    if (!myUid) return;
    const q = query(collection(db, "users"), where("outgoingBattleChallengeUid", "==", myUid));
    const unsubscribe = onSnapshot(q, (snap) => {
      setIncomingChallenger(snap.empty ? null : (snap.docs[0].data() as UserDoc));
    });
    return () => unsubscribe();
  }, [myUid]);

  // ---- 收到的配對對弈挑戰：誰的 outgoingMatchChallengeUid 指定了我 ----
  useEffect(() => {
    if (!myUid) return;
    const q = query(collection(db, "users"), where("outgoingMatchChallengeUid", "==", myUid));
    const unsubscribe = onSnapshot(q, (snap) => {
      setIncomingMatchChallenger(snap.empty ? null : (snap.docs[0].data() as UserDoc));
    });
    return () => unsubscribe();
  }, [myUid]);

  // ---- 已送出、還在等回應的好友邀請（給「取消」功能用，不用重新搜尋一次） ----
  useEffect(() => {
    const uids = user?.outgoingFriendRequestUids ?? [];
    if (uids.length === 0) {
      setOutgoingProfiles([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const profiles = await Promise.all(uids.map((uid) => getDoc(doc(db, "users", uid))));
      if (cancelled) return;
      setOutgoingProfiles(
        profiles
          .filter((snap) => snap.exists())
          .map((snap) => snap.data() as UserDoc)
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.outgoingFriendRequestUids]);

  // ---- 好友列表的詳細資料（解題數/勝率/寵物階段） ----
  useEffect(() => {
    if (!user) return;
    const friendUids = user.friends ?? [];
    if (friendUids.length === 0) {
      setFriendProfiles([]);
      return;
    }

    let cancelled = false;
    (async () => {
      const profiles = await Promise.all(
        friendUids.map(async (uid) => {
          const [userSnap, petSnap] = await Promise.all([
            getDoc(doc(db, "users", uid)),
            getDoc(doc(db, "pets", uid)),
          ]);
          const friendUser = userSnap.exists() ? (userSnap.data() as UserDoc) : undefined;
          const petStage = (petSnap.data()?.stage as string | undefined) ?? "egg";
          if (!friendUser) return null;
          return {
            uid,
            displayName: friendUser.displayName,
            stats: friendUser.stats,
            rebirthCount: friendUser.rebirthCount,
            petStage,
          } satisfies FriendProfile;
        })
      );
      if (!cancelled) setFriendProfiles(profiles.filter((p): p is FriendProfile => p !== null));
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;

  const outgoingUids = user.outgoingFriendRequestUids ?? [];
  const friendUids = user.friends ?? [];

  async function handleSearch() {
    const term = searchTerm.trim();
    if (!term) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const snap = await getDocs(
        query(
          collection(db, "users"),
          where("role", "==", "student"),
          where("displayName", ">=", term),
          where("displayName", "<=", term + "\uf8ff"),
          fsLimit(10)
        )
      );
      const results = snap.docs.map((d) => d.data() as UserDoc).filter((u) => u.uid !== myUid);
      setSearchResults(results);
      if (results.length === 0) showMessage("找不到這個名字的同學");
    } catch (error) {
      console.error("[friends] 搜尋失敗：", error);
      showMessage("搜尋失敗，請稍後再試");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSendRequest(target: UserDoc) {
    if (!user) return;
    const newOutgoing = [...outgoingUids, target.uid];
    setUser({ ...user, outgoingFriendRequestUids: newOutgoing });
    await updateDoc(doc(db, "users", user.uid), { outgoingFriendRequestUids: arrayUnion(target.uid) });
    await notify(target.uid, "friend_request");
    showMessage(`已送出好友邀請給 ${target.displayName}`);
  }

  async function handleCancelRequest(targetUid: string) {
    if (!user) return;
    const newOutgoing = outgoingUids.filter((uid) => uid !== targetUid);
    setUser({ ...user, outgoingFriendRequestUids: newOutgoing });
    await updateDoc(doc(db, "users", user.uid), { outgoingFriendRequestUids: arrayRemove(targetUid) });
    showMessage("已取消邀請");
  }

  async function handleAcceptRequest(fromUser: UserDoc) {
    if (!user) return;
    try {
      const headers = await getAuthHeader();
      const res = await fetch("/api/friends/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ fromUid: fromUser.uid }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage(data.error ?? "接受邀請失敗");
        return;
      }
      setUser({ ...user, friends: [...friendUids, fromUser.uid] });
      showMessage(`你跟 ${fromUser.displayName} 成為好友了！`);
    } catch (error) {
      console.error("[friends] 接受邀請失敗：", error);
      showMessage("接受邀請失敗，請稍後再試");
    }
  }

  async function handleDeclineRequest(fromUser: UserDoc) {
    if (!user) return;
    // 先在自己這邊樂觀隱藏（不用等 API 回應），體感比較快
    const dismissed = [...(user.dismissedFriendRequestUids ?? []), fromUser.uid];
    setUser({ ...user, dismissedFriendRequestUids: dismissed });
    await updateDoc(doc(db, "users", user.uid), { dismissedFriendRequestUids: arrayUnion(fromUser.uid) });

    // 同時清掉對方的「已送出邀請」狀態，讓他之後可以重新邀請我，
    // 不然會卡在一個他猜不到发生什麼事、也沒辦法重新邀請的死狀態。
    try {
      const headers = await getAuthHeader();
      await fetch("/api/friends/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ fromUid: fromUser.uid }),
      });
    } catch (error) {
      console.error("[friends] 拒絕邀請時清除對方狀態失敗：", error);
    }
  }

  async function handleChallenge(friendUid: string, friendName: string) {
    if (!user) return;
    if (user.outgoingBattleChallengeUid) {
      showMessage("你已經有一個對戰邀請還在等回應了，先等對方回應或稍後再試");
      return;
    }
    const now = Date.now();
    setUser({ ...user, outgoingBattleChallengeUid: friendUid, outgoingBattleChallengeSentAt: now });
    await updateDoc(doc(db, "users", user.uid), {
      outgoingBattleChallengeUid: friendUid,
      outgoingBattleChallengeSentAt: now,
    });
    await notify(friendUid, "battle_challenge");
    showMessage(`已經向 ${friendName} 發出戰帖，等他回應！`);
  }

  async function handleCancelChallenge() {
    if (!user) return;
    setUser({ ...user, outgoingBattleChallengeUid: null, outgoingBattleChallengeSentAt: null });
    await updateDoc(doc(db, "users", user.uid), {
      outgoingBattleChallengeUid: null,
      outgoingBattleChallengeSentAt: null,
    });
  }

  async function handleRespondChallenge(action: "accept" | "decline") {
    setIsRespondingChallenge(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch("/api/battle/challenge-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage(data.error ?? "操作失敗");
        setIsRespondingChallenge(false);
        return;
      }
      if (action === "accept" && data.roomId) {
        router.push(`/battle?room=${data.roomId}`);
        return;
      }
      showMessage("已婉拒對戰邀請");
    } catch (error) {
      console.error("[friends] 回應挑戰失敗：", error);
      showMessage("操作失敗，請稍後再試");
    } finally {
      setIsRespondingChallenge(false);
    }
  }

  function openMatchChallengeDialog(friendUid: string, friendName: string) {
    if (!user) return;
    if (user.outgoingMatchChallengeUid) {
      showMessage("你已經有一個對局邀請還在等回應了，先等對方回應或稍後再試");
      return;
    }
    setMatchBaseMinutes(15);
    setMatchIncrementSeconds(5);
    setMatchChallengeTarget({ uid: friendUid, name: friendName });
  }

  async function handleSendMatchChallenge() {
    if (!user || !matchChallengeTarget) return;
    const now = Date.now();
    const settings = { baseMinutes: matchBaseMinutes, incrementSeconds: matchIncrementSeconds };
    setUser({
      ...user,
      outgoingMatchChallengeUid: matchChallengeTarget.uid,
      outgoingMatchChallengeSentAt: now,
      outgoingMatchChallengeSettings: settings,
    });
    await updateDoc(doc(db, "users", user.uid), {
      outgoingMatchChallengeUid: matchChallengeTarget.uid,
      outgoingMatchChallengeSentAt: now,
      outgoingMatchChallengeSettings: settings,
    });
    await notify(matchChallengeTarget.uid, "match_challenge");
    showMessage(`已經向 ${matchChallengeTarget.name} 發出對局邀請，等他回應！`);
    setMatchChallengeTarget(null);
  }

  async function handleCancelMatchChallenge() {
    if (!user) return;
    setUser({ ...user, outgoingMatchChallengeUid: null, outgoingMatchChallengeSentAt: null, outgoingMatchChallengeSettings: null });
    await updateDoc(doc(db, "users", user.uid), {
      outgoingMatchChallengeUid: null,
      outgoingMatchChallengeSentAt: null,
      outgoingMatchChallengeSettings: null,
    });
  }

  async function handleRespondMatchChallenge(action: "accept" | "decline") {
    setIsRespondingMatchChallenge(true);
    try {
      const headers = await getAuthHeader();
      const res = await fetch("/api/match/challenge-respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        showMessage(data.error ?? "操作失敗");
        setIsRespondingMatchChallenge(false);
        return;
      }
      if (action === "accept" && data.roomId) {
        router.push(`/match?room=${data.roomId}`);
        return;
      }
      showMessage("已婉拒對局邀請");
    } catch (error) {
      console.error("[friends] 回應對局挑戰失敗：", error);
      showMessage("操作失敗，請稍後再試");
    } finally {
      setIsRespondingMatchChallenge(false);
    }
  }

  async function handleRemoveFriend(friendUid: string) {
    if (!user) return;
    setUser({ ...user, friends: friendUids.filter((uid) => uid !== friendUid) });
    await updateDoc(doc(db, "users", user.uid), { friends: arrayRemove(friendUid) });
    // 對方那邊的 friends 陣列拿不掉我（沒有跨帳號寫入權限）——這是刻意
    // 的簡化，對方會在自己的好友列表看到一個「已經不理你」的好友，
    // 之後可以再加一個「偵測到對方沒有我」自動隱藏的機制，目前先這樣。
  }

  return (
    <main className="min-h-screen pb-24" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => router.push("/")} className="text-sm font-bold text-[#1A1A2E]/60">
            ← 返回
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">👥 好友</h1>
          <span className="w-8" />
        </div>

        {message ? (
          <div className="mt-3 rounded-2xl bg-[#1A1A2E] px-4 py-2 text-center text-xs font-bold text-white">
            {message}
          </div>
        ) : null}

        {/* ---- 收到的對戰挑戰 ---- */}
        {incomingChallenger ? (
          <section className="mt-4 rounded-3xl bg-[#8B5FBF] p-4 text-white shadow-sm">
            <p className="text-sm font-extrabold">⚔️ {incomingChallenger.displayName} 向你下戰帖！</p>
            <p className="mt-1 text-xs text-white/80">接受的話雙方都會扣 20 飼料，直接開打</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => handleRespondChallenge("decline")}
                disabled={isRespondingChallenge}
                className="flex-1 rounded-xl bg-white/15 py-2 text-xs font-bold disabled:opacity-50"
              >
                婉拒
              </button>
              <button
                type="button"
                onClick={() => handleRespondChallenge("accept")}
                disabled={isRespondingChallenge}
                className="flex-[2] rounded-xl bg-white py-2 text-xs font-extrabold text-[#8B5FBF] disabled:opacity-50"
              >
                {isRespondingChallenge ? "處理中…" : "接受挑戰！"}
              </button>
            </div>
          </section>
        ) : null}

        {/* ---- 我發出、還在等回應的挑戰 ---- */}
        {user.outgoingBattleChallengeUid ? (
          <section className="mt-4 rounded-3xl bg-white/70 p-4 text-center shadow-sm">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">⚔️ 對戰邀請已送出，等待對方回應中…</p>
            <button type="button" onClick={handleCancelChallenge} className="mt-2 text-xs font-bold text-[#C0392B] underline">
              取消邀請
            </button>
          </section>
        ) : null}

        {/* ---- 收到的配對對弈挑戰 ---- */}
        {incomingMatchChallenger ? (
          <section className="mt-4 rounded-3xl bg-[#6B4593] p-4 text-white shadow-sm">
            <p className="text-sm font-extrabold">♟️ {incomingMatchChallenger.displayName} 邀請你下一整盤棋！</p>
            <p className="mt-1 text-xs text-white/80">
              {incomingMatchChallenger.outgoingMatchChallengeSettings
                ? `棋鐘：每人 ${incomingMatchChallenger.outgoingMatchChallengeSettings.baseMinutes} 分鐘，每步加 ${incomingMatchChallenger.outgoingMatchChallengeSettings.incrementSeconds} 秒`
                : "棋鐘：每人 15 分鐘，每步加 5 秒"}
              ・接受的話雙方都會扣 20 飼料
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => handleRespondMatchChallenge("decline")}
                disabled={isRespondingMatchChallenge}
                className="flex-1 rounded-xl bg-white/15 py-2 text-xs font-bold disabled:opacity-50"
              >
                婉拒
              </button>
              <button
                type="button"
                onClick={() => handleRespondMatchChallenge("accept")}
                disabled={isRespondingMatchChallenge}
                className="flex-[2] rounded-xl bg-white py-2 text-xs font-extrabold text-[#6B4593] disabled:opacity-50"
              >
                {isRespondingMatchChallenge ? "處理中…" : "接受對局！"}
              </button>
            </div>
          </section>
        ) : null}

        {/* ---- 我發出、還在等回應的配對對弈挑戰 ---- */}
        {user.outgoingMatchChallengeUid ? (
          <section className="mt-4 rounded-3xl bg-white/70 p-4 text-center shadow-sm">
            <p className="text-xs font-semibold text-[#1A1A2E]/60">♟️ 對局邀請已送出，等待對方回應中…</p>
            <button type="button" onClick={handleCancelMatchChallenge} className="mt-2 text-xs font-bold text-[#C0392B] underline">
              取消邀請
            </button>
          </section>
        ) : null}

        {/* ---- 收到的好友邀請 ---- */}
        {incomingRequesters.length > 0 ? (
          <section className="mt-4">
            <p className="mb-2 text-xs font-bold text-[#1A1A2E]/60">📮 好友邀請</p>
            <div className="flex flex-col gap-2">
              {incomingRequesters.map((requester) => (
                <div key={requester.uid} className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
                  <p className="flex-1 text-sm font-bold text-[#1A1A2E]">{requester.displayName}</p>
                  <button
                    type="button"
                    onClick={() => handleDeclineRequest(requester)}
                    className="rounded-xl bg-[#1A1A2E]/10 px-3 py-1.5 text-xs font-bold text-[#1A1A2E]/60"
                  >
                    拒絕
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAcceptRequest(requester)}
                    className="rounded-xl bg-[#5B8C5A] px-3 py-1.5 text-xs font-bold text-white"
                  >
                    接受
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---- 已送出、還在等回應的好友邀請 ---- */}
        {outgoingProfiles.length > 0 ? (
          <section className="mt-4">
            <p className="mb-2 text-xs font-bold text-[#1A1A2E]/60">📤 已送出的邀請</p>
            <div className="flex flex-col gap-2">
              {outgoingProfiles.map((target) => (
                <div key={target.uid} className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
                  <p className="flex-1 text-sm font-bold text-[#1A1A2E]">{target.displayName}</p>
                  <span className="text-xs font-semibold text-[#1A1A2E]/40">等待回應中</span>
                  <button
                    type="button"
                    onClick={() => handleCancelRequest(target.uid)}
                    className="rounded-xl bg-[#1A1A2E]/10 px-3 py-1.5 text-xs font-bold text-[#C0392B]"
                  >
                    取消
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {/* ---- 搜尋加好友 ---- */}
        <section className="mt-4">
          <p className="mb-2 text-xs font-bold text-[#1A1A2E]/60">🔍 搜尋同學</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="輸入同學的顯示名稱"
              className="flex-1 rounded-xl bg-white/80 px-3 py-2 text-sm outline-none ring-1 ring-inset ring-[#A9764C]/20"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={isSearching}
              className="rounded-xl bg-[#8B5FBF] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {isSearching ? "搜尋中…" : "搜尋"}
            </button>
          </div>

          {searchResults.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              {searchResults.map((result) => {
                const isFriend = friendUids.includes(result.uid);
                const isPending = outgoingUids.includes(result.uid);
                return (
                  <div key={result.uid} className="flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
                    <p className="flex-1 text-sm font-bold text-[#1A1A2E]">{result.displayName}</p>
                    {isFriend ? (
                      <span className="text-xs font-semibold text-[#1A1A2E]/40">已經是好友</span>
                    ) : isPending ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1A1A2E]/40">邀請已送出</span>
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(result.uid)}
                          className="text-xs font-bold text-[#C0392B] underline"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSendRequest(result)}
                        className="rounded-xl bg-[#8B5FBF] px-3 py-1.5 text-xs font-bold text-white"
                      >
                        加好友
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {/* ---- 我的好友 ---- */}
        <section className="mt-5">
          <p className="mb-2 text-xs font-bold text-[#1A1A2E]/60">👥 我的好友（{friendUids.length}）</p>
          {friendProfiles.length === 0 ? (
            <p className="rounded-2xl bg-white/50 px-4 py-6 text-center text-xs text-[#1A1A2E]/50">
              還沒有好友，去上面搜尋同學加好友吧！
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {friendProfiles.map((friend) => (
                <div key={friend.uid} className="rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{STAGE_EMOJI[friend.petStage] ?? "🐣"}</span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-[#1A1A2E]">{friend.displayName}</p>
                      <p className="text-[11px] text-[#1A1A2E]/50">
                        解題 {friend.stats.totalSolved} 題・轉生 {friend.rebirthCount} 次
                        <br />
                        對電腦勝率 {getVsComputerWinRate({ stats: friend.stats } as UserDoc)}%・對戰勝率{" "}
                        {getBattleWinRate({ stats: friend.stats } as UserDoc)}%
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleChallenge(friend.uid, friend.displayName)}
                      disabled={!!user.outgoingBattleChallengeUid}
                      className="flex-1 rounded-xl bg-[#C0392B] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                    >
                      ⚔️ 殘局挑戰
                    </button>
                    <button
                      type="button"
                      onClick={() => openMatchChallengeDialog(friend.uid, friend.displayName)}
                      disabled={!!user.outgoingMatchChallengeUid}
                      className="flex-1 rounded-xl bg-[#6B4593] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                    >
                      ♟️ 對局挑戰
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveFriend(friend.uid)}
                    className="mt-2 text-[11px] font-semibold text-[#1A1A2E]/30 underline"
                  >
                    移除好友
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ---- 配對對弈挑戰：棋鐘設定小視窗 ---- */}
        {matchChallengeTarget ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
              <p className="text-center text-sm font-extrabold text-[#1A1A2E]">
                ♟️ 邀請 {matchChallengeTarget.name} 下一整盤棋
              </p>
              <p className="mt-1 text-center text-xs text-[#1A1A2E]/50">自訂棋鐘（費雪制：每步加秒數）</p>

              <div className="mt-4">
                <p className="text-xs font-bold text-[#1A1A2E]/60">每人總時間</p>
                <div className="mt-1 flex gap-2">
                  {[5, 10, 15, 30].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => setMatchBaseMinutes(minutes)}
                      className={[
                        "flex-1 rounded-xl py-2 text-xs font-bold transition-transform active:scale-95",
                        matchBaseMinutes === minutes ? "bg-[#6B4593] text-white" : "bg-[#1A1A2E]/5 text-[#1A1A2E]/60",
                      ].join(" ")}
                    >
                      {minutes} 分
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-bold text-[#1A1A2E]/60">每步加秒</p>
                <div className="mt-1 flex gap-2">
                  {[0, 3, 5, 10].map((seconds) => (
                    <button
                      key={seconds}
                      type="button"
                      onClick={() => setMatchIncrementSeconds(seconds)}
                      className={[
                        "flex-1 rounded-xl py-2 text-xs font-bold transition-transform active:scale-95",
                        matchIncrementSeconds === seconds ? "bg-[#6B4593] text-white" : "bg-[#1A1A2E]/5 text-[#1A1A2E]/60",
                      ].join(" ")}
                    >
                      +{seconds} 秒
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMatchChallengeTarget(null)}
                  className="flex-1 rounded-2xl bg-[#1A1A2E]/10 py-3 text-sm font-bold text-[#1A1A2E]/60"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSendMatchChallenge}
                  className="flex-[2] rounded-2xl bg-[#6B4593] py-3 text-sm font-bold text-white transition-transform active:scale-95"
                >
                  發出邀請（雙方入場費 20 飼料）
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default function FriendsPage() {
  return (
    <RequireAuth requiredRole="student">
      <FriendsPageContent />
    </RequireAuth>
  );
}
