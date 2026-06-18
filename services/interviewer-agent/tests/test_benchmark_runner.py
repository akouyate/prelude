import pytest

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


@pytest.mark.asyncio
async def test_benchmark_runner_blocks_real_provider_when_credentials_are_missing() -> None:
    runner = BenchmarkRunner(env={})
    config = BenchmarkRunConfig(
        provider="openai_realtime",
        scenario=BenchmarkScenarioName.NORMAL,
        iterations=1,
        benchmark_run_id="bench-openai",
    )

    report = await runner.run(config)

    assert len(report.runs) == 1
    assert report.runs[0].status == "blocked"
    assert "OPENAI_API_KEY" in report.runs[0].blocker
    assert report.recommendation.startswith("Provider access is missing")


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
