# VPS 배포 가이드

Hetzner VPS에 Zepta Quant Agent Team을 배포하는 완전 가이드

## 사전 준비

### 요구사항
- Hetzner VPS (Ubuntu 24.04 LTS)
- Root 접근 권한
- Binance API 키 (현물/선물)
- Telegram 봇 토큰 및 Chat ID
- Vercel KV REST API 인증정보

### VPS 스펙 (권장)
```
CPU: 4 vCPU
RAM: 8 GB
Storage: 50+ GB (SSD)
Bandwidth: 무제한
OS: Ubuntu 24.04 LTS
```

## 배포 단계

### 1단계: VPS 접속

```bash
# SSH 접속
ssh root@5.223.94.159

# 또는 도메인 사용
ssh root@zepta-quant.dev
```

### 2단계: 저장소 클론 (또는 파일 업로드)

```bash
# 방법 A: Git 클론 (권장)
cd /tmp
git clone https://github.com/zepta/quant-agents.git
cd quant-agents

# 방법 B: SCP로 파일 전송
scp -r quant-agents/ root@5.223.94.159:/tmp/

# 방법 C: 직접 생성
mkdir -p /tmp/quant-agents
cd /tmp/quant-agents
# 파일들을 복사
```

### 3단계: 설치 스크립트 실행

```bash
# 현재 디렉토리 확인
pwd  # /tmp/quant-agents 또는 유사

# 실행 권한 부여
chmod +x setup.sh

# 설치 시작
bash setup.sh
```

**설치 진행 내용:**
```
ℹ Zepta Quant Agent Team 설치 시작...

ℹ 시스템 패키지 업데이트 중...
✅ 필수 패키지 설치 완료

ℹ 애플리케이션 디렉토리 생성 중...
✅ 애플리케이션 디렉토리 준비 완료

ℹ Python Virtual Environment 생성 중...
✅ Virtual Environment 생성 완료

ℹ Python 패키지 설치 중...
✅ Python 패키지 설치 완료

ℹ 환경 파일 생성 중...
⚠ /opt/zepta-agents/.env 파일을 수정해주세요!

ℹ Systemd 서비스 등록 중...
✅ Systemd 서비스 등록 완료

════════════════════════════════════════════════════════════════
✅ Zepta Agent Team 설치 완료!
════════════════════════════════════════════════════════════════
```

### 4단계: 환경 파일 설정

```bash
# 환경 파일 수정
nano /opt/zepta-agents/.env
```

**설정 예시:**
```bash
# Vercel KV
VERCEL_KV_REST_API_URL=https://zepta-kv-abc123.vercel.store
VERCEL_KV_REST_API_TOKEN=KV_XXXXXXXXXXXXXXXXXXXXXXXX

# Binance API
BINANCE_API_KEY=your_long_api_key_here
BINANCE_API_SECRET=your_long_api_secret_here
BINANCE_FAPI=https://fapi.binance.com

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh
TELEGRAM_CHAT_ID=123456789

# VPS 설정
VPS_HOST=zepta-quant.dev
VPS_IP=5.223.94.159
AGENT_TEAM_SIZE=5

# 백테스트
BACKTEST_LOOKBACK_DAYS=180
BACKTEST_WINDOW=30
BACKTEST_MIN_TRADES=20
BACKTEST_MIN_SHARPE=0.5
```

**저장 및 종료:**
```
Ctrl + X → Y → Enter
```

### 5단계: 서비스 시작

```bash
# 서비스 시작
systemctl start zepta-agents

# 상태 확인
systemctl status zepta-agents

# 출력 예시:
# ● zepta-agents.service - Zepta Quant Agent Team Orchestrator
#      Loaded: loaded (/etc/systemd/system/zepta-agents.service; enabled; preset: enabled)
#      Active: active (running) since Fri 2026-04-11 07:00:00 UTC
#    Main PID: 12345 (python)
#     Memory: 150.0M
#       CPU: 2%
```

### 6단계: 로그 확인

```bash
# 실시간 로그 확인
journalctl -u zepta-agents -f

# 또는 최근 50줄
journalctl -u zepta-agents -n 50

# 예상 출력:
# Apr 11 07:00:15 zepta-quant root[12345]: 🚀 Zepta Agent Team started on zepta-quant
# Apr 11 07:00:16 root[12345]: ▶️  Researcher 시작...
# Apr 11 07:00:17 root[12345]: ✅ Researcher 완료 (1.2s)
```

### 7단계: 부팅 시 자동 시작 설정

```bash
# 자동 시작 활성화
systemctl enable zepta-agents

# 확인
systemctl is-enabled zepta-agents
# 출력: enabled
```

## 검증

### 서비스 정상 실행 확인

```bash
# 프로세스 확인
ps aux | grep orchestrator

# 포트 바인딩 확인 (Telegram API 통신)
netstat -tlnp | grep python

# 메모리/CPU 사용량
top -p $(pgrep -f orchestrator)
```

### Telegram 알림 테스트

```bash
# 컨테이너에서 Python 실행
cd /opt/zepta-agents
source venv/bin/activate

# 테스트 메시지 전송
python -c "from lib.telegram_report import send_message; send_message('✅ 배포 완료! Zepta Agent Team이 정상 작동 중입니다.')"
```

**성공 시:**
- Telegram에 메시지가 도착합니다
- Chat ID는 메시지가 도착한 채팅방의 ID입니다

## 모니터링

### 일일 점검 체크리스트

```bash
# 서비스 상태
systemctl status zepta-agents

# 최근 에러
journalctl -u zepta-agents -p err

# 메모리 사용량
free -h

# 디스크 사용량
df -h

# CPU 사용량
top -bn1 | head -n 20
```

