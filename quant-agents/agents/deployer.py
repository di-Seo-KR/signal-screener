#!/usr/bin/env python3
"""
전략 배포 에이전트 - 검증된 전략을 프로덕션에 배포
매일 11:00 KST 실행
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


class DeploymentPlan:
    """배포 계획"""

    def __init__(self):
        self.new_strategies: List[Dict] = []
        self.removed_strategies: List[str] = []
        self.updated_strategies: List[Dict] = []
        self.total_changes = 0

    def __str__(self) -> str:
        return (
            f"DeploymentPlan(+{len(self.new_strategies)}, "
            f"-{len(self.removed_strategies)}, "
            f"~{len(self.updated_strategies)})"
        )


class DeployerAgent:
    """검증된 전략을 프로덕션에 배포하는 에이전트"""

    def __init__(self):
        self.max_changes_per_day = 3
        self.min_consecutive_days_on_leaderboard = 3
        self.min_p_value = 0.05

    async def load_leaderboard(self) -> List[Dict]:
        """리더보드 로드 (KV에서)"""
        logger.info("📥 Loading leaderboard from KV...")

        key = "di:agents:strategies:leaderboard"

        # 실제: payload = json.loads(kv_get(key))
        # leaderboard = payload.get('leaderboard', [])

        # 프로토타입
        leaderboard = [
            {
                'name': 'rsi_reversal_v1',
                'strategy': 'rsi_reversal',
                'params': {'rsi_period': 14, 'oversold': 30},
                'symbols': ['BTCUSDT', 'ETHUSDT'],
                'status': 'active',
                'composite_score': 0.82,
                'metrics': {'sharpe': 1.2, 'sortino': 1.4},
                'days_on_leaderboard': 5,
                'p_value': 0.03,
            },
            {
                'name': 'macd_crossover_v2',
                'strategy': 'macd_crossover',
                'params': {'fast': 12, 'slow': 26, 'signal': 9},
                'symbols': ['BTCUSDT', 'SOLUSDT'],
                'status': 'validated',
                'composite_score': 0.75,
                'metrics': {'sharpe': 1.1, 'sortino': 1.3},
                'days_on_leaderboard': 2,
                'p_value': 0.02,
            },
            {
                'name': 'bb_bounce_v1',
                'strategy': 'bb_bounce',
                'params': {'period': 20, 'std_dev': 2.0},
                'symbols': ['ETHUSDT'],
                'status': 'active',
                'composite_score': 0.68,
                'metrics': {'sharpe': 0.9},
                'days_on_leaderboard': 4,
                'p_value': 0.04,
            },
        ]

        logger.info(f"✓ Loaded leaderboard with {len(leaderboard)} strategies")
        return leaderboard

    async def load_current_production(self) -> Dict:
        """현재 프로덕션 전략 설정 로드"""
        logger.info("📥 Loading current production config...")

        key = "di:quant:latest"

        # 실제: config = json.loads(kv_get(key))

        # 프로토타입
        config = {
            'timestamp': datetime.now().isoformat(),
            'active_strategies': [
                {
                    'name': 'rsi_reversal_v1',
                    'strategy': 'rsi_reversal',
                    'params': {'rsi_period': 14, 'oversold': 30},
                    'symbols': ['BTCUSDT', 'ETHUSDT'],
                    'deployed_date': '2026-04-01',
                },
                {
                    'name': 'bb_bounce_v1',
                    'strategy': 'bb_bounce',
                    'params': {'period': 20, 'std_dev': 2.0},
                    'symbols': ['ETHUSDT'],
                    'deployed_date': '2026-04-03',
                },
            ],
        }

        logger.info(f"✓ Loaded production config with {len(config['active_strategies'])} strategies")
        return config

    async def load_validated_strategies(self) -> List[Dict]:
        """최근 검증된 전략 로드"""
        logger.info("📥 Loading validated strategies...")

        today = datetime.now().strftime('%Y-%m-%d')
        key = f"di:agents:validated:{today}"

        # 실제: payload = json.loads(kv_get(key))
        # validated = payload.get('strategies', [])

        validated = [
            {
                'name': 'macd_crossover_v2',
                'strategy': 'macd_crossover',
                'params': {'fast': 12, 'slow': 26, 'signal': 9},
                'symbols': ['BTCUSDT', 'SOLUSDT'],
                'oos_sharpe': 0.85,
                'p_value': 0.02,
            },
        ]

        logger.info(f"✓ Loaded {len(validated)} validated strategies")
        return validated

    async def check_deployment_safety(
        self,
        strategy: Dict,
        leaderboard: List[Dict],
    ) -> Tuple[bool, Optional[str]]:
        """배포 안전성 확인
        1. 워크포워드 검증 통과 확인
        2. 리더보드에 최소 3일 이상 등재
        3. MC p-value < 0.05
        """
        logger.debug(f"  Safety check: {strategy['name']}")

        # 리더보드에서 전략 찾기
        leaderboard_entry = next(
            (s for s in leaderboard if s['name'] == strategy['name']),
            None,
        )

        if not leaderboard_entry:
            return False, f"{strategy['name']} not found on leaderboard"

        # 리더보드 등재 기간 확인
        days_on_leaderboard = leaderboard_entry.get('days_on_leaderboard', 0)
        if days_on_leaderboard < self.min_consecutive_days_on_leaderboard:
            return False, (
                f"{strategy['name']} only {days_on_leaderboard} days on leaderboard "
                f"(min {self.min_consecutive_days_on_leaderboard})"
            )

        # MC p-value 확인
        p_value = leaderboard_entry.get('p_value', 1.0)
        if p_value > self.min_p_value:
            return False, f"{strategy['name']} p-value {p_value:.3f} > {self.min_p_value}"

        logger.debug(f"    ✓ Passed safety checks")
        return True, None

    async def generate_deployment_plan(
        self,
        leaderboard: List[Dict],
        current_production: Dict,
        validated_strategies: List[Dict],
    ) -> DeploymentPlan:
        """배포 계획 생성"""
        logger.info("🎯 Generating deployment plan...")

        plan = DeploymentPlan()

        current_names = {s['name'] for s in current_production['active_strategies']}
        leaderboard_names = {s['name'] for s in leaderboard if s['status'] in ['active', 'validated']}

        # 1. 신규 추가 전략 식별
        for strategy in validated_strategies:
            is_safe, reason = await self.check_deployment_safety(strategy, leaderboard)

            if is_safe and strategy['name'] not in current_names:
                if len(plan.new_strategies) < self.max_changes_per_day:
                    plan.new_strategies.append(strategy)
                    logger.debug(f"    + ADD: {strategy['name']}")
                else:
                    logger.debug(
                        f"    ~ QUEUE: {strategy['name']} "
                        f"(max {self.max_changes_per_day} changes per day)"
                    )
            else:
                logger.debug(f"    ✗ SKIP: {strategy['name']} ({reason})")

        # 2. 제거 후보 식별 (리더보드에 없거나 낮은 점수)
        for current_strategy in current_production['active_strategies']:
            if current_strategy['name'] not in leaderboard_names:
                if len(plan.removed_strategies) < self.max_changes_per_day:
                    plan.removed_strategies.append(current_strategy['name'])
                    logger.debug(f"    - REMOVE: {current_strategy['name']}")

        # 3. 파라미터 업데이트 필요한 전략 식별
        for strategy in leaderboard:
            if strategy['name'] in current_names:
                current = next(s for s in current_production['active_strategies'] if s['name'] == strategy['name'])

                # 파라미터 변경 여부 확인
                if current.get('params') != strategy.get('params'):
                    if len(plan.updated_strategies) < self.max_changes_per_day:
                        plan.updated_strategies.append({
                            'name': strategy['name'],
                            'old_params': current.get('params'),
                            'new_params': strategy.get('params'),
                        })
                        logger.debug(f"    ~ UPDATE: {strategy['name']}")

        plan.total_changes = (
            len(plan.new_strategies) +
            len(plan.removed_strategies) +
            len(plan.updated_strategies)
        )

        logger.info(f"✓ Generated deployment plan: {plan}")
        return plan

    async def apply_deployment(
        self,
        plan: DeploymentPlan,
        current_production: Dict,
    ) -> Dict:
        """배포 계획 적용"""
        logger.info(f"🚀 Applying deployment plan...")

        updated_config = current_production.copy()
        active_strategies = updated_config['active_strategies'].copy()

        # 1. 제거
        for remove_name in plan.removed_strategies:
            active_strategies = [s for s in active_strategies if s['name'] != remove_name]
            logger.debug(f"  Removed: {remove_name}")

        # 2. 추가
        for new_strategy in plan.new_strategies:
            active_strategies.append({
                **new_strategy,
                'deployed_date': datetime.now().isoformat(),
            })
            logger.debug(f"  Added: {new_strategy['name']}")

        # 3. 업데이트
        for updated in plan.updated_strategies:
            for strategy in active_strategies:
                if strategy['name'] == updated['name']:
                    strategy['params'] = updated['new_params']
                    strategy['updated_date'] = datetime.now().isoformat()
                    logger.debug(f"  Updated: {updated['name']}")
                    break

        updated_config['active_strategies'] = active_strategies
        updated_config['updated_at'] = datetime.now().isoformat()
        updated_config['deployment_plan'] = plan.__dict__

        logger.info(f"✓ Deployment applied: {len(active_strategies)} active strategies")
        return updated_config

    async def store_production_config(self, config: Dict) -> None:
        """프로덕션 설정 저장 (KV + 트래킹)"""
        logger.info("💾 Storing production config...")

        # 실제: kv_set("di:quant:active-strategies", json.dumps(config['active_strategies']))
        # kv_set("di:quant:latest", json.dumps(config))

        # 배포 이력 기록
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'active_count': len(config.get('active_strategies', [])),
            'plan': config.get('deployment_plan', {}),
        }

        # 실제: log_data = json.loads(kv_get("di:agents:deployer:log") or "[]")
        # log_data.append(log_entry)
        # kv_set("di:agents:deployer:log", json.dumps(log_data))

        logger.info(f"✓ Production config stored")

    async def send_report(self, plan: DeploymentPlan, active_count: int) -> None:
        """텔레그램 리포트 전송"""
        message = "🚀 Deployed: "
        message += f"+{len(plan.new_strategies)} new"
        message += f", -{len(plan.removed_strategies)} removed"
        message += f", ~{len(plan.updated_strategies)} updated"
        message += f"\n  Active strategies: {active_count}"

        if plan.total_changes == 0:
            message = "🎯 No changes needed - all strategies optimal"

        logger.info(f"📤 {message}")
        # 실제: send_agent_report("deployer", message)

    async def run(self) -> None:
        """메인 실행 함수"""
        start_time = datetime.now()
        logger.info("=" * 70)
        logger.info("DEPLOYER AGENT START")
        logger.info("=" * 70)

        try:
            # 1. 리더보드 + 현재 프로덕션 로드
            leaderboard = await self.load_leaderboard()
            current_production = await self.load_current_production()
            validated_strategies = await self.load_validated_strategies()

            # 2. 배포 계획 생성
            plan = await self.generate_deployment_plan(
                leaderboard, current_production, validated_strategies
            )

            if plan.total_changes == 0:
                logger.info("No deployment changes needed")
                await self.send_report(plan, len(current_production['active_strategies']))
            else:
                # 3. 배포 계획 적용
                updated_config = await self.apply_deployment(plan, current_production)

                # 4. 프로덕션 설정 저장
                await self.store_production_config(updated_config)

                # 5. 리포트 전송
                await self.send_report(plan, len(updated_config['active_strategies']))

            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ DEPLOYER AGENT COMPLETE in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"✗ DEPLOYER AGENT FAILED: {e}", exc_info=True)
            raise


async def main():
    agent = DeployerAgent()
    await agent.run()


if __name__ == '__main__':
    asyncio.run(main())
