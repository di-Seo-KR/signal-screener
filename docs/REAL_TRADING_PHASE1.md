# 실전매매 Phase 1 — 설계 및 리뷰 문서

> 작성일: 2026-04-09 (밤새 작업 결과)
> 브랜치: `feature/real-trading-phase1` — **main 미머지**
> 실거래 활성화 여부: **비활성 (기본값)**. 리뷰 후 수동 enable 필요.
>
> 이 문서는 퇴근 후 돌아온 시오님이 "코드를 어떻게 검토하고, 안전하게 단계별로 켤지" 빠르게 파악하기 위한 가이드입니다.

---

## 0. 요구사항 요약

| 항목 | 값 |
|---|---|
| 초기 자본 | **$100** (테스트 예산) |
| 거래소 | Binance USDⓈ-M Futures |
| 허용 심볼 (Phase 1) | ETHUSDT, SOLUSDT, BNBUSDT, XRPUSDT, DOGEUSDT, ADAUSDT, AVAXUSDT, LINKUSDT, MATICUSDT |
| 제외 심볼 | **BTCUSDT** ($100 minNotional = 자본 전량이라 리스크 분산 불가) |
| 레버리지 | 2x ~ 10x (동적; confidence + family 기반) |
| 타임프레임 | 4h 우선 (수수료/슬리피지 효율), 1d/1h 보조 |
| SL/TP | Binance 사이드 예약 (`STOP_MARKET` + `TAKE_PROFIT_MARKET`, closePosition=true) — **Option A** |
| 트레이드당 리스크 | 에쿼티의 1.5% (Fractional Kelly ~1/4) |
| 서킷브레이커 | 일 -4%, 주 -8%, MDD -15%, 5 연속손실 → 24h cooldown |

---

## 1. 아키텍처 (요약)

```
┌───────────────────────┐    ┌───────────────────────┐
│  Virtual Trading Loop │    │  Quant Research Loop  │
│  (btc-cron 15min)     │    │  (daily 06:00 UTC)    │
│   → 41 strategies     │    │   → strategy ranking  │
│   → bot perf KV       │    │   → (future) archive  │
└──────────┬────────────┘    └──────────┬────────────┘
           │ di:bot:<id>:perf.trades     │ di:quant:latest
           ▼                             ▼
┌─────────────────────────────────────────────────────┐
│  Archive Layer  (api/strategy-snapshot, daily)      │
│    di:archive:bots:YYYY-MM-DD                       │
│    di:archive:quant:YYYY-MM-DD                      │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  Real Trading Engine  (api/real-trading/engine, 5m) │
│    1. killswitch + phase1_enabled check             │
│    2. circuit-breaker preTradeCheck                 │
│    3. pullRecentSignals() ← bot perf trades         │
│    4. signal-extractor.extractSignal (canonicalize) │
│    5. risk-manager.planTrade (qty/SL/TP/leverage)   │
│    6. executeOrderPlan (bracket: MARKET+SL+TP)      │
│    7. engine-log append                             │
└─────────────────────────┬───────────────────────────┘
                          │
                          ▼
        ┌────────────────────────────────┐
        │  Hetzner VPS (5.223.94.159)    │
        │  zepta-proxy.duckdns.org       │
        │  binance-proxy + Caddy HTTPS   │
        └────────────────┬───────────────┘
                         │ HMAC 서명된 내부 요청
                         ▼
                 Binance fapi (/fapi/v2/*)
```

동시에 **Position Monitor** (3분 간격) 가 돌며 고아 SL/TP 주문을 정리하고 포지션 청산을 감지한다.

---

## 2. 새로 추가한 파일

| 경로 | 역할 |
|---|---|
| `api/_shared/signal-extractor.js` | 가상매매 raw 시그널 → canonical signal (id, symbol, side, family) |
| `api/_shared/risk-manager.js` | ATR 기반 SL/TP + 동적 레버리지 + Kelly 사이징 |
| `api/_shared/circuit-breaker.js` | 일/주/MDD/연속손실 감시 + killswitch |
| `api/_shared/strategy-archive.js` | bot perf / quant-research 영구 아카이빙 |
| `api/binance/order.js` | **수정**: `executeOrderPlan()` 내보내기, SL/TP 브라켓 지원 |
| `api/binance/bracket-order.js` | 수동 테스트용 브라켓 주문 API |
| `api/real-trading/engine.js` | 5분 cron — 시그널→리스크→실거래 |
| `api/real-trading/position-monitor.js` | 3분 cron — 고아 정리 + 청산 감지 |
| `api/real-trading/kill-switch.js` | enable/disable/halt/resume 토글 |
| `api/real-trading/status.js` | 프론트엔드용 상태 요약 |
| `api/strategy-snapshot.js` | 매일 06:15 UTC — 봇/퀀트 아카이빙 |
| `api/_shared/binance-client.js` | **수정**: `placeStopOrder`, `getOpenOrders`, `cancelOrder` 추가 |

