from __future__ import annotations

import pytest

from app.live_worker import _validate_env


def test_live_worker_requires_openai_env_for_real_handshake() -> None:
    with pytest.raises(RuntimeError) as exc:
        _validate_env({}, skip_openai_handshake=False)

    assert "OPENAI_API_KEY" in str(exc.value)


def test_live_worker_allows_skipping_openai_handshake_for_local_join_smoke() -> None:
    _validate_env({}, skip_openai_handshake=True)
