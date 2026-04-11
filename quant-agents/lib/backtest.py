"""
코어 백테스트 엔진

- BacktestEngine: 신호 기반 백테스트
- walk_forward_test: 워크포워드 검증
- monte_carlo_test: 몬테카를로 시뮬레이션
"""

import numpy as np
import pandas as pd
from typing import Callable, List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 데이터 클래스
# ═══════════════════════════════════════════════════════════════


@dataclass
class BacktestResult:
    """백테스트 결과"""
    total_return: float          # 총 수익률 (%)
    sharpe: float               # 샤프 지수
    sortino: float              # 소르티노 지수
    calmar: float               # 칼마 비율
    max_drawdown: float         # 최대 낙폭 (%)
    win_rate: float             # 승률 (%)
    profit_factor: float        # 수익팩터
    num_trades: int             # 거래수
    avg_trade_duration: float   # 평균 보유기간 (봉)
    equity_curve: np.ndarray    # 자산곡선
    trades: List[Dict] = field(default_factory=list)  # 거래 리스트


# ═══════════════════════════════════════════════════════════════
# 백테스트 엔진
# ═══════════════════════════════════════════════════════════════


class BacktestEngine:
    """신호 기반 백테스트"""

    def __init__(
        self,
        data: pd.DataFrame,
        initial_capital: float = 10000,
        commission: float = 0.0004,
        slippage: float = 0.0002,
    ):
        """
        Args:
            data: OHLCV DataFrame (columns: open, high, low, close, volume)
            initial_capital: 초기 자본
            commission: 거래수수료 (0.04%)
            slippage: 슬리피지 (0.02%)
        """
        self.data = data
        self.initial_capital = initial_capital
        self.commission = commission
        self.slippage = slippage

        self.close = data["close"].values
        self.high = data["high"].values
        self.low = data["low"].values

    def run(self, signals: np.ndarray) -> BacktestResult:
        """
        신호 기반 백테스트 실행

        Args:
            signals: 신호 배열 (1=매수, -1=매도, 0=홀드)

        Returns:
            BacktestResult
        """
        cash = self.initial_capital
        position = None  # {price, size, bar}
        peak_equity = self.initial_capital
        max_dd = 0
        equity_curve = [self.initial_capital]
        trades = []

        for i, signal in enumerate(signals):
            price = self.close[i]

            # 진입
            if signal == 1 and position is None:
                # 매수 슬리피지
                entry_price = price * (1 + self.slippage)
                size = cash / entry_price
                cash -= size * entry_price
                position = {"price": entry_price, "size": size, "bar": i}

            # 종료
            elif signal == -1 and position is not None:
                # 매도 슬리피지
                exit_price = price * (1 - self.slippage)
                proceeds = position["size"] * exit_price
                commission_fee = proceeds * self.commission
                cash += proceeds - commission_fee

                # 거래 기록
                pnl_pct = ((exit_price - position["price"]) / position["price"]) * 100
                hold_bars = i - position["bar"]
                trades.append({
                    "entry_bar": position["bar"],
                    "entry_price": position["price"],
                    "exit_bar": i,
                    "exit_price": exit_price,
                    "pnl_pct": pnl_pct,
                    "hold_bars": hold_bars,
                    "commission": commission_fee,
                })

                position = None

            # 자산 계산
            if position:
                equity = cash + position["size"] * price
            else:
                equity = cash

            equity_curve.append(equity)

            # 낙폭 계산
            if equity > peak_equity:
                peak_equity = equity
            dd = (peak_equity - equity) / peak_equity * 100
            if dd > max_dd:
                max_dd = dd

        # 미청산 포지션 정리
        if position:
            final_price = self.close[-1]
            proceeds = position["size"] * final_price
            commission_fee = proceeds * self.commission
            cash += proceeds - commission_fee

            pnl_pct = ((final_price - position["price"]) / position["price"]) * 100
            hold_bars = len(self.close) - 1 - position["bar"]
            trades.append({
                "entry_bar": position["bar"],
                "entry_price": position["price"],
                "exit_bar": len(self.close) - 1,
                "exit_price": final_price,
                "pnl_pct": pnl_pct,
                "hold_bars": hold_bars,
                "commission": commission_fee,
            })

        # 성과 지표 계산
        equity_curve = np.array(equity_curve)
        total_return = ((equity_curve[-1] - self.initial_capital) / self.initial_capital) * 100

        # Sharpe, Sortino
        returns = np.diff(equity_curve) / equity_curve[:-1]
        sharpe, sortino = self._calculate_sharpe_sortino(returns)
        calmar = self._calculate_calmar(total_return, max_dd)

        # 승률, 수익팩터
        if trades:
            wins = [t for t in trades if t["pnl_pct"] > 0]
            losses = [t for t in trades if t["pnl_pct"] <= 0]
            win_rate = (len(wins) / len(trades)) * 100
            avg_win = np.mean([t["pnl_pct"] for t in wins]) if wins else 0
            avg_loss = -np.mean([t["pnl_pct"] for t in losses]) if losses else 1
            profit_factor = avg_win / avg_loss if avg_loss > 0 else avg_win
            avg_hold = np.mean([t["hold_bars"] for t in trades])
        else:
            win_rate = 0
            profit_factor = 0
            avg_hold = 0

        return BacktestResult(
            total_return=total_return,
            sharpe=sharpe,
            sortino=sortino,
            calmar=calmar,
            max_drawdown=max_dd,
            win_rate=win_rate,
            profit_factor=profit_factor,
            num_trades=len(trades),
            avg_trade_duration=avg_hold,
            equity_curve=equity_curve,
            trades=trades,
        )

    def _calculate_sharpe_sortino(self, returns: np.ndarray) -> Tuple[float, float]:
        """Sharpe, Sortino 계산"""
        if len(returns) < 2:
            return 0, 0

        mean_ret = np.mean(returns)
        std_ret = np.std(returns)

        # Sharpe (252거래일 연환산)
        sharpe = (mean_ret / std_ret) * np.sqrt(252) if std_ret > 0 else 0

        # Sortino (하낙폭 표준편차만 사용)
        downside = returns[returns < 0]
        downside_std = np.std(downside) if len(downside) > 0 else 1
        sortino = (mean_ret / downside_std) * np.sqrt(252) if downside_std > 0 else sharpe

        return float(sharpe), float(sortino)

    def _calculate_calmar(self, ret: float, max_dd: float) -> float:
        """Calmar 비율 (수익률 / 최대낙폭)"""
        return (ret / max_dd) if max_dd > 0 else ret


