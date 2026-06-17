from __future__ import annotations

import argparse
import asyncio
from uuid import uuid4

from app.adapters.livekit_room import LiveKitRoomAdapter
from app.adapters.mock_openai_realtime import MockOpenAIRealtimeAdapter
from app.adapters.realtime_api import HttpRealtimeApiClient, InMemoryRealtimeApiClient
from app.application.session_runner import InterviewSessionRunner
from app.domain.models import create_demo_plan


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a mocked Prelude live interviewer session.")
    parser.add_argument("--session-id", default=f"session-{uuid4()}", help="Interview session id.")
    parser.add_argument(
        "--realtime-api-url",
        default=None,
        help="Go realtime API base URL. If omitted, events are printed locally.",
    )
    parser.add_argument("--api-key", default=None, help="Optional bearer token for the Go API.")
    parser.add_argument(
        "--join-livekit",
        action="store_true",
        help="Load agent config from the Go API and join the LiveKit room before running.",
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    plan = create_demo_plan()
    provider = MockOpenAIRealtimeAdapter()
    realtime_api = (
        HttpRealtimeApiClient(args.realtime_api_url, api_key=args.api_key)
        if args.realtime_api_url
        else InMemoryRealtimeApiClient()
    )
    livekit_room = None
    livekit_join = None
    provider_name = "mock"

    if args.join_livekit:
        if not isinstance(realtime_api, HttpRealtimeApiClient):
            raise SystemExit("--join-livekit requires --realtime-api-url")
        config = await realtime_api.get_agent_config(args.session_id)
        plan = config.interview_plan
        livekit_join = config.livekit_join
        livekit_room = LiveKitRoomAdapter()
        provider_name = config.provider

    runner = InterviewSessionRunner(
        plan=plan,
        provider=provider,
        realtime_api=realtime_api,
        session_id=args.session_id,
        livekit_room=livekit_room,
        livekit_join=livekit_join,
        provider_name=provider_name,
    )
    result = await runner.run()
    print(
        f"Completed {result.session_id}: "
        f"{result.questions_completed} questions, {result.events_emitted} events emitted"
    )


if __name__ == "__main__":
    asyncio.run(main())
