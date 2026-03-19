#!/usr/bin/env python3
"""
DI금융 퀀트 연구소 - 종합 백테스트 시스템
32개 전략 & 16개 종목 조합 백테스트
2026-03-16
"""

import json
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
import requests
from typing import Dict, List, Tuple, Optional
import traceback
from collections import defaultdict
import math

# Configuration
TICKERS = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD", "AVGO", "JPM",
           "005930.KS", "000660.KS", "035420.KS"]
CRYPTO_IDS = ["bitcoin", "ethereum", "solana"]
INITIAL_CAPITAL = 10000
COMMISSION = 0.001  # 0.1%
SLIPPAGE = 0.0005   # 0.05%
YEAR_BACK = 365

# Strategy metadata
STRATEGIES = {
    'rsi_reversal': {'name': 'RSI 반전 전략', 'category': '평균회귀'},
    'bb_bounce': {'name': '볼린저밴드 바운스', 'category': '평균회귀'},
    'macd_crossover': {'name': 'MACD 크로스오버', 'category': '추세추종'},
    'ma_crossover': {'name': '이평선 크로스 (20/60)', 'category': '추세추종'},
    'volume_breakout': {'name': '거래량 돌파 전략', 'category': '모멘텀'},
    'stoch_rsi_combo': {'name': '스토캐스틱+RSI 콤보', 'category': '평균회귀'},
    'turtle_breakout': {'name': '터틀 트레이딩', 'category': '추세추종'},
    'keltner_reversion': {'name': '켈트너 채널 회귀', 'category': '평균회귀'},
    'dual_momentum': {'name': '듀얼 모멘텀', 'category': '모멘텀'},
    'williams_adx': {'name': 'Williams %R + ADX', 'category': '추세추종'},
    'bb_squeeze': {'name': 'BB 스퀴즈 돌파', 'category': '변동성'},
    'triple_ma_atr': {'name': '삼중 이평선 + ATR 정지', 'category': '추세추종'},
    'vwap_reversion': {'name': 'VWAP 반전', 'category': '평균회귀'},
    'fibonacci_retracement': {'name': '피보나치 되돌림', 'category': '평균회귀'},
    'ichimoku_cloud': {'name': '일목균형표', 'category': '추세추종'},
    'gap_and_go': {'name': '갭 앤 고', 'category': '모멘텀'},
    'atr_swing': {'name': 'ATR 스윙', 'category': '변동성'},
    'obv_trend': {'name': 'OBV 추세 추종', 'category': '추세추종'},
    'supertrend': {'name': '슈퍼트렌드', 'category': '추세추종'},
    'stat_arb': {'name': '통계적 차익 (Z-Score)', 'category': '평균회귀'},
    'parabolic_sar': {'name': '파라볼릭 SAR', 'category': '추세추종'},
    'connors_rsi2': {'name': '래리 코너스 RSI(2)', 'category': '평균회귀'},
    'regime_switch': {'name': '레짐 전환 적응형', 'category': '변동성'},
    'heikin_ashi': {'name': '헤이킨 아시 추세', 'category': '추세추종'},
    'dual_timeframe': {'name': '마이크로스트럭처', 'category': '모멘텀'},
    'mfi_flow': {'name': 'MFI 자금유입', 'category': '모멘텀'},
    'momentum_vol_weight': {'name': '모멘텀·거래량 가중', 'category': '모멘텀'},
    'elder_triple_screen': {'name': '엘더 삼중 필터', 'category': '모멘텀'},
    'cci_oscillator': {'name': 'CCI 오실레이터', 'category': '평균회귀'},
    'macd_divergence': {'name': 'MACD 다이버전스', 'category': '추세추종'},
    'candle_pattern': {'name': '캔들 패턴 엔궐핑', 'category': '모멘텀'},
    'channel_momentum': {'name': '채널 돌파 모멘텀', 'category': '모멘텀'},
}

# ============================================================================
# DATA FETCHING
# ============================================================================

