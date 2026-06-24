/**
 * src/app/admin/dashboard/page.tsx
 *
 * 老師監控後台：學生答題狀況總覽
 * ------------------------------------------------------------
 * 顯示所有學生的：象棋等級、解題統計（總解題數/總嘗試次數/勝率）、
 * 小雞健康狀態，並可以展開查看每個學生「每一次解題」的明細
 * （解了哪道題、什麼難度、什麼時候解的、解出來之前錯了幾次）。
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
 *
 * 權限需求（Firestore 安全規則）：
 *   這個頁面需要「老師可以讀取所有學生的 users / pets /
 *   solvedPuzzles」，這跟學生端「只能讀寫自己」的規則不一樣，
 *   必須額外加一條「if 角色是 teacher 就放行讀取」的規則，
 *   否則會出現跟之前一樣的 Missing or insufficient permissions。
 *   完整規則內容請見對話裡的說明，不是程式碼檔案的一部分。
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import type { PetDoc, PuzzleDoc, SolvedPuzzleRecord, UserDoc } from "@/types/database";
import { CATALOG_ENTRIES } from "@/lib/pet/catalog";

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

  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function fetchDashboardData() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const [usersSnapshot, solvedSnapshot, petsSnapshot, puzzlesSnapshot] = await Promise.all([
          getDocs(query(collection(db, "users"), where("role", "==", "student"))),
          getDocs(collectionGroup(db, "solvedPuzzles")),
          getDocs(collection(db, "pets")),
          getDocs(collection(db, "puzzles")),
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

        setStudents(studentList);
        setPetsByUid(petMap);
        setPuzzlesById(puzzleMap);
        setSolvedRecords(records);
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
                const isExpanded = expandedUid === student.uid;

                return (
                  <li key={student.uid} className="rounded-2xl bg-white/70 shadow-sm">
                    <button
                      type="button"
                      onClick={() => setExpandedUid(isExpanded ? null : student.uid)}
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
                        {/* 圖鑑收藏狀況：資料其實已經包含在 student（UserDoc）裡，
                            不需要額外查詢，純粹是補上顯示。 */}
                        <p className="text-xs font-semibold text-[#1A1A2E]/70">
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
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

export default function TeacherDashboardPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <DashboardContent />
    </RequireAuth>
  );
}
