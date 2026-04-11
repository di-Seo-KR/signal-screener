"""
20개 퀀트 전략 구현

모든 전략은 다음 시그니처를 따름:
  fn(data: np.ndarray, **params) → np.ndarray of signals (1/-1/0)

data 형식:
  np.ndarray with columns: [open, high, low, close, volume]
"""

import numpy as np
import pandas as pd
from typing import Dict, Tuple, Callable, Any, Optional
import logging

from .indicators import (
    sma, ema, rsi, macd, atr, bollinger_bands, supertrend,
    keltner_channels, stochastic_rsi, parabolic_sar, ichimoku,
    obv, hurst_exponent, efficiency_ratio, connors_rsi
)

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 신호 생성 헬퍼
# ═══════════════════════════════════════════════════════════════


def signal_crossover(series_a: np.ndarray, series_b: np.ndarray) -> np.ndarray:
    """
    크로스오버 신호 생성

    Returns:
        1: a가 b 위로 (골든크로스)
        -1: a가 b 아래로 (데드크로스)
        0: 홀드
    """
    signals = np.zeros(len(series_a), dtype=int)

    for i in range(1, len(series_a)):
        if np.isnan(series_a[i]) or np.isnan(series_b[i]):
            continue
        if np.isnan(series_a[i - 1]) or np.isnan(series_b[i - 1]):
            continue

        # 골든크로스
        if series_a[i] > series_b[i] and series_a[i - 1] <= series_b[i - 1]:
            signals[i] = 1
        # 데드크로스
        elif series_a[i] < series_b[i] and series_a[i - 1] >= series_b[i - 1]:
            signals[i] = -1

    return signals


def signal_threshold(series: np.ndarray, buy_th: float, sell_th: float) -> np.ndarray:
    """
    임계값 기반 신호 생성

    Returns:
        1: series > buy_th (이전은 <= buy_th)
        -1: series < sell_th (이전은 >= sell_th)
        0: 홀드
    """
    signals = np.zeros(len(series), dtype=int)

    for i in range(1, len(series)):
        if np.isnan(series[i]) or np.isnan(series[i - 1]):
            continue

        # 매수
        if series[i] > buy_th and series[i - 1] <= buy_th:
            signals[i] = 1
        # 매도
        elif series[i] < sell_th and series[i - 1] >= sell_th:
            signals[i] = -1

    return signals


# ═══════════════════════════════════════════════════════════════
# 20개 전략 구현
# ═══════════════════════════════════════════════════════════════


def rsi_reversal(data: np.ndarray, period: int = 14, buy_th: int = 30, sell_th: int = 70) -> np.ndarray:
    """
    RSI 평균회귀

    매도 과다(< buy_th) → 매수
    매수 과다(> sell_th) → 매도
    """
    close = data[:, 4]
    rsi_val = rsi(close, period)
    return signal_threshold(rsi_val, buy_th, sell_th)


def macd_cross(data: np.ndarray, fast: int = 12, slow: int = 26, sig: int = 9) -> np.ndarray:
    """
    MACD 크로스

    MACD > Signal: 매수
    MACD < Signal: 매도
    """
    close = data[:, 4]
    macd_line, signal_line, _ = macd(close, fast, slow, sig)
    return signal_crossover(macd_line, signal_line)


def bollinger_bounce(data: np.ndarray, period: int = 20, mult: float = 2.0) -> np.ndarray:
    """
    볼린저 밴드 터치 & 바운스

    저가 < 하단밴드 후 종가 > 하단밴드: 매수
    고가 > 상단밴드 후 종가 < 상단밴드: 매도
    """
    close = data[:, 4]
    low = data[:, 2]
    high = data[:, 1]

    upper, middle, lower = bollinger_bands(close, period, mult)
    signals = np.zeros(len(close), dtype=int)

    for i in range(1, len(close)):
        if np.isnan(lower[i]) or np.isnan(upper[i]):
            continue

        # 하단 터치 후 바운스
        if low[i - 1] <= lower[i - 1] and close[i] > lower[i]:
            signals[i] = 1
        # 상단 터치 후 반락
        elif high[i - 1] >= upper[i - 1] and close[i] < upper[i]:
            signals[i] = -1

    return signals


