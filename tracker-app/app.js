/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 */

/* A New Chapter Tracker - app logic. Data persists in localStorage on this device only. */

"use strict";

/* App version (v156): shown in Settings, About, so the version on the
   phone can be checked at a glance. Bump with every tracker-app change,
   together with CACHE_NAME in sw.js, the ?v= tokens in index.html, and
   version.json (the staleness check compares against this value). */
const APP_VERSION = "v156";

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
    proteinGoal: 90,
    movementGoal: 30,
    refillDate: "",
    goalWeight: ""
  },
  water: [],        // { id, date: "YYYY-MM-DD", oz: number }
  protein: [],      // { id, date, grams, food }
  exercise: [],     // { id, date, minutes, label }
  injections: [],   // { id, date, medication, dose, site, notes, status: "On time" | "Missed" | "Delayed" }
  weight: [],       // { id, date, value }
  measurements: [], // { id, date, waist, hips, chest, arm, thigh, neck }
  photos: [],       // { id, date, dataUrl }
  journal: [],      // { id, date, mood, notes }
  sideEffects: [],  // { id, date, symptom, severity, notes }
  moods: {}         // { "YYYY-MM-DD": "Good" }
};

/* Collections that must be arrays, and the settings keys with their defaults.
   Used to validate anything loaded from storage or from a file (S3/S11). */
const COLLECTION_KEYS = ["water", "protein", "exercise", "injections", "weight", "measurements", "photos", "journal", "sideEffects"];

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
    for (const g of ["waterGoal", "proteinGoal", "movementGoal"]) {
      const n = Number(out.settings[g]);
      out.settings[g] = Number.isFinite(n) && n > 0 ? n : DEFAULTS.settings[g];
    }
    const gw = Number(out.settings.goalWeight);
    out.settings.goalWeight = Number.isFinite(gw) && gw > 0 ? gw : "";
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
  COLLECTION_KEYS.forEach((k) => {
    const have = new Set((persisted[k] || []).map((e) => e && e.id).filter(Boolean));
    (local[k] || []).forEach((e) => {
      if (!e || typeof e !== "object") return;
      if (!e.id) e.id = uid();
      if (!have.has(e.id)) { out[k].push(e); have.add(e.id); }
    });
  });
  out.moods = Object.assign({}, local.moods || {}, persisted.moods || {});
  return out;
}

/* Read the generation the saved copy is on now, so a deliberate replace
   (restore) can adopt it and write as the newest copy. */
