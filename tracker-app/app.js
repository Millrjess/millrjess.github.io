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
const APP_VERSION = "v038";

const LS_KEY = "newChapterTracker.v1";
/* Generation counter for the store (v150): bumped on every successful
   save. An instance remembers the generation it loaded; if the saved
   generation changed since, another copy of the app saved newer entries,
   and this instance must merge instead of overwriting. This is what
   stops a stale or empty copy from silently wiping good data. */
const GEN_KEY = "nct-store-gen";
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
const TOKEN_KEY = "newChapterTracker.authToken.v1";
function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

const DEFAULTS = {
  settings: {
    medication: "Zepbound",
    dose: "",
    shotDay: "",
    waterGoal: 92,
    proteinGoal: "", // v005: no preset; the user sets their own target in Settings
    movementGoal: 30,
    waterStep: 8, // v004: ounces the "+ 8 oz" quick-add button adds
    carbGoal: "", // v005: no preset; the user sets their own target in Settings
    fatGoal: "", // v005: no preset; the user sets their own target in Settings
    calorieTarget: "", // v169: optional daily calorie target for the macros card; blank means none, no default
    heightFt: "", // v168: feet, for BMI on the Weight tab
    heightIn: "", // v168: inches, for BMI on the Weight tab
    movementPlan: null, // v168: null means the 5-minute default routine; otherwise [{ name, detail }]
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
    companionVoice: "", // v001: the chosen speech voice name; blank means the phone default
    yourName: "" // v004: your own first name, for the greeting on Today; blank means just "Good morning."
  },
  water: [],        // { id, date: "YYYY-MM-DD", oz: number }
  protein: [],      // { id, date, grams, food, carbs, fat } (carbs/fat added v168; grams is protein)
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
  medicines: [],    // { id, name, dose, time, date } daily medicines besides the GLP-1 shot
  medicineTaken: {}, // { "YYYY-MM-DD": [medicine ids taken that day] }
  recipes: [],       // { id, title, body, date } saved recipes
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
const COLLECTION_KEYS = ["water", "protein", "exercise", "strength", "injections", "weight", "measurements", "photos", "journal", "sideEffects", "medicines", "recipes"];

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
    for (const g of ["waterGoal", "proteinGoal", "movementGoal", "carbGoal", "fatGoal", "routineMinutes", "waterStep"]) {
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
    out.settings.companionVoice = typeof out.settings.companionVoice === "string" ? out.settings.companionVoice.slice(0, 200) : "";
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
  // Per-day medicine check-offs. Keep only real dates; each day holds
  // the medicine ids taken that day.
  if (parsed.medicineTaken !== undefined && (typeof parsed.medicineTaken !== "object" || Array.isArray(parsed.medicineTaken))) {
    lastValidateDropped.push("medicineTaken");
  } else if (parsed.medicineTaken && typeof parsed.medicineTaken === "object" && !Array.isArray(parsed.medicineTaken)) {
    const cleanTaken = {};
    for (const [d, v] of Object.entries(parsed.medicineTaken)) {
      if (!isValidDateStr(d) || !Array.isArray(v)) continue;
      cleanTaken[d] = v.filter((id) => typeof id === "string");
    }
    out.medicineTaken = cleanTaken;
  }
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
    showStorageWarning("Your entries were changed in another window or tab. Reload the app to see the newest entries.");
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
    try { tombstoneGen = Number(localStorage.getItem("nct-store-tombstone")) || 0; } catch {}
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
        showStorageWarning("Your entries were changed in another window or tab. The two copies were combined, so nothing was lost. Reload the app to see the newest entries.");
      }
    }
    // (2) Never let a smaller in-memory store replace a saved store that
    // has more entries. A deliberate empty restore sets allowEmptySave
    // first. A user deleting entries keeps her own settings, which is how
    // a deliberate deletion is told apart from a fresh start: a fresh
    // start has default settings while the saved copy has hers. When the
    // settings match, the smaller store is deliberate and the save is
    // allowed. When they differ, the save is refused and nothing is lost.
    // The frozen starting weight (K3) is left out of the comparison: it is
    // derived from the weight log, not a user preference, so clearing it
    // when the log is emptied must not look like a fresh start.
    const myCount = countStoreEntries(store);
    if (persistedCount > myCount && !allowEmptySave) {
      let settingsMatch = false;
      try {
        settingsMatch = !!persistedStore && settingsEqualIgnoringFreeze(store.settings, persistedStore.settings);
      } catch {}
      if (!settingsMatch) {
        showStorageWarning("Your latest change was not saved, because the saved copy on this device has entries that this screen does not show. Nothing was lost. Reload the app to see your entries.");
        return false;
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
  try { if (countStoreEntries(store) > 0) localStorage.setItem("nct-ever-had-entries", "1"); } catch {}
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
    recipes: (Array.isArray(s.recipes) ? s.recipes : []).map((r) => {
      const copy = Object.assign({}, r);
      if (copy.photo) delete copy.photo;
      return copy;
    })
  });
  const raw = JSON.stringify(stripped);
  return { raw, photosOmitted: (Array.isArray(s.photos) ? s.photos.length : 0) > 0, nearCap: raw.length > SNAPSHOT_WARN_BYTES };
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
        try { localStorage.setItem("nct-last-snapshot-day", todayStr()); } catch {}
        return;
      }
    }
    snaps.unshift({ at: new Date().toISOString(), data: built.raw });
    while (snaps.length > SNAPSHOT_KEEP) snaps.pop();
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
    localStorage.setItem("nct-last-snapshot-day", todayStr());
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
      if (k && k.indexOf("nct-week-dismiss:") === 0) keys.push(k);
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
  "Strong is the goal now, not small. Protein first, every day.",
  "Muscle is your longevity. Every gram of protein protects it.",
  "You showed up today. That matters more than any number.",
  "Consistency beats perfection, at every age.",
  "Energy is the real goal. The rest follows.",
  "This is your chapter. Write it strong.",
  "Be patient with your body. It has carried you this far.",
  "Small habits, repeated daily, create lasting change.",
  "Progress is not always visible, but it is always happening.",
  "You have earned every bit of wisdom in this chapter. Your body is catching up.",
  "Protein at every meal is a small choice that protects a lot.",
  "Water first, then the rest of the day feels easier.",
  "Movement does not have to be big to count. A short walk counts.",
  "Staying on your routine is what keeps the progress steady.",
  "Strength grows quietly, day by day, while you keep showing up.",
  "Rest is part of training, not a break from it.",
  "You are not starting over. You are continuing.",
  "A slow day still counts if you showed up for one good habit.",
  "Celebrate what your body can do today, not only what the scale says.",
  "One good meal, one good walk, one good night of sleep. That is enough for today.",
  "Muscle protects your independence. That is worth the effort.",
  "Keep your routine simple enough to repeat tomorrow.",
  "Progress does not require perfection, only persistence.",
  "Drink your water, eat your protein, move your body, and let the rest follow.",
  "Today is a new chapter, not a test.",
  "Good days are built, one choice at a time.",
  "Your strength is not measured by one weigh-in.",
  "Take care of the body that carries your life.",
  "You are doing this for the life you want to live, not for a number.",
  "Strong today, stronger tomorrow, one habit at a time."
];

function renderEncouragement() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.round((localMidnight(now) - localMidnight(start)) / 86400000);
  document.getElementById("encouragement-text").textContent =
    ENCOURAGEMENTS[dayOfYear % ENCOURAGEMENTS.length];
}

/* ---------- Tab navigation (v168: five tabs; Effects, Companion and
   Settings live under More) ---------- */

const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");
/* Panels that live under the More button: when one of them is showing,
   More is the active tab. */
const MORE_TABS = ["side-effects", "settings", "medicines", "recipes"];

function showTab(name) {
  if (name === "more") { openMoreSheet(); return; }
  closeMoreSheet();
  // v000: navigating away from the Companion stops any reply being
  // read aloud.
  if (name !== "chat") stopSpeaking();
  const activeTab = MORE_TABS.includes(name) ? "more" : name;
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === activeTab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
    if (b.dataset.tab === "more") b.setAttribute("aria-expanded", "false");
  });
  panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  window.scrollTo(0, 0);
  if (name === "weight") { drawWeightChart(); drawBMIChart(); }
  if (name === "shots") renderInjectionCalendar();
  if (name === "chat") { loadCoachMemory(); renderChat(); }
  if (name === "settings") renderPlaySubscription();
  if (name === "medicines") renderMedicines();
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

/* More sheet (v168, Companion moved to the main nav in v169): Effects
   and Settings live here. Opens from the More tab; picking one shows
   its panel and closes the sheet. Escape or the backdrop closes it
   without changing tabs. */
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
    const planModal = document.getElementById("movement-plan-modal");
    if (planModal && !planModal.classList.contains("hidden")) { e.preventDefault(); closeMovementPlanEditor(); return; }
    const doctorModal = document.getElementById("doctor-modal");
    if (doctorModal && !doctorModal.classList.contains("hidden")) { e.preventDefault(); closeDoctorModal(); return; }
    const addAmountModal = document.getElementById("add-amount-modal");
    if (addAmountModal && !addAmountModal.classList.contains("hidden")) { e.preventDefault(); closeAddAmount(); return; }
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
    if (diff === 1) return "Your shot day is tomorrow. Everything is ready.";
    if (diff === 0 && !store.injections.some((e) => e.date === todayStr() && (e.status || "On time") !== "Missed")) {
      return null; // the one-tap button covers today
    }
  }
  const pStreak = streakFor("protein", "grams", "proteinGoal");
  if (pStreak >= 3) return "You've hit your protein goal " + pStreak + " days in a row. That's how strength is built.";
  const wStreak = streakFor("water", "oz", "waterGoal");
  if (wStreak >= 3) return wStreak + " days of hitting your water goal. Your body feels the difference.";
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
    if (daysSince >= 7) return "It's been " + daysSince + " days since you weighed in. No pressure, just whenever you're ready.";
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
  card.open = true;
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
      ? "The month isn't over yet. Keep writing."
      : "That's a chapter worth keeping.";

  body.innerHTML = lines.map((l) => `<p style="margin:0 0 8px">${l}</p>`).join("") +
    `<p style="margin:12px 0 0;font-style:italic;color:var(--sage-deep)">${closing}</p>`;

  document.getElementById("review-next").style.visibility = isCurrent ? "hidden" : "";
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

/* ---------- Weekly digest ---------- */
/* A short weekly report: protein and water averages, movement total,
   weight trend, shots, and side effects. Monday to Sunday, with
   previous and next week navigation. Plain facts only, no failure
   language. */