# ═══════════════════════════════════════════════════════════════
# 워크포워드 테스트
# ═══════════════════════════════════════════════════════════════


def walk_forward_test(
    data: pd.DataFrame,
    strategy_fn: Callable,
    train_window: int = 120,
    test_window: int = 30,
    **strategy_params,
) -> Tuple[List[BacktestResult], Dict[str, Any]]:
    """
    워크포워드 (Out-of-sample) 테스트

    데이터를 train/test로 나누어 반복적으로 테스트

    Args:
        data: OHLCV DataFrame
        strategy_fn: 전략 함수 (data → signals)
        train_window: 학습 윈도우 (봉)
        test_window: 테스트 윈도우 (봉)
        **strategy_params: 전략 파라미터

    Returns:
        (결과 리스트, 통계)
    """
    results = []
    total_return = []
    sharpe_list = []

    # 반복 폴드
    for start in range(0, len(data) - train_window - test_window, test_window):
        # 학습 데이터
        train_data = data.iloc[start:start + train_window]

        # 테스트 데이터
        test_data = data.iloc[start + train_window:start + train_window + test_window]

        if len(test_data) < test_window:
            break

        try:
            # 전략 실행 (학습 데이터로 파라미터 생성)
            # 주의: 실제로는 학습 데이터로 파라미터를 최적화해야 함
            signals = strategy_fn(test_data.values, **strategy_params)

            # 백테스트
            engine = BacktestEngine(test_data)
            result = engine.run(signals)

            results.append(result)
            total_return.append(result.total_return)
            sharpe_list.append(result.sharpe)

            logger.debug(f"  폴드 {len(results)}: Sharpe={result.sharpe:.2f}, Return={result.total_return:.1f}%")

        except Exception as e:
            logger.error(f"  폴드 오류: {e}")

    # 통계
    stats = {
        "num_folds": len(results),
        "avg_return": np.mean(total_return) if total_return else 0,
        "std_return": np.std(total_return) if total_return else 0,
        "avg_sharpe": np.mean(sharpe_list) if sharpe_list else 0,
        "min_sharpe": np.min(sharpe_list) if sharpe_list else 0,
        "max_sharpe": np.max(sharpe_list) if sharpe_list else 0,
    }

    return results, stats


# ═══════════════════════════════════════════════════════════════
# 몬테카를로 테스트
# ═══════════════════════════════════════════════════════════════