---

## 3. KV 키 스키마 (Phase 1 신규)

| 키 | 값 | 기본 |
|---|---|---|
| `di:real:user:<uid>:killswitch` | boolean (true=거래 금지) | **true** (거래 금지) |
| `di:real:user:<uid>:phase1_enabled` | boolean | **false** |
| `di:real:user:<uid>:breaker` | `{dayStartEquity, equityHigh, dayKey, halted, cooldownUntil, ...}` | `{}` |
| `di:real:user:<uid>:engine-log` | 최근 200건 엔진 실행 로그 | `[]` |
| `di:real:user:<uid>:last-signal-ts` | 마지막 처리 시그널 타임스탬프 (중복 방지) | `0` |
| `di:real:user:<uid>:last-positions` | 직전 포지션 스냅샷 (고아 감지) | `[]` |
| `di:real:phase1-users` | Phase 1 활성 유저 id 배열 | `[]` |
| `di:archive:bots:<YYYY-MM-DD>` | 그 날 봇 스냅샷 배열 | — |
| `di:archive:bots:index` | 최근 365일 날짜 인덱스 | `[]` |
| `di:archive:quant:<YYYY-MM-DD>` | 그 날 quant-research payload | — |
| `di:quant:latest` | quant-research 가 **후속 작업으로** 써줘야 함 | (없음) |

---

## 4. 안전 기본값 — "전부 OFF"

1. `di:real:user:<uid>:killswitch` 는 **기본값 true** (KV 에 값이 없어도 true 로 해석). 유저가 의도적으로 `false` 로 바꿔야만 실거래.
2. `di:real:user:<uid>:phase1_enabled` 도 **기본값 false**.
3. `di:real:phase1-users` 배열이 비어있으면 cron 은 아무 유저도 돌리지 않는다.
4. `bracket-order.js` 의 body 기본값 `dryRun=true`.
5. `engine.js` 에서 `forceDryRun` 옵션으로 항상 모의 실행 가능.
6. `vercel.json` 에 cron 은 등록했지만, 위 플래그가 꺼져있으면 실제 주문은 한 건도 나가지 않는다.

**결과: 이 브랜치를 머지해도 실돈은 움직이지 않는다.** 활성화는 다음 6번 섹션의 수동 절차.

---

## 5. 리스크 매니저 로직 (핵심 수식)

```
stopDistPct  = ATR * atrMult[family] / price
riskAmount   = equity * 0.015                    # 1.5%
rawNotional  = riskAmount / stopDistPct
notional     = min(rawNotional, absoluteMaxNotional=$500, maxMargin*leverage)
notional     = notional * sizeHint               # 약한 신호는 축소
leverage     = round(2 + (conf - 0.5)/0.5 * 8) + familyBias   # 2~10
qty          = floorToStep(notional / price, stepSize)
SL price     = price * (1 ± stopDistPct)
TP price     = price * (1 ± stopDistPct * RR)
```

| family | atrMultSL | rewardToRisk | leverage bias |
|---|---|---|---|
| trend | 2.5 | 2.5 | +1 |
| breakout | 1.2 | 2.0 | 0 |
| mean-revert | 1.5 | 1.5 | -1 |
| unknown | 2.0 | 2.0 | 0 |

**$100 기준 예시** (ETH @ $3000, ATR 1.5%, trend family, conf 0.9):
- stopDistPct ≈ 3.75%
- riskAmount = $1.5
- rawNotional ≈ $40
- leverage ≈ 10x → margin ≈ $4
- SL = $2887.5, TP = $3281.25
- 최악: -$1.5, 최선: +$3.75

**주의: Phase 1 에서 ATR 은 현재 `price * 0.015` 고정 근사값.** Phase 2 에서 실제 ATR(14) 로 교체해야 함. (엔진이 CryptoCompare/프록시로 kline 을 받아오는 로직을 추가해야 해서 Phase 1 에선 스코프 밖)

---

## 6. 수동 활성화 절차 (시오님 리뷰 후)

### 6.1 코드 리뷰 포인트
1. `api/_shared/risk-manager.js` — 사이징 수식이 의도와 맞는지
2. `api/real-trading/engine.js::pullRecentSignals` — 어떤 봇 성과를 시그널로 쓸지
3. `api/real-trading/engine.js::defaultAtrApprox` — 고정 ATR 근사가 허용 가능한지
4. `docs/REAL_TRADING_PHASE1.md` — 본 문서
5. `vercel.json` — cron 주기 (5분/3분/일 1회)

