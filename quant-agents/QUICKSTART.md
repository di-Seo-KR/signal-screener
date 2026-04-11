# Zepta Quant Agent Team - Quick Start Guide

## 5분 시작 가이드

### 로컬 개발 환경

```bash
# 1. 디렉토리 이동
cd quant-agents/

# 2. Virtual Environment 설정
python3.12 -m venv venv
source venv/bin/activate

# 3. 의존성 설치
pip install -r requirements.txt

# 4. 환경 파일 생성
cat > .env << 'EOF'
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
BINANCE_API_KEY=your-api-key
BINANCE_API_SECRET=your-api-secret
VERCEL_KV_REST_API_URL=your-kv-url
VERCEL_KV_REST_API_TOKEN=your-kv-token
EOF

# 5. 모든 에이전트 한 번 실행
python orchestrator.py --once

# 6. 개별 에이전트 테스트
python orchestrator.py --agent researcher
python run_agent.py backtester
python run_agent.py all

# 7. 정상 모드 시작 (스케줄 기반)
python orchestrator.py
# Ctrl+C로 종료
```

### VPS 배포 (3단계)

```bash
# VPS에 SSH 접속 (as root)
ssh root@zepta-quant.dev

# 1. 설치 스크립트 실행
bash setup.sh

# 2. 환경 파일 설정
nano /opt/zepta-agents/.env
# (모든 토큰/API 키 입력)

# 3. 서비스 시작
systemctl start zepta-agents
journalctl -u zepta-agents -f
```

## 주요 명령어

### 개발/테스트

| 명령어 | 설명 |
|--------|------|
| `python orchestrator.py` | 정상 운영 (스케줄 모드) |
| `python orchestrator.py --agent researcher` | Researcher만 실행 |
| `python orchestrator.py --once` | 모든 에이전트 한 번 실행 |
| `python run_agent.py backtester` | CLI로 Backtester 실행 |
| `python run_agent.py all` | 모든 에이전트 순차 실행 |

### VPS 운영

| 명령어 | 설명 |
|--------|------|
| `systemctl start zepta-agents` | 서비스 시작 |
| `systemctl stop zepta-agents` | 서비스 중지 |
| `systemctl restart zepta-agents` | 서비스 재시작 |
| `systemctl status zepta-agents` | 서비스 상태 확인 |
| `journalctl -u zepta-agents -f` | 실시간 로그 |
| `journalctl -u zepta-agents -n 100` | 최근 100줄 로그 |

## 일일 스케줄

```
07:00 KST → Researcher   (마켓 분석)
08:00 KST → Backtester  (전략 검증)
09:00 KST → Evolver     (최적화)
10:00 KST → Evaluator   (성과 평가)
11:00 KST → Deployer    (라이브 배포)
12:00 KST → Daily Digest (일일 보고서)

매 6시간 → Risk Tuner   (리스크 조정)
매 12시간 → Heartbeat   (상태 확인)
```

## 폴더 구조

```
quant-agents/
├── orchestrator.py          ← 메인 조정자
├── run_agent.py             ← CLI 도구
├── setup.sh                 ← VPS 설치
├── config.py                ← 설정
├── requirements.txt         ← 의존성
│
├── agents/                  ← 에이전트들
│   ├── researcher.py
│   ├── backtester.py
│   ├── evolver.py
│   ├── evaluator.py
│   ├── risk_tuner.py
│   └── deployer.py
│
├── lib/                     ← 라이브러리
│   ├── telegram_report.py   ← Telegram 알림
│   ├── supabase_kv.py       ← KV 스토리지
│   ├── binance_data.py      ← Binance API
│   └── indicators.py        ← 기술 지표
│
├── ORCHESTRATOR.md          ← 상세 문서
├── DEPLOYMENT.md            ← VPS 배포 가이드
└── QUICKSTART.md            ← 이 파일
```

## Telegram 설정

### 1. 봇 생성

```bash
# Telegram에서 @BotFather 검색
/start
/newbot
# 봇 이름: Zepta Agent Team (예)
# 봇 ID: zepta_agent_team (예)
# → Bot Token: 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
```

### 2. Chat ID 확인

```bash
# 방법 1: @userinfobot 사용
@userinfobot에서 /start
# → "Your user ID: 123456789"

# 방법 2: 봇에 메시지 후 API로 확인
curl "https://api.telegram.org/bot{TOKEN}/getUpdates"
```

### 3. .env 파일에 입력

```bash
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
TELEGRAM_CHAT_ID=123456789
```

## Vercel KV 설정

### 1. KV Store 생성

```bash
# Vercel 대시보드에서
# Storage → KV Database → Create Database
# Region: 선택 (예: Tokyo)
```

### 2. REST API 자격증명 가져오기

```bash
# KV Database 설정에서
# REST API 섹션
VERCEL_KV_REST_API_URL=https://zepta-kv-abc123.vercel.store
VERCEL_KV_REST_API_TOKEN=KV_XXXXXXXXXXXXXXXXXXXXXXXX
```

## Binance API 설정

### 1. API 키 생성

```bash
# Binance 계정 → API Management
# Create API Key (현물 + 선물)
```

### 2. .env 파일에 입력

```bash
BINANCE_API_KEY=your_long_api_key_here
BINANCE_API_SECRET=your_long_api_secret_here
BINANCE_FAPI=https://fapi.binance.com
```

## 문제 해결

### 에이전트가 실행되지 않음

```bash
# 1. 로그 확인
python orchestrator.py --agent researcher

# 2. .env 파일 확인
cat .env | grep -E "TELEGRAM|BINANCE|VERCEL"

# 3. 환경 검증
python -c "from config import validate_config; validate_config()"
```

### Telegram 알림이 안 옴

```bash
# 1. 토큰 테스트
python -c "from lib.telegram_report import send_heartbeat; send_heartbeat('test')"

# 2. 인터넷 연결 확인
curl -I https://api.telegram.org/

# 3. Chat ID 확인
grep TELEGRAM_CHAT_ID .env
```

### VPS 서비스 오류

```bash
# 1. 상태 확인
systemctl status zepta-agents

# 2. 에러 로그 보기
journalctl -u zepta-agents -p err

# 3. 전체 로그 확인
journalctl -u zepta-agents --since "1 hour ago"

# 4. 서비스 재시작
systemctl restart zepta-agents
```

## 다음 단계

1. **Telegram 봇 설정** - @BotFather에서 봇 생성
2. **Vercel KV 생성** - 데이터 저장소 설정
3. **Binance API 키** - 트레이딩 권한 활성화
4. **로컬 테스트** - `python orchestrator.py --once`
5. **VPS 배포** - `bash setup.sh` 실행
6. **모니터링** - `journalctl -u zepta-agents -f`

## 문서

- **ORCHESTRATOR.md** - 상세 기술 문서
- **DEPLOYMENT.md** - VPS 배포 단계별 가이드
- **QUICKSTART.md** - 이 파일 (빠른 시작)

---

**모든 준비가 완료되셨나요? 행운을 빕니다!** 🚀
