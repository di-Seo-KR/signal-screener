# Zepta Quant Agent Team Orchestrator

완전 자동화된 퀀트 투자 에이전트 팀 시스템의 중앙 조정자

## 개요

**Orchestrator**는 6개 에이전트의 실행을 시간 스케줄에 따라 관리하는 중앙 코디네이터입니다.

```
일일 실행 흐름:
07:00 KST → Researcher   (마켓 분석)
08:00 KST → Backtester  (전략 검증)
09:00 KST → Evolver     (최적화)
10:00 KST → Evaluator   (성과 평가)
11:00 KST → Deployer    (라이브 배포)
12:00 KST → Daily Digest (일일 보고서)

매 6시간 → Risk Tuner   (리스크 조정) [00:00, 06:00, 12:00, 18:00]
매 12시간 → Heartbeat   (상태 확인) [00:00, 12:00]
```

## 주요 특징

### 1. **Robust Exception Handling**
- 개별 에이전트 실패가 전체 시스템에 영향 없음
- 각 에이전트 실패 시 자동 Telegram 알림
- 실행 결과 추적 및 로깅

### 2. **Telegram 통합**
- 🚀 시작 메시지: `"Zepta Agent Team started on {hostname}"`
- ❌ 에러 알림: CRITICAL/WARNING 레벨 구분
- 💓 Heartbeat: 매 12시간 생존 확인
- 📊 Daily Digest: 12:00 KST 일일 요약

### 3. **Graceful Shutdown**
- SIGTERM/SIGINT 신호 처리
- 실행 중인 작업 완료 후 종료
- systemd와 완벽 호환

### 4. **다중 실행 모드**
- **정상 운영**: `python orchestrator.py` (스케줄 모드)
- **개별 에이전트**: `python orchestrator.py --agent researcher`
- **일회 실행**: `python orchestrator.py --once` (모든 에이전트 순차)

## 설치

### 로컬 개발 환경

```bash
cd quant-agents/

# 1. Virtual Environment 생성
python3.12 -m venv venv
source venv/bin/activate

# 2. 의존성 설치
pip install -r requirements.txt

# 3. 환경 파일 생성
cp .env.example .env
nano .env  # 설정값 입력

# 4. 개별 에이전트 테스트
python run_agent.py researcher
python run_agent.py backtester
python run_agent.py all  # 모든 에이전트 순차 실행

# 5. 정상 모드 시작
python orchestrator.py
```

### VPS 배포 (Hetzner Ubuntu 24.04)

```bash
# 1. 설치 스크립트 실행 (root 권한)
bash setup.sh

# 2. 환경 파일 설정
nano /opt/zepta-agents/.env

# 3. 서비스 시작
systemctl start zepta-agents

# 4. 로그 확인
journalctl -u zepta-agents -f
```

## 사용법

### 1. 정상 운영 (스케줄 모드)

```bash
python orchestrator.py
```

**출력 예시:**
```
2026-04-11 07:00:15 [INFO] ▶️  Researcher 시작...
2026-04-11 07:00:16 [INFO] ✅ Researcher 완료 (0.8s)
2026-04-11 08:00:15 [INFO] ▶️  Backtester 시작...
...
2026-04-11 12:00:00 [INFO] 📊 Daily Digest 준비 중...
```

### 2. 개별 에이전트 테스트

```bash
# Researcher 실행
python orchestrator.py --agent researcher

# Backtester 실행
python orchestrator.py --agent backtester

# 모든 에이전트 한 번 실행
python orchestrator.py --once
```

**출력 예시:**
```
============================================================
Agent: Researcher
Status: SUCCESS
Duration: 1.2s
Summary: {'status': 'success', 'symbols_analyzed': 150}
============================================================
```

### 3. run_agent.py 편의 도구

```bash
# 개별 에이전트 실행
python run_agent.py researcher
python run_agent.py backtester
python run_agent.py all

# 도움말
python run_agent.py
```