let digestWeekStart = null; // Date of the Monday starting the shown week
function weekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay(); // 0 Sunday, 1 Monday
  x.setDate(x.getDate() - ((day + 6) % 7));
  return x;
}
function dateStrOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function renderWeeklyDigest() {
  const body = document.getElementById("digest-body");
  if (!body) return;
  const now = new Date();
  if (!digestWeekStart) digestWeekStart = weekMonday(now);
  const thisWeek = weekMonday(now);
  if (digestWeekStart > thisWeek) digestWeekStart = thisWeek;
  const start = new Date(digestWeekStart);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const isCurrent = dateStrOf(start) === dateStrOf(thisWeek);
  document.getElementById("digest-title").textContent = isCurrent
    ? "This week"
    : fmt(start) + " to " + fmt(end);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    days.push(dateStrOf(d));
  }
  const inWeek = (d) => d && days.includes(d);

  const daysLogged = new Set();
  ["water", "protein", "exercise", "weight", "injections", "journal", "sideEffects"].forEach((k) => {
    (store[k] || []).forEach((e) => { if (inWeek(e.date)) daysLogged.add(e.date); });
  });
  Object.keys(store.moods || {}).forEach((d) => { if (inWeek(d)) daysLogged.add(d); });

  const sumField = (key, field) => (store[key] || []).reduce((t, e) => inWeek(e.date) ? t + (Number(e[field]) || 0) : t, 0);
  const proteinTotal = sumField("protein", "grams");
  const waterTotal = sumField("water", "oz");
  const moveTotal = sumField("exercise", "minutes");
  const shots = (store.injections || []).filter((e) => inWeek(e.date)).length;
  const effects = (store.sideEffects || []).filter((e) => inWeek(e.date));

  const weights = (store.weight || []).filter((e) => inWeek(e.date)).sort(byDate);
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

  let effectLine = "";
  if (effects.length) {
    const counts = {};
    effects.forEach((e) => { const s = (e.symptom || "Side effect").trim(); counts[s] = (counts[s] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    effectLine = effects.length + " side effect" + (effects.length === 1 ? "" : "s") + " noted" +
      (top ? ", most often " + top[0] + " (" + top[1] + ")." : ".");
  }

  const lines = [];
  lines.push("You showed up " + daysLogged.size + " of 7 days.");
  if (proteinTotal) lines.push("Protein averaged " + Math.round(proteinTotal / 7) + " grams a day.");
  if (waterTotal) lines.push("Water averaged " + Math.round(waterTotal / 7) + " ounces a day.");
  if (moveTotal) lines.push("Movement totaled " + moveTotal + " minutes.");
  if (shots) lines.push(shots + " shot" + (shots === 1 ? "" : "s") + " logged.");
  if (effectLine) lines.push(effectLine);
  if (weightLine) lines.push(weightLine);

  const closing = daysLogged.size === 0
    ? "A quiet week. Next week is yours to write."
    : isCurrent
      ? "The week isn't over yet. Keep writing."
      : "That's a week worth keeping.";

  body.innerHTML = lines.map((l) => `<p style="margin:0 0 8px">${l}</p>`).join("") +
    `<p style="margin:12px 0 0;font-style:italic;color:var(--sage-deep)">${closing}</p>`;

  document.getElementById("digest-next").style.visibility = isCurrent ? "hidden" : "";
}

document.getElementById("digest-prev").addEventListener("click", () => {
  if (!digestWeekStart) digestWeekStart = weekMonday(new Date());
  digestWeekStart.setDate(digestWeekStart.getDate() - 7);
  renderWeeklyDigest();
});
document.getElementById("digest-next").addEventListener("click", () => {
  if (!digestWeekStart) digestWeekStart = weekMonday(new Date());
  digestWeekStart.setDate(digestWeekStart.getDate() + 7);
  renderWeeklyDigest();
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
    const avg = Math.round(total / PROGRESS_DAYS);
    const big = document.getElementById("progress-" + def.key + "-big");
    if (big) big.textContent = String(avg);
    const daysWith = values.filter((v) => v !== null).length;
    const note = document.getElementById("progress-" + def.key + "-note");
    if (note) {
      note.textContent = daysWith === 0
        ? "Nothing logged this week yet."
        : "Logged " + daysWith + " of 7 days." + (def.goal > 0 ? " Your target is " + def.goal + " grams a day." : "");
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
      noteW.textContent = "No weigh-ins this week. Log your weight to see the line.";
    }
  }
  const boxW = document.getElementById("progress-bars-weight");
  if (boxW) {
    const max = wSeen.length ? Math.max(...wSeen) : 0;
    const min = wSeen.length ? Math.min(...wSeen) : 0;
    boxW.innerHTML = wValues.map((v, i) => {
      let pct = 0;
      if (v !== null) {
        pct = max === min ? 50 : Math.round(8 + 92 * (v - (min - 1)) / (max - (min - 1)));
      }
      return progressBarCol(v, pct, "#44503E", progressDayLetter(dates[i]), v === null ? "" : v.toFixed(1));
    }).join("");
    boxW.setAttribute("aria-label", "Weight by day: " + wValues.map((v, i) => progressDayLetter(dates[i]) + " " + (v === null ? "no weigh-in" : v.toFixed(1) + " lbs")).join(", "));
  }

  const noteEl = document.getElementById("progress-note");
  if (noteEl) {
    noteEl.textContent = loggedDays.size === 0
      ? "Nothing logged this week yet. Log a food or your weight and the bars fill in."
      : loggedDays.size < PROGRESS_DAYS
        ? "Logged " + loggedDays.size + " of 7 days. Empty days stay blank."
        : "Seven days logged this week.";
  }
}
function openProgress() {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  const panel = document.getElementById("tab-progress");
  if (panel) panel.classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const active = b.dataset.tab === "today";
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  closeMoreSheet();
  window.scrollTo(0, 0);
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
  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    const iso = localDateStr(d);
    const isViewed = iso === viewed;
    const isToday = iso === todayS;
    const isFuture = iso > todayS;
    html += '<button type="button" class="week-day' + (isViewed ? " viewed" : "") + (isToday ? " today" : "") + '" data-week-day="' + iso + '"' + (isFuture ? " disabled" : "") + ' aria-label="' + d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) + '"' + (isViewed ? ' aria-current="date"' : "") + '><span class="week-letter">' + letters[i] + '</span><span class="week-num">' + d.getDate() + "</span></button>";
  }
  strip.innerHTML = html;
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

  // Show/hide nav arrows
  document.getElementById("day-prev").style.visibility = "";
  document.getElementById("day-next").style.visibility = viewOffset >= 0 ? "hidden" : "";

  // Sliders and add buttons log to the day being viewed, so they stay
  // usable on past days (F13/F16). Nothing here is disabled by day.

  const waterGoal = Number(store.settings.waterGoal) || 92;
  document.getElementById("water-goal-display").textContent = waterGoal;
  const waterOz = sumForDate(store.water, t, "oz");
  syncGoalSlider("water-slider", "water-slider-hint", "water-today", "water-num-btn", "Water", "ounces", waterOz, waterGoal);

  const exMin = sumForDate(store.exercise, t, "minutes");
  const moveGoal = Number(store.settings.movementGoal) || 30;
  document.getElementById("exercise-goal-display").textContent = moveGoal;
  syncGoalSlider("exercise-slider", "exercise-slider-hint", "exercise-today", "exercise-num-btn", "Movement", "minutes", exMin, moveGoal);
  // v004: the quick-add buttons show the amount they add, from Settings.
  const wAdd = document.getElementById("goals-water-add");
  if (wAdd) wAdd.textContent = "+ " + (Number(store.settings.waterStep) || 8) + " oz";
  const eAdd = document.getElementById("goals-exercise-add");
  if (eAdd) eAdd.textContent = "+ 5 min";

  renderMacros();
  renderMovement();
  renderStrength();
  renderWeekStrip();
  renderTodayWeight();

  renderGreeting();
  renderStreak();
  renderEncouragement();
  renderNextInjection();
  renderMood();
  renderBackupNudge();
  renderCorruptNotice();
  if (saveFailed) showStorageWarning("Your latest change could not be saved on this device. It may be out of space. Try downloading a backup from Settings, then deleting a few old photos.");
  renderCoachInsight();
  renderMonthlyReview();
  renderWeeklyDigest();
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
  el.textContent = n >= 2 ? n + " days in a row." : n === 1 ? "Day 1." : "";
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

/* Today's Goals add buttons (v165): one quick entry per tap, logged to
   the day being viewed. Water 8 oz, protein 10 g (Quick add), movement
   5 min. Same store shape as before; entries are still plain entries. */
document.getElementById("goals-water-add").addEventListener("click", () => {
  store.water.push({ id: uid(), date: viewedDateStr(), oz: Number(store.settings.waterStep) || 8 });
  saveStore();
  renderToday();
});
document.getElementById("goals-exercise-add").addEventListener("click", () => {
  store.exercise.push({ id: uid(), date: viewedDateStr(), minutes: 5, label: "Movement" });
  saveStore();
  renderToday();
});

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
    else { e[field] = val - remaining; remaining = 0; }
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
function syncGoalSlider(sliderId, hintId, numId, btnId, label, unitWord, value, goal) {
  const num = document.getElementById(numId);
  if (num) num.textContent = value;
  const slider = document.getElementById(sliderId);
  if (slider) {
    slider.max = Math.max(goal * 2, value);
    slider.value = value;
    slider.setAttribute("aria-valuetext", value + " of " + goal + " " + unitWord);
  }
  const hint = document.getElementById(hintId);
  if (hint) hint.textContent = "Tap " + value + " to type your own amount.";
  const btn = document.getElementById(btnId);
  if (btn) btn.setAttribute("aria-label", label + ", " + value + " of " + goal + " " + unitWord + ". Tap to type an amount to add.");
}
function bindGoalSlider(sliderId, hintId, numId, key, field, extra, goalFor) {
  const slider = document.getElementById(sliderId);
  if (!slider) return;
  const paintLive = () => {
    const v = Number(slider.value) || 0;
    const num = document.getElementById(numId);
    if (num) num.textContent = v;
    const hint = document.getElementById(hintId);
    if (hint) hint.textContent = "Tap " + v + " to type your own amount.";
  };
  slider.addEventListener("input", paintLive);
  slider.addEventListener("change", () => {
    setDayTotal(key, field, extra, Number(slider.value) || 0);
  });
}
bindGoalSlider("water-slider", "water-slider-hint", "water-today", "water", "oz", {}, () => Number(store.settings.waterGoal) || 92);
bindGoalSlider("exercise-slider", "exercise-slider-hint", "exercise-today", "exercise", "minutes", { label: "Movement" }, () => Number(store.settings.movementGoal) || 30);

/* ---------- Type an amount to add (v169) ---------- */
/* The big number inside each ring is a button. Tapping it opens a small
   sheet where the person types a number (a 16 oz bottle is 16, not two
   taps of +8 oz). The amount goes through nudgeGoal, the same helper
   the +8 oz / +5 min buttons, the nudge buttons and the ring drag use,
   so the store, snapshots, and the 3-per-day backup cap behave exactly
   as before. Whole numbers only; Add stays disabled until one is typed. */
const ADD_AMOUNT_CFG = {
  water: { field: "oz", extra: {}, unit: "oz", unitWord: "ounces", title: "Add water", btnId: "water-num-btn" },
  exercise: { field: "minutes", extra: { label: "Movement" }, unit: "min", unitWord: "minutes", title: "Add movement", btnId: "exercise-num-btn" }
};
let addAmountCtx = null; // { key, field, extra, unit, unitWord, startTotal, opener }

function addAmountTyped() {
  const input = document.getElementById("add-amount-input");
  if (!input) return 0;
  const raw = input.value.trim();
  if (!/^\d+$/.test(raw)) return 0;
  return parseInt(raw, 10);
}
function refreshAddAmountPreview() {
  if (!addAmountCtx) return;
  const n = addAmountTyped();
  const addBtn = document.getElementById("add-amount-add");
  const preview = document.getElementById("add-amount-preview");
  if (addBtn) addBtn.disabled = n <= 0;
  if (preview) {
    preview.textContent = n > 0
      ? "After adding: " + (addAmountCtx.startTotal + n) + " " + addAmountCtx.unit
      : "Type a whole number to add.";
  }
}
function openAddAmount(key) {
  const cfg = ADD_AMOUNT_CFG[key];
  const modal = document.getElementById("add-amount-modal");
  const input = document.getElementById("add-amount-input");
  if (!cfg || !modal || !input) return;
  const startTotal = sumForDate(store[key], viewedDateStr(), cfg.field);
  addAmountCtx = {
    key, field: cfg.field, extra: cfg.extra, unit: cfg.unit, unitWord: cfg.unitWord,
    startTotal, opener: document.getElementById(cfg.btnId)
  };
  document.getElementById("add-amount-title").textContent = cfg.title;
  document.getElementById("add-amount-now").textContent = "Now: " + startTotal + " " + cfg.unit;
  input.value = "";
  refreshAddAmountPreview();
  modal.classList.remove("hidden");
  input.focus();
}
function closeAddAmount() {
  const modal = document.getElementById("add-amount-modal");
  if (modal) modal.classList.add("hidden");
  if (addAmountCtx && addAmountCtx.opener && document.contains(addAmountCtx.opener)) addAmountCtx.opener.focus();
  addAmountCtx = null;
}
document.getElementById("water-num-btn").addEventListener("click", () => openAddAmount("water"));
document.getElementById("exercise-num-btn").addEventListener("click", () => openAddAmount("exercise"));
document.getElementById("add-amount-input").addEventListener("input", refreshAddAmountPreview);
document.getElementById("add-amount-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const addBtn = document.getElementById("add-amount-add");
    if (addBtn && !addBtn.disabled) addBtn.click();
  }
});
document.getElementById("add-amount-add").addEventListener("click", () => {
  if (!addAmountCtx) return;
  const n = addAmountTyped();
  if (n <= 0) return;
  const ctx = addAmountCtx;
  closeAddAmount();
  nudgeGoal(ctx.key, ctx.field, ctx.extra, n);
});
document.getElementById("add-amount-cancel").addEventListener("click", closeAddAmount);
document.getElementById("add-amount-modal").addEventListener("click", (e) => {
  if (e.target.id === "add-amount-modal") closeAddAmount();
});

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
    protein: Number(store.settings.proteinGoal) || 0,
    carbs: Number(store.settings.carbGoal) || 0,
    fat: Number(store.settings.fatGoal) || 0
  };
}
function macroCalories(t) {
  return Math.round(t.protein * 4 + t.carbs * 4 + t.fat * 9);
}

/* Calories section: a clear "Calories today" total from macros (protein
   and carbs 4 cal/g, fat 9 cal/g), a progress bar toward the daily
   calorie target from Settings, and a note. With no target set, the
   note points to Settings. */
function renderCalories(totals) {
  const cals = macroCalories(totals);
  const target = Number(store.settings.calorieTarget) || 0;
  const total = totals.protein + totals.carbs + totals.fat;
  const todayEl = document.getElementById("calories-today");
  if (todayEl) todayEl.textContent = cals.toLocaleString("en-US");
  const targetEl = document.getElementById("calories-target-part");
  if (targetEl) targetEl.textContent = target > 0 ? " of " + target.toLocaleString("en-US") : "";
  const fill = document.getElementById("calories-fill");
  if (fill) fill.style.width = target > 0 ? Math.min(100, Math.round(100 * cals / target)) + "%" : "0%";
  const note = document.getElementById("calories-note");
  if (note) {
    if (total <= 0) note.textContent = "No macros logged yet today.";
    else if (target > 0) note.textContent = "Calories from macros today (protein and carbs 4 cal/g, fat 9 cal/g).";
    else note.textContent = "Calories from macros today. Set a daily calorie target in Settings, under Your goals, to track against it.";
  }
}

/* Donut segments, from a totals object. Shared by renderMacros and the
   v169 row slide, so the donut stays live while sliding. */
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
function renderMacros() {
  const card = document.getElementById("macros-card");
  if (!card) return;
  const t = viewedDateStr();
  const totals = macroTotals(t);
  const targets = macroTargets();
  const total = totals.protein + totals.carbs + totals.fat;
  // v005: no preset targets. Until the user sets their own targets in
  // Settings, the donut stays empty and the card shows guidance instead
  // of a 0% or a preset split.
  const targetsSet = targets.protein > 0 || targets.carbs > 0 || targets.fat > 0;
  const setupNote = document.getElementById("macro-setup-note");
  if (setupNote) setupNote.classList.toggle("hidden", targetsSet);
  paintDonut(targetsSet ? totals : { protein: 0, carbs: 0, fat: 0 });
  // Nutrition Balance: the percentage split of the user's gram targets,
  // as % of target calories (protein and carbs 4 cal/g, fat 9 cal/g).
  // Updates whenever targets change, from the same render path.
  const balanceEl = document.getElementById("macro-balance");
  if (balanceEl) {
    const pCal = targets.protein * 4, cCal = targets.carbs * 4, fCal = targets.fat * 9;
    const tCal = pCal + cCal + fCal;
    balanceEl.textContent = tCal > 0
      ? "Your balance: " + Math.round(100 * pCal / tCal) + "% protein · " + Math.round(100 * cCal / tCal) + "% carbohydrates · " + Math.round(100 * fCal / tCal) + "% healthy fats"
      : "";
  }
  document.getElementById("macro-center-grams").textContent = totals[selectedMacro];
  document.getElementById("macro-center-label").textContent = selectedMacro + " logged today";
  MACRO_KEYS.forEach((key) => {
    const loggedEl = document.getElementById("logged-" + key);
    if (loggedEl) loggedEl.textContent = totals[key];
    const targetEl = document.getElementById("target-" + key + "-label");
    if (targetEl) targetEl.textContent = targets[key] > 0 ? targets[key] : "—";
    const pct = targets[key] > 0 ? Math.round(100 * totals[key] / targets[key]) : 0;
    const pctEl = document.getElementById("pct-" + key);
    if (pctEl) pctEl.textContent = macroProgressText(totals[key], targets[key]);
    const barEl = document.getElementById("bar-" + key);
    if (barEl) barEl.style.width = Math.min(100, pct) + "%";
    const row = document.querySelector('.macro-row[data-macro="' + key + '"]');
    if (row) row.classList.toggle("selected", selectedMacro === key);
  });
  renderCalories(totals);
  const svg = card.querySelector(".donut-wrap svg");
  if (svg) svg.setAttribute("aria-label", "Donut chart of today's macros. Protein " + totals.protein + " grams in gold, carbs " + totals.carbs + " grams in sage, fat " + totals.fat + " grams in cream tan.");
  renderFoodList();
}

