# DI금융 자율 전략 진화 시스템 (Autonomous Strategy Evolution System)

## 개요
6개의 독립적인 파이썬 에이전트로 구성된 자동화된 전략 발굴, 검증, 최적화, 배포 시스템.

## 아키텍처

```
Daily Orchestration (07:00 ~ 11:00 KST)
├── 07:00 Researcher Agent
│   ├── Fetch 180일 암호화폐 1h OHLCV (상위 20개)
│   ├── Run 20 strategies × parameter grids
│   └── Output: 신규 알파 후보 (KV: di:agents:research:YYYY-MM-DD)
│
├── 08:00 Backtester Agent
│   ├── Read researcher results
│   ├── Walk-forward test (4 folds: 120d train / 30d test)
│   ├── Monte Carlo significance test (100 iterations)
│   └── Output: 검증된 전략 (KV: di:agents:validated:YYYY-MM-DD)
│
├── 09:00 Evolver Agent
│   ├── Load population (100 individuals)
│   ├── Genetic Algorithm (20 generations)
│   │   ├── Selection: Tournament (size=3)
│   │   ├── Crossover: BLX-alpha (numeric params)
│   │   ├── Mutation: Gaussian (10% sigma)
│   │   └── Elitism: Top 10%
│   └── Output: Evolved population (KV: di:agents:evolution:*)
│
├── 10:00 Evaluator Agent
│   ├── Collect all active strategies
│   ├── Calculate 30-day performance metrics
│   ├── Composite score = 0.35×Sharpe + 0.20×Sortino + 0.15×WinRate + 0.15×PF + 0.15×(1-DD)
│   ├── Promotion: evolver strategies > median → promote to active
│   ├── Demotion: bottom 10% or negative returns → archive
│   └── Output: Updated leaderboard (KV: di:agents:strategies:leaderboard)
│
└── 11:00 Deployer Agent
    ├── Read leaderboard + current production
    ├── Generate deployment plan:
    │   ├── +N new strategies (walked-forward, 3+ days on board, p<0.05)
    │   ├── -M removed strategies (not on leaderboard)
    │   └── ~Z parameter updates
    ├── Safety checks (max 3 changes/day)
    └── Output: Deploy to di:quant:active-strategies

Every 6 Hours (00:00, 06:00, 12:00, 18:00)
└── Risk Tuner Agent
    ├── Fetch BTC, ETH, S&P prices
    ├── Detect regime: Hurst, Efficiency Ratio, ATR
    ├── Classify: TRENDING_UP/DOWN, MEAN_REVERTING, HIGH/LOW_VOLATILITY
    ├── Adjust risk params per regime
    │   ├── leverage_multiplier: 0.6 ~ 1.3x
    │   ├── position_size_multiplier: 0.3 ~ 1.2x
    │   ├── stop_loss_multiplier: 0.8 ~ 1.5x
    │   └── strategy_family_weights
    └── Output: Updated risk config (KV: di:agents:risk:config)
```

## 각 에이전트 상세

### 1. Researcher Agent (`researcher.py`)
**목표**: 신규 알파 발굴

**구현**:
- 180일 1h OHLCV 데이터 수집 (상위 20 암호화폐)
- 20 전략 × 파라미터 그리드 백테스트 (~1440 조합)
- Sharpe, Sortino, Max DD, Win Rate, Profit Factor 점수
- 상위 20개 후보 선택 (Sharpe > 0.3, trades >= 10)
- 신규 패턴 감지: 여러 심볼에서 갑자기 잘 작동하는 전략
- KV 저장: `di:agents:research:YYYY-MM-DD`
- 텔레그램: "🔬 Research Complete: Found X new alpha candidates"

**실행**: 매일 07:00 KST

### 2. Backtester Agent (`backtester.py`)
**목표**: 과적합 검증 (Out-of-Sample Validation)

**구현**:
- Walk-Forward Test (4 fold):
  - Train: 120일, Test: 30일 (미래 데이터)
  - OOS Sharpe, 일관성(consistency), 거래 수 검증
- Monte Carlo Test (100 shuffled returns):
  - 실제 수익률 vs 무작위 수익률
  - p-value < 0.05만 통과
- 필터링:
  - OOS Sharpe > 0.3
  - Consistency > 0.5
  - Min 15 trades/fold
  - p-value < 0.05
- KV 저장: `di:agents:validated:YYYY-MM-DD`
- 텔레그램: "✅ Validation: X/Y candidates passed walk-forward + Monte Carlo"

**실행**: 매일 08:00 KST

### 3. Evolver Agent (`evolver.py`)
**목표**: 유전 알고리즘을 통한 파라미터 최적화