function adoptCurrentGen() {
  try { loadedGen = Number(localStorage.getItem(GEN_KEY)) || 0; } catch { loadedGen = 0; }
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
    const myCount = countStoreEntries(store);
    if (persistedCount > myCount && !allowEmptySave) {
      let settingsMatch = false;
      try {
        settingsMatch = !!persistedStore && JSON.stringify(store.settings) === JSON.stringify(persistedStore.settings);
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

/* How many in-app snapshots to keep (about two weeks of changes). */
const SNAPSHOT_KEEP = 14;
/* Warn when a snapshot is this large; photos are stripped before saving. */
const SNAPSHOT_WARN_BYTES = 2000000;

/* Build the JSON for a snapshot. Photo pictures are left out (only the date
   is kept) because base64 photos are what push a snapshot over the size
   limit; everything else is saved in full, so a too-large store still gets
   a usable snapshot of all its non-photo data (S9). */
function buildSnapshotRaw(s) {
  const stripped = Object.assign({}, s, {
    photos: (Array.isArray(s.photos) ? s.photos : []).map((p) => ({ id: p.id, date: p.date, photo: true }))
  });
  const raw = JSON.stringify(stripped);
  return { raw, photosOmitted: (Array.isArray(s.photos) ? s.photos.length : 0) > 0, nearCap: raw.length > SNAPSHOT_WARN_BYTES };
}

/* Automatic snapshot (v150): a backup copy inside the app, saved on
   every change while there is data to back up, not just once a day. A
   once-a-day copy can be a whole day behind, and a failed save used to
   be swallowed silently. Identical copies are skipped, so a day of small
   edits does not fill the list with duplicates. A failed snapshot is now
   shown in plain words instead of failing silently. */
function saveAutoSnapshot() {
  try {
    if (countStoreEntries(store) === 0) return;
    const built = buildSnapshotRaw(store);
    if (built.nearCap) showStorageWarning("Your saved data is getting large. Download a backup from Settings to keep everything safe.");
    const snaps = loadSnapshots();
    if (snaps.length && snaps[0].data === built.raw) {
      try { localStorage.setItem("nct-last-snapshot-day", todayStr()); } catch {}
      return;
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
   which day is shown, and any entry edit left half finished (F39). */
function resetViewState() {
  viewOffset = 0;
  editingFoodId = null;
  editingInjectionId = null;
  editingWeightId = null;
  editingMeasId = null;
  editingJournalId = null;
  editingSeId = null;
  clearWeekDismissKeys();
  try { cancelFoodEdit(); } catch {}
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

/* Recent foods quick-pick: the 5 most recently logged foods as tap-to-add buttons */

function renderRecentFoods() {
  const box = document.getElementById("recent-foods");
  if (!box) return;
  const seen = new Map();
  [...store.protein].reverse().forEach((e) => {
    const key = (e.food || "Logged entry").trim().toLowerCase();
    if (!seen.has(key)) seen.set(key, e);
  });
  const recent = [...seen.values()].slice(0, 5);
  box.innerHTML = recent.length
    ? '<p class="recent-label">Tap to log again</p>' + recent.map((e) => `
      <button type="button" class="btn btn-small" data-recent-food="${e.id}">${escapeHtml(e.food || "Logged entry")} (${escapeHtml(e.grams)}g)</button>`).join("")
    : "";
  box.querySelectorAll("[data-recent-food]").forEach((b) => b.addEventListener("click", () => {
    const src = store.protein.find((x) => x.id === b.dataset.recentFood);
    if (!src) return;
    store.protein.push({
      id: uid(),
      date: viewedDateStr(),
      grams: Number(src.grams) || 0,
      food: src.food
    });
    saveStore();
    renderToday();
  }));
}

/* Log Food button: jump back to today and scroll to the food form */

document.getElementById("log-food-btn").addEventListener("click", () => {
  if (viewOffset !== 0) {
    viewOffset = 0;
    renderToday();
  }
  setTimeout(() => {
    const form = document.getElementById("protein-form");
    if (form) {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      const foodInput = document.getElementById("protein-food");
      if (foodInput) foodInput.focus({ preventScroll: true });
    }
  }, 60);
});

/* Food entry editing */

let editingFoodId = null;

function startFoodEdit(id) {
  const e = store.protein.find((x) => x.id === id);
  if (!e) return;
  editingFoodId = id;
  document.getElementById("protein-food").value = e.food || "";
  document.getElementById("protein-grams").value = e.grams || "";
  document.getElementById("food-submit-btn").textContent = "Save changes";
  document.getElementById("food-edit-cancel").classList.remove("hidden");
  document.getElementById("protein-form").scrollIntoView({ behavior: "smooth", block: "center" });
  document.getElementById("protein-food").focus({ preventScroll: true });
}

function cancelFoodEdit() {
  editingFoodId = null;
  const form = document.getElementById("protein-form");
  if (form) form.reset();
  const btn = document.getElementById("food-submit-btn");
  if (btn) btn.textContent = "Log";
  const cancel = document.getElementById("food-edit-cancel");
  if (cancel) cancel.classList.add("hidden");
}

/* ---------- Tab navigation ---------- */

const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".tab-panel");

function showTab(name) {
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === name;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", active ? "true" : "false");
  });
  panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  window.scrollTo(0, 0);
  if (name === "weight") drawWeightChart();
  if (name === "injections") renderInjectionCalendar();
  if (name === "chat") loadCoachMemory();
  if (name === "settings") renderPlaySubscription();
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
  if (pStreak >= 3) return "You've hit your protein goal " + pStreak + " days in a row. That's how strength is built after 50.";
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
  if (proteinDays) lines.push("Protein goal reached " + proteinDays + " days.");
  if (waterDays) lines.push("Water goal reached " + waterDays + " days.");
  if (moveDays) lines.push("Movement goal reached " + moveDays + " days.");
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

/* ---------- Weekly wellness summary (last 7 days, logged data only) ---------- */

function weekWindow() {
  const days = [];
  for (let off = 6; off >= 0; off--) days.push(todayStr(-off));
  return days;
}

function weekDismissKey() {
  const days = weekWindow();
  return "nct-week-dismiss:" + days[0] + "_" + days[days.length - 1];
}

// One manageable habit suggestion from the weakest logged area. Never shaming,
// never medical, never a promise about weight. Static wording only, no user data.
function weeklySuggestion(stats) {
  if (!stats.anyLogged) return "One gentle start: log one glass of water today. Small steps count.";
  const areas = [
    { key: "protein", days: stats.proteinDays, total: stats.daysWithGoal.protein },
    { key: "water", days: stats.waterDays, total: stats.daysWithGoal.water },
    { key: "exercise", days: stats.moveDays, total: stats.daysWithGoal.exercise },
  ].filter((a) => a.total > 0);
  if (!areas.length) return "You are logging without set goals. One habit to try: set a protein goal in Settings so next week can show your progress.";
  areas.sort((a, b) => (a.days / a.total) - (b.days / b.total));
  const weakest = areas[0];
  if (weakest.days >= weakest.total) return "You met your goals most days this week. One habit to keep: protect the routine that is already working.";
  if (weakest.key === "protein") return "One manageable habit for next week: add a protein rich food to one meal each day.";
  if (weakest.key === "water") return "One manageable habit for next week: keep a water bottle nearby and sip through the morning.";
  return "One manageable habit for next week: a 10 minute walk after one meal each day.";
}

function renderWeeklySummary() {
  const card = document.getElementById("weekly-summary-card");
  if (!card) return;
  const days = weekWindow();
  const daySet = new Set(days);
  const goal = (k) => Number(store.settings[k]) || 0;
  const proteinGoal = goal("proteinGoal"), waterGoal = goal("waterGoal"), moveGoal = goal("movementGoal");
  const countGoalDays = (key, field, g) => {
    if (!g) return { met: 0, total: 0 };
    let met = 0;
    days.forEach((d) => { if (sumForDate(store[key] || [], d, field) >= g) met++; });
    return { met, total: 7 };
  };
  const p = countGoalDays("protein", "grams", proteinGoal);
  const w = countGoalDays("water", "oz", waterGoal);
  const m = countGoalDays("exercise", "minutes", moveGoal);
  document.getElementById("weekly-summary-range").textContent =
    "Last 7 days: " + formatDate(days[0]) + " to " + formatDate(days[6]) + ".";

  const lines = [];
  const anyLogged = days.some((d) =>
    (store.water || []).some((e) => e.date === d) || (store.protein || []).some((e) => e.date === d) ||
    (store.exercise || []).some((e) => e.date === d) || (store.weight || []).some((e) => e.date === d) ||
    (store.injections || []).some((e) => e.date === d) || (store.journal || []).some((e) => e.date === d) ||
    (store.sideEffects || []).some((e) => e.date === d));
  if (!anyLogged) {
    lines.push("No entries in the last 7 days yet.");
  } else {
    if (proteinGoal) lines.push("Protein goal reached " + p.met + " of 7 days.");
    if (waterGoal) lines.push("Water goal reached " + w.met + " of 7 days.");
    if (moveGoal) lines.push("Movement goal reached " + m.met + " of 7 days.");
    const sessions = (store.exercise || []).filter((e) => daySet.has(e.date));
    const strength = sessions.filter((e) => (e.label || "").toLowerCase().includes("strength"));
    const totalMin = sessions.reduce((t, e) => t + (Number(e.minutes) || 0), 0);
    if (sessions.length) {
      lines.push(sessions.length + " movement session" + (sessions.length === 1 ? "" : "s") +
        " logged, " + totalMin + " minutes total" +
        (strength.length ? ", including " + strength.length + " strength session" + (strength.length === 1 ? "" : "s") : "") + ".");
    }
    const shots = (store.injections || []).filter((e) => daySet.has(e.date)).length;
    if (shots) lines.push(shots + " shot" + (shots === 1 ? "" : "s") + " logged.");
    const weights = (store.weight || []).filter((e) => daySet.has(e.date)).sort(byDate);
    if (weights.length >= 2) {
      const startW = Number(weights[0].value), endW = Number(weights[weights.length - 1].value);
      const change = startW - endW;
      lines.push(change > 0
        ? "Weight went from " + startW + " to " + endW + " lbs, down " + change.toFixed(1) + "."
        : change < 0
          ? "Weight went from " + startW + " to " + endW + " lbs, up " + Math.abs(change).toFixed(1) + "."
          : "Weight held steady at " + endW + " lbs.");
    } else if (weights.length === 1) {
      lines.push("You logged your weight at " + weights[0].value + " lbs.");
    }
    const meas = (store.measurements || []).filter((e) => daySet.has(e.date)).sort(byDate);
    if (meas.length) lines.push("Measurements logged on " + formatDate(meas[meas.length - 1].date) + ".");
    const effects = (store.sideEffects || []).filter((e) => daySet.has(e.date)).sort(byDate);
    if (effects.length) {
      const last = effects[effects.length - 1];
      lines.push(effects.length + " side effect" + (effects.length === 1 ? "" : "s") +
        " logged, most recent: " + escapeHtml(last.symptom || "Not named") +
        " (" + escapeHtml(last.severity || "No severity") + ").");
    } else {
      lines.push("No side effects logged.");
    }
  }
  document.getElementById("weekly-summary-body").innerHTML =
    lines.map((l) => `<p style="margin:0 0 4px">${l}</p>`).join("");

  const stats = { proteinDays: p.met, waterDays: w.met, moveDays: m.met, anyLogged,
    daysWithGoal: { protein: p.total, water: w.total, exercise: m.total } };
  document.getElementById("weekly-suggestion-text").textContent = weeklySuggestion(stats);
  let dismissed = false;
  try { dismissed = localStorage.getItem(weekDismissKey()) === "1"; } catch (err) {}
  document.getElementById("weekly-suggestion-wrap").classList.toggle("hidden", dismissed);
  document.getElementById("weekly-dismissed-note").classList.toggle("hidden", !dismissed);
}

document.getElementById("weekly-dismiss").addEventListener("click", () => {
  try { localStorage.setItem(weekDismissKey(), "1"); } catch (err) {}
  renderWeeklySummary();
});
document.getElementById("weekly-show-suggestion").addEventListener("click", () => {
  try { localStorage.removeItem(weekDismissKey()); } catch (err) {}
  renderWeeklySummary();
});

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

  // Steppers, forms and mood buttons log to the day being viewed, so they
  // stay usable on past days (F13/F16). Nothing here is disabled by day. The
  // old disable list targeted buttons that do not exist ([data-water] etc.).

  const waterGoal = Number(store.settings.waterGoal) || 92;
  document.getElementById("water-goal-display").textContent = waterGoal;
  const waterOz = sumForDate(store.water, t, "oz");
  document.getElementById("water-today").textContent = waterOz;
  const waterPct = Math.round((waterOz / waterGoal) * 100);
  document.getElementById("water-progress").style.width = Math.min(100, waterPct) + "%";
  document.getElementById("water-progressbar").setAttribute("aria-valuenow", Math.min(100, waterPct));
  document.getElementById("water-percent").textContent = waterPct >= 100
    ? "Goal reached! Nice work."
    : waterPct + "% of daily goal";

  const proteinGoal = Number(store.settings.proteinGoal) || 90;
  document.getElementById("protein-goal-display").textContent = proteinGoal;
  const proteinG = sumForDate(store.protein, t, "grams");
  document.getElementById("protein-today").textContent = proteinG;
  const proteinPct = Math.round((proteinG / proteinGoal) * 100);
  document.getElementById("protein-progress").style.width = Math.min(100, proteinPct) + "%";
  document.getElementById("protein-progressbar").setAttribute("aria-valuenow", Math.min(100, proteinPct));
  document.getElementById("protein-percent").textContent = proteinPct >= 100
    ? "Goal reached! Nice work."
    : proteinPct + "% of daily goal";

  // Remaining protein for today
  const pRem = proteinGoal - proteinG;
  const el = document.getElementById("remaining-summary");
  if (el) {
    el.textContent = pRem <= 0
      ? "Protein goal reached for today. Nice work."
      : Math.round(pRem) + "g protein remaining today.";
  }

  const exMin = sumForDate(store.exercise, t, "minutes");
  document.getElementById("exercise-today").textContent = exMin;
  const moveGoal = Number(store.settings.movementGoal) || 30;
  document.getElementById("exercise-goal-display").textContent = moveGoal;
  const exPct = Math.round((exMin / moveGoal) * 100);
  document.getElementById("exercise-progress").style.width = Math.min(100, exPct) + "%";
  document.getElementById("exercise-progressbar").setAttribute("aria-valuenow", Math.min(100, exPct));
  document.getElementById("exercise-percent").textContent = exPct >= 100
    ? "Goal reached! Nice work."
    : exPct + "% of daily goal";

  // Summary cards (3 cards: protein, water, movement)
  document.getElementById("sum-protein-goal").textContent = proteinGoal;
  document.getElementById("sum-water-goal").textContent = waterGoal;
  document.getElementById("sum-move-goal").textContent = moveGoal;
  const sumData = [
    ["protein", proteinG, proteinGoal],
    ["water", waterOz, waterGoal],
    ["move", exMin, moveGoal]
  ];
  sumData.forEach(([key, val, goal]) => {
    document.getElementById("sum-" + key + "-num").textContent = val;
    const pct = Math.round((val / goal) * 100);
    document.getElementById("sum-" + key + "-bar").style.width = Math.min(100, pct) + "%";
  });

  renderEncouragement();
  renderRecentFoods();
  // F18: only cancel an in-progress food edit when its day is no longer the
  // day being viewed. A re-render must never wipe typing or an edit in progress.
  if (editingFoodId) {
    const editingFood = store.protein.find((x) => x.id === editingFoodId);
    if (!editingFood || editingFood.date !== t) cancelFoodEdit();
  }

  renderNextInjection();
  renderMood();
  renderTodayEntries(t);

  document.getElementById("undo-water").style.display = store.water.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-protein").style.display = store.protein.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-exercise").style.display = store.exercise.some((e) => e.date === t) ? "" : "none";

  renderBackupNudge();
  renderCorruptNotice();
  if (saveFailed) showStorageWarning("Your latest change could not be saved on this device. It may be out of space. Try downloading a backup from Settings, then deleting a few old photos.");
  renderCoachInsight();
  renderMonthlyReview();
  renderWeeklySummary();
}

/* Today's water, protein, and movement entries with per-entry remove */

function renderTodayEntries(t) {
  const waterToday = store.water.filter((e) => e.date === t);
  document.getElementById("water-list").innerHTML = waterToday.length
    ? waterToday.map((e) => `
      <div class="today-entry">
        <span>+${escapeHtml(e.oz)} oz</span>
        <button class="btn btn-small btn-danger" data-del-water="${e.id}" aria-label="Remove water entry: ${escapeHtml(e.oz)} ounces">Remove</button>
      </div>`).join("")
    : "";

  const proteinToday = store.protein.filter((e) => e.date === t);
  document.getElementById("protein-list").innerHTML = proteinToday.length
    ? proteinToday.map((e) => `
      <div class="today-entry">
        <span>${escapeHtml(e.food || "Logged entry")} &middot; ${escapeHtml(e.grams)} g</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-small" data-edit-food="${e.id}" aria-label="Edit food entry: ${escapeHtml(e.food || "Logged entry")} ${escapeHtml(e.grams)} grams">Edit</button>
          <button class="btn btn-small btn-danger" data-del-protein="${e.id}" aria-label="Remove food entry: ${escapeHtml(e.food || "Logged entry")} ${escapeHtml(e.grams)} grams">Remove</button>
        </div>
      </div>`).join("")
    : "";

  const exToday = store.exercise.filter((e) => e.date === t);
  document.getElementById("exercise-list").innerHTML = exToday.length
    ? exToday.map((e) => `
      <div class="today-entry">
        <span>${escapeHtml(e.label || "Movement")} &middot; ${escapeHtml(e.minutes)} min</span>
        <button class="btn btn-small btn-danger" data-del-exercise="${e.id}" aria-label="Remove movement entry: ${escapeHtml(e.label || "Movement")} ${escapeHtml(e.minutes)} minutes">Remove</button>
      </div>`).join("")
    : "";

  bindTodayEntryDeletes();
}

function bindTodayEntryDeletes() {
  document.querySelectorAll("[data-edit-food]").forEach((b) => b.addEventListener("click", () => startFoodEdit(b.dataset.editFood)));
  document.querySelectorAll("[data-del-water]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Remove this water entry?")) return;
    store.water = store.water.filter((e) => e.id !== b.dataset.delWater);
    saveStore();
    renderToday();
  }));
  document.querySelectorAll("[data-del-protein]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Remove this food entry?")) return;
    store.protein = store.protein.filter((e) => e.id !== b.dataset.delProtein);
    saveStore();
    renderToday();
  }));
  document.querySelectorAll("[data-del-exercise]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Remove this movement entry?")) return;
    store.exercise = store.exercise.filter((e) => e.id !== b.dataset.delExercise);
    saveStore();
    renderToday();
  }));
}

