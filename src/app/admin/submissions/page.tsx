/**
 * src/app/admin/submissions/page.tsx
 *
 * 老師審核學生投稿的題目（見 PuzzleSubmissionDoc）
 * ------------------------------------------------------------
 * 學生只負責「發現好局面」，答案跟難度由老師在這裡補上——小學生要
 * 正確寫出完整殺法序列太難，錯誤率高反而增加審核負擔。
 *
 * 通過之後系統會自動：建立正式題目 → 標記投稿已通過 → 依難度發飼料
 * 給投稿學生。這三件事包在同一個 transaction 裡（見
 * /api/puzzle/submissions/review），不會出現「題目建好了但學生沒拿到
 * 獎勵」或重複點兩次發兩次飼料的狀況。
 *
 * 注意：這是獨立的新頁面，沒有動到 /admin/page.tsx（那支有本機手動
 * 修改過的匯入 JSON 功能）。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import RequireAuth from "@/components/RequireAuth";
import ChessBoard from "@/components/ChessBoard";
import { parseFen } from "@/lib/xiangqi/fen";
import { getSubmissionReward } from "@/lib/puzzleSubmission";
import type { PuzzleSubmissionDoc, PuzzleSubmissionStatus } from "@/types/database";
import type { PuzzleLevel } from "@/types/xiangqi";

const INPUT_CLASS =
  "w-full rounded-xl border border-[#E5DFCB] bg-white px-3 py-2 text-sm text-[#1A1A2E] outline-none focus:border-[#E8B84B]";

function SubmissionsContent() {
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState<PuzzleSubmissionStatus>("pending");
  const [submissions, setSubmissions] = useState<PuzzleSubmissionDoc[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  // 目前展開審核中的那一筆，以及老師填的題目內容
  const [activeId, setActiveId] = useState<string | null>(null);
  const [level, setLevel] = useState<PuzzleLevel>(1);
  const [description, setDescription] = useState("");
  const [movesText, setMovesText] = useState("");
  // 其他解法：一行一條，每行是一整條走法序列（見 PuzzleDoc.alternativeLines）
  const [altLinesText, setAltLinesText] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ---- AI 自動判斷（見 /api/puzzle/verify-mate）----
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ text: string; isGood: boolean } | null>(null);

  async function handleVerifyMate(submission: PuzzleSubmissionDoc) {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/puzzle/verify-mate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ fen: submission.fen }),
      });
      const data = await response.json();
      if (!response.ok) {
        setVerifyResult({ text: data.error ?? "分析失敗，請稍後再試。", isGood: false });
        return;
      }

      // 找到速勝而且序列完整 → 自動填入答案欄跟標題，老師只要確認就好。
      // 引擎用 MultiPV 一次找多條線：最快的那條當主線正解，其餘的
      // 填進「其他解法」（見 PuzzleDoc.alternativeLines）。
      const lines = (data.lines ?? []) as { mateIn: number; moves: string[] }[];
      if (data.hasMate && lines.length > 0) {
        const [mainLine, ...alternatives] = lines;
        setMovesText(mainLine.moves.join(" "));
        setAltLinesText(alternatives.map((l) => l.moves.join(" ")).join("\n"));
        // 難度用殺法步數當預設值：步數越多越難，但夾在 1-10 之間
        setLevel(Math.min(10, Math.max(1, mainLine.mateIn)) as PuzzleLevel);
      }
      setVerifyResult({ text: data.message, isGood: Boolean(data.hasMate) });
    } catch (error) {
      console.error("[admin/submissions] 自動判斷失敗：", error);
      setVerifyResult({ text: "分析失敗，請稍後再試。", isGood: false });
    } finally {
      setIsVerifying(false);
    }
  }

  const loadSubmissions = useCallback(async () => {
    setLoadState("loading");
    try {
      const snapshot = await getDocs(
        query(
          collection(db, "puzzleSubmissions"),
          where("status", "==", statusFilter),
          orderBy("submittedAt", "desc")
        )
      );
      setSubmissions(snapshot.docs.map((d) => d.data() as PuzzleSubmissionDoc));
      setLoadState("success");
    } catch (error) {
      console.error("[admin/submissions] 載入投稿失敗：", error);
      setLoadState("error");
    }
  }, [statusFilter]);

  useEffect(() => {
    loadSubmissions();
  }, [loadSubmissions]);

  function openReview(submission: PuzzleSubmissionDoc) {
    setActiveId(submission.id);
    setLevel(1);
    setDescription(submission.note ?? "");
    setMovesText("");
    setAltLinesText("");
    setRejectReason("");
    setMessage(null);
    setVerifyResult(null);
  }

  async function callReview(payload: Record<string, unknown>) {
    const token = await auth.currentUser?.getIdToken();
    const response = await fetch("/api/puzzle/submissions/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "審核失敗");
    return data;
  }

  async function handleApprove(submission: PuzzleSubmissionDoc) {
    // 走法用換行或空白分隔，過濾掉空字串
    const moves = movesText.split(/[\s\n]+/).map((m) => m.trim()).filter(Boolean);
    if (moves.length === 0) {
      setMessage("請填寫正解走法序列。");
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      // 其他解法：一行一條，每行再用空白切成走法序列，空行忽略
      const alternativeLines = altLinesText
        .split("\n")
        .map((line) => line.split(/\s+/).map((m) => m.trim()).filter(Boolean))
        .filter((lineMoves) => lineMoves.length > 0);

      const data = await callReview({
        submissionId: submission.id,
        action: "approve",
        level,
        description,
        moves,
        alternativeLines,
      });
      setMessage(
        `✅ 已通過！題目已發布，並發給「${submission.studentName}」${data.awardedFood} 飼料。`
      );
      setActiveId(null);
      await loadSubmissions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "審核失敗，請稍後再試。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReject(submission: PuzzleSubmissionDoc) {
    setIsSaving(true);
    setMessage(null);
    try {
      await callReview({ submissionId: submission.id, action: "reject", rejectReason });
      setMessage(`已駁回「${submission.studentName}」的投稿。`);
      setActiveId(null);
      await loadSubmissions();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "審核失敗，請稍後再試。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FDF6E8] pb-10">
      <div className="mx-auto max-w-2xl px-4 pt-4">
        <header className="flex items-center justify-between rounded-2xl bg-white/70 px-4 py-3 shadow-sm">
          <button
            type="button"
            onClick={() => router.push("/admin")}
            className="rounded-full bg-[#1A1A2E]/5 px-3 py-1.5 text-xs font-bold text-[#1A1A2E] transition-transform active:scale-95"
          >
            ← 返回後台
          </button>
          <h1 className="text-base font-bold text-[#1A1A2E]">📮 學生投稿審核</h1>
          <span className="w-[68px]" aria-hidden="true" />
        </header>

        <div className="mt-3 flex gap-2">
          {(["pending", "approved", "rejected"] as PuzzleSubmissionStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusFilter(s);
                setActiveId(null);
              }}
              className={[
                "flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-transform active:scale-95",
                statusFilter === s ? "bg-[#E8B84B] text-[#5C3D0A]" : "bg-white/70 text-[#1A1A2E]/60",
              ].join(" ")}
            >
              {s === "pending" ? "待審核" : s === "approved" ? "已通過" : "已駁回"}
            </button>
          ))}
        </div>

        {message ? (
          <p className="mt-3 rounded-2xl bg-white/80 px-4 py-2 text-center text-xs font-bold text-[#5C3D0A]">
            {message}
          </p>
        ) : null}

        <div className="mt-3 space-y-3">
          {loadState === "loading" ? (
            <p className="py-10 text-center text-xs text-[#1A1A2E]/50">載入中…</p>
          ) : loadState === "error" ? (
            <p className="py-10 text-center text-xs text-[#C0392B]">
              載入失敗。如果是索引錯誤，請到 Firebase Console 依錯誤訊息建立複合索引。
            </p>
          ) : submissions.length === 0 ? (
            <p className="py-10 text-center text-xs text-[#1A1A2E]/50">目前沒有投稿。</p>
          ) : (
            submissions.map((submission) => {
              const isActive = activeId === submission.id;
              let board = null;
              try {
                board = parseFen(submission.fen);
              } catch {
                board = null;
              }

              return (
                <section key={submission.id} className="rounded-3xl bg-white/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-[#1A1A2E]">{submission.studentName}</p>
                    <p className="text-[10px] text-[#1A1A2E]/40">
                      {new Date(submission.submittedAt).toLocaleString("zh-TW")}
                    </p>
                  </div>

                  {submission.note ? (
                    <p className="mt-1 rounded-xl bg-[#FDF6E8] px-3 py-2 text-xs text-[#1A1A2E]/70">
                      💬 {submission.note}
                    </p>
                  ) : null}

                  {board ? (
                    <div className="mt-2 flex justify-center">
                      <div className="w-full max-w-[260px]">
                        <ChessBoard board={board} onMove={() => {}} />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[#C0392B]">局面資料無法解析</p>
                  )}

                  <p className="mt-1 break-all text-[10px] text-[#1A1A2E]/40">FEN：{submission.fen}</p>

                  {submission.status === "approved" ? (
                    <p className="mt-2 text-xs font-bold text-[#5B8C5A]">
                      ✅ 已通過，發放 {submission.awardedFood} 飼料
                    </p>
                  ) : submission.status === "rejected" ? (
                    <p className="mt-2 text-xs font-bold text-[#C0392B]">
                      ❌ 已駁回{submission.rejectReason ? `：${submission.rejectReason}` : ""}
                    </p>
                  ) : !isActive ? (
                    <button
                      type="button"
                      onClick={() => openReview(submission)}
                      className="mt-2 w-full rounded-xl bg-[#E8B84B] px-4 py-2 text-xs font-bold text-[#5C3D0A] shadow-sm transition-transform active:scale-95"
                    >
                      開始審核
                    </button>
                  ) : (
                    <div className="mt-3 space-y-2 border-t border-[#E5DFCB] pt-3">
                      {/* AI 自動判斷：先讓引擎看看紅方有沒有速勝，有的話
                          直接把整條殺法填進答案欄，老師確認就好；沒有的話
                          這個局面本來就不適合當殘局題，建議直接駁回。 */}
                      <div className="rounded-xl bg-[#8B5FBF]/10 px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleVerifyMate(submission)}
                          disabled={isVerifying}
                          className="w-full rounded-xl bg-[#8B5FBF] px-4 py-2 text-xs font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                        >
                          {isVerifying ? "AI 分析中…（約 10 秒）" : "🤖 AI 自動判斷紅方能否速勝"}
                        </button>
                        {verifyResult ? (
                          <p
                            className={[
                              "mt-2 text-xs font-bold",
                              verifyResult.isGood ? "text-[#5B8C5A]" : "text-[#C0392B]",
                            ].join(" ")}
                          >
                            {verifyResult.text}
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-[#1A1A2E]/50">題目難度</label>
                        <select
                          value={level}
                          onChange={(e) => setLevel(Number(e.target.value) as PuzzleLevel)}
                          className={INPUT_CLASS}
                        >
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((lv) => (
                            <option key={lv} value={lv}>
                              Lv{lv}（獎勵 {getSubmissionReward(lv as PuzzleLevel)} 飼料）
                            </option>
                          ))}
                        </select>
                      </div>

                      <p className="rounded-xl bg-[#FDF6E8] px-3 py-2 text-[10px] text-[#1A1A2E]/60">
                        題目名稱會自動命名為「投稿學生的名字＋序號」
                        （例如 {submission.studentName}1、{submission.studentName}2），不用自己填。
                      </p>

                      <div>
                        <label className="text-[10px] font-bold text-[#1A1A2E]/50">題目說明</label>
                        <input
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-[#1A1A2E]/50">
                          正解走法（四字元記法，用空白或換行分隔，例如：h2e2 b9c7）
                        </label>
                        <textarea
                          value={movesText}
                          onChange={(e) => setMovesText(e.target.value)}
                          rows={3}
                          className={`${INPUT_CLASS} resize-none`}
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-[#1A1A2E]/50">
                          其他解法（選填，一行一條完整走法序列；AI 找到多解時會自動填）
                        </label>
                        <textarea
                          value={altLinesText}
                          onChange={(e) => setAltLinesText(e.target.value)}
                          rows={3}
                          placeholder="h2e2 b9c7 e2e6&#10;b0c2 a9a8 c2d4"
                          className={`${INPUT_CLASS} resize-none`}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleApprove(submission)}
                        disabled={isSaving}
                        className="w-full rounded-xl bg-[#5B8C5A] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
                      >
                        {isSaving ? "處理中…" : "✅ 通過並發布題目"}
                      </button>

                      <div className="border-t border-[#E5DFCB] pt-2">
                        <input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="駁回原因（會顯示給學生）"
                          className={INPUT_CLASS}
                        />
                        <button
                          type="button"
                          onClick={() => handleReject(submission)}
                          disabled={isSaving}
                          className="mt-2 w-full rounded-xl bg-[#1A1A2E]/10 px-4 py-2 text-xs font-bold text-[#1A1A2E]/60 transition-transform active:scale-95 disabled:opacity-60"
                        >
                          ❌ 駁回
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setActiveId(null)}
                        className="w-full py-1 text-[10px] text-[#1A1A2E]/40"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}

export default function AdminSubmissionsPage() {
  return (
    <RequireAuth requiredRole="teacher">
      <SubmissionsContent />
    </RequireAuth>
  );
}
