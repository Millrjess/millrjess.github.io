/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 */

/* A New Chapter Tracker - app logic. Data persists in localStorage on this device only. */

"use strict";

const LS_KEY = "newChapterTracker.v1";

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
    waterGoal: 80,
    proteinGoal: 90,
    movementGoal: 30,
    carbGoal: 130,
    fatGoal: 65,
    calorieGoal: 1600,
    refillDate: "",
    goalWeight: ""
  },
  water: [],        // { id, date: "YYYY-MM-DD", oz: number }
  protein: [],      // { id, date, grams, food }
  exercise: [],     // { id, date, minutes, label }
  injections: [],   // { id, date, medication, dose, site, notes }
  weight: [],       // { id, date, value }
  measurements: [], // { id, date, waist, hips, chest, arm, thigh, neck }
  photos: [],       // { id, date, dataUrl }
  journal: [],      // { id, date, mood, notes }
  sideEffects: [],  // { id, date, symptom, severity, notes }
  moods: {}         // { "YYYY-MM-DD": "Good" }
};

let store = loadStore();
ensureEntryIds();

/* Older entries saved before per-entry delete existed may lack ids. Give them one. */
function ensureEntryIds() {
  ["water", "protein", "exercise"].forEach((key) => {
    if (!Array.isArray(store[key])) return;
    store[key].forEach((e) => {
      if (!e.id) e.id = uid();
    });
  });
}

function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    return Object.assign(structuredClone(DEFAULTS), parsed);
  } catch (e) {
    return structuredClone(DEFAULTS);
  }
}

function saveStore() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    /* storage full or unavailable; app keeps working in memory */
  }
}

function uid() {
  return "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
  if (!iso) return "";
  const parts = iso.split("-");
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Daily encouragement: rotate through supportive messages by day of year */

const ENCOURAGEMENTS = [
  "Every small step counts. You are doing great.",
  "Progress is not always visible, but it is always happening.",
  "You showed up today. That matters.",
  "Consistency beats perfection. Keep going.",
  "Your future self will thank you for today.",
  "Be patient with your body. It is working hard for you.",
  "Small habits, repeated daily, create lasting change."
];

function renderEncouragement() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  document.getElementById("encouragement-text").textContent =
    ENCOURAGEMENTS[dayOfYear % ENCOURAGEMENTS.length];
}

/* Recent foods quick-pick: the 5 most recently logged foods as tap-to-add buttons */

function renderRecentFoods(isToday) {
  const box = document.getElementById("recent-foods");
  if (!box) return;
  if (!isToday) {
    box.innerHTML = "";
    return;
  }
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
      date: todayStr(),
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
  try {
    gtag("event", "page_view", {
      page_title: "Tracker - " + name,
      page_location: location.href.split("#")[0] + "#" + name,
      page_path: "/tracker-app/#" + name
    });
  } catch (e) { /* analytics unavailable; app keeps working */ }
}

tabButtons.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", () => showTab(el.dataset.goto));
});

/* ---------- Today tab ---------- */

function sumForDate(list, dateStr, field) {
  return list.filter((e) => e.date === dateStr).reduce((t, e) => t + (Number(e[field]) || 0), 0);
}

let viewOffset = 0; // 0 = today, -1 = yesterday, etc.

function renderToday() {
  const t = todayStr(viewOffset);
  const dateEl = document.getElementById("today-date");
  const viewDate = new Date();
  viewDate.setDate(viewDate.getDate() + viewOffset);
  const label = viewOffset === 0 ? "Today" : viewOffset === -1 ? "Yesterday"
    : viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("today-heading").textContent = label;
  dateEl.textContent = viewOffset === 0
    ? viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : viewOffset === -1
    ? viewDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "";

  // Show/hide nav arrows
  document.getElementById("day-prev").style.visibility = "";
  document.getElementById("day-next").style.visibility = viewOffset >= 0 ? "hidden" : "";

  // Disable quick-add buttons when viewing a past day
  const isToday = viewOffset === 0;
  document.querySelectorAll("[data-water],[data-protein],[data-exercise]").forEach((b) => {
    b.disabled = !isToday;
    b.style.opacity = isToday ? "" : "0.5";
  });
  // Disable manual entry forms and mood buttons on past days
  ["protein-food", "protein-grams", "carb-grams", "fat-grams", "calorie-count", "protein-add", "exercise-type", "exercise-minutes", "exercise-add", "exercise-custom", "photo-btn"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) { el.disabled = !isToday; el.style.opacity = isToday ? "" : "0.5"; }
  });
  document.querySelectorAll(".mood-btn").forEach((b) => {
    b.disabled = !isToday;
    b.style.opacity = isToday ? "" : "0.5";
  });

  const waterGoal = Number(store.settings.waterGoal) || 80;
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

  // Summary cards (3 cards: protein, water, movement)
  const moveGoal = Number(store.settings.movementGoal) || 30;
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
  renderRecentFoods(isToday);
  cancelFoodEdit();

  renderNextInjection();
  renderMood();
  renderTodayEntries(t, isToday);

  document.getElementById("undo-water").style.display = store.water.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-protein").style.display = store.protein.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-exercise").style.display = store.exercise.some((e) => e.date === t) ? "" : "none";

  renderBackupNudge();
}

