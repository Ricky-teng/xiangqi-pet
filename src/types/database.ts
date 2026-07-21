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

  /**
   * 累計花費飼料總量（只加不減）。涵蓋餵食、買藥水、商店購買道具、
   * 背景抽獎、解題提示、對戰報名費、飼料復活等所有「主動花掉飼料」
   * 的行為。用來做排行榜的「消費排行」。
   * 注意：這是「花了多少」，不是「淨支出」——抽獎中獎不會因為
   * 「有拿到東西」而不算錢，一樣照花費金額累計。
   * 舊帳號沒有這個欄位時視為 0。
   */
  totalFoodSpent?: number;

  /** 每日救助金：當天飼料低於 50 時發放一次 50 飼料的補助，讓學生
   *  剛好有資格參加作戰（需要 50 飼料）。用 "YYYY-MM-DD" 字串記錄
   *  「上次領救助金的日期」，同一天不重複發。null 代表從未領過。 */
  lastDailyGrantDate: string | null;
  
  // 戰績統計
  stats: {
    // 解題統計
    totalSolved: number;        // 答對題數（解題完成）
    totalAttempts: number;      // 嘗試題數（含答錯）—— 一次通過率 = totalSolved / totalAttempts
    // 對電腦對弈統計
    vsComputerWins: number;     // 贏電腦次數
    vsComputerLosses: number;   // 輸電腦次數
    vsComputerDraws: number;    // 和電腦次數
    // 殘局對戰統計
    battleWins: number;         // 對戰勝場
    battleLosses: number;       // 對戰敗場
    battleDraws: number;        // 對戰平局
    /** @deprecated 從未正確寫入，保留欄位不刪是為了相容舊資料，不要再用 */
    winRate: number;
  };
  
  // 圖鑑系統：已解鎖的特殊小雞外觀 ID 陣列
  unlockedCatalogIds: string[];
  
  // 總轉生次數（真正「回到蛋重新養」的次數，轉職不計入；見 lib/pet/catalog.ts）
  rebirthCount: number;
  
  // 行動裝置推播用的 FCM Token 陣列（可能登入多台裝置）
  fcmTokens: string[];

  /**
   * 商店背包：道具持有數量
   * revival_potion        復活藥水（死亡後保留狀態原地復活，700飼料）
   * double_reward_voucher 雙倍飼料券（30分鐘內解題/對弈獎勵×2，300飼料，每天限購一次）
   * fullness_shield       飽食護盾（3天內飽食度不下降，400飼料）
   */
  inventory?: {
    revival_potion?: number;
    double_reward_voucher?: number;
    fullness_shield?: number;
  };

  /** 目前使用的背景 ID，null 或 undefined = 預設米黃 */
  activeBackground?: string | null;

  /** 雙倍飼料券到期時間戳（ms），null 或過期代表沒有效果 */
  doubleRewardExpiry?: number | null;

  /**
   * 是否已經看過新手教學（教「完全不會下象棋的人」認識棋盤跟每個
   * 棋子的走法，跟遊戲功能操作無關）。
   * 新帳號在 createDefaultUserDoc 會明確設成 false，讓他們第一次
   * 進首頁時觸發全螢幕教學。已存在的舊帳號沒有這個欄位（undefined），
   * 刻意不觸發教學——判斷式用「=== false」而不是「!value」，
   * 這樣 undefined 跟 true 都視為「不用再顯示」，只有明確是 false
   * 才會顯示，避免舊帳號突然被強制看一次教學。
   */
  hasSeenTutorial?: boolean;

  /**
   * 是否已經看過「轉生改轉職」的一次性公告彈窗（見
   * @/components/JobChangeAnnouncementModal.tsx）。
   * 判斷式故意跟 hasSeenTutorial 相反：新帳號在 createDefaultUserDoc
   * 會明確設成 true（沒用過舊轉生機制，不需要看），已存在的舊帳號
   * 沒有這個欄位（undefined）就會顯示一次，看完才寫回 true。
   */
  hasSeenJobChangeAnnouncement?: boolean;

  /**
   * 上次「購買」雙倍飼料券的日期（本地 YYYY-MM-DD，見 getTodayDateString）。
   * 用來限制每天只能買一次，跟 lastDailyGrantDate 是同一套日期比對邏輯。
   * 注意：這是「購買」限制，不是「使用」限制——買了可以先囤著，隔天才用也可以。
   */
  lastDoubleVoucherPurchaseDate?: string | null;

  // ============================================================
  // 好友系統
  // ------------------------------------------------------------
  // 設計上刻意不開新的 Firestore collection，全部欄位都放在使用者
  // 自己的文件上——因為 users 集合的規則是「誰都能讀、只能寫自己」，
  // 「送出邀請」只需要自己寫自己的 outgoingFriendRequestUids（自己
  // 要跟誰交朋友，自己說了算），「收到邀請」則是反過來查詢
  // 「誰的 outgoingFriendRequestUids 裡有我」（array-contains 查詢，
  // 靠讀取權限就能做到，不需要誰來寫我的文件）。
  // 真正會動到「雙方」文件的操作只有「接受邀請」（要同時讓兩邊的
  // friends 陣列都加上對方），這個沒辦法用一般的 client SDK 做到
  // （沒有權限寫別人的文件），所以走 /api/friends/accept 這支用
  // Firebase Admin SDK 的伺服器 API。
  // ============================================================

  /** 好友清單（uid 陣列，雙向：我加了誰、誰接受了我，兩邊都會有對方） */
  friends?: string[];

  /** 我主動送出、還在等對方回應的好友邀請對象（uid 陣列） */
  outgoingFriendRequestUids?: string[];

  /**
   * 我已經讀過/拒絕過、不想再看到的邀請來源（uid 陣列）。
   * 「拒絕」不會通知對方、也不會清掉對方的 outgoingFriendRequestUids
   * （這是刻意的簡化，避免拒絕動作也要跨帳號寫入），只是在我自己
   * 這邊的收件匣把它濾掉。
   */
  dismissedFriendRequestUids?: string[];

  // ============================================================
  // 好友對戰挑戰（同樣是「自己寫自己的文件」+「查詢誰指定了我」
  // 的模式；只有「接受挑戰」需要雙方同時扣飼料+建立房間，走
  // /api/battle/challenge-respond 這支伺服器 API）
  // ============================================================

  /** 我正在挑戰的好友 uid（同時間只能有一個未回應的挑戰） */
  outgoingBattleChallengeUid?: string | null;
  outgoingBattleChallengeSentAt?: number | null;

  /**
   * 我發出的挑戰被接受後，伺服器會把新建立的 battleRoom id 寫回這裡，
   * 我的前端監聽到這個欄位變化就知道要跳轉進對戰房間。
   */
  lastChallengeRoomId?: string | null;

  // ============================================================
  // 好友「配對對弈」挑戰（完整一盤棋，不是殘局對戰）
  // ------------------------------------------------------------
  // 跟上面殘局對戰的戰帖是分開的一套欄位——兩種模式可以同時各自有
  // 一個待處理的戰帖，不會互相卡住。邏輯模式（自己寫自己文件 +
  // 查詢誰指定了我 + 接受時走 Admin API）完全比照殘局對戰戰帖。
  // ============================================================

  /** 我正在挑戰的好友 uid（配對對弈版本，同時間只能有一個未回應的挑戰） */
  outgoingMatchChallengeUid?: string | null;
  outgoingMatchChallengeSentAt?: number | null;
  /** 挑戰時選的棋鐘設定（好友對戰可以自訂，公開配對固定用 15 分+5 秒） */
  outgoingMatchChallengeSettings?: { baseMinutes: number; incrementSeconds: number } | null;
  /** 我發出的配對對弈挑戰被接受後，伺服器把新建立的 chessMatchRoom id 寫回這裡 */
  lastMatchChallengeRoomId?: string | null;

  // ============================================================
  // 推播通知相關
  // ============================================================

  /** 上次發送「小雞餓了/生病了」提醒的時間戳，避免排程一直重複轟炸 */
  lastPetReminderSentAt?: number | null;

  /** 上次發送「每日任務未領」提醒的時間戳 */
  lastTaskReminderSentAt?: number | null;

  /** 已購買的背景 ID 陣列 */
  unlockedBackgrounds?: string[];

  /**
   * 每日任務完成進度（可選欄位：舊帳號沒有這個欄位時，視為「今天還沒
   * 完成任何任務」，見 @/lib/tasks/dailyTasks.ts 的 getTodaysCompletedTaskIds）。
   * date 用本地（瀏覽器所在時區）的 YYYY-MM-DD 字串記錄「上次更新是哪一天」，
   * 跟目前日期不同就代表跨天了，當天的任務全部視為尚未完成，不需要另外
   * 跑排程把舊資料清掉——每次讀取時用日期字串比對即可。
   */
  dailyTaskProgress?: {
    date: string;
    completedTaskIds: string[];
  };

  /**
   * 簽到歷史：每次簽到就 push 當天的 "YYYY-MM-DD" 字串。
   * 月曆用這個陣列渲染哪幾天有簽到的標記。
   */
  checkinHistory?: string[];

  /**
   * 當天對弈電腦局數（用於對弈任務進度追蹤）。
   * 格式：{ date: "YYYY-MM-DD", count: N }
   * 跨天時 date 不同，count 重置為 0。
   */
  dailyVsComputerProgress?: {
    date: string;
    count: number;
  };

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
  
  currentAppearanceId: string | null; // 目前的職業 ID（轉職依序解鎖，見 lib/pet/catalog.ts；null 表示還沒轉職過；死亡重新養會歸零，但不影響圖鑑蒐集紀錄）

  /**
   * 飽食護盾到期時間戳（ms）。使用「飽食護盾」道具後設定為 now + 3 天。
   * 在這個時間之前，petDecay.ts 不會扣飽食度，也不會因為餓而觸發生病。
   * null 或已過期（now >= 此值）代表沒有生效中的護盾。
   */
  fullnessProtectionUntil?: number | null;

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
  
  // 多步殺正解走法序列（主線）
  moves: SolutionSequence;

  /**
   * 替代正解線（可選）：同一個殘局有時不只一種獲勝走法，這裡存其他
   * 同樣能獲勝的完整走法序列。沒有這個欄位、或是空陣列時，視為
   * 只有 moves 這一條正解（完全相容舊資料，不會讓既有題目壞掉）。
   *
   * 【重要】型別是 { moves: SolutionSequence }[]，不是 SolutionSequence[]
   * （也就是不是直接的 string[][]）。原因：Firestore 不支援「陣列裡面
   * 直接放陣列」（nested arrays），如果直接存 string[][]，setDoc() 會
   * 直接拋出執行期錯誤「Nested arrays are not supported」，整個發布
   * 會失敗。把每條替代線包進一個物件（{ moves: [...] }）就能避開這個
   * 限制——Firestore 允許「陣列裡面放物件，物件裡面放陣列」，只是不能
   * 「陣列裡面直接放陣列」。
   */
  alternativeLines?: { moves: SolutionSequence }[];

  totalSteps: number; // 總步數 (等於 moves.length，替代線長度可以不同)
  
  createdBy: string;    // 出題老師的 uid
  isPublished: boolean; // 是否公開發充給學生
  
  createdAt: number;
  updatedAt: number;
}

