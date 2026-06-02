# Zepta 발굴 워커 (Hetzner 전용 박스)

Vercel 서버리스의 **300초 타임아웃을 벗어나** 알파 발굴을 *연속·무제한*으로 돌리는 워커입니다.
Vercel cron(`/api/agents/continuous-backtest`)과 **동일한 `runDiscoveryCycle` 로직**을 재사용하므로
발굴 규칙·검증 게이트(교차심볼+OOS)가 100% 일치합니다. 결과는 같은 Upstash KV(`di:alpha:*`)에 기록되어
웹 UI(알파랩)에 그대로 반영됩니다.

> ⚠️ **이 워커는 바이낸스 프록시(zepta-proxy) 박스와 별도의 박스에 올리세요.**
> 프록시 박스는 실거래 생명줄이라, 무거운 발굴이 CPU를 잡으면 주문이 지연됩니다.
> 새 소형 Hetzner 박스(CPX 계열, 월 €5~6)를 발굴 전용으로 두는 걸 권장합니다.

---

## 1. 준비 — 필수 환경변수

Vercel 프로젝트 → Settings → Environment Variables 에서 아래 값을 복사해 `worker/.env` 로 저장:

```env
# 필수 (Upstash KV — 발굴 결과 저장)
KV_REST_API_URL=https://....upstash.io
KV_REST_API_TOKEN=Ax...

# 선택 — klines 를 프록시 경유로 받고 싶을 때만 (없으면 바이낸스 public 직접 조회)
#   발굴은 public OHLC 만 읽으므로 IP 화이트리스트 불필요. 직접 조회로 충분.
# BINANCE_PROXY_URL=https://5.223.94.159   (또는 프록시 도메인)
# BINANCE_PROXY_SECRET=...

# 선택 — 튜닝 (기본값 적절)
# DISCOVERY_SYMBOLS_PER_RUN=13      # 한 사이클에 검증할 심볼 수 (13=전 심볼)
# DISCOVERY_BUDGET_MS=1200000       # 사이클 시간 상한 (20분 = 사실상 무제한)
# DISCOVERY_INTERVAL_MS=300000      # 사이클 사이 휴식 (5분)
```

> `KV_*` 가 없으면 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` 도 인식합니다.

---

## 2. 실행 방법 (택1)

### A) Docker (권장)

```bash
# 레포를 박스에 clone 후, 레포 루트에서:
docker build -f worker/Dockerfile -t zepta-discovery .
docker run -d --restart=always --env-file worker/.env --name zepta-discovery zepta-discovery

# 로그 확인
docker logs -f zepta-discovery
```

업데이트(코드 갱신 시):
```bash
git pull && docker build -f worker/Dockerfile -t zepta-discovery . \
  && docker rm -f zepta-discovery \
  && docker run -d --restart=always --env-file worker/.env --name zepta-discovery zepta-discovery
```

### B) systemd (Docker 없이 bare Node)

```bash
# Node 20 + 레포 설치
cd /opt && git clone <repo> zepta && cd zepta && npm ci --omit=dev

# /etc/systemd/system/zepta-discovery.service
```
```ini
[Unit]
Description=Zepta Discovery Worker
After=network-online.target

[Service]
WorkingDirectory=/opt/zepta
EnvironmentFile=/opt/zepta/worker/.env
ExecStart=/usr/bin/node worker/discovery-worker.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
```bash
systemctl daemon-reload && systemctl enable --now zepta-discovery
journalctl -u zepta-discovery -f
```

---

## 3. 동작 확인

로그에 사이클마다 한 줄씩 찍힙니다:
```
[worker] #1 OK 412300ms — 후보 4, 주입 3(trend-follow,hurst-trend,defi-momentum), 정리 1
```
- `후보` = 이번 사이클 신규 발굴 후보 수
- `주입` = 교차심볼+OOS 검증 통과해 실거래 파라미터로 반영된 전략
- `정리` = 재검증 실패(과적합)로 default 복귀된 전략

웹 알파랩(zepta.app/alpha-lab)에도 동일하게 반영됩니다(같은 KV).

---

## 4. Vercel cron 과의 관계

- 워커가 안정적으로 돌면, Vercel 의 `continuous-backtest` cron(6시간)은 **중복**이 됩니다.
  중복 자체는 무해(주입 flapping 가드 + 재검증이 충돌 방지)하나, KV 호출 절약을 위해
  워커 안정화 후 `vercel.json` 에서 해당 cron 을 제거(또는 빈도 축소)하는 걸 권합니다.
- 워커가 죽으면 Vercel cron 이 백업으로 계속 돕니다(이중화).

---

## 5. 박스 사양 가이드

- 발굴은 CPU 바운드(백테스트), 메모리는 가벼움(수백 MB).
- CPX11~CPX21(2~3 vCPU) 면 충분. vCPU 많을수록 사이클 빨라짐.
- `DISCOVERY_SYMBOLS_PER_RUN` 와 `DISCOVERY_BUDGET_MS` 로 부하 조절.
