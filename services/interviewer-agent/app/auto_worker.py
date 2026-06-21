from __future__ import annotations

import argparse
import asyncio
import os
import socket
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol

import redis.asyncio as redis
from redis.exceptions import ResponseError

from app.adapters.realtime_api import HttpRealtimeApiClient
from app.domain.models import EventType
from app.live_worker import run_live_worker


DEFAULT_STREAM_KEY = "prelude:agent-join:stream"
DEFAULT_CONSUMER_GROUP = "prelude-live-workers"
DEFAULT_PENDING_IDLE_SECONDS = 30


def log(message: str, **fields: object) -> None:
    payload = " ".join(f"{key}={value}" for key, value in fields.items() if value is not None)
    prefix = datetime.now(timezone.utc).isoformat(timespec="seconds")
    print(f"{prefix} {message} {payload}".rstrip(), flush=True)


@dataclass(frozen=True)
class AgentJoinJob:
    session_id: str
    candidate_id: str | None = None
    attempts: int = 0
    message_id: str | None = None


class AgentJoinQueue(Protocol):
    async def next_job(self) -> AgentJoinJob | None: ...

    async def ack(self, job: AgentJoinJob) -> None: ...

    async def retry(self, job: AgentJoinJob, reason: str) -> None: ...

    async def close(self) -> None: ...


class RedisAgentJoinQueue:
    def __init__(
        self,
        *,
        redis_url: str,
        stream_key: str = DEFAULT_STREAM_KEY,
        consumer_group: str = DEFAULT_CONSUMER_GROUP,
        consumer_name: str | None = None,
        poll_timeout_seconds: int = 5,
        pending_idle_seconds: int = DEFAULT_PENDING_IDLE_SECONDS,
        max_attempts: int = 3,
    ) -> None:
        self._client = redis.from_url(redis_url, decode_responses=True)
        self._stream_key = stream_key
        self._consumer_group = consumer_group
        self._consumer_name = consumer_name or socket.gethostname()
        self._dead_letter_key = f"{stream_key}:dead"
        self._poll_timeout_seconds = poll_timeout_seconds
        self._pending_idle_ms = max(pending_idle_seconds, 1) * 1000
        self._max_attempts = max_attempts
        self._group_ready = False

    async def next_job(self) -> AgentJoinJob | None:
        await self._ensure_group()
        claimed_job = await self._claim_stale_job()
        if claimed_job is not None:
            return claimed_job

        response = await self._client.xreadgroup(
            groupname=self._consumer_group,
            consumername=self._consumer_name,
            streams={self._stream_key: ">"},
            count=1,
            block=self._poll_timeout_seconds * 1000,
        )
        if not response:
            return None

        _, messages = response[0]
        message_id, payload = messages[0]
        return await self._job_from_message(message_id, payload)

    async def _claim_stale_job(self) -> AgentJoinJob | None:
        _, messages, _ = await self._client.xautoclaim(
            self._stream_key,
            self._consumer_group,
            self._consumer_name,
            min_idle_time=self._pending_idle_ms,
            start_id="0-0",
            count=1,
        )
        if not messages:
            return None

        message_id, payload = messages[0]
        return await self._job_from_message(message_id, payload)

    async def _job_from_message(self, message_id: str, payload: dict[str, str]) -> AgentJoinJob | None:
        session_id = str(payload.get("session_id", "")).strip()
        if not session_id:
            await self._client.xadd(
                self._dead_letter_key,
                {"reason": "missing_session_id", "source_message_id": message_id},
            )
            await self._client.xack(self._stream_key, self._consumer_group, message_id)
            return None

        attempts = int(payload.get("attempts", 0))
        candidate_id = payload.get("candidate_id")
        return AgentJoinJob(
            session_id=session_id,
            candidate_id=str(candidate_id).strip() if candidate_id else None,
            attempts=attempts,
            message_id=message_id,
        )

    async def ack(self, job: AgentJoinJob) -> None:
        if job.message_id:
            await self._client.xack(self._stream_key, self._consumer_group, job.message_id)

    async def retry(self, job: AgentJoinJob, reason: str) -> None:
        payload = {
            "session_id": job.session_id,
            "attempts": job.attempts + 1,
            "last_error": reason[:500],
        }
        if job.candidate_id:
            payload["candidate_id"] = job.candidate_id

        if payload["attempts"] >= self._max_attempts:
            await self._client.xadd(self._dead_letter_key, payload)
            await self.ack(job)
            return

        await self._client.xadd(self._stream_key, payload)
        await self.ack(job)

    async def close(self) -> None:
        await self._client.aclose()

    async def _ensure_group(self) -> None:
        if self._group_ready:
            return

        try:
            await self._client.xgroup_create(
                self._stream_key,
                self._consumer_group,
                id="0",
                mkstream=True,
            )
        except ResponseError as exc:
            if "BUSYGROUP" not in str(exc):
                raise

        self._group_ready = True


