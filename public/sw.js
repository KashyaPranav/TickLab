/* eslint-env serviceworker */
/* global self, caches, fetch */

/**
 * Offline shell for TickLab.
 *
 * Why this is hand-written rather than generated: the app's habit data already
 * lives in IndexedDB and is read directly by the UI, so all this worker has to do
 * is make sure the *pages* load with no network. That is a small enough problem
 * to own outright, and it avoids a build step.
 *
 * Two rules keep offline honest:
 *  - Only same-origin GETs are intercepted. Supabase lives on another origin, so
 *    a sync request can never be answered from this cache. Sync failing while
 *    offline is correct; sync being served a stale HTTP response is not.
 *  - Navigations are network-first. A user who is online should always get the
 *    deployed app, and only fall back to the cache when the network is gone.
 */

const VERSION = "v1";
const SHELL_CACHE = `ticklab-shell-${VERSION}`;
const ASSET_CACHE = `ticklab-assets-${VERSION}`;
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);

const OFFLINE_URL = "/offline";

/**
 * Every route is prerendered, so precaching the shell means each screen works on
 * a cold first offline launch rather than only after it has been visited.
 */
const SHELL_ROUTES = [
  "/",
  "/today",
  "/habits",
  "/history",
  "/insights",
  "/settings",
  "/login",
  "/signup",
  OFFLINE_URL,
];

const SHELL_ASSETS = [
  "/manifest.json",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one bad URL cannot fail the whole install.
      await Promise.all(
        [...SHELL_ROUTES, ...SHELL_ASSETS].map(async (url) => {
          try {
            const response = await fetch(url, { cache: "reload" });
            if (response.ok) await cache.put(url, response);
          } catch {
            // Offline during install: the runtime handler picks it up later.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("ticklab-") && !KEEP.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(?:js|css|woff2?|png|svg|jpg|jpeg|webp|avif|ico|webmanifest)$/.test(
      url.pathname,
    )
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(ASSET_CACHE);
    // Hashed build assets are immutable, so an unbounded entry count is fine.
    void cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) void cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (request.mode === "navigate") {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw new Error(`Offline and no cached copy of ${request.url}`);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin (Supabase, fonts) and anything non-http is left alone.
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith("http")) return;

  if (isAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request));
});