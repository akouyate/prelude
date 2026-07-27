from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

import pytest
from app import auto_worker
from app.auto_worker import AgentJoinJob
from app.domain.models import EventType


@dataclass
class FakeQueue:
    jobs: list[AgentJoinJob]
    acked: list[AgentJoinJob] = field(default_factory=list)
    retries: list[tuple[AgentJoinJob, str]] = field(default_factory=list)
    renewed: list[AgentJoinJob] = field(default_factory=list)
    renew_results: list[bool] = field(default_factory=list)
    lease_heartbeat_interval_seconds: float = 0.001
    lease_renewed: asyncio.Event = field(default_factory=asyncio.Event)
    closed: bool = False

    async def next_job(self) -> AgentJoinJob | None:
        if not self.jobs:
            return None
        return self.jobs.pop(0)

    async def ack(self, job: AgentJoinJob) -> None:
        self.acked.append(job)

    async def retry(self, job: AgentJoinJob, reason: str) -> None:
        self.retries.append((job, reason))

    async def renew_lease(self, job: AgentJoinJob) -> bool:
        self.renewed.append(job)
        self.lease_renewed.set()
        if self.renew_results:
            return self.renew_results.pop(0)
        return True

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_auto_worker_runs_live_worker_for_queued_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    async def fake_run_live_worker(**kwargs: object) -> int:
        calls.append(kwargs)
        return 3

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    monkeypatch.setattr(auto_worker, "run_live_worker", fake_run_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    queue = FakeQueue(
        jobs=[
            AgentJoinJob(session_id="is_1", candidate_id="candidate_1"),
            AgentJoinJob(session_id="is_2", candidate_id="candidate_2"),
        ]
    )

    completed = await auto_worker.run_auto_worker(
        queue=queue,
        realtime_api_url="http://127.0.0.1:8080",
        max_concurrency=2,
        stop_after_jobs=2,
    )

    assert completed == 2
    assert [call["session_id"] for call in calls] == ["is_1", "is_2"]
    assert calls[0]["realtime_api_url"] == "http://127.0.0.1:8080"
    assert [job.session_id for job in queue.acked] == ["is_1", "is_2"]
    assert queue.closed


@pytest.mark.asyncio
async def test_auto_worker_retries_failed_session(monkeypatch: pytest.MonkeyPatch) -> None:
    async def failing_run_live_worker(**_: object) -> int:
        raise RuntimeError("openai unavailable")

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    monkeypatch.setattr(auto_worker, "run_live_worker", failing_run_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    queue = FakeQueue(jobs=[AgentJoinJob(session_id="is_1")])

    completed = await auto_worker.run_auto_worker(
        queue=queue,
        realtime_api_url="http://127.0.0.1:8080",
        max_concurrency=1,
        stop_after_jobs=1,
    )

    assert completed == 0
    assert queue.retries == [(AgentJoinJob(session_id="is_1"), "openai unavailable")]
    assert queue.closed


@pytest.mark.asyncio
async def test_long_running_job_renews_its_redis_lease_until_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker_started = asyncio.Event()
    release_worker = asyncio.Event()

    async def long_running_live_worker(**_: object) -> int:
        worker_started.set()
        await release_worker.wait()
        return 0

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    monkeypatch.setattr(auto_worker, "run_live_worker", long_running_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    job = AgentJoinJob(session_id="is_long", message_id="1-0")
    queue = FakeQueue(jobs=[job])

    worker_task = asyncio.create_task(
        auto_worker.run_auto_worker(
            queue=queue,
            realtime_api_url="http://127.0.0.1:8080",
            max_concurrency=1,
            stop_after_jobs=1,
        )
    )

    await asyncio.wait_for(worker_started.wait(), timeout=1)
    await asyncio.wait_for(queue.lease_renewed.wait(), timeout=1)

    assert queue.renewed == [job]
    assert queue.acked == []

    release_worker.set()
    assert await asyncio.wait_for(worker_task, timeout=1) == 1
    assert queue.acked == [job]
    assert queue.retries == []


@pytest.mark.asyncio
async def test_transient_lease_errors_do_not_cancel_a_live_interview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker_started = asyncio.Event()
    release_worker = asyncio.Event()
    renewal_attempts = 0

    async def long_running_live_worker(**_: object) -> int:
        worker_started.set()
        await release_worker.wait()
        return 0

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    async def flaky_renew_lease(job: AgentJoinJob) -> bool:
        nonlocal renewal_attempts
        queue.renewed.append(job)
        renewal_attempts += 1
        if renewal_attempts <= 2:
            raise ConnectionError("redis temporarily unavailable")
        queue.lease_renewed.set()
        return True

    monkeypatch.setattr(auto_worker, "run_live_worker", long_running_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    job = AgentJoinJob(session_id="is_transient_redis", message_id="1-1")
    queue = FakeQueue(jobs=[job])
    queue.renew_lease = flaky_renew_lease

    worker_task = asyncio.create_task(
        auto_worker.run_auto_worker(
            queue=queue,
            realtime_api_url="http://127.0.0.1:8080",
            max_concurrency=1,
            stop_after_jobs=1,
        )
    )

    await asyncio.wait_for(worker_started.wait(), timeout=1)
    await asyncio.wait_for(queue.lease_renewed.wait(), timeout=1)
    release_worker.set()

    assert await asyncio.wait_for(worker_task, timeout=1) == 1
    assert renewal_attempts >= 3
    assert queue.acked == [job]
    assert queue.retries == []


@pytest.mark.asyncio
async def test_worker_shutdown_stops_the_job_and_leaves_pending_message_for_reclaim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker_started = asyncio.Event()
    worker_cancelled = asyncio.Event()

    async def interrupted_live_worker(**_: object) -> int:
        worker_started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            worker_cancelled.set()
            raise

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    monkeypatch.setattr(auto_worker, "run_live_worker", interrupted_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    job = AgentJoinJob(session_id="is_crashed", message_id="2-0")
    queue = FakeQueue(jobs=[job])
    worker_task = asyncio.create_task(
        auto_worker.run_auto_worker(
            queue=queue,
            realtime_api_url="http://127.0.0.1:8080",
            max_concurrency=1,
            stop_after_jobs=1,
        )
    )

    await asyncio.wait_for(worker_started.wait(), timeout=1)
    await asyncio.wait_for(queue.lease_renewed.wait(), timeout=1)
    worker_task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await worker_task

    await asyncio.wait_for(worker_cancelled.wait(), timeout=1)
    renewals_after_shutdown = len(queue.renewed)
    await asyncio.sleep(0.01)

    assert len(queue.renewed) == renewals_after_shutdown
    assert queue.acked == []
    assert queue.retries == []
    assert queue.closed


@pytest.mark.asyncio
async def test_lost_lease_cancels_original_agent_before_reclaimed_job_restarts_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_worker_cancelled = asyncio.Event()
    live_worker_calls = 0

    async def recovering_live_worker(**_: object) -> int:
        nonlocal live_worker_calls
        live_worker_calls += 1
        if live_worker_calls == 2:
            assert live_worker_cancelled.is_set()
            return 0
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            live_worker_cancelled.set()
            raise

    async def fake_session_start_disposition(
        **_: object,
    ) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.START

    monkeypatch.setattr(auto_worker, "run_live_worker", recovering_live_worker)
    monkeypatch.setattr(
        auto_worker,
        "session_start_disposition",
        fake_session_start_disposition,
    )
    reclaimed_job = AgentJoinJob(session_id="is_guarded", message_id="3-0")
    queue = FakeQueue(
        jobs=[reclaimed_job, reclaimed_job],
        renew_results=[False],
    )

    completed = await auto_worker.run_auto_worker(
        queue=queue,
        realtime_api_url="http://127.0.0.1:8080",
        max_concurrency=1,
        stop_after_jobs=2,
    )

    assert completed == 1
    assert live_worker_calls == 2
    assert live_worker_cancelled.is_set()
    assert queue.acked == [reclaimed_job]
    assert queue.retries == []


@pytest.mark.asyncio
async def test_redis_lease_renewal_does_not_reclaim_a_message_owned_by_another_consumer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRedisClient:
        eval_args: tuple[object, ...] | None = None

        async def eval(self, *args: object) -> int:
            self.eval_args = args
            return 0

    client = FakeRedisClient()
    monkeypatch.setattr(auto_worker.redis, "from_url", lambda *_args, **_kwargs: client)
    queue = auto_worker.RedisAgentJoinQueue(
        redis_url="redis://unused",
        consumer_name="worker-a",
    )

    renewed = await queue.renew_lease(
        AgentJoinJob(session_id="is_owned_elsewhere", message_id="4-0")
    )

    assert renewed is False
    assert client.eval_args is not None
    assert client.eval_args[1:] == (
        1,
        auto_worker.DEFAULT_STREAM_KEY,
        auto_worker.DEFAULT_CONSUMER_GROUP,
        "worker-a",
        "4-0",
    )


@pytest.mark.asyncio
async def test_crashed_workers_pending_message_is_reclaimed_after_lease_expiry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRedisClient:
        claim_args: tuple[object, ...] | None = None
        claim_kwargs: dict[str, object] | None = None

        async def xautoclaim(self, *args: object, **kwargs: object) -> tuple[str, list[object], list]:
            self.claim_args = args
            self.claim_kwargs = kwargs
            return (
                "0-0",
                [("5-0", {"session_id": "is_recovered", "candidate_id": "candidate_1"})],
                [],
            )

    client = FakeRedisClient()
    monkeypatch.setattr(auto_worker.redis, "from_url", lambda *_args, **_kwargs: client)
    queue = auto_worker.RedisAgentJoinQueue(
        redis_url="redis://unused",
        consumer_name="replacement-worker",
        pending_idle_seconds=30,
    )

    reclaimed = await queue._claim_stale_job()

    assert reclaimed == AgentJoinJob(
        session_id="is_recovered",
        candidate_id="candidate_1",
        message_id="5-0",
    )
    assert client.claim_args == (
        auto_worker.DEFAULT_STREAM_KEY,
        auto_worker.DEFAULT_CONSUMER_GROUP,
        "replacement-worker",
    )
    assert client.claim_kwargs == {
        "min_idle_time": 30_000,
        "start_id": "0-0",
        "count": 1,
    }


@pytest.mark.asyncio
async def test_reclaimed_non_terminal_session_can_restart_after_an_old_agent_join(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeRealtimeApi:
        async def get_event_types(self, _session_id: str) -> list[EventType]:
            return [
                EventType.CANDIDATE_MEDIA_READY,
                EventType.AGENT_JOINED,
            ]

    monkeypatch.setattr(
        auto_worker,
        "HttpRealtimeApiClient",
        lambda *_args, **_kwargs: FakeRealtimeApi(),
    )

    disposition = await auto_worker.session_start_disposition(
        session_id="is_reclaimed",
        realtime_api_url="http://127.0.0.1:8080",
        api_key=None,
    )

    assert disposition is auto_worker.SessionStartDisposition.START


@pytest.mark.asyncio
async def test_active_session_without_ready_media_is_left_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def deferred_session(**_: object) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.DEFER

    async def unexpected_live_worker(**_: object) -> int:
        raise AssertionError("deferred session must not start an interviewer")

    monkeypatch.setattr(auto_worker, "session_start_disposition", deferred_session)
    monkeypatch.setattr(auto_worker, "run_live_worker", unexpected_live_worker)
    job = AgentJoinJob(session_id="is_waiting_for_media", message_id="6-0")
    queue = FakeQueue(jobs=[job])

    completed = await auto_worker.run_auto_worker(
        queue=queue,
        realtime_api_url="http://127.0.0.1:8080",
        max_concurrency=1,
        stop_after_jobs=1,
    )

    assert completed == 0
    assert queue.acked == []
    assert queue.retries == []


@pytest.mark.asyncio
async def test_terminal_session_job_is_acknowledged_without_starting_an_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def terminal_session(**_: object) -> auto_worker.SessionStartDisposition:
        return auto_worker.SessionStartDisposition.TERMINAL

    async def unexpected_live_worker(**_: object) -> int:
        raise AssertionError("terminal session must not start an interviewer")

    monkeypatch.setattr(auto_worker, "session_start_disposition", terminal_session)
    monkeypatch.setattr(auto_worker, "run_live_worker", unexpected_live_worker)
    job = AgentJoinJob(session_id="is_completed", message_id="7-0")
    queue = FakeQueue(jobs=[job])

    completed = await auto_worker.run_auto_worker(
        queue=queue,
        realtime_api_url="http://127.0.0.1:8080",
        max_concurrency=1,
        stop_after_jobs=1,
    )

    assert completed == 0
    assert queue.acked == [job]
    assert queue.retries == []
