#!/usr/bin/env python3
"""
위험 파라미터 튜너 에이전트 - 시장 레짐에 따른 위험 조정
6시간마다 실행
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


class MarketRegimeDetector:
    """시장 레짐 감지기"""

    def __init__(self):
        self.lookback_periods = {
            'hurst': 100,
            'efficiency': 50,
            'atr': 14,
        }

    async def fetch_market_data(self) -> Dict[str, List[float]]:
        """BTC, ETH, S&P 프록시 데이터 수집"""
        logger.debug("  Fetching market data (BTC, ETH, S&P proxy)...")

        # 실제:
        # btc_prices = fetch_ticker("BTCUSDT", days=30)
        # eth_prices = fetch_ticker("ETHUSDT", days=30)
        # sp_prices = fetch_ticker("SPY", days=30)  # 또는 ^GSPC

        # 프로토타입
        import random
        data = {
            'btc_returns': [random.gauss(0.001, 0.02) for _ in range(100)],
            'eth_returns': [random.gauss(0.0005, 0.025) for _ in range(100)],
            'sp_returns': [random.gauss(0.0003, 0.01) for _ in range(100)],
            'btc_prices': [random.uniform(40000, 45000) for _ in range(100)],
            'atr_values': [random.uniform(500, 1500) for _ in range(14)],
        }

        return data

    def _calculate_hurst_exponent(self, returns: List[float]) -> float:
        """허스트 지수 계산 (추세 강도)
        H < 0.5: mean reverting
        H = 0.5: random walk
        H > 0.5: trending
        """
        if len(returns) < self.lookback_periods['hurst']:
            return 0.5

        try:
            # 간단한 허스트 추정
            import math

            lags = []
            tau = []

            for lag in range(1, len(returns) // 2, 5):
                tau.append(lag)

                # 누적 수익 계산
                cumulative = sum(returns[:lag])
                lag_std = (sum([(sum(returns[i : i + lag]) - cumulative) ** 2 for i in range(0, len(returns), lag)]) / (len(returns) // lag)) ** 0.5

                lags.append(math.log(lag_std) if lag_std > 0 else 0)

            # 선형 회귀로 허스트 지수 계산 (간단화)
            if len(tau) > 1:
                h = (lags[-1] - lags[0]) / (math.log(tau[-1]) - math.log(tau[0]) + 0.001)
            else:
                h = 0.5

            return max(0.0, min(1.0, h))

        except Exception as e:
            logger.debug(f"  Hurst calculation error: {e}")
            return 0.5

    def _calculate_efficiency_ratio(self, returns: List[float]) -> float:
        """효율 비율 (추세 vs 변동성)
        ER = |change| / sum(|returns|)
        ER 높음: 추세, ER 낮음: 노이즈/평균회귀
        """
        if len(returns) < self.lookback_periods['efficiency']:
            return 0.5

        recent = returns[-self.lookback_periods['efficiency'] :]

        direction_change = abs(sum(recent))
        volatility = sum([abs(r) for r in recent])

        if volatility == 0:
            return 0.5

        er = direction_change / volatility
        return max(0.0, min(1.0, er))

    def _calculate_atr_percentile(self, atr_values: List[float]) -> float:
        """ATR 백분위수 (변동성 측정)
        높음: 높은 변동성, 낮음: 낮은 변동성
        """
        if not atr_values or len(atr_values) < 2:
            return 0.5

        current_atr = atr_values[-1]
        min_atr = min(atr_values)
        max_atr = max(atr_values)

        if max_atr == min_atr:
            return 0.5

        atr_pct = (current_atr - min_atr) / (max_atr - min_atr)
        return max(0.0, min(1.0, atr_pct))

    async def detect_regime(self, market_data: Dict) -> str:
        """시장 레짐 분류
        TRENDING_UP, TRENDING_DOWN, MEAN_REVERTING, HIGH_VOLATILITY, LOW_VOLATILITY
        """
        logger.debug("  Detecting market regime...")

        # 지표 계산
        hurst = self._calculate_hurst_exponent(market_data['btc_returns'])
        er = self._calculate_efficiency_ratio(market_data['btc_returns'])
        atr_pct = self._calculate_atr_percentile(market_data['atr_values'])

        logger.debug(f"    Hurst: {hurst:.2f}, ER: {er:.2f}, ATR%: {atr_pct:.2f}")

        # 상향/하향 추세 확인
        recent_returns = market_data['btc_returns'][-20:]
        mean_return = sum(recent_returns) / len(recent_returns) if recent_returns else 0

        # 레짐 분류 로직
        if atr_pct > 0.7:
            return "HIGH_VOLATILITY"
        elif atr_pct < 0.3:
            return "LOW_VOLATILITY"
        elif hurst > 0.6:  # 추세 강함
            if mean_return > 0:
                return "TRENDING_UP"
            else:
                return "TRENDING_DOWN"
        elif hurst < 0.4:  # 평균회귀
            return "MEAN_REVERTING"
        else:
            # 기본값
            return "TRENDING_UP" if mean_return > 0 else "TRENDING_DOWN"


class RiskTunerAgent:
    """시장 레짐에 따라 위험 파라미터를 조정하는 에이전트"""

    def __init__(self):
        self.detector = MarketRegimeDetector()

        # 레짐별 위험 파라미터
        self.regime_configs = {
            'TRENDING_UP': {
                'leverage_multiplier': 1.2,
                'position_size_multiplier': 1.0,
                'stop_loss_multiplier': 1.3,
                'strategy_family_weights': {
                    'trend': 0.50,
                    'momentum': 0.30,
                    'mean_reversion': 0.20,
                },
                'description': '상향 추세: 포지션 유지, 스탑 넓힘',
            },
            'TRENDING_DOWN': {
                'leverage_multiplier': 0.8,
                'position_size_multiplier': 0.7,
                'stop_loss_multiplier': 1.2,
                'strategy_family_weights': {
                    'trend': 0.50,
                    'momentum': 0.20,
                    'mean_reversion': 0.30,
                },
                'description': '하향 추세: 포지션 축소, 위험 감소',
            },
            'MEAN_REVERTING': {
                'leverage_multiplier': 1.0,
                'position_size_multiplier': 0.9,
                'stop_loss_multiplier': 1.0,
                'strategy_family_weights': {
                    'trend': 0.20,
                    'momentum': 0.20,
                    'mean_reversion': 0.60,
                },
                'description': '평균회귀: MR 전략 강조, 타이트 스탑',
            },
            'HIGH_VOLATILITY': {
                'leverage_multiplier': 0.6,
                'position_size_multiplier': 0.5,
                'stop_loss_multiplier': 0.8,
                'strategy_family_weights': {
                    'trend': 0.30,
                    'momentum': 0.20,
                    'mean_reversion': 0.50,
                },
                'description': '높은 변동성: 포지션 대폭 축소',
            },
            'LOW_VOLATILITY': {
                'leverage_multiplier': 1.3,
                'position_size_multiplier': 1.1,
                'stop_loss_multiplier': 1.5,
                'strategy_family_weights': {
                    'trend': 0.40,
                    'momentum': 0.40,
                    'mean_reversion': 0.20,
                },
                'description': '낮은 변동성: 포지션 확대 가능',
            },
        }

    async def get_risk_config(self, regime: str) -> Dict:
        """레짐에 맞는 위험 설정 반환"""
        config = self.regime_configs.get(regime, self.regime_configs['TRENDING_UP'])

        logger.debug(f"  Risk config for {regime}:")
        logger.debug(f"    Leverage: {config['leverage_multiplier']:.1f}x")
        logger.debug(f"    Position size: {config['position_size_multiplier']:.1f}x")
        logger.debug(f"    Stop loss: {config['stop_loss_multiplier']:.1f}x")

        return config

    async def store_risk_config(self, regime: str, risk_config: Dict) -> None:
        """위험 설정을 KV에 저장"""
        logger.info(f"💾 Storing risk config for {regime}...")

        key = "di:agents:risk:config"

        payload = {
            'timestamp': datetime.now().isoformat(),
            'regime': regime,
            'leverage_multiplier': risk_config['leverage_multiplier'],
            'position_size_multiplier': risk_config['position_size_multiplier'],
            'stop_loss_multiplier': risk_config['stop_loss_multiplier'],
            'strategy_family_weights': risk_config['strategy_family_weights'],
        }

        # 실제: kv_set(key, json.dumps(payload))

        logger.info(f"✓ Risk config stored for regime: {regime}")

    async def update_strategy_weights(self, weights: Dict) -> None:
        """strategy-weights.js를 위한 가중치 업데이트"""
        logger.info("🎯 Updating strategy family weights...")

        key = "di:quant:strategy-weights"

        payload = {
            'timestamp': datetime.now().isoformat(),
            'family_weights': weights,
        }

        # 실제: kv_set(key, json.dumps(payload))
        logger.info(f"✓ Strategy weights updated: {weights}")

    async def send_report(self, regime: str, risk_config: Dict) -> None:
        """텔레그램 리포트 전송"""
        message = f"🛡️ Risk Update: Regime={regime}"
        message += f"\n  Leverage={risk_config['leverage_multiplier']:.1f}x"
        message += f", Size={risk_config['position_size_multiplier']:.1f}x"
        message += f", Stop={risk_config['stop_loss_multiplier']:.1f}x"

        logger.info(f"📤 {message}")
        # 실제: send_agent_report("risk_tuner", message)

    async def run(self) -> None:
        """메인 실행 함수"""
        start_time = datetime.now()
        logger.info("=" * 70)
        logger.info("RISK TUNER AGENT START")
        logger.info("=" * 70)

        try:
            # 1. 시장 데이터 수집
            market_data = await self.detector.fetch_market_data()

            # 2. 시장 레짐 감지
            regime = await self.detector.detect_regime(market_data)
            logger.info(f"📈 Detected regime: {regime}")

            # 3. 레짐별 위험 설정 조회
            risk_config = await self.get_risk_config(regime)

            # 4. 위험 설정 저장
            await self.store_risk_config(regime, risk_config)

            # 5. 전략 가중치 업데이트
            await self.update_strategy_weights(risk_config['strategy_family_weights'])

            # 6. 리포트 전송
            await self.send_report(regime, risk_config)

            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ RISK TUNER AGENT COMPLETE in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"✗ RISK TUNER AGENT FAILED: {e}", exc_info=True)
            raise


async def main():
    agent = RiskTunerAgent()
    await agent.run()


if __name__ == '__main__':
    asyncio.run(main())
