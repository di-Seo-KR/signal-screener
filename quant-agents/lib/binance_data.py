"""
Binance OHLCV 데이터 페칭

공개 API 엔드포인트 사용 (인증 불필요):
  - https://fapi.binance.com/fapi/v1/klines  (Futures)
  - https://api.binance.com/api/v3/klines   (Spot)

속도 제한: 1200 req/min
캐시: /tmp/zepta-cache/ (1시간 만료)
"""

import os
import json
import time
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import hashlib

import pandas as pd
import requests

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 설정
# ═══════════════════════════════════════════════════════════════

BINANCE_FAPI = os.getenv("BINANCE_FAPI", "https://fapi.binance.com")
BINANCE_API = "https://api.binance.com"

CACHE_DIR = os.getenv("CACHE_DIR", "/tmp/zepta-cache")
CACHE_EXPIRY_HOURS = 1

# 속도 제한 (1200 req/min = 20 req/sec)
REQUEST_INTERVAL = 0.05  # 50ms
_last_request_time = 0.0

# ═══════════════════════════════════════════════════════════════
# 캐시 관리
# ═══════════════════════════════════════════════════════════════


def _ensure_cache_dir():
    """캐시 디렉토리 생성"""
    os.makedirs(CACHE_DIR, exist_ok=True)


def _get_cache_path(symbol: str, interval: str) -> str:
    """캐시 파일 경로"""
    fname = hashlib.md5(f"{symbol}:{interval}".encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"binance_{fname}.json")


def _is_cache_valid(fpath: str) -> bool:
    """캐시 유효성 확인"""
    if not os.path.exists(fpath):
        return False
    age = time.time() - os.path.getmtime(fpath)
    return age < (CACHE_EXPIRY_HOURS * 3600)


def _load_cache(symbol: str, interval: str) -> Optional[List[Dict]]:
    """캐시에서 데이터 로드"""
    fpath = _get_cache_path(symbol, interval)
    if not _is_cache_valid(fpath):
        return None
    try:
        with open(fpath, "r") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"캐시 로드 오류 {symbol}: {e}")
        return None


def _save_cache(symbol: str, interval: str, data: List[Dict]):
    """캐시에 데이터 저장"""
    _ensure_cache_dir()
    fpath = _get_cache_path(symbol, interval)
    try:
        with open(fpath, "w") as f:
            json.dump(data, f)
    except Exception as e:
        logger.warning(f"캐시 저장 오류 {symbol}: {e}")


def _clear_cache(symbol: str = None, interval: str = None):
    """캐시 비우기"""
    if symbol and interval:
        fpath = _get_cache_path(symbol, interval)
        if os.path.exists(fpath):
            os.remove(fpath)
    else:
        # 모든 캐시 제거
        import shutil
        if os.path.exists(CACHE_DIR):
            shutil.rmtree(CACHE_DIR)


# ═══════════════════════════════════════════════════════════════
# 속도 제한
# ═══════════════════════════════════════════════════════════════


def _rate_limit():
    """속도 제한 적용"""
    global _last_request_time
    elapsed = time.time() - _last_request_time
    if elapsed < REQUEST_INTERVAL:
        time.sleep(REQUEST_INTERVAL - elapsed)
    _last_request_time = time.time()


# ═══════════════════════════════════════════════════════════════
# HTTP 요청
# ═══════════════════════════════════════════════════════════════


