#!/usr/bin/env python3
"""
Zepta Quant Agent Team Orchestrator
메인 코디네이터 — 모든 에이전트를 스케줄에 따라 실행

실행 방법:
  python orchestrator.py                      # 정상 운영
  python orchestrator.py --agent researcher   # 특정 에이전트만 실행
  python orchestrator.py --once               # 한 번만 실행 후 종료
"""

import os
import sys
import asyncio
import signal
import logging
import argparse
import socket
from datetime import datetime, timedelta
from typing import Dict, Callable, Optional, List
from pathlib import Path

import schedule
from dotenv import load_dotenv

# 로컬 모듈 임포트
from config import validate_config
from lib.telegram_report import (
    send_message,
    send_alert,
    send_heartbeat,
    send_daily_digest,
    AgentRunResult,
)

# ═══════════════════════════════════════════════════════════════
# 초기화
# ═══════════════════════════════════════════════════════════════

load_dotenv()
validate_config()

# 로깅 설정 (systemd journal로 출력)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# 글로벌 상태
_shutdown_event = asyncio.Event()
_daily_results: List[AgentRunResult] = []
_last_heartbeat: Optional[datetime] = None


# ═══════════════════════════════════════════════════════════════
# 에이전트 러너 (stub)
# ═══════════════════════════════════════════════════════════════

async def run_researcher() -> Dict:
    """마켓 리서처 에이전트 실행"""
    try:
        logger.info("🔬 Researcher 에이전트 시작...")
        # TODO: from agents.researcher import run as run_researcher_impl
        # return await run_researcher_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Researcher 에이전트 완료")
        return {"status": "success", "symbols_analyzed": 150}
    except Exception as e:
        logger.error(f"❌ Researcher 실패: {e}", exc_info=True)
        raise


async def run_backtester() -> Dict:
    """백테스터 에이전트 실행"""
    try:
        logger.info("🧪 Backtester 에이전트 시작...")
        # TODO: from agents.backtester import run as run_backtester_impl
        # return await run_backtester_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Backtester 에이전트 완료")
        return {"status": "success", "strategies_tested": 42}
    except Exception as e:
        logger.error(f"❌ Backtester 실패: {e}", exc_info=True)
        raise


async def run_evolver() -> Dict:
    """진화 알고리즘 에이전트 실행"""
    try:
        logger.info("🧬 Evolver 에이전트 시작...")
        # TODO: from agents.evolver import run as run_evolver_impl
        # return await run_evolver_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Evolver 에이전트 완료")
        return {"status": "success", "generations": 10}
    except Exception as e:
        logger.error(f"❌ Evolver 실패: {e}", exc_info=True)
        raise


async def run_evaluator() -> Dict:
    """성과 평가 에이전트 실행"""
    try:
        logger.info("📈 Evaluator 에이전트 시작...")
        # TODO: from agents.evaluator import run as run_evaluator_impl
        # return await run_evaluator_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Evaluator 에이전트 완료")
        return {"status": "success", "portfolios_ranked": 5}
    except Exception as e:
        logger.error(f"❌ Evaluator 실패: {e}", exc_info=True)
        raise


async def run_risk_tuner() -> Dict:
    """리스크 튜닝 에이전트 실행"""
    try:
        logger.info("⚖️  Risk Tuner 에이전트 시작...")
        # TODO: from agents.risk_tuner import run as run_risk_tuner_impl
        # return await run_risk_tuner_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Risk Tuner 에이전트 완료")
        return {"status": "success", "positions_adjusted": 8}
    except Exception as e:
        logger.error(f"❌ Risk Tuner 실패: {e}", exc_info=True)
        raise


async def run_deployer() -> Dict:
    """배포 에이전트 실행"""
    try:
        logger.info("🚀 Deployer 에이전트 시작...")
        # TODO: from agents.deployer import run as run_deployer_impl
        # return await run_deployer_impl()
        await asyncio.sleep(1)  # 시뮬레이션
        logger.info("✅ Deployer 에이전트 완료")
        return {"status": "success", "strategies_deployed": 3}
    except Exception as e:
        logger.error(f"❌ Deployer 실패: {e}", exc_info=True)
        raise


# ═══════════════════════════════════════════════════════════════
# 에이전트 래퍼 (예외 처리 + 텔레그램 알림)
# ═══════════════════════════════════════════════════════════════

