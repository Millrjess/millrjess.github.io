/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 */

/* A New Chapter Tracker - app logic. Data persists in localStorage on this device only. */

"use strict";

const LS_KEY = "newChapterTracker.v1";

const DEFAULTS = {
  settings: {
    medication: "Zepbound",
    dose: "",
    shotDay: "",
    waterGoal: 80,
    proteinGoal: 90,
    refillDate: ""
  },
  water: [],        // { id, date: "YYYY-MM-DD", oz: number }
  protein: [],      // { id, date, grams, food }
  exercise: [],     // { id, date, minutes, label }
  injections: [],   // { id, date, medication, dose, site, notes }
  weight: [],       // { id, date, value }
  measurements: [], // { id, date, waist, hips, chest, arm, thigh, neck }
  photos: [],       // { id, date, dataUrl }
  journal: [],      // { id, date, mood, rating, notes }
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

function renderToday() {
  const t = todayStr();
  const dateEl = document.getElementById("today-date");
  dateEl.textContent = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
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

  const exMin = sumForDate(store.exercise, t, "minutes");
  document.getElementById("exercise-today").textContent = exMin;

  renderNextInjection();
  renderMood();
  renderTodayEntries(t);

  document.getElementById("undo-water").style.display = store.water.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-protein").style.display = store.protein.some((e) => e.date === t) ? "" : "none";
  document.getElementById("undo-exercise").style.display = store.exercise.some((e) => e.date === t) ? "" : "none";
}

/* Today's water, protein, and movement entries with per-entry remove */

function renderTodayEntries(t) {
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
        <button class="btn btn-small btn-danger" data-del-protein="${e.id}">Remove</button>
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
  store.protein.push({ id: uid(), date: todayStr(), grams, food: food || "Logged entry" });
  document.getElementById("protein-food").value = "";
  document.getElementById("protein-grams").value = "";
  saveStore();
  renderToday();
});

document.querySelectorAll("[data-exercise]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const labels = { 15: "Walk", 10: "Stretch", 30: "Exercise" };
    const mins = Number(btn.dataset.exercise);
    store.exercise.push({ id: uid(), date: todayStr(), minutes: mins, label: labels[mins] || "Exercise" });
    saveStore();
    renderToday();
  });
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
  renderInjections();
  renderToday();
  toggleForm(injForm, document.getElementById("show-injection-form"), false);
});

function renderInjections() {
  const list = document.getElementById("injection-list");
  const sorted = [...store.injections].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No injections logged yet. Tap "Log shot" to add your first.</p>';
    return;
  }
  list.innerHTML = sorted.map((inj) => `
    <div class="entry">
      <p class="entry-title">${escapeHtml(inj.medication)} ${escapeHtml(inj.dose)} mg</p>
      <p class="entry-sub">${escapeHtml(formatDate(inj.date))} &middot; ${escapeHtml(inj.site)}</p>
      ${inj.notes ? `<p class="entry-notes">${escapeHtml(inj.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-inj="${inj.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-inj="${inj.id}">Delete</button>
      </div>
    </div>`).join("");

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
    renderInjections();
    renderToday();
  }));
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
  const min = Math.min(...values), max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const lo = min - span * 0.15, hi = max + span * 0.15;

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
      ctx.fillText(formatDate(w.date).replace(", 2026", "").replace(", 2027", ""), x(i), H - 12);
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
    rating: Number(document.getElementById("journal-rating").value),
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
  renderJournal();
  toggleForm(journalForm, document.getElementById("show-journal-form"), false);
});

const MOOD_EMOJI = { Great: "😄", Good: "🙂", Okay: "😐", Low: "😔" };

function stars(n) {
  let s = "";
  for (let i = 1; i <= 5; i++) s += i <= n ? "★" : "☆";
  return s;
}

function renderJournal() {
  const list = document.getElementById("journal-list");
  const sorted = [...store.journal].sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    list.innerHTML = '<p class="empty-state">No journal entries yet. Tap "New entry" to write your first.</p>';
    return;
  }
  list.innerHTML = sorted.map((j) => `
    <div class="entry">
      <p class="entry-title">${MOOD_EMOJI[j.mood] || ""} ${escapeHtml(j.mood)} <span class="stars">${stars(j.rating || 0)}</span></p>
      <p class="entry-sub">${escapeHtml(formatDate(j.date))}</p>
      ${j.notes ? `<p class="entry-notes">${escapeHtml(j.notes)}</p>` : ""}
      <div class="entry-actions">
        <button class="btn btn-small" data-edit-j="${j.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-del-j="${j.id}">Delete</button>
      </div>
    </div>`).join("");

  list.querySelectorAll("[data-edit-j]").forEach((b) => b.addEventListener("click", () => {
    const j = store.journal.find((x) => x.id === b.dataset.editJ);
    if (!j) return;
    editingJournalId = j.id;
    journalForm.querySelector("h3").textContent = "Edit Journal Entry";
    document.getElementById("journal-date").value = j.date;
    document.getElementById("journal-mood").value = j.mood;
    document.getElementById("journal-rating").value = String(j.rating || 5);
    document.getElementById("journal-notes").value = j.notes || "";
    toggleForm(journalForm, document.getElementById("show-journal-form"), true);
    window.scrollTo(0, 0);
  }));

  list.querySelectorAll("[data-del-j]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("Delete this journal entry?")) return;
    store.journal = store.journal.filter((x) => x.id !== b.dataset.delJ);
    saveStore();
    renderJournal();
  }));
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
    list.innerHTML = '<p class="empty-state">No side effects logged. Tap "Log effect" to add one.</p>';
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
  document.getElementById("set-med").value = s.medication || "";
  document.getElementById("set-dose").value = s.dose || "";
  document.getElementById("set-shot-day").value = s.shotDay || "";
  document.getElementById("set-water-goal").value = s.waterGoal || 80;
  document.getElementById("set-protein-goal").value = s.proteinGoal || 90;
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
  store.settings.medication = document.getElementById("set-med").value.trim() || "Zepbound";
  store.settings.dose = document.getElementById("set-dose").value;
  store.settings.shotDay = document.getElementById("set-shot-day").value;
  const wg = Number(document.getElementById("set-water-goal").value);
  store.settings.waterGoal = wg > 0 ? wg : 80;
  const pg = Number(document.getElementById("set-protein-goal").value);
  store.settings.proteinGoal = pg > 0 ? pg : 90;
  store.settings.refillDate = document.getElementById("set-refill-date").value;
  saveStore();
  renderSettings();
  renderToday();
  alert("Settings saved.");
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
    ["Date", "Mood", "Rating", "Notes"],
    [...store.journal].sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.mood, e.rating, e.notes])
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
