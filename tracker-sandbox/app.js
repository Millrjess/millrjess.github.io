/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 */

/* A New Chapter Tracker - app logic. Data persists in localStorage on this device only. */

"use strict";

/* App version (v159): shown in Settings, About, so the version on the
   phone can be checked at a glance. Bump with every tracker-app change,
   together with CACHE_NAME in sw.js, the ?v= tokens in index.html, and
   version.json (the staleness check compares against this value). */
const APP_VERSION = "v000-features";

const LS_KEY = "newChapterTracker.sandbox.v1";
/* Generation counter for the store (v150): bumped on every successful
   save. An instance remembers the generation it loaded; if the saved
   generation changed since, another copy of the app saved newer entries,
   and this instance must merge instead of overwriting. This is what
   stops a stale or empty copy from silently wiping good data. */
const GEN_KEY = "nct-sandbox-store-gen";
let loadedGen = 0;
/* Set by a deliberate replace (restore from file or from a snapshot) so
   the empty-overwrite guard in saveStore() does not block it. One-shot:
   cleared after a successful save. */
let allowEmptySave = false;
/* Set when the saved store loaded with a collection dropped because it
   was the wrong shape. While set, saveStore() refuses to write, so the
   drop can never be made permanent before the user has seen the warning
   and checked Settings, Backup and restore. Cleared when the user taps
   "Got it" on the warning. */
let storeDamaged = false;
/* Names of collections validateStore() dropped on its most recent call
   (present but the wrong shape, or entries that were not objects). Read
   immediately after a validateStore() call; any later call overwrites it. */
let lastValidateDropped = [];

// Companion auth token storage (must be defined before any render calls)
const TOKEN_KEY = "newChapterTracker.sandbox.authToken.v1";
function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/* True when this device once held a Companion token. A lapsed
   subscription is told apart from one that never existed. */
function hadCompanionToken() {
  try { return localStorage.getItem(TOKEN_KEY + ".ever") === "1"; } catch { return false; }
}
function rememberCompanionToken() {
  try { localStorage.setItem(TOKEN_KEY + ".ever", "1"); } catch {}
}

const DEFAULTS = {
  settings: {
    medication: "Zepbound",
    dose: "",
    shotDay: "",
    waterGoal: 92,
    proteinGoal: 90,
    movementGoal: 30,
    carbGoal: 150, // v168: own carbs target for the Your Macros card
    fatGoal: 60, // v168: own fat target for the Your Macros card
    calorieTarget: "", // v169: optional daily calorie target for the macros card; blank means none, no default
    heightFt: "", // v168: feet, for BMI on the Weight tab
    heightIn: "", // v168: inches, for BMI on the Weight tab
    movementPlan: null, // v042: null or empty means no routine yet; the user picks their own moves; otherwise [{ name, detail }]
    routineMinutes: 5, // v004: minutes the daily routine is worth when finished
    customExercises: [], // v169: the user's own exercises [{ name, pattern, detail }], shown in the plan picker
    refillDate: "",
    goalWeight: "",
    startingWeight: null, // { value, date } frozen from the first weigh-in (K3); null until the first weigh-in
    companionName: "", // v000: the Companion's chosen name; blank means the default "AI Wellness Companion"
    companionAvatar: "gold", // v000: gold | sage | deep-gold | sage-tile
    theme: "sage", // v000: sage | dark | cream
    textSize: "normal", // v000: normal | large
    readAloud: false, // v000: read Companion replies aloud with the phone's own voice
    yourName: "" // v004: your own first name, for the greeting on Today; blank means just "Good morning."
  },
  water: [],        // { id, date: "YYYY-MM-DD", oz: number }
  protein: [],      // { id, date, grams, food, carbs, fat, calories } (carbs/fat added v168, calories v042; grams is protein)
  exercise: [],     // { id, date, minutes, label }
  strength: [],     // v033: { id, date, name, sets, reps, weight } strength exercises
  injections: [],   // { id, date, medication, dose, site, notes, status: "On time" | "Missed" | "Delayed" }
  weight: [],       // { id, date, value }
  measurements: [], // { id, date, waist, hips, chest, arm, thigh, neck }
  photos: [],       // { id, date, dataUrl }
  journal: [],      // { id, date, mood, notes }
  sideEffects: [],  // { id, date, symptom, severity, notes }
  moods: {},        // { "YYYY-MM-DD": "Good" }
  movementDone: {}, // v168: { "YYYY-MM-DD": { done: [move names], bonus: true/false } }
  recipes: [],      // sandbox: { id, title, body, date } saved recipes
  hiddenKitchen: [],  // [recipe id] built-in Kitchen recipes this user hid; ids only, never the recipes themselves
  foodLibrary: {},   // v028: foods already scanned, keyed by barcode: { barcode: { barcode, name, brand, protein, carbs, fat, calories, savedAt } }
  foodArchive: {}    // v031: archived foods, same entry shape as foodLibrary. Archiving never deletes a food.
};

/* v000: the Companion's chosen name and avatar. The variants are
   CSS tints of the existing gold lotus asset (exact-hex tinted PNGs
   were blocked by a file-write failure on this machine); the map
   centralizes them, so exact PNGs can drop in later by adding a src
   per variant. The default avatar is the gold lotus, unchanged.
   Defined up here (not in the chat section) because the Settings
   controls below reference it when the script first runs. */
const COMPANION_AVATARS = {
  "gold": { label: "Gold lotus", filter: "", tile: false },
  "sage": { label: "Sage lotus", filter: "avatar-sage", tile: false },
  "deep-gold": { label: "Deep gold lotus", filter: "avatar-deep-gold", tile: false },
  "sage-tile": { label: "Gold lotus on sage", filter: "", tile: true }
};
const COMPANION_DEFAULT_NAME = "AI Wellness Companion";
function companionDisplayName() {
  const n = (store.settings.companionName || "").trim();
  return n ? n : COMPANION_DEFAULT_NAME;
}
function companionAvatarImg(className) {
  const key = COMPANION_AVATARS[store.settings.companionAvatar] ? store.settings.companionAvatar : "gold";
  const v = COMPANION_AVATARS[key];
  const img = document.createElement("img");
  img.className = className || "chat-lotus";
  img.src = "icons/lotus-gold-only-transparent.png";
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  if (v.filter) img.classList.add(v.filter);
  if (v.tile) img.classList.add("avatar-tile");
  return img;
}

/* Collections that must be arrays, and the settings keys with their defaults.
   Used to validate anything loaded from storage or from a file (S3/S11). */
const COLLECTION_KEYS = ["water", "protein", "exercise", "strength", "injections", "weight", "measurements", "photos", "journal", "sideEffects", "recipes"];

/* Validate a parsed store shape: arrays must be arrays (bad entries dropped),
   settings must be an object merged key-by-key over the defaults so a bad or
   partial settings object can never wipe a goal, moods must be an object.
   Anything that is not an object at all is not a store; returns null.
   Strict mode (restore files) rejects the whole store when any key that is
   present has the wrong shape, instead of quietly repairing it into an
   empty store that would wipe the user's data (S11). */
function validateStore(parsed, strict) {
  lastValidateDropped = [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (strict) {
    for (const k of COLLECTION_KEYS) {
      if (parsed[k] !== undefined && (!Array.isArray(parsed[k]) || parsed[k].some((e) => !e || typeof e !== "object"))) return null;
    }
    if (parsed.settings !== undefined && (typeof parsed.settings !== "object" || Array.isArray(parsed.settings))) return null;
    if (parsed.moods !== undefined && (typeof parsed.moods !== "object" || Array.isArray(parsed.moods))) return null;
  }
  const out = structuredClone(DEFAULTS);
  COLLECTION_KEYS.forEach((k) => {
    if (parsed[k] === undefined) return; // missing is fine: a fresh or older store
    if (!Array.isArray(parsed[k])) { lastValidateDropped.push(k); return; } // present but the wrong shape: dropped, and recorded (v150)
    const kept = [];
    for (const e of parsed[k]) {
      if (!e || typeof e !== "object") continue;
      // A bad date bricks every tab that sorts or formats it (formatDate
      // and localeCompare both throw on a non-string date). Drop the one
      // entry, keep the rest, and record the loss.
      if (!isValidDateStr(e.date)) continue;
      e.id = safeEntryId(e);
      // A photo URL that is not an in-app data URL would load a remote
      // image from the app's origin. Strip it; keep the dated entry.
      if (k === "photos" && e.dataUrl !== undefined && !(typeof e.dataUrl === "string" && e.dataUrl.startsWith("data:image/"))) {
        delete e.dataUrl;
      }
      // v168: carbs and fat ride on protein entries, the same entry
      // pattern as protein grams. Sanitize to non-negative numbers;
      // anything else becomes 0 so a bad value can never break the
      // macros card.
      if (k === "protein") {
        e.carbs = Number.isFinite(Number(e.carbs)) && Number(e.carbs) >= 0 ? Number(e.carbs) : 0;
        e.fat = Number.isFinite(Number(e.fat)) && Number(e.fat) >= 0 ? Number(e.fat) : 0;
        e.calories = Number.isFinite(Number(e.calories)) && Number(e.calories) >= 0 ? Number(e.calories) : 0;
      }
      // v033: strength entries keep a name and counts only; sets and
      // reps are whole numbers of at least 1, weight is pounds or
      // blank, so a bad value can never break the strength list.
      if (k === "strength") {
        e.name = typeof e.name === "string" ? e.name.trim().slice(0, 80) : "";
        if (!e.name) continue;
        e.sets = Number.isFinite(Number(e.sets)) ? Math.max(1, Math.round(Number(e.sets))) : 1;
        e.reps = Number.isFinite(Number(e.reps)) ? Math.max(1, Math.round(Number(e.reps))) : 1;
        const wgt = Number(e.weight);
        e.weight = (e.weight === "" || e.weight === undefined || e.weight === null) ? "" : (Number.isFinite(wgt) && wgt >= 0 ? wgt : "");
      }
      kept.push(e);
    }
    if (kept.length !== parsed[k].length) lastValidateDropped.push(k);
    out[k] = kept;
  });
  if (parsed.settings !== undefined && (typeof parsed.settings !== "object" || Array.isArray(parsed.settings))) {
    lastValidateDropped.push("settings");
  } else if (parsed.settings && typeof parsed.settings === "object" && !Array.isArray(parsed.settings)) {
    Object.keys(DEFAULTS.settings).forEach((k) => {
      if (parsed.settings[k] !== undefined) out.settings[k] = parsed.settings[k];
    });
    // Settings come from a file on restore, so a bad value must not be
    // able to break the countdowns or the settings form.
    const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    if (typeof out.settings.shotDay !== "string" || (out.settings.shotDay !== "" && !dayNames.includes(out.settings.shotDay))) out.settings.shotDay = "";
    if (typeof out.settings.refillDate !== "string" || (out.settings.refillDate !== "" && !isValidDateStr(out.settings.refillDate))) out.settings.refillDate = "";
    for (const g of ["waterGoal", "proteinGoal", "movementGoal", "carbGoal", "fatGoal", "routineMinutes"]) {
      const n = Number(out.settings[g]);
      out.settings[g] = Number.isFinite(n) && n > 0 ? n : DEFAULTS.settings[g];
    }
    // v169: the calorie target is optional; blank stays blank (no
    // default), and a bad value is dropped, not coerced, so snapshot
    // dedup after a restore does not break. (Number("") is 0, so the
    // raw value must be checked first, same as the height fix.)
    const ctRaw = out.settings.calorieTarget;
    out.settings.calorieTarget = (ctRaw === "" || ctRaw === undefined || ctRaw === null) ? ""
      : (Number.isFinite(Number(ctRaw)) && Number(ctRaw) > 0 ? Math.round(Number(ctRaw)) : "");
    // v168: height in feet and inches, for BMI on the Weight tab. Blank
    // stays blank; anything out of range is dropped. (Number("") is 0,
    // so the raw value must be checked first, or a blank height turns
    // into 0 and breaks the snapshot dedup after a restore.)
    const hftRaw = out.settings.heightFt;
    const hft = hftRaw === "" || hftRaw === undefined || hftRaw === null ? NaN : Number(hftRaw);
    out.settings.heightFt = Number.isFinite(hft) && hft >= 0 && hft <= 8 ? hft : "";
    const hinRaw = out.settings.heightIn;
    const hin = hinRaw === "" || hinRaw === undefined || hinRaw === null ? NaN : Number(hinRaw);
    out.settings.heightIn = Number.isFinite(hin) && hin >= 0 && hin <= 11 ? hin : "";
    // v168: the custom movement plan, or null for the default routine.
    // Kept as [{ name, detail }] only; anything else falls back to null.
    const mp = out.settings.movementPlan;
    if (mp === null || mp === undefined) {
      out.settings.movementPlan = null;
    } else if (Array.isArray(mp)) {
      const clean = mp.filter((m) => m && typeof m === "object" && typeof m.name === "string" && m.name.trim() !== "")
        .slice(0, 20)
        .map((m) => ({ name: String(m.name).trim().slice(0, 80), detail: typeof m.detail === "string" ? m.detail.trim().slice(0, 40) : "" }));
      out.settings.movementPlan = clean.length ? clean : null;
    } else {
      out.settings.movementPlan = null;
    }
    // v169: the user's own exercises. Kept as [{ name, pattern, detail }]
    // only; anything else is dropped. A bad pattern falls back to Other.
    const ce = out.settings.customExercises;
    if (ce === null || ce === undefined) {
      out.settings.customExercises = [];
    } else if (Array.isArray(ce)) {
      const patterns = ["Squat", "Hinge", "Push", "Pull", "Carry", "Core", "Other"];
      out.settings.customExercises = ce.filter((m) => m && typeof m === "object" && typeof m.name === "string" && m.name.trim() !== "")
        .slice(0, 50)
        .map((m) => ({
          name: String(m.name).trim().slice(0, 80),
          pattern: patterns.includes(m.pattern) ? m.pattern : "Other",
          detail: typeof m.detail === "string" ? m.detail.trim().slice(0, 40) : ""
        }));
    } else {
      out.settings.customExercises = [];
    }
    // v000: the Companion's chosen name and avatar, the Appearance
    // theme and text size, and the read-aloud setting. All private, all
    // on this device. A bad value falls back to the default.
    const cn = out.settings.companionName;
    out.settings.companionName = typeof cn === "string" ? cn.trim().slice(0, 60) : "";
    const yn = out.settings.yourName;
    out.settings.yourName = typeof yn === "string" ? yn.trim().slice(0, 60) : "";
    const ca = out.settings.companionAvatar;
    out.settings.companionAvatar = ["gold", "sage", "deep-gold", "sage-tile"].includes(ca) ? ca : "gold";
    const th = out.settings.theme;
    out.settings.theme = ["sage", "dark", "cream"].includes(th) ? th : "sage";
    const ts = out.settings.textSize;
    out.settings.textSize = ["normal", "large"].includes(ts) ? ts : "normal";
    out.settings.readAloud = out.settings.readAloud === true;
    const gw = Number(out.settings.goalWeight);
    out.settings.goalWeight = Number.isFinite(gw) && gw > 0 ? gw : "";
    // Frozen starting weight (K3): null, or { value, date } with a positive
    // number and a valid date. Anything else is dropped to null so a bad
    // value can never break the weight display.
    const sw = out.settings.startingWeight;
    if (sw !== null && sw !== undefined) {
      if (typeof sw !== "object" || Array.isArray(sw) || !Number.isFinite(Number(sw.value)) || Number(sw.value) <= 0 || !isValidDateStr(sw.date)) {
        out.settings.startingWeight = null;
      } else {
        out.settings.startingWeight = { value: Number(sw.value), date: sw.date };
      }
    } else {
      out.settings.startingWeight = null;
    }
    if (out.settings.medication !== undefined) out.settings.medication = String(out.settings.medication);
    if (out.settings.dose !== undefined) {
      out.settings.dose = Number.isFinite(Number(out.settings.dose)) && String(out.settings.dose).trim() !== "" ? String(out.settings.dose) : "";
    }
  }
  if (parsed.moods !== undefined && (typeof parsed.moods !== "object" || Array.isArray(parsed.moods))) {
    lastValidateDropped.push("moods");
  } else if (parsed.moods && typeof parsed.moods === "object" && !Array.isArray(parsed.moods)) {
    // Keep only real dates with string moods; a crafted key could
    // otherwise inflate the logged-days count or break the export.
    const cleanMoods = {};
    for (const [d, m] of Object.entries(parsed.moods)) {
      if (isValidDateStr(d) && typeof m === "string") cleanMoods[d] = m;
    }
    out.moods = cleanMoods;
  }
  // v168: per-day movement routine state. Keep only real dates; each
  // day holds the move names done and whether the 5-minute bonus was
  // logged for that day.
  if (parsed.movementDone !== undefined && (typeof parsed.movementDone !== "object" || Array.isArray(parsed.movementDone))) {
    lastValidateDropped.push("movementDone");
  } else if (parsed.movementDone && typeof parsed.movementDone === "object" && !Array.isArray(parsed.movementDone)) {
    const cleanDone = {};
    for (const [d, v] of Object.entries(parsed.movementDone)) {
      if (!isValidDateStr(d) || !v || typeof v !== "object" || Array.isArray(v)) continue;
      cleanDone[d] = {
        done: Array.isArray(v.done) ? v.done.filter((n) => typeof n === "string") : [],
        bonus: v.bonus === true
      };
    }
    out.movementDone = cleanDone;
  }
  // v049: the Medicines tab was removed. Any stored entries and per-day
  // check-offs are dropped on load: they are never copied into the
  // store, so the next save removes them from the device for good.
  // v028: food library, keyed by barcode or by name ("name:..."). Keep
  // only entries with a key and a name; sanitize the macros to
  // non-negative numbers. A bad value drops the whole library, not a crash.
  if (parsed.foodLibrary !== undefined && (typeof parsed.foodLibrary !== "object" || Array.isArray(parsed.foodLibrary))) {
    lastValidateDropped.push("foodLibrary");
  } else if (parsed.foodLibrary && typeof parsed.foodLibrary === "object" && !Array.isArray(parsed.foodLibrary)) {
    const cleanLib = {};
    for (const [code, f] of Object.entries(parsed.foodLibrary)) {
      if (!f || typeof f !== "object" || Array.isArray(f)) continue;
      const barcode = typeof f.barcode === "string" && f.barcode.trim() !== "" ? f.barcode.trim().slice(0, 40) : String(code).trim().slice(0, 40);
      if (!barcode || typeof f.name !== "string" || f.name.trim() === "") continue;
      const num = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
      cleanLib[barcode] = {
        barcode,
        name: f.name.trim().slice(0, 120),
        brand: typeof f.brand === "string" ? f.brand.trim().slice(0, 80) : "",
        protein: num(f.protein),
        carbs: num(f.carbs),
        fat: num(f.fat),
        calories: num(f.calories),
        savedAt: Number.isFinite(Number(f.savedAt)) ? Number(f.savedAt) : 0
      };
    }
    out.foodLibrary = cleanLib;
  }
  // v031: food archive, same entry shape as the library. A bad value
  // drops the whole archive, not a crash.
  if (parsed.foodArchive !== undefined && (typeof parsed.foodArchive !== "object" || Array.isArray(parsed.foodArchive))) {
    lastValidateDropped.push("foodArchive");
  } else if (parsed.foodArchive && typeof parsed.foodArchive === "object" && !Array.isArray(parsed.foodArchive)) {
    const cleanArch = {};
    for (const [code, f] of Object.entries(parsed.foodArchive)) {
      if (!f || typeof f !== "object" || Array.isArray(f)) continue;
      const barcode = typeof f.barcode === "string" && f.barcode.trim() !== "" ? f.barcode.trim().slice(0, 40) : String(code).trim().slice(0, 40);
      if (!barcode || typeof f.name !== "string" || f.name.trim() === "") continue;
      const num = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
      cleanArch[barcode] = {
        barcode,
        name: f.name.trim().slice(0, 120),
        brand: typeof f.brand === "string" ? f.brand.trim().slice(0, 80) : "",
        protein: num(f.protein),
        carbs: num(f.carbs),
        fat: num(f.fat),
        calories: num(f.calories),
        savedAt: Number.isFinite(Number(f.savedAt)) ? Number(f.savedAt) : 0
      };
    }
    out.foodArchive = cleanArch;
  }
  // Hidden Kitchen recipes: ids only, kept as a deduped list of
  // non-empty strings, at most 200. An id that no longer exists in
  // KITCHEN_RECIPES is harmless and is ignored at render time, never
  // an error. Not in COLLECTION_KEYS: that loop drops entries
  // without a valid date, and these are plain strings.
  if (parsed.hiddenKitchen !== undefined && !Array.isArray(parsed.hiddenKitchen)) {
    lastValidateDropped.push("hiddenKitchen");
  } else if (Array.isArray(parsed.hiddenKitchen)) {
    const seen = new Set();
    out.hiddenKitchen = parsed.hiddenKitchen.filter((id) => typeof id === "string" && id.trim() !== "" && !seen.has(id) && seen.add(id)).slice(0, 200);
  }
  return out;
}

/* Older entries saved before per-entry delete existed may lack ids. Give them one.
   Covers every collection, and returns true when an id was added so the
   caller can save the repaired store (F27). */
function ensureEntryIds() {
  let changed = false;
  COLLECTION_KEYS.forEach((key) => {
    if (!Array.isArray(store[key])) return;
    store[key].forEach((e) => {
      if (e && typeof e === "object" && !e.id) { e.id = uid(); changed = true; }
    });
  });
  return changed;
}

/* Set when the saved store cannot be parsed. While it is set, saveStore()
   refuses to overwrite the saved copy with untouched empty defaults, so a
   bad load can never silently destroy good saved data. Deliberate empty
   restores clear it first (see the restore handlers); Delete all my data
   removes the keys directly and never goes through saveStore.
   Declared BEFORE the first loadStore() call: loadStore() assigns it, so
   it must already be initialized when the store first loads. */
let loadFailed = false;

/* Safety net (Nov 5, 2026): the main store once came up empty while the
   in-app snapshots survived. Set by maybeRestoreFromSnapshot() when it
   restores the newest non-empty snapshot; renderRestoreNotice() tells the
   user. A deliberate delete removes the snapshots too, so it is never
   resurrected by this check. */
let restoredFromSnapshot = null;

let store = loadStore();
ensureEntryIds();
syncStartingWeight(); // K3: freeze the starting weight from the first weigh-in on load

function loadStore() {
  try { loadedGen = Number(localStorage.getItem(GEN_KEY)) || 0; } catch { loadedGen = 0; }
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const valid = validateStore(parsed);
    if (!valid) {
      // Readable JSON, but not a tracker store at all: treat it as corrupt
      // rather than silently adopting it.
      loadFailed = true;
      try { localStorage.setItem(LS_KEY + ".corrupt", raw); } catch {}
      return structuredClone(DEFAULTS);
    }
    // v150: a collection that was present but the wrong shape was dropped
    // by validateStore. Say so loudly and block saves until the user has
    // seen the warning, instead of letting the next save make the drop
    // permanent without a word.
    if (lastValidateDropped.length) {
      storeDamaged = true;
      try { localStorage.setItem(LS_KEY + ".corrupt", raw); } catch {}
    }
    return valid;
  } catch (e) {
    // Keep the unreadable copy aside instead of silently losing it.
    loadFailed = true;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) localStorage.setItem(LS_KEY + ".corrupt", raw);
    } catch {}
    return structuredClone(DEFAULTS);
  }
}

/* True when the last save could not be written. Shown as a plain-words
   banner on the Today tab (see showStorageWarning). */
let saveFailed = false;

function showStorageWarning(text) {
  const card = document.getElementById("storage-warning");
  const line = document.getElementById("storage-warning-text");
  if (!card || !line) return;
  line.textContent = text;
  card.classList.remove("hidden");
}

/* v150: another copy of the app (another tab or window) changed the saved
   entries. Say so instead of letting this copy quietly overwrite them;
   the generation check in saveStore() merges the two copies on the next
   save. */
window.addEventListener("storage", (e) => {
  if (e.key === LS_KEY) {
    showStorageWarning("This app is open in two places, and the other copy changed your entries. Your entries are safe and will show here the next time you save.");
  }
});

/* Combine two copies of the store without losing any entry: the newer
   (persisted) copy wins for settings, and every entry that exists in
   either copy is kept, matched by id. A delete made in one copy can come
   back if the other copy still has it; that is the safe direction, losing
   nothing beats losing an entry. Used when two copies of the app saved
   at the same time. */
function mergeStores(persisted, local) {
  const out = structuredClone(persisted);
  // K3: the frozen starting weight is a fact, not a setting to overwrite.
  // Keep whichever copy has one; the persisted copy wins only when both do.
  if (!out.settings) out.settings = structuredClone(DEFAULTS.settings);
  if (!out.settings.startingWeight && local.settings && local.settings.startingWeight) {
    out.settings.startingWeight = local.settings.startingWeight;
  }
  COLLECTION_KEYS.forEach((k) => {
    const have = new Set((persisted[k] || []).map((e) => e && e.id).filter(Boolean));
    (local[k] || []).forEach((e) => {
      if (!e || typeof e !== "object") return;
      if (!e.id) e.id = uid();
      if (!have.has(e.id)) { out[k].push(e); have.add(e.id); }
    });
  });
  out.moods = Object.assign({}, local.moods || {}, persisted.moods || {});
  // v168: routine done-state merges the same way: a day done in either
  // copy stays done.
  out.movementDone = Object.assign({}, local.movementDone || {}, persisted.movementDone || {});
  // v028: food library merges by barcode; a food saved in either copy
  // is kept, and the persisted copy wins when both have the same barcode.
  out.foodLibrary = Object.assign({}, local.foodLibrary || {}, persisted.foodLibrary || {});
  // v031: food archive merges the same way as the library.
  out.foodArchive = Object.assign({}, local.foodArchive || {}, persisted.foodArchive || {});
  // Hidden Kitchen recipes merge as a union: a hide made in either
  // copy stays hidden.
  out.hiddenKitchen = Array.from(new Set([...(persisted.hiddenKitchen || []), ...(local.hiddenKitchen || [])].filter((id) => typeof id === "string" && id !== "")));
  return out;
}

/* Read the generation the saved copy is on now, so a deliberate replace
   (restore) can adopt it and write as the newest copy. */
function adoptCurrentGen() {
  try { loadedGen = Number(localStorage.getItem(GEN_KEY)) || 0; } catch { loadedGen = 0; }
}

/* Compare two settings objects for the save guard, ignoring the frozen
   starting weight (K3): it is derived from the weight log, not a user
   preference, so clearing it when the log is emptied must not look like
   a fresh start. */
function settingsEqualIgnoringFreeze(a, b) {
  if (!a || !b) return false;
  const strip = (s) => { const c = Object.assign({}, s); delete c.startingWeight; return c; };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function saveStore() {
  try {
    // Read the saved copy before writing, so this save never blindly
    // overwrites a newer one.
    let persistedRaw = null;
    let persistedGen = 0;
    let persistedCount = -1;
    let persistedStore = null;
    try { persistedRaw = localStorage.getItem(LS_KEY); } catch {}
    try { persistedGen = Number(localStorage.getItem(GEN_KEY)) || 0; } catch {}
    if (persistedRaw) {
      try {
        persistedStore = validateStore(JSON.parse(persistedRaw));
        persistedCount = persistedStore ? countStoreEntries(persistedStore) : -1;
      } catch { persistedCount = -1; }
    }
    // (0) A delete in another copy wins over this copy's stale entries.
    // The delete leaves a marker stamped with its generation. Any copy
    // that loaded before the delete (loadedGen < marker) adopts the
    // persisted store instead of merging its stale entries back in, so
    // a delete can never be undone by a tab that was open at the time.
    // The marker is never cleared by a save: a copy that loaded after
    // the delete has loadedGen >= marker and is never affected by it.
    let tombstoneGen = 0;
    try { tombstoneGen = Number(localStorage.getItem("nct-sandbox-store-tombstone")) || 0; } catch {}
    if (tombstoneGen > 0 && loadedGen < tombstoneGen) {
      store = persistedStore || structuredClone(DEFAULTS);
      loadFailed = false;
      storeDamaged = false;
      allowEmptySave = true;
      loadedGen = persistedGen;
      showStorageWarning("Your data was deleted in another window or tab. This copy was cleared to match. If that was a mistake, a safety copy is in Settings, then Backup and restore.");
      return true; // the delete stands; nothing to write
    }
    // (1) Another copy saved since this one loaded: merge instead of
    // overwriting, so no entry from either copy is lost.
    if (persistedGen !== loadedGen) {
      if (persistedStore) {
        store = mergeStores(persistedStore, store);
        showStorageWarning("This app is open in two places, and the other copy changed your entries. The two copies were combined, so nothing was lost. Your entries will show here the next time you save.");
      }
    }
    // (2) A smaller in-memory store never replaces a saved store that
    // has more entries. A deliberate empty restore sets allowEmptySave
    // first. A user deleting entries keeps her own settings, which is how
    // a deliberate deletion is told apart from a fresh start: a fresh
    // start has default settings while the saved copy has hers. When the
    // settings match, the smaller store is deliberate and the save is
    // allowed. When they differ, merge the two copies instead of
    // refusing: the merged copy holds every entry from both, so the
    // change is kept and nothing is lost. The frozen starting weight
    // (K3) is left out of the comparison: it is derived from the weight
    // log, not a user preference, so clearing it when the log is emptied
    // must not look like a fresh start.
    const myCount = countStoreEntries(store);
    if (persistedCount > myCount && !allowEmptySave) {
      let settingsMatch = false;
      try {
        settingsMatch = !!persistedStore && settingsEqualIgnoringFreeze(store.settings, persistedStore.settings);
      } catch {}
      if (!settingsMatch && persistedStore) {
        store = mergeStores(persistedStore, store);
        loadedGen = persistedGen;
        showStorageWarning("This app is open in two places, and the other copy changed your entries. The two copies were combined, so nothing was lost. Your entries will show here the next time you save.");
      }
    }
    // (3) A collection was dropped at load because it was damaged: do not
    // let a save make the drop permanent before the user has seen the
    // warning and checked Settings, Backup and restore.
    if (storeDamaged) {
      showStorageWarning("Some of your saved entries could not be read. Before adding new entries, check Settings, then Backup and restore, for a backup to restore.");
      return false;
    }
    // Second layer of the safety net: if this load could not read the saved
    // store and nothing has changed since, do not overwrite the saved copy
    // with empty defaults.
    if (loadFailed && countStoreEntries(store) === 0) {
      let unchanged = false;
      try { unchanged = JSON.stringify(store) === JSON.stringify(DEFAULTS); } catch {}
      if (unchanged) {
        if (persistedRaw) return true; // nothing to write; saved copy is intact
      }
    }
    localStorage.setItem(LS_KEY, JSON.stringify(store));
    try {
      const g = (Number(localStorage.getItem(GEN_KEY)) || 0) + 1;
      localStorage.setItem(GEN_KEY, String(g));
      loadedGen = g;
    } catch {}
  } catch (e) {
    // Storage full or unavailable: say so in plain words instead of
    // failing silently. The app keeps working in memory.
    saveFailed = true;
    showStorageWarning("Your latest change could not be saved on this device. It may be out of space. Try downloading a backup from Settings, then deleting a few old photos.");
    return false;
  }
  saveFailed = false;
  allowEmptySave = false; // one-shot flag, consumed by a successful save
  // v150: remember that this copy once held entries, so a later empty
  // load can be told apart from a first day.
  try { if (countStoreEntries(store) > 0) localStorage.setItem("nct-sandbox-ever-had-entries", "1"); } catch {}
  saveAutoSnapshot();
  return true;
}

/* How many in-app snapshots to keep (3 restore points, her call Nov 6, 2026). */
const SNAPSHOT_KEEP = 3;
/* Warn when a snapshot is this large; photos are stripped before saving. */
const SNAPSHOT_WARN_BYTES = 2000000;

/* Build the JSON for a snapshot. Photo pictures are left out (only the date
   is kept) because base64 photos are what push a snapshot over the size
   limit; everything else is saved in full, so a too-large store still gets
   a usable snapshot of all its non-photo data (S9). */
function buildSnapshotRaw(s) {
  const stripped = Object.assign({}, s, {
    photos: (Array.isArray(s.photos) ? s.photos : []).map((p) => ({ id: p.id, date: p.date, photo: true })),
    /* Food photos are stripped the same way: keep a flag, not the picture,
       so a snapshot stays small. The picture itself lives only in the
       live store, never in a snapshot. */
    protein: (Array.isArray(s.protein) ? s.protein : []).map((e) => {
      if (!e.photo) return e;
      const copy = Object.assign({}, e);
      copy.photo = true;
      return copy;
    })
  });
  const raw = JSON.stringify(stripped);
  const foodPhotosOmitted = (Array.isArray(s.protein) ? s.protein : []).some((e) => !!e.photo);
  return { raw, photosOmitted: ((Array.isArray(s.photos) ? s.photos.length : 0) > 0) || foodPhotosOmitted, nearCap: raw.length > SNAPSHOT_WARN_BYTES };
}

/* Automatic snapshot (v150): a backup copy inside the app, saved on
   every change while there is data to back up, not just once a day. A
   once-a-day copy can be a whole day behind, and a failed save used to
   be swallowed silently. Identical copies are skipped, so a day of small
   edits does not fill the list with duplicates. A failed snapshot is now
   shown in plain words instead of failing silently. v163: at most 3
   backups saved per day, her call Nov 6, 2026. Once 3 are saved today,
   later changes wait for tomorrow's first backup. */
function saveAutoSnapshot() {
  try {
    if (countStoreEntries(store) === 0) return;
    const built = buildSnapshotRaw(store);
    if (built.nearCap) showStorageWarning("Your saved data is getting large. Download a backup from Settings to keep everything safe.");
    const snaps = loadSnapshots();
    const today = todayStr();
    const localDay = (iso) => {
      try {
        const d = new Date(iso);
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      } catch { return ""; }
    };
    const savedToday = snaps.filter((s) => localDay(s.at) === today).length;
    if (savedToday >= 3) return;
    if (snaps.length) {
      // Same content as the newest snapshot: do not create a duplicate.
      // The comparison leaves out the frozen starting weight (K3): it is
      // derived from the weight log, so a snapshot that predates the freeze
      // has the same entries but no startingWeight key. Without this,
      // restoring such a snapshot would immediately create a duplicate.
      let same = false;
      try {
        const prev = JSON.parse(snaps[0].data);
        const cur = JSON.parse(built.raw);
        if (prev.settings) delete prev.settings.startingWeight;
        if (cur.settings) delete cur.settings.startingWeight;
        same = JSON.stringify(prev) === JSON.stringify(cur);
      } catch { same = false; }
      if (same) {
        try { localStorage.setItem("nct-sandbox-last-snapshot-day", todayStr()); } catch {}
        return;
      }
    }
    snaps.unshift({ at: new Date().toISOString(), data: built.raw });
    while (snaps.length > SNAPSHOT_KEEP) snaps.pop();
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
    localStorage.setItem("nct-sandbox-last-snapshot-day", todayStr());
  } catch {
    showStorageWarning("A backup copy could not be saved inside this app. Your entries are still saved. Download a backup from Settings, then Backup and restore, to keep a copy.");
  }
}

/* Safety snapshot taken right before a restore or a delete, labelled so the
   list in Settings says what it is. Bypasses the once-a-day guard (S6/S14). */
function takeSafetySnapshot(label) {
  try {
    if (countStoreEntries(store) === 0) return false;
    const built = buildSnapshotRaw(store);
    const snaps = loadSnapshots();
    snaps.unshift({ at: new Date().toISOString(), data: built.raw, label });
    while (snaps.length > SNAPSHOT_KEEP) snaps.pop();
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
    return true;
  } catch { return false; }
}

/* Week-dismiss keys ("nct-week-dismiss:...") pile up over time; clear them
   after a restore or a delete-all so old weeks never linger (S14/F39). */
function clearWeekDismissKeys() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("nct-sandbox-week-dismiss:") === 0) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

/* Reset the bits of on-screen state a restore or delete leaves behind:
   which day is shown (F39). */
function resetViewState() {
  viewOffset = 0;
  editingInjectionId = null;
  editingWeightId = null;
  editingMeasId = null;
  editingJournalId = null;
  editingSeId = null;
  clearWeekDismissKeys();
}

function uid() {
  return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// A date string the app can trust: YYYY-MM-DD, a real calendar date.
// Anything else (a number, garbage, a crafted restore value) must never
// reach formatDate() or a sort, because both throw on non-string dates.
function isValidDateStr(s) {
  if (typeof s !== "string") return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

// An entry id is interpolated into double-quoted HTML attributes, so it
// must never contain a character that can break out of one (" < > ` = or
// whitespace). Legitimate ids (uid() output) pass unchanged; a number is
// stringified; anything dangerous is replaced with a fresh safe id.
function safeEntryId(e) {
  if (typeof e.id === "number" && Number.isFinite(e.id)) return String(e.id);
  if (typeof e.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(e.id)) return e.id;
  return uid();
}

// Date comparators that never throw, even if an entry somehow carries a
// non-string date. Use these everywhere instead of inline localeCompare.
function byDate(a, b) { return String((a && a.date) || "").localeCompare(String((b && b.date) || "")); }
function byDateDesc(a, b) { return byDate(b, a); }

/* Local-midnight helpers (S22): day differences must be counted in whole
   local days, not by dividing a millisecond span, or a daylight-saving
   change can shift the count by one. */
function localMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function daysBetween(aISO, bISO) {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  return Math.round((localMidnight(b) - localMidnight(a)) / 86400000);
}

function todayStr(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

/* Local YYYY-MM-DD string for any Date object (v168: used by the
   doctor summary for the 90-day and 30-day cutoffs). */
function localDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function formatDate(iso) {
  // Defensive: a bad date must render as blank, never throw (a throw
  // here would tear the whole tab). Entries are date-validated on load,
  // but a snapshot or a merged copy can still carry a bad one.
  if (!iso || typeof iso !== "string") return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatDateShort(iso) {
  // Same as formatDate, without the year: "Nov 11". Used where space is
  // tight, for example the Next shot line on Today.
  if (!iso || typeof iso !== "string") return "";
  const parts = iso.split("-");
  if (parts.length !== 3) return "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}


function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Daily encouragement: rotate through supportive messages by day of year */

const ENCOURAGEMENTS = [
  "Strong, not small. Protein first, every day.",
  "Muscle is longevity. Every gram of protein protects it.",
  "You showed up today. That matters most.",
  "Consistency beats perfection.",
  "Energy is the real goal. The rest follows.",
  "This is your chapter. Write it strong.",
  "Be patient with your body. It has carried you far.",
  "Small habits, repeated daily, last.",
  "Progress is not always visible, but it is happening.",
  "You earned the wisdom. Your body is catching up.",
  "Protein at every meal protects a lot.",
  "Water first. The rest of the day feels easier.",
  "Movement counts, even a short walk.",
  "Your routine keeps the progress steady.",
  "Strength grows quietly, day by day.",
  "Rest is part of training, not a break from it.",
  "You are not starting over. You are continuing.",
  "A slow day still counts. One good habit is enough.",
  "Celebrate what your body can do, not what the scale says.",
  "One good meal, one good walk, one good sleep. Enough for today.",
  "Muscle protects your independence. Worth the effort.",
  "Keep your routine simple enough to repeat.",
  "Progress needs persistence, not perfection.",
  "Water, protein, movement. Let the rest follow.",
  "Today is a new chapter, not a test.",
  "Good days are built, one choice at a time.",
  "Your strength is not measured by one weigh-in.",
  "Take care of the body that carries your life.",
  "You are doing this for your life, not for a number.",
  "Strong today, stronger tomorrow."
];

function renderEncouragement() {
  const el = document.getElementById("encouragement-text");
  if (!el) return;
  /* v052: when food is logged today, the greeting says so, plainly.
     Borrowed from the macro-screens inspiration ("Keep it up! You
     have tracked 6 meals for today"), in the app's own words. */
  const entriesToday = (store.protein || []).filter((e) => e.date === viewedDateStr()).length;
  if (entriesToday > 0) {
    el.textContent = "Keep it up. You have logged " + entriesToday + (entriesToday === 1 ? " food" : " foods") + " today.";
    return;
  }
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.round((localMidnight(now) - localMidnight(start)) / 86400000);
  el.textContent = ENCOURAGEMENTS[dayOfYear % ENCOURAGEMENTS.length];
}

/* ---------- Tab navigation (v168: five tabs; Effects, Companion and
   Settings live under More) ---------- */

/* v079: only the real tabs are in this list. More is a plain button
   (role button, not tab) that opens a dialog, so it is selected by
   [role='tab'] and excluded here; arrow keys move among the five real
   tabs only, and More is reached by Tab. */
const tabButtons = document.querySelectorAll(".tab-btn[role='tab']");
const panels = document.querySelectorAll(".tab-panel");
/* Panels that live under the More button: when one of them is showing,
   More is the active tab. Kitchen is a direct tab now (v079), so
   "recipes" is not here; Journal moved under More (v079). */
const MORE_TABS = ["side-effects", "settings", "journal", "help"];

function showTab(name) {
  // v049: Settings autosaves, so leaving the tab flushes any change
  // typed in the last few hundred milliseconds instead of dropping it.
  if (typeof autosaveSettings === "function") {
    const activePanel = document.querySelector(".tab-panel.active");
    if (activePanel && activePanel.id === "tab-settings" && name !== "settings") {
      clearTimeout(settingsAutosaveTimer);
      autosaveSettings();
    }
  }
  if (name === "more") { openMoreSheet(); return; }
  closeMoreSheet();
  // v000: navigating away from the Companion stops any reply being
  // read aloud.
  if (name !== "chat") stopSpeaking();
  /* v079: "progress" (Your week) is a Today sub-view, so Today stays
     the active tab while viewing it. A More panel lights up More. */
  const activeTab = name === "progress" ? "today" : (MORE_TABS.includes(name) ? "more" : name);
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === activeTab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  /* v079: More is a plain button, not a tab, so it is not in tabButtons.
     Light it up here when a More panel is showing. */
  const moreBtn = document.querySelector('.tab-btn[data-tab="more"]');
  if (moreBtn) moreBtn.classList.toggle("active", MORE_TABS.includes(name));
  panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  /* v052: cards fade in gently when a tab opens. The class goes on in
     the same frame the panel appears, so the cards start at opacity 0
     with no transition, then ease to full over 0.25s. Reduced motion
     makes it instant. */
  const newPanel = document.getElementById("tab-" + name);
  if (newPanel) {
    newPanel.classList.add("tab-fading");
    void newPanel.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => newPanel.classList.remove("tab-fading")));
  }
  window.scrollTo(0, 0);
  if (name === "weight") { drawWeightChart(); }
  if (name === "shots") { renderInjectionCalendar(); renderRefillCountdown(); }
  if (name === "journal") renderMood();
  if (name === "chat") { loadCoachMemory(); renderChat(); }
  if (name === "settings") { renderPlaySubscription(); loadCoachMemory(); }
  if (name === "recipes") renderRecipes();
  try {
    gtag("event", "page_view", {
      page_title: "Tracker - " + name,
      // The URL can carry the companion token in ?key=...; report only
      // the path and tab, never the query string.
      page_location: location.origin + location.pathname + "#" + name,
      page_path: "/tracker-app/#" + name
    });
  } catch (e) { /* analytics unavailable; app keeps working */ }
}

tabButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
/* v079: the More button is not a tab; it opens the More sheet directly. */
const moreTabBtn = document.querySelector('.tab-btn[data-tab="more"]');
if (moreTabBtn) moreTabBtn.addEventListener("click", openMoreSheet);
tabButtons.forEach((b, i) => b.addEventListener("keydown", (e) => {
  let next = null;
  if (e.key === "ArrowRight") next = (i + 1) % tabButtons.length;
  else if (e.key === "ArrowLeft") next = (i - 1 + tabButtons.length) % tabButtons.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabButtons.length - 1;
  if (next === null) return;
  e.preventDefault();
  tabButtons[next].focus();
  showTab(tabButtons[next].dataset.tab);
}));

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => showTab(el.dataset.goto));
});

/* Open Settings scrolled to one card. A closed details card opens
   first. Used by the BMI button and the Companion banner. */
function openSettingsAt(cardId) {
  showTab("settings");
  const el = document.getElementById(cardId);
  if (!el) return;
  if (el.tagName === "DETAILS") el.open = true;
  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

/* More sheet (v168, Companion moved to the main nav in v169; v079:
   Journal moved here and Kitchen became a direct tab): Effects,
   Settings, Journal, and Help live here. Opens from the More button;
   picking one shows its panel and closes the sheet. Escape or the
   backdrop closes it without changing tabs. */
let moreSheetOpener = null;
function openMoreSheet() {
  const sheet = document.getElementById("more-sheet");
  const backdrop = document.getElementById("more-sheet-backdrop");
  if (!sheet || !backdrop) return;
  moreSheetOpener = document.activeElement;
  sheet.classList.remove("hidden");
  backdrop.classList.remove("hidden");
  const moreBtn = document.querySelector('.tab-btn[data-tab="more"]');
  if (moreBtn) moreBtn.setAttribute("aria-expanded", "true");
  const first = sheet.querySelector(".more-item");
  if (first) first.focus();
}
function closeMoreSheet() {
  const sheet = document.getElementById("more-sheet");
  const backdrop = document.getElementById("more-sheet-backdrop");
  if (!sheet || sheet.classList.contains("hidden")) return;
  sheet.classList.add("hidden");
  backdrop.classList.add("hidden");
  const moreBtn = document.querySelector('.tab-btn[data-tab="more"]');
  if (moreBtn) {
    moreBtn.setAttribute("aria-expanded", "false");
    if (moreSheetOpener && document.contains(moreSheetOpener)) moreSheetOpener.focus();
    else moreBtn.focus();
  }
  moreSheetOpener = null;
}
document.querySelectorAll("[data-more-goto]").forEach((el) => {
  el.addEventListener("click", () => {
    const dest = el.dataset.moreGoto;
    closeMoreSheet();
    showTab(dest);
  });
});
document.getElementById("more-sheet-close").addEventListener("click", closeMoreSheet);
document.getElementById("more-sheet-backdrop").addEventListener("click", closeMoreSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const sheet = document.getElementById("more-sheet");
    if (sheet && !sheet.classList.contains("hidden")) { e.preventDefault(); closeMoreSheet(); return; }
    const planEditor = document.getElementById("movement-plan-editor");
    if (planEditor && !planEditor.classList.contains("hidden")) { e.preventDefault(); closeMovementPlanEditor(); return; }
    const doctorModal = document.getElementById("doctor-modal");
    if (doctorModal && !doctorModal.classList.contains("hidden")) { e.preventDefault(); closeDoctorModal(); return; }
    if (inlineAddKey) { e.preventDefault(); closeInlineAdd(); return; }
    const recipeModalEsc = document.getElementById("recipe-modal");
    if (recipeModalEsc && !recipeModalEsc.classList.contains("hidden")) { e.preventDefault(); closeRecipeModal(); return; }
    const scanModalEsc = document.getElementById("scan-modal");
    if (scanModalEsc && !scanModalEsc.classList.contains("hidden")) { e.preventDefault(); closeScanModal(); return; }
    const plateModalEsc = document.getElementById("plate-modal");
    if (plateModalEsc && !plateModalEsc.classList.contains("hidden")) { e.preventDefault(); closePlateModal(); return; }
    const progressPanel = document.getElementById("tab-progress");
    if (progressPanel && progressPanel.classList.contains("active")) { e.preventDefault(); showTab("today"); return; }
  }
});

/* ---------- Proactive companion insights ---------- */

function streakFor(key, field, goalKey) {
  const goal = Number(store.settings[goalKey]) || 0;
  if (!goal) return 0;
  let streak = 0;
  let off = sumForDate(store[key], todayStr(0), field) > 0 ? 0 : 1;
  for (; off < 90; off++) {
    if (sumForDate(store[key], todayStr(-off), field) >= goal) streak++;
    else break;
  }
  return streak;
}

function pickCoachInsight() {
  // Shot day tomorrow gets top priority
  const shotDay = store.settings.shotDay;
  if (shotDay) {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const diff = (days.indexOf(shotDay) - new Date().getDay() + 7) % 7;
    if (diff === 1) return "Shot day tomorrow. Everything is ready.";
    if (diff === 0 && !store.injections.some((e) => e.date === todayStr() && (e.status || "On time") !== "Missed")) {
      return null; // the one-tap button covers today
    }
  }
  const pStreak = streakFor("protein", "grams", "proteinGoal");
  if (pStreak >= 3) return "Protein goal " + pStreak + " days in a row. That's how strength is built.";
  const wStreak = streakFor("water", "oz", "waterGoal");
  if (wStreak >= 3) return wStreak + " days on your water goal. Your body feels it.";
  const mStreak = streakFor("exercise", "minutes", "movementGoal");
  if (mStreak >= 3) return mStreak + " active days in a row. Movement is medicine.";
  const goalW = Number(store.settings.goalWeight) || 0;
  const sorted = [...store.weight].sort(byDate);
  if (goalW > 0 && sorted.length) {
    const remaining = Math.abs(Number(sorted[sorted.length - 1].value) - goalW);
    if (remaining > 0 && remaining <= 5) return "Only " + remaining.toFixed(1) + " lbs to your goal. You're nearly there.";
  }
  if (sorted.length) {
    const lastW = sorted[sorted.length - 1].date;
    const daysSince = daysBetween(lastW, todayStr());
    if (daysSince >= 7) return daysSince + " days since you weighed in. No pressure, whenever you're ready.";
  }
  if (store.journal.length) {
    const lastJ = [...store.journal].sort(byDateDesc)[0].date;
    const daysSince = daysBetween(lastJ, todayStr());
    if (daysSince >= 7) return "A lot can change in " + daysSince + " days. Two minutes of journaling?";
  }
  return null;
}

function renderCoachInsight() {
  const card = document.getElementById("coach-insight-card");
  if (!card) return;
  const insight = pickCoachInsight();
  if (!insight) { card.classList.add("hidden"); return; }
  document.getElementById("coach-insight-text").textContent = insight;
  card.classList.remove("hidden");
  // v063: an insight opens the card, unless she closed it herself.
  if (!sectionPersistedClosed("coach-insight-card")) card.open = true;
}

/* ---------- Monthly review story ---------- */

let reviewYear, reviewMonth;

function renderMonthlyReview() {
  const body = document.getElementById("review-body");
  if (!body) return;
  const now = new Date();
  if (reviewYear === undefined) { reviewYear = now.getFullYear(); reviewMonth = now.getMonth(); }
  // Don't browse into the future
  if (reviewYear > now.getFullYear() || (reviewYear === now.getFullYear() && reviewMonth > now.getMonth())) {
    reviewYear = now.getFullYear(); reviewMonth = now.getMonth();
  }
  const title = new Date(reviewYear, reviewMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  document.getElementById("review-title").textContent = title;

  const daysInMonth = new Date(reviewYear, reviewMonth + 1, 0).getDate();
  const prefix = reviewYear + "-" + String(reviewMonth + 1).padStart(2, "0") + "-";
  const inMonth = (d) => d && d.startsWith(prefix);

  const daysLogged = new Set();
  ["water", "protein", "exercise", "weight", "injections", "journal", "sideEffects"].forEach((k) => {
    (store[k] || []).forEach((e) => { if (inMonth(e.date)) daysLogged.add(e.date); });
  });
  Object.keys(store.moods || {}).forEach((d) => { if (inMonth(d)) daysLogged.add(d); });

  const goalDays = (key, field, goalKey) => {
    const goal = Number(store.settings[goalKey]) || 0;
    if (!goal) return 0;
    let n = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (sumForDate(store[key], prefix + String(d).padStart(2, "0"), field) >= goal) n++;
    }
    return n;
  };
  const proteinDays = goalDays("protein", "grams", "proteinGoal");
  const waterDays = goalDays("water", "oz", "waterGoal");
  const moveDays = goalDays("exercise", "minutes", "movementGoal");
  const shots = store.injections.filter((e) => inMonth(e.date)).length;
  const journals = store.journal.filter((e) => inMonth(e.date)).length;

  const weights = store.weight.filter((e) => inMonth(e.date)).sort(byDate);
  let weightLine = "";
  if (weights.length >= 2) {
    const startW = Number(weights[0].value), endW = Number(weights[weights.length - 1].value);
    const change = startW - endW;
    weightLine = change > 0
      ? "Weight went from " + startW + " to " + endW + " lbs, down " + change.toFixed(1) + "."
      : change < 0
        ? "Weight went from " + startW + " to " + endW + " lbs, up " + Math.abs(change).toFixed(1) + "."
        : "Weight held steady at " + endW + " lbs.";
  } else if (weights.length === 1) {
    weightLine = "You logged your weight at " + weights[0].value + " lbs.";
  }

  const lines = [];
  lines.push("You showed up " + daysLogged.size + " of " + daysInMonth + " days.");
  if (proteinDays) lines.push("Protein goal reached " + proteinDays + " day" + (proteinDays === 1 ? "" : "s") + ".");
  if (waterDays) lines.push("Water goal reached " + waterDays + " day" + (waterDays === 1 ? "" : "s") + ".");
  if (moveDays) lines.push("Movement goal reached " + moveDays + " day" + (moveDays === 1 ? "" : "s") + ".");
  if (shots) lines.push(shots + " shot" + (shots === 1 ? "" : "s") + " logged.");
  if (journals) lines.push(journals + " journal " + (journals === 1 ? "entry" : "entries") + " written.");
  if (weightLine) lines.push(weightLine);

  const isCurrent = reviewYear === now.getFullYear() && reviewMonth === now.getMonth();
  const closing = daysLogged.size === 0
    ? "A blank page. Next month is yours to write."
    : isCurrent
      ? "The month isn't over yet. Keep logging."
      : "That's a chapter worth keeping.";

  body.innerHTML = (lines.length ? `<ul style="margin:0 0 4px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 8px">${l}</li>`).join("")}</ul>` : "") +
    `<p style="margin:12px 0 0;font-style:italic;color:var(--sage-deep)">${closing}</p>`;

  document.getElementById("review-next").style.visibility = isCurrent ? "hidden" : "";
  // v080: open the story when the month has entries, so it is not
  // hidden behind a closed disclosure.
  const reviewDet = document.getElementById("review-details");
  if (reviewDet) reviewDet.open = daysLogged.size > 0;
}

document.getElementById("review-prev").addEventListener("click", () => {
  reviewMonth--;
  if (reviewMonth < 0) { reviewMonth = 11; reviewYear--; }
  renderMonthlyReview();
});
document.getElementById("review-next").addEventListener("click", () => {
  reviewMonth++;
  if (reviewMonth > 11) { reviewMonth = 0; reviewYear++; }
  renderMonthlyReview();
});

/* v063: collapsible section state persists on this device. When she
   opens a section it stays open, and when she closes one it stays
   closed, until she changes it again. One localStorage key per
   section id ("nct-section-<id>": "open" or "closed"). First use
   keeps the HTML default (the open attribute, or closed). The small
   chat-privacy disclosure is not a section and is left alone; the
   Backup and About cards keep their HTML defaults. Sections that do
   not exist in a copy are skipped. */
const SECTION_STATE_PREFIX = "nct-section-";
function sectionPersistedClosed(id) {
  try { return localStorage.getItem(SECTION_STATE_PREFIX + id) === "closed"; } catch { return false; }
}
document.querySelectorAll("details.card[id]").forEach((el) => {
  let saved = null;
  try { saved = localStorage.getItem(SECTION_STATE_PREFIX + el.id); } catch {}
  if (saved === "open") el.open = true;
  else if (saved === "closed") el.open = false;
  el.addEventListener("toggle", () => {
    try { localStorage.setItem(SECTION_STATE_PREFIX + el.id, el.open ? "open" : "closed"); } catch {}
  });
});

/* ---------- Progress view (v038) ---------- */
/* One dedicated screen with 7-day bars for protein, carbs, fat, and
   weight. Computed on the device from the local store; nothing leaves
   the phone. The last 7 days run from 6 days ago through today. Days
   with nothing logged stay blank, never invented. No judgment language. */
const PROGRESS_DAYS = 7;
function progressDates() {
  const days = [];
  for (let i = PROGRESS_DAYS - 1; i >= 0; i--) days.push(todayStr(-i));
  return days;
}
function progressDayLetter(dateStr) {
  const parts = String(dateStr || "").split("-");
  if (parts.length !== 3) return "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return ["S", "M", "T", "W", "T", "F", "S"][d.getDay()];
}
function progressFmtDate(dateStr) {
  const parts = String(dateStr || "").split("-");
  if (parts.length !== 3) return "";
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function progressWeightFor(dateStr) {
  const day = (store.weight || []).filter((e) => e.date === dateStr);
  if (!day.length) return null;
  const v = Number(day[day.length - 1].value);
  return v > 0 ? v : null;
}
function progressBarCol(value, heightPct, color, letter, label) {
  const val = value === null ? "" : label;
  const bar = value === null
    ? "<div class=\"week-bar week-bar-empty\" style=\"height:6px\"></div>"
    : "<div class=\"week-bar\" style=\"height:" + heightPct + "%;background:" + color + "\"></div>";
  return "<div class=\"week-bar-col\"><span class=\"week-bar-val\">" + val + "</span><div class=\"week-bar-track\">" + bar + "</div><span class=\"week-bar-day\">" + letter + "</span></div>";
}
function renderProgress() {
  const probe = document.getElementById("progress-bars-protein");
  if (!probe) return;
  const dates = progressDates();
  const rangeEl = document.getElementById("progress-range");
  if (rangeEl) rangeEl.textContent = progressFmtDate(dates[0]) + " to " + progressFmtDate(dates[dates.length - 1]);

  const loggedDays = new Set();
  (store.protein || []).forEach((e) => { if (dates.includes(e.date)) loggedDays.add(e.date); });
  (store.weight || []).forEach((e) => { if (dates.includes(e.date)) loggedDays.add(e.date); });

  const targets = macroTargets();
  const defs = [
    { key: "protein", label: "Protein", color: "#E8B54A", goal: targets.protein },
    { key: "carbs", label: "Carbs", color: "#5A6B52", goal: targets.carbs },
    { key: "fat", label: "Fat", color: "#DCC9A3", goal: targets.fat }
  ];
  defs.forEach((def) => {
    const values = dates.map((d) => {
      const total = macroTotals(d)[def.key];
      return total > 0 ? total : null;
    });
    const total = values.reduce((t, v) => t + (v || 0), 0);
    const daysWith = values.filter((v) => v !== null).length;
    const avg = daysWith > 0 ? Math.round(total / daysWith) : 0;
    const big = document.getElementById("progress-" + def.key + "-big");
    if (big) big.textContent = String(avg);
    const note = document.getElementById("progress-" + def.key + "-note");
    if (note) {
      const goalPart = def.goal > 0 ? " Your target is " + def.goal + " grams a day." : "";
      note.textContent = daysWith === 0
        ? "Nothing logged this week yet."
        : daysWith < PROGRESS_DAYS
          ? "Average over " + daysWith + " logged day" + (daysWith === 1 ? "" : "s") + "." + goalPart
          : "Logged 7 of 7 days." + goalPart;
    }
    const boxEl = document.getElementById("progress-bars-" + def.key);
    if (boxEl) {
      const scaleMax = Math.max(def.goal > 0 ? def.goal : 0, ...values.map((v) => v || 0));
      boxEl.innerHTML = values.map((v, i) => {
        const pct = v === null || scaleMax <= 0 ? 0 : Math.max(6, Math.round(100 * v / scaleMax));
        return progressBarCol(v, pct, def.color, progressDayLetter(dates[i]), v === null ? "" : String(v));
      }).join("");
      boxEl.setAttribute("aria-label", def.label + " by day: " + values.map((v, i) => progressDayLetter(dates[i]) + " " + (v === null ? "nothing logged" : v + " grams")).join(", "));
    }
  });

  const wValues = dates.map((d) => progressWeightFor(d));
  const wSeen = wValues.filter((v) => v !== null);
  const bigW = document.getElementById("progress-weight-big");
  if (bigW) bigW.textContent = wSeen.length ? wSeen[wSeen.length - 1].toFixed(1) : "\u2014";
  const noteW = document.getElementById("progress-weight-note");
  if (noteW) {
    if (wSeen.length >= 2) {
      const first = wSeen[0], last = wSeen[wSeen.length - 1];
      const change = first - last;
      noteW.textContent = change > 0
        ? "Down " + change.toFixed(1) + " lbs this week."
        : change < 0
          ? "Up " + Math.abs(change).toFixed(1) + " lbs this week."
          : "Held steady this week.";
    } else if (wSeen.length === 1) {
      noteW.textContent = "One weigh-in this week.";
    } else {
      noteW.textContent = "No weigh-ins this week.";
    }
  }
  const boxW = document.getElementById("progress-bars-weight");
  if (boxW) {
    const max = wSeen.length ? Math.max(...wSeen) : 0;
    boxW.innerHTML = wValues.map((v, i) => {
      let pct = 0;
      if (v !== null) {
        pct = max > 0 ? Math.round(8 + 92 * v / max) : 50;
      }
      return progressBarCol(v, pct, "#44503E", progressDayLetter(dates[i]), v === null ? "" : v.toFixed(1));
    }).join("");
    boxW.setAttribute("aria-label", "Weight by day: " + wValues.map((v, i) => progressDayLetter(dates[i]) + " " + (v === null ? "no weigh-in" : v.toFixed(1) + " lbs")).join(", "));
  }

  const noteEl = document.getElementById("progress-note");
  if (noteEl) {
    noteEl.textContent = loggedDays.size === 0
      ? "Nothing logged this week yet."
      : loggedDays.size < PROGRESS_DAYS
        ? "Logged " + loggedDays.size + " of 7 days."
        : "Seven days logged this week.";
  }
  renderMacroStack(dates);
}
/* v052: weekly stacked macro bars on Progress. Protein first, then
   carbs, then fat, in brand colors only. Each bar is one day; the
   height is that day's total grams against the week's biggest day.
   The Avg vs Goal table under it uses the same numbers as the cards
   above, so the two never disagree. */
function renderMacroStack(dates) {
  const box = document.getElementById("progress-bars-stack");
  if (!box) return;
  const totals = dates.map((d) => macroTotals(d));
  const sums = totals.map((t) => t.protein + t.carbs + t.fat);
  const maxTotal = Math.max(1, ...sums);
  box.classList.remove("filled");
  box.innerHTML = totals.map((t, i) => {
    const sum = sums[i];
    const val = sum > 0 ? String(sum) : "";
    const bar = sum <= 0
      ? '<div class="week-bar week-bar-empty" style="height:6px"></div>'
      : '<div class="stack-bar" style="--h:' + Math.max(6, Math.round(100 * sum / maxTotal)) + '%">'
        + '<i style="height:' + (100 * t.protein / sum).toFixed(1) + '%;background:#E8B54A"></i>'
        + '<i style="height:' + (100 * t.carbs / sum).toFixed(1) + '%;background:#5A6B52"></i>'
        + '<i style="height:' + (100 * t.fat / sum).toFixed(1) + '%;background:#7A8B6F"></i></div>';
    return '<div class="week-bar-col"><span class="week-bar-val">' + val + '</span><div class="week-bar-track">' + bar + '</div><span class="week-bar-day">' + progressDayLetter(dates[i]) + '</span></div>';
  }).join("");
  box.setAttribute("aria-label", "Macros by day, stacked: " + totals.map((t, i) => progressDayLetter(dates[i]) + " " + (sums[i] > 0 ? sums[i] + " grams" : "nothing logged")).join(", "));
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("filled")));
  const body = document.getElementById("progress-avg-body");
  if (body) {
    const targets = macroTargets();
    const rows = [
      { label: "Protein", key: "protein", goal: targets.protein },
      { label: "Carbs", key: "carbs", goal: targets.carbs },
      { label: "Fat", key: "fat", goal: targets.fat }
    ].map((r) => {
      const daysWith = totals.filter((t) => t[r.key] > 0).length;
      const total = totals.reduce((s, t) => s + t[r.key], 0);
      const avg = daysWith > 0 ? Math.round(total / daysWith) : 0;
      return "<tr><td>" + r.label + "</td><td>" + avg + "g</td><td>" + (r.goal > 0 ? r.goal + "g" : "—") + "</td></tr>";
    }).join("");
    body.innerHTML = rows;
  }
}
/* Progress entry point (v049, R-15): Progress is a real tab, so it
   opens through showTab like every other tab. v079: it is a Today
   sub-view, so Today stays the active tab while viewing it. */
function openProgress() {
  showTab("progress");
  renderProgress();
}
const openProgressBtn = document.getElementById("open-progress");
if (openProgressBtn) openProgressBtn.addEventListener("click", openProgress);
const progressBackBtn = document.getElementById("progress-back");
if (progressBackBtn) progressBackBtn.addEventListener("click", () => showTab("today"));

/* ---------- Today tab ---------- */

function sumForDate(list, dateStr, field) {
  return list.filter((e) => e.date === dateStr).reduce((t, e) => t + (Number(e[field]) || 0), 0);
}

let viewOffset = 0; // 0 = today, -1 = yesterday, etc.

/* The day the Today tab is showing. Steppers, forms, mood and undo all
   log to this day, not always to today (F13/F14/F16). */
function viewedDateStr() {
  return todayStr(viewOffset);
}



/* ---------- Compact Today (v034) ---------- */
/* Meal groups for Today's food: Breakfast, Lunch, Dinner, Snacks.
   A food entry carries an optional meal tag; entries without one show
   under Other foods. Nothing about the entry shape changed except the
   new optional meal field. */
const MEALS = ["Breakfast", "Lunch", "Dinner", "Snacks"];
function mealOf(entry) {
  return MEALS.includes(entry && entry.meal) ? entry.meal : "";
}

/* 7-day strip above Today: the week holding the day being viewed.
   Tapping a day shows that day. Days after today are disabled. */
function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  if (!strip) return;
  const viewDate = new Date();
  viewDate.setDate(viewDate.getDate() + viewOffset);
  const sunday = new Date(viewDate);
  sunday.setDate(viewDate.getDate() - viewDate.getDay());
  const letters = ["S", "M", "T", "W", "T", "F", "S"];
  const todayS = todayStr(0);
  const viewed = viewedDateStr();
  const logged = loggedDates(); // v052: days with any entry get a gold fill at the base of the strip.
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const iso = localDateStr(d);
    const isViewed = iso === viewed;
    const isToday = iso === todayS;
    const isFuture = iso > todayS;
    html += '<button type="button" class="week-day' + (isViewed ? " viewed" : "") + (isToday ? " today" : "") + '" data-week-day="' + iso + '"' + (isFuture ? " disabled" : "") + ' aria-label="' + letters[i] + d.getDate() + ", " + d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + '"' + (isViewed ? ' aria-current="date"' : "") + '><span class="week-letter">' + letters[i] + '</span><span class="week-num">' + d.getDate() + "</span>" + (logged.has(iso) ? '<span class="week-fill" aria-hidden="true"></span>' : "") + "</button>";
  }
  strip.innerHTML = html;
  strip.classList.remove("filled");
  requestAnimationFrame(() => requestAnimationFrame(() => strip.classList.add("filled")));
  strip.querySelectorAll("[data-week-day]").forEach((b) => b.addEventListener("click", () => {
    viewOffset = daysBetween(todayStr(), b.dataset.weekDay);
    renderToday();
  }));
}

/* Weight card on Today: the latest weigh-in and the change since the
   one before it. Log weight goes to the Weight tab, where the weight
   is logged with the date. */
function renderTodayWeight() {
  const valEl = document.getElementById("today-weight-value");
  if (!valEl) return;
  const sorted = [...(store.weight || [])].sort(byDate);
  const changeEl = document.getElementById("today-weight-change");
  if (!sorted.length) {
    valEl.textContent = "-";
    if (changeEl) changeEl.textContent = "No weigh-ins yet. Log your first weight below.";
    return;
  }
  const latest = sorted[sorted.length - 1];
  valEl.textContent = Number(latest.value);
  if (!changeEl) return;
  if (sorted.length < 2) {
    changeEl.textContent = "Logged " + formatDate(latest.date) + ".";
    return;
  }
  const prev = sorted[sorted.length - 2];
  const diff = Math.round((Number(latest.value) - Number(prev.value)) * 10) / 10;
  changeEl.textContent = (diff > 0 ? "+" : "") + diff + " lbs since " + formatDate(prev.date) + " (" + Number(prev.value) + " lbs).";
}

/* Open the Log food form for one meal: the meal is preselected, the
   form opens, and the page scrolls to it. */
function openFoodFormForMeal(meal) {
  editingFoodId = null;
  const sel = document.getElementById("macro-food-meal");
  if (sel) sel.value = MEALS.includes(meal) ? meal : "";
  const form = document.getElementById("macro-food-form");
  if (!form) return;
  form.classList.remove("hidden");
  openFoodLibraryIfAny();
  syncFormCalories();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  const nameInput = document.getElementById("macro-food-name");
  if (nameInput) nameInput.focus();
}

function renderToday() {
  const t = todayStr(viewOffset);
  const dateEl = document.getElementById("today-date");
  const viewDate = new Date();
  viewDate.setDate(viewDate.getDate() + viewOffset);
  const label = viewOffset === 0 ? "Today" : viewOffset === -1 ? "Yesterday"
    : viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("today-heading").textContent = label;
  dateEl.textContent = viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const dateTap = document.getElementById("date-tap");
  if (dateTap) dateTap.setAttribute("aria-label", label + ", " + dateEl.textContent + ". Change the date shown.");

  // Show/hide nav arrows
  document.getElementById("day-prev").style.visibility = "";
  document.getElementById("day-next").style.visibility = viewOffset >= 0 ? "hidden" : "";

  // Sliders log to the day being viewed, so they stay
  // usable on past days (F13/F16). Nothing here is disabled by day.

  const waterGoal = Number(store.settings.waterGoal) || 92;
  document.getElementById("water-goal-display").textContent = waterGoal;
  const waterOz = sumForDate(store.water, t, "oz");
  syncGoalSlider("water-slider", "water-today", "water-num-btn", "Water", "ounces", waterOz, waterGoal);

  const exMin = sumForDate(store.exercise, t, "minutes");
  const moveGoal = Number(store.settings.movementGoal) || 30;
  document.getElementById("exercise-goal-display").textContent = moveGoal;
  syncGoalSlider("exercise-slider", "exercise-today", "exercise-num-btn", "Movement", "minutes", exMin, moveGoal);

  renderMacros();
  renderMovement();
  renderStrength();
  renderFoodLog();
  renderWeekStrip();
  renderTodayWeight();

  renderGreeting();
  renderStreak();
  renderBloom();
  renderTodayFocus();
  renderEncouragement();
  renderNextInjection();
  renderMood();
  renderBackupNudge();
  renderCorruptNotice();
  renderDiscoverCard();
  if (saveFailed) showStorageWarning("Your latest change could not be saved on this device. It may be out of space. Try downloading a backup from Settings, then deleting a few old photos.");
  renderCoachInsight();
  renderMonthlyReview();
}

/* Streak count (v166): consecutive days with at least one logged entry
   (water, protein, movement, shot, weigh-in, journal, side effect, mood,
   measurement, or photo). Counted from today, or from yesterday when
   today is still empty, so the streak is not lost on a morning before
   the first log. */
function loggedDates() {
  const days = new Set();
  ["water", "protein", "exercise", "strength", "injections", "weight", "measurements", "journal", "sideEffects", "photos"].forEach((k) => {
    (store[k] || []).forEach((e) => { if (e && typeof e.date === "string") days.add(e.date); });
  });
  Object.keys(store.moods || {}).forEach((d) => days.add(d));
  return days;
}
function currentStreak() {
  const days = loggedDates();
  let off = days.has(todayStr(0)) ? 0 : -1;
  let n = 0;
  while (days.has(todayStr(off))) { n++; off--; }
  return n;
}
function renderStreak() {
  const el = document.getElementById("streak-line");
  if (!el) return;
  const n = currentStreak();
  el.textContent = n >= 2 ? "Logged " + n + " days in a row." : n === 1 ? "Logged day 1." : "";
}

/* ---------- v058: the lotus bloom ---------- */
/* The lotus on the welcome card opens a little more with each logged
   day and strength session. Quiet and cumulative: it never closes
   again, and a missed day only pauses it, never sends it backward.
   Five stages across the first three months of logging, then it starts
   again as a new bud, and the count of completed blooms is kept.
   A day with a strength session counts once extra, so strength opens
   it faster. v062: one image per stage, so the lotus genuinely opens
   petal by petal like a real lotus. Stage 0 is the closed bud,
   stages 1-4 are intermediates in the same brushed gold, stage 5 is
   the brand lotus itself, unchanged. The images carry the opening now,
   so the scale and opacity progression in the CSS is subtle. Plain and
   factual, no pressure language. */
function bloomProgress() {
  const days = loggedDates().size;
  const strengthDays = new Set((store.strength || []).map((e) => e.date)).size;
  const points = days + strengthDays;
  const blooms = Math.floor(points / 90);
  const position = points % 90;
  let stage;
  if (points <= 0) stage = 0;
  else if (position === 0) stage = 5;
  else if (position <= 7) stage = 1;
  else if (position <= 21) stage = 2;
  else if (position <= 45) stage = 3;
  else stage = 4;
  return { points: points, blooms: blooms, position: position, stage: stage };
}
function bloomStage() {
  return bloomProgress().stage;
}
/* v062: one image per stage. Stage 4 is the brand lotus squeezed to
   92 percent width, so it is the same flower, just not quite fully
   spread, and the step to stage 5 does not change flowers. */
const BLOOM_IMAGES = [
  "icons/lotus-bud-closed.png",
  "icons/lotus-open-1.png",
  "icons/lotus-open-2.png",
  "icons/lotus-open-3.png",
  "icons/lotus-open-4.png",
  "icons/lotus-gold-only-transparent.png"
];
function renderBloom() {
  const card = document.getElementById("welcome-card");
  if (!card) return;
  const progress = bloomProgress();
  const stage = progress.stage;
  for (let i = 1; i <= 5; i++) card.classList.toggle("bloom-stage-" + i, stage === i);
  const img = card.querySelector(".bloom-lotus");
  if (img) img.src = BLOOM_IMAGES[stage];
  const line = document.getElementById("bloom-stage-line");
  if (line) {
    if (stage === 0) line.textContent = "Your lotus starts to open when you log. Fully open at 90 days of logging.";
    else if (progress.blooms > 0) line.textContent = "Stage " + stage + " of 5. " + progress.blooms + (progress.blooms === 1 ? " bloom" : " blooms") + " completed.";
    else line.textContent = "Stage " + stage + " of 5. Fully open at 90 days of logging.";
  }
}

/* v052: today's focus, in one line in the welcome card. One thing,
   from data already on the phone: a shot due today first, then the
   macro furthest from its target, then water, then movement. When
   everything for today is done, the focus is rest. Past days show
   nothing, since the focus is about today. */
function renderTodayFocus() {
  const el = document.getElementById("today-focus-line");
  if (!el) return;
  if (viewOffset !== 0) { el.textContent = ""; return; }
  const t = viewedDateStr();
  const due = nextShotDue();
  if (due && (due.daysUntil === 0 || due.overdueDays > 0)) {
    el.textContent = due.overdueDays > 0 ? "Today's focus: your shot is due." : "Today's focus: your shot is due today.";
    return;
  }
  const targets = macroTargets();
  const totals = macroTotals(t);
  if (targets.protein > 0 && totals.protein < targets.protein) {
    el.textContent = "Today's focus: protein. " + (targets.protein - totals.protein) + "g to go.";
    return;
  }
  const waterGoal = Number(store.settings.waterGoal) || 92;
  const waterOz = sumForDate(store.water, t, "oz");
  if (waterOz < waterGoal) {
    el.textContent = "Today's focus: water. " + (waterGoal - waterOz) + " oz to go.";
    return;
  }
  const moveGoal = Number(store.settings.movementGoal) || 30;
  const exMin = sumForDate(store.exercise, t, "minutes");
  if (exMin < moveGoal) {
    el.textContent = "Today's focus: movement. " + (moveGoal - exMin) + " min to go.";
    return;
  }
  el.textContent = "Today's focus: rest. Everything for today is done.";
}

/* Greeting (v165, v004): time of day, plus the user's own name when
   they set it in Settings. The name is the buyer's own, never the
   founder's, so a buyer who leaves it blank just sees the time of day. */
function renderGreeting() {
  const el = document.getElementById("greeting-line");
  if (!el) return;
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = (store.settings.yourName || "").trim();
  el.textContent = name ? part + ", " + name + "." : part + ".";
}


/* nudgeGoal (v166): change a day's total by an exact amount, used by
   the type-in sheet. Same add/trim helpers as the slider and the add
   buttons, so the store, snapshots, and the backup cap behave exactly
   the same. */
function nudgeGoal(key, field, extra, delta) {
  if (delta > 0) {
    store[key].push(Object.assign({ id: uid(), date: viewedDateStr() }, extra, { [field]: delta }));
  } else {
    trimDayEntries(key, field, viewedDateStr(), -delta);
  }
  saveStore();
  renderToday();
}


/* Trim a day's entries from the most recent backwards (F15): used by
   the slider and the type-in sheet when a total is lowered, so totals can never go below
   zero. Trims whole entries first, then shrinks the last one. */
function trimDayEntries(key, field, date, amount) {
  let remaining = amount;
  for (let i = store[key].length - 1; i >= 0 && remaining > 0; i--) {
    const e = store[key][i];
    if (e.date !== date) continue;
    const val = Number(e[field]) || 0;
    if (val <= 0) continue;
    if (val <= remaining) { remaining -= val; store[key].splice(i, 1); }
    else {
      e[field] = val - remaining; remaining = 0;
      if (key === "protein" && Number(e.calories) > 0) e.calories = entryCalories(e);
    }
  }
}



/* ---------- Compact slider rows (v036) ---------- */
/* Water and movement as one row with the big amount and the goal, a
   horizontal slider below it. The slider's own fill shows progress, so
   there is no second bar. The number paints live while dragging; the
   store is written once, on
   release, by pushing one entry for a rise or trimming entries for a
   fall, so entries, snapshots, and the backup cap behave exactly as
   for an add-button tap. Totals never go below zero. The slider's
   maximum is twice the goal (or the current total, whichever is
   higher), so going past the goal still works. */
function setDayTotal(key, field, extra, target) {
  target = Math.max(0, Math.round(Number(target) || 0));
  const current = sumForDate(store[key], viewedDateStr(), field);
  const delta = target - current;
  if (delta > 0) {
    store[key].push(Object.assign({ id: uid(), date: viewedDateStr() }, extra, { [field]: delta }));
    saveStore();
  } else if (delta < 0) {
    trimDayEntries(key, field, viewedDateStr(), -delta);
    saveStore();
  }
  renderToday();
}
function syncGoalSlider(sliderId, numId, btnId, label, unitWord, value, goal) {
  const num = document.getElementById(numId);
  if (num) num.textContent = value;
  const slider = document.getElementById(sliderId);
  if (slider) {
    slider.max = Math.max(goal * 2, value);
    slider.value = value;
    slider.setAttribute("aria-valuetext", value + " of " + goal + " " + unitWord);
  }
  const btn = document.getElementById(btnId);
  const shortUnit = unitWord === "ounces" ? "oz" : unitWord === "minutes" ? "min" : unitWord;
  if (btn) btn.setAttribute("aria-label", label + ", " + value + " of " + goal + " " + shortUnit + ". Tap to type an amount to add.");
}
function bindGoalSlider(sliderId, numId, key, field, extra, goalFor) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  const paintLive = () => {
    const v = Number(slider.value) || 0;
    const num = document.getElementById(numId);
    if (num) num.textContent = v;
  };
  slider.addEventListener("input", paintLive);
  slider.addEventListener("change", () => {
    setDayTotal(key, field, extra, Number(slider.value) || 0);
  });
}
bindGoalSlider("water-slider", "water-today", "water", "oz", {}, () => Number(store.settings.waterGoal) || 92);
bindGoalSlider("exercise-slider", "exercise-today", "exercise", "minutes", { label: "Movement" }, () => Number(store.settings.movementGoal) || 30);

/* ---------- Type an amount to add, inline (v049) ---------- */
/* The big number on water, movement, and each macro row is a button.
   Tapping it shows a small row in the same card where the person types
   a number (a 16 oz bottle is 16, or 15 grams of protein). The amount
   goes through nudgeGoal for water and movement and adjustMacroBy for
   the macros, the same helpers the sliders use, so the store,
   snapshots, and the 3-per-day backup cap behave exactly as before.
   Whole numbers only; Add stays disabled until one is typed. Water,
   movement, and macros all use this one row, so the three work the
   same way. Replaces the v169 type-in sheet. */
const INLINE_ADD_CFG = {
  water: { kind: "goal", field: "oz", extra: {}, unit: "oz", unitWord: "ounces" },
  exercise: { kind: "goal", field: "minutes", extra: { label: "Movement" }, unit: "min", unitWord: "minutes" },
  protein: { kind: "macro", unit: "g", unitWord: "grams" },
  carbs: { kind: "macro", unit: "g", unitWord: "grams" },
  fat: { kind: "macro", unit: "g", unitWord: "grams" }
};
let inlineAddKey = null; // which row is open: water, exercise, protein, carbs, or fat
let inlineAddOpener = null;

function inlineAddOpenerId(key) {
  if (key === "water") return "water-num-btn";
  if (key === "exercise") return "exercise-num-btn";
  return "logged-" + key + "-btn";
}
function inlineAddStartTotal(key) {
  const cfg = INLINE_ADD_CFG[key];
  if (!cfg) return 0;
  if (cfg.kind === "macro") return macroTotals(viewedDateStr())[key];
  return sumForDate(store[key], viewedDateStr(), cfg.field);
}
function inlineAddTyped() {
  if (!inlineAddKey) return 0;
  const input = document.getElementById(inlineAddKey + "-inline-input");
  if (!input) return 0;
  const raw = input.value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  return parseInt(raw, 10);
}
function refreshInlineAdd() {
  if (!inlineAddKey) return;
  const cfg = INLINE_ADD_CFG[inlineAddKey];
  const n = inlineAddTyped();
  const addBtn = document.getElementById(inlineAddKey + "-inline-add-btn");
  const preview = document.getElementById(inlineAddKey + "-inline-preview");
  if (addBtn) addBtn.disabled = n <= 0;
  if (preview) {
    preview.textContent = n > 0
      ? "After adding: " + (inlineAddStartTotal(inlineAddKey) + n) + " " + cfg.unit
      : "Type a whole number to add.";
  }
}
function openInlineAdd(key, opener) {
  const cfg = INLINE_ADD_CFG[key];
  const row = document.getElementById(key + "-inline-add");
  const input = document.getElementById(key + "-inline-input");
  if (!cfg || !row || !input) return;
  if (inlineAddKey && inlineAddKey !== key) closeInlineAdd();
  inlineAddKey = key;
  inlineAddOpener = opener || document.getElementById(inlineAddOpenerId(key));
  row.classList.remove("hidden");
  input.value = "";
  refreshInlineAdd();
  /* v058: the row stays rendered when closed (collapsed, not
     display:none), so the input is focusable at tap time and iOS
     summons the keyboard from the tap. Enable it first, then focus
     in the same gesture. */
  input.disabled = false;
  input.focus();
}
function closeInlineAdd() {
  if (!inlineAddKey) return;
  const row = document.getElementById(inlineAddKey + "-inline-add");
  const input = document.getElementById(inlineAddKey + "-inline-input");
  if (row) row.classList.add("hidden");
  if (input) input.disabled = true;
  inlineAddKey = null;
  if (inlineAddOpener && document.contains(inlineAddOpener)) inlineAddOpener.focus();
  inlineAddOpener = null;
}
function submitInlineAdd() {
  if (!inlineAddKey) return;
  const n = inlineAddTyped();
  if (n <= 0) return;
  const cfg = INLINE_ADD_CFG[inlineAddKey];
  const key = inlineAddKey;
  closeInlineAdd();
  if (cfg.kind === "macro") adjustMacroBy(key, n);
  else nudgeGoal(key, cfg.field, cfg.extra, n);
}
["water", "exercise", "protein", "carbs", "fat"].forEach((key) => {
  const opener = document.getElementById(inlineAddOpenerId(key));
  if (opener) opener.addEventListener("click", () => openInlineAdd(key, opener));
  const input = document.getElementById(key + "-inline-input");
  if (input) {
    input.addEventListener("input", refreshInlineAdd);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const addBtn = document.getElementById(key + "-inline-add-btn");
        if (addBtn && !addBtn.disabled) addBtn.click();
      }
    });
  }
  const addBtn = document.getElementById(key + "-inline-add-btn");
  if (addBtn) addBtn.addEventListener("click", submitInlineAdd);
  const cancelBtn = document.getElementById(key + "-inline-cancel-btn");
  if (cancelBtn) cancelBtn.addEventListener("click", closeInlineAdd);
});
const macroCenterBtn = document.getElementById("macro-center-btn");
if (macroCenterBtn) macroCenterBtn.addEventListener("click", () => openInlineAdd(selectedMacro, macroCenterBtn));

/* ---------- Your Macros (v168) ---------- */
/* Protein, carbs and fat on the front page, against the user's own
   targets. Carbs and fat ride on protein entries, the same entry pattern
   as protein grams, same store, same snapshots: a food entry carries
   grams (protein), carbs and fat. The donut uses the preview's SVG
   geometry (r=84, circumference 527.79): protein gold, carbs sage,
   fat soft cream tan. */
const DONUT_C = 527.79;
const DONUT_GAP = 4;
const MACRO_KEYS = ["protein", "carbs", "fat"];
let selectedMacro = "protein";

function macroTotals(dateStr) {
  return {
    protein: sumForDate(store.protein, dateStr, "grams"),
    carbs: sumForDate(store.protein, dateStr, "carbs"),
    fat: sumForDate(store.protein, dateStr, "fat")
  };
}
function macroTargets() {
  return {
    protein: Number(store.settings.proteinGoal) || 90,
    carbs: Number(store.settings.carbGoal) || 150,
    fat: Number(store.settings.fatGoal) || 60
  };
}
/* Calories for one logged food entry: the calories stored on the entry
   when present, otherwise 4/4/9 from the entry's own macros. */
function entryCalories(e) {
  const stored = Number(e.calories);
  if (Number.isFinite(stored) && stored > 0) return Math.round(stored);
  const p = Number(e.grams) || 0, c = Number(e.carbs) || 0, f = Number(e.fat) || 0;
  return Math.round(p * 4 + c * 4 + f * 9);
}

/* Calories section: "Calories today" is the sum of the calories stored
   on the foods logged for the viewed day, so the total and the food
   list agree. An entry without stored calories falls back to 4/4/9
   from its own macros. The "Your balance" split still uses 4/4/9 on
   the targets, since that is about the targets, not the day. Totals
   change only through food logging, so the passed totals are always
   the day totals. */
function renderCalories(totals) {
  const t = viewedDateStr();
  const entries = (store.protein || []).filter((e) => e.date === t);
  const cals = entries.reduce((s, e) => s + entryCalories(e), 0);
  const target = Number(store.settings.calorieTarget) || 0;
  const todayEl = document.getElementById("calories-today");
  if (todayEl) todayEl.textContent = cals.toLocaleString("en-US");
  const targetEl = document.getElementById("calories-target-part");
  if (targetEl) targetEl.textContent = target > 0 ? " of " + target.toLocaleString("en-US") : "";
  const fill = document.getElementById("calories-fill");
  if (fill) fill.style.width = target > 0 ? Math.min(100, Math.round(100 * cals / target)) + "%" : "0%";
  const note = document.getElementById("calories-note");
  if (note) {
    if (!entries.length) note.textContent = "No food logged yet today.";
    else if (target > 0) note.textContent = "From the food you logged today.";
    else note.textContent = "Set a calorie target in Settings to track it.";
  }
}

/* Donut segments, from a totals object. Shared by renderMacros. */
function paintDonut(totals) {
  const total = totals.protein + totals.carbs + totals.fat;
  let offset = 0;
  MACRO_KEYS.forEach((key) => {
    const seg = document.getElementById("seg-" + key);
    if (!seg) return;
    const frac = total > 0 ? totals[key] / total : 0;
    const len = Math.max(0, frac * DONUT_C - DONUT_GAP);
    seg.setAttribute("stroke-dasharray", len.toFixed(1) + " " + DONUT_C.toFixed(1));
    seg.setAttribute("stroke-dashoffset", (-offset).toFixed(1));
    seg.setAttribute("transform", "rotate(-90 150 150)");
    seg.style.opacity = selectedMacro === key ? "1" : "0.45";
    // v004: the macro's share of today's grams, as a label on its segment.
    // Hidden for tiny slices, so the text never crowds the ring.
    const label = document.getElementById("seg-label-" + key);
    if (label) {
      const midFrac = total > 0 ? (offset + frac * DONUT_C / 2) / DONUT_C : 0;
      const angle = midFrac * Math.PI * 2;
      label.setAttribute("x", (150 + 124 * Math.sin(angle)).toFixed(1));
      label.setAttribute("y", (150 - 124 * Math.cos(angle)).toFixed(1));
      const pct = total > 0 ? Math.round(100 * totals[key] / total) : 0;
      label.textContent = pct >= 8 && totals[key] > 0 ? pct + "%" : "";
    }
    offset += frac * DONUT_C;
  });
}

function selectMacro(key) {
  if (!MACRO_KEYS.includes(key)) return;
  selectedMacro = key;
  renderMacros();
}

/* Nutrition Balance overage: when today's intake for a macro is above
   its target, say by how much, in plain neutral language. Nothing extra
   when the target is unset, or intake is at or below the target. */
function macroProgressText(logged, target) {
  if (!(target > 0)) return "";
  const pct = Math.round(100 * logged / target);
  const over = Math.round(logged - target);
  return pct + "% of your target" + (over > 0 ? " · +" + over + "g over your target" : "");
}
/* The tap-to-type buttons name the macro and the current total (v049),
   so a screen reader hears the same numbers a sighted user sees. */
function syncMacroAddLabels(totals, targets) {
  const names = { protein: "Protein", carbs: "Carbs", fat: "Fat" };
  MACRO_KEYS.forEach((key) => {
    const btn = document.getElementById("logged-" + key + "-btn");
    if (btn) {
      const targetPart = totals[key] + " of " + (targets[key] > 0 ? targets[key] : "—") + " grams";
      btn.setAttribute("aria-label", names[key] + " logged today, " + targetPart + ". Tap to add more.");
    }
  });
  const centerBtn = document.getElementById("macro-center-btn");
  if (centerBtn) centerBtn.setAttribute("aria-label", totals[selectedMacro] + " grams " + selectedMacro + " logged today. Tap to add more.");
}
function renderMacros() {
  const card = document.getElementById("macros-card");
  if (!card) return;
  const t = viewedDateStr();
  const totals = macroTotals(t);
  const targets = macroTargets();
  const total = totals.protein + totals.carbs + totals.fat;
  paintDonut(totals);
  // Nutrition Balance: the percentage split of the user's gram targets,
  // as % of target calories (protein and carbs 4 cal/g, fat 9 cal/g).
  // Updates whenever targets change, from the same render path.
  const balanceEl = document.getElementById("macro-balance");
  if (balanceEl) {
    const pCal = targets.protein * 4, cCal = targets.carbs * 4, fCal = targets.fat * 9;
    const tCal = pCal + cCal + fCal;
    balanceEl.textContent = tCal > 0
      ? "Target balance (share of target calories): " + Math.round(100 * pCal / tCal) + "% protein · " + Math.round(100 * cCal / tCal) + "% carbohydrates · " + Math.round(100 * fCal / tCal) + "% healthy fats"
      : "";
  }
  document.getElementById("macro-center-grams").textContent = totals[selectedMacro];
  document.getElementById("macro-center-label").textContent = selectedMacro + " logged today";
  MACRO_KEYS.forEach((key) => {
    const loggedEl = document.getElementById("logged-" + key);
    if (loggedEl) loggedEl.textContent = totals[key];
    const targetEl = document.getElementById("target-" + key + "-label");
    if (targetEl) targetEl.textContent = targets[key];
    const pct = targets[key] > 0 ? Math.round(100 * totals[key] / targets[key]) : 0;
    const pctEl = document.getElementById("pct-" + key);
    if (pctEl) pctEl.textContent = macroProgressText(totals[key], targets[key]);
    const barEl = document.getElementById("bar-" + key);
    if (barEl) barEl.style.width = Math.min(100, pct) + "%";
    const barWrap = document.getElementById("macro-bar-" + key);
    if (barWrap) { barWrap.setAttribute("aria-valuenow", String(totals[key])); barWrap.setAttribute("aria-valuetext", totals[key] + " grams"); }
    const row = document.querySelector('.macro-row[data-macro="' + key + '"]');
    if (row) row.classList.toggle("selected", selectedMacro === key);
  });
  syncMacroAddLabels(totals, targets);
  renderCalories(totals);
  const svg = card.querySelector(".donut-wrap svg");
  if (svg) svg.setAttribute("aria-label", "Donut chart of today's macros. Protein " + totals.protein + " grams in gold, carbs " + totals.carbs + " grams in sage, fat " + totals.fat + " grams in cream tan.");
}

/* Edit support for the sandbox food log: the sandbox already renders
   its own food list (renderFoodLog), so Edit fills the Log food form
   and the submit handler updates the entry instead of adding a new one. */
let editingFoodId = null;

document.querySelectorAll(".macro-row").forEach((row) => {
  row.addEventListener("click", (e) => {
    // A slide on the bar must not also select the macro on release.
    if (suppressMacroRowClick) { suppressMacroRowClick = false; return; }
    selectMacro(row.dataset.macro);
  });
});
document.querySelectorAll(".donut-seg").forEach((seg) => {
  seg.addEventListener("click", () => selectMacro(seg.dataset.macro));
});


/* adjustMacroBy: change the day's logged grams by a magnitude, used
   by the v169 row slide: a drag of N grams is one entry of N, or one
   trim of N. Carbs and fat attach to the day's most recent food entry,
   or a fresh Quick add entry when the day has none yet, so one slide
   never spams the log with tiny entries. */
function adjustMacroBy(key, delta) {
  if (!delta) return;
  const date = viewedDateStr();
  if (key === "protein") {
    if (delta > 0) {
      store.protein.push({ id: uid(), date, grams: delta, food: "Quick add" });
    } else {
      trimDayEntries("protein", "grams", date, -delta);
    }
  } else if (delta > 0) {
    const todays = store.protein.filter((e) => e.date === date);
    if (todays.length) {
      const last = todays[todays.length - 1];
      last[key] = (Number(last[key]) || 0) + delta;
      if (Number(last.calories) > 0) last.calories = entryCalories(last);
    } else {
      const entry = { id: uid(), date, grams: 0, food: "Quick add" };
      entry[key] = delta;
      store.protein.push(entry);
    }
  } else {
    trimDayEntries("protein", key, date, -delta);
  }
  saveStore();
  renderToday();
}

/* Slide a macro row (v169, restored v048): horizontal slide on the
   row's progress bar changes that macro's logged grams, 1 g per 8px,
   the same step as the rings. The donut itself does not slide; tapping
   a row still selects the macro. The row updates live while sliding;
   the store is written once, on release, through adjustMacroBy, so
   entries, snapshots, and the backup cap behave exactly as for a
   stepper tap. Clamped at zero. */
let suppressMacroRowClick = false;
function bindMacroSlide(key) {
  const bar = document.getElementById("macro-bar-" + key);
  if (!bar) return;
  let sliding = false;
  let startX = 0;
  let startTotal = 0;
  let liveTotal = 0;
  let moved = false;
  function paintLive() {
    const totals = macroTotals(viewedDateStr());
    totals[key] = liveTotal;
    const targets = macroTargets();
    const loggedEl = document.getElementById("logged-" + key);
    if (loggedEl) loggedEl.textContent = liveTotal;
    const pct = targets[key] > 0 ? Math.round(100 * liveTotal / targets[key]) : 0;
    const pctEl = document.getElementById("pct-" + key);
    if (pctEl) pctEl.textContent = macroProgressText(liveTotal, targets[key]);
    const barEl = document.getElementById("bar-" + key);
    if (barEl) barEl.style.width = Math.min(100, pct) + "%";
    bar.setAttribute("aria-valuenow", String(liveTotal));
    bar.setAttribute("aria-valuetext", liveTotal + " grams");
    const slideTargetsSet = targets.protein > 0 || targets.carbs > 0 || targets.fat > 0;
    paintDonut(slideTargetsSet ? totals : { protein: 0, carbs: 0, fat: 0 });
    if (selectedMacro === key) {
      document.getElementById("macro-center-grams").textContent = liveTotal;
    }
    syncMacroAddLabels(totals, targets);
    renderCalories(totals);
  }
  bar.addEventListener("pointerdown", (e) => {
    sliding = true;
    moved = false;
    startX = e.clientX;
    startTotal = macroTotals(viewedDateStr())[key];
    liveTotal = startTotal;
    try { bar.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!sliding) return;
    const next = Math.max(0, startTotal + Math.round((e.clientX - startX) / 8));
    if (next !== liveTotal) moved = true;
    liveTotal = next;
    paintLive();
  });
  function endSlide() {
    if (!sliding) return;
    sliding = false;
    const delta = liveTotal - startTotal;
    if (delta !== 0) {
      if (moved) suppressMacroRowClick = true;
      adjustMacroBy(key, delta);
    } else {
      renderToday();
    }
  }
  bar.addEventListener("pointerup", endSlide);
  bar.addEventListener("pointercancel", () => {
    sliding = false;
    renderToday();
  });
  bar.addEventListener("keydown", (e) => {
    /* APG slider keys: Up and Right increase, Down and Left decrease,
       PageUp and PageDown step by 10, Home sets 0, End sets the target.
       aria-valuenow and aria-valuetext keep updating through
       adjustMacroBy and renderToday, as before. */
    const cur = macroTotals(viewedDateStr())[key];
    let delta = null;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") delta = 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") delta = -1;
    else if (e.key === "PageUp") delta = 10;
    else if (e.key === "PageDown") delta = -10;
    else if (e.key === "Home") delta = -cur;
    else if (e.key === "End") delta = (macroTargets()[key] || 0) - cur;
    if (delta === null || delta === 0) return;
    e.preventDefault();
    e.stopPropagation();
    adjustMacroBy(key, delta);
  });
}
MACRO_KEYS.forEach(bindMacroSlide);

/* ---------- v058: subtle plus/minus steppers ---------- */
/* One step at a time on the Today sliders, for people who find the
   bar hard to control precisely. Water and movement go through
   nudgeGoal, macros through adjustMacroBy, the same helpers the
   sliders and the type-in rows use, so the store, snapshots, and the
   backup cap behave exactly as before. Minus at zero is a no-op. */
function bindStepper(btnId, fn) {
  const b = document.getElementById(btnId);
  if (b) b.addEventListener("click", fn);
}
bindStepper("water-minus-btn", () => nudgeGoal("water", "oz", {}, -1));
bindStepper("water-plus-btn", () => nudgeGoal("water", "oz", {}, 1));
bindStepper("exercise-minus-btn", () => nudgeGoal("exercise", "minutes", { label: "Movement" }, -1));
bindStepper("exercise-plus-btn", () => nudgeGoal("exercise", "minutes", { label: "Movement" }, 1));
MACRO_KEYS.forEach((key) => {
  bindStepper(key + "-minus-btn", () => adjustMacroBy(key, -1));
  bindStepper(key + "-plus-btn", () => adjustMacroBy(key, 1));
});

/* Your foods first (v049, R-23): when the Log food form opens, the
   saved foods show with it, so logging a repeat takes one tap. Only
   when there is something saved; an empty library stays hidden. */
function openFoodLibraryIfAny() {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  if (Object.keys(foodLibrary()).length > 0) { renderFoodLibrary(); list.classList.remove("hidden"); }
}
document.getElementById("macro-log-food").addEventListener("click", () => {
  const form = document.getElementById("macro-food-form");
  const wasHidden = form.classList.contains("hidden");
  form.classList.toggle("hidden");
  if (wasHidden) {
    editingFoodId = null;
    const mealSel = document.getElementById("macro-food-meal");
    if (mealSel) mealSel.value = "";
    openFoodLibraryIfAny();
    syncFormCalories();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("macro-food-name").focus();
  }
});
document.getElementById("macro-food-cancel").addEventListener("click", () => {
  editingFoodId = null;
  document.getElementById("macro-food-form").classList.add("hidden");
  document.getElementById("macro-food-msg").textContent = "";
  document.getElementById("macro-food-search-status").textContent = "";
  const sr = document.getElementById("macro-food-search-results");
  sr.classList.add("hidden");
  sr.innerHTML = "";
});
/* Log food form: the Calories field follows the macros (4/4/9) as they
   are typed. A food filled from search, Your foods, or the archive
   shows its own calories; typing a calories value sticks until a macro
   changes, when it recomputes. */
function syncFormCalories() {
  const el = document.getElementById("macro-food-calories");
  if (!el) return;
  const p = Math.max(0, Math.round(Number(document.getElementById("macro-food-protein").value) || 0));
  const c = Math.max(0, Math.round(Number(document.getElementById("macro-food-carbs").value) || 0));
  const f = Math.max(0, Math.round(Number(document.getElementById("macro-food-fat").value) || 0));
  el.value = (p || c || f) ? Math.round(p * 4 + c * 4 + f * 9) : "";
}
["macro-food-protein", "macro-food-carbs", "macro-food-fat"].forEach((id) => {
  const input = document.getElementById(id);
  if (input) input.addEventListener("input", syncFormCalories);
});
document.getElementById("macro-food-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("macro-food-msg");
  const grams = Math.max(0, Math.round(Number(document.getElementById("macro-food-protein").value) || 0));
  const carbs = Math.max(0, Math.round(Number(document.getElementById("macro-food-carbs").value) || 0));
  const fat = Math.max(0, Math.round(Number(document.getElementById("macro-food-fat").value) || 0));
  const calories = Math.max(0, Math.round(Number(document.getElementById("macro-food-calories").value) || 0));
  if (grams <= 0 && carbs <= 0 && fat <= 0) {
    setFormStatus(msg, "Add at least one macro above zero first.", true);
    return;
  }
  const servingInput = document.getElementById("macro-food-serving");
  const serving = servingInput ? servingInput.value.trim().slice(0, 80) : "";
  const food = document.getElementById("macro-food-name").value.trim().slice(0, 120) || "Logged food";
  const mealSel = document.getElementById("macro-food-meal");
  const meal = mealSel && MEALS.includes(mealSel.value) ? mealSel.value : "";
  if (editingFoodId) {
    const i = (store.protein || []).findIndex((x) => x.id === editingFoodId);
    if (i !== -1) {
      const updated = { id: editingFoodId, date: viewedDateStr(), grams, carbs, fat, food, meal, calories, serving };
      if (pendingFoodPhoto) updated.photo = pendingFoodPhoto;
      store.protein[i] = updated;
    }
    editingFoodId = null;
  } else {
    const entry = { id: uid(), date: viewedDateStr(), grams, carbs, fat, food, meal, calories, serving };
    if (pendingFoodPhoto) entry.photo = pendingFoodPhoto;
    store.protein.push(entry);
  }
  // Auto-save to Your foods so this food can be picked again and the
  // macros fill in. No barcode here, so it saves by name. No extra tap.
  saveFoodToLibrary("", { name: food, brand: "", protein: grams, carbs, fat, calories: Math.round(grams * 4 + carbs * 4 + fat * 9) });
  saveStore();
  renderToday();
  document.getElementById("macro-food-form").classList.add("hidden");
  document.getElementById("macro-food-form").reset();
  document.getElementById("macro-food-search-status").textContent = "";
  const sr2 = document.getElementById("macro-food-search-results");
  sr2.classList.add("hidden");
  sr2.innerHTML = "";
  clearFoodPhoto();
});

/* ---------- Copy yesterday (v071) ---------- */
/* Copy yesterday's food into the day being viewed, as new entries.
   Tapping twice does not duplicate: a food already copied today with
   the same name and protein grams is skipped. */
function copyYesterdayFoods() {
  const msg = document.getElementById("copy-yesterday-food-msg");
  const target = viewedDateStr();
  const source = todayStr(viewOffset - 1);
  const yesterdays = (store.protein || []).filter((e) => e.date === source);
  if (!yesterdays.length) {
    if (msg) msg.textContent = "Nothing logged yesterday.";
    return;
  }
  const todays = (store.protein || []).filter((e) => e.date === target);
  let copied = 0;
  yesterdays.forEach((e) => {
    const already = todays.some((x) => (x.food || "").trim().toLowerCase() === (e.food || "").trim().toLowerCase() && Number(x.grams) === Number(e.grams));
    if (already) return;
    store.protein.push({ id: uid(), date: target, grams: e.grams, carbs: e.carbs, fat: e.fat, food: e.food, meal: e.meal, calories: e.calories, ...(e.serving ? { serving: e.serving } : {}) });
    copied++;
  });
  if (!copied) {
    if (msg) msg.textContent = "Already copied. Nothing new to add.";
    return;
  }
  saveStore();
  renderToday();
  if (msg) msg.textContent = "Copied " + copied + (copied === 1 ? " food" : " foods") + " from yesterday.";
}
document.getElementById("copy-yesterday-food").addEventListener("click", copyYesterdayFoods);

/* ---------- Food library (v028) ---------- */
/* Foods already logged, saved on this device only and reused instantly.
   Keyed by barcode when scanned, or by name ("name:...") when logged by
   hand. A lookup or a log that succeeds saves the food here on its own,
   so there is no extra save step. A scan checks here first. */
const FOOD_LIBRARY_MAX = 200;
const FOOD_LIBRARY_SUGGEST_DAYS = 60;
let libraryNote = "";
function foodLibrary() {
  if (!store.foodLibrary || typeof store.foodLibrary !== "object" || Array.isArray(store.foodLibrary)) store.foodLibrary = {};
  return store.foodLibrary;
}
/* ---------- Food archive (v031) ---------- */
/* Archived foods live on this device only, same entry shape as the
   library. Archiving moves a food out of the active list but never
   deletes it. Restoring brings it back. Removing from the archive is
   the only permanent delete, and only from the archive, never from
   the active list. */
function foodArchive() {
  if (!store.foodArchive || typeof store.foodArchive !== "object" || Array.isArray(store.foodArchive)) store.foodArchive = {};
  return store.foodArchive;
}
function archiveFood(key) {
  const lib = foodLibrary();
  const f = lib[key];
  if (!f) return false;
  foodArchive()[key] = f;
  delete lib[key];
  saveStore();
  return true;
}
function restoreArchivedFood(key) {
  const arch = foodArchive();
  const f = arch[key];
  if (!f) return false;
  foodLibrary()[key] = f;
  delete arch[key];
  saveStore();
  return true;
}
function removeArchivedFood(key) {
  const arch = foodArchive();
  if (!arch[key]) return false;
  delete arch[key];
  saveStore();
  return true;
}
/* Archive the foods not used in the last 60 days. savedAt is the last
   used time; a missing savedAt counts as old. Returns how many moved. */
function archiveOldFoods() {
  const lib = foodLibrary();
  const cutoff = Date.now() - FOOD_LIBRARY_SUGGEST_DAYS * 24 * 60 * 60 * 1000;
  const arch = foodArchive();
  let moved = 0;
  Object.keys(lib).forEach((k) => {
    const f = lib[k];
    const when = f && Number.isFinite(Number(f.savedAt)) ? Number(f.savedAt) : 0;
    if (when < cutoff) { arch[k] = f; delete lib[k]; moved++; }
  });
  if (moved) saveStore();
  return moved;
}
function saveFoodToLibrary(barcode, food) {
  const lib = foodLibrary();
  if (!food || typeof food.name !== "string" || food.name.trim() === "") return;
  // Key: barcode digits when present, otherwise a name key so a food
  // logged by hand (no barcode) still saves and can be picked again.
  // The "name:" prefix keeps name keys from colliding with barcodes.
  // The name part is capped so the key stays within the 40-char limit
  // the stored-value validation uses for the barcode field.
  let key = String(barcode || "").trim().replace(/[^0-9]/g, "");
  if (!key) {
    const norm = food.name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 32);
    if (!norm) return;
    key = "name:" + norm;
  }
  const num = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : 0;
  lib[key] = {
    barcode: key,
    name: food.name.trim().slice(0, 120),
    brand: typeof food.brand === "string" ? food.brand.trim().slice(0, 80) : "",
    protein: num(food.protein),
    carbs: num(food.carbs),
    fat: num(food.fat),
    calories: num(food.calories),
    savedAt: Date.now()
  };
  // Keep the library slim: move the oldest entries past the cap to the
  // archive instead of deleting them. Nothing is ever silently deleted.
  const keys = Object.keys(lib);
  let archived = 0;
  if (keys.length > FOOD_LIBRARY_MAX) {
    keys.sort((a, b) => (lib[a].savedAt || 0) - (lib[b].savedAt || 0));
    const arch = foodArchive();
    keys.slice(0, keys.length - FOOD_LIBRARY_MAX).forEach((k) => { arch[k] = lib[k]; delete lib[k]; archived++; });
    if (archived) libraryNote = "The oldest foods moved to your archive.";
  }
  saveStore();
  return archived;
}
function getFoodFromLibrary(barcode) {
  const code = String(barcode || "").trim().replace(/[^0-9]/g, "");
  if (!code) return null;
  const f = foodLibrary()[code];
  return f && typeof f === "object" ? f : null;
}
function libraryFoodsMatching(query) {
  const q = String(query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  return Object.values(foodLibrary())
    .filter((f) => f && typeof f.name === "string" && (f.name.toLowerCase().includes(q) || (f.brand || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, 5);
}
function libraryFoodLabel(f) {
  const cals = Math.round((f.protein || 0) * 4 + (f.carbs || 0) * 4 + (f.fat || 0) * 9);
  return f.name + (cals > 0 ? "  ·  " + cals + " cal" : "") + "  ·  P " + (f.protein || 0) + "g  C " + (f.carbs || 0) + "g  F " + (f.fat || 0) + "g";
}
function fillFoodForm(name, protein, carbs, fat, note, calories, serving) {
  document.getElementById("macro-food-name").value = String(name || "").slice(0, 120);
  document.getElementById("macro-food-protein").value = protein || "";
  document.getElementById("macro-food-carbs").value = carbs || "";
  document.getElementById("macro-food-fat").value = fat || "";
  const calEl = document.getElementById("macro-food-calories");
  if (calEl) {
    const own = Number(calories);
    calEl.value = Number.isFinite(own) && own > 0 ? Math.round(own)
      : ((protein || carbs || fat) ? Math.round((Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9) : "");
  }
  const servingEl = document.getElementById("macro-food-serving");
  if (servingEl) servingEl.value = String(serving || "").slice(0, 80);
  const status = document.getElementById("macro-food-search-status");
  if (status && note) status.textContent = note;
}
/* The "Your foods" list: every food already logged, newest first.
   Tap a row to fill the form and log it again. Archive moves a food
   to the archive (never deleted). The
   only permanent delete is the x in the Archived foods view. */
function renderFoodLibrary() {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  const foods = Object.values(foodLibrary()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  list.innerHTML = "";
  if (libraryNote) {
    const note = document.createElement("p");
    note.className = "muted";
    note.style.cssText = "font-size:.9em;margin:0 0 8px";
    note.textContent = libraryNote;
    list.appendChild(note);
    libraryNote = "";
  }
  if (foods.length >= 150) {
    const sug = document.createElement("p");
    sug.className = "muted";
    sug.style.cssText = "font-size:.9em;margin:0 0 6px";
    sug.textContent = "Your foods is getting long. Archive the ones you no longer use to keep it quick.";
    list.appendChild(sug);
    const ab = document.createElement("button");
    ab.type = "button";
    ab.className = "btn btn-small";
    ab.style.cssText = "margin-bottom:10px";
    ab.textContent = "Archive old foods";
    ab.addEventListener("click", () => {
      const moved = archiveOldFoods();
      libraryNote = moved > 0
        ? "Archived " + moved + (moved === 1 ? " food." : " foods.") + " You can bring one back anytime."
        : "No foods are old enough to archive yet.";
      renderFoodLibrary();
    });
    list.appendChild(ab);
  }
  if (!foods.length) {
    const empty = document.createElement("p");
    empty.className = "muted empty-state";
    empty.style.cssText = "font-size:.9em;margin:0";
    empty.textContent = "No foods saved yet.";
    list.appendChild(empty);
  } else {
    foods.forEach((f) => {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small";
      b.style.cssText = "flex:1;text-align:left;white-space:normal";
      b.textContent = libraryFoodLabel(f);
      b.addEventListener("click", () => {
        fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your foods. Check and edit before saving.", f.calories);
        list.classList.add("hidden");
      });
      const arc = document.createElement("button");
      arc.type = "button";
      arc.className = "btn btn-small";
      arc.setAttribute("aria-label", "Archive " + f.name);
      arc.textContent = "Archive";
      arc.addEventListener("click", () => {
        if (archiveFood(f.barcode)) libraryNote = "Moved to your archive. You can bring it back anytime.";
        renderFoodLibrary();
      });
      row.appendChild(b);
      row.appendChild(arc);
      list.appendChild(row);
    });
  }
  const archivedCount = Object.keys(foodArchive()).length;
  const av = document.createElement("button");
  av.type = "button";
  av.className = "btn btn-small";
  av.style.cssText = "margin-top:6px";
  av.textContent = "Archived foods" + (archivedCount ? " (" + archivedCount + ")" : "");
  av.addEventListener("click", () => renderFoodArchive());
  list.appendChild(av);
}

/* The archived foods view: foods moved out of Your foods, newest first.
   Restore brings one back to Your foods. The small x removes it from
   the archive for good. Shown inside the same Your foods area. */
function renderFoodArchive() {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  const foods = Object.values(foodArchive()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  list.innerHTML = "";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn btn-small";
  back.style.cssText = "margin-bottom:10px";
  back.textContent = "Back to Your foods";
  back.addEventListener("click", () => renderFoodLibrary());
  list.appendChild(back);
  const head = document.createElement("p");
  head.className = "muted";
  head.style.cssText = "font-size:.9em;margin:0 0 8px";
  head.textContent = "Archived foods. Archiving never deletes a food. Restore brings one back to Your foods.";
  list.appendChild(head);
  if (!foods.length) {
    const empty = document.createElement("p");
    empty.className = "muted empty-state";
    empty.style.cssText = "font-size:.9em;margin:0";
    empty.textContent = "Nothing archived yet.";
    list.appendChild(empty);
    return;
  }
  foods.forEach((f) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:6px";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-small";
    b.style.cssText = "flex:1;text-align:left;white-space:normal";
    b.textContent = libraryFoodLabel(f);
    b.addEventListener("click", () => {
      fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your archive. Check and edit before saving.", f.calories);
      list.classList.add("hidden");
    });
    const rs = document.createElement("button");
    rs.type = "button";
    rs.className = "btn btn-small";
    rs.setAttribute("aria-label", "Restore " + f.name + " to your foods");
    rs.textContent = "Restore";
    rs.addEventListener("click", () => {
      if (foodLibrary()[f.barcode]) {
        removeArchivedFood(f.barcode);
        libraryNote = "Already in Your foods.";
      } else if (restoreArchivedFood(f.barcode)) {
        libraryNote = "Restored to Your foods.";
      }
      renderFoodLibrary();
    });
    const x = document.createElement("button");
    x.type = "button";
    x.className = "btn btn-small";
    x.setAttribute("aria-label", "Remove " + f.name + " from the archive");
    x.textContent = "×";
    x.addEventListener("click", () => {
      removeArchivedFood(f.barcode);
      renderFoodArchive();
    });
    row.appendChild(b);
    row.appendChild(rs);
    row.appendChild(x);
    list.appendChild(row);
  });
}

/* Fetch JSON from the food database, with one retry. Open Food Facts
   sometimes answers with an error page instead of JSON, so check
   res.ok before parsing. A missing product answers 404 with a JSON
   body ({status: 0, status_verbose: "product not found"}), so return
   that instead of null: the caller then says "not found" rather than
   "temporarily unavailable". Returns the parsed JSON, or null when the
   database is down or unreachable after one retry. */
async function fetchFoodJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 404) {
        try { return await res.json(); } catch { return { status: 0 }; }
      }
    } catch {}
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/* ---------- Food search by name (sandbox feature) ---------- */
/* Type a food name, search Open Food Facts (free, no key), and tap a
   result to fill the name and macros from the label. Values are per
   serving when available, otherwise per 100 g, and the user edits them
   before logging. */
/* Open the Your foods library: the working fallback when the food
   database is down, so the user can log from foods already saved. */
function openFoodLibrary() {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  if (list.classList.contains("hidden")) { renderFoodLibrary(); list.classList.remove("hidden"); }
}

/* Food search results (v064): how many database results to show before
   "Show more", and the ranked list from the last search, so Show more
   can reveal the rest without fetching again. Reset on every new search. */
const FOOD_SEARCH_FIRST_SHOWN = 10;
let lastFoodSearchResults = [];
/* Food search ranking: Open Food Facts returns branded products above
   plain foods, so a "potato" search shows chips before a potato. Re-sort
   before display: plain foods first (name equals or starts with the
   search term, no brand), then plain foods containing the term, then
   branded foods the same way, then the rest in the order the database
   returned. Within a rank, a food with nutrition values sorts before
   one without, so a tap always has something to fill. Branded results
   stay, only the order changes. */
function rankFoodSearchResults(products, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return products.slice();
  const hasNutrition = (p) => {
    const n = (p && p.nutriments) || {};
    return (Number(n.proteins_100g) || 0) > 0
      || (Number(n.carbohydrates_100g) || 0) > 0
      || (Number(n.fat_100g) || 0) > 0
      || (Number(n.proteins_serving) || 0) > 0
      || (Number(n.carbohydrates_serving) || 0) > 0
      || (Number(n.fat_serving) || 0) > 0;
  };
  const rankOf = (p) => {
    const name = ((p && p.product_name) || "").trim().toLowerCase();
    const brand = ((p && p.brands) || "").trim();
    const starts = name && name.indexOf(q) === 0;
    const contains = name && name.indexOf(q) !== -1;
    if (!brand && starts) return 0;
    if (!brand && contains) return 1;
    if (brand && starts) return 2;
    if (brand && contains) return 3;
    return 4;
  };
  return products
    .map((p, i) => ({ p, i, rank: rankOf(p), fed: hasNutrition(p) ? 0 : 1 }))
    .sort((a, b) => (a.rank - b.rank) || (a.fed - b.fed) || (a.i - b.i))
    .map((x) => x.p);
}

/* One food search result button: the name, calories, and macros, and a
   tap fills the Log food form. Shared by the first results and by
   Show more, so both build the same button. Fills through
   fillFoodForm, so the serving size from the label rides along (v071). */
function appendFoodSearchResult(p) {
  const results = document.getElementById("macro-food-search-results");
  if (!results) return;
  const n = p.nutriments || {};
  const pick = (servingKey, hundredKey) => {
    if (n[servingKey] !== undefined && n[servingKey] !== null) return Number(n[servingKey]);
    if (n[hundredKey] !== undefined && n[hundredKey] !== null) return Number(n[hundredKey]);
    return 0;
  };
  const protein = pick("proteins_serving", "proteins_100g");
  const carbs = pick("carbohydrates_serving", "carbohydrates_100g");
  const fat = pick("fat_serving", "fat_100g");
  const hasServing = n.proteins_serving !== undefined || n.carbohydrates_serving !== undefined || n.fat_serving !== undefined;
  const name = [p.product_name, p.brands].filter(Boolean).join(" - ") || "Food";
  const cals = Math.round(protein * 4 + carbs * 4 + fat * 9);
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-small";
  b.style.cssText = "display:block;width:100%;text-align:left;margin-bottom:6px;white-space:normal";
  b.textContent = name + "  ·  P " + protein + "g  C " + carbs + "g  F " + fat + "g" + (hasServing ? "" : " (per 100 g)");
  b.addEventListener("click", () => {
    fillFoodForm(name, protein, carbs, fat, hasServing ? "Filled from the label. Check and edit before saving." : "Filled per 100 g. Scale to your portion before saving.", cals > 0 ? cals : "", typeof p.serving_size === "string" ? p.serving_size : "");
    results.classList.add("hidden");
    results.innerHTML = "";
  });
  results.appendChild(b);
}
async function searchFoodByName() {
  const nameInput = document.getElementById("macro-food-name");
  const status = document.getElementById("macro-food-search-status");
  const results = document.getElementById("macro-food-search-results");
  const query = (nameInput.value || "").trim();
  if (query.length < 2) { status.textContent = "Type at least 2 letters first."; return; }
  status.textContent = "Searching foods...";
  results.classList.add("hidden");
  results.innerHTML = "";
  // Your foods first: a food already scanned can be tapped and logged
  // again in one tap, with no network wait.
  const mine = libraryFoodsMatching(query);
  if (mine.length) {
    const head = document.createElement("p");
    head.className = "muted";
    head.style.cssText = "margin:0 0 6px;font-size:.85em;font-weight:700";
    head.textContent = "Your foods";
    results.appendChild(head);
    mine.forEach((f) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small";
      b.style.cssText = "display:block;width:100%;text-align:left;margin-bottom:6px;white-space:normal";
      b.textContent = libraryFoodLabel(f);
      b.addEventListener("click", () => {
        fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your foods. Check and edit before saving.", f.calories);
        results.classList.add("hidden");
        results.innerHTML = "";
      });
      results.appendChild(b);
    });
    results.classList.remove("hidden");
    status.textContent = "Pick a food.";
  }
  try {
    const data = await fetchFoodJson("https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + encodeURIComponent(query) + "&search_simple=1&action=process&json=1&page_size=50&countries_tags_en=united-states&fields=product_name,brands,nutriments,serving_size");
    if (!data) { status.textContent = "The food database is temporarily unavailable. Try again in a moment, or enter the grams by hand."; openFoodLibrary(); return; }
    const products = rankFoodSearchResults((data && data.products) || [], query);
    if (!products.length) {
      status.textContent = mine.length ? "Pick a food, or try different words." : "No foods found. Try different words, or enter the grams by hand.";
      return;
    }
    if (!mine.length) status.textContent = "Pick a food.";
    if (!mine.length) status.textContent = "Pick a food.";
    lastFoodSearchResults = products;
    products.slice(0, FOOD_SEARCH_FIRST_SHOWN).forEach((p) => appendFoodSearchResult(p));
    if (products.length > FOOD_SEARCH_FIRST_SHOWN) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "btn btn-small";
      more.style.cssText = "display:block;width:100%;text-align:center;margin-bottom:6px";
      more.textContent = "Show more (" + (products.length - FOOD_SEARCH_FIRST_SHOWN) + " more)";
      more.addEventListener("click", () => {
        lastFoodSearchResults.slice(FOOD_SEARCH_FIRST_SHOWN).forEach((p) => appendFoodSearchResult(p));
        more.remove();
      });
      results.appendChild(more);
    }
    results.classList.remove("hidden");
  } catch (e) {
    status.textContent = "The food database is temporarily unavailable. Try again in a moment, or enter the grams by hand.";
    openFoodLibrary();
  }
}
document.getElementById("macro-food-search-btn").addEventListener("click", searchFoodByName);
document.getElementById("macro-food-library-btn").addEventListener("click", () => {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  if (list.classList.contains("hidden")) { renderFoodLibrary(); list.classList.remove("hidden"); }
  else list.classList.add("hidden");
});

/* ---------- Voice food logging (sandbox feature) ---------- */
/* Speak a food name with the phone's built-in speech recognition; the
   words fill the name field as you speak, and when you stop, the food
   search runs automatically so the macros fill in from the label.
   On-device and free; no audio is recorded, saved, or sent anywhere.
   The button stays hidden when recognition is not available. */
(function setupFoodVoice() {
  const btn = document.getElementById("macro-food-voice-btn");
  const nameInput = document.getElementById("macro-food-name");
  const status = document.getElementById("macro-food-search-status");
  if (!btn || !nameInput) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  btn.classList.remove("hidden");
  let rec = null;
  let listening = false;
  let finalText = "";
  function setListening(on) {
    listening = on;
    btn.textContent = on ? "⏹ Stop" : "🎤 Speak";
    btn.setAttribute("aria-label", on ? "Stop listening" : "Speak the food name");
    if (status) status.textContent = on ? "Listening... Tap Stop when you are done." : "";
  }
  btn.addEventListener("click", () => {
    if (listening) { try { rec.stop(); } catch {} return; }
    try { rec = new SR(); } catch { return; }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      nameInput.value = (finalText + interim).trimStart().slice(0, 120);
    };
    rec.onend = () => {
      setListening(false);
      if (nameInput.value.trim().length >= 2) searchFoodByName();
    };
    rec.onerror = (ev) => {
      setListening(false);
      if (status) status.textContent = ev && ev.error === "not-allowed"
        ? "Microphone access was blocked. You can still type."
        : "I could not hear you. You can still type.";
    };
    try { rec.start(); setListening(true); } catch { setListening(false); }
  });
})();

/* ---------- Food photo (sandbox feature) ---------- */
/* A photo is a visual record attached to a food entry. It is stored as a
   downscaled JPEG data URL on the entry itself, so deleting the entry
   deletes its photo. Snapshots strip the picture and keep a flag, the
   same way progress photos are handled. No AI estimation in this version;
   the user enters the grams by hand. */
let pendingFoodPhoto = null;
function clearFoodPhoto() {
  pendingFoodPhoto = null;
  const input = document.getElementById("macro-food-photo");
  if (input) input.value = "";
  const preview = document.getElementById("macro-food-photo-preview");
  if (preview) preview.classList.add("hidden");
  const thumb = document.getElementById("macro-food-photo-thumb");
  if (thumb) thumb.src = "";
}
document.getElementById("macro-food-photo-btn").addEventListener("click", () => {
  document.getElementById("macro-food-photo").click();
});
document.getElementById("macro-food-photo").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => setFormStatus(document.getElementById("macro-food-msg"), "That photo could not be read. Try a different photo.", true);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => setFormStatus(document.getElementById("macro-food-msg"), "That photo could not be read. Try a different photo.", true);
    img.onload = () => {
      const maxDim = 800;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      pendingFoodPhoto = canvas.toDataURL("image/jpeg", 0.7);
      const thumb = document.getElementById("macro-food-photo-thumb");
      if (thumb) thumb.src = pendingFoodPhoto;
      document.getElementById("macro-food-photo-preview").classList.remove("hidden");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});
document.getElementById("macro-food-photo-remove").addEventListener("click", clearFoodPhoto);

/* Food log list for the viewed day, with photo thumbnails. Tapping a
   thumbnail opens the photo larger. Deleting an entry deletes its photo,
   because the photo lives on the entry. */
/* v052: one short note under a food's macros, when something about it
   is worth a line. Only from data the entry already carries. */
function foodNote(e) {
  const p = Number(e.grams) || 0, c = Number(e.carbs) || 0, f = Number(e.fat) || 0;
  if (p >= 15) return "High in protein.";
  if (c >= 30 && p < 5) return "Mostly carbs.";
  if (f >= 20) return "High in fat.";
  return "";
}
function renderFoodLog() {
  const list = document.getElementById("food-log-list");
  if (!list) return;
  const t = viewedDateStr();
  const entries = store.protein.filter((e) => e.date === t);
  const itemHtml = (e) => `
    <div class="today-entry" style="display:flex;align-items:center;gap:10px;margin:6px 0">
      ${e.photo ? `<button type="button" class="food-photo-thumb" data-photo="${e.id}" aria-label="View photo for ${escapeHtml(e.food || "Logged food")}" style="padding:0;border:1px solid var(--sage-border);border-radius:10px;overflow:hidden;flex:none;background:none;cursor:pointer"><img src="${e.photo}" alt="" style="width:48px;height:48px;object-fit:cover;display:block"></button>` : ""}
      <span style="flex:1">${escapeHtml(e.food || "Logged food")}${e.serving ? ` &middot; ${escapeHtml(String(e.serving).slice(0, 80))}` : ""} &middot; ${escapeHtml(e.grams)} g protein${(Number(e.carbs) || 0) || (Number(e.fat) || 0) ? ` &middot; ${Number(e.carbs) || 0}g carbs &middot; ${Number(e.fat) || 0}g fat` : ""}${foodNote(e) ? `<div class="food-note">${foodNote(e)}</div>` : ""}</span>
      <button type="button" class="btn btn-small" data-edit-food="${e.id}" aria-label="Edit food entry: ${escapeHtml(e.food || "Logged food")}">Edit</button>
      <button type="button" class="btn btn-small btn-danger" data-del-food="${e.id}" aria-label="Remove food entry: ${escapeHtml(e.food || "Logged food")}">Remove</button>
    </div>`;
  const rowHtml = (meal, items) => {
    const kcal = items.reduce((s, e) => s + entryCalories(e), 0);
    const total = items.length
      ? items.length + (items.length === 1 ? " food · " : " foods · ") + kcal + " cal"
      : "";
    return "<div class=\"meal-row\">"
      + "<div class=\"meal-head\"><span class=\"meal-name\">" + meal + "</span>"
      + "<span class=\"muted meal-total\">" + total + "</span>"
      + "<button type=\"button\" class=\"btn btn-small\" data-meal-log=\"" + meal + "\" aria-label=\"Log food for " + meal + "\">Log</button></div>"
      + items.map(itemHtml).join("")
      + "</div>";
  };
  let html = MEALS.map((meal) => rowHtml(meal, entries.filter((e) => mealOf(e) === meal))).join("");
  const untagged = entries.filter((e) => mealOf(e) === "");
  if (untagged.length) {
    html += "<div class=\"meal-row\">"
      + "<div class=\"meal-head\"><span class=\"meal-name\">Other foods</span>"
      + "<span class=\"muted meal-total\">" + untagged.length + (untagged.length === 1 ? " food" : " foods") + " · not grouped by meal</span></div>"
      + untagged.map(itemHtml).join("")
      + "</div>";
  }
  list.innerHTML = html;
  list.querySelectorAll("[data-meal-log]").forEach((b) => b.addEventListener("click", () => openFoodFormForMeal(b.dataset.mealLog)));
  list.querySelectorAll("[data-edit-food]").forEach((b) => b.addEventListener("click", () => {
    const entry = store.protein.find((x) => x.id === b.dataset.editFood);
    if (!entry) return;
    editingFoodId = entry.id;
    document.getElementById("macro-food-name").value = entry.food || "";
    document.getElementById("macro-food-protein").value = Number(entry.grams) || "";
    document.getElementById("macro-food-carbs").value = Number(entry.carbs) || "";
    document.getElementById("macro-food-fat").value = Number(entry.fat) || "";
    document.getElementById("macro-food-calories").value = entryCalories(entry) || "";
    const servingInput = document.getElementById("macro-food-serving");
    if (servingInput) servingInput.value = entry.serving || "";
    const mealSel = document.getElementById("macro-food-meal");
    if (mealSel) mealSel.value = mealOf(entry);
    document.getElementById("macro-food-form").classList.remove("hidden");
    document.getElementById("macro-food-form").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("macro-food-name").focus();
  }));
  list.querySelectorAll("[data-del-food]").forEach((b) => b.addEventListener("click", () => {
    store.protein = store.protein.filter((x) => x.id !== b.dataset.delFood);
    saveStore();
    renderToday();
  }));
  list.querySelectorAll("[data-photo]").forEach((b) => b.addEventListener("click", () => {
    const entry = store.protein.find((x) => x.id === b.dataset.photo);
    if (!entry || !entry.photo) return;
    const img = document.getElementById("food-photo-large");
    if (img) img.src = entry.photo;
    document.getElementById("food-photo-modal").classList.remove("hidden");
  }));
}

document.getElementById("food-photo-close").addEventListener("click", () => {
  document.getElementById("food-photo-modal").classList.add("hidden");
  const img = document.getElementById("food-photo-large");
  if (img) img.src = "";
});
document.getElementById("food-photo-modal").addEventListener("click", (e) => {
  if (e.target.id === "food-photo-modal") {
    document.getElementById("food-photo-modal").classList.add("hidden");
    const img = document.getElementById("food-photo-large");
    if (img) img.src = "";
  }
});

/* ---------- Barcode scanner (sandbox feature, ported from v121) ---------- */
/* Camera scanning uses the native BarcodeDetector when available, then
   html5-qrcode for iPhone, then ZXing as a backup. Typing the barcode
   number works when the camera is unavailable. Lookup is free from
   Open Food Facts. Values are per serving when available, otherwise
   per 100 g, and the user edits them before logging. */
let scanStream = null;
let scanZxingReader = null;
let scanHtml5 = null;
/* Serving size from the last barcode lookup (v071): filled into the
   logged entry when the scan is saved. Blank when the label has none. */
let scanServing = "";
async function stopScanCamera() {
  try { if (scanHtml5) { await scanHtml5.stop(); scanHtml5.clear(); scanHtml5 = null; } } catch {}
  try { if (scanZxingReader) scanZxingReader.reset(); } catch {}
  if (scanStream) { scanStream.getTracks().forEach((tr) => tr.stop()); scanStream = null; }
}
/* One camera view only: the native and ZXing readers use #scan-video,
   html5-qrcode renders its own view inside #scan-reader. Only one is
   ever visible, so there is never a black empty box on top of the live
   camera. The gold frame guide sits over whichever view is showing. */
function setScanView(which) {
  const video = document.getElementById("scan-video");
  const reader = document.getElementById("scan-reader");
  if (video) video.style.display = which === "video" ? "block" : "none";
  if (reader) reader.style.display = which === "reader" ? "block" : "none";
}
function openScanModal() {
  const m = document.getElementById("scan-modal");
  if (!m) return;
  recordDialogOpener("scan-modal");
  m.classList.remove("hidden");
  m.style.display = "flex";
  document.getElementById("scan-status").textContent = "Starting camera...";
  updateScanActionBtn();
  const closeBtn = document.getElementById("scan-close-btn");
  if (closeBtn) closeBtn.focus();
  startScanCamera();
}
function closeScanModal() {
  stopScanCamera();
  scanServing = "";
  const m = document.getElementById("scan-modal");
  if (m) { m.classList.add("hidden"); m.style.display = "none"; }
  returnDialogFocus("scan-modal", "macro-scan-food");
}
async function lookupBarcode(code) {
  const status = document.getElementById("scan-status");
  code = (code || "").trim().replace(/[^0-9]/g, "");
  if (!code) { status.textContent = "Enter a barcode number to look it up."; return; }
  // Your foods first: a barcode already scanned fills in instantly,
  // with no network wait.
  const saved = getFoodFromLibrary(code);
  if (saved) {
    const name = saved.brand ? saved.name + " - " + saved.brand : saved.name;
    document.getElementById("scan-product-name").textContent = name;
    document.getElementById("scan-product-serving").textContent = "From your foods. Check the label and edit the grams before logging.";
    scanServing = typeof saved.serving === "string" ? saved.serving : "";
    document.getElementById("scan-food").value = name;
    document.getElementById("scan-protein").value = saved.protein || "";
    document.getElementById("scan-carbs").value = saved.carbs || "";
    document.getElementById("scan-fat").value = saved.fat || "";
    document.getElementById("scan-result").classList.remove("hidden");
    status.textContent = "Found in your foods.";
    return;
  }
  status.textContent = "Looking up barcode, free from Open Food Facts...";
  try {
    const data = await fetchFoodJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_size,quantity`);
    if (!data) { status.textContent = "The food database is temporarily unavailable. Try again, or enter the grams by hand."; return; }
    if (data.status !== 1 || !data.product) { status.textContent = "Barcode not found in Open Food Facts. Check the number, or enter the grams by hand."; return; }
    const p = data.product;
    const n = p.nutriments || {};
    const pick = (servingKey, hundredKey) => {
      if (n[servingKey] !== undefined && n[servingKey] !== null) return Number(n[servingKey]);
      if (n[hundredKey] !== undefined && n[hundredKey] !== null) return Number(n[hundredKey]);
      return 0;
    };
    const protein = pick("proteins_serving", "proteins_100g");
    const carbs = pick("carbohydrates_serving", "carbohydrates_100g");
    const fat = pick("fat_serving", "fat_100g");
    const name = [p.product_name, p.brands].filter(Boolean).join(" - ") || "Scanned food";
    const scanCals = Math.round(protein * 4 + carbs * 4 + fat * 9);
    scanServing = typeof p.serving_size === "string" ? p.serving_size : "";
    // Saved to your foods on its own, so the next scan is instant.
    saveFoodToLibrary(code, { name: p.product_name || "Scanned food", brand: p.brands || "", protein, carbs, fat, calories: scanCals });
    document.getElementById("scan-product-name").textContent = name;
    const hasServing = n.proteins_serving !== undefined || n.carbohydrates_serving !== undefined || n.fat_serving !== undefined;
    document.getElementById("scan-product-serving").textContent = hasServing
      ? (p.serving_size ? `Serving: ${p.serving_size}. Values below are per serving. Edit them to match your portion.` : "Values below are per serving. Edit them to match your portion.")
      : "These values are per 100 g, not per serving. Scale them to your portion before logging.";
    document.getElementById("scan-food").value = name;
    document.getElementById("scan-protein").value = protein || "";
    document.getElementById("scan-carbs").value = carbs || "";
    document.getElementById("scan-fat").value = fat || "";
    document.getElementById("scan-result").classList.remove("hidden");
    status.textContent = hasServing
      ? "Found. Check the label and edit the grams before logging. No calories are shown or logged."
      : "Found, but only per 100 g values were available. Scale them to your portion before logging. No calories are shown or logged.";
  } catch (e) {
    status.textContent = "The food database is temporarily unavailable. Try again, or enter the grams by hand.";
  }
}
/* v057: the camera-reader libraries ship as local files (assets/js/),
   precached by the service worker, so the scanner works offline and
   when the CDN is unreachable. The CDN stays as a fallback if the
   local file fails to load. */
/* Load a reader library, local file first, CDN fallback. v080: stronger
   loading. The reader failed to load on iPhone (v078), so retry the
   whole local-then-CDN sequence once after a short wait instead of
   giving up after a single pass. */
function loadScriptLocalFirst(localSrc, cdnSrc) {
  const loadOne = (src) => new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  const trySequence = async () => {
    try { await loadOne(localSrc); }
    catch { await loadOne(cdnSrc); }
  };
  return (async () => {
    try { await trySequence(); return; }
    catch {}
    await new Promise((r) => setTimeout(r, 1500));
    await trySequence();
  })();
}
async function startScanCamera() {
  const status = document.getElementById("scan-status");
  const video = document.getElementById("scan-video");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanStream = stream; video.srcObject = stream; await video.play();
    setScanView("video");
    status.textContent = "Camera on. Hold the barcode inside the frame.";
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
        const loop = async () => {
          if (!scanStream) return;
          try {
            const codes = await detector.detect(video);
            if (codes && codes.length) {
              document.getElementById("scan-barcode-input").value = codes[0].rawValue;
              stopScanCamera(); lookupBarcode(codes[0].rawValue); return;
            }
          } catch {}
          setTimeout(loop, 500);
        };
        loop(); return;
      } catch {}
    }
    try {
      if (!window.Html5Qrcode) {
        status.textContent = "Loading the camera reader...";
        await loadScriptLocalFirst("assets/js/html5-qrcode.min.js", "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js");
      }
      if (scanStream) { scanStream.getTracks().forEach((tr) => tr.stop()); scanStream = null; }
      video.srcObject = null;
      setScanView("reader");
      scanHtml5 = new Html5Qrcode("scan-reader");
      status.textContent = "Hold the barcode inside the frame. Tap Capture or type the number.";
      // The scan area matches the gold frame on screen: most of the
      // camera width, 180 px tall, so a barcode inside the frame reads.
      const viewEl = document.getElementById("scan-view");
      const viewW = viewEl ? viewEl.clientWidth : 320;
      const boxW = Math.max(200, Math.min(300, Math.floor(viewW * 0.86)));
      await scanHtml5.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: boxW, height: 180 } },
        (decodedText) => {
          document.getElementById("scan-barcode-input").value = decodedText;
          stopScanCamera(); lookupBarcode(decodedText);
        },
        () => {}
      );
      return;
    } catch (e) {
      status.textContent = "Camera reader did not load. Trying the backup reader, or type the number below.";
      try { if (scanHtml5) { await scanHtml5.stop(); scanHtml5.clear(); scanHtml5 = null; } } catch {}
    }
    if (!scanStream) {
      try {
        scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = scanStream; await video.play();
      } catch {}
    }
    setScanView("video");
    if (!window.ZXingBrowser) {
      await loadScriptLocalFirst("assets/js/zxing-browser.min.js", "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js");
    }
    const ZX = window.ZXingBrowser;
    scanZxingReader = new ZX.BrowserMultiFormatReader();
    status.textContent = "Backup camera reader loaded. Hold the barcode inside the frame. If nothing happens, tap Capture below or type the number.";
    const onResult = (result) => {
      if (result) {
        const code = result.getText();
        document.getElementById("scan-barcode-input").value = code;
        stopScanCamera(); lookupBarcode(code);
      }
    };
    if (scanStream && typeof scanZxingReader.decodeFromStream === "function") {
      scanZxingReader.decodeFromStream(scanStream, video, onResult);
    } else {
      scanZxingReader.decodeFromVideoDevice(null, video, onResult);
    }
  } catch (e) {
    status.textContent = "Camera is not available here. Type the barcode number below instead.";
  }
}
/* Manual capture: when automatic detection does not fire, the user
   taps Capture barcode to take a still photo of the current camera
   frame and read the barcode from it. Finds whichever video element
   is actually showing the camera (the html5-qrcode view inside
   #scan-reader, or the #scan-video element). */
async function captureBarcodeFrame() {
  const status = document.getElementById("scan-status");
  const readerVideo = document.querySelector("#scan-reader video");
  const mainVideo = document.getElementById("scan-video");
  const video = (readerVideo && readerVideo.videoWidth) ? readerVideo : mainVideo;
  if (!video || !video.videoWidth) { status.textContent = "Camera is not ready yet. Wait a moment, then try again."; return; }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  status.textContent = "Reading the barcode from this photo...";
  if ("BarcodeDetector" in window) {
    try {
      const detector = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
      const codes = await detector.detect(canvas);
      if (codes && codes.length) {
        document.getElementById("scan-barcode-input").value = codes[0].rawValue;
        stopScanCamera(); lookupBarcode(codes[0].rawValue); return;
      }
    } catch {}
  }
  try {
    if (!window.ZXingBrowser) {
      await loadScriptLocalFirst("assets/js/zxing-browser.min.js", "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js");
    }
    const ZX = window.ZXingBrowser;
    const reader = new ZX.BrowserMultiFormatReader();
    let result = null;
    if (typeof reader.decodeFromCanvas === "function") {
      result = await reader.decodeFromCanvas(canvas);
    } else {
      const url = canvas.toDataURL("image/png");
      result = await reader.decodeFromImageUrl(url);
    }
    if (result) {
      const code = result.getText();
      document.getElementById("scan-barcode-input").value = code;
      stopScanCamera(); lookupBarcode(code); return;
    }
  } catch (e) {
    status.textContent = "Camera reader did not load. Type the number below, or try again.";
    return;
  }
  status.textContent = "No barcode found in this photo. Hold it steady and try again, or type the number below.";
}
document.getElementById("macro-scan-food").addEventListener("click", openScanModal);
document.getElementById("scan-close-btn").addEventListener("click", closeScanModal);
// v080: one primary barcode button; its label follows the state of the
// number field. A typed number means look it up; an empty field means
// capture from the camera.
function updateScanActionBtn() {
  const btn = document.getElementById("scan-action-btn");
  const input = document.getElementById("scan-barcode-input");
  if (!btn || !input) return;
  btn.textContent = input.value.trim() ? "Look up barcode" : "Capture barcode";
}
document.getElementById("scan-action-btn").addEventListener("click", () => {
  const input = document.getElementById("scan-barcode-input");
  if (input && input.value.trim()) lookupBarcode(input.value);
  else captureBarcodeFrame();
});
document.getElementById("scan-barcode-input").addEventListener("input", updateScanActionBtn);
document.getElementById("scan-log-btn").addEventListener("click", () => {
  const food = document.getElementById("scan-food").value.trim() || "Scanned food";
  const grams = Math.max(0, Math.round(Number(document.getElementById("scan-protein").value) || 0));
  const carbs = Math.max(0, Math.round(Number(document.getElementById("scan-carbs").value) || 0));
  const fat = Math.max(0, Math.round(Number(document.getElementById("scan-fat").value) || 0));
  if (!grams && !carbs && !fat) {
    document.getElementById("scan-status").textContent = "Add at least one macro above zero first.";
    return;
  }
  store.protein.push({ id: uid(), date: viewedDateStr(), grams, carbs, fat, food, calories: Math.round(grams * 4 + carbs * 4 + fat * 9), ...(scanServing ? { serving: scanServing } : {}) });
  // Save the logged values to Your foods, so an edit made here wins
  // over the lookup values saved earlier. Uses the barcode when there
  // is one, otherwise saves by name.
  saveFoodToLibrary(document.getElementById("scan-barcode-input").value, { name: food, brand: "", protein: grams, carbs, fat, calories: Math.round(grams * 4 + carbs * 4 + fat * 9) });
  saveStore();
  renderToday();
  closeScanModal();
  document.getElementById("scan-result").classList.add("hidden");
  document.getElementById("scan-barcode-input").value = "";
});

/* Scan form: the calories line follows the macros (4/4/9) as they
   are edited, so it always matches what is about to be logged. */
function syncScanCalories() {
  const el = document.getElementById("scan-product-calories");
  if (!el) return;
  const p = Math.max(0, Math.round(Number(document.getElementById("scan-protein").value) || 0));
  const c = Math.max(0, Math.round(Number(document.getElementById("scan-carbs").value) || 0));
  const f = Math.max(0, Math.round(Number(document.getElementById("scan-fat").value) || 0));
  const cals = Math.round(p * 4 + c * 4 + f * 9);
  el.textContent = cals > 0 ? "This adds about " + cals + " calories to your day." : "";
}
["scan-protein", "scan-carbs", "scan-fat"].forEach((id) => {
  const input = document.getElementById(id);
  if (input) input.addEventListener("input", syncScanCalories);
});
/* ---------- Plate recognition ---------- */
/* Take a photo of your plate and the app identifies the food and fills
   in the macros. Recognition runs through the Cloudflare Worker with a
   vision model, which is post-November 30 work. Until the Worker
   supports it, recognizePlate shows that it is coming soon and the
   user enters the food and macros by hand. The photo is shown for
   reference and is not stored on the entry yet. */
let platePhotoDataUrl = "";
function openPlateModal() {
  const m = document.getElementById("plate-modal");
  if (!m) return;
  recordDialogOpener("plate-modal");
  m.classList.remove("hidden");
  m.style.display = "flex";
  document.getElementById("plate-status").textContent = "";
  document.getElementById("plate-result").classList.add("hidden");
  const closeBtn = document.getElementById("plate-close-btn");
  if (closeBtn) closeBtn.focus();
}
function closePlateModal() {
  const m = document.getElementById("plate-modal");
  if (m) { m.classList.add("hidden"); m.style.display = "none"; }
  document.getElementById("plate-photo-preview").classList.add("hidden");
  document.getElementById("plate-photo-preview").src = "";
  platePhotoDataUrl = "";
  returnDialogFocus("plate-modal", "macro-plate-food");
}
async function recognizePlate(dataUrl) {
  const status = document.getElementById("plate-status");
  status.textContent = "Scan my plate is coming soon. For now, name the food and enter the macros below.";
  document.getElementById("plate-result").classList.remove("hidden");
  // Post-November 30: send dataUrl to the Worker vision endpoint and
  // fill plate-food, plate-protein, plate-carbs, plate-fat from the
  // reply, then update the status. The Worker call belongs here.
}
document.getElementById("plate-close-btn").addEventListener("click", closePlateModal);
document.getElementById("plate-take-btn").addEventListener("click", () => document.getElementById("plate-photo-input").click());
function handlePlatePhotoFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    platePhotoDataUrl = String(reader.result || "");
    const img = document.getElementById("plate-photo-preview");
    img.src = platePhotoDataUrl;
    img.classList.remove("hidden");
    recognizePlate(platePhotoDataUrl);
  };
  reader.readAsDataURL(file);
}
document.getElementById("plate-photo-input").addEventListener("change", (e) => {
  handlePlatePhotoFile(e.target.files && e.target.files[0]);
  e.target.value = "";
});
document.getElementById("plate-upload-btn").addEventListener("click", () => document.getElementById("plate-upload-input").click());
document.getElementById("plate-upload-input").addEventListener("change", (e) => {
  handlePlatePhotoFile(e.target.files && e.target.files[0]);
  e.target.value = "";
});
document.getElementById("plate-log-btn").addEventListener("click", () => {
  const food = document.getElementById("plate-food").value.trim() || "Food from plate";
  const grams = Math.max(0, Math.round(Number(document.getElementById("plate-protein").value) || 0));
  const carbs = Math.max(0, Math.round(Number(document.getElementById("plate-carbs").value) || 0));
  const fat = Math.max(0, Math.round(Number(document.getElementById("plate-fat").value) || 0));
  if (!grams && !carbs && !fat) {
    document.getElementById("plate-status").textContent = "Add at least one macro above zero first.";
    return;
  }
  store.protein.push({ id: uid(), date: viewedDateStr(), grams, carbs, fat, food, calories: Math.round(grams * 4 + carbs * 4 + fat * 9) });
  // Auto-save to Your foods by name, so this plate can be picked again.
  saveFoodToLibrary("", { name: food, brand: "", protein: grams, carbs, fat, calories: Math.round(grams * 4 + carbs * 4 + fat * 9) });
  saveStore();
  renderToday();
  closePlateModal();
  document.getElementById("plate-result").classList.add("hidden");
  document.getElementById("plate-food").value = "";
  document.getElementById("plate-protein").value = "";
  document.getElementById("plate-carbs").value = "";
  document.getElementById("plate-fat").value = "";
});

/* ---------- Today's Movement (v168) ---------- */
/* A short daily routine on the front page. Finishing every move logs
   5 minutes to the Movement total; unticking a move takes it back. */
/* The picker list: bodyweight, popular weights, and resistance bands,
   across the six movement patterns (squat, hinge, push, pull, carry,
   core). Research-backed picks for adults over 50; defaults first. */
const EXERCISE_LIBRARY = [
  { name: "Sit-to-stands", detail: "10 reps", pattern: "Squat" },
  { name: "Wall push-ups", detail: "10 reps", pattern: "Push" },
  { name: "Standing march in place", detail: "1 minute", pattern: "Core" },
  { name: "Heel raises", detail: "12 reps", pattern: "Squat" },
  { name: "Gentle full-body stretch", detail: "1 minute", pattern: "Core" },
  { name: "Goblet squat", detail: "10 reps", pattern: "Squat" },
  { name: "Lunges", detail: "10 reps", pattern: "Squat" },
  { name: "Glute bridge", detail: "12 reps", pattern: "Hinge" },
  { name: "Romanian deadlift", detail: "10 reps", pattern: "Hinge" },
  { name: "Wall or modified push-up", detail: "10 reps", pattern: "Push" },
  { name: "Chest press", detail: "10 reps", pattern: "Push" },
  { name: "Shoulder press", detail: "10 reps", pattern: "Push" },
  { name: "Dumbbell row", detail: "10 reps each side", pattern: "Pull" },
  { name: "Band row", detail: "12 reps", pattern: "Pull" },
  { name: "Band chest press", detail: "12 reps", pattern: "Push" },
  { name: "Farmer's carry", detail: "1 minute", pattern: "Carry" },
  { name: "Calf raise", detail: "15 reps", pattern: "Squat" },
  { name: "Lateral band walk", detail: "10 steps each way", pattern: "Squat" }
];
const MOVEMENT_BONUS_LABEL = "Daily movement routine";
const MOVEMENT_BONUS_MINUTES = 5;
/* Minutes a single routine move is worth, read from its detail text.
   Only an explicit minute value counts ("15 min", "1 minute"); reps
   ("10 reps") and bare numbers ("2") add no minutes, so we never
   guess a duration the user did not state. */
function moveMinutesFromDetail(detail) {
  if (!detail) return 0;
  const m = String(detail).match(/(\d+)\s*(?:min|mins|minute|minutes)/i);
  return m ? Number(m[1]) : 0;
}
/* Label for the exercise entry a checked routine move adds, so the
   minutes can be removed again when the move is unchecked without
   touching a separately logged exercise of the same name. */
function routineMoveLabel(name) {
  return "Routine: " + name;
}
/* Remove one routine move's minutes entry for a day, if present. */
function removeRoutineMoveMinutes(date, name) {
  const label = routineMoveLabel(name);
  for (let i = store.exercise.length - 1; i >= 0; i--) {
    const e = store.exercise[i];
    if (e.date === date && e.label === label) {
      store.exercise.splice(i, 1);
      return true;
    }
  }
  return false;
}
/* Minutes the daily routine is worth when finished. Set in the plan
   editor; defaults to 5. */
function routineMinutes() {
  return Number(store.settings.routineMinutes) || MOVEMENT_BONUS_MINUTES;
}

function getMovementPlan() {
  const plan = store.settings && store.settings.movementPlan;
  if (Array.isArray(plan) && plan.length) return plan;
  return [];
}
function movementDayState(date) {
  const state = (store.movementDone || {})[date];
  if (state && typeof state === "object" && Array.isArray(state.done)) return state;
  return { done: [], bonus: false };
}
function setMovementDayState(date, state) {
  if (!store.movementDone) store.movementDone = {};
  store.movementDone[date] = state;
}
/* Remove the routine bonus entry for a day, if one is logged. */
function removeMovementBonus(date) {
  for (let i = store.exercise.length - 1; i >= 0; i--) {
    const e = store.exercise[i];
    // Match by label and date only: the routine minutes can change,
    // so an old bonus entry may carry a different number.
    if (e.date === date && e.label === MOVEMENT_BONUS_LABEL) {
      store.exercise.splice(i, 1);
      return true;
    }
  }
  return false;
}

function renderMovement() {
  const card = document.getElementById("movement-routine");
  if (!card) return;
  const plan = getMovementPlan();
  const date = viewedDateStr();
  const state = movementDayState(date);
  // Done names that are no longer in the plan (plan changed) do not count.
  const done = state.done.filter((n) => plan.some((m) => m.name === n));
  const sub = document.getElementById("movement-sub");
  if (sub) sub.textContent = plan.length ? "Your plan · " + plan.length + " moves." : "Choose your moves to start.";
  const desc = card.querySelector(".movement-desc");
  if (desc) desc.hidden = plan.length === 0;
  const prog = card.querySelector(".move-progress");
  if (prog) prog.hidden = plan.length === 0;
  const list = document.getElementById("moves-list");
  list.innerHTML = plan.map((m) => {
    const isDone = done.includes(m.name);
    return `<li class="${isDone ? "done-move" : ""}">
      <button type="button" class="move-check${isDone ? " done" : ""}" data-move="${escapeHtml(m.name)}" aria-pressed="${isDone ? "true" : "false"}" aria-label="Mark ${escapeHtml(m.name)} done"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>
      <span class="move-name">${escapeHtml(m.name)}</span>
      <span class="move-reps">${escapeHtml(m.detail || "")}</span>
    </li>`;
  }).join("");
  list.querySelectorAll("[data-move]").forEach((btn) => btn.addEventListener("click", () => toggleMove(btn.dataset.move)));
  const fill = document.getElementById("move-fill");
  if (fill) fill.style.width = plan.length ? (done.length / plan.length * 100) + "%" : "0%";
  const count = document.getElementById("move-count");
  if (count) count.textContent = done.length + " of " + plan.length + " moves done";
  const logged = document.getElementById("move-logged");
  if (logged) { logged.textContent = "All done. " + routineMinutes() + " minutes added to your Movement total."; logged.classList.toggle("show", done.length === plan.length && plan.length > 0); }
  // Shared total: the routine and the ring are one movement total, so
  // minutes logged anywhere show here too.
  const totalEl = document.getElementById("movement-total");
  if (totalEl) {
    const mins = sumForDate(store.exercise, date, "minutes");
    const goal = Number(store.settings.movementGoal) || 30;
    totalEl.textContent = mins + " of " + goal + " minutes logged today, from the routine and anything else.";
  }
  renderMovementSummary();
}

/* Movement section (v039): one collapsible section on Today, with
   Cardio and Strength training inside. Collapsed by default, the header
   shows just the totals. The slider, tap-to-type, routine toggles,
   Customize, strength form and list, and doctor summary data are all
   unchanged. */
let movementSectionOpen = true;
let strengthFormOpen = false;
function renderMovementSummary() {
  const el = document.getElementById("movement-summary");
  if (!el) return;
  const date = viewedDateStr();
  const mins = sumForDate(store.exercise, date, "minutes");
  const goal = Number(store.settings.movementGoal) || 30;
  const count = (store.strength || []).filter((e) => e.date === date).length;
  el.textContent = mins + " of " + goal + " min" + (count ? " · " + count + " strength" : " · No strength");
}
function setMovementSectionOpen(open) {
  movementSectionOpen = open;
  const body = document.getElementById("movement-body");
  if (body) body.hidden = !open;
  const toggle = document.getElementById("movement-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    const chev = toggle.querySelector(".section-toggle-chevron");
    if (chev) chev.textContent = open ? "▾" : "▸";
  }
}
function setStrengthFormOpen(open) {
  strengthFormOpen = open;
  const form = document.getElementById("strength-form");
  if (form) form.classList.toggle("hidden", !open);
  const toggle = document.getElementById("strength-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Hide form" : "Add exercise";
  }
}
const movementToggleBtn = document.getElementById("movement-toggle");
if (movementToggleBtn) movementToggleBtn.addEventListener("click", () => setMovementSectionOpen(!movementSectionOpen));
const strengthToggleBtn = document.getElementById("strength-toggle");
if (strengthToggleBtn) strengthToggleBtn.addEventListener("click", () => setStrengthFormOpen(!strengthFormOpen));

/* ---------- Strength log (v033) ---------- */
/* One form: exercise name, sets, reps, weight in pounds (optional).
   Entries save to the day being viewed and show in today's list, with
   a remove button each. No chart, no planner. */
function renderStrength() {
  const list = document.getElementById("strength-list");
  if (!list) return;
  const t = todayStr(viewOffset);
  const today = (store.strength || []).filter((e) => e.date === t).sort(byDate);
  list.innerHTML = today.length
    ? today.map((e) => `
      <div class="entry">
        <p class="entry-title">${escapeHtml(e.name)}, ${escapeHtml(String(e.sets))} sets of ${escapeHtml(String(e.reps))}${e.weight !== "" && e.weight !== undefined && e.weight !== null ? " at " + escapeHtml(String(e.weight)) + " lbs" : ""}</p>
        <p class="entry-sub">${escapeHtml(formatDate(e.date))}</p>
        <div class="entry-actions">
          <button class="btn btn-small btn-danger" data-del-strength="${e.id}" aria-label="Remove strength entry: ${escapeHtml(e.name)}">Remove</button>
        </div>
      </div>`).join("")
    : '<p class="empty-state">No strength yet.</p>';
  list.querySelectorAll("[data-del-strength]").forEach((b) => b.addEventListener("click", () => {
    store.strength = (store.strength || []).filter((x) => x.id !== b.dataset.delStrength);
    saveStore();
    renderStrength();
  }));
  renderMovementSummary();
}
document.getElementById("strength-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("strength-name").value.trim();
  const sets = Math.round(Number(document.getElementById("strength-sets").value));
  const reps = Math.round(Number(document.getElementById("strength-reps").value));
  const weightRaw = document.getElementById("strength-weight").value;
  const weight = weightRaw === "" ? "" : Number(weightRaw);
  const msg = document.getElementById("strength-saved-msg");
  if (!name) { setFormStatus(msg, "Give your exercise a name first.", true); return; }
  if (!Number.isFinite(sets) || sets < 1) { setFormStatus(msg, "Sets must be at least 1.", true); return; }
  if (!Number.isFinite(reps) || reps < 1) { setFormStatus(msg, "Reps must be at least 1.", true); return; }
  if (weight !== "" && (!Number.isFinite(weight) || weight < 0)) { setFormStatus(msg, "Weight must be 0 or more, or left blank.", true); return; }
  store.strength.push({ id: uid(), date: viewedDateStr(), name: name.slice(0, 80), sets, reps, weight });
  saveStore();
  document.getElementById("strength-form").reset();
  setFormStatus(msg, "Strength exercise saved.");
  renderStrength();
  setStrengthFormOpen(false);
});

/* ---------- Copy yesterday for exercises (v071) ---------- */
/* Copy yesterday's movement minutes and strength entries into the day
   being viewed, as new entries. Same duplicate rule as foods: an entry
   already copied today is skipped, so a second tap adds nothing. */
function copyYesterdayExercises() {
  const msg = document.getElementById("copy-yesterday-exercise-msg");
  const target = viewedDateStr();
  const source = todayStr(viewOffset - 1);
  const yesterdaysEx = (store.exercise || []).filter((e) => e.date === source);
  const yesterdaysSt = (store.strength || []).filter((e) => e.date === source);
  if (!yesterdaysEx.length && !yesterdaysSt.length) {
    if (msg) msg.textContent = "Nothing logged yesterday.";
    return;
  }
  const todaysEx = (store.exercise || []).filter((e) => e.date === target);
  const todaysSt = (store.strength || []).filter((e) => e.date === target);
  let copied = 0;
  yesterdaysEx.forEach((e) => {
    const already = todaysEx.some((x) => (x.label || "") === (e.label || "") && Number(x.minutes) === Number(e.minutes));
    if (already) return;
    store.exercise.push({ id: uid(), date: target, minutes: e.minutes, label: e.label });
    copied++;
  });
  yesterdaysSt.forEach((e) => {
    const already = todaysSt.some((x) => (x.name || "") === (e.name || "") && Number(x.sets) === Number(e.sets) && Number(x.reps) === Number(e.reps) && String(x.weight) === String(e.weight));
    if (already) return;
    store.strength.push({ id: uid(), date: target, name: e.name, sets: e.sets, reps: e.reps, weight: e.weight });
    copied++;
  });
  if (!copied) {
    if (msg) msg.textContent = "Already copied. Nothing new to add.";
    return;
  }
  saveStore();
  renderToday();
  if (msg) msg.textContent = "Copied " + copied + (copied === 1 ? " entry" : " entries") + " from yesterday.";
}
document.getElementById("copy-yesterday-exercise").addEventListener("click", copyYesterdayExercises);

function toggleMove(name) {
  const date = viewedDateStr();
  const plan = getMovementPlan();
  const state = movementDayState(date);
  const move = plan.find((m) => m.name === name);
  const mins = move ? moveMinutesFromDetail(move.detail) : 0;
  const idx = state.done.indexOf(name);
  if (idx === -1) {
    state.done.push(name);
    // A move with a minute value adds those minutes to the Movement
    // ring right away, so checking it off updates the ring.
    if (mins > 0) store.exercise.push({ id: uid(), date, minutes: mins, label: routineMoveLabel(name) });
  } else {
    state.done.splice(idx, 1);
    if (mins > 0) removeRoutineMoveMinutes(date, name);
  }
  const done = state.done.filter((n) => plan.some((m) => m.name === n));
  const allDone = plan.length > 0 && done.length === plan.length;
  if (allDone && !state.bonus) {
    store.exercise.push({ id: uid(), date, minutes: routineMinutes(), label: MOVEMENT_BONUS_LABEL });
    state.bonus = true;
  } else if (!allDone && state.bonus) {
    removeMovementBonus(date);
    state.bonus = false;
  }
  setMovementDayState(date, state);
  saveStore();
  renderToday();
}

/* One row in the movement plan picker: checkbox, name and pattern,
   reps/time input. Custom exercises (v169) also get a remove button. */
function movementPlanRowHtml(item, checked, detail, isCustom) {
  return `<label class="plan-row"${isCustom ? ` data-custom="true" data-pattern="${escapeHtml(item.pattern || "Other")}"` : ""}>
      <input type="checkbox" data-plan-name="${escapeHtml(item.name)}"${checked ? " checked" : ""}>
      <span class="plan-name">${escapeHtml(item.name)}<span class="plan-pattern">${escapeHtml(item.pattern || "")}</span></span>
      <input type="text" class="plan-detail" data-plan-detail="${escapeHtml(item.name)}" value="${escapeHtml(detail)}" maxlength="40" aria-label="Reps/time for ${escapeHtml(item.name)}">
      ${isCustom ? `<button type="button" class="plan-remove" data-remove-custom="${escapeHtml(item.name)}" aria-label="Remove ${escapeHtml(item.name)} from your exercises">×</button>` : ""}
    </label>`;
}

function openMovementPlanEditor() {
  const editor = document.getElementById("movement-plan-editor");
  const list = document.getElementById("movement-plan-list");
  const plan = getMovementPlan();
  const inPlan = {};
  plan.forEach((m) => { inPlan[m.name] = m.detail || ""; });
  const customs = Array.isArray(store.settings.customExercises) ? store.settings.customExercises : [];
  list.innerHTML = EXERCISE_LIBRARY.map((ex) => {
    const checked = ex.name in inPlan;
    const detail = checked ? inPlan[ex.name] : ex.detail;
    return movementPlanRowHtml(ex, checked, detail, false);
  }).join("") + customs.map((ex) => {
    const checked = ex.name in inPlan;
    const detail = checked ? inPlan[ex.name] : ex.detail;
    return movementPlanRowHtml(ex, checked, detail, true);
  }).join("");
  document.getElementById("movement-plan-msg").textContent = "";
  const customMsg = document.getElementById("custom-ex-msg");
  if (customMsg) { customMsg.textContent = ""; customMsg.classList.remove("error"); }
  const nameInput = document.getElementById("custom-ex-name");
  if (nameInput) nameInput.value = "";
  const detailInput = document.getElementById("custom-ex-detail");
  if (detailInput) detailInput.value = "";
  const minInput = document.getElementById("movement-plan-minutes");
  if (minInput) minInput.value = routineMinutes();
  editor.classList.remove("hidden");
  const btn = document.getElementById("movement-customize");
  if (btn) btn.setAttribute("aria-expanded", "true");
}
function closeMovementPlanEditor() {
  const editor = document.getElementById("movement-plan-editor");
  if (editor) editor.classList.add("hidden");
  const btn = document.getElementById("movement-customize");
  if (btn) { btn.setAttribute("aria-expanded", "false"); btn.focus(); }
}
document.getElementById("movement-customize").addEventListener("click", () => {
  const editor = document.getElementById("movement-plan-editor");
  if (editor && editor.classList.contains("hidden")) openMovementPlanEditor();
  else closeMovementPlanEditor();
});
document.getElementById("movement-plan-cancel").addEventListener("click", closeMovementPlanEditor);
// v169: removing a custom exercise from the picker. Staged like every
// other change in this editor: Save rebuilds the saved list from the
// rows still present, so Cancel brings a removed exercise back.
document.getElementById("movement-plan-list").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove-custom]");
  if (!rm) return;
  const row = rm.closest(".plan-row");
  if (row) row.remove();
});
/* Add your own exercise (v169): name, pattern, and reps/time, in the
   same style as the existing rows. The new exercise joins the picker
   checked, so Save plan puts it in the plan; it is saved with the plan
   in settings and shows on the Today card like any other move. */
document.getElementById("custom-ex-add").addEventListener("click", () => {
  const nameInput = document.getElementById("custom-ex-name");
  const patternSel = document.getElementById("custom-ex-pattern");
  const detailInput = document.getElementById("custom-ex-detail");
  const msg = document.getElementById("custom-ex-msg");
  const name = nameInput.value.trim();
  if (!name) { setFormStatus(msg, "Type an exercise name first.", true); nameInput.focus(); return; }
  const list = document.getElementById("movement-plan-list");
  let duplicate = false;
  list.querySelectorAll("input[type='checkbox']").forEach((cb) => {
    if (cb.dataset.planName.toLowerCase() === name.toLowerCase()) duplicate = true;
  });
  if (duplicate) { setFormStatus(msg, "You already have an exercise with that name.", true); nameInput.focus(); return; }
  const detail = detailInput.value.trim();
  const pattern = patternSel.value;
  const tmp = document.createElement("div");
  tmp.innerHTML = movementPlanRowHtml({ name, pattern, detail }, true, detail, true);
  list.appendChild(tmp.firstElementChild);
  list.scrollTop = list.scrollHeight;
  nameInput.value = "";
  detailInput.value = "";
  if (msg) { msg.textContent = ""; msg.classList.remove("error"); }
  nameInput.focus();
});
document.getElementById("movement-plan-save").addEventListener("click", () => {
  const msg = document.getElementById("movement-plan-msg");
  const picked = [];
  document.querySelectorAll("#movement-plan-list input[type='checkbox']").forEach((cb) => {
    if (!cb.checked) return;
    const name = cb.dataset.planName;
    const detailInput = document.querySelector('#movement-plan-list input[data-plan-detail="' + CSS.escape(name) + '"]');
    const lib = EXERCISE_LIBRARY.find((e) => e.name === name);
    picked.push({ name, detail: (detailInput && detailInput.value.trim()) || (lib ? lib.detail : "") });
  });
  if (!picked.length) {
    setFormStatus(msg, "Pick at least one move for your plan.", true);
    return;
  }
  // v169: the user's own exercises are saved with the plan, from the
  // custom rows still in the picker. Removing a row drops it here.
  const customs = [];
  document.querySelectorAll("#movement-plan-list .plan-row[data-custom='true']").forEach((row) => {
    const cb = row.querySelector("input[type='checkbox']");
    const detailInput = row.querySelector("input.plan-detail");
    if (!cb) return;
    customs.push({
      name: cb.dataset.planName,
      pattern: row.dataset.pattern || "Other",
      detail: (detailInput && detailInput.value.trim()) || ""
    });
  });
  store.settings.customExercises = customs;
  store.settings.movementPlan = picked;
  const rmInput = document.getElementById("movement-plan-minutes");
  const rm = rmInput ? Number(rmInput.value) : NaN;
  store.settings.routineMinutes = Number.isFinite(rm) && rm > 0 ? Math.round(rm) : 5;
  // A new plan can un-complete today: take the bonus back if the new
  // plan is not fully done.
  const date = viewedDateStr();
  const state = movementDayState(date);
  const done = state.done.filter((n) => picked.some((m) => m.name === n));
  if (state.bonus && done.length < picked.length) {
    removeMovementBonus(date);
    state.bonus = false;
    setMovementDayState(date, state);
  }
  saveStore();
  closeMovementPlanEditor();
  renderToday();
});

/* Next injection countdown */

/* v073 Phase 1 ticket 1: missed-dose flag for the never-logged case.
   When a shot day is set but no shot has ever been taken, nextShotDue()
   points at the NEXT occurrence of the shot weekday, so a shot day that
   already passed this week looks like a future shot. This returns the
   local YYYY-MM-DD date of this week's shot day when it is strictly
   before today, otherwise null. A shot day still ahead this week (or
   today itself) is not a miss, and a shot day that passed last week is
   not this week's dose. Local dates only, never toISOString(). A
   "Missed" entry is not a taken shot, so it does not clear the flag;
   once any shot is taken, lastInjection() is set and this returns null. */
function missedThisWeekShotDateStr() {
  const shotDay = store.settings.shotDay;
  if (!shotDay) return null;
  if (lastInjection()) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const target = days.indexOf(shotDay);
  if (target < 0) return null;
  const now = new Date();
  if (target >= now.getDay()) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() - target));
  return localDateStr(d);
}

function renderNextInjection() {
  const el = document.getElementById("next-injection-line");
  const shotDay = store.settings.shotDay;
  if (!shotDay) {
    el.textContent = "Set your shot day in Settings.";
    return;
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const target = days.indexOf(shotDay);
  const now = new Date();
  let diff = (target - now.getDay() + 7) % 7;
  const med = store.settings.medication || "your medication";
  const dose = store.settings.dose ? store.settings.dose + " mg" : "";
  const last = lastInjection();
  const lastSite = last ? " Site: " + last.site + "." : "";
  const due = nextShotDue();
  let when;
  if (due && due.overdueDays > 0) {
    when = "Shot was due " + formatDateShort(due.dateStr) + ". " + due.overdueDays + (due.overdueDays === 1 ? " day overdue." : " days overdue.");
  } else if (due && due.daysUntil === 0) {
    when = "Today is your shot day.";
  } else if (due && due.daysUntil === 1) {
    when = "Next shot: tomorrow (" + formatDateShort(due.dateStr) + ").";
  } else if (due) {
    when = "Next shot: " + formatDateShort(due.dateStr) + " (in " + due.daysUntil + " days).";
  } else {
    when = diff === 0 ? "Today is your shot day." : diff === 1 ? "Next shot: tomorrow." : "Next shot: " + shotDay + " (in " + diff + " days).";
  }
  el.textContent = when + " " + med + (dose ? " " + dose + "." : ".") + lastSite;

  // One-tap shot logging uses the usual medication, dose, and last site
  const gotoBtn = document.getElementById("goto-shots-btn");
  renderTodayRefillLine();
  const alreadyLogged = store.injections.some((e) => e.date === todayStr() && (e.status || "On time") !== "Missed");
  gotoBtn.style.display = alreadyLogged ? "none" : "";
  const shotDayBtn = document.getElementById("goto-shot-day-btn");
  if (shotDayBtn) shotDayBtn.classList.toggle("hidden", alreadyLogged || !!shotDay);
  // v073 Phase 1 ticket 1: this week's shot day passed with no shot
  // ever logged. Flag it gently, name the date, point to the Shots
  // tab, and suggest the prescribing doctor if unsure. Never dose
  // advice: nothing here says when or how much to take.
  const missedDate = missedThisWeekShotDateStr();
  if (missedDate) {
    el.textContent = "It looks like this week's shot was missed. It was due " + formatDateShort(missedDate) + ". That happens, no judgment. You can log it on the Shots tab, and if you're unsure, check with your prescribing doctor.";
    gotoBtn.textContent = "Log shot";
    return;
  }
  // The Today card never logs a shot. It only takes you to the Shots
  // tab, where the shot is logged deliberately with the site and dose.
  gotoBtn.textContent = "Log shot";
}

// The Today card's single Log shot takes you to the Shots tab and
// opens the log form, so the shot is logged deliberately with the
// site and dose. (v080: folded the Quick Actions Log shot in here.)
document.getElementById("goto-shots-btn").addEventListener("click", () => {
  showTab("shots");
  document.getElementById("show-injection-form").click();
});
document.getElementById("goto-shot-day-btn").addEventListener("click", () => openSettingsAt("settings-goals-card"));
document.getElementById("today-refill-settings-btn").addEventListener("click", () => openSettingsAt("settings-goals-card"));

/* GLP-1 quick actions (v035): three links on Today to the flows
   that already exist. Log dose opens the Shots tab with the log form
   open. Reminders runs the existing calendar shot reminder download.
   Log side effect opens the Side Effects tab with the log form open.
   No new data, no new screens. */
document.getElementById("qa-reminders").addEventListener("click", () => {
  document.getElementById("add-shot-reminder").click();
});
document.getElementById("qa-log-effect").addEventListener("click", () => {
  showTab("side-effects");
  document.getElementById("show-sideeffect-form").click();
});



/* Daily mood */

function renderMood() {
  const t = viewedDateStr();
  const current = store.moods[t];
  const moodSelect = document.getElementById("mood-select");
  if (moodSelect) moodSelect.value = current || "";
  const moodLabel = document.getElementById("mood-today-label");
  if (moodLabel) {
    moodLabel.textContent = current
      ? (viewOffset === 0 ? "Today you are feeling: " : "On " + formatDate(t) + " you felt: ") + current + "."
      : "";
    moodLabel.hidden = !current;
  }
}

const moodSelectEl = document.getElementById("mood-select");
if (moodSelectEl) {
  moodSelectEl.addEventListener("change", () => {
    if (moodSelectEl.value) store.moods[viewedDateStr()] = moodSelectEl.value;
    else delete store.moods[viewedDateStr()];
    saveStore();
    renderMood();
  });
}

/* ---------- Form status helper ---------- */
function setFormStatus(el, text, isError) {
  if (!el) return;
  el.setAttribute("role", isError ? "alert" : "status");
  el.classList.toggle("success", !isError);
  el.textContent = text;
}

/* ---------- Injection calendar ---------- */

let injCalYear, injCalMonth;

function nextShotDateStr() {
  const shotDay = store.settings.shotDay;
  if (!shotDay) return null;
  const due = nextShotDue();
  return due ? due.dateStr : null;
}

/* Next shot due date, from the last taken shot + 7 days (weekly).
   If no shot is logged yet, use the next occurrence of the shot
   weekday. Returns { dateStr, overdueDays, daysUntil } or null when
   no shot day is set. An overdue shot stays overdue until it is
   logged, it never silently rolls forward to next week. */
function nextShotDue() {
  const shotDay = store.settings.shotDay;
  if (!shotDay) return null;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const target = days.indexOf(shotDay);
  if (target < 0) return null;
  const today = todayStr();
  const last = lastInjection();
  let dueDate;
  if (last) {
    const d = new Date(last.date + "T00:00:00");
    d.setDate(d.getDate() + 7);
    dueDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  } else {
    const now = new Date();
    const diff = (target - now.getDay() + 7) % 7;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    dueDate = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  const todayD = new Date(today + "T00:00:00");
  const dueD = new Date(dueDate + "T00:00:00");
  const diffDays = Math.round((dueD - todayD) / 86400000);
  return { dateStr: dueDate, overdueDays: diffDays < 0 ? -diffDays : 0, daysUntil: diffDays > 0 ? diffDays : 0 };
}

/* Arrow-key navigation for a calendar grid: arrows move focus to the
   neighbouring day cell in the same month (F30). Returns true when handled. */
function calendarArrowNav(e, currentDs, dateAttr) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!(e.key in moves)) return false;
  const d = new Date(currentDs + "T00:00:00");
  d.setDate(d.getDate() + moves[e.key]);
  const target = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const grid = e.currentTarget.closest(".mini-calendar");
  const cell = grid && grid.querySelector("[" + dateAttr + "=\"" + target + "\"]");
  if (!cell) return false;
  e.preventDefault();
  cell.focus();
  return true;
}

function renderInjectionCalendar() {
  const cal = document.getElementById("inj-calendar");
  if (!cal) return;
  const now = new Date();
  if (injCalYear === undefined) { injCalYear = now.getFullYear(); injCalMonth = now.getMonth(); }
  document.getElementById("inj-cal-title").textContent =
    new Date(injCalYear, injCalMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const loggedByDate = {};
  store.injections.forEach((inj) => {
    (loggedByDate[inj.date] = loggedByDate[inj.date] || []).push(inj);
  });
  const nextShot = nextShotDateStr();
  const todayS = todayStr();

  const startDow = new Date(injCalYear, injCalMonth, 1).getDay();
  const daysInMonth = new Date(injCalYear, injCalMonth + 1, 0).getDate();
  // Grid rows: a header row, then one row per week. Each row holds
  // seven cells, so the grid has the row structure a screen reader
  // expects. Trailing blanks complete the last week.
  let html = `<div class="cal-row" role="row">` + ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<div class="dow" role="columnheader">${d}</div>`).join("") + `</div>`;
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(`<div class="day other-month" role="gridcell" aria-hidden="true"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = injCalYear + "-" + String(injCalMonth + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const dayEntries = loggedByDate[ds] || [];
    const taken = dayEntries.some((j) => (j.status || "On time") !== "Missed");
    const cls = ["day"];
    if (ds === todayS) cls.push("today");
    if (taken) cls.push("logged");
    else if (ds === nextShot) cls.push("scheduled");
    const states = [];
    if (ds === todayS) states.push("today");
    if (taken) states.push("shot logged");
    if (dayEntries.some((j) => (j.status || "On time") === "Missed")) states.push("dose missed");
    if (dayEntries.some((j) => (j.status || "On time") === "Delayed")) states.push("shot delayed");
    if (ds === nextShot) states.push("next scheduled shot");
    const label = formatDate(ds) + (states.length ? ", " + states.join(", ") : "");
    cells.push( `<div class="${cls.join(" ")}" role="gridcell" data-cal-date="${ds}" tabindex="0" aria-label="${label}">${d}</div>`);
  }
  while (cells.length % 7 !== 0) cells.push(`<div class="day other-month" role="gridcell" aria-hidden="true"></div>`);
  for (let i = 0; i < cells.length; i += 7) {
    html += `<div class="cal-row" role="row">` + cells.slice(i, i + 7).join("") + `</div>`;
  }
  cal.innerHTML = html;

  cal.querySelectorAll("[data-cal-date]").forEach((el) => {
    const show = () => {
      const list = loggedByDate[el.dataset.calDate] || [];
      document.getElementById("inj-cal-detail").textContent =
        list.length
          ? formatDate(el.dataset.calDate) + ": " +
            list.map((j) => j.medication + (j.dose ? " " + j.dose + " mg" : "") + " (" + j.site + ", " + (j.status || "On time") + ")").join("; ")
          : "No shot logged on " + formatDate(el.dataset.calDate) + ".";
    };
    el.addEventListener("click", show);
    el.addEventListener("keydown", (e) => {
      if (calendarArrowNav(e, el.dataset.calDate, "data-cal-date")) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); }
    });
  });
  document.getElementById("inj-cal-detail").textContent = "";
}

document.getElementById("inj-cal-prev").addEventListener("click", () => {
  injCalMonth--;
  if (injCalMonth < 0) { injCalMonth = 11; injCalYear--; }
  renderInjectionCalendar();
});
document.getElementById("inj-cal-next").addEventListener("click", () => {
  injCalMonth++;
  if (injCalMonth > 11) { injCalMonth = 0; injCalYear++; }
  renderInjectionCalendar();
});

/* ---------- Injections ---------- */

const injForm = document.getElementById("injection-form");
let editingInjectionId = null;

function toggleForm(form, showBtn, show) {
  form.classList.toggle("hidden", !show);
  if (showBtn) showBtn.classList.toggle("hidden", show);
}

/* ---------- Shot reminder (calendar) ---------- */
/* Shot reminder (v049, R-05): a weekly calendar file for the shot
   day. The reminder lives in the phone's calendar: change or remove
   it there. The day the file was built for is remembered, so Settings
   can say when it no longer matches the shot day. */
const REMINDER_SHOT_DAY_KEY = "nct-reminder-shot-day";
function downloadShotReminder() {
  const shotDay = store.settings.shotDay;
  const note = document.getElementById("shot-reminder-note");
  if (!shotDay) {
    if (note) {
      note.innerHTML = 'Set your shot day in Settings first, then come back to add the reminder. <button type="button" class="btn-link" id="shot-reminder-goto-settings">Go to Settings</button>';
      note.classList.remove("hidden");
      document.getElementById("shot-reminder-goto-settings").addEventListener("click", () => openSettingsAt("settings-goals-card"));
    }
    return;
  }
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const target = days.indexOf(shotDay);
  const now = new Date();
  const diff = (target - now.getDay() + 7) % 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setHours(9, 0, 0, 0);
  // If today's 9am has already passed, the reminder starts next week, never in the past.
  if (next <= now) next.setDate(next.getDate() + 7);
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "T" + p(d.getHours()) + p(d.getMinutes()) + "00";
  };
  const icsEscape = (v) => String(v == null ? "" : v).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const med = store.settings.medication || "GLP-1";
  const dose = store.settings.dose ? " " + store.settings.dose + " mg" : "";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//New Chapter: GLP-1 Tracker™//EN",
    "BEGIN:VEVENT",
    "UID:shot-reminder-" + Date.now() + "@newchapter",
    "DTSTAMP:" + fmt(new Date()),
    "DTSTART:" + fmt(next),
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:" + icsEscape(med + dose + " shot day"),
    "DESCRIPTION:" + icsEscape("Time for your weekly injection. Log it in New Chapter: GLP-1 Tracker™."),
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "shot-reminder.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  try { localStorage.setItem(REMINDER_SHOT_DAY_KEY, shotDay); } catch {}
  if (note) {
    note.textContent = "Reminder downloaded for " + shotDay + "s. Open the downloaded file to add it to your calendar. The reminder lives in your phone's calendar. Change or remove it there.";
    note.classList.remove("hidden");
  }
  renderShotReminderMismatch();
}
document.getElementById("add-shot-reminder").addEventListener("click", downloadShotReminder);
document.getElementById("shot-reminder-redownload-btn").addEventListener("click", downloadShotReminder);
/* Settings mismatch line (v049, R-05): when the shot day changed
   after the reminder was downloaded, say so and offer a new file. */
function renderShotReminderMismatch() {
  const line = document.getElementById("shot-reminder-mismatch");
  const btn = document.getElementById("shot-reminder-redownload-btn");
  let saved = null;
  try { saved = localStorage.getItem(REMINDER_SHOT_DAY_KEY); } catch {}
  const shotDay = store.settings.shotDay;
  const mismatch = saved && shotDay && saved !== shotDay;
  if (line) {
    line.textContent = mismatch ? "Your downloaded reminder is for " + saved + "s. Your shot day is now " + shotDay + "s." : "";
    line.classList.toggle("hidden", !mismatch);
  }
  if (btn) btn.classList.toggle("hidden", !mismatch);
}

document.getElementById("show-injection-form").addEventListener("click", () => {
  editingInjectionId = null;
  injForm.querySelector("h3").textContent = "Log Injection";
  injForm.reset();
  document.getElementById("inj-date").value = todayStr();
  document.getElementById("inj-med").value = store.settings.medication || "";
  document.getElementById("inj-dose").value = store.settings.dose || "";
  const shotDayName = store.settings.shotDay;
  let defaultStatus = "On time";
  if (shotDayName) {
    const d = new Date(document.getElementById("inj-date").value + "T12:00:00");
    const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
    if (dayName !== shotDayName) defaultStatus = "Delayed";
  }
  document.getElementById("inj-status").value = defaultStatus;
  document.getElementById("inj-status-note").classList.toggle("hidden", defaultStatus !== "Missed" && defaultStatus !== "Delayed");
  toggleForm(injForm, document.getElementById("show-injection-form"), true);
  showSiteMapView("front");
  renderSiteMap();
});

/* Show the clinician wording when a dose is marked Missed or Delayed. */
document.getElementById("inj-status").addEventListener("change", (e) => {
  const missedOrDelayed = e.target.value === "Missed" || e.target.value === "Delayed";
  document.getElementById("inj-status-note").classList.toggle("hidden", !missedOrDelayed);
});

// ---- Injection site map ----
const siteMapZones = () => [...document.querySelectorAll("#site-map .site-zone")];

function lastInjection() {
  /* A missed dose was not taken, so it is not a "last shot". */
  const taken = store.injections.filter((e) => (e.status || "On time") !== "Missed");
  if (!taken.length) return null;
  return [...taken].sort(byDateDesc)[0];
}

function showSiteMapView(view) {
  const front = document.getElementById("map-front");
  const back = document.getElementById("map-back");
  const flip = document.getElementById("site-map-flip");
  if (!front || !back) return;
  const isBack = view === "back";
  /* W3C: hidden is not allowed on SVG g, use display instead */
  front.style.display = isBack ? "none" : "";
  back.style.display = isBack ? "" : "none";
  if (flip) {
    flip.textContent = isBack ? "Flip to Front" : "Flip to Back";
    flip.setAttribute("aria-label", isBack ? "Flip injection site map to front view" : "Flip injection site map to back view");
  }
}

function renderSiteMap() {
  const select = document.getElementById("inj-site");
  if (!select) return;
  const chosen = select.value;
  if (chosen === "Left Upper Arm" || chosen === "Right Upper Arm") showSiteMapView("back");
  else if (chosen) showSiteMapView("front");
  const last = lastInjection();
  const caption = document.getElementById("site-map-caption");
  siteMapZones().forEach((z) => {
    const isLast = !!last && !!last.site && z.dataset.site === last.site;
    z.setAttribute("aria-pressed", z.dataset.site === chosen ? "true" : "false");
    z.classList.toggle("selected", z.dataset.site === chosen);
    z.classList.toggle("last-used", isLast && z.dataset.site !== chosen);
    const baseLabel = z.getAttribute("aria-label") || z.dataset.site;
    const cleanLabel = baseLabel.replace(/, last shot.*$/, "");
    z.setAttribute("aria-label", isLast ? cleanLabel + ", last shot" : cleanLabel);
  });
  let html = "Tap a zone to select it.";
  if (last && last.site) {
    html += " Last shot: <strong>" + escapeHtml(last.site) + "</strong> on " + escapeHtml(formatDate(last.date)) + ".";
  }
  if (last && chosen && last.site === chosen) {
    html += '<span class="rotation-nudge">You used ' + escapeHtml(chosen) + " last time. Consider rotating to a fresh site.</span>";
  }
  if (caption) caption.innerHTML = html;
}

siteMapZones().forEach((z) => {
  const pick = () => {
    document.getElementById("inj-site").value = z.dataset.site;
    renderSiteMap();
  };
  z.addEventListener("click", pick);
  z.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
  });
});
document.getElementById("inj-site").addEventListener("change", renderSiteMap);
document.getElementById("site-map-flip").addEventListener("click", () => {
  const back = document.getElementById("map-back");
  showSiteMapView(back && back.style.display !== "none" ? "front" : "back");
});

document.getElementById("cancel-injection").addEventListener("click", () => {
  toggleForm(injForm, document.getElementById("show-injection-form"), false);
});

injForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = {
    id: editingInjectionId || uid(),
    date: document.getElementById("inj-date").value,
    medication: document.getElementById("inj-med").value.trim(),
    dose: Number(document.getElementById("inj-dose").value),
    site: document.getElementById("inj-site").value,
    status: document.getElementById("inj-status").value || "On time",
    notes: document.getElementById("inj-notes").value.trim().slice(0, 2000)
  };
  const injMsg = document.getElementById("inj-saved-msg");
  if (!entry.date) { setFormStatus(injMsg, "Add a date first.", true); document.getElementById("inj-date").focus(); return; }
  if (!entry.medication) { setFormStatus(injMsg, "Add the medication name first.", true); document.getElementById("inj-med").focus(); return; }
  if (!entry.dose || entry.dose <= 0) {
    setFormStatus(injMsg, "Add a dose above zero first.", true);
    document.getElementById("inj-dose").focus();
    return;
  }
  if (!entry.site) { setFormStatus(injMsg, "Choose an injection site first.", true); document.getElementById("inj-site").focus(); return; }
  if (editingInjectionId) {
    const i = store.injections.findIndex((x) => x.id === editingInjectionId);
    if (i === -1) {
      setFormStatus(injMsg, "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.injections[i] = entry;
  } else {
    store.injections.push(entry);
  }
  editingInjectionId = null;
  saveStore();
  injectionLimit = 10;
  renderInjections();
  renderInjectionCalendar();
  renderSiteMap();
  renderToday();
  toggleForm(injForm, document.getElementById("show-injection-form"), false);
  // v066: after logging a shot, take the user to the Shots section so
  // they see the logged shot.
  showTab("shots");
  setFormStatus(document.getElementById("inj-saved-msg"), "Injection saved.", false);
});

let injectionLimit = 10; // entries shown; "show more" loads older ones in batches

/* Site rotation guide (v166): the next site in the rotation order after
   the last shot taken, so the same spot is never used twice in a row.
   Order follows the site map: abdomen, thighs, then upper arms. */
const INJECTION_SITES = ["Left Abdomen", "Right Abdomen", "Left Thigh", "Right Thigh", "Left Upper Arm", "Right Upper Arm"];
function nextInjectionSite() {
  const last = lastInjection();
  if (!last || !last.site) return null;
  const i = INJECTION_SITES.indexOf(last.site);
  if (i === -1) return INJECTION_SITES[0];
  return INJECTION_SITES[(i + 1) % INJECTION_SITES.length];
}
function renderRotationGuide() {
  const el = document.getElementById("rotation-guide");
  const btn = document.getElementById("rotation-use-site");
  if (!el) return;
  const last = lastInjection();
  const next = nextInjectionSite();
  if (!last || !next) {
    el.textContent = "Log your first shot and I will suggest the next site to rotate to.";
    if (btn) btn.classList.add("hidden");
    return;
  }
  el.innerHTML = "Next site: <strong>" + escapeHtml(next) + "</strong>. Last shot was " + escapeHtml(last.site) + " on " + escapeHtml(formatDate(last.date)) + ".";
  const due = nextShotDue();
  if (due) {
    if (due.overdueDays > 0) {
      el.innerHTML += " Shot was due " + escapeHtml(formatDate(due.dateStr)) + ". " + due.overdueDays + (due.overdueDays === 1 ? " day overdue." : " days overdue.");
    } else if (due.daysUntil === 0) {
      el.innerHTML += " Next shot is due today.";
    } else if (due.daysUntil === 1) {
      el.innerHTML += " Next shot is due tomorrow (" + escapeHtml(formatDate(due.dateStr)) + ").";
    } else {
      el.innerHTML += " Next shot is due in " + due.daysUntil + " days (" + escapeHtml(formatDate(due.dateStr)) + ").";
    }
  }
  if (btn) {
    btn.classList.remove("hidden");
    btn.onclick = () => {
      document.getElementById("inj-site").value = next;
      renderSiteMap();
      toggleForm(document.getElementById("injection-form"), document.getElementById("show-injection-form"), true);
      document.getElementById("inj-site").focus();
    };
  }
}

function renderInjections() {
  renderRotationGuide();
  const list = document.getElementById("injection-list");
  const sorted = [...store.injections].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No injections logged yet. Tap "Log shot" to add your first.</p>';
    return;
  }
  const visible = sorted.slice(0, injectionLimit);
  const remaining = sorted.length - visible.length;
  list.innerHTML = visible.map((inj) => {
    const status = inj.status || "On time";
    const missedOrDelayed = status === "Missed" || status === "Delayed";
    return `
    <div class="entry">
      <p class="entry-title">${escapeHtml(inj.medication)}${inj.dose ? " " + escapeHtml(inj.dose) + " mg" : ""}</p>
      <p class="entry-sub">${escapeHtml(formatDate(inj.date))} &middot; ${escapeHtml(inj.site)} &middot; ${escapeHtml(status)}</p>
      ${inj.notes && inj.notes.trim().toLowerCase() !== status.toLowerCase() ? `<p class="entry-notes">${escapeHtml(inj.notes)}</p>` : ""}
      ${missedOrDelayed ? `<p class="entry-notes">Always consult your healthcare provider about your medication, dosing, and health decisions. Never change your dose based on this app.</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-inj="${inj.id}" aria-label="Edit injection: ${escapeHtml(inj.medication)}${inj.dose ? " " + escapeHtml(inj.dose) + " mg" : ""} on ${escapeHtml(formatDate(inj.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-inj="${inj.id}" aria-label="Delete injection: ${escapeHtml(inj.medication)}${inj.dose ? " " + escapeHtml(inj.dose) + " mg" : ""} on ${escapeHtml(formatDate(inj.date))}">Delete</button>
      </div>
    </div>`;
  }).join("")
    + (remaining > 0
      ? `<button class="btn" id="more-injections" style="width:100%;margin-top:8px">Show older (${remaining} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-inj]").forEach((b) => b.addEventListener("click", () => {
    const inj = store.injections.find((x) => x.id === b.dataset.editInj);
    if (!inj) {
      setFormStatus(document.getElementById("inj-saved-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    editingInjectionId = inj.id;
    injForm.querySelector("h3").textContent = "Edit Injection";
    document.getElementById("inj-date").value = inj.date;
    document.getElementById("inj-med").value = inj.medication;
    document.getElementById("inj-dose").value = inj.dose;
    document.getElementById("inj-site").value = inj.site;
    document.getElementById("inj-status").value = inj.status || "On time";
    const missedOrDelayed = (inj.status || "On time") === "Missed" || (inj.status || "On time") === "Delayed";
    document.getElementById("inj-status-note").classList.toggle("hidden", !missedOrDelayed);
    document.getElementById("inj-notes").value = inj.notes || "";
    toggleForm(injForm, document.getElementById("show-injection-form"), true);
    renderSiteMap();
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-inj]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this injection entry?")) return;
    store.injections = store.injections.filter((x) => x.id !== b.dataset.delInj);
    saveStore();
    injectionLimit = 10;
    renderInjections();
    renderInjectionCalendar();
    renderToday();
  }));

  const moreBtn = document.getElementById("more-injections");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    injectionLimit += 10;
    renderInjections();
  });
}

/* ---------- Weight ---------- */

const weightForm = document.getElementById("weight-form");
let editingWeightId = null;

document.getElementById("show-weight-form").addEventListener("click", () => {
  editingWeightId = null;
  weightForm.querySelector("h3").textContent = "Log weigh-in";
  weightForm.reset();
  document.getElementById("weight-date").value = todayStr();
  toggleForm(weightForm, document.getElementById("show-weight-form"), true);
});

document.getElementById("cancel-weight").addEventListener("click", () => {
  toggleForm(weightForm, document.getElementById("show-weight-form"), false);
});

weightForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = {
    id: editingWeightId || uid(),
    date: document.getElementById("weight-date").value,
    value: Number(document.getElementById("weight-value").value)
  };
  const weightMsg = document.getElementById("weight-saved-msg");
  if (!entry.date) { setFormStatus(weightMsg, "Add a date first.", true); return; }
  if (entry.date > todayStr()) {
    setFormStatus(weightMsg, "That date is in the future. Pick today or an earlier date.", true);
    return;
  }
  if (!entry.value || entry.value <= 0) {
    setFormStatus(weightMsg, "Add a weight above zero first.", true);
    document.getElementById("weight-value").focus();
    return;
  }
  if (editingWeightId) {
    const i = store.weight.findIndex((x) => x.id === editingWeightId);
    if (i === -1) {
      setFormStatus(weightMsg, "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.weight[i] = entry;
  } else {
    store.weight.push(entry);
  }
  editingWeightId = null;
  syncStartingWeight(); // K3: freeze from the first weigh-in if not yet frozen
  saveStore();
  renderWeight();
  toggleForm(weightForm, document.getElementById("show-weight-form"), false);
  setFormStatus(document.getElementById("weight-saved-msg"), "Weigh-in saved.", false);
});

let weightLimit = 10; // entries shown; "show more" loads older ones in batches

/* K3 freeze: the starting weight is frozen from the first weigh-in and
   never moves when an earlier weigh-in is added or the first one is
   deleted. It clears only when the weight log becomes empty, so a fresh
   start freezes again from the new first weigh-in. */
function syncStartingWeight() {
  if (!store.settings) return;
  if (!(store.weight || []).length) {
    store.settings.startingWeight = null;
    return;
  }
  if (!store.settings.startingWeight) {
    const sorted = [...store.weight].sort(byDate);
    store.settings.startingWeight = { value: Number(sorted[0].value), date: sorted[0].date };
  }
}

/* The frozen starting weight when set, else the earliest weigh-in (the
   pre-freeze fallback). Returns { value, date } or null. */
function getStartingWeight() {
  const frozen = store.settings && store.settings.startingWeight;
  if (frozen && Number.isFinite(Number(frozen.value)) && isValidDateStr(frozen.date)) {
    return { value: Number(frozen.value), date: frozen.date };
  }
  const sorted = [...(store.weight || [])].sort(byDate);
  return sorted.length ? { value: Number(sorted[0].value), date: sorted[0].date } : null;
}

function renderWeight() {
  const sorted = [...store.weight].sort(byDate);
  const noteEl = document.getElementById("weight-change-note");
  if (sorted.length) {
    const current = sorted[sorted.length - 1].value;
    const start = getStartingWeight();
    const curWEl = document.getElementById("current-weight");
    if (curWEl) curWEl.textContent = Number(current).toFixed(1);
    document.getElementById("weight-hero-value").textContent = Number(current).toFixed(1);
    document.getElementById("weight-hero-date").textContent = "Latest weigh-in " + formatDate(sorted[sorted.length - 1].date);
    /* Starting weight is frozen (K3). It is read from settings, not from
       the earliest weigh-in, so deleting or backdating entries never
       moves it. */
    document.getElementById("starting-weight").textContent = start ? Number(start.value).toFixed(1) : "--";
    document.getElementById("starting-weight-date").textContent = start ? formatDate(start.date) : "";
  } else {
    const curWEl2 = document.getElementById("current-weight");
    if (curWEl2) curWEl2.textContent = "--";
    document.getElementById("weight-hero-value").textContent = "—";
    document.getElementById("weight-hero-date").textContent = "No weigh-ins yet";
    document.getElementById("starting-weight").textContent = "--";
    document.getElementById("starting-weight-date").textContent = "";
  }
  renderBMI();
  if (sorted.length >= 2) {
    /* Total and percent show only with at least two weigh-ins. A gain is
       shown honestly as a gain, never as a negative loss. The baseline is
       the frozen starting weight (K3), not the earliest weigh-in. */
    const frozenStart = getStartingWeight();
    const start = frozenStart ? Number(frozenStart.value) : Number(sorted[0].value);
    const current = Number(sorted[sorted.length - 1].value);
    const change = start - current;
    const gained = change < 0;
    const amount = Math.abs(change).toFixed(1);
    const pct = (Math.abs(change) / start * 100).toFixed(1);
    document.getElementById("total-lost-label").textContent = gained ? "Total gained" : "Total lost";
    document.getElementById("total-lost").textContent = amount;
    document.getElementById("percent-lost-label").textContent = gained ? "Percent gained" : "Percent lost";
    document.getElementById("percent-lost").textContent = pct;
    noteEl.textContent = "";
  } else {
    document.getElementById("total-lost-label").textContent = "Total lost";
    document.getElementById("total-lost").textContent = "--";
    document.getElementById("percent-lost-label").textContent = "Percent lost";
    document.getElementById("percent-lost").textContent = "--";
    noteEl.textContent = sorted.length === 1
      ? "Log a second weigh-in to see your change."
      : "Log a weigh-in to get started.";
  }

  const list = document.getElementById("weight-list");
  const desc = [...sorted].reverse();
  const visibleWeight = desc.slice(0, weightLimit);
  const remainingWeight = desc.length - visibleWeight.length;
  list.innerHTML = desc.length
    ? visibleWeight.map((w) => `
      <div class="entry">
        <p class="entry-title">${escapeHtml(Number(w.value).toFixed(1))} lbs</p>
        <p class="entry-sub">${escapeHtml(formatDate(w.date))}</p>
        <div class="entry-actions">
          <button class="btn btn-small" data-edit-w="${w.id}" aria-label="Edit weigh-in: ${escapeHtml(Number(w.value).toFixed(1))} lbs on ${escapeHtml(formatDate(w.date))}">Edit</button>
          <button class="btn btn-small btn-danger" data-del-w="${w.id}" aria-label="Delete weigh-in: ${escapeHtml(Number(w.value).toFixed(1))} lbs on ${escapeHtml(formatDate(w.date))}">Delete</button>
        </div>
      </div>`).join("")
      + (remainingWeight > 0
        ? `<button class="btn" id="more-weight" style="width:100%;margin-top:8px">Show older (${remainingWeight} more)</button>`
        : "")
    : '<p class="empty-state">No weigh-ins yet.</p>';

  list.querySelectorAll("[data-edit-w]").forEach((b) => b.addEventListener("click", () => {
    const w = store.weight.find((x) => x.id === b.dataset.editW);
    if (!w) {
      setFormStatus(document.getElementById("weight-saved-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    editingWeightId = w.id;
    weightForm.querySelector("h3").textContent = "Edit Weigh-in";
    document.getElementById("weight-date").value = w.date;
    document.getElementById("weight-value").value = w.value;
    toggleForm(weightForm, document.getElementById("show-weight-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-w]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this weigh-in?")) return;
    store.weight = store.weight.filter((x) => x.id !== b.dataset.delW);
    syncStartingWeight(); // K3: clears the freeze only if the weight log is now empty
    saveStore();
    weightLimit = 10;
    renderWeight();
  }));

  const moreWeightBtn = document.getElementById("more-weight");
  if (moreWeightBtn) moreWeightBtn.addEventListener("click", () => {
    weightLimit += 10;
    renderWeight();
  });

  renderWeightMilestone();
  renderWeightVisuals();
  drawWeightChart();
}

/* ---------- BMI (v168) ---------- */
/* BMI from the latest weight and the height in Settings (feet and
   inches). The 703 formula: BMI = 703 × weight(lb) / height(in)².
   Shown under the big current-weight number with its category. */
function calcBMI() {
  const ft = Number(store.settings && store.settings.heightFt);
  const inch = Number(store.settings && store.settings.heightIn);
  const totalIn = (Number.isFinite(ft) ? ft : 0) * 12 + (Number.isFinite(inch) ? inch : 0);
  const sorted = [...(store.weight || [])].sort(byDate);
  const latest = sorted[sorted.length - 1];
  if (!latest || !(totalIn > 0)) return null;
  const bmi = 703 * Number(latest.value) / (totalIn * totalIn);
  if (!Number.isFinite(bmi) || bmi <= 0) return null;
  return { value: bmi, weight: Number(latest.value), heightIn: totalIn };
}
function bmiCategory(bmi) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25) return "Healthy weight";
  if (bmi < 30) return "Overweight";
  return "Obesity";
}
function renderBMI() {
  const line = document.getElementById("bmi-line");
  if (!line) return;
  const bmi = calcBMI();
  const overLine = document.getElementById("bmi-over-line");
  const healthyBlock = document.getElementById("bmi-healthy-block");
  const healthyRange = document.getElementById("bmi-healthy-range");
  if (!bmi) {
    line.textContent = "";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-small";
    b.textContent = "Add your height in Settings to see your BMI here.";
    b.addEventListener("click", () => openSettingsAt("settings-goals-card"));
    line.appendChild(b);
    if (overLine) overLine.textContent = "";
    if (healthyBlock) healthyBlock.hidden = true;
    return;
  }
  line.textContent = "BMI " + bmi.value.toFixed(1) + " · " + bmiCategory(bmi.value)
    + " (" + bmi.weight.toFixed(1) + " lbs, " + Math.floor(bmi.heightIn / 12) + " ft " + (bmi.heightIn % 12) + " in)";
  // v169: how far the current weight sits from the healthy range, and
  // what the healthy range is for this height. Weight at a BMI is
  // BMI × height² / 703. Healthy is BMI 18.5 to 24.9.
  const h2 = bmi.heightIn * bmi.heightIn;
  const lowLbs = 18.5 * h2 / 703;
  const highLbs = 24.9 * h2 / 703;
  if (overLine) {
    if (bmi.value >= 25) {
      overLine.textContent = (bmi.weight - highLbs).toFixed(1) + " lbs above the healthy range";
    } else if (bmi.value < 18.5) {
      overLine.textContent = (lowLbs - bmi.weight).toFixed(1) + " lbs below the healthy range";
    } else {
      overLine.textContent = "In the healthy range";
    }
  }
  if (healthyBlock) {
    healthyBlock.hidden = false;
    if (healthyRange) {
      healthyRange.textContent = "Healthy weight for " + Math.floor(bmi.heightIn / 12) + " ft " + (bmi.heightIn % 12) + " in: " + Math.round(lowLbs) + " to " + Math.round(highLbs) + " lbs (BMI 18.5 to 24.9).";
    }
  }
}

/* Doctor visit summary (v168, date range v066). One tap makes a
   simple summary of weight, shots, and side effects to show her
   clinician. Text only; it never leaves the phone unless she copies
   or downloads it herself. The caller picks a date range; when none
   is given it defaults to the last 30 days. */
function buildDoctorSummary(fromDate, toDate) {
  const ok = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const to = ok(toDate) ? toDate : todayStr();
  const from = ok(fromDate) ? fromDate : todayStr(-30);
  const rangeLabel = formatDateShort(from) + " to " + formatDateShort(to);
  const inRange = (d) => d >= from && d <= to;
  const lines = ["New Chapter: GLP-1 Tracker \u2014 Visit summary", "Prepared " + formatDate(todayStr()), "Dates: " + formatDate(from) + " to " + formatDate(to) + ".", ""];
  // Weight
  const sortedW = [...(store.weight || [])].sort(byDate);
  const latest = sortedW[sortedW.length - 1];
  const start = getStartingWeight();
  const bmi = calcBMI();
  lines.push("Weight");
  if (latest) {
    lines.push("Latest: " + Number(latest.value).toFixed(1) + " lbs on " + formatDate(latest.date) + ".");
    if (start) lines.push("Starting: " + Number(start.value).toFixed(1) + " lbs on " + formatDate(start.date) + ".");
    const change = start ? Number(start.value) - Number(latest.value) : 0;
    if (start) lines.push("Change: " + (change >= 0 ? "-" : "+") + Math.abs(change).toFixed(1) + " lbs since starting.");
    if (store.settings && store.settings.goalWeight) lines.push("Goal weight: " + Number(store.settings.goalWeight).toFixed(1) + " lbs.");
    if (bmi) lines.push("BMI: " + bmi.value.toFixed(1) + " (" + bmiCategory(bmi.value) + ").");
  } else {
    lines.push("No weigh-ins logged yet.");
  }
  lines.push("");
  // Shots
  const sortedI = [...(store.injections || [])].sort(byDateDesc);
  lines.push("Shots");
  const curMed = (store.settings && store.settings.medication) || "";
  const curDose = (store.settings && store.settings.dose) || "";
  if (curMed || curDose) {
    lines.push("Current: " + (curMed || "medication not recorded") + (curDose ? " " + curDose + " mg" : "") + ".");
  }
  if (sortedI.length) {
    const last = sortedI[0];
    lines.push("Last shot: " + formatDate(last.date) + " (" + (last.site || "site not recorded") + ", " + (last.medication || "medication not recorded") + (last.dose ? ", " + last.dose : "") + ").");
    const recent = sortedI.filter((s) => inRange(s.date));
    lines.push("Shots from " + rangeLabel + ": " + recent.length + ".");
    const missed = sortedI.filter((s) => s.status === "Missed").length;
    if (missed) lines.push("Missed shots on record: " + missed + ".");
  } else {
    lines.push("No shots logged yet.");
  }
  lines.push("");
  // Side effects
  const sortedE = [...(store.sideEffects || [])].sort(byDateDesc);
  const recentE = sortedE.filter((s) => inRange(s.date));
  lines.push("Side effects (" + rangeLabel + ")");
  if (recentE.length) {
    recentE.forEach((s) => {
      lines.push("- " + formatDate(s.date) + ": " + s.symptom + " (" + s.severity + ")" + (s.notes ? " \u2014 " + s.notes : ""));
    });
  } else {
    lines.push("None logged from " + rangeLabel + ".");
  }
  lines.push("");
  // Exercise
  const recentEx = (store.exercise || []).filter((e) => inRange(e.date));
  lines.push("Exercise (" + rangeLabel + ")");
  if (recentEx.length) {
    const totalMin = recentEx.reduce((t, e) => t + (Number(e.minutes) || 0), 0);
    const activeDays = new Set(recentEx.map((e) => e.date)).size;
    lines.push("Total movement: " + totalMin + " minutes across " + activeDays + " day" + (activeDays === 1 ? "" : "s") + ".");
    if (activeDays) lines.push("Average: " + Math.round(totalMin / activeDays) + " minutes per active day.");
    const planLen = getMovementPlan().length;
    let routineDays = 0;
    for (const [d, st] of Object.entries(store.movementDone || {})) {
      if (inRange(d) && st && Array.isArray(st.done) && st.done.length >= planLen) routineDays++;
    }
    if (routineDays) lines.push("Daily movement routine completed on " + routineDays + " day" + (routineDays === 1 ? "" : "s") + ".");
  } else {
    lines.push("No movement logged from " + rangeLabel + ".");
  }
  // v033: strength sessions in the chosen range, in the same Exercise section.
  const recentSt = (store.strength || []).filter((e) => inRange(e.date));
  if (recentSt.length) {
    const stDays = new Set(recentSt.map((e) => e.date)).size;
    const stSets = recentSt.reduce((t, e) => t + (Number(e.sets) || 0), 0);
    lines.push("Strength: " + recentSt.length + " exercise" + (recentSt.length === 1 ? "" : "s") + " logged across " + stDays + " day" + (stDays === 1 ? "" : "s") + ", " + stSets + " sets in total.");
  }
  lines.push("");
  lines.push("This summary is from your own log. It is not medical advice.");
  return lines.join("\n");
}
/* Doctor summary (v085): the summary is shown to a clinician, so it must
   reflect the saved log, not just this copy's in-memory store. This copy
   can go stale when another copy of the app saves entries after this one
   loaded (a second tab, or the app left open in the background), and the
   summary would then wrongly say nothing is logged. Re-read the saved
   copy on every rebuild and merge it in when it holds entries this copy
   lacks, so the summary always reflects the latest saved data. Read-only:
   it never writes to storage, it only updates the in-memory store. A merge
   is a union, so it can never remove entries. */
function refreshDoctorStore() {
  let persistedStore = null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    persistedStore = validateStore(JSON.parse(raw));
  } catch { return; }
  if (!persistedStore) return;
  try {
    if (countStoreEntries(persistedStore) > countStoreEntries(store)) {
      store = mergeStores(persistedStore, store);
      try { loadedGen = Number(localStorage.getItem(GEN_KEY)) || loadedGen; } catch {}
    }
  } catch { /* keep the in-memory store; the summary builds from it */ }
}
function openDoctorModal() {
  const modal = document.getElementById("doctor-modal");
  const text = document.getElementById("doctor-text");
  if (!modal || !text) return;
  const fromEl = document.getElementById("doctor-from");
  const toEl = document.getElementById("doctor-to");
  // Default range: last 30 days. A preset from the reminder (or a
  // previous choice) stays as it is.
  if (fromEl && !fromEl.value) fromEl.value = todayStr(-30);
  if (toEl && !toEl.value) toEl.value = todayStr();
  rebuildDoctorText();
  // The summary is long; start the box at the top so the first line
  // (the product name and heading) is fully visible, never clipped.
  text.scrollTop = 0;
  document.getElementById("doctor-msg").textContent = "";
  recordDialogOpener("doctor-modal");
  modal.classList.remove("hidden");
  const copyBtn = document.getElementById("doctor-copy");
  if (copyBtn) copyBtn.focus();
}
/* Rebuild the summary text from the From/To inputs (v066). */
function rebuildDoctorText() {
  const text = document.getElementById("doctor-text");
  if (!text) return;
  refreshDoctorStore();
  const fromEl = document.getElementById("doctor-from");
  const toEl = document.getElementById("doctor-to");
  text.value = buildDoctorSummary(fromEl ? fromEl.value : "", toEl ? toEl.value : "");
}
function closeDoctorModal() {
  document.getElementById("doctor-modal").classList.add("hidden");
  returnDialogFocus("doctor-modal", "doctor-summary-btn");
}
/* v079: the summary button appears on Weight, Shots, and Side Effects,
   so bind all of them by class. Focus returns to the button that
   opened the modal (recordDialogOpener); the Weight button id is the
   fallback only. */
document.querySelectorAll(".doctor-summary-btn").forEach((b) => b.addEventListener("click", openDoctorModal));
document.getElementById("doctor-close").addEventListener("click", closeDoctorModal);
document.getElementById("doctor-x").addEventListener("click", closeDoctorModal);
document.getElementById("doctor-modal").addEventListener("click", (e) => {
  if (e.target.id === "doctor-modal") closeDoctorModal();
});
document.getElementById("doctor-copy").addEventListener("click", () => {
  const text = document.getElementById("doctor-text").value;
  const msg = document.getElementById("doctor-msg");
  const done = () => setFormStatus(msg, "Copied. Paste it into a message or note for your clinician.", false);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      document.getElementById("doctor-text").select();
      setFormStatus(msg, "Copy did not work here. The summary is selected; copy it yourself.", true);
    });
  } else {
    document.getElementById("doctor-text").select();
    setFormStatus(msg, "Copy did not work here. The summary is selected; copy it yourself.", true);
  }
});
document.getElementById("doctor-download").addEventListener("click", () => {
  const text = document.getElementById("doctor-text").value;
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "doctor-visit-summary-" + todayStr() + ".txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setFormStatus(document.getElementById("doctor-msg"), "Downloaded as a text file.", false);
});
const doctorFromEl = document.getElementById("doctor-from");
if (doctorFromEl) doctorFromEl.addEventListener("change", rebuildDoctorText);
const doctorToEl = document.getElementById("doctor-to");
if (doctorToEl) doctorToEl.addEventListener("change", rebuildDoctorText);
/* ---------- Doctor-share reminder (v066) ---------- */
/* Gentle, once-only reminder to share side-effect notes with the
   prescribing doctor. Fires when there are 3 side-effect notes in
   the last 7 days, or any one note marked Severe. It never nags and
   never gives medical advice; it only directs the user to the doctor.
   The reminder shows once per trigger: the signature of the notes
   that triggered it is stored, and a new trigger (a new Severe note,
   or 3 new notes in 7 days) shows it again. */
const DOCTOR_REMINDER_KEY = "nct-doctor-reminder-shown";
function doctorReminderTrigger() {
  const effects = (store.sideEffects || []).slice();
  if (!effects.length) return null;
  const sevenDaysAgo = todayStr(-7);
  const recent = effects.filter((e) => e.date >= sevenDaysAgo);
  const severe = effects.filter((e) => e.severity === "Severe").sort(byDateDesc);
  if (severe.length) {
    return { kind: "severe", sig: "severe:" + severe[0].id, from: severe[0].date, label: "a side effect marked Severe" };
  }
  if (recent.length >= 3) {
    const top3 = recent.slice().sort(byDateDesc).slice(0, 3);
    const ids = top3.map((e) => e.id).sort().join(",");
    const from = top3.slice().sort(byDate)[0].date;
    return { kind: "count", sig: "count:" + ids, from: from, label: "3 side effects in the last 7 days" };
  }
  return null;
}
function renderDoctorReminder() {
  const box = document.getElementById("doctor-reminder");
  if (!box) return;
  const trig = doctorReminderTrigger();
  if (!trig) { box.innerHTML = ""; return; }
  let shown = "";
  try { shown = localStorage.getItem(DOCTOR_REMINDER_KEY) || ""; } catch {}
  if (shown === trig.sig) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="card" style="border:1px solid var(--sage-border);background:var(--sage-tint)">'
    + '<p style="margin:0 0 8px"><strong>Share with your doctor?</strong></p>'
    + '<p class="muted" style="margin:0 0 10px">You have logged ' + escapeHtml(trig.label) + '. Consider sharing your notes with your prescribing doctor.</p>'
    + '<div class="form-actions" style="flex-wrap:wrap">'
    + '<button type="button" class="btn btn-primary" id="doctor-reminder-go">Prepare a summary for my doctor</button>'
    + '<button type="button" class="btn" id="doctor-reminder-later">Not now</button>'
    + '</div></div>';
  const dismiss = () => {
    try { localStorage.setItem(DOCTOR_REMINDER_KEY, trig.sig); } catch {}
    box.innerHTML = "";
  };
  const goBtn = document.getElementById("doctor-reminder-go");
  if (goBtn) goBtn.addEventListener("click", () => {
    const fromEl = document.getElementById("doctor-from");
    const toEl = document.getElementById("doctor-to");
    if (fromEl) fromEl.value = trig.from;
    if (toEl) toEl.value = todayStr();
    dismiss();
    openDoctorModal();
  });
  const laterBtn = document.getElementById("doctor-reminder-later");
  if (laterBtn) laterBtn.addEventListener("click", dismiss);
}

/* PDF doctor export (sandbox feature). Uses jsPDF from CDN. If the
   library did not load, falls back to the browser print dialog with a
   print stylesheet that shows only the summary. */
function downloadDoctorPdf() {
  const msg = document.getElementById("doctor-msg");
  const jsPDFLib = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFLib) {
    setFormStatus(msg, "The PDF library did not load. Opening the print view instead; choose Save as PDF.", false);
    window.print();
    return;
  }
  try {
    const doc = new jsPDFLib({ unit: "pt", format: "letter" });
    const margin = 48;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    let y = 56;
    const line = (text, opts) => {
      const size = (opts && opts.size) || 11;
      const bold = opts && opts.bold;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, width);
      lines.forEach((l) => {
        if (y > doc.internal.pageSize.getHeight() - 48) { doc.addPage(); y = 56; }
        doc.text(l, margin, y);
        y += size + 5;
      });
      y += (opts && opts.gap) || 2;
    };
    line("New Chapter: GLP-1 Tracker", { size: 16, bold: true });
    line("Doctor visit summary", { size: 13, bold: true });
    line("Prepared " + formatDate(todayStr()) + ".", { size: 11 });
    line("", { size: 11 });
    const sortedW = [...(store.weight || [])].sort(byDate);
    const latest = sortedW[sortedW.length - 1];
    const start = getStartingWeight();
    const bmi = calcBMI();
    line("Weight", { size: 12, bold: true });
    if (latest) {
      line("Latest: " + Number(latest.value).toFixed(1) + " lbs on " + formatDate(latest.date) + ".");
      if (start) line("Starting: " + Number(start.value).toFixed(1) + " lbs on " + formatDate(start.date) + ".");
      if (start) {
        const change = Number(start.value) - Number(latest.value);
        line("Change: " + (change >= 0 ? "-" : "+") + Math.abs(change).toFixed(1) + " lbs since starting.");
      }
      if (store.settings && store.settings.goalWeight) line("Goal weight: " + Number(store.settings.goalWeight).toFixed(1) + " lbs.");
      if (bmi) line("BMI: " + bmi.value.toFixed(1) + " (" + bmiCategory(bmi.value) + ").");
    } else {
      line("No weigh-ins logged yet.");
    }
    line("", { size: 11 });
    const sortedI = [...(store.injections || [])].sort(byDateDesc);
    line("Shots", { size: 12, bold: true });
    if (sortedI.length) {
      const last = sortedI[0];
      line("Last shot: " + formatDate(last.date) + " (" + (last.site || "site not recorded") + ", " + (last.medication || "medication not recorded") + (last.dose ? ", " + last.dose : "") + ").");
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const recent = sortedI.filter((s) => s.date >= localDateStr(ninetyDaysAgo));
      line("Shots in the last 90 days: " + recent.length + ".");
      const missed = sortedI.filter((s) => s.status === "Missed").length;
      if (missed) line("Missed shots on record: " + missed + ".");
    } else {
      line("No shots logged yet.");
    }
    line("", { size: 11 });
    const sortedE = [...(store.sideEffects || [])].sort(byDateDesc);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentE = sortedE.filter((s) => s.date >= localDateStr(thirtyDaysAgo));
    line("Side effects (last 30 days)", { size: 12, bold: true });
    if (recentE.length) {
      recentE.forEach((s) => {
        line("- " + formatDate(s.date) + ": " + s.symptom + " (" + s.severity + ")" + (s.notes ? " — " + s.notes : ""));
      });
    } else {
      line("None logged in the last 30 days.");
    }
    line("", { size: 11 });
    line("This summary is from your own log. It is not medical advice.", { size: 10 });
    line("Your tracked data stays on this device. When you message the Companion, your message and a short summary of today go to Cloudflare for a reply. Chat messages are not stored.", { size: 10 });
    doc.save("doctor-visit-summary-" + todayStr() + ".pdf");
    setFormStatus(msg, "Downloaded as a PDF.", false);
  } catch (e) {
    setFormStatus(msg, "The PDF could not be built. Opening the print view instead; choose Save as PDF.", true);
    window.print();
  }
}
document.getElementById("doctor-pdf").addEventListener("click", downloadDoctorPdf);

function renderWeightMilestone() {
  const card = document.getElementById("milestone-card");
  const goalW = Number(store.settings.goalWeight) || 0;
  const sorted = [...store.weight].sort(byDate);
  if (!(goalW > 0) || !sorted.length) { card.classList.add("hidden"); return; }
  const frozenStart = getStartingWeight();
  const startW = frozenStart ? Number(frozenStart.value) : Number(sorted[0].value);
  const curW = Number(sorted[sorted.length - 1].value);
  const total = startW - goalW;
  if (total === 0) { card.classList.add("hidden"); return; }
  let pct = total > 0
    ? (startW - curW) / total    // working down toward goal
    : (curW - startW) / -total;  // working up toward goal
  pct = Math.max(0, Math.min(1, pct));
  const pctRound = Math.round(pct * 100);
  card.classList.remove("hidden");
  document.getElementById("milestone-bar").style.width = pctRound + "%";
  document.getElementById("milestone-barwrap").setAttribute("aria-valuenow", pctRound);
  const textEl = document.getElementById("milestone-text");
  const subEl = document.getElementById("milestone-sub");
  if (sorted.length === 1) {
    textEl.textContent = "Starting point recorded.";
    subEl.textContent = "You logged " + curW + " lbs on " + formatDate(sorted[0].date) + ". Log another weigh-in to see your change toward your goal of " + goalW + " lbs.";
    return;
  }
  if (pctRound >= 100) {
    textEl.textContent = "Goal reached! Incredible work.";
    subEl.textContent = "From " + startW + " to " + curW + " lbs. You did this.";
  } else {
    const milestone = pctRound >= 75 ? 75 : pctRound >= 50 ? 50 : pctRound >= 40 ? 40 : pctRound >= 25 ? 25 : 0;
    textEl.textContent = milestone === 75
      ? "Three quarters of the way there. Beautiful work."
      : milestone === 50
      ? "Halfway there. Beautiful work."
      : milestone === 40
      ? "Almost halfway there. Beautiful work."
      : milestone === 25
      ? "A quarter of the way there. Beautiful work."
      : "You're on your way. Every day counts.";
    subEl.textContent = pctRound + "% of the way from " + startW + " to your goal of " + goalW
      + " lbs (" + Math.abs(curW - goalW).toFixed(1) + " lbs to go).";
  }
}

/* ---------- Weight pace (v033) ---------- */
/* Pounds per week from the first and last weigh-ins, and a projected
   goal date at that pace. Plain numbers only, no judgment language.
   Needs at least two weigh-ins a week apart; the goal date shows only
   when the pace is a loss and the current weight is above the goal. */
function renderWeightVisuals() {
  const perWeekEl = document.getElementById("weight-per-week");
  const goalDateEl = document.getElementById("weight-goal-date");
  if (!perWeekEl || !goalDateEl) return;
  const sorted = [...(store.weight || [])].sort(byDate);
  perWeekEl.textContent = "";
  goalDateEl.textContent = "";
  if (sorted.length < 2) {
    perWeekEl.textContent = "Log two weigh-ins a week apart to see your pounds per week.";
    return;
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (new Date(last.date + "T12:00:00") - new Date(first.date + "T12:00:00")) / 86400000;
  if (!(days >= 7)) {
    perWeekEl.textContent = "Log two weigh-ins a week apart to see your pounds per week.";
    return;
  }
  const change = Number(first.value) - Number(last.value); // positive means lost
  const perWeek = change / days * 7;
  const absWeek = Math.abs(perWeek).toFixed(1);
  perWeekEl.textContent = perWeek > 0.05
    ? "Losing about " + absWeek + " lbs per week."
    : perWeek < -0.05
    ? "Gaining about " + absWeek + " lbs per week."
    : "Holding steady, about 0 lbs per week.";
  const goalW = Number(store.settings.goalWeight) || 0;
  const current = Number(last.value);
  if (perWeek > 0.05 && goalW > 0 && current > goalW) {
    const weeksToGo = (current - goalW) / perWeek;
    const d = new Date();
    d.setDate(d.getDate() + Math.round(weeksToGo * 7));
    goalDateEl.textContent = "At this pace, about " + formatDate(localDateStr(d)) + " to reach " + goalW + " lbs.";
  }
}

function drawWeightChart() {
  const canvas = document.getElementById("weight-chart");
  const emptyMsg = document.getElementById("weight-chart-empty");
  const sorted = [...store.weight].sort(byDate);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const chartText = document.getElementById("weight-chart-text");
  if (sorted.length < 2) {
    emptyMsg.style.display = "";
    const msEl = document.getElementById("weight-milestones");
    if (msEl) { msEl.textContent = ""; msEl.style.display = "none"; }
    renderWeightMilestone();
    if (chartText) chartText.textContent = sorted.length === 1
      ? "One weigh-in so far: " + Number(sorted[0].value).toFixed(1) + " lbs on " + formatDate(sorted[0].date) + ". Log another weigh-in to see your chart."
      : "";
    return;
  }
  emptyMsg.style.display = "none";

  const W = canvas.width, H = canvas.height;
  const padL = 52, padR = 16, padT = 16, padB = 40;
  const values = sorted.map((w) => Number(w.value));
  const goalW = Number(store.settings.goalWeight) || 0;
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(max - min, 1);
  let lo = min - span * 0.15, hi = max + span * 0.15;
  if (goalW > 0) {
    lo = Math.min(lo, goalW - span * 0.1);
    hi = Math.max(hi, goalW + span * 0.1);
  }

  const x = (i) => padL + (i / (sorted.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  ctx.strokeStyle = "#E5E0D5";
  ctx.fillStyle = "#6E6A5E";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "right";
  for (let g = 0; g <= 4; g++) {
    const gv = lo + ((hi - lo) / 4) * g;
    ctx.beginPath();
    ctx.moveTo(padL, y(gv));
    ctx.lineTo(W - padR, y(gv));
    ctx.stroke();
    ctx.fillText(gv.toFixed(0), padL - 8, y(gv) + 7);
  }

  ctx.textAlign = "center";
  const labelEvery = Math.max(1, Math.ceil(sorted.length / 5));
  sorted.forEach((w, i) => {
    if (i % labelEvery === 0 || i === sorted.length - 1) {
      const lx = x(i);
      // Right-align the last label so it doesn't clip at the edge
      ctx.textAlign = i === sorted.length - 1 ? "right" : i === 0 ? "left" : "center";
      ctx.fillText(formatDate(w.date).replace(/, \d{4}$/, ""), 
        i === sorted.length - 1 ? W - 4 : i === 0 ? 4 : lx, H - 12);
      ctx.textAlign = "center";
    }
  });

  ctx.beginPath();
  sorted.forEach((w, i) => (i === 0 ? ctx.moveTo(x(i), y(w.value)) : ctx.lineTo(x(i), y(w.value))));
  ctx.strokeStyle = "#E8B54A";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineTo(x(sorted.length - 1), H - padB);
  ctx.lineTo(x(0), H - padB);
  ctx.closePath();
  ctx.fillStyle = "rgba(232, 181, 74, 0.16)"; // v052: flat soft gold fill, no gradient and no retired gold.
  ctx.fill();

  ctx.fillStyle = "#E8B54A";
  sorted.forEach((w, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(w.value), 7, 0, Math.PI * 2);
    ctx.fill();
  });

  /* Milestones (v166): quiet gold diamonds on the chart at every 5 lbs
     lost from the starting weight, one short line of text under the
     chart. The line itself is already gold. */
  const msEl = document.getElementById("weight-milestones");
  const startW = (function () { const s = getStartingWeight(); return s ? Number(s.value) : null; })();
  const milestones = [];
  if (startW) {
    const totalLost = startW - Number(sorted[sorted.length - 1].value);
    for (let m = 5; m <= totalLost; m += 5) {
      const level = startW - m;
      let hitIdx = -1;
      for (let i = 0; i < sorted.length; i++) {
        if (Number(sorted[i].value) <= level) { hitIdx = i; break; }
      }
      if (hitIdx >= 0) milestones.push({ lbs: m, idx: hitIdx, date: sorted[hitIdx].date });
    }
  }
  milestones.forEach((ms) => {
    const dx = x(ms.idx), dy = y(Number(sorted[ms.idx].value));
    ctx.save();
    ctx.fillStyle = "#E8B54A";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dx, dy - 11);
    ctx.lineTo(dx + 9, dy);
    ctx.lineTo(dx, dy + 11);
    ctx.lineTo(dx - 9, dy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });
  if (msEl) {
    msEl.textContent = milestones.length
      ? "Milestones reached: " + milestones.map((ms) => ms.lbs + " lbs down on " + formatDate(ms.date)).join(", ") + "."
      : "";
    msEl.style.display = milestones.length ? "" : "none";
  }

  // Goal line
  if (goalW > 0) {
    const gy = y(goalW);
    ctx.save();
    ctx.strokeStyle = "#5A6B52";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(W - padR, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#5A6B52";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "left";
    const labelY = gy - 34 < padT ? gy + 28 : gy - 12;
    ctx.fillText("Goal " + goalW, padL + 8, labelY);
    ctx.restore();
  }

  if (chartText) {
    const frozenStart = getStartingWeight();
    const firstW = frozenStart ? { value: frozenStart.value, date: frozenStart.date } : sorted[0];
    const lastW = sorted[sorted.length - 1];
    const diff = Number(firstW.value) - Number(lastW.value);
    const dir = diff > 0 ? "down " + diff.toFixed(1) + " lbs" : diff < 0 ? "up " + Math.abs(diff).toFixed(1) + " lbs" : "unchanged";
    chartText.textContent = "Weight from " + Number(firstW.value).toFixed(1) + " lbs on " + formatDate(firstW.date) + " to " + Number(lastW.value).toFixed(1) + " lbs on " + formatDate(lastW.date) + ", " + dir + " over " + sorted.length + " weigh-ins." + (goalW > 0 ? " Goal: " + goalW + " lbs." : "");
  }

  renderWeightMilestone();
}

/* ---------- BMI history chart ---------- */
/* BMI over time, from the same weigh-ins as the weight chart.
   BMI = 703 × weight(lb) / height(in)². Only drawn when height is
   set and there are at least two weigh-ins. A light band marks the
   healthy range (BMI 18.5–24.9). */

/* ---------- Measurements ---------- */

const measForm = document.getElementById("measurement-form");
let editingMeasId = null;

document.getElementById("show-measurement-form").addEventListener("click", () => {
  editingMeasId = null;
  measForm.querySelector("h3").textContent = "Log Measurements";
  measForm.reset();
  document.getElementById("meas-date").value = todayStr();
  toggleForm(measForm, document.getElementById("show-measurement-form"), true);
});

document.getElementById("cancel-measurement").addEventListener("click", () => {
  toggleForm(measForm, document.getElementById("show-measurement-form"), false);
});

measForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const num = (id) => {
    const v = Number(document.getElementById(id).value);
    return v > 0 ? v : null;
  };
  const entry = {
    id: editingMeasId || uid(),
    date: document.getElementById("meas-date").value,
    waist: num("meas-waist"),
    hips: num("meas-hips"),
    chest: num("meas-chest"),
    arm: num("meas-arm"),
    thigh: num("meas-thigh"),
    neck: num("meas-neck")
  };
  if (!entry.date) {
    setFormStatus(document.getElementById("meas-msg"), "Add a date first.", true);
    return;
  }
  if (!entry.waist && !entry.hips && !entry.chest && !entry.arm && !entry.thigh && !entry.neck) {
    setFormStatus(document.getElementById("meas-msg"), "Add at least one measurement first.", true);
    document.getElementById("meas-waist").focus();
    return;
  }
  if (editingMeasId) {
    const i = store.measurements.findIndex((x) => x.id === editingMeasId);
    if (i === -1) {
      setFormStatus(document.getElementById("meas-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.measurements[i] = entry;
  } else {
    store.measurements.push(entry);
  }
  editingMeasId = null;
  saveStore();
  renderMeasurements();
  toggleForm(measForm, document.getElementById("show-measurement-form"), false);
  setFormStatus(document.getElementById("meas-saved-msg"), "Measurements saved.", false);
});

const MEAS_LABELS = { waist: "Waist", hips: "Hips", chest: "Chest", arm: "Arm", thigh: "Thigh", neck: "Neck" };

let measLimit = 10; // entries shown; "show more" loads older ones in batches

function renderMeasurements() {
  const list = document.getElementById("measurement-list");
  const sorted = [...store.measurements].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<div class="card"><p class="empty-state" style="margin:0">No measurements yet.</p></div>';
    return;
  }
  const visibleMeas = sorted.slice(0, measLimit);
  const remainingMeas = sorted.length - visibleMeas.length;
  list.innerHTML = visibleMeas.map((m) => {
    const parts = Object.keys(MEAS_LABELS)
      .filter((k) => m[k] != null)
      .map((k) => MEAS_LABELS[k] + " " + Number(m[k]).toFixed(1) + "&Prime;");
    return `
    <div class="entry">
      <p class="entry-title">${escapeHtml(formatDate(m.date))}</p>
      <p class="entry-sub">${parts.join(" &middot; ")}</p>
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-meas="${m.id}" aria-label="Edit measurements on ${escapeHtml(formatDate(m.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-meas="${m.id}" aria-label="Delete measurements on ${escapeHtml(formatDate(m.date))}">Delete</button>
      </div>
    </div>`;
  }).join("")
    + (remainingMeas > 0
      ? `<button class="btn" id="more-meas" style="width:100%;margin-top:8px">Show older (${remainingMeas} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-meas]").forEach((b) => b.addEventListener("click", () => {
    const m = store.measurements.find((x) => x.id === b.dataset.editMeas);
    if (!m) {
      setFormStatus(document.getElementById("meas-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    editingMeasId = m.id;
    measForm.querySelector("h3").textContent = "Edit Measurements";
    document.getElementById("meas-date").value = m.date;
    ["waist", "hips", "chest", "arm", "thigh", "neck"].forEach((k) => {
      document.getElementById("meas-" + k).value = m[k] != null ? m[k] : "";
    });
    toggleForm(measForm, document.getElementById("show-measurement-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-meas]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete these measurements?")) return;
    store.measurements = store.measurements.filter((x) => x.id !== b.dataset.delMeas);
    saveStore();
    measLimit = 10;
    renderMeasurements();
  }));

  const moreMeasBtn = document.getElementById("more-meas");
  if (moreMeasBtn) moreMeasBtn.addEventListener("click", () => {
    measLimit += 10;
    renderMeasurements();
  });
}

/* ---------- Progress photos ---------- */

document.getElementById("photo-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => alert("That photo could not be read. Try a different photo.");
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => alert("That photo could not be read. Try a different photo.");
    img.onload = () => {
      const maxDim = 800;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      store.photos.push({ id: uid(), date: todayStr(), dataUrl });
      if (!saveStore()) {
        store.photos.pop();
        alert("Not enough storage on this device for more photos. Try downloading a backup from Settings first, then deleting a few old photos.");
        return;
      }
      renderPhotos();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  e.target.value = "";
});

/* Progress photo comparison (v049, R-17): tap Compare on two photos
   to see them side by side with their dates. A third pick replaces
   the first. Clear empties the comparison. */
let photoCompareIds = [];
function renderPhotoCompare() {
  const box = document.getElementById("photo-compare");
  if (!box) return;
  const picked = photoCompareIds.map((id) => (store.photos || []).find((p) => p.id === id)).filter(Boolean);
  if (!picked.length) { box.classList.add("hidden"); box.innerHTML = ""; return; }
  box.classList.remove("hidden");
  box.innerHTML = '<div class="photo-compare-row">' + picked.map((p) =>
    '<figure><img src="' + p.dataUrl + '" alt="Progress photo from ' + escapeHtml(formatDate(p.date)) + '"><figcaption>' + escapeHtml(formatDate(p.date)) + '</figcaption></figure>').join("") + '</div>'
    + (picked.length < 2 ? '<p class="muted" style="margin:8px 0 0;font-size:.9rem">Pick another photo to compare.</p>' : '')
    + '<p style="margin:8px 0 0"><button type="button" class="btn btn-small" id="photo-compare-clear">Clear comparison</button></p>';
  document.getElementById("photo-compare-clear").addEventListener("click", () => { photoCompareIds = []; renderPhotos(); });
}
function renderPhotos() {
  const grid = document.getElementById("photo-grid");
  // Snapshots keep photo dates only, not the pictures; skip those here.
  const sorted = [...store.photos].filter((p) => p.dataUrl).sort(byDateDesc);
  if (!sorted.length) {
    grid.innerHTML = '<div class="card"><p class="empty-state" style="margin:0">No progress photos yet.</p></div>';
    return;
  }
  grid.innerHTML = sorted.map((p) => `
    <div class="photo-item${photoCompareIds.includes(p.id) ? " selected" : ""}">
      <img src="${p.dataUrl}" alt="Progress photo from ${escapeHtml(formatDate(p.date))}" loading="lazy">
      <div class="photo-date">
        <span>${escapeHtml(formatDate(p.date))}</span>
        <button data-compare-photo="${p.id}" aria-pressed="${photoCompareIds.includes(p.id) ? "true" : "false"}">${photoCompareIds.includes(p.id) ? "Selected" : "Compare"}</button>
        <button data-del-photo="${p.id}" aria-label="Delete photo">Delete</button>
      </div>
    </div>`).join("");

  grid.querySelectorAll("[data-del-photo]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this photo?")) return;
    store.photos = store.photos.filter((x) => x.id !== b.dataset.delPhoto);
    photoCompareIds = photoCompareIds.filter((id) => id !== b.dataset.delPhoto);
    saveStore();
    renderPhotos();
  }));
  grid.querySelectorAll("[data-compare-photo]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.comparePhoto;
    const at = photoCompareIds.indexOf(id);
    if (at >= 0) photoCompareIds.splice(at, 1);
    else {
      if (photoCompareIds.length >= 2) photoCompareIds.shift();
      photoCompareIds.push(id);
    }
    renderPhotos();
  }));
  renderPhotoCompare();
}

/* ---------- Journal ---------- */

/* Speak journal notes with the phone's built-in speech recognition; the
   words fill the notes field as you speak, and stay there to review
   before saving. Nothing auto-saves, and no audio is recorded, saved,
   or sent anywhere. The button stays hidden when recognition is not
   available. */
(function setupJournalVoice() {
  const btn = document.getElementById("journal-voice-btn");
  const notes = document.getElementById("journal-notes");
  const status = document.getElementById("journal-saved-msg");
  if (!btn || !notes) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // not available: the button stays hidden
  btn.classList.remove("hidden");
  let rec = null;
  let listening = false;
  let finalText = "";
  function setListening(on) {
    listening = on;
    btn.textContent = on ? "⏹ Stop" : "🎤 Speak";
    btn.setAttribute("aria-label", on ? "Stop listening" : "Speak your journal notes");
    if (status) status.textContent = on ? "Listening... Tap Stop when you are done." : "";
  }
  btn.addEventListener("click", () => {
    if (listening) { try { rec.stop(); } catch {} return; }
    try { rec = new SR(); } catch { return; }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    finalText = notes.value ? notes.value.trim() + " " : "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      notes.value = (finalText + interim).trimStart().slice(0, 2000);
    };
    rec.onend = () => { setListening(false); };
    rec.onerror = (ev) => {
      setListening(false);
      if (status) status.textContent = ev && ev.error === "not-allowed"
        ? "Microphone access was blocked. You can still type."
        : "I could not hear you. You can still type.";
    };
    try { rec.start(); setListening(true); } catch { setListening(false); }
  });
})();

const journalForm = document.getElementById("journal-form");
let editingJournalId = null;

document.getElementById("show-journal-form").addEventListener("click", () => {
  editingJournalId = null;
  journalForm.querySelector("h3").textContent = "New Journal Entry";
  journalForm.reset();
  document.getElementById("journal-date").value = todayStr();
  toggleForm(journalForm, document.getElementById("show-journal-form"), true);
});

document.getElementById("cancel-journal").addEventListener("click", () => {
  toggleForm(journalForm, document.getElementById("show-journal-form"), false);
});

journalForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = {
    id: editingJournalId || uid(),
    date: document.getElementById("journal-date").value,
    mood: document.getElementById("journal-mood").value,
    notes: document.getElementById("journal-notes").value.trim()
  };
  entry.notes = (entry.notes || "").slice(0, 2000);
  const journalMsg = document.getElementById("journal-saved-msg");
  if (!entry.date) { setFormStatus(journalMsg, "Add a date first.", true); return; }
  if (!entry.mood) { setFormStatus(journalMsg, "Choose a mood first.", true); return; }
  if (editingJournalId) {
    const i = store.journal.findIndex((x) => x.id === editingJournalId);
    if (i === -1) {
      setFormStatus(journalMsg, "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.journal[i] = entry;
  } else {
    store.journal.push(entry);
  }
  editingJournalId = null;
  saveStore();
  journalLimit = 10;
  renderJournal();
  toggleForm(journalForm, document.getElementById("show-journal-form"), false);
  setFormStatus(document.getElementById("journal-saved-msg"), "Journal entry saved.", false);
});

const MOOD_EMOJI = { Great: "😄", Good: "🙂", Okay: "😐", Low: "😔" };

let journalLimit = 10; // entries shown; "show more" loads older ones in batches

function renderJournal() {
  const list = document.getElementById("journal-list");
  const sorted = [...store.journal].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No journal entries yet.</p>';
    return;
  }
  const visible = sorted.slice(0, journalLimit);
  const remaining = sorted.length - visible.length;
  /* Monthly chapters (v166): entries grouped by month under a chapter
     title, newest month first. Every entry and its date stay exactly
     as they are. */
  const entryHtml = (j) => `
    <div class="entry">
      <p class="entry-title">${MOOD_EMOJI[j.mood] || ""} ${escapeHtml(j.mood)}</p>
      <p class="entry-sub">${escapeHtml(formatDate(j.date))}</p>
      ${j.notes ? `<p class="entry-notes">${escapeHtml(j.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-j="${j.id}" aria-label="Edit journal entry: ${escapeHtml(j.mood)} on ${escapeHtml(formatDate(j.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-j="${j.id}" aria-label="Delete journal entry: ${escapeHtml(j.mood)} on ${escapeHtml(formatDate(j.date))}">Delete</button>
      </div>
    </div>`;
  const groups = {};
  visible.forEach((j) => {
    const key = String(j.date || "").slice(0, 7);
    (groups[key] = groups[key] || []).push(j);
  });
  list.innerHTML = Object.keys(groups).sort().reverse().map((key) => {
    const chapterDate = new Date(key + "-01T00:00:00");
    const title = chapterDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    return `<h3 class="journal-chapter">${escapeHtml(title)}</h3>` + groups[key].map(entryHtml).join("");
  }).join("")
    + (remaining > 0
      ? `<button class="btn" id="more-journal" style="width:100%;margin-top:8px">Show older (${remaining} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-j]").forEach((b) => b.addEventListener("click", () => {
    const j = store.journal.find((x) => x.id === b.dataset.editJ);
    if (!j) {
      setFormStatus(document.getElementById("journal-saved-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    editingJournalId = j.id;
    journalForm.querySelector("h3").textContent = "Edit Journal Entry";
    document.getElementById("journal-date").value = j.date;
    document.getElementById("journal-mood").value = j.mood;
    document.getElementById("journal-notes").value = j.notes || "";
    toggleForm(journalForm, document.getElementById("show-journal-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-j]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this journal entry?")) return;
    store.journal = store.journal.filter((x) => x.id !== b.dataset.delJ);
    saveStore();
    journalLimit = 10;
    renderJournal();
  }));

  const moreBtn = document.getElementById("more-journal");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    journalLimit += 10;
    renderJournal();
  });
}

/* ---------- Side effects ---------- */

const seForm = document.getElementById("sideeffect-form");
let editingSeId = null;

document.getElementById("show-sideeffect-form").addEventListener("click", () => {
  editingSeId = null;
  seForm.querySelector("h3").textContent = "Log Side Effect";
  seForm.reset();
  document.getElementById("se-date").value = todayStr();
  toggleForm(seForm, document.getElementById("show-sideeffect-form"), true);
});

document.getElementById("cancel-sideeffect").addEventListener("click", () => {
  toggleForm(seForm, document.getElementById("show-sideeffect-form"), false);
});

seForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const entry = {
    id: editingSeId || uid(),
    date: document.getElementById("se-date").value,
    symptom: document.getElementById("se-symptom").value.trim(),
    severity: document.getElementById("se-severity").value,
    notes: document.getElementById("se-notes").value.trim()
  };
  entry.notes = (entry.notes || "").slice(0, 2000);
  const seMsg = document.getElementById("se-saved-msg");
  if (!entry.date) { setFormStatus(seMsg, "Add a date first.", true); return; }
  if (!entry.symptom) { setFormStatus(seMsg, "Add the symptom first.", true); return; }
  if (!entry.severity) { setFormStatus(seMsg, "Choose how bad it was first.", true); return; }
  if (editingSeId) {
    const i = store.sideEffects.findIndex((x) => x.id === editingSeId);
    if (i === -1) {
      setFormStatus(seMsg, "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.sideEffects[i] = entry;
  } else {
    store.sideEffects.push(entry);
  }
  editingSeId = null;
  saveStore();
  renderSideEffects();
  toggleForm(seForm, document.getElementById("show-sideeffect-form"), false);
  setFormStatus(document.getElementById("se-saved-msg"), "Side effect saved.", false);
});

let seLimit = 10; // entries shown; "show more" loads older ones in batches

/* One side effect entry in the gentle timeline, shared by the Effects
   tab and the Side effects section on the Journal tab (v169). */
function seItemHtml(s) {
  const badgeClass = { Mild: "badge-mild", Moderate: "badge-moderate", Severe: "badge-severe" };
  const sevClass = { Mild: "se-sev-mild", Moderate: "se-sev-moderate", Severe: "se-sev-severe" };
  return `
    <div class="entry se-timeline-item ${sevClass[s.severity] || ""}">
      <p class="entry-title">${escapeHtml(s.symptom)}<span class="badge ${badgeClass[s.severity] || ""}">${escapeHtml(s.severity)}</span></p>
      <p class="entry-sub">${escapeHtml(formatDate(s.date))}</p>
      ${s.notes ? `<p class="entry-notes">${escapeHtml(s.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-se="${s.id}" aria-label="Edit side effect: ${escapeHtml(s.symptom)} on ${escapeHtml(formatDate(s.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-se="${s.id}" aria-label="Delete side effect: ${escapeHtml(s.symptom)} on ${escapeHtml(formatDate(s.date))}">Delete</button>
      </div>
    </div>`;
}

/* Edit and Delete for the side effect buttons inside one container.
   Edit opens the form on the Effects tab, so it works from the Journal
   tab too: the tab is shown first, then the form opens. */
function bindSeButtons(container) {
  container.querySelectorAll("[data-edit-se]").forEach((b) => b.addEventListener("click", () => {
    const s = store.sideEffects.find((x) => x.id === b.dataset.editSe);
    if (!s) {
      setFormStatus(document.getElementById("se-saved-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    showTab("side-effects");
    editingSeId = s.id;
    seForm.querySelector("h3").textContent = "Edit Side Effect";
    document.getElementById("se-date").value = s.date;
    document.getElementById("se-symptom").value = s.symptom;
    document.getElementById("se-severity").value = s.severity;
    document.getElementById("se-notes").value = s.notes || "";
    toggleForm(seForm, document.getElementById("show-sideeffect-form"), true);
    window.scrollTo(0, 0);
  }));
  container.querySelectorAll("[data-del-se]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this side effect entry?")) return;
    store.sideEffects = store.sideEffects.filter((x) => x.id !== b.dataset.delSe);
    saveStore();
    seLimit = 10;
    renderSideEffects();
  }));
}

/* ---------- Side effect trends (sandbox feature) ---------- */
/* Last 30 days, grouped by symptom: how many times it happened and the
   average severity, so patterns are easy to see without reading every
   entry. */
function renderSeTrends() {
  const el = document.getElementById("se-trends");
  if (!el) return;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recent = (store.sideEffects || []).filter((e) => e.date >= localDateStr(thirtyDaysAgo));
  if (!recent.length) { el.innerHTML = ""; el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  const sevNum = { "Mild": 1, "Moderate": 2, "Severe": 3 };
  const groups = {};
  recent.forEach((e) => {
    // v049: group by the lowercased symptom, so "Nausea" and "nausea"
    // count together. The display name keeps the first spelling typed.
    const display = (e.symptom || "Effect").trim();
    const key = display.toLowerCase();
    if (!groups[key]) groups[key] = { display, count: 0, sev: 0, n: 0, last: "", sevLabel: "" };
    groups[key].count++;
    if (sevNum[e.severity]) { groups[key].sev += sevNum[e.severity]; groups[key].n++; }
    if (e.severity) groups[key].sevLabel = e.severity;
    if (!groups[key].last || e.date > groups[key].last) groups[key].last = e.date;
  });
  const shotDates = new Set((store.injections || []).map((e) => e.date));
  const dayBeforeStr = (d) => {
    const p = String(d).split("-");
    const dt = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    dt.setDate(dt.getDate() - 1);
    return localDateStr(dt);
  };
  const rows = Object.entries(groups).sort((a, b) => b[1].count - a[1].count).map(([key, g]) => {
    const avg = g.n ? (g.sev / g.n).toFixed(1) : "—";
    let shotNote = "";
    if (g.last && (shotDates.has(g.last) || shotDates.has(dayBeforeStr(g.last)))) {
      const sd = shotDates.has(g.last) ? g.last : dayBeforeStr(g.last);
      shotNote = ", after your shot on " + formatDate(sd);
    }
    // v080: a single event shows its severity ("Mild, 1 time"); the
    // average only means something with 2 or more events.
    const sevText = g.count === 1 && g.sevLabel
      ? escapeHtml(g.sevLabel) + ", 1 time in the last 30 days"
      : g.count + " time" + (g.count === 1 ? "" : "s") + " in the last 30 days, average severity " + avg + " of 3";
    return `<li><strong>${escapeHtml(g.display)}</strong>: ${sevText}${shotNote}</li>`;
  }).join("");
  el.innerHTML = `<h3 style="margin:0 0 6px">Trends, last 30 days</h3><ul style="margin:0;padding-left:20px">${rows}</ul>`;
}

/* ---------- Saved recipes (sandbox feature) ---------- */
/* Recipes from the Companion, saved to cook again. Title plus the
   ingredients and steps, pasted in. Stored on this device only. */
/* ---------- New Chapter Kitchen ---------- */
/* Built-in recipe library. Per-serving macros are estimated from USDA
   FoodData Central values for the listed ingredients (chicken breast
   roasted FDC 171477, Greek yogurt nonfat FDC 174833, salmon Atlantic
   cooked FDC 175168, egg FDC 171727, and standard entries for oats,
   quinoa, vegetables, and grains). Calories are 4/4/9 from the rounded
   macros, the same conversion the app uses everywhere. Tags drive the
   filter chips. */
const KITCHEN_RECIPES = [
  {
    "id": "greek-yogurt-berry-bowl",
    "image": "kitchen/greek-yogurt-berry-bowl.jpg",
    "credit": "",
    "name": "Greek Yogurt Berry Bowl",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 20, "carbs": 18, "fat": 7, "saturatedFat": 2, "calories": 215, "sodium": 70,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian",
      "low-sodium"
    ],
    "ingredients": [
      "1 cup plain Greek yogurt",
      "1/2 cup mixed berries",
      "1 tbsp chia seeds",
      "1 tbsp chopped pistachios",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Scoop yogurt into a bowl.",
      "Top with berries, chia seeds and pistachios.",
      "Finish with lemon zest."
    ]
  },
  {
    "id": "mediterranean-egg-muffins",
    "image": "kitchen/mediterranean-egg-muffins.jpg",
    "credit": "",
    "name": "Mediterranean Egg Muffins",
    "category": "Breakfast",
    "time": 25,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 21, "carbs": 8, "fat": 11, "saturatedFat": 4, "calories": 215, "sodium": 230,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "6 eggs",
      "1 cup chopped vegetables (kale, peppers, onion, broccoli)",
      "1 garlic clove, minced",
      "1/4 cup feta cheese",
      "1 tsp dried oregano",
      "1 tsp lemon zest",
      "1/4 tsp turmeric"
    ],
    "steps": [
      "Whisk the eggs with the oregano, lemon zest, garlic and turmeric.",
      "Mix in the kale, peppers, onion and broccoli.",
      "Pour into a muffin tin and bake at 350°F for 18–20 min, until set."
    ]
  },
  {
    "id": "overnight-oats-with-berries",
    "image": "kitchen/overnight-oats-with-berries.jpg",
    "credit": "",
    "name": "Overnight Oats with Berries",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22, "carbs": 21, "fat": 12, "saturatedFat": 1, "calories": 269, "sodium": 120,
    "tags": [
      "breakfast",
      "easy-prep",
      "vegetarian",
      "low-sodium"
    ],
    "ingredients": [
      "1/2 cup rolled oats",
      "1/2 cup oat milk (or low-fat milk)",
      "1/4 cup Greek yogurt",
      "1/2 cup blueberries",
      "1 tbsp ground flaxseed",
      "1/2 tsp cinnamon",
      "1/4 tsp vanilla extract",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Mix the oats, oat milk, yogurt, flaxseed, cinnamon, vanilla and lemon zest in a jar.",
      "Stir in the blueberries and refrigerate overnight."
    ]
  },
  {
    "id": "avocado-toast-with-egg",
    "image": "kitchen/avocado-toast-with-egg.jpg",
    "credit": "",
    "name": "Avocado Toast with Egg",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22, "carbs": 16, "fat": 14, "saturatedFat": 5, "calories": 270, "sodium": 150,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian"
    ],
    "ingredients": [
      "1 slice whole-grain bread",
      "1/3 avocado",
      "1 tbsp ground flaxseed",
      "1 egg",
      "1 tsp lemon juice",
      "Salt and pepper to taste"
    ],
    "steps": [
      "Toast the bread.",
      "Mash the avocado with lemon juice and the ground flaxseed and spread it on the toast.",
      "Cook the egg as you like and place it on top.",
      "Season with salt and pepper."
    ]
  },
{
    "id": "costa-rican-breakfast-bowl",
    "image": "kitchen/costa-rican-breakfast-bowl.jpg",
    "credit": "",
    "name": "Costa Rican Breakfast Bowl",
    "category": "Breakfast",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22, "carbs": 20, "fat": 13, "saturatedFat": 4, "calories": 285, "sodium": 560,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free"
    ],
    "ingredients": [
      "2 eggs",
      "1/2 cup black beans",
      "1/4 avocado",
      "1/2 cup tomatoes",
      "2 tbsp salsa"
    ],
    "steps": [
      "Cook eggs, assemble bowl.",
      "Top with avocado and salsa."
    ]
  },
  {
    "id": "greek-omelet-with-veggies",
    "image": "kitchen/greek-omelet-with-veggies.jpg",
    "credit": "",
    "name": "Greek Omelet with Veggies",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 21, "carbs": 9, "fat": 13, "saturatedFat": 4, "calories": 235, "sodium": 300,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "2 eggs",
      "1/2 cup kale, chopped",
      "1/2 cup broccoli, chopped",
      "1/2 cup tomatoes, diced",
      "1 tbsp feta cheese",
      "1 tsp olive oil",
      "1 tsp lemon zest",
      "1 tbsp fresh dill, chopped",
      "1/4 tsp turmeric"
    ],
    "steps": [
      "Whisk the eggs with the lemon zest and turmeric.",
      "Cook the kale, broccoli and tomatoes in olive oil for 2 minutes, until the kale wilts.",
      "Pour in the eggs and cook until set, then top with feta and dill and serve."
    ]
  },
  {
    "id": "smoothie-bowl-with-hemp-seeds",
    "image": "kitchen/smoothie-bowl-with-hemp-seeds.jpg",
    "credit": "",
    "name": "Smoothie Bowl with Hemp Seeds",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 25, "carbs": 16, "fat": 9, "saturatedFat": 1, "calories": 235, "sodium": 70,
    "tags": [
      "breakfast",
      "snacks-smoothies",
      "high-protein",
      "easy-prep",
      "vegetarian",
      "gluten-free",
      "low-sodium"
    ],
    "ingredients": [
      "1 cup plain Greek yogurt",
      "1/2 cup frozen berries",
      "1/2 cup blueberries",
      "1 tbsp hemp seeds",
      "1 tbsp chia seeds"
    ],
    "steps": [
      "Blend the yogurt, berries and blueberries until smooth.",
      "Pour into a bowl.",
      "Top with hemp seeds and chia seeds."
    ]
  },
  {
    "id": "cottage-cheese-with-fruit-nuts",
    "image": "kitchen/cottage-cheese-with-fruit-nuts.jpg",
    "credit": "",
    "name": "Cottage Cheese with Fruit & Nuts",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 25, "carbs": 8, "fat": 12, "saturatedFat": 3, "calories": 229, "sodium": 380,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "1 cup cottage cheese",
      "1/2 cup mixed berries",
      "1 tbsp chopped walnuts",
      "1 tbsp ground flaxseed",
      "1/2 tsp cinnamon",
      "1 tsp lime zest"
    ],
    "steps": [
      "Spoon the cottage cheese into a bowl.",
      "Top with berries, walnuts and flaxseed.",
      "Finish with cinnamon and lime zest."
    ]
  },
  {
    "id": "chia-pudding-with-coconut",
    "image": "kitchen/chia-pudding-with-coconut.jpg",
    "credit": "",
    "name": "Chia Pudding with Coconut",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 21, "carbs": 20, "fat": 11, "saturatedFat": 2, "calories": 262, "sodium": 70,
    "tags": [
      "breakfast",
      "easy-prep",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "low-sodium"
    ],
    "ingredients": [
      "1/4 cup chia seeds",
      "1/2 cup light coconut milk",
      "1/2 cup plain Greek yogurt",
      "1 tbsp shredded coconut",
      "1/2 cup berries",
      "1 tbsp ground flaxseed",
      "1/4 tsp vanilla extract",
      "1/2 tsp cinnamon"
    ],
    "steps": [
      "Stir the chia seeds and flaxseed into the light coconut milk, yogurt, vanilla and cinnamon.",
      "Refrigerate overnight.",
      "Top with shredded coconut and berries."
    ]
  },
  {
    "id": "spinach-feta-breakfast-wrap",
    "image": "kitchen/spinach-feta-breakfast-wrap.jpg",
    "credit": "",
    "name": "Kale & Feta Breakfast Wrap",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 24, "carbs": 17, "fat": 13, "saturatedFat": 5, "calories": 281, "sodium": 320,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian"
    ],
    "ingredients": [
      "1 whole-grain wrap",
      "2 eggs",
      "1 cup kale, chopped",
      "2 tbsp feta cheese",
      "1 tsp olive oil"
    ],
    "steps": [
      "Whisk the eggs.",
      "Cook the kale in olive oil until wilted, add the eggs and scramble.",
      "Spoon into the wrap with feta and roll up."
    ]
  },
{
    "id": "mediterranean-chickpea-salad",
    "image": "kitchen/mediterranean-chickpea-salad.jpg",
    "credit": "",
    "name": "Mediterranean Chickpea Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 24, "carbs": 19, "fat": 14, "saturatedFat": 4, "calories": 298, "sodium": 550,
    "tags": [
      "lunch",
      "high-protein",
      "vegetarian",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 can chickpeas, drained",
      "1 cup cherry tomatoes, halved",
      "1/2 cucumber, diced",
      "1/4 red onion, diced",
      "1/4 cup feta cheese",
      "2 tbsp olive oil",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Combine chickpeas, tomatoes, cucumber, onion, and feta in a bowl.",
      "Drizzle with olive oil and lemon juice.",
      "Toss and serve."
    ]
  },
  {
    "id": "tuna-white-bean-salad",
    "image": "kitchen/tuna-white-bean-salad.jpg",
    "credit": "",
    "name": "Tuna & White Bean Salad",
    "category": "Lunch",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 35, "carbs": 20, "fat": 14, "saturatedFat": 3, "calories": 335, "sodium": 250,
    "tags": [
      "lunch",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 can tuna, drained",
      "1 can white beans, drained",
      "1/2 red onion, diced",
      "1 tbsp olive oil",
      "1 tbsp lemon juice",
      "1 tbsp ground flaxseed",
      "1 cup arugula"
    ],
    "steps": [
      "Combine tuna, white beans, and onion in a bowl.",
      "Whisk the olive oil, lemon juice and flaxseed and drizzle over the salad.",
      "Serve over arugula."
    ]
  },
  {
    "id": "greek-quinoa-bowl",
    "image": "kitchen/greek-quinoa-bowl.jpg",
    "credit": "",
    "name": "Greek Quinoa Bowl",
    "category": "Lunch",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 25, "carbs": 22, "fat": 10, "saturatedFat": 4, "calories": 277, "sodium": 280,
    "tags": [
      "lunch",
      "high-protein",
      "vegetarian",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 cup cooked quinoa",
      "1 cup cherry tomatoes, halved",
      "1/2 cucumber, diced",
      "1/2 cup broccoli, chopped",
      "1/4 cup feta cheese",
      "2 tbsp olive oil",
      "1 tbsp lemon juice",
      "1/4 cup olives"
    ],
    "steps": [
      "Cook the quinoa and let it cool.",
      "Combine with tomatoes, cucumber, broccoli, feta, and olives.",
      "Drizzle with olive oil and lemon juice."
    ]
  },
  {
    "id": "lentil-salad-with-herbs",
    "image": "kitchen/lentil-salad-with-herbs.jpg",
    "credit": "",
    "name": "Lentil Salad with Herbs",
    "category": "Lunch",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 17, "carbs": 22, "fat": 14, "saturatedFat": 3, "calories": 290, "sodium": 200,
    "tags": [
      "lunch",
      "high-protein",
      "vegetarian",
      "vegan",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 cup cooked lentils",
      "1 cup mixed greens",
      "1/2 cup cherry tomatoes, halved",
      "1/2 cucumber, diced",
      "2 hard-boiled eggs, halved",
      "2 tbsp olive oil",
      "1 tbsp lemon juice",
      "1/4 cup chopped fresh herbs (parsley, mint, basil)"
    ],
    "steps": [
      "Toss the lentils, greens, tomatoes, cucumber and herbs together.",
      "Top with the egg halves.",
      "Drizzle with olive oil and lemon juice and serve."
    ]
  },
  {
    "id": "turkey-avocado-wrap",
    "image": "kitchen/turkey-avocado-wrap.jpg",
    "credit": "",
    "name": "Turkey & Avocado Wrap",
    "category": "Lunch",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 28, "carbs": 20, "fat": 14, "saturatedFat": 4, "calories": 318, "sodium": 250,
    "tags": [
      "lunch",
      "high-protein",
      "easy-prep"
    ],
    "ingredients": [
      "1 whole-grain wrap",
      "4 oz fresh cooked turkey breast, sliced",
      "1/2 avocado, sliced",
      "1 cup lettuce",
      "2 tbsp hummus"
    ],
    "steps": [
      "Spread hummus on the wrap.",
      "Layer turkey, avocado, and lettuce.",
      "Roll up and slice in half."
    ]
  },
  {
    "id": "caprese-salad-with-beans",
    "image": "kitchen/caprese-salad-with-beans.jpg",
    "credit": "",
    "name": "Caprese Salad with Beans",
    "category": "Lunch",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 22, "carbs": 21, "fat": 14, "saturatedFat": 3, "calories": 295, "sodium": 280,
    "tags": [
      "lunch",
      "vegetarian",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 can white beans, drained",
      "2 tomatoes, sliced",
      "1/2 ball fresh mozzarella, sliced",
      "1/4 cup basil leaves",
      "2 tbsp olive oil",
      "1 tbsp balsamic vinegar",
      "1 tsp lemon zest",
      "1 tbsp pumpkin seeds"
    ],
    "steps": [
      "Arrange tomato and mozzarella slices on a plate.",
      "Add white beans and basil.",
      "Drizzle with olive oil and balsamic vinegar, finish with lemon zest and pumpkin seeds."
    ]
  },
  {
    "id": "vegetable-farro-bowl",
    "image": "kitchen/vegetable-farro-bowl.jpg",
    "credit": "",
    "name": "Vegetable Farro Bowl",
    "category": "Lunch",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 22, "carbs": 24, "fat": 9, "saturatedFat": 4, "calories": 268, "sodium": 280,
    "tags": [
      "lunch",
      "vegetarian",
      "easy-prep"
    ],
    "ingredients": [
      "1 cup cooked farro",
      "1 cup roasted vegetables",
      "1/2 cup Brussels sprouts, halved",
      "1/2 cup chickpeas",
      "2 tbsp olive oil",
      "1 tbsp lemon juice",
      "2 tbsp feta cheese",
      "1 tsp dried oregano",
      "1 garlic clove, minced",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Cook the farro.",
      "Toss the vegetables and Brussels sprouts with half the olive oil, oregano and garlic, and roast at 400°F until golden at the edges.",
      "Combine farro, vegetables, and chickpeas.",
      "Top with feta, remaining olive oil, lemon juice and lemon zest."
    ]
  },
  {
    "id": "chicken-roasted-veggies",
    "image": "kitchen/chicken-roasted-veggies.jpg",
    "credit": "",
    "name": "Chicken & Roasted Veggies",
    "category": "Lunch",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28, "carbs": 23, "fat": 12, "saturatedFat": 3, "calories": 312, "sodium": 250,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 chicken breasts",
      "2 cups mixed vegetables",
      "1/2 cup Brussels sprouts, halved",
      "1 tbsp olive oil",
      "1 tsp herbs",
      "1/2 tsp turmeric",
      "1 lemon, half juiced and half zested",
      "Salt and pepper"
    ],
    "steps": [
      "Pat the chicken dry, season with olive oil, herbs, turmeric, salt and pepper.",
      "Roast chicken, vegetables and Brussels sprouts at 400°F for 20 to 25 minutes until the chicken is cooked through and golden.",
      "Slice, squeeze lemon juice over the top and finish with lemon zest."
    ]
  },
  {
    "id": "mason-jar-salad",
    "image": "kitchen/mason-jar-salad.jpg",
    "credit": "",
    "name": "Mason Jar Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 23, "carbs": 20, "fat": 13, "saturatedFat": 4, "calories": 285, "sodium": 300,
    "tags": [
      "lunch",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "2 tbsp lemon-olive oil dressing (1 tbsp olive oil, 1 tbsp lemon juice, 1 tsp chopped parsley)",
      "1/2 cup chickpeas",
      "1/2 cup cherry tomatoes, halved",
      "1/2 cup cucumber, diced",
      "1 cup greens",
      "2 tbsp feta cheese"
    ],
    "steps": [
      "Pour dressing into the bottom of a jar.",
      "Layer chickpeas, tomatoes, cucumber, feta, and greens on top.",
      "Seal and refrigerate.",
      "Shake before eating."
    ]
  },
  {
    "id": "zucchini-noodle-greek-salad",
    "image": "kitchen/zucchini-noodle-greek-salad.jpg",
    "credit": "",
    "name": "Zucchini Noodle Greek Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 26, "carbs": 22, "fat": 14, "saturatedFat": 4, "calories": 328, "sodium": 280,
    "tags": [
      "lunch",
      "vegetarian",
      "gluten-free",
      "easy-prep",
      "low-carb"
    ],
    "ingredients": [
      "2 zucchini, spiralized",
      "1 cup cherry tomatoes, halved",
      "1/2 cucumber, diced",
      "1/2 cup chickpeas",
      "1/4 cup feta cheese",
      "2 tbsp olive oil",
      "1 tbsp lemon juice",
      "1/4 cup olives"
    ],
    "steps": [
      "Spiralize the zucchini into noodles.",
      "Combine with tomatoes, cucumber, chickpeas, feta, and olives.",
      "Drizzle with olive oil and lemon juice."
    ]
  },
  {
    "id": "lemon-herb-salmon",
    "image": "kitchen/lemon-herb-salmon.jpg",
    "credit": "",
    "name": "Lemon Herb Salmon",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 36, "carbs": 26, "fat": 13, "saturatedFat": 4, "calories": 360, "sodium": 200,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb",
      "easy-prep"
    ],
    "ingredients": [
      "2 salmon fillets (4 oz each)",
      "1 lemon, half juiced and half zested",
      "1 tbsp olive oil",
      "2 garlic cloves, minced",
      "1 tsp herbs",
      "1 cup steamed broccoli, for serving",
      "Salt and pepper"
    ],
    "steps": [
      "Season the salmon with lemon juice, lemon zest, garlic, herbs, salt, and pepper.",
      "Heat olive oil in a pan.",
      "Cook the salmon 4 to 5 minutes per side until flaky, rest 3 minutes, then serve with pan juices spooned over and the broccoli on the side."
    ]
  },
  {
    "id": "mediterranean-chicken",
    "image": "kitchen/mediterranean-chicken.jpg",
    "credit": "",
    "name": "Mediterranean Chicken",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 34, "carbs": 18, "fat": 12, "saturatedFat": 2, "calories": 290, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 chicken breasts",
      "1 cup cherry tomatoes, halved",
      "1 cup broccoli florets",
      "1/2 cup olives",
      "1 tbsp olive oil",
      "1 tsp oregano",
      "1 lemon"
    ],
    "steps": [
      "Season the chicken with oregano, salt, and pepper.",
      "Sear in olive oil until golden.",
      "Add tomatoes, broccoli and olives and cook 5 minutes more, until the broccoli is just tender.",
      "Squeeze lemon over the top and serve."
    ]
  },
  {
    "id": "turkey-bean-chili",
    "image": "kitchen/turkey-bean-chili.jpg",
    "credit": "",
    "name": "Turkey Bean Chili",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 26, "carbs": 18, "fat": 14, "saturatedFat": 2, "calories": 300, "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "1 lb ground turkey",
      "1 can kidney beans, drained, no salt added",
      "1 can diced tomatoes, no salt added",
      "1 cup chopped kale",
      "1 onion, diced",
      "2 tbsp mild chili powder",
      "1 tsp cumin",
      "Juice of 1 lime"
    ],
    "steps": [
      "Brown the turkey with the onion.",
      "Add beans, tomatoes, chili powder, and cumin.",
      "Simmer 25 minutes, stir in the kale and lime juice and cook 5 minutes more, then serve."
    ]
  },
  {
    "id": "baked-cod-with-veggies",
    "image": "kitchen/baked-cod-with-veggies.jpg",
    "credit": "",
    "name": "Baked Cod with Veggies",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 33, "carbs": 18, "fat": 16, "saturatedFat": 3, "calories": 337, "sodium": 250,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep",
      "low-carb"
    ],
    "ingredients": [
      "2 cod fillets",
      "2 cups mixed vegetables",
      "1 tbsp ground flaxseed",
      "1 tbsp olive oil",
      "1 lemon",
      "1 tsp herbs",
      "Salt and pepper"
    ],
    "steps": [
      "Place cod and vegetables on a baking sheet.",
      "Sprinkle the flaxseed over the vegetables, drizzle with olive oil and lemon.",
      "Bake at 400°F for 15 to 18 minutes."
    ]
  },
  {
    "id": "veggie-stir-fry-with-tofu",
    "image": "kitchen/veggie-stir-fry-with-tofu.jpg",
    "credit": "",
    "name": "Veggie Stir-Fry with Tofu",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28, "carbs": 26, "fat": 12, "saturatedFat": 2, "calories": 322, "sodium": 300,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 block firm tofu, cubed",
      "2 cups mixed vegetables",
      "1 cup broccoli florets",
      "1 tbsp olive oil",
      "1 tbsp low-sodium soy sauce",
      "1 tsp sesame oil",
      "1/2 tsp turmeric"
    ],
    "steps": [
      "Press and cube the tofu.",
      "Stir-fry tofu, vegetables and broccoli in olive oil with the turmeric.",
      "Add soy sauce and sesame oil.",
      "Serve warm."
    ]
  },
  {
    "id": "hearty-lentil-stew",
    "image": "kitchen/hearty-lentil-stew.jpg",
    "credit": "",
    "name": "Hearty Lentil Stew",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 25, "carbs": 20, "fat": 12, "saturatedFat": 1, "calories": 284, "sodium": 250,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "1 cup lentils",
      "2 carrots, diced",
      "1 onion, diced",
      "1 cup chopped kale",
      "2 cups low-sodium broth",
      "1 tbsp olive oil",
      "1 tsp herbs",
      "1/2 tsp turmeric"
    ],
    "steps": [
      "Heat olive oil and cook the onion and carrots.",
      "Add lentils, kale, turmeric and broth.",
      "Simmer 30 minutes until lentils are tender."
    ]
  },
  {
    "id": "greek-chicken-skewers",
    "image": "kitchen/greek-chicken-skewers.jpg",
    "credit": "",
    "name": "Greek Chicken Skewers",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 32, "carbs": 19, "fat": 14, "saturatedFat": 2, "calories": 330, "sodium": 200,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 chicken breasts, cut into cubes",
      "1/2 cup yogurt",
      "1 tbsp lemon juice",
      "1 tsp oregano",
      "1/2 tsp turmeric",
      "1 tsp grated ginger",
      "1 bell pepper, cut into chunks",
      "1/2 red onion, cut into chunks"
    ],
    "steps": [
      "Marinate the chicken in yogurt, lemon juice, oregano, turmeric and ginger for 15 minutes.",
      "Thread chicken, pepper, and onion onto skewers.",
      "Grill 10 to 12 minutes, turning once."
    ]
  },
  {
    "id": "stuffed-peppers-with-quinoa",
    "image": "kitchen/stuffed-peppers-with-quinoa.jpg",
    "credit": "",
    "name": "Stuffed Peppers with Quinoa",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Medium",
    "servings": 4,
    "protein": 23, "carbs": 20, "fat": 13, "saturatedFat": 3, "calories": 290, "sodium": 300,
    "tags": [
      "dinner",
      "vegetarian",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "4 bell peppers",
      "1 cup cooked quinoa",
      "1 can black beans, drained",
      "1 cup diced tomatoes",
      "1/4 cup shredded part-skim mozzarella",
      "1 tsp cumin",
      "1 garlic clove, minced",
      "1 tsp dried oregano",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Cut the tops off the peppers and remove the seeds.",
      "Mix quinoa, beans, tomatoes, cheese, cumin, garlic, oregano and lemon zest.",
      "Fill the peppers.",
      "Bake at 375°F for 25 minutes."
    ]
  },
  {
    "id": "white-bean-tomato-stew",
    "image": "kitchen/white-bean-tomato-stew.jpg",
    "credit": "",
    "name": "White Bean Tomato Stew",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 23, "carbs": 15, "fat": 10, "saturatedFat": 2, "calories": 242, "sodium": 250,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "2 cans white beans, drained",
      "1 can diced tomatoes",
      "1 onion, diced",
      "2 garlic cloves, minced",
      "1 tbsp tomato paste",
      "2 tbsp olive oil",
      "1 tsp herbs",
      "1 tbsp lemon juice",
      "1/4 cup fresh basil leaves"
    ],
    "steps": [
      "Heat olive oil and cook the onion and garlic, then stir in the tomato paste and cook 2 minutes until brick red.",
      "Add beans and tomatoes.",
      "Simmer 20 minutes, stir in lemon juice and basil, and serve."
    ]
  },
  {
    "id": "thai-coconut-veggie-curry",
    "image": "kitchen/thai-coconut-veggie-curry.jpg",
    "credit": "",
    "name": "Thai Coconut Veggie Curry",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 24, "carbs": 15, "fat": 9, "saturatedFat": 2, "calories": 250, "sodium": 300,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 can light coconut milk",
      "1 cup low-sodium vegetable broth",
      "2 cups mixed vegetables",
      "1 tbsp curry paste",
      "1 tbsp lime juice",
      "1 tsp lime zest",
      "1 cup chickpeas"
    ],
    "steps": [
      "Heat the light coconut milk and broth and stir in the curry paste.",
      "Add vegetables and chickpeas.",
      "Simmer 20 minutes.",
      "Stir in lime juice and lime zest."
    ]
  },
  {
    "id": "spanish-chickpea-stew",
    "image": "kitchen/spanish-chickpea-stew.jpg",
    "credit": "",
    "name": "Spanish Chickpea Stew",
    "category": "Dinner",
    "time": 35,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 21, "carbs": 13, "fat": 14, "saturatedFat": 2, "calories": 262, "sodium": 280,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "2 cans chickpeas, drained",
      "1 can diced tomatoes",
      "1 onion, diced",
      "2 garlic cloves, minced",
      "1 tsp smoked paprika",
      "2 tbsp olive oil",
      "1 tbsp sherry vinegar",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Heat olive oil and cook the onion and garlic.",
      "Add chickpeas, tomatoes, and paprika.",
      "Simmer 25 minutes, stir in sherry vinegar and lemon zest, and serve."
    ]
  },
  {
    "id": "grilled-shrimp-with-veggies",
    "image": "kitchen/grilled-shrimp-with-veggies.jpg",
    "credit": "",
    "name": "Grilled Shrimp with Veggies",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 29, "carbs": 18, "fat": 16, "saturatedFat": 2, "calories": 321, "sodium": 250,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 lb shrimp",
      "2 cups mixed vegetables",
      "1 cup cooked quinoa",
      "1 tbsp ground flaxseed",
      "1 tbsp olive oil",
      "1 lemon",
      "1 tsp herbs"
    ],
    "steps": [
      "Season the shrimp.",
      "Sprinkle the flaxseed over the vegetables.",
      "Grill shrimp and vegetables 3 to 4 minutes per side.",
      "Serve over quinoa with lemon."
    ]
  },
  {
    "id": "vegetable-minestrone",
    "image": "kitchen/vegetable-minestrone.jpg",
    "credit": "",
    "name": "Vegetable Minestrone",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 10, "carbs": 24, "fat": 7, "saturatedFat": 1, "calories": 205, "sodium": 300,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "1 can white beans, drained",
      "2 carrots, diced",
      "1 zucchini, diced",
      "1 can diced tomatoes",
      "4 cups low-sodium broth",
      "1/2 cup whole-grain small pasta",
      "1 tbsp olive oil",
      "1 tbsp lemon juice",
      "1/4 cup fresh basil leaves"
    ],
    "steps": [
      "Heat olive oil and cook the carrots and zucchini.",
      "Add beans, tomatoes, and broth.",
      "Simmer 20 minutes.",
      "Add pasta and cook 10 minutes more, then stir in lemon juice and basil."
    ]
  },
  {
    "id": "herb-roasted-chicken",
    "image": "kitchen/herb-roasted-chicken.jpg",
    "credit": "",
    "name": "Herb-Roasted Chicken",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 28, "carbs": 16, "fat": 12, "saturatedFat": 2, "calories": 285, "sodium": 280,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "4 chicken thighs, skinless",
      "2 tbsp olive oil",
      "1 tsp rosemary",
      "1 tsp thyme",
      "2 garlic cloves, minced",
      "1 lemon, sliced",
      "Salt and pepper"
    ],
    "steps": [
      "Rub the chicken with olive oil, herbs, and garlic.",
      "Roast at 400°F for 30 to 35 minutes with the lemon slices until cooked through and golden.",
      "Rest 5 minutes, squeeze lemon over the top and serve."
    ]
  },
  {
    "id": "tuna-nicoise-bowl",
    "image": "kitchen/tuna-nicoise-bowl.jpg",
    "credit": "",
    "name": "Tuna Nicoise Bowl",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 29, "carbs": 18, "fat": 12, "saturatedFat": 3.5, "calories": 295, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 tuna steaks",
      "2 cups greens",
      "1 cup chopped kale",
      "1/2 cup green beans",
      "1 egg, hard-boiled",
      "1/4 cup olives",
      "1 tbsp olive oil",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Sear the tuna 2 to 3 minutes per side.",
      "Arrange greens, kale, green beans, egg, and olives in a bowl.",
      "Top with sliced tuna.",
      "Drizzle with olive oil and lemon juice."
    ]
  },
  {
    "id": "sheet-pan-salmon-asparagus",
    "image": "kitchen/sheet-pan-salmon-asparagus.jpg",
    "credit": "",
    "name": "Sheet Pan Salmon & Asparagus",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 36, "carbs": 19, "fat": 12, "saturatedFat": 4, "calories": 328, "sodium": 200,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep",
      "low-carb"
    ],
    "ingredients": [
      "2 salmon fillets",
      "1 bunch asparagus",
      "1/2 cup Brussels sprouts, halved",
      "1 tbsp olive oil",
      "1 lemon",
      "1 tsp herbs",
      "Salt and pepper"
    ],
    "steps": [
      "Place salmon, asparagus and Brussels sprouts on a sheet pan.",
      "Drizzle with olive oil and lemon.",
      "Bake at 400°F for 12 to 15 minutes."
    ]
  },
  {
    "id": "eggplant-parmesan",
    "image": "kitchen/eggplant-parmesan.jpg",
    "credit": "",
    "name": "Eggplant Parmesan",
    "category": "Dinner",
    "time": 45,
    "difficulty": "Medium",
    "servings": 4,
    "protein": 20, "carbs": 16, "fat": 8, "saturatedFat": 3, "calories": 220, "sodium": 380,
    "tags": [
      "dinner",
      "vegetarian",
      "easy-prep"
    ],
    "ingredients": [
      "1 eggplant, sliced",
      "1 cup marinara sauce",
      "3/4 cup shredded part-skim mozzarella",
      "2 tbsp Parmesan",
      "1 tbsp olive oil",
      "1 tsp herbs",
      "1/4 cup fresh basil leaves",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Brush eggplant slices with olive oil and bake at 400°F for 15 minutes.",
      "Layer eggplant, marinara, and cheese in a baking dish.",
      "Bake 20 minutes until bubbly, then top with basil and lemon zest."
    ]
  },
{
    "id": "mediterranean-lentil-bowl",
    "image": "kitchen/mediterranean-lentil-bowl.jpg",
    "credit": "",
    "name": "Mediterranean Lentil Bowl",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 24, "carbs": 18, "fat": 15, "saturatedFat": 3, "calories": 303, "sodium": 30,
    "tags": [
      "dinner",
      "vegetarian",
      "vegan",
      "dairy-free",
      "gluten-free",
      "easy-prep",
      "budget-friendly",
      "low-sodium"
    ],
    "ingredients": [
      "1 cup cooked lentils",
      "1 cup roasted vegetables",
      "1/2 cup cherry tomatoes, halved",
      "2 tbsp tahini",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Cook the lentils.",
      "Roast the vegetables.",
      "Combine in a bowl with tomatoes.",
      "Drizzle with tahini and lemon juice."
    ]
  },
  {
    "id": "chicken-quinoa-stir-fry",
    "image": "kitchen/chicken-quinoa-stir-fry.jpg",
    "credit": "",
    "name": "Chicken & Quinoa Stir-Fry",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 26, "carbs": 21, "fat": 14, "saturatedFat": 2, "calories": 312, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 chicken breasts, sliced",
      "1 cup cooked quinoa",
      "2 cups mixed vegetables",
      "1/2 cup broccoli florets",
      "1 tbsp olive oil",
      "1 tbsp low-sodium soy sauce",
      "1/2 tsp turmeric"
    ],
    "steps": [
      "Cook the chicken in olive oil with the turmeric.",
      "Add vegetables and broccoli and stir-fry.",
      "Stir in quinoa and soy sauce.",
      "Serve warm."
    ]
  },
  {
    "id": "broiled-tilapia-with-tomato-salsa",
    "image": "kitchen/broiled-tilapia-with-tomato-salsa.jpg",
    "credit": "",
    "name": "Broiled Tilapia with Tomato Salsa",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 30, "carbs": 21, "fat": 16, "saturatedFat": 2, "calories": 345, "sodium": 200,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "easy-prep",
      "low-carb"
    ],
    "ingredients": [
      "2 tilapia fillets",
      "1 cup diced tomatoes",
      "1/4 red onion, diced",
      "1 tbsp lime juice",
      "1 tbsp olive oil",
      "1 tsp herbs",
      "1 tbsp pumpkin seeds"
    ],
    "steps": [
      "Mix tomatoes, onion, lime juice and pumpkin seeds for the salsa.",
      "Broil the tilapia 4 to 5 minutes per side.",
      "Top with salsa."
    ]
  },
  {
    "id": "mixed-nuts-seeds",
    "image": "kitchen/mixed-nuts-seeds.jpg",
    "credit": "",
    "name": "Mixed Nuts & Seeds",
    "category": "Snacks",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 15, "carbs": 13, "fat": 14, "saturatedFat": 2, "calories": 239, "sodium": 5,
    "tags": [
      "snacks-smoothies",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "low-sodium"
    ],
    "ingredients": [
      "2 tbsp pistachios",
      "2 tbsp walnuts",
      "1 tbsp pumpkin seeds",
      "1 tbsp sunflower seeds",
      "1/4 cup blueberries"
    ],
    "steps": [
      "Combine all nuts and seeds in a small bowl.",
      "Scatter the blueberries over the top and serve."
    ]
  },
  {
    "id": "greek-yogurt-with-honey",
    "image": "kitchen/greek-yogurt-with-honey.jpg",
    "credit": "",
    "name": "Greek Yogurt with Honey",
    "category": "Snacks",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 13, "carbs": 16, "fat": 6, "saturatedFat": 0, "calories": 159, "sodium": 60,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian",
      "low-sodium"
    ],
    "ingredients": [
      "3/4 cup plain Greek yogurt",
      "1 tsp honey",
      "1/2 cup berries",
      "1 tbsp ground flaxseed"
    ],
    "steps": [
      "Spoon yogurt into a bowl.",
      "Stir in the flaxseed.",
      "Top with berries.",
      "Drizzle with honey."
    ]
  },
{
    "id": "veggie-sticks-with-hummus",
    "image": "kitchen/veggie-sticks-with-hummus.jpg",
    "credit": "",
    "name": "Veggie Sticks with Hummus",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 12, "carbs": 15, "fat": 14, "saturatedFat": 2, "calories": 234, "sodium": 180,
    "tags": [
      "snacks-smoothies",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1/2 cup carrot sticks",
      "1/2 cup cucumber sticks",
      "1/2 cup bell pepper strips",
      "1/4 cup hummus"
    ],
    "steps": [
      "Cut the vegetables into sticks.",
      "Serve with hummus for dipping."
    ]
  },
  {
    "id": "apple-with-almond-butter",
    "image": "kitchen/apple-with-almond-butter.jpg",
    "credit": "",
    "name": "Apple with Sunflower-Seed Butter",
    "category": "Snacks",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 11, "carbs": 12, "fat": 8, "saturatedFat": 1, "calories": 170, "sodium": 40,
    "tags": [
      "snacks-smoothies",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "low-sodium"
    ],
    "ingredients": [
      "1 apple, sliced",
      "2 tbsp sunflower-seed butter"
    ],
    "steps": [
      "Slice the apple.",
      "Serve with sunflower-seed butter for dipping."
    ]
  },
  {
    "id": "edamame-with-sea-salt",
    "image": "kitchen/edamame-with-sea-salt.jpg",
    "credit": "",
    "name": "Edamame with Sea Salt",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 14, "carbs": 12, "fat": 8, "saturatedFat": 1, "calories": 176, "sodium": 300,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 cup edamame in pods",
      "1/8 tsp sea salt",
      "1 tsp lemon zest"
    ],
    "steps": [
      "Boil or steam the edamame for 5 minutes.",
      "Drain, sprinkle with sea salt and lemon zest, and toss."
    ]
  },
  {
    "id": "clear-vegetable-soup",
    "image": "kitchen/clear-vegetable-soup.jpg",
    "credit": "",
    "name": "Clear Vegetable Soup",
    "category": "Light Meals",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 18, "carbs": 20, "fat": 6, "saturatedFat": 2, "calories": 210, "sodium": 300,
    "tags": [
      "small-portions",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "2 carrots, diced",
      "2 celery stalks, diced",
      "1 onion, diced",
      "1 can white beans, drained and rinsed",
      "4 cups low-sodium broth",
      "1 tbsp olive oil",
      "1 tsp herbs",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Warm the olive oil and cook the onion, carrots and celery for 5 minutes until softened.",
      "Add the beans and broth and simmer 20 minutes until vegetables are tender.",
      "Stir in lemon juice and herbs and serve."
    ]
  },
  {
    "id": "miso-tofu-soup",
    "image": "kitchen/miso-tofu-soup.jpg",
    "credit": "",
    "name": "Miso Tofu Soup",
    "category": "Light Meals",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 14, "carbs": 15, "fat": 5, "saturatedFat": 1, "calories": 160, "sodium": 300,
    "tags": [
      "small-portions",
      "easy-prep",
      "vegan",
      "dairy-free"
    ],
    "ingredients": [
      "1 cup low-sodium broth",
      "1/2 cup tofu cubes",
      "2 cups kale or bok choy, chopped",
      "1/2 cup shredded carrots",
      "1 tsp miso paste",
      "1 tsp grated ginger",
      "1 tsp lemon juice",
      "1/2 tsp turmeric"
    ],
    "steps": [
      "Heat broth, add tofu, greens, carrots, ginger and turmeric, and simmer 3 minutes.",
      "Stir in miso and lemon juice before serving."
    ]
  },
  {
    "id": "gazpacho-soup",
    "image": "kitchen/gazpacho-soup.jpg",
    "credit": "",
    "name": "Gazpacho Soup",
    "category": "Light Meals",
    "time": 15,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 17, "carbs": 15, "fat": 5, "saturatedFat": 1, "calories": 165, "sodium": 200,
    "tags": [
      "small-portions",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "4 tomatoes",
      "1 cucumber",
      "1 bell pepper",
      "1 tsp olive oil",
      "1 tbsp lemon juice",
      "1 tbsp sherry vinegar",
      "1/2 cup plain Greek yogurt, for serving",
      "2 tbsp pumpkin seeds",
      "Salt to taste"
    ],
    "steps": [
      "Blend tomatoes, cucumber, and bell pepper until smooth.",
      "Stir in olive oil, lemon juice and sherry vinegar.",
      "Chill and serve topped with a dollop of yogurt and pumpkin seeds."
    ]
  },
  {
    "id": "cucumber-salad",
    "image": "kitchen/cucumber-salad.jpg",
    "credit": "",
    "name": "Cucumber Salad",
    "category": "Light Meals",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 17, "carbs": 13, "fat": 7, "saturatedFat": 1, "calories": 175, "sodium": 200,
    "tags": [
      "small-portions",
      "easy-prep",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "2 cucumbers, sliced",
      "1/2 cup cherry tomatoes, halved",
      "1/2 cup plain Greek yogurt",
      "1 tbsp rice vinegar",
      "1 tbsp chopped fresh dill",
      "1 tbsp lemon juice",
      "1 tbsp pumpkin seeds",
      "Salt to taste"
    ],
    "steps": [
      "Slice the cucumbers and halve the tomatoes.",
      "Whisk the yogurt, vinegar, dill and lemon juice with salt.",
      "Toss with the cucumbers and tomatoes, sprinkle with pumpkin seeds and serve chilled."
    ]
  },
  {
    "id": "fruit-cottage-cheese-bowl",
    "image": "kitchen/fruit-cottage-cheese-bowl.jpg",
    "credit": "",
    "name": "Fruit & Cottage Cheese Bowl",
    "category": "Light Meals",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 14, "carbs": 14, "fat": 2, "saturatedFat": 1, "calories": 130, "sodium": 350,
    "tags": [
      "small-portions",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "3/4 cup cottage cheese",
      "1/2 cup mixed berries",
      "1/2 peach, sliced",
      "1/2 tsp cinnamon",
      "1 tsp lime zest"
    ],
    "steps": [
      "Spoon cottage cheese into a bowl.",
      "Top with berries and peach slices.",
      "Finish with cinnamon and lime zest."
    ]
  },
  {
    "id": "tamagoyaki-with-spinach",
    "image": "kitchen/tamagoyaki-with-spinach.jpg",
    "credit": "",
    "name": "Japanese Tamagoyaki with Kale",
    "category": "Breakfast",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 25, "carbs": 5, "fat": 12, "saturatedFat": 5, "calories": 228, "sodium": 250,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "3 eggs",
      "2 egg whites",
      "1 cup fresh kale, finely chopped",
      "1 tsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1/2 tsp olive oil",
      "1/4 tsp turmeric",
      "1 tsp grated ginger",
      "Pinch of salt"
    ],
    "steps": [
      "Whisk the eggs and egg whites with the soy sauce, turmeric, ginger and salt.",
      "Cook the kale in a pan with the oil until wilted, then set aside.",
      "Pour a thin layer of egg into the pan, add some kale, and roll it up as it sets. Repeat with the rest of the egg and kale, then slice."
    ]
  },
  {
    "id": "chicken-congee-with-egg",
    "image": "kitchen/chicken-congee-with-egg.jpg",
    "credit": "",
    "name": "Chinese Chicken Congee with Egg",
    "category": "Breakfast",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28, "carbs": 20, "fat": 8, "saturatedFat": 3.4, "calories": 265, "sodium": 300,
    "tags": [
      "breakfast",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1/4 cup brown rice",
      "4 cups low-sodium chicken broth",
      "1 chicken breast, diced",
      "3 eggs",
      "1 cup sliced mushrooms",
      "1 cup chopped kale",
      "2 green onions, sliced",
      "1 tsp grated ginger",
      "1/2 tsp turmeric",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Simmer the brown rice and broth in a pot for 35 minutes, stirring often, until thick and creamy.",
      "Add the chicken, mushrooms, kale and ginger and cook 8 minutes more, until the chicken is done.",
      "Stir in the eggs off the heat, then top with green onions, turmeric and lemon juice and serve."
    ]
  },
  {
    "id": "kimchi-egg-scramble",
    "image": "kitchen/kimchi-egg-scramble.jpg",
    "credit": "",
    "name": "Korean Kimchi Egg Scramble",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 23, "carbs": 8, "fat": 12, "saturatedFat": 3.8, "calories": 232, "sodium": 340,
    "tags": [
      "breakfast",
      "high-protein",
      "budget-friendly",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "2 eggs",
      "3 egg whites",
      "1/4 cup kimchi, chopped and rinsed",
      "1 tsp sesame oil",
      "1/2 tsp turmeric",
      "1 tsp grated ginger",
      "1 green onion, sliced"
    ],
    "steps": [
      "Heat the sesame oil in a pan and cook the kimchi for 2 minutes.",
      "Whisk the eggs and egg whites with the turmeric and ginger and pour them into the pan.",
      "Stir gently until the eggs are just set, then top with green onion."
    ]
  },
  {
    "id": "thai-coconut-chia-pudding",
    "image": "kitchen/thai-coconut-chia-pudding.jpg",
    "credit": "",
    "name": "Thai Coconut Chia Pudding",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 24, "carbs": 12, "fat": 8, "saturatedFat": 2.7, "calories": 205, "sodium": 60,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian",
      "gluten-free",
      "low-sodium"
    ],
    "ingredients": [
      "3 tbsp chia seeds",
      "6 tbsp light coconut milk",
      "1 cup plain Greek yogurt",
      "1/2 cup blueberries, diced",
      "2 tbsp water"
    ],
    "steps": [
      "Stir the chia seeds, coconut milk, water and yogurt together in a jar.",
      "Chill in the fridge for at least 4 hours or overnight.",
      "Top with blueberries and serve."
    ]
  },
  {
    "id": "vietnamese-chicken-and-herb-omelet",
    "image": "kitchen/vietnamese-chicken-and-herb-omelet.jpg",
    "credit": "",
    "name": "Vietnamese Chicken and Herb Omelet",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 25, "carbs": 7, "fat": 12, "saturatedFat": 4.5, "calories": 235, "sodium": 300,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "2 eggs",
      "1/2 cup cooked chicken, shredded",
      "1/2 cup broccoli, chopped",
      "1/4 cup chopped fresh herbs (cilantro, mint, basil)",
      "1 tsp fish sauce",
      "1 tsp olive oil"
    ],
    "steps": [
      "Whisk the eggs with the fish sauce.",
      "Cook the chicken, broccoli and herbs in a pan with the oil for 2 minutes.",
      "Pour in the eggs and cook until set, then fold in half and serve."
    ]
  },
  {
    "id": "miso-salmon-rice-bowl",
    "image": "kitchen/miso-salmon-rice-bowl.jpg",
    "credit": "",
    "name": "Japanese Miso Salmon Rice Bowl",
    "category": "Lunch",
    "time": 20,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 32, "carbs": 20, "fat": 12, "saturatedFat": 2.5, "calories": 315, "sodium": 450,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "balanced-macros"
    ],
    "ingredients": [
      "1 salmon fillet",
      "1/2 tbsp white miso paste",
      "1 tbsp lemon juice",
      "1/2 cup cooked brown rice",
      "1/2 cup shelled edamame",
      "1 cup steamed broccoli",
      "1 green onion, sliced",
      "1 tsp sesame seeds"
    ],
    "steps": [
      "Mix the miso with half the lemon juice, spread over the salmon and bake at 400°F for 12 minutes.",
      "Spoon the brown rice into a bowl and top with the edamame and broccoli.",
      "Flake the salmon over the bowl and finish with green onion, sesame seeds and remaining lemon juice."
    ]
  },
  {
    "id": "chicken-and-cucumber-salad",
    "image": "kitchen/chicken-and-cucumber-salad.jpg",
    "credit": "",
    "name": "Chinese Chicken and Cucumber Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 30, "carbs": 11, "fat": 12, "saturatedFat": 2.5, "calories": 275, "sodium": 250,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "2 cups cooked chicken, shredded",
      "2 cucumbers, sliced thin",
      "1 carrot, grated",
      "1 tbsp rice vinegar",
      "1 tbsp sesame oil",
      "1 tsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame seeds"
    ],
    "steps": [
      "Toss the chicken, cucumber and carrot together in a bowl.",
      "Whisk the vinegar, sesame oil and soy sauce, then pour over the salad.",
      "Sprinkle with sesame seeds and serve chilled."
    ]
  },
  {
    "id": "green-papaya-chicken-salad",
    "image": "kitchen/green-papaya-chicken-salad.jpg",
    "credit": "",
    "name": "Thai Green Papaya Chicken Salad",
    "category": "Lunch",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28, "carbs": 14, "fat": 10, "saturatedFat": 1.5, "calories": 261, "sodium": 350,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "2 cups shredded green papaya",
      "2 cups cooked chicken, shredded",
      "1 carrot, grated",
      "1/2 cup cherry tomatoes, halved",
      "Juice of 1 lime",
      "1 tbsp fish sauce",
      "1/4 cup fresh cilantro"
    ],
    "steps": [
      "Toss the papaya, chicken, carrot and tomatoes in a large bowl.",
      "Whisk the lime juice and fish sauce and pour over the salad.",
      "Top with cilantro and serve."
    ]
  },
  {
    "id": "chicken-pho",
    "image": "kitchen/chicken-pho.jpg",
    "credit": "",
    "name": "Vietnamese Chicken Pho",
    "category": "Lunch",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 31, "carbs": 21, "fat": 6, "saturatedFat": 1, "calories": 265, "sodium": 520,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "2 chicken breasts",
      "4 cups low-sodium chicken broth",
      "2 cups water",
      "2 oz brown-rice noodles",
      "1 onion, halved",
      "1 cup shredded carrots",
      "2 tsp fish sauce",
      "2 cups bean sprouts",
      "1/4 cup fresh cilantro and basil",
      "1 lime, cut into wedges"
    ],
    "steps": [
      "Simmer the broth and water with the onion and chicken for 20 minutes, then lift out the chicken and slice it.",
      "Cook the noodles in the broth as directed, then return the chicken to the pot with the fish sauce and carrots.",
      "Ladle into bowls and top with bean sprouts, herbs and lime."
    ]
  },
  {
    "id": "chicken-bibimbap-bowl",
    "image": "kitchen/chicken-bibimbap-bowl.jpg",
    "credit": "",
    "name": "Korean Chicken Bibimbap Bowl",
    "category": "Lunch",
    "time": 25,
    "difficulty": "Medium",
    "servings": 2,
    "protein": 30, "carbs": 18, "fat": 12, "saturatedFat": 3, "calories": 300, "sodium": 400,
    "tags": [
      "lunch",
      "high-protein",
      "balanced-macros",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "2 chicken breasts, sliced thin",
      "1 cup cooked brown rice",
      "2 eggs",
      "1 cup shredded carrots",
      "1 cup shredded zucchini",
      "1 cup kale, chopped",
      "1/2 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame oil",
      "1/2 tsp smoked paprika",
      "2 tsp gluten-free gochujang, on the side"
    ],
    "steps": [
      "Cook the chicken in a pan with the soy sauce, sesame oil and smoked paprika until done, about 8 minutes.",
      "Wilt the kale, cook the carrots and zucchini for 2 minutes, and fry the eggs.",
      "Build each bowl with brown rice, chicken, vegetables and a fried egg, and serve with gochujang on the side."
    ]
  },
  {
    "id": "teriyaki-salmon",
    "image": "kitchen/teriyaki-salmon.jpg",
    "credit": "",
    "name": "Japanese Teriyaki Salmon",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 32, "carbs": 12, "fat": 14, "saturatedFat": 2, "calories": 300, "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "balanced-macros"
    ],
    "ingredients": [
      "2 salmon fillets",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp grated ginger",
      "2 cloves garlic, minced",
      "Juice of 1 lime",
      "1/2 cup cooked brown rice",
      "2 cups steamed broccoli"
    ],
    "steps": [
      "Mix the soy sauce, ginger, garlic and lime juice, and brush it over the salmon.",
      "Pan-sear the salmon 4 minutes per side, brushing with more sauce as it cooks.",
      "Serve with brown rice and broccoli."
    ]
  },
  {
    "id": "chicken-yakitori-skewers",
    "image": "kitchen/chicken-yakitori-skewers.jpg",
    "credit": "",
    "name": "Japanese Chicken Yakitori Skewers",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Medium",
    "servings": 2,
    "protein": 32, "carbs": 7, "fat": 10, "saturatedFat": 2, "calories": 244, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb chicken breast, cut into chunks",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp grated ginger",
      "2 cloves garlic, minced",
      "Juice of 1 lime",
      "4 green onions, cut into pieces",
      "1 cup broccoli florets",
      "Wooden skewers, soaked in water"
    ],
    "steps": [
      "Mix the soy sauce, ginger, garlic and lime juice, and marinate the chicken for 15 minutes.",
      "Thread the chicken and green onion pieces onto the skewers.",
      "Grill or broil 10 to 12 minutes, turning and brushing with the marinade, until cooked through. Grill the broccoli alongside for the last 6 minutes."
    ]
  },
  {
    "id": "garlic-shrimp-stir-fry",
    "image": "kitchen/garlic-shrimp-stir-fry.jpg",
    "credit": "",
    "name": "Chinese Garlic Shrimp Stir-Fry",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 30, "carbs": 16, "fat": 10, "saturatedFat": 1.3, "calories": 272, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb shrimp, peeled",
      "4 cloves garlic, minced",
      "2 cups snap peas",
      "1 cup broccoli florets",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tbsp sesame oil",
      "1 tsp grated ginger"
    ],
    "steps": [
      "Heat the sesame oil in a large pan and cook the garlic and ginger for 1 minute.",
      "Add the shrimp, snap peas and broccoli and cook 4 minutes, until the shrimp turn pink.",
      "Stir in the soy sauce and serve."
    ]
  },
  {
    "id": "beef-and-broccoli",
    "image": "kitchen/beef-and-broccoli.jpg",
    "credit": "",
    "name": "Chinese Beef and Broccoli",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 30, "carbs": 13, "fat": 12, "saturatedFat": 4.1, "calories": 275, "sodium": 480,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "3/4 lb flank steak, sliced thin",
      "3 cups broccoli florets",
      "1 cup sliced mushrooms",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame oil",
      "2 cloves garlic, minced",
      "Juice of 1 lime",
      "1 tsp grated ginger"
    ],
    "steps": [
      "Sear the beef in a hot pan with the sesame oil for 3 minutes, then set aside.",
      "Cook the mushrooms until golden, then the broccoli and garlic in the same pan for 4 minutes.",
      "Return the beef to the pan, add the soy sauce, lime juice and ginger, and toss for 1 minute."
    ]
  },
  {
    "id": "thai-basil-chicken-with-peppers",
    "image": "kitchen/thai-basil-chicken-with-peppers.jpg",
    "credit": "",
    "name": "Thai Basil Chicken with Peppers",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 31, "carbs": 15, "fat": 12, "saturatedFat": 2, "calories": 296, "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb chicken breast, sliced thin",
      "2 bell peppers, sliced",
      "1/2 cup broccoli florets",
      "1 cup fresh basil leaves",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp fish sauce",
      "1 tbsp olive oil",
      "2 cloves garlic, minced"
    ],
    "steps": [
      "Heat the oil in a pan and cook the garlic for 1 minute.",
      "Add the chicken, peppers and broccoli and cook 8 minutes, until the chicken is done.",
      "Stir in the soy sauce, fish sauce and basil until the basil wilts, then serve."
    ]
  },
  {
    "id": "thai-red-curry-with-tofu",
    "image": "kitchen/thai-red-curry-with-tofu.jpg",
    "credit": "",
    "name": "Thai Red Curry with Tofu",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28, "carbs": 21, "fat": 11, "saturatedFat": 2.5, "calories": 280, "sodium": 380,
    "tags": [
      "dinner",
      "high-protein",
      "vegetarian",
      "vegan",
      "gluten-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1 1/2 blocks firm tofu, cubed",
      "1/4 can light coconut milk",
      "2 cups low-sodium vegetable broth",
      "1 tbsp red curry paste",
      "2 cups mixed vegetables (bell pepper, zucchini, green beans)",
      "1 cup cauliflower florets",
      "1 tbsp fish sauce or gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1/4 cup fresh basil",
      "1 tbsp lime juice"
    ],
    "steps": [
      "Simmer the coconut milk, broth and curry paste in a pot for 2 minutes.",
      "Add the tofu, vegetables and cauliflower and cook 10 minutes, until tender.",
      "Stir in the sauce, lime juice and basil, then serve."
    ]
  },
  {
    "id": "vietnamese-lemongrass-chicken",
    "image": "kitchen/vietnamese-lemongrass-chicken.jpg",
    "credit": "",
    "name": "Vietnamese Lemongrass Chicken",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Medium",
    "servings": 2,
    "protein": 32, "carbs": 14, "fat": 12, "saturatedFat": 3, "calories": 285, "sodium": 400,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb chicken breast, sliced",
      "2 stalks lemongrass, minced",
      "1 tbsp fish sauce",
      "2 cloves garlic, minced",
      "1 tbsp olive oil",
      "1 cup cooked brown rice",
      "1 cup steamed broccoli, for serving"
    ],
    "steps": [
      "Mix the lemongrass, fish sauce and garlic, and marinate the chicken for 15 minutes.",
      "Cook the chicken in a pan with the oil for 10 minutes, until browned and cooked through.",
      "Serve over brown rice with the broccoli on the side."
    ]
  },
  {
    "id": "vietnamese-shrimp-and-vegetable-stir-fry",
    "image": "kitchen/vietnamese-shrimp-and-vegetable-stir-fry.jpg",
    "credit": "",
    "name": "Vietnamese Shrimp and Vegetable Stir-Fry",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 27, "carbs": 14, "fat": 14, "saturatedFat": 1.3, "calories": 279, "sodium": 520,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb shrimp, peeled",
      "2 cups mixed vegetables (carrots, bell pepper, snap peas)",
      "2 tsp fish sauce",
      "2 tsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tbsp sesame oil",
      "1 tbsp ground flaxseed",
      "Juice of 1 lime"
    ],
    "steps": [
      "Heat the sesame oil in a large pan and cook the vegetables for 3 minutes.",
      "Add the shrimp and cook 4 minutes, until pink.",
      "Stir in the fish sauce, soy sauce, lime juice and flaxseed, then serve."
    ]
  },
  {
    "id": "korean-bulgogi-beef",
    "image": "kitchen/korean-bulgogi-beef.jpg",
    "credit": "",
    "name": "Korean Bulgogi Beef",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Medium",
    "servings": 2,
    "protein": 32, "carbs": 18, "fat": 9, "saturatedFat": 4, "calories": 280, "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "3/4 lb sirloin, sliced very thin",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame oil",
      "2 cloves garlic, minced",
      "1 tsp grated ginger",
      "Juice of 1 lime",
      "1/2 onion, sliced thin",
      "1 tsp sesame seeds",
      "1 cup cooked brown rice",
      "1 cup steamed broccoli, for serving"
    ],
    "steps": [
      "Mix the soy sauce, sesame oil, garlic, ginger and lime juice, and marinate the beef and onion for 15 minutes.",
      "Cook in a hot pan for 5 minutes, until browned.",
      "Sprinkle with sesame seeds and serve over brown rice with the broccoli on the side."
    ]
  },
  {
    "id": "sundubu-tofu-stew",
    "image": "kitchen/sundubu-tofu-stew.jpg",
    "credit": "",
    "name": "Korean Sundubu Tofu Stew",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 21, "carbs": 12, "fat": 12, "saturatedFat": 3.2, "calories": 238, "sodium": 400,
    "tags": [
      "dinner",
      "high-protein",
      "vegetarian",
      "gluten-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1 block soft tofu",
      "2 cups low-sodium vegetable broth",
      "1/4 cup kimchi, chopped and rinsed",
      "1 cup chopped kale",
      "2 eggs",
      "2 tsp gluten-free gochujang",
      "1/2 tsp smoked paprika",
      "1 tsp sesame oil",
      "1 green onion, sliced"
    ],
    "steps": [
      "Simmer the broth, kimchi, gochujang and smoked paprika in a pot for 5 minutes.",
      "Gently add the tofu in large spoonfuls and the kale and cook 5 minutes more.",
      "Crack the eggs into the stew, cover for 2 minutes, then top with sesame oil and green onion."
    ]
  },
  {
    "id": "cucumber-sesame-salad",
    "image": "kitchen/cucumber-sesame-salad.jpg",
    "credit": "",
    "name": "Japanese Cucumber Sesame Salad",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 16, "carbs": 19, "fat": 12, "saturatedFat": 0.8, "calories": 235, "sodium": 200,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "vegan",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "2 cucumbers, sliced thin",
      "1 cup shelled edamame",
      "1/2 cup cherry tomatoes, halved",
      "1 tbsp sweet rice vinegar (unsweetened)",
      "1 tsp grated carrot",
      "1 tsp sesame oil",
      "1 tsp sesame seeds",
      "1 tbsp pumpkin seeds",
      "Pinch of salt"
    ],
    "steps": [
      "Toss the cucumber, edamame and tomatoes in a bowl.",
      "Whisk the vinegar, carrot, sesame oil and salt, and pour over the salad.",
      "Chill 10 minutes, then sprinkle with sesame seeds and pumpkin seeds."
    ]
  },
{
    "id": "kimchi-tofu-bites",
    "image": "kitchen/kimchi-tofu-bites.jpg",
    "credit": "",
    "name": "Korean Kimchi Tofu Bites",
    "category": "Snacks",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 12,
    "carbs": 6,
    "fat": 8,
    "saturatedFat": 1.6,
    "calories": 144,
    "sodium": 390,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "vegetarian",
      "vegan",
      "gluten-free"
    ],
    "ingredients": [
      "1 block firm tofu, cut into cubes",
      "1/4 cup kimchi, chopped and rinsed",
      "1 tbsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame oil",
      "1 tsp sesame seeds"
    ],
    "steps": [
      "Pan-fry the tofu cubes in the sesame oil for 6 minutes, turning until golden on all sides.",
      "Add the kimchi and soy sauce and cook 2 minutes more.",
      "Serve warm, sprinkled with sesame seeds."
    ]
  },
  {
    "id": "mushroom-and-tofu-soup",
    "image": "kitchen/mushroom-and-tofu-soup.jpg",
    "credit": "",
    "name": "Japanese Mushroom and Tofu Soup",
    "category": "Light Meals",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 13, "carbs": 10, "fat": 6, "saturatedFat": 0.6, "calories": 144, "sodium": 440,
    "tags": [
      "small-portions",
      "high-protein",
      "vegan",
      "vegetarian",
      "gluten-free"
    ],
    "ingredients": [
      "2 cups sliced mushrooms",
      "1/2 block firm tofu, cubed",
      "1 cup chopped kale",
      "2 cups low-sodium vegetable broth",
      "2 cups water",
      "1 tbsp white miso paste",
      "1 green onion, sliced",
      "1 tsp grated ginger",
      "1 tsp lemon juice"
    ],
    "steps": [
      "Simmer the mushrooms, kale and ginger in the broth and water for 10 minutes.",
      "Add the tofu and cook 3 minutes more.",
      "Stir in the miso and lemon juice until dissolved, then top with green onion."
    ]
  },
  {
    "id": "egg-drop-soup",
    "image": "kitchen/egg-drop-soup.jpg",
    "credit": "",
    "name": "Chinese Egg Drop Soup",
    "category": "Light Meals",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 17, "carbs": 9, "fat": 7, "saturatedFat": 2, "calories": 165, "sodium": 450,
    "tags": [
      "small-portions",
      "high-protein",
      "budget-friendly",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "3 cups low-sodium chicken broth",
      "1 cup water",
      "2 eggs, beaten",
      "1/2 block firm tofu, cubed",
      "1/2 cup shredded carrots",
      "2 tsp gluten-free low-sodium soy sauce (low-sodium tamari)",
      "1 tsp sesame oil",
      "1 tsp grated ginger",
      "1/2 tsp turmeric",
      "1 green onion, sliced",
      "1 tsp cornstarch mixed with 2 tbsp water"
    ],
    "steps": [
      "Bring the broth and water to a gentle simmer and stir in the soy sauce, tofu, carrots, ginger, turmeric and cornstarch mixture.",
      "Slowly pour in the beaten eggs while stirring, so they form thin ribbons.",
      "Finish with sesame oil and green onion."
    ]
  },
  {
    "id": "chicken-coconut-soup",
    "image": "kitchen/chicken-coconut-soup.jpg",
    "credit": "",
    "name": "Thai Chicken Coconut Soup",
    "category": "Light Meals",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 23, "carbs": 13, "fat": 7, "saturatedFat": 3.5, "calories": 208, "sodium": 480,
    "tags": [
      "small-portions",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "2 chicken breasts, sliced thin",
      "1/2 can light coconut milk",
      "2 cups low-sodium chicken broth",
      "1 cup water",
      "1 cup sliced mushrooms",
      "1 cup cauliflower florets",
      "Juice of 1 lime",
      "2 tsp fish sauce",
      "1/4 cup fresh cilantro"
    ],
    "steps": [
      "Simmer the coconut milk, broth and water in a pot for 5 minutes.",
      "Add the chicken, mushrooms and cauliflower and cook 8 minutes, until the chicken is done.",
      "Stir in the lime juice and fish sauce, then top with cilantro."
    ]
  },
  {
    "id": "provencal-herb-omelet",
    "image": "kitchen/provencal-herb-omelet.jpg",
    "credit": "",
    "name": "Provençal Herb Omelet",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22, "carbs": 7, "fat": 10, "saturatedFat": 4.6, "calories": 205, "sodium": 200,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "1 large egg plus 2 egg whites",
      "1/2 cup broccoli, chopped",
      "1 tbsp chopped fresh herbs (parsley, chives, tarragon)",
      "1/2 oz goat cheese, crumbled",
      "1 tsp olive oil",
      "Salt and black pepper"
    ],
    "steps": [
      "Whisk the egg and egg whites with the herbs, salt, and pepper.",
      "Warm the olive oil in a small pan over medium heat and soften the broccoli for 2 minutes.",
      "Pour in the eggs and cook gently, lifting the edges as they set.",
      "Sprinkle the goat cheese over the top and fold the omelet in half.",
      "Slide onto a plate and serve right away."
    ]
  },
  {
    "id": "riviera-yogurt-bowl-lavender-honey",
    "image": "kitchen/riviera-yogurt-bowl-lavender-honey.jpg",
    "credit": "",
    "name": "Riviera Yogurt Bowl with Lavender",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 21, "carbs": 20, "fat": 10, "saturatedFat": 1.5, "calories": 242, "sodium": 70,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "gluten-free",
      "vegetarian",
      "low-sodium"
    ],
    "ingredients": [
      "1 cup plain Greek yogurt",
      "1/2 cup mixed berries",
      "1 tbsp sliced pistachios",
      "1 tbsp ground flaxseed",
      "1 tsp honey",
      "1 pinch dried culinary lavender"
    ],
    "steps": [
      "Scoop the yogurt into a bowl.",
      "Top with the berries.",
      "Drizzle with honey, sprinkle the pistachios, flaxseed and lavender over the top."
    ]
  },
  {
    "id": "nicoise-breakfast-toast",
    "image": "kitchen/nicoise-breakfast-toast.jpg",
    "credit": "",
    "name": "Niçoise Breakfast Toast",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 25, "carbs": 19, "fat": 17, "saturatedFat": 3.9, "calories": 320, "sodium": 300,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "vegetarian"
    ],
    "ingredients": [
      "1 small slice whole-grain bread",
      "1 tbsp olive tapenade",
      "2 hard-boiled eggs, sliced",
      "2 tsp ground flaxseed",
      "2 tomato slices",
      "2 fresh basil leaves"
    ],
    "steps": [
      "Toast the bread until golden.",
      "Spread the tapenade over the toast.",
      "Lay the egg slices and tomato on top.",
      "Sprinkle the flaxseed over the eggs, tear the basil over the top and serve."
    ]
  },
  {
    "id": "pistou-breakfast-scramble",
    "image": "kitchen/pistou-breakfast-scramble.jpg",
    "credit": "",
    "name": "Pistou Breakfast Scramble",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22, "carbs": 9, "fat": 11, "saturatedFat": 4.2, "calories": 222, "sodium": 200,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "gluten-free",
      "vegetarian"
    ],
    "ingredients": [
      "2 large eggs",
      "1 tbsp basil pistou",
      "1/2 cup cherry tomatoes, halved",
      "1/2 cup broccoli, chopped",
      "1 tsp olive oil",
      "Salt and black pepper"
    ],
    "steps": [
      "Whisk the eggs with the pistou, salt, and pepper.",
      "Warm the olive oil in a pan over medium heat and soften the tomatoes and broccoli for 2 minutes.",
      "Pour in the eggs and scramble gently until just set.",
      "Serve right away."
    ]
  },
  {
    "id": "fig-almond-overnight-oats",
    "image": "kitchen/fig-almond-overnight-oats.jpg",
    "credit": "",
    "name": "Fig & Pistachio Overnight Oats",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 24, "carbs": 16, "fat": 14, "saturatedFat": 1.5, "calories": 275, "sodium": 90,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "vegetarian",
      "budget-friendly",
      "low-sodium"
    ],
    "ingredients": [
      "1/3 cup rolled oats",
      "1/2 cup milk or oat milk",
      "1 dried fig, chopped",
      "1/2 cup plain Greek yogurt",
      "1 tbsp sliced pistachios",
      "1 tsp pumpkin seeds",
      "1 tbsp ground flaxseed"
    ],
    "steps": [
      "Stir the oats, milk, yogurt and flaxseed together in a jar or bowl.",
      "Stir in the fig, pistachios and pumpkin seeds.",
      "Cover and refrigerate overnight."
    ]
  },
  {
    "id": "salade-nicoise-grilled-tuna",
    "image": "kitchen/salade-nicoise-grilled-tuna.jpg",
    "credit": "",
    "name": "Salade Niçoise with Grilled Tuna",
    "category": "Lunch",
    "time": 20,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 33, "carbs": 20, "fat": 14, "saturatedFat": 4.6, "calories": 335, "sodium": 300,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "4 oz tuna steak",
      "1 hard-boiled egg, halved",
      "1 cup green beans, steamed",
      "1 small potato, peeled, boiled and sliced",
      "5 Niçoise olives",
      "1 cup lettuce leaves",
      "1/2 cup chopped kale",
      "1 tbsp olive oil",
      "1 tsp lemon juice"
    ],
    "steps": [
      "Grill the tuna for 2 to 3 minutes per side and slice it.",
      "Arrange the lettuce and kale on a plate.",
      "Top with the tuna, egg, green beans, potato, and olives.",
      "Drizzle with olive oil and lemon juice."
    ]
  },
  {
    "id": "ratatouille-white-bean-bowl",
    "image": "kitchen/ratatouille-white-bean-bowl.jpg",
    "credit": "",
    "name": "Ratatouille and White Bean Bowl",
    "category": "Lunch",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 23, "carbs": 22, "fat": 17, "saturatedFat": 3.1, "calories": 322, "sodium": 250,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "vegetarian",
      "gluten-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1 eggplant, diced",
      "2 zucchini, sliced",
      "1 bell pepper, diced",
      "1/2 can white beans, drained",
      "1 can diced tomatoes",
      "2 cloves garlic, minced",
      "1 tbsp olive oil",
      "1 tsp herbes de Provence",
      "2 hard-boiled eggs, halved",
      "1/2 cup plain Greek yogurt",
      "1 tbsp ground flaxseed"
    ],
    "steps": [
      "Warm the olive oil in a large pan over medium heat.",
      "Add the eggplant, zucchini, and pepper and cook for 8 minutes.",
      "Stir in the garlic, tomatoes, beans, and herbs.",
      "Simmer for 15 minutes until the vegetables are soft.",
      "Serve warm in bowls, topped with a halved egg, a dollop of yogurt and the flaxseed."
    ]
  },
{
    "id": "provencal-chicken-olive-salad",
    "image": "kitchen/provencal-chicken-olive-salad.jpg",
    "credit": "",
    "name": "Provençal Chicken and Olive Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 30,
    "carbs": 8,
    "fat": 12,
    "saturatedFat": 3.5,
    "calories": 260,
    "sodium": 340,
    "tags": [
      "lunch",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "4 oz cooked chicken breast, sliced",
      "1 cup mixed greens",
      "8 green olives, halved",
      "1/2 cup cherry tomatoes, halved",
      "1 tbsp olive oil",
      "1 tsp lemon juice",
      "1 tsp chopped fresh basil"
    ],
    "steps": [
      "Put the greens in a bowl.",
      "Top with the chicken, olives, and tomatoes.",
      "Drizzle with olive oil and lemon juice.",
      "Sprinkle the basil over the top."
    ]
  },
{
    "id": "grilled-vegetable-goat-cheese-tartine",
    "image": "kitchen/grilled-vegetable-goat-cheese-tartine.jpg",
    "credit": "",
    "name": "Grilled Vegetable and Goat Cheese Tartine",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 22,
    "carbs": 19,
    "fat": 12,
    "saturatedFat": 4.8,
    "calories": 272,
    "sodium": 240,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "vegetarian",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 slice whole-grain bread",
      "1/2 cup grilled zucchini and bell pepper",
      "1/2 oz goat cheese",
      "1 hard-boiled egg and 1 hard-boiled egg white, sliced",
      "4 fresh basil leaves",
      "1 tsp olive oil"
    ],
    "steps": [
      "Toast the bread until golden.",
      "Pile the grilled vegetables on the toast.",
      "Crumble the goat cheese over the top.",
      "Lay the egg slices on top.",
      "Drizzle with olive oil and add the basil."
    ]
  },
{
    "id": "lentil-herb-salad-provencal",
    "image": "kitchen/lentil-herb-salad-provencal.jpg",
    "credit": "",
    "name": "Lentil and Herb Salad Provençal",
    "category": "Lunch",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 21,
    "carbs": 20,
    "fat": 12,
    "saturatedFat": 2.9,
    "calories": 272,
    "sodium": 240,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "vegetarian",
      "gluten-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1/3 cup green lentils",
      "1 cup cherry tomatoes, halved",
      "1 cucumber, diced",
      "1/4 red onion, finely diced",
      "1/4 cup chopped parsley and basil",
      "2 hard-boiled eggs, halved",
      "2 hard-boiled egg whites, halved",
      "1/2 cup plain Greek yogurt",
      "1 tbsp olive oil",
      "1 tbsp lemon juice",
      "Salt and black pepper"
    ],
    "steps": [
      "Simmer the lentils in water for 20 minutes until tender, then drain and cool.",
      "Toss the lentils with the tomatoes, cucumber, onion, and herbs.",
      "Top with the egg halves and egg whites.",
      "Whisk the yogurt with the olive oil and lemon juice and spoon over the top.",
      "Season with salt and pepper and serve."
    ]
  },
  {
    "id": "bouillabaisse-light",
    "image": "kitchen/bouillabaisse-light.jpg",
    "credit": "",
    "name": "Bouillabaisse (Light Fish Stew)",
    "category": "Dinner",
    "time": 35,
    "difficulty": "Medium",
    "servings": 4,
    "protein": 32, "carbs": 12, "fat": 9, "saturatedFat": 0.5, "calories": 257, "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "1 lb white fish fillets, cut into chunks",
      "1/2 lb shrimp, peeled",
      "1 can diced tomatoes",
      "1 pinch saffron threads",
      "1 fennel bulb, sliced",
      "2 cloves garlic, minced",
      "4 cups low-sodium fish or vegetable stock",
      "1 strip orange peel",
      "1 tbsp lemon juice"
    ],
    "steps": [
      "Simmer the stock with the saffron, fennel, garlic, and orange peel for 10 minutes.",
      "Stir in the tomatoes and simmer for 5 minutes.",
      "Add the fish and shrimp and cook gently for 8 minutes.",
      "Ladle into bowls, stir in lemon juice and serve."
    ]
  },
{
    "id": "herb-roasted-chicken-provencal",
    "image": "kitchen/herb-roasted-chicken-provencal.jpg",
    "credit": "",
    "name": "Herb-Roasted Chicken Provençal",
    "category": "Dinner",
    "time": 45,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 35,
    "carbs": 6,
    "fat": 12,
    "saturatedFat": 2.0,
    "calories": 272,
    "sodium": 270,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "4 chicken breasts",
      "2 tsp herbes de Provence",
      "1 lemon, sliced",
      "2 cloves garlic, minced",
      "12 green olives",
      "1 tbsp olive oil",
      "Salt and black pepper"
    ],
    "steps": [
      "Heat the oven to 400°F.",
      "Rub the chicken with olive oil, herbs, garlic, salt, and pepper.",
      "Place in a baking dish with the lemon slices and olives.",
      "Roast for 30 to 35 minutes until cooked through."
    ]
  },
  {
    "id": "grilled-sea-bass-lemon-herbs",
    "image": "kitchen/grilled-sea-bass-lemon-herbs.jpg",
    "credit": "",
    "name": "Grilled Sea Bass with Lemon and Herbs",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 36, "carbs": 10, "fat": 14, "saturatedFat": 1.5, "calories": 300, "sodium": 200,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "2 sea bass fillets",
      "1 lemon, half juiced and half sliced",
      "1 tbsp chopped fresh herbs (parsley, thyme)",
      "1 tbsp olive oil",
      "1 cup steamed broccoli, for serving",
      "1 tbsp ground flaxseed",
      "Salt and black pepper"
    ],
    "steps": [
      "Rub the fillets with olive oil, salt, and pepper.",
      "Grill for 3 to 4 minutes per side until the fish flakes.",
      "Squeeze the lemon juice over the top.",
      "Sprinkle with herbs and serve with lemon slices and the broccoli, with the flaxseed over the broccoli."
    ]
  },
{
    "id": "baked-cod-with-ratatouille",
    "image": "kitchen/baked-cod-with-ratatouille.jpg",
    "credit": "",
    "name": "Baked Cod with Ratatouille",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 30,
    "carbs": 14,
    "fat": 8,
    "saturatedFat": 1.5,
    "calories": 248,
    "sodium": 240,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "2 cod fillets",
      "2 cups ratatouille (eggplant, zucchini, pepper, tomato)",
      "1 tbsp olive oil",
      "1 tsp herbes de Provence",
      "Salt and black pepper"
    ],
    "steps": [
      "Heat the oven to 400°F.",
      "Place the cod in a baking dish and season with salt, pepper, and herbs.",
      "Spoon the ratatouille around the fish and drizzle with olive oil.",
      "Bake for 18 to 20 minutes until the fish flakes."
    ]
  },
  {
    "id": "provencal-beef-daube-light",
    "image": "kitchen/provencal-beef-daube-light.jpg",
    "credit": "",
    "name": "Provençal Beef Daube (Light)",
    "category": "Dinner",
    "time": 120,
    "difficulty": "Medium",
    "servings": 4,
    "protein": 32, "carbs": 14, "fat": 11, "saturatedFat": 4.5, "calories": 283, "sodium": 450,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free"
    ],
    "ingredients": [
      "1 lb lean beef stew meat",
      "1 can diced tomatoes",
      "12 black olives",
      "2 cloves garlic, minced",
      "1 tsp herbes de Provence",
      "1 cup low-sodium beef stock",
      "1 tbsp olive oil"
    ],
    "steps": [
      "Warm the olive oil in a pot and brown the beef on all sides.",
      "Add the garlic, tomatoes, olives, herbs, and stock.",
      "Cover and braise on low heat for 1 hour 30 minutes until tender.",
      "Serve in bowls with the sauce."
    ]
  },
{
    "id": "grilled-shrimp-garlic-herbs",
    "image": "kitchen/grilled-shrimp-garlic-herbs.jpg",
    "credit": "",
    "name": "Grilled Shrimp with Garlic and Herbs",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 28,
    "carbs": 5,
    "fat": 9,
    "saturatedFat": 1.3,
    "calories": 213,
    "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 lb large shrimp, peeled",
      "2 cloves garlic, minced",
      "1 tbsp chopped parsley",
      "1 tbsp olive oil",
      "1 tsp lemon juice",
      "Salt and black pepper"
    ],
    "steps": [
      "Toss the shrimp with garlic, parsley, olive oil, salt, and pepper.",
      "Grill for 2 minutes per side until pink.",
      "Squeeze the lemon juice over the top and serve."
    ]
  },
{
    "id": "baked-salmon-olive-tapenade",
    "image": "kitchen/baked-salmon-olive-tapenade.jpg",
    "credit": "",
    "name": "Baked Salmon with Olive Tapenade",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 32,
    "carbs": 4,
    "fat": 14,
    "saturatedFat": 2.3,
    "calories": 270,
    "sodium": 370,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "2 salmon fillets",
      "2 tbsp olive tapenade",
      "1 lemon, sliced",
      "1 tbsp chopped parsley",
      "Salt and black pepper"
    ],
    "steps": [
      "Heat the oven to 400°F.",
      "Season the salmon with salt and pepper and place in a baking dish.",
      "Spread the tapenade over each fillet and add the lemon slices.",
      "Bake for 12 to 14 minutes until the salmon flakes."
    ]
  },
{
    "id": "chicken-olives-lemon-provencal",
    "image": "kitchen/chicken-olives-lemon-provencal.jpg",
    "credit": "",
    "name": "Chicken with Olives and Lemon",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 33,
    "carbs": 7,
    "fat": 12,
    "saturatedFat": 2.5,
    "calories": 268,
    "sodium": 420,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "low-carb"
    ],
    "ingredients": [
      "2 chicken breasts",
      "12 green olives",
      "1 lemon, sliced",
      "2 cloves garlic, minced",
      "1 tsp herbes de Provence",
      "1 tbsp olive oil",
      "Salt and black pepper"
    ],
    "steps": [
      "Season the chicken with salt, pepper, and herbs.",
      "Sear in olive oil over medium-high heat for 4 minutes per side.",
      "Add the garlic, olives, and lemon slices.",
      "Cover and cook on low for 12 minutes until cooked through."
    ]
  },
  {
    "id": "vegetable-tian-provencal",
    "image": "kitchen/vegetable-tian-provencal.jpg",
    "credit": "",
    "name": "Vegetable Tian Provençal",
    "category": "Dinner",
    "time": 45,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 19, "carbs": 20, "fat": 12, "saturatedFat": 3, "calories": 260, "sodium": 300,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "vegetarian",
      "gluten-free"
    ],
    "ingredients": [
      "1 zucchini, sliced",
      "1 eggplant, sliced",
      "1 tomato, sliced",
      "1/2 onion, sliced",
      "1 oz Gruyère cheese, grated",
      "1 tsp herbes de Provence",
      "1 tbsp olive oil",
      "1 tsp lemon zest",
      "4 poached eggs"
    ],
    "steps": [
      "Heat the oven to 375°F.",
      "Layer the sliced vegetables upright in a baking dish, alternating them.",
      "Sprinkle with cheese, herbs, lemon zest, and olive oil.",
      "Bake for 35 minutes until tender and golden.",
      "Top each serving with a poached egg."
    ]
  },
{
    "id": "turkey-white-bean-cassoulet-light",
    "image": "kitchen/turkey-white-bean-cassoulet-light.jpg",
    "credit": "",
    "name": "Turkey and White Bean Cassoulet (Light)",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 26,
    "carbs": 16,
    "fat": 8,
    "saturatedFat": 2.5,
    "calories": 240,
    "sodium": 350,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1 lb ground turkey",
      "1 can white beans, drained",
      "1 zucchini, diced",
      "1 bell pepper, diced",
      "1 can diced tomatoes",
      "2 cloves garlic, minced",
      "1 tsp herbes de Provence",
      "1 tbsp olive oil",
      "Salt and black pepper"
    ],
    "steps": [
      "Brown the turkey in olive oil over medium heat, breaking it up.",
      "Stir in the garlic, tomatoes, beans, zucchini, and bell pepper.",
      "Season with salt and pepper.",
      "Simmer for 20 minutes and serve."
    ]
  },
  {
    "id": "olive-tapenade-cucumber-slices",
    "image": "kitchen/olive-tapenade-cucumber-slices.jpg",
    "credit": "",
    "name": "Olive Tapenade with Cucumber Slices",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 13, "carbs": 10, "fat": 9, "saturatedFat": 1.8, "calories": 170, "sodium": 420,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "vegetarian",
      "gluten-free",
      "low-carb",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 cup pitted black olives",
      "1/2 cup roasted red peppers",
      "2 tsp capers",
      "1 clove garlic",
      "1 tsp lemon juice",
      "1 tbsp olive oil",
      "1 cucumber, sliced into rounds",
      "1 cup plain Greek yogurt, for serving"
    ],
    "steps": [
      "Blend the olives, roasted red peppers, capers, garlic, lemon juice, and olive oil until chunky.",
      "Spoon the tapenade into a small bowl.",
      "Serve with the cucumber slices for scooping and the yogurt for dipping."
    ]
  },
{
    "id": "herbed-goat-cheese-tomato-bites",
    "image": "kitchen/herbed-goat-cheese-tomato-bites.jpg",
    "credit": "",
    "name": "Herbed Goat Cheese and Tomato Bites",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 12,
    "carbs": 9,
    "fat": 7,
    "saturatedFat": 4.3,
    "calories": 147,
    "sodium": 140,
    "tags": [
      "snacks-smoothies",
      "high-protein",
      "vegetarian",
      "gluten-free",
      "low-carb",
      "easy-prep",
      "low-sodium"
    ],
    "ingredients": [
      "1 1/2 oz goat cheese",
      "8 cherry tomatoes, halved",
      "1 tbsp chopped fresh herbs (basil, chives)",
      "1 tsp olive oil",
      "Black pepper",
      "1 cup plain Greek yogurt, for serving",
      "1 cucumber, sliced"
    ],
    "steps": [
      "Roll the goat cheese into small balls and coat with the herbs.",
      "Place a cheese ball on each tomato half.",
      "Drizzle with olive oil and black pepper.",
      "Serve with the cucumber slices and a spoonful of yogurt."
    ]
  },
  {
    "id": "chilled-cucumber-yogurt-soup",
    "image": "kitchen/chilled-cucumber-yogurt-soup.jpg",
    "credit": "",
    "name": "Chilled Cucumber and Yogurt Soup",
    "category": "Light Meals",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 14, "carbs": 13, "fat": 8, "saturatedFat": 0.5, "calories": 175, "sodium": 150,
    "tags": [
      "vegetarian",
      "gluten-free",
      "low-carb",
      "easy-prep"
    ],
    "ingredients": [
      "2 cucumbers, peeled and chopped",
      "1 1/4 cups plain Greek yogurt",
      "1/2 cup diced tomatoes, for topping",
      "2 tbsp hemp seeds",
      "1 tbsp chopped dill",
      "1 clove garlic, minced",
      "1 tsp lemon juice",
      "Salt and black pepper"
    ],
    "steps": [
      "Blend the cucumber, yogurt, dill, garlic, and lemon juice until smooth.",
      "Season with salt and pepper.",
      "Chill for 30 minutes, top with hemp seeds and the diced tomatoes and serve cold."
    ]
  },
{
    "id": "simple-green-salad-lemon-herbs",
    "image": "kitchen/simple-green-salad-lemon-herbs.jpg",
    "credit": "",
    "name": "Simple Green Salad with Lemon and Herbs",
    "category": "Light Meals",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 12,
    "carbs": 14,
    "fat": 8,
    "saturatedFat": 2.0,
    "calories": 176,
    "sodium": 590,
    "tags": [
      "vegetarian",
      "vegan",
      "gluten-free",
      "dairy-free",
      "low-carb",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "2 cups mixed greens",
      "1/2 cup chickpeas, drained",
      "1 tbsp chopped fresh herbs (parsley, basil)",
      "1 tbsp olive oil",
      "1 tsp lemon juice",
      "Salt and black pepper"
    ],
    "steps": [
      "Put the greens and chickpeas in a bowl.",
      "Whisk the olive oil and lemon juice with salt and pepper.",
      "Pour the dressing over the salad and toss.",
      "Sprinkle the herbs over the top."
    ]
  },
{
    "id": "provencal-fish-soup-light",
    "image": "kitchen/provencal-fish-soup-light.jpg",
    "credit": "",
    "name": "Provençal Fish Soup (Light)",
    "category": "Light Meals",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 26,
    "carbs": 12,
    "fat": 8,
    "saturatedFat": 1.5,
    "calories": 224,
    "sodium": 390,
    "tags": [
      "gluten-free",
      "dairy-free",
      "low-carb",
      "high-protein",
      "easy-prep"
    ],
    "ingredients": [
      "1 lb white fish fillets (cod or sea bass), cut into chunks",
      "1 can diced tomatoes",
      "1 fennel bulb, thinly sliced",
      "1 onion, chopped",
      "2 cloves garlic, minced",
      "1 tbsp olive oil",
      "1 tsp herbes de Provence",
      "4 cups low-sodium fish or vegetable stock",
      "1 tbsp lemon juice",
      "Salt and black pepper"
    ],
    "steps": [
      "Heat the olive oil in a pot and cook the onion, fennel, and garlic for 5 minutes.",
      "Add the tomatoes, stock, and herbes de Provence. Simmer for 10 minutes.",
      "Add the fish chunks and cook gently for 8 minutes, until the fish flakes.",
      "Stir in the lemon juice and season with salt and pepper."
    ]
  },
  {
    "id": "chicken-strawberry-salsa",
    "image": "kitchen/seared-chicken-strawberry-salsa.jpg",
    "credit": "Pexels",
    "name": "Seared Chicken with Strawberry Salsa",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 46, "carbs": 8, "fat": 10, "saturatedFat": 3, "calories": 306, "sodium": 160,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total)",
      "150 g strawberries, hulled and diced (about 1 cup) (organic preferred)",
      "40 g red onion, finely diced (about 1/4 cup)",
      "1 small jalapeño, seeded and finely diced (optional)",
      "1 lime, juiced",
      "A small handful of fresh cilantro, chopped",
      "2 teaspoons olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Stir the strawberries, onion, jalapeño, lime juice, and cilantro together in a bowl. Set the salsa aside while you cook the chicken.",
      "Season the chicken with salt and pepper.",
      "Cook in a pan with the olive oil until the center reaches 165°F, about 6 minutes a side.",
      "Rest the chicken a few minutes, slice, and spoon the salsa over the top."
    ]
  },
  {
    "id": "tuscan-chicken-skewers",
    "image": "kitchen/tuscan-chicken-kebabs.jpg",
    "credit": "Pexels",
    "name": "Tuscan Chicken Kebabs",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 48, "carbs": 10, "fat": 10, "saturatedFat": 3, "calories": 322, "sodium": 170,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total), cut into chunks",
      "160 g cherry tomatoes (about 1 cup)",
      "150 g zucchini, cut into thick half moons",
      "1 small red onion, cut into wedges",
      "1 bell pepper, cut into squares",
      "2 teaspoons olive oil",
      "1 lemon, juiced",
      "2 garlic cloves, minced",
      "1 teaspoon dried Italian herbs",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Toss the chicken with olive oil, lemon juice, garlic, herbs, salt, and pepper. Let it sit while you cut the vegetables.",
      "Thread the chicken and vegetables onto skewers, alternating as you go.",
      "Grill or cook in a pan, turning now and then, until the chicken reaches 165°F, about 10 to 12 minutes.",
      "Squeeze a little extra lemon over the top and serve."
    ]
  },
  {
    "id": "chicken-strips-green-beans",
    "image": "kitchen/baked-chicken-strips-green-beans.jpg",
    "credit": "Pexels",
    "name": "Baked Chicken Strips with Green Beans",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 54, "carbs": 26, "fat": 13, "saturatedFat": 3.5, "calories": 439, "sodium": 210,
    "tags": [
      "dinner",
      "high-protein",
      "budget-friendly",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total), cut into strips",
      "40 g rolled oats (about 1/3 cup), blitzed into coarse crumbs, mixed with the zest of 1/2 lemon",
      "1 egg, beaten",
      "1 teaspoon paprika",
      "300 g green beans",
      "2 teaspoons olive oil",
      "A pinch of salt (optional) and pepper",
      "150 g cherry tomatoes, halved (about 1 cup)"
    ],
    "steps": [
      "Heat the oven to 400°F and line a baking tray.",
      "Dip each chicken strip in the egg, then in the oat crumbs mixed with paprika, salt, and pepper.",
      "Lay the strips on the tray, drizzle with the olive oil, and bake until the center reaches 165°F, about 18 minutes. Squeeze the remaining lemon half over the strips before serving.",
      "Steam the green beans until tender, about 5 minutes. Serve the chicken strips with the green beans and the cherry tomatoes alongside."
    ]
  },
  {
    "id": "oat-chicken-fingers",
    "image": "kitchen/oat-crusted-chicken-fingers.jpg",
    "credit": "\"Baked Chicken Tenders with Sweet and Sour Sauce\" by TheCulinaryGeek, licensed under CC BY 2.0",
    "name": "Oat-Crusted Chicken Fingers",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 53, "carbs": 25, "fat": 14, "saturatedFat": 3.5, "calories": 439, "sodium": 210,
    "tags": [
      "dinner",
      "high-protein",
      "budget-friendly",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total), cut into fingers",
      "60 g rolled oats (about 2/3 cup), blitzed into coarse crumbs",
      "1 egg, beaten",
      "1 teaspoon garlic powder",
      "1 teaspoon paprika",
      "2 teaspoons olive oil",
      "A pinch of salt (optional) and pepper",
      "150 g cherry tomatoes, halved (about 1 cup)",
      "1/2 cucumber, sliced"
    ],
    "steps": [
      "Heat the oven to 400°F and line a baking tray.",
      "Mix the oat crumbs with garlic powder, paprika, salt, and pepper.",
      "Dip each chicken finger in the egg, then press into the oat crumbs.",
      "Lay on the tray, drizzle with olive oil, and bake until the center reaches 165°F, about 18 minutes.",
      "Serve the chicken fingers with the cherry tomatoes and cucumber slices alongside."
    ]
  },
  {
    "id": "ranchero-eggs-tortilla",
    "image": "kitchen/huevos-rancheros.jpg",
    "credit": "Pexels",
    "name": "Huevos Rancheros",
    "category": "Breakfast",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 24, "carbs": 36, "fat": 13, "saturatedFat": 4.3, "calories": 357, "sodium": 800,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "budget-friendly",
      "vegetarian",
      "gluten-free",
      "nut-free"
    ],
    "ingredients": [
      "1 egg",
      "2 egg whites",
      "1 small corn tortilla",
      "80 g canned black beans, drained (about 1/3 cup)",
      "80 g salsa (about 1/3 cup)",
      "14 g crumbled feta (about 1/2 oz)",
      "1 teaspoon olive oil",
      "A pinch of cumin and pepper"
    ],
    "steps": [
      "Warm the beans in a small pan with the cumin.",
      "Warm the tortilla in a dry pan until soft.",
      "Fry the egg and egg whites in the olive oil the way you like them.",
      "Lay the tortilla on a plate, spoon the beans over it, top with the eggs, salsa, and feta."
    ]
  },
  {
    "id": "southwest-quinoa-egg-bowl",
    "image": "kitchen/southwestern-quinoa-egg-bowl.jpg",
    "credit": "Pexels",
    "name": "Southwestern Quinoa and Egg Bowl",
    "category": "Breakfast",
    "time": 15,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 19, "carbs": 48, "fat": 11, "saturatedFat": 2, "calories": 369, "sodium": 450,
    "tags": [
      "breakfast",
      "balanced-macros",
      "easy-prep",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "nut-free"
    ],
    "ingredients": [
      "100 g cooked quinoa (about 1/2 cup)",
      "1 egg",
      "80 g canned black beans, drained (about 1/3 cup)",
      "80 g broccoli florets, chopped small (about 1 cup)",
      "40 g salsa (about 3 tablespoons)",
      "1 tablespoon ground flaxseed",
      "1/2 teaspoon cumin",
      "1 lime wedge"
    ],
    "steps": [
      "Warm the quinoa, beans, and broccoli in a pan with the cumin, then stir in the ground flaxseed.",
      "Fry the egg the way you like it.",
      "Spoon the quinoa mix into a bowl, top with the egg and salsa.",
      "Squeeze lime over the top and eat."
    ]
  },
  {
    "id": "microwave-veggie-egg-bowl",
    "image": "kitchen/microwave-egg-veggie-bowl.jpg",
    "credit": "Pexels",
    "name": "Microwave Egg and Veggie Bowl",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 16, "carbs": 8, "fat": 12, "saturatedFat": 3.1, "calories": 210, "sodium": 160,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "small-portions",
      "vegetarian",
      "gluten-free",
      "nut-free"
    ],
    "ingredients": [
      "2 eggs",
      "30 g chopped kale, stems removed (about 1 cup)",
      "80 g cherry tomatoes, halved (about 1/2 cup)",
      "50 g bell pepper, diced",
      "1 tablespoon pumpkin seeds"
    ],
    "steps": [
      "Whisk the eggs in a microwave-safe bowl.",
      "Stir in the kale, tomatoes, and pepper.",
      "Microwave for 90 seconds, stir, then microwave 60 seconds more, until the kale is tender.",
      "Sprinkle with the pumpkin seeds, let it sit a moment, then eat from the bowl."
    ]
  },
  {
    "id": "western-omelet-mug",
    "image": "kitchen/western-mug-omelet.jpg",
    "credit": "Pexels",
    "name": "Western Mug Omelet",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 27, "carbs": 7, "fat": 7, "saturatedFat": 3.0, "calories": 200, "sodium": 240,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "small-portions",
      "gluten-free",
      "nut-free"
    ],
    "ingredients": [
      "1 egg",
      "2 egg whites",
      "40 g diced cooked chicken breast (about 1/4 cup)",
      "30 g red bell pepper, diced",
      "20 g onion, diced",
      "14 g shredded part-skim mozzarella (about 1/2 oz)",
      "30 g chopped kale, stems removed (about 1 cup)"
    ],
    "steps": [
      "Whisk the egg and egg whites in a microwave-safe mug.",
      "Stir in the chicken, pepper, onion, kale, and mozzarella.",
      "Microwave for 90 seconds, stir, then microwave 30 seconds more.",
      "Let it sit a moment, then eat from the mug."
    ]
  },
  {
    "id": "salmon-foil-packet-lemon",
    "image": "kitchen/lemon-garlic-salmon-foil-packet.jpg",
    "credit": "Pexels",
    "name": "Lemon-Garlic Salmon Foil Packet",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 35, "carbs": 7, "fat": 20, "saturatedFat": 3.5, "calories": 348, "sodium": 150,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 salmon fillets (about 300 g total)",
      "200 g green beans",
      "1 lemon, half juiced and half sliced",
      "2 garlic cloves, minced",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Heat the oven to 400°F and tear off two large sheets of foil.",
      "Place a salmon fillet and half the green beans on each sheet.",
      "Drizzle with lemon juice and olive oil, scatter the garlic, and lay lemon slices on top.",
      "Fold the foil into sealed packets and bake for 15 minutes, until the salmon flakes."
    ]
  },
  {
    "id": "tea-citrus-tilapia",
    "image": "kitchen/citrus-tea-tilapia.jpg",
    "credit": "Pexels",
    "name": "Citrus Tea Tilapia",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 41, "carbs": 13, "fat": 4, "saturatedFat": 1, "calories": 254, "sodium": 170,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 tilapia fillets (about 300 g total)",
      "120 ml brewed green tea, cooled (about 1/2 cup)",
      "60 ml orange juice (about 1/4 cup)",
      "1 teaspoon orange zest",
      "200 g green beans",
      "A pinch of salt (optional) and pepper",
      "150 g cherry tomatoes, halved (about 1 cup)"
    ],
    "steps": [
      "Stir the tea, orange juice, and zest together in a shallow dish.",
      "Lay the tilapia in the tea mix for 10 minutes, turning once.",
      "Lift the fish out and cook in a pan until it flakes, about 3 minutes a side.",
      "Steam the green beans and cherry tomatoes until tender and serve them alongside."
    ]
  },
  {
    "id": "chicken-mole-sauce",
    "image": "kitchen/chicken-mole.jpg",
    "credit": "Pexels",
    "name": "Chicken Mole",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 50, "carbs": 8, "fat": 13, "saturatedFat": 3.5, "calories": 349, "sodium": 280,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "egg-free"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total)",
      "160 g tomato sauce (about 2/3 cup)",
      "2 tablespoons natural peanut butter (no added sugar)",
      "2 teaspoons unsweetened cocoa powder",
      "1 teaspoon chili powder",
      "1/2 teaspoon cumin",
      "A pinch of cinnamon",
      "1 garlic clove, minced",
      "1 teaspoon olive oil",
      "A small handful of fresh cilantro, chopped",
      "40 g red onion, finely diced (about 1/4 cup)"
    ],
    "steps": [
      "Season the chicken with a little salt and pepper and cook in a pan with the olive oil until the center reaches 165°F. Set aside.",
      "In the same pan, warm the tomato sauce, peanut butter, cocoa, chili powder, cumin, cinnamon, and garlic.",
      "Stir until the sauce is smooth, about 3 minutes.",
      "Slice the chicken, spoon the sauce over it, and scatter the cilantro and red onion on top."
    ]
  },
  {
    "id": "salmon-cucumber-dill",
    "image": "kitchen/salmon-cucumbers-dill.jpg",
    "credit": "\"Pittsburgh salmon salad\" by Triciaburmeister, licensed under CC BY-SA 4.0",
    "name": "Salmon with Cucumbers and Dill",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 37, "carbs": 5, "fat": 18, "saturatedFat": 2.5, "calories": 330, "sodium": 150,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 salmon fillets (about 300 g total)",
      "200 g cucumber, thinly sliced (about 1 cup)",
      "60 g plain nonfat Greek yogurt (about 1/4 cup)",
      "1 tablespoon fresh dill, chopped",
      "1 lemon, juiced",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Season the salmon with salt and pepper.",
      "Cook in a pan with the olive oil until it flakes, about 4 minutes a side.",
      "Toss the cucumber with the yogurt, dill, and lemon juice.",
      "Serve the salmon with the cucumber salad on the side."
    ]
  },
  {
    "id": "salmon-salad-stuffed-tomato",
    "image": "kitchen/tomato-stuffed-salmon-salad.jpg",
    "credit": "Pexels",
    "name": "Tomato Stuffed with Dill Salmon Salad",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 19, "carbs": 6, "fat": 5, "saturatedFat": 1, "calories": 145, "sodium": 340,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "small-portions",
      "easy-prep",
      "gluten-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 large tomatoes",
      "150 g canned salmon, drained (about 2/3 cup)",
      "60 g plain nonfat Greek yogurt (about 1/4 cup)",
      "40 g celery, finely diced",
      "20 g red onion, finely diced",
      "1 tablespoon fresh dill, chopped",
      "1 lemon, juiced",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Cut the tops off the tomatoes and scoop out the insides.",
      "Mix the salmon with the yogurt, celery, onion, dill, and lemon juice.",
      "Season lightly and spoon the salad into the tomatoes.",
      "Serve cold, straight from the fridge if you like."
    ]
  },
  {
    "id": "broccoli-cheese-scramble",
    "image": "kitchen/broccoli-cheese-scramble-muffin.jpg",
    "credit": "Pexels",
    "name": "Broccoli and Cheese Scramble",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 17, "carbs": 7, "fat": 13, "saturatedFat": 3.9, "calories": 213, "sodium": 290,
    "tags": [
      "breakfast",
      "high-protein",
      "low-carb",
      "easy-prep",
      "small-portions",
      "vegetarian",
      "gluten-free",
      "nut-free"
    ],
    "ingredients": [
      "1 egg",
      "1 egg white",
      "100 g broccoli florets, chopped small (about 1 cup)",
      "30 g chopped kale, stems removed (about 1 cup)",
      "14 g shredded reduced-fat cheddar (about 1/2 oz)",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Warm the oil in a pan and cook the broccoli and kale until just tender, about 3 minutes.",
      "Whisk the egg and egg white and pour them over the broccoli.",
      "Stir gently until the eggs are just set, then fold in the cheddar.",
      "Serve right away, while the cheese is still soft."
    ]
  },
  {
    "id": "salmon-honey-balsamic",
    "image": "kitchen/salmon-honey-balsamic-glaze.jpg",
    "credit": "\"Mesa Grill Ancho Chile Honey Glazed Salmon\" by Calgary Reviews, licensed under CC BY 2.0",
    "name": "Salmon with Balsamic Glaze",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 35, "carbs": 10, "fat": 18, "saturatedFat": 2.5, "calories": 342, "sodium": 210,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 salmon fillets (about 300 g total)",
      "2 tablespoons balsamic vinegar",
      "1 teaspoon Dijon mustard",
      "1 garlic clove, minced",
      "200 g green beans",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Simmer the balsamic vinegar in a small pan until it thickens slightly, then stir in the mustard and garlic.",
      "Season the salmon with salt and pepper and brush half the glaze over it.",
      "Cook in a pan with the olive oil, brushing with the rest of the glaze as it cooks, until the salmon flakes, about 4 minutes a side.",
      "Steam the green beans until tender and serve them alongside."
    ]
  },
  {
    "id": "jess-tuscan-lentil-chicken-soup",
    "image": "kitchen/jess-tuscan-lentil-chicken-soup.jpg",
    "credit": "",
    "name": "Jess's Tuscan Lentil and Chicken Soup",
    "category": "Dinner",
    "time": 50,
    "difficulty": "Easy",
    "servings": 9,
    "protein": 23, "carbs": 34, "fat": 4, "saturatedFat": 1, "calories": 262, "sodium": 150,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "nut-free",
      "egg-free",
      "budget-friendly",
      "easy-prep"
    ],
    "ingredients": [
      "2 cups lentils, rinsed",
      "2 tablespoons olive oil",
      "8 garlic cloves, minced",
      "2 carrots, diced",
      "2 zucchini, diced",
      "2 cans diced tomatoes (no salt)",
      "2 low-sodium chicken bouillon cubes",
      "10 cups water",
      "2 teaspoons Italian herbs (basil, oregano, thyme)",
      "Black pepper",
      "12 oz cooked chicken breast, diced (about 340 g)",
      "2 cups chopped kale, stems removed",
      "Parmesan (optional)",
      "Whole-grain seeded bread, for serving (optional)",
      "Juice of 1 lemon"
    ],
    "steps": [
      "Sear the chicken in a pan with a little of the olive oil until browned at the edges, about 4 minutes.",
      "Heat the oil, saute the garlic for 1 minute.",
      "Add the carrots and zucchini, cook 3-4 minutes.",
      "Add the lentils, tomatoes, bouillon, herbs, pepper, water, and protein.",
      "Boil, then simmer 35-40 minutes until the lentils are tender.",
      "Stir in the kale and cook 5 minutes more, until tender, then stir in the lemon juice and serve with Parmesan and whole-grain seeded bread."
    ]
  },
  {
    "id": "mississippi-pot-roast",
    "image": "kitchen/mississippi-pot-roast.jpg",
    "credit": "",
    "name": "Mississippi Pot Roast",
    "category": "Dinner",
    "time": 480,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 40, "carbs": 5, "fat": 6, "saturatedFat": 2.1, "calories": 234, "sodium": 240,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "low-carb",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "3 lb top round roast (or eye of round), trimmed",
      "1 teaspoon garlic powder",
      "1 teaspoon onion powder",
      "1 teaspoon dried dill",
      "1/2 teaspoon dried parsley",
      "1 teaspoon smoked paprika",
      "6 pepperoncini peppers, plus 2 tablespoons of the juice",
      "1 cup low-sodium beef broth",
      "2 carrots, sliced"
    ],
    "steps": [
      "Rub the roast all over with the garlic powder, onion powder, dill, parsley, and smoked paprika.",
      "Set the roast in the slow cooker.",
      "Tuck the peppers and carrots around the roast, then pour in the pepper juice and the broth.",
      "Cover and cook on low for 8 hours, until the roast pulls apart easily.",
      "Shred the meat with two forks and stir it through the juices. Skim any fat from the juices before serving.",
      "Serve with steamed green beans or roasted cauliflower."
    ]
  },
  {
    "id": "slow-cooker-chicken-posole",
    "image": "kitchen/slow-cooker-chicken-posole.jpg",
    "credit": "",
    "name": "Slow Cooker Chicken Posole",
    "category": "Dinner",
    "time": 360,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 30, "carbs": 21, "fat": 7, "saturatedFat": 1.5, "calories": 256, "sodium": 340,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "1 1/2 lb boneless, skinless chicken breasts",
      "2 cans hominy (about 25 oz total), drained",
      "1 can diced tomatoes (14 oz)",
      "1 onion, chopped",
      "4 garlic cloves, minced",
      "4 cups low-sodium chicken broth",
      "2 teaspoons chili powder",
      "1 teaspoon ground cumin",
      "1 teaspoon dried oregano",
      "A pinch of salt (optional) and pepper",
      "Lime wedges, chopped cilantro, and sliced avocado, to serve"
    ],
    "steps": [
      "Put the chicken, hominy, tomatoes, onion, garlic, and broth in the slow cooker.",
      "Stir in the chili powder, cumin, oregano, salt, and pepper.",
      "Cover and cook on low for 6 hours, until the chicken is tender.",
      "Lift the chicken out and shred it with two forks.",
      "Stir the shredded chicken back into the pot.",
      "Serve with lime, cilantro, and avocado."
    ]
  },
  {
    "id": "slow-cooker-bbq-brisket",
    "image": "kitchen/slow-cooker-bbq-brisket.jpg",
    "credit": "",
    "name": "Slow Cooker BBQ Beef Brisket",
    "category": "Dinner",
    "time": 480,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 32, "carbs": 6, "fat": 6, "saturatedFat": 2.5, "calories": 208, "sodium": 360,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "3 lb beef brisket, flat half only, fat cap removed",
      "1 1/2 cups low-sodium sugar-free BBQ sauce",
      "1/2 cup low-sodium beef broth",
      "1 onion, sliced",
      "1 tablespoon smoked paprika",
      "1 teaspoon garlic powder",
      "1 teaspoon ground cumin",
      "Salt and pepper",
      "1 tablespoon apple cider vinegar",
      "1 red bell pepper, sliced"
    ],
    "steps": [
      "Rub the brisket all over with the paprika, garlic powder, cumin, salt, and pepper.",
      "Scatter the sliced onion in the bottom of the slow cooker.",
      "Lay the brisket on the onions and pepper, and pour the BBQ sauce, broth, and vinegar over it.",
      "Cover and cook on low for 8 hours, until the brisket slices easily.",
      "Slice against the grain and spoon the cooking juices over the top. Skim any fat from the juices before serving."
    ]
  },
  {
    "id": "creamy-tuscan-garlic-chicken",
    "image": "kitchen/creamy-tuscan-garlic-chicken.jpg",
    "credit": "",
    "name": "Slow Cooker Creamy Tuscan Garlic Chicken",
    "category": "Dinner",
    "time": 360,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 58, "carbs": 10, "fat": 8, "saturatedFat": 3, "calories": 344, "sodium": 370,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "low-carb",
      "gluten-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "4 boneless, skinless chicken breasts (about 700 g total)",
      "3/4 cup evaporated skim milk",
      "1/2 cup low-sodium chicken broth",
      "1/3 cup sun-dried tomatoes, chopped",
      "3 cups chopped kale, stems removed",
      "5 garlic cloves, minced",
      "1 teaspoon Italian seasoning",
      "1/4 cup grated Parmesan",
      "Salt and pepper"
    ],
    "steps": [
      "Lay the chicken breasts in the slow cooker.",
      "Whisk the evaporated skim milk, broth, garlic, Italian seasoning, salt, and pepper together and pour it over the chicken.",
      "Scatter the sun-dried tomatoes on top.",
      "Cover and cook on low for 6 hours, until the chicken is cooked through.",
      "Stir in the kale and Parmesan and cook 5 minutes more, until the kale is tender and the sauce comes together.",
      "Serve over whole-grain pasta or brown rice, or on its own."
    ]
  },
  {
    "id": "slow-cooker-beef-stew",
    "image": "kitchen/slow-cooker-beef-stew.jpg",
    "credit": "",
    "name": "Slow Cooker Beef Stew",
    "category": "Dinner",
    "time": 480,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 41, "carbs": 14, "fat": 18, "saturatedFat": 3.5, "calories": 370, "sodium": 250,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "2 lb beef stew meat, cubed",
      "4 cups low-sodium beef broth",
      "3 carrots, sliced",
      "2 potatoes, peeled and diced",
      "2 cups cauliflower florets",
      "1 onion, chopped",
      "4 garlic cloves, minced",
      "1 tablespoon tomato paste",
      "2 teaspoons dried thyme",
      "1 teaspoon dried rosemary",
      "1 tablespoon olive oil",
      "Salt and pepper",
      "Juice of 1/2 lemon"
    ],
    "steps": [
      "Put the beef, broth, carrots, potatoes, cauliflower, onion, and garlic in the slow cooker.",
      "Stir in the tomato paste, thyme, rosemary, olive oil, salt, and pepper.",
      "Cover and cook on low for 8 hours, until the beef and vegetables are tender.",
      "Stir in the lemon juice, taste, and adjust the salt.",
      "Serve with whole-grain bread, or on its own."
    ]
  },
  {
    "id": "slow-cooker-bbq-pulled-pork",
    "image": "kitchen/slow-cooker-bbq-pulled-pork.jpg",
    "credit": "",
    "name": "Slow Cooker BBQ Pulled Pork",
    "category": "Dinner",
    "time": 480,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 29, "carbs": 13, "fat": 13, "saturatedFat": 5, "calories": 286, "sodium": 260,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "3 lb pork shoulder",
      "1 onion, chopped",
      "1 1/2 cups low-sodium sugar-free BBQ sauce",
      "2 tablespoons apple cider vinegar",
      "1 teaspoon smoked paprika",
      "1 teaspoon garlic powder",
      "Salt and pepper",
      "1 red bell pepper, sliced"
    ],
    "steps": [
      "Set the pork shoulder in the slow cooker and scatter the chopped onion and sliced pepper over it.",
      "Stir the BBQ sauce, vinegar, paprika, garlic powder, salt, and pepper together and pour it over the pork.",
      "Cover and cook on low for 8 hours, until the pork pulls apart easily.",
      "Lift the pork out, shred it with two forks, and return it to the pot.",
      "Stir the shredded pork through the sauce.",
      "Serve on whole-grain buns with extra sauce, or over roasted cauliflower."
    ]
  },
  {
    "id": "bbq-chicken-drumsticks",
    "image": "kitchen/bbq-chicken-drumsticks.jpg",
    "credit": "",
    "name": "BBQ Chicken Drumsticks",
    "category": "Dinner",
    "time": 360,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 33, "carbs": 18, "fat": 11, "saturatedFat": 2.5, "calories": 304, "sodium": 380,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "8 chicken drumsticks, skin removed (about 900 g total)",
      "1 cup low-sodium sugar-free BBQ sauce",
      "1 tablespoon olive oil",
      "1 teaspoon smoked paprika",
      "1 teaspoon garlic powder",
      "Salt and pepper",
      "1 red bell pepper, sliced"
    ],
    "steps": [
      "Season the drumsticks with salt, pepper, paprika, and garlic powder.",
      "Heat the olive oil in a pan and brown the drumsticks on all sides, 5 to 7 minutes.",
      "Move the drumsticks to the slow cooker, tuck the pepper slices around them, and pour the BBQ sauce over them.",
      "Cover and cook on low for 6 hours, until the chicken is tender and cooked through.",
      "Serve with extra sauce on the side."
    ]
  },
  {
    "id": "bbq-meatballs",
    "image": "kitchen/bbq-meatballs.jpg",
    "credit": "",
    "name": "BBQ Meatballs",
    "category": "Dinner",
    "time": 300,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 32, "carbs": 9, "fat": 5, "saturatedFat": 1.4, "calories": 206, "sodium": 390,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "nut-free"
    ],
    "ingredients": [
      "1 1/2 lb ground turkey breast (99% lean)",
      "1/3 cup whole-grain breadcrumbs",
      "1 egg",
      "1/3 cup grated Parmesan",
      "2 tablespoons chopped parsley",
      "1 teaspoon garlic powder",
      "1 tablespoon ground flaxseed",
      "Salt and pepper",
      "1 1/2 cups low-sodium sugar-free BBQ sauce",
      "1 red bell pepper, finely diced",
      "A small handful of fresh parsley, chopped, to serve"
    ],
    "steps": [
      "Mix the ground turkey, breadcrumbs, egg, Parmesan, parsley, red pepper, garlic powder, ground flaxseed, salt, and pepper in a bowl.",
      "Roll the mix into small meatballs, about 1 inch across.",
      "Set the meatballs in the slow cooker and pour the BBQ sauce over them.",
      "Cover and cook on low for 5 hours, stirring once or twice.",
      "Serve with toothpicks as a snack, or on a whole-grain roll. Scatter the extra parsley over the top before serving."
    ]
  },
  {
    "id": "slow-cooker-bbq-ribs",
    "image": "kitchen/slow-cooker-bbq-ribs.jpg",
    "credit": "",
    "name": "Slow Cooker Country-Style BBQ Ribs",
    "category": "Dinner",
    "time": 420,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 19, "carbs": 4, "fat": 11, "saturatedFat": 4.5, "calories": 193, "sodium": 420,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "1 1/2 lb boneless country-style ribs (pork loin)",
      "1 1/2 cups low-sodium sugar-free BBQ sauce",
      "1 tablespoon smoked paprika",
      "1 tablespoon garlic powder",
      "1 tablespoon onion powder",
      "1/2 teaspoon salt",
      "1 teaspoon black pepper",
      "1/2 teaspoon cayenne pepper",
      "1 red bell pepper, sliced"
    ],
    "steps": [
      "Mix the paprika, garlic powder, onion powder, salt, pepper, and cayenne in a small bowl.",
      "Rub the seasoning all over the ribs.",
      "Set the ribs in the slow cooker, tuck the pepper slices around them, and pour the BBQ sauce over the top.",
      "Cover and cook on low for 7 hours, until the ribs are tender.",
      "Serve with extra sauce on the side."
    ]
  },
  {
    "id": "greek-salad",
    "image": "kitchen/greek-salad.jpg",
    "credit": "",
    "name": "Greek Salad",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 38, "carbs": 10, "fat": 12, "saturatedFat": 3.2, "calories": 295, "sodium": 320,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "budget-friendly",
      "gluten-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "4 chicken breasts (about 450 g total), grilled and sliced",
      "400 g ripe tomatoes (about 2 large), cut into wedges",
      "200 g cucumber (about 1 medium), sliced into half moons",
      "1 red bell pepper, seeded and sliced",
      "1/2 red onion, thinly sliced",
      "40 g Kalamata olives, pitted",
      "40 g feta cheese, crumbled or in a block",
      "4 teaspoons olive oil",
      "1 tablespoon lemon juice",
      "1 teaspoon dried oregano",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Grill the chicken breasts until the center reaches 165°F, about 6 minutes a side. Rest a few minutes, then slice.",
      "Put the tomatoes, cucumber, pepper, and onion in a large bowl.",
      "Add the olives and feta on top.",
      "Whisk the olive oil, lemon juice, oregano, salt, and pepper in a small cup.",
      "Pour the dressing over the salad and toss gently.",
      "Let it sit for 5 minutes so the flavors come together, then top each serving with sliced grilled chicken and serve."
    ]
  },
  {
    "id": "chickpea-salad",
    "image": "kitchen/chickpea-salad.jpg",
    "credit": "",
    "name": "Chickpea Salad",
    "category": "Dinner",
    "time": 10,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 16, "carbs": 38, "fat": 11, "saturatedFat": 2.5, "calories": 315, "sodium": 430,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "budget-friendly",
      "vegetarian",
      "gluten-free",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 cans chickpeas, drained and rinsed (about 480 g total)",
      "200 g cucumber (about 1 medium), diced",
      "200 g cherry tomatoes, halved",
      "1/2 red onion, finely diced",
      "60 g feta cheese, crumbled",
      "1 tablespoon olive oil",
      "60 g plain nonfat Greek yogurt (about 1/4 cup)",
      "1 tablespoon lemon juice",
      "1/2 teaspoon ground cumin",
      "A small handful of fresh parsley, chopped",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Drain and rinse the chickpeas, then tip them into a large bowl.",
      "Add the cucumber, tomatoes, onion, and feta.",
      "Whisk the olive oil, yogurt, lemon juice, and cumin in a small cup.",
      "Pour the dressing over the salad and toss until everything is coated.",
      "Stir in the parsley, season lightly, and serve. It keeps well in the fridge for a day."
    ]
  },
  {
    "id": "shrimp-scampi-vegetables",
    "image": "kitchen/shrimp-scampi-vegetables.jpg",
    "credit": "",
    "name": "Shrimp Scampi with Kale, Tomatoes and Zucchini",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 32, "carbs": 36, "fat": 13, "saturatedFat": 3.5, "calories": 385, "sodium": 310,
    "tags": [
      "dinner",
      "high-protein",
      "balanced-macros",
      "nut-free",
      "egg-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 lb large shrimp, peeled and deveined (about 450 g)",
      "6 oz whole-grain spaghetti (about 170 g)",
      "2 tablespoons olive oil",
      "1 tablespoon butter",
      "5 garlic cloves, minced",
      "1 cup cherry tomatoes, halved",
      "2 cups chopped kale, stems removed",
      "1 medium zucchini, sliced into half-moons",
      "1 medium zucchini, cut into thin ribbons",
      "Juice of 1 lemon",
      "1/4 teaspoon red pepper flakes",
      "2 tablespoons grated Parmesan",
      "2 tablespoons chopped parsley",
      "Salt and pepper",
      "1 teaspoon grated fresh ginger"
    ],
    "steps": [
      "Cook the pasta in salted water until just tender, about 9 minutes. Drain, saving 1/2 cup of the pasta water.",
      "Warm the olive oil and butter in a large pan over medium heat. Add the garlic and red pepper flakes and cook 1 minute, until fragrant.",
      "Add the shrimp in a single layer and cook 2 minutes per side, until pink.",
      "Add the kale, tomatoes, zucchini, and ginger and cook 3 minutes, until just soft and the kale is tender.",
      "Stir in the lemon juice and toss until everything is coated, about 1 minute.",
      "Toss in the pasta and the zucchini ribbons with a splash of the saved pasta water. Top with Parmesan and parsley and serve."
    ]
  },
  {
    "id": "stuffed-artichokes",
    "image": "kitchen/stuffed-artichokes.jpg",
    "credit": "",
    "name": "Stuffed Artichokes",
    "category": "Snacks",
    "time": 60,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 12, "carbs": 35, "fat": 15, "saturatedFat": 2.5, "calories": 329, "sodium": 320,
    "tags": [
      "snacks-smoothies",
      "vegetarian",
      "egg-free",
      "nut-free",
      "easy-prep",
      "small-portions"
    ],
    "ingredients": [
      "4 medium artichokes",
      "1 lemon, halved",
      "3/4 cup whole-grain breadcrumbs",
      "2 tablespoons ground flaxseed",
      "1/4 cup grated Parmesan cheese",
      "4 garlic cloves, minced",
      "1/2 cup fresh parsley, chopped",
      "3 tablespoons olive oil",
      "Salt and pepper",
      "2 cups water, for steaming",
      "1 red bell pepper, finely diced"
    ],
    "steps": [
      "Trim the artichokes: cut off the top inch, snip the sharp leaf tips, and peel away the tough outer leaves.",
      "Rub the cut edges with half a lemon so they do not brown.",
      "Spread the leaves open gently and pull out the small center leaves and the fuzzy choke with a spoon.",
      "Mix the breadcrumbs, ground flaxseed, Parmesan, garlic, parsley, red pepper, and a pinch of salt and pepper.",
      "Spoon the filling between the leaves and into the center of each artichoke. Drizzle with olive oil.",
      "Stand the artichokes upright in a pot with about 2 inches of water and the lemon half. Cover and steam 40-45 minutes, until a leaf pulls away easily.",
      "Serve warm with the lemon squeezed over the top."
    ]
  },
  {
    "id": "italian-minestrone",
    "image": "kitchen/italian-minestrone.jpg",
    "credit": "",
    "name": "Italian Minestrone",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 12, "carbs": 40, "fat": 7, "saturatedFat": 0.5, "calories": 271, "sodium": 450,
    "tags": [
      "dinner",
      "vegetarian",
      "balanced-macros",
      "budget-friendly",
      "easy-prep",
      "nut-free",
      "egg-free"
    ],
    "ingredients": [
      "2 tablespoons olive oil",
      "1 onion, chopped",
      "2 carrots, diced",
      "2 celery stalks, diced",
      "3 garlic cloves, minced",
      "2 zucchini, diced",
      "2 cups green beans, cut into 1-inch pieces",
      "1 can (14.5 oz) diced tomatoes, no salt added",
      "1 can (15 oz) cannellini beans, rinsed and drained",
      "1 can (15 oz) kidney beans, rinsed and drained",
      "6 cups low-sodium vegetable broth",
      "1 teaspoon dried Italian herbs (basil and oregano)",
      "1/2 teaspoon ground turmeric",
      "Salt and pepper",
      "1 cup small whole-grain pasta (ditalini or small shells)",
      "Grated Parmesan, for serving"
    ],
    "steps": [
      "Heat the olive oil in a large pot over medium heat.",
      "Add the onion, carrots, and celery. Cook 5 minutes until softened.",
      "Add the garlic and zucchini. Cook 2 minutes more.",
      "Add the tomatoes, both beans, green beans, broth, herbs, salt, and pepper. Bring to a boil.",
      "Lower the heat and simmer 20 minutes.",
      "Stir in the pasta. Cook 10 minutes until the pasta is tender.",
      "Taste and add more salt or pepper if you like.",
      "Serve with grated Parmesan on top."
    ]
  },
  {
    "id": "roasted-cauliflower-white-bean-tacos",
    "image": "kitchen/roasted-cauliflower-white-bean-tacos.jpg",
    "credit": "",
    "name": "Roasted Cauliflower and White Bean Tacos",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 11, "carbs": 37, "fat": 9, "saturatedFat": 0.5, "calories": 268, "sodium": 460,
    "tags": [
      "dinner",
      "vegetarian",
      "gluten-free",
      "budget-friendly",
      "easy-prep"
    ],
    "ingredients": [
      "400 g cauliflower florets, cut into small pieces",
      "1 can white beans (400 g), drained and rinsed",
      "1 tablespoon olive oil",
      "1 teaspoon ground cumin",
      "1 teaspoon smoked paprika",
      "1/4 teaspoon salt",
      "8 small corn tortillas",
      "1 cup shredded green cabbage",
      "1/2 cup salsa",
      "1 lime, cut into wedges",
      "1/4 cup chopped fresh cilantro",
      "1/4 cup pumpkin seeds"
    ],
    "steps": [
      "Heat the oven to 200°C (400°F). Line a baking tray with baking paper.",
      "Toss the cauliflower with the olive oil, cumin, smoked paprika, and salt. Spread it in a single layer on the tray.",
      "Roast for 20 minutes, turning once halfway through, until the edges are browned and the centres are soft.",
      "While the cauliflower roasts, warm the white beans in a small pan over medium heat for 3 to 4 minutes. Mash a few beans with a fork to thicken them.",
      "Warm the tortillas in a dry pan for 30 seconds on each side, or wrap them in a clean towel and microwave for 30 seconds.",
      "Fill each tortilla with cauliflower, white beans, and shredded cabbage.",
      "Top with salsa, cilantro, and pumpkin seeds. Serve with lime wedges."
    ]
  },
  {
    "id": "white-bean-greens-soup",
    "image": "kitchen/white-bean-greens-soup.jpg",
    "credit": "",
    "name": "White Bean and Greens Soup",
    "category": "Light Meals",
    "time": 30,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 11, "carbs": 28, "fat": 6, "saturatedFat": 0.5, "calories": 206, "sodium": 360,
    "tags": [
      "small-portions",
      "vegan",
      "gluten-free",
      "dairy-free",
      "budget-friendly",
      "easy-prep"
    ],
    "ingredients": [
      "1 tablespoon olive oil",
      "1 onion, chopped",
      "2 carrots, peeled and sliced",
      "3 garlic cloves, minced",
      "1 teaspoon dried rosemary",
      "2 cans cannellini beans (400 g each), drained and rinsed",
      "4 cups low-sodium vegetable broth",
      "6 cups chopped kale, stems removed",
      "1 lemon, juiced",
      "Salt and black pepper to taste",
      "3 tablespoons ground flaxseed"
    ],
    "steps": [
      "Heat the olive oil in a large pot over medium heat.",
      "Add the onion and carrots. Cook for 5 minutes, stirring often, until the onion is soft.",
      "Add the garlic and rosemary. Cook for 1 minute until fragrant.",
      "Add the beans and the broth. Bring to a gentle boil, then turn the heat down and simmer for 10 minutes.",
      "Stir in the kale a handful at a time. Simmer for 5 more minutes until the greens are wilted and tender.",
      "Stir in the ground flaxseed and the lemon juice. Taste and add salt and pepper.",
      "Ladle into bowls and serve hot."
    ]
  },
  {
    "id": "lentil-barley-bowl",
    "image": "kitchen/lentil-barley-bowl.jpg",
    "credit": "",
    "name": "Lentil and Barley Bowl",
    "category": "Dinner",
    "time": 35,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 14, "carbs": 40, "fat": 11, "saturatedFat": 1, "calories": 313, "sodium": 180,
    "tags": [
      "dinner",
      "vegan",
      "high-protein",
      "budget-friendly",
      "easy-prep"
    ],
    "ingredients": [
      "1 cup dry brown lentils, rinsed",
      "1 cup pearl barley, rinsed",
      "3 cups water or low-sodium vegetable broth",
      "1 zucchini, diced",
      "1 red pepper, diced",
      "1 red onion, diced",
      "2 tablespoons olive oil",
      "1 teaspoon ground cumin",
      "1 cup cherry tomatoes, halved",
      "1/4 cup chopped fresh parsley",
      "1 lemon, juiced",
      "Salt and black pepper to taste",
      "4 tablespoons ground flaxseed"
    ],
    "steps": [
      "Put the lentils, barley, and water or broth in a medium pot. Bring to a boil.",
      "Turn the heat to low, cover, and simmer for 25 minutes until the lentils are tender and the barley is chewy. Drain any extra liquid.",
      "While the grains cook, heat the oven to 200°C (400°F). Toss the zucchini, red pepper, and onion with 1 tablespoon of the olive oil and the cumin. Spread on a baking tray.",
      "Roast the vegetables for 20 minutes, turning once, until soft and browned at the edges.",
      "Stir the roasted vegetables and cherry tomatoes into the lentils and barley.",
      "Add the remaining olive oil, lemon juice, parsley, and ground flaxseed. Toss gently.",
      "Taste and add salt and pepper. Serve warm or at room temperature."
    ]
  },
  {
    "id": "chickpea-kale-roasted-cauliflower-skillet",
    "image": "kitchen/chickpea-kale-roasted-cauliflower-skillet.jpg",
    "credit": "",
    "name": "Chickpea and Kale Skillet with Roasted Cauliflower",
    "category": "Dinner",
    "time": 30,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 12, "carbs": 36, "fat": 9, "saturatedFat": 0.5, "calories": 275, "sodium": 270,
    "tags": [
      "dinner",
      "vegan",
      "vegetarian",
      "gluten-free",
      "dairy-free",
      "high-protein",
      "easy-prep",
      "budget-friendly"
    ],
    "ingredients": [
      "1 medium cauliflower (about 200 g florets)",
      "1 tablespoon olive oil",
      "1 onion, chopped",
      "2 garlic cloves, minced",
      "1 teaspoon ground cumin",
      "1/2 teaspoon ground turmeric",
      "1 can chickpeas (400 g), drained and rinsed",
      "4 cups chopped kale, stems removed",
      "1 lemon, juiced",
      "Salt and black pepper to taste",
      "1/4 cup pumpkin seeds",
      "1 cup cherry tomatoes, halved"
    ],
    "steps": [
      "Heat the oven to 200°C (400°F). Toss the cauliflower florets with half the olive oil and roast for 15 minutes, until browned at the edges.",
      "While the cauliflower roasts, warm the rest of the olive oil in a large skillet over medium heat. Add the onion and cook 4 minutes, until soft.",
      "Add the garlic, cumin, and turmeric. Cook for 1 minute until fragrant.",
      "Add the chickpeas and 2 tablespoons of water. Cover and cook for 5 minutes.",
      "Add the kale a handful at a time, stirring until each handful wilts, then add the cherry tomatoes.",
      "Stir in the roasted cauliflower and the lemon juice. Taste and add salt and pepper, then sprinkle with the pumpkin seeds.",
      "Serve hot, straight from the pan."
    ]
  },
  {
    "id": "overnight-oats-berries",
    "image": "kitchen/overnight-oats-berries.jpg",
    "credit": "",
    "name": "Overnight Oats with Berries",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 16, "carbs": 46, "fat": 4, "saturatedFat": 1.1, "calories": 290, "sodium": 70,
    "tags": [
      "breakfast",
      "vegetarian",
      "easy-prep",
      "high-protein",
      "balanced-macros",
      "low-sodium",
      "nut-free"
    ],
    "ingredients": [
      "1 cup rolled oats",
      "1 cup milk",
      "1/2 cup plain Greek yogurt",
      "1 tablespoon chia seeds",
      "1/4 teaspoon pure stevia (or monk fruit extract)",
      "1/2 teaspoon ground cinnamon",
      "1 cup mixed berries, including blueberries"
    ],
    "steps": [
      "Stir the oats, milk, yogurt, chia seeds, stevia, and cinnamon together in a bowl or jar.",
      "Cover and put in the fridge overnight, or for at least 4 hours.",
      "In the morning, stir the oats. Add a splash of milk if they are thicker than you like.",
      "Divide between two bowls.",
      "Top each bowl with half the berries. Serve cold."
    ]
  },
  {
    "id": "garlic-butter-cod-broccoli",
    "image": "kitchen/garlic-butter-cod-broccoli.jpg",
    "credit": "",
    "name": "Garlic Olive Oil Cod with Roasted Broccoli and Brussels Sprouts",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 31, "carbs": 14, "fat": 13, "saturatedFat": 2.0, "calories": 299, "sodium": 170,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "egg-free",
      "nut-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 cod fillets (about 300 g total)",
      "150 g broccoli florets (about 1 1/2 cups)",
      "150 g Brussels sprouts, halved (about 1 1/2 cups)",
      "1 tablespoon olive oil",
      "3 garlic cloves, minced",
      "1 lemon, juiced",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper",
      "150 g cherry tomatoes, halved (about 1 cup)"
    ],
    "steps": [
      "Heat the oven to 425°F and line a baking tray with parchment.",
      "Toss the broccoli, Brussels sprouts, and cherry tomatoes with the olive oil, salt, and pepper and spread them on the tray.",
      "Roast for 10 minutes, until the broccoli starts to brown at the edges.",
      "Season the cod with salt and pepper and lay it on the tray beside the vegetables.",
      "Warm the olive oil with the garlic in a small pan and spoon it over the cod.",
      "Roast 10 minutes more, until the cod flakes easily with a fork.",
      "Squeeze the lemon juice over the top and serve."
    ]
  },
  {
    "id": "turkey-meatballs-tomato-sauce",
    "image": "kitchen/turkey-meatballs-tomato-sauce.jpg",
    "credit": "",
    "name": "Turkey Meatballs in Tomato Sauce",
    "category": "Dinner",
    "time": 35,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 46, "carbs": 16, "fat": 4, "saturatedFat": 1.2, "calories": 284, "sodium": 420,
    "tags": [
      "dinner",
      "high-protein",
      "easy-prep",
      "nut-free",
      "budget-friendly"
    ],
    "ingredients": [
      "1 1/2 lb ground turkey breast (99% lean)",
      "1/3 cup whole-grain breadcrumbs",
      "1 egg, beaten",
      "1 tablespoon grated Parmesan",
      "2 garlic cloves, minced",
      "1 teaspoon dried Italian herbs",
      "2 cups tomato sauce",
      "Olive oil spray",
      "A pinch of salt (optional) and pepper",
      "A small handful of fresh basil leaves, torn"
    ],
    "steps": [
      "Mix the turkey, breadcrumbs, egg, Parmesan, garlic, herbs, salt, and pepper in a large bowl.",
      "Roll the mix into 16 small meatballs, about 1 1/2 inches across.",
      "Spray a large pan with olive oil spray and brown the meatballs on all sides over medium heat, about 6 minutes.",
      "Pour the tomato sauce over the meatballs and bring it to a gentle simmer.",
      "Cover and cook for 15 minutes, until the meatballs are cooked through.",
      "Serve over whole-grain pasta or with whole-grain bread, or on their own. Scatter the basil over the top before serving."
    ]
  },
  {
    "id": "tuna-steak-green-beans",
    "image": "kitchen/tuna-steak-green-beans.jpg",
    "credit": "",
    "name": "Tuna Steak with Green Beans and Cherry Tomatoes",
    "category": "Dinner",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 38, "carbs": 11, "fat": 6, "saturatedFat": 1, "calories": 250, "sodium": 120,
    "tags": [
      "dinner",
      "high-protein",
      "low-carb",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free",
      "easy-prep",
      "low-sodium"
    ],
    "ingredients": [
      "2 tuna steaks (about 300 g total)",
      "200 g green beans",
      "150 g cherry tomatoes, halved (about 1 cup)",
      "1 lemon, juiced",
      "1 teaspoon olive oil",
      "1 garlic clove, minced",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Season the tuna with salt and pepper.",
      "Warm the olive oil in a pan over medium-high heat.",
      "Cook the tuna for 2 to 3 minutes a side, until seared outside and pink in the middle.",
      "Set the tuna aside to rest a few minutes.",
      "In the same pan, cook the green beans and tomatoes with the garlic for 3 to 4 minutes, until the beans are just tender.",
      "Squeeze the lemon juice over the vegetables, slice the tuna, and serve."
    ]
  },
  {
    "id": "pork-chops-apple-onion",
    "image": "kitchen/pork-chops-apple-onion.jpg",
    "credit": "",
    "name": "Grilled Pork Chops with Apple and Onion",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 31, "carbs": 22, "fat": 10, "saturatedFat": 3.0, "calories": 304, "sodium": 210,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "2 boneless pork loin chops, trimmed (about 300 g total)",
      "1 apple, cored and sliced (organic preferred)",
      "1 onion, sliced",
      "1 teaspoon olive oil",
      "1 teaspoon Dijon mustard",
      "1/2 teaspoon dried thyme",
      "A pinch of salt (optional) and pepper",
      "1 red bell pepper, sliced"
    ],
    "steps": [
      "Season the pork chops with salt, pepper, and thyme.",
      "Warm the olive oil in a pan over medium-high heat.",
      "Cook the pork chops for 4 to 5 minutes a side, until the center reaches 145°F. Set aside to rest.",
      "In the same pan, cook the apple, onion, and pepper for 4 minutes, until softened.",
      "Stir in the mustard and a splash of water, scraping up the browned bits.",
      "Spoon the apple and onion over the pork chops and serve."
    ]
  },
  {
    "id": "chicken-vegetable-stir-fry",
    "image": "kitchen/chicken-vegetable-stir-fry.jpg",
    "credit": "",
    "name": "Chicken and Vegetable Stir-Fry with Brown Rice",
    "category": "Dinner",
    "time": 25,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 36, "carbs": 30, "fat": 8, "saturatedFat": 1.5, "calories": 340, "sodium": 360,
    "tags": [
      "dinner",
      "high-protein",
      "balanced-macros",
      "dairy-free",
      "egg-free",
      "nut-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 chicken breasts (about 300 g total), sliced into thin strips",
      "1 1/2 cups cooked brown rice, for serving",
      "1 red bell pepper, sliced",
      "2 cups broccoli florets",
      "1 carrot, sliced into thin rounds",
      "2 tablespoons low-sodium soy sauce",
      "1 tablespoon olive oil",
      "2 garlic cloves, minced",
      "1 teaspoon grated fresh ginger",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Cook the brown rice if you have not already, and keep it warm.",
      "Toss the chicken strips with half the soy sauce.",
      "Warm the olive oil in a large pan or wok over high heat.",
      "Cook the chicken until browned and cooked through, about 5 minutes. Set aside.",
      "In the same pan, cook the pepper, broccoli, and carrot for 3 to 4 minutes, until just tender.",
      "Add the garlic and ginger and cook 1 minute more.",
      "Return the chicken to the pan with the rest of the soy sauce and toss everything together.",
      "Serve over the brown rice."
    ]
  },
  {
    "id": "baked-ziti-kale-ricotta",
    "image": "kitchen/baked-ziti-kale-ricotta.jpg",
    "credit": "",
    "name": "Baked Ziti with Kale and Ricotta",
    "category": "Dinner",
    "time": 40,
    "difficulty": "Medium",
    "servings": 6,
    "protein": 17, "carbs": 36, "fat": 5, "saturatedFat": 2.5, "calories": 258, "sodium": 410,
    "tags": [
      "dinner",
      "balanced-macros",
      "vegetarian",
      "easy-prep",
      "nut-free"
    ],
    "ingredients": [
      "8 oz whole-grain ziti pasta (about 225 g)",
      "2 cups tomato sauce",
      "1 cup blended low-fat (1%) cottage cheese",
      "1 cup shredded part-skim mozzarella, divided",
      "2 cups chopped kale, stems removed",
      "1 cup broccoli florets, chopped small",
      "1 teaspoon olive oil",
      "1/2 teaspoon dried Italian herbs",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Heat the oven to 375°F and oil a baking dish.",
      "Cook the ziti in salted water until just tender, about 9 minutes, adding the kale and broccoli for the last 2 minutes. Drain.",
      "Stir the kale through the hot pasta until it is tender.",
      "Mix in the tomato sauce, cottage cheese, half the mozzarella, the herbs, salt, and pepper.",
      "Tip everything into the baking dish and scatter the rest of the mozzarella on top.",
      "Bake for 20 minutes, until the cheese is melted and bubbling.",
      "Let it sit for 5 minutes before serving."
    ]
  },
  {
    "id": "beef-vegetable-soup",
    "image": "kitchen/beef-vegetable-soup.jpg",
    "credit": "",
    "name": "Beef and Vegetable Soup",
    "category": "Dinner",
    "time": 50,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 29, "carbs": 21, "fat": 9, "saturatedFat": 2.5, "calories": 278, "sodium": 250,
    "tags": [
      "dinner",
      "high-protein",
      "gluten-free",
      "dairy-free",
      "egg-free",
      "nut-free",
      "budget-friendly",
      "easy-prep"
    ],
    "ingredients": [
      "1 1/2 lb beef stew meat, cut into small cubes",
      "6 cups low-sodium beef broth",
      "2 potatoes, peeled and diced",
      "3 carrots, sliced",
      "2 celery stalks, diced",
      "1 onion, chopped",
      "3 garlic cloves, minced",
      "1 tablespoon tomato paste",
      "2 cups chopped kale, stems removed",
      "1 teaspoon dried thyme",
      "1 tablespoon olive oil",
      "A pinch of salt (optional) and pepper",
      "Juice of 1/2 lemon"
    ],
    "steps": [
      "Warm the olive oil in a large pot over medium-high heat.",
      "Brown the beef on all sides, about 5 minutes. Set aside.",
      "In the same pot, cook the onion, carrots, and celery for 4 minutes, until softened.",
      "Stir in the garlic and tomato paste and cook 1 minute more.",
      "Return the beef to the pot with the potatoes, broth, thyme, salt, and pepper.",
      "Bring to a boil, then lower the heat and simmer for 30 minutes, until the beef is tender. Stir in the kale and simmer 5 minutes more, until tender.",
      "Stir in the lemon juice, taste, and add more salt or pepper if you like. Serve hot."
    ]
  },
  {
    "id": "veggie-fried-rice-egg",
    "image": "kitchen/veggie-fried-rice-egg.jpg",
    "credit": "",
    "name": "Veggie Fried Rice with Egg",
    "category": "Dinner",
    "time": 20,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 13, "carbs": 40, "fat": 11, "saturatedFat": 1.5, "calories": 320, "sodium": 380,
    "tags": [
      "dinner",
      "vegetarian",
      "balanced-macros",
      "easy-prep",
      "nut-free",
      "dairy-free"
    ],
    "ingredients": [
      "3 cups cooked brown rice, cooled",
      "2 cups cauliflower rice",
      "4 eggs, beaten",
      "1 cup frozen mixed vegetables (peas, carrots, corn)",
      "3 green onions, sliced",
      "2 tablespoons low-sodium soy sauce",
      "1 tablespoon olive oil",
      "2 garlic cloves, minced",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Warm half the olive oil in a large pan over medium-high heat.",
      "Pour in the eggs and scramble until just set, about 1 minute. Set aside.",
      "Warm the rest of the oil in the same pan and cook the garlic for 30 seconds.",
      "Add the frozen vegetables and cauliflower rice and cook for 3 minutes, until heated through.",
      "Add the rice and soy sauce and stir-fry for 3 minutes, until the rice is hot and lightly browned.",
      "Stir in the scrambled egg and green onions. Serve right away."
    ]
  },
  {
    "id": "cottage-cheese-toast-tomato",
    "image": "kitchen/cottage-cheese-toast-tomato.jpg",
    "credit": "",
    "name": "Cottage Cheese Toast with Tomato and Basil",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 17, "carbs": 29, "fat": 8, "saturatedFat": 3.5, "calories": 256, "sodium": 660,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian",
      "small-portions",
      "nut-free"
    ],
    "ingredients": [
      "1 slice whole-grain bread",
      "1/2 cup cottage cheese",
      "1 tomato, sliced",
      "4 fresh basil leaves",
      "1 teaspoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Toast the bread until golden.",
      "Spread the cottage cheese over the toast.",
      "Lay the tomato slices on top.",
      "Tear the basil over the top and drizzle with the olive oil.",
      "Season lightly and eat right away."
    ]
  },
  {
    "id": "banana-peanut-butter-smoothie",
    "image": "kitchen/banana-peanut-butter-smoothie.jpg",
    "credit": "",
    "name": "Banana Peanut Butter Smoothie",
    "category": "Breakfast",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 17, "carbs": 35, "fat": 10, "saturatedFat": 2.5, "calories": 295, "sodium": 70,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian",
      "gluten-free",
      "egg-free",
      "low-sodium"
    ],
    "ingredients": [
      "1/2 banana, peeled",
      "1/2 cup blueberries",
      "1 tablespoon peanut butter",
      "1/2 cup milk",
      "1/4 cup plain Greek yogurt",
      "4 ice cubes"
    ],
    "steps": [
      "Put the banana, blueberries, peanut butter, milk, yogurt, and ice in a blender.",
      "Blend until smooth, about 30 seconds.",
      "Pour into a glass and drink right away."
    ]
  },
  {
    "id": "savory-oatmeal-egg-kale",
    "image": "kitchen/savory-oatmeal-egg-kale.jpg",
    "credit": "",
    "name": "Savory Oatmeal with Egg and Kale",
    "category": "Breakfast",
    "time": 10,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 15, "carbs": 33, "fat": 12, "saturatedFat": 3.5, "calories": 300, "sodium": 280,
    "tags": [
      "breakfast",
      "high-protein",
      "easy-prep",
      "vegetarian",
      "small-portions",
      "nut-free"
    ],
    "ingredients": [
      "1/3 cup rolled oats",
      "2/3 cup water",
      "1 egg",
      "1 cup chopped kale, stems removed",
      "1 tablespoon grated Parmesan",
      "1 tablespoon ground flaxseed",
      "A pinch of salt (optional) and pepper",
      "80 g cherry tomatoes, halved (about 1/2 cup)"
    ],
    "steps": [
      "Cook the oats in the water over medium heat for 4 to 5 minutes, until thick.",
      "Stir in the kale and cherry tomatoes and cook 2 minutes, until the kale is tender and the tomatoes soften.",
      "Fry the egg in a small pan the way you like it.",
      "Stir the ground flaxseed into the oatmeal, spoon into a bowl, and top with the egg and Parmesan.",
      "Season lightly and eat right away."
    ]
  },
  {
    "id": "egg-salad-lettuce-cups",
    "image": "kitchen/egg-salad-lettuce-cups.jpg",
    "credit": "",
    "name": "Egg Salad Lettuce Cups",
    "category": "Lunch",
    "time": 15,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 15, "carbs": 4, "fat": 12, "saturatedFat": 3.2, "calories": 186, "sodium": 270,
    "tags": [
      "lunch",
      "high-protein",
      "low-carb",
      "small-portions",
      "easy-prep",
      "gluten-free",
      "nut-free",
      "vegetarian"
    ],
    "ingredients": [
      "4 eggs, hard-boiled and peeled",
      "3 tablespoons plain Greek yogurt",
      "1 teaspoon Dijon mustard",
      "2 green onions, sliced",
      "1 tablespoon fresh dill, chopped",
      "8 large lettuce leaves",
      "A pinch of salt (optional) and pepper",
      "1 teaspoon lemon juice",
      "40 g red bell pepper, finely diced (about 1/4 cup)"
    ],
    "steps": [
      "Chop the eggs and put them in a bowl.",
      "Stir in the yogurt, mustard, lemon juice, green onions, dill, red pepper, salt, and pepper.",
      "Spoon the egg salad into the lettuce leaves.",
      "Eat like a wrap, straight away."
    ]
  },
  {
    "id": "tomato-mozzarella-salad",
    "image": "kitchen/tomato-mozzarella-salad.jpg",
    "credit": "",
    "name": "Tomato and Mozzarella Salad",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 9, "carbs": 7, "fat": 9, "saturatedFat": 3.5, "calories": 145, "sodium": 230,
    "tags": [
      "snacks-smoothies",
      "vegetarian",
      "small-portions",
      "easy-prep",
      "gluten-free",
      "egg-free",
      "nut-free"
    ],
    "ingredients": [
      "2 large tomatoes, sliced",
      "56 g fresh part-skim mozzarella, sliced (about 2 oz)",
      "8 fresh basil leaves",
      "2 teaspoons olive oil",
      "1 teaspoon balsamic vinegar",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Lay the tomato and mozzarella slices on a plate, alternating them.",
      "Tuck the basil leaves between the slices.",
      "Drizzle with the olive oil and balsamic vinegar.",
      "Season lightly and serve right away."
    ]
  },
  {
    "id": "yogurt-herb-dip-veggies",
    "image": "kitchen/yogurt-herb-dip-veggies.jpg",
    "credit": "",
    "name": "Carrot and Cucumber Sticks with Yogurt Herb Dip",
    "category": "Snacks",
    "time": 10,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 14, "carbs": 17, "fat": 5, "saturatedFat": 0.5, "calories": 175, "sodium": 90,
    "tags": [
      "snacks-smoothies",
      "vegetarian",
      "small-portions",
      "easy-prep",
      "gluten-free",
      "egg-free",
      "nut-free",
      "low-sodium"
    ],
    "ingredients": [
      "1 cup plain Greek yogurt",
      "2 carrots, peeled and cut into sticks",
      "1 cucumber, cut into sticks",
      "1 tablespoon fresh dill, chopped",
      "1 garlic clove, minced",
      "1 lemon, juiced",
      "1 teaspoon olive oil",
      "1 tablespoon ground flaxseed",
      "A pinch of salt (optional) and pepper"
    ],
    "steps": [
      "Stir the yogurt, dill, garlic, lemon juice, olive oil, and ground flaxseed together in a small bowl.",
      "Season lightly with salt and pepper.",
      "Cut the carrots and cucumber into sticks.",
      "Serve the vegetables with the dip."
    ]
  },
  {
    "id": "citrus-mint-sparkling-refresher",
    "image": "kitchen/citrus-mint-sparkling-refresher.jpg",
    "credit": "",
    "name": "Citrus-Mint Sparkling Refresher",
    "category": "Mocktails",
    "cuisine": "Greek",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 1, "carbs": 17, "fat": 0, "saturatedFat": 0, "calories": 68, "sodium": 2,
    "tags": [
      "mocktails",
      "greek",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep",
      "low-calorie"
    ],
    "ingredients": [
      "1 large orange, freshly juiced",
      "1 lemon, freshly juiced",
      "6-8 fresh mint leaves",
      "1 cup cold sparkling water, unflavoured",
      "Ice",
      "Orange slices and mint sprigs, to garnish (optional)",
      "Stevia or monk fruit to taste (optional, only if more sweetness is wanted)"
    ],
    "steps": [
      "Juice the orange and lemon into a glass or small pitcher.",
      "Gently muddle the mint leaves at the bottom of the glass.",
      "Add ice, pour the sparkling water on top, and stir gently.",
      "Garnish with orange slices and mint sprigs and serve at once."
    ]
  },
  {
    "id": "limoncello-mocktail",
    "image": "kitchen/limoncello-mocktail.jpg",
    "credit": "",
    "name": "Limoncello Mocktail",
    "category": "Mocktails",
    "cuisine": "Italian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 2,
    "protein": 0, "carbs": 5, "fat": 0, "saturatedFat": 0, "calories": 20, "sodium": 1,
    "tags": [
      "mocktails",
      "italian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep",
      "low-calorie"
    ],
    "ingredients": [
      "1/2 cup fresh lemon juice (3-4 lemons)",
      "1 cup sparkling water or club soda",
      "Stevia or monk fruit to taste (start with a few drops liquid stevia or 1/2-1 tsp granulated stevia or monk fruit)",
      "Ice",
      "Lemon wheel and fresh mint or 5-6 basil leaves, to garnish"
    ],
    "steps": [
      "Juice the lemons.",
      "Stir the stevia or monk fruit into the lemon juice until dissolved.",
      "Slowly pour in the sparkling water and stir gently.",
      "Pour over ice and garnish with a lemon wheel and mint or basil."
    ]
  },
  {
    "id": "lavender-lemon-sparkler",
    "image": "kitchen/lavender-lemon-sparkler.jpg",
    "credit": "",
    "name": "Lavender-Lemon Sparkler",
    "category": "Mocktails",
    "cuisine": "French Mediterranean",
    "time": 15,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 0, "carbs": 3, "fat": 0, "saturatedFat": 0, "calories": 12, "sodium": 1,
    "tags": [
      "mocktails",
      "french",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep",
      "low-calorie"
    ],
    "ingredients": [
      "2 tsp dried culinary lavender (culinary grade only, never ornamental or fragrance lavender)",
      "2 tsp stevia or monk fruit sweetener",
      "250 ml boiling water",
      "2 tbsp lemon juice per glass",
      "2 tbsp lavender syrup per glass",
      "Sparkling water, to top up",
      "Ice"
    ],
    "steps": [
      "Put the lavender, stevia or monk fruit, and boiling water in a small saucepan. Bring to a gentle boil, then turn to very low and simmer 7-10 minutes until the colour fades from the lavender. Strain and cool. This is the lavender syrup.",
      "Per glass: add 2 tbsp lavender syrup and 2 tbsp lemon juice.",
      "Top with sparkling water, add ice, and garnish."
    ]
  },
  {
    "id": "pomegranate-thyme-cooler",
    "image": "kitchen/pomegranate-thyme-cooler.jpg",
    "credit": "",
    "name": "Pomegranate-Thyme Cooler",
    "category": "Mocktails",
    "cuisine": "Sardinian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 0, "carbs": 6, "fat": 0, "saturatedFat": 0, "calories": 22, "sodium": 1,
    "tags": [
      "mocktails",
      "sardinian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep",
      "low-calorie"
    ],
    "ingredients": [
      "2 x 12 oz cans sparkling berry water, chilled (or plain sparkling water)",
      "4 oz (1/2 cup) 100% pomegranate juice, no added sugar",
      "A few fresh cranberries, to garnish",
      "Fresh thyme sprigs"
    ],
    "steps": [
      "Per glass: add 1/2 can sparkling water and 1 oz pomegranate juice.",
      "Add 2-3 cranberries and top with 1-2 thyme sprigs.",
      "Serve at once."
    ]
  },
  {
    "id": "shikuwasa-mint-sparkler",
    "image": "kitchen/shikuwasa-mint-sparkler.jpg",
    "credit": "",
    "name": "Shikuwasa-Mint Sparkler",
    "category": "Mocktails",
    "cuisine": "Okinawan",
    "time": 5,
    "difficulty": "Easy",
    "servings": 1,
    "protein": 0, "carbs": 3, "fat": 0, "saturatedFat": 0, "calories": 12, "sodium": 0,
    "tags": [
      "mocktails",
      "okinawan",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep",
      "low-calorie"
    ],
    "ingredients": [
      "2 tbsp (30 ml) 100% shikuwasa juice (check the label: 100% juice, no added sugar; avoid sweetened soda or syrup versions)",
      "1/2 cup (120 ml) cold sparkling water",
      "A few fresh mint leaves",
      "Ice",
      "Stevia or monk fruit to taste (optional)",
      "If shikuwasa is unavailable: lime juice with a small squeeze of mandarin or orange"
    ],
    "steps": [
      "Pour the sparkling water into a tall glass first to keep the bubbles.",
      "Add the shikuwasa juice and stir gently.",
      "Add ice and mint, torn or slapped to release the oils. Serve at once.",
      "Do not drink the juice neat. It is very acidic."
    ]
  },
  {
    "id": "lemon-herb-greek-seasoning",
    "image": "kitchen/lemon-herb-greek-seasoning.jpg",
    "credit": "",
    "name": "Lemon-Herb Greek Seasoning",
    "category": "Spices",
    "cuisine": "Greek",
    "time": 5,
    "difficulty": "Easy",
    "servings": 9,
    "protein": 0, "carbs": 0, "fat": 0, "saturatedFat": 0, "calories": 0, "sodium": 0,
    "tags": [
      "spices",
      "greek",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1 tbsp dried oregano",
      "1 tsp garlic powder",
      "1 tsp onion powder",
      "1 tsp lemon zest or dried lemon peel",
      "1/2 tsp black pepper",
      "1/2 tsp dried rosemary",
      "1/2 tsp dried dill",
      "1/4 tsp red pepper flakes",
      "No salt (salt is omitted entirely for the lowest sodium; salt the dish separately if needed)"
    ],
    "steps": [
      "Whisk everything together in a small bowl, breaking up any clumps.",
      "Use 1-2 tsp per 500 g chicken, fish, or vegetables.",
      "Store the base blend airtight, cool and dry, up to 2 months. Use dried lemon peel (not fresh zest) if storing in the pantry; with fresh zest, refrigerate and use within 2-3 days."
    ]
  },
  {
    "id": "homemade-italian-seasoning",
    "image": "kitchen/homemade-italian-seasoning.jpg",
    "credit": "",
    "name": "Homemade Italian Seasoning",
    "category": "Spices",
    "cuisine": "Italian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 36,
    "protein": 0, "carbs": 0, "fat": 0, "saturatedFat": 0, "calories": 0, "sodium": 0,
    "tags": [
      "spices",
      "italian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "3 tbsp dried oregano",
      "3 tbsp dried basil",
      "3 tbsp dried parsley",
      "2 tbsp dried marjoram",
      "1 tbsp ground thyme",
      "2 tsp crushed dried rosemary"
    ],
    "steps": [
      "Measure all six dried herbs into a clean, dry bowl or mason jar.",
      "Stir or shake until combined.",
      "Store airtight, cool, dark and dry, and use within 6 months to 1 year. Start with 1 tsp per dish and adjust."
    ]
  },
  {
    "id": "herbes-de-provence",
    "image": "kitchen/herbes-de-provence.jpg",
    "credit": "",
    "name": "Herbes de Provence",
    "category": "Spices",
    "cuisine": "French Mediterranean",
    "time": 5,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 0, "carbs": 0, "fat": 0, "saturatedFat": 0, "calories": 0, "sodium": 0,
    "tags": [
      "spices",
      "french",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "2 tsp dried marjoram",
      "2 tsp dried thyme",
      "1 tsp dried basil",
      "1 tsp dried rosemary, crumbled",
      "1 tsp dried sage",
      "1/4 tsp dried lavender (optional; leave it out if it tastes soapy to you)",
      "1/8 tsp ground fennel"
    ],
    "steps": [
      "Combine all ingredients in a bowl.",
      "Store airtight at room temperature up to 2 months.",
      "Use 1-2 tsp per dish on roast chicken, grilled fish, roast vegetables, ratatouille, and soups."
    ]
  },
  {
    "id": "fennel-saffron-myrtle-seasoning",
    "image": "kitchen/fennel-saffron-myrtle-seasoning.jpg",
    "credit": "",
    "name": "Fennel-Saffron-Myrtle Seasoning",
    "category": "Spices",
    "cuisine": "Sardinian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 6,
    "protein": 0, "carbs": 1, "fat": 0, "saturatedFat": 0, "calories": 4, "sodium": 0,
    "tags": [
      "spices",
      "sardinian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "2 tsp wild fennel seeds, lightly crushed",
      "2 tsp dried thyme",
      "1 tsp dried rosemary, crushed",
      "1 tsp dried myrtle berries, crushed (or 1 tsp dried myrtle leaves if berries are unavailable; if neither is available, use 1 tsp dried bay leaf, crumbled)",
      "A pinch of saffron threads, crumbled (about 1/8 tsp, optional; omit and the blend still works)"
    ],
    "steps": [
      "Mix everything in a small jar and shake before use.",
      "Use 1-2 tsp per 500 g fish, chicken, or vegetables, rubbed with a little olive oil and lemon.",
      "Good on grilled fish, chicken, roast fennel or cauliflower, and in bean and barley minestrone."
    ]
  },
  {
    "id": "ginger-turmeric-seasoning",
    "image": "kitchen/ginger-turmeric-seasoning.jpg",
    "credit": "",
    "name": "Ginger-Turmeric Seasoning",
    "category": "Spices",
    "cuisine": "Okinawan",
    "time": 5,
    "difficulty": "Easy",
    "servings": 15,
    "protein": 0, "carbs": 1, "fat": 0, "saturatedFat": 0, "calories": 4, "sodium": 0,
    "tags": [
      "spices",
      "okinawan",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1 tbsp ground coriander",
      "1 tsp garlic powder",
      "1 tsp ground turmeric",
      "1/2 tsp cayenne",
      "2 tsp ground ginger"
    ],
    "steps": [
      "Combine all ingredients and store sealed at room temperature.",
      "Use 1-2 tsp per dish, mixed with a little olive oil or citrus juice as a rub, or stirred into soups and stir-fries."
    ]
  },
  {
    "id": "greek-yogurt-chicken-marinade",
    "image": "kitchen/greek-yogurt-chicken-marinade.jpg",
    "credit": "",
    "name": "Greek Yogurt Chicken Marinade",
    "category": "Marinades",
    "cuisine": "Greek",
    "time": 15,
    "difficulty": "Easy",
    "servings": 3,
    "protein": 55, "carbs": 2, "fat": 16, "saturatedFat": 3, "calories": 387, "sodium": 328,
    "tags": [
      "marinades",
      "greek",
      "high-protein",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1 1/2 lb boneless, skinless chicken breasts or thighs",
      "1/2 cup plain Greek yogurt (low-fat or 2%, unsweetened)",
      "4 cloves garlic, minced",
      "2 tbsp extra-virgin olive oil",
      "Juice of 1 small lemon (plus zest if liked)",
      "2 tsp dried oregano",
      "1 tsp dried thyme",
      "1/4 tsp salt",
      "1 tsp paprika",
      "1/2 tsp ground cumin"
    ],
    "steps": [
      "If using breasts, pound to even thickness and trim fat.",
      "Whisk the yogurt, garlic, oil, lemon juice and zest, oregano, thyme, salt, paprika, and cumin.",
      "Add the chicken, turn to coat, cover, and refrigerate at least 2 hours, up to 24 hours.",
      "Rest 20 minutes out of the fridge, then grill 8-12 minutes, bake at 425 F for 14-20 minutes, or air-fry at 375 F for 10-14 minutes, to 165 F inside."
    ]
  },
  {
    "id": "tuscan-lemon-garlic-herb-marinade",
    "image": "kitchen/tuscan-lemon-garlic-herb-marinade.jpg",
    "credit": "",
    "name": "Tuscan Lemon, Garlic and Herb Marinade",
    "category": "Marinades",
    "cuisine": "Italian",
    "time": 10,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 53, "carbs": 4, "fat": 16, "saturatedFat": 3, "calories": 387, "sodium": 414,
    "tags": [
      "marinades",
      "italian",
      "high-protein",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "2 lb chicken, fish, or vegetables",
      "1/3 cup olive oil",
      "2 lemons, zested and juiced",
      "6 cloves garlic, grated or crushed",
      "4 sprigs fresh rosemary, roughly chopped",
      "1 tbsp dried oregano",
      "1/2 tsp crushed red pepper flakes (optional)",
      "1/2 tsp salt",
      "1 tsp ground black pepper"
    ],
    "steps": [
      "Whisk everything in a bowl or shake in a jar or bag.",
      "Add the chicken, fish, or vegetables and coat.",
      "Marinate: fish or seafood 20 minutes to 1 hour; chicken 4-6 hours; vegetables 20 minutes to 24 hours. Do not over-marinate in the lemon juice or the texture turns mushy.",
      "Grill or roast as usual. The marinade alone keeps in the fridge up to 5 days."
    ]
  },
  {
    "id": "herbes-de-provence-lemon-marinade",
    "image": "kitchen/herbes-de-provence-lemon-marinade.jpg",
    "credit": "",
    "name": "Herbes de Provence Lemon Marinade",
    "category": "Marinades",
    "cuisine": "French Mediterranean",
    "time": 10,
    "difficulty": "Easy",
    "servings": 3,
    "protein": 53, "carbs": 2, "fat": 21, "saturatedFat": 4, "calories": 427, "sodium": 126,
    "tags": [
      "marinades",
      "french",
      "high-protein",
      "low-sodium",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1-1 1/2 lb chicken, fish, or vegetables",
      "6 tbsp (1/4 cup plus 2 tbsp) olive oil",
      "2 tbsp lemon juice",
      "2-4 tsp Herbes de Provence",
      "2 garlic cloves, crushed",
      "Black pepper to taste",
      "No added salt"
    ],
    "steps": [
      "Mix the oil, lemon juice, Herbes de Provence, garlic, and pepper.",
      "Coat the chicken, fish, or vegetables and grill, roast, or barbecue.",
      "For stronger flavour, refrigerate chicken in the marinade before cooking (30 minutes for fish, 2-4 hours for chicken; do not leave fish in citrus for hours)."
    ]
  },
  {
    "id": "myrtle-lemon-grilled-fish",
    "image": "kitchen/myrtle-lemon-grilled-fish.jpg",
    "credit": "",
    "name": "Myrtle-Lemon Grilled Fish",
    "category": "Marinades",
    "cuisine": "Sardinian",
    "time": 20,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 35, "carbs": 1, "fat": 19, "saturatedFat": 4, "calories": 320, "sodium": 244,
    "tags": [
      "marinades",
      "sardinian",
      "high-protein",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "4 whole fish about 1 lb (450 g) each, or 4 palm-sized fillets of sea bass, mullet, or swordfish",
      "3 tbsp extra-virgin olive oil, for the fish and grate",
      "2 garlic cloves, lightly crushed",
      "8 fresh myrtle sprigs (or 8 bay leaves if myrtle is unavailable)",
      "1 lemon, thinly sliced",
      "8 flat-leaf parsley stems",
      "Black pepper",
      "1/2 tsp coarse salt total for the 4 fish (or omit it)",
      "To finish: 4 tbsp best olive oil, 2 lemons halved, 1 tbsp chopped parsley"
    ],
    "steps": [
      "Scale and gut the fish, scrape the dark membrane inside the cavity until pale, rinse, and dry. Score the back shallowly.",
      "Rub lightly with salt and pepper, rest 20 minutes, and pat dry again.",
      "Put 2 myrtle sprigs, 2 lemon slices, 1/2 crushed garlic clove, and 2 parsley stems in each cavity (for fillets, lay them on top). Brush the skin with oil.",
      "Grill over hot coals, turn once, 7-9 minutes per side for a 1 lb fish, to 131-135 F in the thickest part. Rest 3 minutes.",
      "Dress at the table only with a spiral of olive oil and a squeeze of lemon. Do not wet-marinate fish before grilling; a marinade wets the surface and prevents browning."
    ]
  },
  {
    "id": "citrus-soy-sesame-marinade",
    "image": "kitchen/citrus-soy-sesame-marinade.jpg",
    "credit": "",
    "name": "Citrus-Soy-Sesame Marinade",
    "category": "Marinades",
    "cuisine": "Okinawan",
    "time": 10,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 36, "carbs": 2, "fat": 2, "saturatedFat": 0, "calories": 170, "sodium": 438,
    "tags": [
      "marinades",
      "okinawan",
      "high-protein",
      "gluten-free",
      "easy-prep"
    ],
    "ingredients": [
      "1-1 1/2 lb mahi mahi or other thick fish, extra-firm tofu, or boneless skinless chicken",
      "2 tbsp low-sodium soy sauce",
      "2 tbsp water",
      "1 tbsp rice vinegar",
      "Juice of 1 orange (about 2 tbsp)",
      "Juice of 1/2 lime (about 1 tbsp)",
      "1 tsp sesame oil",
      "2 scallions, sliced",
      "1 tsp sriracha (optional)"
    ],
    "steps": [
      "Put the fish, tofu, or chicken in a glass dish.",
      "Whisk the soy sauce, water, vinegar, orange and lime juice, sesame oil, and scallions (and sriracha if using); pour over and flip to coat.",
      "Marinate 10-30 minutes for fish or tofu, up to 2 hours for chicken.",
      "Bake at 400 F for about 20 minutes until the fish flakes easily, or grill or pan-fry chicken or tofu to 165 F or heated through. Discard the used marinade."
    ]
  },
  {
    "id": "mediterranean-salad-dressing",
    "image": "kitchen/mediterranean-salad-dressing.jpg",
    "credit": "",
    "name": "Mediterranean Salad Dressing",
    "category": "Salad Dressings",
    "cuisine": "Greek",
    "time": 5,
    "difficulty": "Easy",
    "servings": 16,
    "protein": 0, "carbs": 1, "fat": 14, "saturatedFat": 2, "calories": 130, "sodium": 0,
    "tags": [
      "salad-dressings",
      "greek",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "2 cloves garlic",
      "1 tbsp ground oregano",
      "1 cup extra-virgin olive oil",
      "1/2 cup fresh lemon juice"
    ],
    "steps": [
      "Mix all ingredients with a whisk or immersion blender.",
      "Use 1 tbsp per serving. Olive oil is calorie-dense, so measure the portion rather than pouring freely."
    ]
  },
  {
    "id": "low-sodium-italian-dressing",
    "image": "kitchen/low-sodium-italian-dressing.jpg",
    "credit": "",
    "name": "Low-Sodium Italian Dressing",
    "category": "Salad Dressings",
    "cuisine": "Italian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 0, "carbs": 1, "fat": 14, "saturatedFat": 2, "calories": 125, "sodium": 6,
    "tags": [
      "salad-dressings",
      "italian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 cup extra-virgin olive oil",
      "1/4 cup white-wine or red-wine vinegar (or a mix)",
      "2 tsp balsamic vinegar (optional)",
      "2 tbsp water",
      "4-5 drops liquid stevia or a pinch of monk fruit (or omit the sweetener entirely)",
      "2 tsp lemon juice",
      "1 tbsp grated Parmesan, optional (omit for 1 mg sodium per serving)",
      "1 tsp garlic powder",
      "3/4 tsp dried parsley",
      "1/2 tsp dried basil",
      "1/8 tsp dried oregano",
      "1/8 tsp red pepper flakes",
      "Black pepper to taste"
    ],
    "steps": [
      "Put everything in a jar with a tight lid and shake vigorously, or immersion-blend, until emulsified.",
      "Taste and adjust the vinegar and pepper.",
      "Store sealed in the fridge 2-3 weeks and shake before each use. Separation is normal.",
      "Doubles as a marinade: use 1/2 cup per lb chicken, 2-4 hours."
    ]
  },
  {
    "id": "nicoise-lemon-dijon-vinaigrette",
    "image": "kitchen/nicoise-lemon-dijon-vinaigrette.jpg",
    "credit": "",
    "name": "Nicoise Lemon-Dijon Vinaigrette",
    "category": "Salad Dressings",
    "cuisine": "French Mediterranean",
    "time": 10,
    "difficulty": "Easy",
    "servings": 12,
    "protein": 0, "carbs": 2, "fat": 14, "saturatedFat": 2, "calories": 128, "sodium": 10,
    "tags": [
      "salad-dressings",
      "french",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1/2 cup lemon juice (2-3 lemons)",
      "3/4 cup extra-virgin olive oil",
      "1 medium shallot, minced (about 3 tbsp)",
      "1 tbsp minced fresh thyme leaves",
      "2 tbsp minced fresh basil leaves",
      "2 tsp minced fresh oregano leaves",
      "1 tsp Dijon mustard",
      "Black pepper to taste",
      "No added salt"
    ],
    "steps": [
      "Whisk the lemon juice, oil, shallot, thyme, basil, oregano, and mustard in a medium bowl.",
      "Season with pepper only.",
      "Use 2-3 tbsp per composed salad of lettuce, green beans, tomatoes, potatoes in small portions, egg, and a palm-sized portion of olive-oil-packed tuna, drained.",
      "Use the dressing on the salad without anchovies, and with olives and capers rinsed and in small amounts."
    ]
  },
  {
    "id": "citrus-basil-vinaigrette",
    "image": "kitchen/citrus-basil-vinaigrette.jpg",
    "credit": "",
    "name": "Citrus-Basil Vinaigrette",
    "category": "Salad Dressings",
    "cuisine": "Sardinian",
    "time": 5,
    "difficulty": "Easy",
    "servings": 4,
    "protein": 0, "carbs": 3, "fat": 14, "saturatedFat": 2, "calories": 130, "sodium": 0,
    "tags": [
      "salad-dressings",
      "sardinian",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1/4 cup extra-virgin olive oil",
      "2 tbsp fresh lemon juice",
      "1 tbsp fresh orange juice",
      "1 small garlic clove, minced",
      "1 tbsp fresh basil, finely chopped",
      "Black pepper to taste",
      "No added salt and no added sweetener"
    ],
    "steps": [
      "Whisk the oil, lemon juice, orange juice, garlic, basil, and pepper.",
      "Toss over warm fregola with roast cauliflower, rinsed green olives in small amounts, and arugula.",
      "Serve warm or at room temperature.",
      "Add a palm-sized portion of grilled fish or chicken, or a serving of chickpeas or beans, for GLP-1 protein. Pecorino only as 1 tbsp shaved, if wanted at all."
    ]
  },
  {
    "id": "sesame-ginger-dressing",
    "image": "kitchen/sesame-ginger-dressing.jpg",
    "credit": "",
    "name": "Sesame-Ginger Dressing",
    "category": "Salad Dressings",
    "cuisine": "Okinawan",
    "time": 5,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 1, "carbs": 1, "fat": 9, "saturatedFat": 1, "calories": 83, "sodium": 288,
    "tags": [
      "salad-dressings",
      "okinawan",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1/4 cup low-sodium soy sauce or tamari",
      "1/4 cup rice vinegar, unseasoned (seasoned vinegar has added sugar and salt)",
      "3 tbsp toasted sesame oil",
      "2 tbsp neutral oil (avocado, canola, or light olive oil)",
      "Stevia or monk fruit to taste, or omit the sweetener (add 1 tsp lime or orange zest for brightness)",
      "1 tsp fresh ginger, finely grated",
      "1 clove garlic, finely grated or minced",
      "1/4 tsp black pepper",
      "1 tbsp toasted sesame seeds, optional (omit to keep oxalate as low as possible)"
    ],
    "steps": [
      "Whisk the soy sauce, vinegar, sweetener if using, ginger, garlic, and pepper.",
      "While whisking vigorously, slowly drizzle in the sesame oil, then the neutral oil, to emulsify.",
      "Stir in the sesame seeds just before serving, if using.",
      "Use only 1-2 tbsp per serving. Store airtight in the fridge up to 2 weeks; let it sit 10-15 minutes at room temperature and shake before use."
    ]
  },
  {
    "id": "pistou-basil-garlic-sauce",
    "image": "kitchen/pistou-basil-garlic-sauce.jpg",
    "credit": "",
    "name": "Pistou Basil-Garlic Sauce",
    "category": "Salad Dressings",
    "cuisine": "French Mediterranean",
    "time": 10,
    "difficulty": "Easy",
    "servings": 8,
    "protein": 0, "carbs": 0, "fat": 5, "saturatedFat": 1, "calories": 46, "sodium": 0,
    "tags": [
      "salad-dressings",
      "french",
      "low-sodium",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1-2 garlic cloves",
      "3 large handfuls basil leaves",
      "2-4 tbsp extra-virgin olive oil",
      "A pinch of salt, or omit it",
      "No pine nuts and no cheese in the pot (cheese is passed separately)"
    ],
    "steps": [
      "Pound the garlic, then add the basil a handful at a time, then work in the olive oil until it forms a paste.",
      "Stir a spoonful into each bowl of vegetable or bean soup at the table. Do not boil it."
    ]
  },
  {
    "id": "olive-tapenade-condiment",
    "image": "kitchen/olive-tapenade-condiment.jpg",
    "credit": "",
    "name": "Olive Tapenade Condiment",
    "category": "Salad Dressings",
    "cuisine": "French Mediterranean",
    "time": 10,
    "difficulty": "Easy",
    "servings": 16,
    "protein": 0, "carbs": 1, "fat": 5, "saturatedFat": 1, "calories": 49, "sodium": 200,
    "tags": [
      "salad-dressings",
      "french",
      "gluten-free",
      "vegetarian",
      "vegan",
      "easy-prep"
    ],
    "ingredients": [
      "1 1/2 cups pitted olives (Castelvetrano and Leccino), rinsed",
      "1/4 cup parsley",
      "3 tbsp extra-virgin olive oil",
      "Red pepper flakes to taste",
      "No anchovies and no added salt"
    ],
    "steps": [
      "Rinse the brined olives well and omit the anchovies and any added salt.",
      "Pulse the olives, parsley, olive oil, and red pepper flakes until coarsely chopped, not smooth.",
      "Use no more than 1 tbsp per person as a flavour condiment on grilled fish or vegetables, not as a spread in quantity.",
      "Do not make it a daily item for high blood pressure or kidney disease."
    ]
  }
];
let kitchenFilter = "all";
let kitchenSearch = ""; // v053: text typed in the Kitchen search box
let kitchenLimit = 30; // recipes shown; "Show more" loads the next 30
const kitchenServings = {}; // recipe id -> servings to add (default 1)
const kitchenAddedAt = {}; // recipe id -> timestamp of last Add to Today

function kitchenIsSaved(id) {
  return store.recipes.some((r) => r.kitchenId === id);
}
/* The macros are stored as fields on the saved entry and shown as chips
   on the saved recipe card, so the body is Ingredients and Steps only. */
function kitchenBodyText(r) {
  return "Ingredients\n" + r.ingredients.map((i) => "- " + i).join("\n")
    + "\n\nSteps\n" + r.steps.map((s, i) => (i + 1) + ". " + s).join("\n");
}
/* Add a Kitchen recipe to today (v037): one macro entry for the day,
   the same path as the Log food form, so entries, snapshots, and the
   backup cap behave exactly as for logging food. Calories come from
   the macros via the existing 4/4/9 calculation. Shared by the Kitchen
   cards and the meal ideas, so both add the same way. */
function addKitchenToToday(id, servings) {
  const r = KITCHEN_RECIPES.find((x) => x.id === id);
  if (!r) return;
  const n = servings || kitchenServings[id] || 1;
  store.protein.push({ id: uid(), date: viewedDateStr(), grams: r.protein * n, carbs: r.carbs * n, fat: r.fat * n, food: r.name, calories: r.calories * n });
  saveStore();
  renderToday();
  kitchenAddedAt[id] = Date.now();
  renderKitchen();
  setTimeout(() => { delete kitchenAddedAt[id]; renderKitchen(); }, 2500);
}

/* Meal ideas for today (v037): Kitchen recipes whose
   per-serving macros fit inside what is left of today's goals, so a
   suggestion never pushes a goal over. Ranked by protein, most first,
   top three, one serving each, with the same Add to Today action as
   the Kitchen cards. Local only, no new data leaves the device. */
function renderMealIdeas() {
  const box = document.getElementById("meal-ideas");
  if (!box) return;
  const pGoal = Number(store.settings.proteinGoal) || 0;
  const cGoal = Number(store.settings.carbGoal) || 0;
  const fGoal = Number(store.settings.fatGoal) || 0;
  const t = viewedDateStr();
  let html;
  if (!pGoal || !cGoal || !fGoal) {
    html = "<h3>Meal ideas for today</h3>"
      + "<p class=\"muted\" style=\"font-size:.9em\">Set macro goals in Settings to see ideas for what is left.</p>"
      + "<button type=\"button\" class=\"btn btn-small\" data-goto=\"settings\">Set goals in Settings</button>";
  } else {
    const pLeft = pGoal - sumForDate(store.protein, t, "grams");
    const cLeft = cGoal - sumForDate(store.protein, t, "carbs");
    const fLeft = fGoal - sumForDate(store.protein, t, "fat");
    if (pLeft <= 0 && cLeft <= 0 && fLeft <= 0) {
      html = "<h3>Meal ideas for today</h3>"
        + "<p class=\"muted\" style=\"font-size:.9em\">Goals met for today. Nice work.</p>";
    } else {
      const fits = kitchenVisibleRecipes().filter((r) => r.protein <= pLeft && r.carbs <= cLeft && r.fat <= fLeft)
        .sort((a, b) => b.protein - a.protein).slice(0, 3);
      if (!fits.length) {
        html = "<h3>Meal ideas for today</h3>"
          + "<p class=\"muted\" style=\"font-size:.9em\">Nothing fits what is left. Try a snack from Your foods.</p>";
      } else {
        html = "<h3>Meal ideas for today</h3>"
          + "<p class=\"muted\" style=\"font-size:.9em\">Fits what is left: "
          + Math.max(0, Math.round(pLeft)) + "g protein, "
          + Math.max(0, Math.round(cLeft)) + "g carbs, "
          + Math.max(0, Math.round(fLeft)) + "g fat.</p>"
          + fits.map((r) => {
            const added = kitchenAddedAt[r.id] && Date.now() - kitchenAddedAt[r.id] < 2500;
            return "<div class=\"entry-row\" data-meal-idea=\"" + r.id + "\">"
              + "<div style=\"flex:1\"><strong>" + escapeHtml(r.name) + "</strong>"
              + " <span class=\"muted\" style=\"font-size:.85em\">" + r.protein + "g protein, " + r.carbs + "g carbs, " + r.fat + "g fat, " + r.calories + " cal</span></div>"
              + "<button type=\"button\" class=\"btn btn-small btn-primary\" data-kitchen-add=\"" + r.id + "\">" + (added ? "Added to today \u2713" : "Add to Today's Nutrition") + "</button>"
              + "</div>";
          }).join("")
          + "<p class=\"muted\" style=\"font-size:.85em\">Per serving. Nutrition is estimated from USDA values.</p>";
      }
    }
  }
  box.innerHTML = html;
  const goBtn = box.querySelector("[data-goto]");
  if (goBtn) goBtn.addEventListener("click", () => showTab("settings"));
  box.querySelectorAll("[data-kitchen-add]").forEach((btn) => btn.addEventListener("click", () => addKitchenToToday(btn.dataset.kitchenAdd, 1)));
}

/* Quick and easy pool (v049, R-07): recipes ready in 15 minutes or
   less, or tagged Easy Prep. The Quick and easy filter shows this pool. */
function kitchenQuickPool() {
  return kitchenVisibleRecipes().filter((r) => r.time <= 15 || r.tags.includes("easy-prep"));
}

/* One photo card (v039): photo, category chip, name, and calories, with
   a bookmark to save it. Shared by the featured row and the full list.
   Tapping the card opens the recipe; the bookmark saves it. Our own
   words and layout, in our colors. */
const BOOKMARK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>`;
const BOOKMARK_SAVED_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#E8B54A" stroke="#87692B" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4.5L6 21z"/></svg>`;
/* Recipe source line (v048): the American Heart Association recipes
   carry a source field and a sourceUrl. The modal shows the full
   attribution with the source as a link; cards show the plain text. */
function recipeSourceHtml(r) {
  if (!r || !r.source) return "";
  const text = String(r.source);
  const url = r.sourceUrl ? String(r.sourceUrl) : "";
  if (!url) return `<p class="kitchen-source">${escapeHtml(text)}</p>`;
  const name = "American Heart Association";
  const idx = text.indexOf(name);
  if (idx === -1) return `<p class="kitchen-source">${escapeHtml(text)} (<a href="${escapeHtml(url)}" target="_blank" rel="noopener">Source</a>)</p>`;
  return `<p class="kitchen-source">${escapeHtml(text.slice(0, idx))}<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${name}</a>${escapeHtml(text.slice(idx + name.length))}</p>`;
}
function kitchenPhotoCardHtml(r, hidden) {
  const saved = kitchenIsSaved(r.id);
  const photo = r.image
    ? `<img class="kitchen-photo" src="${escapeHtml(r.image)}" alt="" loading="lazy">`
    : `<span class="recipe-placeholder"><img src="icons/lotus-gold-only-transparent.png" alt=""></span>`;
  return `<article class="kitchen-photo-card">
    <button type="button" class="kitchen-photo-open" data-kitchen-open="${r.id}" aria-label="${escapeHtml(r.category)} ${escapeHtml(r.name)} ${r.calories} cal${r.source ? " " + escapeHtml(r.source) : ""}. See recipe.">
      <span class="kitchen-photo-wrap">${photo}<span class="kitchen-chip-tag">${escapeHtml(r.category)}</span></span>
      <span class="kitchen-photo-body"><strong>${escapeHtml(r.name)}</strong> <span class="muted">${r.calories} cal</span></span>
      ${r.source ? `<span class="kitchen-source">${escapeHtml(r.source)}</span>` : ""}
    </button>
    <button type="button" class="kitchen-bookmark" data-kitchen-save="${r.id}" aria-pressed="${saved ? "true" : "false"}" aria-label="${saved ? "Remove " : "Save "}${escapeHtml(r.name)}">${saved ? BOOKMARK_SAVED_SVG : BOOKMARK_SVG}</button>
    ${hidden
      ? `<button type="button" class="btn btn-small kitchen-hide" data-kitchen-unhide="${r.id}" aria-label="Unhide ${escapeHtml(r.name)}">Unhide</button>`
      : `<button type="button" class="btn btn-small kitchen-hide" data-kitchen-hide="${r.id}" aria-label="Hide ${escapeHtml(r.name)}">Hide</button>`}
  </article>`;
}
function toggleKitchenSave(id) {
  const r = KITCHEN_RECIPES.find((x) => x.id === id);
  if (!r) return;
  if (kitchenIsSaved(r.id)) {
    store.recipes = store.recipes.filter((x) => x.kitchenId !== r.id);
  } else {
    store.recipes.push({ id: uid(), title: r.name, body: kitchenBodyText(r), date: viewedDateStr(), kitchenId: r.id, image: r.image || "", credit: r.credit || "", source: r.source || "", sourceUrl: r.sourceUrl || "", protein: r.protein, carbs: r.carbs, fat: r.fat, calories: r.calories, servings: r.servings });
  }
  saveStore();
  renderRecipes();
}
/* Hidden built-in Kitchen recipes: ids only, stored on this device in
   store.hiddenKitchen. Hiding removes a recipe from this user's Kitchen
   view only. The recipe is not deleted and still exists for everyone
   else; a copy already saved to My recipes is untouched. */
function kitchenIsHidden(id) {
  return (store.hiddenKitchen || []).includes(id);
}
function kitchenVisibleRecipes() {
  return KITCHEN_RECIPES.filter((r) => !kitchenIsHidden(r.id));
}
function hideKitchenRecipe(id) {
  if (!KITCHEN_RECIPES.some((r) => r.id === id)) return;
  /* Focus must not drop to the body when the Hide button (on a card or
     in the recipe modal) is removed by the re-render below. Remember
     the next visible recipe first, so focus can move to its card. */
  const hideHadFocus = document.activeElement && document.activeElement.closest
    ? !!document.activeElement.closest("[data-kitchen-hide], [data-modal-kitchen-hide]")
    : false;
  const visibleBefore = kitchenVisibleRecipes();
  const hideIdx = visibleBefore.findIndex((r) => r.id === id);
  const nextVisible = visibleBefore.filter((r) => r.id !== id)[Math.min(hideIdx, visibleBefore.length - 2)];
  if (!kitchenIsHidden(id)) store.hiddenKitchen.push(id);
  saveStore();
  closeRecipeModal();
  renderKitchen();
  if (hideHadFocus) {
    const nextBtn = nextVisible
      ? document.querySelector('[data-kitchen-open="' + nextVisible.id + '"]')
      : null;
    if (nextBtn) nextBtn.focus();
    else {
      const searchInput = document.getElementById("kitchen-search-input");
      if (searchInput) searchInput.focus();
    }
  }
}
function unhideKitchenRecipe(id) {
  /* Focus must not drop to the body when the Show button is removed
     by the re-render below. Move focus to the recipe's card in the
     Kitchen list, or to the Hidden recipes summary when it is still
     there, or to the Kitchen search box. */
  const showHadFocus = document.activeElement && document.activeElement.closest
    ? !!document.activeElement.closest("[data-kitchen-unhide]")
    : false;
  store.hiddenKitchen = (store.hiddenKitchen || []).filter((x) => x !== id);
  saveStore();
  renderKitchen();
  if (!showHadFocus) return;
  const cardBtn = document.querySelector('[data-kitchen-open="' + id + '"]');
  if (cardBtn) { cardBtn.focus(); return; }
  const summary = document.querySelector("#kitchen-hidden summary");
  if (summary) { summary.focus(); return; }
  const searchInput = document.getElementById("kitchen-search-input");
  if (searchInput) searchInput.focus();
}
function bindKitchenCards(root) {
  if (!root) return;
  root.querySelectorAll("[data-kitchen-open]").forEach((btn) => btn.addEventListener("click", () => openRecipeModal(btn.dataset.kitchenOpen)));
  root.querySelectorAll("[data-kitchen-save]").forEach((btn) => btn.addEventListener("click", () => toggleKitchenSave(btn.dataset.kitchenSave)));
  root.querySelectorAll("[data-kitchen-hide]").forEach((btn) => btn.addEventListener("click", () => hideKitchenRecipe(btn.dataset.kitchenHide)));
  root.querySelectorAll("[data-kitchen-unhide]").forEach((btn) => btn.addEventListener("click", () => unhideKitchenRecipe(btn.dataset.kitchenUnhide)));
}

/* The Kitchen is one library (v049, R-07): one filter row and one
   list, each recipe shown once. Fresh picks is a filter (the first
   six), Quick and easy is a filter (the quick pool). The old Fresh
   picks and Quick and easy sections are gone. */
/* Dietary search (v053): one filter chip plus the Kitchen search box.
   The chip picks the pool, the search text narrows it by recipe name,
   so the two combine. Tags are the verified table from
   kitchen-dietary-tags-2026-11-09.md, plus the two v051 recipes. */
/* Dietary search (v053): one filter chip plus the Kitchen search box.
   The chip picks the pool, the search text narrows it by name,
   ingredients, or tags, so the two combine. Name matches come first,
   then ingredient matches, then tag matches, each in Kitchen order.
   Hidden recipes are filtered out first, so a hidden recipe never
   appears under any filter or search. Category is not searched, the
   chips already filter by category, and steps are not searched,
   because they mention ingredients incidentally and would add noise.
   Hyphens count as spaces, so "high protein" finds the
   "high-protein" tag. Tags are the verified table from
   kitchen-dietary-tags-2026-11-09.md, plus the two v051 recipes. */
function kitchenFiltered() {
  let pool;
  const visible = kitchenVisibleRecipes();
  if (kitchenFilter === "all") pool = visible.slice();
  else if (kitchenFilter === "fresh-picks") pool = visible.slice(0, 6);
  else if (kitchenFilter === "quick-and-easy") pool = kitchenQuickPool();
  else pool = visible.filter((r) => r.tags.includes(kitchenFilter) || r.category.toLowerCase().replace(/ /g, "-") === kitchenFilter);
  const q = kitchenSearch.trim().toLowerCase();
  if (!q) return pool;
  const norm = (s) => String(s || "").toLowerCase().replace(/-/g, " ");
  const nq = norm(q);
  const rankOf = (r) => {
    if (norm(r.name).includes(nq)) return 0;
    if ((r.ingredients || []).some((ing) => norm(ing).includes(nq))) return 1;
    if ((r.tags || []).some((t) => norm(t).includes(nq))) return 2;
    return -1;
  };
  return pool
    .map((r, i) => ({ r, i, rank: rankOf(r) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.r);
}
let hiddenRecipesOpen = false; // module-level, keeps the Hidden recipes details open across re-renders
function renderKitchen() {
  const list = document.getElementById("kitchen-list");
  if (!list) return;
  renderMealIdeas();
  renderHiddenKitchen();
  const shown = kitchenFiltered();
  const kitchenCount = document.getElementById("kitchen-count");
  if (kitchenCount) kitchenCount.textContent = kitchenVisibleRecipes().length + " recipes";
  if (!shown.length) {
    const q = kitchenSearch.trim();
    const hiddenCount = (store.hiddenKitchen || []).length;
    const msg = q && kitchenFilter !== "all" ? "No recipes match this search and filter." : q ? "No recipes match this search." : kitchenFilter !== "all" ? "No recipes match this filter." : hiddenCount ? "You have hidden every recipe in the Kitchen. Show hidden recipes above to bring one back." : "No recipes match this filter.";
    list.innerHTML = '<p class="empty-state">' + msg + '</p>';
    return;
  }
  const visible = shown.slice(0, kitchenLimit);
  const remaining = shown.length - visible.length;
  list.innerHTML = visible.map((r) => kitchenPhotoCardHtml(r)).join("")
    + (remaining > 0 ? `<button class="btn" id="more-kitchen" style="width:100%;margin-top:8px">Show more (${remaining} more)</button>` : "");
  bindKitchenCards(list);
  const moreBtn = document.getElementById("more-kitchen");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    kitchenLimit += 30;
    renderKitchen();
  });
}
/* Hidden recipes (v078): a compact collapsible row under the Kitchen
   search and filters, so it is visible without scrolling past the
   recipe list. It renders only when at least one recipe is hidden.
   Each hidden recipe is one line with its name and a Show button;
   showing it puts the recipe straight back in the Kitchen list, and
   the section disappears when the last hidden recipe is shown. */
function renderHiddenKitchen() {
  const box = document.getElementById("kitchen-hidden");
  if (!box) return;
  const hidden = KITCHEN_RECIPES.filter((r) => kitchenIsHidden(r.id));
  if (!hidden.length) { hiddenRecipesOpen = false; box.innerHTML = ""; return; }
  const open = hiddenRecipesOpen;
  const rows = hidden.map((r) =>
    `<div class="kitchen-hidden-row"><span>${escapeHtml(r.name)}</span>` +
    `<button type="button" class="btn btn-small" data-kitchen-unhide="${r.id}" aria-label="Show ${escapeHtml(r.name)}">Show</button></div>`
  ).join("");
  box.innerHTML =
    `<details class="card kitchen-hidden-compact"${open ? " open" : ""}>` +
    `<summary aria-expanded="${open ? "true" : "false"}">Hidden recipes (${hidden.length})</summary>` +
    `<p class="muted" style="font-size:.9em;margin:8px 0">These recipes are hidden from your Kitchen. They are not deleted. Show one to bring it back.</p>` +
    rows +
    `</details>`;
  const details = box.querySelector("details");
  if (details) details.addEventListener("toggle", () => {
    hiddenRecipesOpen = details.open;
    const summary = details.querySelector("summary");
    if (summary) summary.setAttribute("aria-expanded", details.open ? "true" : "false");
  });
  bindKitchenCards(box);
}
document.querySelectorAll("#kitchen-filters [data-filter]").forEach((chip) => chip.addEventListener("click", () => {
  kitchenFilter = chip.dataset.filter;
  kitchenLimit = 30;
  document.querySelectorAll("#kitchen-filters [data-filter]").forEach((c) => {
    c.classList.toggle("active", c === chip);
    c.setAttribute("aria-pressed", c === chip ? "true" : "false");
  });
  // v080: when a dietary filter is active, the collapsed "More filters"
  // summary names it, so the active filter is visible when closed.
  const moreSummary = document.getElementById("kitchen-more-filters-summary");
  if (moreSummary) {
    const dietary = ["fresh-picks", "quick-and-easy", "high-protein", "vegetarian", "vegan", "gluten-free", "dairy-free", "low-sodium", "nut-free", "egg-free"];
    moreSummary.textContent = dietary.includes(kitchenFilter) ? "More filters · " + chip.textContent : "More filters";
  }
  renderKitchen();
}));
// v080: the shopping list lives below the recipes; this button under
// the search is its persistent spot, with the item count.
const kitchenShoppingJump = document.getElementById("kitchen-shopping-jump");
if (kitchenShoppingJump) kitchenShoppingJump.addEventListener("click", () => {
  const section = document.getElementById("shopping-list-section");
  if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
});
const kitchenSearchInput = document.getElementById("kitchen-search-input");
if (kitchenSearchInput) kitchenSearchInput.addEventListener("input", () => {
  kitchenSearch = kitchenSearchInput.value;
  kitchenLimit = 30;
  renderKitchen();
});



/* Shopping list, pantry staples, and copy recipe (v069). The shopping
   list and pantry live in their own localStorage keys, namespaced by
   the store key so the app, demo, and sandbox each keep their own. */
const SHOPPING_KEY = LS_KEY + ".shopping-list";
const PANTRY_KEY = LS_KEY + ".pantry-staples";
const PANTRY_DEFAULTS = ["olive oil", "salt", "black pepper", "soy sauce", "rice", "garlic", "onions", "vinegar", "honey", "chili flakes", "sesame oil", "fish sauce", "canned tomatoes", "dried herbs", "flour", "sugar", "cooking oil", "butter"];
function loadShoppingList() {
  try {
    const v = JSON.parse(localStorage.getItem(SHOPPING_KEY));
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}
function saveShoppingList(list) {
  try { localStorage.setItem(SHOPPING_KEY, JSON.stringify(list)); } catch (e) {}
}
function loadPantryStaples() {
  try {
    const v = JSON.parse(localStorage.getItem(PANTRY_KEY));
    if (Array.isArray(v) && v.length) return v.filter((s) => s && s.name).map((s) => ({ name: String(s.name), have: s.have !== false }));
  } catch (e) {}
  return PANTRY_DEFAULTS.map((name) => ({ name, have: true }));
}
function savePantryStaples(list) {
  try { localStorage.setItem(PANTRY_KEY, JSON.stringify(list)); } catch (e) {}
}
/* Does this ingredient name a pantry staple the user keeps on hand?
   Word-boundary match, case-insensitive, so "salt" does not match
   "unsalted butter". Only staples marked as kept count. */
function pantryMatch(text) {
  const lower = String(text || "").toLowerCase();
  const staples = loadPantryStaples();
  for (const s of staples) {
    if (!s.have) continue;
    const name = String(s.name || "").toLowerCase().trim();
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp("\\b" + esc + "\\b").test(lower)) return s;
  }
  return null;
}
function addRecipeToShoppingList(id) {
  const r = KITCHEN_RECIPES.find((x) => x.id === id);
  if (!r || !Array.isArray(r.ingredients)) return 0;
  const list = loadShoppingList();
  r.ingredients.forEach((ing) => {
    list.push({ id: uid(), text: String(ing), recipe: r.name, pantry: !!pantryMatch(ing), checked: false });
  });
  saveShoppingList(list);
  renderShoppingList();
  return r.ingredients.length;
}
/* Brief confirmation on a button, then back to its normal label. */
function flashButton(btn, text) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { if (btn.isConnected) btn.textContent = orig; }, 2000);
}
/* Copy a recipe as plain text: name, category, time, servings,
   macros, ingredients, steps. Clipboard API with a textarea
   fallback, so it works in older browsers too. */
function recipeText(r) {
  const lines = [];
  lines.push(r.name);
  lines.push(r.category + " · " + r.time + " minutes · Serves " + r.servings);
  lines.push("Protein " + r.protein + "g · Carbs " + r.carbs + "g · Fat " + r.fat + "g · " + r.calories + " calories (per serving)");
  lines.push("");
  lines.push("Ingredients:");
  (r.ingredients || []).forEach((i) => lines.push("- " + i));
  lines.push("");
  lines.push("Steps:");
  (r.steps || []).forEach((s, i) => lines.push((i + 1) + ". " + s));
  return lines.join("\n");
}
function copyRecipeFallback(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (e) {}
  document.body.removeChild(ta);
  if (done) done();
}
function copyRecipe(id, btn) {
  const r = KITCHEN_RECIPES.find((x) => x.id === id);
  if (!r) return;
  const text = recipeText(r);
  const done = () => {
    flashButton(btn, "Copied ✓");
    const statusEl = document.getElementById("recipe-copy-status");
    if (statusEl) setFormStatus(statusEl, "Copied.", false);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => copyRecipeFallback(text, done));
  } else {
    copyRecipeFallback(text, done);
  }
}
/* Shopping list copy and print. The plain text groups items under
   "To buy" and "Check your pantry", each item with its recipe name,
   so the list is useful on paper or pasted elsewhere. */
function shoppingListText() {
  const list = loadShoppingList();
  const toBuy = [];
  const checkPantry = [];
  list.forEach((x) => (pantryMatch(x.text) ? checkPantry : toBuy).push(x));
  const lines = ["Shopping list", ""];
  if (toBuy.length) {
    lines.push("To buy");
    toBuy.forEach((x) => lines.push("- " + x.text + " (" + x.recipe + ")"));
    lines.push("");
  }
  if (checkPantry.length) {
    lines.push("Check your pantry");
    checkPantry.forEach((x) => lines.push("- " + x.text + " (" + x.recipe + ")"));
    lines.push("");
  }
  return lines.join("\n").trim();
}
function copyShoppingList(btn) {
  const text = shoppingListText();
  if (!text) return;
  const done = () => {
    flashButton(btn, "Copied ✓");
    const statusEl = document.getElementById("shop-copy-status");
    if (statusEl) setFormStatus(statusEl, "Copied.", false);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => copyRecipeFallback(text, done));
  } else {
    copyRecipeFallback(text, done);
  }
}
function printShoppingList() {
  const list = loadShoppingList();
  if (!list.length) return;
  const toBuy = [];
  const checkPantry = [];
  list.forEach((x) => (pantryMatch(x.text) ? checkPantry : toBuy).push(x));
  const groupHtml = (title, items) => {
    if (!items.length) return "";
    return "<h2>" + title + "</h2><ul>"
      + items.map((x) => "<li>" + escapeHtml(x.text) + " <span style=\"color:#666\">(" + escapeHtml(x.recipe) + ")</span></li>").join("")
      + "</ul>";
  };
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write("<!doctype html><html><head><title>Shopping list</title>"
    + "<style>body{font-family:Georgia,serif;max-width:640px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:22px}h2{font-size:16px;margin:18px 0 6px}ul{margin:0;padding-left:20px}li{margin:4px 0}</style>"
    + "</head><body><h1>Shopping list</h1>"
    + groupHtml("To buy", toBuy)
    + groupHtml("Check your pantry", checkPantry)
    + "</body></html>");
  win.document.close();
  win.focus();
  win.print();
}
/* Pantry copy and print. The plain text lists each staple on its own
   line, with a check mark for staples on hand and an empty box for
   the rest, so the list is useful on paper or pasted elsewhere. */
function pantryText() {
  const staples = loadPantryStaples();
  const lines = ["Pantry staples", ""];
  staples.forEach((s) => lines.push((s.have ? "✓ " : "☐ ") + s.name));
  return lines.join("\n").trim();
}
function copyPantry(btn) {
  const text = pantryText();
  if (!text) return;
  const done = () => {
    flashButton(btn, "Copied ✓");
    const statusEl = document.getElementById("pantry-copy-status");
    if (statusEl) setFormStatus(statusEl, "Copied.", false);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => copyRecipeFallback(text, done));
  } else {
    copyRecipeFallback(text, done);
  }
}
function printPantry() {
  const staples = loadPantryStaples();
  if (!staples.length) return;
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write("<!doctype html><html><head><title>Pantry staples</title>"
    + "<style>body{font-family:Georgia,serif;max-width:640px;margin:24px auto;padding:0 16px;color:#222}h1{font-size:22px}ul{margin:0;padding-left:20px}li{margin:4px 0}</style>"
    + "</head><body><h1>Pantry staples</h1><ul>"
    + staples.map((s) => "<li>" + (s.have ? "✓ " : "☐ ") + escapeHtml(s.name) + "</li>").join("")
    + "</ul></body></html>");
  win.document.close();
  win.focus();
  win.print();
}
/* The shopping list section in the Kitchen. "To buy" is the fresh
   items and the staples you do not have. "Check your pantry" is the
   staples you keep on hand, so you can skip them if already stocked.
   The pantry grouping is re-derived at render time from the current
   pantry checklist, so unchecking a staple moves its items to To buy. */
function shoppingGroupHtml(title, items) {
  if (!items.length) return "";
  return '<h4 style="margin:12px 0 4px">' + title + " (" + items.length + ")</h4>"
    + '<div class="shopping-list">' + items.map((x) =>
      '<label class="shopping-row"><input type="checkbox" data-shop-check="' + x.id + '"' + (x.checked ? " checked" : "") + '> <span class="shopping-text' + (x.checked ? " shopping-done" : "") + '">' + escapeHtml(x.text) + ' <span class="muted" style="font-size:.85em">· ' + escapeHtml(x.recipe) + "</span></span>"
      + ' <button type="button" class="shopping-remove" data-shop-remove="' + x.id + '" aria-label="Remove ' + escapeHtml(x.text) + '">×</button></label>'
    ).join("") + "</div>";
}
function renderShoppingList() {
  const box = document.getElementById("shopping-list-section");
  if (!box) return;
  const prevInput = box.querySelector("#pantry-add-input");
  const prevVal = prevInput ? prevInput.value : "";
  const list = loadShoppingList();
  const staples = loadPantryStaples();
  // v080: keep the count on the shopping jump button under the search.
  const jump = document.getElementById("kitchen-shopping-jump");
  if (jump) jump.textContent = "Shopping list (" + list.length + ")";
  const toBuy = [];
  const checkPantry = [];
  list.forEach((x) => (pantryMatch(x.text) ? checkPantry : toBuy).push(x));
  let html = '<h3 style="margin-top:18px">Shopping list</h3>';
  if (!list.length) {
    html += '<p class="muted" style="font-size:.9rem">Your shopping list is empty. Add ingredients from a recipe.</p>';
  } else {
    html += shoppingGroupHtml("To buy", toBuy);
    if (checkPantry.length) {
      html += '<p class="muted" style="font-size:.85rem;margin:10px 0 2px">Check your pantry. You keep these on hand, so check before you shop.</p>';
      html += shoppingGroupHtml("Check your pantry", checkPantry);
    }
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
      + '<button type="button" class="btn btn-small" data-shop-copy-list>Copy list</button>'
      + '<button type="button" class="btn btn-small" data-shop-print-list>Print list</button>'
      + '<button type="button" class="btn btn-small" data-shop-clear-checked>Clear checked</button>'
      + '<button type="button" class="btn btn-small" data-shop-clear-all>Clear all</button></div>'
      + '<p class="muted" id="shop-copy-status" role="status" style="font-size:.9rem;margin:6px 0 0"></p>';
  }
  html += '<h3 style="margin-top:18px">Pantry staples</h3>'
    + '<p class="muted" style="font-size:.9rem">Tick what you keep on hand. Staples you have go under "Check your pantry" on the shopping list.</p>'
    + '<div class="pantry-list">' + staples.map((s, i) =>
      '<label class="pantry-row"><input type="checkbox" data-pantry-have="' + i + '"' + (s.have ? " checked" : "") + '> <span>' + escapeHtml(s.name) + "</span>"
      + ' <button type="button" class="pantry-remove" data-pantry-remove="' + i + '" aria-label="Remove ' + escapeHtml(s.name) + '">×</button></label>'
    ).join("") + "</div>"
    + (staples.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">'
      + '<button type="button" class="btn btn-small" data-pantry-copy>Copy pantry</button>'
      + '<button type="button" class="btn btn-small" data-pantry-print>Print pantry</button></div>'
      + '<p class="muted" id="pantry-copy-status" role="status" style="font-size:.9rem;margin:6px 0 0"></p>' : "")
    + '<div style="display:flex;gap:8px;margin-top:8px">'
    + '<input type="text" id="pantry-add-input" maxlength="60" placeholder="Add a staple" aria-label="Add a pantry staple" style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:15px">'
    + '<button type="button" class="btn btn-small" data-pantry-add>Add</button></div>';
  box.innerHTML = html;
  const input = box.querySelector("#pantry-add-input");
  if (input) input.value = prevVal;
  bindShoppingList(box);
}
function bindShoppingList(box) {
  if (!box) return;
  box.querySelectorAll("[data-shop-check]").forEach((cb) => cb.addEventListener("change", () => {
    const list = loadShoppingList();
    const item = list.find((x) => x.id === cb.dataset.shopCheck);
    if (item) { item.checked = cb.checked; saveShoppingList(list); renderShoppingList(); }
  }));
  box.querySelectorAll("[data-shop-remove]").forEach((btn) => btn.addEventListener("click", () => {
    saveShoppingList(loadShoppingList().filter((x) => x.id !== btn.dataset.shopRemove));
    renderShoppingList();
  }));
  const clearChecked = box.querySelector("[data-shop-clear-checked]");
  if (clearChecked) clearChecked.addEventListener("click", () => {
    saveShoppingList(loadShoppingList().filter((x) => !x.checked));
    renderShoppingList();
  });
  const clearAll = box.querySelector("[data-shop-clear-all]");
  if (clearAll) clearAll.addEventListener("click", () => { saveShoppingList([]); renderShoppingList(); });
  const copyList = box.querySelector("[data-shop-copy-list]");
  if (copyList) copyList.addEventListener("click", () => copyShoppingList(copyList));
  const printList = box.querySelector("[data-shop-print-list]");
  if (printList) printList.addEventListener("click", printShoppingList);
  const copyPantryBtn = box.querySelector("[data-pantry-copy]");
  if (copyPantryBtn) copyPantryBtn.addEventListener("click", () => copyPantry(copyPantryBtn));
  const printPantryBtn = box.querySelector("[data-pantry-print]");
  if (printPantryBtn) printPantryBtn.addEventListener("click", printPantry);
  box.querySelectorAll("[data-pantry-have]").forEach((cb) => cb.addEventListener("change", () => {
    const staples = loadPantryStaples();
    const s = staples[Number(cb.dataset.pantryHave)];
    if (s) { s.have = cb.checked; savePantryStaples(staples); renderShoppingList(); }
  }));
  box.querySelectorAll("[data-pantry-remove]").forEach((btn) => btn.addEventListener("click", () => {
    const staples = loadPantryStaples();
    staples.splice(Number(btn.dataset.pantryRemove), 1);
    savePantryStaples(staples);
    renderShoppingList();
  }));
  const addBtn = box.querySelector("[data-pantry-add]");
  const addInput = box.querySelector("#pantry-add-input");
  if (addBtn && addInput) {
    const addStaple = () => {
      const name = addInput.value.trim();
      if (!name) return;
      const staples = loadPantryStaples();
      staples.push({ name, have: true });
      savePantryStaples(staples);
      renderShoppingList();
    };
    addBtn.addEventListener("click", addStaple);
    addInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addStaple(); } });
  }
}
renderShoppingList();

/* Recipe detail tag chips (v076): the category, a calories chip, and up
   to three meaningful tags from the recipe, as rounded pills. The labels
   are our own words; the tag slugs come from the recipe data. */
const RECIPE_TAG_LABELS = {
  "low-sodium": "Low sodium",
  "high-protein": "High protein",
  "gluten-free": "Gluten free",
  "dairy-free": "Dairy free",
  "low-carb": "Low carb",
  "high-fiber": "High fiber",
  "nut-free": "Nut free",
  "one-pot": "One pot",
  "easy-prep": "Easy prep",
  "kid-friendly": "Kid friendly",
  "vegetarian": "Vegetarian",
  "vegan": "Vegan",
  "spicy": "Spicy",
  "quick": "Quick"
};
function recipeTagLabel(tag) {
  if (RECIPE_TAG_LABELS[tag]) return RECIPE_TAG_LABELS[tag];
  return tag.split("-").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
}
function recipeTagChipsHtml(kr) {
  const chips = [escapeHtml(kr.category)];
  chips.push(kr.calories < 500 ? "Under 500 Calories" : kr.calories + " cal");
  const picked = [];
  const preferred = ["low-sodium", "high-protein", "gluten-free", "vegetarian", "vegan", "dairy-free"];
  const tags = kr.tags || [];
  for (const t of preferred) {
    if (picked.length >= 3) break;
    if (tags.includes(t)) picked.push(t);
  }
  for (const t of tags) {
    if (picked.length >= 3) break;
    if (picked.includes(t)) continue;
    if (recipeTagLabel(t).toLowerCase() === kr.category.toLowerCase()) continue;
    picked.push(t);
  }
  for (const t of picked) chips.push(escapeHtml(recipeTagLabel(t)));
  return `<div class="recipe-tag-chips" aria-label="Recipe tags">${chips.map((c) => `<span class="recipe-tag-chip">${c}</span>`).join("")}</div>`;
}
/* Recipe calorie ring (v076): an SVG ring with calories in the center and
   the macro split as shares of macro calories (4 cal per gram of protein
   or carbs, 9 per gram of fat), rounded to whole numbers that sum to 100.
   Colors are brand only: sage for protein, bright gold for carbs,
   sage-light for fat. The ring stays per serving, as the old macro grid
   did; the "Adds N servings" line below still shows the scaled totals. */
function recipeRingHtml(kr) {
  const pCal = kr.protein * 4, cCal = kr.carbs * 4, fCal = kr.fat * 9;
  const total = pCal + cCal + fCal;
  let pPct = 0, cPct = 0, fPct = 0;
  if (total > 0) {
    pPct = Math.round((pCal / total) * 100);
    cPct = Math.round((cCal / total) * 100);
    fPct = Math.round((fCal / total) * 100);
    const diff = 100 - (pPct + cPct + fPct);
    if (diff !== 0) {
      if (pPct >= cPct && pPct >= fPct) pPct += diff;
      else if (cPct >= fPct) cPct += diff;
      else fPct += diff;
    }
  }
  const C = 2 * Math.PI * 52;
  const denom = total > 0 ? total : 1;
  const pLen = (pCal / denom) * C, cLen = (cCal / denom) * C, fLen = (fCal / denom) * C;
  const label = kr.calories + " calories per serving: " + pPct + " percent protein, " + cPct + " percent carbs, " + fPct + " percent fat";
  return `<div class="recipe-ring-wrap">
    <div class="recipe-ring" role="img" aria-label="${escapeHtml(label)}">
      <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--sage-tint)" stroke-width="12"></circle>
        <circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--sage)" stroke-width="12" stroke-dasharray="${(pLen + 1).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="0" transform="rotate(-90 60 60)"></circle>
        <circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--gold)" stroke-width="12" stroke-dasharray="${(cLen + 1).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-pLen).toFixed(1)}" transform="rotate(-90 60 60)"></circle>
        <circle cx="60" cy="60" r="52" fill="none" style="stroke:var(--sage-light)" stroke-width="12" stroke-dasharray="${(fLen + 1).toFixed(1)} ${C.toFixed(1)}" stroke-dashoffset="${(-pLen - cLen).toFixed(1)}" transform="rotate(-90 60 60)"></circle>
      </svg>
      <div class="recipe-ring-center"><b>${kr.calories}</b><span>cal</span></div>
    </div>
    <div class="recipe-ring-macros">
      <div class="recipe-ring-macro"><i class="recipe-dot" style="background:var(--sage)"></i><b>${kr.protein}g</b><span>Protein ${pPct}%</span></div>
      <div class="recipe-ring-macro"><i class="recipe-dot" style="background:var(--gold)"></i><b>${kr.carbs}g</b><span>Carbs ${cPct}%</span></div>
      <div class="recipe-ring-macro"><i class="recipe-dot" style="background:var(--sage-light)"></i><b>${kr.fat}g</b><span>Fat ${fPct}%</span></div>
    </div>
  </div>`;
}
/* Recipe detail (v039): tap a card to see the full recipe, with the
   photo, ingredients, steps, nutrition, servings, Save, and Add to
   Today's Nutrition. Saved recipes open the same way, with their own
   photo or a lotus placeholder when they have none. */
/* The recipe the modal is showing now, so a delayed refresh after
   Add to Today never yanks the modal back to a different recipe. */
let recipeModalId = null;
let recipeNutritionOpen = false;
function openRecipeModal(id) {
  const modal = document.getElementById("recipe-modal");
  const body = document.getElementById("recipe-modal-body");
  if (!modal || !body) return;
  recipeModalId = id;
  const wasHidden = modal.classList.contains("hidden");
  if (wasHidden) recordDialogOpener("recipe-modal");
  /* Focus must not drop when the modal body is rebuilt by a servings
     tap or an Add tap. Remember which control had focus, so it can be
     put back after the rebuild (same pattern as Hide/Unhide recipes). */
  const modalActive = document.activeElement;
  let modalFocusSel = null;
  if (modalActive && body.contains(modalActive)) {
    if (modalActive.hasAttribute("data-modal-kitchen-serv")) modalFocusSel = '[data-modal-kitchen-serv="' + id + '"][data-dir="' + modalActive.dataset.dir + '"]';
    else if (modalActive.hasAttribute("data-modal-kitchen-add")) modalFocusSel = '[data-modal-kitchen-add="' + id + '"]';
    else if (modalActive.hasAttribute("data-recipe-add")) modalFocusSel = '[data-recipe-add="' + id + '"]';
    else if (modalActive.hasAttribute("data-modal-kitchen-save")) modalFocusSel = '[data-modal-kitchen-save="' + id + '"]';
  }
  const kr = KITCHEN_RECIPES.find((x) => x.id === id);
  if (kr) {
    const n = kitchenServings[kr.id] || 1;
    const saved = kitchenIsSaved(kr.id);
    const added = kitchenAddedAt[kr.id] && Date.now() - kitchenAddedAt[kr.id] < 2500;
    body.innerHTML = `
      ${kr.image ? `<img class="kitchen-photo" src="${escapeHtml(kr.image)}" alt="${escapeHtml(kr.name)}" style="height:200px">` : ""}
      <h2 id="recipe-modal-title" style="margin:12px 0 4px">${escapeHtml(kr.name)}</h2>
      <p class="muted" style="font-size:.9em;margin:0 0 8px">${escapeHtml(kr.category)} · ${kr.time} minutes · ${escapeHtml(kr.difficulty)} · Serves ${kr.servings}</p>
      ${recipeTagChipsHtml(kr)}
      ${recipeRingHtml(kr)}
      <details class="kitchen-nutrition"${recipeNutritionOpen ? " open" : ""}>
        <summary>${recipeNutritionOpen ? "Hide nutrition" : "Show nutrition"}</summary>
        ${kr.saturatedFat != null ? `<p style="margin:8px 0 0">Saturated fat: ${kr.saturatedFat}g per serving.</p>` : ""}
        <p class="muted" style="font-size:.85em;margin:4px 0 0">Values are per serving.</p>
      </details>
      <h3 style="margin:14px 0 4px">Ingredients</h3>
      <ul style="margin:0;padding-left:24px">${kr.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
      <h3 style="margin:14px 0 4px">Steps</h3>
      <ol style="margin:0;padding-left:24px">${kr.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      <div class="kitchen-actions">
        <button type="button" class="btn btn-small" data-modal-kitchen-save="${kr.id}">${saved ? "Saved ✓" : "Save"}</button>
        <button type="button" class="btn btn-small" data-modal-kitchen-hide="${kr.id}">Hide this recipe</button>
        <span class="kitchen-stepper">
          <button type="button" class="btn btn-small" data-modal-kitchen-serv="${kr.id}" data-dir="-1" aria-label="One fewer serving">−</button>
          <span aria-live="polite">Servings: ${n}</span>
          <button type="button" class="btn btn-small" data-modal-kitchen-serv="${kr.id}" data-dir="1" aria-label="One more serving">+</button>
        </span>
        <button type="button" class="btn btn-small" data-modal-kitchen-shop="${kr.id}">Add to shopping list</button>
        <button type="button" class="btn btn-small" data-modal-kitchen-copy="${kr.id}">Copy recipe</button>
      </div>
      <p class="muted" id="recipe-copy-status" role="status" style="font-size:.85em;margin:6px 0 0"></p>
      <p class="muted" style="font-size:.85em;margin:6px 0 0">Adds ${n} serving${n === 1 ? "" : "s"}: ${kr.protein * n}g protein, ${kr.carbs * n}g carbs, ${kr.fat * n}g fat, ${kr.calories * n} cal.</p>
      ${kr.credit ? `<p class="kitchen-credit">Photo: ${escapeHtml(kr.credit)}</p>` : ""}${recipeSourceHtml(kr)}
      <div class="kitchen-sticky-add">
        <button type="button" class="btn btn-block btn-primary" data-modal-kitchen-add="${kr.id}">${added ? "Added to today ✓" : "Add to Today's Nutrition"}</button>
      </div>`;
  } else {
    const r = (store.recipes || []).find((x) => x.id === id);
    if (!r) return;
    body.innerHTML = `
      ${recipePhotoHtml(r) || `<div class="recipe-placeholder" aria-hidden="true"><img src="icons/lotus-gold-only-transparent.png" alt=""></div>`}
      <h2 id="recipe-modal-title" style="margin:12px 0 4px">${escapeHtml(r.title)}</h2>
      <p style="white-space:pre-wrap;margin:6px 0 0">${escapeHtml(r.body)}</p>
      ${recipeMacrosHtml(r)}${recipeSourceHtml(r)}`;
  }
  bindRecipeModalButtons();
  modal.classList.remove("hidden");
  if (wasHidden) {
    const x = document.getElementById("recipe-modal-x");
    if (x) x.focus();
  } else if (modalFocusSel) {
    const btn = body.querySelector(modalFocusSel);
    if (btn) btn.focus();
  }
}
function bindRecipeModalButtons() {
  const body = document.getElementById("recipe-modal-body");
  if (!body) return;
  body.querySelectorAll(".kitchen-nutrition").forEach((d) => d.addEventListener("toggle", () => {
    recipeNutritionOpen = d.open;
    const s = d.querySelector("summary");
    if (s) s.textContent = d.open ? "Hide nutrition" : "Show nutrition";
  }));
  body.querySelectorAll("[data-modal-kitchen-save]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.modalKitchenSave;
    toggleKitchenSave(id);
    openRecipeModal(id);
  }));
  body.querySelectorAll("[data-modal-kitchen-hide]").forEach((btn) => btn.addEventListener("click", () => hideKitchenRecipe(btn.dataset.modalKitchenHide)));
  body.querySelectorAll("[data-modal-kitchen-serv]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.modalKitchenServ;
    kitchenServings[id] = Math.max(1, (kitchenServings[id] || 1) + Number(btn.dataset.dir));
    openRecipeModal(id);
  }));
  body.querySelectorAll("[data-modal-kitchen-add]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.modalKitchenAdd;
    addKitchenToToday(id);
    openRecipeModal(id);
    setTimeout(() => {
      const modal = document.getElementById("recipe-modal");
      if (modal && !modal.classList.contains("hidden") && recipeModalId === id) openRecipeModal(id);
    }, 2600);
  }));
  body.querySelectorAll("[data-recipe-add]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.recipeAdd;
    addSavedRecipeToToday(id);
    openRecipeModal(id);
    setTimeout(() => {
      const modal = document.getElementById("recipe-modal");
      if (modal && !modal.classList.contains("hidden") && recipeModalId === id) openRecipeModal(id);
    }, 2600);
  }));
  body.querySelectorAll("[data-modal-kitchen-shop]").forEach((btn) => btn.addEventListener("click", () => {
    addRecipeToShoppingList(btn.dataset.modalKitchenShop);
    flashButton(btn, "Added to list ✓");
  }));
  body.querySelectorAll("[data-modal-kitchen-copy]").forEach((btn) => btn.addEventListener("click", () => copyRecipe(btn.dataset.modalKitchenCopy, btn)));
}
function closeRecipeModal() {
  recipeModalId = null;
  const modal = document.getElementById("recipe-modal");
  if (modal) modal.classList.add("hidden");
  returnDialogFocus("recipe-modal");
}
const recipeModalX = document.getElementById("recipe-modal-x");
if (recipeModalX) recipeModalX.addEventListener("click", closeRecipeModal);
const recipeModalClose = document.getElementById("recipe-modal-close");
if (recipeModalClose) recipeModalClose.addEventListener("click", closeRecipeModal);
const recipeModal = document.getElementById("recipe-modal");
if (recipeModal) recipeModal.addEventListener("click", (e) => {
  if (e.target.id === "recipe-modal") closeRecipeModal();
});


/* The photo on a saved recipe card: the user's own photo when they
   added one, otherwise the Kitchen photo (and credit) when the recipe
   was saved from the Kitchen. */
function recipePhotoHtml(r) {
  const src = r.photo || r.image || "";
  if (!src) return "";
  return `<img class="kitchen-photo" src="${escapeHtml(src)}" alt="${escapeHtml(r.title)}" loading="lazy">` + (r.credit ? `<p class="kitchen-credit">Photo: ${escapeHtml(r.credit)}</p>` : "");
}
/* The nutrition on a saved recipe card: the same macro chips as a
   Kitchen card, plus an Add to Today's Nutrition button that logs one
   serving. Shown only when the recipe has macros (entered on the form
   or carried over from a Kitchen save). Calories fall back to the 4/4/9
   calculation when they were not entered. */
const recipeAddedAt = {}; // recipe id -> timestamp of last Add to Today
function recipeMacrosHtml(r) {
  const protein = Number(r.protein) || 0;
  const carbs = Number(r.carbs) || 0;
  const fat = Number(r.fat) || 0;
  if (!protein && !carbs && !fat) return "";
  const calories = Number(r.calories) || Math.round(protein * 4 + carbs * 4 + fat * 9);
  const added = recipeAddedAt[r.id] && Date.now() - recipeAddedAt[r.id] < 2500;
  return `<div class="kitchen-macros">
    <div class="kitchen-macro"><b>${protein}g</b><span>Protein</span></div>
    <div class="kitchen-macro"><b>${carbs}g</b><span>Carbs</span></div>
    <div class="kitchen-macro"><b>${fat}g</b><span>Fat</span></div>
    <div class="kitchen-macro"><b>${calories}</b><span>Calories</span></div>
  </div>
  <p class="muted" style="font-size:.8em;margin:6px 0 0">Per serving${r.servings ? " · Serves " + r.servings : ""}</p>
  <div style="margin-top:8px"><button type="button" class="btn btn-small btn-primary" data-recipe-add="${r.id}">${added ? "Added to today ✓" : "Add to Today's Nutrition"}</button></div>`;
}
/* Calories for a saved recipe card: the entered calories, or the 4/4/9
   calculation when they were not entered. Zero when it has no macros. */
function savedRecipeCalories(r) {
  const protein = Number(r.protein) || 0, carbs = Number(r.carbs) || 0, fat = Number(r.fat) || 0;
  if (!protein && !carbs && !fat) return 0;
  return Number(r.calories) || Math.round(protein * 4 + carbs * 4 + fat * 9);
}
/* Add a saved recipe to today (v039): one macro entry for the day,
   the same path as the Kitchen Add to Today. Shared by the saved
   recipe list and the recipe modal. */
function addSavedRecipeToToday(id) {
  const r = store.recipes.find((x) => x.id === id);
  if (!r) return;
  store.protein.push({ id: uid(), date: viewedDateStr(), grams: Number(r.protein) || 0, carbs: Number(r.carbs) || 0, fat: Number(r.fat) || 0, food: r.title, calories: savedRecipeCalories(r) });
  saveStore();
  renderToday();
  recipeAddedAt[r.id] = Date.now();
  renderRecipes();
  setTimeout(() => { delete recipeAddedAt[r.id]; renderRecipes(); }, 2500);
}
function renderRecipes() {
  renderKitchen();
  const list = document.getElementById("recipe-list");
  if (!list) return;
  if (!store.recipes.length) {
    list.innerHTML = '<p class="empty-state">No recipes saved yet.</p>';
    return;
  }
  const sorted = [...store.recipes].sort(byDateDesc);
  list.innerHTML = sorted.map((r) => {
    const calories = savedRecipeCalories(r);
    const photo = (r.photo || r.image)
      ? `<img class="kitchen-photo" src="${escapeHtml(r.photo || r.image)}" alt="" loading="lazy">`
      : `<span class="recipe-placeholder"><img src="icons/lotus-gold-only-transparent.png" alt=""></span>`;
    return `<article class="kitchen-photo-card">
      <button type="button" class="kitchen-photo-open" data-recipe-open="${r.id}" aria-label="${escapeHtml(r.title)}${calories ? " " + calories + " cal" : ""}${r.source ? " " + escapeHtml(r.source) : ""}. See recipe.">
        <span class="kitchen-photo-wrap">${photo}</span>
        <span class="kitchen-photo-body"><strong>${escapeHtml(r.title)}</strong>${calories ? ` <span class="muted">${calories} cal</span>` : ""}</span>
        ${r.source ? `<span class="kitchen-source">${escapeHtml(r.source)}</span>` : ""}
      </button>
      <button type="button" class="btn btn-small btn-danger kitchen-card-del" data-recipe-del="${r.id}" aria-label="Delete ${escapeHtml(r.title)}">Delete</button>
    </article>`;
  }).join("");
  list.querySelectorAll("[data-recipe-open]").forEach((btn) => btn.addEventListener("click", () => openRecipeModal(btn.dataset.recipeOpen)));
  list.querySelectorAll("[data-recipe-del]").forEach((btn) => btn.addEventListener("click", () => {
    store.recipes = store.recipes.filter((r) => r.id !== btn.dataset.recipeDel);
    saveStore();
    renderRecipes();
  }));
}
/* A photo for a saved recipe. The photo is shrunk to at most 800px wide
   and saved as a JPEG, so it stays small in local storage. It is the
   user's own photo, kept on the device like everything else. */
let recipePhotoDataUrl = "";
function compressRecipePhoto(file, done) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 800;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      done(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => done("");
    img.src = String(reader.result || "");
  };
  reader.onerror = () => done("");
  reader.readAsDataURL(file);
}
function setRecipePhoto(dataUrl) {
  recipePhotoDataUrl = dataUrl || "";
  const preview = document.getElementById("recipe-photo-preview");
  const removeBtn = document.getElementById("recipe-remove-photo-btn");
  if (recipePhotoDataUrl) {
    preview.src = recipePhotoDataUrl;
    preview.classList.remove("hidden");
    removeBtn.classList.remove("hidden");
  } else {
    preview.src = "";
    preview.classList.add("hidden");
    removeBtn.classList.add("hidden");
  }
}
document.getElementById("recipe-take-btn").addEventListener("click", () => document.getElementById("recipe-photo-input").click());
document.getElementById("recipe-photo-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) compressRecipePhoto(file, setRecipePhoto);
});
document.getElementById("recipe-upload-btn").addEventListener("click", () => document.getElementById("recipe-upload-input").click());
document.getElementById("recipe-upload-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (file) compressRecipePhoto(file, setRecipePhoto);
});
document.getElementById("recipe-remove-photo-btn").addEventListener("click", () => setRecipePhoto(""));
document.getElementById("recipe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("recipe-msg");
  const title = document.getElementById("recipe-title").value.trim().slice(0, 120);
  const body = document.getElementById("recipe-body").value.trim().slice(0, 4000);
  if (!title) { setFormStatus(msg, "Type a title first.", true); return; }
  if (!body) { setFormStatus(msg, "Paste the recipe first.", true); return; }
  const entry = { id: uid(), title, body, date: viewedDateStr() };
  if (recipePhotoDataUrl) entry.photo = recipePhotoDataUrl;
  const protein = Math.max(0, Math.round((Number(document.getElementById("recipe-protein").value) || 0) * 10) / 10);
  const carbs = Math.max(0, Math.round((Number(document.getElementById("recipe-carbs").value) || 0) * 10) / 10);
  const fat = Math.max(0, Math.round((Number(document.getElementById("recipe-fat").value) || 0) * 10) / 10);
  if (protein || carbs || fat) {
    entry.protein = protein;
    entry.carbs = carbs;
    entry.fat = fat;
    const calories = Math.max(0, Math.round(Number(document.getElementById("recipe-calories").value) || 0));
    entry.calories = calories || Math.round(protein * 4 + carbs * 4 + fat * 9);
  }
  const servings = Math.max(0, Math.round(Number(document.getElementById("recipe-servings").value) || 0));
  if (servings > 0) entry.servings = servings;
  store.recipes.push(entry);
  saveStore();
  document.getElementById("recipe-form").reset();
  setRecipePhoto("");
  setRecipeFormOpen(false);
  const recipeToggle = document.getElementById("recipe-form-toggle");
  if (recipeToggle) {
    recipeToggle.textContent = "Recipe saved \u2713";
    setTimeout(() => { if (recipeToggle.textContent === "Recipe saved \u2713") recipeToggle.textContent = "Add your own recipe"; }, 2500);
  }
  renderRecipes();
});
/* Recipe form: the Calories field follows the macros (4/4/9) as they
   are typed, the same as the Log food form. Typing a calories value
   sticks until a macro changes, when it recomputes. */
function syncRecipeCalories() {
  const el = document.getElementById("recipe-calories");
  if (!el) return;
  const p = Math.max(0, Math.round((Number(document.getElementById("recipe-protein").value) || 0) * 10) / 10);
  const c = Math.max(0, Math.round((Number(document.getElementById("recipe-carbs").value) || 0) * 10) / 10);
  const f = Math.max(0, Math.round((Number(document.getElementById("recipe-fat").value) || 0) * 10) / 10);
  el.value = (p || c || f) ? Math.round(p * 4 + c * 4 + f * 9) : "";
}
["recipe-protein", "recipe-carbs", "recipe-fat"].forEach((id) => {
  const input = document.getElementById(id);
  if (input) input.addEventListener("input", syncRecipeCalories);
});
/* Paste a Recipe and the saved-recipe form (v039): both collapse
   behind one button each, so the Kitchen opens short. The AI step that
   reads a pasted recipe and fills in the name, servings, and nutrition
   arrives after November 30, when the Worker can parse it. Until then
   the pasted text goes into the recipe form below, and the name,
   servings, and nutrition stay blank for the user to fill in. Nothing
   is guessed or invented. */
function setPasteRecipeOpen(open) {
  const form = document.getElementById("paste-recipe-form");
  if (form) form.classList.toggle("hidden", !open);
  const toggle = document.getElementById("paste-recipe-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Hide the paste box" : "Paste a recipe";
  }
  if (open) {
    const box = document.getElementById("paste-recipe-text");
    if (box) box.focus();
  }
}
function setRecipeFormOpen(open) {
  const form = document.getElementById("recipe-form");
  if (form) form.classList.toggle("hidden", !open);
  const toggle = document.getElementById("recipe-form-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Hide form" : "Add your own recipe";
  }
}
const pasteRecipeToggleBtn = document.getElementById("paste-recipe-toggle");
if (pasteRecipeToggleBtn) pasteRecipeToggleBtn.addEventListener("click", () => {
  const form = document.getElementById("paste-recipe-form");
  setPasteRecipeOpen(form ? form.classList.contains("hidden") : true);
});
const recipeFormToggleBtn = document.getElementById("recipe-form-toggle");
if (recipeFormToggleBtn) recipeFormToggleBtn.addEventListener("click", () => {
  const form = document.getElementById("recipe-form");
  setRecipeFormOpen(form ? form.classList.contains("hidden") : true);
});
document.getElementById("paste-recipe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("paste-recipe-msg");
  const text = document.getElementById("paste-recipe-text").value.trim().slice(0, 4000);
  if (!text) { setFormStatus(msg, "Paste a recipe first.", true); return; }
  document.getElementById("recipe-body").value = text;
  document.getElementById("paste-recipe-text").value = "";
  setPasteRecipeOpen(false);
  setRecipeFormOpen(true);
  setFormStatus(document.getElementById("recipe-msg"), "Recipe AI is coming soon. Your pasted recipe is in the form below. Edit it, then save it to your Kitchen.", false);
  document.getElementById("recipe-form").scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("recipe-title").focus();
});
/* Recipe search (online database). The live lookup arrives after
   November 30, when the Worker can call the FatSecret recipe database.
   Until then the box shows what is coming, the same pattern as Scan my
   plate. */
document.getElementById("recipe-search-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("recipe-search-msg");
  const results = document.getElementById("recipe-search-results");
  const q = document.getElementById("recipe-search-input").value.trim();
  if (!q) { setFormStatus(msg, "Type a dish first.", true); results.innerHTML = ""; return; }
  setFormStatus(msg, "", false);
  results.innerHTML = `<p class="muted">Recipe search is coming soon. After November 30, a search for "${escapeHtml(q)}" here will find the recipe, photo, and nutrition. For now, try the Kitchen recipes below, or save your own above.</p>`;
});

function renderSideEffects() {
  const list = document.getElementById("sideeffect-list");
  if (!list) return;
  renderSeTrends();
  renderDoctorReminder();
  const sorted = [...store.sideEffects].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No side effects logged yet.</p>';
    return;
  }
  const visibleSe = sorted.slice(0, seLimit);
  const remainingSe = sorted.length - visibleSe.length;
  /* Gentle timeline (v166): a quiet vertical line with a severity-
     colored dot per entry, newest first, so patterns over time are
     easy to see. Edit and Delete stay on every entry. */
  list.innerHTML = `<div class="se-timeline">` + visibleSe.map(seItemHtml).join("") + `</div>`
    + (remainingSe > 0
      ? `<button class="btn" id="more-se" style="width:100%;margin-top:8px">Show older (${remainingSe} more)</button>`
      : "");
  bindSeButtons(list);
  const moreSeBtn = document.getElementById("more-se");
  if (moreSeBtn) moreSeBtn.addEventListener("click", () => {
    seLimit += 10;
    renderSideEffects();
  });
}

/* Side effects on the Journal tab (v169): the same timeline, below the
   journal entries, in addition to the Effects tab. */

/* ---------- Settings ---------- */

/* Show only the last 4 characters of the companion key, never the whole key (F32). */
function maskToken(t) {
  if (!t) return "";
  return t.length > 4 ? "\u2022\u2022\u2022\u2022" + t.slice(-4) : "\u2022\u2022\u2022\u2022";
}

function renderSettings() {
  renderSnapshots();
  const versionLine = document.getElementById("app-version-line");
  if (versionLine) versionLine.textContent = "App version " + APP_VERSION + ".";
  // v155: the version also shows in Backup & restore, so it is easy to
  // find when something goes wrong and Jessica asks which version the
  // app is running.
  const backupVersionLine = document.getElementById("backup-version-line");
  if (backupVersionLine) backupVersionLine.textContent = "App version " + APP_VERSION + ".";
  const s = store.settings;
  document.getElementById("set-companion-key").value = maskToken(getAuthToken());
  updateCoachStatus();
  renderPlaySubscription();
  document.getElementById("set-med").value = s.medication || "";
  document.getElementById("set-dose").value = s.dose || "";
  document.getElementById("set-shot-day").value = s.shotDay || "";
  document.getElementById("set-water-goal").value = s.waterGoal || 92;
  document.getElementById("set-protein-goal").value = s.proteinGoal || 90;
  document.getElementById("set-movement-goal").value = s.movementGoal || 30;
  // v168: carbs and fat targets for the Your Macros card, and height
  // in feet and inches for BMI.
  document.getElementById("set-carbs-goal").value = s.carbGoal || 150;
  document.getElementById("set-fat-goal").value = s.fatGoal || 60;
  // v169: the calorie target is optional; blank stays blank.
  document.getElementById("set-calorie-target").value = s.calorieTarget === "" || s.calorieTarget === undefined ? "" : s.calorieTarget;
  // The percentage fields show real values, not placeholders. Fill them
  // from the saved gram goals and calorie target so the "Set goals from
  // percentages" button reads what the user sees. Protein and carbs round
  // to the nearest percent; fat takes the remainder so the three always
  // add up to 100. When no goals are saved yet, the fields keep the
  // decided split from the HTML (32/35/33).
  const calNum = Number(s.calorieTarget);
  const pGrams = Number(s.proteinGoal);
  const cGrams = Number(s.carbGoal);
  const fGrams = Number(s.fatGoal);
  if (calNum > 0 && pGrams > 0 && cGrams > 0 && fGrams > 0) {
    const ppct = Math.round(pGrams * 4 / calNum * 100);
    const cpct = Math.round(cGrams * 4 / calNum * 100);
    const fpct = 100 - ppct - cpct;
    if (ppct >= 0 && ppct <= 100 && cpct >= 0 && cpct <= 100 && fpct >= 0 && fpct <= 100) {
      document.getElementById("set-protein-pct").value = ppct;
      document.getElementById("set-carbs-pct").value = cpct;
      document.getElementById("set-fat-pct").value = fpct;
    }
  }
  syncMacroPctSliders();
  document.getElementById("set-height-ft").value = s.heightFt === "" || s.heightFt === undefined ? "" : s.heightFt;
  document.getElementById("set-height-in").value = s.heightIn === "" || s.heightIn === undefined ? "" : s.heightIn;
  document.getElementById("set-goal-weight").value = s.goalWeight || "";
  document.getElementById("set-starting-weight").value = (s.startingWeight && Number(s.startingWeight.value) > 0) ? s.startingWeight.value : "";
  document.getElementById("set-refill-date").value = s.refillDate || "";
  // v000: Companion name and avatar, Appearance theme and text size,
  // and the read-aloud setting.
  const nameInput = document.getElementById("set-companion-name");
  if (nameInput) nameInput.value = s.companionName || "";
  const yourNameInput = document.getElementById("set-your-name");
  if (yourNameInput) yourNameInput.value = s.yourName || "";
  const avatarRadio = document.querySelector('input[name="companion-avatar"][value="' + (COMPANION_AVATARS[s.companionAvatar] ? s.companionAvatar : "gold") + '"]');
  if (avatarRadio) avatarRadio.checked = true;
  const themeRadio = document.querySelector('input[name="theme"][value="' + (["sage", "dark", "cream"].includes(s.theme) ? s.theme : "sage") + '"]');
  if (themeRadio) themeRadio.checked = true;
  const sizeRadio = document.querySelector('input[name="text-size"][value="' + (s.textSize === "large" ? "large" : "normal") + '"]');
  if (sizeRadio) sizeRadio.checked = true;
  const readAloudBox = document.getElementById("set-read-aloud");
  if (readAloudBox) readAloudBox.checked = s.readAloud === true;
  renderRefillCountdown();
  renderShotReminderMismatch();
}

/* The refill line, shared by the Settings countdown and the Today
   card (v049, R-04): one wording, one place, so the two never drift. */
function refillLineText() {
  const rd = store.settings.refillDate;
  if (!rd) return "";
  const diffDays = daysBetween(todayStr(), rd);
  if (diffDays < 0) return "Your refill date has passed. Consider requesting a refill soon.";
  if (diffDays === 0) return "Your refill is due today.";
  if (diffDays === 1) return "Your refill is due tomorrow.";
  return "Your refill is due in " + diffDays + " days (" + formatDate(rd) + ").";
}
function renderRefillCountdown() {
  const el = document.getElementById("refill-countdown");
  if (el) el.textContent = refillLineText();
}
/* Refill line on Today (v049, R-04): shown only when the refill is
   within 7 days or already passed, with a link to Settings to change
   the date. */
function renderTodayRefillLine() {
  const line = document.getElementById("today-refill-line");
  const text = document.getElementById("today-refill-text");
  if (!line || !text) return;
  const rd = store.settings.refillDate;
  const diff = rd ? daysBetween(todayStr(), rd) : null;
  if (diff === null || diff > 7) { line.classList.add("hidden"); return; }
  text.textContent = refillLineText();
  line.classList.remove("hidden");
}

/* v000: the Companion and Appearance controls apply as soon as they
   change, so the person sees the new name, avatar, theme, or text
   size right away. The Save button writes the same values again,
   which is harmless. */
(function setupCompanionAppearanceControls() {
  const nameInput = document.getElementById("set-companion-name");
  if (nameInput) nameInput.addEventListener("change", () => {
    store.settings.companionName = nameInput.value.trim().slice(0, 60);
    saveStore();
    renderChat();
  });
  document.querySelectorAll('input[name="companion-avatar"]').forEach((r) => r.addEventListener("change", () => {
    if (r.checked && COMPANION_AVATARS[r.value]) {
      store.settings.companionAvatar = r.value;
      saveStore();
      renderChat();
    }
  }));
  document.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener("change", () => {
    if (r.checked && ["sage", "dark", "cream"].includes(r.value)) {
      store.settings.theme = r.value;
      saveStore();
      applyAppearance();
    }
  }));
  document.querySelectorAll('input[name="text-size"]').forEach((r) => r.addEventListener("change", () => {
    if (r.checked && ["normal", "large"].includes(r.value)) {
      store.settings.textSize = r.value;
      saveStore();
      applyAppearance();
    }
  }));
  const readAloudBox = document.getElementById("set-read-aloud");
  if (readAloudBox) readAloudBox.addEventListener("change", () => {
    store.settings.readAloud = readAloudBox.checked === true;
    if (!store.settings.readAloud) stopSpeaking();
    saveStore();
  });
})();

/* v169: a blank or invalid macro target leaves the existing target
   unchanged; the default applies only when nothing was ever set.
   (The type-in fields already exist under Your goals; this only changes
   what a blank or invalid save does, so clearing a field by mistake
   cannot reset a target she set.) */
function keepMacroTarget(raw, current, fallback) {
  const t = String(raw == null ? "" : raw).trim();
  if (/^\d+$/.test(t)) { const n = Number(t); if (n > 0) return n; }
  const c = Number(current);
  return Number.isFinite(c) && c > 0 ? c : fallback;
}

/* Set macro gram goals from calories and percentages. Protein and
   carbs are 4 calories a gram, fat is 9. The percentages must add
   up to 100. Fills the gram fields above; Save Settings keeps them. */
/* Macro percentage sliders (v048): each percentage has a slider under
   its type-in field. Protein and carbs are the adjustable pair; fat is
   always the remainder, so the three always add up to 100. The same
   rounding as the saved split: protein and carbs round to the nearest
   percent, fat takes the remainder. Sliding or typing a percentage
   refills the gram fields live when a calorie target is set. */
function macroPctValues() {
  return {
    protein: Number(document.getElementById("set-protein-pct").value) || 0,
    carbs: Number(document.getElementById("set-carbs-pct").value) || 0,
    fat: Number(document.getElementById("set-fat-pct").value) || 0
  };
}
function syncMacroPctSliders() {
  const p = macroPctValues();
  const ps = document.getElementById("set-protein-pct-slider");
  const cs = document.getElementById("set-carbs-pct-slider");
  const fs = document.getElementById("set-fat-pct-slider");
  // v057: paint each slider track with the macro color up to the thumb.
  if (ps) { ps.value = p.protein; ps.style.setProperty("--fill-pct", p.protein + "%"); }
  if (cs) { cs.value = p.carbs; cs.style.setProperty("--fill-pct", p.carbs + "%"); }
  if (fs) { fs.value = p.fat; fs.style.setProperty("--fill-pct", p.fat + "%"); }
}
function writeMacroPct(p) {
  document.getElementById("set-protein-pct").value = p.protein;
  document.getElementById("set-carbs-pct").value = p.carbs;
  document.getElementById("set-fat-pct").value = p.fat;
  syncMacroPctSliders();
}
function fillMacroGramsFromPct() {
  const cal = Number(document.getElementById("set-calorie-target").value);
  if (!(cal > 0)) return false;
  const p = macroPctValues();
  const pg = Math.round(cal * p.protein / 100 / 4);
  const cg = Math.round(cal * p.carbs / 100 / 4);
  const fg = Math.round(cal * p.fat / 100 / 9);
  document.getElementById("set-protein-goal").value = pg;
  document.getElementById("set-carbs-goal").value = cg;
  document.getElementById("set-fat-goal").value = fg;
  const msg = document.getElementById("set-macro-pct-msg");
  if (msg) msg.textContent = "Set to " + pg + "g protein, " + cg + "g carbs, " + fg + "g fat. Tap Save below to keep them.";
  return true;
}
function balanceMacroPct(changed) {
  const p = macroPctValues();
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  if (changed === "fat") {
    const f = clamp(p.fat);
    const rest = 100 - f;
    const total = p.protein + p.carbs;
    let pr, cb;
    if (total > 0) {
      pr = Math.round(p.protein * rest / total);
      cb = rest - pr;
    } else {
      pr = rest; cb = 0;
    }
    writeMacroPct({ protein: pr, carbs: cb, fat: f });
  } else {
    const v = clamp(p[changed]);
    const other = changed === "protein" ? "carbs" : "protein";
    const ov = Math.min(p[other], 100 - v);
    const out = { protein: 0, carbs: 0, fat: 0 };
    out[changed] = v; out[other] = ov; out.fat = 100 - v - ov;
    writeMacroPct(out);
  }
  fillMacroGramsFromPct();
}
["protein", "carbs", "fat"].forEach((key) => {
  const slider = document.getElementById("set-" + key + "-pct-slider");
  if (slider) slider.addEventListener("input", () => {
    document.getElementById("set-" + key + "-pct").value = slider.value;
    balanceMacroPct(key);
  });
  const field = document.getElementById("set-" + key + "-pct");
  if (field) field.addEventListener("change", () => balanceMacroPct(key));
});
document.getElementById("set-macro-pct-btn").addEventListener("click", () => {
  const msg = document.getElementById("set-macro-pct-msg");
  const cal = Number(document.getElementById("set-calorie-target").value);
  const p = macroPctValues();
  if (!(cal > 0)) { msg.textContent = "Enter your daily calorie target above first."; return; }
  if (![p.protein, p.carbs, p.fat].every((n) => Number.isFinite(n) && n >= 0)) { msg.textContent = "Add a percentage for protein, carbs, and fat."; return; }
  const sum = p.protein + p.carbs + p.fat;
  if (sum !== 100) { msg.textContent = "Percentages must add up to 100. Yours add up to " + sum + "."; return; }
  fillMacroGramsFromPct();
  autosaveSettings();
});

/* Read the Settings form into store.settings (v049, R-01): the
   same field reads the Save button used to do, so an autosave
   and a Save write exactly the same values. */
function collectSettingsFromForm() {
  store.settings.medication = document.getElementById("set-med").value.trim() || "";
  store.settings.dose = document.getElementById("set-dose").value;
  store.settings.shotDay = document.getElementById("set-shot-day").value;
  const wg = Number(document.getElementById("set-water-goal").value);
  store.settings.waterGoal = wg > 0 ? wg : 92;
  // v169: a blank or invalid macro target keeps the existing target.
  store.settings.proteinGoal = keepMacroTarget(document.getElementById("set-protein-goal").value, store.settings.proteinGoal, 90);
  const mg = Number(document.getElementById("set-movement-goal").value);
  store.settings.movementGoal = mg > 0 ? mg : 30;
  // v168: carbs and fat targets for the Your Macros card, and height
  // for BMI. A height with no feet and no inches stays blank.
  // (Number("") is 0, so the raw field value is checked first.)
  store.settings.carbGoal = keepMacroTarget(document.getElementById("set-carbs-goal").value, store.settings.carbGoal, 150);
  store.settings.fatGoal = keepMacroTarget(document.getElementById("set-fat-goal").value, store.settings.fatGoal, 60);
  // v169: the calorie target is optional and has no default. Whole
  // numbers only; blank or invalid stays unset.
  const ctRaw = document.getElementById("set-calorie-target").value.trim();
  store.settings.calorieTarget = /^\d+$/.test(ctRaw) && Number(ctRaw) > 0 ? Number(ctRaw) : "";
  const hftRaw = document.getElementById("set-height-ft").value.trim();
  const hft = hftRaw === "" ? NaN : Number(hftRaw);
  store.settings.heightFt = Number.isFinite(hft) && hft >= 0 && hft <= 8 ? hft : "";
  const hinRaw = document.getElementById("set-height-in").value.trim();
  const hin = hinRaw === "" ? NaN : Number(hinRaw);
  store.settings.heightIn = Number.isFinite(hin) && hin >= 0 && hin <= 11 ? hin : "";
  const gw = Number(document.getElementById("set-goal-weight").value);
  store.settings.goalWeight = gw > 0 ? gw : "";
  const sw = Number(document.getElementById("set-starting-weight").value);
  if (sw > 0) {
    const prevDate = store.settings.startingWeight && store.settings.startingWeight.date;
    store.settings.startingWeight = { value: sw, date: (prevDate && isValidDateStr(prevDate)) ? prevDate : todayStr() };
  } else {
    store.settings.startingWeight = null;
  }
  store.settings.refillDate = document.getElementById("set-refill-date").value;
  // v000: Companion name and avatar, Appearance theme and text size,
  // and the read-aloud setting. The name falls back to the default
  // when blank.
  const cnInput = document.getElementById("set-companion-name");
  store.settings.companionName = cnInput ? cnInput.value.trim().slice(0, 60) : "";
  const ynInput = document.getElementById("set-your-name");
  store.settings.yourName = ynInput ? ynInput.value.trim().slice(0, 60) : "";
  const avatarChecked = document.querySelector('input[name="companion-avatar"]:checked');
  if (avatarChecked && COMPANION_AVATARS[avatarChecked.value]) store.settings.companionAvatar = avatarChecked.value;
  const themeChecked = document.querySelector('input[name="theme"]:checked');
  if (themeChecked && ["sage", "dark", "cream"].includes(themeChecked.value)) store.settings.theme = themeChecked.value;
  const sizeChecked = document.querySelector('input[name="text-size"]:checked');
  if (sizeChecked && ["normal", "large"].includes(sizeChecked.value)) store.settings.textSize = sizeChecked.value;
  const readAloudChecked = document.getElementById("set-read-aloud");
  store.settings.readAloud = readAloudChecked ? readAloudChecked.checked === true : false;
  }

document.getElementById("settings-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const keyInput = document.getElementById("set-companion-key").value.trim();
  const existingKey = getAuthToken();
  let tokenSaveFailed = false;
  if (keyInput && keyInput !== maskToken(existingKey)) {
    if (existingKey && !confirm("Replace the companion key you already have saved? The old key will stop working here.")) {
      document.getElementById("set-companion-key").value = maskToken(existingKey);
      return;
    }
    // Verify the key actually stuck: a full or blocked store would
    // otherwise swallow the key silently. The goals still save below;
    // the warning is shown with the saved message at the end.
    try {
      localStorage.setItem(TOKEN_KEY, keyInput);
      tokenSaveFailed = localStorage.getItem(TOKEN_KEY) !== keyInput;
    } catch { tokenSaveFailed = true; }
    if (!tokenSaveFailed) rememberCompanionToken();
    if (tokenSaveFailed) document.getElementById("set-companion-key").value = maskToken(getAuthToken());
  }
collectSettingsFromForm();
  saveStore();
  applyAppearance();
  renderChat();
  renderSettings();
  renderToday();
  renderWeight();
  const savedMsg = document.getElementById("settings-saved-msg");
  if (savedMsg) {
    savedMsg.textContent = tokenSaveFailed
      ? "Settings saved, but the companion key could not be saved on this device. It may be out of space. Download a backup from Settings, then delete a few old photos, and enter the key again."
      : "Settings saved.";
    savedMsg.classList.add("success");
  }
});


/* Settings autosave (v049, R-01): every change in the Settings form
   saves itself a moment later, so an edit is never lost by leaving
   the page without tapping Save. The save reads the form and writes
   the store only; it never re-renders Settings, which would reset the
   percentage sliders, and never touches the companion key, which keeps
   its confirm flow on Save. */
var settingsAutosaveTimer = null;
function autosaveSettings() {
  collectSettingsFromForm();
  saveStore();
  renderShotReminderMismatch();
  const savedMsg = document.getElementById("settings-saved-msg");
  if (savedMsg) { savedMsg.textContent = "Saved."; savedMsg.classList.add("success"); }
}
document.getElementById("settings-form").addEventListener("input", (e) => {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) {
    clearTimeout(settingsAutosaveTimer);
    settingsAutosaveTimer = setTimeout(autosaveSettings, 600);
  }
});
document.getElementById("settings-form").addEventListener("change", () => {
  clearTimeout(settingsAutosaveTimer);
  settingsAutosaveTimer = setTimeout(autosaveSettings, 300);
});

/* ---------- Companion access code ---------- */

const WORKER_URL = "https://github-fetcher.millrjess.workers.dev";

function updateCoachStatus() {
  const line = document.getElementById("coach-status-line");
  const entry = document.getElementById("coach-code-entry");
  if (!line) return;
  const token = getAuthToken();
  if (token && token.length >= 16) {
    line.textContent = "Your AI Wellness Companion is connected and ready.";
    line.style.color = "var(--sage-dark)";
    if (entry) entry.classList.add("hidden");
  } else if (isPlayEntitled()) {
    line.textContent = "Your Play subscription is active. Companion chat for Play subscribers is still being connected.";
    line.style.color = "var(--sage-dark)";
    if (entry) entry.classList.remove("hidden");
  } else if (hadCompanionToken()) {
    line.textContent = "Your subscription ended. Resubscribe in Settings to reconnect your Companion.";
    line.style.color = "";
    if (entry) entry.classList.remove("hidden");
  } else {
    line.textContent = "Your AI Wellness Companion is not connected yet.";
    line.style.color = "";
    if (entry) entry.classList.remove("hidden");
  }
}

function setCodeError(text) {
  const input = document.getElementById("set-access-code");
  const msg = document.getElementById("code-msg");
  if (!msg) return;
  // Clear first so a repeated empty click still produces a fresh alert announcement.
  msg.textContent = "";
  void msg.offsetHeight;
  msg.textContent = text;
  msg.classList.remove("success");
  if (input) {
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
}

async function redeemAccessCode() {
  const input = document.getElementById("set-access-code");
  const msg = document.getElementById("code-msg");
  const btn = document.getElementById("redeem-code-btn");
  const code = (input.value || "").replace(/\D/g, "").slice(0, 6);
  if (code.length !== 6) {
    setCodeError("Enter all 6 digits.");
    return;
  }
  if (input) input.setAttribute("aria-invalid", "false");
  msg.classList.remove("success");
  msg.textContent = "Connecting...";
  btn.disabled = true;
  try {
    const res = await fetch(WORKER_URL + "/api/code/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      // Verify the key actually stuck: a full or blocked store would
      // otherwise report "connected" while every chat message fails.
      let tokenSaved = false;
      try {
        localStorage.setItem(TOKEN_KEY, data.token);
        tokenSaved = localStorage.getItem(TOKEN_KEY) === data.token;
      } catch {}
      if (tokenSaved) rememberCompanionToken();
      if (!tokenSaved) {
        setCodeError("Your code worked, but the companion key could not be saved on this device. It may be out of space. Download a backup from Settings, then delete a few old photos, and try the code again.");
        return;
      }
      document.getElementById("set-companion-key").value = maskToken(data.token);
      msg.textContent = "Your AI Wellness Companion is connected.";
      msg.classList.add("success");
      if (input) input.setAttribute("aria-invalid", "false");
      input.value = "";
      updateCoachStatus();
      showGettingStartedVideo();
    } else {
      setCodeError(data.error || "That code did not work. Try again.");
      const m = document.getElementById("code-msg");
      if (m) {
        const a = document.createElement("a");
        a.href = "https://millrjess.github.io/tracker/welcome/";
        a.textContent = " Get a new code from the welcome page.";
        m.appendChild(a);
      }
    }
  } catch (e) {
    setCodeError("Could not reach the service. Check your connection.");
  }
  btn.disabled = false;
}

document.getElementById("redeem-code-btn").addEventListener("click", redeemAccessCode);

/* ---------- Getting Started video: first launch (v079) ----------
   After a successful code redemption, show the Getting Started video
   once. It never shows again (localStorage flag), and it never blocks:
   the Close button, Escape, or the backdrop dismiss it and pause the
   video. The redeem click is a user gesture, so sound is attempted
   first; if the browser blocks it, the video plays muted with a
   Tap for sound button. */
const GETTING_STARTED_SEEN_KEY = "newChapterTracker.sandbox.gettingStartedSeen.v1";
function showGettingStartedVideo() {
  const overlay = document.getElementById("getting-started-overlay");
  const video = document.getElementById("getting-started-video");
  if (!overlay || !video) return;
  try { if (localStorage.getItem(GETTING_STARTED_SEEN_KEY) === "1") return; } catch {}
  try { localStorage.setItem(GETTING_STARTED_SEEN_KEY, "1"); } catch {}
  recordDialogOpener("getting-started-overlay");
  overlay.classList.remove("hidden");
  document.getElementById("getting-started-close").focus();
  const soundBtn = document.getElementById("getting-started-sound");
  video.muted = false;
  const p = video.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {
      video.muted = true;
      if (soundBtn) soundBtn.hidden = false;
      const p2 = video.play();
      if (p2 && typeof p2.catch === "function") p2.catch(() => {});
    });
  }
}
function closeGettingStartedVideo() {
  const overlay = document.getElementById("getting-started-overlay");
  const video = document.getElementById("getting-started-video");
  if (!overlay || overlay.classList.contains("hidden")) return;
  if (video) video.pause();
  overlay.classList.add("hidden");
  returnDialogFocus("getting-started-overlay", "redeem-code-btn");
}
document.getElementById("getting-started-close").addEventListener("click", closeGettingStartedVideo);
document.getElementById("getting-started-overlay").addEventListener("click", (e) => {
  if (e.target.id === "getting-started-overlay") closeGettingStartedVideo();
});
document.getElementById("getting-started-sound").addEventListener("click", () => {
  const video = document.getElementById("getting-started-video");
  const soundBtn = document.getElementById("getting-started-sound");
  if (!video) return;
  video.muted = false;
  const p = video.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
  if (soundBtn) soundBtn.hidden = true;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("getting-started-overlay").classList.contains("hidden")) {
    e.preventDefault();
    closeGettingStartedVideo();
  }
});
bindDialogFocusTrap("getting-started-overlay");

/* ---------- Help videos: aria-expanded on details toggles (v079) ----------
   Native <details> toggles are keyboard accessible, but the expanded state
   is not exposed as aria-expanded in every browser, so sync it here. The
   toggle event does not bubble, so listen in the capture phase. */
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d || d.tagName !== "DETAILS" || !d.closest || !d.closest("#help-videos")) return;
  const s = d.querySelector(":scope > summary");
  if (s) s.setAttribute("aria-expanded", d.open ? "true" : "false");
}, true);
document.getElementById("set-access-code").addEventListener("input", () => {
  const input = document.getElementById("set-access-code");
  const msg = document.getElementById("code-msg");
  if (input && input.getAttribute("aria-invalid") === "true") {
    input.setAttribute("aria-invalid", "false");
    if (msg) msg.textContent = "";
  }
});

/* ---------- Google Play Billing (Digital Goods API) ---------- */

// Play Billing is only available when the app runs inside the Google Play
// installed app (Trusted Web Activity). On the website, in a desktop browser,
// or in a website installed PWA, window.getDigitalGoodsService is missing and
// this whole section stays silent: no Play card is shown, no Play call is made,
// and the website Stripe flow is untouched. The Play card is filled in by
// JavaScript only when Play is detected, so website users never see it.
//
// Subscription: anewchapter_monthly, base plan monthly. There is one base
// plan only, so buying the product ID buys that base plan. Do not add a
// second product or offer here without updating the purchase flow.
// Purchase records are purchase access, not tracked content. They are kept
// when the user deletes tracked data, the same way the companion token is kept.

const PLAY_SKU = "anewchapter_monthly";
const PLAY_STORE_ID = "https://play.google.com/billing";
const PLAY_ENTITLEMENT_KEY = "newChapterTracker.sandbox.playEntitlement.v1";

let playServicePromise = null;
let playRenderInFlight = false;

function getPlayEntitlement() {
  try {
    const raw = localStorage.getItem(PLAY_ENTITLEMENT_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw);
    if (rec && rec.sku === PLAY_SKU) return rec;
    return null;
  } catch {
    return null;
  }
}

function setPlayEntitlement(record) {
  try {
    localStorage.setItem(PLAY_ENTITLEMENT_KEY, JSON.stringify(record));
  } catch {}
}

function clearPlayEntitlement() {
  try {
    localStorage.removeItem(PLAY_ENTITLEMENT_KEY);
  } catch {}
}

function isPlayEntitled() {
  return getPlayEntitlement() !== null;
}

// Returns the Play Digital Goods service, or null when Play Billing is not
// available (website, desktop browser, website installed PWA). Never throws.
async function getPlayService() {
  if (typeof window.getDigitalGoodsService !== "function") return null;
  if (!playServicePromise) {
    try {
      playServicePromise = window.getDigitalGoodsService(PLAY_STORE_ID).catch(() => null);
    } catch {
      return null;
    }
  }
  const service = await playServicePromise;
  if (!service) playServicePromise = null;
  return service;
}

// Refresh the cached entitlement from Play. This is the source of truth:
// an active purchase in listPurchases means entitled; an empty list means
// the subscription ended and the cache is cleared. A failed check (offline,
// Play unreachable) keeps the cache as is, so an offline user is not locked
// out by a network error. Never throws.
async function refreshPlayEntitlement() {
  const service = await getPlayService();
  if (!service) return isPlayEntitled();
  try {
    const purchases = await service.listPurchases();
    const active = (purchases || []).find((p) => p.itemId === PLAY_SKU);
    if (active) {
      setPlayEntitlement({
        sku: PLAY_SKU,
        purchaseToken: active.purchaseToken || "",
        checkedOn: todayStr(),
      });
      return true;
    }
    clearPlayEntitlement();
    return false;
  } catch {
    return isPlayEntitled();
  }
}

// True when the user has a Play subscription recorded but no companion token.
// In that case chat cannot call the worker yet, so the chat handler shows a
// Play specific message instead of the website welcome email message.
function playChatBlocked() {
  return !getAuthToken() && isPlayEntitled();
}

function playCardEl() {
  return document.getElementById("play-subscription-card");
}

function formatPlayPrice(detail) {
  if (!detail || !detail.price) return "";
  const value = Number(detail.price.value);
  const currency = detail.price.currency || "USD";
  if (!isFinite(value)) return "";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency }).format(value);
  } catch {
    return currency + " " + value;
  }
}

// Fill the Play subscription card in Settings. Does nothing on the website
// (no card content, no error) because getPlayService returns null there.
// All failures inside Play are shown inside the card only, never as alerts.
async function renderPlaySubscription() {
  const card = playCardEl();
  if (!card) return;
  if (playRenderInFlight) return;
  playRenderInFlight = true;
  try {
    const service = await getPlayService();
    if (!service) {
      card.innerHTML = "";
      return;
    }
    card.innerHTML = "<div class=\"card\"><h3>Google Play subscription</h3><p class=\"muted\" id=\"play-status-line\">Checking your Play subscription...</p><div id=\"play-action-area\"></div></div>";
    const statusLine = document.getElementById("play-status-line");
    const actionArea = document.getElementById("play-action-area");
    let detail = null;
    try {
      const details = await service.getDetails([PLAY_SKU]);
      detail = (details || []).find((d) => d.itemId === PLAY_SKU) || null;
    } catch {
      detail = null;
    }
    let entitled = false;
    try {
      entitled = await refreshPlayEntitlement();
    } catch {
      entitled = isPlayEntitled();
    }
    const bindRefresh = () => {
      const refreshBtn = document.getElementById("play-refresh-btn");
      if (refreshBtn) refreshBtn.addEventListener("click", () => renderPlaySubscription());
    };
    if (entitled) {
      const token = getAuthToken();
      if (token && token.length >= 16) {
        statusLine.textContent = "Your Play subscription is active, and your AI Wellness Companion is connected.";
      } else {
        statusLine.textContent = "Your Play subscription is active. Companion chat for Play subscribers is still being connected.";
      }
      statusLine.style.color = "var(--sage-dark)";
      actionArea.innerHTML = "<p class=\"muted\">Manage your subscription in the Play Store app under Payments and subscriptions.</p><button type=\"button\" class=\"btn\" id=\"play-refresh-btn\">Refresh status</button>";
      bindRefresh();
      return;
    }
    if (!detail) {
      statusLine.textContent = "The Play subscription is not available yet.";
      statusLine.style.color = "";
      actionArea.innerHTML = "<button type=\"button\" class=\"btn\" id=\"play-refresh-btn\">Refresh status</button>";
      bindRefresh();
      return;
    }
    const price = formatPlayPrice(detail);
    statusLine.textContent = "You are not subscribed through Google Play yet.";
    statusLine.style.color = "";
    const priceLabel = price ? " for " + price + " a month" : "";
    actionArea.innerHTML = "<button type=\"button\" class=\"btn-primary\" id=\"play-subscribe-btn\" style=\"margin-top:12px;width:100%;padding:16px;font-size:1.1rem\">Subscribe" + priceLabel + "</button><p class=\"muted\" id=\"play-purchase-msg\" style=\"min-height:1.2em\"></p>";
    const subBtn = document.getElementById("play-subscribe-btn");
    if (subBtn) subBtn.addEventListener("click", () => startPlayPurchase());
  } finally {
    playRenderInFlight = false;
  }
}

async function startPlayPurchase() {
  const msg = document.getElementById("play-purchase-msg");
  const btn = document.getElementById("play-subscribe-btn");
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = "Opening Google Play...";
  let response = null;
  try {
    if (typeof PaymentRequest === "undefined") {
      throw new Error("PaymentRequest unavailable");
    }
    const methods = [{ supportedMethods: PLAY_STORE_ID, data: { sku: PLAY_SKU } }];
    // Total is required by the Payment Request API but ignored by Play,
    // which charges the price set in Play Console.
    const details = { total: { label: "Total", amount: { currency: "USD", value: "0" } } };
    const request = new PaymentRequest(methods, details);
    response = await request.show();
    const purchaseToken = response.details ? response.details.purchaseToken : "";
    if (!purchaseToken) {
      throw new Error("No purchase token returned");
    }
    // Record the entitlement on this device first, then close the payment
    // sheet. Server side verification and acknowledgement are a separate
    // follow up step: without acknowledgement within three days, Play
    // refunds an unacknowledged purchase. See the build report.
    setPlayEntitlement({ sku: PLAY_SKU, purchaseToken: purchaseToken, checkedOn: todayStr() });
    try { await response.complete("success"); } catch {}
    response = null;
    await refreshPlayEntitlement();
    renderPlaySubscription();
    updateCoachStatus();
    alert("Thank you. Your Play subscription is active.");
  } catch (err) {
    if (response) {
      try { await response.complete("fail"); } catch {}
      response = null;
    }
    const name = (err && err.name) || "";
    const message = (err && err.message) || "";
    if (name === "AbortError" || /cancel/i.test(message) || /abort/i.test(message)) {
      if (msg) msg.textContent = "Purchase canceled. Nothing was charged.";
    } else if (/already/i.test(message) || /subscribed/i.test(message)) {
      if (msg) msg.textContent = "You already have an active subscription.";
      renderPlaySubscription();
    } else {
      if (msg) msg.textContent = "Purchase did not complete. Please try again.";
    }
  }
  if (btn) btn.disabled = false;
}

// Warm the Play detection cache on load so later checks are fast. Silent:
// on the website this resolves to null immediately and does nothing, and
// getPlayService never rejects, so there is no unhandled rejection.
getPlayService();

/* "What you can do" card (v049, R-14): shown during the first week,
   until dismissed. It points to the two things new users miss most:
   the doctor summary and Your foods. */
function discoverFirstUseDate() {
  let earliest = null;
  ["water", "protein", "exercise", "weight", "injections", "journal", "sideEffects", "measurements", "photos"].forEach((k) => {
    (store[k] || []).forEach((e) => { if (e.date && (!earliest || e.date < earliest)) earliest = e.date; });
  });
  Object.keys(store.moods || {}).forEach((d) => { if (!earliest || d < earliest) earliest = d; });
  return earliest;
}
function renderDiscoverCard() {
  const card = document.getElementById("discover-card");
  if (!card) return;
  let show = false;
  try { show = !localStorage.getItem("nct-discover-dismissed"); } catch { show = true; }
  if (show) {
    const first = discoverFirstUseDate();
    if (first) {
      const days = Math.floor((Date.now() - new Date(first + "T12:00:00").getTime()) / 86400000);
      show = days <= 7;
    }
  }
  card.classList.toggle("hidden", !show);
}
document.getElementById("discover-dismiss-btn").addEventListener("click", () => {
  try { localStorage.setItem("nct-discover-dismissed", "1"); } catch {}
  document.getElementById("discover-card").classList.add("hidden");
});
document.getElementById("discover-doctor-btn").addEventListener("click", () => {
  showTab("shots");
  const b = document.getElementById("doctor-summary-btn");
  if (b) b.click();
});
document.getElementById("discover-foods-btn").addEventListener("click", () => {
  showTab("today");
  const form = document.getElementById("macro-food-form");
  if (form && form.classList.contains("hidden")) {
    document.getElementById("macro-log-food").click();
  } else {
    openFoodLibraryIfAny();
    if (form) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

/* ---------- Backup nudge ---------- */

function renderBackupNudge() {
  const banner = document.getElementById("backup-nudge");
  if (!banner) return;
  let snooze = null, last = null;
  try {
    snooze = localStorage.getItem("nct-sandbox-backup-snooze");
    last = localStorage.getItem("nct-sandbox-last-backup");
  } catch {}
  if (snooze && snooze >= todayStr()) { banner.classList.add("hidden"); return; }
  if (last) {
    const daysSince = daysBetween(last, todayStr());
    if (daysSince < 30) { banner.classList.add("hidden"); return; } // monthly
  }
  const days = new Set();
  ["water", "protein", "exercise", "weight", "injections", "journal", "sideEffects"].forEach((k) => {
    (store[k] || []).forEach((e) => { if (e.date) days.add(e.date); });
  });
  Object.keys(store.moods || {}).forEach((d) => days.add(d));
  if (days.size < 7) { banner.classList.add("hidden"); return; }
  document.getElementById("backup-nudge-text").textContent =
    "You've logged " + days.size + " days in your tracker. Keep your progress safe with a quick backup.";
  banner.classList.remove("hidden");
}

document.getElementById("backup-now").addEventListener("click", () => {
  document.getElementById("backup-data").click();
});
document.getElementById("backup-later").addEventListener("click", () => {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  const s = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  try { localStorage.setItem("nct-sandbox-backup-snooze", s); } catch {}
  document.getElementById("backup-nudge").classList.add("hidden");
});

/* ---------- Data export (tab-delimited) ---------- */

function tsvCell(v) {
  const text = String(v == null ? "" : v);
  if (/[\t\r\n"]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function tsvSection(title, headers, rows) {
  const out = [title, headers.join("\t")];
  rows.forEach((r) => out.push(r.map(tsvCell).join("\t")));
  out.push("");
  return out;
}

document.getElementById("export-data").addEventListener("click", () => {
  const lines = [];
  lines.push("New Chapter: GLP-1 Tracker™ - data export");
  lines.push("Exported " + new Date().toLocaleString("en-US"));
  lines.push("");

  lines.push(...tsvSection(
    "Water Intake",
    ["Date", "Amount (oz)"],
    [...store.water].sort(byDate).map((e) => [e.date, e.oz])
  ));

  lines.push(...tsvSection(
    "Protein",
    ["Date", "Food", "Protein (g)", "Carbs (g)", "Fat (g)"],
    [...store.protein].sort(byDate).map((e) => [e.date, e.food, e.grams, Number(e.carbs) || 0, Number(e.fat) || 0])
  ));

  lines.push(...tsvSection(
    "Movement",
    ["Date", "Activity", "Minutes"],
    [...store.exercise].sort(byDate).map((e) => [e.date, e.label, e.minutes])
  ));

  lines.push(...tsvSection(
    "Injections",
    ["Date", "Medication", "Dose (mg)", "Site", "Status", "Notes"],
    [...store.injections].sort(byDate).map((e) => [e.date, e.medication, e.dose, e.site, e.status || "On time", e.notes])
  ));

  lines.push(...tsvSection(
    "Weight",
    ["Date", "Weight (lbs)"],
    [...store.weight].sort(byDate).map((e) => [e.date, e.value])
  ));

  lines.push(...tsvSection(
    "Measurements",
    ["Date", "Waist (in)", "Hips (in)", "Chest (in)", "Arm (in)", "Thigh (in)", "Neck (in)"],
    [...(store.measurements || [])].sort(byDate).map((e) => [e.date, e.waist, e.hips, e.chest, e.arm, e.thigh, e.neck])
  ));

  lines.push("Progress Photos");
  lines.push(["Date", "Note"].join("\t"));
  [...(store.photos || [])].sort(byDate).forEach((p) => {
    lines.push([p.date, "Photo stored in app (not included in export)"].join("\t"));
  });
  lines.push("");

  lines.push(...tsvSection(
    "Journal",
    ["Date", "Mood", "Notes"],
    [...store.journal].sort(byDate).map((e) => [e.date, e.mood, e.notes])
  ));

  lines.push(...tsvSection(
    "Side Effects",
    ["Date", "Symptom", "Severity", "Notes"],
    [...store.sideEffects].sort(byDate).map((e) => [e.date, e.symptom, e.severity, e.notes])
  ));

  lines.push(...tsvSection(
    "Daily Mood",
    ["Date", "Mood"],
    Object.keys(store.moods || {}).sort().map((d) => [d, store.moods[d]])
  ));

  lines.push(...tsvSection(
    "Settings and goals",
    ["Setting", "Value"],
    [
      ["Medication", store.settings.medication || ""],
      ["Dose (mg)", store.settings.dose || ""],
      ["Shot day", store.settings.shotDay || ""],
      ["Daily water goal (oz)", store.settings.waterGoal || ""],
      ["Daily protein goal (g)", store.settings.proteinGoal || ""],
      ["Daily carbs goal (g)", store.settings.carbGoal || ""],
      ["Daily fat goal (g)", store.settings.fatGoal || ""],
      ["Daily calorie target (cal)", store.settings.calorieTarget === "" || store.settings.calorieTarget === undefined ? "" : store.settings.calorieTarget],
      ["Height (ft)", store.settings.heightFt === "" || store.settings.heightFt === undefined ? "" : store.settings.heightFt],
      ["Height (in)", store.settings.heightIn === "" || store.settings.heightIn === undefined ? "" : store.settings.heightIn],
      ["Daily movement goal (min)", store.settings.movementGoal || ""],
      ["Goal weight (lbs)", store.settings.goalWeight || ""],
      ["Refill date", store.settings.refillDate || ""]
    ]
  ));

  const blob = new Blob([lines.join("\n")], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "new-chapter-tracker-" + todayStr() + ".tsv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  // An export is not a backup: it cannot be restored, so it must not
  // reset the backup reminder (F25/S10).
  renderBackupNudge();
});
/* ---------- Diary CSV export (v033) ---------- */
/* One row per food entry per day, with that day's water, movement,
   weight, mood, and journal notes on the row. A day with no food
   entries but with water, movement, weight, mood, or a journal note
   gets one row with the food fields blank. Pure function of the
   store, so it can be tested without the page. */
function csvCell(v) {
  const text = String(v == null ? "" : v);
  if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}
function buildDiaryCSV(s) {
  const headers = ["Date", "Food", "Protein (g)", "Carbs (g)", "Fat (g)", "Calories", "Water (oz)", "Movement (min)", "Weight (lbs)", "Mood", "Journal note"];
  const byDay = {};
  const addDay = (d) => { if (!byDay[d]) byDay[d] = { foods: [], water: 0, movement: 0, weight: "", mood: "", notes: [] }; return byDay[d]; };
  (s.water || []).forEach((e) => { if (e && e.date) addDay(e.date).water += Number(e.oz) || 0; });
  (s.exercise || []).forEach((e) => { if (e && e.date) addDay(e.date).movement += Number(e.minutes) || 0; });
  (s.weight || []).forEach((e) => { if (e && e.date) addDay(e.date).weight = Number(e.value); });
  (s.protein || []).forEach((e) => { if (e && e.date) addDay(e.date).foods.push(e); });
  (s.journal || []).forEach((e) => {
    if (!e || !e.date) return;
    const day = addDay(e.date);
    if (e.mood && !day.mood) day.mood = e.mood;
    if (e.notes) day.notes.push(e.notes);
  });
  Object.entries(s.moods || {}).forEach(([d, m]) => { if (typeof m === "string" && m) { const day = addDay(d); if (!day.mood) day.mood = m; } });
  const rows = [headers.map(csvCell).join(",")];
  Object.keys(byDay).sort().forEach((d) => {
    const day = byDay[d];
    const mood = day.mood || "";
    const note = day.notes.join(" ");
    const water = day.water || "";
    const movement = day.movement || "";
    const weight = day.weight === "" ? "" : day.weight;
    if (!day.foods.length) {
      rows.push([d, "", "", "", "", "", water, movement, weight, mood, note].map(csvCell).join(","));
      return;
    }
    day.foods.forEach((f) => {
      const p = Number(f.grams) || 0, c = Number(f.carbs) || 0, fa = Number(f.fat) || 0;
      const cal = Math.round(p * 4 + c * 4 + fa * 9);
      rows.push([d, f.food || "", p, c, fa, cal, water, movement, weight, mood, note].map(csvCell).join(","));
    });
  });
  return rows.join("\n");
}
document.getElementById("export-diary-csv").addEventListener("click", () => {
  const csv = buildDiaryCSV(store);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "new-chapter-diary-" + todayStr() + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const msg = document.getElementById("csv-msg");
  if (msg) setFormStatus(msg, "Diary downloaded as a CSV file. It opens in Google Sheets.");
  // An export is not a backup: it cannot be restored, so it must not
  // reset the backup reminder.
  renderBackupNudge();
});




function countStoreEntries(s) {
  if (!s) return 0;
  const keys = ["water", "protein", "exercise", "injections", "weight", "measurements", "photos", "journal", "sideEffects"];
  let total = 0;
  keys.forEach((k) => { if (Array.isArray(s[k])) total += s[k].length; });
  if (s.moods) total += Object.keys(s.moods).length;
  if (s.movementDone) total += Object.keys(s.movementDone).length;
  return total;
}
function snapshotSummary(s) {
  if (!s) return "Could not be read";
  const parts = [];
  const labels = [["weight", "weigh-ins"], ["injections", "injections"], ["journal", "journal entries"], ["sideEffects", "side effects"], ["measurements", "measurements"], ["photos", "photos"], ["water", "water entries"], ["protein", "protein entries"], ["exercise", "movement entries"]];
  labels.forEach(([k, label]) => { if (Array.isArray(s[k]) && s[k].length) parts.push(s[k].length + " " + label); });
  if (s.moods && Object.keys(s.moods).length) parts.push(Object.keys(s.moods).length + " moods");
  if (!parts.length) return "Empty, no entries";
  return parts.join(", ");
}

/* ---------- In app backup snapshots ---------- */

const SNAP_KEY = "nct-sandbox-snapshots";

/* Safety net: if the main store has zero entries but a non-empty snapshot
   exists, restore the newest non-empty snapshot instead of showing a blank
   app. Called once at startup, before the first render and before any
   save, so the restored data is what the user sees and what gets saved. */
function maybeRestoreFromSnapshot() {
  if (countStoreEntries(store) !== 0) return;
  const snaps = loadSnapshots();
  for (const sn of snaps) {
    // A safety copy kept when data was deleted on purpose must never
    // bring that data back on its own (S14). The same holds for a
    // reset: the "Before reset" copy is there to restore by hand, not
    // to undo the reset on its own.
    if (sn.label === "Before delete" || sn.label === "Before reset") continue;
    let snapStore = null;
    try { snapStore = validateStore(JSON.parse(sn.data)); } catch { continue; }
    if (!snapStore || countStoreEntries(snapStore) === 0) continue;
    store = snapStore;
    ensureEntryIds();
    syncStartingWeight(); // K3: freeze from the restored first weigh-in if the snapshot predates the freeze
    loadFailed = false;
    storeDamaged = false; // a restored copy replaces the damaged one
    restoredFromSnapshot = { at: sn.at, summary: snapshotSummary(snapStore) };
    saveStore();
    return;
  }
}

/* S1: if this load could not read the saved entries, say so in plain words
   on the Today tab instead of silently starting fresh. The unreadable copy
   is kept aside (newChapterTracker.sandbox.v1.corrupt) and the save guard keeps
   this empty start from overwriting it. v150: the same card is used when
   a collection was dropped because it was damaged, so the user sees the
   loss before any save can make it permanent. */
function renderCorruptNotice() {
  const card = document.getElementById("corrupt-notice");
  if (!card) return;
  if ((!loadFailed && !storeDamaged) || restoredFromSnapshot) { card.classList.add("hidden"); return; }
  if (storeDamaged) {
    document.getElementById("corrupt-notice-text").textContent =
      "Some of your saved entries could not be read, so those entries are not showing. Your other entries are safe. Before adding new entries, check Settings, then Backup and restore, for a backup to restore. Nothing new will be saved until you tap Got it.";
  } else {
    document.getElementById("corrupt-notice-text").textContent =
      "Your saved entries could not be read, so the app started fresh to keep your old data safe. Your old data is still saved on this device. Before adding new entries, check Settings, then Backup & restore, for a backup to restore.";
  }
  card.classList.remove("hidden");
}

document.getElementById("corrupt-notice-hide").addEventListener("click", () => {
  const card = document.getElementById("corrupt-notice");
  if (card) card.classList.add("hidden");
  // The user has seen the warning and chosen to continue: allow saves
  // again. The unreadable copy stays set aside under .corrupt.
  storeDamaged = false;
});

/* v150: true when the app has been used before, so an empty store at
   startup is a loss to warn about, not a first day. Only signals that
   come from real use count: a backup file was downloaded, a backup
   snapshot exists, or entries were once saved. The setup marker
   (nct-setup-done) is set on the very first load, so it cannot tell a
   first day from a loss. A deliberate delete clears these markers, so
   it never triggers the warning. */
function hasUsedAppBefore() {
  try {
    if (localStorage.getItem("nct-sandbox-ever-had-entries") === "1") return true;
    if (localStorage.getItem("nct-sandbox-last-backup")) return true;
    const snaps = loadSnapshots();
    return snaps.some((sn) => sn.label !== "Before delete");
  } catch { return false; }
}

/* v150: true when the app is running as the installed home-screen app
   rather than in a browser tab. On iOS the home-screen app keeps its
   own storage, separate from Safari, so a browser tab is a different,
   empty copy. */
function isStandaloneApp() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator.standalone) return true;
  } catch {}
  return false;
}

/* v150: the store loaded empty and the safety net had nothing to restore.
   Say so in plain words instead of silently showing a blank app. In a
   browser tab the message is guidance (the entries live in the
   home-screen app, not here). In the home-screen app it is a warning,
   shown only when the app was used before, so a first day stays quiet. */
function renderEmptyNotice() {
  const card = document.getElementById("empty-notice");
  if (!card) return;
  if (countStoreEntries(store) !== 0 || restoredFromSnapshot || loadFailed || storeDamaged) {
    card.classList.add("hidden");
    return;
  }
  if (!isStandaloneApp()) {
    document.getElementById("empty-notice-text").textContent =
      "You are viewing the tracker in the browser. Your entries are kept in the home-screen app, not here. Open the tracker from its home-screen app icon to see your entries. If you have not added it to your home screen yet, use Share, then Add to Home Screen.";
    card.classList.remove("hidden");
    return;
  }
  if (!hasUsedAppBefore()) { card.classList.add("hidden"); return; }
  document.getElementById("empty-notice-text").textContent =
    "Your entries are not showing. Your entries are stored only in this app on this phone. If you opened the tracker in Safari, from a link, or from a new app icon, that is a separate empty copy. Close this and open the tracker from its home-screen app icon. If you have a backup file, restore it in Settings, then Backup and restore.";
  card.classList.remove("hidden");
}

document.getElementById("empty-notice-hide").addEventListener("click", () => {
  const card = document.getElementById("empty-notice");
  if (card) card.classList.add("hidden");
});

document.getElementById("storage-warning-hide").addEventListener("click", () => {
  const card = document.getElementById("storage-warning");
  if (card) card.classList.add("hidden");
});

function renderRestoreNotice() {
  const card = document.getElementById("restore-notice");
  if (!card) return;
  if (!restoredFromSnapshot) { card.classList.add("hidden"); return; }
  const label = new Date(restoredFromSnapshot.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  document.getElementById("restore-notice-text").textContent =
    "Your entries were restored from a backup saved in this app on " + label + ". It has " + restoredFromSnapshot.summary + ". If anything looks wrong, check Settings, then Backup & restore.";
  card.classList.remove("hidden");
}

document.getElementById("restore-notice-hide").addEventListener("click", () => {
  const card = document.getElementById("restore-notice");
  if (card) card.classList.add("hidden");
});

function loadSnapshots() {
  let raw = null;
  try { raw = localStorage.getItem(SNAP_KEY); } catch { return []; }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("snapshots not an array");
    return parsed.filter((sn) => {
      if (!sn || typeof sn !== "object" || typeof sn.data !== "string") return false;
      // A snapshot with an unreadable timestamp cannot be displayed or
      // ordered, so it cannot be restored either. Drop it, keep the rest.
      if (typeof sn.at !== "string" || isNaN(new Date(sn.at).getTime())) return false;
      // The label is shown as HTML, so it may only be one of the labels
      // the app itself writes. Anything else is treated as no label.
      if (sn.label !== undefined && sn.label !== "Before delete" && sn.label !== "Before restore" && sn.label !== "Before reset") sn.label = undefined;
      return true;
    });
  } catch {
    // Do not destroy the unreadable snapshots by overwriting them: set the
    // raw copy aside under its own key and start with an empty list (S5).
    try { localStorage.setItem(SNAP_KEY + ".corrupt", raw); } catch {}
    return [];
  }
}
/* Legacy snapshot writer removed in v152: it swallowed failures silently
   (catch {}), so a snapshot that was never written looked like a safety
   net. The backup-download handler now calls saveAutoSnapshot() instead,
   which warns in plain words when it cannot save. */
function renderSnapshots() {
  const box = document.getElementById("snapshot-list");
  // v150: show the newest backup in plain words, so it is visible that
  // backups are being recorded, and when the last one was saved.
  const lastLine = document.getElementById("last-backup-line");
  const snapsForLine = loadSnapshots();
  if (lastLine) {
    if (!snapsForLine.length) {
      lastLine.textContent = "No backup saved in this app yet. A backup is saved automatically when you add entries.";
    } else {
      let newestSummary = "";
      try {
        const parsed = validateStore(JSON.parse(snapsForLine[0].data));
        newestSummary = parsed ? snapshotSummary(parsed) : "";
      } catch {}
      const label = new Date(snapsForLine[0].at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      lastLine.textContent = "Last backup in this app: " + label + (newestSummary ? " (" + newestSummary + ")" : "") + ". " + snapsForLine.length + " backup" + (snapsForLine.length === 1 ? "" : "s") + " kept.";
    }
  }
  if (!box) return;
  const snaps = snapsForLine;
  if (!snaps.length) { box.innerHTML = ""; return; }
  // v162: only the newest backup shows in full. Older ones sit behind a
  // closed "Show older backups" toggle, so Settings stays clean and the
  // restore points are still there when she needs one.
  const rowHtml = (sn, i) => {
    const label = new Date(sn.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }) + (i === 0 ? " · Newest" : "")
      + (sn.label === "Before delete" ? " · Safety copy kept when you deleted your data" : sn.label ? " · " + sn.label : "");
    let summary = "Could not be read";
    let corrupt = false;
    try {
      const parsed = validateStore(JSON.parse(sn.data));
      if (!parsed) throw new Error("bad snapshot");
      summary = snapshotSummary(parsed);
    } catch { corrupt = true; }
    if (corrupt) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line)"><span>' + label + '<br><span class="muted" style="font-size:.85em">This backup is damaged and cannot be restored.</span></span><button type="button" class="btn btn-small" disabled aria-label="Backup from ' + escapeHtml(label) + ' is damaged and cannot be restored">Restore</button></div>';
    }
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-top:1px solid var(--line)"><span>' + label + '<br><span class="muted" style="font-size:.85em">' + escapeHtml(summary) + '</span></span><button type="button" class="btn btn-small" data-restore-snap="' + escapeHtml(sn.at) + '" aria-label="Restore backup from ' + escapeHtml(label) + '">Restore</button></div>';
  };
  let html = '<p class="muted" style="margin:0 0 4px">Recent backups saved in this app:</p>' + rowHtml(snaps[0], 0);
  if (snaps.length > 1) {
    html += '<details style="margin-top:6px"><summary>Show older backups (' + (snaps.length - 1) + ')</summary>' + snaps.slice(1).map((sn, j) => rowHtml(sn, j + 1)).join("") + '</details>';
  }
  box.innerHTML = html;
  box.querySelectorAll("[data-restore-snap]").forEach((b) => b.addEventListener("click", () => {
    // Look the snapshot up by its timestamp, not by its position in the
    // list: the list can change between render and click, and a positional
    // index could then restore the wrong snapshot.
    const snap = loadSnapshots().find((s) => s.at === b.dataset.restoreSnap);
    if (!snap) return;
    let snapStore = null;
    try { snapStore = validateStore(JSON.parse(snap.data)); } catch {}
    if (!snapStore) { alert("That backup is damaged and cannot be restored. Nothing was changed."); return; }
    const snapSummary = snapshotSummary(snapStore);
    const snapLabel = new Date(snap.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
    if (countStoreEntries(snapStore) === 0) {
      if (!confirm("This snapshot from " + snapLabel + " is empty, no entries. Restoring it will replace your current data with nothing. Are you sure you want to restore an empty snapshot?")) return;
    } else if (!confirm("Restore this snapshot from " + snapLabel + "? It contains " + snapSummary + ". Your current data will be replaced. A safety copy of your current data will be kept first, just in case.")) return;
    try {
      takeSafetySnapshot("Before restore"); // current data kept first (S6)
      store = snapStore;
      ensureEntryIds();
      syncStartingWeight(); // K3: freeze from the restored first weigh-in if the snapshot predates the freeze
      loadFailed = false; // deliberate restore: the save guard must not block it
      storeDamaged = false;
      allowEmptySave = true; // a deliberate restore may replace the store with a smaller one
      adoptCurrentGen(); // write this restore as the newest copy
      resetViewState();
      saveStore();
      renderToday();
      renderInjections();
      renderWeight();
      renderMeasurements();
      renderPhotos();
      renderJournal();
      renderSideEffects();
      renderNextInjection();
      renderSettings();
      alert("Backup restored.");
    } catch { alert("That in app backup could not be read."); }
  }));
}

/* ---------- Backup & restore (JSON) ---------- */

document.getElementById("backup-data").addEventListener("click", () => {
  // v155: appVersion stamps which app version made the file, so a
  // backup sent in for help says which version it came from. It is
  // separate from version: 1, which is the backup file format version.
  // The restore check ignores it, so old files still restore.
  const backup = { app: "new-chapter-tracker", version: 1, appVersion: APP_VERSION, exported: new Date().toISOString(), store };
  // The loud snapshot writer, not the old silent one: if the in-app
  // backup copy cannot be saved, the user is told instead of it failing
  // quietly while the file download looks like it worked.
  saveAutoSnapshot();
  const msg = document.getElementById("backup-msg");
  try {
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "new-chapter-backup-" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    // Only a backup file counts as a backup: mark it done now that the
    // download was started (S10).
    try { localStorage.setItem("nct-sandbox-last-backup", todayStr()); } catch {}
    if (msg) { msg.textContent = "Backup downloaded. Check your Downloads folder."; msg.classList.add("success"); }
  } catch (err) {
    if (msg) { msg.textContent = "That download did not work. Try again."; msg.classList.remove("success"); }
  }
  renderBackupNudge();
  renderSnapshots();
});

document.getElementById("restore-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) { e.target.value = ""; return; }
  const reader = new FileReader();
  reader.onerror = () => {
    alert("That file could not be read. Try downloading a fresh backup from Settings and restoring that one.");
    e.target.value = "";
  };
  reader.onload = () => {
    try {
      const backup = JSON.parse(reader.result);
      if (!backup || backup.app !== "new-chapter-tracker" || !backup.store) {
        throw new Error("not a tracker backup");
      }
      if (backup.version !== undefined && backup.version !== 1) {
        throw new Error("unsupported backup version");
      }
      // Same per-key validation as a normal load: a malformed file is
      // rejected before anything is replaced (S11). Strict: any key with
      // the wrong shape rejects the whole file.
      const validStore = validateStore(backup.store, true);
      if (!validStore) throw new Error("backup store has the wrong shape");
      const fileSummary = snapshotSummary(validStore);
      if (countStoreEntries(validStore) === 0) {
        if (!confirm("This backup file is empty, no entries. Restoring it will replace your current data with nothing. Are you sure you want to restore an empty backup?")) return;
      } else if (!confirm("Restore this backup file? It contains " + fileSummary + ". Your current data will be replaced. A safety copy of your current data will be kept first, just in case.")) return;
      takeSafetySnapshot("Before restore"); // current data kept first (S6)
      store = validStore;
      ensureEntryIds();
      syncStartingWeight(); // K3: freeze from the restored first weigh-in if the backup predates the freeze
      loadFailed = false; // deliberate restore: the save guard must not block it
      storeDamaged = false;
      allowEmptySave = true; // a deliberate restore may replace the store with a smaller one
      adoptCurrentGen(); // write this restore as the newest copy
      resetViewState();
      saveStore();
      renderToday();
      renderInjections();
      renderWeight();
      renderMeasurements();
      renderPhotos();
      renderJournal();
      renderSideEffects();
      renderNextInjection();
      renderSettings();
      alert("Backup restored.");
    } catch (err) {
      alert("That file does not look like a backup from this app, so nothing was changed. Try downloading a fresh backup from Settings.");
    } finally {
      // Always reset, even if the confirm was cancelled, so picking the
      // same file again still works (S12).
      e.target.value = "";
    }
  };
  reader.readAsText(file);
});

document.getElementById("day-prev").addEventListener("click", () => {
  viewOffset--;
  renderToday();
});
document.getElementById("day-next").addEventListener("click", () => {
  if (viewOffset < 0) { viewOffset++; renderToday(); }
});

// Calendar date picker: jump straight to any past day
let dayCalYear, dayCalMonth;

function renderDayCalModal() {
  const now = new Date();
  if (dayCalYear === undefined) { dayCalYear = now.getFullYear(); dayCalMonth = now.getMonth(); }
  document.getElementById("day-cal-title").textContent =
    new Date(dayCalYear, dayCalMonth, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const grid = document.getElementById("day-cal-grid");
  const todayS = todayStr(0);
  const viewingS = todayStr(viewOffset);
  const startDow = new Date(dayCalYear, dayCalMonth, 1).getDay();
  const daysInMonth = new Date(dayCalYear, dayCalMonth + 1, 0).getDate();
  let html = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) html += `<div class="day other-month"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = dayCalYear + "-" + String(dayCalMonth + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const cls = ["day"];
    if (ds === todayS) cls.push("today");
    if (ds === viewingS) cls.push("selected");
    const future = ds > todayS;
    html += `<div class="${cls.join(" ")}${future ? " disabled" : ""}" ${future ? `aria-disabled="true" aria-label="${formatDate(ds)}, not available yet"` : `data-pick-date="${ds}" role="button" tabindex="0" aria-label="Pick ${formatDate(ds)}"`}>${d}</div>`;
  }
  grid.innerHTML = html;
  grid.querySelectorAll("[data-pick-date]").forEach((el) => {
    const pick = () => {
      viewOffset = daysBetween(todayStr(), el.dataset.pickDate);
      renderToday();
      closeDayCalModal();
    };
    el.addEventListener("click", pick);
    el.addEventListener("keydown", (e) => {
      if (calendarArrowNav(e, el.dataset.pickDate, "data-pick-date")) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); }
    });
  });
}

let dayCalOpener = null;
function closeDayCalModal() {
  document.getElementById("day-cal-modal").classList.add("hidden");
  const opener = dayCalOpener && document.contains(dayCalOpener)
    ? dayCalOpener
    : document.getElementById("day-cal");
  if (opener) opener.focus();
  dayCalOpener = null;
}

function openDayPicker() {
  const now = new Date();
  dayCalOpener = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : document.getElementById("day-cal");
  dayCalYear = now.getFullYear(); dayCalMonth = now.getMonth();
  renderDayCalModal();
  document.getElementById("day-cal-modal").classList.remove("hidden");
  /* WCAG 2.4.3: move focus into the dialog on open, so tabbing does not go through background content first. Close already returns focus to the opener, and Escape already closes it. */
  document.getElementById("day-cal-close").focus();
}
document.getElementById("day-cal-prev").addEventListener("click", () => {
  dayCalMonth--; if (dayCalMonth < 0) { dayCalMonth = 11; dayCalYear--; } renderDayCalModal();
});
document.getElementById("day-cal-next").addEventListener("click", () => {
  dayCalMonth++; if (dayCalMonth > 11) { dayCalMonth = 0; dayCalYear++; } renderDayCalModal();
});
document.getElementById("day-cal-close").addEventListener("click", closeDayCalModal);
document.getElementById("day-cal-modal").addEventListener("click", (e) => {
  if (e.target.id === "day-cal-modal") closeDayCalModal();
});
/* Focus trap: Tab cycles inside the open date-picker dialog (F29). */
document.getElementById("day-cal-modal").addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const modal = document.getElementById("day-cal-modal");
  const focusables = [...modal.querySelectorAll("button, [tabindex]")]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && el.offsetParent !== null);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.getElementById("day-cal-modal").classList.contains("hidden")) {
    e.preventDefault();
    closeDayCalModal();
  }
});

/* ---------- Shared dialog focus handling (WCAG 2.4.3, 2.1.1) ----------
   The date picker dialog is the pattern to copy: record the opener,
   move focus into the dialog, trap Tab inside it, return focus to the
   opener on close, and close on Escape. The trap binds to the dialog
   container, so it survives the recipe modal body being re-rendered.
   Note: the setup overlay gets the trap and the focus move and return,
   and Escape acts as Skip. Escape triggers the Skip button, so the
   Terms check still applies and nothing is marked done without it. */
const dialogOpeners = {};
function recordDialogOpener(id) {
  dialogOpeners[id] = document.activeElement && document.activeElement !== document.body
    ? document.activeElement
    : null;
}
function returnDialogFocus(id, fallbackId) {
  const opener = dialogOpeners[id];
  dialogOpeners[id] = null;
  if (opener && document.contains(opener)) { opener.focus(); return; }
  if (fallbackId) {
    const fb = document.getElementById(fallbackId);
    if (fb) fb.focus();
  }
}
function dialogFocusables(modal) {
  return [...modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]")]
    .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
}
function trapTabInDialog(modal, e) {
  if (e.key !== "Tab") return;
  const focusables = dialogFocusables(modal);
  if (!focusables.length) return;
  const first = focusables[0], last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function bindDialogFocusTrap(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.addEventListener("keydown", (e) => trapTabInDialog(modal, e));
}
bindDialogFocusTrap("recipe-modal");
bindDialogFocusTrap("doctor-modal");
bindDialogFocusTrap("scan-modal");
bindDialogFocusTrap("plate-modal");
bindDialogFocusTrap("setup-overlay");
bindDialogFocusTrap("more-sheet");
document.getElementById("day-cal").addEventListener("click", openDayPicker);
// Tapping the date heading itself also opens the picker
document.getElementById("date-tap").addEventListener("click", openDayPicker);
document.getElementById("date-tap").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDayPicker(); }
});



/* ---------- Clickwrap: Terms acceptance (v066) ---------- */
/* Required, unchecked checkbox before purchase (sales page) and at
   first run in the app. Acceptance is logged with a timestamp and
   the Terms version. The exact checkbox wording goes to the attorney
   later; the Terms themselves are not rewritten here. */
const TERMS_VERSION = "2026-11-11";
const TERMS_ACCEPT_KEY = "nct-terms-accepted";
function logTermsAcceptance() {
  try {
    localStorage.setItem(TERMS_ACCEPT_KEY, JSON.stringify({ at: new Date().toISOString(), termsVersion: TERMS_VERSION }));
  } catch {}
}
function setupTermsChecked() {
  const box = document.getElementById("setup-terms");
  // No checkbox in this copy (demo has no setup overlay): nothing to block.
  if (!box) return true;
  return box.checked;
}
function setupTermsMsg(text) {
  const msg = document.getElementById("setup-terms-msg");
  /* Route through setFormStatus so the error gets role="alert" and is
     announced, like every other form message in the app. */
  if (msg) setFormStatus(msg, text || "", !!text);
}

/* ---------- First-run setup wizard ---------- */

(function setupDefaults() {
  if (localStorage.getItem("nct-sandbox-setup-done")) return;
  // Set sensible defaults silently, no blocking wizard.
  // User can change everything in Settings.
  if (!store.settings.waterGoal) store.settings.waterGoal = 92;
  if (!store.settings.proteinGoal) store.settings.proteinGoal = 90;
  // Only save when there is actually something to save. Saving an empty
  // store here would write over a missing save with blank defaults (S2).
  try {
    if (JSON.stringify(store) !== JSON.stringify(DEFAULTS)) saveStore();
  } catch {}
  // The flag is set only when the first-run setup is finished or
  // skipped (see the setup overlay below), so a fresh install sees
  // the setup steps instead of landing on blank fields.
})();

/* ---------- First-run setup ---------- */
/* A 5-step setup shown once, on a fresh install: name, medication +
   dose, shot day, height + goal weight, and macro targets. Nothing is required: every
   step can be left blank, and Skip closes the setup without saving.
   Existing installs already have nct-sandbox-setup-done set and never see it. */
let setupStep = 1;
function showSetupStep(n) {
  setupStep = n;
  document.querySelectorAll("#setup-overlay .setup-step").forEach((s) => {
    s.classList.toggle("hidden", Number(s.dataset.step) !== n);
  });
  document.getElementById("setup-step-label").textContent = "Step " + n + " of 5";
  document.getElementById("setup-back").classList.toggle("hidden", n === 1);
  document.getElementById("setup-next").textContent = n === 5 ? "Finish" : "Next";
}
function finishSetup(save) {
  if (save) {
    const name = document.getElementById("setup-name").value.trim().slice(0, 60);
    if (name) store.settings.yourName = name;
    const med = document.getElementById("setup-med").value.trim();
    if (med) store.settings.medication = med;
    const dose = document.getElementById("setup-dose").value;
    if (dose) store.settings.dose = dose;
    const shotDay = document.getElementById("setup-shot-day").value;
    if (shotDay) store.settings.shotDay = shotDay;
    // v057: a blank height field stays blank (Number("") is 0, which
    // used to save 0 and show 0 in Settings). Same blank check as
    // the Settings save.
    const hftRaw = document.getElementById("setup-height-ft").value.trim();
    const hft = hftRaw === "" ? NaN : Number(hftRaw);
    if (Number.isFinite(hft) && hft >= 0 && hft <= 8) store.settings.heightFt = hft;
    const hinRaw = document.getElementById("setup-height-in").value.trim();
    const hin = hinRaw === "" ? NaN : Number(hinRaw);
    if (Number.isFinite(hin) && hin >= 0 && hin <= 11) store.settings.heightIn = hin;
    const gw = Number(document.getElementById("setup-goal-weight").value);
    if (gw > 0) store.settings.goalWeight = gw;
    const cal = Number(document.getElementById("setup-calorie-target").value);
    if (cal > 0) store.settings.calorieTarget = cal;
    const pg = Number(document.getElementById("setup-protein-goal").value);
    if (pg > 0) store.settings.proteinGoal = pg;
    const cg = Number(document.getElementById("setup-carb-goal").value);
    if (cg > 0) store.settings.carbGoal = cg;
    const fg = Number(document.getElementById("setup-fat-goal").value);
    if (fg > 0) store.settings.fatGoal = fg;
    saveStore();
  }
  try { localStorage.setItem("nct-sandbox-setup-done", "1"); } catch {}
  document.getElementById("setup-overlay").classList.add("hidden");
  returnDialogFocus("setup-overlay", "app-main");
  renderToday();
}
const setupNextBtn = document.getElementById("setup-next");
const setupBackBtn = document.getElementById("setup-back");
const setupSkipBtn = document.getElementById("setup-skip");
const setupOverlayEl = document.getElementById("setup-overlay");
if (setupNextBtn) setupNextBtn.addEventListener("click", () => {
  if (setupStep < 5) showSetupStep(setupStep + 1);
  else {
    if (!setupTermsChecked()) { setupTermsMsg("Please agree to the Terms to continue."); return; }
    setupTermsMsg("");
    logTermsAcceptance();
    finishSetup(true);
  }
});
if (setupBackBtn) setupBackBtn.addEventListener("click", () => {
  if (setupStep > 1) showSetupStep(setupStep - 1);
});
if (setupSkipBtn) setupSkipBtn.addEventListener("click", () => {
  if (!setupTermsChecked()) { setupTermsMsg("Please agree to the Terms to continue."); return; }
  setupTermsMsg("");
  logTermsAcceptance();
  finishSetup(false);
});
/* Escape acts as Skip: it triggers the Skip button, so the Terms
   check still applies and nothing is marked done without it. */
if (setupOverlayEl) setupOverlayEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { e.preventDefault(); if (setupSkipBtn) setupSkipBtn.click(); }
});
/* Setup step 5: fill macro grams from the calorie target at the
   decided split, 35% carbs, 33% fat, 32% protein. */
const setupFillPctBtn = document.getElementById("setup-fill-percent");
if (setupFillPctBtn) setupFillPctBtn.addEventListener("click", () => {
  const note = document.getElementById("setup-percent-note");
  const cal = Number(document.getElementById("setup-calorie-target").value);
  if (!(cal > 0)) {
    if (note) setFormStatus(note, "Enter your daily calorie target first.", true);
    return;
  }
  document.getElementById("setup-protein-goal").value = Math.round(cal * 32 / 100 / 4);
  document.getElementById("setup-carb-goal").value = Math.round(cal * 35 / 100 / 4);
  document.getElementById("setup-fat-goal").value = Math.round(cal * 33 / 100 / 9);
  if (note) setFormStatus(note, "Filled from your calorie target. You can change any number.", false);
});
if (!localStorage.getItem("nct-sandbox-setup-done") && setupOverlayEl) {
  recordDialogOpener("setup-overlay");
  showSetupStep(1);
  setupOverlayEl.classList.remove("hidden");
  /* H1: move focus into the dialog on open, so a keyboard user does not
     have to Tab through the whole Today tab behind the modal first.
     Tab is trapped inside by the shared dialog trap bound above. */
  const setupName = document.getElementById("setup-name");
  if (setupName) setupName.focus();
}

/* v063: Reset my lotus. Clears the lotus and the log only: the eleven
   log collections. Settings (goals, targets, companion name/avatar,
   theme) and Companion Memory (server-side, with its own Forget me
   control) stay untouched. The lotus is computed from logged dates
   (bloomProgress / loggedDates), so clearing the log closes it back
   to a closed bud automatically; nothing about the bloom is stored
   separately. Two steps in the page: the first tap shows exactly what
   clears and offers a backup first; only the second tap clears. A
   "Before reset" snapshot is kept in Backup & restore, so the reset
   can be undone by restoring it. The "ever had entries" marker is
   cleared with the log, the same as a deliberate delete. */
const RESET_LOG_KEYS = ["water", "protein", "exercise", "strength", "injections", "weight", "measurements", "photos", "journal", "sideEffects", "moods"];
function resetLotusLog() {
  let preResetSnap = null;
  try {
    if (countStoreEntries(store) > 0) {
      const built = buildSnapshotRaw(store);
      preResetSnap = { at: new Date().toISOString(), data: built.raw, label: "Before reset" };
    }
  } catch {}
  RESET_LOG_KEYS.forEach((k) => { store[k] = Array.isArray(store[k]) ? [] : {}; });
  saveStore();
  try { localStorage.removeItem("nct-ever-had-entries"); } catch {}
  try {
    if (preResetSnap) {
      const snaps = loadSnapshots();
      snaps.unshift(preResetSnap);
      localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
    }
  } catch {}
  renderToday();
  renderSnapshots();
}
document.getElementById("reset-lotus-start").addEventListener("click", () => {
  document.getElementById("reset-lotus-confirm").classList.remove("hidden");
  document.getElementById("reset-lotus-start").classList.add("hidden");
});
document.getElementById("reset-lotus-cancel").addEventListener("click", () => {
  document.getElementById("reset-lotus-confirm").classList.add("hidden");
  document.getElementById("reset-lotus-start").classList.remove("hidden");
  const msg = document.getElementById("reset-lotus-msg");
  if (msg) msg.textContent = "";
});
document.getElementById("reset-lotus-backup").addEventListener("click", () => {
  document.getElementById("backup-data").click();
});
document.getElementById("reset-lotus-confirm-btn").addEventListener("click", () => {
  resetLotusLog();
  document.getElementById("reset-lotus-confirm").classList.add("hidden");
  document.getElementById("reset-lotus-start").classList.remove("hidden");
  const msg = document.getElementById("reset-lotus-msg");
  if (msg) { msg.textContent = "Your lotus is a bud again, and your log is empty. Start fresh whenever you are ready."; msg.classList.add("success"); }
});

document.getElementById("clear-all-data").addEventListener("click", () => {
  if (!confirm("Delete all your data? Your entries will be gone. A safety copy stays in Backup & restore.")) return;
  if (!confirm("This deletes your entries, chat history, and custom activities. Your companion access stays connected.")) return;
  // Safety copy first, kept on its own: the startup safety net never
  // restores a "Before delete" copy, so deleting stays final (S14).
  let preDeleteSnap = null;
  try {
    if (countStoreEntries(store) > 0) {
      const built = buildSnapshotRaw(store);
      preDeleteSnap = { at: new Date().toISOString(), data: built.raw, label: "Before delete" };
    }
  } catch {}
  clearWeekDismissKeys();
  localStorage.removeItem(LS_KEY);
  // Leave a delete marker stamped with a fresh generation, so any other
  // copy of the app that was open at the time adopts the delete instead
  // of merging its stale entries back in (see saveStore, step 0).
  const deleteGen = Date.now();
  try { localStorage.setItem(GEN_KEY, String(deleteGen)); } catch {}
  try { localStorage.setItem("nct-sandbox-store-tombstone", String(deleteGen)); } catch {}
  localStorage.removeItem("nct-sandbox-ever-had-entries");
  localStorage.removeItem(LS_KEY + ".corrupt");
  localStorage.removeItem("nct-snapshots.corrupt");
  localStorage.removeItem("nct-sandbox-last-snapshot-day");
  localStorage.removeItem("nc_custom_activities");
  localStorage.removeItem("nct-sandbox-last-backup");
  localStorage.removeItem("nct-sandbox-backup-snooze");
  localStorage.removeItem(CHAT_KEY);
  localStorage.removeItem("nct-sandbox-setup-done");
  try { localStorage.setItem(SNAP_KEY, JSON.stringify(preDeleteSnap ? [preDeleteSnap] : [])); } catch {}
  location.reload();
});

/* ---------- Init ---------- */

/* v150: a render that throws halfway leaves a torn screen (some numbers
   new, the chart and milestone stale), which is how a mixed screen can
   appear. Catch it, say so in plain words, and keep rendering the rest,
   instead of failing silently. */
function safeRender(fn) {
  try { fn(); } catch {
    showStorageWarning("Something went wrong showing part of this screen. Your entries are still saved. Try reloading the app.");
  }
}

/* v153: after an update lands, say so once, instead of leaving the user
   to dig in Settings, About to check the version. The last version this
   copy recorded lives in localStorage; a different running version means
   an update just landed. A first install records the version silently:
   no setup marker and no saved entries means nothing was updated from.
   The writes are best-effort and never block the app. */
const LAST_VERSION_KEY = "nct-last-version";
function showVersionConfirmation() {
  let last = null;
  try { last = localStorage.getItem(LAST_VERSION_KEY); } catch {}
  if (last === APP_VERSION) return;
  if (!last) {
    // No version was ever recorded: this copy predates the version key.
    // Saved entries mean it is an update from an older copy, not a
    // first install. (The setup marker alone cannot tell them apart:
    // it is written on first run, before this check runs.)
    let existing = false;
    try { existing = localStorage.getItem("nct-sandbox-ever-had-entries") === "1"; } catch {}
    if (!existing) {
      try { localStorage.setItem(LAST_VERSION_KEY, APP_VERSION); } catch {}
      return;
    }
  }
  try { localStorage.setItem(LAST_VERSION_KEY, APP_VERSION); } catch {}
  // The update already landed, so the "new version is ready" card is
  // stale: hide it, so both cards never sit on screen together.
  const updateCard = document.getElementById("update-notice");
  if (updateCard) updateCard.classList.add("hidden");
  const card = document.getElementById("version-notice");
  const text = document.getElementById("version-notice-text");
  if (card && text) {
    text.textContent = "Updated to " + APP_VERSION + ".";
    card.classList.remove("hidden");
    // v162: the confirmation clears itself after 8 seconds, so it does
    // not sit on screen until she taps Got it. Got it still hides it now.
    setTimeout(() => { card.classList.add("hidden"); }, 8000);
  }
}

document.getElementById("version-notice-hide").addEventListener("click", () => {
  const card = document.getElementById("version-notice");
  if (card) card.classList.add("hidden");
});

/* Check whether a newer app version is published, even when the service
   worker has not picked it up yet. version.json is fetched fresh on
   every load (never cached by the worker) and compared with this copy's
   version; a mismatch shows the same update card the worker path uses. */
function checkForAppUpdate() {
  if (!window.fetch) return;
  fetch("./version.json", { cache: "no-store" })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((data) => {
      if (data && typeof data.version === "string" && data.version !== APP_VERSION) {
        const card = document.getElementById("update-notice");
        if (card) card.classList.remove("hidden");
      }
    })
    .catch(() => {}); // offline or unreachable: the app keeps working
}

/* Custom activities (v165): the movement activity picker is gone, so
   nothing adds to this list anymore. The read stays so a damaged value
   saved by an older version is still stashed aside, not silently
   dropped (V14), instead of letting a later save overwrite it. */
function getCustomActivities() {
  try {
    const parsed = JSON.parse(localStorage.getItem("nc_custom_activities") || "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    // Same rule as chat history: stash the damaged copy instead of
    // letting the next save overwrite it silently.
    try { localStorage.setItem("nc_custom_activities.corrupt", localStorage.getItem("nc_custom_activities") || ""); } catch {}
    return [];
  }
}
function loadCustomActivities() {
  getCustomActivities();
}

maybeRestoreFromSnapshot();
if (ensureEntryIds()) saveStore(); // persist ids given to old entries (F27)
loadCustomActivities();
applyAppearance(); // v000: theme and text size from settings, before first paint of the tabs
safeRender(renderToday);
safeRender(renderInjections);
safeRender(renderWeight);
safeRender(renderMeasurements);
safeRender(renderPhotos);
safeRender(renderJournal);
safeRender(renderSideEffects);
safeRender(renderSettings);
renderRestoreNotice();
renderCorruptNotice();
renderEmptyNotice();
showVersionConfirmation();
checkForAppUpdate();

/* ---------- AI Wellness Companion chat ---------- */

// Update this URL after deploying the Worker
const COMPANION_API_URL = "https://github-fetcher.millrjess.workers.dev/api/chat";
const MEMORY_API_URL = "https://github-fetcher.millrjess.workers.dev/api/memory";

/* ---------- Companion memory (opt-in) ---------- */

function memoryHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = getAuthToken();
  if (token) headers["X-Auth-Token"] = token;
  return headers;
}

async function loadCoachMemory() {
  const toggle = document.getElementById("memory-toggle");
  if (!toggle) return;
  try {
    const res = await fetch(MEMORY_API_URL, { headers: memoryHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (data.profile) {
      toggle.checked = true;
      document.getElementById("memory-fields").classList.remove("hidden");
      document.getElementById("memory-name").value = data.profile.name || "";
      // v004: if the greeting name is blank, fill it from the name already
      // saved here, so the greeting uses it without typing it twice.
      if (!(store.settings.yourName || "").trim() && data.profile.name) {
        store.settings.yourName = String(data.profile.name).trim().slice(0, 60);
        saveStore();
        renderGreeting();
      }
      document.getElementById("memory-goals").value = data.profile.goals || "";
      document.getElementById("memory-preferences").value = data.profile.preferences || "";
      document.getElementById("memory-saved-msg").classList.remove("hidden");
      document.getElementById("memory-optin-card").removeAttribute("open");
    }
  } catch (e) {
    // Memory unavailable; leave opt-in off
  }
}

document.getElementById("memory-toggle").addEventListener("change", (e) => {
  const on = e.target.checked;
  document.getElementById("memory-fields").classList.toggle("hidden", !on);
  if (!on) {
    // Turning off deletes the stored profile; put the switch back if it fails.
    fetch(MEMORY_API_URL, { method: "DELETE", headers: memoryHeaders() }).then((res) => {
      if (!res.ok) {
        e.target.checked = true;
        document.getElementById("memory-fields").classList.remove("hidden");
        alert("That did not work. Check your connection and try again. Your companion still remembers you.");
      }
    }).catch(() => {
      e.target.checked = true;
      document.getElementById("memory-fields").classList.remove("hidden");
      alert("That did not work. Check your connection and try again. Your companion still remembers you.");
    });
    document.getElementById("memory-saved-msg").classList.add("hidden");
  }
});

document.getElementById("memory-save").addEventListener("click", async () => {
  const profile = {
    name: document.getElementById("memory-name").value.trim(),
    goals: document.getElementById("memory-goals").value.trim(),
    preferences: document.getElementById("memory-preferences").value.trim(),
  };
  try {
    const res = await fetch(MEMORY_API_URL, {
      method: "POST",
      headers: memoryHeaders(),
      body: JSON.stringify(profile),
    });
    if (res.ok) {
      document.getElementById("memory-saved-msg").classList.remove("hidden");
      document.getElementById("memory-optin-card").removeAttribute("open");
    } else if (res.status === 400) {
      alert("Companion memory needs your personal key. Use the 'Get your personal app link' box on the welcome page to get one.");
    } else {
      alert("Could not save. Check your connection and try again.");
    }
  } catch (e) {
    alert("Could not reach the service. Check your connection and try again.");
  }
});

/* Companion memory (v037): when the section is opened, bring it into
   view so the whole detail shows inside the visible area instead of
   running under the keyboard. */
document.getElementById("memory-optin-card").addEventListener("toggle", (e) => {
  const summary = e.target.querySelector("summary");
  if (summary) summary.setAttribute("aria-expanded", String(e.target.open));
  if (e.target.open) e.target.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

document.getElementById("forget-me").addEventListener("click", async () => {
  if (!confirm("Delete everything your AI Wellness Companion remembers about you? This cannot be undone.")) return;
  let ok = false;
  try {
    const res = await fetch(MEMORY_API_URL, { method: "DELETE", headers: memoryHeaders() });
    ok = res.ok;
  } catch (e) { ok = false; }
  if (!ok) {
    alert("That did not work. Check your connection and try again. Nothing was deleted.");
    return;
  }
  const toggle = document.getElementById("memory-toggle");
  if (toggle) {
    toggle.checked = false;
    document.getElementById("memory-fields").classList.add("hidden");
    document.getElementById("memory-saved-msg").classList.add("hidden");
  }
  alert("Done. Your companion no longer remembers you.");
});

const CHAT_KEY = "newChapterTracker.sandbox.chat.v1";
let chatHistory = loadChatHistory();

// Capture the auth token from the buyer link (?key=...) on first visit,
// then persist it in localStorage. The token is never in the public code.
(function captureAuthToken() {
  try {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    if (key && key.length >= 16) {
      localStorage.setItem(TOKEN_KEY, key);
      // Only scrub the key from the address bar when running as an installed
      // app. In a browser tab, keep it so Share > Add to Home Screen carries it.
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches
        || window.navigator.standalone === true;
      if (isStandalone) {
        params.delete("key");
        const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", clean);
      }
    }
  } catch {
    /* URL parsing unavailable */
  }
})();

function loadChatHistory() {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    // A damaged chat history must not be silently dropped and then
    // overwritten by the next message: stash the raw copy aside, like
    // the store does, so it can be recovered.
    try { localStorage.setItem(CHAT_KEY + ".corrupt", localStorage.getItem(CHAT_KEY) || ""); } catch {}
    return [];
  }
}

function saveChatHistory() {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(chatHistory.slice(-20)));
  } catch {
    /* storage unavailable; chat works for this session */
  }
}

function renderMarkdown(text) {
  // Escape HTML first to prevent XSS, then apply basic markdown
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withInline = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*(.+?)\*/g, "$1<em>$2</em>");

  // Build lists line by line so spacing stays clean
  const lines = withInline.split("\n");
  let html = "";
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += "<li>" + bullet[1] + "</li>";
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (line.trim()) html += line + "<br>";
    }
  }
  if (inList) html += "</ul>";
  // Remove trailing <br>
  return html.replace(/(<br>)+$/, "");
}

/* Morning check-in (v166): local and rule-based only, no worker call.
   On mornings (5:00 to noon) the Companion speaks first with one gentle
   question for the day, rotating by the day of the year. The card is
   not part of chat history; it simply opens the conversation. */
const MORNING_CHECKIN_QUESTIONS = [
  "How did you sleep last night?",
  "What is one small thing you want to do for yourself today?",
  "How is your energy feeling this morning?",
  "What would make today feel like a win?",
  "How is your appetite this morning?",
  "Is there anything on your mind today?",
  "What are you most looking forward to today?"
];
function renderMorningCheckin() {
  const card = document.getElementById("morning-checkin");
  if (!card) return;
  const now = new Date();
  const h = now.getHours();
  if (h < 5 || h >= 12) { card.classList.add("hidden"); return; }
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const q = MORNING_CHECKIN_QUESTIONS[dayOfYear % MORNING_CHECKIN_QUESTIONS.length];
  document.getElementById("morning-checkin-q").textContent = q;
  const connected = !!getAuthToken();
  const replyBtn = document.getElementById("morning-checkin-reply");
  if (replyBtn) replyBtn.classList.toggle("hidden", !connected);
  const connectLine = document.getElementById("morning-checkin-connect");
  if (connectLine) connectLine.classList.toggle("hidden", connected);
  card.classList.remove("hidden");
  // v000: when read-aloud is on, the morning question is read aloud
  // once per day, using the phone's own voice.
  if (store.settings.readAloud) {
    const today = todayStr();
    if (checkinSpokenDate !== today) {
      checkinSpokenDate = today;
      speakCompanion(q);
    }
  }
}
let checkinSpokenDate = "";
document.getElementById("morning-checkin-reply").addEventListener("click", () => {
  // The check-in card sits on the Companion tab, so the button opens
  // the chat tab first, then focuses the input.
  showTab("chat");
  const input = document.getElementById("chat-input");
  if (input) input.focus();
});

/* v000: Appearance. The theme and text size switch CSS variables
   through data attributes on the root element. The default stays
   the sage, gold, and cream brand look; gold accents and the gold
   lotus stay gold in every theme. */
function applyAppearance() {
  const s = store.settings;
  const theme = ["sage", "dark", "cream"].includes(s.theme) ? s.theme : "sage";
  const size = s.textSize === "large" ? "large" : "normal";
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.setAttribute("data-text-size", size);
}

/* v000: talking voice for the Companion. Uses the phone's built-in
   speech (speechSynthesis), on-device and free; no server, no cost.
   The voice is the phone's own system voice, not a custom voice. */
let currentUtterance = null;
function speakCompanion(text) {
  if (!("speechSynthesis" in window)) return false;
  const clean = String(text || "").replace(/[*#_`>\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    currentUtterance = u;
    u.onend = () => { if (currentUtterance === u) currentUtterance = null; };
    u.onerror = () => { if (currentUtterance === u) currentUtterance = null; };
    window.speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}
function stopSpeaking() {
  if (!("speechSynthesis" in window)) return;
  try { window.speechSynthesis.cancel(); } catch {}
  currentUtterance = null;
}
function isSpeaking() { return currentUtterance !== null; }
let lastSpokenReply = "";
function maybeReadAloud() {
  // v000: when read-aloud is on, a new Companion reply is read aloud
  // once. The guard keeps a re-render from speaking the same reply
  // twice.
  if (!store.settings.readAloud) return;
  const last = chatHistory[chatHistory.length - 1];
  if (last && last.role === "assistant" && last.content && last.content !== lastSpokenReply) {
    lastSpokenReply = last.content;
    speakCompanion(last.content);
  }
}

// v080: the chat mic and speaker are inline SVG, matching the tab-bar
// icons, instead of emoji.
const MIC_SVG = '<svg aria-hidden="true" focusable="false" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const SPEAKER_SVG = '<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const STOP_SVG = '<svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
function renderChat() {
  renderMorningCheckin();
  // v000: the chat header shows the Companion's chosen name and avatar.
  const title = document.getElementById("chat-title");
  if (title) title.textContent = companionDisplayName() === COMPANION_DEFAULT_NAME ? "Companion" : companionDisplayName();
  const headerAvatar = document.getElementById("chat-header-avatar");
  if (headerAvatar) {
    const fresh = companionAvatarImg("chat-header-avatar");
    fresh.id = "chat-header-avatar";
    headerAvatar.replaceWith(fresh);
  }
  const input = document.getElementById("chat-input");
  if (input) input.placeholder = "Ask " + (companionDisplayName() === COMPANION_DEFAULT_NAME ? "the Companion" : companionDisplayName()) + "...";
  growChatInput();
  const box = document.getElementById("chat-messages");
  if (!box) return;
  box.innerHTML = "";
  // v000: assistant messages sit in a row with the Companion's chosen
  // avatar beside them, and a speaker button that reads the reply
  // aloud with the phone's own voice.
  const listenBtn = (text) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-small chat-listen";
    b.setAttribute("aria-label", "Listen to this reply");
    b.innerHTML = SPEAKER_SVG + " Listen";
    b.dataset.text = text;
    b.addEventListener("click", () => {
      if (isSpeaking()) { stopSpeaking(); b.innerHTML = SPEAKER_SVG + " Listen"; b.classList.remove("playing"); b.setAttribute("aria-label", "Listen to this reply"); return; }
      if (speakCompanion(text)) {
        b.innerHTML = STOP_SVG + " Stop";
        b.classList.add("playing");
        b.setAttribute("aria-label", "Stop listening");
        const u = currentUtterance;
        if (u) {
          const done = () => { b.innerHTML = SPEAKER_SVG + " Listen"; b.classList.remove("playing"); b.setAttribute("aria-label", "Listen to this reply"); };
          u.addEventListener("end", done);
          u.addEventListener("error", done);
        }
      }
    });
    return b;
  };
  if (chatHistory.length === 0) {
    // v080: no greeting or Listen button until connected; the warning
    // card above is the only thing shown when not connected.
    if (!getAuthToken()) return;
    const welcomeText = "Hi, I am " + companionDisplayName() + ". Ask me about protein, water, or movement, or tell me how your day is going.";
    const row = document.createElement("div");
    row.className = "chat-row assistant";
    row.appendChild(companionAvatarImg());
    const wrap = document.createElement("div");
    wrap.className = "chat-msg-wrap";
    const welcome = document.createElement("div");
    welcome.className = "chat-msg assistant";
    welcome.textContent = welcomeText;
    wrap.appendChild(welcome);
    wrap.appendChild(listenBtn(welcomeText));
    row.appendChild(wrap);
    box.appendChild(row);
    // v080: three tappable prompts under the greeting; tapping one
    // fills the input so it can be sent or edited first.
    const prompts = document.createElement("div");
    prompts.className = "chat-prompts";
    ["How can I get more protein today?", "What is a good walk to try?", "I feel tired today"].forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-small chat-prompt";
      b.textContent = p;
      b.addEventListener("click", () => {
        const input = document.getElementById("chat-input");
        if (input) { input.value = p; input.focus(); growChatInput(); }
      });
      prompts.appendChild(b);
    });
    box.appendChild(prompts);
    return;
  }
  chatHistory.forEach((m) => {
    const row = document.createElement("div");
    row.className = "chat-row " + (m.role === "user" ? "user" : "assistant");
    if (m.role === "assistant") row.appendChild(companionAvatarImg());
    if (m.role === "assistant") {
      const wrap = document.createElement("div");
      wrap.className = "chat-msg-wrap";
      const div = document.createElement("div");
      div.className = "chat-msg assistant";
      div.innerHTML = renderMarkdown(m.content);
      wrap.appendChild(div);
      wrap.appendChild(listenBtn(m.content));
      row.appendChild(wrap);
    } else {
      const div = document.createElement("div");
      div.className = "chat-msg user";
      div.textContent = m.content;
      row.appendChild(div);
    }
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
}

function addTypingIndicator() {
  const box = document.getElementById("chat-messages");
  if (!box) return null;
  const row = document.createElement("div");
  row.className = "chat-row assistant";
  row.appendChild(companionAvatarImg());
  const div = document.createElement("div");
  div.className = "chat-msg assistant typing";
  div.id = "chat-typing";
  div.textContent = "Thinking...";
  row.appendChild(div);
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
  return row; // the caller removes the whole row (lotus included)
}

/* Clear chat history (v049, R-23): the Companion keeps at most 20
   messages; this removes them all, from the device and from memory,
   after a confirm. Nothing else is touched. */
document.getElementById("chat-clear-btn").addEventListener("click", () => {
  if (!chatHistory.length) return;
  if (!confirm("Clear your chat history? This cannot be undone.")) return;
  chatHistory = [];
  try { localStorage.removeItem(CHAT_KEY); } catch {}
  renderChat();
});
document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  stopSpeaking(); // a new message stops any reply still being read aloud
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) {
    setFormStatus(document.getElementById("chat-msg"), "Type a message before sending.", true);
    input.focus();
    return;
  }
  setFormStatus(document.getElementById("chat-msg"), "", false);
  input.value = "";
  growChatInput();

  // Add user message
  chatHistory.push({ role: "user", content: text });
  saveChatHistory();
  renderChat();

  // Play subscribers without a companion token cannot call the worker yet.
  // Show a Play specific message instead of the website welcome email message.
  if (playChatBlocked()) {
    chatHistory.push({
      role: "assistant",
      content: "Your Play subscription is active, but companion chat for Play subscribers is still being connected. You can enter a companion key in Settings if you have one from the website.",
    });
    saveChatHistory();
    renderChat();
    maybeReadAloud();
    return;
  }

  // Show typing indicator
  const typing = addTypingIndicator();
  const sendBtn = document.getElementById("chat-send");
  sendBtn.disabled = true;

  try {
    const headers = { "Content-Type": "application/json" };
    const token = getAuthToken();
    if (token) {
      headers["X-Auth-Token"] = token;
    }
    const res = await fetch(COMPANION_API_URL, {
      method: "POST",
      headers: headers,
      // v000: pass the Companion's chosen name so the worker can
      // include it in the system prompt ("Your name is X"). Sent
      // only when a custom name is set.
      body: JSON.stringify({ messages: chatHistory, companionName: companionDisplayName() === COMPANION_DEFAULT_NAME ? undefined : companionDisplayName() }),
    });

    const data = await res.json();

    if (typing) typing.remove();

    if (res.status === 401) {
      // Missing or invalid token. Play users get Play guidance, website
      // users get the welcome email guidance.
      const playService = await getPlayService();
      if (playService) {
        chatHistory.push({
          role: "assistant",
          content: "Your AI Wellness Companion is not connected yet. Subscribe in Settings, or enter a companion key if you have one from the website.",
        });
      } else {
        chatHistory.push({
          role: "assistant",
          content: hadCompanionToken()
            ? "Your subscription ended. Resubscribe in Settings to reconnect your Companion."
            : "Your AI Wellness Companion needs your personal app link to work. Please open the link from your welcome email.",
        });
      }
    } else if (data.reply) {
      chatHistory.push({ role: "assistant", content: data.reply });
    } else if (data.message) {
      // Rate limit message from Worker
      chatHistory.push({ role: "assistant", content: data.message });
    } else {
      chatHistory.push({
        role: "assistant",
        content: "I am having trouble right now. Please try again in a moment.",
      });
    }
  } catch (err) {
    if (typing) typing.remove();
    chatHistory.push({
      role: "assistant",
      content: "I could not reach the AI Wellness Companion service. Check your connection and try again.",
    });
  }

  saveChatHistory();
  renderChat();
  maybeReadAloud();
  sendBtn.disabled = false;
});

/* ---------- A growing chat input (v037) ---------- */
/* The input is a textarea that grows as you type, up to eight lines,
   and Enter sends (Shift+Enter adds a line). Nothing here is a new
   data path; no new data leaves the device. */
function growChatInput() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 204) + "px";
}
function submitChatForm() {
  const form = document.getElementById("chat-form");
  if (!form) return;
  if (form.requestSubmit) form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { cancelable: true }));
}
(function setupGrowingChatInput() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.addEventListener("input", growChatInput);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitChatForm();
    }
  });
  growChatInput();
})();

/* v000: two-way voice. The mic button starts the phone's built-in
   speech recognition (webkitSpeechRecognition / SpeechRecognition),
   on-device and free; no server, no cost. Recognized words fill the
   chat input as the person speaks (interim results shown live). When
   the person stops, the text stays in the input to check and send.
   Nothing auto-sends, and no audio is recorded, saved, or sent
   anywhere. If recognition is not available, the button stays hidden
   and the chat works exactly as before. */
(function setupChatMic() {
  const micBtn = document.getElementById("chat-mic");
  const input = document.getElementById("chat-input");
  const statusEl = document.getElementById("chat-msg");
  if (!micBtn || !input) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return; // not available: the button stays hidden
  micBtn.classList.remove("hidden");
  let rec = null;
  let listening = false;
  let finalText = "";
  function setListening(on) {
    listening = on;
    micBtn.setAttribute("aria-label", on ? "Stop listening" : "Talk instead of typing");
    micBtn.title = on ? "Stop listening" : "Talk instead of typing";
    micBtn.innerHTML = on ? STOP_SVG + " Stop" : MIC_SVG;
    micBtn.classList.toggle("listening", on);
    if (statusEl) setFormStatus(statusEl, on ? "Listening... Tap Stop when you are done." : "", false);
  }
  micBtn.addEventListener("click", () => {
    if (listening) { try { rec.stop(); } catch {} return; }
    stopSpeaking();
    try {
      rec = new SR();
    } catch { return; }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    finalText = input.value ? input.value.trim() + " " : "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      input.value = (finalText + interim).trimStart();
      growChatInput();
    };
    rec.onend = () => { setListening(false); };
    rec.onerror = (ev) => {
      setListening(false);
      if (statusEl) {
        const msg = ev && ev.error === "not-allowed"
          ? "Microphone access was blocked. You can still type."
          : "I could not hear you. You can still type.";
        setFormStatus(statusEl, msg, true);
      }
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  });
})();

// Render chat when tab is opened
/* The chat tab is on the main nav, so showTab renders the chat
   itself; no separate [data-tab="chat"] listener is needed. */
