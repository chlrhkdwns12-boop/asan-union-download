/**
 * 오프라인·빠른 시작 서비스워커
 *  · 앱 껍데기(HTML·CSS·JS·아이콘·계산기 원본)를 미리 담아 둔다.
 *  · 화면 요청은 네트워크 먼저 → 3초 안에 못 받으면 담아 둔 사본(지하철·엘리베이터에서도 열린다).
 *  · Firebase·중계 서버(다른 주소)는 건드리지 않는다 — 데이터는 SDK 가 스스로 캐시한다.
 */
const VERSION = 'asan-union-pwa-v1.0.1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './manifest.webmanifest',
  './payroll_calculator_2026.html',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isAppOrigin(url) {
  return url.origin === self.location.origin;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isAppOrigin(url)) return; // Firebase·카카오·중계 서버는 그대로 지나간다.

  // 주소창처럼 이동하는 요청 — 네트워크 먼저, 실패하면 담아 둔 화면
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await Promise.race([
          fetch(request),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500))
        ]);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (error) {
        const cache = await caches.open(VERSION);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 정적 자원 — 담아 둔 것을 바로 주고, 뒤에서 새 사본으로 바꾼다.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
