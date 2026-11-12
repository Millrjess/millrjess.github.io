/* Run the tracker app and demo suites SEQUENTIALLY (parallel runs crash
   Chrome) and compare pass counts to the recorded baselines.
   The suites exit nonzero unless EVERY check passes, and a few checks
   are known pre-existing failures (app: speaker/auto-read empty spoken
   array, no headless voices; demo: talking-voice (read-aloud control
   not visible in headless); two V000 name checks; mic hide check
   expects no SpeechRecognition API in headless), so a nonzero exit
   from a suite is NOT itself a failure here. What matters is the
   pass count:
     app  >= 72/96
     demo >= 60/86
   Exit 0 only when both suites meet their baselines at the expected
   totals; anything else (a crash, a missing count line, a changed
   total, a pass count below baseline) exits 1. */
"use strict";
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BASELINES = {
  app: { script: path.join(__dirname, "app", "runTests.js"), args: ["after"], pass: 72, total: 96, pattern: /(\d+)\/(\d+) passed \(after\)/ },
  demo: { script: path.join(__dirname, "demo", "runTests.js"), args: [], pass: 60, total: 86, pattern: /(\d+)\/(\d+) checks passed\./ },
};

function runSuite(name, cfg) {
  return new Promise((resolve) => {
    console.log("\n===== " + name + " suite: node " + path.relative(ROOT, cfg.script) + " " + cfg.args.join(" ") + " =====\n");
    const child = spawn("node", [cfg.script, ...cfg.args], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { process.stdout.write(d); out += d.toString(); });
    child.stderr.on("data", (d) => { process.stderr.write(d); out += d.toString(); });
    child.on("error", (err) => resolve({ name, ok: false, reason: "could not start suite: " + err.message }));
    child.on("close", (code) => {
      const m = out.match(cfg.pattern);
      if (!m) {
        resolve({ name, ok: false, reason: "no pass-count line in output (suite exit code " + code + "); the suite may have crashed" });
        return;
      }
      const passed = Number(m[1]);
      const total = Number(m[2]);
      const failing = (out.match(/^Failing: (.*)$/m) || [])[1] || "";
      resolve({ name, ok: passed >= cfg.pass && total === cfg.total, passed, total, baseline: cfg.pass + "/" + cfg.total, failing, exitCode: code });
    });
  });
}

async function main() {
  const results = [];
  // Sequential on purpose: running both at once crashes Chrome.
  results.push(await runSuite("app", BASELINES.app));
  results.push(await runSuite("demo", BASELINES.demo));

  console.log("\n===== BASELINE CHECK =====");
  let allOk = true;
  for (const r of results) {
    if (r.passed === undefined) {
      console.log(r.name + ": FAILED — " + r.reason);
      allOk = false;
      continue;
    }
    const status = r.ok ? "OK" : "BELOW BASELINE";
    console.log(r.name + ": " + r.passed + "/" + r.total + " passed (baseline " + r.baseline + ") — " + status + " (suite exit code " + r.exitCode + ")");
    if (r.failing) console.log(r.name + " failing: " + r.failing);
    if (!r.ok) allOk = false;
  }
  if (allOk) {
    console.log("Both suites meet their baselines.");
  } else {
    console.log("Baseline check FAILED. If a total changed, update the baselines in tests/check-baselines.js; if a pass count fell, a new failure appeared.");
  }
  process.exit(allOk ? 0 : 1);
}

main();