def triple_ma(data: np.ndarray, fast: int = 5, mid: int = 21, slow: int = 55) -> np.ndarray:
    """
    트리플 이동평균 (추세 추종)

    fast > mid > slow: 강한 상승 → 매수
    fast < mid < slow: 강한 하강 → 매도
    """
    close = data[:, 4]
    ema_fast = ema(close, fast)
    ema_mid = ema(close, mid)
    ema_slow = ema(close, slow)

    signals = np.zeros(len(close), dtype=int)

    for i in range(1, len(close)):
        if np.isnan(ema_fast[i]) or np.isnan(ema_mid[i]) or np.isnan(ema_slow[i]):
            continue

        # 정렬된 상승
        if ema_fast[i] > ema_mid[i] > ema_slow[i] and not (ema_fast[i - 1] > ema_mid[i - 1] > ema_slow[i - 1]):
            signals[i] = 1
        # 정렬된 하강
        elif ema_fast[i] < ema_mid[i] < ema_slow[i] and not (ema_fast[i - 1] < ema_mid[i - 1] < ema_slow[i - 1]):
            signals[i] = -1

    return signals


def supertrend_strategy(data: np.ndarray, period: int = 10, mult: float = 3.0) -> np.ndarray:
    """
    Supertrend 추세 추종

    추세 전환 시점에서 신호 생성
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]

    trend, st_val = supertrend(high, low, close, period, mult)

    signals = np.zeros(len(close), dtype=int)
    for i in range(1, len(close)):
        if np.isnan(st_val[i]):
            continue
        # 추세 전환
        if trend[i] == 1 and trend[i - 1] == -1:
            signals[i] = 1
        elif trend[i] == -1 and trend[i - 1] == 1:
            signals[i] = -1

    return signals


def keltner_channel(data: np.ndarray, ema_period: int = 20, atr_period: int = 10, mult: float = 1.5) -> np.ndarray:
    """
    Keltner 채널 (변동성 기반 채널)

    채널 돌파 시점에서 신호
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]

    upper, middle, lower = keltner_channels(high, low, close, ema_period, atr_period, mult)

    signals = np.zeros(len(close), dtype=int)
    for i in range(1, len(close)):
        if np.isnan(upper[i]) or np.isnan(lower[i]):
            continue

        # 상단 돌파
        if close[i - 1] <= upper[i - 1] and close[i] > upper[i]:
            signals[i] = 1
        # 하단 돌파
        elif close[i - 1] >= lower[i - 1] and close[i] < lower[i]:
            signals[i] = -1

    return signals


def stochastic_rsi_strategy(data: np.ndarray, rsi_period: int = 14, stoch_period: int = 14, k: int = 3, d: int = 3) -> np.ndarray:
    """
    Stochastic RSI

    %K < 20: 과매도 → 매수
    %K > 80: 과매수 → 매도
    """
    close = data[:, 4]
    k_val, d_val = stochastic_rsi(close, rsi_period, stoch_period, k, d)
    return signal_threshold(k_val, 20, 80)


def volume_breakout(data: np.ndarray, vol_mult: float = 2.0, trend_period: int = 20) -> np.ndarray:
    """
    거래량 돌파

    거래량 증가 + 가격 추세 확인 → 신호
    """
    close = data[:, 4]
    volume = data[:, 5]

    vol_sma = sma(volume, 20)
    trend_sma = sma(close, trend_period)

    signals = np.zeros(len(close), dtype=int)

    for i in range(max(20, trend_period), len(close)):
        if np.isnan(vol_sma[i]) or np.isnan(trend_sma[i]):
            continue

        # 거래량 급증 + 상승
        if volume[i] > vol_sma[i] * vol_mult and close[i] > close[i - 1] and close[i] > trend_sma[i]:
            signals[i] = 1
        # 거래량 급증 + 하락
        elif volume[i] > vol_sma[i] * vol_mult and close[i] < close[i - 1] and close[i] < trend_sma[i]:
            signals[i] = -1

    return signals


