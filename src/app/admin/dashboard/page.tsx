/**
 * src/app/admin/dashboard/page.tsx
 *
 * 老師監控後台：學生答題狀況總覽
 * ------------------------------------------------------------
 * 顯示所有學生的：象棋等級、解題統計（總解題數/總嘗試次數/勝率）、
 * 小雞健康狀態，並可以展開查看每個學生「每一次解題」的明細
 * （解了哪道題、什麼難度、什麼時候解的、解出來之前錯了幾次），以及
 * 「每一場對弈電腦」的紀錄（贏/輸/和、難度、飼料增減），點進去可以
 * 用棋盤一步一步回放整局棋。
 *
 * 資料來源（皆為一次性 getDocs，不開即時監聽，避免長期掛著這頁
 * 浪費 Firestore 讀取額度）：
 *   1. users 集合，篩 role === "student"。
 *   2. collectionGroup("solvedPuzzles")：用 collection group query
 *      一次撈出「所有學生」的解題紀錄子集合，不需要對每個學生各打
 *      一次查詢。文件本身沒有存 uid 欄位，所以用
 *      docSnapshot.ref.parent.parent?.id 取出它所屬的學生 uid
 *      （路徑是 users/{uid}/solvedPuzzles/{puzzleId}，
 *      parent = solvedPuzzles 集合，parent.parent = users/{uid} 文件）。
 *   3. pets 集合（文件 ID 即 uid，一對一對應 users），撈出健康狀態。
 *   4. puzzles 集合，用來把 solvedPuzzles 紀錄裡的 puzzleId
 *      換成題目標題顯示。
 *   5. collectionGroup("vsComputerGames")：跟 solvedPuzzles 同樣的
 *      collection group 查詢手法，但這個文件本身就存了 studentUid
 *      欄位（見 gameRecording.ts），不需要從路徑反推。
 *
 * 權限需求（Firestore 安全規則）：
 *   這個頁面需要「老師可以讀取所有學生的 users / pets /
 *   solvedPuzzles / vsComputerGames」，這跟學生端「只能讀寫自己」的
 *   規則不一樣，必須額外加規則放行讀取，否則會出現跟之前一樣的
 *   Missing or insufficient permissions。完整規則內容請見對話裡的
 *   說明，不是程式碼檔案的一部分。
 */

"use client";


import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, collectionGroup, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import type { PetDoc, PuzzleDoc, SolvedPuzzleRecord, UserDoc, VsComputerGameDoc } from "@/types/database";
import type { PuzzleLevel } from "@/types/xiangqi";
import { CATALOG_ENTRIES } from "@/lib/pet/catalog";
import ChessBoard from "@/components/ChessBoard";
import { parseFen } from "@/lib/xiangqi/fen";
import { toChineseNotation } from "@/lib/xiangqi/chineseNotation";

type FetchStatus = "loading" | "success" | "error";

/** collectionGroup 查回來的解題紀錄，補上從文件路徑反推出來的 uid */
interface SolvedRecordWithUid extends SolvedPuzzleRecord {
  uid: string;
}

const HEALTH_STATUS_LABEL: Record<string, string> = {
  normal: "健康",
  slightly_sick: "生小病",
  severely_sick: "生大病",
  dead: "已死亡",
};

const HEALTH_STATUS_EMOJI: Record<string, string> = {
  normal: "🐣",
  slightly_sick: "🤢",
  severely_sick: "🤮",
  dead: "💀",
};

const OUTCOME_LABEL: Record<"win" | "lose" | "draw", string> = {
  win: "🏆 獲勝",
  lose: "😢 落敗",
  draw: "🤝 和棋",
};

