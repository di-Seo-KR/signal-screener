"""
Vercel KV (Redis-compatible) 래퍼

프로젝트는 Vercel KV를 사용하므로, REST API를 통한 접근 또는
Python Redis 라이브러리를 통한 접근을 지원합니다.

환경변수:
  - VERCEL_KV_REST_API_URL: REST API 엔드포인트
  - VERCEL_KV_REST_API_TOKEN: 인증 토큰
  - REDIS_HOST: Redis 호스트 (직접 접근)
  - REDIS_PORT: Redis 포트
  - REDIS_PASSWORD: Redis 패스워드
"""

import json
import os
import logging
from typing import Any, Dict, List, Optional
from datetime import timedelta

import requests

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════
# 환경변수
# ═══════════════════════════════════════════════════════════════

KV_MODE = os.getenv("KV_MODE", "rest")  # "rest" or "redis"
KV_REST_API_URL = os.getenv("VERCEL_KV_REST_API_URL", "")
KV_REST_API_TOKEN = os.getenv("VERCEL_KV_REST_API_TOKEN", "")

REDIS_HOST = os.getenv("REDIS_HOST", "")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

# ═══════════════════════════════════════════════════════════════
# REST API 모드 (Vercel KV)
# ═══════════════════════════════════════════════════════════════

class RestKVClient:
    """Vercel KV REST API 클라이언트"""

    def __init__(self, url: str, token: str):
        self.url = url.rstrip("/")
        self.token = token
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        })

    def _request(self, method: str, *args, **kwargs) -> Any:
        """HTTP 요청"""
        try:
            resp = self.session.request(method, *args, **kwargs, timeout=10)
            if resp.status_code >= 400:
                logger.error(f"KV 오류 {resp.status_code}: {resp.text}")
                return None
            return resp.json()
        except requests.RequestException as e:
            logger.error(f"KV 요청 오류: {e}")
            return None

    def get(self, key: str) -> Optional[Any]:
        """키 조회"""
        # Vercel KV REST: GET /{key}
        url = f"{self.url}/get/{key}"
        result = self._request("GET", url)
        if result and "result" in result:
            return result["result"]
        return None

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        """키 설정 (with optional expiry in seconds)"""
        # Vercel KV REST: POST /{key}
        url = f"{self.url}/set/{key}"
        body = {
            "value": value,
        }
        if ex:
            body["ex"] = ex  # 초 단위 만료시간

        result = self._request("POST", url, json=body)
        return result is not None

    def delete(self, key: str) -> bool:
        """키 삭제"""
        url = f"{self.url}/del/{key}"
        result = self._request("POST", url)
        return result is not None

    def keys(self, pattern: str) -> List[str]:
        """패턴으로 키 검색"""
        url = f"{self.url}/keys/{pattern}"
        result = self._request("GET", url)
        if result and "result" in result:
            return result["result"]
        return []

    def mget(self, *keys: str) -> Dict[str, Any]:
        """여러 키 조회"""
        url = f"{self.url}/mget"
        body = {"keys": list(keys)}
        result = self._request("POST", url, json=body)
        if result and "result" in result:
            return dict(zip(keys, result["result"]))
        return {}

    def mset(self, **kwargs) -> bool:
        """여러 키 설정"""
        url = f"{self.url}/mset"
        body = {"keyvalues": kwargs}
        result = self._request("POST", url, json=body)
        return result is not None


# ═══════════════════════════════════════════════════════════════
# Redis 직접 접근 모드
# ═══════════════════════════════════════════════════════════════

class RedisKVClient:
    """Redis 클라이언트 (선택적)"""

    def __init__(self, host: str, port: int, password: str = ""):
        try:
            import redis
            self.redis = redis.Redis(
                host=host,
                port=port,
                password=password,
                decode_responses=True,
                socket_connect_timeout=5,
            )
            # 연결 테스트
            self.redis.ping()
            logger.info("✅ Redis 연결 성공")
        except Exception as e:
            logger.error(f"Redis 연결 실패: {e}")
            self.redis = None

    def get(self, key: str) -> Optional[Any]:
        """키 조회 (JSON 역직렬화)"""
        if not self.redis:
            return None
        try:
            val = self.redis.get(key)
            if val:
                return json.loads(val)
            return None
        except Exception as e:
            logger.error(f"Redis GET 오류 {key}: {e}")
            return None

    def set(self, key: str, value: Any, ex: Optional[int] = None) -> bool:
        """키 설정 (JSON 직렬화)"""
        if not self.redis:
            return False
        try:
            self.redis.set(key, json.dumps(value), ex=ex)
            return True
        except Exception as e:
            logger.error(f"Redis SET 오류 {key}: {e}")
            return False

    def delete(self, key: str) -> bool:
        """키 삭제"""
        if not self.redis:
            return False
        try:
            self.redis.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis DEL 오류 {key}: {e}")
            return False

    def keys(self, pattern: str) -> List[str]:
        """패턴으로 키 검색"""
        if not self.redis:
            return []
        try:
            return self.redis.keys(pattern)
        except Exception as e:
            logger.error(f"Redis KEYS 오류 {pattern}: {e}")
            return []

    def mget(self, *keys: str) -> Dict[str, Any]:
        """여러 키 조회"""
        if not self.redis:
            return {}
        try:
            vals = self.redis.mget(list(keys))
            return {k: json.loads(v) if v else None for k, v in zip(keys, vals)}
        except Exception as e:
            logger.error(f"Redis MGET 오류: {e}")
            return {}

    def mset(self, **kwargs) -> bool:
        """여러 키 설정"""
        if not self.redis:
            return False
        try:
            # JSON 직렬화
            data = {k: json.dumps(v) for k, v in kwargs.items()}
            self.redis.mset(data)
            return True
        except Exception as e:
            logger.error(f"Redis MSET 오류: {e}")
            return False