function undoLastEntry(key) {
  const t = viewedDateStr();
  for (let i = store[key].length - 1; i >= 0; i--) {
    if (store[key][i].date === t) {
      store[key].splice(i, 1);
      break;
    }
  }
  saveStore();
  renderToday();
}

document.getElementById("undo-water").addEventListener("click", () => undoLastEntry("water"));
document.getElementById("undo-protein").addEventListener("click", () => undoLastEntry("protein"));
document.getElementById("undo-exercise").addEventListener("click", () => undoLastEntry("exercise"));

/* ---------- Steppers ---------- */
/* Steppers log to the day being viewed (F13). A minus tap trims that day's
   most recent entries instead of pushing a negative entry, so totals can
   never go below zero (F15). A typed amount above 500 is kept to 500 (F19). */
let stepperWasClamped = false;
function getStep(id, fallback) {
  const el = document.getElementById(id);
  const v = Number(el.value);
  const base = v > 0 ? v : fallback;
  if (base > 500) { stepperWasClamped = true; return 500; }
  stepperWasClamped = false;
  return base;
}
function showStepperNote() {
  const n = document.getElementById("stepper-note");
  if (!n) return;
  if (stepperWasClamped) {
    n.textContent = "That was a very large amount, so it was kept to 500.";
    n.classList.remove("hidden");
  } else {
    n.classList.add("hidden");
  }
}
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
function stepperAdd(key, field, date, amount, extra) {
  store[key].push(Object.assign({ id: uid(), date }, extra, { [field]: amount }));
  showStepperNote();
  saveStore(); renderToday();
}
function stepperMinus(key, field, date, amount) {
  trimDayEntries(key, field, date, amount);
  showStepperNote();
  saveStore(); renderToday();
}
document.getElementById("water-plus").addEventListener("click", () => {
  stepperAdd("water", "oz", viewedDateStr(), getStep("water-step", 8), {});
});
document.getElementById("water-minus").addEventListener("click", () => {
  stepperMinus("water", "oz", viewedDateStr(), getStep("water-step", 8));
});
document.getElementById("protein-plus").addEventListener("click", () => {
  stepperAdd("protein", "grams", viewedDateStr(), getStep("protein-step", 15), { food: "Quick add" });
});
document.getElementById("protein-minus").addEventListener("click", () => {
  stepperMinus("protein", "grams", viewedDateStr(), getStep("protein-step", 15));
});
document.getElementById("exercise-plus").addEventListener("click", () => {
  stepperAdd("exercise", "minutes", viewedDateStr(), getStep("exercise-step", 15), { label: "Movement" });
});
document.getElementById("exercise-minus").addEventListener("click", () => {
  stepperMinus("exercise", "minutes", viewedDateStr(), getStep("exercise-step", 15));
});