## 아키텍처

### 파일 구조

```
quant-agents/
├── orchestrator.py          ← 메인 조정자 (이 파일)
├── run_agent.py             ← CLI 도구
├── config.py                ← 공유 설정
├── requirements.txt         ← Python 의존성
├── setup.sh                 ← VPS 설치 스크립트
│
├── agents/                  ← 에이전트 구현
│   ├── __init__.py
│   ├── researcher.py        (마켓 분석)
│   ├── backtester.py        (전략 검증)
│   ├── evolver.py           (최적화)
│   ├── evaluator.py         (성과 평가)
│   ├── risk_tuner.py        (리스크 조정)
│   └── deployer.py          (라이브 배포)
│
└── lib/                     ← 라이브러리
    ├── __init__.py
    ├── telegram_report.py   ← Telegram 알림
    ├── supabase_kv.py       ← Vercel KV 스토리지
    ├── binance_data.py      ← Binance API
    └── indicators.py        ← 기술 지표
```

### 실행 흐름

```
Main Process (orchestrator.py)
    │
    ├── Schedule Jobs 등록
    │   ├── 07:00 → run_agent_safe("Researcher", run_researcher)
    │   ├── 08:00 → run_agent_safe("Backtester", run_backtester)
    │   ├── 09:00 → run_agent_safe("Evolver", run_evolver)
    │   ├── 10:00 → run_agent_safe("Evaluator", run_evaluator)
    │   ├── 11:00 → run_agent_safe("Deployer", run_deployer)
    │   ├── 12:00 → send_daily_digest(_daily_results)
    │   ├── 매 6시간 → run_agent_safe("Risk Tuner", run_risk_tuner)
    │   └── 매 12시간 → send_heartbeat(hostname)
    │
    ├── Scheduler Loop
    │   └── 매 1분마다 schedule.run_pending()
    │
    ├── Signal Handler
    │   ├── SIGTERM → _shutdown_event.set()
    │   └── SIGINT → _shutdown_event.set()
    │
    └── Telegram Alerts
        ├── 에이전트 실패 → send_alert()
        ├── 일일 요약 → send_daily_digest()
        ├── Heartbeat → send_heartbeat()
        └── 시작/종료 → send_message()
```

## 환경 설정

### .env 파일 (필수)

```bash
# Vercel KV (Redis 호환)
VERCEL_KV_REST_API_URL=https://your-project.vercel.store
VERCEL_KV_REST_API_TOKEN=your-kv-token

# Binance API
BINANCE_API_KEY=your-api-key
BINANCE_API_SECRET=your-api-secret
BINANCE_FAPI=https://fapi.binance.com

# Telegram 알림
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# VPS 설정
VPS_HOST=zepta-quant.dev
VPS_IP=5.223.94.159
AGENT_TEAM_SIZE=5

# 백테스트 설정
BACKTEST_LOOKBACK_DAYS=180
BACKTEST_WINDOW=30
BACKTEST_MIN_TRADES=20
BACKTEST_MIN_SHARPE=0.5
```

## Systemd 통합

### 서비스 시작/중지

```bash
# 서비스 시작
systemctl start zepta-agents

# 서비스 중지
systemctl stop zepta-agents

# 서비스 재시작
systemctl restart zepta-agents

# 부팅 시 자동 시작
systemctl enable zepta-agents

# 서비스 상태 확인
systemctl status zepta-agents
```

### 로그 확인

```bash
# 실시간 로그 (tail -f)
journalctl -u zepta-agents -f

# 최근 100줄
journalctl -u zepta-agents -n 100

# 특정 시간대 로그
journalctl -u zepta-agents --since "2026-04-11 07:00:00"

# 에러만 필터링
journalctl -u zepta-agents -p err

# 서비스 시작 이후 모든 로그
journalctl -u zepta-agents -b
```

### Systemd Service 파일

