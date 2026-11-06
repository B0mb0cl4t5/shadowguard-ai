/*
 * ShadowGuard AI service worker.
 *
 * Security rule: it caches ONLY public, versioned static assets (/_next/static).
 * Pages and /api responses contain authenticated risk data, so they are never
 * cached; an offline device shows a plain offline notice instead.
 */
const CACHE = "shadowguard-static-v2";
const STATIC = [/^\/_next\/static\//];

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC.some((re) => re.test(url.pathname))) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            "<!doctype html><html><head><meta name=viewport content='width=device-width'><title>Offline</title></head>" +
              "<body style='background:#0b1120;color:#cbd5e1;font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0'>" +
              "<p>ShadowGuard is offline. Reconnect to see live risk data.</p></body></html>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
          ),
      ),
    );
  }
});