/* Today's water, protein, and movement entries with per-entry remove */

function renderTodayEntries(t, isToday) {
  const waterToday = store.water.filter((e) => e.date === t);
  document.getElementById("water-list").innerHTML = waterToday.length
    ? waterToday.map((e) => `
      <div class="today-entry">
        <span>+${escapeHtml(e.oz)} oz</span>
        <button class="btn btn-small btn-danger" data-del-water="${e.id}">Remove</button>
      </div>`).join("")
    : "";

  const proteinToday = store.protein.filter((e) => e.date === t);
  document.getElementById("protein-list").innerHTML = proteinToday.length
    ? proteinToday.map((e) => `
      <div class="today-entry">
        <span>${escapeHtml(e.food || "Logged entry")} &middot; ${escapeHtml(e.grams)} g</span>
        <div style="display:flex;gap:6px;flex-shrink:0">
          ${isToday ? `<button class="btn btn-small" data-edit-food="${e.id}">Edit</button>` : ""}
          <button class="btn btn-small btn-danger" data-del-protein="${e.id}">Remove</button>
        </div>
      </div>`).join("")
    : "";

  const exToday = store.exercise.filter((e) => e.date === t);
  document.getElementById("exercise-list").innerHTML = exToday.length
    ? exToday.map((e) => `
      <div class="today-entry">
        <span>${escapeHtml(e.label || "Exercise")} &middot; ${escapeHtml(e.minutes)} min</span>
        <button class="btn btn-small btn-danger" data-del-exercise="${e.id}">Remove</button>
      </div>`).join("")
    : "";

  bindTodayEntryDeletes();
}

function bindTodayEntryDeletes() {
  document.querySelectorAll("[data-edit-food]").forEach((b) => b.addEventListener("click", () => startFoodEdit(b.dataset.editFood)));
  document.querySelectorAll("[data-del-water]").forEach((b) => b.addEventListener("click", () => {
    store.water = store.water.filter((e) => e.id !== b.dataset.delWater);
    saveStore();
    renderToday();
  }));
  document.querySelectorAll("[data-del-protein]").forEach((b) => b.addEventListener("click", () => {
    store.protein = store.protein.filter((e) => e.id !== b.dataset.delProtein);
    saveStore();
    renderToday();
  }));
  document.querySelectorAll("[data-del-exercise]").forEach((b) => b.addEventListener("click", () => {
    store.exercise = store.exercise.filter((e) => e.id !== b.dataset.delExercise);
    saveStore();
    renderToday();
  }));
}

function undoLastEntry(key) {
  const t = todayStr();
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

document.querySelectorAll("[data-water]").forEach((btn) => {
  btn.addEventListener("click", () => {
    store.water.push({ id: uid(), date: todayStr(), oz: Number(btn.dataset.water) });
    saveStore();
    renderToday();
  });
});

document.querySelectorAll("[data-protein]").forEach((btn) => {
  btn.addEventListener("click", () => {
    store.protein.push({ id: uid(), date: todayStr(), grams: Number(btn.dataset.protein), food: "Quick add" });
    saveStore();
    renderToday();
  });
});

document.getElementById("protein-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const food = document.getElementById("protein-food").value.trim();
  const grams = Number(document.getElementById("protein-grams").value);
  if (!grams || grams <= 0) {
    document.getElementById("protein-grams").focus();
    document.getElementById("protein-grams").placeholder = "Enter grams first";
    return;
  }
  const data = {
    id: editingFoodId || uid(),
    date: todayStr(),
    grams,
    food: food || "Logged entry"
  };
  if (editingFoodId) {
    const i = store.protein.findIndex((x) => x.id === editingFoodId);
    if (i > -1) store.protein[i] = data;
  } else {
    store.protein.push(data);
  }
  cancelFoodEdit();
  saveStore();
  renderToday();
});