document.getElementById("protein-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const food = document.getElementById("protein-food").value.trim();
  const grams = Number(document.getElementById("protein-grams").value);
  const proteinMsg = document.getElementById("protein-msg");
  if (!grams || grams <= 0) {
    setFormStatus(proteinMsg, "Add the grams of protein first.", true);
    document.getElementById("protein-grams").focus();
    return;
  }
  const existing = editingFoodId ? store.protein.find((x) => x.id === editingFoodId) : null;
  const data = {
    id: editingFoodId || uid(),
    date: existing ? existing.date : viewedDateStr(),
    grams,
    food: food || "Logged entry"
  };
  if (editingFoodId) {
    if (!existing) {
      setFormStatus(proteinMsg, "That entry could not be found. It may already have been removed.", true);
      return;
    }
    store.protein[store.protein.findIndex((x) => x.id === editingFoodId)] = data;
  } else {
    store.protein.push(data);
  }
  setFormStatus(proteinMsg, "", false);
  cancelFoodEdit();
  saveStore();
  renderToday();
});

document.getElementById("food-edit-cancel").addEventListener("click", cancelFoodEdit);

document.getElementById("exercise-type").addEventListener("change", (e) => {
  document.getElementById("exercise-custom").classList.toggle("hidden", e.target.value !== "Other");
});

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
function saveCustomActivity(name) {
  const list = getCustomActivities();
  if (!list.includes(name)) {
    list.push(name);
    try { localStorage.setItem("nc_custom_activities", JSON.stringify(list)); } catch {}
    const sel = document.getElementById("exercise-type");
    const opt = document.createElement("option");
    opt.textContent = name;
    sel.insertBefore(opt, sel.querySelector('option[value=""]') || sel.lastChild);
  }
}
function loadCustomActivities() {
  const sel = document.getElementById("exercise-type");
  getCustomActivities().forEach((name) => {
    if (![...sel.options].some((o) => o.text === name)) {
      const opt = document.createElement("option");
      opt.textContent = name;
      sel.insertBefore(opt, sel.lastChild);
    }
  });
}

