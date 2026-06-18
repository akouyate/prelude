from __future__ import annotations

import os
import subprocess
import time
from collections import Counter
from dataclasses import dataclass, field
from typing import Mapping
from uuid import uuid4

from pydantic import BaseModel, Field

from app.adapters.realtime_api import InMemoryRealtimeApiClient
from app.application.ports import RealtimeApiClient
from app.application.session_runner import InterviewSessionRunner
from app.benchmark.providers import ProviderBenchmarkBlocked, build_benchmark_provider
from app.benchmark.scenarios import BenchmarkScenarioName, load_benchmark_scenario
from app.domain.models import EventType, InterviewEvent


class BenchmarkMetrics(BaseModel):
    total_duration_ms: int
    events_emitted: int
    completed_questions: int
    question_repeated_count: int = 0
    repeat_requests: int = 0
    followups_asked: int = 0
    soft_reprompts: int = 0
    accepted_barge_ins: int = 0
    candidate_turns_finalized: int = 0
    provider_errors: int = 0
    event_persistence_complete: bool = True
    estimated_cost_cents: float | None = None


class BenchmarkRunResult(BaseModel):
    provider: str
    scenario: BenchmarkScenarioName
    iteration: int
    session_id: str
    status: str
    events_emitted: int = 0
    metrics: BenchmarkMetrics = Field(
        default_factory=lambda: BenchmarkMetrics(
            total_duration_ms=0,
            events_emitted=0,
            completed_questions=0,
            event_persistence_complete=False,
        )
    )
    blocker: str | None = None


class BenchmarkReport(BaseModel):
    benchmark_run_id: str
    provider: str
    scenario: BenchmarkScenarioName
    runs: list[BenchmarkRunResult]
    recommendation: str


class RecordingRealtimeApiClient:
    def __init__(self, wrapped: RealtimeApiClient) -> None:
        self._wrapped = wrapped
        self.events: list[InterviewEvent] = []

    async def emit_event(self, event: InterviewEvent) -> None:
        await self._wrapped.emit_event(event)
        self.events.append(event)


@dataclass(frozen=True)
class BenchmarkRunConfig:
    provider: str
    scenario: BenchmarkScenarioName
    iterations: int = 3
    benchmark_run_id: str = field(default_factory=lambda: f"bench-{uuid4().hex[:10]}")
    session_id_prefix: str | None = None
    realtime_api_url: str | None = None
    api_key: str | None = None


class BenchmarkRunner:
    def __init__(self, env: Mapping[str, str] | None = None) -> None:
        self._env = env if env is not None else os.environ
        self.events_by_session: dict[str, list[InterviewEvent]] = {}

    async def run(self, config: BenchmarkRunConfig) -> BenchmarkReport:
        if config.iterations < 1:
            raise ValueError("iterations must be greater than zero")

        runs: list[BenchmarkRunResult] = []
        for iteration in range(1, config.iterations + 1):
            runs.append(await self._run_iteration(config, iteration))

        return BenchmarkReport(
            benchmark_run_id=config.benchmark_run_id,
            provider=config.provider,
            scenario=config.scenario,
            runs=runs,
            recommendation=_recommendation_for(runs),
        )

    async def _run_iteration(
        self,
        config: BenchmarkRunConfig,
        iteration: int,
    ) -> BenchmarkRunResult:
        session_id = _session_id(config, iteration)
        scenario = load_benchmark_scenario(config.scenario)
        try:
            provider = build_benchmark_provider(config.provider, scenario, self._env)
        except ProviderBenchmarkBlocked as exc:
            return BenchmarkRunResult(
                provider=config.provider,
                scenario=config.scenario,
                iteration=iteration,
                session_id=session_id,
                status="blocked",
                blocker=str(exc),
            )

        realtime_api = RecordingRealtimeApiClient(_build_realtime_client(config))
        started = time.perf_counter()
        runner = InterviewSessionRunner(
            plan=scenario.plan,
            provider=provider,
            realtime_api=realtime_api,
            session_id=session_id,
            provider_name=config.provider,
            simulate_first_question_barge_in=scenario.simulate_barge_in,
            provider_metadata={
                "benchmark_run_id": config.benchmark_run_id,
                "scenario": config.scenario.value,
                "scenario_description": scenario.description,
                "iteration": iteration,
                "commit_sha": _commit_sha(),
                "provider_config": _provider_config(config.provider, self._env),
            },
            idempotency_key_prefix=f"{config.benchmark_run_id}:{session_id}",
        )
        session_result = await runner.run()
        duration_ms = round((time.perf_counter() - started) * 1000)
        events = list(realtime_api.events)
        if events:
            self.events_by_session[session_id] = events

        metrics = _compute_metrics(
            events=events,
            duration_ms=duration_ms,
            fallback_events_emitted=session_result.events_emitted,
        )
        return BenchmarkRunResult(
            provider=config.provider,
            scenario=config.scenario,
            iteration=iteration,
            session_id=session_id,
            status="completed",
            events_emitted=session_result.events_emitted,
            metrics=metrics,
        )


