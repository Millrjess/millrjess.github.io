/* Sample demo seed. Runs before app.js. No real AI call, no purchase, no live data.
   Demo storage keys only: newChapterTracker.demo.* and demo-nct-*
   If a visitor edits the demo, their edits stay in the demo only. */
(function () {
  "use strict";
  var LS = "newChapterTracker.demo.v1";
  var CHAT = "newChapterTracker.demo.chat.v1";
  var MARK = "newChapterTracker.demo.seeded.v1";
  function iso(offset) {
    var d = new Date();
    d.setDate(d.getDate() + offset);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function id(n) { return "sample-" + n; }
  try {
    if (!localStorage.getItem(MARK)) {
      var store = {
        settings: {
          medication: "Zepbound",
          dose: "",
          shotDay: "",
          waterGoal: 92,
          proteinGoal: 90,
          movementGoal: 30,
          carbGoal: 150,
          fatGoal: 60,
          heightFt: 5,
          heightIn: 6,
          refillDate: "",
          goalWeight: "160"
        },
        water: [
          { id: id("w1"), date: iso(0), oz: 16 },
          { id: id("w2"), date: iso(0), oz: 16 },
          { id: id("w3"), date: iso(0), oz: 16 },
          { id: id("w4"), date: iso(-1), oz: 24 },
          { id: id("w5"), date: iso(-2), oz: 32 },
          { id: id("w6"), date: iso(-4), oz: 16 },
          { id: id("w7"), date: iso(-5), oz: 24 }
        ],
        protein: [
          { id: id("p1"), date: iso(0), grams: 25, carbs: 40, fat: 10, food: "Sample: eggs" },
          { id: id("p2"), date: iso(0), grams: 22, carbs: 45, fat: 15, food: "Sample: Greek yogurt" },
          { id: id("p3"), date: iso(0), grams: 21, carbs: 35, fat: 20, food: "Sample: chicken" },
          { id: id("p4"), date: iso(-1), grams: 30, food: "Sample: protein shake" },
          { id: id("p5"), date: iso(-2), grams: 28, food: "Sample: eggs" },
          { id: id("p6"), date: iso(-4), grams: 20, food: "Sample: yogurt" },
          { id: id("p7"), date: iso(-5), grams: 24, food: "Sample: chicken" }
        ],
        exercise: [
          { id: id("e1"), date: iso(0), minutes: 20, label: "Walking" },
          { id: id("e2"), date: iso(-1), minutes: 15, label: "Walking" },
          { id: id("e3"), date: iso(-2), minutes: 30, label: "Strength Training" },
          { id: id("e4"), date: iso(-4), minutes: 20, label: "Pilates" },
          { id: id("e5"), date: iso(-5), minutes: 15, label: "Walking" }
        ],
        injections: [
          { id: id("i1"), date: iso(-21), medication: "Zepbound", dose: "", site: "Left Upper Arm", notes: "Sample entry" },
          { id: id("i2"), date: iso(-14), medication: "Zepbound", dose: "", site: "Right Upper Arm", notes: "Sample entry" },
          { id: id("i3"), date: iso(-7), medication: "Zepbound", dose: "", site: "Left Abdomen", notes: "Sample entry" }
        ],
        weight: [
          { id: id("wt1"), date: iso(-28), value: 180 },
          { id: id("wt2"), date: iso(-21), value: 176 },
          { id: id("wt3"), date: iso(-14), value: 172 },
          { id: id("wt4"), date: iso(-7), value: 170 },
          { id: id("wt5"), date: iso(0), value: 168 }
        ],
        measurements: [],
        photos: [],
        journal: [
          { id: id("j1"), date: iso(0), mood: "Calm", notes: "Sample entry: a steady day." },
          { id: id("j2"), date: iso(-2), mood: "Busy", notes: "Sample entry: a busy day, still logged." }
        ],
        sideEffects: [
          { id: id("s1"), date: iso(-2), symptom: "Nausea", severity: "Mild", notes: "Sample entry" },
          { id: id("s2"), date: iso(-5), symptom: "Tired", severity: "Mild", notes: "Sample entry" }
        ],
        moods: {},
        movementDone: {}
      };
      localStorage.setItem(LS, JSON.stringify(store));
      var chat = [
        { role: "user", content: "Can you give me a protein recipe idea? (Sample)" },
        { role: "assistant", content: "Sample reply: Try eggs with spinach and cheese, with whole grain toast. This is encouragement, not medical advice." },
        { role: "user", content: "Can you make me a shopping list? (Sample)" },
        { role: "assistant", content: "Sample shopping list: eggs, spinach, cheese, whole grain bread." },
        { role: "user", content: "What is a healthy snack idea? (Sample)" },
        { role: "assistant", content: "Sample snack idea: Greek yogurt with berries. This is encouragement, not medical advice." }
      ];
      localStorage.setItem(CHAT, JSON.stringify(chat));
      localStorage.setItem(MARK, "1");
    }
  } catch (e) { /* demo keeps working in memory */ }

  /* Block all live Worker calls from the demo. No demo chat reaches the real AI. */
  var realFetch = window.fetch.bind(window);
  window.fetch = function (url, options) {
    var u = String(url || "");
    if (u.indexOf("github-fetcher") !== -1 || u.indexOf("/api/") !== -1 || u.indexOf("/demo-api") !== -1) {
      var body;
      if (u.indexOf("/api/chat") !== -1 || u.indexOf("api/chat") !== -1) {
        body = { reply: "Sample reply only. In the real app, your AI Wellness Companion would answer here. Try eggs with spinach and cheese, with whole grain toast. This is encouragement, not medical advice." };
      } else {
        body = { found: false, error: "Sample demo only. No real Companion connection in this demo." };
      }
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return realFetch(url, options);
  };
})();
