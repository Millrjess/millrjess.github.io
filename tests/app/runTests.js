/* Tracker app (live) data-loss + vulnerability reproduction tests.
   Run:  node runTests.js before   (against the v151 snapshot in /tmp)
         node runTests.js after    (against the fixed tracker-app)
   Each test prints PASS/FAIL. Before the fix, the V-tests FAIL (the
   vulnerability reproduces). After the fix they must PASS. R-tests are
   v150 regressions that must PASS both before and after. */
"use strict";
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const MODE = process.argv[2] || "after";
const APP_DIR = MODE === "before"
  ? (process.env.BEFORE_DIR || "/tmp/tracker-audit-v151/full")
  : path.join(__dirname, "..", "..", "tracker-app");
const CHROME = process.env.CHROME_PATH || undefined;
const LS = "newChapterTracker.v1";
const GEN = "nct-store-gen";
const SNAP = "nct-snapshots";
const EVER = "nct-ever-had-entries";
const CHAT_KEY = "newChapterTracker.chat.v1";
const TOKEN_KEY = "newChapterTracker.authToken.v1";
const COLLECTIONS = ["water", "protein", "exercise", "injections", "weight", "measurements", "photos", "journal", "sideEffects"];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

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

function serve(overrides) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      if (overrides && overrides[urlPath] !== undefined) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(overrides[urlPath]);
        return;
      }
      let fp = path.join(APP_DIR, urlPath === "/" ? "index.html" : urlPath);
      if (!fp.startsWith(APP_DIR)) { res.writeHead(403); res.end(); return; }
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

async function newPage(browser, url, opts) {
  const ctx = await browser.newContext(Object.assign({ acceptDownloads: true }, (opts && opts.context) || {}));
  const page = await ctx.newPage();
  // v005 first-run setup overlay would block every tab click in tests.
  // The suite predates the wizard and never tests it, so mark setup
  // done before the app loads and the overlay never appears.
  await page.addInitScript(() => {
    try { localStorage.setItem("nct-setup-done", "1"); } catch {}
  });
  let dialogs = 0;
  let lastDialog = "";
  page.on("dialog", async (d) => { dialogs++; lastDialog = d.message(); await d.accept(); });
  page.on("pageerror", () => {});
  if (opts && opts.noSW) {
    // Block service-worker registration so the only path that can show
    // the update card is the version.json staleness check.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "serviceWorker", {
        value: { register: () => Promise.reject(new Error("SW disabled for test")), addEventListener: () => {}, getRegistration: () => Promise.resolve(undefined), controller: null },
        configurable: true
      });
    });
  }
  await page.goto(url, { waitUntil: "load" });
  return { ctx, page, dialogs: () => dialogs, lastDialog: () => lastDialog };
}

async function setStorage(page, entries) {
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    // v005 setup overlay would block tab clicks after the reload;
    // the suite never tests the wizard itself.
    localStorage.setItem("nct-setup-done", "1");
  }, entries);
}
async function getStorage(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}
async function storeEntries(page) {
  return page.evaluate(({ LS, COLLECTIONS }) => {
    try {
      const s = JSON.parse(localStorage.getItem(LS));
      if (!s) return -1;
      let n = 0;
      COLLECTIONS.forEach((k) => { if (Array.isArray(s[k])) n += s[k].length; });
      return n;
    } catch { return -99; }
  }, { LS, COLLECTIONS });
}
async function waterCount(page) {
  return page.evaluate((LS) => {
    try { const s = JSON.parse(localStorage.getItem(LS)); return Array.isArray(s.water) ? s.water.length : -1; } catch { return -99; }
  }, LS);
}
async function cardVisible(page, id) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    return !!el && !el.classList.contains("hidden");
  }, id);
}
async function fillToQuota(page) {
  // Fill localStorage until even a tiny write fails, so the next app
  // save cannot squeeze in. Big chunks first, then small ones to use
  // up the last headroom (a 1MB-chunk fill leaves ~1MB free, and the
  // app's small saves would still succeed).
  return page.evaluate(() => {
    const sizes = [256 * 1024, 1024, 100, 10];
    let total = 0;
    for (const size of sizes) {
      const chunk = "x".repeat(size);
      let i = 0;
      try {
        for (i = 0; ; i++) localStorage.setItem("quota-fill-" + size + "-" + i, chunk);
      } catch (e) { /* this size no longer fits */ }
      total += i;
    }
    return total;
  });
}
async function clickTab(page, tabId) {
  // Tab buttons carry data-tab; #tab-* are the panels, not the buttons.
  await page.click(`.tab-btn[data-tab="${tabId}"]`);
  await page.waitForTimeout(200);
}

