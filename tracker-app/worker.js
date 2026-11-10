/*
 * A New Chapter Tracker - AI Wellness Companion Worker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 *
 * Cloudflare Worker that proxies chat requests to Workers AI,
 * validates per-user access tokens, and stores opt-in companion memory.
 * The API key never touches the client. Deploy from the Cloudflare
 * dashboard only. Do not run wrangler deploy from the repo config;
 * it spins up a duplicate worker.
 *
 * Required secrets: AUTH_TOKEN (master token, backward compat)
 * Optional secrets: ADMIN_SECRET (for issuing per-user tokens)
 * Portal secret: STRIPE_SECRET_KEY (restricted key, for the /api/portal
 * Billing portal endpoint; add in the December dashboard deploy, with
 * the Billing portal configured in the Stripe dashboard)
 * KV bindings: RATE_LIMITS (existing), USERS (per-user tokens + memory)
 */

// --- Configuration ---
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DAILY_CAP = 40; // messages per user per day
const ALLOWED_ORIGINS = [
  "https://millrjess.github.io",
];

// --- System prompt with brand guardrails ---
const SYSTEM_PROMPT = `You are a supportive wellness companion inside the New Chapter: GLP-1 Tracker™ app, made for adults on GLP-1 medications like Zepbound, Wegovy, Mounjaro, and Ozempic.

Core principles — these govern every reply:
- Ethical: you are honest about what you are (an AI companion, not a human, not a medical professional). You never manipulate, never use guilt or fear, and never push the user toward a purchase or a choice. You respect their autonomy.
- Unbiased: you treat every user with the same respect regardless of age, gender, body size, medication, or background. You never shame anyone about food, weight, or habits. You never favor one product, diet, or medication over another.
- Factual: you only state facts you are confident about. You never invent citations, studies, statistics, or medical claims. If you are unsure, say so plainly. You never present a guess as a fact.
- Compassion and empathy: you speak with authentic human warmth. You acknowledge how hard this journey can be. You validate feelings before offering tips. You celebrate small wins and consistency over perfection. Strength and energy matter more than any number. You sound like a caring person, not a textbook.

Your role:
- Offer encouragement and practical tips. Help the user reflect on the habits they describe in chat, such as protein, water, movement, and mood.
- Personalize for GLP-1 treatment: you know their medication, dose, and shot day when the app shares it. Tailor your replies to their GLP-1 journey: protein for muscle protection while the medicine works, staying hydrated, gentle movement, managing common side effects like nausea and fatigue, and injection site rotation.
- Use the GLP-1 context the app sends with each message (medication, dose, shot day, protein targets, today's logged protein, recent side effects, weight trend) to give specific, relevant replies. Never claim to have seen their full tracker history, only the context the app shares in this message.

Strict boundaries:
- You are NOT a medical professional. Never give medical advice, diagnose, recommend doses, or suggest changing medication.
- If asked about medication, doses, side effects, or health concerns, encourage the user to talk to their clinician or pharmacist.
- Describe Zepbound accurately: Zepbound is FDA approved for chronic weight management. Mounjaro is the same medicine under a different name, approved for type 2 diabetes. Neither is a cosmetic product.
- Never invent product recommendations. If nutrition comes up, keep it general (protein rich foods, hydration) and suggest they check with their dietitian.
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

    // Stripe webhook: auto-issue a token on completed checkout (signature verified)
    if (url.pathname === "/api/webhook/stripe" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    // Recover app link by purchase email (rate-limited, public)
    if (url.pathname === "/api/recover" && request.method === "POST") {
      return handleRecover(request, env);
    }

    // Access code: request a 6-digit code by email (rate-limited, public)
    if (url.pathname === "/api/code/request" && request.method === "POST") {
      return handleCodeRequest(request, env);
    }

    // Access code: redeem a 6-digit code for the token (rate-limited, public)
    if (url.pathname === "/api/code/redeem" && request.method === "POST") {
      return handleCodeRedeem(request, env);
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

    // Memory endpoints (opt-in companion memory)
    if (url.pathname === "/api/memory" && request.method === "GET") {
      return handleGetMemory(request, env, auth);
    }
    if (url.pathname === "/api/memory" && request.method === "POST") {
      return handleSaveMemory(request, env, auth);
    }
    if (url.pathname === "/api/memory" && request.method === "DELETE") {
      return handleDeleteMemory(request, env, auth);
    }

    // Billing portal: manage or cancel the subscription in Stripe.
    // Token-gated: the token resolves the user's email from KV, and the
    // Stripe customer is found by that email. Needs STRIPE_SECRET_KEY
    // in the Worker environment (December dashboard deploy) and a
    // configured Billing portal in the Stripe dashboard.
    if (url.pathname === "/api/portal" && request.method === "POST") {
      return handleBillingPortal(request, env, auth);
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
    // Lowercased, like the webhook and recover paths: an admin-issued
    // token for "User@Example.com" must be found by a recover lookup
    // for "user@example.com".
    email: String(body.email || "").toLowerCase().trim(),
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

/* ---------- Stripe webhook: auto-issue tokens on purchase ---------- */

const APP_URL = "https://millrjess.github.io/tracker-app/";

async function issueUserToken(env, email, plan) {
  const token = "nc_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const user = {
    email: String(email || "").toLowerCase(),
    plan: String(plan || "unknown"),
    created: new Date().toISOString(),
    status: "active",
  };
  await env.USERS.put("user:" + token, JSON.stringify(user));
  if (user.email) {
    await env.USERS.put("email:" + user.email, token);
  }
  return { token, user };
}

async function verifyStripeSignature(request, env) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = request.headers.get("stripe-signature") || "";
  const rawBody = await request.text();
  // Parse t= and v1= from the signature header
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
  const t = parts.t, v1 = parts.v1;
  if (!t || !v1) return { ok: false };
  // Reject timestamps older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - parseInt(t, 10)) > 300) return { ok: false };
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = await crypto.subtle.sign(
    "HMAC", key, new TextEncoder().encode(t + "." + rawBody)
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let ok = hex.length === v1.length;
  for (let i = 0; i < hex.length; i++) ok = ok && hex[i] === v1[i];
  return { ok, body: rawBody };
}

async function handleStripeWebhook(request, env) {
  const check = await verifyStripeSignature(request, env);
  if (!check || !check.ok) {
    return corsResponse(JSON.stringify({ error: "Invalid signature" }), request, 400);
  }
  let event;
  try { event = JSON.parse(check.body); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object || {};
    const email = (session.customer_details && session.customer_details.email) || session.customer_email || "";
    // Detect plan from amount or metadata
    let plan = "unknown";
    const meta = session.metadata || {};
    if (meta.plan) plan = String(meta.plan);
    else if (session.amount_total === 2999) plan = "annual";
    else if (session.amount_total === 399) plan = "monthly";
    try {
      const { token } = await issueUserToken(env, email, plan);
      console.log("Issued token for purchase:", email, plan);
      return corsResponse(JSON.stringify({ ok: true, token_issued: true }), request, 200);
    } catch (e) {
      console.error("Token issue on webhook failed:", e);
      return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
    }
  }
  // Acknowledge other event types without action
  return corsResponse(JSON.stringify({ ok: true }), request, 200);
}

/* ---------- Billing portal (Stripe) ---------- */
/* One-tap manage/cancel: the app's Manage subscription button calls
   this with its Companion token. The token resolves the user's email
   from the KV user record (the same email the welcome and code flow
   stored, looked up the way handleCodeRequest looks up email:<email>),
   the Stripe customer is found by that email, and a Billing portal
   session is created. Returns { url } for the app to open in a new tab.
   Requires env.STRIPE_SECRET_KEY (restricted key) and a Billing portal
   configured in the Stripe dashboard; both are December deploy steps.
   Until then this returns 503 and the app shows the coming-soon line. */

async function handleBillingPortal(request, env, auth) {
  if (!(await checkPublicRateLimit(request, env, "portal", 10))) {
    return corsResponse(JSON.stringify({ error: "Too many attempts. Try again later." }), request, 429);
  }
  if (!auth.userId) {
    // A master token carries no identity, so there is no email to find.
    return corsResponse(JSON.stringify({ error: "No account linked to this device." }), request, 400);
  }
  let email = "";
  try {
    const raw = await env.USERS.get("user:" + auth.userId);
    if (raw) email = (JSON.parse(raw).email || "").toLowerCase().trim();
  } catch (e) {
    console.error("Portal KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
  if (!email) {
    return corsResponse(JSON.stringify({ error: "No account linked to this device." }), request, 400);
  }
  if (!env.STRIPE_SECRET_KEY) {
    return corsResponse(JSON.stringify({ error: "Billing portal is not set up yet." }), request, 503);
  }
  const key = env.STRIPE_SECRET_KEY;
  let customerId = "";
  try {
    const listRes = await fetch("https://api.stripe.com/v1/customers?email=" + encodeURIComponent(email) + "&limit=1", {
      headers: { Authorization: "Bearer " + key }
    });
    if (!listRes.ok) {
      console.error("Portal customer lookup failed:", listRes.status);
      return corsResponse(JSON.stringify({ error: "Could not open the billing portal. Try again later." }), request, 502);
    }
    const list = await listRes.json();
    if (!list.data || !list.data.length) {
      return corsResponse(JSON.stringify({ error: "No subscription found for this email." }), request, 404);
    }
    customerId = list.data[0].id;
  } catch (e) {
    console.error("Portal customer lookup error:", e);
    return corsResponse(JSON.stringify({ error: "Could not open the billing portal. Try again later." }), request, 502);
  }
  try {
    const body = new URLSearchParams({ customer: customerId, return_url: APP_URL });
    const sessRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!sessRes.ok) {
      console.error("Portal session create failed:", sessRes.status);
      return corsResponse(JSON.stringify({ error: "Could not open the billing portal. Try again later." }), request, 502);
    }
    const sess = await sessRes.json();
    if (!sess.url) {
      return corsResponse(JSON.stringify({ error: "Could not open the billing portal. Try again later." }), request, 502);
    }
    return corsResponse(JSON.stringify({ url: sess.url }), request, 200);
  } catch (e) {
    console.error("Portal session error:", e);
    return corsResponse(JSON.stringify({ error: "Could not open the billing portal. Try again later." }), request, 502);
  }
}

/* ---------- Recover app link by email ---------- */

async function handleRecover(request, env) {
  // Rate limit: 5 attempts per IP per hour (prevents email enumeration)
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = "recover:" + ip;
  try {
    const count = parseInt((await env.RATE_LIMITS.get(rlKey)) || "0", 10);
    if (count >= 5) {
      return corsResponse(JSON.stringify({ error: "Too many attempts. Try again later." }), request, 429);
    }
    await env.RATE_LIMITS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
  } catch (e) { console.error("Recover rate limit error:", e); }

  let body;
  try { body = await request.json(); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return corsResponse(JSON.stringify({ error: "Enter a valid email address." }), request, 400);
  }
  try {
    const token = await env.USERS.get("email:" + email);
    if (!token) {
      // Same response shape whether or not the email exists (don't leak)
      return corsResponse(JSON.stringify({ found: false }), request, 200);
    }
    return corsResponse(JSON.stringify({ found: true, link: APP_URL + "?key=" + token }), request, 200);
  } catch (e) {
    console.error("Recover KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
}

/* ---------- Access codes (6-digit, type into the app) ---------- */

async function checkPublicRateLimit(request, env, prefix, maxPerHour) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const rlKey = prefix + ":" + ip;
  try {
    const count = parseInt((await env.RATE_LIMITS.get(rlKey)) || "0", 10);
    if (count >= maxPerHour) return false;
    await env.RATE_LIMITS.put(rlKey, String(count + 1), { expirationTtl: 3600 });
    return true;
  } catch (e) {
    console.error("Rate limit error:", e);
    // Fail closed on KV errors: these endpoints guard 6-digit codes, and
    // every one of them needs KV to work anyway (the code or email lookup
    // would fail too), so refusing during an outage loses nothing real
    // while an open gate would let the code be hammered without a limit.
    return false;
  }
}

async function handleCodeRequest(request, env) {
  if (!(await checkPublicRateLimit(request, env, "code-req", 5))) {
    return corsResponse(JSON.stringify({ error: "Too many attempts. Try again later." }), request, 429);
  }
  let body;
  try { body = await request.json(); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return corsResponse(JSON.stringify({ error: "Enter a valid email address." }), request, 400);
  }
  try {
    const token = await env.USERS.get("email:" + email);
    if (!token) {
      return corsResponse(JSON.stringify({ found: false }), request, 200);
    }
    // 6-digit code, re-redeemable within 24 hours (covers PWA install wiping Safari storage)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await env.USERS.put("code:" + code, JSON.stringify({ token, created: new Date().toISOString() }), { expirationTtl: 86400 });
    return corsResponse(JSON.stringify({ found: true, code }), request, 200);
  } catch (e) {
    console.error("Code request KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
}

async function handleCodeRedeem(request, env) {
  if (!(await checkPublicRateLimit(request, env, "code-redeem", 10))) {
    return corsResponse(JSON.stringify({ error: "Too many attempts. Try again later." }), request, 429);
  }
  let body;
  try { body = await request.json(); } catch {
    return corsResponse(JSON.stringify({ error: "Invalid JSON" }), request, 400);
  }
  const code = String(body.code || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    return corsResponse(JSON.stringify({ error: "Enter the 6-digit code." }), request, 400);
  }
  try {
    const raw = await env.USERS.get("code:" + code);
    if (!raw) {
      return corsResponse(JSON.stringify({ error: "That code is not valid or has expired. Request a new one." }), request, 400);
    }
    // Re-redeemable within TTL: do NOT delete, so users can re-enter after
    // installing the PWA (iOS wipes Safari storage on Add to Home Screen).
    const { token } = JSON.parse(raw);
    return corsResponse(JSON.stringify({ ok: true, token }), request, 200);
  } catch (e) {
    console.error("Code redeem KV error:", e);
    return corsResponse(JSON.stringify({ error: "Storage unavailable" }), request, 500);
  }
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
    medication: String(body.medication || "").slice(0, 60),
    dose: String(body.dose || "").slice(0, 20),
    shotDay: String(body.shotDay || "").slice(0, 20),
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
          message: "You have reached your 40 messages for today. Come back tomorrow.",
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
  // v000: the user can name their Companion. When a custom name is
  // sent, tell the model its name so it can call itself by it.
  // (Repo only: the live worker updates from the Cloudflare dashboard,
  // so the name-in-replies part waits for the next dashboard deploy.)
  if (typeof body.companionName === "string" && body.companionName.trim()) {
    systemPrompt += "\n\nYour name is " + body.companionName.trim().slice(0, 60) + ".";
  }
  const memKey = memoryKey(auth);
  if (memKey) {
    try {
      const raw = await env.USERS.get(memKey);
      if (raw) {
        const p = JSON.parse(raw);
        const parts = [];
        if (p.name) parts.push("The user's name is " + p.name + ".");
        if (p.medication) parts.push("Their GLP-1 medication: " + p.medication + (p.dose ? " " + p.dose : "") + (p.shotDay ? ", shot day " + p.shotDay : "") + ".");
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
  // Per-message GLP-1 context from the app (today's logged data).
  // Sent by the app with each chat message so replies can be specific.
  if (body.context && typeof body.context === "object") {
    const c = body.context;
    const ctx = [];
    if (c.medication) ctx.push("Medication: " + String(c.medication).slice(0, 60) + (c.dose ? " " + String(c.dose).slice(0, 20) : ""));
    if (c.shotDay) ctx.push("Shot day: " + String(c.shotDay).slice(0, 20));
    if (c.nextShot) ctx.push("Next shot: " + String(c.nextShot).slice(0, 40));
    if (typeof c.proteinLogged === "number" && typeof c.proteinTarget === "number") ctx.push("Protein today: " + c.proteinLogged + "g of " + c.proteinTarget + "g target");
    if (typeof c.movementMinutes === "number") ctx.push("Movement today: " + c.movementMinutes + " minutes");
    if (typeof c.waterOz === "number") ctx.push("Water today: " + c.waterOz + " oz");
    if (c.weightChange) ctx.push("Weight: " + String(c.weightChange).slice(0, 80));
    if (c.recentSideEffects) ctx.push("Recent side effects: " + String(c.recentSideEffects).slice(0, 300));
    if (ctx.length) {
      systemPrompt += "\n\nTheir GLP-1 context today (from their tracker, shared with this message):\n" + ctx.join("\n");
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