async def run_agent_safe(
    agent_name: str,
    agent_func: Callable,
) -> AgentRunResult:
    """
    에이전트를 안전하게 실행하고 결과를 추적

    Args:
        agent_name: 에이전트 이름 (예: "Researcher")
        agent_func: 비동기 에이전트 함수

    Returns:
        AgentRunResult 객체
    """
    start_time = datetime.now()

    try:
        logger.info(f"▶️  {agent_name} 시작...")
        result = await agent_func()
        duration = (datetime.now() - start_time).total_seconds()

        logger.info(f"✅ {agent_name} 완료 ({duration:.1f}s)")

        return AgentRunResult(
            agent_name=agent_name,
            status="success",
            duration_seconds=duration,
            summary=str(result),
            metrics=result if isinstance(result, dict) else None,
        )

    except Exception as e:
        duration = (datetime.now() - start_time).total_seconds()
        error_msg = str(e)

        logger.error(f"❌ {agent_name} 실패: {error_msg}")

        # Telegram 알림
        send_alert(agent_name, error_msg, "CRITICAL")

        return AgentRunResult(
            agent_name=agent_name,
            status="failed",
            duration_seconds=duration,
            summary=f"Error: {error_msg}",
            error_message=error_msg,
        )


# ═══════════════════════════════════════════════════════════════
# 스케줄 작업
# ═══════════════════════════════════════════════════════════════

async def job_researcher():
    """07:00 KST: Researcher"""
    result = await run_agent_safe("Researcher", run_researcher)
    _daily_results.append(result)


async def job_backtester():
    """08:00 KST: Backtester"""
    result = await run_agent_safe("Backtester", run_backtester)
    _daily_results.append(result)


async def job_evolver():
    """09:00 KST: Evolver"""
    result = await run_agent_safe("Evolver", run_evolver)
    _daily_results.append(result)


async def job_evaluator():
    """10:00 KST: Evaluator"""
    result = await run_agent_safe("Evaluator", run_evaluator)
    _daily_results.append(result)


async def job_deployer():
    """11:00 KST: Deployer"""
    result = await run_agent_safe("Deployer", run_deployer)
    _daily_results.append(result)


async def job_risk_tuner():
    """매 6시간마다: Risk Tuner (00:00, 06:00, 12:00, 18:00 KST)"""
    result = await run_agent_safe("Risk Tuner", run_risk_tuner)
    _daily_results.append(result)


async def job_daily_digest():
    """12:00 KST: Daily Digest Report"""
    logger.info("📊 Daily Digest 준비 중...")

    if _daily_results:
        send_daily_digest(_daily_results)
        logger.info(f"✅ Daily Digest 전송됨 ({len(_daily_results)} 에이전트)")
        # 다음 날을 위해 리셋
        _daily_results.clear()
    else:
        logger.info("ℹ️  Daily Digest: 리포팅할 결과 없음")


async def job_heartbeat():
    """매 12시간마다: Heartbeat (00:00, 12:00 KST)"""
    global _last_heartbeat
    hostname = socket.gethostname()
    send_heartbeat(hostname)
    _last_heartbeat = datetime.now()
    logger.info(f"💓 Heartbeat 전송 ({hostname})")


# ═══════════════════════════════════════════════════════════════
# 스케줄러 루프
# ═══════════════════════════════════════════════════════════════

def schedule_jobs():
    """모든 작업 스케줄링"""
    # 일일 작업
    schedule.every().day.at("07:00").do(lambda: asyncio.create_task(job_researcher()))
    schedule.every().day.at("08:00").do(lambda: asyncio.create_task(job_backtester()))
    schedule.every().day.at("09:00").do(lambda: asyncio.create_task(job_evolver()))
    schedule.every().day.at("10:00").do(lambda: asyncio.create_task(job_evaluator()))
    schedule.every().day.at("11:00").do(lambda: asyncio.create_task(job_deployer()))
    schedule.every().day.at("12:00").do(lambda: asyncio.create_task(job_daily_digest()))

    # 6시간 주기 (Risk Tuner)
    schedule.every(6).hours.do(lambda: asyncio.create_task(job_risk_tuner()))

    # 12시간 주기 (Heartbeat)
    schedule.every(12).hours.do(lambda: asyncio.create_task(job_heartbeat()))

    logger.info("✅ 모든 작업 스케줄 등록됨")


async def scheduler_loop():
    """스케줄러 메인 루프"""
    while not _shutdown_event.is_set():
        try:
            # 스케줄 확인 및 실행
            schedule.run_pending()
            await asyncio.sleep(60)  # 1분마다 체크

        except Exception as e:
            logger.error(f"❌ 스케줄 루프 에러: {e}", exc_info=True)
            await asyncio.sleep(60)


# ═══════════════════════════════════════════════════════════════
# 시그널 핸들링 (Graceful Shutdown)
# ═══════════════════════════════════════════════════════════════

