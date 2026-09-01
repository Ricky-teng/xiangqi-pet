/**
 * src/app/api/pasture/join/route.ts
 *
 * 牧場分配：學生第一次進 /pasture 頁面時呼叫一次，把他分配到一間
 * 「還有名額」的牧場（見 PastureDoc 的說明）。之後永久固定在這間牧場，
 * 這支 API 對同一個人重複呼叫是安全的（已經分配過的話直接回傳既有
 * pastureId，不會重複加入或建立新牧場）。
 * ------------------------------------------------------------
 * 用 Firestore transaction 包住「查詢有名額的牧場 + 加入 + 更新
 * memberCount」這整段，避免兩個學生剛好同時加入同一間牧場，各自都
 * 讀到「還有名額」，結果兩個人一起塞進去讓這間牧場超過
 * MAX_PASTURE_MEMBERS——transaction 會保證這整段「讀取判斷 + 寫入」
 * 是原子性的，後面的請求如果讀到的資料已經過期會自動重試。
 */

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { verifyRequestAuth, AuthError } from "@/lib/server/verifyAuth";
import { getAdminDb } from "@/lib/server/firebaseAdmin";
import { MAX_PASTURE_MEMBERS } from "@/lib/pasture";

export async function POST(request: Request) {
  let uid: string;
  try {
    uid = await verifyRequestAuth(request);
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  try {
    const db = getAdminDb();
    const userRef = db.collection("users").doc(uid);

    // 已經分配過的話，直接回傳既有結果，不用進 transaction
    const existingUserSnap = await userRef.get();
    const existingPastureId = existingUserSnap.data()?.pastureId as string | undefined;
    if (existingPastureId) {
      return NextResponse.json({ pastureId: existingPastureId });
    }

    const pastureId = await db.runTransaction(async (transaction) => {
      const candidatesSnap = await transaction.get(
        db.collection("pastures").where("memberCount", "<", MAX_PASTURE_MEMBERS).limit(1)
      );

      const now = Date.now();

      if (!candidatesSnap.empty) {
        const pastureRef = candidatesSnap.docs[0].ref;
        const pastureData = candidatesSnap.docs[0].data();
        // 防呆：萬一這個人已經在名單裡（理論上不會，但避免重複呼叫時
        // 把自己的 uid 塞兩次進 memberUids）
        if (!(pastureData.memberUids as string[]).includes(uid)) {
          transaction.update(pastureRef, {
            memberUids: FieldValue.arrayUnion(uid),
            memberCount: FieldValue.increment(1),
          });
        }
        transaction.update(userRef, { pastureId: pastureRef.id, updatedAt: now });
        return pastureRef.id;
      }

      // 沒有還有名額的牧場，開一間新的
      const newPastureRef = db.collection("pastures").doc();
      transaction.set(newPastureRef, {
        id: newPastureRef.id,
        memberUids: [uid],
        memberCount: 1,
        createdAt: now,
      });
      transaction.update(userRef, { pastureId: newPastureRef.id, updatedAt: now });
      return newPastureRef.id;
    });

    return NextResponse.json({ pastureId });
  } catch (error) {
    console.error("[api/pasture/join] 分配牧場失敗：", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分配牧場時發生未知錯誤。" },
      { status: 500 }
    );
  }
}
