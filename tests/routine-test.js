/* Focused functional test for the v088 strength routine (built-in days,
   Log, Swap, Remove, Reset, 3-day/4-day plan, persistence).
   Run: node /tmp/routine-test.js <app-dir> <ls-key> [label]
   Serves the given dir over HTTP and drives it with Playwright. */
"use strict";
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_DIR = process.argv[2];
const LS_KEY = process.argv[3] || "newChapterTracker.v1";
const LABEL = process.argv[4] || "app";
const SETUP_KEY = process.argv[5] || "nct-setup-done";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

let results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS" : "FAIL") + "  [" + LABEL + "] " + name + (detail ? "  (" + detail + ")" : ""));
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { server, port } = await serve();
  const url = "http://127.0.0.1:" + port + "/index.html";
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    await page.addInitScript((key) => { try { localStorage.setItem(key, "1"); } catch {} }, SETUP_KEY);
    // The suite is anchored to Saturday Nov 14, 2026: today is a rest
    // day, Friday Nov 13 is a workout day, and the week view opens on
    // Monday Nov 16. Pin the page clock there so the suite runs on any
    // real date. Only Date is shifted; timers stay real, so the app's
    // debounces and renders still fire.
    await page.addInitScript(() => {
      const fixed = new Date("2026-11-14T12:00:00-05:00").getTime();
      const shift = Date.now() - fixed;
      const OrigDate = window.Date;
      class ShiftedDate extends OrigDate {
        constructor(...args) {
          if (args.length === 0) super(OrigDate.now() - shift);
          else super(...args);
        }
        static now() { return OrigDate.now() - shift; }
      }
      window.Date = ShiftedDate;
    });
    await page.goto(url, { waitUntil: "load" });
    // The title is in the static HTML as "Today's routine"; wait until the
    // app has rendered it, which also means the day-nav handlers are wired.
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });

    const txt = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.textContent : null; }, sel);
    const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
    const store = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, LS_KEY);
    // v094: the Strength detail starts collapsed behind its summary row,
    // so open the row before clicking Log, Swap, or Remove in the Today routine.
    const ensureRoutineOpen = async () => {
      const hidden = await page.evaluate(() => {
        const d = document.getElementById("strength-detail");
        return d ? d.hidden : false;
      });
      if (hidden) { await page.click("#strength-row"); await sleep(200); }
    };

    // 1. Today is Saturday Nov 14, 2026: rest day in both plans.
    check("rest day title", (await txt("#strength-routine-title")) === "Today's routine: Rest day", await txt("#strength-routine-title"));
    check("rest day message", (await txt("#strength-routine-list")).indexOf("Rest day. Walking counts today.") !== -1);
    check("rest day has no Log buttons", (await count("#strength-routine-list [data-log-routine]")) === 0);

    // 2. Back one day to Friday Nov 13: Lower B under the 4-day default.
    await page.click("#day-prev");
    await sleep(300);
    await ensureRoutineOpen();
    check("Friday title is Lower B", (await txt("#strength-routine-title")) === "Today's routine: Lower B", await txt("#strength-routine-title"));
    check("Lower B has 6 exercises", (await count("#strength-routine-list .entry")) === 6);
    check("warmup line shown", (await txt("#strength-routine-warmup")).indexOf("Warm up: 5-minute walk") === 0);
    check("medical advice line shown", (await txt("#strength-routine-note")).indexOf("General fitness information, not medical advice.") === 0);
    check("shot day line shown", (await txt("#strength-routine-shot")).indexOf("On shot day, if you feel nauseated or tired") === 0);
    check("Bulgarian Split Squat present", (await txt("#strength-routine-list")).indexOf("Bulgarian Split Squat") !== -1);

    // 3. Log Dumbbell Deadlift: entry appears, button becomes Logged.
    await page.click('[data-log-routine="Dumbbell Deadlift"]');
    await sleep(300);
    check("Deadlift logged in strength list", (await txt("#strength-list")).indexOf("Dumbbell Deadlift") !== -1);
    check("Deadlift button now Logged and disabled", await page.evaluate(() => {
      const b = document.querySelector('[data-log-routine="Dumbbell Deadlift"]');
      return b && b.textContent === "Logged" && b.disabled;
    }));
    const st1 = await store();
    check("strength entry in store", st1 && st1.strength && st1.strength.some((e) => e.name === "Dumbbell Deadlift" && e.sets === 3 && e.reps === 10));

    // 4. Swap Bulgarian Split Squat to Split Squat (Jessica's example).
    await page.click('[data-swap-routine="Bulgarian Split Squat"]');
    await sleep(200);
    check("swap picker offers Split Squat", (await count('[data-swap-to="Split Squat"]')) === 1);
    check("swap picker offers Goblet Squat", (await count('[data-swap-to="Goblet Squat"]')) === 1);
    await page.click('[data-swap-to="Split Squat"]');
    await sleep(300);
    check("Split Squat now shown", (await txt("#strength-routine-list")).indexOf("Split Squat, 3 x 10 each leg") !== -1);
    check("swapped-from note shown", (await txt("#strength-routine-list")).indexOf("Swapped from Bulgarian Split Squat.") !== -1);
    check("Reset routine button appears", (await count("#strength-routine-reset-btn")) === 1);
    const st2 = await store();
    check("swap persisted in settings", st2 && st2.settings && st2.settings.strengthCustom && st2.settings.strengthCustom["4day:5"] && st2.settings.strengthCustom["4day:5"]["Bulgarian Split Squat"] && st2.settings.strengthCustom["4day:5"]["Bulgarian Split Squat"].swap === "Split Squat");

    // 5. Remove Hip Thrust: gone, Reset still there.
    await page.click('[data-remove-routine="Hip Thrust"]');
    await sleep(300);
    check("Hip Thrust removed", (await txt("#strength-routine-list")).indexOf("Hip Thrust") === -1);
    check("5 exercises left", (await count("#strength-routine-list .entry")) === 5);
    const st3 = await store();
    check("removal persisted", st3 && st3.settings.strengthCustom["4day:5"]["Hip Thrust"] && st3.settings.strengthCustom["4day:5"]["Hip Thrust"].removed === true);

    // 6. Reload: customizations survive.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await page.click("#day-prev");
    await sleep(300);
    await ensureRoutineOpen();
    check("after reload: Split Squat still swapped in", (await txt("#strength-routine-list")).indexOf("Split Squat, 3 x 10 each leg") !== -1);
    check("after reload: Hip Thrust still removed", (await txt("#strength-routine-list")).indexOf("Hip Thrust") === -1);

    // 7. Reset routine restores the built-in day.
    await page.click("#strength-routine-reset-btn");
    await sleep(300);
    check("after reset: Bulgarian Split Squat back", (await txt("#strength-routine-list")).indexOf("Bulgarian Split Squat") !== -1);
    check("after reset: Hip Thrust back", (await txt("#strength-routine-list")).indexOf("Hip Thrust") !== -1);
    check("after reset: 6 exercises", (await count("#strength-routine-list .entry")) === 6);
    check("after reset: no Reset button", (await count("#strength-routine-reset-btn")) === 0);

    // 8. Settings: switch to the 3-day starter; Friday becomes Full-body.
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    check("plan select defaults to 4day", await page.evaluate(() => document.getElementById("set-strength-plan").value === "4day"));
    await page.selectOption("#set-strength-plan", "3day");
    await sleep(900); // autosave debounce
    const st4 = await store();
    check("plan saved as 3day", st4 && st4.settings && st4.settings.strengthPlan === "3day");
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    // The Today tab may reset to today (Saturday, rest day); step back to Friday if so.
    if ((await txt("#strength-routine-title")) === "Today's routine: Rest day") { await page.click("#day-prev"); await sleep(300); }
    await ensureRoutineOpen();
    check("Friday title is Full-body on 3-day plan", (await txt("#strength-routine-title")) === "Today's routine: Full-body", await txt("#strength-routine-title"));
    check("Full-body has 6 exercises", (await count("#strength-routine-list .entry")) === 6);

    // 9. Settings reset-all clears every customization.
    await page.click('[data-swap-routine="Goblet Squat"]');
    await sleep(200);
    await page.click('[data-swap-to="Bodyweight Squat"]');
    await sleep(300);
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    check("reset-all enabled once customized", await page.evaluate(() => !document.getElementById("strength-reset-all").disabled));
    await page.click("#strength-reset-all");
    await sleep(300);
    const st5 = await store();
    check("reset-all cleared strengthCustom", st5 && st5.settings && Object.keys(st5.settings.strengthCustom || {}).length === 0);
    check("reset-all status shown", (await txt("#strength-reset-msg")) === "Routine changes reset.");
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    if ((await txt("#strength-routine-title")) === "Today's routine: Rest day") { await page.click("#day-prev"); await sleep(300); }
    await ensureRoutineOpen();
    check("after reset-all: Goblet Squat back", (await txt("#strength-routine-list")).indexOf("Goblet Squat, 3 x 10") !== -1);

    // 10. Week view (v094): plan the week ahead from Saturday.
    // The plan is 3-day after section 8, so switch back to 4-day first.
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    await page.selectOption("#set-strength-plan", "4day");
    await sleep(900);
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    check("Plan the week row present", (await count("#strength-week-row")) === 1);
    await page.click("#strength-week-row");
    await sleep(300);
    check("week view open", await page.evaluate(() => !document.getElementById("strength-week-view").hidden));
    check("week view has 7 days", (await count("#strength-week-days [data-week-view-day]")) === 7);
    check("week view starts Monday Nov 16", (await count('[data-week-view-day="2026-11-16"]')) === 1);
    check("week view has no Nov 9 (last week)", (await count('[data-week-view-day="2026-11-09"]')) === 0);
    check("week title is Week of November 16", (await txt("#strength-week-title")) === "Week of November 16");
    check("Monday label is Upper A", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-16"]');
      return b && b.getAttribute("aria-label").indexOf("Upper A") !== -1;
    }));
    check("Monday preselected as next workout day", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-16"]');
      return b && b.getAttribute("aria-current") === "date";
    }));
    check("week Monday title is Upper A", (await txt("#strength-week-day-title")) === "Monday, November 16: Upper A");
    check("week Monday has 6 exercises", (await count("#strength-week-day-list .entry")) === 6);
    check("week view has no Log buttons", (await count("#strength-week-day-list [data-log-routine]")) === 0);
    // 10b. Swap Bench Press to Chest Press machine on Monday.
    await page.click('#strength-week-day-list [data-swap-routine="Dumbbell Bench Press"]');
    await sleep(200);
    check("week swap offers Chest Press machine", (await count('#strength-week-day-list [data-swap-to="Chest Press machine"]')) === 1);
    await page.click('#strength-week-day-list [data-swap-to="Chest Press machine"]');
    await sleep(300);
    check("Chest Press machine shown on Monday", (await txt("#strength-week-day-list")).indexOf("Chest Press machine, 3 x 10") !== -1);
    check("swapped-from note shown on Monday", (await txt("#strength-week-day-list")).indexOf("Swapped from Dumbbell Bench Press.") !== -1);
    const st6 = await store();
    check("Monday swap persisted", st6 && st6.settings.strengthCustom["4day:1"] && st6.settings.strengthCustom["4day:1"]["Dumbbell Bench Press"] && st6.settings.strengthCustom["4day:1"]["Dumbbell Bench Press"].swap === "Chest Press machine");
    // 10c. Add Dead Bug to Monday.
    await page.click("#strength-week-add-open");
    await sleep(200);
    await page.selectOption("#strength-week-add-select", "Dead Bug");
    await page.click("#strength-week-add-btn");
    await sleep(300);
    check("Dead Bug added to Monday", (await txt("#strength-week-day-list")).indexOf("Dead Bug, 2 x 10 each side") !== -1);
    check("Monday has 7 exercises", (await count("#strength-week-day-list .entry")) === 7);
    const st7 = await store();
    check("Monday add persisted", st7 && st7.settings.strengthCustom["4day:1"] && st7.settings.strengthCustom["4day:1"]["__add:Dead Bug"] && st7.settings.strengthCustom["4day:1"]["__add:Dead Bug"].add === "Dead Bug");
    // 10d. Reload: Monday's plan survives, still no Log. Sunday is a rest day.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await page.click("#strength-week-row");
    await sleep(300);
    check("after reload: Chest Press machine still on Monday", (await txt("#strength-week-day-list")).indexOf("Chest Press machine, 3 x 10") !== -1);
    check("after reload: Dead Bug still on Monday", (await txt("#strength-week-day-list")).indexOf("Dead Bug, 2 x 10 each side") !== -1);
    check("after reload: still no Log buttons", (await count("#strength-week-day-list [data-log-routine]")) === 0);
    await page.click('[data-week-view-day="2026-11-22"]');
    await sleep(300);
    check("Sunday is a rest day", (await txt("#strength-week-day-title")) === "Sunday, November 22: Rest day");
    check("Sunday rest message shown", (await txt("#strength-week-day-list")).indexOf("Rest day. Walking counts today.") !== -1);
    check("rest day has no Add button", (await count("#strength-week-add-open")) === 0);
    await page.click('[data-week-view-day="2026-11-16"]');
    await sleep(300);
    check("back on Monday after Sunday", (await txt("#strength-week-day-title")) === "Monday, November 16: Upper A");
    await page.click("#strength-week-close");
    await sleep(300);
    check("Close hides the week view", await page.evaluate(() => document.getElementById("strength-week-view").hidden));
    // 10e. Plan switch updates the week view: 3-day Monday is Upper, Wednesday is Lower.
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    await page.selectOption("#set-strength-plan", "3day");
    await sleep(900);
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    await page.click("#strength-week-row");
    await sleep(300);
    check("3-day Monday label is Upper", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-16"]');
      return b && b.getAttribute("aria-label").indexOf("Upper") !== -1 && b.getAttribute("aria-label").indexOf("Upper A") === -1;
    }));
    check("3-day Wednesday label is Lower", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-18"]');
      return b && b.getAttribute("aria-label").indexOf("Lower") !== -1;
    }));
    check("3-day Friday label is Full-body", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-20"]');
      return b && b.getAttribute("aria-label").indexOf("Full-body") !== -1;
    }));
    check("3-day Monday has no 4-day swap", (await txt("#strength-week-day-list")).indexOf("Chest Press machine") === -1);
    await page.click("#strength-week-close");
    await sleep(300);
    // 10f. Week reset restores Monday on the 4-day plan.
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    await page.selectOption("#set-strength-plan", "4day");
    await sleep(900);
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    await page.click("#strength-week-row");
    await sleep(300);
    check("week reset start: Chest Press machine present", (await txt("#strength-week-day-list")).indexOf("Chest Press machine, 3 x 10") !== -1);
    check("week reset start: Dead Bug present", (await txt("#strength-week-day-list")).indexOf("Dead Bug, 2 x 10 each side") !== -1);
    await page.click("#strength-week-day-reset-btn");
    await sleep(300);
    check("week reset: Bench Press back", (await txt("#strength-week-day-list")).indexOf("Dumbbell Bench Press, 3 x 10") !== -1);
    check("week reset: Dead Bug gone", (await txt("#strength-week-day-list")).indexOf("Dead Bug") === -1);
    check("week reset: 6 exercises", (await count("#strength-week-day-list .entry")) === 6);
    check("week reset: no Reset button", (await count("#strength-week-day-reset-btn")) === 0);
    const st8 = await store();
    check("week reset: strengthCustom empty", st8 && st8.settings && Object.keys(st8.settings.strengthCustom || {}).length === 0);

    // 11. Fitness card simplification (v094): short summary rows on first view,
    // detail one tap away, tabs for My Exercises / History / All Exercises.
    // Close the strength row first: persistence from earlier sections keeps it
    // open. Then reload for a fresh first view, then go to Friday.
    const strengthOpen = await page.evaluate(() => !document.getElementById("strength-detail").hidden);
    if (strengthOpen) { await page.click("#strength-row"); await sleep(200); }
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await page.click("#day-prev");
    await sleep(300);
    check("three summary rows present", (await count("#movement-row, #strength-row, #strength-week-row")) === 3);
    check("Movement row label", (await txt("#movement-row .fitness-row-label")) === "Movement");
    check("Strength row label", (await txt("#strength-row .fitness-row-label")) === "Strength");
    check("Plan the week row label", (await txt("#strength-week-row .fitness-row-label")) === "Plan the week");
    check("Movement row status shows minutes of 30", /^\d+ of 30 min/.test((await txt("#movement-row-status")) || ""), await txt("#movement-row-status"));
    check("Strength row status is Lower B, 6 exercises, 1 logged", (await txt("#strength-row-status")) === "Lower B · 6 exercises · 1 logged");
    check("Plan the week row status is 4 workouts", (await txt("#strength-week-row-status")) === "4 workouts · Mon, Tue, Thu, Fri");
    check("strength detail hidden on first view", await page.evaluate(() => document.getElementById("strength-detail").hidden));
    check("movement detail hidden on first view", await page.evaluate(() => document.getElementById("movement-detail").hidden));
    check("Log button not visible while collapsed", await page.evaluate(() => {
      const b = document.querySelector('[data-log-routine="Dumbbell Deadlift"]');
      return b && b.offsetParent === null;
    }));
    const cardH1 = await page.evaluate(() => document.getElementById("fitness-card").getBoundingClientRect().height);
    // Open the strength row: the routine shows, My Exercises tab selected.
    await page.click("#strength-row");
    await sleep(300);
    check("strength detail visible after opening the row", await page.evaluate(() => !document.getElementById("strength-detail").hidden));
    check("My Exercises tab selected", await page.evaluate(() => document.getElementById("strength-tab-mine").getAttribute("aria-selected") === "true"));
    check("History tab present", (await count("#strength-tab-history")) === 1);
    check("All Exercises tab present", (await count("#strength-tab-all")) === 1);
    check("routine shows Lower B", (await txt("#strength-routine-title")) === "Today's routine: Lower B");
    check("Log button visible after opening the row", await page.evaluate(() => {
      const b = document.querySelector('[data-log-routine="Dumbbell Deadlift"]');
      return b && b.offsetParent !== null;
    }));
    const cardH2 = await page.evaluate(() => document.getElementById("fitness-card").getBoundingClientRect().height);
    check("expanded card is much taller than collapsed", cardH2 > cardH1 + 200, Math.round(cardH1) + "px collapsed, " + Math.round(cardH2) + "px expanded");
    // All Exercises tab: add Plank to Friday Lower B.
    await page.click("#strength-tab-all");
    await sleep(300);
    check("All Exercises tab selected", await page.evaluate(() => document.getElementById("strength-tab-all").getAttribute("aria-selected") === "true"));
    check("All Exercises intro shown", (await txt("#strength-tab-panel-all .muted")) === "Every exercise in the library. Tap Add to put one in today's routine.");
    await page.click('#strength-all-exercises [data-add-all-exercise="Plank"]');
    await sleep(300);
    check("My Exercises tab selected after Add", await page.evaluate(() => document.getElementById("strength-tab-mine").getAttribute("aria-selected") === "true"));
    check("Plank added to Friday routine", (await txt("#strength-routine-list")).indexOf("Plank") !== -1);
    const st9 = await store();
    check("Plank add persisted", st9 && st9.settings.strengthCustom["4day:5"] && st9.settings.strengthCustom["4day:5"]["__add:Plank"] && st9.settings.strengthCustom["4day:5"]["__add:Plank"].add === "Plank");
    // Close the strength row again.
    await page.click("#strength-row");
    await sleep(300);
    check("strength detail hidden again after closing the row", await page.evaluate(() => document.getElementById("strength-detail").hidden));

    // 12. Last weight (lbs) on routine rows: shown when a prior log has a
    // weight, nothing when no weight was logged or the weight is zero,
    // nothing for Plank (bodyweight). Same row component on Today and in
    // the week view.
    const lbsSeeded = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.strength = st.strength || [];
      st.strength.push({ id: "lbs-test-1", date: "2026-11-12", name: "Dumbbell Bench Press", sets: 3, reps: 10, weight: 20 });
      st.strength.push({ id: "lbs-test-2", date: "2026-11-13", name: "Dumbbell Bench Press", sets: 3, reps: 10, weight: 25 });
      st.strength.push({ id: "lbs-test-3", date: "2026-11-13", name: "One-Arm Dumbbell Row", sets: 3, reps: 10, weight: 0 });
      st.strength.push({ id: "lbs-test-4", date: "2026-11-14", name: "Dumbbell Deadlift", sets: 3, reps: 10, weight: 30 });
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("lbs seed stored", lbsSeeded);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    // Reload resets to Saturday; step back to Friday Lower B.
    await page.click("#day-prev");
    await sleep(300);
    const weekTitles = () => page.evaluate(() => Array.from(document.querySelectorAll("#strength-week-day-list .entry-title")).map((el) => el.textContent));
    const routineTitles = () => page.evaluate(() => Array.from(document.querySelectorAll("#strength-routine-list .entry-title")).map((el) => el.textContent));
    await ensureRoutineOpen();
    await page.click("#strength-week-row");
    await sleep(300);
    check("week view open for lbs check", await page.evaluate(() => !document.getElementById("strength-week-view").hidden));
    check("Bench Press row shows last weight 25 lbs", (await weekTitles()).includes("Dumbbell Bench Press, 3 x 10, 25 lbs"));
    check("Row with zero weight shows no lbs", (await weekTitles()).includes("One-Arm Dumbbell Row, 3 x 10 each side"));
    check("Row never logged shows no lbs", (await weekTitles()).includes("Dumbbell Shoulder Press, 3 x 10"));
    check("No week row shows 0 lbs", (await weekTitles()).every((t) => t.indexOf("0 lbs") === -1));
    await page.click("#strength-week-close");
    await sleep(300);
    check("Deadlift row on Today shows last weight 30 lbs", (await routineTitles()).some((t) => t.includes("Dumbbell Deadlift, 3 x 10, 30 lbs")));
    check("Plank row shows no lbs", (await routineTitles()).includes("Plank, 2 x 30 seconds"));

    // 13. v095 barcode auto-log: a lookup with macros logs itself and
    // the macros and calories update at once, with an Undo. An unknown
    // food and an all-zero food stay manual. The demo has no barcode
    // scanner, so it skips this section.
    const hasScanner = (await count("#macro-scan-food")) === 1;
    if (!hasScanner) {
      check("scan auto-log n/a in demo (no scanner)", true, "demo has no barcode scanner");
    } else {
      // Back to today: section 12 left the view on Friday.
      await page.click("#day-next");
      await sleep(300);
      const proteinToday = async () => Number((await txt("#logged-protein")) || 0);
      const caloriesToday = async () => Number(((await txt("#calories-today")) || "0").replace(/,/g, ""));
      const proteinBefore = await proteinToday();
      const caloriesBefore = await caloriesToday();
      // Seed a known food in Your foods: 20g protein, 5g carbs, 3g fat,
      // 127 calories (20*4 + 5*4 + 3*9).
      const scanSeeded = await page.evaluate((k) => {
        let st = null;
        try { st = JSON.parse(localStorage.getItem(k)); } catch {}
        if (!st) return false;
        st.foodLibrary = st.foodLibrary || {};
        st.foodLibrary["1234567890123"] = { barcode: "1234567890123", name: "Scan Test Yogurt", brand: "Test Brand", protein: 20, carbs: 5, fat: 3, calories: 127, savedAt: Date.now() };
        st.foodLibrary["9999999999999"] = { barcode: "9999999999999", name: "Zero Macro Food", brand: "", protein: 0, carbs: 0, fat: 0, calories: 0, savedAt: Date.now() };
        localStorage.setItem(k, JSON.stringify(st));
        return true;
      }, LS_KEY);
      check("scan seed stored", scanSeeded);
      await page.reload({ waitUntil: "load" });
      await page.waitForFunction(() => {
        const t = document.getElementById("strength-routine-title");
        return !!t && t.textContent !== "Today's routine";
      }, null, { timeout: 10000 });
      // Type the known barcode and look it up: it auto-logs.
      await page.click("#macro-scan-food");
      await sleep(300);
      await page.fill("#scan-barcode-input", "1234567890123");
      await page.click("#scan-action-btn");
      await sleep(500);
      check("scan modal closed after auto-log", await page.evaluate(() => document.getElementById("scan-modal").classList.contains("hidden")));
      check("Undo banner shown with the food name", await page.evaluate(() => {
        const b = document.getElementById("scan-undo");
        return b && b.style.display !== "none" && document.getElementById("scan-undo-food").textContent.indexOf("Scan Test Yogurt") !== -1;
      }));
      check("protein total up 20 after auto-log", (await proteinToday()) === proteinBefore + 20, proteinBefore + " -> " + (await proteinToday()));
      check("calories total up 127 after auto-log", (await caloriesToday()) === caloriesBefore + 127, caloriesBefore + " -> " + (await caloriesToday()));
      const stScan = await store();
      check("auto-logged entry in store", !!(stScan && (stScan.protein || []).some((e) => (e.food || "").indexOf("Scan Test Yogurt") !== -1)));
      // Undo takes just that entry back.
      await page.click("#scan-undo-btn");
      await sleep(300);
      check("protein back after Undo", (await proteinToday()) === proteinBefore);
      check("calories back after Undo", (await caloriesToday()) === caloriesBefore);
      check("Undo banner hidden after Undo", await page.evaluate(() => document.getElementById("scan-undo").style.display === "none"));
      const stUndo = await store();
      check("auto-logged entry gone after Undo", !(stUndo && (stUndo.protein || []).some((e) => (e.food || "").indexOf("Scan Test Yogurt") !== -1)));
      // All-zero food: no auto-log, the form stays open for manual entry.
      const proteinBeforeZero = await proteinToday();
      await page.click("#macro-scan-food");
      await sleep(300);
      await page.fill("#scan-barcode-input", "9999999999999");
      await page.click("#scan-action-btn");
      await sleep(500);
      check("zero-macro food does not auto-log (modal stays open)", await page.evaluate(() => !document.getElementById("scan-modal").classList.contains("hidden")));
      check("zero-macro food adds no entry", (await proteinToday()) === proteinBeforeZero);
      check("zero-macro Undo banner stays hidden", await page.evaluate(() => document.getElementById("scan-undo").style.display === "none"));
      await page.click("#scan-close-btn");
      await sleep(200);
      // Unknown food: Open Food Facts says not found, so no auto-log;
      // the manual form stays, and Log still works by hand.
      await page.route("**/world.openfoodfacts.org/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: 0 }) }));
      await page.click("#macro-scan-food");
      await sleep(300);
      await page.fill("#scan-barcode-input", "5555555555555");
      await page.click("#scan-action-btn");
      await sleep(500);
      check("unknown food does not auto-log (modal stays open)", await page.evaluate(() => !document.getElementById("scan-modal").classList.contains("hidden")));
      check("unknown food adds no entry", (await proteinToday()) === proteinBeforeZero);
      await page.fill("#scan-protein", "10");
      await page.click("#scan-log-btn");
      await sleep(500);
      check("manual Log still works after unknown lookup", (await proteinToday()) === proteinBeforeZero + 10);
      check("modal closed after manual Log", await page.evaluate(() => document.getElementById("scan-modal").classList.contains("hidden")));
      await page.unroute("**/world.openfoodfacts.org/**");
    }

    // 14. v095 doctor summary dedup: one button, on Shots. The Weight
    // and Side effects buttons are gone; the strength-area link stays.
    const doctorBtns = (sel) => page.evaluate((s) => Array.from(document.querySelectorAll(s)).filter((b) => b.textContent.trim() === "Doctor visit summary").length, sel);
    check("one Doctor visit summary button on Shots", (await doctorBtns("#tab-shots .doctor-summary-btn")) === 1);
    check("no Doctor visit summary button on Weight", (await doctorBtns("#tab-weight .doctor-summary-btn")) === 0);
    check("no Doctor visit summary button on Side effects", (await doctorBtns("#tab-side-effects .doctor-summary-btn")) === 0);
    check("two doctor summary controls in total", (await count(".doctor-summary-btn")) === 2);
    check("strength-area doctor summary link kept", (await count(".linklike.doctor-summary-btn")) === 1);
    await page.evaluate(() => showTab("shots"));
    await sleep(300);
    await page.click("#doctor-summary-btn");
    await sleep(300);
    check("Shots button opens the doctor modal", await page.evaluate(() => !document.getElementById("doctor-modal").classList.contains("hidden")));
    await page.click("#doctor-close");
    await sleep(200);
    check("doctor modal closes", await page.evaluate(() => document.getElementById("doctor-modal").classList.contains("hidden")));

    // 15. Steps, typed in by hand (v096): a Steps row on Today, tap to
    // type the count, saved per day, survives a reload, cleared by Clear.
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    // The demo enters this section still viewing Friday (its section 13
    // has no scan, so it never steps back to today). Step forward when
    // the next-day arrow is showing, so the count lands on today.
    const nextVisible = await page.evaluate(() => {
      const b = document.getElementById("day-next");
      return !!b && b.style.visibility !== "hidden";
    });
    if (nextVisible) { await page.click("#day-next"); await sleep(300); }
    check("Steps row present", (await count("#steps-row")) === 1);
    check("Steps row status starts Not logged", (await txt("#steps-row-status")) === "Not logged");
    await page.click("#steps-row");
    await sleep(200);
    check("Steps detail opens", await page.evaluate(() => !document.getElementById("steps-detail").hidden));
    await page.fill("#steps-inline-input", "8500");
    await page.click("#steps-inline-save-btn");
    await sleep(300);
    check("Steps row status shows 8,500 steps", (await txt("#steps-row-status")) === "8,500 steps");
    const stSteps = await store();
    check("steps saved in store for today", !!(stSteps && stSteps.steps && stSteps.steps["2026-11-14"] === 8500));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    check("steps survive a reload", (await txt("#steps-row-status")) === "8,500 steps");
    const stepsOpenAfterReload = await page.evaluate(() => !document.getElementById("steps-detail").hidden);
    if (!stepsOpenAfterReload) { await page.click("#steps-row"); await sleep(200); }
    await page.click("#steps-inline-clear-btn");
    await sleep(300);
    check("Steps row status back to Not logged after Clear", (await txt("#steps-row-status")) === "Not logged");
    const stSteps2 = await store();
    check("steps cleared from store", !(stSteps2 && stSteps2.steps && stSteps2.steps["2026-11-14"]));

    // 16. Food day picker (v096): copy food from any earlier day, not
    // just yesterday. Foods already logged today are skipped.
    const foodSeeded = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.protein = st.protein || [];
      st.protein.push({ id: "picker-oats-11", date: "2026-11-11", grams: 15, carbs: 30, fat: 5, food: "Picker Oats", meal: "Breakfast", calories: 225 });
      st.protein.push({ id: "picker-soup-11", date: "2026-11-11", grams: 10, carbs: 20, fat: 3, food: "Picker Soup", meal: "Lunch", calories: 147 });
      st.protein.push({ id: "picker-rice-13", date: "2026-11-13", grams: 5, carbs: 40, fat: 2, food: "Yesterday Rice", meal: "Dinner", calories: 198 });
      st.protein.push({ id: "picker-oats-14", date: "2026-11-14", grams: 15, carbs: 30, fat: 5, food: "Picker Oats", meal: "Breakfast", calories: 225 });
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("food picker seed stored", foodSeeded);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    const proteinToday = async () => Number((await txt("#logged-protein")) || 0);
    const proteinBeforePicker = await proteinToday();
    await page.fill("#copy-food-date", "2026-11-11");
    await page.click("#copy-food-day");
    await sleep(300);
    check("copy from Nov 11 skips the oats already logged today", (await proteinToday()) === proteinBeforePicker + 10, proteinBeforePicker + " -> " + (await proteinToday()));
    check("copy from Nov 11 message names the day", (await txt("#copy-yesterday-food-msg")) === "Copied 1 food from Wed, Nov 11.");
    const stPicker = await store();
    check("soup copied into today", !!(stPicker && (stPicker.protein || []).some((e) => e.date === "2026-11-14" && e.food === "Picker Soup")));
    check("oats not duplicated today", (stPicker && (stPicker.protein || []).filter((e) => e.date === "2026-11-14" && e.food === "Picker Oats").length) === 1);
    await page.click("#copy-food-day");
    await sleep(300);
    check("copying the same day again adds nothing", (await txt("#copy-yesterday-food-msg")) === "Already copied. Nothing new to add.");
    // Copy yesterday: what is pending depends on the store (the demo
    // seeds a Friday protein shake), so count it from the store first.
    const beforeCopyY = await store();
    const friFoods = (beforeCopyY.protein || []).filter((e) => e.date === "2026-11-13");
    const satFoods = (beforeCopyY.protein || []).filter((e) => e.date === "2026-11-14");
    const pendingY = friFoods.filter((e) => !satFoods.some((x) => (x.food || "").trim().toLowerCase() === (e.food || "").trim().toLowerCase() && Number(x.grams) === Number(e.grams)));
    const pendingYGrams = pendingY.reduce((t, e) => t + Number(e.grams || 0), 0);
    const proteinBeforeY = await proteinToday();
    await page.click("#copy-yesterday-food");
    await sleep(300);
    check("Copy yesterday still works", (await txt("#copy-yesterday-food-msg")) === "Copied " + pendingY.length + (pendingY.length === 1 ? " food" : " foods") + " from yesterday.");
    check("yesterday foods copied", (await proteinToday()) === proteinBeforeY + pendingYGrams);
    await page.fill("#copy-food-date", "2026-11-14");
    await page.click("#copy-food-day");
    await sleep(300);
    check("today cannot be copied from", (await txt("#copy-yesterday-food-msg")) === "Pick an earlier day to copy from.");
    await page.fill("#copy-food-date", "");
    await page.click("#copy-food-day");
    await sleep(300);
    check("empty date asks for a day", (await txt("#copy-yesterday-food-msg")) === "Pick a day to copy from.");

    // 17. Weight at log time (v096): the routine row shows a weight
    // input prefilled with the last weight; changing it before Log
    // logs the new weight, and the row shows it right away. The week
    // view never logs, so it has no weight input.
    await page.click("#day-prev");
    await sleep(300);
    await ensureRoutineOpen();
    check("Friday title is Lower B for weight check", (await txt("#strength-routine-title")) === "Today's routine: Lower B");
    check("Hip Thrust weight input starts blank", (await page.inputValue('.routine-weight-input[data-weight-for="Hip Thrust"]')) === "");
    check("Deadlift weight input prefilled with last weight 30", (await page.inputValue('.routine-weight-input[data-weight-for="Dumbbell Deadlift"]')) === "30");
    await page.fill('.routine-weight-input[data-weight-for="Hip Thrust"]', "40");
    await page.click('[data-log-routine="Hip Thrust"]');
    await sleep(300);
    check("Hip Thrust logged with the new weight", await page.evaluate(() => {
      const b = document.querySelector('[data-log-routine="Hip Thrust"]');
      return b && b.textContent === "Logged" && b.disabled;
    }));
    check("Hip Thrust row shows 40 lbs right away", (await routineTitles()).some((t) => t.includes("Hip Thrust, 3 x 12, 40 lbs")));
    const stWeight = await store();
    check("Hip Thrust entry stores weight 40", !!(stWeight && (stWeight.strength || []).some((e) => e.date === "2026-11-13" && e.name === "Hip Thrust" && String(e.weight) === "40")));
    await page.click("#strength-week-row");
    await sleep(300);
    check("week view has no weight inputs", (await count("#strength-week-day-list .routine-weight-input")) === 0);
    await page.click("#strength-week-close");
    await sleep(300);

    // 18. Doctor summary strength lines (v096): the count line stays
    // as the header, and underneath one line per day names the
    // exercises with sets, reps, and weight.
    const doctorSeeded = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.strength = st.strength || [];
      st.strength.push({ id: "doc-test-1", date: "2026-11-12", name: "Dumbbell Incline Press", sets: 3, reps: 10, weight: 15 });
      st.strength.push({ id: "doc-test-2", date: "2026-11-12", name: "Lateral Raise", sets: 3, reps: 12, weight: "" });
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("doctor seed stored", doctorSeeded);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await page.evaluate(() => showTab("shots"));
    await sleep(300);
    await page.click("#doctor-summary-btn");
    await sleep(300);
    const doctorText = await page.evaluate(() => (document.getElementById("doctor-text") || {}).value || "");
    check("doctor count line kept", /Strength: \d+ exercises? logged across \d+ days?, \d+ sets in total\./.test(doctorText), (doctorText.match(/Strength: [^\n]*/) || [""])[0]);
    // One line per day; the demo seeds extra entries on the same days
    // (Squats on Nov 12, Wall push-ups on Nov 14), so check each day's
    // line contains the expected entries, not the exact whole line.
    const lineFor = (prefix) => doctorText.split("\n").find((l) => l.indexOf(prefix) === 0) || "";
    check("doctor Nov 12 line names Incline Press with weight", lineFor("Nov 12, 2026:").indexOf("Dumbbell Incline Press 3x10, 15 lbs") !== -1);
    check("doctor Nov 12 line names Bench Press 20 lbs", lineFor("Nov 12, 2026:").indexOf("Dumbbell Bench Press 3x10, 20 lbs") !== -1);
    check("doctor Nov 12 line names Lateral Raise without weight", lineFor("Nov 12, 2026:").indexOf("Lateral Raise 3x12") !== -1 && lineFor("Nov 12, 2026:").indexOf("Lateral Raise 3x12, ") === -1);
    check("doctor Nov 13 line names Bench Press 25 lbs", lineFor("Nov 13, 2026:").indexOf("Dumbbell Bench Press 3x10, 25 lbs") !== -1);
    check("doctor Nov 13 line names Deadlift without weight", lineFor("Nov 13, 2026:").indexOf("Dumbbell Deadlift 3x10;") !== -1);
    check("doctor Nov 13 line names Hip Thrust 40 lbs", lineFor("Nov 13, 2026:").indexOf("Hip Thrust 3x12, 40 lbs") !== -1);
    check("doctor Nov 14 line names Deadlift 30 lbs", lineFor("Nov 14, 2026:").indexOf("Dumbbell Deadlift 3x10, 30 lbs") !== -1);
    check("doctor summary never shows a 0 lbs weight", doctorText.indexOf(", 0 lbs") === -1);
    await page.click("#doctor-close");
    await sleep(200);

    // 19. Copy-yesterday warning (v096): copying yesterday's strength
    // asks first, because it can work the same muscles two days in a
    // row. Movement alone copies with no warning. Cancelling copies nothing.
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    await ensureRoutineOpen();
    await page.click("#strength-tab-history");
    await sleep(200);
    // What is already on Saturday depends on the store (the demo seeds
    // a Saturday Wall push-up and two Saturday movement entries), so
    // count it from the store instead of assuming an empty day.
    const satBefore = await store();
    const satSt0 = (satBefore.strength || []).filter((e) => e.date === "2026-11-14").length;
    const satEx0 = (satBefore.exercise || []).filter((e) => e.date === "2026-11-14").length;
    // Friday (yesterday) has strength; Saturday (today) does not have
    // it yet. Cancel the confirm: nothing is copied.
    await page.evaluate(() => { window.confirm = () => false; });
    await page.click("#copy-yesterday-exercise");
    await sleep(300);
    const stCancel = await store();
    check("cancelled copy adds no strength today", (stCancel && (stCancel.strength || []).filter((e) => e.date === "2026-11-14").length) === satSt0);
    check("cancelled copy adds no movement today", (stCancel && (stCancel.exercise || []).filter((e) => e.date === "2026-11-14").length) === satEx0);
    // Count what is pending from Friday, by the same duplicate rule the
    // app uses, before accepting.
    const friSt = (stCancel.strength || []).filter((e) => e.date === "2026-11-13");
    const satSt = (stCancel.strength || []).filter((e) => e.date === "2026-11-14");
    const pendingSt = friSt.filter((e) => !satSt.some((x) => (x.name || "") === (e.name || "") && Number(x.sets) === Number(e.sets) && Number(x.reps) === Number(e.reps) && String(x.weight) === String(e.weight)));
    const friEx = (stCancel.exercise || []).filter((e) => e.date === "2026-11-13");
    const satEx = (stCancel.exercise || []).filter((e) => e.date === "2026-11-14");
    const pendingEx = friEx.filter((e) => !satEx.some((x) => (x.label || "") === (e.label || "") && Number(x.minutes) === Number(e.minutes)));
    const pendingTotal = pendingSt.length + pendingEx.length;
    // Accept: the pending entries copy.
    await page.evaluate(() => { window.confirm = () => true; });
    await page.click("#copy-yesterday-exercise");
    await sleep(300);
    check("accepted copy message", (await txt("#copy-yesterday-exercise-msg")) === "Copied " + pendingTotal + (pendingTotal === 1 ? " entry" : " entries") + " from yesterday.");
    const stAccept = await store();
    check("accepted copy adds Friday strength to today", (stAccept && (stAccept.strength || []).filter((e) => e.date === "2026-11-14").length) === satSt0 + pendingSt.length);
    // Movement alone: seed a Friday walk, with Friday's strength
    // already copied, so only movement is pending. No confirm appears.
    const moveSeeded = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.exercise = st.exercise || [];
      st.exercise.push({ id: "move-test-1", date: "2026-11-13", minutes: 10, label: "Walk" });
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("movement-only seed stored", moveSeeded);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await ensureRoutineOpen();
    await page.click("#strength-tab-history");
    await sleep(200);
    await page.evaluate(() => { window.__confirmCalled = false; window.confirm = () => { window.__confirmCalled = true; return true; }; });
    await page.click("#copy-yesterday-exercise");
    await sleep(300);
    check("movement-only copy shows no confirm", await page.evaluate(() => window.__confirmCalled === false));
    check("movement-only copy message", (await txt("#copy-yesterday-exercise-msg")) === "Copied 1 entry from yesterday.");
    const stMove = await store();
    check("walk copied into today", !!(stMove && (stMove.exercise || []).some((e) => e.date === "2026-11-14" && e.label === "Walk" && e.minutes === 10)));

    // 20. v098: Fitness h2, demo digest, no scan line, shot-day picker.
    // The Fitness card has a real h2 now, so its h3s no longer read as
    // subsections of Water.
    check("Fitness card has one h2", (await count("#fitness-card h2")) === 1);
    check("Fitness h2 is named Fitness", await page.evaluate(() => { const h = document.querySelector("#fitness-card h2"); return !!h && h.getAttribute("aria-label") === "Fitness"; }));
    check("Fitness h2 wraps the toggle", await page.evaluate(() => { const h = document.querySelector("#fitness-card h2"); return !!h && !!h.querySelector("#movement-toggle"); }));
    // The toggle still works with the h2 around it; restore its state.
    const fitExpandedBefore = await page.evaluate(() => document.getElementById("movement-toggle").getAttribute("aria-expanded"));
    await page.click("#movement-toggle");
    await sleep(200);
    const fitExpandedAfter = await page.evaluate(() => document.getElementById("movement-toggle").getAttribute("aria-expanded"));
    check("Fitness toggle still flips", fitExpandedBefore !== fitExpandedAfter);
    await page.click("#movement-toggle");
    await sleep(200);
    // Week digest on Today, populated from the week's logs. The first
    // line is unconditional, so it reads even on a quiet week.
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    check("week digest present", (await count("#digest-details")) === 1);
    check("week digest title is This week", (await txt("#digest-title")) === "This week");
    check("week digest shows days logged", (await txt("#digest-body")).indexOf("You showed up") !== -1);
    // The dead-end plate line is gone from Today.
    check("no scan-my-plate line on Today", await page.evaluate(() => !document.body.textContent.includes("Scan my plate arrives in December.")));
    // Shot-day picker: clear the day, reload, pick Wednesday on the card.
    const shotDayCleared = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.settings = st.settings || {};
      st.settings.shotDay = "";
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("shot day cleared", shotDayCleared);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    check("picker visible with no shot day", await page.evaluate(() => { const p = document.getElementById("next-shot-day-picker"); return !!p && !p.classList.contains("hidden"); }));
    check("empty-state line points at the picker", (await txt("#next-injection-line")) === "Set your shot day below.");
    check("Set shot day button stays hidden", await page.evaluate(() => document.getElementById("goto-shot-day-btn").classList.contains("hidden")));
    await page.selectOption("#next-shot-day-select", "Wednesday");
    await sleep(300);
    const stShot = await store();
    check("picker writes shot day to settings", !!(stShot && stShot.settings && stShot.settings.shotDay === "Wednesday"));
    // The card shows the date, not the day name: "Next shot: Nov 18
    // (in 4 days)" with no prior shot, "Today is your shot day"
    // when the last shot was 7 days ago (demo seed), or the gentle
    // missed-shot line when this week's picked day already passed
    // with no shot logged (app: Wednesday was Nov 11).
    const shotLine = await txt("#next-injection-line");
    check("card shows the shot date after picking", shotLine.indexOf("Next shot:") !== -1 || shotLine.indexOf("Today is your shot day") !== -1 || shotLine.indexOf("It was due") !== -1, shotLine);
    check("picker hides once the day is set", await page.evaluate(() => document.getElementById("next-shot-day-picker").classList.contains("hidden")));
    // The Settings form reads the same setting, so leaving Settings
    // cannot autosave a stale blank day over the picked day.
    await page.evaluate(() => showTab("settings"));
    await sleep(300);
    check("Settings shot day shows Wednesday", await page.evaluate(() => document.getElementById("set-shot-day").value === "Wednesday"));
    await page.evaluate(() => showTab("today"));
    await sleep(300);
    const stShot2 = await store();
    check("shot day survives leaving Settings", !!(stShot2 && stShot2.settings && stShot2.settings.shotDay === "Wednesday"));

    // 21. v099: YMCA machines plan. Third plan choice in Settings;
    // Mon Upper, Wed Lower, Fri Full-body, each exercise with a
    // planned starting weight. The same name carries a different
    // weight on a different day; a logged weight wins over the plan.
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    check("plan select offers ymca", await page.evaluate(() => Array.from(document.getElementById("set-strength-plan").options).some((o) => o.value === "ymca")));
    await page.selectOption("#set-strength-plan", "ymca");
    await sleep(900);
    const stYmca = await store();
    check("plan saved as ymca", stYmca && stYmca.settings && stYmca.settings.strengthPlan === "ymca");
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    check("Plan the week row is 3 workouts Mon Wed Fri", (await txt("#strength-week-row-status")) === "3 workouts · Mon, Wed, Fri");
    if ((await txt("#strength-routine-title")) === "Today's routine: Rest day") { await page.click("#day-prev"); await sleep(300); }
    await ensureRoutineOpen();
    check("Friday title is Full-body on ymca plan", (await txt("#strength-routine-title")) === "Today's routine: Full-body", await txt("#strength-routine-title"));
    check("Friday Full-body has 7 exercises", (await count("#strength-routine-list .entry")) === 7);
    check("Friday Leg Press shows planned 50 lbs", (await txt("#strength-routine-list")).indexOf("Leg Press, 2 x 12, 50 lbs") !== -1);
    check("Friday Lat Pulldown shows planned 25 lbs", (await txt("#strength-routine-list")).indexOf("Lat Pulldown, 2 x 12, 25 lbs") !== -1);
    check("Friday Abdominal Machine shows planned 15 lbs", (await txt("#strength-routine-list")).indexOf("Abdominal Machine, 2 x 12, 15 lbs") !== -1);
    check("Friday Leg Press input pre-fills 50", await page.evaluate(() => { const i = document.querySelector('.routine-weight-input[data-weight-for="Leg Press"]'); return !!i && i.value === "50"; }));
    // Wednesday: the same Leg Press shows its own planned weight, 60.
    await page.click("#day-prev");
    await sleep(300);
    await page.click("#day-prev");
    await sleep(300);
    await ensureRoutineOpen();
    check("Wednesday title is Lower", (await txt("#strength-routine-title")) === "Today's routine: Lower", await txt("#strength-routine-title"));
    check("Wednesday Lower has 7 exercises", (await count("#strength-routine-list .entry")) === 7);
    check("Wednesday Leg Press shows planned 60 lbs", (await txt("#strength-routine-list")).indexOf("Leg Press, 3 x 12, 60 lbs") !== -1);
    check("Wednesday Hip Abduction shows 3 x 15, 30 lbs", (await txt("#strength-routine-list")).indexOf("Hip Abduction, 3 x 15, 30 lbs") !== -1);
    check("Wednesday Glute Machine shows planned 20 lbs", (await txt("#strength-routine-list")).indexOf("Glute Machine, 2 x 12, 20 lbs") !== -1);
    check("Wednesday Leg Press input pre-fills 60", await page.evaluate(() => { const i = document.querySelector('.routine-weight-input[data-weight-for="Leg Press"]'); return !!i && i.value === "60"; }));
    // Log Leg Press at its planned weight, then log Seated Leg Curl
    // with a changed weight: the changed weight is what is stored.
    await page.click('[data-log-routine="Leg Press"]');
    await sleep(300);
    const stLeg = await store();
    check("Leg Press logged with planned weight 60", !!(stLeg && (stLeg.strength || []).some((e) => e.date === "2026-11-11" && e.name === "Leg Press" && e.sets === 3 && e.reps === 12 && String(e.weight) === "60")));
    await page.fill('.routine-weight-input[data-weight-for="Seated Leg Curl machine"]', "25");
    await page.click('[data-log-routine="Seated Leg Curl machine"]');
    await sleep(300);
    const stCurl = await store();
    check("Seated Leg Curl logged with changed weight 25", !!(stCurl && (stCurl.strength || []).some((e) => e.date === "2026-11-11" && e.name === "Seated Leg Curl machine" && String(e.weight) === "25")));
    check("Seated Leg Curl row now shows logged 25 lbs", (await txt("#strength-routine-list")).indexOf("Seated Leg Curl machine, 3 x 12, 25 lbs") !== -1);
    // Monday: Upper, with its own planned weights.
    await page.click("#day-prev");
    await sleep(300);
    await page.click("#day-prev");
    await sleep(300);
    await ensureRoutineOpen();
    check("Monday title is Upper", (await txt("#strength-routine-title")) === "Today's routine: Upper", await txt("#strength-routine-title"));
    check("Monday Upper has 7 exercises", (await count("#strength-routine-list .entry")) === 7);
    check("Monday Chest Press shows planned 20 lbs", (await txt("#strength-routine-list")).indexOf("Chest Press machine, 3 x 12, 20 lbs") !== -1);
    check("Monday Lat Pulldown shows planned 30 lbs", (await txt("#strength-routine-list")).indexOf("Lat Pulldown, 3 x 12, 30 lbs") !== -1);
    check("Monday Triceps Extension shows planned 15 lbs", (await txt("#strength-routine-list")).indexOf("Triceps Extension, 2 x 12, 15 lbs") !== -1);
    check("Monday Chest Press input pre-fills 20", await page.evaluate(() => { const i = document.querySelector('.routine-weight-input[data-weight-for="Chest Press machine"]'); return !!i && i.value === "20"; }));
    // Swap Lat Pulldown: Seated Row machine is already on Monday, so
    // only One-Arm Dumbbell Row is offered.
    await page.click('[data-swap-routine="Lat Pulldown"]');
    await sleep(200);
    check("swap picker offers One-Arm Dumbbell Row", (await count('[data-swap-to="One-Arm Dumbbell Row"]')) === 1);
    check("swap picker skips Seated Row machine already on Monday", (await count('[data-swap-to="Seated Row machine"]')) === 0);
    await page.click('[data-swap-to="One-Arm Dumbbell Row"]');
    await sleep(300);
    check("One-Arm Dumbbell Row swapped in", (await txt("#strength-routine-list")).indexOf("Swapped from Lat Pulldown.") !== -1);
    const stSwap = await store();
    check("ymca swap persisted", !!(stSwap && stSwap.settings.strengthCustom && stSwap.settings.strengthCustom["ymca:1"] && stSwap.settings.strengthCustom["ymca:1"]["Lat Pulldown"] && stSwap.settings.strengthCustom["ymca:1"]["Lat Pulldown"].swap === "One-Arm Dumbbell Row"));
    // Remove Triceps Extension from Monday.
    await page.click('[data-remove-routine="Triceps Extension"]');
    await sleep(300);
    check("Triceps Extension removed, 6 exercises left", (await txt("#strength-routine-list")).indexOf("Triceps Extension") === -1 && (await count("#strength-routine-list .entry")) === 6);
    const stRem = await store();
    check("ymca removal persisted", !!(stRem && stRem.settings.strengthCustom["ymca:1"]["Triceps Extension"] && stRem.settings.strengthCustom["ymca:1"]["Triceps Extension"].removed === true));
    // Week view follows the ymca plan, and Monday's swap and removal
    // carry over to next week.
    await page.click("#strength-week-row");
    await sleep(300);
    check("week Monday Nov 16 label is Upper", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-16"]');
      return b && b.getAttribute("aria-label").indexOf("Upper") !== -1;
    }));
    check("week Monday has 6 exercises after swap and removal", (await count("#strength-week-day-list .entry")) === 6);
    check("week Wednesday Nov 18 label is Lower", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-18"]');
      return b && b.getAttribute("aria-label").indexOf("Lower") !== -1;
    }));
    check("week Friday Nov 20 label is Full-body", await page.evaluate(() => {
      const b = document.querySelector('[data-week-view-day="2026-11-20"]');
      return b && b.getAttribute("aria-label").indexOf("Full-body") !== -1;
    }));
    await page.click('[data-week-view-day="2026-11-22"]');
    await sleep(300);
    check("week Sunday is a rest day on ymca plan", (await txt("#strength-week-day-title")) === "Sunday, November 22: Rest day");
    await page.click('[data-week-view-day="2026-11-16"]');
    await sleep(300);
    // Add Dead Bug to Monday in the week view, then reset the day.
    await page.click("#strength-week-add-open");
    await sleep(200);
    await page.selectOption("#strength-week-add-select", "Dead Bug");
    await page.click("#strength-week-add-btn");
    await sleep(300);
    check("Dead Bug added to Monday in week view", (await txt("#strength-week-day-list")).indexOf("Dead Bug, 2 x 10 each side") !== -1);
    check("Monday has 7 exercises after add", (await count("#strength-week-day-list .entry")) === 7);
    const stAdd = await store();
    check("ymca add persisted", !!(stAdd && stAdd.settings.strengthCustom["ymca:1"] && stAdd.settings.strengthCustom["ymca:1"]["__add:Dead Bug"] && stAdd.settings.strengthCustom["ymca:1"]["__add:Dead Bug"].add === "Dead Bug"));
    await page.click("#strength-week-day-reset-btn");
    await sleep(300);
    check("week reset: Lat Pulldown back", (await txt("#strength-week-day-list")).indexOf("Lat Pulldown, 3 x 12, 30 lbs") !== -1);
    check("week reset: Triceps Extension back", (await txt("#strength-week-day-list")).indexOf("Triceps Extension, 2 x 12, 15 lbs") !== -1);
    check("week reset: Dead Bug gone", (await txt("#strength-week-day-list")).indexOf("Dead Bug") === -1);
    check("week reset: 7 exercises", (await count("#strength-week-day-list .entry")) === 7);
    const stReset = await store();
    check("week reset: ymca:1 customizations gone", !(stReset && stReset.settings.strengthCustom && stReset.settings.strengthCustom["ymca:1"]));
    await page.click("#strength-week-close");
    await sleep(300);
    // Reload: the plan survives. Switching back to 4-day shows the
    // built-in plans are untouched.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    const stReload = await store();
    check("plan still ymca after reload", !!(stReload && stReload.settings && stReload.settings.strengthPlan === "ymca"));
    await page.click('.tab-btn[data-tab="more"]');
    await page.click('.more-item[data-more-goto="settings"]');
    await sleep(300);
    await page.evaluate(() => { const sel = document.getElementById("set-strength-plan"); if (sel) { const d = sel.closest("details"); if (d) d.open = true; } });
    await sleep(200);
    await page.selectOption("#set-strength-plan", "4day");
    await sleep(900);
    const stBack = await store();
    check("plan switched back to 4day", !!(stBack && stBack.settings && stBack.settings.strengthPlan === "4day"));
    await page.click('.tab-btn[data-tab="today"]');
    await sleep(300);
    if ((await txt("#strength-routine-title")) === "Today's routine: Rest day") { await page.click("#day-prev"); await sleep(300); }
    await ensureRoutineOpen();
    check("Friday title is Lower B on 4-day plan", (await txt("#strength-routine-title")) === "Today's routine: Lower B", await txt("#strength-routine-title"));

    // 21b. v099 checkmarks: a logged exercise shows a checkmark, the
    // whole day logged shows Workout complete, and a new day starts
    // unchecked. Friday already has the Deadlift from section 3, the
    // Hip Thrust from section 12, and the Plank added in section 11,
    // so the day has seven exercises and two of them are logged.
    check("two checkmarks on Friday from the earlier logs", (await count("#strength-routine-list .routine-done")) === 2);
    check("day not complete with two of seven logged", (await txt("#strength-routine-list")).indexOf("Workout complete") === -1);
    for (const name of ["Bulgarian Split Squat", "Single-Leg Romanian Deadlift", "Seated Calf Raise, or standing", "Dead Bug", "Plank"]) {
      await page.click('[data-log-routine="' + name + '"]');
      await sleep(300);
    }
    check("seven checkmarks after logging the whole day", (await count("#strength-routine-list .routine-done")) === 7);
    check("Workout complete line on Today", (await txt("#strength-routine-list")).indexOf("Workout complete") !== -1);
    // A new day starts unchecked: Tuesday Nov 10 has nothing logged.
    // DOM clicks for the day nav: the page is scrolled deep into the
    // Fitness card here and Playwright's scroll-into-view stalls on
    // the header buttons in the headless shell; the handlers are the
    // same either way. (Monday Nov 16 is a future day and the Today
    // tab never steps past today, so the unlogged day is Tuesday.)
    await page.evaluate(() => document.getElementById("day-prev").click());
    await sleep(300);
    await page.evaluate(() => document.getElementById("day-prev").click());
    await sleep(300);
    await page.evaluate(() => document.getElementById("day-prev").click());
    await sleep(300);
    await ensureRoutineOpen();
    check("Tuesday Nov 10 title is Lower A", (await txt("#strength-routine-title")) === "Today's routine: Lower A", await txt("#strength-routine-title"));
    check("Tuesday Nov 10 has no checkmarks", (await count("#strength-routine-list .routine-done")) === 0);
    check("Tuesday Nov 10 not complete", (await txt("#strength-routine-list")).indexOf("Workout complete") === -1);
    // The week view derives the same checkmarks from the store: seed
    // all six Upper A exercises for Nov 16, reload, and open the week.
    const monSeeded = await page.evaluate((k) => {
      let st = null;
      try { st = JSON.parse(localStorage.getItem(k)); } catch {}
      if (!st) return false;
      st.strength = st.strength || [];
      const day = [
        ["Dumbbell Bench Press", 3, 10], ["One-Arm Dumbbell Row", 3, 10],
        ["Dumbbell Shoulder Press", 3, 10], ["Dumbbell Chest Fly", 2, 12],
        ["Band Row", 2, 12], ["Dumbbell Biceps Curl", 3, 12]
      ];
      day.forEach(([name, sets, reps], i) => st.strength.push({ id: "mon-test-" + i, date: "2026-11-16", name, sets, reps, weight: "" }));
      localStorage.setItem(k, JSON.stringify(st));
      return true;
    }, LS_KEY);
    check("Nov 16 seed stored", monSeeded);
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => {
      const t = document.getElementById("strength-routine-title");
      return !!t && t.textContent !== "Today's routine";
    }, null, { timeout: 10000 });
    await page.click("#strength-week-row");
    await sleep(300);
    check("week Monday Nov 16 shows six checkmarks", (await count("#strength-week-day-list .routine-done")) === 6);
    check("week Monday Nov 16 shows Workout complete", (await txt("#strength-week-day-list")).indexOf("Workout complete") !== -1);
    await page.click('[data-week-view-day="2026-11-17"]');
    await sleep(300);
    check("week Tuesday Nov 17 has no checkmarks", (await count("#strength-week-day-list .routine-done")) === 0);
    check("week Tuesday Nov 17 not complete", (await txt("#strength-week-day-list")).indexOf("Workout complete") === -1);
    await page.click("#strength-week-close");
    await sleep(300);

    // 22. v100: the full gym library. 44 new strength exercises
    // (every common machine, barbells, kettlebells, cables, bands,
    // lunges, bodyweight) and 19 new cardio moves in the picker.
    // Nothing was deleted: the built-in plans are untouched.
    const NEW_STRENGTH = ["Cable Crossover", "Smith Machine Squat", "Smith Machine Bench Press", "Assisted Pull-up", "Assisted Dip", "Back Extension machine", "Torso Rotation machine", "Lateral Raise machine", "Triceps Pushdown", "Cable Row", "Preacher Curl machine", "Hack Squat machine", "Lying Leg Curl machine", "Incline Chest Press machine", "T-Bar Row", "Rear Delt Fly machine", "Barbell Bench Press", "Barbell Squat", "Barbell Deadlift", "Barbell Row", "Barbell Overhead Press", "Dumbbell Forward Lunge", "Dumbbell Walking Lunge", "Dumbbell Lateral Lunge", "Dumbbell Front Raise", "Concentration Curl", "Dumbbell Pullover", "Kettlebell Swing", "Kettlebell Deadlift", "Band Pull-Apart", "Band Squat", "Band Pull-Through", "Step-ups", "Wall Sit", "Bird Dog", "Bench Dip", "Diamond Push-up", "Russian Twist", "Bicycle Crunch", "Hanging Knee Raise", "Leg Raise", "Cable Kickback", "Face Pull", "Cable Lateral Raise"];
    const NEW_CARDIO = ["Treadmill walk", "Treadmill run", "Elliptical", "Stationary bike", "Recumbent bike", "Spin bike", "Rowing machine", "Stair climber", "Swimming", "Water aerobics", "Outdoor walk", "Outdoor run", "Outdoor cycling", "Hiking", "Dance", "Aerobics class", "Jump rope", "Yoga", "Tai chi"];
    const lib = await page.evaluate(([ns, nc]) => {
      const badSwaps = [];
      Object.entries(STRENGTH_SWAPS).forEach(([k, alts]) => {
        if (!STRENGTH_EXERCISES[k]) badSwaps.push("key " + k);
        alts.forEach((a) => { if (!STRENGTH_EXERCISES[a]) badSwaps.push(k + " -> " + a); });
      });
      let slots = 0, ymca = 0;
      Object.entries(STRENGTH_ROUTINES).forEach(([plan, days]) => {
        Object.values(days).forEach((d) => { slots += d.exercises.length; if (plan === "ymca") ymca += d.exercises.length; });
      });
      return {
        indexCount: Object.keys(STRENGTH_EXERCISES).length,
        libNames: EXERCISE_LIBRARY.map((e) => e.name),
        badSwaps,
        slots, ymca,
        newMissing: ns.filter((n) => !STRENGTH_EXERCISES[n]),
        newNoSwaps: ns.filter((n) => !(STRENGTH_SWAPS[n] && STRENGTH_SWAPS[n].length >= 2)),
        cardioMissing: nc.filter((n) => !EXERCISE_LIBRARY.some((e) => e.name === n))
      };
    }, [NEW_STRENGTH, NEW_CARDIO]);
    check("strength index has 99 exercises", lib.indexCount === 99, "got " + lib.indexCount);
    check("all 44 new strength names in the index", lib.newMissing.length === 0, "missing: " + lib.newMissing.join(", "));
    check("every new strength entry has 2 swap alternatives", lib.newNoSwaps.length === 0, "missing: " + lib.newNoSwaps.join(", "));
    check("every swap key and target resolves", lib.badSwaps.length === 0, lib.badSwaps.slice(0, 3).join("; "));
    check("movement library has 37 entries", lib.libNames.length === 37, "got " + lib.libNames.length);
    check("all 19 new cardio moves in the picker list", lib.cardioMissing.length === 0, "missing: " + lib.cardioMissing.join(", "));
    check("built-in plans untouched: 63 routine slots", lib.slots === 63, "got " + lib.slots);
    check("YMCA still 21 exercises", lib.ymca === 21, "got " + lib.ymca);
    // The All Exercises tab lists the new machines, and adding one
    // from there works with Swap, then Reset restores the day.
    // 21b ended on Saturday Nov 14, a rest day, so step back to
    // Friday Nov 13 first: the All Exercises list only renders on a
    // workout day. (The day nav click goes through evaluate, as in
    // 21b, because scroll-into-view stalls in the headless shell.)
    await page.evaluate(() => document.getElementById("day-prev").click());
    await sleep(300);
    await ensureRoutineOpen();
    check("Friday Nov 13 title is Lower B", (await txt("#strength-routine-title")) === "Today's routine: Lower B", await txt("#strength-routine-title"));
    await page.click("#strength-tab-all");
    await sleep(300);
    check("All Exercises lists Cable Crossover", (await txt("#strength-all-exercises")).indexOf("Cable Crossover, 3 x 12") !== -1);
    check("All Exercises lists Barbell Squat", (await txt("#strength-all-exercises")).indexOf("Barbell Squat, 3 x 10") !== -1);
    await page.click('[data-add-all-exercise="Cable Crossover"]');
    await sleep(300);
    check("Cable Crossover added to Friday", (await txt("#strength-routine-list")).indexOf("Cable Crossover, 3 x 12") !== -1);
    // Friday already has 7: the 6 built-in Lower B plus the Plank
    // added in section 11, so the add makes 8.
    check("Friday has 8 exercises after add", (await count("#strength-routine-list .entry")) === 8);
    await page.click('[data-swap-routine="__add:Cable Crossover"]');
    await sleep(200);
    check("swap picker offers Dumbbell Chest Fly", (await count('[data-swap-to="Dumbbell Chest Fly"]')) === 1);
    check("swap picker offers Pec Fly machine", (await count('[data-swap-to="Pec Fly machine"]')) === 1);
    await page.click("#strength-routine-reset-btn");
    await sleep(300);
    check("reset removes Cable Crossover", (await txt("#strength-routine-list")).indexOf("Cable Crossover") === -1);
    check("Friday back to 6 exercises", (await count("#strength-routine-list .entry")) === 6);
    // The movement picker lists the new cardio moves.
    const moveHidden = await page.evaluate(() => { const d = document.getElementById("movement-detail"); return d ? d.hidden : false; });
    if (moveHidden) { await page.click("#movement-row"); await sleep(200); }
    await page.click("#movement-customize");
    await sleep(300);
    check("movement picker lists Elliptical", (await txt("#movement-plan-list")).indexOf("Elliptical") !== -1);
    check("movement picker lists Treadmill walk", (await txt("#movement-plan-list")).indexOf("Treadmill walk") !== -1);
    await page.click("#movement-plan-cancel");
    await sleep(200);

    // Section 23 (v101): Skip personalization closes first-run setup
    // without the Terms box ticked. Fresh context, so no setup-done key
    // is set and the overlay must appear. The demo has no setup overlay.
    const freshCtx = await browser.newContext();
    const fresh = await freshCtx.newPage();
    fresh.on("dialog", (d) => d.accept());
    await fresh.goto(url, { waitUntil: "load" });
    const hasOverlay = await fresh.evaluate(() => !!document.getElementById("setup-overlay"));
    if (!hasOverlay) {
      check("no setup overlay in this copy", LABEL === "demo");
    } else {
      await fresh.waitForFunction(() => {
        const o = document.getElementById("setup-overlay");
        return !!o && !o.classList.contains("hidden");
      }, null, { timeout: 10000 });
      check("setup overlay shows on a fresh install", true);
      check("Skip button reads Skip personalization", (await fresh.evaluate(() => { const b = document.getElementById("setup-skip"); return b ? b.textContent.trim() : null; })) === "Skip personalization");
      check("Terms box starts unchecked", await fresh.evaluate(() => { const b = document.getElementById("setup-terms"); return b ? !b.checked : false; }));
      await fresh.click("#setup-skip");
      await sleep(300);
      check("Skip closes setup without the Terms box", await fresh.evaluate(() => { const o = document.getElementById("setup-overlay"); return !!o && o.classList.contains("hidden"); }));
      check("Skip marks setup done", await fresh.evaluate((key) => { try { return localStorage.getItem(key) === "1"; } catch { return false; } }, SETUP_KEY));
    }
    await freshCtx.close();

  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log("[" + LABEL + "] " + (results.length - failed) + "/" + results.length + " routine checks passed.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
