/* 草野球スコア - Service Worker
   球場は電波が悪いことが多いため、アプリ本体は必ずキャッシュから即座に返す（cache-first）。
   更新は裏で取得しておき、次回起動時に反映する（stale-while-revalidate）。 */

const VERSION = 'v2.1.1';
const CACHE = `bbscore-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/model.js',
  './js/store.js',
  './js/stats.js',
  './js/runners.js',
  './js/backup.js',
  './js/report.js',
  './js/ui/common.js',
  './js/ui/players.js',
  './js/ui/games.js',
  './js/ui/lineup.js',
  './js/ui/score.js',
  './js/ui/stats.js',
  './js/ui/settings.js',
  './js/ui/personal.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 1つでも失敗すると install 全体が落ちるため個別に許容する
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const network = fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (cached) return cached;
    const res = await network;
    if (res) return res;
    // オフラインかつ未キャッシュ：ナビゲーションなら index を返す
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