/**
 * 4. 每日任務文件 (路徑: dailyTasks/{taskId})
 * ------------------------------------------------------------
 * 之前是寫死在程式碼裡的 DAILY_TASK_DEFINITIONS 固定陣列，老師沒辦法
 * 自己新增/編輯/刪除任務。現在改成跟 PuzzleDoc 一樣存在 Firestore，
 * 老師透過 /admin/tasks 後台管理，學生端從這個 collection 動態讀取。
 */
export type DailyTaskType = "checkin" | "vs_computer";

export interface DailyTaskDoc {
  id: string;
  /** 任務類型：checkin = 簽到，vs_computer = 當天對弈電腦 N 局 */
  taskType: DailyTaskType;
  title: string;
  description: string;
  icon: string;
  rewardFood: number;
  /**
   * 任務完成門檻（僅 vs_computer 有意義）：
   * vs_computer：當天對弈幾局才算完成，預設 1
   * checkin：固定 1，不用設定
   */
  requiredCount: number;
  isActive: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * 5. 對弈電腦紀錄 (路徑: users/{uid}/vsComputerGames/{gameId})
 * ------------------------------------------------------------
 * 每打完一局（贏/輸/和都算）就寫一筆，給老師後台查閱用。fenHistory
 * 存「每一步之後的局面」（第一個元素是開局），回放時直接讀取顯示，
 * 不需要老師端重新載入規則引擎重算。
 */
export interface VsComputerGameDoc {
  id: string;
  studentUid: string;
  opponentLevel: PuzzleLevel; // 這局挑戰的電腦難度等級
  studentLevelAtPlay: PuzzleLevel; // 下棋當時學生自己的等級快照（避免之後老師改等級，歷史紀錄對不起來）
  outcome: "win" | "lose" | "draw";
  foodDelta: number; // 這局實際獲得/扣除的飼料數量
  moveHistory: string[]; // 走法記號列表，依序
  fenHistory: string[]; // 每一步之後的局面 FEN，跟 moveHistory 等長，依序對應
  playedAt: number;
}

/**
 * 6. 作戰配對隊列 (路徑: matchmakingQueue/{uid})
 * ------------------------------------------------------------
 * 學生進入等待室時寫入，配對成功或離開後刪除。
 */
export interface MatchmakingQueueEntry {
  uid: string;
  displayName: string;
  chessLevel: number;
  joinedAt: number;
  /** 已被配對到的房間 ID，null 代表還在等待中 */
  roomId: string | null;
}

/**
 * 7. 作戰房間 (路徑: battleRooms/{roomId})
 * ------------------------------------------------------------
 * 配對成功後建立，整場對戰的狀態都存在這裡。
 */
export type BattleRoomStatus =
  | "waiting"   // 等待第二位玩家加入
  | "playing"   // 對戰進行中
  | "finished"; // 對戰結束

export interface BattlePlayerState {
  displayName: string;
  chessLevel: number;
  /** 目前這一題有沒有解出來（或時間到算輸） */
  solved: boolean;
  /** 解題花費毫秒數（未解出時為 null） */
  timeMs: number | null;
}

export interface BattleRoomDoc {
  roomId: string;
  status: BattleRoomStatus;
  /** key 是玩家 uid */
  players: Record<string, BattlePlayerState>;
  /** 10 個 puzzleId，從 Lv.1-5 隨機抽 */
  questions: string[];
  /** 目前第幾題（0-indexed） */
  currentQuestion: number;
  /** 這一題的開始時間戳記（ms），用來算計時 */
  questionStartTime: number;
  /** 各玩家累積答對題數，key 是 uid */
  scores: Record<string, number>;
  /** 各玩家累積答對的總時間（毫秒），key 是 uid；只累計答對的題目的時間，
   *  答錯/超時不計。平局時比較這個欄位，時間短的贏。
   *  Optional 是因為舊有 battleRoom 文件沒有這個欄位，程式碼用 ?. 讀取。 */
  totalSolveTimeMs?: Record<string, number>;
  /** 對戰結束時的贏家 uid，平局為 null；對戰還沒結束時也是 null（靠 status 判斷是否結束） */
  winner: string | null;
  createdAt: number;
}

/**
 * 8. 配對對弈佇列 (路徑: chessMatchQueue/{uid})
 * ------------------------------------------------------------
 * 「配對對弈」是下一整盤真正的棋（不是殘局解謎），學生進入等待室時
 * 寫入，配對成功或離開後刪除。跟 matchmakingQueue（殘局作戰用）是
 * 完全獨立的兩套佇列，因為房間資料結構差很多（棋鐘、完整局面歷史
 * vs 題目清單、單題計分），混在一起反而更亂。
 */
export interface ChessMatchQueueEntry {
  uid: string;
  displayName: string;
  chessLevel: number;
  joinedAt: number;
  roomId: string | null;
}

/** 配對對弈的結束原因 */
export type ChessMatchEndReason =
  | "checkmate"      // 將死
  | "stalemate"      // 困斃（無子可動但沒被將軍，算和棋）
  | "resign"         // 認輸
  | "timeout"        // 棋鐘用完
  | "draw_agreement" // 雙方同意和棋
  | "draw_rule";     // 引擎判定的其他和棋規則（例如長將/長捉/回合數上限）

export interface ChessMatchPlayerInfo {
  uid: string;
  displayName: string;
  chessLevel: number;
}

/**
 * 9. 配對對弈房間 (路徑: chessMatchRooms/{roomId})
 * ------------------------------------------------------------
 * 棋鐘採用「費雪制」（Fischer increment）：每人一開始有 baseMs，每走
 * 完一步、輪到自己走的那段時間扣掉之後，加回 incrementMs。
 *
 * 計時方式是純前端算的（沒有後端排程一直在跑），lastMoveAt 記錄「最後
 * 一次有人動作（開局或走完一步）的時間戳」，誰的回合誰的棋鐘就從這個
 * 時間點開始倒數；雙方瀏覽器都會各自算，任何一方偵測到「現在輪到走的
 * 那方時間已經用完」，就由偵測到的那個人的瀏覽器負責寫入
 * status: "finished"、winner、endReason: "timeout"（不是一定要輪到走
 * 的那方自己認輸，對手的瀏覽器一樣會偵測到並幫忙結算，避免有人拖網路
 * 或關頁面卡住不結算）。
 */
export interface ChessMatchRoomDoc {
  roomId: string;
  status: "playing" | "finished";
  red: ChessMatchPlayerInfo;
  black: ChessMatchPlayerInfo;
  /** 目前局面（這個 App 格式的 FEN，不含輪走方，輪走方看 sideToMove） */
  fen: string;
  sideToMove: "w" | "b";
  /** 走法記號歷史，依序（例如 ["h2e2", "h7e7", ...]） */
  moveHistory: string[];
  /** 每一步之後的局面，跟 moveHistory 等長，第一個元素是開局前的起始局面 */
  fenHistory: string[];
  /** 雙方棋鐘剩餘毫秒數（是「上次動作當下」的剩餘量，不是即時值，
   *  即時剩餘要用 lastMoveAt 前端自己算） */
  clockRedMs: number;
  clockBlackMs: number;
  /** 費雪制每步加秒數（毫秒） */
  incrementMs: number;
  /** 最後一次動作（開局／走完一步）的時間戳，用來算目前這步經過多久 */
  lastMoveAt: number;
  /** 有人提和棋的話，這裡是提議人的 uid；沒有提議中的和棋則是 null */
  drawOfferBy: string | null;
  /** 贏家 uid，和局是 null；對局還沒結束時也是 null（靠 status 判斷） */
  winner: string | null;
  endReason: ChessMatchEndReason | null;
  createdAt: number;
  updatedAt: number;
}