**구현**:
- Genetic Algorithm (DEAP 라이브러리 사용):
  - Population: 100 individuals
  - Generations: 20
  - Individual = (strategy_name, {params}, [symbols])
  
- Fitness function:
  ```
  fitness = OOS_Sharpe × sqrt(num_trades) × (1 - max_dd)
  ```
  
- 연산자:
  - **Selection**: Tournament selection (size=3)
  - **Crossover**: BLX-alpha (0.3) for numeric params
  - **Mutation**: Gaussian (sigma=10% of range)
  - **Elitism**: Keep top 10% unchanged
  
- 출력: 진화된 개체군, 최적 fitness 추적
- KV 저장: `di:agents:evolution:generation`, `di:agents:evolution:population`
- 텔레그램: "🧬 Evolution Gen X: Best fitness Y, avg Z, improved A strategies"

**실행**: 매일 09:00 KST

### 4. Evaluator Agent (`evaluator.py`)
**목표**: 전략 성과 점수 산정 및 리더보드 업데이트

**구현**:
- 30일 라이브/섀도우 성과 계산
- Composite Score:
  ```
  score = 0.35×Sharpe + 0.20×Sortino + 0.15×WinRate 
        + 0.15×ProfitFactor + 0.15×(1-MaxDD)
  ```
- 승격 (Promotion):
  - Evolver 전략이 현재 리더보드 중위수 초과 → 활성 전략으로 승격
  
- 강등 (Demotion):
  - 활성 전략 중 하위 10% → 아카이브
  - 또는 최근 30일 수익률이 음수 → 아카이브
  
- KV 저장: `di:agents:strategies:leaderboard`
- 텔레그램: "📊 Evaluation: X strategies active, Y promoted, Z demoted, top Sharpe: W"

**실행**: 매일 10:00 KST

### 5. Risk Tuner Agent (`risk_tuner.py`)
**목표**: 시장 레짐 감지 & 위험 파라미터 자동 조정

**구현**:
- 시장 데이터: BTC, ETH, S&P 프록시
- 지표 계산:
  - **Hurst Exponent** (추세 강도): H > 0.6 = trending, H < 0.4 = mean reverting
  - **Efficiency Ratio** (추세 vs 노이즈): ER = |change| / sum(|returns|)
  - **ATR Percentile** (변동성): 0 = 낮음, 1 = 높음

- 레짐 분류:
  - `TRENDING_UP`: leverage=1.2x, size=1.0x, stop=1.3x
  - `TRENDING_DOWN`: leverage=0.8x, size=0.7x, stop=1.2x
  - `MEAN_REVERTING`: leverage=1.0x, size=0.9x, stop=1.0x
  - `HIGH_VOLATILITY`: leverage=0.6x, size=0.5x, stop=0.8x
  - `LOW_VOLATILITY`: leverage=1.3x, size=1.1x, stop=1.5x

- 레짐별 전략 가중치:
  - TRENDING: Trend 50% + Momentum 30% + MR 20%
  - MEAN_REVERTING: MR 60% + Trend 20% + Momentum 20%
  - HIGH_VOL: Reduce all positions by 50%
  - LOW_VOL: Increase positions by 10-30%

- KV 저장: `di:agents:risk:config`
- 텔레그램: "🛡️ Risk Update: Regime=X, Leverage=Y, Size=Z"

**실행**: 매 6시간 (00:00, 06:00, 12:00, 18:00)

### 6. Deployer Agent (`deployer.py`)
**목표**: 검증된 전략을 프로덕션에 안전하게 배포

**구현**:
- 리더보드 vs 현재 프로덕션 비교
- 배포 계획 생성:
  - **신규 추가**: validated → not in production
  - **제거**: in production → not on leaderboard
  - **파라미터 업데이트**: params changed on leaderboard

- 안전 점검:
  - ✓ Walk-forward validation 통과
  - ✓ 리더보드에 3일 이상 등재 (consistency)
  - ✓ Monte Carlo p-value < 0.05
  - ✓ **최대 3 changes/day** (보수적 접근)

- 배포 실행:
  - `di:quant:active-strategies` 업데이트
  - `strategy-weights.js` 가중치 업데이트
  - 배포 이력 기록: `di:agents:deployer:log`

- KV 저장: `di:quant:latest`
- 텔레그램: "🚀 Deployed: +X new strategies, -Y removed, Z updated params"

**실행**: 매일 11:00 KST

## KV 저장소 스키마