# ═══════════════════════════════════════════════════════════════
# 글로벌 클라이언트 초기화
# ═══════════════════════════════════════════════════════════════

_client: Optional[Any] = None


def init_kv_client():
    """KV 클라이언트 초기화"""
    global _client

    if KV_MODE == "redis" and REDIS_HOST:
        _client = RedisKVClient(REDIS_HOST, REDIS_PORT, REDIS_PASSWORD)
    elif KV_REST_API_URL and KV_REST_API_TOKEN:
        _client = RestKVClient(KV_REST_API_URL, KV_REST_API_TOKEN)
    else:
        raise RuntimeError("KV 스토리지 설정 필수: VERCEL_KV_REST_API_URL 또는 REDIS_HOST")

    logger.info(f"✅ KV 클라이언트 초기화 (mode={KV_MODE})")
    return _client


def get_kv_client():
    """KV 클라이언트 조회"""
    global _client
    if _client is None:
        init_kv_client()
    return _client


# ═══════════════════════════════════════════════════════════════
# 공개 API
# ═══════════════════════════════════════════════════════════════

def kv_get(key: str) -> Optional[Any]:
    """
    KV에서 값 조회

    Args:
        key: KV 키

    Returns:
        JSON 파싱된 값 또는 None
    """
    client = get_kv_client()
    return client.get(key)


def kv_set(key: str, value: Any, ex: Optional[int] = None) -> bool:
    """
    KV에 값 설정

    Args:
        key: KV 키
        value: JSON 직렬화 가능한 값
        ex: 만료시간 (초 단위, 기본값=없음)

    Returns:
        성공 여부
    """
    client = get_kv_client()
    return client.set(key, value, ex=ex)


def kv_delete(key: str) -> bool:
    """
    KV에서 키 삭제

    Args:
        key: KV 키

    Returns:
        성공 여부
    """
    client = get_kv_client()
    return client.delete(key)


def kv_list(prefix: str) -> List[str]:
    """
    프리픽스로 키 검색

    Args:
        prefix: 검색 프리픽스 (예: "di:agents:strategy")

    Returns:
        매칭된 키 리스트
    """
    client = get_kv_client()
    return client.keys(f"{prefix}*")


def kv_get_multiple(keys: List[str]) -> Dict[str, Any]:
    """
    여러 키 한번에 조회

    Args:
        keys: 조회할 키 리스트

    Returns:
        {key: value} 딕셔너리
    """
    client = get_kv_client()
    return client.mget(*keys)


def kv_set_multiple(**kwargs) -> bool:
    """
    여러 키 한번에 설정

    Args:
        **kwargs: {key: value, ...}

    Returns:
        성공 여부
    """
    client = get_kv_client()
    return client.mset(**kwargs)


# ═══════════════════════════════════════════════════════════════
# JSON 직렬화 헬퍼
# ═══════════════════════════════════════════════════════════════

def kv_get_json(key: str, default: Any = None) -> Any:
    """JSON 값 조회"""
    val = kv_get(key)
    return val if val is not None else default


def kv_set_json(key: str, obj: Any, ex: Optional[int] = None) -> bool:
    """JSON 값 저장"""
    return kv_set(key, obj, ex=ex)


# ═══════════════════════════════════════════════════════════════
# 만료시간 헬퍼
# ═══════════════════════════════════════════════════════════════

def seconds_until(delta: timedelta) -> int:
    """timedelta를 초 단위로 변환"""
    return int(delta.total_seconds())


def hours_to_seconds(hours: int) -> int:
    """시간을 초로 변환"""
    return hours * 3600


def days_to_seconds(days: int) -> int:
    """일을 초로 변환"""
    return days * 86400


if __name__ == "__main__":
    # 테스트
    import sys

    logging.basicConfig(level=logging.INFO)

    try:
        # 클라이언트 초기화
        client = init_kv_client()

        # 테스트 데이터 설정
        test_key = "di:agents:test:data"
        test_value = {"message": "Hello KV", "timestamp": "2026-04-11"}
        print(f"▶ {test_key} = {test_value}")
        success = kv_set(test_key, test_value)
        print(f"  결과: {'✅' if success else '❌'}")

        # 조회
        retrieved = kv_get(test_key)
        print(f"▶ 조회: {retrieved}")

        # 삭제
        success = kv_delete(test_key)
        print(f"▶ 삭제: {'✅' if success else '❌'}")

    except Exception as e:
        print(f"❌ {e}")
        sys.exit(1)
