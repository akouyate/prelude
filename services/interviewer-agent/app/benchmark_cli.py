from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from app.benchmark.runner import BenchmarkRunConfig, BenchmarkRunner
from app.benchmark.scenarios import BenchmarkScenarioName


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run repeatable Prelude live IA interviewer provider benchmarks."
    )
    parser.add_argument(
        "--provider",
        default="mock_openai_realtime",
        choices=["mock_openai_realtime", "openai_realtime", "elevenlabs"],
        help="Provider adapter to benchmark.",
    )
    parser.add_argument(
        "--scenario",
        default=BenchmarkScenarioName.NORMAL.value,
        choices=[scenario.value for scenario in BenchmarkScenarioName],
        help="Benchmark scenario to execute.",
    )
    parser.add_argument(
        "--iterations",
        type=positive_int,
        default=3,
        help="Runs per scenario.",
    )
    parser.add_argument(
        "--benchmark-run-id",
        default=None,
        help="Stable id for this benchmark batch.",
    )
    parser.add_argument("--session-id-prefix", default=None, help="Prefix for generated session ids.")
    parser.add_argument(
        "--realtime-api-url",
        default=None,
        help="Go realtime API base URL. If omitted, events stay in memory.",
    )
    parser.add_argument("--api-key", default=None, help="Optional bearer token for the Go API.")
    parser.add_argument(
        "--allow-live-llm-tests",
        action="store_true",
        help=(
            "Allow paid live LLM provider benchmarks. Without this flag or "
            "ALLOW_LIVE_LLM_TESTS=1, real providers are blocked."
        ),
    )
    parser.add_argument(
        "--output-json",
        default=None,
        help="Optional path where the benchmark report JSON should be written.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    config_kwargs = {
        "provider": args.provider,
        "scenario": BenchmarkScenarioName(args.scenario),
        "iterations": args.iterations,
        "session_id_prefix": args.session_id_prefix,
        "realtime_api_url": args.realtime_api_url,
        "api_key": args.api_key,
        "allow_live_llm_tests": args.allow_live_llm_tests,
    }
    if args.benchmark_run_id:
        config_kwargs["benchmark_run_id"] = args.benchmark_run_id

    report = await BenchmarkRunner().run(BenchmarkRunConfig(**config_kwargs))
    payload = report.model_dump(mode="json")
    output = json.dumps(payload, indent=2, ensure_ascii=False)
    print(output)

    if args.output_json:
        Path(args.output_json).write_text(f"{output}\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