async def run_auto_worker(
    *,
    queue: AgentJoinQueue,
    realtime_api_url: str,
    api_key: str | None = None,
    skip_openai_handshake: bool = False,
    max_concurrency: int = 2,
    stop_after_jobs: int | None = None,
) -> int:
    if max_concurrency < 1:
        raise ValueError("max_concurrency must be greater than zero")

    running: set[asyncio.Task[None]] = set()
    completed_jobs = 0
    processed_jobs = 0

    async def run_job(job: AgentJoinJob) -> None:
        nonlocal completed_jobs, processed_jobs
        try:
            if not await session_can_start(
                session_id=job.session_id,
                realtime_api_url=realtime_api_url,
                api_key=api_key,
            ):
                log("agent_job_skipped", session_id=job.session_id, reason="session_not_startable")
                await queue.ack(job)
                return

            log("agent_worker_starting", session_id=job.session_id)
            await run_live_worker(
                session_id=job.session_id,
                realtime_api_url=realtime_api_url,
                api_key=api_key,
                skip_openai_handshake=skip_openai_handshake,
            )
            await queue.ack(job)
            completed_jobs += 1
            log("agent_worker_completed", session_id=job.session_id)
        except Exception as exc:  # pragma: no cover - covered through behavior tests
            log("agent_worker_failed", session_id=job.session_id, error=str(exc))
            await queue.retry(job, str(exc))
        finally:
            processed_jobs += 1

    try:
        while stop_after_jobs is None or processed_jobs < stop_after_jobs:
            if len(running) >= max_concurrency:
                done, running = await asyncio.wait(
                    running,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in done:
                    task.result()
                continue

            job = await queue.next_job()
            if job is None:
                if running:
                    done, running = await asyncio.wait(
                        running,
                        timeout=0.1,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in done:
                        task.result()
                else:
                    await asyncio.sleep(0)
                continue

            log(
                "agent_job_claimed",
                session_id=job.session_id,
                candidate_id=job.candidate_id,
                attempts=job.attempts,
            )
            task = asyncio.create_task(run_job(job))
            running.add(task)

        if running:
            done, _ = await asyncio.wait(running)
            for task in done:
                task.result()
    finally:
        await queue.close()

    return completed_jobs


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Prelude auto-worker that starts live interviewer agents from Redis."
    )
    parser.add_argument("--redis-url", required=True, help="Redis URL, e.g. redis://localhost:6379/0.")
    parser.add_argument("--realtime-api-url", required=True, help="Go realtime API base URL.")
    parser.add_argument("--api-key", default=None, help="Optional bearer token for the Go API.")
    parser.add_argument(
        "--stream-key",
        default=os.getenv("AGENT_JOIN_STREAM_KEY", DEFAULT_STREAM_KEY),
        help="Redis stream key used for agent join jobs.",
    )
    parser.add_argument(
        "--consumer-group",
        default=os.getenv("AGENT_JOIN_CONSUMER_GROUP", DEFAULT_CONSUMER_GROUP),
        help="Redis consumer group for live interviewer workers.",
    )
    parser.add_argument(
        "--poll-timeout-seconds",
        type=int,
        default=5,
        help="Redis blocking pop timeout.",
    )
    parser.add_argument(
        "--pending-idle-seconds",
        type=int,
        default=int(
            os.getenv(
                "AGENT_JOIN_PENDING_IDLE_SECONDS",
                str(DEFAULT_PENDING_IDLE_SECONDS),
            )
        ),
        help="Seconds before a pending Redis Stream job may be reclaimed by this worker.",
    )
    parser.add_argument(
        "--max-concurrency",
        type=int,
        default=int(os.getenv("LIVE_WORKER_MAX_CONCURRENCY", "2")),
        help="Maximum live interviewer sessions this process may run concurrently.",
    )
    parser.add_argument(
        "--skip-openai-handshake",
        action="store_true",
        help="Join LiveKit and persist events without opening OpenAI Realtime.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    queue = RedisAgentJoinQueue(
        redis_url=args.redis_url,
        stream_key=args.stream_key,
        consumer_group=args.consumer_group,
        poll_timeout_seconds=args.poll_timeout_seconds,
        pending_idle_seconds=args.pending_idle_seconds,
    )
    log(
        "auto_worker_started",
        host=socket.gethostname(),
        stream=args.stream_key,
        concurrency=args.max_concurrency,
    )
    await run_auto_worker(
        queue=queue,
        realtime_api_url=args.realtime_api_url,
        api_key=args.api_key,
        skip_openai_handshake=args.skip_openai_handshake,
        max_concurrency=args.max_concurrency,
    )


async def session_can_start(
    *,
    session_id: str,
    realtime_api_url: str,
    api_key: str | None,
) -> bool:
    realtime_api = HttpRealtimeApiClient(realtime_api_url, api_key=api_key)
    event_types = await realtime_api.get_event_types(session_id)
    if EventType.CANDIDATE_MEDIA_READY not in event_types:
        return False
    if EventType.AGENT_JOINED in event_types:
        return False
    if EventType.SESSION_COMPLETED in event_types:
        return False
    if EventType.SESSION_FAILED in event_types:
        return False
    return True


if __name__ == "__main__":
    asyncio.run(main())
