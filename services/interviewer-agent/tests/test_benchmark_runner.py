import pytest

from app.adapters.openai_realtime import OpenAIRealtimeSmokeProvider
from app.benchmark.runner import BenchmarkRunConfig, BenchmarkRunner
from app.benchmark.scenarios import BenchmarkScenarioName
from app.domain.models import EventType


@pytest.mark.asyncio
async def test_benchmark_runner_emits_common_metadata_for_each_event() -> None:
    runner = BenchmarkRunner()
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-test",
        session_id_prefix="session-bench",
    )

    report = await runner.run(config)

    assert report.benchmark_run_id == "bench-test"
    assert len(report.runs) == 1
    run = report.runs[0]
    assert run.provider == "mock_openai_realtime"
    assert run.scenario == BenchmarkScenarioName.NORMAL
    assert run.session_id == "session-bench-1"
    assert run.events_emitted > 0
    assert run.metrics.completed_questions == 3
    assert run.metrics.event_persistence_complete is True
    assert all(
        event.provider_metadata["benchmark_run_id"] == "bench-test"
        for event in runner.events_by_session[run.session_id]
    )
    assert all(
        event.provider_metadata["scenario"] == "normal"
        for event in runner.events_by_session[run.session_id]
    )
    assert runner.events_by_session[run.session_id][0].idempotency_key == (
        "bench-test:session-bench-1:1:session_started"
    )
    assert runner.events_by_session[run.session_id][0].event_id == (
        "evt_bench-test:session-bench-1:1:session_started"
    )
    assert runner.events_by_session[run.session_id][0].provider_metadata[
        "provider_config"
    ] == {"mode": "deterministic_mock"}
    assert any(
        event.type == EventType.CANDIDATE_TURN_FINALIZED
        for event in runner.events_by_session[run.session_id]
    )


@pytest.mark.asyncio
async def test_benchmark_runner_repeats_the_same_scenario_for_iterations() -> None:
    runner = BenchmarkRunner()
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=BenchmarkScenarioName.REPEAT,
        iterations=2,
        benchmark_run_id="bench-repeat",
        session_id_prefix="session-repeat",
    )

    report = await runner.run(config)

    assert [run.iteration for run in report.runs] == [1, 2]
    assert [run.session_id for run in report.runs] == [
        "session-repeat-1",
        "session-repeat-2",
    ]
    for run in report.runs:
        events = runner.events_by_session[run.session_id]
        assert any(event.type == EventType.QUESTION_REPEATED for event in events)
        assert run.metrics.repeat_requests == 1


@pytest.mark.parametrize(
    "scenario",
    [
        BenchmarkScenarioName.ABSURD_ANSWER,
        BenchmarkScenarioName.OFF_TOPIC,
        BenchmarkScenarioName.LOW_INFORMATION,
        BenchmarkScenarioName.CONTRADICTORY,
        BenchmarkScenarioName.GENERIC_CLAIM,
    ],
)
@pytest.mark.asyncio
async def test_benchmark_runner_smoke_scenarios_challenge_weak_answers(
    scenario: BenchmarkScenarioName,
) -> None:
    runner = BenchmarkRunner()
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=scenario,
        iterations=1,
        benchmark_run_id=f"bench-{scenario.value}",
        session_id_prefix=f"session-{scenario.value}",
    )

    report = await runner.run(config)

    run = report.runs[0]
    events = runner.events_by_session[run.session_id]
    evaluated = [event for event in events if event.type == EventType.ANSWER_EVALUATED]
    followups = [event for event in events if event.type == EventType.FOLLOWUP_ASKED]

    assert run.metrics.completed_questions == 3
    assert followups
    assert any(
        event.payload["policy_action"] == "ask_followup"
        and event.payload["evaluation_matrix"]["challenge"]["needed"] is True
        for event in evaluated
    )