def _fetch_json(url: str, params: Dict = None, timeout: int = 10) -> Optional[Any]:
    """HTTP GET 요청"""
    _rate_limit()
    try:
        resp = requests.get(
            url,
            params=params,
            timeout=timeout,
            headers={"User-Agent": "zepta-quant-agent/1.0"},
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.error(f"HTTP 오류 {url}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════
# 공개 API
# ═══════════════════════════════════════════════════════════════


def fetch_klines(
    symbol: str,
    interval: str = "1h",
    limit: int = 500,
    use_futures: bool = False,
) -> Optional[pd.DataFrame]:
    """
    Binance 캔들 데이터 조회

    Args:
        symbol: 거래쌍 (예: "BTCUSDT")
        interval: 캔들 간격 (1m, 5m, 1h, 4h, 1d)
        limit: 개수 (최대 1000)
        use_futures: Futures API 사용 여부

    Returns:
        [timestamp, open, high, low, close, volume] DataFrame
    """
    # 캐시 확인
    cached = _load_cache(symbol, interval)
    if cached and len(cached) >= limit:
        df = _parse_klines(cached[-limit:])
        logger.debug(f"✓ 캐시 사용: {symbol} {len(df)}개 캔들")
        return df

    # API 요청
    base_url = BINANCE_FAPI if use_futures else BINANCE_API
    path = "/fapi/v1/klines" if use_futures else "/api/v3/klines"
    url = f"{base_url}{path}"

    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "limit": min(limit, 1000),
    }

    data = _fetch_json(url, params)
    if not data:
        logger.warning(f"데이터 조회 실패: {symbol}")
        return None

    # 캐시 저장
    _save_cache(symbol, interval, data)

    # 파싱
    df = _parse_klines(data)
    logger.info(f"✓ 조회 완료: {symbol} {len(df)}개 캔들")
    return df


def fetch_klines_days(
    symbol: str,
    days: int = 180,
    interval: str = "1h",
    use_futures: bool = False,
) -> Optional[pd.DataFrame]:
    """
    장기 캔들 데이터 조회 (페이지네이션)

    예: 180일 1h 캔들 = 4320개 (500개씩 9번)

    Args:
        symbol: 거래쌍
        days: 조회 기간 (일)
        interval: 캔들 간격
        use_futures: Futures API 사용 여부

    Returns:
        DataFrame
    """
    # 캔들 간격별 계산
    intervals_per_day = {
        "1m": 1440,
        "5m": 288,
        "15m": 96,
        "1h": 24,
        "4h": 6,
        "1d": 1,
    }
    candles_needed = intervals_per_day.get(interval, 24) * days
    limit_per_request = 1000

    all_data = []
    end_time = None

    for i in range((candles_needed + limit_per_request - 1) // limit_per_request):
        base_url = BINANCE_FAPI if use_futures else BINANCE_API
        path = "/fapi/v1/klines" if use_futures else "/api/v3/klines"
        url = f"{base_url}{path}"

        params = {
            "symbol": symbol.upper(),
            "interval": interval,
            "limit": limit_per_request,
        }
        if end_time:
            params["endTime"] = end_time

        data = _fetch_json(url, params)
        if not data:
            break

        all_data = data + all_data
        if len(data) < limit_per_request:
            break

        # 다음 배치의 끝시간
        end_time = data[0][0] - 1

        logger.debug(f"  배치 {i + 1}: {len(data)} 캔들, 누적 {len(all_data)}")

        time.sleep(0.1)  # 요청 간 대기

    if not all_data:
        return None

    df = _parse_klines(all_data)
    logger.info(f"✓ 장기 조회 완료: {symbol} {len(df)}개 캔들 ({days}일)")
    return df


def fetch_ticker(symbol: str, use_futures: bool = False) -> Optional[Dict[str, float]]:
    """
    현재 가격 조회

    Args:
        symbol: 거래쌍
        use_futures: Futures API 사용 여부

    Returns:
        {"symbol": str, "price": float, "timestamp": int}
    """
    base_url = BINANCE_FAPI if use_futures else BINANCE_API
    path = "/fapi/v4/ticker/latest" if use_futures else "/api/v3/ticker/price"
    url = f"{base_url}{path}"

    params = {"symbol": symbol.upper()}
    data = _fetch_json(url, params)

    if not data:
        return None

    price = float(data.get("price") or data.get("lastPrice", 0))
    return {
        "symbol": symbol,
        "price": price,
        "timestamp": int(time.time() * 1000),
    }


def fetch_all_tickers(use_futures: bool = False) -> Optional[Dict[str, float]]:
    """
    모든 거래쌍의 현재 가격 조회

    Returns:
        {symbol: price, ...}
    """
    base_url = BINANCE_FAPI if use_futures else BINANCE_API
    path = "/fapi/v1/ticker/24hr" if use_futures else "/api/v3/ticker/price"
    url = f"{base_url}{path}"

    data = _fetch_json(url)
    if not data:
        return None

    if use_futures:
        # Futures: [{symbol, lastPrice}, ...]
        return {d["symbol"]: float(d["lastPrice"]) for d in data}
    else:
        # Spot: [{symbol, price}, ...]
        return {d["symbol"]: float(d["price"]) for d in data}


def fetch_exchange_info(use_futures: bool = False) -> Optional[Dict]:
    """
    거래소 정보 조회 (지원 심볼 목록 등)

    Returns:
        거래소 메타데이터
    """
    base_url = BINANCE_FAPI if use_futures else BINANCE_API
    path = "/fapi/v1/exchangeInfo" if use_futures else "/api/v3/exchangeInfo"
    url = f"{base_url}{path}"

    return _fetch_json(url)


# ═══════════════════════════════════════════════════════════════
# 헬퍼
# ═══════════════════════════════════════════════════════════════


def _parse_klines(data: List[List]) -> pd.DataFrame:
    """
    Binance 캔들 응답 파싱

    응답 형식:
    [
      [
        1499040000000,      // 시간
        "0.01634790",       // open
        "0.80765069",       // high
        "0.01575800",       // low
        "0.01577100",       // close
        "148976.11427815"   // volume
        ...
      ],
      ...
    ]
    """
    if not data:
        return pd.DataFrame()

    df = pd.DataFrame(
        [
            {
                "timestamp": pd.to_datetime(row[0], unit="ms"),
                "open": float(row[1]),
                "high": float(row[2]),
                "low": float(row[3]),
                "close": float(row[4]),
                "volume": float(row[5]),
            }
            for row in data
        ]
    )

    return df.set_index("timestamp")


def validate_symbol(symbol: str, use_futures: bool = False) -> bool:
    """심볼 유효성 확인"""
    info = fetch_exchange_info(use_futures)
    if not info:
        return False

    symbols = {s["symbol"] for s in info.get("symbols", [])}
    return symbol.upper() in symbols


if __name__ == "__main__":
    # 테스트
    import logging

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s"
    )

    # Spot 시장: Bitcoin
    print("\n▶ BTC 최근 1시간 캔들 조회 (Spot)")
    df = fetch_klines("BTCUSDT", interval="1h", limit=10)
    if df is not None:
        print(df.tail())

    # Futures 시장: Bitcoin
    print("\n▶ BTC 최근 1시간 캔들 조회 (Futures)")
    df = fetch_klines("BTCUSDT", interval="1h", limit=10, use_futures=True)
    if df is not None:
        print(df.tail())

    # 현재 가격
    print("\n▶ BTC 현재 가격")
    ticker = fetch_ticker("BTCUSDT")
    print(f"  {ticker}")

    # 장기 데이터
    print("\n▶ BTC 180일 일봉 (페이지네이션)")
    df = fetch_klines_days("BTCUSDT", days=180, interval="1d")
    if df is not None:
        print(f"  {len(df)} 캔들 로드")
        print(df.tail())
