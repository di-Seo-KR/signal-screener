#!/bin/bash
################################################################################
# Zepta Quant Agent Team — VPS Setup Script
# Hetzner Ubuntu 24.04에서 root로 실행
#
# 사용법:
#   bash setup.sh
#
# 설치 순서:
#   1. 시스템 패키지
#   2. Python 환경
#   3. 애플리케이션 디렉토리
#   4. Virtual Environment
#   5. 의존성 설치
#   6. 환경 파일 생성
#   7. Systemd 서비스 등록
#
# 구성 후:
#   1. nano /opt/zepta-agents/.env  ← 환경변수 설정
#   2. systemctl start zepta-agents  ← 서비스 시작
#   3. journalctl -u zepta-agents -f ← 로그 확인
################################################################################

set -e  # 에러 발생 시 즉시 종료

# ═══════════════════════════════════════════════════════════════
# 색상 정의
# ═══════════════════════════════════════════════════════════════

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'  # No Color

# ═══════════════════════════════════════════════════════════════
# 함수
# ═══════════════════════════════════════════════════════════════

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

# ═══════════════════════════════════════════════════════════════
# 사전 확인
# ═══════════════════════════════════════════════════════════════

if [ "$EUID" -ne 0 ]; then
    log_error "이 스크립트는 root 권한으로 실행해야 합니다"
    exit 1
fi

log_info "Zepta Quant Agent Team 설치 시작..."
echo ""

# ═══════════════════════════════════════════════════════════════
# 1. 시스템 패키지 업데이트
# ═══════════════════════════════════════════════════════════════

log_info "시스템 패키지 업데이트 중..."
apt-get update
apt-get upgrade -y

# ═══════════════════════════════════════════════════════════════
# 2. 필수 패키지 설치
# ═══════════════════════════════════════════════════════════════

log_info "필수 패키지 설치 중..."
apt-get install -y \
    python3.12 \
    python3.12-venv \
    python3.12-dev \
    python3-pip \
    git \
    curl \
    wget \
    nano \
    htop \
    build-essential \
    libssl-dev \
    libffi-dev

log_success "필수 패키지 설치 완료"

# ═══════════════════════════════════════════════════════════════
# 3. 애플리케이션 디렉토리 생성
# ═══════════════════════════════════════════════════════════════

log_info "애플리케이션 디렉토리 생성 중..."
mkdir -p /opt/zepta-agents
cd /opt/zepta-agents

# 현재 디렉토리에서 파일 복사 (setup.sh와 같은 위치)
if [ -f requirements.txt ]; then
    log_info "기존 파일에서 복사 중..."
    cp -r . /opt/zepta-agents/ 2>/dev/null || true
else
    log_warning "현재 디렉토리에서 파일을 찾을 수 없습니다"
    log_info "수동으로 파일을 복사해주세요:"
    log_info "  git clone <repo> /opt/zepta-agents"
fi

log_success "애플리케이션 디렉토리 준비 완료"

# ═══════════════════════════════════════════════════════════════
# 4. Python Virtual Environment 생성
# ═══════════════════════════════════════════════════════════════

log_info "Python Virtual Environment 생성 중..."
cd /opt/zepta-agents
python3.12 -m venv venv
source venv/bin/activate

log_success "Virtual Environment 생성 완료"

# ═══════════════════════════════════════════════════════════════
# 5. Python 패키지 설치
# ═══════════════════════════════════════════════════════════════

log_info "Python 패키지 설치 중 (pip upgrade)..."
pip install --upgrade pip setuptools wheel

if [ -f requirements.txt ]; then
    log_info "Python 패키지 설치 중 (requirements.txt)..."
    pip install -r requirements.txt
    log_success "Python 패키지 설치 완료"
else
    log_warning "requirements.txt를 찾을 수 없습니다"
    log_info "최소 패키지 설치 중..."
    pip install \
        numpy \
        pandas \
        requests \
        python-telegram-bot \
        aiohttp \
        python-dotenv \
        schedule
