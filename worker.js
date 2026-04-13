/**
 * Cloudflare Worker for LINE Translation Bot
 * Using D1 for configuration and session persistence.
 */

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

      console.log(`[Webhook] 入口請求 - Path: ${pathname}, Signature: ${signature ? "已提供" : "缺失"}`);

      if (!signature || !(await verifySignature(body, signature, env.LINE_CHANNEL_SECRET))) {
        console.error("[Webhook] 簽章驗證失敗");
        return new Response("Unauthorized", { status: 401 });
      }

      const events = JSON.parse(body).events;
      console.log(`[Webhook] 接收到 ${events.length} 個事件`);

      for (const event of events) {
        ctx.waitUntil(handleLineEvent(event, env));
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
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
async function handleLineEvent(event, env) {
  if (event.type !== "message" || event.message.type !== "text") return;

  const sessionId = event.source.groupId || event.source.roomId || event.source.userId;
  const userId = event.source.userId;
  const userMessage = event.message.text.trim();

  // 1. 取得 Session 狀態與管理者資訊
  console.log(`[Event] 收到處理請求 - Session: ${sessionId}, User: ${userId}, Message: ${userMessage}`);

  const [session, isAdmin] = await Promise.all([
    getChatSession(sessionId, env),
    checkIsAdmin(userId, env),
  ]);

  console.log(`[Session] 狀態 - Active: ${session.is_active}, IsAdmin: ${isAdmin}`);

  // 2. 指令解析 (Admin Only)
  if (isAdmin) {
    if (userMessage === "說話") {
      await updateSessionActive(sessionId, 1, env);
      return replyMessage(event.replyToken, "我可以說話囉，歡迎來跟我互動 ^_^", env);
    }
    if (userMessage === "閉嘴") {
      await updateSessionActive(sessionId, 0, env);
      return replyMessage(event.replyToken, "好的，我乖乖閉嘴 > <，如果想要我繼續說話，請跟我說 「說話」", env);
    }
    if (userMessage.toLowerCase().startsWith("lang set ")) {
      const langs = userMessage.slice(9).trim();
      const newGuidelines = `將所有輸入的訊息翻譯成 ${langs} 等幾種語言，每種語言一行，僅執行翻譯，不進行其他互動。`;
      await updateSessionGuidelines(sessionId, newGuidelines, env);
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
      // 取得歷史紀錄
      const historyLimit = await getSystemConfig("HISTORY_LIMIT", "10", env);
      const history = await getChatHistory(sessionId, parseInt(historyLimit), env);
      
      // 準備 Guidelines (優先使用 Session 級別)
      const systemPrompt = session.guidelines || await getSystemConfig("DEFAULT_GUIDELINE", "你是一個翻譯助手", env);

      const messages = [
        { role: "system", content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage }
      ];

      // 呼叫 OpenAI
      const aiResponse = await callOpenAI(messages, env);

      // 儲存紀錄
      await Promise.all([
        saveChatHistory(sessionId, "user", userMessage, env),
        saveChatHistory(sessionId, "assistant", aiResponse, env),
      ]);

      return replyMessage(event.replyToken, aiResponse, env);
    } catch (error) {
      console.error("OpenAI Error:", error);
      return replyMessage(event.replyToken, `處理訊息時發生錯誤: ${error.message}`, env);
    }
  }
}

/**
 * LINE 回覆訊息
 */
async function replyMessage(replyToken, text, env) {
  const url = "https://api.line.me/v2/bot/message/reply";
  
  const safeText = (text && text.trim().length > 0) ? text : "(機器人暫時沒有回應)";
  console.log(`[LINE] 準備發送回覆 - Content: ${safeText.substring(0, 50)}${safeText.length > 50 ? "..." : ""}`);

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

  const resText = await response.text();
  if (!response.ok) {
    console.error(`[LINE] 回傳錯誤 - Status: ${response.status}, Body: ${resText}`);
  } else {
    console.log("[LINE] 回覆發送成功");
  }
}

/**
 * D1 Helper Functions
 */

async function getChatSession(sessionId, env) {
  const res = await env.DB.prepare("SELECT * FROM chat_sessions WHERE session_id = ?")
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
  const res = await env.DB.prepare("SELECT 1 FROM admins WHERE user_id = ?").bind(userId).first();
  return !!res;
}

async function getSystemConfig(key, defaultValue, env) {
  const res = await env.DB.prepare("SELECT value FROM system_configs WHERE key = ?").bind(key).first();
  return res ? res.value : defaultValue;
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
 * OpenAI API 呼叫
 */
async function callOpenAI(messages, env) {
  const model = await getSystemConfig("OPENAI_MODEL", "gpt-4o-mini", env);
  const maxTokens = await getSystemConfig("OPENAI_MAX_TOKENS", "500", env);
  const temperature = await getSystemConfig("OPENAI_TEMPERATURE", "0.0", env);

  console.log(`[OpenAI] 呼叫參數 - Model: ${model}, Temp: ${temperature}, Tokens: ${maxTokens}`);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: parseInt(maxTokens),
      temperature: parseFloat(temperature),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const errDetail = JSON.stringify(data);
    console.error(`[OpenAI] API 報錯 - Status: ${response.status}, Detail: ${errDetail}`);
    throw new Error(data.error?.message || "OpenAI API Error");
  }

  const message = data.choices[0].message;
  const result = message.content;
  
  if (!result && message.refusal) {
    console.warn(`[OpenAI] 模型拒絕回答 - 原因: ${message.refusal}`);
    return `(模型拒絕回答: ${message.refusal})`;
  }

  console.log(`[OpenAI] 成功取得回應 - 長度: ${result ? result.length : 0}`);
  return result || "";
}
