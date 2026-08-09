// v6 — 자동 업데이트 (controllerchange 시 페이지 reload) + SKIP_WAITING 메시지 핸들러.
//      배포하면 사용자가 dev tools 안 만져도 새 버전 즉시 반영.
// v5 — 블로그 진입 (GNB / 햄버거 / 사용자 드롭다운) 추가, 옛 캐시 무효화.
// v4 — 시세 API stale 위험 차단 + /api/ stale-while-revalidate (5분)
// 이전 v3 는 yahoo/finnhub/coingecko 응답까지 무조건 cache.put → 모바일 스토리지
// 비대 + 오래된 시세 노출 위험. v4 부터 외부 시세 직접 요청은 캐시 안 함.
// ★ 2026-07-30 v7: 피벗 배포(#206·#207) 연속 2회 동안 버전 미증가로 구캐시가 옛 청크를
//   물고 있어 일부 클라이언트가 스플래시에서 정지(대표 실보고). 캐시 전면 갱신.
//   교훈 재확인: 청크 해시가 바뀌는 배포가 나가면 SW 캐시 버전도 함께 올릴 것.
// ★ v8 (2026-07-30): Phase 2(#209) 청크 변경 배포 후행 bump — 규칙 준수(청크 변경 시 SW 동반 bump)
const CACHE_NAME = "zepta-v10";
const API_MAX_AGE_MS = 5 * 60 * 1000; // 5분
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

// ★ 2026-05-11: 클라이언트가 SKIP_WAITING 메시지 보내면 즉시 활성화 → controllerchange 발동.
//   index.html 의 'updatefound' 핸들러가 새 SW 발견하면 이걸 호출 → 즉시 활성화 →
//   클라이언트의 controllerchange 가 페이지 reload → 사용자는 새 버전 즉시 보임.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch: 전략적 캐싱 (API는 네트워크 우선, 정적 자산은 캐시 우선)
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // 1a. 외부 시세 API (yahoo/coingecko/finnhub) — 절대 캐시 안 함
  // 이유: 시세는 1초만 늦어도 잘못된 정보. SW 캐시가 stale 응답 노출하면
  // 사용자에게 "방금 본 가격" 보여 매매 결정 오도. 항상 네트워크.
  if (url.includes('yahoo') || url.includes('coingecko') || url.includes('finnhub')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 1b. 자체 API (/api/) — stale-while-revalidate (5분 max-age)
  // 캐시가 있으면 즉시 반환 (UI 빠르게) + 백그라운드로 갱신.
  // 캐시가 5분 넘었거나 없으면 네트워크 우선.
  if (url.includes('/api/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        const cachedAt = cached?.headers.get('x-cached-at');
        const cachedFresh = cached && cachedAt && (Date.now() - Number(cachedAt) < API_MAX_AGE_MS);
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) {
              // x-cached-at 헤더로 만료 추적 (Response 헤더 mutation 위해 새 Response)
              const headers = new Headers(response.headers);
              headers.set('x-cached-at', String(Date.now()));
              response.clone().blob().then((body) => {
                const tagged = new Response(body, { status: response.status, statusText: response.statusText, headers });
                cache.put(event.request, tagged);
              });
            }
            return response;
          })
          .catch(() => cached || new Response('', { status: 503 }));
        // fresh cache 가 있으면 즉시 반환, 없으면 네트워크 대기
        return cachedFresh ? cached : fetchPromise;
      })
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
          }).catch((err) => {
            // ★ 2026-07-30 수정: 빈 404 응답 조작 금지 — 빈 스크립트를 물려주면 앱이
            //   조용히 스플래시에서 영구 정지함(실사례). 실패를 그대로 던져 브라우저
            //   에러로 표면화하고, index.html 의 청크 로드 실패 복구/유저 새로고침이 동작하게 함.
            throw err;
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
