from __future__ import annotations

import argparse
import asyncio
import os
from typing import Mapping

from app.adapters.answer_inference import build_live_answer_inference_provider
from app.adapters.livekit_room import LiveKitRoomAdapter
from app.adapters.livekit_openai_worker import OpenAILiveKitWorker, OpenAILiveWorkerConfig
from app.adapters.mock_openai_realtime import MockOpenAIRealtimeAdapter
from app.adapters.realtime_api import HttpRealtimeApiClient
from app.application.session_runner import InterviewSessionRunner


REQUIRED_OPENAI_ENV = (
    "OPENAI_API_KEY",
    "OPENAI_REALTIME_MODEL",
    "OPENAI_REALTIME_VOICE",
    "OPENAI_REALTIME_TURN_DETECTION",
    "OPENAI_REALTIME_REASONING_EFFORT",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the OpenAI-only Prelude live interviewer worker for one session."
    )
    parser.add_argument("--session-id", required=True, help="Go realtime session id.")
    parser.add_argument(
        "--realtime-api-url",
        required=True,
        help="Go realtime API base URL.",
    )
    parser.add_argument("--api-key", default=None, help="Optional bearer token for the Go API.")
    parser.add_argument(
        "--skip-openai-handshake",
        action="store_true",
        help="Join LiveKit and persist events without opening OpenAI Realtime.",
    )
    return parser.parse_args()


async def run_live_worker(
    *,
    session_id: str,
    realtime_api_url: str,
    api_key: str | None = None,
    env: Mapping[str, str] | None = None,
    skip_openai_handshake: bool = False,
) -> int:
    worker_env = env if env is not None else os.environ
    _validate_env(worker_env, skip_openai_handshake=skip_openai_handshake)

    realtime_api = HttpRealtimeApiClient(realtime_api_url, api_key=api_key)
    config = await realtime_api.get_agent_config(session_id)
    _guard_real_livekit_token(config.livekit_join.token, worker_env)

    if not skip_openai_handshake:
        return await OpenAILiveKitWorker(
            agent_config=config,
            realtime_api_emit_event=realtime_api.emit_event,
            realtime_api_has_event=realtime_api.has_event,
            realtime_api_count_events=realtime_api.count_events,
            worker_config=OpenAILiveWorkerConfig.from_env(worker_env),
            answer_inference=build_live_answer_inference_provider(worker_env),
        ).run()

    provider_metadata: dict[str, object] = {
        "live_worker": {
            "mode": "openai_realtime",
            "session_id": session_id,
            "room_name": config.livekit_join.room_name,
        }
    }
    initial_sequence = await realtime_api.count_events(session_id)

    runner = InterviewSessionRunner(
        plan=config.interview_plan,
        provider=MockOpenAIRealtimeAdapter(),
        realtime_api=realtime_api,
        session_id=session_id,
        livekit_room=LiveKitRoomAdapter(),
        livekit_join=config.livekit_join,
        provider_name="openai_realtime",
        provider_metadata=provider_metadata,
        initial_sequence=initial_sequence,
    )
    result = await runner.run()
    print(
        f"Completed live OpenAI worker {result.session_id}: "
        f"{result.questions_completed} questions, {result.events_emitted} events emitted"
    )
    return result.events_emitted


async def main() -> None:
    args = parse_args()
    await run_live_worker(
        session_id=args.session_id,
        realtime_api_url=args.realtime_api_url,
        api_key=args.api_key,
        skip_openai_handshake=args.skip_openai_handshake,
    )


def _mock_interview_allowed(env: Mapping[str, str]) -> bool:
    # Default-deny: a fake (mock/scripted, no-audio) interview runs only when
    # explicitly enabled AND never in production (defense in depth against a
    # misconfigured deploy). A real candidate must never silently sit through one.
    if env.get("APP_ENV", "").strip().lower() == "production":
        return False
    return env.get("ALLOW_MOCK_INTERVIEW", "").strip().lower() in {"1", "true", "yes"}


def _guard_real_livekit_token(token: str, env: Mapping[str, str]) -> None:
    if token.startswith("mock_lk_") and not _mock_interview_allowed(env):
        raise RuntimeError(
            "Refusing a mock LiveKit token (mock_lk_*): the realtime API returned a "
            "mock room outside an explicitly mock-enabled, non-production environment. "
            "A real candidate must never silently sit through a fake, no-audio "
            "interview. Set ALLOW_MOCK_INTERVIEW=true only for local smoke runs."
        )


def _validate_env(env: Mapping[str, str], *, skip_openai_handshake: bool) -> None:
    if skip_openai_handshake:
        if not _mock_interview_allowed(env):
            raise RuntimeError(
                "Refusing --skip-openai-handshake: it runs a mock (scripted, no-audio) "
                "interview, which is disabled outside an explicitly mock-enabled, "
                "non-production environment. Set ALLOW_MOCK_INTERVIEW=true only for "
                "local smoke runs."
            )
        return

    missing = [key for key in REQUIRED_OPENAI_ENV if not env.get(key)]
    if missing:
        raise RuntimeError(
            "OpenAI live worker requires missing environment variables: "
            f"{', '.join(missing)}."
        )


if __name__ == "__main__":
    asyncio.run(main())
