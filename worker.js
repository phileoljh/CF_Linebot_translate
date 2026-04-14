/**
 * 全域配置快取 (In-Memory Cache)
 * 用於減少對 D1 資料庫的重複查詢，提升回應速度。
 * 具備 5 分鐘自動刷新機制 (TTL)。
 */
let CONFIG_CACHE = {};
let LAST_FETCH_TIME = 0;
const CACHE_TTL = 300000; // 5 分鐘 (毫秒)
// Bulk Sync 去重鎖：防止快取到期時多個並行呼叫同時觸發重複的 D1 查詢 (Cache Stampede)
let activeConfigSync = null;

/**
 * 管理者清單快取 (In-Memory Cache)
 * 避免每次訊息都向 D1 查詢 admins 資料表。
 * TTL 設為 10 分鐘，可接受短暫延遲更新（新增/刪除管理者最多 10 分鐘生效）。
 */
let ADMIN_CACHE = null;       // null 表示尚未初始化；Set 表示已載入
let ADMIN_CACHE_TIME = 0;
const ADMIN_CACHE_TTL = 600000; // 10 分鐘 (毫秒)

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const { pathname } = new URL(request.url);

    // 1. Webhook 處理
    if (pathname === "/webhook") {
      const body = await request.text();
      const signature = request.headers.get("x-line-signature");

      // 先驗證簽章，非法請求直接拒絕，不觸發任何日誌 I/O 或設定讀取
      if (!signature || !(await verifySignature(body, signature, env.LINE_CHANNEL_SECRET))) {
        console.error("[Webhook] 簽章驗證失敗");
        return new Response("Unauthorized", { status: 401 });
      }

      // 驗證通過後才記錄日誌與讀取設定
      await debugLog(env, `[Webhook] 入口請求驗證通過 - Path: ${pathname}`, 'DEBUG');
      const events = JSON.parse(body).events;
      const debugEnabled = await getSystemConfig("ENABLE_DEBUGGING", "1", env) === "1";
      if (debugEnabled) {
        console.log(`[Webhook] 接收到 ${events.length} 個事件`);
      }

      for (const event of events) {
        ctx.waitUntil(handleLineEvent(event, env, ctx));
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },

  /**
   * 2. 定期維護任務 (Cron Trigger)
   * 根據 CHAT_RETENTION_DAYS 自動清理過期對話紀錄
   */
  async scheduled(event, env, ctx) {
    const retentionDays = await getSystemConfig("CHAT_RETENTION_DAYS", "30", env);
    console.log(`[Scheduled] 啟動自動清理 - 保留天數: ${retentionDays} 天`);

    try {
      const result = await env.DB.prepare(
        "DELETE FROM chat_history WHERE created_at < datetime('now', '-' || ? || ' days')"
      ).bind(retentionDays).run();

      console.log(`[Scheduled] 清理完成。共移除 ${result.meta.changes} 筆過期紀錄。`);
    } catch (error) {
      console.error("[Scheduled] 清理任務失敗:", error);
    }
  }
};

/**
 * 驗證 LINE 簽章
 */
async function verifySignature(body, signature, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const base64Sig = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return base64Sig === signature;
}

/**
 * 處理 LINE 事件
 */
/**
 * 處理 LINE 事件
 */
