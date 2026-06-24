// src/types/database.ts
import { PuzzleLevel, SolutionSequence } from "./xiangqi";

/**
 * 1. 使用者文件 (路徑: users/{uid})
 */
export interface UserDoc {
  uid: string;
  displayName: string;
  role: "student" | "teacher" | "system";
  
  // 學生目前的象棋等級 (1-10 級)
  chessLevel: PuzzleLevel;
  
  // 核心資源
  foodCount: number; // 飼料庫存數量
  
  // 體力值系統
  stamina: {
    current: number;        // 當前體力
    max: number;            // 體力上限（預設 40）
    lastRefillTime: number; // 上次自動回復體力的時間戳記 (milliseconds)
  };
  
  // 戰績統計
  stats: {
    totalSolved: number;   // 總共成功解題數
    totalAttempts: number; // 總共嘗試答題次數（包含答錯）
    winRate: number;       // 答題正確率 / 勝率 (0 ~ 100)
  };
  
  // 圖鑑系統：已解鎖的特殊小雞外觀 ID 陣列
  unlockedCatalogIds: string[];
  
  // 總轉生次數
  rebirthCount: number;
  
  // 行動裝置推播用的 FCM Token 陣列（可能登入多台裝置）
  fcmTokens: string[];
  
  createdAt: number; // 帳號建立時間
  updatedAt: number; // 資料更新時間
}

/**
 * 子集合：已解題目記錄 (路徑: users/{uid}/solvedPuzzles/{puzzleId})
 * 用於防刷獎勵機制。如果存在此紀錄，代表該題拿過飼料了。
 */
export interface SolvedPuzzleRecord {
  puzzleId: string;
  solvedAt: number; // 答對時間戳記
  
  // 【工程師額外加的防弊快照】
  // 記錄解題當下題目與使用者的等級，避免事後老師改等級導致歷史獎勵對不起來
  puzzleLevelAtSolve: PuzzleLevel;
  userLevelAtSolve: PuzzleLevel;
  
  earnedFood: number; // 當時獲得的飼料量

  /**
   * 這次解題（從進入題目到答對最後一步）總共答錯的次數。
   * 給老師監控後台用：可以看出這個學生這道題卡了多久才解出來。
   */
  wrongAttemptsBeforeSolving: number;
}

/**
 * 2. 電子雞文件 (路徑: pets/{uid})
 * 使用 uid 當作文件 ID，與 users 一對一綁定，方便查詢
 */
export type PetStage = "egg" | "chick" | "teen" | "master";
export type PetHealthStatus = "normal" | "slightly_sick" | "severely_sick" | "dead";

export interface PetDoc {
  uid: string; // 擁有者的 uid
  
  stage: PetStage; // 成長階段："egg"(蛋), "chick"(雛雞), "teen"(青年雞), "master"(大師雞)
  xp: number;       // 當前階段累積的生命經驗值 (餵 10 飼料 = +10 XP)
  fullness: number; // 飽食度 (0 ~ 100，每 4 小時自動 -5)
  
  healthStatus: PetHealthStatus; // 健康狀態："normal"(正常), "slightly_sick"(生小病), "severely_sick"(生大病), "dead"(死掉)
  
  // 生病觸發判定器
  currentWrongPuzzleId: string | null; // 目前正在卡關的題目 ID
  consecutiveWrongCount: number;       // 同一題連續答錯次數（達到 3 次立刻變生小病）
  
  // 關鍵計時時間戳記 (Epoch ms) -> 供 Vercel Cron 排程計算時間差
  lastFedTime: number;                // 上次餵食時間（用來算飽食度扣多少）
  sickStartTime: number | null;       // 開始生小病的時間點（過 4 小時未醫治則變大病）
  severeSickStartTime: number | null; // 開始生大病的時間點（過 4 小時未醫治則死掉）
  
  // 離線推播發送旗標（發過就變 true，避免 Cron 重複推播疲勞轟炸）
  notifiedFlags: {
    lowFullness: boolean;  // 飽食度 < 20 警告
    slightlySick: boolean; // 生小病通知
    severelySick: boolean; // 變大病(病危)通知
    dead: boolean;         // 确认死亡通知
  };
  
  currentAppearanceId: string | null; // 當前穿戴的小雞特殊外觀 ID (轉生解鎖獲得)
  
  createdAt: number;
  updatedAt: number;
}

/**
 * 3. 殘局題目文件 (路徑: puzzles/{puzzleId})
 */
export interface PuzzleDoc {
  id: string;
  level: PuzzleLevel; // 題目難度 (1-10)
  title: string;      // 題目標題（例如：馬後炮絕殺）
  description: string; // 題目提示或敘述
  
  // 初始盤面：採用業界標準 FEN 字串儲存（Firestore不適合存二維陣列）
  initialFen: string;
  
  // 多步殺正解走法序列
  moves: SolutionSequence;
  
  totalSteps: number; // 總步數 (等於 moves.length)
  
  createdBy: string;    // 出題老師的 uid
  isPublished: boolean; // 是否公開發充給學生
  
  createdAt: number;
  updatedAt: number;
}
