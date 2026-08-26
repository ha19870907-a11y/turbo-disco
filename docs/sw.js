// PWAのアプリシェルをキャッシュし、オフライン時も最低限起動できるようにするサービスワーカー。
// レース関連の外部データは network-first とし、通信できない時のみ直近のキャッシュを表示する
// （予想の性質上、鮮度が最優先のため常に最新取得を優先する）。
const CACHE_VERSION = "v1";
const APP_SHELL_CACHE = `kyotei-app-shell-${CACHE_VERSION}`;
const DATA_CACHE = `kyotei-data-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./client.js",
  "./predictor.js",
  "./stadiums.js",
  "./manifest.webmanifest",
  "./fixtures/sample-20260401.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== APP_SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isExternalDataRequest(url) {
  return url.hostname === "turnmark.github.io" || url.hostname === "raw.githubusercontent.com";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (isExternalDataRequest(url)) {
    // network-first: 最新のレースデータ取得を優先し、失敗時のみキャッシュを返す
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(DATA_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // app shell: cache-first
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
