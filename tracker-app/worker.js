/*
 * A New Chapter Tracker - AI Companion Worker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 *
 * Cloudflare Worker that proxies chat requests to Workers AI.
 * The API key never touches the client. Deploy with: npx wrangler deploy
 */

// --- Configuration ---
const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DAILY_CAP = 20; // messages per device per day
const ALLOWED_ORIGINS = [
  "https://millrjess.github.io",
];

// --- System prompt with brand guardrails ---
const SYSTEM_PROMPT = `You are a supportive wellness companion inside the A New Chapter Tracker app, made for adults on GLP-1 medications like Zepbound, Wegovy, and Mounjaro.

Your role:
- Offer encouragement, practical tips, and help interpreting the user's own logged data (protein, water, movement, weight, mood).
- Be warm, compassionate, and non-judgmental. Never shame the user about food, weight, or habits.
- Celebrate small wins and consistency over perfection.

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

    // Chat endpoint
    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    return corsResponse(JSON.stringify({ error: "Not found" }), request, 404);
  },
};

async function handleChat(request, env) {
  // Origin check: only allow the tracker app
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

  // Rate limiting: per-device daily cap using a fingerprint
  const fingerprint = request.headers.get("CF-Connecting-IP") || "unknown";
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
    // Increment with 24h expiry
    await env.RATE_LIMITS.put(rateKey, String(count + 1), { expirationTtl: 86400 });
  } catch (e) {
    // If KV is unavailable, allow the request (fail open for UX, log the error)
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

  try {
    const response = await env.AI.run(MODEL, {
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...cleanMessages],
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
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
