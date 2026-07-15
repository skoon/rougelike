// Service worker for offline play (M11-T2). Precaches the app shell on install
// and runtime-caches everything else (the art/audio) cache-first on first use,
// so the game is fully playable offline after one online visit. Bump CACHE to
// invalidate old caches when the shell changes.

const CACHE = "catacombs-v1";

// The boot shell: HTML, styles, every ES module, manifest, and icons.
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/main.js",
  "./js/game.js",
  "./js/camp.js",
  "./js/dungeon.js",
  "./js/entities.js",
  "./js/npc.js",
  "./js/pathfind.js",
  "./js/audio.js",
  "./js/assets.js",
  "./js/scores.js",
  "./js/rng.js",
  "./icon-192.png",
  "./icon-512.png",
  "./favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  // Cache-first; on a miss, fetch and stash a copy (covers on-demand assets).
  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
