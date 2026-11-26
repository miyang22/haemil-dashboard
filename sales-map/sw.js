/* ==========================================================================
   해밀 영업지도 — Service Worker
   - 앱 껍데기(HTML·CSS·JS·아이콘·매니페스트·Code.gs)를 미리 캐시
   - 같은 출처: 캐시 우선 → 없으면 네트워크
   - 외부(Leaflet·SheetJS CDN·지도 타일): 캐시가 있으면 먼저 보여주고 뒤에서 갱신
   - 파일을 고쳐 배포할 때는 아래 VERSION/BUILD 문자열을 올리면 새 캐시로 교체됩니다.
   ========================================================================== */
'use strict';

const VERSION = 'v1';
const BUILD = '2';
const CACHE_PREFIX = 'haemil-sales-map-';
const CACHE_NAME = CACHE_PREFIX + VERSION + '-' + BUILD;
const RUNTIME = CACHE_PREFIX + 'runtime';
const RUNTIME_MAX = 260;

const PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './apps-script-code.txt',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && res.ok) await cache.put(url, res);
      } catch (err) { /* 오프라인 설치 등: 무시 */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME && k !== RUNTIME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // 시트 API(JSONP) 호출은 캐시하지 않고 그대로 네트워크로 보냅니다.
  if (url.search && /(^|[?&])callback=/.test(url.search)) return;

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(req));
  } else if (isStaticAsset(url)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});

function isStaticAsset(url) {
  const host = url.hostname;
  if (host.endsWith('unpkg.com') || host.endsWith('jsdelivr.net')) return true;
  if (host.endsWith('basemaps.cartocdn.com')) return true;
  return false;
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  // 페이지 이동만 검색어를 무시하고(./ 와 ./?utm=…) 나머지는 정확히 매칭합니다.
  const cached = await cache.match(req, req.mode === 'navigate' ? { ignoreSearch: true } : undefined);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok && (res.type === 'basic' || res.type === 'default')) {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    if (req.mode === 'navigate') {
      const fallback = await cache.match('./index.html') || await cache.match('./');
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(req, res.clone()).then(trimRuntime).catch(() => {});
    }
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function trimRuntime() {
  try {
    const cache = await caches.open(RUNTIME);
    const keys = await cache.keys();
    if (keys.length <= RUNTIME_MAX) return;
    const extra = keys.slice(0, keys.length - RUNTIME_MAX);
    await Promise.all(extra.map(k => cache.delete(k)));
  } catch (err) { /* ignore */ }
}
