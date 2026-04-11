"""
기술 지표 모음

모든 지표는 numpy/pandas 기반 순수 구현 (외부 라이브러리 의존성 최소화)

입력: pandas Series 또는 numpy array
출력: numpy array (NaN for insufficient data)
"""

import numpy as np
import pandas as pd
from typing import Tuple, List, Optional
import logging

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 기본 이동평균
# ═══════════════════════════════════════════════════════════════


def sma(series: np.ndarray, period: int) -> np.ndarray:
    """
    단순 이동평균 (Simple Moving Average)

    Args:
        series: 가격 시리즈
        period: 기간

    Returns:
        SMA 배열
    """
    if len(series) < period:
        return np.full_like(series, np.nan, dtype=float)

    result = np.full_like(series, np.nan, dtype=float)
    for i in range(period - 1, len(series)):
        result[i] = np.mean(series[i - period + 1:i + 1])
    return result


def ema(series: np.ndarray, period: int) -> np.ndarray:
    """
    지수 이동평균 (Exponential Moving Average)

    Args:
        series: 가격 시리즈
        period: 기간

    Returns:
        EMA 배열
    """
    if len(series) < period:
        return np.full_like(series, np.nan, dtype=float)

    result = np.full_like(series, np.nan, dtype=float)
    multiplier = 2 / (period + 1)

    # 초기값은 SMA
    result[period - 1] = np.mean(series[:period])

    for i in range(period, len(series)):
        result[i] = series[i] * multiplier + result[i - 1] * (1 - multiplier)

    return result


# ═══════════════════════════════════════════════════════════════
# 모멘텀 지표
# ═══════════════════════════════════════════════════════════════


def rsi(series: np.ndarray, period: int = 14) -> np.ndarray:
    """
    상대 강도 지수 (Relative Strength Index)

    Args:
        series: 가격 시리즈
        period: 기간 (기본값 14)

    Returns:
        RSI 배열 (0-100)
    """
    if len(series) < period + 1:
        return np.full_like(series, np.nan, dtype=float)

    # 가격 변화
    delta = np.diff(series)
    gains = np.where(delta > 0, delta, 0)
    losses = np.where(delta < 0, -delta, 0)

    # 평균 수익/손실 (EMA 사용)
    avg_gain = np.full_like(series, np.nan, dtype=float)
    avg_loss = np.full_like(series, np.nan, dtype=float)

    avg_gain[period] = np.mean(gains[:period])
    avg_loss[period] = np.mean(losses[:period])

    multiplier = 2 / (period + 1)

    for i in range(period + 1, len(series)):
        avg_gain[i] = avg_gain[i - 1] * (1 - multiplier) + gains[i - 1] * multiplier
        avg_loss[i] = avg_loss[i - 1] * (1 - multiplier) + losses[i - 1] * multiplier

    # RS = 평균수익 / 평균손실
    rs = np.divide(avg_gain, avg_loss, where=avg_loss != 0, out=np.full_like(avg_gain, np.nan))
    rsi_val = 100 - (100 / (1 + rs))

    return rsi_val


