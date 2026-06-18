from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping


@dataclass(frozen=True)
class OpenAIRealtimeConfig:
    api_key: str
    model: str
    voice: str
    turn_detection: str
    reasoning_effort: str
    handshake_timeout_seconds: float = 10.0

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "OpenAIRealtimeConfig":
        return cls(
            api_key=env["OPENAI_API_KEY"],
            model=env["OPENAI_REALTIME_MODEL"],
            voice=env["OPENAI_REALTIME_VOICE"],
            turn_detection=env["OPENAI_REALTIME_TURN_DETECTION"],
            reasoning_effort=env["OPENAI_REALTIME_REASONING_EFFORT"],
            handshake_timeout_seconds=float(
                env.get("OPENAI_REALTIME_HANDSHAKE_TIMEOUT_SECONDS", "10")
            ),
        )


RealtimeModelFactory = Callable[..., Any]


class OpenAIRealtimeSessionProbe:
    def __init__(
        self,
        config: OpenAIRealtimeConfig,
        *,
        realtime_model_factory: RealtimeModelFactory | None = None,
    ) -> None:
        self._config = config
        self._realtime_model_factory = realtime_model_factory

    async def connect(self) -> dict[str, object]:
        started = time.perf_counter()
        model = self._build_model()
        session = model.session()
        first_event: asyncio.Future[dict[str, Any]] = (
            asyncio.get_running_loop().create_future()
        )

        def on_server_event(event: dict[str, Any]) -> None:
            if first_event.done():
                return
            event_type = str(event.get("type", ""))
            if event_type.startswith("session."):
                first_event.set_result(event)

        def on_error(event: object) -> None:
            if first_event.done():
                return
            error = getattr(event, "error", event)
            first_event.set_exception(
                RuntimeError(
                    "OpenAI Realtime handshake failed "
                    f"with {error.__class__.__name__}."
                )
            )

        session.on("openai_server_event_received", on_server_event)
        session.on("error", on_error)

        try:
            event = await asyncio.wait_for(
                first_event,
                timeout=self._config.handshake_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise RuntimeError(
                "OpenAI Realtime handshake timed out before receiving a session event."
            ) from exc
        finally:
            await session.aclose()
            close_model = getattr(model, "aclose", None)
            if close_model:
                close_result = close_model()
                if hasattr(close_result, "__await__"):
                    await close_result

        return {
            "smoke_status": "connected",
            "handshake_event_type": event.get("type", ""),
            "openai_session_id": _openai_session_id(event),
            "connect_duration_ms": round((time.perf_counter() - started) * 1000),
            "model": self._config.model,
            "voice": self._config.voice,
            "turn_detection": self._config.turn_detection,
            "reasoning_effort": self._config.reasoning_effort,
        }

    def _build_model(self) -> Any:
        factory = self._realtime_model_factory or _load_realtime_model_factory()
        return factory(
            api_key=self._config.api_key,
            model=self._config.model,
            voice=self._config.voice,
            modalities=["audio"],
            turn_detection=_turn_detection(self._config.turn_detection),
            reasoning=_reasoning(self._config.reasoning_effort),
        )


def _load_realtime_model_factory() -> RealtimeModelFactory:
    try:
        from livekit.plugins.openai.realtime import RealtimeModel
    except ImportError as exc:
        raise RuntimeError(
            "livekit-agents[openai] is required for OpenAI Realtime live worker runs. "
            "Install dependencies from services/interviewer-agent/requirements.txt."
        ) from exc
    return RealtimeModel


def _turn_detection(value: str) -> object:
    normalized = value.strip().lower()
    if normalized in {"", "none", "null", "disabled", "off"}:
        return None

    from openai.types import realtime

    if normalized == "semantic_vad":
        return realtime.realtime_audio_input_turn_detection.SemanticVad(
            type="semantic_vad",
            create_response=True,
            interrupt_response=True,
            eagerness="auto",
        )
    if normalized == "server_vad":
        return realtime.realtime_audio_input_turn_detection.ServerVad(
            type="server_vad",
            create_response=True,
            interrupt_response=True,
        )
    raise ValueError(
        "OPENAI_REALTIME_TURN_DETECTION must be one of: "
        "semantic_vad, server_vad, none."
    )


def _reasoning(value: str) -> object:
    normalized = value.strip().lower()
    if normalized in {"", "none", "null", "disabled", "off"}:
        return None

    from openai.types import realtime

    return realtime.RealtimeReasoning(effort=normalized)


def _openai_session_id(event: Mapping[str, Any]) -> str | None:
    session = event.get("session")
    if isinstance(session, Mapping):
        session_id = session.get("id")
        if isinstance(session_id, str):
            return session_id
    event_id = event.get("event_id")
    if isinstance(event_id, str):
        return event_id
    return None
