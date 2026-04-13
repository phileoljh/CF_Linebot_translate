# LINE Translation Bot (Cloudflare Workers + D1 版)

> [!NOTE]
> 本專案已從 Vercel (Python) 遷移至 **Cloudflare Workers (JavaScript)**，並使用 **Cloudflare D1** 作為資料庫，提供更穩定的對話歷史紀錄與動態設定管理。

這是一個利用 OpenAI API 與 LINE Messaging API 打造的翻譯機器人。它具備「群組記憶功能」、「動態指令設定」以及「管理者控制模式」。

## 🚀 特色
- **高效能**: 基於 Cloudflare Workers 全球邊緣運算，反應極快。
- **持久化**: 使用 D1 存儲對話歷史與系統設定，即使重新部署也不會遺失狀態。
- **靈活性**: 支援單一對話群組的獨立翻譯設定（例如：群組 A 翻日文，群組 B 翻英文）。
- **免費額度**: Cloudflare Workers 與 D1 的免費方案足以應付一般個人與小群組使用。

---

## 🛠️ 安裝步驟

### 1. 建立 Cloudflare D1 資料庫
1. 進入 Cloudflare Dashboard -> **Storage & Databases** -> **D1**。
2. 點擊 **Create database**，名稱自訂（例如 `line-bot-db`）。
3. 進入該資料庫的 **Console**，複製並執行 [`schema.sql`](./schema.sql) 中的所有 SQL 指令。

### 2. 建立 Cloudflare Worker
1. 進入 **Workers & Pages** -> **Create application** -> **Create Worker**。
2. 命名後點擊 **Deploy**，接著點擊 **Edit code**。
3. 將 [`worker.js`](./worker.js) 的內容完整複製並貼入編輯器中。
4. **重要設定 (Settings)**:
   - **Bindings**: 前往 **Settings** -> **Variables** -> **D1 database bindings**，將變數名稱設為 `DB`，並選擇你剛才建立的資料庫。
   - **Secrets**: 前往 **Settings** -> **Variables** -> **Environment Variables**，新增以下加密變數：
     - `LINE_CHANNEL_SECRET`: LINE Developer Console 取得。
     - `LINE_CHANNEL_ACCESS_TOKEN`: LINE Developer Console 取得。
     - `OPENAI_API_KEY`: OpenAI API 取得。

### 3. 設定 LINE Webhook
1. 在 [LINE Developers Console](https://developers.line.biz/) 中找到你的 Messaging API Channel。
2. 進入 **Messaging API** 分頁。
3. 在 **Webhook URL** 填入你的 Worker 網址，並加上 `/webhook` (例如：`https://your-worker.your-subdomain.workers.dev/webhook`)。
4. 點擊 **Verify** 檢查連線是否成功。
5. **務必開啟** `Use webhook` 選項。

---

## 🎮 指令說明

### 管理者指令 (需先手動將 User ID 加入 `admins` 資料表)
- `說話`: 開啟對話功能（預設開啟）。
- `閉嘴`: 暫停對話功能。
- `lang set [語言列表]`: 設定翻譯目標。
  - 例如：`lang set ja,en` (翻成日文與英文)。
- `查目前的變數值`: 顯示目前的系統設定與該群組狀態。

### 通用指令
- `show id`: 查詢目前的 User ID 與 Group/Session ID (用於設定管理者)。

---

## 📝 TODO List
- [x] 遷移至 Cloudflare Workers (JS ES Modules)
- [x] 使用 D1 實現對話歷史記憶
- [x] 支援管理者權限控制
- [x] 更新 README 說明文件
- [ ] 支援更多 AI 模型切換介面

---

## 📄 授權與貢獻
本專案改寫自原有的 [GPT-Linebot-python-flask-on-vercel](https://github.com/howarder3/GPT-Linebot-python-flask-on-vercel)。歡迎發送 PR 或 Issues！
