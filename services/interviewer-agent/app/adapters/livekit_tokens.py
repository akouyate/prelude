from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Mapping

from app.domain.models import AgentLiveKitJoin


def build_livekit_agent_join(
    *,
    session_id: str,
    room_name: str,
    env: Mapping[str, str],
    ttl_seconds: int = 900,
) -> AgentLiveKitJoin:
    missing = [
        key
        for key in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")
        if not env.get(key)
    ]
    if missing:
        raise ValueError(
            f"missing LiveKit environment variables: {', '.join(missing)}"
        )

    try:
        from livekit import api
    except ImportError as exc:
        raise RuntimeError(
            "livekit is required to mint a real LiveKit join token. "
            "Install dependencies from services/interviewer-agent/requirements.txt."
        ) from exc

    participant = f"agent-{session_id}"
    ttl = timedelta(seconds=ttl_seconds)
    token = (
        api.AccessToken(env["LIVEKIT_API_KEY"], env["LIVEKIT_API_SECRET"])
        .with_identity(participant)
        .with_name("Prelude IA interviewer")
        .with_kind("agent")
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
                agent=True,
            )
        )
        .with_ttl(ttl)
        .to_jwt()
    )

    return AgentLiveKitJoin(
        room_name=room_name,
        url=env["LIVEKIT_URL"],
        token=token,
        participant=participant,
        expires_at=datetime.now(timezone.utc) + ttl,
    )
