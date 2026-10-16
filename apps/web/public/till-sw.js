// Copyright (c) 2026, Rademics. All rights reserved.
// Service worker for the till (pos-offline plan §1): the /till page and the
// app's static files are fetched from the network first and kept in a cache,
// so the till still opens when the server cannot be reached. Only same-origin
// GET requests are touched; API calls (another origin), sign-in and anything
// else go straight to the network. Bills are never stored here (they live in
// the till's own database).
const CACHE = "retail-erp-till-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("retail-erp-till-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname === "/till" || url.pathname.startsWith("/till/") || url.pathname.startsWith("/_next/static/") || url.pathname === "/favicon.ico";
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreVary: true }).then((hit) => {
          if (hit) return hit;
          // A page load of /till with another query string: fall back to the saved /till page.
          if (req.mode === "navigate") return caches.match("/till", { ignoreVary: true }).then((page) => page || Response.error());
          return Response.error();
        }),
      ),
  );
});