async function handleLineEvent(event, env, ctx) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const sessionId = event.source.groupId || event.source.roomId || event.source.userId;
  const userId = event.source.userId;
  const userMessage = event.message.text.trim();

  // 1. 取得 Session 狀態與管理者資訊
  console.log(`[Event] 收到處理請求 - Session: ${sessionId}, User: ${userId}, Message: ${userMessage}`);

  // 三個任務同步並行發起，消除串行等待：
  // 1. getChatSession：讀取或初始化此 session 的狀態
  // 2. checkIsAdmin：驗證此用戶是否為管理者
  // 3. getSystemConfig 預熱：觸發 Bulk Sync，一次將全部 system_configs 載入記憶體
  //    確保後續所有 debugLog 與 config 讀取均命中快取，不再觸發額外 D1 查詢
  const [session, isAdmin] = await Promise.all([
    getChatSession(sessionId, env),
    checkIsAdmin(userId, env),
    getSystemConfig("ENABLE_DEBUGGING", "1", env), // 副作用：預熱 CONFIG_CACHE
  ]);

  await debugLog(env, `[Session] 狀態 - Active: ${session.is_active}, IsAdmin: ${isAdmin}`, 'DEBUG');

  // 2. 指令解析 (Admin Only)
  if (isAdmin) {
    if (userMessage === "說話") {
      ctx.waitUntil(updateSessionActive(sessionId, 1, env));
      return replyMessage(event.replyToken, "我可以說話囉，歡迎來跟我互動 ^_^", env);
    }
    if (userMessage === "閉嘴") {
      ctx.waitUntil(updateSessionActive(sessionId, 0, env));
      return replyMessage(event.replyToken, "好的，我乖乖閉嘴 > <，如果想要我繼續說話，請跟我說 「說話」", env);
    }
    if (userMessage.toLowerCase().startsWith("lang set ")) {
      const langs = userMessage.slice(9).trim();
      const newGuidelines = `將所有輸入的訊息翻譯成 ${langs} 等幾種語言，每種語言一行，僅執行翻譯，不進行其他互動。`;
      ctx.waitUntil(updateSessionGuidelines(sessionId, newGuidelines, env));
      return replyMessage(event.replyToken, `已更新翻譯設定：\n${newGuidelines}`, env);
    }
    if (userMessage.toLowerCase() === "查目前的變數值") {
      const configs = await env.DB.prepare("SELECT * FROM system_configs").all();
      const configStr = configs.results.map(c => `${c.key}: ${c.value}`).join("\n");
      const status = `Session ID: ${sessionId}\nIs Active: ${session.is_active}\n\nSystem Configs:\n${configStr}`;
      return replyMessage(event.replyToken, status, env);
    }
  }

  // 3. 通用指令
  if (userMessage.toLowerCase() === "show id") {
    const info = `User ID: ${userId}\nSession ID: ${sessionId}\nIs Admin: ${isAdmin}`;
    return replyMessage(event.replyToken, info, env);
  }

  // 4. ChatGPT 對話邏輯
  if (session.is_active === 1) {
    try {
      // 並行讀取所有需要的設定值
      // 快取已在函數入口的預熱步驟填充完畢，此步為純記憶體操作，無 D1 I/O
      // saveHistoryEnabled 提前至此讀取，消除原本在 aiResponse 之後才讀取所造成的串行等待
      const [historyLimit, saveHistoryEnabled, defaultGuideline] = await Promise.all([
        getSystemConfig("HISTORY_LIMIT", "0", env),
        getSystemConfig("SAVE_CHAT_HISTORY", "0", env),
        getSystemConfig("DEFAULT_GUIDELINE", "你是一個翻譯助手", env),
      ]);

      // 取得歷史紀錄：僅在 SAVE_CHAT_HISTORY=1 時才查詢 D1
      // 若功能停用，直接回傳空陣列，避免每次請求白白消耗一次 D1 Rows Read
      const history = saveHistoryEnabled === "1"
        ? await getChatHistory(sessionId, parseInt(historyLimit), env)
        : [];

      // 準備 Guidelines (優先使用 Session 級別，其次為全域預設)
      const systemPrompt = session.guidelines || defaultGuideline;

      const messages = [
        { role: "system", content: systemPrompt },
        ...history
          .filter(h => h.content && h.content.trim().length > 0) // 過濾空內容訊息
          .map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage }
      ];

      // 呼叫 OpenAI
      const aiResponse = await callOpenAI(messages, env);

      // 將儲存任務移至背景執行 (ctx.waitUntil)，立即回覆使用者
      if (saveHistoryEnabled === "1") {
        const saveTasks = [saveChatHistory(sessionId, "user", userMessage, env)];
        if (typeof aiResponse === "string" && aiResponse.trim().length > 0) {
          saveTasks.push(saveChatHistory(sessionId, "assistant", aiResponse, env));
        }
        ctx.waitUntil(Promise.all(saveTasks));
      }

      return replyMessage(event.replyToken, aiResponse, env);
    } catch (error) {
      await debugLog(env, `處理訊息時發生錯誤: ${error.message}`, 'CRITICAL');
      return replyMessage(event.replyToken, `處理訊息時發生錯誤: ${error.message}`, env);
    }
  }
}

/**
 * LINE 回覆訊息
 */
async function replyMessage(replyToken, text, env) {
  const url = "https://api.line.me/v2/bot/message/reply";

  // 確保 text 是字串且不為空
  let safeText = (typeof text === "string" && text.trim().length > 0) ? text : "(機器人暫時沒有回應)";

  // 如果傳入的是物件而非字串，嘗試轉為 JSON
  if (typeof text === "object" && text !== null) {
    safeText = JSON.stringify(text);
  }
  await debugLog(env, `[LINE] 準備發送回覆 - Content: ${safeText.substring(0, 50)}${safeText.length > 50 ? "..." : ""}`, 'DEBUG');

  const body = JSON.stringify({
    replyToken,
    messages: [{ type: "text", text: safeText }],
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body,
  });

  // 成功時無需讀取回應 body，避免不必要的 I/O；失敗時才讀取以獲取錯誤詳情
  if (!response.ok) {
    const resText = await response.text();
    await debugLog(env, `[LINE] 回傳錯誤 - Status: ${response.status}, Body: ${resText}`, 'CRITICAL');
  } else {
    await debugLog(env, "[LINE] 回覆發送成功", 'DEBUG');
  }
}