위치: `/etc/systemd/system/zepta-agents.service`

```ini
[Unit]
Description=Zepta Quant Agent Team Orchestrator
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/zepta-agents
EnvironmentFile=/opt/zepta-agents/.env
ExecStart=/opt/zepta-agents/venv/bin/python orchestrator.py
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zepta-agents

[Install]
WantedBy=multi-user.target
```

## Telegram 알림 예시

### 시작 메시지
```
🚀 Zepta Agent Team started on zepta-quant.dev
```

### 에이전트 실패 알림
```
🔴 Agent Error Report

Agent: Researcher
Level: CRITICAL
Time: 2026-04-11 07:15:30 KST
Error: Connection timeout to Binance API
```

### Daily Digest
```
📊 Daily Agent Report

Summary:
  ✅ Success: 5
  ❌ Failed: 1
  ⏱️  Total: 45.3s

Details:
✅ Researcher (1.2s): {'status': 'success', 'symbols_analyzed': 150}
✅ Backtester (8.4s): {'status': 'success', 'strategies_tested': 42}
✅ Evolver (12.1s): {'status': 'success', 'generations': 10}
✅ Evaluator (5.6s): {'status': 'success', 'portfolios_ranked': 5}
❌ Deployer (18.0s): Error: Insufficient margin

Time: 2026-04-11 12:00:00 KST
```

### Heartbeat
```
💓 Agent Team alive
Host: zepta-quant.dev
Time: 2026-04-11 00:00:00 KST
```

## 디버깅

### 문제 해결

**1. 에이전트가 실행되지 않음**
```bash
# 로그 확인
journalctl -u zepta-agents -f

# 환경 변수 확인
cat /opt/zepta-agents/.env

# 개별 테스트
python run_agent.py researcher
```

**2. Telegram 알림이 안 옴**
```bash
# 토큰 확인
grep TELEGRAM /opt/zepta-agents/.env

# 직접 테스트
python -c "from lib.telegram_report import send_heartbeat; send_heartbeat('test')"
```

**3. 스케줄이 작동하지 않음**
```bash
# 타임존 확인
timedatectl

# KST로 설정
timedatectl set-timezone Asia/Seoul
```

### 로그 레벨

```python
# orchestrator.py의 로깅 설정 수정
logging.basicConfig(
    level=logging.DEBUG,  # INFO → DEBUG로 변경
    ...
)
```

## 성능 최적화

### 1. 스케줄 간격 조정

```python
# orchestrator.py에서
schedule.every(6).hours.do(...)  # 6시간 → 4시간으로 변경
```

### 2. 동시 실행

현재는 순차 실행입니다. 독립적인 에이전트는 동시 실행 가능:

```python
# 순차 실행 (기본)
await job_researcher()
await job_backtester()

# 동시 실행 (병렬)
await asyncio.gather(
    job_researcher(),
    job_backtester(),
)
```

### 3. 리소스 모니터링

```bash
# CPU/메모리 사용량 모니터링
watch -n 1 'ps aux | grep orchestrator'

# 시스템 리소스
htop
```

## 안전성

### 재시작 정책

```bash
# setup.sh에서 자동 설정됨
Restart=always          # 크래시 시 자동 재시작
RestartSec=30          # 30초 대기 후 재시작
```

### 신호 처리

```python
# Graceful shutdown
signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)

# _shutdown_event가 set되면 루프 종료
while not _shutdown_event.is_set():
    await asyncio.sleep(60)
```

## 통계

### 일일 실행 통계 추적

```bash
# 지난 24시간 에이전트 실행 횟수
journalctl -u zepta-agents --since "24 hours ago" | grep "✅\|❌" | wc -l

# 평균 실행 시간
journalctl -u zepta-agents --since "24 hours ago" | grep "완료" | grep -oE "[0-9]+\.[0-9]+s"
```

## 라이센스

Zepta Quant Agent Team © 2026