document.getElementById("exercise-add").addEventListener("click", () => {
  let type = document.getElementById("exercise-type").value;
  const mins = Number(document.getElementById("exercise-minutes").value);
  const exMsg = document.getElementById("exercise-msg");
  if (type === "Other") {
    type = document.getElementById("exercise-custom").value.trim();
    if (!type) {
      setFormStatus(exMsg, "Add your activity name first.", true);
      document.getElementById("exercise-custom").focus();
      return;
    }
    saveCustomActivity(type);
  }
  if (!type || !mins || mins < 1) {
    setFormStatus(exMsg, "Choose an activity and add the minutes first.", true);
    return;
  }
  setFormStatus(exMsg, "", false);
  store.exercise.push({ id: uid(), date: viewedDateStr(), minutes: mins, label: type });
  saveStore();
  renderToday();
  document.getElementById("exercise-type").value = "";
  document.getElementById("exercise-minutes").value = "";
  document.getElementById("exercise-custom").value = "";
  document.getElementById("exercise-custom").classList.add("hidden");
});

/* Next injection countdown */

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
  const lastSite = last ? " Last site: " + last.site + "." : "";
  const when = diff === 0 ? "Today is your shot day." : diff === 1 ? "Your next shot is tomorrow." : "Your next shot is in " + diff + " days (" + shotDay + ").";
  el.textContent = when + " " + med + (dose ? " " + dose + "." : ".") + lastSite;

  // One-tap shot logging uses the usual medication, dose, and last site
  const quickBtn = document.getElementById("quick-log-shot");
  const alreadyLogged = store.injections.some((e) => e.date === todayStr() && (e.status || "On time") !== "Missed");
  quickBtn.style.display = alreadyLogged ? "none" : "";
  if (!alreadyLogged && last && last.site) {
    quickBtn.textContent = "Log today's shot (" + med + (dose ? " " + dose : "") + ", " + last.site + ")";
  } else {
    quickBtn.textContent = "Log today's shot";
  }
}