def _build_realtime_client(config: BenchmarkRunConfig) -> RealtimeApiClient:
    if config.realtime_api_url:
        from app.adapters.realtime_api import HttpRealtimeApiClient

        return HttpRealtimeApiClient(config.realtime_api_url, api_key=config.api_key)
    return InMemoryRealtimeApiClient(print_events=False)


def _provider_config(provider: str, env: Mapping[str, str]) -> dict[str, str]:
    if provider == "openai_realtime":
        return {
            "model": env.get("OPENAI_REALTIME_MODEL", ""),
            "voice": env.get("OPENAI_REALTIME_VOICE", ""),
            "turn_detection": env.get("OPENAI_REALTIME_TURN_DETECTION", ""),
            "reasoning_effort": env.get("OPENAI_REALTIME_REASONING_EFFORT", ""),
        }
    if provider == "elevenlabs":
        return {
            "agent_id": env.get("ELEVENLABS_AGENT_ID", ""),
            "voice_id": env.get("ELEVENLABS_VOICE_ID", ""),
            "conversation_mode": env.get("ELEVENLABS_CONVERSATION_MODE", ""),
            "turn_eagerness": env.get("ELEVENLABS_TURN_EAGERNESS", ""),
        }
    return {"mode": "deterministic_mock"}


def _commit_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        )
    except Exception:
        return "unknown"
    return result.stdout.strip() or "unknown"


def _compute_metrics(
    *,
    events: list[InterviewEvent],
    duration_ms: int,
    fallback_events_emitted: int,
) -> BenchmarkMetrics:
    counts = Counter(event.type for event in events)
    completed_questions = sum(
        1
        for event in events
        if event.type == EventType.QUESTION_COMPLETED
        and event.payload.get("completion_reason") == "answered"
    )
    return BenchmarkMetrics(
        total_duration_ms=duration_ms,
        events_emitted=len(events) or fallback_events_emitted,
        completed_questions=completed_questions,
        question_repeated_count=counts[EventType.QUESTION_REPEATED],
        repeat_requests=counts[EventType.QUESTION_REPEATED],
        followups_asked=counts[EventType.FOLLOWUP_ASKED],
        soft_reprompts=counts[EventType.SOFT_REPROMPTED],
        accepted_barge_ins=counts[EventType.BARGE_IN_ACCEPTED],
        candidate_turns_finalized=counts[EventType.CANDIDATE_TURN_FINALIZED],
        provider_errors=counts[EventType.SESSION_FAILED],
        event_persistence_complete=bool(events)
        and counts[EventType.SESSION_COMPLETED] == 1
        and counts[EventType.SESSION_FAILED] == 0,
    )


def _session_id(config: BenchmarkRunConfig, iteration: int) -> str:
    if config.session_id_prefix:
        return f"{config.session_id_prefix}-{iteration}"
    return f"{config.provider}-{config.scenario.value}-{config.benchmark_run_id}-{iteration}"


def _recommendation_for(runs: list[BenchmarkRunResult]) -> str:
    blocked = [run for run in runs if run.status == "blocked"]
    if blocked:
        return f"Provider access is missing or incomplete: {blocked[0].blocker}"
    failed = [run for run in runs if run.status != "completed"]
    if failed:
        return "Benchmark did not complete reliably; inspect blocked or failed runs first."
    return "Benchmark harness completed. Run the same scenarios against real providers before choosing one."
