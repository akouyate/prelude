from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from app import auto_worker
from app.auto_worker import AgentJoinJob


@dataclass
class FakeQueue:
    jobs: list[AgentJoinJob]
    acked: list[AgentJoinJob] = field(default_factory=list)
    retries: list[tuple[AgentJoinJob, str]] = field(default_factory=list)
    closed: bool = False

    async def next_job(self) -> AgentJoinJob | None:
        if not self.jobs:
            return None
        return self.jobs.pop(0)

    async def ack(self, job: AgentJoinJob) -> None:
        self.acked.append(job)

    async def retry(self, job: AgentJoinJob, reason: str) -> None:
        self.retries.append((job, reason))

    async def close(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_auto_worker_runs_live_worker_for_queued_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, object]] = []

    async def fake_run_live_worker(**kwargs: object) -> int:
        calls.append(kwargs)
        return 3

    async def fake_session_can_start(**_: object) -> bool:
        return True

    monkeypatch.setattr(auto_worker, "run_live_worker", fake_run_live_worker)
    monkeypatch.setattr(auto_worker, "session_can_start", fake_session_can_start)
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

    async def fake_session_can_start(**_: object) -> bool:
        return True

    monkeypatch.setattr(auto_worker, "run_live_worker", failing_run_live_worker)
    monkeypatch.setattr(auto_worker, "session_can_start", fake_session_can_start)
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
