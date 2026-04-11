"""
공유 설정 — 퀀트 에이전트 팀 시스템
VPS: Hetzner Ubuntu 24, IP: 5.223.94.159
스토리지: Vercel KV (Redis-compatible)
알림: Telegram Bot
"""

import os
from enum import Enum
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

# ═══════════════════════════════════════════════════════════════
# 환경변수 로드
# ═══════════════════════════════════════════════════════════════

# Vercel KV 접근 (REST API를 통한 Redis 호환)
# 환경변수: VERCEL_KV_REST_API_URL, VERCEL_KV_REST_API_TOKEN
# (또는 @vercel/kv 라이브러리를 통한 직접 접근)
KV_REST_API_URL = os.getenv("VERCEL_KV_REST_API_URL", "")
KV_REST_API_TOKEN = os.getenv("VERCEL_KV_REST_API_TOKEN", "")

# Binance API
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")
BINANCE_FAPI = os.getenv("BINANCE_FAPI", "https://fapi.binance.com")
BINANCE_FAPI_TESTNET = "https://testnet.binancefuture.com"

# Telegram 알림
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# 기타 설정
AGENT_TEAM_SIZE = int(os.getenv("AGENT_TEAM_SIZE", "5"))
VPS_IP = "5.223.94.159"
VPS_HOST = os.getenv("VPS_HOST", "zepta-quant.dev")

# ═══════════════════════════════════════════════════════════════
# 전략 가족 분류
# ═══════════════════════════════════════════════════════════════

class StrategyFamily(str, Enum):
    """전략 분류"""
    TREND = "trend"              # 추세 추종 (Supertrend, Moving Average)
    MEAN_REVERT = "mean_revert"  # 평균 회귀 (Bollinger Bands, Mean Reversion)
    BREAKOUT = "breakout"        # 돌파 (Volume Breakout, Keltner Channel)
    MOMENTUM = "momentum"        # 모멘텀 (MACD, Dual Momentum)
    VOLATILITY = "volatility"    # 변동성 (ATR-based, Keltner)
    ADVANCED = "advanced"        # 고급 알고리즘 (Ichimoku, Hurst, Smart Money)


# ═══════════════════════════════════════════════════════════════
# 백테스트 설정
# ═══════════════════════════════════════════════════════════════

@dataclass
class BacktestConfig:
    """백테스트 기본 설정"""
    lookback_days: int = 180        # 히스토리 기간
    walk_forward_window: int = 30   # 워크포워드 테스트 윈도우
    min_trades: int = 20            # 최소 거래수 필터링 조건
    min_sharpe: float = 0.5         # 최소 샤프 지수
    initial_capital: float = 10000  # 초기 자본
    commission: float = 0.0004      # 거래수수료 (0.04%)
    slippage: float = 0.0002        # 슬리피지 (0.02%)
    position_size: float = 0.7      # 포지션 크기 (70% 자본)


# ═══════════════════════════════════════════════════════════════
# KV 키 프리픽스
# ═══════════════════════════════════════════════════════════════

KV_PREFIX = "di:agents"  # 모든 에이전트 데이터의 접두사

# KV 키 생성 헬퍼
def kv_key(entity_type: str, entity_id: str, field: str) -> str:
    """생성: di:agents:{type}:{id}:{field}"""
    return f"{KV_PREFIX}:{entity_type}:{entity_id}:{field}"


# 주요 KV 키 패턴:
# - di:agents:strategy:{name}:stats     — 전략별 누적 통계
# - di:agents:strategy:{name}:results   — 최근 백테스트 결과 리스트
# - di:agents:symbol:{sym}:metrics      — 종목별 성과 메트릭
# - di:agents:daily:{date}:report       — 일일 리포트
# - di:agents:evolution:log             — 유전 알고리즘 진화 로그
# - di:agents:portfolio:active          — 활성 포트폴리오 상태


# ═══════════════════════════════════════════════════════════════
# 기본 상수
# ═══════════════════════════════════════════════════════════════

# 트레이딩 시간대
MARKET_OPEN_UTC = 13.5   # NYSE 09:30 EST = 13:30 UTC (동계시간)
MARKET_CLOSE_UTC = 21.0  # NYSE 16:00 EST = 21:00 UTC (동계시간)

# 캐시 설정
CACHE_DIR = "/tmp/zepta-cache"
CACHE_EXPIRY_HOURS = 1

# 배치 처리 설정
DEFAULT_INTERVAL = "1h"  # 기본 캔들 간격
DEFAULT_LOOKBACK_LIMIT = 500  # 기본 캔들 수 제한

# 속도 제한
BINANCE_RATE_LIMIT = 1200  # 요청/분
TELEGRAM_RATE_LIMIT = 20   # 메시지/분

