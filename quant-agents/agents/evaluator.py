#!/usr/bin/env python3
"""
성과 평가 에이전트 - 전략 점수 및 순위 산정
매일 10:00 KST 실행
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


class EvaluatorAgent:
    """모든 전략을 점수 산정하고 리더보드 업데이트하는 평가 에이전트"""

    def __init__(self):
        # 복합 점수 가중치
        self.weights = {
            'sharpe': 0.35,
            'sortino': 0.20,
            'win_rate': 0.15,
            'profit_factor': 0.15,
            'max_dd_penalty': 0.15,
        }
        self.promotion_threshold_percentile = 50  # 중위수보다 높으면 승격
        self.demotion_threshold = -0.05  # 최근 30일 수익률이 음수면 강등

    async def collect_active_strategies(self) -> List[Dict]:
        """KV에서 모든 활성 전략 수집"""
        logger.info("📥 Collecting active strategies from KV...")

        # 실제:
        # active_key = "di:agents:strategies:active"
        # active_data = json.loads(kv_get(active_key))
        # strategies = active_data.get('strategies', [])

        # 프로토타입
        strategies = [
            {
                'name': 'rsi_reversal_v1',
                'strategy': 'rsi_reversal',
                'params': {'rsi_period': 14, 'oversold': 30},
                'symbols': ['BTCUSDT', 'ETHUSDT'],
                'deployed_date': '2026-04-01',
                'status': 'active',
            },
            {
                'name': 'macd_crossover_v1',
                'strategy': 'macd_crossover',
                'params': {'fast': 12, 'slow': 26},
                'symbols': ['BTCUSDT', 'SOLUSDT'],
                'deployed_date': '2026-04-02',
                'status': 'active',
            },
            {
                'name': 'bb_bounce_v1',
                'strategy': 'bb_bounce',
                'params': {'period': 20, 'std_dev': 2.0},
                'symbols': ['ETHUSDT'],
                'deployed_date': '2026-04-03',
                'status': 'active',
            },
        ]

        logger.info(f"✓ Collected {len(strategies)} active strategies")
        return strategies

    async def calculate_30day_performance(self, strategy: Dict) -> Dict:
        """최근 30일 라이브/섀도우 성과 계산"""
        logger.debug(f"  Calculating 30-day performance for {strategy['name']}...")

        # 실제 구현:
        # live_trades = fetch_trades(strategy['name'], days=30)
        # returns = calculate_returns(live_trades)
        # metrics = calculate_metrics(returns)

        # 프로토타입
        import random
        metrics = {
            'sharpe': random.uniform(0.1, 1.5),
            'sortino': random.uniform(0.1, 1.8),
            'win_rate': random.uniform(0.35, 0.65),
            'profit_factor': random.uniform(0.8, 2.2),
            'max_dd': random.uniform(0.05, 0.35),
            'total_return': random.uniform(-0.05, 0.20),
            'num_trades': random.randint(10, 100),
        }

        return metrics

    def _compute_composite_score(self, metrics: Dict) -> float:
        """복합 점수 계산
        = 0.35×Sharpe + 0.20×Sortino + 0.15×WinRate + 0.15×ProfitFactor + 0.15×(1-MaxDD)
        """
        score = (
            self.weights['sharpe'] * min(metrics['sharpe'], 2.0) / 2.0
            + self.weights['sortino'] * min(metrics['sortino'], 2.0) / 2.0
            + self.weights['win_rate'] * metrics['win_rate']
            + self.weights['profit_factor'] * min(metrics['profit_factor'], 2.0) / 2.0
            + self.weights['max_dd_penalty'] * (1.0 - metrics['max_dd'])
        )

        return max(0.0, score)  # 음수 방지

    async def evaluate_and_rank(self, strategies: List[Dict]) -> List[Dict]:
        """모든 전략 평가 및 복합 점수로 순위 산정"""
        logger.info("📊 Evaluating and ranking strategies...")

        evaluated = []

        for strategy in strategies:
            try:
                metrics = await self.calculate_30day_performance(strategy)
                composite_score = self._compute_composite_score(metrics)

                evaluated.append({
                    **strategy,
                    'metrics': metrics,
                    'composite_score': composite_score,
                    'evaluation_date': datetime.now().isoformat(),
                })

            except Exception as e:
                logger.error(f"  Error evaluating {strategy['name']}: {e}")
                continue

        # 복합 점수로 순위 산정
        leaderboard = sorted(evaluated, key=lambda x: x['composite_score'], reverse=True)

        logger.info(f"✓ Ranked {len(leaderboard)} strategies")
        return leaderboard

    async def handle_promotions(
        self, leaderboard: List[Dict], evolver_strategies: List[Dict]
    ) -> Tuple[List[Dict], int]:
        """상위 진화 전략 승격 (중위수 이상)"""
        logger.info("🎯 Processing promotions...")

        if not leaderboard:
            return leaderboard, 0

        median_score = leaderboard[len(leaderboard) // 2]['composite_score']

        promoted = []
        promotion_count = 0

        for strategy in evolver_strategies:
            # 진화 전략이 중위수를 초과하는지 확인
            simulated_score = self._compute_composite_score(
                {
                    'sharpe': strategy.get('fitness', 0.5),
                    'sortino': strategy.get('fitness', 0.5) * 1.1,
                    'win_rate': 0.50,
                    'profit_factor': 1.5,
                    'max_dd': 0.20,
                }
            )

            if simulated_score > median_score:
                # 승격
                promoted.append({
                    'name': strategy.get('name', f"evolved_{len(promoted)}"),
                    'strategy': strategy.get('strategy'),
                    'params': strategy.get('params', {}),
                    'symbols': strategy.get('symbols', []),
                    'source': 'evolver',
                    'promoted_date': datetime.now().isoformat(),
                    'composite_score': simulated_score,
                })
                promotion_count += 1

        logger.info(f"✓ Promoted {promotion_count} strategies from evolver")

        return leaderboard + promoted, promotion_count

    async def handle_demotions(self, leaderboard: List[Dict]) -> Tuple[List[Dict], int]:
        """하위 전략 강등 (음수 수익 또는 최악의 10%)"""
        logger.info("📉 Processing demotions...")

        active = [s for s in leaderboard if s.get('status') == 'active']

        if not active:
            return leaderboard, 0

        # 복합 점수가 가장 낮은 10% 찾기
        demotion_count = max(1, len(active) // 10)
        demotion_threshold = sorted(
            [s['composite_score'] for s in active]
        )[demotion_count - 1] if demotion_count > 0 else 0

        demoted = []
        demoted_count = 0

        for strategy in active:
            # 강등 조건:
            # 1. 최근 30일 수익률이 음수
            # 2. 최악의 10%에 해당하는 복합 점수
            if (
                strategy['metrics'].get('total_return', 0) <= self.demotion_threshold
                or strategy['composite_score'] <= demotion_threshold
            ):
                demoted.append({
                    **strategy,
                    'status': 'archived',
                    'demoted_date': datetime.now().isoformat(),
                })
                demoted_count += 1

        # 활성 목록에서 강등된 전략 제거
        active_after = [s for s in active if s not in demoted]
        remaining = [s for s in leaderboard if s.get('status') != 'active'] + active_after

        logger.info(f"✓ Demoted {demoted_count} strategies to archive")

        return remaining, demoted_count

    async def store_leaderboard(self, leaderboard: List[Dict]) -> None:
        """업데이트된 리더보드를 KV에 저장"""
        logger.info("💾 Storing leaderboard to KV...")

        key = "di:agents:strategies:leaderboard"

        payload = {
            'timestamp': datetime.now().isoformat(),
            'total_strategies': len(leaderboard),
            'leaderboard': leaderboard,
        }

        # 실제: kv_set(key, json.dumps(payload))

        logger.info(f"✓ Leaderboard stored (top strategy: {leaderboard[0].get('name', 'unknown')})")

    async def send_report(
        self,
        leaderboard: List[Dict],
        promoted_count: int,
        demoted_count: int,
    ) -> None:
        """텔레그램 리포트 전송"""
        active_count = len([s for s in leaderboard if s.get('status') == 'active'])

        if leaderboard:
            top_sharpe = max([s['metrics'].get('sharpe', 0) for s in leaderboard])
        else:
            top_sharpe = 0

        message = f"📊 Evaluation: {active_count} strategies active"
        message += f", +{promoted_count} promoted, -{demoted_count} demoted"
        message += f"\n  Top Sharpe: {top_sharpe:.2f}"

        if leaderboard:
            message += f"\n  Leaderboard leader: {leaderboard[0].get('name', 'unknown')}"

        logger.info(f"📤 {message}")
        # 실제: send_agent_report("evaluator", message)

    async def run(self) -> None:
        """메인 실행 함수"""
        start_time = datetime.now()
        logger.info("=" * 70)
        logger.info("EVALUATOR AGENT START")
        logger.info("=" * 70)

        try:
            # 1. 활성 전략 수집
            strategies = await self.collect_active_strategies()

            if not strategies:
                logger.warning("No active strategies found")
                return

            # 2. 평가 및 순위 산정
            leaderboard = await self.evaluate_and_rank(strategies)

            # 3. 진화기 전략 승격 (프로토타입: 비어있는 리스트)
            evolver_strategies = []
            leaderboard, promoted_count = await self.handle_promotions(
                leaderboard, evolver_strategies
            )

            # 4. 하위 전략 강등
            leaderboard, demoted_count = await self.handle_demotions(leaderboard)

            # 5. 리더보드 저장
            await self.store_leaderboard(leaderboard)

            # 6. 리포트 전송
            await self.send_report(leaderboard, promoted_count, demoted_count)

            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ EVALUATOR AGENT COMPLETE in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"✗ EVALUATOR AGENT FAILED: {e}", exc_info=True)
            raise


async def main():
    agent = EvaluatorAgent()
    await agent.run()


if __name__ == '__main__':
    asyncio.run(main())
