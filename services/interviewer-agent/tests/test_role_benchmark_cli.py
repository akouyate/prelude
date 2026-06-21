import pytest

from app.role_benchmark_cli import (
    HAPPY_ROLE_SCENARIOS,
    format_markdown,
    run_role_benchmark,
)


@pytest.mark.asyncio
async def test_role_benchmark_cli_formats_happy_path_summary() -> None:
    rows = await run_role_benchmark(
        provider="mock_openai_realtime",
        iterations=1,
        benchmark_run_id="role-cli-test",
        scenarios=HAPPY_ROLE_SCENARIOS,
    )

    output = format_markdown(rows)

    assert len(rows) == 4
    assert all(row.decision == "Pass" for row in rows)
    assert "`cmo`" in output
    assert "`buyer`" in output
    assert "`hr`" in output
    assert "`ai_orchestrator`" in output
    assert "Decision: **Pass**" in output
