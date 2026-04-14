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

CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history (session_id, id DESC);

INSERT OR REPLACE INTO system_configs (key, value, description) VALUES 
('OPENAI_MODEL', 'gpt-5.4-nano', '使用的 OpenAI 模型'),
('OPENAI_MAX_TOKENS', '2000', '回應最大 Token 數 (GPT-5 包含推理量)'),
('OPENAI_REASONING_EFFORT', 'none', '推理強度 (none, low, medium, high, xhigh)'),
('HISTORY_LIMIT', '2', '保留最近幾筆對話作為上下文'),
('DEFAULT_GUIDELINE', '將輸入訊息翻譯為以下語言，每一種語言換一行：\n【zh-TW】翻譯內容\n【ja】翻譯內容\n【fr】翻譯內容\n【en】翻譯內容\n僅執行翻譯，直接輸出結果，不准進行深度思考。', '全域預設指令'),
('SAVE_CHAT_HISTORY', '0', '是否將對話紀錄存入 D1 資料庫 (1: 是, 0: 否)'),
('CHAT_RETENTION_DAYS', '30', '對話紀錄保留天數'),
('ENABLE_DEBUGGING', '1', '是否開啟詳細偵錯日誌 (1: 是, 0: 否)'),
('SUPPORTED_LANGUAGES', '繁體中文 (zh-TW), 日文 (ja), 英文 (en), 法文 (fr), 泰文 (th), 印尼文 (id), 越南文 (vi), 印度文 (hi), 菲律賓文 (tl), 柬埔寨文 (km)', '支援的語種列表');

-- 清理已廢棄的設定：Responses API (GPT-5) 不支援 temperature 參數
-- 若資料庫已存在此欄位（由舊版 schema 建立），此指令將其移除
DELETE FROM system_configs WHERE key = 'OPENAI_TEMPERATURE';

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
-- 5. idx_chat_history_session_id: 加速歷史紀錄查詢與排序

-- ==========================================
-- 🛠️ 維護指令 (Maintenance Commands)
-- 當您需要手動管理資料庫時，可以拷貝以下指令執行
-- ==========================================

-- 【設定類】
-- 1. 開啟/關閉 詳細偵錯日誌 (1: 開, 0: 關)
-- UPDATE system_configs SET value = '1' WHERE key = 'ENABLE_DEBUGGING';

-- 2. 開啟/關閉 對話紀錄存檔 (1: 開, 0: 關)
-- UPDATE system_configs SET value = '1' WHERE key = 'SAVE_CHAT_HISTORY';

-- 3. 修改全域預設指令 (例如增加新語言)
-- UPDATE system_configs SET value = '你是一個翻譯助手...' WHERE key = 'DEFAULT_GUIDELINE';

-- 【管理類】
-- 4. 新增管理者 (填入 User ID)
-- INSERT OR IGNORE INTO admins (user_id, note) VALUES ('U123456...', '管理者名稱');

-- 5. 移除管理者
-- DELETE FROM admins WHERE user_id = 'U123456...';

-- 【清理類】
-- 6. 清空「全體」對話歷史紀錄 (慎用！)
-- DELETE FROM chat_history;

-- 7. 清空「特定群組/個人」的對話歷史 (填入 Session ID)
-- DELETE FROM chat_history WHERE session_id = 'C123456...';

-- 8. 手動執行過期資料清理 (例如清理 7 天前)
-- DELETE FROM chat_history WHERE created_at < datetime('now', '-7 days');

-- 【查詢類】
-- 9. 查詢目前各表數據量
-- SELECT 'system_configs' as table_name, COUNT(*) as count FROM system_configs
-- UNION ALL SELECT 'admins', COUNT(*) FROM admins
-- UNION ALL SELECT 'chat_sessions', COUNT(*) FROM chat_sessions
-- UNION ALL SELECT 'chat_history', COUNT(*) FROM chat_history;

-- 10. 查詢最近 10 筆對話紀錄
-- SELECT * FROM chat_history ORDER BY id DESC LIMIT 10;
