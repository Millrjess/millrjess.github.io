/*
 * A New Chapter Tracker - AI Coach Worker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 *
 * Cloudflare Worker that proxies chat requests to Workers AI,
 * validates per-user access tokens, and stores opt-in coach memory.
 * The API key never touches the client. Deploy with: npx wrangler deploy
 *
 * Required secrets: AUTH_TOKEN (master token, backward compat)
 * Optional secrets: ADMIN_SECRET (for issuing per-user tokens)
 * KV bindings: RATE_LIMITS (existing), USERS (per-user tokens + memory)
 */

// --- Configuration ---
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const DAILY_CAP = 20; // messages per user per day
const ALLOWED_ORIGINS = [
  "https://millrjess.github.io",
];

// --- System prompt with brand guardrails ---
const SYSTEM_PROMPT = `You are a supportive wellness coach inside the A New Chapter Tracker app, made for women over 50 on GLP-1 medications like Zepbound, Wegovy, and Mounjaro.

Your role:
- Offer encouragement, practical tips, and help interpreting the user's own logged data (protein, water, movement, weight, mood).
- Be warm, compassionate, and non-judgmental. Never shame the user about food, weight, or habits.
- Celebrate small wins and consistency over perfection. Strength and energy matter more than any number.

Strict boundaries:
- You are NOT a medical professional. Never give medical advice, diagnose, recommend doses, or suggest changing medication.
- If asked about medication, doses, side effects, or health concerns, encourage the user to talk to their clinician or pharmacist.
- Describe Zepbound accurately: it is FDA-approved for chronic weight management and type 2 diabetes (as Zepbound/Mounjaro), not a cosmetic product.
- Never invent product recommendations. If nutrition comes up, keep it general (protein-rich foods, hydration) and suggest they check with their dietitian.
- Keep responses concise and conversational, suitable for a phone chat.

Privacy note: the user was told that chat messages leave their device and are processed by Cloudflare and the AI model provider. Do not repeat this unprompted.`;

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return corsResponse(null, request);
    }

    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/api/health") {
      return corsResponse(JSON.stringify({ ok: true }), request, 200);
    }

    // Admin: issue a per-user token (protected by ADMIN_SECRET)
    if (url.pathname === "/api/admin/issue" && request.method === "POST") {
      return handleIssueToken(request, env);
    }

    // All other API routes require a valid token
    const auth = await validateToken(request, env);
    if (!auth.valid) {
      return corsResponse(JSON.stringify({ error: "Unauthorized" }), request, 401);
    }

    // Chat endpoint
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env, auth);
    }

    // Memory endpoints (opt-in coach memory)
    if (url.pathname === "/api/memory" && request.method === "GET") {
      return handleGetMemory(request, env, auth);
    }
    if (url.pathname === "/api/memory" && request.method === "POST") {
      return handleSaveMemory(request, env, auth);
    }
    if (url.pathname === "/api/memory" && request.method === "DELETE") {
      return handleDeleteMemory(request, env, auth);
    }

    return corsResponse(JSON.stringify({ error: "Not found" }), request, 404);
  },
};

/* ---------- Token validation ---------- */

async function validateToken(request, env) {
  const token = (request.headers.get("X-Auth-Token") || "").trim();
  if (!token) return { valid: false };

  // Master token: backward compatible with existing buyer links.
  // No per-user identity, so no memory.
  if (env.AUTH_TOKEN && token === env.AUTH_TOKEN) {
    return { valid: true, userId: null, master: true };
  }

  // Per-user token from KV
  try {
    const raw = await env.USERS.get("user:" + token);
    if (!raw) return { valid: false };
    const user = JSON.parse(raw);
    if (user.status !== "active") return { valid: false };
    return { valid: true, userId: token, master: false, plan: user.plan || "unknown" };
  } catch (e) {
    console.error("Token validation KV error:", e);
    return { valid: false };
  }
}

/* ---------- Admin: issue per-user tokens ---------- */

