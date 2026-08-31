/* 草野球スコア - Service Worker
   球場は電波が悪く、モバイル通信量も気になるため、
   キャッシュにあるものは「一切通信せずに」返す（cache-only）。
   毎回裏で取得し直す作り（stale-while-revalidate）にすると、
   起動のたびに全ファイルぶんの通信が発生してしまうため採用しない。

   更新は VERSION を上げた sw.js が配信されたときにだけ行う。
   ブラウザは起動時に sw.js だけを確認する（数百バイト程度）。 */

const VERSION = 'v2.4.0';
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
  './js/ui/help.js',
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

    // キャッシュにあれば通信しない
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;

    // 未キャッシュのものだけ取りに行き、取れたら次回のために保存する
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      // オフラインかつ未キャッシュ：ナビゲーションなら index を返す
      if (req.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