/* Today's food list: every food logged for the day being viewed,
   grouped by meal, with its macros and calories, so the user can check
   what they logged and fix a mistake. Edit fills the Log food form;
   Delete removes the entry. Foods without a meal tag show under Other
   foods. Each meal row has its own Log button, which opens the form
   with that meal preselected. */
let editingFoodId = null;
function foodItemHtml(e) {
  const p = Number(e.grams) || 0, c = Number(e.carbs) || 0, f = Number(e.fat) || 0;
  const kcal = Math.round(p * 4 + c * 4 + f * 9);
  return "<div class=\"food-item\" style=\"display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--border)\">"
    + "<div style=\"flex:1;min-width:0\"><div style=\"font-weight:600\">" + escapeHtml(e.food || "Logged food") + "</div>"
    + "<div class=\"muted\" style=\"font-size:.85em\">" + p + "g protein · " + c + "g carbs · " + f + "g fat · " + kcal + " cal</div></div>"
    + "<button type=\"button\" class=\"btn btn-small\" data-edit-food=\"" + e.id + "\" aria-label=\"Edit " + escapeHtml(e.food || "food") + "\">Edit</button>"
    + "<button type=\"button\" class=\"btn btn-small btn-danger\" data-del-food=\"" + e.id + "\" aria-label=\"Delete " + escapeHtml(e.food || "food") + "\">Delete</button></div>";
}
function mealRowHtml(meal, items) {
  const p = items.reduce((s, e) => s + (Number(e.grams) || 0), 0);
  const c = items.reduce((s, e) => s + (Number(e.carbs) || 0), 0);
  const f = items.reduce((s, e) => s + (Number(e.fat) || 0), 0);
  const kcal = Math.round(p * 4 + c * 4 + f * 9);
  const total = items.length
    ? items.length + (items.length === 1 ? " food · " : " foods · ") + kcal + " cal"
    : "Nothing logged yet";
  return "<div class=\"meal-row\">"
    + "<div class=\"meal-head\"><span class=\"meal-name\">" + meal + "</span>"
    + "<span class=\"muted meal-total\">" + total + "</span>"
    + "<button type=\"button\" class=\"btn btn-small\" data-meal-log=\"" + meal + "\" aria-label=\"Log food for " + meal + "\">Log</button></div>"
    + items.map(foodItemHtml).join("")
    + "</div>";
}
function renderFoodList() {
  const listEl = document.getElementById("food-list");
  if (!listEl) return;
  const t = viewedDateStr();
  const entries = [...(store.protein || [])].filter((e) => e.date === t);
  let html = MEALS.map((meal) => mealRowHtml(meal, entries.filter((e) => mealOf(e) === meal))).join("");
  const untagged = entries.filter((e) => mealOf(e) === "");
  if (untagged.length) {
    html += "<div class=\"meal-row\">"
      + "<div class=\"meal-head\"><span class=\"meal-name\">Other foods</span>"
      + "<span class=\"muted meal-total\">" + untagged.length + (untagged.length === 1 ? " food" : " foods") + " · not grouped by meal</span></div>"
      + untagged.map(foodItemHtml).join("")
      + "</div>";
  }
  listEl.innerHTML = html;
}

document.getElementById("food-list").addEventListener("click", (e) => {
  const mealBtn = e.target.closest("[data-meal-log]");
  if (mealBtn) {
    openFoodFormForMeal(mealBtn.dataset.mealLog);
    return;
  }
  const editBtn = e.target.closest("[data-edit-food]");
  const delBtn = e.target.closest("[data-del-food]");
  if (editBtn) {
    const entry = (store.protein || []).find((x) => x.id === editBtn.dataset.editFood);
    if (!entry) return;
    editingFoodId = entry.id;
    document.getElementById("macro-food-name").value = entry.food || "";
    document.getElementById("macro-food-protein").value = Number(entry.grams) || "";
    document.getElementById("macro-food-carbs").value = Number(entry.carbs) || "";
    document.getElementById("macro-food-fat").value = Number(entry.fat) || "";
    const mealSel = document.getElementById("macro-food-meal");
    if (mealSel) mealSel.value = mealOf(entry);
    document.getElementById("macro-food-form").classList.remove("hidden");
    document.getElementById("macro-food-form").scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("macro-food-name").focus();
    return;
  }
  if (delBtn) {
    const idx = (store.protein || []).findIndex((x) => x.id === delBtn.dataset.delFood);
    if (idx === -1) return;
    store.protein.splice(idx, 1);
    saveStore();
    renderToday();
  }
});

document.querySelectorAll(".macro-row").forEach((row) => {
  row.addEventListener("click", (e) => {
    // The log steppers inside the row must not select the macro.
    if (e.target.closest(".macro-log-btn")) return;
    // A slide on the bar must not also select the macro on release.
    if (suppressMacroRowClick) { suppressMacroRowClick = false; return; }
    selectMacro(row.dataset.macro);
  });
});
document.querySelectorAll(".donut-seg").forEach((seg) => {
  seg.addEventListener("click", () => selectMacro(seg.dataset.macro));
});
document.querySelectorAll(".macro-log-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    adjustMacro(btn.dataset.macroLog, Number(btn.dataset.dir));
  });
});

/* Log steppers on each macro row: change the day's logged grams by
   exactly 1, like the ring nudge buttons. Carbs and fat attach to the
   day's most recent food entry, or a fresh Quick add entry when the day
   has none yet, so one tap never spams the log with tiny entries.
   adjustMacroBy is the same helper with a magnitude, used by the v169
   row slide: a drag of N grams is one entry of N, or one trim of N. */
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
function adjustMacro(key, delta) {
  adjustMacroBy(key, delta);
}

/* Slide a macro row (v169): horizontal slide on the row's progress bar
   changes that macro's logged grams, 1 g per 8px, the same step as the
   rings. The donut itself does not slide; tapping a row still selects
   the macro. The row updates live while sliding; the store is written
   once, on release, through adjustMacroBy, so entries, snapshots, and
   the backup cap behave exactly as for a stepper tap. Clamped at zero. */
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
    const slideTargetsSet = targets.protein > 0 || targets.carbs > 0 || targets.fat > 0;
    paintDonut(slideTargetsSet ? totals : { protein: 0, carbs: 0, fat: 0 });
    if (selectedMacro === key) {
      document.getElementById("macro-center-grams").textContent = liveTotal;
    }
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
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    e.stopPropagation();
    adjustMacroBy(key, e.key === "ArrowRight" ? 1 : -1);
  });
}
MACRO_KEYS.forEach(bindMacroSlide);

document.getElementById("macro-log-food").addEventListener("click", () => {
  const form = document.getElementById("macro-food-form");
  const wasHidden = form.classList.contains("hidden");
  form.classList.toggle("hidden");
  if (wasHidden) {
    editingFoodId = null;
    const mealSel = document.getElementById("macro-food-meal");
    if (mealSel) mealSel.value = "";
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
document.getElementById("macro-food-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("macro-food-msg");
  const grams = Math.max(0, Math.round(Number(document.getElementById("macro-food-protein").value) || 0));
  const carbs = Math.max(0, Math.round(Number(document.getElementById("macro-food-carbs").value) || 0));
  const fat = Math.max(0, Math.round(Number(document.getElementById("macro-food-fat").value) || 0));
  if (grams <= 0 && carbs <= 0 && fat <= 0) {
    setFormStatus(msg, "Add at least one macro above zero first.", true);
    return;
  }
  const food = document.getElementById("macro-food-name").value.trim().slice(0, 120) || "Logged food";
  const mealSel = document.getElementById("macro-food-meal");
  const meal = mealSel && MEALS.includes(mealSel.value) ? mealSel.value : "";
  if (editingFoodId) {
    const i = (store.protein || []).findIndex((x) => x.id === editingFoodId);
    if (i !== -1) store.protein[i] = { id: editingFoodId, date: viewedDateStr(), grams, carbs, fat, food, meal };
    editingFoodId = null;
  } else {
    store.protein.push({ id: uid(), date: viewedDateStr(), grams, carbs, fat, food, meal });
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
});

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
function fillFoodForm(name, protein, carbs, fat, note) {
  document.getElementById("macro-food-name").value = String(name || "").slice(0, 120);
  document.getElementById("macro-food-protein").value = protein || "";
  document.getElementById("macro-food-carbs").value = carbs || "";
  document.getElementById("macro-food-fat").value = fat || "";
  const status = document.getElementById("macro-food-search-status");
  if (status && note) status.textContent = note;
}
/* The "Your foods" list: every food already logged, newest first.
   Tap a row to fill the form and log it again. Archive moves a food
   to the archive (never deleted). The small x archives it too. The
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
    empty.className = "muted";
    empty.style.cssText = "font-size:.9em;margin:0";
    empty.textContent = "No foods saved yet. Log a food and it saves here on its own.";
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
        fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your foods. Check and edit before saving.");
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
      const x = document.createElement("button");
      x.type = "button";
      x.className = "btn btn-small";
      x.setAttribute("aria-label", "Archive " + f.name);
      x.textContent = "×";
      x.addEventListener("click", () => {
        if (archiveFood(f.barcode)) libraryNote = "Moved to your archive. You can bring it back anytime.";
        renderFoodLibrary();
      });
      row.appendChild(b);
      row.appendChild(arc);
      row.appendChild(x);
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
    empty.className = "muted";
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
      fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your archive. Check and edit before saving.");
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
   res.ok before parsing. Returns the parsed JSON, or null when the
   database is down or unreachable after one retry. */
async function fetchFoodJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/* ---------- Food search by name ---------- */
/* Type a food name, search Open Food Facts (free, no key), and tap a
   result to fill the name and macros from the label. Values are per
   serving when available, otherwise per 100 g, and the user edits them
   before logging. */
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
        fillFoodForm(f.name, f.protein, f.carbs, f.fat, "From your foods. Check and edit before saving.");
        results.classList.add("hidden");
        results.innerHTML = "";
      });
      results.appendChild(b);
    });
    results.classList.remove("hidden");
    status.textContent = "Tap a food to fill the macros.";
  }
  try {
    const data = await fetchFoodJson("https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + encodeURIComponent(query) + "&search_simple=1&action=process&json=1&page_size=8&countries_tags_en=united-states&fields=product_name,brands,nutriments,serving_size");
    if (!data) { status.textContent = "The food database is temporarily unavailable. Try again in a moment, or enter the grams by hand."; return; }
    const products = (data && data.products) || [];
    if (!products.length) {
      status.textContent = mine.length ? "Tap a food above, or try different words." : "No foods found. Try different words, or enter the grams by hand.";
      return;
    }
    if (!mine.length) status.textContent = "Tap a food to fill the macros.";
    products.forEach((p) => {
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
      b.textContent = name + (cals > 0 ? "  ·  " + cals + " cal" : "") + "  ·  P " + protein + "g  C " + carbs + "g  F " + fat + "g" + (hasServing ? "" : " (per 100 g)");
      b.addEventListener("click", () => {
        nameInput.value = name.slice(0, 120);
        document.getElementById("macro-food-protein").value = protein || "";
        document.getElementById("macro-food-carbs").value = carbs || "";
        document.getElementById("macro-food-fat").value = fat || "";
        status.textContent = hasServing ? "Filled from the label. Check and edit before saving." : "Filled per 100 g. Scale to your portion before saving.";
        results.classList.add("hidden");
        results.innerHTML = "";
      });
      results.appendChild(b);
    });
    results.classList.remove("hidden");
  } catch (e) {
    status.textContent = "The food database is temporarily unavailable. Try again in a moment, or enter the grams by hand.";
  }
}
document.getElementById("macro-food-search-btn").addEventListener("click", searchFoodByName);
document.getElementById("macro-food-library-btn").addEventListener("click", () => {
  const list = document.getElementById("macro-food-library");
  if (!list) return;
  if (list.classList.contains("hidden")) { renderFoodLibrary(); list.classList.remove("hidden"); }
  else list.classList.add("hidden");
});

/* ---------- Barcode scanning ---------- */
/* Camera scanning uses the native BarcodeDetector when available, then
   html5-qrcode for iPhone, then ZXing as a backup. Typing the barcode
   number works when the camera is unavailable. Lookup is free from
   Open Food Facts. Values are per serving when available, otherwise
   per 100 g, and the user edits them before logging. */
