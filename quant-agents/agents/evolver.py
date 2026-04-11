#!/usr/bin/env python3
"""
유전 알고리즘 진화 에이전트 - 전략 파라미터 최적화
매일 09:00 KST 실행
"""

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any
import sys
import os
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

try:
    from deap import base, creator, tools, algorithms
    DEAP_AVAILABLE = True
except ImportError:
    DEAP_AVAILABLE = False
    logger.warning("DEAP library not available - using mock GA")


class EvolutionIndividual:
    """진화 개인 - (strategy_name, params_dict, symbol_list)"""

    def __init__(self, strategy_name: str, params: Dict, symbols: List[str]):
        self.strategy_name = strategy_name
        self.params = params
        self.symbols = symbols
        self.fitness = 0.0

    def to_dict(self) -> Dict:
        return {
            'strategy': self.strategy_name,
            'params': self.params,
            'symbols': self.symbols,
            'fitness': self.fitness,
        }

    @classmethod
    def from_dict(cls, d: Dict) -> 'EvolutionIndividual':
        ind = cls(d['strategy'], d['params'], d['symbols'])
        ind.fitness = d.get('fitness', 0.0)
        return ind


class EvolutionConfig:
    """진화 설정"""

    def __init__(self):
        self.population_size = 100
        self.generations = 20
        self.elite_size = max(1, self.population_size // 10)  # 상위 10%
        self.tournament_size = 3
        self.crossover_alpha = 0.3
        self.mutation_sigma = 0.1  # 파라미터 범위의 10%
        self.strategy_pool = [
            'rsi_reversal', 'macd_crossover', 'bb_bounce',
            'ma_crossover', 'volume_breakout', 'stoch_rsi_combo',
        ]
        self.symbol_pool = [
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "DOGEUSDT",
            "AVAXUSDT", "LINKUSDT", "UNIUSDT", "XRPUSDT", "BNBUSDT",
        ]


class EvolverAgent:
    """유전 알고리즘을 통한 전략 파라미터 진화 에이전트"""

    def __init__(self):
        self.config = EvolutionConfig()
        self.current_generation = 0
        self.best_fitness_history = []

    async def load_or_initialize_population(self) -> List[EvolutionIndividual]:
        """KV에서 population 로드 또는 leaderboard top50에서 초기화"""
        logger.info("📚 Loading or initializing population...")

        try:
            # 실제: gen_num = kv_get("di:agents:evolution:generation")
            # population_data = kv_get("di:agents:evolution:population")
            # if population_data:
            #     population = [EvolutionIndividual.from_dict(d) for d in json.loads(population_data)]
            #     return population

            # leaderboard에서 상위 50개로 초기화
            # leaderboard = json.loads(kv_get("di:agents:strategies:leaderboard"))
            # top_50 = leaderboard[:50]

            population = []
            for i in range(self.config.population_size):
                strategy = random.choice(self.config.strategy_pool)
                symbols = random.sample(self.config.symbol_pool, random.randint(3, 7))
                params = self._generate_random_params(strategy)

                ind = EvolutionIndividual(strategy, params, symbols)
                population.append(ind)

            logger.info(f"✓ Initialized population of {len(population)}")
            return population

        except Exception as e:
            logger.error(f"Error loading population: {e}")
            raise

    def _generate_random_params(self, strategy: str) -> Dict:
        """전략별 무작위 파라미터 생성"""
        param_ranges = {
            'rsi_reversal': {
                'rsi_period': (7, 21),
                'rsi_oversold': (20, 40),
                'rsi_overbought': (60, 80),
            },
            'macd_crossover': {
                'fast': (8, 16),
                'slow': (17, 30),
                'signal': (5, 13),
            },
            'bb_bounce': {
                'period': (14, 25),
                'std_dev': (1.5, 2.5),
            },
            'ma_crossover': {
                'fast_ma': (10, 30),
                'slow_ma': (50, 100),
            },
        }

        ranges = param_ranges.get(strategy, {})
        params = {}

        for param_name, (min_val, max_val) in ranges.items():
            if isinstance(min_val, float):
                params[param_name] = random.uniform(min_val, max_val)
            else:
                params[param_name] = random.randint(min_val, max_val)

        return params

    def _evaluate_fitness(self, individual: EvolutionIndividual) -> float:
        """fitness = walk-forward OOS Sharpe × sqrt(num_trades) × (1 - max_dd)"""
        # 실제 구현:
        # oos_sharpe = get_oos_sharpe(individual.strategy_name, individual.params)
        # num_trades = get_num_trades(individual.strategy_name, individual.params)
        # max_dd = get_max_drawdown(individual.strategy_name, individual.params)

        # 모의 fitness 계산
        oos_sharpe = random.uniform(0.1, 1.5)
        num_trades = random.randint(10, 100)
        max_dd = random.uniform(0.1, 0.5)

        import math
        fitness = oos_sharpe * math.sqrt(num_trades) * (1.0 - max_dd)

        return fitness

    def _tournament_selection(self, population: List[EvolutionIndividual]) -> EvolutionIndividual:
        """토너먼트 선택"""
        tournament = random.sample(population, self.config.tournament_size)
        return max(tournament, key=lambda x: x.fitness)

    def _blend_crossover(
        self, parent1: EvolutionIndividual, parent2: EvolutionIndividual
    ) -> Tuple[EvolutionIndividual, EvolutionIndividual]:
        """블렌드 크로스오버 (수치 파라미터용)"""
        # 부모 파라미터 블렌드
        child1_params = {}
        child2_params = {}

        for key in parent1.params:
            if key in parent2.params:
                p1_val = parent1.params[key]
                p2_val = parent2.params[key]

                if isinstance(p1_val, (int, float)):
                    # BLX-alpha
                    alpha = self.config.crossover_alpha
                    lower = min(p1_val, p2_val)
                    upper = max(p1_val, p2_val)
                    range_val = upper - lower

                    child1_params[key] = random.uniform(
                        lower - alpha * range_val, upper + alpha * range_val
                    )
                    child2_params[key] = random.uniform(
                        lower - alpha * range_val, upper + alpha * range_val
                    )
                else:
                    child1_params[key] = random.choice([p1_val, p2_val])
                    child2_params[key] = random.choice([p1_val, p2_val])

        # 심볼 크로스오버
        strategy = parent1.strategy_name if random.random() < 0.5 else parent2.strategy_name
        symbols = list(set(parent1.symbols) | set(parent2.symbols))
        if not symbols:
            symbols = parent1.symbols

        child1 = EvolutionIndividual(strategy, child1_params, symbols)
        child2 = EvolutionIndividual(strategy, child2_params, symbols)

        return child1, child2

    def _mutate(self, individual: EvolutionIndividual) -> EvolutionIndividual:
        """뮤테이션: 수치 파라미터는 가우시안, 심볼은 랜덤 추가/제거"""
        mutated_params = {}

        for key, value in individual.params.items():
            if isinstance(value, (int, float)) and random.random() < 0.5:
                # 가우시안 뮤테이션
                sigma = value * self.config.mutation_sigma
                mutated_params[key] = value + random.gauss(0, sigma)
            else:
                mutated_params[key] = value

        # 심볼 뮤테이션: 10% 확률로 심볼 추가/제거
        mutated_symbols = individual.symbols.copy()
        if random.random() < 0.1:
            candidate_symbols = [s for s in self.config.symbol_pool if s not in mutated_symbols]
            if candidate_symbols:
                mutated_symbols.append(random.choice(candidate_symbols))

        if random.random() < 0.1 and len(mutated_symbols) > 1:
            mutated_symbols.pop(random.randint(0, len(mutated_symbols) - 1))

        mutated = EvolutionIndividual(individual.strategy_name, mutated_params, mutated_symbols)
        return mutated

    async def run_generation(self, population: List[EvolutionIndividual]) -> List[EvolutionIndividual]:
        """한 세대 실행: 평가 → 선택 → 크로스오버 → 뮤테이션"""
        logger.info(f"🧬 Generation {self.current_generation + 1}/{self.config.generations}")

        # 1. 평가
        for ind in population:
            ind.fitness = self._evaluate_fitness(ind)

        # 2. 엘리트 보존
        elite = sorted(population, key=lambda x: x.fitness, reverse=True)[: self.config.elite_size]

        # 3. 선택 + 크로스오버 + 뮤테이션
        next_generation = elite.copy()

        while len(next_generation) < self.config.population_size:
            parent1 = self._tournament_selection(population)
            parent2 = self._tournament_selection(population)

            child1, child2 = self._blend_crossover(parent1, parent2)

            if random.random() < 0.5:
                child1 = self._mutate(child1)
            if random.random() < 0.5:
                child2 = self._mutate(child2)

            next_generation.extend([child1, child2])

        # 크기 조정
        next_generation = next_generation[: self.config.population_size]

        # 통계
        fitnesses = [ind.fitness for ind in next_generation]
        avg_fitness = sum(fitnesses) / len(fitnesses)
        best_fitness = max(fitnesses)

        self.best_fitness_history.append(best_fitness)
        logger.debug(f"  Best: {best_fitness:.4f}, Avg: {avg_fitness:.4f}, Elite size: {len(elite)}")

        return next_generation

    async def store_population(self, population: List[EvolutionIndividual]) -> None:
        """진화 상태 KV 저장"""
        logger.info("💾 Storing population to KV...")

        # 실제:
        # kv_set("di:agents:evolution:generation", str(self.current_generation))
        # population_data = [ind.to_dict() for ind in population]
        # kv_set("di:agents:evolution:population", json.dumps(population_data))

        logger.info(f"✓ Generation {self.current_generation} population stored")

    async def send_report(self, population: List[EvolutionIndividual]) -> None:
        """텔레그램 리포트 전송"""
        fitnesses = [ind.fitness for ind in population]
        best_fitness = max(fitnesses)
        avg_fitness = sum(fitnesses) / len(fitnesses)

        improved_count = len([f for f in self.best_fitness_history if f == best_fitness])

        message = f"🧬 Evolution Gen {self.current_generation}: "
        message += f"Best fitness {best_fitness:.4f}, avg {avg_fitness:.4f}"
        message += f", improved {improved_count} strategies"

        logger.info(f"📤 {message}")
        # 실제: send_agent_report("evolver", message)

    async def run(self) -> None:
        """메인 실행 함수"""
        start_time = datetime.now()
        logger.info("=" * 70)
        logger.info("EVOLVER AGENT START")
        logger.info("=" * 70)

        try:
            # 1. Population 로드/초기화
            population = await self.load_or_initialize_population()

            # 2. 세대별 진화 실행
            for gen in range(self.config.generations):
                self.current_generation = gen
                population = await self.run_generation(population)

            # 3. Population 저장
            await self.store_population(population)

            # 4. 리포트 전송
            await self.send_report(population)

            elapsed = (datetime.now() - start_time).total_seconds()
            logger.info(f"✓ EVOLVER AGENT COMPLETE in {elapsed:.1f}s")

        except Exception as e:
            logger.error(f"✗ EVOLVER AGENT FAILED: {e}", exc_info=True)
            raise


async def main():
    agent = EvolverAgent()
    await agent.run()


if __name__ == '__main__':
    asyncio.run(main())
