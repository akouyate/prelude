from __future__ import annotations

import pytest

from app.live_worker import (
    _guard_real_livekit_token,
    _mock_interview_allowed,
    _validate_env,
    parse_args,
)


def test_live_worker_requires_openai_env_for_real_handshake() -> None:
    with pytest.raises(RuntimeError) as exc:
        _validate_env({}, skip_openai_handshake=False)

    assert "OPENAI_API_KEY" in str(exc.value)


def test_mock_interview_is_refused_by_default() -> None:
    # Default-deny: an unset flag must never silently allow a fake interview.
    assert _mock_interview_allowed({}) is False


def test_mock_interview_allowed_only_when_explicitly_enabled_outside_production() -> None:
    assert _mock_interview_allowed({"ALLOW_MOCK_INTERVIEW": "true"}) is True
    # Production hard-denies mock even if the flag is set (defense in depth).
    assert (
        _mock_interview_allowed(
            {"ALLOW_MOCK_INTERVIEW": "true", "APP_ENV": "production"}
        )
        is False
    )


def test_skip_openai_handshake_is_refused_unless_mock_is_allowed() -> None:
    with pytest.raises(RuntimeError) as exc:
        _validate_env({}, skip_openai_handshake=True)
    assert "mock" in str(exc.value).lower()

    # Allowed only in an explicitly mock-enabled, non-production environment.
    _validate_env({"ALLOW_MOCK_INTERVIEW": "true"}, skip_openai_handshake=True)


def test_mock_livekit_token_is_refused_unless_mock_is_allowed() -> None:
    with pytest.raises(RuntimeError) as exc:
        _guard_real_livekit_token("mock_lk_abc", {})
    assert "mock" in str(exc.value).lower()

    # A real token always passes; a mock token passes only when mock is allowed.
    _guard_real_livekit_token("real-livekit-token", {})
    _guard_real_livekit_token("mock_lk_abc", {"ALLOW_MOCK_INTERVIEW": "true"})


def test_live_worker_flags_win_over_environment_variables() -> None:
    args = parse_args(
        [
            "--session-id",
            "is_flag",
            "--realtime-api-url",
            "http://flag.internal:8080",
            "--api-key",
            "flag-key",
        ],
        env={
            "SESSION_ID": "is_env",
            "REALTIME_API_URL": "http://env.internal:8080",
            "REALTIME_API_KEY": "env-key",
        },
    )

    # `make live-openai-worker` passes flags; they must keep winning.
    assert args.session_id == "is_flag"
    assert args.realtime_api_url == "http://flag.internal:8080"
    assert args.api_key == "flag-key"


def test_live_worker_falls_back_to_environment_variables() -> None:
    # A container runs `python -m app.live_worker` with nothing but env vars.
    args = parse_args(
        [],
        env={
            "SESSION_ID": "is_env",
            "REALTIME_API_URL": "http://env.internal:8080",
            "REALTIME_API_KEY": "env-key",
        },
    )

    assert args.session_id == "is_env"
    assert args.realtime_api_url == "http://env.internal:8080"
    assert args.api_key == "env-key"


def test_live_worker_missing_realtime_api_url_names_both_ways_to_supply_it(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc:
        parse_args([], env={"SESSION_ID": "is_env"})

    assert exc.value.code == 2
    message = capsys.readouterr().err
    assert "--realtime-api-url" in message
    assert "REALTIME_API_URL" in message


def test_live_worker_missing_session_id_names_both_ways_to_supply_it(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as exc:
        parse_args([], env={"REALTIME_API_URL": "http://env.internal:8080"})

    assert exc.value.code == 2
    message = capsys.readouterr().err
    assert "--session-id" in message
    assert "SESSION_ID" in message
