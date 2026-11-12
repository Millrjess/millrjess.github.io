/* Demo data-loss reproduction + verification tests.
   Run: node runTests.js  (serves tracker-demo over localhost, drives Chromium)
   Each test prints PASS/FAIL. Before the fix, the V-tests FAIL (vulnerability
   reproduces). After the fix they must PASS. R-tests are regressions that must
   PASS both before and after. */
"use strict";
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const DEMO_DIR = path.join(__dirname, "..", "..", "tracker-demo");
const CHROME = process.env.CHROME_PATH || undefined;
const LS = "newChapterTracker.demo.v1";
const MARK = "newChapterTracker.demo.seeded.v1";
const SNAP = "demo-nct-snapshots";
const GEN = "demo-nct-store-gen";
const EVER = "demo-nct-ever-had-entries";
const CHAT_KEY = "newChapterTracker.demo.chat.v1";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon" };

function today(offset) {
  const d = new Date();
  d.setDate(d.getDate() + (offset || 0));
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

function makeStore(overrides) {
  const base = {
    settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "", companionAvatar: "gold", theme: "sage", textSize: "normal", readAloud: false },
    water: [], protein: [], exercise: [], injections: [], weight: [], measurements: [], photos: [], journal: [], sideEffects: [], moods: {}, movementDone: {}
  };
  return Object.assign(base, overrides || {});
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let fp = path.join(DEMO_DIR, urlPath === "/" ? "index.html" : urlPath);
      if (!fp.startsWith(DEMO_DIR)) { res.writeHead(403); res.end(); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end("not found"); return; }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

let results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || "" });
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (detail ? "  (" + detail + ")" : ""));
}

async function newPage(browser, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", () => {});
  page.on("dialog", async (d) => { await d.accept(); });
  await page.goto(url, { waitUntil: "load" });
  return { ctx, page };
}

async function setStorage(page, entries) {
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, entries);
}
async function getStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}
async function storeEntries(page) {
  return page.evaluate((LS) => {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      if (!s) return -1;
      let n = 0;
      ["water", "protein", "exercise", "injections", "weight", "measurements", "photos", "journal", "sideEffects"].forEach((k) => { if (Array.isArray(s[k])) n += s[k].length; });
      return n;
    } catch { return -99; }
  }, LS);
}
async function waterCount(page) {
  return page.evaluate((LS) => {
    try { const s = JSON.parse(localStorage.getItem(LS)); return Array.isArray(s.water) ? s.water.length : -1; } catch { return -99; }
  }, LS);
}
async function clickWaterPlus(page) {
  await page.click("#goals-water-add"); // the v165 add button (was the Water stepper +)
  await page.waitForTimeout(150);
}
async function cardVisible(page, id) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains("hidden");
  }, id);
}
async function clickTab(page, tabId) {
  // Tab buttons carry data-tab; #tab-* are the panels, not the buttons.
  await page.click(`.tab-btn[data-tab="${tabId}"]`);
  await page.waitForTimeout(200);
}

// v168: Effects and Settings live under the More sheet (Companion
// moved to the main nav in v169).
async function clickMoreTab(page, tabId) {
  await page.click(`.tab-btn[data-tab="more"]`);
  await page.waitForTimeout(200);
  await page.click(`.more-item[data-more-goto="${tabId}"]`);
  await page.waitForTimeout(200);
}

// v169: "Your goals" in Settings is a closed <details> by default, so its
// fields are not visible (and not fillable) until it is opened. A real
// user taps the summary; the test opens it directly and idempotently.
async function openYourGoals(page) {
  await page.evaluate(() => { const d = document.querySelector("#tab-settings details.card"); if (d) d.open = true; });
  await page.waitForTimeout(100);
}

// v057: the four "Your Companion" cards in Settings are closed <details>
// by default, so their controls are not clickable until opened. A real
// user taps the summary; the test opens the named card directly and
// idempotently, the same way openYourGoals opens "Your goals".
async function openSettingsCard(page, heading) {
  await page.evaluate((heading) => {
    const cards = Array.from(document.querySelectorAll("#tab-settings details.card"));
    const card = cards.find((d) => { const s = d.querySelector("summary"); return s && s.textContent.indexOf(heading) !== -1; });
    if (card) card.open = true;
  }, heading);
  await page.waitForTimeout(100);
}

