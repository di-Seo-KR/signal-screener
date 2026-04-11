#!/usr/bin/env python3
"""
개별 에이전트 실행 도구
테스트 및 개발용 CLI

사용법:
  python run_agent.py researcher
  python run_agent.py backtester
  python run_agent.py evolver
  python run_agent.py evaluator
  python run_agent.py risk_tuner
  python run_agent.py deployer
  python run_agent.py all  # 순차 실행
"""

import sys
import asyncio
import logging
from typing import Optional

from dotenv import load_dotenv

from config import validate_config
from orchestrator import (
    run_researcher,
    run_backtester,
    run_evolver,
    run_evaluator,
    run_risk_tuner,
    run_deployer,
    run_agent_safe,
    run_all_agents,
)

# ═══════════════════════════════════════════════════════════════
# 초기화
# ═══════════════════════════════════════════════════════════════

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

try:
    validate_config()
except RuntimeError as e:
    logger.error(f"❌ 설정 오류: {e}")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════
# CLI 메인
# ═══════════════════════════════════════════════════════════════

async def main(agent_name: str):
    """메인 함수"""

    if agent_name == "all":
        # 모든 에이전트 순차 실행
        await run_all_agents()
        return

    # 개별 에이전트 맵
    agent_map = {
        "researcher": ("🔬 Researcher", run_researcher),
        "backtester": ("🧪 Backtester", run_backtester),
        "evolver": ("🧬 Evolver", run_evolver),
        "evaluator": ("📈 Evaluator", run_evaluator),
        "risk_tuner": ("⚖️  Risk Tuner", run_risk_tuner),
        "deployer": ("🚀 Deployer", run_deployer),
    }

    if agent_name not in agent_map:
        print(f"\n❌ 알 수 없는 에이전트: {agent_name}\n")
        print("가능한 에이전트:")
        for name, (display, _) in agent_map.items():
            print(f"  • {name:15} {display}")
        print(f"  • all             모든 에이전트 순차 실행\n")
        sys.exit(1)

    # 에이전트 실행
    display_name, func = agent_map[agent_name]
    logger.info(f"시작: {display_name}")

    result = await run_agent_safe(display_name, func)

    # 상세 결과 출력
    print(f"\n{'=' * 70}")
    print(f"  Agent: {result.agent_name}")
    print(f"  Status: {result.status.upper()}")
    print(f"  Duration: {result.duration_seconds:.2f}s")
    print(f"  Summary: {result.summary}")
    if result.error_message:
        print(f"  Error: {result.error_message}")
    if result.metrics:
        print(f"  Metrics: {result.metrics}")
    print(f"{'=' * 70}\n")

    # Exit code
    exit_code = 0 if result.status == "success" else 1
    logger.info(f"종료 코드: {exit_code}")
    sys.exit(exit_code)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("\n사용법: python run_agent.py <agent_name>\n")
        print("가능한 에이전트:")
        print("  • researcher    마켓 리서처 에이전트")
        print("  • backtester    백테스터 에이전트")
        print("  • evolver       진화 알고리즘 에이전트")
        print("  • evaluator     성과 평가 에이전트")
        print("  • risk_tuner    리스크 튜닝 에이전트")
        print("  • deployer      배포 에이전트")
        print("  • all           모든 에이전트 순차 실행\n")
        sys.exit(1)

    agent_name = sys.argv[1].lower()
    asyncio.run(main(agent_name))
