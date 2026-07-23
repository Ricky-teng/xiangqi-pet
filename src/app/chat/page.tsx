/**
 * src/app/chat/page.tsx
 *
 * 聊天列表頁：列出所有好友，已經聊過天的排最上面（依最新訊息時間），
 * 顯示最新一則訊息預覽跟未讀數；還沒聊過天的好友排在下面，直接點就能
 * 開始聊天（不用另外有個「開始聊天」的步驟，開一則訊息聊天室就自動
 * 建立）。
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { useAppBackground } from "@/lib/useAppBackground";
import type { ChatDoc, UserDoc } from "@/types/database";

interface FriendChatRow {
  uid: string;
  displayName: string;
  chat: ChatDoc | null;
}

function ChatListContent() {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);

  const [friendNames, setFriendNames] = useState<Record<string, string>>({});
  const [chatsByFriendUid, setChatsByFriendUid] = useState<Record<string, ChatDoc>>({});
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);

  const friendUids = user?.friends ?? [];

  // ---- 抓好友的顯示名稱 ----
  useEffect(() => {
    if (friendUids.length === 0) {
      setIsLoadingFriends(false);
      return;
    }
    let isCancelled = false;
    setIsLoadingFriends(true);
    Promise.all(
      friendUids.map(async (uid) => {
        const snap = await getDoc(doc(db, "users", uid));
        return [uid, snap.exists() ? (snap.data() as UserDoc).displayName : "好友"] as const;
      })
    )
      .then((pairs) => {
        if (isCancelled) return;
        setFriendNames(Object.fromEntries(pairs));
      })
      .catch((error) => {
        console.error("[chat] 讀取好友名稱失敗：", error);
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingFriends(false);
      });
    return () => {
      isCancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendUids.join(",")]);

  // ---- 即時監聽所有跟我有關的聊天室 ----
  useEffect(() => {
    if (!user) return;
    const chatsQuery = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
    const unsubscribe = onSnapshot(
      chatsQuery,
      (snapshot) => {
        const map: Record<string, ChatDoc> = {};
        snapshot.docs.forEach((docSnapshot) => {
          const chat = docSnapshot.data() as ChatDoc;
          const otherUid = chat.participants.find((uid) => uid !== user.uid);
          if (otherUid) map[otherUid] = chat;
        });
        setChatsByFriendUid(map);
      },
      (error) => {
        console.error("[chat] 監聽聊天室列表失敗：", error);
      }
    );
    return () => unsubscribe();
  }, [user]);

  if (!user) return null;

  const rows: FriendChatRow[] = friendUids.map((uid) => ({
    uid,
    displayName: friendNames[uid] ?? "好友",
    chat: chatsByFriendUid[uid] ?? null,
  }));

  // 有聊過天的排最上面（依最新訊息時間新到舊），沒聊過天的排下面（按名字排序，穩定不會每次重排）
  rows.sort((a, b) => {
    if (a.chat && b.chat) return b.chat.lastMessageAt - a.chat.lastMessageAt;
    if (a.chat && !b.chat) return -1;
    if (!a.chat && b.chat) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <main className="min-h-screen pb-10" style={bgStyle}>
      <div className="mx-auto max-w-md px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回大廳
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">💬 聊天</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <div className="mt-4">
          {isLoadingFriends ? (
            <p className="text-center text-xs text-[#1A1A2E]/50">載入中…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-3xl bg-white/60 px-4 py-8 text-center shadow-sm">
              <p className="text-sm font-bold text-[#1A1A2E]">還沒有好友</p>
              <p className="mt-1 text-xs text-[#1A1A2E]/50">先去交幾個朋友，就可以開始聊天囉！</p>
              <button
                type="button"
                onClick={() => router.push("/friends")}
                className="mt-4 rounded-2xl bg-[#E8B84B] px-4 py-2.5 text-xs font-bold text-[#5C3D0A]"
              >
                前往好友列表
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {rows.map((row) => {
                const unread = row.chat?.unreadCount?.[user.uid] ?? 0;
                return (
                  <button
                    key={row.uid}
                    type="button"
                    onClick={() => router.push(`/chat/${row.uid}`)}
                    className="flex items-center gap-3 rounded-2xl bg-white/80 px-4 py-3 text-left shadow-sm transition-transform active:scale-95"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#8B5FBF]/15 text-lg">
                      🐔
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#1A1A2E]">{row.displayName}</p>
                      <p className="truncate text-xs text-[#1A1A2E]/50">
                        {row.chat ? row.chat.lastMessageText : "還沒有聊天紀錄，打個招呼吧！"}
                      </p>
                    </div>
                    {unread > 0 ? (
                      <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#C0392B] px-1.5 text-[10px] font-extrabold text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ChatListPage() {
  return (
    <RequireAuth requiredRole="student">
      <ChatListContent />
    </RequireAuth>
  );
}
