# LINE Translation Bot (Cloudflare Workers + D1 版)

> [!NOTE]
> 本專案已從 Vercel (Python) 遷移至 **Cloudflare Workers (JavaScript)**，並使用 **Cloudflare D1** 作為資料庫，提供更穩定的對話歷史紀錄與動態設定管理。

這是一個利用 OpenAI API 與 LINE Messaging API 打造的翻譯機器人。它具備「群組記憶功能」、「動態指令設定」以及「管理者控制模式」。

## 🚀 特色
- **高效能**: 基於 Cloudflare Workers 全球邊緣運算，反應極快。
- **持久化**: 使用 D1 存儲對話歷史與系統設定，即使重新部署也不會遺失狀態。
- **靈活性**: 支援單一對話群組的獨立翻譯設定（例如：群組 A 翻日文，群組 B 翻英文）。
- **免費額度**: Cloudflare Workers 與 D1 的免費方案足以應付一般個人與小群組使用。
- **GPT-5 支援**: 已升級至 OpenAI 最新的 **Responses API**，支援具備推論能力的 `gpt-5-mini` 模型。

---

> [!CAUTION]
> **重大更新與不相容說明 (2026-04-13)**  
> 此專案已將 OpenAI 的整合模式從 Chat Completions 遷移至 **Responses API (/v1/responses)**。
> - **僅支援 GPT-5 系列模型**：由於 API 結構（Payload 與 Endpoint）大幅變動，舊款模型（如 GPT-4, GPT-3.5）已不再相容。
> - **參數異動**：移除了 `temperature` 參數（由 GPT-5 推論引擎自動接管），並使用 `max_output_tokens` 控制長度。

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

### 系統配置 (system_configs)
- `OPENAI_MODEL`: 預設為 `gpt-5-mini`。**請勿改回舊模型**，否則會發生 API 錯誤。
- `ENABLE_DEBUGGING`: 
    - `1`: 開啟詳細偵錯日誌。
    - `0`: 僅記錄重大錯誤指標。
    - 建議平時設為 `0` 以節省 Console 日誌空間。

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
