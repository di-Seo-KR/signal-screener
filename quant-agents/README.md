# 자율 전략 진화 시스템 (Autonomous Strategy Evolution System)

**프로덕션 레디 6-에이전트 시스템**

## 빠른 시작

```bash
cd /path/to/quant-agents

# 의존성 설치
pip install -r requirements.txt

# 검증
bash verify.sh

# 단일 에이전트 실행
python3 -m agents.researcher
python3 -m agents.backtester
python3 -m agents.evolver
python3 -m agents.evaluator
python3 -m agents.risk_tuner
python3 -m agents.deployer

# 오케스트레이터로 모든 에이전트 순차 실행
python3 orchestrator.py --run-once

# 특정 에이전트만 실행
python3 orchestrator.py --agent researcher
```

## 시스템 아키텍처

### 일일 오케스트레이션 (Daily Pipeline)

```
Time    Agent           Purpose                Input              Output
─────────────────────────────────────────────────────────────────────────
07:00 - Researcher     신규 알파 발굴          180d 1h OHLCV      research:YYYY-MM-DD
08:00 - Backtester     과적합 검증             research results   validated:YYYY-MM-DD
09:00 - Evolver        파라미터 최적화         population         evolution:*
10:00 - Evaluator      성과 평가 & 순위        active strategies  leaderboard
11:00 - Deployer       프로덕션 배포           leaderboard        active-strategies

Every 6h - Risk Tuner   위험 조정               BTC/ETH/S&P        risk:config
```

## 6개 에이전트

### 1. Researcher Agent
**발굴 (Discovery)**
- 180일 암호화폐 1h OHLCV 수집 (상위 20개: BTC, ETH, SOL, ADA, DOGE, ...)
- 20개 전략 × 파라미터 그리드 (~1440 조합) 백테스트
- Sharpe, Sortino, Max DD, Win Rate, Profit Factor 스코어링
- 상위 20 후보 + 신규 패턴 선별
- **파일**: `agents/researcher.py` (270 lines)
- **실행**: 매일 07:00 KST
- **출력**: `di:agents:research:YYYY-MM-DD`

### 2. Backtester Agent
**검증 (Validation)**
- Walk-Forward Test: 4 fold (120d train / 30d test)
- Out-of-Sample Sharpe, 일관성, 거래 수 검증
- Monte Carlo Test (100 shuffled returns, p < 0.05)
- 필터: OOS Sharpe > 0.3, consistency > 0.5, trades >= 15
- **파일**: `agents/backtester.py` (290 lines)
- **실행**: 매일 08:00 KST
- **출력**: `di:agents:validated:YYYY-MM-DD`

### 3. Evolver Agent
**진화 (Evolution)**
- Genetic Algorithm (100 individuals, 20 generations)
- Selection: Tournament (size=3)
- Crossover: BLX-alpha (0.3) for numeric parameters
- Mutation: Gaussian (10% sigma) + symbol add/drop
- Elitism: Keep top 10%
- Fitness = OOS_Sharpe × sqrt(trades) × (1 - max_dd)
- **파일**: `agents/evolver.py` (339 lines)
- **실행**: 매일 09:00 KST
- **출력**: `di:agents:evolution:*`

### 4. Evaluator Agent
**평가 (Evaluation)**
- 30일 라이브/섀도우 성과 계산
- Composite Score:
  ```
  = 0.35×Sharpe + 0.20×Sortino + 0.15×WinRate 
    + 0.15×ProfitFactor + 0.15×(1-MaxDD)
  ```
- Promotion: evolver strategies > median
- Demotion: bottom 10% or negative returns
- **파일**: `agents/evaluator.py` (315 lines)
- **실행**: 매일 10:00 KST
- **출력**: `di:agents:strategies:leaderboard`

### 5. Risk Tuner Agent
**위험 조정 (Risk Management)**
- Market Regime Detection:
  - Hurst Exponent (추세 강도)
  - Efficiency Ratio (추세 vs 노이즈)
  - ATR Percentile (변동성)
- Regime Classification:
  - TRENDING_UP/DOWN
  - MEAN_REVERTING
  - HIGH/LOW_VOLATILITY
- Risk Parameters per Regime:
  - leverage_multiplier: 0.6 ~ 1.3x
  - position_size_multiplier: 0.3 ~ 1.2x
  - stop_loss_multiplier: 0.8 ~ 1.5x
  - strategy_family_weights
- **파일**: `agents/risk_tuner.py` (322 lines)
- **실행**: 매 6시간 (00:00, 06:00, 12:00, 18:00)
- **출력**: `di:agents:risk:config`

### 6. Deployer Agent
**배포 (Deployment)**
- Leaderboard vs Production 비교
- Deployment Plan:
  - +N new (walk-forward passed, 3+ days on board, p<0.05)
  - -M removed (not on leaderboard)
  - ~Z parameter updates
- Safety Checks: Max 3 changes/day
- **파일**: `agents/deployer.py` (371 lines)
- **실행**: 매일 11:00 KST
- **출력**: `di:quant:active-strategies`

## 파일 구조

```
quant-agents/
├── agents/
│   ├── __init__.py                 # (empty)
│   ├── researcher.py               # 신규 알파 발굴
│   ├── backtester.py               # 과적합 검증
│   ├── evolver.py                  # 유전 알고리즘
│   ├── evaluator.py                # 성과 평가
│   ├── risk_tuner.py               # 위험 조정
│   └── deployer.py                 # 프로덕션 배포
├── lib/                            # (비어있음 - 프로덕션에서 구현)
├── orchestrator.py                 # 에이전트 오케스트레이션
├── verify.sh                       # 시스템 검증
├── requirements.txt                # Python dependencies
├── AGENTS.md                       # 상세 문서
└── README.md                       # 이 파일
```