@pytest.mark.asyncio
async def test_benchmark_runner_blocks_real_provider_when_credentials_are_missing() -> None:
    class RecordingHttpFactory:
        def __init__(self) -> None:
            self.created: list[dict[str, object]] = []

        async def create_session(self, payload: dict[str, object]) -> str:
            self.created.append(payload)
            return "go-session-should-not-exist"

        def build_client(self, session_id: str):
            return _RecordingApi(session_id)

    factory = RecordingHttpFactory()
    runner = BenchmarkRunner(env={}, http_factory=factory)
    config = BenchmarkRunConfig(
        provider="openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-openai",
        realtime_api_url="http://realtime.test",
        allow_live_llm_tests=True,
    )

    report = await runner.run(config)

    assert len(report.runs) == 1
    assert report.runs[0].status == "blocked"
    assert "OPENAI_API_KEY" in report.runs[0].blocker
    assert report.recommendation.startswith("Provider access is missing")
    assert factory.created == []


@pytest.mark.asyncio
async def test_benchmark_runner_blocks_real_provider_without_live_llm_opt_in() -> None:
    class RecordingHttpFactory:
        def __init__(self) -> None:
            self.created: list[dict[str, object]] = []

        async def create_session(self, payload: dict[str, object]) -> str:
            self.created.append(payload)
            return "go-session-should-not-exist"

        def build_client(self, session_id: str):
            return _RecordingApi(session_id)

    factory = RecordingHttpFactory()
    runner = BenchmarkRunner(
        env={
            "OPENAI_API_KEY": "sk-test-secret",
            "OPENAI_REALTIME_MODEL": "gpt-realtime",
            "OPENAI_REALTIME_VOICE": "marin",
            "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
            "OPENAI_REALTIME_REASONING_EFFORT": "low",
            "LIVEKIT_URL": "wss://livekit.example.test",
            "LIVEKIT_API_KEY": "lk_key",
            "LIVEKIT_API_SECRET": "lk_secret",
        },
        http_factory=factory,
    )
    config = BenchmarkRunConfig(
        provider="openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-openai",
        realtime_api_url="http://realtime.test",
    )

    report = await runner.run(config)

    assert report.runs[0].status == "blocked"
    assert "ALLOW_LIVE_LLM_TESTS=1" in report.runs[0].blocker
    assert "--allow-live-llm-tests" in report.runs[0].blocker
    assert "sk-test-secret" not in report.runs[0].blocker
    assert factory.created == []


@pytest.mark.asyncio
async def test_benchmark_runner_requires_go_persistence_for_openai_smoke() -> None:
    runner = BenchmarkRunner(
        env={
            "OPENAI_API_KEY": "sk-test-secret",
            "OPENAI_REALTIME_MODEL": "gpt-realtime",
            "OPENAI_REALTIME_VOICE": "marin",
            "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
            "OPENAI_REALTIME_REASONING_EFFORT": "low",
            "LIVEKIT_URL": "wss://livekit.example.test",
            "LIVEKIT_API_KEY": "lk_key",
            "LIVEKIT_API_SECRET": "lk_secret",
        }
    )
    config = BenchmarkRunConfig(
        provider="openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-openai",
        allow_live_llm_tests=True,
    )

    report = await runner.run(config)

    assert report.runs[0].status == "blocked"
    assert "--realtime-api-url" in report.runs[0].blocker
    assert "sk-test-secret" not in report.runs[0].blocker


