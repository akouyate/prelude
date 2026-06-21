from __future__ import annotations

import argparse
import asyncio
import json
from dataclasses import dataclass
from pathlib import Path

from app.benchmark.runner import BenchmarkRunConfig, BenchmarkRunner
from app.benchmark.scenarios import BenchmarkScenarioName, load_benchmark_scenario
from app.domain.models import EventType


HAPPY_ROLE_SCENARIOS = (
    BenchmarkScenarioName.CMO,
    BenchmarkScenarioName.BUYER,
    BenchmarkScenarioName.HR,
    BenchmarkScenarioName.AI_ORCHESTRATOR,
)

WEAK_ROLE_SCENARIOS = (
    BenchmarkScenarioName.CMO_VAGUE,
    BenchmarkScenarioName.BUYER_OFF_TOPIC,
    BenchmarkScenarioName.HR_CONTRADICTORY,
    BenchmarkScenarioName.AI_ORCHESTRATOR_LOW_INFORMATION,
)


@dataclass(frozen=True)
class RoleBenchmarkRow:
    scenario: str
    role: str
    status: str
    completed_questions: int
    expected_questions: int
    events: int
    followups: int
    reprompts: int
    provider_errors: int
    classifications: list[str]
    actions: list[str]

    @property
    def decision(self) -> str:
        if self.status != "completed" or self.provider_errors > 0:
            return "Blocker"
        if self.completed_questions != self.expected_questions:
            return "Retry"
        return "Pass"

    def to_json(self) -> dict[str, object]:
        return {
            "scenario": self.scenario,
            "role": self.role,
            "status": self.status,
            "completed_questions": self.completed_questions,
            "expected_questions": self.expected_questions,
            "events": self.events,
            "followups": self.followups,
            "reprompts": self.reprompts,
            "provider_errors": self.provider_errors,
            "classifications": self.classifications,
            "actions": self.actions,
            "decision": self.decision,
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Prelude role-style benchmark matrix."
    )
    parser.add_argument(
        "--provider",
        default="mock_openai_realtime",
        choices=["mock_openai_realtime", "openai_realtime", "elevenlabs"],
        help="Provider adapter to benchmark.",
    )
    parser.add_argument(
        "--iterations",
        type=positive_int,
        default=1,
        help="Runs per role scenario.",
    )
    parser.add_argument(
        "--benchmark-run-id",
        default="role-style-benchmark",
        help="Stable id for this benchmark batch.",
    )
    parser.add_argument(
        "--happy-only",
        action="store_true",
        help="Run only clear-answer role scenarios.",
    )
    parser.add_argument(
        "--weak-only",
        action="store_true",
        help="Run only weak-answer role scenarios.",
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Optional path where the benchmark summary JSON should be written.",
    )
    return parser.parse_args()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


async def run_role_benchmark(
    *,
    provider: str,
    iterations: int,
    benchmark_run_id: str,
    scenarios: tuple[BenchmarkScenarioName, ...],
) -> list[RoleBenchmarkRow]:
    rows: list[RoleBenchmarkRow] = []
    for scenario in scenarios:
        runner = BenchmarkRunner()
        report = await runner.run(
            BenchmarkRunConfig(
                provider=provider,
                scenario=scenario,
                iterations=iterations,
                benchmark_run_id=f"{benchmark_run_id}-{scenario.value}",
                session_id_prefix=f"{benchmark_run_id}-{scenario.value}",
            )
        )
        rows.extend(_rows_from_runner(report.runs, runner, scenario))

    return rows


def select_scenarios(args: argparse.Namespace) -> tuple[BenchmarkScenarioName, ...]:
    if args.happy_only and args.weak_only:
        raise ValueError("Use either --happy-only or --weak-only, not both.")
    if args.happy_only:
        return HAPPY_ROLE_SCENARIOS
    if args.weak_only:
        return WEAK_ROLE_SCENARIOS
    return HAPPY_ROLE_SCENARIOS + WEAK_ROLE_SCENARIOS


def format_markdown(rows: list[RoleBenchmarkRow]) -> str:
    lines = [
        "# Role Benchmark",
        "",
        "| Scenario | Role | Decision | Questions | Follow-ups | Reprompts | Errors | Classifications | Actions |",
        "| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    f"`{row.scenario}`",
                    row.role,
                    row.decision,
                    f"{row.completed_questions}/{row.expected_questions}",
                    str(row.followups),
                    str(row.reprompts),
                    str(row.provider_errors),
                    ", ".join(row.classifications) or "none",
                    ", ".join(row.actions) or "none",
                ]
            )
            + " |"
        )

    blockers = [row for row in rows if row.decision == "Blocker"]
    retries = [row for row in rows if row.decision == "Retry"]
    decision = "Blocker" if blockers else "Retry" if retries else "Pass"
    lines.extend(["", f"Decision: **{decision}**"])
    return "\n".join(lines)


def _rows_from_runner(
    runs,
    runner: BenchmarkRunner,
    scenario: BenchmarkScenarioName,
) -> list[RoleBenchmarkRow]:
    plan = load_benchmark_scenario(scenario).plan
    rows: list[RoleBenchmarkRow] = []
    for run in runs:
        events = runner.events_by_session.get(run.session_id, [])
        evaluations = [
            event for event in events if event.type == EventType.ANSWER_EVALUATED
        ]
        rows.append(
            RoleBenchmarkRow(
                scenario=scenario.value,
                role=plan.role_title,
                status=run.status,
                completed_questions=run.metrics.completed_questions,
                expected_questions=len(plan.questions),
                events=run.metrics.events_emitted,
                followups=run.metrics.followups_asked,
                reprompts=run.metrics.soft_reprompts,
                provider_errors=run.metrics.provider_errors,
                classifications=[
                    str(event.payload.get("classification", "unknown"))
                    for event in evaluations
                ],
                actions=[
                    str(event.payload.get("policy_action", "unknown"))
                    for event in evaluations
                ],
            )
        )
    return rows


async def main() -> None:
    args = parse_args()
    rows = await run_role_benchmark(
        provider=args.provider,
        iterations=args.iterations,
        benchmark_run_id=args.benchmark_run_id,
        scenarios=select_scenarios(args),
    )
    print(format_markdown(rows))

    if args.output_json:
        payload = [row.to_json() for row in rows]
        Path(args.output_json).write_text(
            f"{json.dumps(payload, indent=2, ensure_ascii=False)}\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    asyncio.run(main())
