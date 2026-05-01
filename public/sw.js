// 코드 스플리팅 도입 후 구버전 모놀리식 번들 캐시 강제 무효화 — v3
const CACHE_NAME = 'zepta-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/zepta-icon-192.png',
  '/zepta-icon-512.png',
  '/favicon-32.png',
  '/og-image.png'
];

// Install: 기본 셸 캐시 + PWA 정적 자산
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        // 캐시 추가 실패 무시 (일부 파일이 없을 수 있음)
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.log('캐시 추가 중 일부 자산 누락됨:', err);
          return cache.addAll(['/', '/index.html', '/manifest.json']);
        });
      })
  );
  self.skipWaiting();
});

// Activate: 이전 캐시 철저히 정리 (v1 및 기타 오래된 버전)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      console.log('활성 캐시:', CACHE_NAME, '| 정리할 캐시:', keys.filter((k) => k !== CACHE_NAME));
      return Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k.startsWith('zepta-'))
          .map((k) => {
            console.log('캐시 삭제:', k);
            return caches.delete(k);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch: 전략적 캐싱 (API는 네트워크 우선, 정적 자산은 캐시 우선)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 1. API 요청: 네트워크 우선 (실패 시 캐시 폴백)
  if (url.includes('/api/') || url.includes('yahoo') || url.includes('coingecko') || url.includes('finnhub')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // 성공 응답만 캐시 (실패는 캐시하지 않음)
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 2. 정적 자산 (HTML, CSS, JS, 이미지): 캐시 우선
  if (url.includes('.js') || url.includes('.css') || url.includes('/manifest.json') ||
      url.endsWith('.png') || url.endsWith('.jpg') || url.endsWith('.svg') || url.endsWith('.webp')) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response.ok && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return response;
          }).catch(() => {
            // 정적 자산 폴백 (기본값)
            if (url.endsWith('.js')) return new Response('', { status: 404 });
            if (url.endsWith('.css')) return new Response('', { status: 404 });
            return new Response('', { status: 404 });
          });
        })
    );
    return;
  }

  // 3. HTML 문서 (SPA): 네트워크 우선 (오프라인 폴백)
  if (event.request.headers.get('accept')?.includes('text/html') || url.endsWith('/') || !url.includes('.')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            // 오프라인 페이지
            return new Response(
              '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Zepta - 오프라인</title><style>body{margin:0;padding:20px;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#060a12;color:#f7f8fa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-align:center}div{max-width:400px}h1{font-size:32px;margin:0 0 12px}p{color:#8b96a6;font-size:16px;margin:0 0 24px;line-height:1.5}a{display:inline-block;padding:12px 24px;background:#4a7c59;color:#fff;text-decoration:none;border-radius:6px;font-weight:500}</style></head><body><div><h1>📡 오프라인 상태</h1><p>인터넷 연결을 확인해주세요</p><a href="/">홈으로 돌아가기</a></div></body></html>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
          });
        })
    );
    return;
  }

  // 4. 기타 요청: 네트워크 우선 (폴백 캐시)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