let scanStream = null;
let scanZxingReader = null;
let scanHtml5 = null;
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
  m.classList.remove("hidden");
  m.style.display = "flex";
  document.getElementById("scan-status").textContent = "Starting camera...";
  startScanCamera();
}
function closeScanModal() {
  stopScanCamera();
  const m = document.getElementById("scan-modal");
  if (m) { m.classList.add("hidden"); m.style.display = "none"; }
}
async function lookupBarcode(code) {
  const status = document.getElementById("scan-status");
  code = (code || "").trim().replace(/[^0-9]/g, "");
  if (!code) { status.textContent = "Enter a barcode number first."; return; }
  // Your foods first: a barcode already scanned fills in instantly,
  // with no network wait.
  const saved = getFoodFromLibrary(code);
  if (saved) {
    const name = saved.brand ? saved.name + " - " + saved.brand : saved.name;
    document.getElementById("scan-product-name").textContent = name;
    document.getElementById("scan-product-serving").textContent = "From your foods. Check the label and edit the grams before logging.";
    document.getElementById("scan-product-calories").textContent = saved.calories > 0 ? "This adds about " + saved.calories + " calories to your day." : "";
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
    document.getElementById("scan-product-calories").textContent = scanCals > 0
      ? "This adds about " + scanCals + " calories to your day."
      : "";
    document.getElementById("scan-result").classList.remove("hidden");
    status.textContent = hasServing
      ? "Found. Check the label and edit the grams before logging."
      : "Found, but only per 100 g values were available. Scale them to your portion before logging.";
  } catch (e) {
    status.textContent = "The food database is temporarily unavailable. Try again, or enter the grams by hand.";
  }
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
        await new Promise((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js";
          s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
        });
      }
      if (scanStream) { scanStream.getTracks().forEach((tr) => tr.stop()); scanStream = null; }
      video.srcObject = null;
      setScanView("reader");
      scanHtml5 = new Html5Qrcode("scan-reader");
      status.textContent = "Camera reader loaded. Hold the barcode inside the frame, about 6 to 12 inches away. If nothing happens in a few seconds, tap Capture below or type the number.";
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
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
        s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
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
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js";
        s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
      });
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
document.getElementById("scan-capture-btn").addEventListener("click", captureBarcodeFrame);
document.getElementById("scan-lookup-btn").addEventListener("click", () => lookupBarcode(document.getElementById("scan-barcode-input").value));
document.getElementById("scan-log-btn").addEventListener("click", () => {
  const food = document.getElementById("scan-food").value.trim() || "Scanned food";
  const grams = Math.max(0, Math.round(Number(document.getElementById("scan-protein").value) || 0));
  const carbs = Math.max(0, Math.round(Number(document.getElementById("scan-carbs").value) || 0));
  const fat = Math.max(0, Math.round(Number(document.getElementById("scan-fat").value) || 0));
  if (!grams && !carbs && !fat) {
    document.getElementById("scan-status").textContent = "Add at least one macro above zero first.";
    return;
  }
  store.protein.push({ id: uid(), date: viewedDateStr(), grams, carbs, fat, food });
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
  m.classList.remove("hidden");
  m.style.display = "flex";
  document.getElementById("plate-status").textContent = "";
  document.getElementById("plate-result").classList.add("hidden");
}
function closePlateModal() {
  const m = document.getElementById("plate-modal");
  if (m) { m.classList.add("hidden"); m.style.display = "none"; }
  document.getElementById("plate-photo-preview").classList.add("hidden");
  document.getElementById("plate-photo-preview").src = "";
  platePhotoDataUrl = "";
}
async function recognizePlate(dataUrl) {
  const status = document.getElementById("plate-status");
  status.textContent = "Scan my plate is coming soon. Take a photo of your plate, and the app identifies the food and fills in the macros for you. No typing. For now, name the food and enter the macros below.";
  document.getElementById("plate-result").classList.remove("hidden");
  // Post-November 30: send dataUrl to the Worker vision endpoint and
  // fill plate-food, plate-protein, plate-carbs, plate-fat from the
  // reply, then update the status. The Worker call belongs here.
}
document.getElementById("macro-plate-food").addEventListener("click", openPlateModal);
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
  store.protein.push({ id: uid(), date: viewedDateStr(), grams, carbs, fat, food });
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

/* ---------- Today's Movement (v168) ---------- */
/* A short daily routine on the front page. Finishing every move logs
   5 minutes to the Movement total; unticking a move takes it back. */
const DEFAULT_MOVES = [
  { name: "Sit-to-stands", detail: "10 reps" },
  { name: "Wall push-ups", detail: "10 reps" },
  { name: "Standing march in place", detail: "1 minute" },
  { name: "Heel raises", detail: "12 reps" },
  { name: "Gentle full-body stretch", detail: "1 minute" }
];
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
  return DEFAULT_MOVES;
}
function isDefaultPlan() {
  const plan = store.settings && store.settings.movementPlan;
  return !Array.isArray(plan) || !plan.length;
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
  if (sub) sub.textContent = isDefaultPlan() ? routineMinutes() + " minutes. No equipment." : "Your plan · " + plan.length + " moves.";
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
}

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
    : '<p class="empty-state">No strength exercises logged for this day yet.</p>';
  list.querySelectorAll("[data-del-strength]").forEach((b) => b.addEventListener("click", () => {
    store.strength = (store.strength || []).filter((x) => x.id !== b.dataset.delStrength);
    saveStore();
    renderStrength();
  }));
}
document.getElementById("strength-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const name = document.getElementById("strength-name").value.trim();
  const sets = Math.round(Number(document.getElementById("strength-sets").value));
  const reps = Math.round(Number(document.getElementById("strength-reps").value));
  const weightRaw = document.getElementById("strength-weight").value;
  const weight = weightRaw === "" ? "" : Number(weightRaw);
  const msg = document.getElementById("strength-saved-msg");
  if (!name) { setFormStatus(msg, "Enter an exercise name.", true); return; }
  if (!Number.isFinite(sets) || sets < 1) { setFormStatus(msg, "Sets must be at least 1.", true); return; }
  if (!Number.isFinite(reps) || reps < 1) { setFormStatus(msg, "Reps must be at least 1.", true); return; }
  if (weight !== "" && (!Number.isFinite(weight) || weight < 0)) { setFormStatus(msg, "Weight must be 0 or more, or left blank.", true); return; }
  store.strength.push({ id: uid(), date: viewedDateStr(), name: name.slice(0, 80), sets, reps, weight });
  saveStore();
  document.getElementById("strength-form").reset();
  setFormStatus(msg, "Strength exercise saved.");
  renderStrength();
});

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
      <input type="text" class="plan-detail" data-plan-detail="${escapeHtml(item.name)}" value="${escapeHtml(detail)}" maxlength="40" aria-label="Reps or time for ${escapeHtml(item.name)}">
      ${isCustom ? `<button type="button" class="plan-remove" data-remove-custom="${escapeHtml(item.name)}" aria-label="Remove ${escapeHtml(item.name)} from your exercises">×</button>` : ""}
    </label>`;
}

function openMovementPlanEditor() {
  const modal = document.getElementById("movement-plan-modal");
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
  modal.classList.remove("hidden");
  const first = modal.querySelector("input[type='checkbox']");
  if (first) first.focus();
}
function closeMovementPlanEditor() {
  document.getElementById("movement-plan-modal").classList.add("hidden");
  const btn = document.getElementById("movement-customize");
  if (btn) btn.focus();
}
document.getElementById("movement-customize").addEventListener("click", openMovementPlanEditor);
document.getElementById("movement-plan-cancel").addEventListener("click", closeMovementPlanEditor);
// v169: the X closes the modal exactly like Cancel, Escape, and
// backdrop tap do: it discards unsaved changes, and focus returns to
// the Customize button.
document.getElementById("movement-plan-x").addEventListener("click", closeMovementPlanEditor);
document.getElementById("movement-plan-modal").addEventListener("click", (e) => {
  if (e.target.id === "movement-plan-modal") closeMovementPlanEditor();
});
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
document.getElementById("movement-plan-reset").addEventListener("click", () => {
  store.settings.movementPlan = null;
  store.settings.routineMinutes = 5;
  saveStore();
  closeMovementPlanEditor();
  renderToday();
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

function renderNextInjection() {
  const el = document.getElementById("next-injection-line");
  const shotDay = store.settings.shotDay;
  const gotoBtn = document.getElementById("goto-shots-btn");
  // Done state first: it applies even before a shot day is set, so a
  // buyer who logged a shot never sees "Log it in Shots" again today
  // and cannot double-log. (The old code returned early above when no
  // shot day was set, so the button stayed visible with no done state.)
  const alreadyLogged = store.injections.some((e) => e.date === todayStr() && (e.status || "On time") !== "Missed");
  gotoBtn.style.display = alreadyLogged ? "none" : "";
  if (alreadyLogged) {
    el.textContent = "\u2713 Today's shot logged.";
    return;
  }
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
  const lastSite = last ? " Last site: " + last.site + "." : "";
  const due = nextShotDue();
  let when;
  if (due && due.overdueDays > 0) {
    when = "Your shot was due " + formatDate(due.dateStr) + " \u2014 " + due.overdueDays + (due.overdueDays === 1 ? " day overdue." : " days overdue.");
  } else if (due && due.daysUntil === 0) {
    when = "Today is your shot day.";
  } else if (due && due.daysUntil === 1) {
    when = "Your next shot is tomorrow (" + formatDate(due.dateStr) + ").";
  } else if (due) {
    when = "Your next shot is in " + due.daysUntil + " days (" + formatDate(due.dateStr) + ").";
  } else {
    when = diff === 0 ? "Today is your shot day." : diff === 1 ? "Your next shot is tomorrow." : "Your next shot is in " + diff + " days (" + shotDay + ").";
  }
  el.textContent = when + " " + med + (dose ? " " + dose + "." : ".") + lastSite;

  // The Today card never logs a shot. It only takes you to the Shots
  // tab, where the shot is logged deliberately with the site and dose.
  gotoBtn.textContent = "Log it in Shots";
}

// The Today card never logs a shot. It takes you to the Shots tab,
// where the shot is logged deliberately with the site and dose.
document.getElementById("goto-shots-btn").addEventListener("click", () => {
  showTab("shots");
});

/* GLP-1 quick actions (v035): three links on Today to the flows
   that already exist. Log dose opens the Shots tab with the log form
   open. Reminders runs the existing calendar shot reminder download.
   Log side effect opens the Side Effects tab with the log form open.
   No new data, no new screens. */
document.getElementById("qa-log-dose").addEventListener("click", () => {
  showTab("shots");
  document.getElementById("show-injection-form").click();
});
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
  document.querySelectorAll(".mood-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.mood === current);
    b.setAttribute("aria-pressed", b.dataset.mood === current ? "true" : "false");
  });
  document.getElementById("mood-today-label").textContent = current
    ? (viewOffset === 0 ? "Today you are feeling: " : "On " + formatDate(t) + " you felt: ") + current + "."
    : (viewOffset === 0 ? "No mood logged today yet." : "No mood logged for this day yet.");
}

document.querySelectorAll(".mood-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    store.moods[viewedDateStr()] = btn.dataset.mood;
    saveStore();
    renderMood();
  });
});

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
document.getElementById("add-shot-reminder").addEventListener("click", () => {
  const shotDay = store.settings.shotDay;
  if (!shotDay) {
    alert("Set your shot day in Settings first, then come back to add the reminder.");
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
});

document.getElementById("show-injection-form").addEventListener("click", () => {
  editingInjectionId = null;
  injForm.querySelector("h3").textContent = "Log Injection";
  injForm.reset();
  document.getElementById("inj-date").value = todayStr();
  document.getElementById("inj-med").value = store.settings.medication || "";
  document.getElementById("inj-dose").value = store.settings.dose || "";
  document.getElementById("inj-status").value = "On time";
  document.getElementById("inj-status-note").classList.add("hidden");
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
  if (!entry.date) { setFormStatus(injMsg, "Add a date first.", true); return; }
  if (!entry.medication) { setFormStatus(injMsg, "Add the medication name first.", true); return; }
  if (!entry.dose || entry.dose <= 0) {
    setFormStatus(injMsg, "Add a dose above zero first.", true);
    document.getElementById("inj-dose").focus();
    return;
  }
  if (!entry.site) { setFormStatus(injMsg, "Choose an injection site first.", true); return; }
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
      el.innerHTML += " Next shot was due " + escapeHtml(formatDate(due.dateStr)) + " \u2014 " + due.overdueDays + (due.overdueDays === 1 ? " day overdue." : " days overdue.");
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
      ${inj.notes ? `<p class="entry-notes">${escapeHtml(inj.notes)}</p>` : ""}
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
    document.getElementById("current-weight").textContent = Number(current).toFixed(1);
    document.getElementById("weight-hero-value").textContent = Number(current).toFixed(1);
    document.getElementById("weight-hero-date").textContent = "Latest weigh-in " + formatDate(sorted[sorted.length - 1].date);
    /* Starting weight is frozen (K3). It is read from settings, not from
       the earliest weigh-in, so deleting or backdating entries never
       moves it. */
    document.getElementById("starting-weight").textContent = start ? Number(start.value).toFixed(1) : "--";
    document.getElementById("starting-weight-date").textContent = start ? formatDate(start.date) : "";
  } else {
    document.getElementById("current-weight").textContent = "--";
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
    document.getElementById("total-lost").textContent = (gained ? "+" : "-") + amount;
    document.getElementById("percent-lost-label").textContent = gained ? "Percent gained" : "Percent lost";
    document.getElementById("percent-lost").textContent = (gained ? "+" : "-") + pct;
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
    : '<p class="empty-state">No weigh-ins yet. Tap "Log weigh-in" to add your first.</p>';

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
  drawBMIChart();
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
    line.textContent = "Add your height in Settings to see your BMI here.";
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
      overLine.textContent = "Overweight by " + (bmi.weight - highLbs).toFixed(1) + " lbs";
    } else if (bmi.value < 18.5) {
      overLine.textContent = "Underweight by " + (lowLbs - bmi.weight).toFixed(1) + " lbs";
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

/* ---------- Doctor visit summary (v168) ---------- */
/* One tap makes a simple summary of weight, shots, and side effects to
   show her clinician. Text only; it never leaves the phone unless she
   copies or downloads it herself. */
function buildDoctorSummary() {
  const lines = ["New Chapter: GLP-1 Tracker — Visit summary", "Prepared " + formatDate(todayStr()), ""];
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
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const cutoff = localDateStr(ninetyDaysAgo);
    const recent = sortedI.filter((s) => s.date >= cutoff);
    lines.push("Shots in the last 90 days: " + recent.length + ".");
    const missed = sortedI.filter((s) => s.status === "Missed").length;
    if (missed) lines.push("Missed shots on record: " + missed + ".");
  } else {
    lines.push("No shots logged yet.");
  }
  lines.push("");
  // Side effects
  const sortedE = [...(store.sideEffects || [])].sort(byDateDesc);
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentE = sortedE.filter((s) => s.date >= localDateStr(thirtyDaysAgo));
  lines.push("Side effects (last 30 days)");
  if (recentE.length) {
    recentE.forEach((s) => {
      lines.push("- " + formatDate(s.date) + ": " + s.symptom + " (" + s.severity + ")" + (s.notes ? " — " + s.notes : ""));
    });
  } else {
    lines.push("None logged in the last 30 days.");
  }
  lines.push("");
  // Exercise (last 30 days)
  const recentEx = (store.exercise || []).filter((e) => e.date >= localDateStr(thirtyDaysAgo));
  lines.push("Exercise (last 30 days)");
  if (recentEx.length) {
    const totalMin = recentEx.reduce((t, e) => t + (Number(e.minutes) || 0), 0);
    const activeDays = new Set(recentEx.map((e) => e.date)).size;
    lines.push("Total movement: " + totalMin + " minutes across " + activeDays + " day" + (activeDays === 1 ? "" : "s") + ".");
    if (activeDays) lines.push("Average: " + Math.round(totalMin / activeDays) + " minutes per active day.");
    const planLen = getMovementPlan().length;
    let routineDays = 0;
    for (const [d, st] of Object.entries(store.movementDone || {})) {
      if (d >= localDateStr(thirtyDaysAgo) && st && Array.isArray(st.done) && st.done.length >= planLen) routineDays++;
    }
    if (routineDays) lines.push("Daily movement routine completed on " + routineDays + " day" + (routineDays === 1 ? "" : "s") + ".");
  } else {
    lines.push("No movement logged in the last 30 days.");
  }
  // v033: strength sessions in the last 30 days, in the same Exercise section.
  const recentSt = (store.strength || []).filter((e) => e.date >= localDateStr(thirtyDaysAgo));
  if (recentSt.length) {
    const stDays = new Set(recentSt.map((e) => e.date)).size;
    const stSets = recentSt.reduce((t, e) => t + (Number(e.sets) || 0), 0);
    lines.push("Strength: " + recentSt.length + " exercise" + (recentSt.length === 1 ? "" : "s") + " logged across " + stDays + " day" + (stDays === 1 ? "" : "s") + ", " + stSets + " sets in total.");
  }
  lines.push("");
  lines.push("This summary is from your own log. It is not medical advice.");
  return lines.join("\n");
}
function openDoctorModal() {
  const modal = document.getElementById("doctor-modal");
  const text = document.getElementById("doctor-text");
  if (!modal || !text) return;
  text.value = buildDoctorSummary();
  document.getElementById("doctor-msg").textContent = "";
  modal.classList.remove("hidden");
  const copyBtn = document.getElementById("doctor-copy");
  if (copyBtn) copyBtn.focus();
}
function closeDoctorModal() {
  document.getElementById("doctor-modal").classList.add("hidden");
  const btn = document.getElementById("doctor-summary-btn");
  if (btn) btn.focus();
}
document.getElementById("doctor-summary-btn").addEventListener("click", openDoctorModal);
document.getElementById("doctor-close").addEventListener("click", closeDoctorModal);
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
    const milestone = pctRound >= 75 ? 75 : pctRound >= 50 ? 50 : pctRound >= 25 ? 25 : 0;
    textEl.textContent = milestone === 75
      ? "Three quarters of the way there. Beautiful work."
      : milestone === 50
      ? "Halfway there. Beautiful work."
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

  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, "rgba(201,169,106,0.35)");
  grad.addColorStop(1, "rgba(201,169,106,0.02)");
  ctx.beginPath();
  sorted.forEach((w, i) => (i === 0 ? ctx.moveTo(x(i), y(w.value)) : ctx.lineTo(x(i), y(w.value))));
  ctx.strokeStyle = "#E8B54A";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineTo(x(sorted.length - 1), H - padB);
  ctx.lineTo(x(0), H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
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
function drawBMIChart() {
  const canvas = document.getElementById("bmi-chart");
  const emptyMsg = document.getElementById("bmi-chart-empty");
  if (!canvas) return;
  const sorted = [...(store.weight || [])].sort(byDate);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const chartText = document.getElementById("bmi-chart-text");
  const ft = Number(store.settings && store.settings.heightFt);
  const inch = Number(store.settings && store.settings.heightIn);
  const totalIn = (Number.isFinite(ft) ? ft : 0) * 12 + (Number.isFinite(inch) ? inch : 0);
  if (!(totalIn > 0)) {
    if (emptyMsg) { emptyMsg.style.display = ""; emptyMsg.textContent = "Add your height in Settings to see your BMI chart."; }
    if (chartText) chartText.textContent = "";
    canvas.style.display = "none";
    return;
  }
  if (sorted.length < 2) {
    if (emptyMsg) { emptyMsg.style.display = ""; emptyMsg.textContent = "Log at least two weigh-ins to see your BMI chart."; }
    if (chartText) chartText.textContent = sorted.length === 1
      ? "One weigh-in so far. Log another weigh-in to see your BMI chart."
      : "";
    canvas.style.display = "none";
    return;
  }
  if (emptyMsg) emptyMsg.style.display = "none";
  canvas.style.display = "";
  const bmis = sorted.map((w) => 703 * Number(w.value) / (totalIn * totalIn));
  const W = canvas.width, H = canvas.height;
  const padL = 52, padR = 16, padT = 16, padB = 40;
  const min = Math.min(...bmis), max = Math.max(...bmis);
  const span = Math.max(max - min, 1);
  const lo = Math.min(min - span * 0.15, 18.5 - span * 0.1);
  const hi = Math.max(max + span * 0.15, 24.9 + span * 0.1);
  const x = (i) => padL + (i / (sorted.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  ctx.fillStyle = "rgba(90,107,82,0.10)";
  ctx.fillRect(padL, y(24.9), W - padL - padR, y(18.5) - y(24.9));
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
    ctx.fillText(gv.toFixed(1), padL - 8, y(gv) + 7);
  }
  ctx.textAlign = "center";
  const labelEvery = Math.max(1, Math.ceil(sorted.length / 5));
  sorted.forEach((w, i) => {
    if (i % labelEvery === 0 || i === sorted.length - 1) {
      ctx.textAlign = i === sorted.length - 1 ? "right" : i === 0 ? "left" : "center";
      ctx.fillText(formatDate(w.date).replace(/, \d{4}$/, ""),
        i === sorted.length - 1 ? W - 4 : i === 0 ? 4 : x(i), H - 12);
      ctx.textAlign = "center";
    }
  });
  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, "rgba(201,169,106,0.35)");
  grad.addColorStop(1, "rgba(201,169,106,0.02)");
  ctx.beginPath();
  bmis.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.strokeStyle = "#E8B54A";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineTo(x(bmis.length - 1), H - padB);
  ctx.lineTo(x(0), H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = "#E8B54A";
  bmis.forEach((v, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(v), 7, 0, Math.PI * 2);
    ctx.fill();
  });
  if (chartText) {
    chartText.textContent = "BMI from " + bmis[0].toFixed(1) + " on " + formatDate(sorted[0].date) + " to " + bmis[bmis.length - 1].toFixed(1) + " on " + formatDate(sorted[sorted.length - 1].date) + " over " + sorted.length + " weigh-ins. Healthy range 18.5–24.9.";
  }
}

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
    setFormStatus(document.getElementById("meas-msg"), "Enter at least one measurement.", true);
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
    list.innerHTML = '<p class="empty-state">No measurements yet. Tap "+ Log measurements" to add your first.</p>';
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

function renderPhotos() {
  const grid = document.getElementById("photo-grid");
  // Snapshots keep photo dates only, not the pictures; skip those here.
  const sorted = [...store.photos].filter((p) => p.dataUrl).sort(byDateDesc);
  if (!sorted.length) {
    grid.innerHTML = '<p class="empty-state">No progress photos yet. Tap "+ Add photo" to add your first.</p>';
    return;
  }
  grid.innerHTML = sorted.map((p) => `
    <div class="photo-item">
      <img src="${p.dataUrl}" alt="Progress photo from ${escapeHtml(formatDate(p.date))}" loading="lazy">
      <div class="photo-date">
        <span>${escapeHtml(formatDate(p.date))}</span>
        <button data-del-photo="${p.id}" aria-label="Delete photo">Delete</button>
      </div>
    </div>`).join("");

  grid.querySelectorAll("[data-del-photo]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this photo?")) return;
    store.photos = store.photos.filter((x) => x.id !== b.dataset.delPhoto);
    saveStore();
    renderPhotos();
  }));
}

/* ---------- Journal ---------- */

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
    list.innerHTML = '<p class="empty-state">No journal entries yet. Tap "New entry" to write your first.</p>';
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
  // v169: the Side effects section below the entries stays in step.
  renderJournalSe();
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
let journalSeLimit = 10; // same, for the Side effects section on the Journal tab

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
    journalSeLimit = 10;
    renderSideEffects();
  }));
}

/* ---------- Side effect trends ---------- */
/* Last 30 days, grouped by symptom: how many times it happened and the
   average severity, so patterns are easy to see without reading every
   entry. */
function renderSeTrends() {
  const el = document.getElementById("se-trends");
  if (!el) return;
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recent = (store.sideEffects || []).filter((e) => e.date >= localDateStr(thirtyDaysAgo));
  if (!recent.length) { el.innerHTML = ""; return; }
  const sevNum = { "Mild": 1, "Moderate": 2, "Severe": 3 };
  const groups = {};
  recent.forEach((e) => {
    const key = (e.symptom || "Effect").trim();
    if (!groups[key]) groups[key] = { count: 0, sev: 0, n: 0 };
    groups[key].count++;
    if (sevNum[e.severity]) { groups[key].sev += sevNum[e.severity]; groups[key].n++; }
  });
  const rows = Object.entries(groups).sort((a, b) => b[1].count - a[1].count).map(([name, g]) => {
    const avg = g.n ? (g.sev / g.n).toFixed(1) : "—";
    return `<li><strong>${escapeHtml(name)}</strong>: ${g.count} time${g.count === 1 ? "" : "s"} in the last 30 days, average severity ${avg} of 3</li>`;
  }).join("");
  el.innerHTML = `<h3 style="margin:12px 0 6px">Trends, last 30 days</h3><ul style="margin:0;padding-left:20px">${rows}</ul>`;
}

/* ---------- Medicines ---------- */
/* Daily medicines besides the GLP-1 shot. A standing list (name, dose,
   time) with a per-day check-off: tap the circle when you take one.
   Taken state is per date, so a new day starts unchecked. */
function renderMedicines() {
  const list = document.getElementById("medicine-list");
  if (!list) return;
  const date = viewedDateStr();
  const taken = (store.medicineTaken && store.medicineTaken[date]) || [];
  if (!store.medicines.length) {
    list.innerHTML = '<p class="empty-state">No medicines added yet. Add one above.</p>';
    return;
  }
  list.innerHTML = store.medicines.map((m) => {
    const isTaken = taken.includes(m.id);
    return `<div class="entry-row" style="display:flex;align-items:center;gap:10px">
      <button type="button" class="move-check${isTaken ? " done" : ""}" data-med="${m.id}" aria-pressed="${isTaken ? "true" : "false"}" aria-label="Mark ${escapeHtml(m.name)} taken today"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5 9.5 18 20 6.5"/></svg></button>
      <span style="flex:1"><strong>${escapeHtml(m.name)}</strong>${m.dose ? " · " + escapeHtml(m.dose) : ""}${m.time ? " · " + escapeHtml(m.time) : ""}</span>
      <button type="button" class="btn btn-small" data-med-edit="${m.id}" aria-label="Edit ${escapeHtml(m.name)}">Edit</button>
      <button type="button" class="btn btn-small" data-med-del="${m.id}">Delete</button>
    </div>`;
  }).join("");
  list.querySelectorAll("[data-med]").forEach((btn) => btn.addEventListener("click", () => {
    const d = viewedDateStr();
    if (!store.medicineTaken) store.medicineTaken = {};
    const arr = store.medicineTaken[d] || [];
    const i = arr.indexOf(btn.dataset.med);
    if (i === -1) arr.push(btn.dataset.med); else arr.splice(i, 1);
    store.medicineTaken[d] = arr;
    saveStore();
    renderMedicines();
  }));
  list.querySelectorAll("[data-med-del]").forEach((btn) => btn.addEventListener("click", () => {
    store.medicines = store.medicines.filter((m) => m.id !== btn.dataset.medDel);
    saveStore();
    renderMedicines();
  }));
  list.querySelectorAll("[data-med-edit]").forEach((btn) => btn.addEventListener("click", () => {
    const m = (store.medicines || []).find((x) => x.id === btn.dataset.medEdit);
    if (!m) return;
    editingMedId = m.id;
    document.getElementById("med-name").value = m.name || "";
    document.getElementById("med-dose").value = m.dose || "";
    document.getElementById("med-time").value = m.time || "";
    document.getElementById("med-submit-btn").textContent = "Save changes";
    document.getElementById("med-cancel-btn").classList.remove("hidden");
    document.getElementById("med-name").focus();
  }));
}
/* Editing a medicine keeps its id, so the taken history for that
   medicine is kept. Deleting and re-adding would lose it. */
let editingMedId = null;
function resetMedForm() {
  document.getElementById("medicine-form").reset();
  document.getElementById("med-submit-btn").textContent = "Add medicine";
  document.getElementById("med-cancel-btn").classList.add("hidden");
}
document.getElementById("med-cancel-btn").addEventListener("click", () => {
  editingMedId = null;
  resetMedForm();
  document.getElementById("med-msg").textContent = "";
});
document.getElementById("medicine-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("med-msg");
  const name = document.getElementById("med-name").value.trim().slice(0, 80);
  if (!name) { setFormStatus(msg, "Type the medicine name first.", true); return; }
  const dose = document.getElementById("med-dose").value.trim().slice(0, 40);
  const time = document.getElementById("med-time").value.trim().slice(0, 20);
  if (editingMedId) {
    const i = (store.medicines || []).findIndex((x) => x.id === editingMedId);
    if (i !== -1) {
      store.medicines[i] = { ...store.medicines[i], name, dose, time };
      setFormStatus(msg, "Medicine updated.", false);
    }
    editingMedId = null;
  } else {
    store.medicines.push({ id: uid(), name, dose, time, date: viewedDateStr() });
    setFormStatus(msg, "Medicine added.", false);
  }
  saveStore();
  resetMedForm();
  renderMedicines();
});

/* ---------- Saved recipes ---------- */
/* Recipes from the Companion, saved to cook again. Title plus the
   ingredients and steps, pasted in. Stored on this device only. */
/* ---------- New Chapter Kitchen ---------- */
/* Built-in recipe library. Per-serving macros are estimated from USDA
   FoodData Central values for the listed ingredients (chicken breast
   roasted FDC 171477, Greek yogurt nonfat FDC 174833, salmon Atlantic
   cooked FDC 175168, egg FDC 171727, and standard entries for oats,
   quinoa, vegetables, and grains). Calories are 4/4/9 from the rounded
   macros, the same conversion the app uses everywhere. Tags drive the
   filter chips. Low-oxalate is tagged only where every ingredient is
   generally low in oxalate (no spinach, sweet potato, or oats). */
const KITCHEN_RECIPES = [
  {
    id: "lemon-garlic-chicken",
    image: "kitchen/lemon-garlic-chicken.jpg",
    credit: "Unsplash",
    name: "Lemon Garlic Chicken with Zucchini",
    category: "High Protein",
    time: 25, difficulty: "Easy", servings: 2,
    protein: 36, carbs: 5, fat: 9, calories: 245,
    tags: ["high-protein", "low-carb", "lunch", "dinner", "low-sodium", "low-oxalate"],
    ingredients: [
      "2 chicken breasts (about 225 g total)",
      "2 zucchini, sliced",
      "1 lemon, juiced",
      "2 garlic cloves, minced",
      "1 tablespoon olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    steps: [
      "Season the chicken with lemon juice, garlic, salt, and pepper.",
      "Cook in a pan with olive oil until the center reaches 165°F.",
      "Add the zucchini and cook until just tender.",
      "Serve the chicken over the zucchini."
    ]
  },
  {
    id: "greek-yogurt-egg-bowl",
    image: "kitchen/greek-yogurt-egg-bowl.jpg",
    credit: "Paul Keller, Flickr, CC BY",
    name: "Greek Yogurt Egg Power Bowl",
    category: "High Protein",
    time: 10, difficulty: "Easy", servings: 1,
    protein: 25, carbs: 9, fat: 6, calories: 190,
    tags: ["high-protein", "low-carb", "breakfast", "easy-prep", "budget-friendly", "low-sodium"],
    ingredients: [
      "170 g plain nonfat Greek yogurt (about 3/4 cup)",
      "1 boiled egg, halved",
      "30 g fresh spinach (about 1 cup)",
      "50 g cucumber, sliced"
    ],
    steps: [
      "Spoon the yogurt into a bowl.",
      "Add the egg, spinach, and cucumber.",
      "Season with a little salt and pepper.",
      "Eat right away, or chill and take it with you."
    ]
  },
  {
    id: "berry-yogurt-bowl",
    image: "kitchen/berry-yogurt-bowl.jpg",
    credit: "grongar, Flickr, CC BY",
    name: "Berry Greek Yogurt Bowl",
    category: "Easy Breakfasts",
    time: 5, difficulty: "Easy", servings: 1,
    protein: 20, carbs: 31, fat: 2, calories: 222,
    tags: ["breakfast", "easy-prep", "small-portions", "budget-friendly", "low-sodium"],
    ingredients: [
      "170 g plain nonfat Greek yogurt (about 3/4 cup)",
      "75 g blueberries (about 1/2 cup)",
      "20 g rolled oats (about 2 tablespoons)"
    ],
    steps: [
      "Spoon the yogurt into a bowl.",
      "Top with blueberries and oats.",
      "Stir lightly and eat."
    ]
  },
  {
    id: "spinach-scrambled-eggs",
    image: "kitchen/spinach-eggs-toast.jpg",
    credit: "ultrakml, Flickr, CC BY",
    name: "Spinach Scrambled Eggs with Toast",
    category: "Easy Breakfasts",
    time: 10, difficulty: "Easy", servings: 1,
    protein: 17, carbs: 14, fat: 16, calories: 268,
    tags: ["breakfast", "easy-prep", "low-carb", "budget-friendly", "low-sodium"],
    ingredients: [
      "2 eggs",
      "30 g fresh spinach (about 1 cup)",
      "1 teaspoon olive oil",
      "1 slice whole wheat bread, toasted"
    ],
    steps: [
      "Whisk the eggs in a bowl.",
      "Warm the oil in a pan and wilt the spinach.",
      "Pour in the eggs and stir gently until just set.",
      "Serve with the toast."
    ]
  },
  {
    id: "salmon-quinoa-broccoli",
    image: "kitchen/salmon-quinoa-broccoli.jpg",
    credit: "Ella Olsson, Wikimedia Commons, CC BY",
    name: "Salmon, Quinoa and Broccoli",
    category: "Balanced Dinners",
    time: 25, difficulty: "Easy", servings: 2,
    protein: 32, carbs: 28, fat: 21, calories: 429,
    tags: ["high-protein", "balanced-macros", "dinner", "low-sodium"],
    ingredients: [
      "2 salmon fillets (about 225 g total)",
      "200 g cooked quinoa (about 1 cup)",
      "200 g broccoli florets",
      "2 teaspoons olive oil",
      "A pinch of salt (optional) and lemon to taste"
    ],
    steps: [
      "Cook the salmon in a pan with 1 teaspoon of olive oil until it flakes.",
      "Steam or roast the broccoli until tender.",
      "Toss the quinoa with the remaining oil.",
      "Serve the salmon over the quinoa with broccoli on the side."
    ]
  },
  {
    id: "turkey-vegetable-skillet",
    image: "kitchen/turkey-skillet.jpg",
    credit: "rovingI, Flickr, CC BY",
    name: "Turkey and Vegetable Skillet",
    category: "Balanced Dinners",
    time: 20, difficulty: "Easy", servings: 2,
    protein: 31, carbs: 28, fat: 16, calories: 380,
    tags: ["high-protein", "balanced-macros", "lunch", "dinner", "budget-friendly", "low-sodium"],
    ingredients: [
      "240 g lean ground turkey",
      "200 g cooked sweet potato, cubed (about 1 cup)",
      "200 g green beans",
      "2 teaspoons olive oil",
      "A pinch of salt (optional) and pepper"
    ],
    steps: [
      "Brown the turkey in a pan with the olive oil.",
      "Add the green beans and cook until tender.",
      "Stir in the sweet potato and warm through.",
      "Season and serve."
    ]
  },
  {
    id: "berry-protein-smoothie",
    image: "kitchen/berry-smoothie.jpg",
    credit: "my little red suitcase, Flickr, CC BY",
    name: "Berry Protein Smoothie",
    category: "Small Appetite",
    time: 5, difficulty: "Easy", servings: 1,
    protein: 15, carbs: 30, fat: 5, calories: 225,
    tags: ["snacks-smoothies", "breakfast", "small-portions", "easy-prep", "balanced-macros", "low-oxalate"],
    ingredients: [
      "100 g plain nonfat Greek yogurt",
      "120 ml whole milk (about 1/2 cup)",
      "1/2 banana",
      "50 g blueberries (about 1/3 cup)"
    ],
    steps: [
      "Put everything in a blender.",
      "Blend until smooth.",
      "Pour into a glass and drink right away."
    ]
  },
  {
    id: "egg-toast-plate",
    image: "kitchen/egg-toast-plate.jpg",
    credit: "ultrakml, Flickr, CC BY",
    name: "Egg and Toast Plate",
    category: "Small Appetite",
    time: 10, difficulty: "Easy", servings: 1,
    protein: 18, carbs: 16, fat: 7, calories: 199,
    tags: ["breakfast", "small-portions", "easy-prep", "budget-friendly", "low-sodium", "low-oxalate"],
    ingredients: [
      "1 egg, boiled or fried",
      "1 slice whole wheat bread, toasted",
      "60 g low-fat cottage cheese (about 1/4 cup)",
      "50 g cucumber, sliced"
    ],
    steps: [
      "Cook the egg the way you like it.",
      "Toast the bread.",
      "Plate the egg, toast, cottage cheese, and cucumber.",
      "Season lightly and eat."
    ]
  }
];
let kitchenFilter = "all";
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
  store.protein.push({ id: uid(), date: viewedDateStr(), grams: r.protein * n, carbs: r.carbs * n, fat: r.fat * n, food: r.name });
  saveStore();
  renderToday();
  kitchenAddedAt[id] = Date.now();
  renderKitchen();
  setTimeout(() => { delete kitchenAddedAt[id]; renderKitchen(); }, 2500);
}

/* Meal ideas for the rest of today (v037): Kitchen recipes whose
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
    html = "<h3>Meal ideas for the rest of today</h3>"
      + "<p class=\"muted\" style=\"font-size:.9em\">Set your protein, carb, and fat goals in Settings to see meal ideas matched to what is left today.</p>"
      + "<button type=\"button\" class=\"btn btn-small\" data-goto=\"settings\">Set goals in Settings</button>";
  } else {
    const pLeft = pGoal - sumForDate(store.protein, t, "grams");
    const cLeft = cGoal - sumForDate(store.protein, t, "carbs");
    const fLeft = fGoal - sumForDate(store.protein, t, "fat");
    if (pLeft <= 0 && cLeft <= 0 && fLeft <= 0) {
      html = "<h3>Meal ideas for the rest of today</h3>"
        + "<p class=\"muted\" style=\"font-size:.9em\">You have met your macro goals for today. Nice work.</p>";
    } else {
      const fits = KITCHEN_RECIPES.filter((r) => r.protein <= pLeft && r.carbs <= cLeft && r.fat <= fLeft)
        .sort((a, b) => b.protein - a.protein).slice(0, 3);
      if (!fits.length) {
        html = "<h3>Meal ideas for the rest of today</h3>"
          + "<p class=\"muted\" style=\"font-size:.9em\">Nothing in the Kitchen fits what is left today. A small snack from Your foods may fit better.</p>";
      } else {
        html = "<h3>Meal ideas for the rest of today</h3>"
          + "<p class=\"muted\" style=\"font-size:.9em\">These fit what is left of your goals today: "
          + Math.max(0, Math.round(pLeft)) + "g protein, "
          + Math.max(0, Math.round(cLeft)) + "g carbs, "
          + Math.max(0, Math.round(fLeft)) + "g fat left.</p>"
          + fits.map((r) => {
            const added = kitchenAddedAt[r.id] && Date.now() - kitchenAddedAt[r.id] < 2500;
            return "<div class=\"entry-row\" data-meal-idea=\"" + r.id + "\">"
              + "<div style=\"flex:1\"><strong>" + escapeHtml(r.name) + "</strong>"
              + " <span class=\"muted\" style=\"font-size:.85em\">" + r.protein + "g protein, " + r.carbs + "g carbs, " + r.fat + "g fat</span></div>"
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

function renderKitchen() {
  const list = document.getElementById("kitchen-list");
  if (!list) return;
  renderMealIdeas();
  const shown = KITCHEN_RECIPES.filter((r) => kitchenFilter === "all" || r.tags.includes(kitchenFilter) || r.category.toLowerCase().replace(/ /g, "-") === kitchenFilter);
  if (!shown.length) {
    list.innerHTML = '<p class="empty-state">No recipes match this filter yet.</p>';
    return;
  }
  list.innerHTML = shown.map((r) => {
    const n = kitchenServings[r.id] || 1;
    const saved = kitchenIsSaved(r.id);
    const added = kitchenAddedAt[r.id] && Date.now() - kitchenAddedAt[r.id] < 2500;
    return `<article class="kitchen-card">
      ${r.image ? `<img class="kitchen-photo" src="${escapeHtml(r.image)}" alt="${escapeHtml(r.name)}" loading="lazy">${r.credit ? `<p class="kitchen-credit">Photo: ${escapeHtml(r.credit)}</p>` : ""}` : ""}
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <strong>${escapeHtml(r.name)}</strong>
        <span class="muted" style="font-size:.85em;white-space:nowrap">${escapeHtml(r.category)}</span>
      </div>
      <p class="muted" style="font-size:.85em;margin:4px 0 8px">${r.time} minutes · ${escapeHtml(r.difficulty)} · Serves ${r.servings}</p>
      <div class="kitchen-macros">
        <div class="kitchen-macro"><b>${r.protein}g</b><span>Protein</span></div>
        <div class="kitchen-macro"><b>${r.carbs}g</b><span>Carbs</span></div>
        <div class="kitchen-macro"><b>${r.fat}g</b><span>Fat</span></div>
        <div class="kitchen-macro"><b>${r.calories}</b><span>Calories</span></div>
      </div>
      <p class="muted" style="font-size:.8em;margin:6px 0 0">Per serving</p>
      <details class="kitchen-details"><summary>Ingredients and steps</summary>
        <ul>${r.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
        <ol>${r.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>
      </details>
      <div class="kitchen-actions">
        <button type="button" class="btn btn-small" data-kitchen-save="${r.id}">${saved ? "Saved ✓" : "Save"}</button>
        <span class="kitchen-stepper">
          <button type="button" class="btn btn-small" data-kitchen-serv="${r.id}" data-dir="-1" aria-label="One fewer serving">−</button>
          <span aria-live="polite">Servings: ${n}</span>
          <button type="button" class="btn btn-small" data-kitchen-serv="${r.id}" data-dir="1" aria-label="One more serving">+</button>
        </span>
        <button type="button" class="btn btn-small btn-primary" data-kitchen-add="${r.id}">${added ? "Added to today ✓" : "Add to Today's Nutrition"}</button>
      </div>
      <p class="muted" style="font-size:.85em;margin:6px 0 0">Adds ${n} serving${n === 1 ? "" : "s"}: ${r.protein * n}g protein, ${r.carbs * n}g carbs, ${r.fat * n}g fat.</p>
    </article>`;
  }).join("");
  list.querySelectorAll("[data-kitchen-save]").forEach((btn) => btn.addEventListener("click", () => {
    const r = KITCHEN_RECIPES.find((x) => x.id === btn.dataset.kitchenSave);
    if (!r) return;
    if (kitchenIsSaved(r.id)) {
      store.recipes = store.recipes.filter((x) => x.kitchenId !== r.id);
    } else {
      store.recipes.push({ id: uid(), title: r.name, body: kitchenBodyText(r), date: viewedDateStr(), kitchenId: r.id, image: r.image || "", credit: r.credit || "", protein: r.protein, carbs: r.carbs, fat: r.fat, calories: r.calories, servings: r.servings });
    }
    saveStore();
    renderRecipes();
  }));
  list.querySelectorAll("[data-kitchen-serv]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.kitchenServ;
    kitchenServings[id] = Math.max(1, (kitchenServings[id] || 1) + Number(btn.dataset.dir));
    renderKitchen();
  }));
  list.querySelectorAll("[data-kitchen-add]").forEach((btn) => btn.addEventListener("click", () => addKitchenToToday(btn.dataset.kitchenAdd)));
}
document.querySelectorAll("#kitchen-filters [data-filter]").forEach((chip) => chip.addEventListener("click", () => {
  kitchenFilter = chip.dataset.filter;
  document.querySelectorAll("#kitchen-filters [data-filter]").forEach((c) => c.classList.toggle("active", c === chip));
  const note = document.getElementById("kitchen-oxalate-note");
  if (note) note.classList.toggle("hidden", kitchenFilter !== "low-oxalate");
  renderKitchen();
}));

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
function renderRecipes() {
  renderKitchen();
  const list = document.getElementById("recipe-list");
  if (!list) return;
  if (!store.recipes.length) {
    list.innerHTML = '<p class="empty-state">No recipes saved yet. Save one above.</p>';
    return;
  }
  const sorted = [...store.recipes].sort(byDateDesc);
  list.innerHTML = sorted.map((r) => `<div class="entry-row">
    ${recipePhotoHtml(r)}
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
      <strong>${escapeHtml(r.title)}</strong>
      <button type="button" class="btn btn-small" data-recipe-del="${r.id}">Delete</button>
    </div>
    <p style="white-space:pre-wrap;margin:6px 0 0">${escapeHtml(r.body)}</p>
    ${recipeMacrosHtml(r)}
  </div>`).join("");
  list.querySelectorAll("[data-recipe-del]").forEach((btn) => btn.addEventListener("click", () => {
    store.recipes = store.recipes.filter((r) => r.id !== btn.dataset.recipeDel);
    saveStore();
    renderRecipes();
  }));
  list.querySelectorAll("[data-recipe-add]").forEach((btn) => btn.addEventListener("click", () => {
    const r = store.recipes.find((x) => x.id === btn.dataset.recipeAdd);
    if (!r) return;
    /* Same path as the Kitchen Add to Today: one macro entry for the day,
       then saveStore + renderToday, so entries, snapshots, and the backup
       cap behave exactly as for logging food. */
    store.protein.push({ id: uid(), date: viewedDateStr(), grams: Number(r.protein) || 0, carbs: Number(r.carbs) || 0, fat: Number(r.fat) || 0, food: r.title });
    saveStore();
    renderToday();
    recipeAddedAt[r.id] = Date.now();
    renderRecipes();
    setTimeout(() => { delete recipeAddedAt[r.id]; renderRecipes(); }, 2500);
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
  setFormStatus(msg, "Recipe saved.", false);
  renderRecipes();
});
/* Paste a Recipe. The AI step that reads a pasted recipe and fills in
   the name, servings, and nutrition arrives after November 30, when the
   Worker can parse it. Until then the box shows what is coming, the same
   pattern as Scan my plate and the recipe search box: the pasted text
   goes into the recipe form below, and the name, servings, and nutrition
   stay blank for the user to fill in. Nothing is guessed or invented. */
document.getElementById("paste-recipe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const msg = document.getElementById("paste-recipe-msg");
  const text = document.getElementById("paste-recipe-text").value.trim().slice(0, 4000);
  if (!text) { setFormStatus(msg, "Paste a recipe first.", true); return; }
  document.getElementById("recipe-body").value = text;
  document.getElementById("paste-recipe-text").value = "";
  setFormStatus(msg, "Recipe AI is coming soon. For now, your pasted recipe is in the form below. Edit the name, servings, and nutrition, then save it to your Kitchen.", false);
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
  results.innerHTML = `<p class="muted">Online recipe search is coming soon. After November 30, searching for "${escapeHtml(q)}" here will pull the recipe with its photo and nutrition, and you can add it to today's macros or save it to your Kitchen. For now, try the Kitchen recipes below, or save your own recipe above.</p>`;
});

