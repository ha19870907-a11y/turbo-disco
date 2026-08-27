// PWAのアプリシェルをキャッシュし、オフライン時も最低限起動できるようにするサービスワーカー。
// アプリ本体(HTML/JS/CSS)は開発中に頻繁に更新されるため network-first とし、
// オフライン時のみキャッシュにフォールバックする(鮮度を優先し、更新が反映されない事故を防ぐ)。
// レース関連の外部データも同様に network-first。
const CACHE_VERSION = "v2";
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
  "./history.js",
  "./dayCache.js",
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
    // app shell: network-first。コード更新を即座に反映するため、オンライン時は常に
    // ネットワークを優先し、オフライン時のみキャッシュへフォールバックする。
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