async function main() {
  const { server, port } = await serve();
  const url = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

  // ---------- V1: stale / empty instance overwrites good data (two tabs) ----------
  try {
    const { ctx, page: pageA } = await newPage(browser, url);
    const store1 = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(pageA, { [MARK]: "1", [LS]: JSON.stringify(store1) });
    await pageA.reload();
    const pageB = await ctx.newPage();
    pageB.on("dialog", async (d) => { await d.accept(); });
    await pageB.goto(url, { waitUntil: "load" });
    await clickWaterPlus(pageA); // A now has 2 water entries, saved
    await clickWaterPlus(pageB); // B's in-memory copy has 1; its save must not wipe A's
    const n = await waterCount(pageA);
    check("V1 stale-tab overwrite: both tabs' water entries survive", n === 3, "saved water entries=" + n + " (want 3)");
    await ctx.close();
  } catch (e) { check("V1 stale-tab overwrite: both tabs' water entries survive", false, "error: " + e.message); }

  // ---------- V2: damaged collection silently dropped, then made permanent ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const bad = makeStore({ protein: [{ id: "p1", date: today(0), grams: 25, food: "Eggs" }, { id: "p2", date: today(0), grams: 20, food: "Yogurt" }] });
    bad.water = "not-an-array"; // damaged collection
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(bad) });
    await page.reload();
    const warned = await cardVisible(page, "corrupt-notice");
    check("V2 damaged collection: loud warning shown at load", warned, warned ? "" : "corrupt-notice hidden");
    const corruptStash = await getStorage(page, LS + ".corrupt");
    check("V2 damaged collection: damaged copy stashed aside", !!corruptStash, corruptStash ? "" : "no .corrupt stash");
    await clickWaterPlus(page); // any save attempt must not make the drop permanent
    const rawAfter = await getStorage(page, LS);
    let waterStillDamaged = false, proteinKept = false;
    try { const s = JSON.parse(rawAfter); waterStillDamaged = s.water === "not-an-array"; proteinKept = Array.isArray(s.protein) && s.protein.length === 2; } catch {}
    check("V2 damaged collection: save blocked until user sees warning", waterStillDamaged && proteinKept, "water still raw string=" + waterStillDamaged + ", protein kept=" + proteinKept);
    await ctx.close();
  } catch (e) { check("V2 damaged collection", false, "error: " + e.message); }

  // ---------- V3: empty store after prior use, no snapshots: silent blank ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [EVER]: "1" }); // used before, store now gone
    await page.reload();
    const hasCard = await page.evaluate(() => !!document.getElementById("empty-notice"));
    const warned = hasCard && await cardVisible(page, "empty-notice");
    check("V3 empty store after prior use: plain-words warning shown", warned, hasCard ? "card exists but hidden" : "no empty-notice card in page");
    // First day stays quiet: no markers at all -> no warning
    await setStorage(page, { [MARK]: "1" });
    await page.reload();
    const quiet = await page.evaluate(() => { const el = document.getElementById("empty-notice"); return !el || el.classList.contains("hidden"); });
    check("V3 first day stays quiet (no false warning)", quiet, quiet ? "" : "warning shown on a first day");
    await ctx.close();
  } catch (e) { check("V3 empty store warning", false, "error: " + e.message); }

  // ---------- V4: snapshot recorded on every change, not once a day ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s), [SNAP]: "[]", "demo-nct-last-snapshot-day": today(0) });
    await page.reload();
    await clickWaterPlus(page);
    const snapsRaw = await getStorage(page, SNAP);
    let snapHasNew = false, snapCount = 0;
    try {
      const snaps = JSON.parse(snapsRaw || "[]");
      snapCount = snaps.length;
      snapHasNew = snaps.some((sn) => { try { return JSON.parse(sn.data).water.length === 2; } catch { return false; } });
    } catch {}
    check("V4 snapshot on every change (same-day edit recorded)", snapCount >= 1 && snapHasNew, "snapshots=" + snapCount + ", newest has new entry=" + snapHasNew);
    await ctx.close();
  } catch (e) { check("V4 snapshot on every change", false, "error: " + e.message); }

  // ---------- V5: snapshot quota failure is loud, not swallowed ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s), [SNAP]: "[]" });
    await page.reload();
    await page.evaluate((SNAP) => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === SNAP) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
        return orig.call(this, k, v);
      };
    }, SNAP);
    await clickWaterPlus(page);
    const warned = await cardVisible(page, "storage-warning");
    const text = await page.evaluate(() => (document.getElementById("storage-warning-text") || {}).textContent || "");
    check("V5 snapshot failure: plain-words warning shown", warned && /backup/i.test(text), warned ? text : "storage-warning hidden");
    await ctx.close();
  } catch (e) { check("V5 snapshot failure warning", false, "error: " + e.message); }

  // ---------- V6: shrink guard (smaller store, different settings, same gen) ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const big = makeStore({ water: Array.from({ length: 8 }, (_, i) => ({ id: "w" + i, date: today(0), oz: 8 })) });
    big.settings.waterGoal = 100; // non-default settings mark this as real data
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(big), [GEN]: "5" });
    await page.reload(); // this instance loaded gen 5, 8 entries
    // Simulate another copy writing a bigger store without bumping gen (or an external edit):
    await page.evaluate(({ LS }) => {
      const s = JSON.parse(localStorage.getItem(LS));
      s.water.push({ id: "w8", date: new Date().toISOString().slice(0, 10), oz: 8 });
      s.water.push({ id: "w9", date: new Date().toISOString().slice(0, 10), oz: 8 });
      s.settings.waterGoal = 120;
      localStorage.setItem(LS, JSON.stringify(s)); // gen stays 5 on purpose
    }, { LS });
    await clickWaterPlus(page); // in-memory store has 8; persisted now has 10 + different settings
    const n = await waterCount(page);
    const warned = await cardVisible(page, "storage-warning");
    check("V6 shrink guard: smaller in-memory store does not overwrite bigger saved store", n === 10, "saved water entries=" + n + " (want 10)");
    check("V6 shrink guard: warning shown when save refused", warned, warned ? "" : "no warning");
    await ctx.close();
  } catch (e) { check("V6 shrink guard", false, "error: " + e.message); }

  // ---------- V7: photo dataUrl stored-XSS via a crafted backup ----------
  try {
    // Own context: this test needs its own dialog handler (record, do not auto-accept).
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    let alertFired = false;
    page.on("dialog", async (d) => { alertFired = true; await d.dismiss().catch(() => {}); });
    await page.goto(url, { waitUntil: "load" });
    const s = makeStore({ photos: [{ id: "ph1", date: today(0), dataUrl: 'x" onerror="alert(1)' }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s) });
    await page.reload();
    await page.click('[data-tab="weight"]'); // progress photos live on the Weight tab
    await page.waitForTimeout(300);
    check("V7 photo dataUrl cannot break out of the img tag (no script runs)", !alertFired, alertFired ? "alert() fired from stored dataUrl" : "");
    await ctx.close();
  } catch (e) { check("V7 photo dataUrl XSS", false, "error: " + e.message); }

  // ---------- R1: safety net still restores from snapshot when main store is unreadable ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const good = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }, { id: "a2", date: today(0), oz: 16 }] });
    const snap = { at: new Date().toISOString(), data: JSON.stringify(good) };
    await setStorage(page, { [MARK]: "1", [LS]: "this is not json {{{", [SNAP]: JSON.stringify([snap]) });
    await page.reload();
    const n = await storeEntries(page);
    const noticed = await cardVisible(page, "restore-notice");
    check("R1 safety net: unreadable store restored from snapshot", n === 2 && noticed, "entries=" + n + ", restore notice=" + noticed);
    await ctx.close();
  } catch (e) { check("R1 safety net restore", false, "error: " + e.message); }

  // ---------- R2: deliberate delete still works and is not resurrected ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    const snap = { at: new Date().toISOString(), data: JSON.stringify(s) };
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s), [SNAP]: JSON.stringify([snap]) });
    await page.reload();
    await clickMoreTab(page, "settings");
    await page.click("#clear-all-data");
    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(200);
    const n = await storeEntries(page);
    const snapsRaw = await getStorage(page, SNAP);
    let onlyBeforeDelete = false;
    try { const snaps = JSON.parse(snapsRaw || "[]"); onlyBeforeDelete = snaps.every((sn) => sn.label === "Before delete"); } catch {}
    check("R2 deliberate delete: data gone and not resurrected on reload", (n === 0 || n === -1) && onlyBeforeDelete, "entries=" + n + " (-1 = no store key, also empty), only Before-delete snapshots=" + onlyBeforeDelete);
    await ctx.close();
  } catch (e) { check("R2 deliberate delete", false, "error: " + e.message); }

  // ---------- R3: restore from a wrong-shape file is rejected, nothing changes ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s) });
    await page.reload();
    const badFile = { app: "new-chapter-tracker", version: 1, exported: new Date().toISOString(), store: { settings: {}, water: "nope", protein: [] } };
    await page.setInputFiles("#restore-input", { name: "bad-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(badFile)) });
    await page.waitForTimeout(300);
    const n = await storeEntries(page);
    check("R3 wrong-shape backup file rejected, data untouched", n === 1, "entries=" + n + " (want 1)");
    await ctx.close();
  } catch (e) { check("R3 wrong-shape restore rejected", false, "error: " + e.message); }

  // ---------- R4: restore of an empty file is confirmed and then works ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s) });
    await page.reload();
    const emptyFile = { app: "new-chapter-tracker", version: 1, exported: new Date().toISOString(), store: makeStore({}) };
    await page.setInputFiles("#restore-input", { name: "empty-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(emptyFile)) });
    await page.waitForTimeout(300);
    const n = await storeEntries(page);
    check("R4 confirmed empty-file restore replaces data (deliberate)", n === 0, "entries=" + n + " (want 0 after confirmed empty restore)");
    await ctx.close();
  } catch (e) { check("R4 empty-file restore", false, "error: " + e.message); }

  // ---------- R5: quota failure on the main save is loud ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s) });
    await page.reload();
    await page.evaluate((LS) => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === LS) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
        return orig.call(this, k, v);
      };
    }, LS);
    await clickWaterPlus(page);
    const warned = await cardVisible(page, "storage-warning");
    check("R5 main save quota failure: warning shown", warned, warned ? "" : "storage-warning hidden");
    await ctx.close();
  } catch (e) { check("R5 main save quota failure", false, "error: " + e.message); }

  // ---------- V165: Today tab matches the preview ----------
  try {
    const { ctx, page } = await newPage(browser, url);
    const s = makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }], protein: [{ id: "a2", date: today(0), grams: 30, food: "Quick add" }], exercise: [{ id: "a3", date: today(0), minutes: 5, label: "Movement" }] });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(s) });
    await page.reload();
    await page.waitForTimeout(400);
    const structure = await page.evaluate(() => {
      const titles = [...document.querySelectorAll("#tab-today .card-title")].map((el) => el.textContent);
      return {
        goalsCards: document.querySelectorAll("#goals-card").length,
        rings: document.querySelectorAll(".goals-rings .ring-box").length,
        detailCards: ["Water Intake", "Protein", "Movement"].filter((x) => titles.includes(x)).length,
        summaryCards: document.querySelectorAll(".progress-grid").length,
        entryLists: document.querySelectorAll("#water-list,#protein-list,#exercise-list").length,
        weekCard: document.querySelectorAll("#weekly-summary-card").length,
        logFoodBtn: document.querySelectorAll("#log-food-btn").length,
        viewHistory: [...document.querySelectorAll("#tab-today button")].filter((b) => b.textContent.includes("View shot history")).length,
        greeting: (document.getElementById("greeting-line") || {}).textContent || "",
        waterNum: (document.getElementById("water-today") || {}).textContent || "",
        macrosCard: document.querySelectorAll("#macros-card").length,
        proteinRing: !!document.getElementById("protein-ring")
      };
    });
    // v168: two rings (water, movement), macros card present, protein ring gone.
    const shapeOk = structure.goalsCards === 1 && structure.rings === 2 &&
      structure.detailCards === 0 && structure.summaryCards === 0 && structure.entryLists === 0 &&
      structure.weekCard === 0 && structure.logFoodBtn === 0 && structure.viewHistory === 0 &&
      structure.greeting.indexOf("Good") === 0 && structure.greeting.indexOf("Jessica") === -1 && structure.waterNum === "16" &&
      structure.macrosCard === 1 && !structure.proteinRing;
    check("V165 Today matches preview: one goals card, two rings, macros card, no extras", shapeOk, JSON.stringify(structure));
    await page.click("#goals-water-add");
    await page.click("#goals-exercise-add");
    await page.waitForTimeout(400);
    const totals = await page.evaluate((LS) => {
      const st = JSON.parse(localStorage.getItem(LS));
      return {
        water: st.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        protein: st.protein.reduce((a, e) => a + (Number(e.grams) || 0), 0),
        exercise: st.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0)
      };
    }, LS);
    check("V165 add buttons: +8 oz, +5 min stored, protein untouched", totals.water === 24 && totals.protein === 30 && totals.exercise === 10, JSON.stringify(totals));
    await ctx.close();
  } catch (e) { check("V165 Today matches preview", false, "error: " + e.message); }

  // ---------- V166: section features + fine-control buttons ----------
  // Rotation guide, weight milestones + gold line, journal chapters,
  // effects timeline, streak, morning check-in, +/- 1 nudge buttons.
  try {
    // Rotation guide: last site Right Abdomen -> next is Left Thigh.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ injections: [
      { id: "i1", date: today(-7), medication: "Zepbound", dose: 5, site: "Left Abdomen", status: "On time" },
      { id: "i2", date: today(0), medication: "Zepbound", dose: 5, site: "Right Abdomen", status: "On time" }
    ] })) });
    await page.reload();
    await clickTab(page, "shots");
    await page.waitForTimeout(400);
    const guide = await page.evaluate(() => ({
      text: (document.getElementById("rotation-guide") || {}).textContent || "",
      useBtnVisible: !!document.getElementById("rotation-use-site") && !document.getElementById("rotation-use-site").classList.contains("hidden")
    }));
    check("V166 rotation guide: next site after Right Abdomen is Left Thigh", guide.text.indexOf("Left Thigh") !== -1 && guide.text.indexOf("Right Abdomen") !== -1 && guide.useBtnVisible, JSON.stringify(guide));
    await page.click("#rotation-use-site");
    await page.waitForTimeout(300);
    const siteVal = await page.evaluate(() => document.getElementById("inj-site").value);
    check("V166 rotation guide: Use this site pre-selects Left Thigh", siteVal === "Left Thigh", "site=" + siteVal);
    await ctx.close();
  } catch (e) { check("V166 rotation guide", false, "error: " + e.message); }

  try {
    // Rotation guide with no injections yet.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await clickTab(page, "shots");
    await page.waitForTimeout(400);
    const guide = await page.evaluate(() => ({
      text: (document.getElementById("rotation-guide") || {}).textContent || "",
      useBtnVisible: !!document.getElementById("rotation-use-site") && !document.getElementById("rotation-use-site").classList.contains("hidden")
    }));
    check("V166 rotation guide: no shots yet shows first-shot hint", guide.text.indexOf("first shot") !== -1 && !guide.useBtnVisible, JSON.stringify(guide));
    await ctx.close();
  } catch (e) { check("V166 rotation guide empty", false, "error: " + e.message); }

  try {
    // Weight milestones: 200 -> 189 is 11 lbs lost, so 5 and 10 reached.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [
      { id: "w1", date: today(-10), value: 200 },
      { id: "w2", date: today(-6), value: 195 },
      { id: "w3", date: today(-3), value: 190 },
      { id: "w4", date: today(0), value: 189 }
    ] })) });
    await page.reload();
    await page.click('[data-tab="weight"]');
    await page.waitForTimeout(400);
    const ms = await page.evaluate(() => {
      const text = (document.getElementById("weight-milestones") || {}).textContent || "";
      const canvas = document.getElementById("weight-chart");
      let goldPixels = 0;
      try {
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r >= 215 && r <= 245 && g >= 165 && g <= 195 && b >= 60 && b <= 95) goldPixels++;
        }
      } catch (e) { /* canvas unreadable */ }
      return { text, goldPixels };
    });
    check("V166 weight milestones: 5 and 10 lbs down named", ms.text.indexOf("5 lbs down") !== -1 && ms.text.indexOf("10 lbs down") !== -1, JSON.stringify(ms));
    check("V166 weight chart line is gold", ms.goldPixels > 50, "gold pixels=" + ms.goldPixels);
    await ctx.close();
  } catch (e) { check("V166 weight milestones", false, "error: " + e.message); }

  try {
    // Journal chapters: entries in two months get two chapter headings.
    const { ctx, page } = await newPage(browser, url);
    const now = new Date();
    const thisMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonth = lastMonthDate.getFullYear() + "-" + String(lastMonthDate.getMonth() + 1).padStart(2, "0");
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ journal: [
      { id: "j1", date: today(0), mood: "Good", notes: "Feeling strong." },
      { id: "j2", date: lastMonth + "-15", mood: "Okay", notes: "A slow week." }
    ] })) });
    await page.reload();
    await page.click('[data-tab="journal"]');
    await page.waitForTimeout(400);
    const chapters = await page.evaluate(() => [...document.querySelectorAll(".journal-chapter")].map((el) => el.textContent));
    const thisName = new Date(thisMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const lastName = new Date(lastMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    check("V166 journal chapters: one heading per month", chapters.length === 2 && chapters.includes(thisName) && chapters.includes(lastName), JSON.stringify(chapters));
    await ctx.close();
  } catch (e) { check("V166 journal chapters", false, "error: " + e.message); }

  try {
    // Effects timeline: entries render on a timeline, newest first.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ sideEffects: [
      { id: "s1", date: today(-2), symptom: "Nausea", severity: "Mild", notes: "" },
      { id: "s2", date: today(0), symptom: "Fatigue", severity: "Moderate", notes: "Rest helped." }
    ] })) });
    await page.reload();
    await clickMoreTab(page, "side-effects");
    await page.waitForTimeout(400);
    const tl = await page.evaluate(() => {
      // Scoped to the Effects tab: the Journal tab now renders the same
      // timeline a second time (v169), so a page-wide count would be 2.
      const items = [...document.querySelectorAll("#sideeffect-list .se-timeline-item")];
      return {
        timeline: document.querySelectorAll("#sideeffect-list .se-timeline").length,
        items: items.length,
        firstSymptom: items.length ? items[0].textContent : "",
        moderateDot: items.some((el) => el.classList.contains("se-sev-moderate")),
        mildDot: items.some((el) => el.classList.contains("se-sev-mild"))
      };
    });
    check("V166 effects timeline: two dated items, severity dots", tl.timeline === 1 && tl.items === 2 && tl.firstSymptom.indexOf("Fatigue") !== -1 && tl.moderateDot && tl.mildDot, JSON.stringify(tl));
    await ctx.close();
  } catch (e) { check("V166 effects timeline", false, "error: " + e.message); }

  try {
    // Streak: entries today, yesterday, day before -> 3 days in a row.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ water: [
      { id: "a1", date: today(0), oz: 16 },
      { id: "a2", date: today(-1), oz: 8 },
      { id: "a3", date: today(-2), oz: 8 }
    ] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const streak = await page.evaluate(() => (document.getElementById("streak-line") || {}).textContent || "");
    check("V166 streak: three consecutive logged days", streak.indexOf("3 days in a row") !== -1, "streak=" + JSON.stringify(streak));
    // Morning before logging: only yesterday logged -> streak is 1.
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(-1), oz: 8 }] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const streak2 = await page.evaluate(() => (document.getElementById("streak-line") || {}).textContent || "");
    check("V166 streak: yesterday only still counts as Day 1", streak2.indexOf("Day 1") !== -1, "streak=" + JSON.stringify(streak2));
    await ctx.close();
  } catch (e) { check("V166 streak", false, "error: " + e.message); }

  try {
    // Nudge buttons: +1 and -1 by exactly one unit, clamped at zero.
    const { ctx, page } = await newPage(browser, url);
    // v168: protein has no ring any more, so the nudge pair is water
    // and movement.
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }], exercise: [{ id: "a3", date: today(0), minutes: 5, label: "Movement" }] })) });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click("#water-plus-1");
    await page.click("#exercise-plus-1");
    await page.waitForTimeout(300);
    let totals = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        exercise: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0)
      };
    }, LS);
    check("V166 nudge +1: water 16 to 17, movement 5 to 6", totals.water === 17 && totals.exercise === 6, JSON.stringify(totals));
    await page.click("#water-minus-1");
    await page.waitForTimeout(300);
    totals = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0) };
    }, LS);
    check("V166 nudge -1: water 17 back to 16", totals.water === 16, JSON.stringify(totals));
    // Clamp: 20 taps of minus from 16 cannot go below zero.
    for (let i = 0; i < 20; i++) await page.click("#water-minus-1");
    await page.waitForTimeout(300);
    totals = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0) };
    }, LS);
    check("V166 nudge -1: clamped at zero", totals.water === 0, JSON.stringify(totals));
    await ctx.close();
  } catch (e) { check("V166 nudge buttons", false, "error: " + e.message); }

  try {
    // Morning check-in: time-aware. In the morning the card shows with
    // a question; later in the day it stays hidden.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await clickTab(page, "chat");
    await page.waitForTimeout(400);
    const ci = await page.evaluate(() => {
      const card = document.getElementById("morning-checkin");
      const q = (document.getElementById("morning-checkin-q") || {}).textContent || "";
      return { hour: new Date().getHours(), hidden: !card || card.classList.contains("hidden"), question: q };
    });
    const morningOk = ci.hour >= 5 && ci.hour < 12 ? (!ci.hidden && ci.question.length > 5) : ci.hidden;
    check("V166 morning check-in: shows in the morning, hidden later", morningOk, JSON.stringify(ci));
    await ctx.close();
  } catch (e) { check("V166 morning check-in", false, "error: " + e.message); }

  try {
    // V167 double-tap zoom fix: the nudge buttons and the gold add
    // buttons on the Today's Goals rings must carry touch-action:
    // manipulation, so rapid taps on iOS Safari are not read as a
    // double-tap that zooms the page.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    const ta = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll(".ring-nudge-btn").forEach((b) => { out[b.id] = getComputedStyle(b).touchAction; });
      document.querySelectorAll(".goals-add").forEach((b) => { out[b.id] = getComputedStyle(b).touchAction; });
      return out;
    });
    const vals = Object.values(ta);
    check("V167 touch-action: nudge and add buttons are manipulation", vals.length === 6 && vals.every((v) => v === "manipulation"), JSON.stringify(ta));
    await ctx.close();
  } catch (e) { check("V167 touch-action", false, "error: " + e.message); }


  // ---------- V168: macros, movement routine, 5-tab nav, BMI, doctor summary ----------
  try {
    // Header: real gold lotus above the title, new tagline.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    const header = await page.evaluate(() => {
      const img = document.querySelector(".app-header .header-lotus");
      const tag = (document.querySelector(".app-header .tagline") || {}).textContent || "";
      const title = (document.querySelector(".app-header h1") || {}).textContent || "";
      return { lotusSrc: img ? img.getAttribute("src") : "", tagline: tag, title };
    });
    check("V168 header: gold lotus above title, new tagline", header.lotusSrc.indexOf("lotus-gold-only-transparent.png") !== -1 && header.tagline.indexOf("Stay strong while the medicine works") !== -1 && header.title.indexOf("New Chapter") !== -1, JSON.stringify(header));
    await ctx.close();
  } catch (e) { check("V168 header", false, "error: " + e.message); }

  try {
    // Macros card: 25+22+21 protein, 40+45+35 carbs, 10+15+20 fat
    // sums to 68/120/45 against targets 90/150/60; calories 1157.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ protein: [
      { id: "p1", date: today(0), grams: 25, carbs: 40, fat: 10, food: "Eggs" },
      { id: "p2", date: today(0), grams: 22, carbs: 45, fat: 15, food: "Yogurt" },
      { id: "p3", date: today(0), grams: 21, carbs: 35, fat: 20, food: "Chicken" }
    ] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const macros = await page.evaluate(() => ({
      card: document.querySelectorAll("#macros-card").length,
      proteinRing: !!document.getElementById("protein-ring"),
      center: (document.getElementById("macro-center-grams") || {}).textContent || "",
      p: (document.getElementById("logged-protein") || {}).textContent || "",
      c: (document.getElementById("logged-carbs") || {}).textContent || "",
      f: (document.getElementById("logged-fat") || {}).textContent || "",
      tp: (document.getElementById("target-protein-label") || {}).textContent || "",
      tc: (document.getElementById("target-carbs-label") || {}).textContent || "",
      tf: (document.getElementById("target-fat-label") || {}).textContent || "",
      cal: (document.getElementById("calories-today") || {}).textContent || ""
    }));
    const macrosOk = macros.card === 1 && !macros.proteinRing && macros.center === "68" &&
      macros.p === "68" && macros.c === "120" && macros.f === "45" &&
      macros.tp === "90" && macros.tc === "150" && macros.tf === "60" &&
      macros.cal.indexOf("1,157") !== -1;
    check("V168 macros card: 68/120/45 logged vs 90/150/60, 1,157 calories, no protein ring", macrosOk, JSON.stringify(macros));
    // Tap the carbs row: the donut center switches to carbs.
    await page.click('.macro-row[data-macro="carbs"]');
    await page.waitForTimeout(300);
    const centerAfter = await page.evaluate(() => (document.getElementById("macro-center-grams") || {}).textContent || "");
    check("V168 macros select: tapping carbs shows 120 in the center", centerAfter === "120", "center=" + centerAfter);
    // Protein log stepper: +1 logs one more gram.
    await page.click('.macro-log-btn[data-macro-log="protein"][data-dir="1"]');
    await page.waitForTimeout(300);
    const afterStep = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return s.protein.reduce((a, e) => a + (Number(e.grams) || 0), 0);
    }, LS);
    check("V168 macros log stepper: protein +1 is 69", afterStep === 69, "protein=" + afterStep);
    // Log food form: a real meal lands in the store with all macros.
    await page.click("#macro-log-food");
    await page.waitForTimeout(200);
    await page.fill("#macro-food-name", "Salmon bowl");
    await page.fill("#macro-food-protein", "30");
    await page.fill("#macro-food-carbs", "25");
    await page.fill("#macro-food-fat", "12");
    await page.click("#macro-food-submit");
    await page.waitForTimeout(400);
    const afterFood = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      const last = s.protein[s.protein.length - 1];
      return {
        protein: s.protein.reduce((a, e) => a + (Number(e.grams) || 0), 0),
        carbs: s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0),
        fat: s.protein.reduce((a, e) => a + (Number(e.fat) || 0), 0),
        food: last ? last.food : ""
      };
    }, LS);
    check("V168 log food: Salmon bowl adds 30/25/12 to the day", afterFood.protein === 99 && afterFood.carbs === 145 && afterFood.fat === 57 && afterFood.food === "Salmon bowl", JSON.stringify(afterFood));
    await ctx.close();
  } catch (e) { check("V168 macros card", false, "error: " + e.message); }

  try {
    // Movement card: five default moves, progress, 5-minute bonus on
    // completion, bonus taken back when a move is unticked.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    const start = await page.evaluate(() => ({
      moves: document.querySelectorAll("#moves-list li").length,
      count: (document.getElementById("move-count") || {}).textContent || "",
      sub: (document.getElementById("movement-sub") || {}).textContent || ""
    }));
    check("V168 movement card: five default moves, 0 of 5", start.moves === 5 && start.count.indexOf("0 of 5") !== -1 && start.sub.indexOf("5 minutes") !== -1, JSON.stringify(start));
    // Tap all five gold circles. Each tap re-renders the list, so the
    // buttons are re-queried every time instead of holding handles
    // across renders.
    for (let i = 0; i < 5; i++) {
      await page.click("#moves-list .move-check:not(.done)");
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(400);
    const done = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        count: (document.getElementById("move-count") || {}).textContent || "",
        logged: (document.getElementById("move-logged") || {}).classList.contains("show"),
        minutes: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
        bonus: s.exercise.filter((e) => e.label === "Daily movement routine").length,
        ring: (document.getElementById("exercise-today") || {}).textContent || ""
      };
    }, LS);
    check("V168 movement complete: 5 of 5 logs 5 minutes to the Movement ring", done.count.indexOf("5 of 5") !== -1 && done.logged && done.minutes === 5 && done.bonus === 1 && done.ring === "5", JSON.stringify(done));
    // Untick one move: the bonus comes back off.
    await page.click("#moves-list .move-check.done");
    await page.waitForTimeout(400);
    const undone = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        minutes: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
        bonus: s.exercise.filter((e) => e.label === "Daily movement routine").length
      };
    }, LS);
    check("V168 movement untick: bonus removed, movement back to 0", undone.minutes === 0 && undone.bonus === 0, JSON.stringify(undone));
    await ctx.close();
  } catch (e) { check("V168 movement card", false, "error: " + e.message); }

  try {
    // Customize: pick Lunges at 8 reps, drop the stretch, save.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click("#movement-customize");
    await page.waitForTimeout(300);
    const editor = await page.evaluate(() => ({
      open: !document.getElementById("movement-plan-modal").classList.contains("hidden"),
      rows: document.querySelectorAll("#movement-plan-list .plan-row").length,
      checked: [...document.querySelectorAll("#movement-plan-list input[type='checkbox']")].filter((c) => c.checked).length
    }));
    check("V168 plan editor: opens with 18 exercises, 5 checked", editor.open && editor.rows === 18 && editor.checked === 5, JSON.stringify(editor));
    await page.uncheck('input[data-plan-name="Gentle full-body stretch"]');
    await page.check('input[data-plan-name="Lunges"]');
    await page.fill('input[data-plan-detail="Lunges"]', "8 reps");
    await page.click("#movement-plan-save");
    await page.waitForTimeout(400);
    const plan = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      const names = [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent);
      const reps = [...document.querySelectorAll("#moves-list .move-reps")].map((el) => el.textContent);
      return { names, reps, saved: (s.settings.movementPlan || []).map((m) => m.name + " " + m.detail) };
    }, LS);
    check("V168 plan save: Lunges 8 reps in, stretch out, plan saved", plan.names.includes("Lunges") && plan.reps[plan.names.indexOf("Lunges")] === "8 reps" && !plan.names.includes("Gentle full-body stretch") && plan.saved.length === 5, JSON.stringify(plan));
    // Reset returns to the default five.
    await page.click("#movement-customize");
    await page.waitForTimeout(300);
    await page.click("#movement-plan-reset");
    await page.waitForTimeout(400);
    const reset = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { names: [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent), plan: s.settings.movementPlan };
    }, LS);
    check("V168 plan reset: back to the default five", reset.plan === null && reset.names.length === 5 && reset.names.includes("Sit-to-stands"), JSON.stringify(reset));
    await ctx.close();
  } catch (e) { check("V168 movement customize", false, "error: " + e.message); }

  try {
    // Six-tab nav (v169): Today, Shots, Weight, Journal, Companion,
    // More. More opens a sheet; picking Effects or Settings shows that
    // panel and marks More active.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    const nav = await page.evaluate(() => ({
      labels: [...document.querySelectorAll(".tab-btn .tab-label")].map((el) => el.textContent),
      dots: document.querySelectorAll(".tab-btn .tab-dot").length
    }));
    check("V168 nav: six tabs, each with a gold dot", nav.labels.join(",") === "Today,Shots,Weight,Journal,Companion,More" && nav.dots === 6, JSON.stringify(nav));
    await page.click('.tab-btn[data-tab="more"]');
    await page.waitForTimeout(300);
    const sheet = await page.evaluate(() => ({
      open: !document.getElementById("more-sheet").classList.contains("hidden"),
      items: [...document.querySelectorAll(".more-item[data-more-goto]")].map((el) => el.dataset.moreGoto)
    }));
    check("V004 More sheet: opens with Effects, Settings, Recipes", sheet.open && sheet.items.join(",") === "side-effects,settings,recipes", JSON.stringify(sheet));
    await page.click('.more-item[data-more-goto="settings"]');
    await page.waitForTimeout(300);
    const afterSettings = await page.evaluate(() => ({
      settingsActive: document.getElementById("tab-settings").classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active"),
      sheetClosed: document.getElementById("more-sheet").classList.contains("hidden")
    }));
    check("V168 More pick: Settings panel shows, More stays active, sheet closes", afterSettings.settingsActive && afterSettings.moreActive && afterSettings.sheetClosed, JSON.stringify(afterSettings));
    await page.click('.tab-btn[data-tab="more"]');
    await page.waitForTimeout(300);
    await page.click('.more-item[data-more-goto="side-effects"]');
    await page.waitForTimeout(300);
    const afterEffects = await page.evaluate(() => ({
      effectsActive: document.getElementById("tab-side-effects").classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active")
    }));
    check("V168 More pick: Effects panel shows, More stays active", afterEffects.effectsActive && afterEffects.moreActive, JSON.stringify(afterEffects));
    // Escape closes the sheet without changing tabs.
    await page.click('.tab-btn[data-tab="more"]');
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const afterEsc = await page.evaluate(() => ({
      sheetClosed: document.getElementById("more-sheet").classList.contains("hidden"),
      effectsStillActive: document.getElementById("tab-side-effects").classList.contains("active")
    }));
    check("V168 More sheet: Escape closes it, tab unchanged", afterEsc.sheetClosed && afterEsc.effectsStillActive, JSON.stringify(afterEsc));
    await ctx.close();
  } catch (e) { check("V168 five-tab nav", false, "error: " + e.message); }

  try {
    // BMI: 168 lbs at 5 ft 6 in is 27.1, Overweight. No height, no BMI.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 168 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const bmi = await page.evaluate(() => ({
      hero: (document.getElementById("weight-hero-value") || {}).textContent || "",
      line: (document.getElementById("bmi-line") || {}).textContent || ""
    }));
    check("V168 BMI: 168 lbs at 5 ft 6 in is 27.1 Overweight, hero shows 168", bmi.hero === "168.0" && bmi.line.indexOf("27.1") !== -1 && bmi.line.indexOf("Overweight") !== -1, JSON.stringify(bmi));
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 168 }] })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const noHeight = await page.evaluate(() => (document.getElementById("bmi-line") || {}).textContent || "");
    check("V168 BMI: no height in Settings shows the add-height hint", noHeight.indexOf("Add your height") !== -1, JSON.stringify(noHeight));
    await ctx.close();
  } catch (e) { check("V168 BMI", false, "error: " + e.message); }

  try {
    // Doctor visit summary: one tap builds weight, shots and side
    // effects into a text summary with Copy and Download.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      weight: [
        { id: "w1", date: today(-30), value: 180 },
        { id: "w2", date: today(0), value: 168 }
      ],
      injections: [
        { id: "i1", date: today(-7), medication: "Zepbound", dose: 5, site: "Left Thigh", status: "On time" }
      ],
      sideEffects: [
        { id: "s1", date: today(-2), symptom: "Nausea", severity: "Mild", notes: "" }
      ]
    })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    await page.click("#doctor-summary-btn");
    await page.waitForTimeout(300);
    const summary = await page.evaluate(() => {
      const text = (document.getElementById("doctor-text") || {}).value || "";
      return {
        open: !document.getElementById("doctor-modal").classList.contains("hidden"),
        hasLatest: text.indexOf("168.0") !== -1,
        hasStart: text.indexOf("180.0") !== -1,
        hasShot: text.indexOf("Left Thigh") !== -1,
        hasEffect: text.indexOf("Nausea") !== -1,
        hasCopy: !!document.getElementById("doctor-copy"),
        hasDownload: !!document.getElementById("doctor-download")
      };
    });
    check("V168 doctor summary: weight, shot and side effect in the text", summary.open && summary.hasLatest && summary.hasStart && summary.hasShot && summary.hasEffect && summary.hasCopy && summary.hasDownload, JSON.stringify(summary));
    await ctx.close();
  } catch (e) { check("V168 doctor summary", false, "error: " + e.message); }

  try {
    // Chat lotus: the Companion's messages carry the gold lotus.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, {
      [MARK]: "1",
      [LS]: JSON.stringify(makeStore()),
      [CHAT_KEY]: JSON.stringify([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello, Jessica." }])
    });
    await page.reload();
    await clickTab(page, "chat");
    await page.waitForTimeout(400);
    const chat = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#chat-messages .chat-row")];
      return {
        rows: rows.length,
        assistantLotus: rows.filter((r) => r.classList.contains("assistant") && r.querySelector(".chat-lotus")).length,
        userLotus: rows.filter((r) => r.classList.contains("user") && r.querySelector(".chat-lotus")).length,
        lotusSrc: (document.querySelector("#chat-messages .chat-lotus") || {}).getAttribute ? document.querySelector("#chat-messages .chat-lotus").getAttribute("src") : ""
      };
    });
    check("V168 chat lotus: assistant row has the lotus, user row does not", chat.rows === 2 && chat.assistantLotus === 1 && chat.userLotus === 0 && chat.lotusSrc.indexOf("lotus-gold-only-transparent.png") !== -1, JSON.stringify(chat));
    await ctx.close();
  } catch (e) { check("V168 chat lotus", false, "error: " + e.message); }

  // ---------- V169: ring type-in, macro slide, calorie target, plan editor, BMI extras, weight layout ----------
  try {
    // Ring numbers are buttons that open the type-in sheet.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }], exercise: [{ id: "a3", date: today(0), minutes: 5, label: "Movement" }] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const numBtns = await page.evaluate(() => ({
      waterTag: (document.getElementById("water-num-btn") || {}).tagName || "",
      exTag: (document.getElementById("exercise-num-btn") || {}).tagName || "",
      waterLabel: (document.getElementById("water-num-btn") || {}).getAttribute ? document.getElementById("water-num-btn").getAttribute("aria-label") : "",
      hint: (document.querySelector(".goals-hint") || {}).textContent || ""
    }));
    check("V169 ring numbers are buttons with a type-in label", numBtns.waterTag === "BUTTON" && numBtns.exTag === "BUTTON" && numBtns.waterLabel.indexOf("16 of 92") !== -1 && numBtns.waterLabel.indexOf("Tap to type") !== -1 && numBtns.hint.indexOf("Tap the number to type an amount") !== -1, JSON.stringify(numBtns));
    // Type 16 in the water sheet: preview updates, Add stores 32 oz.
    await page.click("#water-num-btn");
    await page.waitForTimeout(300);
    const sheetOpen = await page.evaluate(() => ({
      open: !document.getElementById("add-amount-modal").classList.contains("hidden"),
      title: (document.getElementById("add-amount-title") || {}).textContent || "",
      now: (document.getElementById("add-amount-now") || {}).textContent || "",
      addDisabled: document.getElementById("add-amount-add").disabled,
      focused: document.activeElement.id || ""
    }));
    check("V169 water sheet: opens empty with Add disabled, input focused", sheetOpen.open && sheetOpen.title === "Add water" && sheetOpen.now === "Now: 16 oz" && sheetOpen.addDisabled && sheetOpen.focused === "add-amount-input", JSON.stringify(sheetOpen));
    await page.fill("#add-amount-input", "16");
    await page.waitForTimeout(200);
    const preview = await page.evaluate(() => ({
      text: (document.getElementById("add-amount-preview") || {}).textContent || "",
      addDisabled: document.getElementById("add-amount-add").disabled
    }));
    check("V169 water sheet: preview shows After adding 32 oz as typed", preview.text.indexOf("After adding: 32 oz") !== -1 && !preview.addDisabled, JSON.stringify(preview));
    await page.click("#add-amount-add");
    await page.waitForTimeout(300);
    const waterAfter = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { total: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0), ring: (document.getElementById("water-today") || {}).textContent || "", closed: document.getElementById("add-amount-modal").classList.contains("hidden") };
    }, LS);
    check("V169 water sheet: typing 16 adds 16 oz (16 to 32)", waterAfter.total === 32 && waterAfter.ring === "32" && waterAfter.closed, JSON.stringify(waterAfter));
    // Type 5 in the movement sheet: 5 to 10 min.
    await page.click("#exercise-num-btn");
    await page.waitForTimeout(300);
    await page.fill("#add-amount-input", "5");
    await page.waitForTimeout(200);
    const movePreview = await page.evaluate(() => (document.getElementById("add-amount-preview") || {}).textContent || "");
    check("V169 movement sheet: preview shows After adding 10 min", movePreview.indexOf("After adding: 10 min") !== -1, JSON.stringify(movePreview));
    await page.click("#add-amount-add");
    await page.waitForTimeout(300);
    const moveAfter = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0);
    }, LS);
    check("V169 movement sheet: typing 5 adds 5 min (5 to 10)", moveAfter === 10, "minutes=" + moveAfter);
    // Cancel leaves the value unchanged.
    await page.click("#water-num-btn");
    await page.waitForTimeout(300);
    await page.fill("#add-amount-input", "16");
    await page.click("#add-amount-cancel");
    await page.waitForTimeout(300);
    const afterCancel = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { total: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0), focusBack: document.activeElement.id || "" };
    }, LS);
    check("V169 sheet Cancel: value unchanged, focus back on the ring number", afterCancel.total === 32 && afterCancel.focusBack === "water-num-btn", JSON.stringify(afterCancel));
    // Invalid entry: Add stays disabled, Escape closes, value unchanged.
    await page.click("#water-num-btn");
    await page.waitForTimeout(300);
    await page.fill("#add-amount-input", "abc");
    await page.waitForTimeout(200);
    const invalid = await page.evaluate(() => ({
      addDisabled: document.getElementById("add-amount-add").disabled,
      preview: (document.getElementById("add-amount-preview") || {}).textContent || ""
    }));
    check("V169 sheet invalid entry: Add stays disabled", invalid.addDisabled && invalid.preview.indexOf("After adding") === -1, JSON.stringify(invalid));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const afterInvalid = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { total: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0), closed: document.getElementById("add-amount-modal").classList.contains("hidden") };
    }, LS);
    check("V169 sheet Escape: closes without changing the value", afterInvalid.total === 32 && afterInvalid.closed, JSON.stringify(afterInvalid));
    await ctx.close();
  } catch (e) { check("V169 ring type-in", false, "error: " + e.message); }

  try {
    // Macro row slide: drag the carbs bar right and left, clamp at zero.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ protein: [{ id: "p1", date: today(0), grams: 68, carbs: 120, fat: 45, food: "Eggs" }] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const barRole = await page.evaluate(() => {
      const bar = document.getElementById("macro-bar-carbs");
      const stepper = document.querySelector('.macro-row[data-macro="carbs"] .macro-log-btn[data-dir="1"]');
      const nameBtn = document.querySelector('.macro-row[data-macro="carbs"] .macro-name');
      return { role: bar.getAttribute("role"), touch: getComputedStyle(bar).touchAction, stepper: !!stepper && stepper.getAttribute("aria-label") || "", nameBtn: !!nameBtn && nameBtn.tagName === "BUTTON" };
    });
    // a11y v015 (demo): the bar is a drag handle, not a slider role.
    // Keyboard adjustment is the steppers; the macro name is the button.
    check("V169 macro bar is a drag handle (no slider role), steppers and name button present", barRole.role === null && barRole.touch === "none" && barRole.stepper.indexOf("Log 1 gram more carbs") !== -1 && barRole.nameBtn, JSON.stringify(barRole));
    // Select carbs so the donut center tracks it.
    await page.click('.macro-row[data-macro="carbs"] .macro-name');
    await page.waitForTimeout(300);
    async function dragBar(dx) {
      // The bar sits below the fold on a phone-height viewport, so a drag
      // from its raw box lands outside the viewport and no pointer event
      // fires. Scroll it into view first, as a person would.
      await page.locator("#macro-bar-carbs").scrollIntoViewIfNeeded();
      const box = await page.locator("#macro-bar-carbs").boundingBox();
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await dragBar(80); // +10 g at 1 g per 8px
    const afterRight = await page.evaluate(() => ({
      carbs: (document.getElementById("logged-carbs") || {}).textContent || "",
      center: (document.getElementById("macro-center-grams") || {}).textContent || "",
      pct: (document.getElementById("pct-carbs") || {}).textContent || ""
    }));
    check("V169 macro slide right: carbs 120 to 130, center and percent update", afterRight.carbs === "130" && afterRight.center === "130" && afterRight.pct.indexOf("87%") !== -1, JSON.stringify(afterRight));
    await dragBar(-160); // -20 g
    const afterLeft = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { stored: s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0), shown: (document.getElementById("logged-carbs") || {}).textContent || "" };
    }, LS);
    check("V169 macro slide left: carbs 130 to 110, stored once", afterLeft.stored === 110 && afterLeft.shown === "110", JSON.stringify(afterLeft));
    await dragBar(-2000); // far past zero: clamps
    const clamped = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { stored: s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0), shown: (document.getElementById("logged-carbs") || {}).textContent || "" };
    }, LS);
    check("V169 macro slide left: clamped at zero", clamped.stored === 0 && clamped.shown === "0", JSON.stringify(clamped));
    await ctx.close();
  } catch (e) { check("V169 macro row slide", false, "error: " + e.message); }

  try {
    // Calorie target: setting it shows "of 1,400", clearing reverts, invalid ignored.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ protein: [{ id: "p1", date: today(0), grams: 25, carbs: 40, fat: 10, food: "Eggs" }] })) });
    await page.reload();
    await page.waitForTimeout(400);
    const plainBefore = await page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || ""
    }));
    check("V169 calorie target: no target shows the plain section", plainBefore.today === "350" && plainBefore.target === "", JSON.stringify(plainBefore));
    await clickMoreTab(page, "settings");
    // The goals fields live inside the closed "Your goals" details.
    await page.evaluate(() => {
      document.querySelectorAll("#tab-settings details").forEach((d) => {
        if (((d.querySelector("summary") || {}).textContent || "").indexOf("Your goals") !== -1) d.open = true;
      });
    });
    await page.waitForTimeout(200);
    await page.fill("#set-calorie-target", "1400");
    await page.click('#settings-form button[type="submit"]');
    await page.waitForTimeout(400);
    const withTarget = await page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || ""
    }));
    check("V169 calorie target: 1400 shows 350 of 1,400", withTarget.today === "350" && withTarget.target === " of 1,400", JSON.stringify(withTarget));
    await page.fill("#set-calorie-target", "");
    await page.click('#settings-form button[type="submit"]');
    await page.waitForTimeout(400);
    const cleared = await page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || ""
    }));
    check("V169 calorie target: clearing it reverts to the plain section", cleared.today === "350" && cleared.target === "", JSON.stringify(cleared));
    await page.fill("#set-calorie-target", "-5");
    await page.click('#settings-form button[type="submit"]');
    await page.waitForTimeout(400);
    const invalidTarget = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { target: s.settings.calorieTarget, line: (document.getElementById("calories-target-part") || {}).textContent || "" };
    }, LS);
    check("V169 calorie target: invalid input is ignored, stays blank", invalidTarget.target === "" && invalidTarget.line.indexOf("of") === -1, JSON.stringify(invalidTarget));
    await ctx.close();
  } catch (e) { check("V169 calorie target", false, "error: " + e.message); }

  try {
    // v169: macro targets are type-in fields under Your goals in
    // Settings. Typing a new protein target updates the macros card;
    // a blank or invalid value leaves the existing target unchanged.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    await clickMoreTab(page, "settings");
    await page.waitForTimeout(300);
    await openYourGoals(page);
    await page.fill("#set-protein-goal", "120");
    await page.click("#settings-form button[type='submit']");
    await page.waitForTimeout(400);
    await clickTab(page, "today");
    await page.waitForTimeout(300);
    const setTarget = await page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 protein target typed in Settings updates the macros card", setTarget === "120", JSON.stringify(setTarget));
    // Blank keeps the 120 target; zero keeps it too.
    await clickMoreTab(page, "settings");
    await page.waitForTimeout(300);
    await openYourGoals(page);
    await page.fill("#set-protein-goal", "");
    await page.click("#settings-form button[type='submit']");
    await page.waitForTimeout(400);
    await clickTab(page, "today");
    await page.waitForTimeout(300);
    const keptBlank = await page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 blank protein target keeps the existing target", keptBlank === "120", JSON.stringify(keptBlank));
    await clickMoreTab(page, "settings");
    await page.waitForTimeout(300);
    await openYourGoals(page);
    await page.fill("#set-protein-goal", "0");
    await page.click("#settings-form button[type='submit']");
    await page.waitForTimeout(400);
    await clickTab(page, "today");
    await page.waitForTimeout(300);
    const keptZero = await page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 zero protein target keeps the existing target", keptZero === "120", JSON.stringify(keptZero));
    await ctx.close();
  } catch (e) { check("V169 macro target type-in", false, "error: " + e.message); }

  try {
    // Movement plan editor: add a custom exercise, X closes, picker scrolls, remove works.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click("#movement-customize");
    await page.waitForTimeout(300);
    const picker = await page.evaluate(() => {
      const list = document.getElementById("movement-plan-list");
      const cs = getComputedStyle(list);
      return { maxHeight: cs.maxHeight, scrollable: list.scrollHeight > list.clientHeight, hasX: !!document.getElementById("movement-plan-x"), hasAdd: !!document.getElementById("custom-ex-add") };
    });
    check("V169 plan editor: X button present, add section present, picker scrolls in a fixed height", picker.hasX && picker.hasAdd && picker.maxHeight === "264px" && picker.scrollable, JSON.stringify(picker));
    await page.fill("#custom-ex-name", "Step-ups");
    await page.selectOption("#custom-ex-pattern", "Squat");
    await page.fill("#custom-ex-detail", "10 reps");
    await page.click("#custom-ex-add");
    await page.waitForTimeout(300);
    const added = await page.evaluate(() => {
      const row = document.querySelector('#movement-plan-list .plan-row[data-custom="true"]');
      return { row: !!row, checked: row ? row.querySelector("input[type='checkbox']").checked : false, name: row ? row.querySelector(".plan-name").textContent : "" };
    });
    check("V169 plan editor: custom exercise joins the picker checked", added.row && added.checked && added.name.indexOf("Step-ups") !== -1, JSON.stringify(added));
    await page.click("#movement-plan-save");
    await page.waitForTimeout(400);
    const saved = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        names: [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent),
        customs: s.settings.customExercises || [],
        plan: (s.settings.movementPlan || []).map((m) => m.name)
      };
    }, LS);
    check("V169 plan editor: Step-ups saved, on the Today card and in the plan", saved.names.includes("Step-ups") && saved.customs.length === 1 && saved.customs[0].name === "Step-ups" && saved.customs[0].pattern === "Squat" && saved.plan.includes("Step-ups"), JSON.stringify(saved));
    await page.reload();
    await page.waitForTimeout(400);
    const survives = await page.evaluate(() => [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent));
    check("V169 plan editor: custom exercise survives reload", survives.includes("Step-ups"), JSON.stringify(survives));
    // X closes the modal and focus returns to Customize.
    await page.click("#movement-customize");
    await page.waitForTimeout(300);
    await page.click("#movement-plan-x");
    await page.waitForTimeout(300);
    const xClosed = await page.evaluate(() => ({
      closed: document.getElementById("movement-plan-modal").classList.contains("hidden"),
      focusBack: document.activeElement.id || ""
    }));
    check("V169 plan editor: X closes the modal, focus back on Customize", xClosed.closed && xClosed.focusBack === "movement-customize", JSON.stringify(xClosed));
    // Remove the custom exercise: gone from the picker, the plan, and Today.
    await page.click("#movement-customize");
    await page.waitForTimeout(300);
    await page.click('[data-remove-custom="Step-ups"]');
    await page.waitForTimeout(200);
    await page.click("#movement-plan-save");
    await page.waitForTimeout(400);
    const removed = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { names: [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent), customs: s.settings.customExercises || [] };
    }, LS);
    check("V169 plan editor: removing the custom exercise drops it everywhere", !removed.names.includes("Step-ups") && removed.customs.length === 0, JSON.stringify(removed));
    await ctx.close();
  } catch (e) { check("V169 movement plan editor", false, "error: " + e.message); }

  try {
    // BMI extras: 182 lbs at 5 ft 6 in is BMI 29.4, healthy 115 to 154, overweight by 27.7.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 182 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const bmi = await page.evaluate(() => ({
      line: (document.getElementById("bmi-line") || {}).textContent || "",
      over: (document.getElementById("bmi-over-line") || {}).textContent || "",
      range: (document.getElementById("bmi-healthy-range") || {}).textContent || "",
      blockHidden: document.getElementById("bmi-healthy-block").hidden,
      cutoffs: (document.querySelector("#bmi-healthy-block .bmi-cutoffs") || {}).textContent || ""
    }));
    check("V169 BMI extras: 182 lbs at 5 ft 6 in, overweight by 27.7, healthy 115 to 154", bmi.line.indexOf("29.4") !== -1 && bmi.over === "Overweight by 27.7 lbs" && bmi.range.indexOf("115 to 154 lbs") !== -1 && !bmi.blockHidden && bmi.cutoffs.indexOf("Underweight below 18.5") !== -1, JSON.stringify(bmi));
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 182 }] })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const noHeight = await page.evaluate(() => ({
      over: (document.getElementById("bmi-over-line") || {}).textContent || "",
      blockHidden: document.getElementById("bmi-healthy-block").hidden
    }));
    check("V169 BMI extras: no height shows no extras", noHeight.over === "" && noHeight.blockHidden, JSON.stringify(noHeight));
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 140 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const healthy = await page.evaluate(() => (document.getElementById("bmi-over-line") || {}).textContent || "");
    check("V169 BMI extras: in-range weight says In the healthy range, no over line", healthy === "In the healthy range", JSON.stringify(healthy));
    await ctx.close();
  } catch (e) { check("V169 BMI extras", false, "error: " + e.message); }

  try {
    // Weight tab layout: chart right after the hero, buttons side by side, at least 44px tall.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({ weight: [
      { id: "w1", date: today(-10), value: 200 },
      { id: "w2", date: today(0), value: 189 }
    ] })) });
    await page.reload();
    await clickTab(page, "weight");
    await page.waitForTimeout(400);
    const layout = await page.evaluate(() => {
      const chart = document.getElementById("weight-chart-card");
      const stats = document.querySelector("#tab-weight .stats-row");
      const a = document.getElementById("show-weight-form").getBoundingClientRect();
      const b = document.getElementById("doctor-summary-btn").getBoundingClientRect();
      return {
        chartBeforeStats: !!(chart.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING),
        sameRow: Math.abs(a.top - b.top) <= 1,
        heights: [Math.round(a.height), Math.round(b.height)]
      };
    });
    check("V169 weight layout: chart before the weight cards, buttons share a row at 44px or taller", layout.chartBeforeStats && layout.sameRow && layout.heights.every((h) => h >= 44), JSON.stringify(layout));
    await ctx.close();
  } catch (e) { check("V169 weight layout", false, "error: " + e.message); }

  // ---------- V169: six-tab nav with Companion, side effects on the Journal tab ----------
  try {
    // Companion is a main tab: clicking it shows the chat panel and
    // marks Companion active; it is gone from the More sheet.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    await page.click('.tab-btn[data-tab="chat"]');
    await page.waitForTimeout(400);
    const companion = await page.evaluate(() => ({
      chatActive: document.getElementById("tab-chat").classList.contains("active"),
      tabActive: document.querySelector('.tab-btn[data-tab="chat"]').classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active"),
      icon: !!document.querySelector('.tab-btn[data-tab="chat"] .tab-icon svg path[d^="M21 11.5"]'),
      dot: !!document.querySelector('.tab-btn[data-tab="chat"] .tab-dot')
    }));
    check("V169 six-tab nav: Companion tab shows the chat panel, gold dot, chat icon", companion.chatActive && companion.tabActive && !companion.moreActive && companion.icon && companion.dot, JSON.stringify(companion));
    // Morning check-in "Reply in chat" still opens the Companion tab.
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) {
      const reply = await page.evaluate(() => {
        const card = document.getElementById("morning-checkin");
        return { shown: !!card && !card.classList.contains("hidden") };
      });
      if (reply.shown) {
        await page.click("#morning-checkin-reply");
        await page.waitForTimeout(400);
        const afterReply = await page.evaluate(() => ({
          chatActive: document.getElementById("tab-chat").classList.contains("active"),
          tabActive: document.querySelector('.tab-btn[data-tab="chat"]').classList.contains("active")
        }));
        check("V169 six-tab nav: Reply in chat opens the Companion tab", afterReply.chatActive && afterReply.tabActive, JSON.stringify(afterReply));
      } else {
        check("V169 six-tab nav: Reply in chat opens the Companion tab", true, "check-in card not shown, nothing to tap");
      }
    } else {
      check("V169 six-tab nav: Reply in chat opens the Companion tab", true, "not morning, check-in hidden by design");
    }
    await ctx.close();
  } catch (e) { check("V169 six-tab nav Companion", false, "error: " + e.message); }

  try {
    // Journal tab: Side effects section with the same timeline, newest
    // first, severity dots; Edit and Delete work from there.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      journal: [{ id: "j1", date: today(0), mood: "Good", notes: "Feeling strong." }],
      sideEffects: [
        { id: "s1", date: today(-2), symptom: "Nausea", severity: "Mild", notes: "" },
        { id: "s2", date: today(0), symptom: "Fatigue", severity: "Moderate", notes: "Rest helped." }
      ]
    })) });
    await page.reload();
    await clickTab(page, "journal");
    await page.waitForTimeout(400);
    const journalSe = await page.evaluate(() => {
      const items = [...document.querySelectorAll("#journal-se-list .se-timeline-item")];
      return {
        heading: [...document.querySelectorAll("#tab-journal h3")].map((el) => el.textContent).includes("Side effects"),
        items: items.length,
        first: items.length ? items[0].textContent : "",
        moderateDot: items.some((el) => el.classList.contains("se-sev-moderate")),
        mildDot: items.some((el) => el.classList.contains("se-sev-mild")),
        editBtns: document.querySelectorAll("#journal-se-list [data-edit-se]").length,
        delBtns: document.querySelectorAll("#journal-se-list [data-del-se]").length
      };
    });
    check("V169 journal side effects: section shows both effects, newest first, severity dots", journalSe.heading && journalSe.items === 2 && journalSe.first.indexOf("Fatigue") !== -1 && journalSe.moderateDot && journalSe.mildDot && journalSe.editBtns === 2 && journalSe.delBtns === 2, JSON.stringify(journalSe));
    // Edit from the Journal tab: switches to the Effects tab, form opens with the entry.
    await page.click('#journal-se-list [data-edit-se="s2"]');
    await page.waitForTimeout(400);
    const editOpened = await page.evaluate(() => ({
      effectsActive: document.getElementById("tab-side-effects").classList.contains("active"),
      formVisible: !document.getElementById("sideeffect-form").classList.contains("hidden"),
      symptom: document.getElementById("se-symptom").value,
      severity: document.getElementById("se-severity").value
    }));
    check("V169 journal side effects: Edit opens the form on the Effects tab", editOpened.effectsActive && editOpened.formVisible && editOpened.symptom === "Fatigue" && editOpened.severity === "Moderate", JSON.stringify(editOpened));
    await ctx.close();
  } catch (e) { check("V169 journal side effects Edit", false, "error: " + e.message); }

  try {
    // Delete from the Journal tab: gone from both lists and the store.
    const { ctx, page } = await newPage(browser, url);
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      journal: [{ id: "j1", date: today(0), mood: "Good", notes: "Feeling strong." }],
      sideEffects: [
        { id: "s1", date: today(-2), symptom: "Nausea", severity: "Mild", notes: "" },
        { id: "s2", date: today(0), symptom: "Fatigue", severity: "Moderate", notes: "Rest helped." }
      ]
    })) });
    await page.reload();
    await clickTab(page, "journal");
    await page.waitForTimeout(400);
    await page.click('#journal-se-list [data-del-se="s1"]');
    await page.waitForTimeout(400);
    const afterDel = await page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        journalItems: document.querySelectorAll("#journal-se-list .se-timeline-item").length,
        journalText: (document.getElementById("journal-se-list") || {}).textContent || "",
        effectsItems: document.querySelectorAll("#sideeffect-list .se-timeline-item").length,
        effectsText: (document.getElementById("sideeffect-list") || {}).textContent || "",
        stored: s.sideEffects.map((e) => e.symptom)
      };
    }, LS);
    check("V169 journal side effects: Delete removes it from both lists and the store", afterDel.journalItems === 1 && afterDel.journalText.indexOf("Nausea") === -1 && afterDel.effectsItems === 1 && afterDel.effectsText.indexOf("Nausea") === -1 && afterDel.stored.join(",") === "Fatigue", JSON.stringify(afterDel));
    await ctx.close();
  } catch (e) { check("V169 journal side effects Delete", false, "error: " + e.message); }

  // ---------- v000: Companion name and avatar ----------
  try {
    // A chosen name shows in the chat header and the welcome message.
    // The input placeholder reads the not-available message: the demo
    // no longer accepts messages when not connected (Nov 8 fix), so
    // the name is not in the placeholder anymore.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "Nova", companionAvatar: "sage", theme: "sage", textSize: "normal", readAloud: false }
    })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "chat");
    await t.page.waitForTimeout(300);
    const named = await t.page.evaluate(() => ({
      title: (document.getElementById("chat-title") || {}).textContent || "",
      welcome: (document.querySelector("#chat-messages .chat-msg.assistant") || {}).textContent || "",
      placeholder: (document.getElementById("chat-input") || {}).placeholder || "",
      headerAvatarSage: (document.getElementById("chat-header-avatar") || { classList: { contains: () => false } }).classList.contains("avatar-sage"),
      rowAvatarSage: !!(document.querySelector("#chat-messages .chat-row.assistant .chat-lotus.avatar-sage"))
    }));
    check("V000 companion name shows in header and welcome; input offers the trial", named.title === "Your Nova" && named.welcome.indexOf("Hi, I am Nova.") === 0 && named.placeholder.indexOf("trial") !== -1, JSON.stringify(named));
    check("V000 companion avatar shows beside messages and in header", named.headerAvatarSage && named.rowAvatarSage, JSON.stringify(named));
    // Pick a different avatar in Settings: the header avatar follows.
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    // v057: "Your Companion" is a closed <details>; open it first.
    await openSettingsCard(t.page, "Your Companion");
    await t.page.click('input[name="companion-avatar"][value="deep-gold"]');
    await t.page.waitForTimeout(300);
    const deepGold = await t.page.evaluate(() => (document.getElementById("chat-header-avatar") || { classList: { contains: () => false } }).classList.contains("avatar-deep-gold"));
    check("V000 picking an avatar shows it in the header", deepGold === true, "deepGold=" + deepGold);
    // Clear the name in Settings: it falls back to the default.
    await t.page.fill("#set-companion-name", "");
    await t.page.click("#settings-form button[type='submit']");
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "chat");
    await t.page.waitForTimeout(300);
    const cleared = await t.page.evaluate((LS) => ({
      title: (document.getElementById("chat-title") || {}).textContent || "",
      stored: (() => { try { return JSON.parse(localStorage.getItem(LS)).settings.companionName; } catch { return "?"; } })()
    }), LS);
    check("V000 clearing the name falls back to AI Wellness Companion", cleared.title === "Your AI Wellness Companion" && cleared.stored === "", JSON.stringify(cleared));
    await t.ctx.close();
  } catch (e) { check("V000 companion name and avatar", false, "error: " + e.message); }

  try {
    // The demo offers a 3-message Companion trial when not connected
    // (v073): the input and send button are enabled while trial
    // messages remain, and the placeholder names the trial. The seeded
    // sample conversation still renders, so visitors can see how the
    // Companion works.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "Nova", companionAvatar: "gold", theme: "sage", textSize: "normal", readAloud: false }
    })), [CHAT_KEY]: JSON.stringify([
      { role: "user", content: "Can you give me a protein recipe idea? (Sample)" },
      { role: "assistant", content: "Sample reply: Try eggs with spinach and cheese, with whole grain toast. This is encouragement, not medical advice." }
    ]) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "chat");
    await t.page.waitForTimeout(300);
    const chatState = await t.page.evaluate(() => {
      const input = document.getElementById("chat-input");
      const send = document.getElementById("chat-send");
      const msgs = Array.from(document.querySelectorAll("#chat-messages .chat-msg.assistant")).map((m) => m.textContent);
      return {
        inputDisabled: input ? input.disabled : null,
        sendDisabled: send ? send.disabled : null,
        placeholder: input ? input.placeholder : "",
        sampleReply: msgs.some((m) => m.indexOf("Sample reply:") !== -1)
      };
    });
    check("V000 demo chat trial is enabled when not connected", chatState.inputDisabled === false && chatState.sendDisabled === false && chatState.placeholder.indexOf("trial") !== -1, JSON.stringify(chatState));
    check("V000 demo sample conversation renders", chatState.sampleReply === true, JSON.stringify(chatState));
    await t.ctx.close();
  } catch (e) { check("V000 companion name in chat request", false, "error: " + e.message); }

  // ---------- v000: Appearance ----------
  try {
    // A dark theme and Large text apply from settings, gold stays
    // gold, and the choice persists after reload.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "", companionAvatar: "gold", theme: "dark", textSize: "large", readAloud: false }
    })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const dark = await t.page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      rootFont: getComputedStyle(document.documentElement).fontSize,
      bodyFont: getComputedStyle(document.body).fontSize,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      gold: getComputedStyle(document.documentElement).getPropertyValue("--gold").trim()
    }));
    check("V000 dark theme and large text apply and gold stays gold", dark.theme === "dark" && dark.rootFont === "18px" && dark.bodyFont === "20.25px" && dark.bodyBg === "rgb(32, 38, 31)" && dark.gold === "#E8B54A", JSON.stringify(dark));
    // Pick Cream in Settings: it applies at once and survives reload.
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    // v057: "Appearance" is a closed <details>; open it first.
    await openSettingsCard(t.page, "Appearance");
    await t.page.click('input[name="theme"][value="cream"]');
    await t.page.waitForTimeout(300);
    const cream = await t.page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      bodyBg: getComputedStyle(document.body).backgroundColor
    }));
    check("V000 cream theme applies at once", cream.theme === "cream" && cream.bodyBg === "rgb(241, 237, 227)", JSON.stringify(cream));
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const persisted = await t.page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      bodyFont: getComputedStyle(document.body).fontSize
    }));
    check("V000 appearance choice persists after reload", persisted.theme === "cream" && persisted.bodyFont === "20.25px", JSON.stringify(persisted));
    await t.ctx.close();
  } catch (e) { check("V000 appearance", false, "error: " + e.message); }

  // ---------- v000: talking voice (speaker + auto-read) ----------
  try {
    // Stub the phone's speech so the call path can be verified
    // without asserting actual audio output.
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.__spoken = [];
      window.__cancelled = 0;
      window.SpeechSynthesisUtterance = function (t) {
        this.text = t;
        this._listeners = {};
        this.addEventListener = (ev, fn) => { (this._listeners[ev] = this._listeners[ev] || []).push(fn); };
      };
      window.speechSynthesis = {
        speak(u) { window.__spoken.push(u.text); },
        cancel() { window.__cancelled++; }
      };
    });
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    await page.goto(url, { waitUntil: "load" });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore({
      chatHistory: undefined,
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "", companionAvatar: "gold", theme: "sage", textSize: "normal", readAloud: false }
    })), [CHAT_KEY]: JSON.stringify([{ role: "assistant", content: "Drink some water today." }]) });
    await page.reload();
    await page.waitForTimeout(400);
    await clickTab(page, "chat");
    await page.waitForTimeout(300);
    // Read-aloud is off: nothing is spoken on its own.
    const quiet = await page.evaluate(() => window.__spoken.slice());
    // Tapping Listen speaks the reply; tapping again stops it.
    await page.click("#chat-messages .chat-listen");
    await page.waitForTimeout(300);
    const afterTap = await page.evaluate(() => ({ spoken: window.__spoken.slice(), cancelled: window.__cancelled }));
    await page.click("#chat-messages .chat-listen");
    await page.waitForTimeout(200);
    const afterStop = await page.evaluate(() => window.__cancelled);
    check("V000 speaker button reads a reply aloud on tap, stops on second tap", quiet.length === 0 && afterTap.spoken.some((s) => s.indexOf("Drink some water today.") !== -1) && afterStop > afterTap.cancelled, JSON.stringify({ quiet, afterTap, afterStop }));
    // Turn read-aloud on in Settings, then send a message: the new
    // reply is read aloud automatically.
    await clickMoreTab(page, "settings");
    await page.waitForTimeout(300);
    await page.click("#set-read-aloud");
    await page.waitForTimeout(200);
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Auto reply here." }) });
    });
    await clickTab(page, "chat");
    await page.waitForTimeout(300);
    await page.fill("#chat-input", "hello");
    await page.click("#chat-send");
    await page.waitForTimeout(700);
    const autoRead = await page.evaluate(() => window.__spoken.slice());
    check("V000 auto-read speaks a new reply when the setting is on", autoRead.some((s) => s.indexOf("Auto reply here.") !== -1), JSON.stringify(autoRead));
    await ctx.close();
  } catch (e) { check("V000 talking voice", false, "error: " + e.message); }

  // ---------- v000: two-way voice (mic) ----------
  try {
    // Mock the phone's speech recognition so the input path can be
    // verified without a microphone.
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      window.__srInstances = [];
      window.SpeechRecognition = class {
        constructor() { window.__srInstances.push(this); this.started = false; }
        start() { this.started = true; }
        stop() { if (this.onend) this.onend(); }
      };
      window.webkitSpeechRecognition = window.SpeechRecognition;
    });
    const page = await ctx.newPage();
    page.on("pageerror", () => {});
    await page.goto(url, { waitUntil: "load" });
    await setStorage(page, { [MARK]: "1", [LS]: JSON.stringify(makeStore()) });
    await page.reload();
    await page.waitForTimeout(400);
    await clickTab(page, "chat");
    await page.waitForTimeout(300);
    const micShown = await page.evaluate(() => {
      const b = document.getElementById("chat-mic");
      return { visible: !!b && !b.classList.contains("hidden"), label: b ? b.getAttribute("aria-label") : "", h: b ? Math.round(b.getBoundingClientRect().height) : 0 };
    });
    check("V000 mic button shows with its label when recognition is available", micShown.visible && micShown.label === "Talk instead of typing" && micShown.h >= 44, JSON.stringify(micShown));
    await page.click("#chat-mic");
    await page.waitForTimeout(300);
    const listening = await page.evaluate(() => {
      const b = document.getElementById("chat-mic");
      return { label: b ? b.getAttribute("aria-label") : "", status: (document.getElementById("chat-msg") || {}).textContent || "" };
    });
    // Fire a final recognition result: the words land in the input.
    await page.evaluate(() => {
      const inst = window.__srInstances[0];
      const r = [{ transcript: "drink water" }];
      r.isFinal = true;
      inst.onresult({ resultIndex: 0, results: [r] });
    });
    await page.waitForTimeout(200);
    const heard = await page.evaluate(() => ({
      input: (document.getElementById("chat-input") || {}).value || "",
      userMsgs: document.querySelectorAll("#chat-messages .chat-msg.user").length
    }));
    // Tap Stop: the text stays in the input, nothing was auto-sent.
    await page.click("#chat-mic");
    await page.waitForTimeout(300);
    const afterStop = await page.evaluate(() => ({
      input: (document.getElementById("chat-input") || {}).value || "",
      userMsgs: document.querySelectorAll("#chat-messages .chat-msg.user").length,
      label: (document.getElementById("chat-mic") || {}).getAttribute("aria-label") || ""
    }));
    check("V000 mic fills the input from speech and never auto-sends", listening.label === "Stop listening" && listening.status.indexOf("Listening") !== -1 && heard.input === "drink water" && heard.userMsgs === 0 && afterStop.input === "drink water" && afterStop.userMsgs === 0 && afterStop.label === "Talk instead of typing", JSON.stringify({ listening, heard, afterStop }));
    await ctx.close();
    // Without the recognition API, the mic button stays hidden and
    // the chat works exactly as before.
    const t2 = await newPage(browser, url);
    await setStorage(t2.page, { [LS]: JSON.stringify(makeStore()) });
    await t2.page.reload();
    await t2.page.waitForTimeout(400);
    const noMic = await t2.page.evaluate(() => {
      const b = document.getElementById("chat-mic");
      const api = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
      return { hidden: !!b && b.classList.contains("hidden"), api };
    });
    check("V000 mic hides gracefully when recognition is unavailable", noMic.hidden === true && noMic.api === false, JSON.stringify(noMic));
    await t2.ctx.close();
  } catch (e) { check("V000 two-way voice", false, "error: " + e.message); }

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " checks passed.");
  if (failed.length) { console.log("Failing: " + failed.map((f) => f.name).join("; ")); process.exitCode = 1; }
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
