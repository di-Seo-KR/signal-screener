"""
텔레그램 알림 및 리포트 모듈
Zepta Quant Agent Team 통신 담당
"""

import os
import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List
from dataclasses import dataclass

import aiohttp
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 설정
# ═══════════════════════════════════════════════════════════════

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}"


# ═══════════════════════════════════════════════════════════════
# 데이터 클래스
# ═══════════════════════════════════════════════════════════════

@dataclass
class AgentRunResult:
    """에이전트 실행 결과"""
    agent_name: str
    status: str  # "success", "failed", "skipped"
    duration_seconds: float
    summary: str
    error_message: Optional[str] = None
    metrics: Optional[Dict[str, Any]] = None


# ═══════════════════════════════════════════════════════════════
# 동기 함수 (빠른 알림용)
# ═══════════════════════════════════════════════════════════════

def send_message(text: str, parse_mode: str = "HTML") -> bool:
    """
    텔레그램 메시지 전송 (동기)

    Args:
        text: 메시지 본문
        parse_mode: "HTML", "Markdown", "MarkdownV2"

    Returns:
        성공 여부
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("⚠️  Telegram 설정 미흡 - 메시지 전송 불가")
        return False

    try:
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": text,
            "parse_mode": parse_mode,
        }
        response = requests.post(
            f"{TELEGRAM_API_URL}/sendMessage",
            json=payload,
            timeout=10
        )

        if response.status_code == 200:
            logger.debug(f"✅ Telegram 메시지 전송 성공")
            return True
        else:
            logger.error(f"❌ Telegram API 에러: {response.text}")
            return False

    except Exception as e:
        logger.error(f"❌ Telegram 전송 실패: {e}")
        return False


def send_alert(agent_name: str, error_message: str, error_type: str = "CRITICAL") -> bool:
    """
    에러 알림 전송

    Args:
        agent_name: 에이전트 이름
        error_message: 에러 메시지
        error_type: "CRITICAL", "WARNING"

    Returns:
        성공 여부
    """
    emoji = "🔴" if error_type == "CRITICAL" else "🟡"
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S KST")

    text = f"""
{emoji} <b>Agent Error Report</b>

<b>Agent:</b> {agent_name}
<b>Level:</b> {error_type}
<b>Time:</b> {timestamp}
<b>Error:</b> {error_message}
"""

    return send_message(text.strip())


def send_heartbeat(hostname: str = "") -> bool:
    """
    주기적 heartbeat 전송

    Args:
        hostname: VPS 호스트명

    Returns:
        성공 여부
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S KST")
    text = f"💓 Agent Team alive\nHost: {hostname}\nTime: {timestamp}"
    return send_message(text)


# ═══════════════════════════════════════════════════════════════
# 비동기 함수 (배치 리포트용)
# ═══════════════════════════════════════════════════════════════

async def send_message_async(text: str, parse_mode: str = "HTML") -> bool:
    """
    텔레그램 메시지 전송 (비동기)

    Args:
        text: 메시지 본문
        parse_mode: "HTML", "Markdown", "MarkdownV2"

    Returns:
        성공 여부
    """
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning("⚠️  Telegram 설정 미흡")
        return False

    try:
        async with aiohttp.ClientSession() as session:
            payload = {
                "chat_id": TELEGRAM_CHAT_ID,
                "text": text,
                "parse_mode": parse_mode,
            }
            async with session.post(
                f"{TELEGRAM_API_URL}/sendMessage",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                if resp.status == 200:
                    logger.debug("✅ Telegram 비동기 메시지 전송 성공")
                    return True
                else:
                    text_resp = await resp.text()
                    logger.error(f"❌ Telegram API 에러: {text_resp}")
                    return False

    except Exception as e:
        logger.error(f"❌ Telegram 비동기 전송 실패: {e}")
        return False


def send_daily_digest(results: List[AgentRunResult]) -> bool:
    """
    일일 다이제스트 리포트 전송
    12:00 KST에 호출됨

    Args:
        results: 에이전트 실행 결과 리스트

    Returns:
        성공 여부
    """
    if not results:
        logger.warning("다이제스트 전송: 결과 없음")
        return False

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S KST")

    # 상태별 집계
    success_count = sum(1 for r in results if r.status == "success")
    failed_count = sum(1 for r in results if r.status == "failed")
    total_duration = sum(r.duration_seconds for r in results)

    # 결과 상세
    details = "\n".join([
        format_result_line(r) for r in results
    ])

    text = f"""
📊 <b>Daily Agent Report</b>

<b>Summary:</b>
  ✅ Success: {success_count}
  ❌ Failed: {failed_count}
  ⏱️  Total: {total_duration:.1f}s

<b>Details:</b>
{details}

<b>Time:</b> {timestamp}
"""

    return send_message(text.strip())


def format_result_line(result: AgentRunResult) -> str:
    """에이전트 결과 한 줄 포맷팅"""
    status_emoji = "✅" if result.status == "success" else "❌"
    return f"{status_emoji} <b>{result.agent_name}</b> ({result.duration_seconds:.1f}s): {result.summary}"


# ═══════════════════════════════════════════════════════════════
# 유틸리티
# ═══════════════════════════════════════════════════════════════

def validate_telegram_config() -> bool:
    """Telegram 설정 검증"""
    if not TELEGRAM_BOT_TOKEN:
        logger.error("❌ TELEGRAM_BOT_TOKEN 환경변수 필수")
        return False

    if not TELEGRAM_CHAT_ID:
        logger.error("❌ TELEGRAM_CHAT_ID 환경변수 필수")
        return False

    logger.info("✅ Telegram 설정 유효함")
    return True


if __name__ == "__main__":
    # 테스트
    logging.basicConfig(level=logging.INFO)

    if validate_telegram_config():
        # 간단한 메시지 테스트
        send_message("🚀 테스트 메시지입니다")

        # 알림 테스트
        send_alert("TestAgent", "이것은 테스트 에러입니다", "WARNING")

        # Heartbeat 테스트
        send_heartbeat("zepta-quant.dev")