fi

# ═══════════════════════════════════════════════════════════════
# 6. 환경 파일 생성
# ═══════════════════════════════════════════════════════════════

log_info "환경 파일 생성 중..."
cat > /opt/zepta-agents/.env << 'EOF'
# Zepta Quant Agent Team 환경 설정
# IP: 5.223.94.159
# 모든 값을 수정하고 저장하세요!

# ═══════════════════════════════════════════════════════════════
# Vercel KV (Redis 호환)
# ═══════════════════════════════════════════════════════════════
VERCEL_KV_REST_API_URL=https://your-project.vercel.store
VERCEL_KV_REST_API_TOKEN=your-kv-token

# ═══════════════════════════════════════════════════════════════
# Binance API (현물 및 선물)
# ═══════════════════════════════════════════════════════════════
BINANCE_API_KEY=your-binance-api-key
BINANCE_API_SECRET=your-binance-api-secret
BINANCE_FAPI=https://fapi.binance.com

# ═══════════════════════════════════════════════════════════════
# Telegram 알림
# ═══════════════════════════════════════════════════════════════
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# ═══════════════════════════════════════════════════════════════
# VPS 설정
# ═══════════════════════════════════════════════════════════════
VPS_HOST=zepta-quant.dev
VPS_IP=5.223.94.159

# ═══════════════════════════════════════════════════════════════
# 에이전트 설정
# ═══════════════════════════════════════════════════════════════
AGENT_TEAM_SIZE=5

# 백테스트 기본 설정
BACKTEST_LOOKBACK_DAYS=180
BACKTEST_WINDOW=30
BACKTEST_MIN_TRADES=20
BACKTEST_MIN_SHARPE=0.5
EOF

chmod 600 /opt/zepta-agents/.env
log_success "환경 파일 생성 완료"
log_warning "/opt/zepta-agents/.env 파일을 수정해주세요!"

# ═══════════════════════════════════════════════════════════════
# 7. Systemd 서비스 등록
# ═══════════════════════════════════════════════════════════════

log_info "Systemd 서비스 등록 중..."
cat > /etc/systemd/system/zepta-agents.service << 'EOF'
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
EOF

chmod 644 /etc/systemd/system/zepta-agents.service
systemctl daemon-reload

log_success "Systemd 서비스 등록 완료"

# ═══════════════════════════════════════════════════════════════
# 8. 완료 및 지시사항
# ═══════════════════════════════════════════════════════════════

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ Zepta Agent Team 설치 완료!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════════════════${NC}"
echo ""

echo "📋 다음 단계:"
echo ""
echo "  1️⃣  환경변수 설정:"
echo "     nano /opt/zepta-agents/.env"
echo ""
echo "  2️⃣  서비스 시작:"
echo "     systemctl start zepta-agents"
echo ""
echo "  3️⃣  서비스 상태 확인:"
echo "     systemctl status zepta-agents"
echo ""
echo "  4️⃣  실시간 로그 확인:"
echo "     journalctl -u zepta-agents -f"
echo ""
echo "  5️⃣  서비스 활성화 (부팅 시 자동 시작):"
echo "     systemctl enable zepta-agents"
echo ""

echo -e "${YELLOW}⚠  주의:${NC}"
echo "   • /opt/zepta-agents/.env 파일의 모든 설정값을 수정해야 합니다"
echo "   • Binance, Telegram, Vercel KV 인증정보를 입력하세요"
echo "   • 파일은 600 권한으로 보호됩니다"
echo ""

echo -e "${BLUE}📖 유용한 명령어:${NC}"
echo "   systemctl restart zepta-agents    — 서비스 재시작"
echo "   systemctl stop zepta-agents       — 서비스 중지"
echo "   journalctl -u zepta-agents -n 50  — 최근 50줄 로그"
echo "   ps aux | grep orchestrator        — 프로세스 확인"
echo ""

log_success "설치 스크립트 완료"
