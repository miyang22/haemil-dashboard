/* ==========================================================================
   해밀홈케어 · 매출·비용 관리 — Service Worker
   - 앱 껍데기(HTML·CSS·JS·아이콘·매니페스트)를 미리 캐시
   - 캐시 우선, 없으면 네트워크 → 받은 응답은 캐시에 저장
   - 모든 경로가 상대 경로(./)라 GitHub Pages 루트(/)와 하위 경로(/저장소/) 모두에서 동작
   - 파일을 고쳐 배포할 때는 아래 VERSION 문자열을 올리면 새 캐시로 교체됩니다.
   ========================================================================== */
'use strict';

const VERSION = 'v4';
/* 같은 VERSION 안에서 파일만 고쳐 다시 배포할 때 이 값을 올리면 캐시가 새로 받아집니다. */
const BUILD = '3';
const CACHE_PREFIX = 'haemil-dashboard-';
const CACHE_NAME = CACHE_PREFIX + VERSION + '-' + BUILD;

/* sw.js 위치(스코프)를 기준으로 하는 상대 경로들 */
const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* ------------------------------ 설치 ------------------------------ */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 개별 add: 하나가 실패해도 나머지는 캐시되도록 (addAll 은 전체 실패)
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (err) {
        /* 오프라인 설치 등: 무시하고 넘어감 */
      }
    }));
    await self.skipWaiting();
  })());
});

/* ------------------------------ 활성화 ------------------------------ */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

/* ------------------------------ 요청 처리 ------------------------------ */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (err) {
    return;
  }
  // 같은 출처(이 앱의 파일)만 다룬다. 외부 요청·확장 프로그램·data/blob 은 그대로 통과
  if (url.origin !== self.location.origin) return;

  event.respondWith(cacheFirst(req));
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);

  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;

  try {
    const res = await fetch(req);
    // 정상 응답이고 http(s) 인 경우에만 저장
    if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    // 오프라인: 페이지 이동이면 캐시해 둔 index.html 로 대신 응답
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('./');
      if (fallback) return fallback;
    }
    throw err;
  }
}