document.getElementById("food-edit-cancel").addEventListener("click", cancelFoodEdit);

document.querySelectorAll("[data-exercise]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const labels = { 15: "Walk", 10: "Stretch", 30: "Exercise" };
    const mins = Number(btn.dataset.exercise);
    store.exercise.push({ id: uid(), date: todayStr(), minutes: mins, label: labels[mins] || "Exercise" });
    saveStore();
    renderToday();
  });
});

document.getElementById("exercise-add").addEventListener("click", () => {
  const type = document.getElementById("exercise-type").value;
  const mins = Number(document.getElementById("exercise-minutes").value);
  if (!type || !mins || mins < 1) return;
  store.exercise.push({ id: uid(), date: todayStr(), minutes: mins, label: type });
  saveStore();
  renderToday();
  document.getElementById("exercise-type").value = "";
  document.getElementById("exercise-minutes").value = "";
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
  const last = [...store.injections].sort((a, b) => b.date.localeCompare(a.date))[0];
  const lastSite = last ? " Last site: " + last.site + "." : "";
  const when = diff === 0 ? "Today is your shot day." : diff === 1 ? "Your next shot is tomorrow." : "Your next shot is in " + diff + " days (" + shotDay + ").";
  el.textContent = when + " " + med + (dose ? " " + dose + "." : ".") + lastSite;
}

/* Daily mood */

function renderMood() {
  const t = todayStr();
  const current = store.moods[t];
  document.querySelectorAll(".mood-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.mood === current);
  });
  document.getElementById("mood-today-label").textContent = current
    ? "Today you are feeling: " + current + "."
    : "No mood logged today yet.";
}

document.querySelectorAll(".mood-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    store.moods[todayStr()] = btn.dataset.mood;
    saveStore();
    renderMood();
  });
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
  const fmt = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "T" + p(d.getHours()) + p(d.getMinutes()) + "00";
  };
  const med = store.settings.medication || "GLP-1";
  const dose = store.settings.dose ? " " + store.settings.dose + " mg" : "";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//A New Chapter Tracker//EN",
    "BEGIN:VEVENT",
    "UID:shot-reminder-" + Date.now() + "@newchapter",
    "DTSTAMP:" + fmt(new Date()),
    "DTSTART:" + fmt(next),
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:" + med + dose + " shot day",
    "DESCRIPTION:Time for your weekly injection. Log it in A New Chapter Tracker.",
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
  toggleForm(injForm, document.getElementById("show-injection-form"), true);
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
    notes: document.getElementById("inj-notes").value.trim()
  };
  if (!entry.date || !entry.medication || !entry.site) return;
  if (editingInjectionId) {
    const i = store.injections.findIndex((x) => x.id === editingInjectionId);
    if (i > -1) store.injections[i] = entry;
  } else {
    store.injections.push(entry);
  }
  editingInjectionId = null;
  saveStore();
  injectionLimit = 10;
  renderInjections();
  renderToday();
  toggleForm(injForm, document.getElementById("show-injection-form"), false);
});

let injectionLimit = 10; // entries shown; "show more" loads older ones in batches