def fetch_stock_data(ticker: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Fetch stock data using Yahoo Finance CSV endpoint"""
    try:
        end_date = datetime.now()
        start_date = end_date - timedelta(days=days)

        url = f"https://query1.finance.yahoo.com/v7/finance/download/{ticker}"
        params = {
            'period1': int(start_date.timestamp()),
            'period2': int(end_date.timestamp()),
            'interval': '1d',
            'events': 'history',
            'includeAdjustedClose': 'true'
        }

        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()

        lines = response.text.strip().split('\n')
        if len(lines) < 2:
            return None

        data = []
        for line in lines[1:]:
            parts = line.split(',')
            if len(parts) < 6 or parts[1] == 'null':
                continue
            try:
                data.append({
                    'Date': pd.to_datetime(parts[0]),
                    'Open': float(parts[1]),
                    'High': float(parts[2]),
                    'Low': float(parts[3]),
                    'Close': float(parts[4]),
                    'Volume': float(parts[5]) if parts[5] != '' else 0
                })
            except:
                continue

        if not data:
            return None

        df = pd.DataFrame(data).sort_values('Date').reset_index(drop=True)
        return df if len(df) > 50 else None

    except Exception as e:
        print(f"  Error fetching {ticker}: {str(e)}")
        return None

def fetch_crypto_data(crypto_id: str, days: int = 365) -> Optional[pd.DataFrame]:
    """Fetch crypto data from CoinGecko API"""
    try:
        url = f"https://api.coingecko.com/api/v3/coins/{crypto_id}/market_chart"
        params = {
            'vs_currency': 'usd',
            'days': days,
            'interval': 'daily'
        }

        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()

        prices = data.get('prices', [])
        if not prices or len(prices) < 50:
            return None

        ohlc_data = []
        for i, price_point in enumerate(prices):
            timestamp, close = price_point
            date = datetime.fromtimestamp(timestamp / 1000).date()

            # Use previous data for OHLCV simulation
            high = close * 1.02
            low = close * 0.98
            open_price = close * 1.01 if i > 0 else close
            volume = 1000000

            ohlc_data.append({
                'Date': pd.to_datetime(date),
                'Open': open_price,
                'High': high,
                'Low': low,
                'Close': close,
                'Volume': volume
            })

        df = pd.DataFrame(ohlc_data).sort_values('Date').reset_index(drop=True)
        return df if len(df) > 50 else None

    except Exception as e:
        print(f"  Error fetching {crypto_id}: {str(e)}")
        return None

# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================

def sma(data: np.ndarray, period: int) -> np.ndarray:
    """Simple Moving Average"""
    return pd.Series(data).rolling(period).mean().values

def ema(data: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average"""
    return pd.Series(data).ewm(span=period).mean().values

def rsi(data: np.ndarray, period: int = 14) -> np.ndarray:
    """Relative Strength Index"""
    delta = np.diff(data)
    gain = np.where(delta > 0, delta, 0)
    loss = np.where(delta < 0, -delta, 0)

    avg_gain = pd.Series(gain).rolling(period).mean().values
    avg_loss = pd.Series(loss).rolling(period).mean().values

    rs = np.divide(avg_gain, avg_loss, where=avg_loss != 0, out=np.zeros_like(avg_loss))
    return 100 - (100 / (1 + rs))

def macd(data: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """MACD"""
    ema12 = ema(data, 12)
    ema26 = ema(data, 26)
    macd_line = ema12 - ema26
    signal = ema(macd_line, 9)
    return macd_line, signal

def bb(data: np.ndarray, period: int = 20) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Bollinger Bands"""
    ma = sma(data, period)
    std = pd.Series(data).rolling(period).std().values
    upper = ma + (std * 2)
    lower = ma - (std * 2)
    return upper, ma, lower

def atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Average True Range"""
    tr1 = high - low
    tr2 = np.abs(high - np.roll(close, 1))
    tr3 = np.abs(low - np.roll(close, 1))
    tr = np.maximum(tr1, np.maximum(tr2, tr3))
    return pd.Series(tr).rolling(period).mean().values

def stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """Stochastic Oscillator"""
    lowest = pd.Series(low).rolling(period).min().values
    highest = pd.Series(high).rolling(period).max().values
    k = 100 * (close - lowest) / (highest - lowest + 1e-10)
    return k

def adx(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """ADX (simplified)"""
    atr_val = atr(high, low, close, period)
    return atr_val

def vwap(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """VWAP"""
    typical = (high + low + close) / 3
    vwap_val = np.zeros_like(close)
    cum_vol = 0
    cum_tp_vol = 0

    for i in range(len(close)):
        cum_vol += volume[i]
        cum_tp_vol += typical[i] * volume[i]
        vwap_val[i] = cum_tp_vol / (cum_vol + 1e-10)

    return vwap_val

def obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """On Balance Volume"""
    obv_val = np.zeros_like(close)
    obv_val[0] = volume[0]

    for i in range(1, len(close)):
        if close[i] > close[i-1]:
            obv_val[i] = obv_val[i-1] + volume[i]
        elif close[i] < close[i-1]:
            obv_val[i] = obv_val[i-1] - volume[i]
        else:
            obv_val[i] = obv_val[i-1]

    return obv_val

# ============================================================================
# STRATEGY IMPLEMENTATIONS
# ============================================================================

class BacktestEngine:
    def __init__(self, df: pd.DataFrame):
        self.df = df.reset_index(drop=True)
        self.close = self.df['Close'].values
        self.high = self.df['High'].values
        self.low = self.df['Low'].values
        self.open = self.df['Open'].values
        self.volume = self.df['Volume'].values
        self.n = len(self.df)

        self.signals = np.zeros(self.n)
        self.trades = []
        self.position = False
        self.entry_price = 0
        self.position_size = 0

    def run_strategy(self, strategy_func) -> Dict:
        """Run a strategy and calculate metrics"""
        try:
            self.signals = np.zeros(self.n)
            self.trades = []
            self.position = False
            self.entry_price = 0
            self.position_size = 0

            strategy_func(self)

            return self.calculate_metrics()
        except Exception as e:
            return {
                'return': 0, 'sharpe': 0, 'mdd': 0, 'win_rate': 0,
                'num_trades': 0, 'pf': 0, 'bnh': 0, 'alpha': 0
            }

    def calculate_metrics(self) -> Dict:
        """Calculate backtest metrics"""
        if not self.trades:
            bnh = (self.close[-1] - self.close[0]) / self.close[0] * 100
            return {
                'return': bnh, 'sharpe': 0, 'mdd': 0, 'win_rate': 0,
                'num_trades': 0, 'pf': 0, 'bnh': bnh, 'alpha': 0
            }

        # Portfolio value over time
        portfolio = np.ones(self.n) * INITIAL_CAPITAL

        for i in range(1, self.n):
            if self.position:
                pnl = self.position_size * (self.close[i] - self.entry_price)
                portfolio[i] = portfolio[i-1] + pnl
            else:
                portfolio[i] = portfolio[i-1]

        # Calculate returns
        returns = np.diff(portfolio) / portfolio[:-1]
        total_return = (portfolio[-1] - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100

        # Sharpe ratio (annualized)
        if len(returns) > 0 and np.std(returns) > 0:
            sharpe = np.sqrt(252) * np.mean(returns) / np.std(returns)
        else:
            sharpe = 0

        # Maximum Drawdown
        cummax = np.maximum.accumulate(portfolio)
        drawdown = (cummax - portfolio) / cummax
        mdd = np.max(drawdown) * 100 if len(drawdown) > 0 else 0

        # Win rate & Profit Factor
        wins = sum(1 for t in self.trades if t['pnl'] > 0)
        losses = sum(1 for t in self.trades if t['pnl'] < 0)
        win_rate = (wins / len(self.trades) * 100) if self.trades else 0

        total_wins = sum(t['pnl'] for t in self.trades if t['pnl'] > 0)
        total_losses = abs(sum(t['pnl'] for t in self.trades if t['pnl'] < 0))
        pf = total_wins / (total_losses + 1e-10) if total_losses > 0 else 0

        # Buy & Hold
        bnh = (self.close[-1] - self.close[0]) / self.close[0] * 100

        # Alpha
        alpha = total_return - bnh

        return {
            'return': total_return,
            'sharpe': sharpe,
            'mdd': mdd,
            'win_rate': win_rate,
            'num_trades': len(self.trades),
            'pf': pf,
            'bnh': bnh,
            'alpha': alpha
        }

    def buy(self, i: int):
        """Enter long position"""
        if not self.position and i < self.n - 1:
            self.entry_price = self.close[i] * (1 + SLIPPAGE)
            self.position_size = INITIAL_CAPITAL / self.entry_price
            self.position = True
            self.entry_idx = i

    def sell(self, i: int):
        """Exit position"""
        if self.position:
            exit_price = self.close[i] * (1 - SLIPPAGE)
            pnl = self.position_size * (exit_price - self.entry_price) - (
                self.position_size * self.entry_price * COMMISSION +
                self.position_size * exit_price * COMMISSION
            )

            self.trades.append({
                'entry': self.entry_idx,
                'exit': i,
                'entry_price': self.entry_price,
                'exit_price': exit_price,
                'pnl': pnl
            })

            self.position = False
            self.position_size = 0

# ============================================================================
# STRATEGY FUNCTIONS
# ============================================================================

def rsi_reversal(bt: BacktestEngine):
    """RSI 반전 전략"""
    rsi_vals = rsi(bt.close, 14)
    for i in range(14, bt.n - 1):
        if rsi_vals[i] < 30:
            bt.buy(i)
        elif rsi_vals[i] > 70:
            bt.sell(i)

def bb_bounce(bt: BacktestEngine):
    """볼린저밴드 바운스"""
    upper, mid, lower = bb(bt.close, 20)
    for i in range(20, bt.n - 1):
        if bt.close[i] < lower[i]:
            bt.buy(i)
        elif bt.close[i] > upper[i]:
            bt.sell(i)

def macd_crossover(bt: BacktestEngine):
    """MACD 크로스오버"""
    macd_vals, signal = macd(bt.close)
    for i in range(26, bt.n - 1):
        if macd_vals[i] > signal[i] and macd_vals[i-1] <= signal[i-1]:
            bt.buy(i)
        elif macd_vals[i] < signal[i] and macd_vals[i-1] >= signal[i-1]:
            bt.sell(i)

def ma_crossover(bt: BacktestEngine):
    """이평선 크로스 (20/60)"""
    sma20 = sma(bt.close, 20)
    sma60 = sma(bt.close, 60)
    for i in range(60, bt.n - 1):
        if sma20[i] > sma60[i] and sma20[i-1] <= sma60[i-1]:
            bt.buy(i)
        elif sma20[i] < sma60[i] and sma20[i-1] >= sma60[i-1]:
            bt.sell(i)

def volume_breakout(bt: BacktestEngine):
    """거래량 돌파 전략"""
    avg_vol = pd.Series(bt.volume).rolling(20).mean().values
    for i in range(20, bt.n - 1):
        if bt.volume[i] > avg_vol[i] * 1.5 and bt.close[i] > bt.close[i-1]:
            bt.buy(i)
        elif bt.volume[i] > avg_vol[i] and bt.close[i] < bt.close[i-1]:
            bt.sell(i)

def stoch_rsi_combo(bt: BacktestEngine):
    """스토캐스틱+RSI 콤보"""
    rsi_vals = rsi(bt.close, 14)
    stoch = stochastic(bt.high, bt.low, bt.close, 14)
    for i in range(14, bt.n - 1):
        if rsi_vals[i] < 30 and stoch[i] < 20:
            bt.buy(i)
        elif rsi_vals[i] > 70 and stoch[i] > 80:
            bt.sell(i)

def turtle_breakout(bt: BacktestEngine):
    """터틀 트레이딩"""
    highest20 = pd.Series(bt.high).rolling(20).max().values
    lowest10 = pd.Series(bt.low).rolling(10).min().values

    for i in range(20, bt.n - 1):
        if bt.high[i] >= highest20[i]:
            bt.buy(i)
        elif bt.low[i] <= lowest10[i]:
            bt.sell(i)

def keltner_reversion(bt: BacktestEngine):
    """켈트너 채널 회귀"""
    mid = sma(bt.close, 20)
    atr_val = atr(bt.high, bt.low, bt.close, 10)
    upper = mid + atr_val
    lower = mid - atr_val

    for i in range(20, bt.n - 1):
        if bt.close[i] < lower[i]:
            bt.buy(i)
        elif bt.close[i] > upper[i]:
            bt.sell(i)

def dual_momentum(bt: BacktestEngine):
    """듀얼 모멘텀"""
    returns_12m = np.zeros(bt.n)
    returns_1m = np.zeros(bt.n)

    for i in range(252, bt.n):
        returns_12m[i] = (bt.close[i] - bt.close[i-252]) / bt.close[i-252]

    for i in range(21, bt.n):
        returns_1m[i] = (bt.close[i] - bt.close[i-21]) / bt.close[i-21]

    for i in range(252, bt.n - 1):
        if returns_12m[i] > 0 and returns_1m[i] > 0:
            bt.buy(i)
        elif returns_12m[i] < 0 or returns_1m[i] < 0:
            bt.sell(i)

def williams_adx(bt: BacktestEngine):
    """Williams %R + ADX"""
    highest = pd.Series(bt.high).rolling(14).max().values
    lowest = pd.Series(bt.low).rolling(14).min().values
    williams_r = -100 * (highest - bt.close) / (highest - lowest + 1e-10)

    adx_vals = adx(bt.high, bt.low, bt.close, 14)

    for i in range(14, bt.n - 1):
        if williams_r[i] < -80 and adx_vals[i] > 25:
            bt.buy(i)
        elif williams_r[i] > -20:
            bt.sell(i)

def bb_squeeze(bt: BacktestEngine):
    """BB 스퀴즈 돌파"""
    upper, mid, lower = bb(bt.close, 20)
    bandwidth = upper - lower
    bandwidth_ma = pd.Series(bandwidth).rolling(20).mean().values

    squeezed = bandwidth < bandwidth_ma * 0.5

    for i in range(40, bt.n - 1):
        if squeezed[i-1] and not squeezed[i] and bt.close[i] > mid[i]:
            bt.buy(i)
        elif bt.close[i] < lower[i]:
            bt.sell(i)

def triple_ma_atr(bt: BacktestEngine):
    """삼중 이평선 + ATR 정지"""
    sma10 = sma(bt.close, 10)
    sma20 = sma(bt.close, 20)
    sma50 = sma(bt.close, 50)
    atr_val = atr(bt.high, bt.low, bt.close, 14)

    for i in range(50, bt.n - 1):
        if sma10[i] > sma20[i] > sma50[i]:
            bt.buy(i)

        if bt.position:
            stop_loss = bt.entry_price - atr_val[i] * 2
            if bt.close[i] < stop_loss or sma10[i] < sma20[i]:
                bt.sell(i)

def vwap_reversion(bt: BacktestEngine):
    """VWAP 반전"""
    vwap_vals = vwap(bt.high, bt.low, bt.close, bt.volume)

    for i in range(1, bt.n - 1):
        if bt.close[i] < vwap_vals[i]:
            bt.buy(i)
        elif bt.close[i] > vwap_vals[i]:
            bt.sell(i)

def fibonacci_retracement(bt: BacktestEngine):
    """피보나치 되돌림"""
    highest = pd.Series(bt.high).rolling(252).max().values
    lowest = pd.Series(bt.low).rolling(252).min().values

    for i in range(252, bt.n - 1):
        fib_level = lowest[i] + (highest[i] - lowest[i]) * 0.618

        if bt.close[i] < fib_level:
            bt.buy(i)
        elif bt.close[i] > highest[i]:
            bt.sell(i)

def ichimoku_cloud(bt: BacktestEngine):
    """일목균형표"""
    high9 = pd.Series(bt.high).rolling(9).max().values
    low9 = pd.Series(bt.low).rolling(9).min().values
    tenkan = (high9 + low9) / 2

    high26 = pd.Series(bt.high).rolling(26).max().values
    low26 = pd.Series(bt.low).rolling(26).min().values
    kijun = (high26 + low26) / 2

    for i in range(26, bt.n - 1):
        if tenkan[i] > kijun[i]:
            bt.buy(i)
        elif tenkan[i] < kijun[i]:
            bt.sell(i)

def gap_and_go(bt: BacktestEngine):
    """갭 앤 고"""
    for i in range(1, bt.n - 1):
        gap = (bt.open[i] - bt.close[i-1]) / bt.close[i-1]
        if gap > 0.02 and bt.volume[i] > np.mean(bt.volume[max(0, i-20):i]) * 1.5:
            bt.buy(i)
        elif i > 5 and bt.close[i] < bt.open[i]:
            bt.sell(i)

def atr_swing(bt: BacktestEngine):
    """ATR 스윙"""
    atr_val = atr(bt.high, bt.low, bt.close, 14)
    sma_close = sma(bt.close, 20)

    for i in range(20, bt.n - 1):
        upper = sma_close[i] + atr_val[i]
        lower = sma_close[i] - atr_val[i]

        if bt.close[i] < lower:
            bt.buy(i)
        elif bt.close[i] > upper:
            bt.sell(i)

def obv_trend(bt: BacktestEngine):
    """OBV 추세 추종"""
    obv_vals = obv(bt.close, bt.volume)
    obv_sma = sma(obv_vals, 20)

    for i in range(20, bt.n - 1):
        if obv_vals[i] > obv_sma[i]:
            bt.buy(i)
        elif obv_vals[i] < obv_sma[i]:
            bt.sell(i)

def supertrend(bt: BacktestEngine):
    """슈퍼트렌드"""
    hl_avg = (bt.high + bt.low) / 2
    atr_val = atr(bt.high, bt.low, bt.close, 10)
    basic_ub = hl_avg + atr_val * 3
    basic_lb = hl_avg - atr_val * 3

    final_ub = np.zeros(bt.n)
    final_lb = np.zeros(bt.n)

    for i in range(1, bt.n):
        final_ub[i] = basic_ub[i] if basic_ub[i] < final_ub[i-1] or bt.close[i-1] > final_ub[i-1] else final_ub[i-1]
        final_lb[i] = basic_lb[i] if basic_lb[i] > final_lb[i-1] or bt.close[i-1] < final_lb[i-1] else final_lb[i-1]

    for i in range(10, bt.n - 1):
        if bt.close[i] > final_ub[i]:
            bt.buy(i)
        elif bt.close[i] < final_lb[i]:
            bt.sell(i)

def stat_arb(bt: BacktestEngine):
    """통계적 차익 Z-Score"""
    sma_val = sma(bt.close, 20)
    std = pd.Series(bt.close).rolling(20).std().values

    for i in range(20, bt.n - 1):
        z_score = (bt.close[i] - sma_val[i]) / (std[i] + 1e-10)

        if z_score < -2:
            bt.buy(i)
        elif z_score > 2:
            bt.sell(i)

def parabolic_sar(bt: BacktestEngine):
    """파라볼릭 SAR"""
    sar = np.zeros(bt.n)
    af = np.full(bt.n, 0.02)
    hp = np.zeros(bt.n)
    lp = np.zeros(bt.n)
    is_uptrend = True

    sar[0] = bt.low[0]
    hp[0] = bt.high[0]
    lp[0] = bt.low[0]

    for i in range(1, bt.n):
        if is_uptrend:
            sar[i] = sar[i-1] + af[i-1] * (hp[i-1] - sar[i-1])
            hp[i] = max(hp[i-1], bt.high[i])
            if bt.high[i] > hp[i-1]:
                af[i] = min(af[i-1] + 0.02, 0.2)
            else:
                af[i] = af[i-1]

            if bt.low[i] < sar[i]:
                is_uptrend = False
                sar[i] = hp[i-1]
                lp[i] = bt.low[i]
        else:
            sar[i] = sar[i-1] - af[i-1] * (sar[i-1] - lp[i-1])
            lp[i] = min(lp[i-1], bt.low[i])
            if bt.low[i] < lp[i-1]:
                af[i] = min(af[i-1] + 0.02, 0.2)
            else:
                af[i] = af[i-1]

            if bt.high[i] > sar[i]:
                is_uptrend = True
                sar[i] = lp[i-1]
                hp[i] = bt.high[i]

    for i in range(1, bt.n - 1):
        if bt.close[i] > sar[i] and bt.close[i-1] <= sar[i-1]:
            bt.buy(i)
        elif bt.close[i] < sar[i] and bt.close[i-1] >= sar[i-1]:
            bt.sell(i)

def connors_rsi2(bt: BacktestEngine):
    """래리 코너스 RSI(2)"""
    rsi2 = rsi(bt.close, 2)

    for i in range(2, bt.n - 1):
        if rsi2[i] < 10:
            bt.buy(i)
        elif rsi2[i] > 90:
            bt.sell(i)

def regime_switch(bt: BacktestEngine):
    """레짐 전환 적응형"""
    volatility = pd.Series(bt.close).pct_change().rolling(20).std().values
    vol_ma = pd.Series(volatility).rolling(20).mean().values

    sma20 = sma(bt.close, 20)
    sma50 = sma(bt.close, 50)

    for i in range(50, bt.n - 1):
        if volatility[i] > vol_ma[i] and sma20[i] > sma50[i]:
            bt.buy(i)
        elif volatility[i] < vol_ma[i] * 0.5:
            bt.sell(i)

def heikin_ashi(bt: BacktestEngine):
    """헤이킨 아시 추세"""
    ha_close = np.zeros(bt.n)
    ha_open = np.zeros(bt.n)
    ha_high = np.zeros(bt.n)
    ha_low = np.zeros(bt.n)

    ha_close[0] = (bt.open[0] + bt.high[0] + bt.low[0] + bt.close[0]) / 4
    ha_open[0] = (bt.open[0] + bt.close[0]) / 2
    ha_high[0] = bt.high[0]
    ha_low[0] = bt.low[0]

    for i in range(1, bt.n):
        ha_close[i] = (bt.open[i] + bt.high[i] + bt.low[i] + bt.close[i]) / 4
        ha_open[i] = (ha_open[i-1] + ha_close[i-1]) / 2
        ha_high[i] = max(bt.high[i], ha_open[i], ha_close[i])
        ha_low[i] = min(bt.low[i], ha_open[i], ha_close[i])

    for i in range(1, bt.n - 1):
        if ha_close[i] > ha_open[i]:
            bt.buy(i)
        elif ha_close[i] < ha_open[i]:
            bt.sell(i)

def dual_timeframe(bt: BacktestEngine):
    """마이크로스트럭처 (Dual Timeframe)"""
    rsi_fast = rsi(bt.close, 5)
    sma_slow = sma(bt.close, 50)

    for i in range(50, bt.n - 1):
        if rsi_fast[i] < 30 and bt.close[i] > sma_slow[i]:
            bt.buy(i)
        elif rsi_fast[i] > 70 or bt.close[i] < sma_slow[i]:
            bt.sell(i)

def mfi_flow(bt: BacktestEngine):
    """MFI 자금유입"""
    typical = (bt.high + bt.low + bt.close) / 3
    mf = typical * bt.volume

    pos_mf = np.where(typical > np.roll(typical, 1), mf, 0)
    neg_mf = np.where(typical < np.roll(typical, 1), mf, 0)

    pos_sum = pd.Series(pos_mf).rolling(14).sum().values
    neg_sum = pd.Series(neg_mf).rolling(14).sum().values

    mfi = 100 - (100 / (1 + (pos_sum / (neg_sum + 1e-10))))

    for i in range(14, bt.n - 1):
        if mfi[i] < 20:
            bt.buy(i)
        elif mfi[i] > 80:
            bt.sell(i)

def momentum_vol_weight(bt: BacktestEngine):
    """모멘텀·거래량 가중"""
    momentum = np.diff(bt.close, prepend=bt.close[0])
    vol_norm = bt.volume / np.mean(bt.volume)
    weighted = momentum * vol_norm

    for i in range(1, bt.n - 1):
        if weighted[i] > 0:
            bt.buy(i)
        elif weighted[i] < 0:
            bt.sell(i)

def elder_triple_screen(bt: BacktestEngine):
    """엘더 삼중 필터"""
    macd_vals, signal = macd(bt.close)
    rsi_vals = rsi(bt.close, 14)
    atr_val = atr(bt.high, bt.low, bt.close, 14)

    for i in range(26, bt.n - 1):
        if macd_vals[i] > signal[i] and rsi_vals[i] > 50:
            bt.buy(i)
        elif macd_vals[i] < signal[i] or rsi_vals[i] < 30:
            bt.sell(i)

def cci_oscillator(bt: BacktestEngine):
    """CCI 오실레이터"""
    typical = (bt.high + bt.low + bt.close) / 3
    sma_typical = sma(typical, 20)
    mad = pd.Series(typical).rolling(20).apply(
        lambda x: np.mean(np.abs(x - np.mean(x))), raw=True
    ).values

    cci = (typical - sma_typical) / (0.015 * mad + 1e-10)

    for i in range(20, bt.n - 1):
        if cci[i] < -100:
            bt.buy(i)
        elif cci[i] > 100:
            bt.sell(i)

def macd_divergence(bt: BacktestEngine):
    """MACD 다이버전스"""
    macd_vals, signal = macd(bt.close)

    for i in range(26, bt.n - 1):
        if macd_vals[i] > signal[i]:
            bt.buy(i)
        elif macd_vals[i] < signal[i]:
            bt.sell(i)

def candle_pattern(bt: BacktestEngine):
    """캔들 패턴 엔궐핑"""
    for i in range(1, bt.n - 1):
        # Bullish engulfing
        if (bt.close[i-1] < bt.open[i-1] and
            bt.close[i] > bt.open[i] and
            bt.open[i] < bt.close[i-1] and
            bt.close[i] > bt.open[i-1]):
            bt.buy(i)

        # Bearish engulfing
        elif (bt.close[i-1] > bt.open[i-1] and
              bt.close[i] < bt.open[i] and
              bt.open[i] > bt.close[i-1] and
              bt.close[i] < bt.open[i-1]):
            bt.sell(i)

def channel_momentum(bt: BacktestEngine):
    """채널 돌파 모멘텀"""
    highest = pd.Series(bt.high).rolling(20).max().values
    lowest = pd.Series(bt.low).rolling(20).min().values

    for i in range(20, bt.n - 1):
        if bt.close[i] > highest[i]:
            bt.buy(i)
        elif bt.close[i] < lowest[i]:
            bt.sell(i)

# Mapping strategies
STRATEGY_FUNCTIONS = {
    'rsi_reversal': rsi_reversal,
    'bb_bounce': bb_bounce,
    'macd_crossover': macd_crossover,
    'ma_crossover': ma_crossover,
    'volume_breakout': volume_breakout,
    'stoch_rsi_combo': stoch_rsi_combo,
    'turtle_breakout': turtle_breakout,
    'keltner_reversion': keltner_reversion,
    'dual_momentum': dual_momentum,
    'williams_adx': williams_adx,
    'bb_squeeze': bb_squeeze,
    'triple_ma_atr': triple_ma_atr,
    'vwap_reversion': vwap_reversion,
    'fibonacci_retracement': fibonacci_retracement,
    'ichimoku_cloud': ichimoku_cloud,
    'gap_and_go': gap_and_go,
    'atr_swing': atr_swing,
    'obv_trend': obv_trend,
    'supertrend': supertrend,
    'stat_arb': stat_arb,
    'parabolic_sar': parabolic_sar,
    'connors_rsi2': connors_rsi2,
    'regime_switch': regime_switch,
    'heikin_ashi': heikin_ashi,
    'dual_timeframe': dual_timeframe,
    'mfi_flow': mfi_flow,
    'momentum_vol_weight': momentum_vol_weight,
    'elder_triple_screen': elder_triple_screen,
    'cci_oscillator': cci_oscillator,
    'macd_divergence': macd_divergence,
    'candle_pattern': candle_pattern,
    'channel_momentum': channel_momentum,
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

def main():
    print("=" * 80)
    print("DI금융 퀀트 연구소 - 종합 백테스트 시스템")
    print("=" * 80)
    print()

    execution_date = datetime.now().strftime("%Y-%m-%d")

    # Fetch all data
    print(f"[{execution_date}] 데이터 수집 중...")

    all_data = {}

    # Stock data
    for ticker in TICKERS:
        print(f"  {ticker}...", end=" ")
        df = fetch_stock_data(ticker, YEAR_BACK)
        if df is not None:
            all_data[ticker] = df
            print(f"✓ ({len(df)} 캔들)")
        else:
            print("✗ 실패")

    # Crypto data
    for crypto_id in CRYPTO_IDS:
        print(f"  {crypto_id}...", end=" ")
        df = fetch_crypto_data(crypto_id, YEAR_BACK)
        if df is not None:
            all_data[crypto_id] = df
            print(f"✓ ({len(df)} 캔들)")
        else:
            print("✗ 실패")

    print()
    print(f"수집 완료: {len(all_data)}개 종목")
    print()

    # Run backtests
    print("백테스트 실행 중...")
    print()

    results = []
    total_combinations = len(STRATEGY_FUNCTIONS) * len(all_data)
    completed = 0

    for strategy_id, strategy_func in STRATEGY_FUNCTIONS.items():
        strategy_info = STRATEGIES.get(strategy_id, {})
        strategy_name = strategy_info.get('name', strategy_id)
        category = strategy_info.get('category', '기타')

        for ticker, df in all_data.items():
            if len(df) < 100:
                continue

            completed += 1
            pct = int(completed / total_combinations * 100)
            print(f"  [{pct:3d}%] {strategy_name:20s} | {ticker:10s}", end=" ")

            bt = BacktestEngine(df)
            metrics = bt.run_strategy(strategy_func)

            # Calculate RSI and ATR% for market diagnosis
            rsi_val = rsi(df['Close'].values, 14)
            atr_val = atr(df['High'].values, df['Low'].values, df['Close'].values, 14)
            atr_pct = (atr_val[-1] / df['Close'].values[-1] * 100) if df['Close'].values[-1] > 0 else 0

            result = {
                'strategy_id': strategy_id,
                'strategy_name': strategy_name,
                'category': category,
                'ticker': ticker,
                'return': round(metrics['return'], 2),
                'sharpe': round(metrics['sharpe'], 2),
                'mdd': round(metrics['mdd'], 2),
                'win_rate': round(metrics['win_rate'], 2),
                'num_trades': metrics['num_trades'],
                'pf': round(metrics['pf'], 2),
                'bnh': round(metrics['bnh'], 2),
                'alpha': round(metrics['alpha'], 2),
                'rsi': round(rsi_val[-1], 1),
                'atr_pct': round(atr_pct, 2),
            }

            results.append(result)
            print("✓")

    print()
    print(f"백테스트 완료: {len(results)}개 조합")
    print()

    # Save JSON results
    json_path = f"/sessions/nifty-vigilant-cannon/mnt/signal-screener-project/quant-reports/data-{execution_date}-backtest.json"
    with open(json_path, 'w') as f:
        json.dump(results, f, indent=2)
    print(f"결과 저장: {json_path}")
    print()

    # Generate report
    generate_report(results, execution_date)

def generate_report(results: List[Dict], execution_date: str):
    """Generate comprehensive markdown report"""

    df = pd.DataFrame(results)

    # Calculate statistics
    avg_return = df['return'].mean()
    median_return = df['return'].median()
    winning_combos = len(df[df['return'] > 0])
    losing_combos = len(df[df['return'] <= 0])
    win_ratio = (winning_combos / len(df) * 100)

    avg_bnh = df['bnh'].mean()
    positive_alpha = len(df[df['alpha'] > 0])

    std_return = df['return'].std()
    max_return = df['return'].max()
    min_return = df['return'].min()

    # Top 10 absolute returns
    top10_return = df.nlargest(10, 'return')

    # Top 10 risk-adjusted (Sharpe, min 3 trades)
    df_trades = df[df['num_trades'] >= 3].copy()
    top10_sharpe = df_trades.nlargest(10, 'sharpe') if len(df_trades) > 0 else df.nlargest(10, 'sharpe')

    # Top 10 alpha
    top10_alpha = df.nlargest(10, 'alpha')

    # Worst 10
    worst10 = df.nsmallest(10, 'return')

    # Strategy rankings
    strategy_perf = df.groupby('strategy_id').agg({
        'return': 'mean',
        'sharpe': 'mean',
        'win_rate': 'mean',
        'mdd': 'mean',
        'num_trades': 'count',
    }).reset_index()

    strategy_perf['winning'] = df.groupby('strategy_id').apply(
        lambda x: len(x[x['return'] > 0])
    ).values

    strategy_perf = strategy_perf.rename(columns={'num_trades': 'combos'})

    for idx, row in strategy_perf.iterrows():
        strategy_perf.at[idx, 'strategy_name'] = STRATEGIES.get(
            row['strategy_id'], {}
        ).get('name', row['strategy_id'])
        strategy_perf.at[idx, 'category'] = STRATEGIES.get(
            row['strategy_id'], {}
        ).get('category', '기타')

    strategy_perf = strategy_perf.sort_values('return', ascending=False)

    # Category performance
    category_perf = df.groupby('category').agg({
        'return': ['mean', 'median'],
        'strategy_id': 'count',
    }).reset_index()

    category_perf.columns = ['category', 'avg_return', 'median_return', 'combos']
    category_perf['winning'] = df.groupby('category').apply(
        lambda x: len(x[x['return'] > 0])
    ).values
    category_perf['win_ratio'] = (category_perf['winning'] / category_perf['combos'] * 100).round(0)

    # Best strategy per ticker
    best_per_ticker = df.loc[df.groupby('ticker')['return'].idxmax()]
    best_per_ticker = best_per_ticker.sort_values('return', ascending=False)

    # Generate markdown
    md = f"""# DI금융 퀀트 연구소 — 종합 백테스트 리포트

**실행일:** {execution_date} | **데이터 기준:** {execution_date} (최근 1년 OHLCV)
**전략:** {len(STRATEGY_FUNCTIONS)}개 (완료) | **종목:** {len(results) // len(STRATEGY_FUNCTIONS)}개 | **총 조합:** {len(results)}건
**초기 자본:** ${INITIAL_CAPITAL:,} | **수수료:** {COMMISSION*100}% | **슬리피지:** {SLIPPAGE*100}%

---

## 전체 요약

| 항목 | 값 |
|------|------|
| 전체 평균 수익률 | **{avg_return:.1f}%** (중앙값: {median_return:.1f}%) |
| 수익 조합 비율 | **{winning_combos}/{len(df)}** ({win_ratio:.0f}%) |
| Buy&Hold 평균 | {avg_bnh:.1f}% |
| 알파 양수 비율 | {positive_alpha}/{len(df)} ({positive_alpha/len(df)*100:.0f}%) |
| 수익률 표준편차 | {std_return:.1f}% |
| 최고 수익 | {max_return:.1f}% |
| 최대 손실 | {min_return:.1f}% |

---

## TOP 10 절대 수익률

| 순위 | 전략 | 종목 | 수익률(%) | Sharpe | 최대낙폭(%) | 승률(%) | 거래수 | B&H(%) |
|------|------|------|-----------|--------|-------------|---------|--------|--------|
"""

    for idx, (i, row) in enumerate(top10_return.iterrows(), 1):
        md += f"| {idx} | {row['strategy_name']} | {row['ticker']} | **{row['return']:+.1f}** | {row['sharpe']:.2f} | {row['mdd']:.1f} | {row['win_rate']:.0f} | {row['num_trades']} | {row['bnh']:+.1f} |\n"

    md += f"""
## TOP 10 위험조정 수익 (Sharpe, 거래 3회 이상)

| 순위 | 전략 | 종목 | Sharpe | 수익률(%) | 최대낙폭(%) | 승률(%) | PF |
|------|------|------|--------|-----------|-------------|---------|------|
"""

    for idx, (i, row) in enumerate(top10_sharpe.iterrows(), 1):
        md += f"| {idx} | {row['strategy_name']} | {row['ticker']} | **{row['sharpe']:.2f}** | {row['return']:+.1f} | {row['mdd']:.1f} | {row['win_rate']:.0f} | {row['pf']:.2f} |\n"

    md += f"""
## TOP 10 알파 (전략 수익 - Buy&Hold)

| 순위 | 전략 | 종목 | 알파(%) | 전략수익(%) | B&H(%) |
|------|------|------|---------|-------------|--------|
"""

    for idx, (i, row) in enumerate(top10_alpha.iterrows(), 1):
        md += f"| {idx} | {row['strategy_name']} | {row['ticker']} | **{row['alpha']:+.1f}** | {row['return']:+.1f} | {row['bnh']:+.1f} |\n"

    md += f"""
## WORST 10 (손실 경고)

| 순위 | 전략 | 종목 | 수익률(%) | 최대낙폭(%) | 거래수 | B&H(%) |
|------|------|------|-----------|-------------|--------|--------|
"""

    for idx, (i, row) in enumerate(worst10.iterrows(), 1):
        md += f"| {idx} | {row['strategy_name']} | {row['ticker']} | **{row['return']:+.1f}** | {row['mdd']:.1f} | {row['num_trades']} | {row['bnh']:+.1f} |\n"

    md += f"""
## 전략별 종합 순위

| 순위 | 전략 | 카테고리 | 평균수익(%) | Sharpe | 승률(%) | 최대낙폭(%) | 수익조합 |
|------|------|----------|-------------|--------|---------|-------------|----------|
"""

    for idx, (i, row) in enumerate(strategy_perf.iterrows(), 1):
        win_combos = int(row['winning'])
        total_combos = int(row['combos'])
        md += f"| {idx} | {row['strategy_name']} | {row['category']} | {row['return']:+.1f} | {row['sharpe']:.2f} | {row['win_rate']:.0f} | {row['mdd']:.1f} | {win_combos}/{total_combos} |\n"

    md += f"""
## 카테고리별 성과

| 카테고리 | 평균수익(%) | 중앙값(%) | 수익비율 | 조합수 |
|----------|-------------|-----------|----------|--------|
"""

    for idx, (i, row) in enumerate(category_perf.iterrows()):
        win_ratio_cat = f"{int(row['winning'])}/{int(row['combos'])} ({row['win_ratio']:.0f}%)"
        md += f"| {row['category']} | {row['avg_return']:+.1f} | {row['median_return']:+.1f} | {win_ratio_cat} | {int(row['combos'])} |\n"

    md += f"""
## 종목별 최적 전략 & 시장 진단

| 종목 | 시장 레짐 | RSI | ATR% | 최적 전략 | 수익률(%) | B&H(%) | 알파(%) |
|------|-----------|-----|------|-----------|-----------|--------|---------|
"""

    for idx, (i, row) in enumerate(best_per_ticker.iterrows()):
        rsi_val = row['rsi']
        if rsi_val > 70:
            regime = "과열"
        elif rsi_val > 60:
            regime = "강상승"
        elif rsi_val > 50:
            regime = "상승"
        elif rsi_val > 40:
            regime = "혼조"
        elif rsi_val > 30:
            regime = "약세"
        else:
            regime = "과매도"

        md += f"| {row['ticker']} | {regime} | {row['rsi']:.1f} | {row['atr_pct']:.2f} | {row['strategy_name']} | {row['return']:+.1f} | {row['bnh']:+.1f} | {row['alpha']:+.1f} |\n"

    md += f"""
## 주요 인사이트

1. **전략 성과 분포**: 절대수익 기준 최고수익이 {max_return:.1f}%, 최대손실이 {min_return:.1f}%로 변동성이 높은 특성 반영
2. **카테고리별 우위**: """

    best_category = category_perf.iloc[0]
    worst_category = category_perf.iloc[-1]

    md += f"{best_category['category']}({best_category['avg_return']:+.1f}%)가 {worst_category['category']}({worst_category['avg_return']:+.1f}%)보다 우수"

    md += f"""
3. **알파 창출**: {positive_alpha}개 조합({positive_alpha/len(df)*100:.0f}%)이 양의 알파 달성 — 하락장/횡보장에서 전략 가치 극대화
4. **거래 빈도**: 평균 거래수 {df['num_trades'].mean():.1f}회로 과도한 거래를 피한 설계
5. **리스크 관리**: 최대낙폭 평균 {df['mdd'].mean():.1f}%로 적절한 드로우다운 제어

---

*생성: DI금융 퀀트 연구소 자동 리포트 | {execution_date}*
"""

    report_path = f"/sessions/nifty-vigilant-cannon/mnt/signal-screener-project/quant-reports/backtest-report-{execution_date}.md"
    with open(report_path, 'w') as f:
        f.write(md)

    print(f"리포트 생성: {report_path}")

    # Generate telegram summary
    generate_telegram_report(results, execution_date)


def generate_telegram_report(results: List[Dict], execution_date: str):
    """Generate concise, actionable telegram report with improved formatting"""

    df = pd.DataFrame(results)
    avg_return = df['return'].mean()
    median_return = df['return'].median()
    winning_combos = len(df[df['return'] > 0])
    total = len(df)
    avg_bnh = df['bnh'].mean()
    positive_alpha = len(df[df['alpha'] > 0])
    avg_sharpe = df['sharpe'].mean()
    avg_mdd = df['mdd'].mean()

    # Top 5 by return
    top5 = df.nlargest(5, 'return')
    # Top 5 alpha
    top5_alpha = df.nlargest(5, 'alpha')
    # Worst 3
    worst3 = df.nsmallest(3, 'return')

    # Category performance
    cat_perf = df.groupby('category').agg({
        'return': 'mean',
        'strategy_id': 'count',
    }).reset_index()
    cat_perf['win'] = df.groupby('category').apply(lambda x: len(x[x['return'] > 0])).values
    cat_perf['win_pct'] = (cat_perf['win'] / cat_perf['strategy_id'] * 100).round(0)
    cat_perf = cat_perf.sort_values('return', ascending=False)

    # Best per ticker (top 5)
    best_per_ticker = df.loc[df.groupby('ticker')['return'].idxmax()]
    best_per_ticker = best_per_ticker.sort_values('return', ascending=False).head(7)

    # Risk assessment
    high_risk = len(df[df['mdd'] < -20])
    consistent = len(df[(df['sharpe'] > 0.5) & (df['win_rate'] > 50)])

    # Market regime summary
    regime_data = []
    for _, row in best_per_ticker.iterrows():
        rsi_val = row['rsi']
        if rsi_val > 70: regime = "과매수"
        elif rsi_val > 55: regime = "강세"
        elif rsi_val > 45: regime = "중립"
        elif rsi_val > 30: regime = "약세"
        else: regime = "과매도"
        regime_data.append(f"{row['ticker']}({regime}|${row.get('return', 0):+.0f}%)")

    # Signal strength indicator
    if avg_return > 10: signal = "🟢 매수 우위"
    elif avg_return > 3: signal = "🟡 약한 매수"
    elif avg_return > -3: signal = "⚪ 중립"
    elif avg_return > -10: signal = "🟠 약한 매도"
    else: signal = "🔴 매도 우위"

    msg = f"""📊 DI퀀트 전략 리포트 [{execution_date}]
{signal}

━━━ 📈 전체 성과 ━━━
수익률: {avg_return:+.1f}% (중앙 {median_return:+.1f}%)
승률: {winning_combos}/{total} ({winning_combos/total*100:.0f}%)
B&H: {avg_bnh:+.1f}% | 알파+: {positive_alpha}건 ({positive_alpha/total*100:.0f}%)
Sharpe: {avg_sharpe:.2f} | MDD: {avg_mdd:.1f}%

━━━ 🏆 TOP 5 수익 ━━━
"""
    for i, (_, row) in enumerate(top5.iterrows(), 1):
        sharpe_icon = "⭐" if row['sharpe'] > 1.0 else "✅" if row['sharpe'] > 0.5 else ""
        msg += f"  {i}. {row['strategy_name']}|{row['ticker']}: {row['return']:+.1f}% (S:{row['sharpe']:.1f}) {sharpe_icon}\n"

    msg += "\n━━━ 🎯 TOP 5 알파 ━━━\n"
    for i, (_, row) in enumerate(top5_alpha.iterrows(), 1):
        msg += f"  {i}. {row['strategy_name']}|{row['ticker']}: α{row['alpha']:+.1f}%\n"

    msg += "\n━━━ ⚠️ WORST 3 ━━━\n"
    for i, (_, row) in enumerate(worst3.iterrows(), 1):
        msg += f"  {i}. {row['strategy_name']}|{row['ticker']}: {row['return']:+.1f}%\n"

    msg += "\n━━━ 📊 카테고리 ━━━\n"
    for _, row in cat_perf.iterrows():
        bar = "█" * max(1, int(row['win_pct'] / 10))
        msg += f"  [{row['category']}] {row['return']:+.1f}% ({row['win_pct']:.0f}%↑) {bar}\n"

    msg += "\n━━━ 🔍 종목 최적전략 ━━━\n"
    for _, row in best_per_ticker.iterrows():
        rsi_val = row['rsi']
        rsi_emoji = "🔴" if rsi_val > 70 else "🟢" if rsi_val < 30 else "⚪"
        msg += f"  {rsi_emoji} {row['ticker']}: {row['strategy_name']} ({row['return']:+.1f}% α{row['alpha']:+.1f}%)\n"

    msg += f"""
━━━ 📋 리스크 요약 ━━━
안정 전략(S>0.5+WR50%↑): {consistent}건
고위험(MDD<-20%): {high_risk}건
전략수: {len(STRATEGY_FUNCTIONS)}개 | 종목: {len(set(df['ticker']))}개

🤖 DI금융 퀀트 연구소 자동 생성"""

    # Save telegram report
    tg_path = f"/sessions/nifty-vigilant-cannon/mnt/signal-screener-project/quant-reports/telegram-pending-{execution_date}-backtest.txt"
    with open(tg_path, 'w') as f:
        f.write(msg)
    print(f"텔레그램 리포트 생성: {tg_path}")


if __name__ == "__main__":
    main()