```
# 연구 & 검증
di:agents:research:YYYY-MM-DD
  ├── timestamp
  ├── top_candidates (상위 20)
  └── novel_patterns (신규 패턴)

di:agents:validated:YYYY-MM-DD
  ├── timestamp
  ├── validated_count
  └── strategies (walk-forward + MC passed)

# 진화
di:agents:evolution:generation      → current gen number
di:agents:evolution:population      → current 100 individuals

# 평가
di:agents:strategies:leaderboard    → ranked strategies (composite score)
di:agents:strategies:active         → currently deployed strategies
di:agents:strategies:archive        → demoted strategies

# 위험
di:agents:risk:config               → current regime & risk params

# 배포
di:agents:deployer:log              → deployment history

di:quant:latest                     → latest production config
di:quant:active-strategies          → active trading strategies
di:quant:strategy-weights           → family weights for engine
```

## 실행 방법

### 단일 에이전트 실행 (개발/테스트)
```bash
cd /path/to/quant-agents

# Researcher
python3 -m agents.researcher

# Backtester
python3 -m agents.backtester

# Evolver
python3 -m agents.evolver

# Evaluator
python3 -m agents.evaluator

# Risk Tuner
python3 -m agents.risk_tuner

# Deployer
python3 -m agents.deployer
```

### 오케스트레이터를 통한 실행
```bash
# 특정 에이전트만 실행
python3 orchestrator.py --agent researcher

# 모든 에이전트를 순차 실행 (한 번)
python3 orchestrator.py --run-once

# 스케줄에 따라 실행 (daemon mode)
python3 orchestrator.py
```

### Systemd를 통한 자동화 (VPS)
```bash
# Service 파일 생성
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

[Install]
WantedBy=multi-user.target
EOF

# 실행
sudo systemctl enable di-quant-agents.service
sudo systemctl start di-quant-agents.service

# 로그 확인
sudo journalctl -u di-quant-agents.service -f
```

## 라이브러리 의존성

```
numpy>=1.26
pandas>=2.1
scipy>=1.12
scikit-learn>=1.4
ta>=0.11              # Technical analysis indicators
requests>=2.31
python-telegram-bot>=21.0
aiohttp>=3.9          # Async HTTP
deap>=1.4             # Genetic Algorithm
```

설치: `pip install -r requirements.txt`

## 통합 라이브러리 (프로덕션에서 구현 필요)

```python
# lib.supabase_kv
kv_get(key: str) -> str
kv_set(key: str, value: str) -> None

# lib.binance_data
fetch_klines_days(symbol: str, interval: str, days: int) -> pd.DataFrame
fetch_ticker(symbol: str) -> Dict

# lib.indicators
calculate_rsi(prices, period) -> List[float]
calculate_macd(prices) -> (macd, signal, histogram)
calculate_bollinger_bands(prices, period, std_dev) -> (upper, middle, lower)
# ... (모든 20개 전략 지표)

# lib.backtest
class BacktestEngine:
    def run(self, strategy: str, params: Dict, ohlcv: pd.DataFrame) -> Dict

# lib.strategies
STRATEGY_REGISTRY: Dict[str, callable]
get_strategy(name: str) -> callable

# lib.telegram_report
send_agent_report(agent_name: str, message: str) -> None
send_alert(message: str) -> None

# config
TELEGRAM_TOKEN: str
TELEGRAM_CHAT_ID: str
SUPABASE_URL: str
SUPABASE_KEY: str
# ... (other configs)
```

## 주요 특징

✅ **자동화**: 매일 07:00 ~ 11:00 KST 자동 실행
✅ **독립적**: 각 에이전트는 독립적으로 실행 가능
✅ **견고성**: 각 에이전트의 try/except + Telegram 실패 알림
✅ **추적성**: 모든 실행이 KV에 기록 & 로그 출력
✅ **확장성**: 새로운 전략/지표 추가 용이
✅ **보수성**: 최대 3 changes/day, 3일 이상 검증 필수

## 성능 지표

- **Researcher**: ~1440 조합 테스트, 상위 20 선택 (~5분)
- **Backtester**: 4-fold WFT + MC test (~10분)
- **Evolver**: 20 generations × 100 population (~15분)
- **Evaluator**: Leaderboard 업데이트 (~2분)
- **Deployer**: 안전 점검 & 배포 (~1분)
- **Risk Tuner**: 레짐 감지 & 조정 (~1분)

## 개발 노트

- 모든 에이전트는 `async def run()` 메인 함수 포함
- 에러 발생 시 Telegram 알림 + 로그 기록
- 프로토타입은 mock 데이터 사용, 실제는 lib 모듈에서 import
- 스케줄 시간은 환경 설정으로 변경 가능
- KV 키는 일관된 네이밍 규칙 사용 (`di:agents:*`)