@pytest.mark.asyncio
async def test_benchmark_runner_wires_openai_smoke_to_livekit_and_go(
    monkeypatch,
) -> None:
    class RecordingHttpFactory:
        async def create_session(self, payload: dict[str, object]) -> str:
            return "is_openai"

        def build_client(self, session_id: str):
            return _RecordingApi(session_id)

    class RecordingLiveKitRoom:
        def __init__(self) -> None:
            self.joined = None
            self.disconnected = False

        async def join(self, join) -> None:
            self.joined = join

        async def disconnect(self) -> None:
            self.disconnected = True

    async def fake_prepare_smoke(self):
        return {
            "openai_realtime": {
                "smoke_status": "connected",
                "handshake_event_type": "session.created",
                "openai_session_id": "sess_test",
            }
        }

    room = RecordingLiveKitRoom()
    monkeypatch.setattr("app.benchmark.runner.LiveKitRoomAdapter", lambda: room)
    monkeypatch.setattr(OpenAIRealtimeSmokeProvider, "prepare_smoke", fake_prepare_smoke)
    runner = BenchmarkRunner(
        env={
            "OPENAI_API_KEY": "sk-test-secret",
            "OPENAI_REALTIME_MODEL": "gpt-realtime",
            "OPENAI_REALTIME_VOICE": "marin",
            "OPENAI_REALTIME_TURN_DETECTION": "semantic_vad",
            "OPENAI_REALTIME_REASONING_EFFORT": "low",
            "LIVEKIT_URL": "wss://livekit.example.test",
            "LIVEKIT_API_KEY": "lk_key",
            "LIVEKIT_API_SECRET": "a" * 32,
        },
        http_factory=RecordingHttpFactory(),
    )
    config = BenchmarkRunConfig(
        provider="openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-openai",
        realtime_api_url="http://realtime.test",
        allow_live_llm_tests=True,
    )

    report = await runner.run(config)

    events = runner.events_by_session["is_openai"]
    assert report.runs[0].status == "completed"
    assert room.joined.room_name == "prelude-is_openai"
    assert room.joined.participant == "agent-is_openai"
    assert not room.joined.token.startswith("mock_lk_")
    assert room.disconnected is True
    assert events[0].type == EventType.AGENT_JOINED
    assert all(
        event.provider_metadata["openai_realtime"]["smoke_status"] == "connected"
        for event in events
    )


@pytest.mark.asyncio
async def test_benchmark_runner_rejects_zero_iterations() -> None:
    runner = BenchmarkRunner()
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=0,
    )

    with pytest.raises(ValueError, match="iterations"):
        await runner.run(config)


@pytest.mark.asyncio
async def test_benchmark_runner_creates_go_sessions_before_http_ingest() -> None:
    class RecordingHttpFactory:
        def __init__(self) -> None:
            self.created: list[dict[str, object]] = []

        async def create_session(self, payload: dict[str, object]) -> str:
            self.created.append(payload)
            return f"go-session-{len(self.created)}"

        def build_client(self, session_id: str):
            return _RecordingApi(session_id)

    factory = RecordingHttpFactory()
    runner = BenchmarkRunner(http_factory=factory)
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=2,
        benchmark_run_id="bench-http",
        realtime_api_url="http://realtime.test",
    )

    report = await runner.run(config)

    assert [run.session_id for run in report.runs] == [
        "go-session-1",
        "go-session-2",
    ]
    assert [payload["interview_plan_id"] for payload in factory.created] == [
        "plan-demo-product-manager",
        "plan-demo-product-manager",
    ]
    assert [payload["candidate_id"] for payload in factory.created] == [
        "benchmark-candidate-bench-http-1",
        "benchmark-candidate-bench-http-2",
    ]
    assert runner.events_by_session["go-session-1"][0].session_id == "go-session-1"


@pytest.mark.asyncio
async def test_benchmark_runner_returns_failed_report_when_runtime_errors() -> None:
    class FailingApi:
        async def emit_event(self, event) -> None:
            raise RuntimeError("boom secret-token")

    class FailingFactory:
        async def create_session(self, payload: dict[str, object]) -> str:
            return "go-session-failing"

        def build_client(self, session_id: str):
            return FailingApi()

    runner = BenchmarkRunner(http_factory=FailingFactory())
    config = BenchmarkRunConfig(
        provider="mock_openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-fail",
        realtime_api_url="http://realtime.test",
    )

    report = await runner.run(config)

    assert report.runs[0].status == "failed"
    assert report.runs[0].session_id == "go-session-failing"
    assert "RuntimeError" in report.runs[0].blocker
    assert "secret-token" not in report.runs[0].blocker
    assert report.runs[0].metrics.event_persistence_complete is False


class _RecordingApi:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        self.events = []

    async def emit_event(self, event) -> None:
        assert event.session_id == self.session_id
        self.events.append(event)
