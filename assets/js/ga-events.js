// GA4 click events for care plans, free discovery, and paid strategy.
// No personal data is sent. Only the event name is recorded.
(function () {
  if (typeof window === "undefined") return;
  document.addEventListener("click", function (event) {
    var link = event.target && event.target.closest ? event.target.closest("a") : null;
    if (!link || !link.href) return;
    var href = link.getAttribute("href") || "";
    var eventName = null;
    if (href.indexOf("buy.stripe.com/aFa7sMfCM43Nc8JdOF6EU02") !== -1) {
      eventName = "paid_strategy_click";
    } else if (href.indexOf("calendar.google.com/calendar") !== -1 && href.indexOf("appointments/schedules") !== -1) {
      eventName = "free_discovery_click";
    } else if (href === "booking/" || href === "../booking/" || href === "/booking/" || href.indexOf("/booking/") !== -1) {
      eventName = "free_discovery_click";
    } else if (href.indexOf("pricing/#care-plans") !== -1) {
      eventName = "care_plan_click";
    }
    if (eventName && typeof window.gtag === "function") {
      window.gtag("event", eventName);
    }
  });
})();