function renderInjections() {
  const list = document.getElementById("injection-list");
  const sorted = [...store.injections].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No injections logged yet. Tap "Log shot" to add your first.</p>';
    return;
  }
  const visible = sorted.slice(0, injectionLimit);
  const remaining = sorted.length - visible.length;
  list.innerHTML = visible.map((inj) => `
    <div class="entry">
      <p class="entry-title">${escapeHtml(inj.medication)} ${escapeHtml(inj.dose)} mg</p>
      <p class="entry-sub">${escapeHtml(formatDate(inj.date))} &middot; ${escapeHtml(inj.site)}</p>
      ${inj.notes ? `<p class="entry-notes">${escapeHtml(inj.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-inj="${inj.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-inj="${inj.id}">Delete</button>
      </div>
    </div>`).join("")
    + (remaining > 0
      ? `<button class="btn" id="more-injections" style="width:100%;margin-top:8px">Show older (${remaining} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-inj]").forEach((b) => b.addEventListener("click", () => {
    const inj = store.injections.find((x) => x.id === b.dataset.editInj);
    if (!inj) return;
    editingInjectionId = inj.id;
    injForm.querySelector("h3").textContent = "Edit Injection";
    document.getElementById("inj-date").value = inj.date;
    document.getElementById("inj-med").value = inj.medication;
    document.getElementById("inj-dose").value = inj.dose;
    document.getElementById("inj-site").value = inj.site;
    document.getElementById("inj-notes").value = inj.notes || "";
    toggleForm(injForm, document.getElementById("show-injection-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-inj]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this injection entry?")) return;
    store.injections = store.injections.filter((x) => x.id !== b.dataset.delInj);
    saveStore();
    injectionLimit = 10;
    renderInjections();
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
  weightForm.querySelector("h3").textContent = "Log Weigh-in";
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
  if (!entry.date || !entry.value || entry.value <= 0) return;
  if (editingWeightId) {
    const i = store.weight.findIndex((x) => x.id === editingWeightId);
    if (i > -1) store.weight[i] = entry;
  } else {
    store.weight.push(entry);
  }
  editingWeightId = null;
  saveStore();
  renderWeight();
  toggleForm(weightForm, document.getElementById("show-weight-form"), false);
});

function renderWeight() {
  const sorted = [...store.weight].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length) {
    const current = sorted[sorted.length - 1].value;
    const first = sorted[0].value;
    document.getElementById("current-weight").textContent = current.toFixed(1);
    const lost = first - current;
    document.getElementById("total-lost").textContent = (lost >= 0 ? "-" : "+") + Math.abs(lost).toFixed(1);
  } else {
    document.getElementById("current-weight").textContent = "--";
    document.getElementById("total-lost").textContent = "--";
  }

  const list = document.getElementById("weight-list");
  const desc = [...sorted].reverse();
  list.innerHTML = desc.length
    ? desc.map((w) => `
      <div class="entry">
        <p class="entry-title">${escapeHtml(Number(w.value).toFixed(1))} lbs</p>
        <p class="entry-sub">${escapeHtml(formatDate(w.date))}</p>
        <div class="entry-actions">
          <button class="btn btn-small" data-edit-w="${w.id}">Edit</button>
          <button class="btn btn-small btn-danger" data-del-w="${w.id}">Delete</button>
        </div>
      </div>`).join("")
    : '<p class="empty-state">No weigh-ins yet. Tap "Log weigh-in" to add your first.</p>';

  list.querySelectorAll("[data-edit-w]").forEach((b) => b.addEventListener("click", () => {
    const w = store.weight.find((x) => x.id === b.dataset.editW);
    if (!w) return;
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
    renderWeight();
  }));

  drawWeightChart();
}

function renderWeightMilestone() {
  const card = document.getElementById("milestone-card");
  const goalW = Number(store.settings.goalWeight) || 0;
  const sorted = [...store.weight].sort((a, b) => a.date.localeCompare(b.date));
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
  const sorted = [...store.weight].sort((a, b) => a.date.localeCompare(b.date));
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (sorted.length < 2) {
    emptyMsg.style.display = "";
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
  ctx.fillStyle = "#8A8A8A";
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
      ctx.fillText(formatDate(w.date).replace(", 2026", "").replace(", 2027", ""), 
        i === sorted.length - 1 ? W - 4 : i === 0 ? 4 : lx, H - 12);
      ctx.textAlign = "center";
    }
  });

  const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
  grad.addColorStop(0, "rgba(201,169,106,0.35)");
  grad.addColorStop(1, "rgba(201,169,106,0.02)");
  ctx.beginPath();
  sorted.forEach((w, i) => (i === 0 ? ctx.moveTo(x(i), y(w.value)) : ctx.lineTo(x(i), y(w.value))));
  ctx.strokeStyle = "#C9A96A";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.lineTo(x(sorted.length - 1), H - padB);
  ctx.lineTo(x(0), H - padB);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = "#C9A96A";
  sorted.forEach((w, i) => {
    ctx.beginPath();
    ctx.arc(x(i), y(w.value), 7, 0, Math.PI * 2);
    ctx.fill();
  });

  // Goal line
  if (goalW > 0) {
    const gy = y(goalW);
    ctx.save();
    ctx.strokeStyle = "#7A8B6F";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(W - padR, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7A8B6F";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "left";
    const labelY = gy - 34 < padT ? gy + 28 : gy - 12;
    ctx.fillText("Goal " + goalW, padL + 8, labelY);
    ctx.restore();
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
  if (!entry.date) return;
  if (!entry.waist && !entry.hips && !entry.chest && !entry.arm && !entry.thigh && !entry.neck) {
    alert("Enter at least one measurement.");
    return;
  }
  if (editingMeasId) {
    const i = store.measurements.findIndex((x) => x.id === editingMeasId);
    if (i > -1) store.measurements[i] = entry;
  } else {
    store.measurements.push(entry);
  }
  editingMeasId = null;
  saveStore();
  renderMeasurements();
  toggleForm(measForm, document.getElementById("show-measurement-form"), false);
});

