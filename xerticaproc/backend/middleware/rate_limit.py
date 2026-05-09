"""Rate limiter simples in-memory por (user_id|ip, endpoint).

Limites padrão pensados para conter custo Gemini no /chat.
Sem dependência externa — Token bucket por chave.
Para multi-réplica em prod, trocar por Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    def __init__(self, *, rate: float, burst: int):
        """rate: tokens/segundo; burst: tamanho máximo do bucket."""
        self.rate = rate
        self.burst = burst
        self._buckets: dict[str, _Bucket] = defaultdict(
            lambda: _Bucket(tokens=float(burst), updated=time.monotonic()),
        )

    def consume(self, key: str, cost: float = 1.0) -> tuple[bool, float]:
        b = self._buckets[key]
        now = time.monotonic()
        elapsed = now - b.updated
        b.tokens = min(self.burst, b.tokens + elapsed * self.rate)
        b.updated = now
        if b.tokens >= cost:
            b.tokens -= cost
            return True, b.tokens
        retry_after = (cost - b.tokens) / self.rate
        return False, retry_after


_chat_limiter = RateLimiter(rate=0.5, burst=10)  # 30 msgs/min com burst=10


def _client_key(request: Request, contratacao_id: str) -> str:
    auth = request.headers.get("authorization", "")
    user = request.headers.get("x-user-id") or auth[-24:] or "anon"
    ip = (request.client.host if request.client else "0.0.0.0")
    return f"{user}|{ip}|{contratacao_id}"


def enforce_chat_rate(request: Request, contratacao_id: str) -> None:
    """Lança HTTPException 429 se exceder o limite. Caller passa request explicitamente."""
    key = _client_key(request, contratacao_id)
    ok, info = _chat_limiter.consume(key)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail={"error": "rate_limited", "retry_after_s": round(info, 2)},
            headers={"Retry-After": str(int(info) + 1)},
        )
