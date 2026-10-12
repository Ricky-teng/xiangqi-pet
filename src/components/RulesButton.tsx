// src/components/RulesButton.tsx
"use client";

/**
 * 「❓ 規則」按鈕 ＋ 說明彈窗
 * ------------------------------------------------------------
 * 探險、戰隊、物品（裝備）三頁共用。新手強制教學只教到「打完第一關」
 * 就放手，合成跟戰隊都沒教，所以每一頁都要有地方隨時查規則。
 *
 * 規則文字集中在這個檔案（RULES 常數），改規則只要改這裡，不用去翻
 * 三個頁面。
 */

import { useState } from "react";

export type RulesTopic = "explore" | "team" | "equipment";

interface RuleSection {
  title: string;
  lines: string[];
}

const RULES: Record<RulesTopic, { title: string; sections: RuleSection[] }> = {
  explore: {
    title: "🗺️ 探險規則",
    sections: [
      {
        title: "怎麼打",
        lines: [
          "一次只能派 1 隻小雞，那隻必須有武器。",
          "共 10 座塔，每座 10 關。要照順序打，通關某座塔的第 10 關才會解鎖下一座塔。",
          "怪物一隻一隻出來，打倒一隻會回復最大體力的 30%，每一關開始時回滿。",
          "每一關最後都有一隻 Boss，體力是小怪的 5 倍。",
        ],
      },
      {
        title: "次數",
        lines: [
          "每天 10 次，台北時間 00:00 重置。",
          "輸贏都會扣 1 次。",
          "已經通關過的關卡重打不扣次數，但什麼都不會掉。",
        ],
      },
      {
        title: "掉寶",
        lines: [
          "只有第一次通關才會掉裝備，掉 2 件第 1 階（武器或防具隨機）。",
          "背包滿了的話多出來的會直接消失，記得先去合成或擴充背包。",
          "探險不會掉飼料。",
        ],
      },
      {
        title: "打輸了怎麼辦",
        lines: [
          "打輸不會死，也沒有任何懲罰，只是這一關沒過。",
          "結算畫面會直接告訴你是攻擊不夠還是撐不住，照著補裝備就好。",
        ],
      },
    ],
  },
  team: {
    title: "⚔️ 戰隊規則",
    sections: [
      {
        title: "編隊",
        lines: [
          "最多派 3 隻小雞，1 隻也能上。",
          "整隊只要至少一隻有武器就能出戰（跟探險不一樣）。",
          "同一隻小雞可以同時用在探險跟戰隊。",
          "在下面的收藏網格長按小雞，拖到上面的空位就能上陣。",
        ],
      },
      {
        title: "挑戰",
        lines: [
          "從排行榜挑對手，每天 5 次（台北時間 00:00 重置）。",
          "對手不用上線，電腦會用他被挑戰當下的即時狀態自動打。",
          "被挑戰的人不會加分也不會扣分，也不會收到通知。",
          "六隻同時上場混戰，一方全倒就結束。",
        ],
      },
      {
        title: "積分",
        lines: [
          "挑戰排名比自己高的人，贏了加比較多分、輸了扣比較少。",
          "挑戰排名比自己低的人，贏了只加一點點、輸了扣很多。",
          "分數不會變成負的，扣到 0 就停。",
          "每一列的「+N / −M」就是這場贏了加幾分、輸了扣幾分。",
        ],
      },
      {
        title: "賽季",
        lines: [
          "每個月 1 號台北時間 00:00 結算，積分歸零重新開始。",
          "前三名分別拿 3000 / 2000 / 1000 飼料。",
          "跟上個月比，名次每進步 1 名多拿 20 飼料，最多 200。",
          "獎勵會直接入帳，下次開 App 會跳通知。",
        ],
      },
    ],
  },
  equipment: {
    title: "⚔️ 裝備規則",
    sections: [
      {
        title: "買跟合成",
        lines: [
          "商店只賣第 1 階，武器跟防具各 100 飼料。",
          "3 件同階同類型可以合成 1 件高一階的，必定成功、不用額外花飼料。",
          "武器跟防具不能互相合成。",
          "一件第 5 階等於 81 件第 1 階，是長期目標。",
        ],
      },
      {
        title: "穿裝備",
        lines: [
          "每隻小雞有武器、防具各一個欄位，可以隨時卸下換給別隻。",
          "武器加攻擊，防具加防禦跟體力。",
          "裝備不能賣回。",
          "到「🐣 我的小雞」點裝備格就能換。",
        ],
      },
      {
        title: "背包",
        lines: [
          "背包一開始 50 格，一件裝備佔一格。",
          "畫面上同階同類型會折疊成一格顯示，但格數還是照件數算。",
          "花 1000 飼料可以 +20 格，沒有次數上限。",
        ],
      },
    ],
  },
};

export default function RulesButton({ topic, variant = "light" }: { topic: RulesTopic; variant?: "light" | "dark" }) {
  const [open, setOpen] = useState(false);
  const rules = RULES[topic];

  return (
    <>
      {variant === "dark" ? (
        // 深色頁首（RPG 區）用的版本：方形圖示鈕，跟旁邊的次數徽章同高
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white/85 ring-1 ring-white/15 transition-transform active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          aria-label="查看規則"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9.5" />
            <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 3.8" />
            <circle cx="12" cy="17.3" r="0.6" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-[#1A1A2E]/5 px-2.5 py-1 text-[11px] font-bold text-[#1A1A2E]/60 transition-transform active:scale-95"
          aria-label="查看規則"
        >
          ❓ 規則
        </button>
      )}

      {open ? (
        <div className="fixed inset-0 z-[85] flex items-end bg-black/65" onClick={() => setOpen(false)}>
          <div
            className="rules-sheet max-h-[78vh] w-full overflow-y-auto rounded-t-[28px] px-5 pb-8 pt-4"
            style={{
              background: "linear-gradient(180deg,#221F48 0%,#0E0D1E 100%)",
              boxShadow: "0 -1px 0 rgba(245,197,66,0.5), 0 -20px 40px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={rules.title}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <h3 className="text-center">
              <span
                className="fx-text text-[20px] font-black"
                data-text={rules.title}
                style={
                  {
                    ["--fx-fill" as string]: "linear-gradient(180deg,#FFFFFF 5%,#FFE58A 50%,#E8A912 100%)",
                    ["--fx-stroke" as string]: "5px",
                    ["--fx-stroke-color" as string]: "#1A1206",
                  } as React.CSSProperties
                }
              >
                {rules.title}
              </span>
            </h3>

            <div className="mt-4 flex flex-col gap-2.5">
              {rules.sections.map((section) => (
                <section key={section.title} className="rounded-2xl bg-white/[0.06] px-3.5 py-3 ring-1 ring-white/10">
                  <p className="flex items-center gap-1.5 text-[13px] font-black text-[#FFE58A]">
                    <span className="block h-1.5 w-1.5 rotate-45 bg-[#F5C542]" />
                    {section.title}
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {section.lines.map((line) => (
                      <li key={line} className="text-[12px] leading-relaxed text-white/75">
                        ・{line}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <button type="button" onClick={() => setOpen(false)} className="btn-gold mt-5 w-full rounded-2xl px-4 py-3 text-sm font-black">
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