/**
 * D1 Helper Functions
 */

async function getChatSession(sessionId, env) {
  // 僅讀取必要欄位，減少 D1 資料傳輸量
  const res = await env.DB.prepare("SELECT is_active, guidelines FROM chat_sessions WHERE session_id = ?")
    .bind(sessionId)
    .first();

  if (!res) {
    // 初始化 Session
    await env.DB.prepare("INSERT INTO chat_sessions (session_id, is_active) VALUES (?, 1)")
      .bind(sessionId)
      .run();
    return { is_active: 1, guidelines: null };
  }
  return res;
}

async function checkIsAdmin(userId, env) {
  const now = Date.now();

  // 判定管理者快取是否需要更新（首次載入或 TTL 到期）
  if (ADMIN_CACHE === null || (now - ADMIN_CACHE_TIME) >= ADMIN_CACHE_TTL) {
    try {
      // 一次性載入全部管理者清單，儲存為 Set 以支援 O(1) 查詢
      const { results } = await env.DB.prepare("SELECT user_id FROM admins").all();
      ADMIN_CACHE = new Set(results.map(r => r.user_id));
      ADMIN_CACHE_TIME = now;
      console.log(`[Admin] 快取更新完成。管理者數量: ${ADMIN_CACHE.size}`);
    } catch (e) {
      console.error("[Admin] 快取更新失敗，降級為直接查詢 DB", e);
      // 快取更新失敗時，降級為直接查詢確保功能正確
      const res = await env.DB.prepare("SELECT 1 FROM admins WHERE user_id = ?").bind(userId).first();
      return !!res;
    }
  }

  // Set.has() 為 O(1) 純記憶體操作，不觸發 D1 查詢
  return ADMIN_CACHE.has(userId);
}

async function getSystemConfig(key, defaultValue, env) {
  const now = Date.now();
  
  // 判定是否需要執行全量同步 (快取為空或已過期)
  const isExpired = (now - LAST_FETCH_TIME) >= CACHE_TTL;
  const isEmpty = Object.keys(CONFIG_CACHE).length === 0;

  if (isExpired || isEmpty) {
    // 去重保護：若已有 Bulk Sync 任務在飛行中（由其他並行呼叫觸發），
    // 直接等待同一個 Promise，不重複發起 D1 查詢（Cache Stampede 防護）
    if (!activeConfigSync) {
      activeConfigSync = (async () => {
        await debugLog(env, `[Config] Bulk Syncing (Reason: ${isEmpty ? 'Initial' : 'Expired'})`, 'DEBUG');
        try {
          // 一次性抓取整張配置表
          const { results } = await env.DB.prepare("SELECT key, value FROM system_configs").all();

          // 抹除舊快取並重新填充，確保與 DB 狀態完全同步
          const newCache = {};
          results.forEach(row => {
            newCache[row.key] = row.value;
          });

          CONFIG_CACHE = newCache;
          LAST_FETCH_TIME = Date.now();
          console.log(`[Config] Bulk Sync Successful. Total items: ${results.length}`);
        } catch (e) {
          console.error("[Config] Bulk Sync Failed", e);
          // 失敗時不更新時間，下次呼叫會再次嘗試刷新
        } finally {
          activeConfigSync = null; // 無論成功或失敗，釋放鎖，允許下次重試
        }
      })();
    }
    await activeConfigSync; // 所有並行呼叫等待同一個 Promise 完成
  }

  const value = CONFIG_CACHE[key];
  return (value !== undefined) ? value : defaultValue;
}

async function updateSessionActive(sessionId, isActive, env) {
  await env.DB.prepare("UPDATE chat_sessions SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?")
    .bind(isActive, sessionId)
    .run();
}

async function updateSessionGuidelines(sessionId, guidelines, env) {
  await env.DB.prepare("UPDATE chat_sessions SET guidelines = ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?")
    .bind(guidelines, sessionId)
    .run();
}

async function getChatHistory(sessionId, limit, env) {
  const res = await env.DB.prepare("SELECT role, content FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?")
    .bind(sessionId, limit)
    .all();
  return res.results.reverse(); // 轉回正確順序
}

async function saveChatHistory(sessionId, role, content, env) {
  await env.DB.prepare("INSERT INTO chat_history (session_id, role, content) VALUES (?, ?, ?)")
    .bind(sessionId, role, content)
    .run();
}

