/**
 * src/components/PetCommentary.tsx
 *
 * 小雞在解題/對戰/對弈頁面旁邊的即時講話元件
 * ------------------------------------------------------------
 * 使用方式：
 *   <PetCommentary trigger={trigger} lines={lines} />
 *
 * trigger 每次換新值（或從 null 變成任意值）就會觸發顯示一句話，
 * 從 lines 陣列隨機挑一句，顯示 3 秒後自動消失。
 * lines 是空陣列時元件靜默不動作（佔位不佔空間）。
 */

"use client";

import { useEffect, useState } from "react";
import { getPetImagePath } from "@/lib/pet/petImagePath";

export type PetCommentaryTrigger =
  | { kind: "correct" }       // 解題答對
  | { kind: "wrong" }         // 解題答錯
  | { kind: "score"; cp: number } // 對弈局面分數（正=紅優，負=黑優）
  | { kind: "battle" }        // 殘局對戰進場
  | null;

export interface PetCommentaryLines {
  correct: string[];     // 解題答對時說的話
  wrong: string[];       // 解題答錯時說的話
  advantage: string[];   // 對弈分析：我方優勢時說的話
  disadvantage: string[]; // 對弈分析：我方劣勢時說的話
  balanced: string[];    // 對弈分析：局面平衡時說的話
  battle: string[];      // 殘局對戰進場時說的話
}

/** 台詞組 */
export const EMPTY_COMMENTARY_LINES: PetCommentaryLines = {
  correct: [
    "只要有心，人人都可以是棋神。",
    "真相只有一個！",
    "領域展開！",
    "安西教練，我想下棋。",
    "想像力就是我的超能力。",
    "好東西要和好朋友分享。",
    "說我帥，太沉重！",
    "今年是五倍的恩典，信小雞得鑽石！",
    "以我爺爺的名義發誓！",
    "你成功引起我的注意。",
    "各位觀眾，五支菸！窩邀煙拍！給我擦皮鞋！",
    "已購買，小孩愛吃。",
  ],
  wrong: [
    "我讀書少，你不要騙我。",
    "臣妾做不到呀！",
    "一頓操作猛如虎，一看比分零比五。",
    "本來應該從從容容、游刃有餘。現在是匆匆忙忙、連滾帶爬！",
    "不出意外的話馬上要出意外了。",
    "完了，芭比Q了。",
    "阿姨，我不想努力了。",
    "那畫面太美，我不敢看。",
    "當時的我害怕極了。",
    "這不是逃跑，這是戰術性後撤。",
    "可憐哪。",
    "還好我兩個兒子一個有出息。",
    "這不是肯德雞！這不是肯德雞！",
  ],
  advantage: [
    "我不是針對你，我是說在座的各位都是垃圾。",
    "我這輩子最討厭別人用「車」指著我的「帥」！",
    "我要看到血流成河！",
    "收手吧阿祖，外面全是警察。",
    "裁判，可以讓人這樣打了又打嗎？",
    "你不要這麼專業好不好。",
    "我是鎧之小雞，他是超大型小雞。",
    "喜歡嗎？爸爸買給你！",
    "那個斌斌就是遜啦！",
    "憑你的智慧，我很難跟你解釋。",
    "我看你是完全不懂喔。",
  ],
  disadvantage: [
    "不能逃！不能逃！不能逃！",
    "究竟是命運的安排，還是造化弄人？",
    "你是忘記了，還是害怕想起來？",
    "出來混，遲早要還的。",
    "賤人就是矯情。",
    "QQㄋㄟㄋㄟ好喝到咩噗茶！",
    "回答我！Look in my eyes！",
    "杰哥不要！",
    "他只是個孩子啊！",
    "我忘了繃帶的綁法了。",
    "大師兄嬌喘一聲，倒在何金銀的懷裡。",
    "阿嬤妳怎麼沒感覺？",
  ],
  balanced: [
    "觀棋不語真君子，但我是隻雞。",
    "你有看過凌晨四點的象棋盤嗎？我沒有。",
    "既然你誠心誠意的發問了！那我就大發慈悲的告訴你。",
    "你為什麼不問問神奇海螺呢？",
    "小孩子才做選擇，我全都要。",
    "來都來了。",
    "只要你不尷尬，尷尬的就是別人。",
    "大腦是很好的東西，希望你也有一個。",
    "尊嘟假嘟？你要確欸？",
    "不管你怎麼想，總之我是信了。",
    "科技始終來自於人性。",
    "我跳進去了！我跳出來了！打我啊，笨蛋！",
    "這是義大利設計師Sit Down Please設計的。",
    "一定iPad溫開水！喝咖啡吃甜食，又讓你胃食道逆流了嗎？",
    "小心點，不要踩到花花草草。",
  ],
  battle: [
    "我要代替月亮來懲罰你！",
    "抱歉了對手，但我需要那個酷東西。",
    "你還是回火星吧！",
    "孩子們準備好了沒？",
    "我是什麼很賤的人嗎？",
    "斷開魂結！斷開鎖鏈！燒毀！",
    "萊納，你坐呀！",
    "大俠愛吃漢堡包，你不是大俠吃香蕉。",
    "我最討厭直覺敏銳的小雞。",
    "我話說完，誰贊成？誰反對？",
    "娘子，快跟牛魔王出來看上帝！",
    "臣妾要告發熹貴妃私通。",
    "要打去練舞室打！",
    "露比醬～嗨！",
  ],
};

function pickRandom(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

function resolveLine(trigger: PetCommentaryTrigger, lines: PetCommentaryLines): string | null {
  if (!trigger) return null;
  switch (trigger.kind) {
    case "correct":     return pickRandom(lines.correct);
    case "wrong":       return pickRandom(lines.wrong);
    case "battle":      return pickRandom(lines.battle);
    case "score": {
      const cp = trigger.cp;
      if (cp > 150)  return pickRandom(lines.advantage);
      if (cp < -150) return pickRandom(lines.disadvantage);
      return pickRandom(lines.balanced);
    }
  }
}

interface PetCommentaryProps {
  stage: string;
  healthStatus: string;
  trigger: PetCommentaryTrigger;
  lines: PetCommentaryLines;
}

export function PetCommentary({ stage, healthStatus, trigger, lines }: PetCommentaryProps) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!trigger) return;
    const line = resolveLine(trigger, lines);
    if (!line) return;

    setText(line);
    const timer = setTimeout(() => setText(null), 3500);
    return () => clearTimeout(timer);
  // trigger 換新物件參照就重新觸發，所以用 JSON.stringify 比較內容
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(trigger)]);

  return (
    <div className="flex items-end gap-2 rounded-2xl bg-white/60 px-3 py-2 shadow-sm">
      {/* 小雞縮圖 */}
      <img
        src={getPetImagePath(stage, healthStatus)}
        alt="小雞"
        className="h-12 w-12 shrink-0 object-contain"
      />
      {/* 對話框 */}
      <div className="relative min-h-[2.5rem] flex-1">
        {text ? (
          <div className="rounded-2xl rounded-bl-none bg-[#1A1A2E] px-3 py-2 text-xs font-semibold text-white shadow-md">
            {text}
          </div>
        ) : (
          <div className="rounded-2xl rounded-bl-none bg-[#1A1A2E]/10 px-3 py-2 text-xs text-[#1A1A2E]/30">
            …
          </div>
        )}
      </div>
    </div>
  );
}