def dual_momentum(data: np.ndarray, lookback: int = 60, hold_bars: int = 20) -> np.ndarray:
    """
    이중 모멘텀

    절대 + 상대 모멘텀 확인 → 신호
    """
    close = data[:, 4]
    signals = np.zeros(len(close), dtype=int)
    last_signal = -999

    for i in range(lookback, len(close)):
        if i - last_signal < hold_bars:
            continue

        abs_ret = (close[i] - close[i - lookback]) / close[i - lookback]
        rel_ret = (close[i] - close[i - lookback // 2]) / close[i - lookback // 2]

        if abs_ret > 0 and rel_ret > 0.02:
            signals[i] = 1
            last_signal = i
        elif abs_ret < -0.05 or rel_ret < -0.03:
            signals[i] = -1
            last_signal = i

    return signals


def mean_reversion(data: np.ndarray, period: int = 20, z_threshold: float = 2.0) -> np.ndarray:
    """
    평균회귀 (Z-score)

    Z < -threshold: 매수
    Z > threshold: 매도
    """
    close = data[:, 4]
    sma_val = sma(close, period)

    signals = np.zeros(len(close), dtype=int)

    for i in range(period, len(close)):
        if np.isnan(sma_val[i]):
            continue

        # Z-score 계산
        window = close[i - period + 1:i + 1]
        std = np.std(window)
        if std == 0:
            continue

        z = (close[i] - sma_val[i]) / std

        if z > z_threshold and (i == period or (close[i - 1] - sma_val[i - 1]) / np.std(close[i - period:i]) >= z_threshold):
            signals[i] = -1
        elif z < -z_threshold and (i == period or (close[i - 1] - sma_val[i - 1]) / np.std(close[i - period:i]) <= -z_threshold):
            signals[i] = 1

    return signals


def ichimoku_strategy(data: np.ndarray, tenkan: int = 9, kijun: int = 26, senkou: int = 52) -> np.ndarray:
    """
    Ichimoku Cloud 추세 추종

    Tenkan > Kijun + 종가 > 클라우드: 매수
    Tenkan < Kijun + 종가 < 클라우드: 매도
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]

    tenkan_val, kijun_val, senkou_a, senkou_b, chikou = ichimoku(high, low, close, tenkan, kijun, senkou)

    signals = np.zeros(len(close), dtype=int)

    for i in range(kijun, len(close)):
        if np.isnan(tenkan_val[i]) or np.isnan(kijun_val[i]):
            continue

        cloud_upper = max(senkou_a[i], senkou_b[i]) if not np.isnan(senkou_a[i]) else np.nan
        cloud_lower = min(senkou_a[i], senkou_b[i]) if not np.isnan(senkou_b[i]) else np.nan

        if np.isnan(cloud_upper) or np.isnan(cloud_lower):
            continue

        # 강한 상승
        if (tenkan_val[i] > kijun_val[i] and
            (i == 0 or not (tenkan_val[i - 1] > kijun_val[i - 1])) and
            close[i] > cloud_upper):
            signals[i] = 1
        # 강한 하강
        elif (tenkan_val[i] < kijun_val[i] and
              (i == 0 or not (tenkan_val[i - 1] < kijun_val[i - 1])) and
              close[i] < cloud_lower):
            signals[i] = -1

    return signals


def obv_trend(data: np.ndarray, ema_period: int = 20) -> np.ndarray:
    """
    OBV (거래량 누적) 추세

    OBV > OBV_EMA: 매수
    OBV < OBV_EMA: 매도
    """
    close = data[:, 4]
    volume = data[:, 5]

    obv_val = obv(close, volume)
    obv_ema_val = ema(obv_val, ema_period)

    return signal_crossover(obv_val, obv_ema_val)


def parabolic_sar_strategy(data: np.ndarray, af_start: float = 0.02, af_max: float = 0.2) -> np.ndarray:
    """
    Parabolic SAR 추세 추종

    SAR 돌파 시점에서 신호
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]

    sar = parabolic_sar(high, low, af_start, af_max)

    signals = np.zeros(len(close), dtype=int)

    for i in range(1, len(close)):
        if np.isnan(sar[i]) or np.isnan(sar[i - 1]):
            continue

        # SAR 위로 돌파
        if close[i] > sar[i] and close[i - 1] <= sar[i - 1]:
            signals[i] = 1
        # SAR 아래로 돌파
        elif close[i] < sar[i] and close[i - 1] >= sar[i - 1]:
            signals[i] = -1

    return signals


def connors_rsi_strategy(data: np.ndarray, rsi_period: int = 2, buy_th: int = 10, sell_th: int = 90) -> np.ndarray:
    """
    Connors RSI (극단적 평균회귀)

    ConnorsRSI < buy_th: 매수
    ConnorsRSI > sell_th: 매도
    """
    close = data[:, 4]
    crsi = connors_rsi(close, rsi_period, 2, 100)
    return signal_threshold(crsi, buy_th, sell_th)


def btc_alpha(data: np.ndarray, rsi_period: int = 14, bb_period: int = 20, bb_mult: float = 2.0, ema_fast: int = 9, ema_slow: int = 21) -> np.ndarray:
    """
    BTC Alpha (다중 지표 결합)

    RSI + BB + EMA 크로스
    """
    close = data[:, 4]

    rsi_val = rsi(close, rsi_period)
    _, bb_middle, bb_lower = bollinger_bands(close, bb_period, bb_mult)
    ema_f = ema(close, ema_fast)
    ema_s = ema(close, ema_slow)

    signals = np.zeros(len(close), dtype=int)

    for i in range(max(rsi_period, bb_period, ema_slow), len(close)):
        if np.isnan(rsi_val[i]) or np.isnan(ema_f[i]):
            continue

        # 매수: RSI < 50 + BB 하단 + EMA 크로스업
        if (rsi_val[i] < 50 and close[i] < bb_lower[i] and
            ema_f[i] > ema_s[i] and ema_f[i - 1] <= ema_s[i - 1]):
            signals[i] = 1

        # 매도: RSI > 70 또는 EMA 크로스다운
        elif (rsi_val[i] > 70 or
              (ema_f[i] < ema_s[i] and ema_f[i - 1] >= ema_s[i - 1])):
            signals[i] = -1

    return signals


def hurst_regime(data: np.ndarray, lookback: int = 100, mean_rev_th: float = 0.4, trend_th: float = 0.6) -> np.ndarray:
    """
    Hurst 지수 기반 레짐 전환

    H > trend_th: 추세 추종
    H < mean_rev_th: 평균회귀
    """
    close = data[:, 4]
    signals = np.zeros(len(close), dtype=int)

    for i in range(lookback, len(close)):
        window = close[i - lookback:i + 1]
        h = hurst_exponent(window, max_lag=50)

        if h > trend_th:
            # 추세 시장: 상승 모멘텀
            if close[i] > close[i - 5]:
                signals[i] = 1
        elif h < mean_rev_th:
            # 평균회귀 시장: 극값에서 신호
            rsi_val = rsi(window, 14)
            if rsi_val[-1] < 30:
                signals[i] = 1
            elif rsi_val[-1] > 70:
                signals[i] = -1

    return signals


def efficiency_ratio_strategy(data: np.ndarray, period: int = 10, surge: float = 0.6, collapse: float = 0.2) -> np.ndarray:
    """
    효율성 비율 (Kaufman)

    높은 효율성 (추세): 계속 추종
    낮은 효율성 (노이즈): 평균회귀
    """
    close = data[:, 4]
    er = efficiency_ratio(close, period)

    signals = np.zeros(len(close), dtype=int)

    for i in range(period, len(close)):
        if np.isnan(er[i]):
            continue

        if er[i] > surge:
            # 추세 시장
            if close[i] > close[i - 1]:
                signals[i] = 1
            else:
                signals[i] = -1
        elif er[i] < collapse:
            # 노이즈 시장: 반대 추종
            if close[i] > close[i - 5]:
                signals[i] = -1
            else:
                signals[i] = 1

    return signals


def vol_cluster(data: np.ndarray, atr_period: int = 14, long_ma: int = 50, explosion_ratio: float = 1.8) -> np.ndarray:
    """
    변동성 클러스터링

    ATR 급증 + 추세: 신호
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]

    atr_val = atr(high, low, close, atr_period)
    atr_sma = sma(atr_val, 20)
    long_sma = sma(close, long_ma)

    signals = np.zeros(len(close), dtype=int)

    for i in range(max(atr_period + 20, long_ma), len(close)):
        if np.isnan(atr_val[i]) or np.isnan(atr_sma[i]):
            continue

        # ATR 폭발
        if atr_val[i] > atr_sma[i] * explosion_ratio:
            # 상승 추세
            if close[i] > long_sma[i]:
                signals[i] = 1
            # 하락 추세
            else:
                signals[i] = -1

    return signals


def momentum_decay(data: np.ndarray, fast_mom: int = 10, slow_mom: int = 30, decay_th: float = 0.5) -> np.ndarray:
    """
    모멘텀 감쇠

    모멘텀 교차 + 강도 확인
    """
    close = data[:, 4]

    mom_fast = close - np.roll(close, fast_mom)
    mom_slow = close - np.roll(close, slow_mom)
    rsi_val = rsi(close, 14)

    signals = np.zeros(len(close), dtype=int)

    for i in range(slow_mom, len(close)):
        if np.isnan(mom_fast[i]) or np.isnan(mom_slow[i]):
            continue

        # 모멘텀 상승
        if mom_fast[i] > mom_slow[i] and mom_fast[i - 1] <= mom_slow[i - 1]:
            if rsi_val[i] < 60:  # 추가 확인
                signals[i] = 1

        # 모멘텀 하강
        elif mom_fast[i] < mom_slow[i] and mom_fast[i - 1] >= mom_slow[i - 1]:
            if rsi_val[i] > 40:
                signals[i] = -1

    return signals


def smart_money(data: np.ndarray, flat_range: float = 1.5, vol_mult: float = 2.0, obv_ema: int = 20) -> np.ndarray:
    """
    Smart Money (수급 + 거래량 + 변동성)

    가격 범위 축소 후 폭발 + OBV 확인
    """
    high = data[:, 1]
    low = data[:, 2]
    close = data[:, 4]
    volume = data[:, 5]

    # 변동성
    atr_val = atr(high, low, close, 14)
    atr_sma = sma(atr_val, 20)

    # 거래량
    obv_val = obv(close, volume)
    obv_ema_val = ema(obv_val, obv_ema)

    # 범위
    range_val = high - low
    range_sma = sma(range_val, 20)

    signals = np.zeros(len(close), dtype=int)

    for i in range(20, len(close)):
        if np.isnan(atr_val[i]) or np.isnan(range_sma[i]):
            continue

        # 축소 후 폭발
        if range_val[i] < range_sma[i] / flat_range and i > 0:
            # 다음 바 폭발성 움직임
            if atr_val[i + 1] > atr_sma[i] * vol_mult if i + 1 < len(atr_val) else False:
                # OBV 상승
                if obv_val[i] > obv_ema_val[i]:
                    signals[i + 1 if i + 1 < len(signals) else i] = 1

    return signals


# ═══════════════════════════════════════════════════════════════
# 전략 레지스트리
# ═══════════════════════════════════════════════════════════════

STRATEGY_REGISTRY: Dict[str, Tuple[Callable, Dict[str, Any], str]] = {
    "rsi_reversal": (rsi_reversal, {"period": [7, 10, 14, 21], "buy_th": [20, 25, 30, 35], "sell_th": [65, 70, 75, 80]}, "mean_revert"),
    "macd_cross": (macd_cross, {"fast": [8, 12], "slow": [21, 26], "sig": [5, 9]}, "momentum"),
    "bollinger_bounce": (bollinger_bounce, {"period": [15, 20, 30], "mult": [1.5, 2.0, 2.5]}, "mean_revert"),
    "triple_ma": (triple_ma, {"fast": [5, 8, 10], "mid": [20, 21, 34], "slow": [50, 55, 89]}, "trend"),
    "supertrend_strategy": (supertrend_strategy, {"period": [7, 10, 14], "mult": [2.0, 2.5, 3.0, 3.5]}, "trend"),
    "keltner_channel": (keltner_channel, {"ema_period": [10, 20], "atr_period": [10, 14], "mult": [1.5, 2.0, 2.5]}, "volatility"),
    "stochastic_rsi_strategy": (stochastic_rsi_strategy, {"rsi_period": [10, 14, 21], "stoch_period": [10, 14], "k": [3], "d": [3]}, "momentum"),
    "volume_breakout": (volume_breakout, {"vol_mult": [1.5, 2.0, 2.5], "trend_period": [20, 50]}, "breakout"),
    "dual_momentum": (dual_momentum, {"lookback": [40, 60, 90], "hold_bars": [15, 20, 30]}, "momentum"),
    "mean_reversion": (mean_reversion, {"period": [10, 20, 30], "z_threshold": [1.5, 2.0, 2.5]}, "mean_revert"),
    "ichimoku_strategy": (ichimoku_strategy, {"tenkan": [7, 9], "kijun": [22, 26], "senkou": [44, 52]}, "trend"),
    "obv_trend": (obv_trend, {"ema_period": [10, 20, 30]}, "momentum"),
    "parabolic_sar_strategy": (parabolic_sar_strategy, {"af_start": [0.01, 0.02, 0.03], "af_max": [0.15, 0.2, 0.3]}, "trend"),
    "connors_rsi_strategy": (connors_rsi_strategy, {"rsi_period": [2, 3], "buy_th": [5, 10, 15], "sell_th": [85, 90, 95]}, "mean_revert"),
    "btc_alpha": (btc_alpha, {"rsi_period": [10, 14], "bb_period": [20], "bb_mult": [2.0, 2.5, 3.0], "ema_fast": [9, 13, 21], "ema_slow": [21, 34, 55]}, "advanced"),
    "hurst_regime": (hurst_regime, {"lookback": [60, 100, 150], "mean_rev_th": [0.4, 0.45], "trend_th": [0.55, 0.6]}, "advanced"),
    "efficiency_ratio_strategy": (efficiency_ratio_strategy, {"period": [8, 10, 15], "surge": [0.55, 0.6, 0.65], "collapse": [0.15, 0.2, 0.25]}, "advanced"),
    "vol_cluster": (vol_cluster, {"atr_period": [10, 14], "long_ma": [40, 50, 60], "explosion_ratio": [1.5, 1.8, 2.0]}, "volatility"),
    "momentum_decay": (momentum_decay, {"fast_mom": [8, 10, 15], "slow_mom": [20, 30], "decay_th": [0.4, 0.5, 0.6]}, "momentum"),
    "smart_money": (smart_money, {"flat_range": [1.0, 1.5, 2.0], "vol_mult": [1.8, 2.0, 2.5], "obv_ema": [15, 20, 25]}, "advanced"),
}


# ═══════════════════════════════════════════════════════════════
# 공개 API
# ═══════════════════════════════════════════════════════════════


def get_all_strategies() -> list:
    """모든 전략명 조회"""
    return list(STRATEGY_REGISTRY.keys())


def get_strategy(name: str) -> Optional[Tuple[Callable, Dict, str]]:
    """전략 조회"""
    return STRATEGY_REGISTRY.get(name)


def get_strategy_param_grid(name: str) -> Optional[Dict[str, list]]:
    """전략의 파라미터 그리드 조회"""
    strategy = get_strategy(name)
    return strategy[1] if strategy else None


def get_strategy_family(name: str) -> Optional[str]:
    """전략의 가족 분류 조회"""
    strategy = get_strategy(name)
    return strategy[2] if strategy else None


if __name__ == "__main__":
    # 테스트
    import logging

    logging.basicConfig(level=logging.INFO)

    # 샘플 데이터
    np.random.seed(42)
    close = np.cumsum(np.random.randn(200) * 2) + 100
    high = close + np.abs(np.random.randn(200))
    low = close - np.abs(np.random.randn(200))
    volume = np.random.randint(1000, 5000, 200)

    data = np.column_stack([
        close,  # open (단순화)
        high,
        low,
        close,
        volume,
    ])

    # 각 전략 테스트
    for strat_name in list(STRATEGY_REGISTRY.keys())[:3]:
        print(f"\n▶ {strat_name}")
        fn, param_grid, family = STRATEGY_REGISTRY[strat_name]
        signals = fn(data)
        buy_count = np.sum(signals == 1)
        sell_count = np.sum(signals == -1)
        print(f"  신호: {buy_count} 매수 / {sell_count} 매도")

    print("\n✓ 모든 테스트 완료")
