from __future__ import annotations

import pytest

from app.live_worker import (
    _guard_real_livekit_token,
    _mock_interview_allowed,
    _validate_env,
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