function renderSideEffects() {
  const list = document.getElementById("sideeffect-list");
  if (!list) return;
  renderSeTrends();
  const sorted = [...store.sideEffects].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No side effects logged yet. Tap "Log effect" above to record how you are feeling today.</p>';
    renderJournalSe();
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
  renderJournalSe();
}

/* Side effects on the Journal tab (v169): the same timeline, below the
   journal entries, in addition to the Effects tab. */
function renderJournalSe() {
  const list = document.getElementById("journal-se-list");
  if (!list) return;
  const sorted = [...store.sideEffects].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No side effects logged yet.</p>';
    return;
  }
  const visibleSe = sorted.slice(0, journalSeLimit);
  const remainingSe = sorted.length - visibleSe.length;
  list.innerHTML = `<div class="se-timeline">` + visibleSe.map(seItemHtml).join("") + `</div>`
    + (remainingSe > 0
      ? `<button class="btn" id="more-journal-se" style="width:100%;margin-top:8px">Show older (${remainingSe} more)</button>`
      : "");
  bindSeButtons(list);
  const moreBtn = document.getElementById("more-journal-se");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    journalSeLimit += 10;
    renderJournalSe();
  });
}

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
  updateSubscriptionStatus();
  renderPlaySubscription();
  document.getElementById("set-med").value = s.medication || "";
  document.getElementById("set-dose").value = s.dose || "";
  document.getElementById("set-shot-day").value = s.shotDay || "";
  document.getElementById("set-water-goal").value = s.waterGoal || 92;
  document.getElementById("set-water-step").value = s.waterStep || 8;
  document.getElementById("set-protein-goal").value = s.proteinGoal || "";
  document.getElementById("set-movement-goal").value = s.movementGoal || 30;
  // v168: carbs and fat targets for the Your Macros card, and height
  // in feet and inches for BMI.
  document.getElementById("set-carbs-goal").value = s.carbGoal || "";
  document.getElementById("set-fat-goal").value = s.fatGoal || "";
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
  populateVoicePicker();
  renderRefillCountdown();
}

