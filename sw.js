// LOALIFE Service Worker
// 方針:
//  - install は allSettled で1つ失敗しても壊れない（過去は addAll が
//    実在しない /icon-192.png 等で reject → install 失敗していた）。
//  - HTML(ナビゲーション)は network-first：常に最新を優先し、取れない時だけ
//    キャッシュにフォールバック（＝デプロイ後の更新が反映される）。
//  - それ以外の同一オリジンGET(アイコン等の静的資産)は cache-first で高速表示。
//  - クロスオリジン(Open-Meteo等のAPI/CDN)はキャッシュせず素通し（天気の陳腐化防止）。
const CACHE = "loalife-v6";
const CORE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-any-192.png",
  "/icon-any-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // 1つでも404だと addAll は全体 reject するので、個別に add して失敗は無視する
      Promise.allSettled(CORE.map((u) => c.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // クロスオリジン（天気API・Google 等）はSWで触らない＝常に最新・キャッシュ汚染なし
  if (url.origin !== self.location.origin) return;

  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    // network-first（更新を取りこぼさない）
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/index.html"))
        )
    );
    return;
  }

  // 静的資産は cache-first（無ければ取得してキャッシュ）
  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
          return res;
        })
    )
  );
});
