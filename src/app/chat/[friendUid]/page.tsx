/**
 * src/app/chat/[friendUid]/page.tsx
 *
 * 好友聊天對話頁
 * ------------------------------------------------------------
 * 只有好友之間能聊天（進頁面時會檢查 friendUid 在不在
 * user.friends 裡，不是的話顯示錯誤訊息，不會讓人亂輸網址就能跟
 * 陌生人聊天）。老師完全不介入，沒有任何查看入口。
 *
 * 即時更新：訊息用 onSnapshot 監聽 chats/{chatId}/messages，
 * 不用手動重新整理。聊天室文件（chats/{chatId}）第一次傳訊息時才
 * 建立（setDoc merge），不用另外有個「建立聊天室」的步驟。
 */

"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { useGameStore } from "@/stores/useGameStore";
import RequireAuth from "@/components/RequireAuth";
import { useAppBackground } from "@/lib/useAppBackground";
import { getChatId, CHAT_MESSAGE_MAX_LENGTH, CHAT_QUICK_EMOJIS } from "@/lib/chat";
import type { ChatDoc, ChatMessageDoc, UserDoc } from "@/types/database";

async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function ChatConversationContent({ friendUid }: { friendUid: string }) {
  const router = useRouter();
  const bgStyle = useAppBackground();
  const user = useGameStore((s) => s.user);

  const [friendProfile, setFriendProfile] = useState<UserDoc | null>(null);
  const [friendLoadError, setFriendLoadError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDoc[]>([]);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isFriend = !!user && (user.friends ?? []).includes(friendUid);
  const chatId = user ? getChatId(user.uid, friendUid) : null;

  // ---- 載入好友基本資料（顯示名字用） ----
  useEffect(() => {
    if (!isFriend) return;
    let isCancelled = false;
    getDoc(doc(db, "users", friendUid))
      .then((snap) => {
        if (isCancelled) return;
        if (!snap.exists()) {
          setFriendLoadError("找不到這位好友的資料。");
          return;
        }
        setFriendProfile(snap.data() as UserDoc);
      })
      .catch((error) => {
        if (isCancelled) return;
        console.error("[chat] 讀取好友資料失敗：", error);
        setFriendLoadError("讀取好友資料失敗，請稍後再試。");
      });
    return () => {
      isCancelled = true;
    };
  }, [friendUid, isFriend]);

  // ---- 進聊天室：先確保聊天室文件存在，才開始監聽訊息 ----
  // 規則裡 messages 子集合的讀取權限要靠 get() 讀「父層聊天室文件」
  // 的 participants 欄位判斷；如果雙方還沒聊過天，父層文件根本不
  // 存在，get() 讀不到東西，規則會直接判定沒有權限（Missing or
  // insufficient permissions）。所以進頁面要先用 merge 寫入把聊天室
  // 文件「確保存在」（不會覆蓋掉已經有的訊息/未讀數），成功之後才
  // 訂閱 messages，兩件事故意串成同一個 async 流程、不平行執行。
  useEffect(() => {
    if (!chatId || !user || !isFriend) return;
    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        await setDoc(
          doc(db, "chats", chatId),
          { id: chatId, participants: [user.uid, friendUid].sort() },
          { merge: true }
        );
      } catch (error) {
        console.error("[chat] 初始化聊天室文件失敗：", error);
        return;
      }
      if (isCancelled) return;

      // 聊天室文件確定存在了，這裡才是安全的時機點去標記已讀
      updateDoc(doc(db, "chats", chatId), {
        [`unreadCount.${user.uid}`]: 0,
      }).catch((error) => {
        console.error("[chat] 標記已讀失敗：", error);
      });

      const messagesQuery = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("createdAt", "asc")
      );
      unsubscribe = onSnapshot(
        messagesQuery,
        (snapshot) => {
          setMessages(snapshot.docs.map((docSnapshot) => docSnapshot.data() as ChatMessageDoc));
        },
        (error) => {
          console.error("[chat] 監聽訊息失敗：", error);
        }
      );
    })();

    return () => {
      isCancelled = true;
      unsubscribe?.();
    };
  }, [chatId, user, friendUid, isFriend]);

  // ---- 每次有新訊息進來（表示還在這個聊天室），順便再標記一次已讀 ----
  useEffect(() => {
    if (!chatId || !user || messages.length === 0) return;
    updateDoc(doc(db, "chats", chatId), {
      [`unreadCount.${user.uid}`]: 0,
    }).catch((error) => {
      console.error("[chat] 標記已讀失敗：", error);
    });
  }, [chatId, user, messages.length]);

  // ---- 新訊息進來自動捲到最下面 ----
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || !user || !chatId || isSending) return;

    setIsSending(true);
    setInputText("");
    setShowEmojiPicker(false);

    const now = Date.now();
    const messageRef = doc(collection(db, "chats", chatId, "messages"));
    const message: ChatMessageDoc = {
      id: messageRef.id,
      senderUid: user.uid,
      text: trimmed,
      createdAt: now,
    };

    try {
      await setDoc(messageRef, message);

      const chatRef = doc(db, "chats", chatId);
      const chatSnap = await getDoc(chatRef);
      const existingUnread = chatSnap.exists()
        ? ((chatSnap.data() as ChatDoc).unreadCount ?? {})
        : {};

      const chatPayload: ChatDoc = {
        id: chatId,
        participants: [user.uid, friendUid].sort() as [string, string],
        participantNames: {
          [user.uid]: user.displayName,
          [friendUid]: friendProfile?.displayName ?? "好友",
        },
        lastMessageText: trimmed,
        lastMessageAt: now,
        lastMessageSenderUid: user.uid,
        unreadCount: {
          ...existingUnread,
          [user.uid]: 0,
          [friendUid]: (existingUnread[friendUid] ?? 0) + 1,
        },
        createdAt: (chatSnap.exists() && (chatSnap.data() as ChatDoc).createdAt) || now,
      };
      await setDoc(chatRef, chatPayload, { merge: true });

      // 推播通知對方（見 notify/route.ts 的 chat_message 類型），
      // 失敗不影響訊息本身已經送出
      const headers = await getAuthHeader();
      fetch("/api/notifications/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ toUid: friendUid, type: "chat_message", previewText: trimmed }),
      }).catch((error) => {
        console.error("[chat] 發送推播失敗（不影響訊息本身）：", error);
      });
    } catch (error) {
      console.error("[chat] 傳送訊息失敗：", error);
      setInputText(trimmed); // 送失敗把文字還給輸入框，不要讓學生打的字憑空消失
    } finally {
      setIsSending(false);
    }
  }

  function handleInsertEmoji(emoji: string) {
    setInputText((prev) => prev + emoji);
  }

  if (!user) return null;

  if (!isFriend) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4" style={bgStyle}>
        <div className="w-full max-w-sm rounded-3xl bg-white/80 px-6 py-8 text-center shadow-md">
          <p className="text-sm font-bold text-[#1A1A2E]">只能跟好友聊天喔</p>
          <p className="mt-1 text-xs text-[#1A1A2E]/50">這個人不在你的好友清單裡。</p>
          <button
            type="button"
            onClick={() => router.push("/friends")}
            className="mt-4 rounded-2xl bg-[#E8B84B] px-4 py-2.5 text-xs font-bold text-[#5C3D0A]"
          >
            前往好友列表
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen flex-col" style={bgStyle}>
      <header className="flex shrink-0 items-center justify-between bg-white/70 px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => router.push("/chat")}
          className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
        >
          ← 返回
        </button>
        <h1 className="text-base font-bold text-[#1A1A2E]">
          💬 {friendProfile?.displayName ?? "好友"}
        </h1>
        <span className="w-[52px]" aria-hidden="true" />
      </header>

      {friendLoadError ? (
        <p className="px-4 py-2 text-center text-xs text-[#C0392B]">{friendLoadError}</p>
      ) : null}

      {/* 訊息列表：flex-1 填滿中間空間，自己捲動；輸入區固定在最下面 */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-xs text-[#1A1A2E]/40">
            還沒有任何訊息，打個招呼吧！
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((message) => {
              const isMine = message.senderUid === user.uid;
              return (
                <div key={message.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={[
                      "max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                      isMine ? "bg-[#8B5FBF] text-white" : "bg-white/90 text-[#1A1A2E]",
                    ].join(" ")}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.text}</p>
                    <p className={["mt-0.5 text-[9px]", isMine ? "text-white/60" : "text-[#1A1A2E]/40"].join(" ")}>
                      {new Date(message.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* emoji 選擇器：展開時蓋在輸入框正上方 */}
      {showEmojiPicker ? (
        <div className="shrink-0 border-t border-[#1A1A2E]/5 bg-white/90 px-3 py-2">
          <div className="grid grid-cols-8 gap-1.5">
            {CHAT_QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleInsertEmoji(emoji)}
                className="rounded-lg py-1.5 text-lg transition-transform active:scale-90 hover:bg-[#E8B84B]/20"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 輸入區：固定在畫面最下面 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[#1A1A2E]/5 bg-white/80 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setShowEmojiPicker((prev) => !prev)}
          className={[
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg transition-transform active:scale-90",
            showEmojiPicker ? "bg-[#E8B84B]/30" : "bg-[#1A1A2E]/5",
          ].join(" ")}
          aria-label="表情符號"
        >
          😀
        </button>
        <input
          type="text"
          value={inputText}
          onChange={(event) => setInputText(event.target.value.slice(0, CHAT_MESSAGE_MAX_LENGTH))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          placeholder="輸入訊息…"
          className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-sm text-[#1A1A2E] ring-1 ring-inset ring-[#A9764C]/20 placeholder:text-[#1A1A2E]/30 focus:outline-none focus:ring-2 focus:ring-[#E8B84B]"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!inputText.trim() || isSending}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#8B5FBF] text-white shadow-sm transition-transform active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="送出"
        >
          {isSending ? "…" : "➤"}
        </button>
      </div>
    </main>
  );
}

export default function ChatConversationPage({ params }: { params: Promise<{ friendUid: string }> }) {
  const { friendUid } = use(params);
  return (
    <RequireAuth requiredRole="student">
      <ChatConversationContent friendUid={friendUid} />
    </RequireAuth>
  );
}