function renderRefillCountdown() {
  const el = document.getElementById("refill-countdown");
  const rd = store.settings.refillDate;
  if (!rd) {
    el.textContent = "";
    return;
  }
  const diffDays = daysBetween(todayStr(), rd);
  if (diffDays < 0) {
    el.textContent = "Your refill date has passed. Consider requesting a refill soon.";
  } else if (diffDays === 0) {
    el.textContent = "Your refill is due today.";
  } else if (diffDays === 1) {
    el.textContent = "Your refill is due tomorrow.";
  } else {
    el.textContent = "Your refill is due in " + diffDays + " days (" + formatDate(rd) + ").";
  }
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
  const voiceSel = document.getElementById("set-companion-voice");
  if (voiceSel) voiceSel.addEventListener("change", () => {
    store.settings.companionVoice = voiceSel.value || "";
    saveStore();
  });
  if ("speechSynthesis" in window) {
    try { window.speechSynthesis.addEventListener("voiceschanged", populateVoicePicker); } catch {}
  }
})();

/* v169: a blank or invalid macro target leaves the existing target
   unchanged; v005: there is no preset default, so a blank save when
   nothing was ever set stays unset.
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
document.getElementById("set-macro-pct-btn").addEventListener("click", () => {
  const msg = document.getElementById("set-macro-pct-msg");
  const cal = Number(document.getElementById("set-calorie-target").value);
  const pp = Number(document.getElementById("set-protein-pct").value);
  const cp = Number(document.getElementById("set-carbs-pct").value);
  const fp = Number(document.getElementById("set-fat-pct").value);
  if (!(cal > 0)) { msg.textContent = "Enter your daily calorie target above first."; return; }
  if (![pp, cp, fp].every((n) => Number.isFinite(n) && n >= 0)) { msg.textContent = "Enter a percentage for protein, carbs, and fat."; return; }
  const sum = pp + cp + fp;
  if (sum !== 100) { msg.textContent = "Percentages must add up to 100. Yours add up to " + sum + "."; return; }
  const pg = Math.round(cal * pp / 100 / 4);
  const cg = Math.round(cal * cp / 100 / 4);
  const fg = Math.round(cal * fp / 100 / 9);
  document.getElementById("set-protein-goal").value = pg;
  document.getElementById("set-carbs-goal").value = cg;
  document.getElementById("set-fat-goal").value = fg;
  msg.textContent = "Set to " + pg + "g protein, " + cg + "g carbs, " + fg + "g fat. Tap Save below to keep them.";
});

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
    if (tokenSaveFailed) document.getElementById("set-companion-key").value = maskToken(getAuthToken());
  }
  store.settings.medication = document.getElementById("set-med").value.trim() || "Zepbound";
  store.settings.dose = document.getElementById("set-dose").value;
  store.settings.shotDay = document.getElementById("set-shot-day").value;
  const wg = Number(document.getElementById("set-water-goal").value);
  store.settings.waterGoal = wg > 0 ? wg : 92;
  const ws = Number(document.getElementById("set-water-step").value);
  store.settings.waterStep = ws > 0 ? Math.round(ws) : 8;
  // v169: a blank or invalid macro target keeps the existing target.
  store.settings.proteinGoal = keepMacroTarget(document.getElementById("set-protein-goal").value, store.settings.proteinGoal, "");
  const mg = Number(document.getElementById("set-movement-goal").value);
  store.settings.movementGoal = mg > 0 ? mg : 30;
  // v168: carbs and fat targets for the Your Macros card, and height
  // for BMI. A height with no feet and no inches stays blank.
  // (Number("") is 0, so the raw field value is checked first.)
  store.settings.carbGoal = keepMacroTarget(document.getElementById("set-carbs-goal").value, store.settings.carbGoal, "");
  store.settings.fatGoal = keepMacroTarget(document.getElementById("set-fat-goal").value, store.settings.fatGoal, "");
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
  const voiceSelSave = document.getElementById("set-companion-voice");
  if (voiceSelSave) store.settings.companionVoice = voiceSelSave.value || "";
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
  } else {
    line.textContent = "Your AI Wellness Companion is not connected yet.";
    line.style.color = "";
    if (entry) entry.classList.remove("hidden");
  }
}

/* Subscription status in Settings. Uses only the paid access this device
   already tracks (the companion token from the website flow, or a Play
   entitlement). It never invents a plan type: the app does not store
   whether a website subscriber is monthly or annual. */
