from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Mapping

from app.benchmark.scenarios import BenchmarkScenario
from app.domain.models import CandidateTurn, InterviewPlan, InterviewQuestion
from app.domain.state_machine import INTERVIEWER_STATE_MACHINE_INSTRUCTIONS


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


class OpenAIRealtimeSmokeProvider:
    """OpenAI Realtime smoke adapter with deterministic candidate turns.

    The real provider boundary is exercised through a short OpenAI Realtime
    handshake. Candidate answers remain scripted so benchmark scenarios stay
    replayable until the candidate UI/media path exists.
    """

    def __init__(
        self,
        scenario: BenchmarkScenario,
        config: OpenAIRealtimeConfig,
        *,
        realtime_model_factory: RealtimeModelFactory | None = None,
    ) -> None:
        self._scenario = scenario
        self._config = config
        self._realtime_model_factory = realtime_model_factory
        self._turns = {
            question_id: list(turns)
            for question_id, turns in scenario.candidate_turns.items()
        }
        self._answers_by_question: dict[str, int] = defaultdict(int)
        self.system_instructions = INTERVIEWER_STATE_MACHINE_INSTRUCTIONS
        self.smoke_metadata: dict[str, object] = {
            "openai_realtime": {
                "smoke_status": "not_started",
                "model": config.model,
                "voice": config.voice,
                "turn_detection": config.turn_detection,
                "reasoning_effort": config.reasoning_effort,
            }
        }

    async def prepare_smoke(self) -> dict[str, object]:
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

        metadata = {
            "smoke_status": "connected",
            "handshake_event_type": event.get("type", ""),
            "openai_session_id": _openai_session_id(event),
            "connect_duration_ms": round((time.perf_counter() - started) * 1000),
            "model": self._config.model,
            "voice": self._config.voice,
            "turn_detection": self._config.turn_detection,
            "reasoning_effort": self._config.reasoning_effort,
        }
        self.smoke_metadata = {"openai_realtime": metadata}
        return dict(self.smoke_metadata)

    async def start_session(self, plan: InterviewPlan) -> str:
        return (
            "Bonjour, je suis l'interviewer IA de Prelude. "
            "Nous allons valider le chemin OpenAI Realtime et LiveKit "
            f"pour le poste {plan.role_title}."
        )

    async def ask_question(self, question: InterviewQuestion) -> str:
        return question.prompt

    async def listen_for_answer(self, question: InterviewQuestion) -> CandidateTurn:
        self._answers_by_question[question.id] += 1
        queued_turns = self._turns.get(question.id) or []
        if queued_turns:
            turn = queued_turns.pop(0)
            self._turns[question.id] = queued_turns
            return turn
        return CandidateTurn(
            question_id=question.id,
            transcript="Je peux completer avec un exemple concret et mes contraintes de disponibilite.",
            started_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            ended_at=datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=1),
        )

    async def should_follow_up(
        self,
        question: InterviewQuestion,
        turn: CandidateTurn,
        followups_used: int,
        max_followups: int,
    ) -> bool:
        if followups_used >= max_followups:
            return False
        if self._scenario.name.value == "vague" and question.follow_up_prompt:
            return self._answers_by_question[question.id] == 1
        return False

    async def ask_follow_up(self, question: InterviewQuestion) -> str:
        return question.follow_up_prompt or "Pouvez-vous preciser votre reponse ?"

    async def close_session(self) -> str:
        return "Merci, l'entretien est termine. Le recruteur recevra un resume structure."

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
            "livekit-agents[openai] is required for OpenAI Realtime smoke runs. "
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
