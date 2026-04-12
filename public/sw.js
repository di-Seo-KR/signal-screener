const CACHE_NAME = 'zepta-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// Install: 기본 셸 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', (event) => {
  // API 요청은 네트워크 우선
  if (event.request.url.includes('/api/') || event.request.url.includes('yahoo') || event.request.url.includes('coingecko')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  // 정적 자산은 캐시 우선
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // 오프라인 폴백 (HTML 요청일 경우)
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return new Response(
            '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zepta - 오프라인</title><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#060a12;color:#f7f8fa;font-family:system-ui;text-align:center}h1{font-size:24px;margin-bottom:12px}p{color:#6b7d8e;font-size:16px}</style></head><body><div><h1>📡 오프라인 상태입니다</h1><p>인터넷 연결을 확인해주세요</p></div></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      });
    })
  );
});
