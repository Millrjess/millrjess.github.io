/* Sample demo seed. Runs before app.js. No real AI call, no purchase, no live data.
   Demo storage keys only: newChapterTracker.demo.* and demo-nct-*
   If a visitor edits the demo, their edits stay in the demo only.
   Sample values use the established public-preview sample set (weight 170.0 lbs,
   height 5 ft 5 in, starting 178.0 lbs). No real health numbers appear here.
   The demo banner states all data on the page is sample only, so individual
   entries do not carry a "Sample:" prefix; they read as realistic entries. */
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
          dose: "5",
          shotDay: "Wednesday",
          waterGoal: 92,
          proteinGoal: 90,
          movementGoal: 30,
          carbGoal: 150,
          fatGoal: 60,
          heightFt: 5,
          heightIn: 5,
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
          { id: id("p1"), date: iso(0), grams: 20, carbs: 25, fat: 2, food: "Greek yogurt with berries" },
          { id: id("p2"), date: iso(0), grams: 35, carbs: 15, fat: 10, food: "Grilled chicken and vegetables" },
          { id: id("p3"), date: iso(0), grams: 32, carbs: 28, fat: 21, food: "Salmon, quinoa, and broccoli" },
          { id: id("p4"), date: iso(-1), grams: 30, food: "Protein shake" },
          { id: id("p5"), date: iso(-2), grams: 28, food: "Eggs with toast" },
          { id: id("p6"), date: iso(-4), grams: 20, food: "Greek yogurt" },
          { id: id("p7"), date: iso(-5), grams: 24, food: "Chicken and rice" }
        ],
        exercise: [
          { id: id("e1"), date: iso(0), minutes: 20, label: "Walking" },
          { id: id("e2"), date: iso(0), minutes: 5, label: "Daily movement routine" },
          { id: id("e3"), date: iso(-1), minutes: 15, label: "Walking" },
          { id: id("e4"), date: iso(-2), minutes: 30, label: "Strength Training" },
          { id: id("e5"), date: iso(-4), minutes: 20, label: "Pilates" },
          { id: id("e6"), date: iso(-5), minutes: 15, label: "Walking" }
        ],
        injections: [
          { id: id("i1"), date: iso(-21), medication: "Zepbound", dose: "5", site: "Left Upper Arm", notes: "On time." },
          { id: id("i2"), date: iso(-14), medication: "Zepbound", dose: "5", site: "Right Upper Arm", notes: "On time." },
          { id: id("i3"), date: iso(-7), medication: "Zepbound", dose: "5", site: "Left Abdomen", notes: "On time." }
        ],
        weight: [
          { id: id("wt1"), date: iso(-28), value: 178 },
          { id: id("wt2"), date: iso(-21), value: 176 },
          { id: id("wt3"), date: iso(-14), value: 174 },
          { id: id("wt4"), date: iso(-7), value: 172 },
          { id: id("wt5"), date: iso(0), value: 170 }
        ],
        measurements: [],
        photos: [],
        journal: [
          { id: id("j1"), date: iso(0), mood: "Calm", notes: "A steady day. Logged everything and felt good." },
          { id: id("j2"), date: iso(-2), mood: "Busy", notes: "A busy day, still logged." }
        ],
        sideEffects: [
          { id: id("s1"), date: iso(-2), symptom: "Nausea", severity: "Mild", notes: "A little queasy after lunch." },
          { id: id("s2"), date: iso(-5), symptom: "Tired", severity: "Mild", notes: "A low-energy afternoon." }
        ],
        moods: {},
        movementDone: {}
      };
      store.moods[iso(0)] = "Good";
      store.moods[iso(-1)] = "Calm";
      store.moods[iso(-2)] = "Busy";
      store.moods[iso(-4)] = "Good";
      store.moods[iso(-5)] = "Calm";
      store.movementDone[iso(0)] = {
        done: ["Sit-to-stands", "Wall push-ups", "Standing march in place", "Heel raises", "Gentle full-body stretch"],
        bonus: true
      };
      localStorage.setItem(LS, JSON.stringify(store));
      var chat = [
        { role: "user", content: "Can you give me a protein recipe idea?" },
        { role: "assistant", content: "Try eggs with spinach and cheese, with whole grain toast. This is encouragement, not medical advice." },
        { role: "user", content: "Can you make me a shopping list?" },
        { role: "assistant", content: "Here is a shopping list: eggs, spinach, cheese, whole grain bread." },
        { role: "user", content: "What is a healthy snack idea?" },
        { role: "assistant", content: "Greek yogurt with berries is a good choice. This is encouragement, not medical advice." }
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
        body = { reply: "Chat with your AI Wellness Companion is not available in the demo. It is part of the full app." };
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
