# RPG 擴充：Firestore 規則與索引（要手動貼到 Firebase Console）

專案的安全規則是在 Firebase Console 上管理的，不在 repo 裡，所以這一份是
「要新增哪幾段」的清單，**不是完整的規則檔**。把下面的區塊加進現有的
`match /databases/{database}/documents { ... }` 裡面。

---

## 1. 安全規則

```js
// ============================================================
// RPG 擴充
// ============================================================

// 收藏小雞：自己完全可讀寫。
// 別人也要能「讀」——戰隊對戰要用對手被挑戰當下的即時狀態，
// 必須讀得到他上場那幾隻的職業、生病次數、裝備。
match /users/{uid}/collectedPets/{petId} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == uid;
}

// 探險進度：只有自己看得到、自己寫。別人沒有理由知道你打到第幾塔。
match /users/{uid}/rpg/{docId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}

// 待通知（賽季獎勵）：只有自己讀，自己看完刪掉。
// 寫入是後端 cron 用 Admin SDK 做的，Admin SDK 不受規則限制，
// 所以這裡不用開 create 給前端。
match /users/{uid}/pendingNotices/{noticeId} {
  allow read, delete: if request.auth != null && request.auth.uid == uid;
  allow create, update: if false;
}

// 戰隊：全部公開可讀（排行榜、對手隊伍本來就要看得到），只能寫自己的。
match /teams/{uid} {
  allow read: if request.auth != null;
  allow write: if request.auth != null && request.auth.uid == uid;
}

// 賽季結算紀錄：大家都能看歷史名次，只有後端能寫。
match /seasons/{seasonId} {
  allow read: if request.auth != null;
  allow write: if false;
}
```

### ⚠️ 一個已知的限制

Firestore **沒有欄位級的安全規則**，所以「學生只能改自己戰隊的某些欄位」
做不到——`allow write: if request.auth.uid == uid` 等於學生可以把自己的
`score` 直接改成 9999。

目前接受這個風險，理由：

- 這是班級內部使用的教學 App，不是公開遊戲
- 要作弊得會開 DevTools 打 Firestore SDK，門檻遠高於這個年齡層
- 真的發生的話老師看排行榜一眼就會發現（分數會離譜到不合理）

如果之後要堵起來，做法是把「挑戰結算」搬到一支 API route 用 Admin SDK
寫入，前端只負責播放動畫；那時候 `teams/{uid}` 的 write 就可以整個關掉。

---

## 2. 複合索引

排行榜的查詢是 `where("seasonId", "==", ...) + orderBy("score", "desc")`，
Firestore 需要一個複合索引。第一次跑到這個查詢時 Console 會跳出一個
「建立索引」的連結，點下去就好；或是先手動建：

| Collection | 欄位 1 | 欄位 2 |
|---|---|---|
| `teams` | `seasonId`（Ascending） | `score`（Descending） |

賽季結算的 cron 另外用了 `where("seasonId","==") + where("score",">",0)`，
這個用同一個索引就可以了。

`users/{uid}/collectedPets` 只有 `orderBy("collectedAt","desc")`，單欄位
索引 Firestore 會自動建，不用手動處理。

---

## 3. Vercel 環境變數

賽季結算的 cron 沿用既有的 `CRON_SECRET`，不用新增環境變數。

`vercel.json` 已經加好第二個 cron：

```json
{ "path": "/api/cron/season", "schedule": "0 16 * * *" }
```

**為什麼是每天跑一次**：賽季要在台北時間每月 1 號 00:00 換，換算成 UTC
是「上個月最後一天的 16:00」。Vercel 的 cron 不支援 `L`（月底），所以改成
每天 UTC 16:00 叫一次，程式自己判斷台北時間是不是 1 號——不是的話第一個
檢查就直接返回，幾乎不花資源。

結算本身是冪等的（會先檢查 `seasons/{seasonId}` 存不存在），重複觸發不會
重複發獎。要手動補跑某一季可以加 `?force=1`。