document.getElementById("quick-log-shot").addEventListener("click", () => {
  const t = todayStr();
  if (store.injections.some((e) => e.date === t && (e.status || "On time") !== "Missed")) return;
  const last = lastInjection();
  if (!last || !last.site) {
    alert("Log your first shot in the Injections tab so I know your usual site. After that, one tap does it.");
    showTab("injections");
    return;
  }
  store.injections.push({
    id: uid(),
    date: t,
    medication: store.settings.medication || last.medication || "Zepbound",
    dose: Number(store.settings.dose) || Number(last.dose) || 0,
    site: last.site,
    status: "On time",
    notes: ""
  });
  saveStore();
  renderInjections();
  renderInjectionCalendar();
  renderToday();
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
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const target = days.indexOf(shotDay);
  if (target < 0) return null;
  const now = new Date();
  const diff = (target - now.getDay() + 7) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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
  let html = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) html += `<div class="day other-month"></div>`;
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
    html += `<div class="${cls.join(" ")}" role="gridcell" data-cal-date="${ds}" tabindex="0" aria-label="${label}">${d}</div>`;
  }
  cal.innerHTML = html;

  cal.querySelectorAll("[data-cal-date]").forEach((el) => {
    const show = () => {
      const list = loggedByDate[el.dataset.calDate] || [];
      document.getElementById("inj-cal-detail").textContent =
        list.length
          ? formatDate(el.dataset.calDate) + ": " +
            list.map((j) => j.medication + " " + j.dose + " mg (" + j.site + ", " + (j.status || "On time") + ")").join("; ")
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

function renderInjections() {
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
      <p class="entry-title">${escapeHtml(inj.medication)} ${escapeHtml(inj.dose)} mg</p>
      <p class="entry-sub">${escapeHtml(formatDate(inj.date))} &middot; ${escapeHtml(inj.site)} &middot; ${escapeHtml(status)}</p>
      ${inj.notes ? `<p class="entry-notes">${escapeHtml(inj.notes)}</p>` : ""}
      ${missedOrDelayed ? `<p class="entry-notes">Always consult your healthcare provider about your medication, dosing, and health decisions. Never change your dose based on this app.</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-inj="${inj.id}" aria-label="Edit injection: ${escapeHtml(inj.medication)} ${escapeHtml(inj.dose)} mg on ${escapeHtml(formatDate(inj.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-inj="${inj.id}" aria-label="Delete injection: ${escapeHtml(inj.medication)} ${escapeHtml(inj.dose)} mg on ${escapeHtml(formatDate(inj.date))}">Delete</button>
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
  saveStore();
  renderWeight();
  toggleForm(weightForm, document.getElementById("show-weight-form"), false);
  setFormStatus(document.getElementById("weight-saved-msg"), "Weigh-in saved.", false);
});

let weightLimit = 10; // entries shown; "show more" loads older ones in batches

function renderWeight() {
  const sorted = [...store.weight].sort(byDate);
  const noteEl = document.getElementById("weight-change-note");
  if (sorted.length) {
    const current = sorted[sorted.length - 1].value;
    const first = sorted[0];
    document.getElementById("current-weight").textContent = Number(current).toFixed(1);
    /* Starting weight is the first weigh-in, with its date. It is never
       overwritten: it is read from the log, not stored separately. */
    document.getElementById("starting-weight").textContent = Number(first.value).toFixed(1);
    document.getElementById("starting-weight-date").textContent = formatDate(first.date);
  } else {
    document.getElementById("current-weight").textContent = "--";
    document.getElementById("starting-weight").textContent = "--";
    document.getElementById("starting-weight-date").textContent = "";
  }
  if (sorted.length >= 2) {
    /* Total and percent show only with at least two weigh-ins. A gain is
       shown honestly as a gain, never as a negative loss. */
    const start = Number(sorted[0].value);
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
  drawWeightChart();
}

function renderWeightMilestone() {
  const card = document.getElementById("milestone-card");
  const goalW = Number(store.settings.goalWeight) || 0;
  const sorted = [...store.weight].sort(byDate);
  if (!(goalW > 0) || !sorted.length) { card.classList.add("hidden"); return; }
  const startW = Number(sorted[0].value);
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
    textEl.textContent = milestone > 0
      ? "You've reached the " + milestone + "% milestone. Beautiful work."
      : "You're on your way. Every day counts.";
    subEl.textContent = pctRound + "% of the way from " + startW + " to your goal of " + goalW
      + " lbs (" + Math.abs(curW - goalW).toFixed(1) + " lbs to go).";
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
    const firstW = sorted[0], lastW = sorted[sorted.length - 1];
    const diff = Number(firstW.value) - Number(lastW.value);
    const dir = diff > 0 ? "down " + diff.toFixed(1) + " lbs" : diff < 0 ? "up " + Math.abs(diff).toFixed(1) + " lbs" : "unchanged";
    chartText.textContent = "Weight from " + Number(firstW.value).toFixed(1) + " lbs on " + formatDate(firstW.date) + " to " + Number(lastW.value).toFixed(1) + " lbs on " + formatDate(lastW.date) + ", " + dir + " over " + sorted.length + " weigh-ins." + (goalW > 0 ? " Goal: " + goalW + " lbs." : "");
  }

  renderWeightMilestone();
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
  list.innerHTML = visible.map((j) => `
    <div class="entry">
      <p class="entry-title">${MOOD_EMOJI[j.mood] || ""} ${escapeHtml(j.mood)}</p>
      <p class="entry-sub">${escapeHtml(formatDate(j.date))}</p>
      ${j.notes ? `<p class="entry-notes">${escapeHtml(j.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-j="${j.id}" aria-label="Edit journal entry: ${escapeHtml(j.mood)} on ${escapeHtml(formatDate(j.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-j="${j.id}" aria-label="Delete journal entry: ${escapeHtml(j.mood)} on ${escapeHtml(formatDate(j.date))}">Delete</button>
      </div>
    </div>`).join("")
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

function renderSideEffects() {
  const list = document.getElementById("sideeffect-list");
  const sorted = [...store.sideEffects].sort(byDateDesc);
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No side effects logged yet. Tap "Log effect" above to record how you are feeling today.</p>';
    return;
  }
  const visibleSe = sorted.slice(0, seLimit);
  const remainingSe = sorted.length - visibleSe.length;
  const badgeClass = { Mild: "badge-mild", Moderate: "badge-moderate", Severe: "badge-severe" };
  list.innerHTML = visibleSe.map((s) => `
    <div class="entry">
      <p class="entry-title">${escapeHtml(s.symptom)}<span class="badge ${badgeClass[s.severity] || ""}">${escapeHtml(s.severity)}</span></p>
      <p class="entry-sub">${escapeHtml(formatDate(s.date))}</p>
      ${s.notes ? `<p class="entry-notes">${escapeHtml(s.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-se="${s.id}" aria-label="Edit side effect: ${escapeHtml(s.symptom)} on ${escapeHtml(formatDate(s.date))}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-se="${s.id}" aria-label="Delete side effect: ${escapeHtml(s.symptom)} on ${escapeHtml(formatDate(s.date))}">Delete</button>
      </div>
    </div>`).join("")
    + (remainingSe > 0
      ? `<button class="btn" id="more-se" style="width:100%;margin-top:8px">Show older (${remainingSe} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-se]").forEach((b) => b.addEventListener("click", () => {
    const s = store.sideEffects.find((x) => x.id === b.dataset.editSe);
    if (!s) {
      setFormStatus(document.getElementById("se-saved-msg"), "That entry could not be found. It may already have been removed.", true);
      return;
    }
    editingSeId = s.id;
    seForm.querySelector("h3").textContent = "Edit Side Effect";
    document.getElementById("se-date").value = s.date;
    document.getElementById("se-symptom").value = s.symptom;
    document.getElementById("se-severity").value = s.severity;
    document.getElementById("se-notes").value = s.notes || "";
    toggleForm(seForm, document.getElementById("show-sideeffect-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-se]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this side effect entry?")) return;
    store.sideEffects = store.sideEffects.filter((x) => x.id !== b.dataset.delSe);
    saveStore();
    seLimit = 10;
    renderSideEffects();
  }));

  const moreSeBtn = document.getElementById("more-se");
  if (moreSeBtn) moreSeBtn.addEventListener("click", () => {
    seLimit += 10;
    renderSideEffects();
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
  renderPlaySubscription();
  document.getElementById("set-med").value = s.medication || "";
  document.getElementById("set-dose").value = s.dose || "";
  document.getElementById("set-shot-day").value = s.shotDay || "";
  document.getElementById("set-water-goal").value = s.waterGoal || 92;
  document.getElementById("set-protein-goal").value = s.proteinGoal || 90;
  document.getElementById("set-movement-goal").value = s.movementGoal || 30;
  document.getElementById("set-goal-weight").value = s.goalWeight || "";
  document.getElementById("set-refill-date").value = s.refillDate || "";
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
  const pg = Number(document.getElementById("set-protein-goal").value);
  store.settings.proteinGoal = pg > 0 ? pg : 90;
  const mg = Number(document.getElementById("set-movement-goal").value);
  store.settings.movementGoal = mg > 0 ? mg : 30;
  const gw = Number(document.getElementById("set-goal-weight").value);
  store.settings.goalWeight = gw > 0 ? gw : "";
  store.settings.refillDate = document.getElementById("set-refill-date").value;
  saveStore();
  renderSettings();
  renderToday();
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
    ["Date", "Food", "Grams"],
    [...store.protein].sort(byDate).map((e) => [e.date, e.food, e.grams])
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



function countStoreEntries(s) {
  if (!s) return 0;
  const keys = ["water", "protein", "exercise", "injections", "weight", "measurements", "photos", "journal", "sideEffects"];
  let total = 0;
  keys.forEach((k) => { if (Array.isArray(s[k])) total += s[k].length; });
  if (s.moods) total += Object.keys(s.moods).length;
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
      "You are viewing the tracker in the browser. Your entries are kept in the home-screen app, not here. Open the tracker from its home-screen app icon to see your entries. If you have not added it to your home screen yet, use Share, then Add to Home Screen.";
    // v156: the browser case gets a link to the help video; the
    // standalone case does not, since that user is already in the app.
    document.getElementById("empty-notice-video").classList.remove("hidden");
    card.classList.remove("hidden");
    return;
  }
  if (!hasUsedAppBefore()) { card.classList.add("hidden"); return; }
  document.getElementById("empty-notice-text").textContent =
    "Your entries are not showing. Your entries are stored only in this app on this phone. If you opened the tracker in Safari, from a link, or from a new app icon, that is a separate empty copy. Close this and open the tracker from its home-screen app icon. If you have a backup file, restore it in Settings, then Backup and restore.";
  document.getElementById("empty-notice-video").classList.add("hidden");
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
  box.innerHTML = '<p class="muted" style="margin:0 0 4px">Recent backups saved in this app:</p>' + snaps.map((sn, i) => {
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
  }).join("");
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
  if (!store.settings.proteinGoal) store.settings.proteinGoal = 90;
  // Only save when there is actually something to save. Saving an empty
  // store here would write over a missing save with blank defaults (S2).
  try {
    if (JSON.stringify(store) !== JSON.stringify(DEFAULTS)) saveStore();
  } catch {}
  localStorage.setItem("nct-setup-done", "1");
})();

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
  const card = document.getElementById("version-notice");
  const text = document.getElementById("version-notice-text");
  if (card && text) {
    text.textContent = "Updated to " + APP_VERSION + ".";
    card.classList.remove("hidden");
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

maybeRestoreFromSnapshot();
if (ensureEntryIds()) saveStore(); // persist ids given to old entries (F27)
loadCustomActivities();
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

function renderChat() {
  const box = document.getElementById("chat-messages");
  if (!box) return;
  box.innerHTML = "";
  if (chatHistory.length === 0) {
    const welcome = document.createElement("div");
    welcome.className = "chat-msg assistant";
    welcome.textContent = "Hi, I am your AI Wellness Companion. Ask me about protein, water, or movement, or tell me how your day is going.";
    box.appendChild(welcome);
    return;
  }
  chatHistory.forEach((m) => {
    const div = document.createElement("div");
    div.className = "chat-msg " + (m.role === "user" ? "user" : "assistant");
    if (m.role === "assistant") {
      div.innerHTML = renderMarkdown(m.content);
    } else {
      div.textContent = m.content;
    }
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

function addTypingIndicator() {
  const box = document.getElementById("chat-messages");
  if (!box) return null;
  const div = document.createElement("div");
  div.className = "chat-msg assistant typing";
  div.id = "chat-typing";
  div.textContent = "Thinking...";
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

document.getElementById("chat-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) {
    setFormStatus(document.getElementById("chat-msg"), "Type a message before sending.", true);
    input.focus();
    return;
  }
  setFormStatus(document.getElementById("chat-msg"), "", false);
  input.value = "";

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
      body: JSON.stringify({ messages: chatHistory }),
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
          content: "Your AI Wellness Companion needs your personal app link to work. Please open the link from your welcome email.",
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
  sendBtn.disabled = false;
});

// Render chat when tab is opened
document.querySelector('[data-tab="chat"]').addEventListener("click", renderChat);