### 6.2 단계별 활성화

**Step 1. Dry-run 수동 테스트**
```bash
curl -X POST https://zepta.vercel.app/api/real-trading/engine \
  -H "Content-Type: application/json" \
  -d '{"userId":"<UID>","dryRun":true}'
```
→ `ran: false, reason: "phase1 disabled"` 가 나오면 정상.

**Step 2. `phase1_enabled=true` 로 켜고 다시 dry-run**
```bash
curl -X POST https://zepta.vercel.app/api/real-trading/kill-switch \
  -H "Content-Type: application/json" \
  -d '{"userId":"<UID>","action":"disable"}'   # killswitch ON 확인
# Vercel KV UI 에서 di:real:user:<UID>:phase1_enabled = true 직접 set
curl -X POST .../api/real-trading/engine -d '{"userId":"<UID>","dryRun":true}'
```
→ 시그널 수집/리스크 플랜/dry-run result 전체 흐름 검증.

**Step 3. Phase1-users 배열 등록**
Vercel KV UI 에서 `di:real:phase1-users = ["<UID>"]` set.
→ cron 이 이제 해당 유저를 순회 (여전히 killswitch ON 이라 실거래는 X).

**Step 4. Killswitch 해제 (실거래 시작)**
```bash
curl -X POST .../api/real-trading/kill-switch \
  -d '{"userId":"<UID>","action":"enable"}'
```
→ 5분 내 첫 실거래 발생 가능. **최대 손실 -$1.5/trade, 하루 -$4 halt.**

**Step 5. 상태 모니터링**
```bash
curl "https://zepta.vercel.app/api/real-trading/status?userId=<UID>"
```

---

## 7. 미결 / Phase 2 과제

| 항목 | 이유 |
|---|---|
| **실제 ATR(14)** 계산 | 엔진 내부에서 kline 로드가 필요. Phase 1 은 고정 1.5% 근사. |
| **quant-research → `di:quant:latest` 저장** | 아카이버가 복사할 수 있도록 quant-research 에 한 줄 추가. 메인 파일 손대기 싫어 보류. |
| **userTrades 기반 realizedPnL** | position-monitor 가 현재는 approximate. 정확한 손익은 `/fapi/v1/userTrades` 조회 필요. |
| **프론트 RealTrading.jsx 통합** | status 엔드포인트는 준비됨. UI 연동은 별도 PR. |
| **알파 감쇠 탐지** (30d rolling Sharpe, walk-forward) | archive 데이터가 2주 이상 쌓인 후 의미 있음. |
| **BTCUSDT 재편입** | 자본이 $500+ 로 증가하면 해제 고려. |

---

## 8. 롤백 방법

사고 발생 시 안전하게 되돌리는 법:

```bash
# 1. 즉시 모든 거래 차단
curl -X POST .../api/real-trading/kill-switch -d '{"userId":"<UID>","action":"halt","reason":"emergency"}'

# 2. Phase 1 완전 비활성화
# Vercel KV UI: di:real:phase1-users = []
#               di:real:user:<UID>:phase1_enabled = false

# 3. 오픈 포지션 청산
curl -X POST .../api/binance/emergency-stop -d '{"userId":"<UID>"}'

# 4. 브랜치 롤백
git checkout main
# feature/real-trading-phase1 은 머지되지 않았으므로 main 영향 없음
```

---

## 9. 체크리스트 (시오님 내일 확인용)

- [ ] 브랜치 `feature/real-trading-phase1` 체크아웃
- [ ] 위 "6.1 리뷰 포인트" 파일들 직접 읽기
- [ ] `vercel.json` cron 스케줄 확인
- [ ] **Vercel 배포는 아직 하지 말 것.** 리뷰 후 PR 로 올리거나 직접 머지
- [ ] (배포 후) Step 1~4 순서대로 활성화
- [ ] 첫 실거래 발생 시 `di:real:user:<UID>:engine-log` 확인

---

## 10. 커밋 히스토리

이 브랜치의 커밋은 논리 단위로 분할되어 있습니다:
1. `feat(real-trading): add canonical signal extractor`
2. `feat(real-trading): add risk manager with Kelly sizing`
3. `feat(real-trading): add circuit breaker + killswitch`
4. `feat(real-trading): add strategy archive helpers`
5. `feat(binance): extend client with stop/tp orders`
6. `feat(binance): extend order.js with executeOrderPlan + bracket`
7. `feat(real-trading): add engine, monitor, kill-switch, status`
8. `feat(cron): add strategy-snapshot daily archiver`
9. `chore(vercel): register new cron jobs`
10. `docs: add REAL_TRADING_PHASE1.md`

---

푹 쉬시고, 내일 퇴근 후에 보시면 됩니다. 🌙
