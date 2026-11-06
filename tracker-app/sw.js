/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 *
 * Freshness strategy (S16/S17/S18/S19):
 * - The page requests styles.css?v=150 and app.js?v=150, so the precache
 *   lists those exact versioned URLs; a bare "./app.js" would never match.
 * - App shell files (HTML, JS, CSS) are network-first with a cache fallback,
 *   so an installed app picks up new code instead of serving old code forever.
 * - Truly static files (icons, manifest) are cache-first.
 * - Only successful same-origin responses are cached, and the index.html
 *   fallback is for page navigations only, never for JS/CSS.
 * - Install adds assets one by one, so one failed asset cannot block the update.
 * - Nothing here touches localStorage: a service worker update can never
 *   wipe saved entries (S20).
 * - v150: the page also calls registration.update() on every load and
 *   shows an update notice when a new worker takes over, so a new version
 *   reaches the installed app instead of waiting on the browser's own
 *   update schedule.
 */

const CACHE_NAME = "new-chapter-tracker-v150";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=150",
  "./app.js?v=150",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png"
];

/* App shell: always try the network first so updates reach the user. */
function isAppShell(url) {
  return url.pathname.endsWith("/index.html")
    || url.pathname.endsWith("/")
    || url.pathname.endsWith("app.js")
    || url.pathname.endsWith("styles.css");
}

function cacheable(response, url) {
  return response && response.ok && new URL(response.url).origin === url.origin;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((asset) => cache.add(asset).catch(() => {
        /* One failed asset must not block the whole update (S19). */
      })))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (isAppShell(url) || event.request.mode === "navigate") {
    // Network-first: fresh code when online, cached copy when offline.
    event.respondWith(
      fetch(event.request).then((response) => {
        if (cacheable(response, url)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // HTML fallback for page navigations only, never for JS/CSS (S18).
          if (event.request.mode === "navigate") return caches.match("./index.html");
          throw new Error("offline");
        })
      )
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (cacheable(response, url)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