// v169: Effects and Settings live under the More sheet; Companion is a main tab.
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

  // ---------- V1: malformed entry date bricks a tab ----------
  try {
    const t = await newPage(browser, url);
    const bad = makeStore({
      weight: [
        { id: "w1", date: today(0), value: 190 },
        { id: "w2", date: 20261106, value: 189 },       // number, not a string
        { id: "w3", date: "garbage", value: 188 }       // not a date at all
      ]
    });
    await setStorage(t.page, { [LS]: JSON.stringify(bad) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    const listText = await t.page.evaluate(() => document.getElementById("weight-list").innerText);
    const showsValid = listText.includes("190");
    // The drop must be LOUD: the corrupt notice tells the user entries
    // could not be read. (The storage warning may show too, from the
    // save guard; either way the user is told, and the screen is not torn.)
    const loud = await cardVisible(t.page, "corrupt-notice");
    check("V1 bad entry date: valid entries still render, drop is loud", showsValid && loud, "list shows 190=" + showsValid + ", corrupt notice=" + loud);
    await t.ctx.close();
  } catch (e) { check("V1 bad entry date: valid entries still render, no torn screen", false, "error: " + e.message); }

  // ---------- V2: stored XSS via a crafted entry id ----------
  try {
    const t = await newPage(browser, url);
    const evil = makeStore({
      journal: [{ id: 'x"><img src=x onerror="alert(1)', date: today(0), mood: "Good", notes: "hello" }]
    });
    await setStorage(t.page, { [LS]: JSON.stringify(evil) });
    const dialogsBefore = t.dialogs();
    await t.page.reload();
    await clickMoreTab(t.page, "journal");
    await t.page.waitForTimeout(300);
    const fired = t.dialogs() - dialogsBefore;
    const listText = await t.page.evaluate(() => document.getElementById("journal-list").innerText);
    check("V2 crafted entry id: no script runs, entry still shows", fired === 0 && listText.includes("hello"), "alerts fired=" + fired);
    await t.ctx.close();
  } catch (e) { check("V2 crafted entry id: no script runs, entry still shows", false, "error: " + e.message); }

  // ---------- V3: photo dataUrl pointing at a remote URL ----------
  try {
    const t = await newPage(browser, url);
    let externalRequests = 0;
    t.page.on("request", (r) => { if (r.url().indexOf("example.com") !== -1) externalRequests++; });
    const evil = makeStore({
      photos: [{ id: "p1", date: today(0), dataUrl: "https://example.com/tracker.png" }]
    });
    await setStorage(t.page, { [LS]: JSON.stringify(evil) });
    await t.page.reload();
    await clickTab(t.page, "today");
    await t.page.waitForTimeout(400);
    const imgSrc = await t.page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll("#photo-grid img"));
      return imgs.map((i) => i.getAttribute("src") || "");
    });
    const leaked = imgSrc.some((s) => s.indexOf("example.com") !== -1) || externalRequests > 0;
    check("V3 remote photo URL: no external image loads", !leaked, "external requests=" + externalRequests + ", img srcs=" + JSON.stringify(imgSrc));
    await t.ctx.close();
  } catch (e) { check("V3 remote photo URL: no external image loads", false, "error: " + e.message); }

  // ---------- V4: token save failure reported as success ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    await fillToQuota(t.page);
    // The companion-key field sits inside a collapsed section in
    // Settings, so set it and submit from the page instead of clicking.
    await t.page.evaluate(() => {
      document.getElementById("set-companion-key").value = "nc_testkey1234567890";
      document.getElementById("settings-form").requestSubmit();
    });
    await t.page.waitForTimeout(300);
    const msg = await t.page.evaluate(() => document.getElementById("settings-saved-msg").textContent);
    const honest = msg.indexOf("could not be saved") !== -1;
    check("V4 token save failure: told plainly, not reported as saved", honest, "message=" + JSON.stringify(msg));
    await t.ctx.close();
  } catch (e) { check("V4 token save failure: told plainly, not reported as saved", false, "error: " + e.message); }

  // ---------- V5: snapshot restore by position, not by identity ----------
  try {
    const t = await newPage(browser, url);
    const snapA = { at: "2026-11-05T10:00:00.000Z", data: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(-1), oz: 8 }] })) };
    const snapB = { at: "2026-11-06T09:00:00.000Z", data: JSON.stringify(makeStore({ water: [{ id: "b1", date: today(0), oz: 8 }, { id: "b2", date: today(0), oz: 8 }, { id: "b3", date: today(0), oz: 8 }] })) };
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()), [SNAP]: JSON.stringify([snapB, snapA]) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    // Another tab takes an auto-snapshot between render and click: it
    // lands at the front of the list, shifting every position by one.
    const snapC = { at: "2026-11-06T10:00:00.000Z", data: JSON.stringify(makeStore({ water: [{ id: "c1", date: today(0), oz: 8 }, { id: "c2", date: today(0), oz: 8 }, { id: "c3", date: today(0), oz: 8 }, { id: "c4", date: today(0), oz: 8 }, { id: "c5", date: today(0), oz: 8 }] })) };
    await t.page.evaluate(({ SNAP, snapC }) => {
      const snaps = JSON.parse(localStorage.getItem(SNAP));
      snaps.unshift(snapC);
      localStorage.setItem(SNAP, JSON.stringify(snaps));
    }, { SNAP, snapC });
    // Click the Restore button that was rendered for snapshot B (the
    // first button in the list as rendered, index 0). After C lands at
    // the front, position 0 points at C, not B.
    await t.page.evaluate(() => {
      const btns = document.querySelectorAll("[data-restore-snap]");
      btns[0].click();
    });
    await t.page.waitForTimeout(400);
    const n = await waterCount(t.page);
    check("V5 snapshot restore: restores the snapshot clicked, not its neighbour", n === 3, "water entries after restore=" + n + " (want 3, snapshot B)");
    await t.ctx.close();
  } catch (e) { check("V5 snapshot restore: restores the snapshot clicked, not its neighbour", false, "error: " + e.message); }

  // ---------- V6: backup download when the in-app snapshot cannot save ----------
  // The store must have changed since the last snapshot, or there is
  // nothing new to write and no failure to warn about.
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    await fillToQuota(t.page);
    // Change the in-memory store without saving, so the next snapshot
    // has new data to write and the write must fail on the full store.
    await t.page.evaluate(({ d }) => { store.water.push({ id: "a2", date: d, oz: 8 }); }, { d: today(0) });
    await t.page.click("#backup-data");
    await t.page.waitForTimeout(300);
    const warned = await cardVisible(t.page, "storage-warning");
    check("V6 backup download with a full store: snapshot failure is shown", warned, warned ? "" : "no storage warning");
    await t.ctx.close();
  } catch (e) { check("V6 backup download with a full store: snapshot failure is shown", false, "error: " + e.message); }

  // ---------- V7: version staleness check (served with a newer version.json) ----------
  // Service workers are disabled for this test: the update card must
  // appear from the version.json check alone.
  try {
    const { server: server2, port: port2 } = await serve({ "/version.json": JSON.stringify({ version: "v999" }) });
    const url2 = `http://127.0.0.1:${port2}/index.html`;
    const t = await newPage(browser, url2, { noSW: true });
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(800);
    const shown = await cardVisible(t.page, "update-notice");
    check("V7 newer version published: update card appears", shown, shown ? "" : "update-notice stayed hidden");
    await t.ctx.close();
    server2.close();
  } catch (e) { check("V7 newer version published: update card appears", false, "error: " + e.message); }

  // ---------- V7b: Update now keeps the worker and reloads onto the new files ----------
  // v154: Update now never unregisters. The new worker already skips
  // waiting and claims the page on install, so a plain reload serves the
  // new files (network-first). Unregistering threw the new worker away
  // and fell back to the browser cache, which served the old copy again.
  try {
    const t = await newPage(browser, url);
    await t.page.addInitScript(() => { window.__controllerAtInit = navigator.serviceWorker ? !!navigator.serviceWorker.controller : false; });
    await t.page.reload();
    await t.page.waitForTimeout(1200);
    const controlledBefore = await t.page.evaluate(() => !!navigator.serviceWorker.controller);
    await t.page.evaluate(() => document.getElementById("update-notice").classList.remove("hidden"));
    await Promise.all([
      t.page.waitForNavigation({ waitUntil: "load", timeout: 15000 }),
      t.page.click("#update-now")
    ]);
    await t.page.waitForTimeout(800);
    const atInitAfter = await t.page.evaluate(() => window.__controllerAtInit);
    const cardHiddenAfter = !(await cardVisible(t.page, "update-notice"));
    check("V7b Update now: worker stays, reload lands on current files", controlledBefore === true && atInitAfter === true && cardHiddenAfter, "controlled before=" + controlledBefore + ", controller at init after reload=" + atInitAfter + ", update card hidden after=" + cardHiddenAfter);
    await t.ctx.close();
  } catch (e) { check("V7b Update now: worker stays, reload lands on current files", false, "error: " + e.message); }

  // ---------- V8: delete in one tab, stale tab must not resurrect ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }, { id: "a2", date: today(0), oz: 8 }] })), [GEN]: "3" });
    await t.page.reload();
    const pageB = await t.ctx.newPage();
    pageB.on("dialog", async (d) => { await d.accept(); });
    await pageB.goto(url, { waitUntil: "load" });
    await clickMoreTab(pageB, "settings");
    await pageB.click("#clear-all-data"); // two confirms, auto-accepted; page reloads empty
    await pageB.waitForTimeout(800);
    await t.page.click("#goals-water-add"); // stale tab A saves its old copy
    await t.page.waitForTimeout(400);
    const raw = await getStorage(t.page, LS);
    let n = -1;
    try { const s = JSON.parse(raw); n = Array.isArray(s.water) ? s.water.length : 0; } catch { n = 0; }
    const warned = await cardVisible(t.page, "storage-warning");
    check("V8 delete wins: stale tab does not bring deleted entries back", raw === null || n === 0, "entries after stale save=" + n + ", warning shown=" + warned);
    await t.ctx.close();
  } catch (e) { check("V8 delete wins: stale tab does not bring deleted entries back", false, "error: " + e.message); }

  // ---------- V9: companion token must not reach Google Analytics ----------
  try {
    const t = await newPage(browser, url + "?key=nc_testtoken1234567890");
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(300);
    const leaked = await t.page.evaluate(() => {
      const dl = window.dataLayer || [];
      return JSON.stringify(dl).indexOf("nc_testtoken1234567890") !== -1;
    });
    check("V9 companion token: never sent to Analytics", !leaked, leaked ? "token found in dataLayer" : "");
    await t.ctx.close();
  } catch (e) { check("V9 companion token: never sent to Analytics", false, "error: " + e.message); }

  // ---------- V11: snapshot with an unreadable timestamp ----------
  try {
    const t = await newPage(browser, url);
    const good = { at: "2026-11-06T09:00:00.000Z", data: JSON.stringify(makeStore({ water: [{ id: "b1", date: today(0), oz: 8 }] })) };
    const bad = { at: "garbage", data: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 8 }] })) };
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()), [SNAP]: JSON.stringify([good, bad]) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    const btnCount = await t.page.evaluate(() => document.querySelectorAll("[data-restore-snap]").length);
    check("V11 bad snapshot timestamp: only readable snapshots are offered", btnCount === 1, "restore buttons=" + btnCount + " (want 1)");
    await t.ctx.close();
  } catch (e) { check("V11 bad snapshot timestamp: only readable snapshots are offered", false, "error: " + e.message); }

  // ---------- V12: crafted settings must not break the countdowns ----------
  try {
    const t = await newPage(browser, url);
    const bad = makeStore();
    bad.settings.shotDay = "Funday";
    bad.settings.refillDate = "not-a-date";
    await setStorage(t.page, { [LS]: JSON.stringify(bad) });
    await t.page.reload();
    const line = await t.page.evaluate(() => document.getElementById("next-injection-line").textContent);
    check("V12 bad settings values: no wrong countdown, asks to set the day", line.indexOf("Set your shot day") !== -1, "next-injection line=" + JSON.stringify(line));
    await t.ctx.close();
  } catch (e) { check("V12 bad settings values: no wrong countdown, asks to set the day", false, "error: " + e.message); }

  // ---------- V13: corrupt chat history is stashed, not silently dropped ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()), [CHAT_KEY]: "{not json" });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const stash = await getStorage(t.page, CHAT_KEY + ".corrupt");
    check("V13 corrupt chat history: damaged copy stashed aside", stash === "{not json", stash === null ? "no .corrupt stash" : "stash=" + JSON.stringify(stash));
    await t.ctx.close();
  } catch (e) { check("V13 corrupt chat history: damaged copy stashed aside", false, "error: " + e.message); }

  // ---------- V14: corrupt custom activities are stashed, not silently dropped ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()), ["nc_custom_activities"]: "{not json" });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const stash = await getStorage(t.page, "nc_custom_activities.corrupt");
    check("V14 corrupt custom activities: damaged copy stashed aside", stash === "{not json", stash === null ? "no .corrupt stash" : "stash=" + JSON.stringify(stash));
    await t.ctx.close();
  } catch (e) { check("V14 corrupt custom activities: damaged copy stashed aside", false, "error: " + e.message); }

  // ---------- R1: safety net restores an unreadable store ----------
  try {
    const t = await newPage(browser, url);
    const snap = { at: "2026-11-06T09:00:00.000Z", data: JSON.stringify(makeStore({ water: [{ id: "b1", date: today(0), oz: 8 }, { id: "b2", date: today(0), oz: 8 }] })) };
    await setStorage(t.page, { [LS]: "{not json", [SNAP]: JSON.stringify([snap]), [EVER]: "1" });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const n = await waterCount(t.page);
    const noticed = await cardVisible(t.page, "restore-notice");
    check("R1 unreadable store: safety net restores from snapshot", n === 2 && noticed, "water=" + n + ", restore notice=" + noticed);
    await t.ctx.close();
  } catch (e) { check("R1 unreadable store: safety net restores from snapshot", false, "error: " + e.message); }

  // ---------- R2: deliberate delete stays deleted ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    await t.page.click("#clear-all-data");
    await t.page.waitForTimeout(800);
    const n = await storeEntries(t.page);
    check("R2 deliberate delete: data stays gone after reload", n === -1 || n === 0, "entries=" + n);
    await t.ctx.close();
  } catch (e) { check("R2 deliberate delete: data stays gone after reload", false, "error: " + e.message); }

  // ---------- R3: wrong-shape backup file is rejected ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    const badFile = { app: "new-chapter-tracker", version: 1, store: makeStore({ water: "not-an-array" }) };
    await t.page.setInputFiles("#restore-input", { name: "bad-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(badFile)) });
    await t.page.waitForTimeout(500);
    const n = await waterCount(t.page);
    check("R3 wrong-shape backup file: rejected, data untouched", n === 1, "water entries=" + n + " (want 1)");
    await t.ctx.close();
  } catch (e) { check("R3 wrong-shape backup file: rejected, data untouched", false, "error: " + e.message); }

  // ---------- R4: confirmed empty-file restore works ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "settings");
    const emptyFile = { app: "new-chapter-tracker", version: 1, store: makeStore() };
    await t.page.setInputFiles("#restore-input", { name: "empty-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(emptyFile)) });
    await t.page.waitForTimeout(500);
    const n = await storeEntries(t.page);
    check("R4 confirmed empty restore: allowed, store is empty", n === 0, "entries=" + n + " (want 0)");
    await t.ctx.close();
  } catch (e) { check("R4 confirmed empty restore: allowed, store is empty", false, "error: " + e.message); }

  // ---------- R5: main-save quota failure warns ----------
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await fillToQuota(t.page);
    await t.page.click("#goals-water-add");
    await t.page.waitForTimeout(300);
    const warned = await cardVisible(t.page, "storage-warning");
    check("R5 save quota failure: plain-words warning shown", warned, warned ? "" : "no storage warning");
    await t.ctx.close();
  } catch (e) { check("R5 save quota failure: plain-words warning shown", false, "error: " + e.message); }

  // ---------- V165: Today tab matches the preview ----------
  // One Today's Goals card with two rings (v168: protein moved to the
  // macros card); no detail cards, no summary cards, no per-entry
  // lists, no weekly card, no Log protein button, no View shot history
  // button. Sliding a ring right raises the stored total; the add
  // buttons log one quick entry each.
  try {
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }], protein: [{ id: "a2", date: today(0), grams: 30, food: "Quick add" }], exercise: [{ id: "a3", date: today(0), minutes: 5, label: "Movement" }] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const structure = await t.page.evaluate(() => {
      const titles = [...document.querySelectorAll("#tab-today .card-title")].map((el) => el.textContent);
      return {
        goalsCards: document.querySelectorAll("#goals-card").length,
        rings: document.querySelectorAll(".goals-rings .ring-box").length,
        proteinRing: !!document.getElementById("protein-ring"),
        macrosCard: document.querySelectorAll("#macros-card").length,
        detailCards: ["Water Intake", "Protein", "Movement"].filter((x) => titles.includes(x)).length,
        summaryCards: document.querySelectorAll(".progress-grid").length,
        entryLists: document.querySelectorAll("#water-list,#protein-list,#exercise-list").length,
        weekCard: document.querySelectorAll("#weekly-summary-card").length,
        logFoodBtn: document.querySelectorAll("#log-food-btn").length,
        viewHistory: [...document.querySelectorAll("#tab-today button")].filter((b) => b.textContent.includes("View shot history")).length,
        greeting: (document.getElementById("greeting-line") || {}).textContent || "",
        hint: (document.querySelector(".goals-hint") || {}).textContent || "",
        waterNum: (document.getElementById("water-today") || {}).textContent || "",
        exerciseNum: (document.getElementById("exercise-today") || {}).textContent || ""
      };
    });
    const shapeOk = structure.goalsCards === 1 && structure.rings === 2 &&
      !structure.proteinRing && structure.macrosCard === 1 &&
      structure.detailCards === 0 && structure.summaryCards === 0 && structure.entryLists === 0 &&
      structure.weekCard === 0 && structure.logFoodBtn === 0 && structure.viewHistory === 0 &&
      structure.greeting.indexOf("Good") === 0 && structure.greeting.indexOf("Jessica") === -1 &&
      structure.hint.indexOf("Slide left or right") !== -1 &&
      structure.waterNum === "16" && structure.exerciseNum === "5";
    check("V165 Today matches preview: one goals card, two rings, macros card, no extras", shapeOk, JSON.stringify(structure));
    // Add buttons: +8 oz water, +5 min movement. Protein lives in the
    // macros card now, so the protein add button is gone.
    await t.page.click("#goals-water-add");
    await t.page.click("#goals-exercise-add");
    await t.page.waitForTimeout(400);
    const totals = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        protein: s.protein.reduce((a, e) => a + (Number(e.grams) || 0), 0),
        exercise: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0)
      };
    }, LS);
    check("V165 add buttons: +8 oz, +5 min stored, protein untouched", totals.water === 24 && totals.protein === 30 && totals.exercise === 10, JSON.stringify(totals));
    // Horizontal drag on the water ring: right ~80px is +10 oz at 8px/unit.
    // v169: the number in the center is now a button that opens the
    // type-in sheet, so the drag starts on the ring itself, not the center.
    const ring = await t.page.$("#water-ring");
    const box = await ring.boundingBox();
    await t.page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
    await t.page.mouse.down();
    await t.page.mouse.move(box.x + box.width * 0.85 + 80, box.y + box.height / 2, { steps: 10 });
    await t.page.mouse.up();
    await t.page.waitForTimeout(400);
    const afterDrag = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        num: (document.getElementById("water-today") || {}).textContent || ""
      };
    }, LS);
    check("V165 ring slides left/right: drag right raises stored total", afterDrag.water === 34 && afterDrag.num === "34", JSON.stringify(afterDrag));
    await t.ctx.close();
  } catch (e) { check("V165 Today matches preview", false, "error: " + e.message); }

  // ---------- V166: section features + fine-control buttons ----------
  // Rotation guide, weight milestones + gold line, journal chapters,
  // effects timeline, streak, morning check-in, +/- 1 nudge buttons.
  try {
    // Rotation guide: last site Right Abdomen -> next is Left Thigh.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ injections: [
      { id: "i1", date: today(-7), medication: "Zepbound", dose: 5, site: "Left Abdomen", status: "On time" },
      { id: "i2", date: today(0), medication: "Zepbound", dose: 5, site: "Right Abdomen", status: "On time" }
    ] })) });
    await t.page.reload();
    await clickTab(t.page, "shots");
    await t.page.waitForTimeout(400);
    const guide = await t.page.evaluate(() => ({
      text: (document.getElementById("rotation-guide") || {}).textContent || "",
      useBtnVisible: !!document.getElementById("rotation-use-site") && !document.getElementById("rotation-use-site").classList.contains("hidden")
    }));
    check("V166 rotation guide: next site after Right Abdomen is Left Thigh", guide.text.indexOf("Left Thigh") !== -1 && guide.text.indexOf("Right Abdomen") !== -1 && guide.useBtnVisible, JSON.stringify(guide));
    // Use this site: pre-selects Left Thigh in the form.
    await t.page.click("#rotation-use-site");
    await t.page.waitForTimeout(300);
    const siteVal = await t.page.evaluate(() => document.getElementById("inj-site").value);
    check("V166 rotation guide: Use this site pre-selects Left Thigh", siteVal === "Left Thigh", "site=" + siteVal);
    await t.ctx.close();
  } catch (e) { check("V166 rotation guide", false, "error: " + e.message); }

  try {
    // Rotation guide with no injections yet.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await clickTab(t.page, "shots");
    await t.page.waitForTimeout(400);
    const guide = await t.page.evaluate(() => ({
      text: (document.getElementById("rotation-guide") || {}).textContent || "",
      useBtnVisible: !!document.getElementById("rotation-use-site") && !document.getElementById("rotation-use-site").classList.contains("hidden")
    }));
    check("V166 rotation guide: no shots yet shows first-shot hint", guide.text.indexOf("first shot") !== -1 && !guide.useBtnVisible, JSON.stringify(guide));
    await t.ctx.close();
  } catch (e) { check("V166 rotation guide empty", false, "error: " + e.message); }

  try {
    // Weight milestones: 200 -> 189 is 11 lbs lost, so 5 and 10 reached.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ weight: [
      { id: "w1", date: today(-10), value: 200 },
      { id: "w2", date: today(-6), value: 195 },
      { id: "w3", date: today(-3), value: 190 },
      { id: "w4", date: today(0), value: 189 }
    ], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, refillDate: "", goalWeight: "" } })) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    const ms = await t.page.evaluate(() => {
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
    await t.ctx.close();
  } catch (e) { check("V166 weight milestones", false, "error: " + e.message); }

  try {
    // Journal chapters: entries in two months get two chapter headings.
    const t = await newPage(browser, url);
    const now = new Date();
    const thisMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonth = lastMonthDate.getFullYear() + "-" + String(lastMonthDate.getMonth() + 1).padStart(2, "0");
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ journal: [
      { id: "j1", date: today(0), mood: "Good", notes: "Feeling strong." },
      { id: "j2", date: lastMonth + "-15", mood: "Okay", notes: "A slow week." }
    ] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "journal");
    await t.page.waitForTimeout(400);
    const chapters = await t.page.evaluate(() => [...document.querySelectorAll(".journal-chapter")].map((el) => el.textContent));
    const thisName = new Date(thisMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const lastName = new Date(lastMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    check("V166 journal chapters: one heading per month", chapters.length === 2 && chapters.includes(thisName) && chapters.includes(lastName), JSON.stringify(chapters));
    await t.ctx.close();
  } catch (e) { check("V166 journal chapters", false, "error: " + e.message); }

  try {
    // Effects timeline: entries render on a timeline, newest first.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ sideEffects: [
      { id: "s1", date: today(-2), symptom: "Nausea", severity: "Mild", notes: "" },
      { id: "s2", date: today(0), symptom: "Fatigue", severity: "Moderate", notes: "Rest helped." }
    ] })) });
    await t.page.reload();
    await clickMoreTab(t.page, "side-effects");
    await t.page.waitForTimeout(400);
    const tl = await t.page.evaluate(() => {
      // v169: the Journal tab shows the same effects again, so count
      // only inside the Effects panel.
      const panel = document.getElementById("tab-side-effects");
      const items = [...panel.querySelectorAll(".se-timeline-item")];
      return {
        timeline: panel.querySelectorAll(".se-timeline").length,
        items: items.length,
        firstSymptom: items.length ? items[0].textContent : "",
        moderateDot: items.some((el) => el.classList.contains("se-sev-moderate")),
        mildDot: items.some((el) => el.classList.contains("se-sev-mild"))
      };
    });
    check("V166 effects timeline: two dated items, severity dots", tl.timeline === 1 && tl.items === 2 && tl.firstSymptom.indexOf("Fatigue") !== -1 && tl.moderateDot && tl.mildDot, JSON.stringify(tl));
    await t.ctx.close();
  } catch (e) { check("V166 effects timeline", false, "error: " + e.message); }

  try {
    // Streak: entries today, yesterday, day before -> 3 days in a row.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [
      { id: "a1", date: today(0), oz: 16 },
      { id: "a2", date: today(-1), oz: 8 },
      { id: "a3", date: today(-2), oz: 8 }
    ] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const streak = await t.page.evaluate(() => (document.getElementById("streak-line") || {}).textContent || "");
    check("V166 streak: three consecutive logged days", streak.indexOf("3 days in a row") !== -1, "streak=" + JSON.stringify(streak));
    // Morning before logging: only yesterday logged -> streak is 1.
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(-1), oz: 8 }] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const streak2 = await t.page.evaluate(() => (document.getElementById("streak-line") || {}).textContent || "");
    check("V166 streak: yesterday only still counts as Day 1", streak2.indexOf("Day 1") !== -1, "streak=" + JSON.stringify(streak2));
    await t.ctx.close();
  } catch (e) { check("V166 streak", false, "error: " + e.message); }

  try {
    // Nudge buttons: +1 and -1 by exactly one unit, clamped at zero.
    // v168: protein has no ring any more, so the nudge pair is water
    // and movement.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "a1", date: today(0), oz: 16 }], exercise: [{ id: "a3", date: today(0), minutes: 5, label: "Movement" }] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await t.page.click("#water-plus-1");
    await t.page.click("#exercise-plus-1");
    await t.page.waitForTimeout(300);
    let totals = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        exercise: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0)
      };
    }, LS);
    check("V166 nudge +1: water 16 to 17, movement 5 to 6", totals.water === 17 && totals.exercise === 6, JSON.stringify(totals));
    await t.page.click("#water-minus-1");
    await t.page.waitForTimeout(300);
    totals = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0) };
    }, LS);
    check("V166 nudge -1: water 17 back to 16", totals.water === 16, JSON.stringify(totals));
    // Clamp: 20 taps of minus from 16 cannot go below zero.
    for (let i = 0; i < 20; i++) await t.page.click("#water-minus-1");
    await t.page.waitForTimeout(300);
    totals = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0) };
    }, LS);
    check("V166 nudge -1: clamped at zero", totals.water === 0, JSON.stringify(totals));
    await t.ctx.close();
  } catch (e) { check("V166 nudge buttons", false, "error: " + e.message); }

  try {
    // Morning check-in: time-aware. In the morning the card shows with
    // a question; later in the day it stays hidden.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    // v169: Companion is a main tab now, not a More sheet item.
    await clickTab(t.page, "chat");
    await t.page.waitForTimeout(400);
    const ci = await t.page.evaluate(() => {
      const card = document.getElementById("morning-checkin");
      const q = (document.getElementById("morning-checkin-q") || {}).textContent || "";
      return { hour: new Date().getHours(), hidden: !card || card.classList.contains("hidden"), question: q };
    });
    const morningOk = ci.hour >= 5 && ci.hour < 12 ? (!ci.hidden && ci.question.length > 5) : ci.hidden;
    check("V166 morning check-in: shows in the morning, hidden later", morningOk, JSON.stringify(ci));
    await t.ctx.close();
  } catch (e) { check("V166 morning check-in", false, "error: " + e.message); }

  try {
    // V167 double-tap zoom fix: the nudge buttons and the gold add
    // buttons on the Today's Goals rings must carry touch-action:
    // manipulation, so rapid taps on iOS Safari are not read as a
    // double-tap that zooms the page.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const ta = await t.page.evaluate(() => {
      const out = {};
      document.querySelectorAll(".ring-nudge-btn").forEach((b) => { out[b.id] = getComputedStyle(b).touchAction; });
      document.querySelectorAll(".goals-add").forEach((b) => { out[b.id] = getComputedStyle(b).touchAction; });
      return out;
    });
    const vals = Object.values(ta);
    check("V167 touch-action: nudge and add buttons are manipulation", vals.length === 6 && vals.every((v) => v === "manipulation"), JSON.stringify(ta));
    await t.ctx.close();
  } catch (e) { check("V167 touch-action", false, "error: " + e.message); }

  // ---------- V168: macros, movement routine, 5-tab nav, BMI, doctor summary ----------
  try {
    // Header: real gold lotus above the title, new tagline.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const header = await t.page.evaluate(() => {
      const img = document.querySelector(".app-header .header-lotus");
      const tag = (document.querySelector(".app-header .tagline") || {}).textContent || "";
      const title = (document.querySelector(".app-header h1") || {}).textContent || "";
      return { lotusSrc: img ? img.getAttribute("src") : "", tagline: tag, title };
    });
    check("V168 header: gold lotus above title, new tagline", header.lotusSrc.indexOf("lotus-gold-only-transparent.png") !== -1 && header.tagline.indexOf("Stay strong while the medicine works") !== -1 && header.title.indexOf("New Chapter") !== -1, JSON.stringify(header));
    await t.ctx.close();
  } catch (e) { check("V168 header", false, "error: " + e.message); }

  try {
    // Macros card: 25+22+21 protein, 40+45+35 carbs, 10+15+20 fat
    // sums to 68/120/45 against targets 90/150/60; calories 1157.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ protein: [
      { id: "p1", date: today(0), grams: 25, carbs: 40, fat: 10, food: "Eggs" },
      { id: "p2", date: today(0), grams: 22, carbs: 45, fat: 15, food: "Yogurt" },
      { id: "p3", date: today(0), grams: 21, carbs: 35, fat: 20, food: "Chicken" }
    ] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const macros = await t.page.evaluate(() => ({
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
    await t.page.click('.macro-row[data-macro="carbs"]');
    await t.page.waitForTimeout(300);
    const centerAfter = await t.page.evaluate(() => (document.getElementById("macro-center-grams") || {}).textContent || "");
    check("V168 macros select: tapping carbs shows 120 in the center", centerAfter === "120", "center=" + centerAfter);
    // Protein type-in (v049 R-29): steppers were removed in v039; the
    // inline row is now the precise-adjust path. Tap the logged number,
    // type 1, Add.
    await t.page.click("#logged-protein-btn");
    await t.page.waitForTimeout(300);
    await t.page.fill("#protein-inline-input", "1");
    await t.page.click("#protein-inline-add-btn");
    await t.page.waitForTimeout(300);
    const afterStep = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return s.protein.reduce((a, e) => a + (Number(e.grams) || 0), 0);
    }, LS);
    check("V168 macros type-in: protein +1 is 69", afterStep === 69, "protein=" + afterStep);
    // Log food form: a real meal lands in the store with all macros.
    await t.page.click("#macro-log-food");
    await t.page.waitForTimeout(200);
    await t.page.fill("#macro-food-name", "Salmon bowl");
    await t.page.fill("#macro-food-protein", "30");
    await t.page.fill("#macro-food-carbs", "25");
    await t.page.fill("#macro-food-fat", "12");
    await t.page.click("#macro-food-submit");
    await t.page.waitForTimeout(400);
    const afterFood = await t.page.evaluate((LS) => {
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
    await t.ctx.close();
  } catch (e) { check("V168 macros card", false, "error: " + e.message); }

  try {
    // Movement card: five default moves, progress, 5-minute bonus on
    // completion, bonus taken back when a move is unticked.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const start = await t.page.evaluate(() => ({
      moves: document.querySelectorAll("#moves-list li").length,
      count: (document.getElementById("move-count") || {}).textContent || "",
      sub: (document.getElementById("movement-sub") || {}).textContent || ""
    }));
    check("V168 movement card: five default moves, 0 of 5", start.moves === 5 && start.count.indexOf("0 of 5") !== -1 && start.sub.indexOf("5 minutes") !== -1, JSON.stringify(start));
    // Tap all five gold circles. Each tap re-renders the list, so the
    // buttons are re-queried every time instead of holding handles
    // across renders.
    for (let i = 0; i < 5; i++) {
      await t.page.click("#moves-list .move-check:not(.done)");
      await t.page.waitForTimeout(200);
    }
    await t.page.waitForTimeout(400);
    const done = await t.page.evaluate((LS) => {
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
    await t.page.click("#moves-list .move-check.done");
    await t.page.waitForTimeout(400);
    const undone = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        minutes: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
        bonus: s.exercise.filter((e) => e.label === "Daily movement routine").length
      };
    }, LS);
    check("V168 movement untick: bonus removed, movement back to 0", undone.minutes === 0 && undone.bonus === 0, JSON.stringify(undone));
    await t.ctx.close();
  } catch (e) { check("V168 movement card", false, "error: " + e.message); }

  try {
    // Customize: pick Lunges at 8 reps, drop the stretch, save.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await t.page.click("#movement-customize");
    await t.page.waitForTimeout(300);
    const editor = await t.page.evaluate(() => ({
      open: !document.getElementById("movement-plan-modal").classList.contains("hidden"),
      rows: document.querySelectorAll("#movement-plan-list .plan-row").length,
      checked: [...document.querySelectorAll("#movement-plan-list input[type='checkbox']")].filter((c) => c.checked).length
    }));
    check("V168 plan editor: opens with 18 exercises, 5 checked", editor.open && editor.rows === 18 && editor.checked === 5, JSON.stringify(editor));
    await t.page.uncheck('input[data-plan-name="Gentle full-body stretch"]');
    await t.page.check('input[data-plan-name="Lunges"]');
    await t.page.fill('input[data-plan-detail="Lunges"]', "8 reps");
    await t.page.click("#movement-plan-save");
    await t.page.waitForTimeout(400);
    const plan = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      const names = [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent);
      const reps = [...document.querySelectorAll("#moves-list .move-reps")].map((el) => el.textContent);
      return { names, reps, saved: (s.settings.movementPlan || []).map((m) => m.name + " " + m.detail) };
    }, LS);
    check("V168 plan save: Lunges 8 reps in, stretch out, plan saved", plan.names.includes("Lunges") && plan.reps[plan.names.indexOf("Lunges")] === "8 reps" && !plan.names.includes("Gentle full-body stretch") && plan.saved.length === 5, JSON.stringify(plan));
    // Reset returns to the default five.
    await t.page.click("#movement-customize");
    await t.page.waitForTimeout(300);
    await t.page.click("#movement-plan-reset");
    await t.page.waitForTimeout(400);
    const reset = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { names: [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent), plan: s.settings.movementPlan };
    }, LS);
    check("V168 plan reset: back to the default five", reset.plan === null && reset.names.length === 5 && reset.names.includes("Sit-to-stands"), JSON.stringify(reset));
    await t.ctx.close();
  } catch (e) { check("V168 movement customize", false, "error: " + e.message); }

  try {
    // v169: six-tab nav, Today, Shots, Weight, Journal, Companion, More.
    // Companion moved out of the More sheet into the main nav. More
    // opens a sheet; picking Effects or Settings shows that panel and
    // marks More active.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const nav = await t.page.evaluate(() => ({
      labels: [...document.querySelectorAll(".tab-btn .tab-label")].map((el) => el.textContent),
      dots: document.querySelectorAll(".tab-btn .tab-dot").length
    }));
    check("V168 nav: five tabs plus More, each with a gold dot", nav.labels.join(",") === "Today,Shots,Weight,Kitchen,Companion,More" && nav.dots === 6, JSON.stringify(nav));
    await t.page.click('.tab-btn[data-tab="more"]');
    await t.page.waitForTimeout(300);
    const sheet = await t.page.evaluate(() => ({
      open: !document.getElementById("more-sheet").classList.contains("hidden"),
      items: [...document.querySelectorAll(".more-item[data-more-goto]")].map((el) => el.dataset.moreGoto)
    }));
    check("V004 More sheet: opens with Effects, Settings, Journal, Help", sheet.open && sheet.items.join(",") === "side-effects,settings,journal,help", JSON.stringify(sheet));
    await t.page.click('.more-item[data-more-goto="settings"]');
    await t.page.waitForTimeout(300);
    const afterSettings = await t.page.evaluate(() => ({
      settingsActive: document.getElementById("tab-settings").classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active"),
      sheetClosed: document.getElementById("more-sheet").classList.contains("hidden")
    }));
    check("V168 More pick: Settings panel shows, More stays active, sheet closes", afterSettings.settingsActive && afterSettings.moreActive && afterSettings.sheetClosed, JSON.stringify(afterSettings));
    await t.page.click('.tab-btn[data-tab="more"]');
    await t.page.waitForTimeout(300);
    await t.page.click('.more-item[data-more-goto="side-effects"]');
    await t.page.waitForTimeout(300);
    const afterEffects = await t.page.evaluate(() => ({
      effectsActive: document.getElementById("tab-side-effects").classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active")
    }));
    check("V168 More pick: Effects panel shows, More stays active", afterEffects.effectsActive && afterEffects.moreActive, JSON.stringify(afterEffects));
    // Escape closes the sheet without changing tabs.
    await t.page.click('.tab-btn[data-tab="more"]');
    await t.page.waitForTimeout(300);
    await t.page.keyboard.press("Escape");
    await t.page.waitForTimeout(300);
    const afterEsc = await t.page.evaluate(() => ({
      sheetClosed: document.getElementById("more-sheet").classList.contains("hidden"),
      effectsStillActive: document.getElementById("tab-side-effects").classList.contains("active")
    }));
    check("V168 More sheet: Escape closes it, tab unchanged", afterEsc.sheetClosed && afterEsc.effectsStillActive, JSON.stringify(afterEsc));
    await t.ctx.close();
  } catch (e) { check("V168 six-tab nav", false, "error: " + e.message); }

  try {
    // BMI: 168 lbs at 5 ft 6 in is 27.1, Overweight. No height, no BMI.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 168 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    const bmi = await t.page.evaluate(() => ({
      hero: (document.getElementById("weight-hero-value") || {}).textContent || "",
      line: (document.getElementById("bmi-line") || {}).textContent || ""
    }));
    check("V168 BMI: 168 lbs at 5 ft 6 in is 27.1 Overweight, hero shows 168", bmi.hero === "168.0" && bmi.line.indexOf("27.1") !== -1 && bmi.line.indexOf("Overweight") !== -1, JSON.stringify(bmi));
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 168 }] })) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    const noHeight = await t.page.evaluate(() => (document.getElementById("bmi-line") || {}).textContent || "");
    check("V168 BMI: no height in Settings shows the add-height hint", noHeight.indexOf("Add your height") !== -1, JSON.stringify(noHeight));
    await t.ctx.close();
  } catch (e) { check("V168 BMI", false, "error: " + e.message); }

  try {
    // Doctor visit summary: one tap builds weight, shots and side
    // effects into a text summary with Copy and Download.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
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
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    await t.page.click("#doctor-summary-btn");
    await t.page.waitForTimeout(300);
    const summary = await t.page.evaluate(() => {
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
    await t.ctx.close();
  } catch (e) { check("V168 doctor summary", false, "error: " + e.message); }

  try {
    // Chat lotus: the Companion's messages carry the gold lotus.
    const t = await newPage(browser, url);
    await setStorage(t.page, {
      [LS]: JSON.stringify(makeStore()),
      [CHAT_KEY]: JSON.stringify([{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello, Jessica." }])
    });
    await t.page.reload();
    // v169: the Companion is a main tab now, not a More sheet item.
    await t.page.click('.tab-btn[data-tab="chat"]');
    await t.page.waitForTimeout(400);
    const chat = await t.page.evaluate(() => {
      const rows = [...document.querySelectorAll("#chat-messages .chat-row")];
      return {
        rows: rows.length,
        assistantLotus: rows.filter((r) => r.classList.contains("assistant") && r.querySelector(".chat-lotus")).length,
        userLotus: rows.filter((r) => r.classList.contains("user") && r.querySelector(".chat-lotus")).length,
        lotusSrc: (document.querySelector("#chat-messages .chat-lotus") || {}).getAttribute ? document.querySelector("#chat-messages .chat-lotus").getAttribute("src") : ""
      };
    });
    check("V168 chat lotus: assistant row has the lotus, user row does not", chat.rows === 2 && chat.assistantLotus === 1 && chat.userLotus === 0 && chat.lotusSrc.indexOf("lotus-gold-only-transparent.png") !== -1, JSON.stringify(chat));
    await t.ctx.close();
  } catch (e) { check("V168 chat lotus", false, "error: " + e.message); }

  // ---------- V169: ring type-in, macro slide, calorie target, plan editor, BMI extras, weight layout, six-tab nav, journal side effects ----------
  try {
    // Ring type-in: the number inside each ring is a button that opens
    // an inline add row under the slider. v049 R-29 replaced the
    // add-amount modal sheet with the same inline row water, movement
    // and macros all use, so these checks now exercise the inline
    // flow, not the removed modal. Type 16 oz of water, 5 min of movement.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ water: [{ id: "w1", date: today(0), oz: 43 }] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const ringBtns = await t.page.evaluate(() => ({
      waterIsButton: (document.getElementById("water-num-btn") || {}).tagName === "BUTTON",
      moveIsButton: (document.getElementById("exercise-num-btn") || {}).tagName === "BUTTON",
      waterLabel: (document.getElementById("water-num-btn") || {}).getAttribute("aria-label") || "",
      moveLabel: (document.getElementById("exercise-num-btn") || {}).getAttribute("aria-label") || ""
    }));
    check("V169 ring numbers are buttons with a type-in hint", ringBtns.waterIsButton && ringBtns.moveIsButton && ringBtns.waterLabel.indexOf("Tap to type an amount to add") !== -1 && ringBtns.moveLabel.indexOf("Tap to type an amount to add") !== -1 && ringBtns.waterLabel.indexOf("43 of 92 oz") !== -1, JSON.stringify(ringBtns));
    await t.page.click("#water-num-btn");
    await t.page.waitForTimeout(300);
    const rowOpen = await t.page.evaluate(() => ({
      open: !document.getElementById("water-inline-add").classList.contains("hidden"),
      preview: (document.getElementById("water-inline-preview") || {}).textContent || "",
      addDisabled: !!document.getElementById("water-inline-add-btn").disabled,
      placeholder: (document.getElementById("water-inline-input") || {}).getAttribute("placeholder") || "",
      focused: (document.activeElement || {}).id || ""
    }));
    check("V169 water inline row opens with the current total, Add disabled, input focused", rowOpen.open && rowOpen.preview === "Type a whole number to add." && rowOpen.addDisabled && rowOpen.placeholder === "16" && rowOpen.focused === "water-inline-input", JSON.stringify(rowOpen));
    await t.page.fill("#water-inline-input", "16");
    await t.page.waitForTimeout(200);
    const preview = await t.page.evaluate(() => ({
      text: (document.getElementById("water-inline-preview") || {}).textContent || "",
      addDisabled: !!document.getElementById("water-inline-add-btn").disabled
    }));
    check("V169 inline preview updates as typed: 43 + 16 is 59", preview.text === "After adding: 59 oz" && !preview.addDisabled, JSON.stringify(preview));
    await t.page.click("#water-inline-add-btn");
    await t.page.waitForTimeout(400);
    const afterAdd = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0),
        entries: s.water.length,
        num: (document.getElementById("water-today") || {}).textContent || "",
        closed: document.getElementById("water-inline-add").classList.contains("hidden"),
        focused: (document.activeElement || {}).id || ""
      };
    }, LS);
    check("V169 typing 16 adds 16 oz through the same helper, focus back on the ring number", afterAdd.water === 59 && afterAdd.entries === 2 && afterAdd.num === "59" && afterAdd.closed && afterAdd.focused === "water-num-btn", JSON.stringify(afterAdd));
    // Movement: type 5 minutes.
    await t.page.click("#exercise-num-btn");
    await t.page.waitForTimeout(300);
    await t.page.fill("#exercise-inline-input", "5");
    await t.page.click("#exercise-inline-add-btn");
    await t.page.waitForTimeout(400);
    const afterMove = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        minutes: s.exercise.reduce((a, e) => a + (Number(e.minutes) || 0), 0),
        num: (document.getElementById("exercise-today") || {}).textContent || ""
      };
    }, LS);
    check("V169 typing 5 adds 5 minutes of movement", afterMove.minutes === 5 && afterMove.num === "5", JSON.stringify(afterMove));
    // Cancel leaves the value unchanged.
    await t.page.click("#water-num-btn");
    await t.page.waitForTimeout(200);
    await t.page.fill("#water-inline-input", "10");
    await t.page.click("#water-inline-cancel-btn");
    await t.page.waitForTimeout(300);
    const afterCancel = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0), closed: document.getElementById("water-inline-add").classList.contains("hidden") };
    }, LS);
    check("V169 Cancel leaves the water total unchanged", afterCancel.water === 59 && afterCancel.closed, JSON.stringify(afterCancel));
    // Invalid entries keep Add disabled and change nothing.
    await t.page.click("#water-num-btn");
    await t.page.waitForTimeout(200);
    await t.page.fill("#water-inline-input", "abc");
    await t.page.waitForTimeout(200);
    const invalid = await t.page.evaluate(() => ({
      addDisabled: !!document.getElementById("water-inline-add-btn").disabled,
      preview: (document.getElementById("water-inline-preview") || {}).textContent || ""
    }));
    check("V169 invalid entry keeps Add disabled", invalid.addDisabled && invalid.preview === "Type a whole number to add.", JSON.stringify(invalid));
    await t.page.fill("#water-inline-input", "0");
    await t.page.waitForTimeout(200);
    const zero = await t.page.evaluate(() => !!document.getElementById("water-inline-add-btn").disabled);
    check("V169 zero keeps Add disabled", zero, "disabled=" + zero);
    await t.page.keyboard.press("Escape");
    await t.page.waitForTimeout(300);
    const afterEsc = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return { water: s.water.reduce((a, e) => a + (Number(e.oz) || 0), 0), closed: document.getElementById("water-inline-add").classList.contains("hidden") };
    }, LS);
    check("V169 Escape closes the inline row, value unchanged", afterEsc.water === 59 && afterEsc.closed, JSON.stringify(afterEsc));
    await t.ctx.close();
  } catch (e) { check("V169 ring type-in", false, "error: " + e.message); }

  try {
    // Macro row slide: 68/120/45 seeded. Slide the carbs bar right
    // 80px (+10 g at 8px/unit), then left 80px, then clamp at zero.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ protein: [
      { id: "p1", date: today(0), grams: 25, carbs: 40, fat: 10, food: "Eggs" },
      { id: "p2", date: today(0), grams: 22, carbs: 45, fat: 15, food: "Yogurt" },
      { id: "p3", date: today(0), grams: 21, carbs: 35, fat: 20, food: "Chicken" }
    ] })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const barAttrs = await t.page.evaluate(() => {
      const bar = document.getElementById("macro-bar-carbs");
      const stepper = document.querySelector('.macro-row[data-macro="carbs"] .macro-log-btn[data-dir="1"]');
      const nameBtn = document.querySelector('.macro-row[data-macro="carbs"] .macro-name');
      return {
        role: bar.getAttribute("role"),
        touch: getComputedStyle(bar).touchAction,
        note: (document.querySelector(".donut-note") || {}).textContent || "",
        stepper: !!stepper && stepper.getAttribute("aria-label") || "",
        nameBtn: !!nameBtn && nameBtn.tagName === "BUTTON"
      };
    });
    // v049: the bar is a slider (v048 restored slide-to-adjust with a
    // slider role), and the donut note now documents tap-to-type on the
    // center number. Steppers were removed in v039; adjustment is slide
    // plus tap-to-type. The macro name is the button that selects it.
    check("V169 macro bar is a slider, note mentions tapping the center to add more, name button present", barAttrs.role === "slider" && barAttrs.touch === "none" && barAttrs.note.indexOf("Tap the center number to add more") !== -1 && barAttrs.nameBtn, JSON.stringify(barAttrs));
    // Select carbs so the donut center follows it.
    await t.page.click('.macro-row[data-macro="carbs"]');
    await t.page.waitForTimeout(200);
    const bar = await t.page.$("#macro-bar-carbs");
    const box = await bar.boundingBox();
    const cy = box.y + box.height / 2;
    await t.page.mouse.move(box.x + box.width / 2, cy);
    await t.page.mouse.down();
    await t.page.mouse.move(box.x + box.width / 2 + 80, cy, { steps: 10 });
    await t.page.mouse.up();
    await t.page.waitForTimeout(400);
    const afterRight = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        carbs: s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0),
        logged: (document.getElementById("logged-carbs") || {}).textContent || "",
        pct: (document.getElementById("pct-carbs") || {}).textContent || "",
        center: (document.getElementById("macro-center-grams") || {}).textContent || "",
        cal: (document.getElementById("calories-today") || {}).textContent || ""
      };
    }, LS);
    check("V169 slide carbs right: 120 to 130, center and percent update", afterRight.carbs === 130 && afterRight.logged === "130" && afterRight.pct === "87% of your target" && afterRight.center === "130" && afterRight.cal.indexOf("1,197") !== -1, JSON.stringify(afterRight));
    await t.page.mouse.move(box.x + box.width / 2, cy);
    await t.page.mouse.down();
    await t.page.mouse.move(box.x + box.width / 2 - 80, cy, { steps: 10 });
    await t.page.mouse.up();
    await t.page.waitForTimeout(400);
    const afterLeft = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0);
    }, LS);
    check("V169 slide carbs left: back to 120", afterLeft === 120, "carbs=" + afterLeft);
    await t.ctx.close();
    // Clamp at zero: a fresh day with only 5 g of carbs.
    const t2 = await newPage(browser, url);
    await setStorage(t2.page, { [LS]: JSON.stringify(makeStore({ protein: [
      { id: "p1", date: today(0), grams: 10, carbs: 5, fat: 2, food: "Snack" }
    ] })) });
    await t2.page.reload();
    await t2.page.waitForTimeout(400);
    const bar2 = await t2.page.$("#macro-bar-carbs");
    // The bar sits below the fold on a phone-height viewport, so a drag
    // from its raw box lands outside the viewport and no pointer event
    // fires. Scroll it into view first, as a person would.
    await bar2.scrollIntoViewIfNeeded();
    const box2 = await bar2.boundingBox();
    const cy2 = box2.y + box2.height / 2;
    await t2.page.mouse.move(box2.x + box2.width / 2, cy2);
    await t2.page.mouse.down();
    await t2.page.mouse.move(box2.x + box2.width / 2 - 80, cy2, { steps: 10 });
    await t2.page.mouse.up();
    await t2.page.waitForTimeout(400);
    const clamped = await t2.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        carbs: s.protein.reduce((a, e) => a + (Number(e.carbs) || 0), 0),
        logged: (document.getElementById("logged-carbs") || {}).textContent || ""
      };
    }, LS);
    check("V169 slide carbs left past zero clamps at 0", clamped.carbs === 0 && clamped.logged === "0", JSON.stringify(clamped));
    await t2.ctx.close();
  } catch (e) { check("V169 macro row slide", false, "error: " + e.message); }

  try {
    // Calorie target: 30/20/5 macros is 245 calories. With a 1,400
    // target the line reads "About 245 of 1,400 calories ...".
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
      protein: [{ id: "p1", date: today(0), grams: 30, carbs: 20, fat: 5, food: "Meal" }],
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: "", heightIn: "", movementPlan: null, refillDate: "", goalWeight: "", calorieTarget: 1400 }
    })) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const withTarget = await t.page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || "",
      note: (document.getElementById("calories-note") || {}).textContent || ""
    }));
    check("V169 calorie target set: section shows 245 of 1,400", withTarget.today === "245" && withTarget.target === " of 1,400" && withTarget.note === "Calories from macros today (protein and carbs 4 cal/g, fat 9 cal/g).", JSON.stringify(withTarget));
    // Clear it in Settings: the plain line comes back.
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    await openYourGoals(t.page);
    await t.page.fill("#set-calorie-target", "");
    // v080: Save lives inside the collapsed Companion card (finding 30).
    await openSettingsCard(t.page, "AI Wellness Companion access");
    await t.page.click("#settings-form button[type='submit']");
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "today");
    await t.page.waitForTimeout(300);
    const cleared = await t.page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || "",
      note: (document.getElementById("calories-note") || {}).textContent || ""
    }));
    check("V169 calorie target cleared: plain section returns", cleared.today === "245" && cleared.target === "" && cleared.note.indexOf("Set a daily calorie target") !== -1, JSON.stringify(cleared));
    await t.ctx.close();
    // Invalid target in storage is ignored by validation.
    const t2 = await newPage(browser, url);
    await setStorage(t2.page, { [LS]: JSON.stringify(makeStore({
      protein: [{ id: "p1", date: today(0), grams: 30, carbs: 20, fat: 5, food: "Meal" }],
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: "", heightIn: "", movementPlan: null, refillDate: "", goalWeight: "", calorieTarget: "abc" }
    })) });
    await t2.page.reload();
    await t2.page.waitForTimeout(400);
    const invalid = await t2.page.evaluate(() => ({
      today: (document.getElementById("calories-today") || {}).textContent || "",
      target: (document.getElementById("calories-target-part") || {}).textContent || "",
      note: (document.getElementById("calories-note") || {}).textContent || ""
    }));
    check("V169 invalid calorie target is ignored", invalid.today === "245" && invalid.target === "" && invalid.note.indexOf("Set a daily calorie target") !== -1, JSON.stringify(invalid));
    await t2.ctx.close();
  } catch (e) { check("V169 calorie target", false, "error: " + e.message); }

  try {
    // v169: macro targets are type-in fields under Your goals in
    // Settings. Typing a new protein target updates the macros card;
    // a blank or invalid value leaves the existing target unchanged.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    await openYourGoals(t.page);
    await t.page.fill("#set-protein-goal", "120");
    // v080: Save lives inside the collapsed Companion card (finding 30).
    await openSettingsCard(t.page, "AI Wellness Companion access");
    await t.page.click("#settings-form button[type='submit']");
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "today");
    await t.page.waitForTimeout(300);
    const setTarget = await t.page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 protein target typed in Settings updates the macros card", setTarget === "120", JSON.stringify(setTarget));
    // Blank keeps the 120 target; zero keeps it too.
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    await openYourGoals(t.page);
    await t.page.fill("#set-protein-goal", "");
    await openSettingsCard(t.page, "AI Wellness Companion access");
    await t.page.click("#settings-form button[type='submit']");
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "today");
    await t.page.waitForTimeout(300);
    const keptBlank = await t.page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 blank protein target keeps the existing target", keptBlank === "120", JSON.stringify(keptBlank));
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    await openYourGoals(t.page);
    await t.page.fill("#set-protein-goal", "0");
    await openSettingsCard(t.page, "AI Wellness Companion access");
    await t.page.click("#settings-form button[type='submit']");
    await t.page.waitForTimeout(400);
    await clickTab(t.page, "today");
    await t.page.waitForTimeout(300);
    const keptZero = await t.page.evaluate(() => (document.getElementById("target-protein-label") || {}).textContent || "");
    check("V169 zero protein target keeps the existing target", keptZero === "120", JSON.stringify(keptZero));
    await t.ctx.close();
  } catch (e) { check("V169 macro target type-in", false, "error: " + e.message); }

  try {
    // Movement plan editor: 18 rows in a scrollable picker, X closes,
    // a custom exercise can be added, saved, and removed.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await t.page.click("#movement-customize");
    await t.page.waitForTimeout(300);
    const picker = await t.page.evaluate(() => {
      const list = document.getElementById("movement-plan-list");
      const cs = getComputedStyle(list);
      return {
        rows: document.querySelectorAll("#movement-plan-list .plan-row").length,
        scrolls: list.scrollHeight > list.clientHeight,
        maxHeight: cs.maxHeight,
        hasX: !!document.getElementById("movement-plan-x")
      };
    });
    check("V169 plan picker: 18 rows, scrolls inside a fixed height, X present", picker.rows === 18 && picker.scrolls && picker.maxHeight === "264px" && picker.hasX, JSON.stringify(picker));
    // Add a custom exercise.
    await t.page.fill("#custom-ex-name", "Step-ups");
    await t.page.selectOption("#custom-ex-pattern", "Squat");
    await t.page.fill("#custom-ex-detail", "12 reps");
    await t.page.click("#custom-ex-add");
    await t.page.waitForTimeout(300);
    const afterAdd = await t.page.evaluate(() => {
      const rows = [...document.querySelectorAll("#movement-plan-list .plan-row")];
      const custom = rows.find((r) => r.dataset.custom === "true");
      return {
        rows: rows.length,
        customChecked: !!(custom && custom.querySelector("input[type='checkbox']").checked),
        customName: custom ? (custom.querySelector("input[type='checkbox']").dataset.planName || "") : ""
      };
    });
    check("V169 custom exercise added and checked in the picker", afterAdd.rows === 19 && afterAdd.customChecked && afterAdd.customName === "Step-ups", JSON.stringify(afterAdd));
    await t.page.click("#movement-plan-save");
    await t.page.waitForTimeout(400);
    const onCard = await t.page.evaluate(() => ({
      moves: [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent),
      sub: (document.getElementById("movement-sub") || {}).textContent || ""
    }));
    check("V169 custom exercise shows on the Today card", onCard.moves.length === 6 && onCard.moves.includes("Step-ups") && onCard.sub.indexOf("6 moves") !== -1, JSON.stringify(onCard));
    // It survives a reload.
    await t.page.reload();
    await t.page.waitForTimeout(400);
    const afterReload = await t.page.evaluate(() => [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent));
    check("V169 custom exercise survives reload", afterReload.length === 6 && afterReload.includes("Step-ups"), JSON.stringify(afterReload));
    // The X closes the modal and focus returns to Customize.
    await t.page.click("#movement-customize");
    await t.page.waitForTimeout(300);
    await t.page.click("#movement-plan-x");
    await t.page.waitForTimeout(300);
    const afterX = await t.page.evaluate(() => ({
      closed: document.getElementById("movement-plan-modal").classList.contains("hidden"),
      focused: (document.activeElement || {}).id || "",
      moves: document.querySelectorAll("#moves-list li").length
    }));
    check("V169 X closes the editor, focus back on Customize, plan unchanged", afterX.closed && afterX.focused === "movement-customize" && afterX.moves === 6, JSON.stringify(afterX));
    // Remove the custom exercise and save: back to the default five.
    await t.page.click("#movement-customize");
    await t.page.waitForTimeout(300);
    await t.page.click('[data-remove-custom="Step-ups"]');
    await t.page.waitForTimeout(200);
    const afterRemove = await t.page.evaluate(() => document.querySelectorAll("#movement-plan-list .plan-row").length);
    check("V169 remove takes the custom row out of the picker", afterRemove === 18, "rows=" + afterRemove);
    await t.page.click("#movement-plan-save");
    await t.page.waitForTimeout(400);
    const afterSave = await t.page.evaluate(() => [...document.querySelectorAll("#moves-list .move-name")].map((el) => el.textContent));
    check("V169 saving after remove: back to the default five", afterSave.length === 5 && !afterSave.includes("Step-ups"), JSON.stringify(afterSave));
    await t.ctx.close();
  } catch (e) { check("V169 movement plan editor", false, "error: " + e.message); }

  try {
    // BMI extras: 182.0 lbs at 5 ft 6 in is BMI 29.4, 27.7 lbs over a
    // healthy top of 154 lbs, range 115 to 154.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 182 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    // v080: the cutoffs live behind an "About BMI" disclosure (finding
    // 16), and the over line now leads with the number.
    await t.page.evaluate(() => { const d = document.querySelector("#bmi-healthy-block details"); if (d) d.open = true; });
    await t.page.waitForTimeout(200);
    const bmi = await t.page.evaluate(() => ({
      line: (document.getElementById("bmi-line") || {}).textContent || "",
      over: (document.getElementById("bmi-over-line") || {}).textContent || "",
      range: (document.getElementById("bmi-healthy-range") || {}).textContent || "",
      cutoffs: (document.querySelector("#bmi-healthy-block .bmi-cutoffs") || {}).textContent || "",
      disclosureOpen: !!((document.querySelector("#bmi-healthy-block details") || {}).open),
      blockHidden: !!document.getElementById("bmi-healthy-block").hidden
    }));
    check("V169 BMI extras: 27.7 lbs over, range 115 to 154, cutoffs in About BMI", bmi.line.indexOf("29.4") !== -1 && bmi.line.indexOf("Overweight") !== -1 && bmi.over === "27.7 lbs above the healthy range" && bmi.range === "Healthy weight for 5 ft 6 in: 115 to 154 lbs (BMI 18.5 to 24.9)." && bmi.cutoffs.indexOf("Underweight below 18.5") !== -1 && bmi.cutoffs.indexOf("Obesity Class I 30") !== -1 && bmi.disclosureOpen && !bmi.blockHidden, JSON.stringify(bmi));
    await t.ctx.close();
    // No height: no BMI extras at all.
    const t2 = await newPage(browser, url);
    await setStorage(t2.page, { [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 182 }] })) });
    await t2.page.reload();
    await clickTab(t2.page, "weight");
    await t2.page.waitForTimeout(400);
    const noHeight = await t2.page.evaluate(() => ({
      line: (document.getElementById("bmi-line") || {}).textContent || "",
      over: (document.getElementById("bmi-over-line") || {}).textContent || "",
      blockHidden: !!document.getElementById("bmi-healthy-block").hidden
    }));
    check("V169 BMI extras: no height means no extras", noHeight.line.indexOf("Add your height") !== -1 && noHeight.over === "" && noHeight.blockHidden, JSON.stringify(noHeight));
    await t2.ctx.close();
    // In the healthy range: 140 lbs at 5 ft 6 in is BMI 22.6.
    const t3 = await newPage(browser, url);
    await setStorage(t3.page, { [LS]: JSON.stringify(makeStore({ weight: [{ id: "w1", date: today(0), value: 140 }], settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, heightFt: 5, heightIn: 6, movementPlan: null, refillDate: "", goalWeight: "" } })) });
    await t3.page.reload();
    await clickTab(t3.page, "weight");
    await t3.page.waitForTimeout(400);
    const healthy = await t3.page.evaluate(() => ({
      over: (document.getElementById("bmi-over-line") || {}).textContent || "",
      range: (document.getElementById("bmi-healthy-range") || {}).textContent || ""
    }));
    check("V169 BMI extras: in the healthy range, no over line", healthy.over === "In the healthy range" && healthy.range.indexOf("115 to 154") !== -1, JSON.stringify(healthy));
    await t3.ctx.close();
  } catch (e) { check("V169 BMI extras", false, "error: " + e.message); }

  try {
    // Weight tab layout: the chart sits right after the hero, before
    // the stat cards; the two buttons share one row, at least 44px tall.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({ weight: [
      { id: "w1", date: today(-7), value: 184 },
      { id: "w2", date: today(0), value: 182 }
    ] })) });
    await t.page.reload();
    await clickTab(t.page, "weight");
    await t.page.waitForTimeout(400);
    const layout = await t.page.evaluate(() => {
      const chart = document.getElementById("weight-chart-card");
      const stats = document.querySelector("#tab-weight .stats-row");
      const hero = document.querySelector("#tab-weight .weight-hero");
      const order = chart.compareDocumentPosition(stats) & Node.DOCUMENT_POSITION_FOLLOWING ? "chart-first" : "stats-first";
      const heroOrder = hero.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING ? "hero-first" : "chart-first";
      const logBtn = document.getElementById("show-weight-form");
      const docBtn = document.getElementById("doctor-summary-btn");
      const lb = logBtn.getBoundingClientRect();
      const db = docBtn.getBoundingClientRect();
      return {
        order, heroOrder,
        sameRow: Math.abs(lb.top - db.top) < 2,
        docAfterLog: db.left > lb.right,
        logH: Math.round(lb.height),
        docH: Math.round(db.height)
      };
    });
    check("V169 weight layout: chart after hero, before cards; buttons side by side, 44px or taller", layout.order === "chart-first" && layout.heroOrder === "hero-first" && layout.sameRow && layout.docAfterLog && layout.logH >= 44 && layout.docH >= 44, JSON.stringify(layout));
    await t.ctx.close();
  } catch (e) { check("V169 weight layout", false, "error: " + e.message); }

  try {
    // Six-tab nav: the Companion tab shows the chat panel and takes
    // the gold active state; More is not active.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore()) });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    await t.page.click('.tab-btn[data-tab="chat"]');
    await t.page.waitForTimeout(300);
    const companion = await t.page.evaluate(() => ({
      chatActive: document.getElementById("tab-chat").classList.contains("active"),
      tabActive: document.querySelector('.tab-btn[data-tab="chat"]').classList.contains("active"),
      moreActive: document.querySelector('.tab-btn[data-tab="more"]').classList.contains("active"),
      label: (document.querySelector('.tab-btn[data-tab="chat"] .tab-label') || {}).textContent || ""
    }));
    check("V169 Companion tab shows the chat panel and is active", companion.chatActive && companion.tabActive && !companion.moreActive && companion.label === "Companion", JSON.stringify(companion));
    await t.ctx.close();
  } catch (e) { check("V169 six-tab nav", false, "error: " + e.message); }

  try {
    // v080: side effects no longer appear on the Journal tab (finding
    // 20); the same timeline lives on the Side Effects tab, newest
    // first, with Edit and Delete working from there.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
      journal: [{ id: "j1", date: today(0), mood: "Good", notes: "Felt strong today." }],
      sideEffects: [
        { id: "s1", date: today(0), symptom: "Nausea", severity: "Mild", notes: "" },
        { id: "s2", date: today(-1), symptom: "Headache", severity: "Moderate", notes: "" }
      ]
    })) });
    await t.page.reload();
    await clickMoreTab(t.page, "side-effects");
    await t.page.waitForTimeout(400);
    const effectsSe = await t.page.evaluate(() => {
      const items = [...document.querySelectorAll("#sideeffect-list .se-timeline-item")];
      return {
        count: items.length,
        first: (items[0] || {}).textContent || "",
        hasMild: items.some((el) => el.classList.contains("se-sev-mild")),
        hasModerate: items.some((el) => el.classList.contains("se-sev-moderate")),
        heading: (document.querySelector("#tab-side-effects h2") || {}).textContent || ""
      };
    });
    check("V169 side effects tab: two entries, newest first, severity dots", effectsSe.count === 2 && effectsSe.first.indexOf("Nausea") !== -1 && effectsSe.hasMild && effectsSe.hasModerate && effectsSe.heading === "Side Effects", JSON.stringify(effectsSe));
    // Edit from the Effects tab: the form opens on the same tab.
    await t.page.click("#sideeffect-list [data-edit-se='s1']");
    await t.page.waitForTimeout(400);
    const afterEdit = await t.page.evaluate(() => ({
      effectsActive: document.getElementById("tab-side-effects").classList.contains("active"),
      formOpen: !document.getElementById("sideeffect-form").classList.contains("hidden"),
      symptom: (document.getElementById("se-symptom") || {}).value || ""
    }));
    check("V169 edit from Effects tab opens the form", afterEdit.effectsActive && afterEdit.formOpen && afterEdit.symptom === "Nausea", JSON.stringify(afterEdit));
    await t.page.click("#cancel-sideeffect");
    await t.page.waitForTimeout(300);
    // Delete from the Effects tab: gone from the list and the store.
    await t.page.click("#sideeffect-list [data-del-se='s2']");
    await t.page.waitForTimeout(400);
    const afterDel = await t.page.evaluate((LS) => {
      const s = JSON.parse(localStorage.getItem(LS));
      return {
        stored: s.sideEffects.length,
        listCount: document.querySelectorAll("#sideeffect-list .se-timeline-item").length
      };
    }, LS);
    check("V169 delete from Effects tab removes the effect", afterDel.stored === 1 && afterDel.listCount === 1, JSON.stringify(afterDel));
    await t.ctx.close();
  } catch (e) { check("V169 side effects tab", false, "error: " + e.message); }

  // ---------- v000: Companion name and avatar ----------
  try {
    // A chosen name shows in the chat header, the welcome message,
    // and the input placeholder; the chosen avatar shows beside
    // messages and in the header.
    const t = await newPage(browser, url);
    // v080: the greeting bubble only renders when connected (finding
    // 23), so set a token first; the test then verifies the name in
    // the greeting, header, and input as before.
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "Nova", companionAvatar: "sage", theme: "sage", textSize: "normal", readAloud: false }
    })), [TOKEN_KEY]: "test-token-123" });
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
    check("V000 companion name shows in header, welcome, and input", named.title === "Your Nova" && named.welcome.indexOf("Hi, I am Nova.") === 0 && named.placeholder === "Ask Nova...", JSON.stringify(named));
    check("V000 companion avatar shows beside messages and in header", named.headerAvatarSage && named.rowAvatarSage, JSON.stringify(named));
    // Pick a different avatar in Settings: the header avatar follows.
    await clickMoreTab(t.page, "settings");
    await t.page.waitForTimeout(300);
    // v057: "Companion name and look" is a closed <details>; open it first.
    await openSettingsCard(t.page, "Companion name and look");
    await t.page.click('input[name="companion-avatar"][value="deep-gold"]');
    await t.page.waitForTimeout(300);
    const deepGold = await t.page.evaluate(() => (document.getElementById("chat-header-avatar") || { classList: { contains: () => false } }).classList.contains("avatar-deep-gold"));
    check("V000 picking an avatar shows it in the header", deepGold === true, "deepGold=" + deepGold);
    // Clear the name in Settings: it falls back to the default.
    await t.page.fill("#set-companion-name", "");
    // v080: Save lives inside the collapsed Companion card (finding 30).
    await openSettingsCard(t.page, "AI Wellness Companion access");
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
    // The chosen name is sent with the chat request; with the default
    // name nothing is sent.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "Nova", companionAvatar: "gold", theme: "sage", textSize: "normal", readAloud: false }
    })), [TOKEN_KEY]: "test-token-123" });
    await t.page.reload();
    await t.page.waitForTimeout(400);
    let sentBody = null;
    await t.page.route("**/api/chat", async (route) => {
      try { sentBody = route.request().postDataJSON(); } catch { sentBody = null; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ reply: "Hello there." }) });
    });
    await clickTab(t.page, "chat");
    await t.page.waitForTimeout(300);
    await t.page.fill("#chat-input", "hi");
    await t.page.click("#chat-send");
    await t.page.waitForTimeout(600);
    check("V000 companion name is sent with the chat request", sentBody && sentBody.companionName === "Nova", JSON.stringify(sentBody));
    // The reply renders, with a speaker button on it.
    const reply = await t.page.evaluate(() => {
      const msgs = Array.from(document.querySelectorAll("#chat-messages .chat-msg.assistant")).map((m) => m.textContent);
      const btn = document.querySelector("#chat-messages .chat-listen");
      return {
        hasReply: msgs.some((m) => m.indexOf("Hello there.") !== -1),
        btnLabel: btn ? btn.getAttribute("aria-label") : "",
        btnH: btn ? Math.round(btn.getBoundingClientRect().height) : 0
      };
    });
    check("V000 reply renders with a speaker button at least 44px tall", reply.hasReply && reply.btnLabel === "Listen to this reply" && reply.btnH >= 44, JSON.stringify(reply));
    await t.ctx.close();
  } catch (e) { check("V000 companion name in chat request", false, "error: " + e.message); }

  // ---------- v000: Appearance ----------
  try {
    // A dark theme and Large text apply from settings, gold stays
    // gold, and the choice persists after reload.
    const t = await newPage(browser, url);
    await setStorage(t.page, { [LS]: JSON.stringify(makeStore({
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
    await setStorage(page, { [LS]: JSON.stringify(makeStore({
      chatHistory: undefined,
      settings: { medication: "Zepbound", dose: "", shotDay: "", waterGoal: 92, proteinGoal: 90, movementGoal: 30, carbGoal: 150, fatGoal: 60, calorieTarget: "", heightFt: "", heightIn: "", movementPlan: null, customExercises: [], refillDate: "", goalWeight: "", startingWeight: null, companionName: "", companionAvatar: "gold", theme: "sage", textSize: "normal", readAloud: false }
    })), [CHAT_KEY]: JSON.stringify([{ role: "assistant", content: "Drink some water today." }]), [TOKEN_KEY]: "test-token-123" });
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
    // v057: "Your Companion" is a closed <details>; open it first.
    await openSettingsCard(page, "Your Companion");
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
    await setStorage(page, { [LS]: JSON.stringify(makeStore()), [TOKEN_KEY]: "test-token-123" });
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
  const passed = results.filter((r) => r.ok).length;
  console.log("\n" + passed + "/" + results.length + " passed (" + MODE + ")");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error("Harness error:", e); process.exit(2); });
