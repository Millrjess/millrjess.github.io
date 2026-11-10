/*
 * A New Chapter Tracker
 * Copyright (c) 2026 Jessica A. Miller. All rights reserved.
 * https://millrjess.github.io/tracker/
 *
 * Freshness strategy (S16/S17/S18/S19):
 * - The page requests styles.css?v=000 and app.js?v=000, so the precache
 *   lists those exact versioned URLs; a bare "./app.js" would never match.
 * - App shell files (HTML, JS, CSS) are network-first with a cache fallback,
 *   so an installed app picks up new code instead of serving old code forever.
 * - Truly static files (icons, manifest) are cache-first.
 * - version.json is never cached: it is the staleness signal the app
 *   checks on every load, so a newer version cannot hide behind a cache.
 * - Only successful same-origin responses are cached, and the index.html
 *   fallback is for page navigations only, never for JS/CSS.
 * - Install adds assets one by one, so one failed asset cannot block the update.
 * - Nothing here touches localStorage: a service worker update can never
 *   wipe saved entries (S20).
 * - v150: the page also calls registration.update() on every load and
 *   shows an update notice when a new worker takes over, so a new version
 *   reaches the installed app instead of waiting on the browser's own
 *   update schedule.
 * - v152: Update now unregisters the old worker before reloading, so a
 *   phone stuck on a stale cache-first copy actually gets fresh files.
 * - v154: that unregister is gone. The new worker already skips waiting
 *   and claims the page on install, so by the time the update card shows
 *   the new worker is controlling the page and a plain reload serves the
 *   new files (network-first). Unregistering threw the new worker away
 *   and fell back to the browser cache, which served the old copy again,
 *   so Update now flickered and never landed. Update now now only asks
 *   a waiting worker to take over, then reloads; it never unregisters.
 */

const CACHE_NAME = "new-chapter-tracker-v054";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=000",
  "./app.js?v=000",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/lotus-gold-only-transparent.png"
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

/* v154: Update now can ask a waiting worker to take over. The install
   handler already skips waiting, so this is only the belt-and-braces
   path for a worker that installed before this change. */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Only this app's own caches: caches.keys() is origin-wide, and
    // deleting every other cache could wipe another app's offline copy.
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k.indexOf("new-chapter-tracker-") === 0).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // version.json is the staleness signal: it must always come from the
  // network and never be cached, or the app could keep reporting that
  // it is current while a newer version is live.
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(event.request));
    return;
  }
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
