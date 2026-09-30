// 推し活カレンダー service worker：オフラインでも開けるようにアプリ本体をキャッシュする
// ファイルを変更したら VERSION を上げ、index.html の ?v= もそろえる（古い版と新しい版のファイルが混ざらないように）
const VERSION = "13";
const CACHE = `oshical-v${VERSION}`;
const ASSETS = [
  "./", "./index.html", "./manifest.json", "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./css/app.css",
  "./js/core.js", "./js/components.js", "./js/forms.js", "./js/app.js",
  "./js/views/home.js", "./js/views/calendar.js", "./js/views/money.js", "./js/views/notes.js", "./js/views/settings.js",
].map((u) => (/\.(css|js)$/.test(u) ? `${u}?v=${VERSION}` : u));

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("oshical-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ネットワーク優先・失敗したらキャッシュ（更新がすぐ反映され、圏外でも開ける）
// ブラウザの HTTP キャッシュも使わず、毎回サーバーに最新か確認する
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // ページを開くときだけ index.html で代わりにする（JS や CSS の代わりに HTML を返すと壊れるため）
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
