-- ==========================================
-- SQL 語句 (純淨版，可直接拷貝執行)
-- ==========================================

CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT
);

CREATE TABLE IF NOT EXISTS admins (
    user_id TEXT PRIMARY KEY,
    note TEXT
);

CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id TEXT PRIMARY KEY,
    is_active INTEGER DEFAULT 1,
    guidelines TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO system_configs (key, value, description) VALUES 
('OPENAI_MODEL', 'gpt-5.4-nano', '使用的 OpenAI 模型'),
('OPENAI_TEMPERATURE', '1.0', 'OpenAI 採樣溫度 (0.0-2.0)'),
('OPENAI_MAX_TOKENS', '2000', '回應最大 Token 數 (GPT-5 包含推理量)'),
('OPENAI_REASONING_EFFORT', 'none', '推理強度 (none, low, medium, high, xhigh)'),
('HISTORY_LIMIT', '0', '保留最近幾筆對話作為上下文'),
('DEFAULT_GUIDELINE', '將輸入訊息翻譯為以下語言，每一種語言換一行：\n【zh-TW】翻譯內容\n【ja】翻譯內容\n【fr】翻譯內容\n【en】翻譯內容\n僅執行翻譯，直接輸出結果，不准進行深度思考。', '全域預設指令'),
('SAVE_CHAT_HISTORY', '1', '是否將對話紀錄存入 D1 資料庫 (1: 是, 0: 否)'),
('ENABLE_DEBUGGING', '1', '是否開啟詳細偵錯日誌 (1: 是, 0: 否)');

-- ==========================================
-- 欄位說明與註解 (放在下方，不影響上方拷貝)
-- ==========================================
-- 1. system_configs: 系統全域設定表
-- 2. admins: 管理者權限表
-- 3. chat_sessions: 對話群組 / 個人狀態表
--    - session_id: LINE 的 groupId, roomId 或 userId
--    - is_active: 1: 說話模式, 0: 閉嘴模式
--    - guidelines: 此群組專屬的翻譯/行為指令
-- 4. chat_history: 對話歷史紀錄表
--    - role: 'system', 'user', 'assistant'