def macd(
    series: np.ndarray,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    MACD (Moving Average Convergence Divergence)

    Args:
        series: 가격 시리즈
        fast: 빠른 EMA 기간
        slow: 느린 EMA 기간
        signal: 신호선 EMA 기간

    Returns:
        (MACD line, Signal line, Histogram)
    """
    ema_fast = ema(series, fast)
    ema_slow = ema(series, slow)
    macd_line = ema_fast - ema_slow

    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line

    return macd_line, signal_line, histogram


# ═══════════════════════════════════════════════════════════════
# 변동성 지표
# ═══════════════════════════════════════════════════════════════


def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """
    Average True Range (변동성)

    Args:
        high: 고가 배열
        low: 저가 배열
        close: 종가 배열
        period: 기간

    Returns:
        ATR 배열
    """
    if len(high) < period:
        return np.full_like(high, np.nan, dtype=float)

    # True Range 계산
    tr = np.zeros_like(high, dtype=float)
    tr[0] = high[0] - low[0]

    for i in range(1, len(high)):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i] - close[i - 1]),
        )

    # ATR는 TR의 EMA
    return ema(tr, period)


def bollinger_bands(
    series: np.ndarray,
    period: int = 20,
    mult: float = 2.0,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    볼린저 밴드

    Args:
        series: 가격 시리즈
        period: 기간
        mult: 표준편차 배수

    Returns:
        (상단밴드, 중간선(SMA), 하단밴드)
    """
    middle = sma(series, period)
    std = np.full_like(series, np.nan, dtype=float)

    for i in range(period - 1, len(series)):
        std[i] = np.std(series[i - period + 1:i + 1])

    upper = middle + (std * mult)
    lower = middle - (std * mult)

    return upper, middle, lower


def supertrend(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    period: int = 10,
    mult: float = 3.0,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Supertrend 지표

    Args:
        high: 고가 배열
        low: 저가 배열
        close: 종가 배열
        period: ATR 기간
        mult: ATR 배수

    Returns:
        (추세 방향 [-1/1], Supertrend 값)
    """
    hl2 = (high + low) / 2
    atr_val = atr(high, low, close, period)

    basic_ub = hl2 + mult * atr_val
    basic_lb = hl2 - mult * atr_val

    final_ub = np.full_like(high, np.nan, dtype=float)
    final_lb = np.full_like(high, np.nan, dtype=float)

    for i in range(period, len(high)):
        final_ub[i] = basic_ub[i] if basic_ub[i] < final_ub[i - 1] or close[i - 1] > final_ub[i - 1] else final_ub[i - 1]
        final_lb[i] = basic_lb[i] if basic_lb[i] > final_lb[i - 1] or close[i - 1] < final_lb[i - 1] else final_lb[i - 1]

    supertrend_val = np.full_like(high, np.nan, dtype=float)
    trend = np.full_like(high, 1, dtype=int)

    for i in range(period, len(high)):
        if close[i] <= final_ub[i]:
            supertrend_val[i] = final_ub[i]
            trend[i] = -1
        else:
            supertrend_val[i] = final_lb[i]
            trend[i] = 1

    return trend, supertrend_val


def keltner_channels(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    ema_period: int = 20,
    atr_period: int = 10,
    mult: float = 1.5,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Keltner 채널

    Args:
        high: 고가 배열
        low: 저가 배열
        close: 종가 배열
        ema_period: EMA 기간
        atr_period: ATR 기간
        mult: ATR 배수

    Returns:
        (상단, 중간선(EMA), 하단)
    """
    middle = ema(close, ema_period)
    atr_val = atr(high, low, close, atr_period)

    upper = middle + (atr_val * mult)
    lower = middle - (atr_val * mult)

    return upper, middle, lower


# ═══════════════════════════════════════════════════════════════
# 거래량 지표
# ═══════════════════════════════════════════════════════════════


def obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """
    On-Balance Volume

    Args:
        close: 종가 배열
        volume: 거래량 배열

    Returns:
        OBV 배열
    """
    obv_val = np.zeros_like(close, dtype=float)
    obv_val[0] = volume[0]

    for i in range(1, len(close)):
        if close[i] > close[i - 1]:
            obv_val[i] = obv_val[i - 1] + volume[i]
        elif close[i] < close[i - 1]:
            obv_val[i] = obv_val[i - 1] - volume[i]
        else:
            obv_val[i] = obv_val[i - 1]

    return obv_val


# ═══════════════════════════════════════════════════════════════
# 고급 지표
# ═══════════════════════════════════════════════════════════════


def stochastic_rsi(
    series: np.ndarray,
    rsi_period: int = 14,
    stoch_period: int = 14,
    k_period: int = 3,
    d_period: int = 3,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Stochastic RSI (K%, D%)

    Args:
        series: 가격 시리즈
        rsi_period: RSI 기간
        stoch_period: Stochastic 기간
        k_period: %K EMA 기간
        d_period: %D EMA 기간

    Returns:
        (%K, %D)
    """
    rsi_val = rsi(series, rsi_period)
    k = np.full_like(series, np.nan, dtype=float)

    for i in range(rsi_period + stoch_period - 1, len(series)):
        rsi_window = rsi_val[i - stoch_period + 1:i + 1]
        high = np.nanmax(rsi_window)
        low = np.nanmin(rsi_window)
        k[i] = 100 * (rsi_val[i] - low) / (high - low) if high != low else 50

    k_smooth = ema(k, k_period)
    d_smooth = ema(k_smooth, d_period)

    return k_smooth, d_smooth


def parabolic_sar(
    high: np.ndarray,
    low: np.ndarray,
    af_start: float = 0.02,
    af_max: float = 0.2,
) -> np.ndarray:
    """
    Parabolic SAR

    Args:
        high: 고가 배열
        low: 저가 배열
        af_start: 초기 Acceleration Factor
        af_max: 최대 Acceleration Factor

    Returns:
        SAR 배열
    """
    sar = np.full_like(high, np.nan, dtype=float)
    trend = 1  # 1 = 상승, -1 = 하강
    af = af_start
    hp = high[0]  # Highest Point
    lp = low[0]   # Lowest Point
    sar[0] = low[0]

    for i in range(1, len(high)):
        # SAR 업데이트
        sar[i] = sar[i - 1] + af * (hp - sar[i - 1]) if trend == 1 else sar[i - 1] + af * (lp - sar[i - 1])

        # 추세 변경 확인
        reverse = False
        if trend == 1:
            if low[i] < sar[i]:
                trend = -1
                sar[i] = hp
                lp = low[i]
                af = af_start
                reverse = True
            else:
                if high[i] > hp:
                    hp = high[i]
                    af = min(af + af_start, af_max)
        else:
            if high[i] > sar[i]:
                trend = 1
                sar[i] = lp
                hp = high[i]
                af = af_start
                reverse = True
            else:
                if low[i] < lp:
                    lp = low[i]
                    af = min(af + af_start, af_max)

    return sar


def ichimoku(
    high: np.ndarray,
    low: np.ndarray,
    close: np.ndarray,
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_period: int = 52,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Ichimoku Cloud

    Args:
        high: 고가 배열
        low: 저가 배열
        close: 종가 배열
        tenkan_period: Tenkan 기간
        kijun_period: Kijun 기간
        senkou_period: Senkou B 기간

    Returns:
        (Tenkan-sen, Kijun-sen, Senkou Span A, Senkou Span B, Chikou Span)
    """
    def high_low(arr, period):
        """기간 내 최고가/최저가의 중간값"""
        result = np.full_like(arr, np.nan, dtype=float)
        for i in range(period - 1, len(arr)):
            result[i] = (np.max(arr[i - period + 1:i + 1]) + np.min(arr[i - period + 1:i + 1])) / 2
        return result

    tenkan = high_low(high, tenkan_period)
    kijun = high_low(high, kijun_period)

    senkou_a = (tenkan + kijun) / 2
    senkou_a = np.roll(senkou_a, kijun_period)  # 26개 앞으로 이동

    senkou_b = high_low(high, senkou_period)
    senkou_b = np.roll(senkou_b, kijun_period)

    chikou = np.roll(close, -kijun_period)  # 26개 뒤로 이동

    return tenkan, kijun, senkou_a, senkou_b, chikou


def hurst_exponent(series: np.ndarray, max_lag: int = 100) -> float:
    """
    Hurst 지수 (추세/평균회귀 판단)

    H > 0.5: 추세 시장
    H < 0.5: 평균회귀 시장
    H ≈ 0.5: 랜덤워크

    Args:
        series: 가격 시리즈
        max_lag: 최대 래그

    Returns:
        Hurst 지수 (0~1)
    """
    lags = range(2, min(max_lag, len(series) // 2))
    tau = []

    for lag in lags:
        # 래그별 분산
        var = np.var(np.diff(series[::lag]))
        tau.append(var)

    tau = np.array(tau)
    lags = np.array(lags)

    # log-log 회귀
    poly = np.polyfit(np.log(lags), np.log(tau), 1)
    hurst = poly[0] / 2

    return np.clip(hurst, 0, 1)


def efficiency_ratio(series: np.ndarray, period: int = 10) -> np.ndarray:
    """
    효율성 비율 (Kaufman)

    높은 효율성 = 추세, 낮은 효율성 = 노이즈

    Args:
        series: 가격 시리즈
        period: 기간

    Returns:
        효율성 비율 배열 (0~1)
    """
    result = np.full_like(series, np.nan, dtype=float)
    change = np.abs(np.diff(series, n=period))
    volatility = np.sum(np.abs(np.diff(series)), axis=0, keepdims=True)

    for i in range(period, len(series)):
        chg = np.abs(series[i] - series[i - period])
        vol = np.sum(np.abs(np.diff(series[i - period:i + 1])))
        result[i] = chg / vol if vol > 0 else 0

    return result


def connors_rsi(
    close: np.ndarray,
    rsi_period: int = 3,
    streak_period: int = 2,
    rank_period: int = 100,
) -> np.ndarray:
    """
    Connors RSI (mean-reverting indicator)

    3가지 지표의 가중합:
    1. RSI(3) — 단기 모멘텀
    2. 상승/하강 스트릭 RSI
    3. 퍼센트 랭크

    Args:
        close: 종가 배열
        rsi_period: RSI 기간
        streak_period: 스트릭 RSI 기간
        rank_period: 퍼센트 랭크 기간

    Returns:
        ConnorsRSI 배열 (0-100)
    """
    # 1. RSI(3)
    rsi_3 = rsi(close, rsi_period)

    # 2. 스트릭
    streak = np.zeros_like(close, dtype=float)
    for i in range(1, len(close)):
        if close[i] > close[i - 1]:
            streak[i] = streak[i - 1] + 1 if streak[i - 1] >= 0 else 1
        elif close[i] < close[i - 1]:
            streak[i] = streak[i - 1] - 1 if streak[i - 1] <= 0 else -1
        else:
            streak[i] = streak[i - 1]

    # Streak RSI
    streak_rsi = rsi(streak, streak_period)

    # 3. Percent Rank
    percent_rank = np.full_like(close, np.nan, dtype=float)
    for i in range(rank_period, len(close)):
        window = close[i - rank_period:i + 1]
        rank = np.sum(window <= close[i]) / len(window) * 100
        percent_rank[i] = rank

    # 가중합
    connors = (rsi_3 + streak_rsi + percent_rank) / 3

    return connors


# ═══════════════════════════════════════════════════════════════
# 종합 유틸
# ═══════════════════════════════════════════════════════════════


def to_numpy(series) -> np.ndarray:
    """pandas Series를 numpy array로 변환"""
    if isinstance(series, pd.Series):
        return series.values
    return np.asarray(series, dtype=float)


if __name__ == "__main__":
    # 테스트
    import logging

    logging.basicConfig(level=logging.INFO)

    # 샘플 데이터
    np.random.seed(42)
    close = np.cumsum(np.random.randn(200)) + 100
    high = close + np.random.rand(200) * 2
    low = close - np.random.rand(200) * 2
    volume = np.random.rand(200) * 1000

    print("▶ 기본 지표")
    print(f"  SMA(20): {sma(close, 20)[-5:]}")
    print(f"  EMA(20): {ema(close, 20)[-5:]}")
    print(f"  RSI(14): {rsi(close, 14)[-5:]}")

    print("\n▶ MACD")
    macd_line, signal, hist = macd(close)
    print(f"  MACD: {macd_line[-5:]}")
    print(f"  Signal: {signal[-5:]}")

    print("\n▶ 볼린저 밴드")
    upper, middle, lower = bollinger_bands(close)
    print(f"  Upper: {upper[-5:]}")
    print(f"  Middle: {middle[-5:]}")
    print(f"  Lower: {lower[-5:]}")

    print("\n▶ Hurst 지수")
    h = hurst_exponent(close)
    print(f"  Hurst: {h:.3f}")

    print("\n▶ Efficiency Ratio")
    eff = efficiency_ratio(close)
    print(f"  ER: {eff[-5:]}")

    print("\n✓ 모든 테스트 완료")