const MEAS_LABELS = { waist: "Waist", hips: "Hips", chest: "Chest", arm: "Arm", thigh: "Thigh", neck: "Neck" };

function renderMeasurements() {
  const list = document.getElementById("measurement-list");
  const sorted = [...store.measurements].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = sorted.map((m) => {
    const parts = Object.keys(MEAS_LABELS)
      .filter((k) => m[k] != null)
      .map((k) => MEAS_LABELS[k] + " " + Number(m[k]).toFixed(1) + "&Prime;");
    return `
    <div class="entry">
      <p class="entry-title">${escapeHtml(formatDate(m.date))}</p>
      <p class="entry-sub">${parts.join(" &middot; ")}</p>
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-meas="${m.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-meas="${m.id}">Delete</button>
      </div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-edit-meas]").forEach((b) => b.addEventListener("click", () => {
    const m = store.measurements.find((x) => x.id === b.dataset.editMeas);
    if (!m) return;
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
    renderMeasurements();
  }));
}

/* ---------- Progress photos ---------- */

document.getElementById("photo-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
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
      try {
        store.photos.push({ id: uid(), date: todayStr(), dataUrl });
        saveStore();
      } catch (err) {
        store.photos.pop();
        alert("Not enough storage on this device for more photos. Try exporting your data first.");
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
  const sorted = [...store.photos].sort((a, b) => a.date.localeCompare(b.date));
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
  if (!entry.date || !entry.mood) return;
  if (editingJournalId) {
    const i = store.journal.findIndex((x) => x.id === editingJournalId);
    if (i > -1) store.journal[i] = entry;
  } else {
    store.journal.push(entry);
  }
  editingJournalId = null;
  saveStore();
  journalLimit = 10;
  renderJournal();
  toggleForm(journalForm, document.getElementById("show-journal-form"), false);
});

const MOOD_EMOJI = { Great: "😄", Good: "🙂", Okay: "😐", Low: "😔" };

let journalLimit = 10; // entries shown; "show more" loads older ones in batches

function renderJournal() {
  const list = document.getElementById("journal-list");
  const sorted = [...store.journal].sort((a, b) => b.date.localeCompare(a.date));
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
        <button class="btn btn-small" data-edit-j="${j.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-j="${j.id}">Delete</button>
      </div>
    </div>`).join("")
    + (remaining > 0
      ? `<button class="btn" id="more-journal" style="width:100%;margin-top:8px">Show older (${remaining} more)</button>`
      : "");

  list.querySelectorAll("[data-edit-j]").forEach((b) => b.addEventListener("click", () => {
    const j = store.journal.find((x) => x.id === b.dataset.editJ);
    if (!j) return;
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
  if (!entry.date || !entry.symptom || !entry.severity) return;
  if (editingSeId) {
    const i = store.sideEffects.findIndex((x) => x.id === editingSeId);
    if (i > -1) store.sideEffects[i] = entry;
  } else {
    store.sideEffects.push(entry);
  }
  editingSeId = null;
  saveStore();
  renderSideEffects();
  toggleForm(seForm, document.getElementById("show-sideeffect-form"), false);
});

function renderSideEffects() {
  const list = document.getElementById("sideeffect-list");
  const sorted = [...store.sideEffects].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No side effects logged yet. Tap "Log effect" above to record how you are feeling today.</p>';
    return;
  }
  const badgeClass = { Mild: "badge-mild", Moderate: "badge-moderate", Severe: "badge-severe" };
  list.innerHTML = sorted.map((s) => `
    <div class="entry">
      <p class="entry-title">${escapeHtml(s.symptom)}<span class="badge ${badgeClass[s.severity] || ""}">${escapeHtml(s.severity)}</span></p>
      <p class="entry-sub">${escapeHtml(formatDate(s.date))}</p>
      ${s.notes ? `<p class="entry-notes">${escapeHtml(s.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-se="${s.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-se="${s.id}">Delete</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-edit-se]").forEach((b) => b.addEventListener("click", () => {
    const s = store.sideEffects.find((x) => x.id === b.dataset.editSe);
    if (!s) return;
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
    renderSideEffects();
  }));
}

/* ---------- Settings ---------- */

function renderSettings() {
  const s = store.settings;
  document.getElementById("set-companion-key").value = getAuthToken();
  document.getElementById("set-med").value = s.medication || "";
  document.getElementById("set-dose").value = s.dose || "";
  document.getElementById("set-shot-day").value = s.shotDay || "";
  document.getElementById("set-water-goal").value = s.waterGoal || 80;
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
  const today = new Date(todayStr());
  const target = new Date(rd + "T00:00:00");
  const diffDays = Math.round((target - today) / 86400000);
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
  if (keyInput) {
    try { localStorage.setItem(TOKEN_KEY, keyInput); } catch {}
  }
  store.settings.medication = document.getElementById("set-med").value.trim() || "Zepbound";
  store.settings.dose = document.getElementById("set-dose").value;
  store.settings.shotDay = document.getElementById("set-shot-day").value;
  const wg = Number(document.getElementById("set-water-goal").value);
  store.settings.waterGoal = wg > 0 ? wg : 80;
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
  alert("Settings saved.");
});

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
    const daysSince = Math.round((new Date(todayStr()) - new Date(last + "T00:00:00")) / 86400000);
    if (daysSince < 30) { banner.classList.add("hidden"); return; }
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
  return String(v == null ? "" : v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
}

function tsvSection(title, headers, rows) {
  const out = [title, headers.join("\t")];
  rows.forEach((r) => out.push(r.map(tsvCell).join("\t")));
  out.push("");
  return out;
}

document.getElementById("export-data").addEventListener("click", () => {
  const lines = [];
  lines.push("A New Chapter Tracker - data export");
  lines.push("Exported " + new Date().toLocaleString("en-US"));
  lines.push("");

  lines.push(...tsvSection(
    "Water Intake",
    ["Date", "Amount (oz)"],
    [...store.water].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.oz])
  ));

  lines.push(...tsvSection(
    "Protein",
    ["Date", "Food", "Grams"],
    [...store.protein].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.food, e.grams])
  ));

  lines.push(...tsvSection(
    "Movement",
    ["Date", "Activity", "Minutes"],
    [...store.exercise].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.label, e.minutes])
  ));

  lines.push(...tsvSection(
    "Injections",
    ["Date", "Medication", "Dose (mg)", "Site", "Notes"],
    [...store.injections].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.medication, e.dose, e.site, e.notes])
  ));

  lines.push(...tsvSection(
    "Weight",
    ["Date", "Weight (lbs)"],
    [...store.weight].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.value])
  ));

  lines.push(...tsvSection(
    "Measurements",
    ["Date", "Waist (in)", "Hips (in)", "Chest (in)", "Arm (in)", "Thigh (in)", "Neck (in)"],
    [...(store.measurements || [])].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.waist, e.hips, e.chest, e.arm, e.thigh, e.neck])
  ));

  lines.push("Progress Photos");
  lines.push(["Date", "Note"].join("\t"));
  [...(store.photos || [])].sort((a, b) => a.date.localeCompare(b.date)).forEach((p) => {
    lines.push([p.date, "Photo stored in app (not included in export)"].join("\t"));
  });
  lines.push("");

  lines.push(...tsvSection(
    "Journal",
    ["Date", "Mood", "Notes"],
    [...store.journal].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.mood, e.notes])
  ));

  lines.push(...tsvSection(
    "Side Effects",
    ["Date", "Symptom", "Severity", "Notes"],
    [...store.sideEffects].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.symptom, e.severity, e.notes])
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
  try { localStorage.setItem("nct-last-backup", todayStr()); } catch {}
  renderBackupNudge();
});