async function handleIssueToken(request, env) {
  const adminSecret = (request.headers.get("X-Admin-Secret") || "").trim();
  if (!env.ADMIN_SECRET || adminSecret !== env.ADMIN_SECRET) {
    return corsResponse(JSON.stringify({ error: "Forbidden" }), request, 403);
  }
  let body = {};
  try { body = await request.json(); } catch {}
  const token = "nc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const user = {
    email: String(body.email || ""),
    plan: String(body.plan || "monthly"),
    created: new Date().toISOString(),
    status: "active",
  };
  try {
    await env.USERS.put("user:" + token, JSON.stringify(user));
  } catch (e) {
    console.error("Issue token KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
  return corsResponse(JSON.stringify({ token, user }), request, 200);
}

/* ---------- Memory (opt-in) ---------- */

function memoryKey(auth) {
  // Memory is only available for per-user tokens, never the master token.
  return auth.userId ? "memory:" + auth.userId : null;
}

async function handleGetMemory(request, env, auth) {
  const key = memoryKey(auth);
  if (!key) return corsResponse(JSON.stringify({ profile: null }), request, 200);
  try {
    const raw = await env.USERS.get(key);
    return corsResponse(JSON.stringify({ profile: raw ? JSON.parse(raw) : null }), request, 200);
  } catch (e) {
    console.error("Get memory KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
}

async function handleSaveMemory(request, env, auth) {
  const key = memoryKey(auth);
  if (!key) {
    return corsResponse(JSON.stringify({ error: "Memory requires a personal access link" }), request, 400);
  }
  let body;
  try { body = await request.json(); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }
  // Only allow known profile fields, each length-capped
  const profile = {
    name: String(body.name || "").slice(0, 60),
    goals: String(body.goals || "").slice(0, 500),
    preferences: String(body.preferences || "").slice(0, 500),
    notes: String(body.notes || "").slice(0, 1000),
    updatedAt: new Date().toISOString(),
  };
  try {
    await env.USERS.put(key, JSON.stringify(profile));
  } catch (e) {
    console.error("Save memory KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
  return corsResponse(JSON.stringify({ ok: true }), request, 200);
}

async function handleDeleteMemory(request, env, auth) {
  const key = memoryKey(auth);
  if (!key) return corsResponse(JSON.stringify({ ok: true }), request, 200);
  try {
    await env.USERS.delete(key);
  } catch (e) {
    console.error("Delete memory KV error:", e);
  }
  return corsResponse(JSON.stringify({ ok: true }), request, 200);
}

/* ---------- Chat ---------- */

async function handleChat(request, env, auth) {
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.includes(origin)) {
    return corsResponse(JSON.stringify({ error: "Forbidden" }), request, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return corsResponse(JSON.stringify({ error: "No messages provided" }), request, 400);
  }

  // Rate limiting: per user (token) when available, else per IP
  const fingerprint = auth.userId ? "user:" + auth.userId : (request.headers.get("CF-Connecting-IP") || "unknown");
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rateKey = `ratelimit:${fingerprint}:${today}`;

  try {
    const count = parseInt((await env.RATE_LIMITS.get(rateKey)) || "0", 10);
    if (count >= DAILY_CAP) {
      return corsResponse(
        JSON.stringify({
          error: "Daily limit reached",
          message: "You have reached your 20 messages for today. Come back tomorrow.",
        }),
        request,
        429
      );
    }
    await env.RATE_LIMITS.put(rateKey, String(count + 1), { expirationTtl: 86400 });
  } catch (e) {
    console.error("Rate limit KV error:", e);
  }

  // Sanitize messages: only role + content, cap at last 20
  const cleanMessages = messages
    .slice(-20)
    .filter((m) => m && typeof m.content === "string" && ["user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (cleanMessages.length === 0) {
    return corsResponse(JSON.stringify({ error: "No valid messages" }), request, 400);
  }

  // Load opt-in memory profile to personalize the system prompt
  let systemPrompt = SYSTEM_PROMPT;
  const memKey = memoryKey(auth);
  if (memKey) {
    try {
      const raw = await env.USERS.get(memKey);
      if (raw) {
        const p = JSON.parse(raw);
        const parts = [];
        if (p.name) parts.push("The user's name is " + p.name + ".");
        if (p.goals) parts.push("Their goals: " + p.goals);
        if (p.preferences) parts.push("Preferences to respect: " + p.preferences);
        if (p.notes) parts.push("Notes about them: " + p.notes);
        if (parts.length) {
          systemPrompt += "\n\nWhat you remember about this user (they opted in to this):\n" + parts.join("\n");
        }
      }
    } catch (e) {
      console.error("Memory load KV error:", e);
    }
  }

  try {
    const response = await env.AI.run(MODEL, {
      messages: [{ role: "system", content: systemPrompt }, ...cleanMessages],
      max_tokens: 500,
      temperature: 0.7,
    });

    const reply =
      response.response || "I am here for you. Could you say that another way?";

    return corsResponse(JSON.stringify({ reply }), request, 200);
  } catch (e) {
    console.error("Workers AI error:", e);
    return corsResponse(
      JSON.stringify({
        reply: "I am having trouble right now. Please try again in a moment.",
      }),
      request,
      200
    );
  }
}

function corsResponse(body, request, status = 200) {
  const origin = request.headers.get("Origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowed,
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Admin-Secret",
    },
  });
}
