/* 単語テスト PWA — キャッシュは最小構成だけ */
const CACHE = "wordtest-pwa-v100";
const PRECACHE = [
  "./index.html",
  "./css/wordtest.css?v=100",
  "./js/wordtest.js?v=100",
  "./images/welcome-top.png?v=87",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.pathname.endsWith("/data/lesson.json")) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match(request, { ignoreSearch: true })
      )
    );
    return;
  }
  if (/\/data\/lessons\/.+\.json$/.test(url.pathname)) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(() =>
        caches.match(request, { ignoreSearch: true })
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        return res;
      });
    })
  );
});
