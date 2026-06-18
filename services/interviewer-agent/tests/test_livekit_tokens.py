from __future__ import annotations

from app.adapters.livekit_tokens import build_livekit_agent_join


def test_build_livekit_agent_join_mints_agent_token_without_exposing_secret() -> None:
    join = build_livekit_agent_join(
        session_id="is_test",
        room_name="prelude-is_test",
        env={
            "LIVEKIT_URL": "wss://livekit.example.test",
            "LIVEKIT_API_KEY": "lk_key",
            "LIVEKIT_API_SECRET": "a" * 32,
        },
    )

    assert join.room_name == "prelude-is_test"
    assert join.url == "wss://livekit.example.test"
    assert join.participant == "agent-is_test"
    assert join.token
    assert "a" * 32 not in join.model_dump_json()


def test_build_livekit_agent_join_rejects_missing_env_without_secret_values() -> None:
    try:
        build_livekit_agent_join(
            session_id="is_test",
            room_name="prelude-is_test",
            env={"LIVEKIT_URL": "wss://livekit.example.test"},
        )
    except ValueError as exc:
        message = str(exc)
    else:
        raise AssertionError("expected missing LiveKit env to fail")

    assert "LIVEKIT_API_KEY" in message
    assert "LIVEKIT_API_SECRET" in message
    assert "wss://livekit.example.test" not in message
