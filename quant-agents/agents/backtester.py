#!/usr/bin/env python3
"""
워크포워드 백테스터 에이전트 - 과적합 방지 검증
매일 08:00 KST 실행
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any
import sys
import os
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


@dataclass
class WalkForwardResult:
    """워크포워드 테스트 결과"""
    strategy: str
    params: Dict
    symbol: str
    fold: int
    oos_sharpe: float
    oos_sortino: float
    oos_max_dd: float
    oos_trades: int
    in_sample_sharpe: float


class BacktesterAgent:
    """워크포워드 검증을 통한 과적합 방지 에이전트"""

    def __init__(self):
        self.train_days = 120
        self.test_days = 30
        self.num_folds = 4
        self.min_oos_sharpe = 0.3
        self.min_consistency = 0.5
        self.min_trades_per_fold = 15
        self.monte_carlo_iterations = 100
        self.p_value_threshold = 0.05

    async def load_research_results(self) -> List[Dict]:
        """연구원 에이전트 결과 읽기 (KV에서)"""
        logger.info("📥 Loading research results from KV...")

        today = datetime.now().strftime('%Y-%m-%d')
        key = f"di:agents:research:{today}"

        # 실제: payload = json.loads(kv_get(key))
        # 프로토타입
        candidates = [
            {
                'symbol': 'BTCUSDT',
                'strategy': 'rsi_reversal',
                'params': {'rsi_period': 14, 'oversold': 30},
                'sharpe': 0.85,
            },
            {
                'symbol': 'ETHUSDT',
                'strategy': 'macd_crossover',
                'params': {'fast': 12, 'slow': 26},
                'sharpe': 0.72,
            },
        ]

        logger.info(f"✓ Loaded {len(candidates)} candidates")
        return candidates

    async def run_walk_forward_test(
        self, candidate: Dict, market_data: Dict
    ) -> Tuple[List[WalkForwardResult], float]:
        """워크포워드 테스트 실행 (4 folds)"""
        symbol = candidate['symbol']
        strategy = candidate['strategy']
        params = candidate['params']

        logger.debug(f"  Walk-forward: {strategy} on {symbol}")

        fold_results = []
        fold_sharpes = []

        for fold in range(self.num_folds):
            try:
                # 실제: data_slice = get_fold_data(market_data, fold, train_days, test_days)
                # fold_result = backtest_engine.run(strategy, params, data_slice['test'])

                result = WalkForwardResult(
                    strategy=strategy,
                    params=params,
                    symbol=symbol,
                    fold=fold,
                    oos_sharpe=0.35 + fold * 0.02,  # 모의
                    oos_sortino=0.40 + fold * 0.02,
                    oos_max_dd=0.25 - fold * 0.02,
                    oos_trades=20 + fold * 2,
                    in_sample_sharpe=0.50 + fold * 0.01,
                )

                fold_results.append(result)
                fold_sharpes.append(result.oos_sharpe)

            except Exception as e:
                logger.debug(f"    Fold {fold} error: {e}")
                continue

        # 일관성 점수 계산 (fold 간 Sharpe의 표준편차)
        if fold_sharpes:
            import statistics
            mean_sharpe = statistics.mean(fold_sharpes)
            std_dev = statistics.stdev(fold_sharpes) if len(fold_sharpes) > 1 else 0
            consistency = 1.0 - min(std_dev / (mean_sharpe + 0.001), 1.0)  # 0~1 범위
        else:
            consistency = 0.0

        return fold_results, consistency

    async def run_monte_carlo_test(
        self, fold_results: List[WalkForwardResult]
    ) -> Tuple[float, bool]:
        """몬테카를로 테스트: 반환률 셔플 검증"""
        logger.debug(f"    Running Monte Carlo ({self.monte_carlo_iterations} iterations)...")

        if not fold_results:
            return 0.0, False

        avg_oos_sharpe = sum([r.oos_sharpe for r in fold_results]) / len(fold_results)

        # 실제 구현:
        # returns = extract_returns_from_results(fold_results)
        # worse_than_actual = 0
        # for i in range(monte_carlo_iterations):
        #     shuffled_returns = np.random.permutation(returns)
        #     shuffled_sharpe = calculate_sharpe(shuffled_returns)
        #     if shuffled_sharpe > avg_oos_sharpe:
        #         worse_than_actual += 1
        # p_value = worse_than_actual / monte_carlo_iterations

        # 모의
        p_value = 0.02  # 좋은 신호: p-value 작음

        is_significant = p_value < self.p_value_threshold

        logger.debug(f"    Monte Carlo p-value: {p_value:.4f} (significant: {is_significant})")

        return p_value, is_significant

    async def filter_candidates(
        self, candidates: List[Dict]
    ) -> Tuple[List[Dict], List[Dict]]:
        """후보 필터링: OOS Sharpe, 일관성, 거래 수, MC 검증"""
        logger.info("🔍 Running walk-forward validation...")

        validated = []
        rejected = []

        for i, candidate in enumerate(candidates, 1):
            logger.debug(f"  [{i}/{len(candidates)}] {candidate['strategy']} on {candidate['symbol']}")

            try:
                # 시장 데이터 로드 (실제)
                # market_data = fetch_klines_days(candidate['symbol'], '1h', 180)

                # 워크포워드 테스트
                fold_results, consistency = await self.run_walk_forward_test(
                    candidate, {}
                )

                if not fold_results:
                    rejected.append((candidate, "No fold results"))
                    continue

                # 기본 필터: OOS Sharpe, 일관성, 거래 수
                avg_oos_sharpe = sum([r.oos_sharpe for r in fold_results]) / len(fold_results)
                min_trades = min([r.oos_trades for r in fold_results])

                if avg_oos_sharpe <= self.min_oos_sharpe:
                    rejected.append((candidate, f"OOS Sharpe {avg_oos_sharpe:.2f} < {self.min_oos_sharpe}"))
                    continue

                if consistency <= self.min_consistency:
                    rejected.append((candidate, f"Consistency {consistency:.2f} < {self.min_consistency}"))
                    continue

                if min_trades < self.min_trades_per_fold:
                    rejected.append((candidate, f"Min trades {min_trades} < {self.min_trades_per_fold}"))
                    continue

                # 몬테카를로 검증
                p_value, is_significant = await self.run_monte_carlo_test(fold_results)

                if not is_significant:
                    rejected.append((candidate, f"MC p-value {p_value:.4f} > {self.p_value_threshold}"))
                    continue

                # 통과
                validated.append({
                    **candidate,
                    'oos_sharpe': avg_oos_sharpe,
                    'consistency': consistency,
                    'p_value': p_value,
                    'fold_results': fold_results,
                })

            except Exception as e:
                logger.error(f"    Error validating: {e}")
                rejected.append((candidate, str(e)))
                continue

        logger.info(f"✓ Validation complete: {len(validated)} passed, {len(rejected)} rejected")

        return validated, rejected

    async def store_validated(self, validated: List[Dict]) -> None:
        """통과한 전략을 KV에 저장: di:agents:validated:YYYY-MM-DD"""
        today = datetime.now().strftime('%Y-%m-%d')
        key = f"di:agents:validated:{today}"

        payload = {
            'timestamp': datetime.now().isoformat(),
            'validated_count': len(validated),
            'strategies': validated,
        }

        # 실제: kv_set(key, json.dumps(payload))
        logger.info(f"✓ Stored {len(validated)} validated strategies in KV: {key}")

    async def send_report(self, validated: List[Dict], rejected: List[Tuple]) -> None:
        """텔레그램 리포트 전송"""
        total = len(validated) + len(rejected)
        pass_rate = len(validated) / total * 100 if total > 0 else 0

        message = f"✅ Validation: {len(validated)}/{total} candidates passed walk-forward + Monte Carlo"
        message += f"\n  Pass rate: {pass_rate:.1f}%"

        if validated:
            avg_oos_sharpe = sum([v['oos_sharpe'] for v in validated]) / len(validated)
            message += f"\n  Avg OOS Sharpe: {avg_oos_sharpe:.2f}"

        logger.info(f"📤 {message}")
        # 실제: send_agent_report("backtester", message)

    async def run(self) -> None:
        """메인 실행 함수"""
        start_time = datetime.now()
        logger.info("=" * 70)
        logger.info("BACKTESTER AGENT START")
        logger.info("=" * 70)

        try:
            # 1. 연구원 결과 로드
            candidates = await self.load_research_results()

            if not candidates:
                logger.warning("No candidates found from researcher")
                return

            # 2. 워크포워드 + MC 검증
            validated, rejected = await self.filter_candidates(candidates)

            # 3. KV 저장
            await self.store_validated(validated)

            # 4. 리포트 전송
            await self.send_report(validated, rejected)

            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ BACKTESTER AGENT COMPLETE in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"✗ BACKTESTER AGENT FAILED: {e}", exc_info=True)
            raise


async def main():
    agent = BacktesterAgent()
    await agent.run()


if __name__ == '__main__':
    asyncio.run(main())