/* ---------- Backup & restore (JSON) ---------- */

document.getElementById("backup-data").addEventListener("click", () => {
  const backup = { app: "new-chapter-tracker", version: 1, exported: new Date().toISOString(), store };
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "new-chapter-backup-" + todayStr() + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  try { localStorage.setItem("nct-last-backup", todayStr()); } catch {}
  renderBackupNudge();
});

document.getElementById("restore-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const backup = JSON.parse(reader.result);
      if (!backup || backup.app !== "new-chapter-tracker" || !backup.store) {
        throw new Error("not a tracker backup");
      }
      if (!confirm("Restore this backup? Your current data will be replaced.")) return;
      store = backup.store;
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
      alert("Could not read that backup file. Make sure it is a backup downloaded from this app.");
    }
    e.target.value = "";
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
const dayPicker = document.getElementById("day-picker");
function openDayPicker() {
  dayPicker.value = todayStr(viewOffset);
  dayPicker.max = todayStr(0);
  if (typeof dayPicker.showPicker === "function") {
    dayPicker.showPicker();
  } else {
    dayPicker.focus();
    dayPicker.click();
  }
}
document.getElementById("day-cal").addEventListener("click", openDayPicker);
// Tapping the date heading itself also opens the picker
document.getElementById("date-tap").addEventListener("click", openDayPicker);
document.getElementById("date-tap").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDayPicker(); }
});
dayPicker.addEventListener("change", () => {
  if (!dayPicker.value) return;
  const parts = dayPicker.value.split("-").map(Number);
  const picked = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((picked - todayMid) / 86400000);
  viewOffset = Math.min(0, diffDays); // clamp future dates to today
  renderToday();
});