/**
 * OpenAI API 呼叫 (已升級為 Responses API 並支援 GPT-5)
 */
async function callOpenAI(messages, env) {
  // 並行讀取三個 OpenAI 設定值
  // 正常情況下快取已由 handleLineEvent 入口的預熱步驟填充，此步為純記憶體操作，無 D1 I/O
  const [model, maxTokens, effort] = await Promise.all([
    getSystemConfig("OPENAI_MODEL", "gpt-5.4-nano", env),
    getSystemConfig("OPENAI_MAX_TOKENS", "2000", env),
    getSystemConfig("OPENAI_REASONING_EFFORT", "none", env),
  ]);

  // 硬性檢查模型版本
  if (!model.toLowerCase().includes("gpt-5")) {
    const warnMsg = `[重大警告] 目前偵測到模型為 ${model}。本專案已遷移至 Responses API (/v1/responses)，此端點僅支援 GPT-5 系列。使用舊模型將導致不可預期的錯誤！`;
    await debugLog(env, warnMsg, 'CRITICAL');
  }

  await debugLog(env, `[OpenAI] 呼叫參數 (Responses API) - Model: ${model}, Effort: ${effort}, Max Output Tokens: ${maxTokens}`, 'DEBUG');

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: model,
      input: messages,
      max_output_tokens: parseInt(maxTokens),
      reasoning: {
        effort: effort
      }
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const errDetail = JSON.stringify(data);
    await debugLog(env, `[OpenAI] API 報錯 - Status: ${response.status}, Detail: ${errDetail}`, 'CRITICAL');
    throw new Error(data.error?.message || "OpenAI API Error");
  }

  // 深度解析核心：遞迴尋找任何可能潛藏在陣列或物件中的文字內容
  const extractText = (val) => {
    if (typeof val === "string") return val;
    if (Array.isArray(val)) {
      // 處理陣列，過濾掉推理區塊並串接文本
      return val
        .filter(item => item && item.type !== "reasoning")
        .map(extractText)
        .join(""); // .trim() 移至外層，避免遞迴中過度修剪
    }
    if (typeof val === "object" && val !== null) {
      // 核心修正：GPT-5 的 text 欄位可能是物件也可能是字串
      // 我們按優先序檢索，且只有在確定是字串時才直接回傳
      if (typeof val.text === "string") return val.text;
      if (typeof val.content === "string") return val.content;

      // 若欄位依然是物件，則繼續遞迴
      return extractText(val.text) || extractText(val.content) || extractText(val.message) || "";
    }
    return "";
  };

  let result = extractText(data.output_text) || extractText(data.output) || "";
  if (typeof result === "string") result = result.trim();

  if (!result) {
    if (data.status === "incomplete") {
      const reason = data.incomplete_details?.reason || "未知原因";
      await debugLog(env, `[OpenAI] 回應不完整 - 原因: ${reason}`, 'CRITICAL');
      return `(模型回應不完整，原因: ${reason}。這通常是因為 Token 上限不足或推論過長。)`;
    }

    if (!data.refusal) {
      await debugLog(env, `[OpenAI] 解析失敗 - 完整回傳結構: ${JSON.stringify(data)}`, 'CRITICAL');
    }
  }

  if (!result && data.refusal) {
    await debugLog(env, `[OpenAI] 模型拒絕回答 - 原因: ${data.refusal}`, 'CRITICAL');
    return `(模型拒絕回答: ${data.refusal})`;
  }

  const finalResult = (typeof result === "string") ? result : (result ? JSON.stringify(result) : "");

  await debugLog(env, `[OpenAI] 成功取得回應 - 類型: ${typeof result}, 長度: ${finalResult.length}`, 'DEBUG');
  return finalResult;
}

/**
 * 集中管理日誌輸出
 * @param {string} level 'DEBUG' | 'CRITICAL'
 */
async function debugLog(env, message, level = 'DEBUG') {
  if (level === 'CRITICAL') {
    console.error(message);
    return;
  }

  // 直接讀取全域快取開關，避免遞迴呼叫 getSystemConfig
  let debugEnabled = CONFIG_CACHE["ENABLE_DEBUGGING"];

  // 如果快取中還沒有開關值，則直接向 DB 查詢並補回快取
  if (debugEnabled === undefined) {
    try {
      const res = await env.DB.prepare("SELECT value FROM system_configs WHERE key = 'ENABLE_DEBUGGING'").first();
      debugEnabled = res ? res.value : "1";
      CONFIG_CACHE["ENABLE_DEBUGGING"] = debugEnabled;
    } catch (e) {
      console.error("[Fatal] 無法讀取偵錯開關", e);
      debugEnabled = "1";
    }
  }

  if (debugEnabled === "1") {
    console.log(message);
  }
}