## KV 저장소 키

```
# 일일 파이프라인 아웃풋
di:agents:research:YYYY-MM-DD        → 신규 알파 후보
di:agents:validated:YYYY-MM-DD       → 검증된 전략

# 진화 상태
di:agents:evolution:generation       → 현재 세대 번호
di:agents:evolution:population       → 100 개체군

# 전략 관리
di:agents:strategies:leaderboard     → 순위 리스트
di:agents:strategies:active          → 활성 전략
di:agents:strategies:archive         → 아카이브된 전략

# 위험 설정
di:agents:risk:config                → 현재 레짐 & 위험 파라미터

# 배포
di:agents:deployer:log               → 배포 이력

# 프로덕션
di:quant:latest                      → 최신 프로덕션 설정
di:quant:active-strategies           → 현재 활성 전략
di:quant:strategy-weights            → 전략 가족 가중치
```

## 의존성

```
numpy>=1.26
pandas>=2.1
scipy>=1.12
scikit-learn>=1.4
ta>=0.11                  # Technical analysis indicators
requests>=2.31
python-telegram-bot>=21.0
aiohttp>=3.9              # Async HTTP
deap>=1.4                 # Genetic Algorithm (optional)
```

설치:
```bash
pip install -r requirements.txt
```

## 프로덕션 배포

### Option 1: Systemd Service

```bash
cat > /etc/systemd/system/di-quant-agents.service << EOF
[Unit]
Description=DI금융 자율 전략 진화 시스템
After=network.target

[Service]
Type=simple
User=quant
WorkingDirectory=/path/to/quant-agents
ExecStart=/usr/bin/python3 orchestrator.py
Restart=on-failure
RestartSec=60
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable di-quant-agents.service
sudo systemctl start di-quant-agents.service
sudo journalctl -u di-quant-agents.service -f
```

### Option 2: Docker

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python3", "orchestrator.py"]
```

```bash
docker build -t di-quant-agents .
docker run -d --name quant-agents di-quant-agents
docker logs -f quant-agents
```

### Option 3: Cron Jobs

```bash
# Crontab entries (7 AM to 11 AM + 6 hourly)
0 7 * * * cd /path/to/quant-agents && python3 -m agents.researcher >> /var/log/quant-agents.log 2>&1
0 8 * * * cd /path/to/quant-agents && python3 -m agents.backtester >> /var/log/quant-agents.log 2>&1
0 9 * * * cd /path/to/quant-agents && python3 -m agents.evolver >> /var/log/quant-agents.log 2>&1
0 10 * * * cd /path/to/quant-agents && python3 -m agents.evaluator >> /var/log/quant-agents.log 2>&1
0 11 * * * cd /path/to/quant-agents && python3 -m agents.deployer >> /var/log/quant-agents.log 2>&1
0 0,6,12,18 * * * cd /path/to/quant-agents && python3 -m agents.risk_tuner >> /var/log/quant-agents.log 2>&1
```

## 모니터링

### 로그 확인
```bash
tail -f /var/log/quant-agents.log | grep "COMPLETE\|FAILED"
```

### 에이전트 상태
```bash
# KV에서 최신 실행 기록 확인
curl https://your-supabase-url/functions/v1/kv-get?key=di:agents:deployer:log
```

### Telegram 알림
각 에이전트가 완료 또는 실패 시 자동으로 텔레그램 메시지 발송

## 주요 특징

✅ **완전 자동화**: 매일 07:00 ~ 11:00 KST 자동 파이프라인
✅ **독립적 실행**: 각 에이전트는 단독 실행 가능
✅ **견고한 검증**: Walk-forward + Monte Carlo 검증
✅ **동적 위험 관리**: 시장 레짐 자동 감지
✅ **보수적 배포**: Max 3 changes/day, 3+ days on board
✅ **에러 처리**: 자동 재시도 + Telegram 알림
✅ **추적 가능**: 모든 실행이 KV + 로그에 기록

## 성능

- **Researcher**: 1,440 조합 테스트 (~5분)
- **Backtester**: 4-fold WFT + MC (~10분)
- **Evolver**: 20 gen × 100 pop (~15분)
- **Evaluator**: Leaderboard 업데이트 (~2분)
- **Deployer**: 안전 점검 & 배포 (~1분)
- **Risk Tuner**: 레짐 감지 & 조정 (~1분)

**Total Daily Runtime**: ~33분 (07:00 ~ 11:30 KST)

## 확장성

### 새로운 전략 추가
1. `lib.strategies.STRATEGY_REGISTRY`에 등록
2. Researcher에서 파라미터 그리드 정의
3. 다음 날 자동으로 파이프라인에 포함

### 새로운 지표 추가
1. `lib.indicators`에 계산 함수 구현
2. 전략에서 import 및 사용
3. 자동으로 백테스트에 포함

### 포트폴리오 최적화
Deployer의 `strategy_family_weights`를 조정하여
trend/momentum/mean_reversion 비율 제어

## 문제 해결

### Agent가 작동하지 않음
```bash
python3 -m agents.researcher  # 직접 실행하여 에러 확인
```

### KV 접속 불가
```python
# supabase_kv 라이브러리 검증
python3 -c "from lib.supabase_kv import kv_get; print(kv_get('test'))"
```

### Telegram 알림 미수신
- `config.TELEGRAM_TOKEN` 및 `TELEGRAM_CHAT_ID` 확인
- Bot이 chat에 메시지 전송 권한 있는지 확인

## 라이선스 & 작성자

DI금융 연구소
2026-04-11