/* ---------- First-run setup wizard ---------- */

(function setupWizard() {
  if (localStorage.getItem("nct-setup-done")) return;
  const overlay = document.getElementById("setup-wizard");
  const form = document.getElementById("setup-form");
  overlay.classList.remove("hidden");

  const finish = () => {
    localStorage.setItem("nct-setup-done", "1");
    overlay.classList.add("hidden");
  };

  document.getElementById("setup-skip").addEventListener("click", finish);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    store.settings.medication = document.getElementById("setup-med").value || "Zepbound";
    const dose = parseFloat(document.getElementById("setup-dose").value);
    if (!isNaN(dose)) store.settings.dose = dose;
    store.settings.shotDay = document.getElementById("setup-shot-day").value || "";
    const water = parseInt(document.getElementById("setup-water").value, 10);
    if (!isNaN(water)) store.settings.waterGoal = water;
    const protein = parseInt(document.getElementById("setup-protein").value, 10);
    if (!isNaN(protein)) store.settings.proteinGoal = protein;
    saveStore();
    renderSettings();
    renderNextInjection();
    renderToday();
    finish();
  });
})();

document.getElementById("clear-all-data").addEventListener("click", () => {
  if (!confirm("Delete ALL your data? This cannot be undone. Consider downloading a backup first.")) return;
  if (!confirm("Are you sure? All water, protein, injections, weight, journal, and side effect entries will be permanently deleted.")) return;
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem("nct-setup-done");
  location.reload();
});

/* ---------- Init ---------- */

renderToday();
renderInjections();
renderWeight();
renderMeasurements();
renderPhotos();
renderJournal();
renderSideEffects();
renderSettings();

/* ---------- AI Companion chat ---------- */

// Update this URL after deploying the Worker
const COMPANION_API_URL = "https://github-fetcher.millrjess.workers.dev/api/chat";

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
      // Clean the URL so the token isn't left in the address bar
      params.delete("key");
      const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
      window.history.replaceState({}, "", clean);
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
    welcome.textContent = "Hi, I am your wellness companion. Ask me about staying on track with protein, water, or movement, or just tell me how your day is going.";
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
  if (!text) return;
  input.value = "";

  // Add user message
  chatHistory.push({ role: "user", content: text });
  saveChatHistory();
  renderChat();

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
      // Missing or invalid token: the buyer link wasn't used
      chatHistory.push({
        role: "assistant",
        content: "The companion needs your personal app link to work. Please open the link from your welcome email.",
      });
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
      content: "I could not reach the companion service. Check your connection and try again.",
    });
  }

  saveChatHistory();
  renderChat();
  sendBtn.disabled = false;
});

// Render chat when tab is opened
document.querySelector('[data-tab="chat"]').addEventListener("click", renderChat);