### 스크립트로 자동 모니터링

```bash
# /opt/zepta-agents/check_health.sh 생성
cat > /opt/zepta-agents/check_health.sh << 'EOF'
#!/bin/bash
echo "=== Zepta Agent Team Health Check ==="
echo "Service Status:"
systemctl status zepta-agents --no-pager
echo ""
echo "Recent Errors:"
journalctl -u zepta-agents -p err -n 5 --no-pager
echo ""
echo "Resource Usage:"
ps aux | grep orchestrator | grep -v grep
echo ""
echo "Last Heartbeat:"
journalctl -u zepta-agents -n 1 --no-pager | grep Heartbeat
EOF

chmod +x /opt/zepta-agents/check_health.sh

# 실행
bash /opt/zepta-agents/check_health.sh
```

## 업데이트

### 에이전트 코드 업데이트

```bash
# 1. 서비스 중지
systemctl stop zepta-agents

# 2. 코드 업데이트
cd /opt/zepta-agents
git pull origin main

# 3. 의존성 업데이트 (필요시)
source venv/bin/activate
pip install -r requirements.txt --upgrade

# 4. 서비스 재시작
systemctl start zepta-agents

# 5. 로그 확인
journalctl -u zepta-agents -f
```

### 환경 파일 업데이트 (인증정보)

```bash
# 1. 환경 파일 수정
nano /opt/zepta-agents/.env

# 2. 서비스 재시작 (systemd가 자동 감지)
systemctl restart zepta-agents
```

## 문제 해결

### 서비스가 시작되지 않음

```bash
# 1. 상태 확인
systemctl status zepta-agents

# 2. 에러 로그 확인
journalctl -u zepta-agents -p err -n 20

# 3. 환경 파일 확인
cat /opt/zepta-agents/.env

# 4. Python 문법 확인
python3 -m py_compile /opt/zepta-agents/orchestrator.py

# 5. Virtual Environment 확인
/opt/zepta-agents/venv/bin/python --version

# 6. 의존성 확인
/opt/zepta-agents/venv/bin/pip list | grep schedule
```

### 에이전트가 실행되지 않음

```bash
# 1. 스케줄 확인 (수동 실행)
/opt/zepta-agents/venv/bin/python /opt/zepta-agents/run_agent.py researcher

# 2. 로그에서 스케줄 확인
journalctl -u zepta-agents | grep "스케줄"

# 3. 타임존 확인
timedatectl
# 출력: Time zone: Asia/Seoul (UTC+09:00) [O]
# 또는 UTC로 표시되는 경우 변경 필요
```

### Telegram 알림이 안 옴

```bash
# 1. 토큰 확인
grep "TELEGRAM" /opt/zepta-agents/.env

# 2. 직접 테스트
cd /opt/zepta-agents
source venv/bin/activate
python -c "from lib.telegram_report import validate_telegram_config; validate_telegram_config()"

# 3. 네트워크 연결 확인
curl -I https://api.telegram.org/

# 4. Chat ID 확인
# Telegram에서 @userinfobot에 /start → 자신의 ID 확인
```

### 메모리 부족

```bash
# 메모리 사용량 모니터링
watch -n 1 'free -h && echo "---" && ps aux | grep orchestrator | grep -v grep'

# 메모리 증가 시 재시작
systemctl restart zepta-agents

# 스왑 추가 (필요시)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 운영 팁

### 1. 정기 백업

```bash
# 환경 파일 백업
cp /opt/zepta-agents/.env /opt/zepta-agents/.env.backup.$(date +%Y%m%d)

# 전체 백업
tar -czf zepta-agents-backup-$(date +%Y%m%d).tar.gz /opt/zepta-agents/
```

### 2. 로그 로테이션

```bash
# systemd는 자동 로그 로테이션을 수행합니다
journalctl --disk-usage
journalctl --vacuum-time=30d  # 30일 이상 로그 삭제
```

### 3. 알림 설정

```bash
# Telegram 채널 생성
# 1. @BotFather에서 봇 생성
# 2. 봇을 채널에 추가
# 3. https://api.telegram.org/bot{TOKEN}/getUpdates로 Chat ID 확인
```

### 4. 외부 모니터링 (선택사항)

```bash
# Uptime Robot 등의 서비스로 주기적 상태 확인
# Cron으로 자동 체크
0 */6 * * * /opt/zepta-agents/check_health.sh | mail -s "Zepta Health" admin@example.com
```

## 안전성

### 보안 체크리스트

- [ ] SSH 키 인증만 사용 (비밀번호 비활성화)
- [ ] Firewall 설정 (필요한 포트만 열기)
- [ ] .env 파일 권한 설정 (600)
- [ ] 정기적인 보안 업데이트
- [ ] 로그 모니터링

```bash
# Firewall 설정 (UFW)
ufw allow 22/tcp
ufw allow 443/tcp
ufw enable

# .env 파일 권한 확인
ls -la /opt/zepta-agents/.env
# -rw------- 1 root root  (600 권한이어야 함)
```

## 지원

### 로그 수집 (문제 보고 시)

```bash
# 최근 1000줄 로그 저장
journalctl -u zepta-agents -n 1000 > zepta-logs.txt

# 시스템 정보 저장
uname -a > system-info.txt
df -h >> system-info.txt
free -h >> system-info.txt

# 전송
scp zepta-logs.txt system-info.txt user@support.example.com:
```

---

**배포 완료!** 🎉

Zepta Quant Agent Team이 Hetzner VPS에서 정상 운영 중입니다.