# 퀀트 리서치 배치 (quant-research.js에서 차용)
STRATEGY_FAMILIES_RANKED = [
    "RSI Reversal",
    "MACD Cross",
    "BB Bounce",
    "Triple MA",
    "Supertrend",
    "Keltner Channel",
    "Stochastic RSI",
    "Volume Breakout",
    "Dual Momentum",
    "Mean Reversion",
    "Ichimoku Cloud",
    "OBV Trend",
    "Parabolic SAR",
    "Connors RSI(2)",
    "BTC Alpha",
    "Hurst Regime",
    "Efficiency Ratio",
    "Vol Cluster",
    "Momentum Decay",
    "Smart Money",
]

# ═══════════════════════════════════════════════════════════════
# 시그널 정의
# ═══════════════════════════════════════════════════════════════

SIGNAL_BUY = 1    # 매수 신호
SIGNAL_SELL = -1  # 매도 신호
SIGNAL_HOLD = 0   # 홀드


# ═══════════════════════════════════════════════════════════════
# 텔레그램 알림 설정
# ═══════════════════════════════════════════════════════════════

@dataclass
class TelegramAlertLevel:
    """텔레그램 알림 레벨"""
    CRITICAL = "CRITICAL"  # 🔴
    WARNING = "WARNING"    # 🟡
    INFO = "INFO"         # 🔵
    SUCCESS = "SUCCESS"   # 🟢


# ═══════════════════════════════════════════════════════════════
# 데이터 클래스
# ═══════════════════════════════════════════════════════════════

@dataclass
class StrategyMetrics:
    """전략 성과 메트릭"""
    name: str
    family: StrategyFamily
    total_return: float         # 총 수익률 (%)
    sharpe: float              # 샤프 지수
    sortino: float             # 소르티노 지수
    calmar: float              # 칼마 비율
    max_drawdown: float        # 최대 낙폭 (%)
    win_rate: float            # 승률 (%)
    profit_factor: float       # 수익 팩터
    num_trades: int            # 거래수
    avg_trade_duration: float  # 평균 보유 기간 (일)
    tested_symbols: int        # 테스트된 종목수
    last_updated: str          # ISO 타임스탠프


@dataclass
class BacktestResult:
    """백테스트 결과"""
    symbol: str
    strategy: str
    params: Dict[str, Any]
    total_return: float
    sharpe: float
    sortino: float
    calmar: float
    max_drawdown: float
    win_rate: float
    profit_factor: float
    num_trades: int
    avg_trade_duration: float
    equity_curve: List[float]
    signals: List[Dict[str, Any]]
    timestamp: str


@dataclass
class AgentReport:
    """에이전트 리포트"""
    agent_id: str
    task_type: str  # "backtest", "optimize", "evolve", "monitor"
    status: str     # "running", "completed", "failed"
    summary: str
    metrics: Dict[str, Any]
    started_at: str
    completed_at: Optional[str] = None
    error_message: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# 헬퍼 함수
# ═══════════════════════════════════════════════════════════════

def get_backtest_config() -> BacktestConfig:
    """백테스트 설정 조회"""
    return BacktestConfig(
        lookback_days=int(os.getenv("BACKTEST_LOOKBACK_DAYS", "180")),
        walk_forward_window=int(os.getenv("BACKTEST_WINDOW", "30")),
        min_trades=int(os.getenv("BACKTEST_MIN_TRADES", "20")),
        min_sharpe=float(os.getenv("BACKTEST_MIN_SHARPE", "0.5")),
    )


def validate_config() -> bool:
    """설정 유효성 검증"""
    errors = []

    if not BINANCE_API_KEY:
        errors.append("BINANCE_API_KEY 환경변수 필수")
    if not BINANCE_API_SECRET:
        errors.append("BINANCE_API_SECRET 환경변수 필수")
    if not TELEGRAM_BOT_TOKEN:
        errors.append("TELEGRAM_BOT_TOKEN 환경변수 필수")
    if not TELEGRAM_CHAT_ID:
        errors.append("TELEGRAM_CHAT_ID 환경변수 필수")

    # KV 설정 (REST API 또는 라이브러리)
    if not (KV_REST_API_URL or os.getenv("VERCEL_KV_STORE")):
        errors.append("KV 스토리지 설정 필수 (VERCEL_KV_REST_API_URL 또는 VERCEL_KV_STORE)")

    if errors:
        raise RuntimeError("설정 오류:\n" + "\n".join(errors))

    return True


if __name__ == "__main__":
    # 설정 검증
    try:
        validate_config()
        print("✅ 모든 설정 유효함")
    except RuntimeError as e:
        print(f"❌ {e}")