function updateSubscriptionStatus() {
  const line = document.getElementById("subscription-status-line");
  if (!line) return;
  const token = getAuthToken();
  if (token && token.length >= 16) {
    line.textContent = "Your subscription is active, and your AI Wellness Companion is connected.";
    line.style.color = "var(--sage-dark)";
  } else if (isPlayEntitled()) {
    line.textContent = "Your Play subscription is active.";
    line.style.color = "var(--sage-dark)";
  } else {
    line.textContent = "No active subscription on this device.";
    line.style.color = "";
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
    } else {
      setCodeError(data.error || "That code did not work. Try again.");
    }
  } catch (e) {
    setCodeError("Could not reach the service. Check your connection.");
  }
  btn.disabled = false;
}

document.getElementById("redeem-code-btn").addEventListener("click", redeemAccessCode);

/* Subscription section in Settings: Resubscribe reveals the two Stripe
   plan links; Cancel is a pre-filled email (one-tap portal cancel needs a
   server and is a post-November 30 follow up). */
document.getElementById("resubscribe-btn").addEventListener("click", () => {
  const btn = document.getElementById("resubscribe-btn");
  const plans = document.getElementById("resubscribe-plans");
  if (!btn || !plans) return;
  const opening = plans.classList.contains("hidden");
  plans.classList.toggle("hidden", !opening);
  btn.setAttribute("aria-expanded", opening ? "true" : "false");
  btn.textContent = opening ? "Hide plans" : "Resubscribe";
});
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
const PLAY_ENTITLEMENT_KEY = "newChapterTracker.playEntitlement.v1";

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
// Play specific message instead of the website welcome page message.
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

/* ---------- Backup nudge ---------- */

function renderBackupNudge() {
  const banner = document.getElementById("backup-nudge");
  if (!banner) return;
  let snooze = null, last = null;
  try {
    snooze = localStorage.getItem("nct-backup-snooze");
    last = localStorage.getItem("nct-last-backup");
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
  try { localStorage.setItem("nct-backup-snooze", s); } catch {}
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

const SNAP_KEY = "nct-snapshots";

/* Safety net: if the main store has zero entries but a non-empty snapshot
   exists, restore the newest non-empty snapshot instead of showing a blank
   app. Called once at startup, before the first render and before any
   save, so the restored data is what the user sees and what gets saved. */
function maybeRestoreFromSnapshot() {
  if (countStoreEntries(store) !== 0) return;
  const snaps = loadSnapshots();
  for (const sn of snaps) {
    // A safety copy kept when data was deleted on purpose must never
    // bring that data back on its own (S14).
    if (sn.label === "Before delete") continue;
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
   is kept aside (newChapterTracker.v1.corrupt) and the save guard keeps
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
    if (localStorage.getItem("nct-ever-had-entries") === "1") return true;
    if (localStorage.getItem("nct-last-backup")) return true;
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
      "Tip: your entries stay on this device. If you add the tracker to your home screen, open it from there so everything stays in one place.";
    card.classList.remove("hidden");
    return;
  }
  if (!hasUsedAppBefore()) { card.classList.add("hidden"); return; }
  document.getElementById("empty-notice-text").textContent =
    "Your entries are not showing here. Entries stay only in this app on this phone. If you opened the tracker in Safari, from a link, or from a new app icon, that is a separate, empty copy. Open the tracker from your home-screen app icon, or restore a backup in Settings.";
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
      if (sn.label !== undefined && sn.label !== "Before delete" && sn.label !== "Before restore") sn.label = undefined;
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
    try { localStorage.setItem("nct-last-backup", todayStr()); } catch {}
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
document.getElementById("day-cal").addEventListener("click", openDayPicker);
// Tapping the date heading itself also opens the picker
document.getElementById("date-tap").addEventListener("click", openDayPicker);
document.getElementById("date-tap").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDayPicker(); }
});


