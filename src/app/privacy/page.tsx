/**
 * src/app/privacy/page.tsx
 *
 * 隱私權政策頁面
 * ------------------------------------------------------------
 * Google Play 上架必備：Play Console 的「應用程式內容」表單一定要填
 * 一個隱私權政策網址，這個頁面的網址（https://你的網域/privacy）就是
 * 要填進去的那個連結。內容照這個 App 實際蒐集的資料據實寫，不是
 * 制式範本亂套。
 *
 * 這個頁面不用登入就能看（沒有包在 RequireAuth 裡），因為 Play 商店
 * 審核機器人跟一般訪客都要能直接看到，不能卡在登入頁後面。
 */

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#FDF6E8] px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white/70 px-6 py-8 text-sm leading-relaxed text-[#1A1A2E] shadow-sm">
        <h1 className="text-xl font-extrabold">象棋小雞 隱私權政策</h1>
        <p className="mt-2 text-xs text-[#1A1A2E]/50">最後更新日期：2026 年 7 月</p>

        <section className="mt-6">
          <h2 className="text-base font-bold">我們蒐集哪些資料</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>帳號資訊：註冊時使用的電子郵件、你設定的顯示名稱。</li>
            <li>遊戲資料：解題紀錄、對弈紀錄、飼料與道具、成就勳章、好友清單、聊天訊息等使用本 App 過程中產生的資料。</li>
            <li>裝置推播權杖（Push Token）：如果你開啟推播通知，我們會取得一組裝置代碼，用來發送遊戲內的通知（例如好友邀請、新訊息），我們不會用這組代碼追蹤你在其他 App 或網站的行為。</li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">我們不會做的事</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>不會在 App 內投放廣告。</li>
            <li>不會把你的個人資料出售或提供給第三方行銷使用。</li>
            <li>不會蒐集超出遊戲功能所需以外的資料。</li>
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">資料怎麼儲存</h2>
          <p className="mt-2">
            所有資料儲存在 Google Firebase（Firestore 資料庫與 Authentication 身分驗證服務）上，傳輸過程全程加密（HTTPS）。
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">好友聊天功能</h2>
          <p className="mt-2">
            聊天訊息只有聊天室的雙方看得到，開發者不會主動查看聊天內容，但基於資料庫維運需求，訊息會保存在伺服器上。
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">刪除帳號與資料</h2>
          <p className="mt-2">
            如果你想刪除帳號與相關資料，請寄信到下方聯絡信箱提出申請，我們會在合理時間內處理。
          </p>
        </section>

        <section className="mt-6">
          <h2 className="text-base font-bold">聯絡我們</h2>
          <p className="mt-2">
            有任何隱私權相關問題，歡迎來信：
            <a href="mailto:tengchihchi@gmail.com" className="ml-1 font-bold text-[#8B5FBF] underline">
              tengchihchi@gmail.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
