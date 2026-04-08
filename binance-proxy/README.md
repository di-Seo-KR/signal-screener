# Zepta Binance Proxy

Fly.io 고정 IP 프록시 — Vercel(zepta) ↔ Binance Futures 중계 서버.

## 왜 필요한가

바이낸스 Futures API는 IP 화이트리스트가 필수. Vercel 서버리스는 고정 IP가 없어서
선물 주문을 직접 칠 수 없다. 이 프록시를 Fly.io에 띄우면 전용 IPv4가 발급되고,
해당 IP를 바이낸스에 등록하면 Vercel → 이 프록시 → 바이낸스 순으로 주문이 통한다.

## 구조

```
[Vercel zepta.vercel.app]
        │  HTTPS + HMAC internal auth
        ▼
[Fly.io zepta-binance-proxy.fly.dev] ← 고정 IP (IPv4)
        │  standard Binance signed request
        ▼
[Binance fapi.binance.com]  ← IP 화이트리스트에 Fly.io IP 등록
```

## 배포 순서 (최초 1회)

### 0. 사전 준비

- Fly.io 계정 생성: https://fly.io/app/sign-up
- `flyctl` 설치: `curl -L https://fly.io/install.sh | sh`
- `fly auth login`

### 1. 앱 생성 (deploy는 X)

```bash
cd binance-proxy
fly launch --no-deploy --copy-config --name zepta-binance-proxy --region nrt
```

- "Would you like to tweak these settings?" → **N**
- Postgres/Redis 질문 → **N** (필요 없음)

### 2. 공유 시크릿 생성 & 등록

**A. 랜덤 시크릿 한 줄 만들기** (Mac 터미널):

```bash
openssl rand -hex 32
```

→ 64자리 hex 문자열 하나 나옴 (예: `c4a8...`). 이걸 `PROXY_SHARED_SECRET` 이라 부름.
**이 값은 Fly.io와 Vercel 양쪽에 동일하게 넣어야 함.**

**B. Fly.io에 등록:**

```bash
fly secrets set PROXY_SHARED_SECRET=<위에서 만든 64자리>
```

**C. Vercel에도 등록:**

Vercel 대시보드 → zepta 프로젝트 → Settings → Environment Variables → New:
- `BINANCE_PROXY_SECRET` = (같은 64자리)
- `BINANCE_PROXY_URL` = `https://zepta-binance-proxy.fly.dev` (배포 후 확정)

### 3. 최초 배포

```bash
fly deploy
```

배포 완료 후:

```bash
fly status
```

### 4. 전용 IPv4 할당 (핵심)

Fly.io는 기본적으로 공유 IPv4만 주므로, **전용 IPv4를 별도로 할당해야** 바이낸스 화이트리스트에 고정 IP로 등록 가능.

```bash
fly ips allocate-v4
```

출력된 IP 주소를 메모. (월 $2 과금)

### 5. outbound IP 확인

실제로 바이낸스에 나갈 때 쓰는 IP가 위의 할당된 IP와 같은지 확인:

```bash
curl https://zepta-binance-proxy.fly.dev/ip
```

응답: `{"ok":true,"ip":"<outbound-ip>"}`

→ 이 IP를 **바이낸스 API 키 > IP access restrictions > Restrict access to trusted IPs** 에 등록.

### 6. 바이낸스 API 키 설정

1. binance.com → Account → API Management → 기존 Zepta 키 편집
2. **Enable Futures** 체크
3. IP 화이트리스트에 위 IP 등록
4. Save

### 7. Vercel 재배포

환경변수를 Vercel에 추가했으므로 재배포가 필요:

Vercel 대시보드 → Deployments → 최신 배포 `···` → Redeploy

### 8. 헬스체크

```bash
# 프록시 자체
curl https://zepta-binance-proxy.fly.dev/health

# Vercel → 프록시 → 바이낸스 (API 키 등록 후)
curl "https://zepta.vercel.app/api/binance/balance?userId=<your-user-id>"
```

## 환경변수

| Key | 어디 | 용도 |
|---|---|---|
| `PROXY_SHARED_SECRET` | Fly.io | 내부 인증 HMAC 키 (64 hex) |
| `BINANCE_PROXY_SECRET` | Vercel | 위와 동일 값 |
| `BINANCE_PROXY_URL` | Vercel | `https://zepta-binance-proxy.fly.dev` |
| `BINANCE_FAPI_BASE` | Fly.io (선택) | 기본 `https://fapi.binance.com` |

## 인증 방식

매 요청에 다음 헤더 필수:

```
X-Proxy-Timestamp: <밀리초>
X-Proxy-Signature: hex(HMAC-SHA256(SECRET, ts + "\n" + method + "\n" + path + "\n" + body))
```

- timestamp는 현재 시각 ±60초 내
- signature는 timing-safe 비교
- API key/secret은 요청 body로 넘어오며 서버에 저장 X

## 운영

```bash
fly logs                  # 실시간 로그
fly status                # 머신 상태
fly ssh console           # 원격 접속
fly scale count 2         # 인스턴스 수 조정
fly scale memory 512      # 메모리 변경
```

## 비용

- VM (shared-cpu-1x, 256MB): ~$2/month
- 전용 IPv4: $2/month
- 네트워크 egress: 무료 구간 (월 100GB)
- **합계: 약 $4~5/month**
