-- 1. 系統全域設定表
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT,
    description TEXT
);

-- 2. 管理者權限表
CREATE TABLE IF NOT EXISTS admins (
    user_id TEXT PRIMARY KEY,
    note TEXT
);

-- 3. 對話群組 / 個人狀態表
CREATE TABLE IF NOT EXISTS chat_sessions (
    session_id TEXT PRIMARY KEY,   -- LINE 的 groupId, roomId 或 userId
    is_active INTEGER DEFAULT 1,   -- 1: 說話模式, 0: 閉嘴模式
    guidelines TEXT,               -- 此群組專屬的翻譯/行為指令
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. 對話歷史紀錄表
CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    role TEXT,                     -- 'system', 'user', 'assistant'
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 預設系統參數
INSERT OR REPLACE INTO system_configs (key, value, description) VALUES 
('OPENAI_MODEL', 'gpt-4o-mini', '使用的 OpenAI 模型'),
('OPENAI_MAX_TOKENS', '500', '回應最大 Token 數'),
('HISTORY_LIMIT', '10', '保留最近幾筆對話作為上下文'),
('DEFAULT_GUIDELINE', '你是一個專業的翻譯小幫手，請將使用者的內容翻譯成目標語言。', '全域預設指令');