def monte_carlo_test(
    data: pd.DataFrame,
    strategy_fn: Callable,
    n_simulations: int = 100,
    **strategy_params,
) -> Dict[str, Any]:
    """
    몬테카를로 시뮬레이션

    거래 결과를 랜덤하게 재배열하여 운의 영향을 평가

    Args:
        data: OHLCV DataFrame
        strategy_fn: 전략 함수
        n_simulations: 시뮬레이션 수
        **strategy_params: 전략 파라미터

    Returns:
        {
            "original": BacktestResult,
            "simulations": [BacktestResult, ...],
            "statistics": {
                "mean_return": ...,
                "percentile_5": ...,
                "percentile_95": ...,
            }
        }
    """
    # 원본 실행
    signals = strategy_fn(data.values, **strategy_params)
    engine = BacktestEngine(data)
    original = engine.run(signals)

    # 시뮬레이션
    sim_results = []

    if original.num_trades < 2:
        logger.warning("거래 수 부족 (최소 2개 필요)")
        return {"original": original, "simulations": []}

    trades = original.trades.copy()

    for _ in range(n_simulations):
        # 거래 순서 랜덤화
        shuffled = np.random.permutation(trades)

        # 신호 재구성
        sim_signals = np.zeros(len(data), dtype=int)
        for trade in shuffled:
            entry_bar = trade["entry_bar"]
            exit_bar = trade["exit_bar"]

            if entry_bar < len(sim_signals):
                sim_signals[entry_bar] = 1
            if exit_bar < len(sim_signals):
                sim_signals[exit_bar] = -1

        # 백테스트
        result = engine.run(sim_signals)
        sim_results.append(result)

    # 통계
    sim_returns = [r.total_return for r in sim_results]
    stats = {
        "mean_return": np.mean(sim_returns),
        "std_return": np.std(sim_returns),
        "percentile_5": np.percentile(sim_returns, 5),
        "percentile_25": np.percentile(sim_returns, 25),
        "percentile_50": np.percentile(sim_returns, 50),
        "percentile_75": np.percentile(sim_returns, 75),
        "percentile_95": np.percentile(sim_returns, 95),
        "min_return": np.min(sim_returns),
        "max_return": np.max(sim_returns),
    }

    return {
        "original": original,
        "simulations": sim_results,
        "statistics": stats,
    }


# ═══════════════════════════════════════════════════════════════
# 유틸
# ═══════════════════════════════════════════════════════════════


def get_drawdown_info(equity_curve: np.ndarray) -> Dict[str, Any]:
    """낙폭 분석"""
    peak = np.maximum.accumulate(equity_curve)
    drawdown = (peak - equity_curve) / peak * 100

    # 최대 낙폭 구간
    max_dd_idx = np.argmax(drawdown)
    peak_idx = np.argmax(equity_curve[:max_dd_idx])

    return {
        "max_drawdown": np.max(drawdown),
        "avg_drawdown": np.mean(drawdown[drawdown > 0]),
        "drawdown_duration": max_dd_idx - peak_idx,
        "peak_before_dd": equity_curve[peak_idx],
        "trough": equity_curve[max_dd_idx],
    }


if __name__ == "__main__":
    # 테스트
    import logging

    logging.basicConfig(level=logging.INFO)

    # 샘플 데이터 생성
    np.random.seed(42)
    dates = pd.date_range("2023-01-01", periods=200, freq="D")
    close = np.cumsum(np.random.randn(200) * 2) + 100
    high = close + np.abs(np.random.randn(200))
    low = close - np.abs(np.random.randn(200))
    volume = np.random.randint(1000, 5000, 200)

    data = pd.DataFrame({
        "open": close,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume,
    }, index=dates)

    # 간단한 전략: 이동평균 크로스
    def simple_ma_strategy(df):
        close = df[:, 4]  # close 컬럼
        sma_short = pd.Series(close).rolling(10).mean().values
        sma_long = pd.Series(close).rolling(30).mean().values

        signals = np.zeros(len(close), dtype=int)
        for i in range(30, len(close)):
            if sma_short[i] > sma_long[i] and sma_short[i - 1] <= sma_long[i - 1]:
                signals[i] = 1
            elif sma_short[i] < sma_long[i] and sma_short[i - 1] >= sma_long[i - 1]:
                signals[i] = -1

        return signals

    # 테스트
    print("▶ 백테스트 실행")
    engine = BacktestEngine(data)
    signals = simple_ma_strategy(data.values)
    result = engine.run(signals)

    print(f"\n결과:")
    print(f"  수익률: {result.total_return:.2f}%")
    print(f"  Sharpe: {result.sharpe:.2f}")
    print(f"  Sortino: {result.sortino:.2f}")
    print(f"  최대낙폭: {result.max_drawdown:.2f}%")
    print(f"  거래수: {result.num_trades}")
    print(f"  승률: {result.win_rate:.1f}%")
    print(f"  수익팩터: {result.profit_factor:.2f}")

    print("\n✓ 테스트 완료")
