/* Adds a Sample note to every tab panel in the demo, after the real app renders. */
(function () {
  "use strict";
  function addNotes() {
    document.querySelectorAll(".tab-panel").forEach(function (panel) {
      if (panel.querySelector(".demo-sample-note")) return;
      var note = document.createElement("p");
      note.className = "demo-sample-note";
      note.textContent = "Sample data on this screen. This is a demo, not your real tracker.";
      panel.insertBefore(note, panel.firstChild);
    });
    var chatIntro = document.querySelector("#tab-chat .muted");
    if (chatIntro && !chatIntro.querySelector(".demo-sample-note")) {
      chatIntro.textContent = "Sample chat only. No real AI call is made in this demo, and no purchase or code is needed. In the real app, Companion chat is available after purchase.";
    }
    var codeEntry = document.querySelector("#tab-settings #coach-code-entry");
    if (codeEntry) codeEntry.style.display = "none";
    var settingsAccess = document.querySelector("#tab-settings h3");
    if (settingsAccess && settingsAccess.textContent.indexOf("AI Wellness Companion access") !== -1 && !document.querySelector("#tab-settings .demo-settings-note")) {
      var p = document.createElement("p");
      p.className = "demo-sample-note demo-settings-note";
      p.textContent = "Sample demo: Companion access is disabled here. No code is needed to try this demo.";
      settingsAccess.parentNode.insertBefore(p, settingsAccess.nextSibling);
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(addNotes, 100); });
  } else {
    setTimeout(addNotes, 100);
  }
  window.addEventListener("load", function () { setTimeout(addNotes, 300); });
})();