/* ---------- First-run setup wizard ---------- */

(function setupDefaults() {
  if (localStorage.getItem("nct-setup-done")) return;
  // Set sensible defaults silently, no blocking wizard.
  // User can change everything in Settings.
  if (!store.settings.medication) store.settings.medication = "Zepbound";
  if (!store.settings.waterGoal) store.settings.waterGoal = 92;
  // v005: no preset macro targets; the user sets their own in Settings.
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
/* A 4-step setup shown once, on a fresh install: name, medication +
   dose, shot day, height + goal weight. Nothing is required: every
   step can be left blank, and Skip closes the setup without saving.
   Existing installs already have nct-setup-done set and never see it. */
let setupStep = 1;
function showSetupStep(n) {
  setupStep = n;
  document.querySelectorAll("#setup-overlay .setup-step").forEach((s) => {
    s.classList.toggle("hidden", Number(s.dataset.step) !== n);
  });
  document.getElementById("setup-step-label").textContent = "Step " + n + " of 4";
  document.getElementById("setup-back").classList.toggle("hidden", n === 1);
  document.getElementById("setup-next").textContent = n === 4 ? "Finish" : "Next";
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
    const hft = Number(document.getElementById("setup-height-ft").value);
    if (Number.isFinite(hft) && hft >= 0 && hft <= 8) store.settings.heightFt = hft;
    const hin = Number(document.getElementById("setup-height-in").value);
    if (Number.isFinite(hin) && hin >= 0 && hin <= 11) store.settings.heightIn = hin;
    const gw = Number(document.getElementById("setup-goal-weight").value);
    if (gw > 0) store.settings.goalWeight = gw;
    saveStore();
  }
  try { localStorage.setItem("nct-setup-done", "1"); } catch {}
  document.getElementById("setup-overlay").classList.add("hidden");
  renderToday();
}
const setupNextBtn = document.getElementById("setup-next");
const setupBackBtn = document.getElementById("setup-back");
const setupSkipBtn = document.getElementById("setup-skip");
const setupOverlayEl = document.getElementById("setup-overlay");
if (setupNextBtn) setupNextBtn.addEventListener("click", () => {
  if (setupStep < 4) showSetupStep(setupStep + 1);
  else finishSetup(true);
});
if (setupBackBtn) setupBackBtn.addEventListener("click", () => {
  if (setupStep > 1) showSetupStep(setupStep - 1);
});
if (setupSkipBtn) setupSkipBtn.addEventListener("click", () => finishSetup(false));
if (!localStorage.getItem("nct-setup-done") && setupOverlayEl) {
  showSetupStep(1);
  setupOverlayEl.classList.remove("hidden");
}

document.getElementById("clear-all-data").addEventListener("click", () => {
  if (!confirm("Delete ALL your data? Your entries will be gone. A safety copy will stay in Backup & restore in Settings, in case this was a mistake. Consider downloading a backup first.")) return;
  if (!confirm("Are you sure? This deletes your tracked entries, chat history, and custom activities. Your companion access stays connected.")) return;
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
  try { localStorage.setItem("nct-store-tombstone", String(deleteGen)); } catch {}
  localStorage.removeItem("nct-ever-had-entries");
  localStorage.removeItem(LS_KEY + ".corrupt");
  localStorage.removeItem("nct-snapshots.corrupt");
  localStorage.removeItem("nct-last-snapshot-day");
  localStorage.removeItem("nc_custom_activities");
  localStorage.removeItem("nct-last-backup");
  localStorage.removeItem("nct-backup-snooze");
  localStorage.removeItem(CHAT_KEY);
  localStorage.removeItem("nct-setup-done");
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
    try { existing = localStorage.getItem("nct-ever-had-entries") === "1"; } catch {}
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

/* Build the GLP-1 context sent with each Companion chat message so
   replies are personalized to this user's treatment, not generic.
   Only includes what the user has already logged in the app. */
function buildCompanionContext() {
  const s = store.settings || {};
  const ctx = {};
  if (s.medication) ctx.medication = s.medication;
  if (s.dose) ctx.dose = s.dose;
  if (s.shotDay) ctx.shotDay = s.shotDay;
  const today = todayStr();
  const proteinLogged = Math.round(sumForDate(store.protein || [], today, "grams"));
  const proteinTarget = Number(s.proteinGoal) || 0;
  if (proteinTarget) { ctx.proteinLogged = proteinLogged; ctx.proteinTarget = proteinTarget; }
  ctx.movementMinutes = Math.round(sumForDate(store.exercise || [], today, "minutes"));
  ctx.waterOz = Math.round(sumForDate(store.water || [], today, "oz"));
  const sortedW = [...(store.weight || [])].sort(byDate);
  const latest = sortedW[sortedW.length - 1];
  const start = getStartingWeight();
  if (latest && start) {
    const change = Number(start.value) - Number(latest.value);
    ctx.weightChange = "Latest " + Number(latest.value).toFixed(1) + " lbs, " + (change >= 0 ? "-" : "+") + Math.abs(change).toFixed(1) + " lbs since starting";
  } else if (latest) {
    ctx.weightChange = "Latest " + Number(latest.value).toFixed(1) + " lbs";
  }
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentE = [...(store.sideEffects || [])].filter((e) => e.date >= localDateStr(thirtyDaysAgo));
  if (recentE.length) {
    ctx.recentSideEffects = recentE.slice(0, 5).map((e) => e.symptom + " (" + e.severity + ")").join(", ");
  }
  return ctx;
}

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
      document.getElementById("memory-medication").value = data.profile.medication || "";
      document.getElementById("memory-dose").value = data.profile.dose || "";
      document.getElementById("memory-shot-day").value = data.profile.shotDay || "";
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
    medication: document.getElementById("memory-medication").value.trim(),
    dose: document.getElementById("memory-dose").value.trim(),
    shotDay: document.getElementById("memory-shot-day").value.trim(),
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

const CHAT_KEY = "newChapterTracker.chat.v1";
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
    const voice = selectedVoice();
    if (voice) u.voice = voice;
    u.rate = 0.9; // v004: a slightly slower read, so the Companion sounds calm and relaxed.
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

/* v001: Companion voice picker. Lists the phone's built-in speech
   voices (speechSynthesis), on-device and free. The chosen voice name
   is stored in settings; blank means the phone default. Voices load
   asynchronously, so the picker refills on voiceschanged. Only the
   best voices are offered: premium/enhanced first, compact voices
   dropped, so the list never shows the jerky robotic ones. */
function availableVoices() {
  if (!("speechSynthesis" in window)) return [];
  try { return window.speechSynthesis.getVoices() || []; } catch { return []; }
}
/* Best voices only, in preference order: voices matching the device
   language; among those, premium/enhanced voices if any exist;
   otherwise all but the compact ones; if that leaves none, all
   voices for the language, so the picker is never empty. */
function bestVoices(voices) {
  const list = voices || [];
  const lang = (navigator.language || "en").toLowerCase();
  const prefix = lang.split("-")[0];
  let same = list.filter((v) => (v.lang || "").toLowerCase() === lang);
  if (!same.length) same = list.filter((v) => (v.lang || "").toLowerCase().split("-")[0] === prefix);
  if (!same.length) same = list;
  const uri = (v) => String(v.voiceURI || "").toLowerCase();
  const premium = same.filter((v) => uri(v).indexOf("premium") !== -1 || uri(v).indexOf("enhanced") !== -1);
  if (premium.length) return premium;
  const nonCompact = same.filter((v) => uri(v).indexOf("compact") === -1);
  if (nonCompact.length) return nonCompact;
  return same;
}
function selectedVoice() {
  const name = store.settings.companionVoice || "";
  if (!name) return null;
  const voices = bestVoices(availableVoices());
  return voices.find((v) => v.name === name) || voices[0] || null;
}
function populateVoicePicker() {
  const sel = document.getElementById("set-companion-voice");
  if (!sel) return;
  const voices = bestVoices(availableVoices());
  const current = store.settings.companionVoice || "";
  sel.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Phone default voice";
  sel.appendChild(def);
  voices.forEach((v) => {
    const o = document.createElement("option");
    o.value = v.name;
    o.textContent = v.name + (v.lang ? " (" + v.lang + ")" : "");
    sel.appendChild(o);
  });
  sel.value = voices.some((v) => v.name === current) ? current : "";
  if (sel.value !== current) store.settings.companionVoice = "";
}
/* v004: Preview the voice. Speaks a sample line in the voice currently
   chosen in the picker, so you can hear it before saving. Uses the same
   calm rate as the real read-aloud. */
document.getElementById("companion-voice-preview").addEventListener("click", () => {
  if (!("speechSynthesis" in window)) return;
  const sel = document.getElementById("set-companion-voice");
  const name = sel ? sel.value : "";
  const voices = bestVoices(availableVoices());
  const voice = name ? voices.find((v) => v.name === name) || null : null;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Hello. I am your AI Wellness Companion. I am here to help you stay strong while the medicine works.");
    if (voice) u.voice = voice;
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  } catch {}
});
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

/* v000: the Companion chat shows a not-connected state before the
   user can type or send, when no code has been entered. The banner
   states what is needed and links to Settings (where the code is
   entered) and to the welcome page (where the code comes from).
   Play subscribers without a token see the Play-specific text. */
function renderChatGate() {
  const banner = document.getElementById("chat-not-connected");
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const micBtn = document.getElementById("chat-mic");
  const connected = !!getAuthToken();
  if (banner) {
    banner.classList.toggle("hidden", connected);
    const playMsg = document.getElementById("chat-not-connected-play");
    const webMsg = document.getElementById("chat-not-connected-web");
    const playBlocked = !connected && isPlayEntitled();
    if (playMsg) playMsg.classList.toggle("hidden", !playBlocked);
    if (webMsg) webMsg.classList.toggle("hidden", playBlocked);
  }
  if (input) input.disabled = !connected;
  if (sendBtn) sendBtn.disabled = !connected;
  if (micBtn) micBtn.disabled = !connected;
  document.querySelectorAll("#chat-chips .chat-chip").forEach((c) => { c.disabled = !connected; });
}

function renderChat() {
  renderMorningCheckin();
  renderChatGate();
  // v000: the chat header shows the Companion's chosen name and avatar.
  const title = document.getElementById("chat-title");
  if (title) title.textContent = "Your " + companionDisplayName();
  const headerAvatar = document.getElementById("chat-header-avatar");
  if (headerAvatar) {
    const fresh = companionAvatarImg("chat-header-avatar");
    fresh.id = "chat-header-avatar";
    headerAvatar.replaceWith(fresh);
  }
  const input = document.getElementById("chat-input");
  if (input) input.placeholder = "Ask " + companionDisplayName() + "...";
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
    b.textContent = "🔊 Listen";
    b.dataset.text = text;
    b.addEventListener("click", () => {
      if (isSpeaking()) { stopSpeaking(); b.textContent = "🔊 Listen"; b.classList.remove("playing"); b.setAttribute("aria-label", "Listen to this reply"); return; }
      if (speakCompanion(text)) {
        b.textContent = "⏹ Stop";
        b.classList.add("playing");
        b.setAttribute("aria-label", "Stop listening");
        const u = currentUtterance;
        if (u) {
          const done = () => { b.textContent = "🔊 Listen"; b.classList.remove("playing"); b.setAttribute("aria-label", "Listen to this reply"); };
          u.addEventListener("end", done);
          u.addEventListener("error", done);
        }
      }
    });
    return b;
  };
  if (chatHistory.length === 0) {
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

  // No code entered: do not call the worker. The banner above the
  // chat already says a code is needed; this keeps a send from
  // failing silently when the input is reached another way.
  if (!getAuthToken() && !playChatBlocked()) {
    chatHistory.push({
      role: "assistant",
      content: "Your AI Wellness Companion is not connected yet. Get your code from the welcome page with your purchase email, then enter it in Settings.",
    });
    saveChatHistory();
    renderChat();
    maybeReadAloud();
    return;
  }

  // Play subscribers without a companion token cannot call the worker yet.
  // Show a Play specific message instead of the website welcome page message.
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
      // only when a custom name is set. Also send the GLP-1 context
      // (medication, dose, shot day, today's protein/movement/water,
      // weight trend, recent side effects) so replies are personalized.
      body: JSON.stringify({ messages: chatHistory, companionName: companionDisplayName() === COMPANION_DEFAULT_NAME ? undefined : companionDisplayName(), context: buildCompanionContext() }),
    });

    const data = await res.json();

    if (typing) typing.remove();

    if (res.status === 401) {
      // Missing or invalid token. Play users get Play guidance, website
      // users get the welcome page guidance.
      const playService = await getPlayService();
      if (playService) {
        chatHistory.push({
          role: "assistant",
          content: "Your AI Wellness Companion is not connected yet. Subscribe in Settings, or enter a companion key if you have one from the website.",
        });
      } else {
        chatHistory.push({
          role: "assistant",
          content: "Your AI Wellness Companion is not connected yet. Get your code from the welcome page with your purchase email, then enter it in Settings.",
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

/* ---------- Quick prompt chips and a growing chat input (v037) ---------- */
/* The chips send a common question through the existing chat path: the
   chip text goes into the input and the form is submitted, so the
   not-connected message, the Play block, and the daily cap all behave
   exactly as for a typed message. The input is a textarea that grows
   as you type, up to five lines, and Enter sends (Shift+Enter adds a
   line). Nothing here is a new data path; no new data leaves the
   device. */
function growChatInput() {
  const input = document.getElementById("chat-input");
  if (!input) return;
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 132) + "px";
}
function submitChatForm() {
  const form = document.getElementById("chat-form");
  if (!form) return;
  if (form.requestSubmit) form.requestSubmit();
  else form.dispatchEvent(new Event("submit", { cancelable: true }));
}
document.querySelectorAll("#chat-chips .chat-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const input = document.getElementById("chat-input");
    if (!input || input.disabled) return;
    input.value = chip.dataset.chip || chip.textContent.trim();
    growChatInput();
    submitChatForm();
  });
});
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
    micBtn.textContent = on ? "⏹ Stop" : "🎤";
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