def handle_signal(signum, frame):
    """SIGTERM/SIGINT 핸들러"""
    logger.warning(f"⚠️  시그널 수신 ({signum}), 종료 중...")
    _shutdown_event.set()


# ═══════════════════════════════════════════════════════════════
# CLI: 개별 에이전트 실행
# ═══════════════════════════════════════════════════════════════

async def run_single_agent(agent_name: str):
    """개별 에이전트 실행 (CLI)"""
    agent_map = {
        "researcher": ("Researcher", run_researcher),
        "backtester": ("Backtester", run_backtester),
        "evolver": ("Evolver", run_evolver),
        "evaluator": ("Evaluator", run_evaluator),
        "risk_tuner": ("Risk Tuner", run_risk_tuner),
        "deployer": ("Deployer", run_deployer),
    }

    if agent_name not in agent_map:
        logger.error(f"❌ 알 수 없는 에이전트: {agent_name}")
        logger.info(f"   가능한 에이전트: {', '.join(agent_map.keys())}")
        sys.exit(1)

    display_name, func = agent_map[agent_name]
    result = await run_agent_safe(display_name, func)

    # 결과 출력
    print(f"\n{'='*60}")
    print(f"Agent: {result.agent_name}")
    print(f"Status: {result.status.upper()}")
    print(f"Duration: {result.duration_seconds:.1f}s")
    print(f"Summary: {result.summary}")
    if result.error_message:
        print(f"Error: {result.error_message}")
    print(f"{'='*60}\n")

    # Exit code
    sys.exit(0 if result.status == "success" else 1)


async def run_all_agents():
    """모든 에이전트를 순차 실행 (--once 또는 --all)"""
    logger.info("🔄 모든 에이전트를 순차 실행합니다...")

    agents = [
        ("Researcher", run_researcher),
        ("Backtester", run_backtester),
        ("Evolver", run_evolver),
        ("Evaluator", run_evaluator),
        ("Risk Tuner", run_risk_tuner),
        ("Deployer", run_deployer),
    ]

    results = []
    for name, func in agents:
        result = await run_agent_safe(name, func)
        results.append(result)

    # 요약 리포트
    print(f"\n{'='*60}")
    print("All Agents Summary:")
    print(f"{'='*60}")
    for result in results:
        status_emoji = "✅" if result.status == "success" else "❌"
        print(
            f"{status_emoji} {result.agent_name:15} | "
            f"{result.duration_seconds:6.1f}s | "
            f"{result.summary[:40]}"
        )
    print(f"{'='*60}\n")

    success_count = sum(1 for r in results if r.status == "success")
    total_duration = sum(r.duration_seconds for r in results)
    logger.info(
        f"✅ 완료: {success_count}/{len(results)} 성공, "
        f"총 {total_duration:.1f}s 소요"
    )

    sys.exit(0 if success_count == len(results) else 1)


# ═══════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════

async def main(args):
    """메인 진입점"""

    hostname = socket.gethostname()

    if args.agent:
        # 개별 에이전트 실행
        await run_single_agent(args.agent)

    elif args.once or args.all:
        # 모든 에이전트 한 번 실행 후 종료
        await run_all_agents()

    else:
        # 정상 운영: 스케줄러 루프
        logger.info(f"🚀 Zepta Agent Team started on {hostname}")
        send_message(f"🚀 Zepta Agent Team started on {hostname}")

        schedule_jobs()

        # 시그널 핸들러 등록
        signal.signal(signal.SIGTERM, handle_signal)
        signal.signal(signal.SIGINT, handle_signal)

        try:
            await scheduler_loop()

        except KeyboardInterrupt:
            logger.info("⚠️  키보드 인터럽트")

        finally:
            logger.warning("🛑 Agent Team 종료 중...")
            send_message("🛑 Agent Team shutdown")
            await asyncio.sleep(0.5)


def main_sync():
    """동기 진입점"""
    parser = argparse.ArgumentParser(
        description="Zepta Quant Agent Team Orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python orchestrator.py                    # 정상 운영 (스케줄 모드)
  python orchestrator.py --agent researcher  # Researcher 에이전트만 실행
  python orchestrator.py --once              # 모든 에이전트 한 번 실행
        """,
    )

    parser.add_argument(
        "--agent",
        type=str,
        choices=["researcher", "backtester", "evolver", "evaluator", "risk_tuner", "deployer"],
        help="개별 에이전트 실행",
    )

    parser.add_argument(
        "--once",
        action="store_true",
        help="모든 에이전트를 한 번 실행 후 종료",
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="모든 에이전트를 한 번 실행 후 종료 (--once의 별칭)",
    )

    args = parser.parse_args()

    # asyncio 실행
    asyncio.run(main(args))


if __name__ == "__main__":
    main_sync()