function formatTimestamp(ms: number): string {
  if (!ms) return "—";
  const date = new Date(ms);
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DashboardContent() {
  const router = useRouter();

  const [status, setStatus] = useState<FetchStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [students, setStudents] = useState<UserDoc[]>([]);
  const [petsByUid, setPetsByUid] = useState<Map<string, PetDoc>>(new Map());
  const [solvedRecords, setSolvedRecords] = useState<SolvedRecordWithUid[]>([]);
  const [puzzlesById, setPuzzlesById] = useState<Map<string, PuzzleDoc>>(new Map());
  const [vsComputerGames, setVsComputerGames] = useState<VsComputerGameDoc[]>([]);

  // 正在查看回放的對局（null 代表沒有打開回放）
  const [replayingGame, setReplayingGame] = useState<VsComputerGameDoc | null>(null);

  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  // ---- 老師調整學生棋藝等級 ----
  // 只有「目前展開的那位學生」會用到這幾個狀態，不需要用 uid 當 key
  // 個別記錄每個人，切換展開對象時順手清空即可。
  const [pendingLevel, setPendingLevel] = useState<PuzzleLevel | null>(null);
  const [isSavingLevel, setIsSavingLevel] = useState(false);
  const [levelSaveMessage, setLevelSaveMessage] = useState<string | null>(null);

  function handleToggleExpand(uid: string) {
    setExpandedUid((prev) => (prev === uid ? null : uid));
    setPendingLevel(null);
    setLevelSaveMessage(null);
  }

  async function handleUpdateLevel(student: UserDoc) {
    if (pendingLevel === null || pendingLevel === student.chessLevel) return;

    setIsSavingLevel(true);
    setLevelSaveMessage(null);
    try {
      await updateDoc(doc(db, "users", student.uid), {
        chessLevel: pendingLevel,
        updatedAt: Date.now(),
      });
      // 同步更新本地列表，不用重新整理整個頁面才會看到新等級
      setStudents((prev) =>
        prev.map((existing) =>
          existing.uid === student.uid ? { ...existing, chessLevel: pendingLevel } : existing
        )
      );
      setLevelSaveMessage(`已將「${student.displayName}」的等級更新為 ${pendingLevel} 級！`);
    } catch (error) {
      console.error("[admin/dashboard] 更新學生等級失敗：", error);
      setLevelSaveMessage("更新失敗，請稍後再試。");
    } finally {
      setIsSavingLevel(false);
    }
  }

  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboardData() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const [usersSnapshot, solvedSnapshot, petsSnapshot, puzzlesSnapshot, vsComputerSnapshot] =
          await Promise.all([
            getDocs(query(collection(db, "users"), where("role", "==", "student"))),
            getDocs(collectionGroup(db, "solvedPuzzles")),
            getDocs(collection(db, "pets")),
            getDocs(collection(db, "puzzles")),
            getDocs(collectionGroup(db, "vsComputerGames")),
          ]);

        if (isCancelled) return;

        const studentList = usersSnapshot.docs.map((docSnapshot) => docSnapshot.data() as UserDoc);

        const petMap = new Map<string, PetDoc>();
        petsSnapshot.docs.forEach((docSnapshot) => {
          petMap.set(docSnapshot.id, docSnapshot.data() as PetDoc);
        });

        const puzzleMap = new Map<string, PuzzleDoc>();
        puzzlesSnapshot.docs.forEach((docSnapshot) => {
          puzzleMap.set(docSnapshot.id, docSnapshot.data() as PuzzleDoc);
        });

        const records: SolvedRecordWithUid[] = solvedSnapshot.docs.map((docSnapshot) => {
          // solvedPuzzles 文件路徑：users/{uid}/solvedPuzzles/{puzzleId}
          // parent = solvedPuzzles 集合參照，parent.parent = users/{uid} 文件參照
          const uid = docSnapshot.ref.parent.parent?.id ?? "unknown";
          return { ...(docSnapshot.data() as SolvedPuzzleRecord), uid };
        });

        // vsComputerGames 文件本身已經存了 studentUid 欄位，不需要像
        // solvedPuzzles 那樣從文件路徑反推。
        const gameRecords = vsComputerSnapshot.docs.map(
          (docSnapshot) => docSnapshot.data() as VsComputerGameDoc
        );

        setStudents(studentList);
        setPetsByUid(petMap);
        setPuzzlesById(puzzleMap);
        setSolvedRecords(records);
        setVsComputerGames(gameRecords);
        setStatus("success");
      } catch (error) {
        if (isCancelled) return;
        console.error("[admin/dashboard] 讀取學生數據失敗：", error);
        setErrorMessage(
          error instanceof Error ? error.message : "讀取學生數據時發生未知錯誤，請稍後再試。"
        );
        setStatus("error");
      }
    }

    fetchDashboardData();

    return () => {
      isCancelled = true;
    };
  }, []);

  // 依 uid 分組的解題紀錄，並依解題時間新到舊排序
  const recordsByUid = useMemo(() => {
    const grouped = new Map<string, SolvedRecordWithUid[]>();
    for (const record of solvedRecords) {
      const list = grouped.get(record.uid) ?? [];
      list.push(record);
      grouped.set(record.uid, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b.solvedAt - a.solvedAt);
    }
    return grouped;
  }, [solvedRecords]);

  // 依 uid 分組的對弈電腦紀錄，並依對局時間新到舊排序
  const gamesByUid = useMemo(() => {
    const grouped = new Map<string, VsComputerGameDoc[]>();
    for (const game of vsComputerGames) {
      const list = grouped.get(game.studentUid) ?? [];
      list.push(game);
      grouped.set(game.studentUid, list);
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => b.playedAt - a.playedAt);
    }
    return grouped;
  }, [vsComputerGames]);

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-16">
      <div className="mx-auto max-w-3xl px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="flex items-center gap-1 rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            <span aria-hidden="true">←</span>
            回出題後台
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📊 學生答題監控後台</h1>
          <span className="w-[88px]" aria-hidden="true" />
        </header>

        <div className="mt-4">
          {status === "loading" ? (
            <p className="text-center text-sm text-[#1A1A2E]/60">學生數據載入中…</p>
          ) : status === "error" ? (
            <div className="rounded-2xl bg-[#C0392B]/10 px-4 py-4 text-center text-sm text-[#C0392B]">
              {errorMessage ?? "讀取失敗，請稍後再試。"}
              <p className="mt-2 text-xs text-[#1A1A2E]/50">
                若顯示「Missing or insufficient permissions」，代表 Firestore
                安全規則還沒開放老師讀取所有學生資料，請確認規則已加上對應的
                teacher 讀取權限。
              </p>
            </div>
          ) : students.length === 0 ? (
            <div className="rounded-2xl bg-white/60 px-4 py-8 text-center text-sm text-[#1A1A2E]/60">
              目前還沒有任何學生帳號。
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {students.map((student) => {
                const pet = petsByUid.get(student.uid);
                const records = recordsByUid.get(student.uid) ?? [];
                const games = gamesByUid.get(student.uid) ?? [];
                const isExpanded = expandedUid === student.uid;

                return (
                  <li key={student.uid} className="rounded-2xl bg-white/70 shadow-sm">
                    <button
                      type="button"
                      onClick={() => handleToggleExpand(student.uid)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl" role="img" aria-label="小雞狀態">
                          {pet ? HEALTH_STATUS_EMOJI[pet.healthStatus] ?? "🐣" : "❓"}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-[#1A1A2E]">{student.displayName}</p>
                          <p className="text-[11px] text-[#1A1A2E]/50">
                            等級 Lv.{student.chessLevel} ・
                            {pet ? HEALTH_STATUS_LABEL[pet.healthStatus] ?? pet.healthStatus : "無寵物資料"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-semibold text-[#1A1A2E]/70">
                        <span className="tabular-nums">
                          🏆 {student.unlockedCatalogIds.length}/{CATALOG_ENTRIES.length}
                        </span>
                        <span className="tabular-nums">
                          解題 {student.stats.totalSolved} / 嘗試 {student.stats.totalAttempts}
                        </span>
                        <span aria-hidden="true">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-[#1A1A2E]/10 px-4 py-3">
                        {/* 老師調整棋藝等級：現在所有學生註冊後都是 1 級，
                            需要老師手動依實際棋力調整。 */}
                        <p className="text-xs font-semibold text-[#1A1A2E]/70">🎓 棋藝等級</p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <select
                            value={pendingLevel ?? student.chessLevel}
                            onChange={(event) =>
                              setPendingLevel(Number(event.target.value) as PuzzleLevel)
                            }
                            className="rounded-lg bg-[#FDF6E8] px-2 py-1.5 text-xs font-semibold text-[#1A1A2E] ring-1 ring-inset ring-[#A9764C]/30"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((levelOption) => (
                              <option key={levelOption} value={levelOption}>
                                {levelOption} 級
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => handleUpdateLevel(student)}
                            disabled={
                              isSavingLevel ||
                              pendingLevel === null ||
                              pendingLevel === student.chessLevel
                            }
                            className="rounded-lg bg-[#E8B84B] px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isSavingLevel ? "更新中…" : "更新等級"}
                          </button>
                        </div>
                        {levelSaveMessage ? (
                          <p className="mt-1.5 text-[11px] font-medium text-[#5B8C5A]">
                            {levelSaveMessage}
                          </p>
                        ) : null}

                        {/* 圖鑑收藏狀況：資料其實已經包含在 student（UserDoc）裡，
                            不需要額外查詢，純粹是補上顯示。 */}
                        <p className="mt-3 text-xs font-semibold text-[#1A1A2E]/70">
                          📖 圖鑑收藏（{student.unlockedCatalogIds.length}/{CATALOG_ENTRIES.length}
                          ・轉生 {student.rebirthCount} 次）
                        </p>
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          {CATALOG_ENTRIES.map((entry) => {
                            const isUnlocked = student.unlockedCatalogIds.includes(entry.id);
                            return (
                              <div
                                key={entry.id}
                                className={[
                                  "flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-center",
                                  isUnlocked ? "bg-[#FDF6E8]" : "bg-[#1A1A2E]/5",
                                ].join(" ")}
                                title={isUnlocked ? entry.name : `轉生 ${entry.unlockAtRebirthCount} 次解鎖`}
                              >
                                <span className={["text-xl", isUnlocked ? "" : "opacity-30"].join(" ")}>
                                  {isUnlocked ? entry.fallbackEmoji : "🔒"}
                                </span>
                                <span className="text-[9px] text-[#1A1A2E]/60">
                                  {isUnlocked ? entry.name : "未解鎖"}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        <p className="mt-3 text-xs font-semibold text-[#1A1A2E]/70">📝 解題紀錄</p>
                        {records.length === 0 ? (
                          <p className="mt-1 text-xs text-[#1A1A2E]/50">這位學生還沒有解過任何題目。</p>
                        ) : (
                          <ul className="mt-1 flex flex-col gap-2">
                            {records.map((record) => {
                              const puzzleTitle =
                                puzzlesById.get(record.puzzleId)?.title ?? record.puzzleId;
                              return (
                                <li
                                  key={`${record.puzzleId}-${record.solvedAt}`}
                                  className="flex items-center justify-between rounded-xl bg-[#FDF6E8] px-3 py-2 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-semibold text-[#1A1A2E]">
                                      {puzzleTitle}
                                      <span className="ml-1 font-normal text-[#1A1A2E]/50">
                                        (Lv.{record.puzzleLevelAtSolve})
                                      </span>
                                    </p>
                                    <p className="text-[#1A1A2E]/50">
                                      {formatTimestamp(record.solvedAt)}
                                    </p>
                                  </div>
                                  <div className="ml-3 flex shrink-0 flex-col items-end gap-0.5">
                                    <span className="font-bold text-[#C0392B]">
                                      錯 {record.wrongAttemptsBeforeSolving} 次
                                    </span>
                                    <span className="text-[#1A1A2E]/50">
                                      +{record.earnedFood} 飼料
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        <p className="mt-3 text-xs font-semibold text-[#1A1A2E]/70">♟️ 對弈電腦紀錄</p>
                        {games.length === 0 ? (
                          <p className="mt-1 text-xs text-[#1A1A2E]/50">這位學生還沒有對弈過電腦。</p>
                        ) : (
                          <ul className="mt-1 flex flex-col gap-2">
                            {games.map((game) => (
                              <li
                                key={game.id}
                                className="flex items-center justify-between rounded-xl bg-[#FDF6E8] px-3 py-2 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-[#1A1A2E]">
                                    {OUTCOME_LABEL[game.outcome]}
                                    <span className="ml-1 font-normal text-[#1A1A2E]/50">
                                      (對手 Lv.{game.opponentLevel}・自身 Lv.{game.studentLevelAtPlay}・
                                      {game.moveHistory.length}手)
                                    </span>
                                  </p>
                                  <p className="text-[#1A1A2E]/50">{formatTimestamp(game.playedAt)}</p>
                                </div>
                                <div className="ml-3 flex shrink-0 flex-col items-end gap-1">
                                  <span
                                    className={[
                                      "font-bold",
                                      game.foodDelta >= 0 ? "text-[#5B8C5A]" : "text-[#C0392B]",
                                    ].join(" ")}
                                  >
                                    {game.foodDelta >= 0 ? "+" : ""}
                                    {game.foodDelta} 飼料
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setReplayingGame(game)}
                                    className="rounded-lg bg-[#8B5FBF] px-2 py-1 text-[11px] font-bold text-white transition-transform active:scale-95"
                                  >
                                    📺 查看棋局
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {replayingGame ? (
        <ReplayModal game={replayingGame} onClose={() => setReplayingGame(null)} />
      ) : null}
    </main>
  );
}

/** 對弈紀錄回放：用既有的 ChessBoard 元件顯示某一步的局面，靠 prev/next 一步步看 */
function ReplayModal({ game, onClose }: { game: VsComputerGameDoc; onClose: () => void }) {
  const [step, setStep] = useState(0); // 0 = 開局局面，最大值 = fenHistory.length - 1
  const totalSteps = game.fenHistory.length - 1;

  const board = useMemo(
    () => parseFen(game.fenHistory[step] ?? game.fenHistory[0]),
    [game, step]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1A2E]/60 px-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-[#FDF6E8] p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#1A1A2E]">
            {OUTCOME_LABEL[game.outcome]}・對手 Lv.{game.opponentLevel}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#1A1A2E]/10 px-2.5 py-1 text-xs font-bold text-[#1A1A2E]/70"
          >
            ✕
          </button>
        </div>

        {/* 回放是唯讀的，onMove 給空函式即可——不是要拿掉 ChessBoard
            的互動能力，只是這個情境下完全不需要它做任何事。 */}
        <div className="mt-3">
          <ChessBoard board={board} onMove={() => {}} />
        </div>

        <p className="mt-2 text-center text-xs text-[#1A1A2E]/60">
          第 {step} / {totalSteps} 步
          {step > 0
            ? `（${toChineseNotation(parseFen(game.fenHistory[step - 1]), game.moveHistory[step - 1])}）`
            : "（開局）"}
        </p>

        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setStep(0)}
            disabled={step === 0}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 disabled:opacity-40"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={step === 0}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 disabled:opacity-40"
          >
            ◀ 上一步
          </button>
          <button
            type="button"
            onClick={() => setStep((current) => Math.min(totalSteps, current + 1))}
            disabled={step === totalSteps}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 disabled:opacity-40"
          >
            下一步 ▶
          </button>
          <button
            type="button"
            onClick={() => setStep(totalSteps)}
            disabled={step === totalSteps}
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-bold text-[#1A1A2E]/70 ring-1 ring-inset ring-[#A9764C]/30 disabled:opacity-40"
          >
            ⏭
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TeacherDashboardPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <DashboardContent />
    </RequireAuth>
  );
}
