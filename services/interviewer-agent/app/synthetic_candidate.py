"""Synthetic candidate end-to-end voice harness for the live IA interviewer.

This joins a real LiveKit interview room *as the candidate*, plays text-to-speech
audio of scripted answers, and drives a full voice interview automatically. It
exists so the agent's turn-taking can be smoke-tested without a human sitting
through a live interview.

Flow (all verified against the running stack):

  1. POST /v1/interview-sessions to the Go realtime API. The API persists the
     session and dispatches an agent-join over Redis; a separately-running
     autoworker (``make live-openai-autoworker``) picks it up and the interviewer
     agent joins the same room. This harness does NOT start the agent.
  2. Join the LiveKit room as the candidate using the url+token the Go API
     returned (we never mint tokens ourselves).
  3. Publish a mono 24 kHz PCM microphone track.
  4. Watch the append-only Postgres event store (``live_interview_events``) for
     ``agent_speech_completed`` rows. Each one carries the interviewer's spoken
     text at ``payload.transcript_turn.text``. When a new one appears, speak the
     next scripted answer. Stop on ``session_closing`` / ``session_completed`` or
     a hard wall-clock cap.
  5. Synthesize each answer (default: local pocket-tts, free/CPU; optional:
     OpenAI TTS) and stream it into the LiveKit track in real time, with short
     silences between sentences so the agent's turn-detector sees realistic pauses.
  6. Print a PASS/FAIL verdict read back from the event store.

The TTS layer is pluggable via ``--tts {pocket,openai}`` (default ``pocket``).
pocket-tts is a heavy, host-side-only dependency: it is installed by the make
target's ``uv`` invocation, never added to the service's prod requirements or
Docker image.

Run via the gated Makefile target ``make e2e-voice-smoke`` (see the Makefile).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Protocol

import httpx
from livekit import rtc

logger = logging.getLogger("synthetic_candidate")

# --- Audio constants -------------------------------------------------------

# LiveKit track format. OpenAI "pcm" TTS and pocket-tts (french_24l) both emit
# 24 kHz mono, so this is the native rate end-to-end (no resampling in practice).
LIVEKIT_SAMPLE_RATE = 24_000
LIVEKIT_NUM_CHANNELS = 1
FRAME_DURATION_MS = 10
SAMPLES_PER_FRAME = LIVEKIT_SAMPLE_RATE * FRAME_DURATION_MS // 1000  # 240
BYTES_PER_SAMPLE = 2  # int16 little-endian

# Pause inserted between sentences so the turn-detector sees a realistic gap.
INTER_SENTENCE_SILENCE_MS = 200
# Human-like "thinking" delay before the candidate starts answering.
PRE_ANSWER_DELAY_S = 0.8
# After session_closing, keep polling this long for session_completed — the LLM
# closing line plays out (~15s) before it fires.
CLOSING_GRACE_S = 25.0

# Trigger / lifecycle tuning.
EVENT_POLL_INTERVAL_S = 0.5
AGENT_JOIN_TIMEOUT_S = 30.0
# A session_closing while the candidate has spoken less than this is flagged as a
# likely premature end (the agent bailed before the interview really happened).
PREMATURE_END_MIN_SPOKEN_S = 8.0

# --- Scripted answers (the candidate's REAL prior answers; FR, role: CSM) ---

SCRIPTED_ANSWERS: tuple[str, ...] = (
    "Ce qui me plaît dans ce poste de Customer Success Manager, c'est avant tout "
    "l'accompagnement des clients sur la durée : construire une relation de "
    "confiance, comprendre leurs enjeux, et les aider à tirer le maximum de valeur "
    "du produit. J'aime être le point de contact qui transforme un client sceptique "
    "en véritable ambassadeur.",
    "Récemment, j'ai onboardé une cliente complètement sceptique à l'idée d'utiliser "
    "notre outil. J'ai mis en place un accompagnement rapproché : des points "
    "hebdomadaires, de la formation sur mesure, et un suivi régulier des indicateurs "
    "d'usage. En trois mois, on est passés d'une satisfaction de deux à quatre "
    "étoiles, et elle est devenue l'une de nos meilleures références.",
    "Pour un client à risque après une implémentation difficile, je commence par un "
    "point franc pour comprendre la cause réelle de la frustration. Ensuite je "
    "co-construis un plan de remédiation avec des jalons concrets et un accompagnement "
    "renforcé, et je sécurise un sponsor exécutif des deux côtés pour ancrer la "
    "relation sur le long terme.",
)

# Generic elaboration used when a follow-up arrives but the scripted queue is empty,
# so every agent utterance still gets a spoken answer.
GENERIC_FOLLOWUP = (
    "Pour préciser, je m'appuie sur des points réguliers et des indicateurs concrets "
    "pour garder la relation sur de bons rails et anticiper les risques."
)


# ===========================================================================
# Sentence splitting
# ===========================================================================

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?:])\s+")


def split_sentences(text: str) -> list[str]:
    """Split an answer into sentence-ish chunks for per-sentence synthesis."""
    parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(text.strip())]
    return [p for p in parts if p]


# ===========================================================================
# TTS providers
# ===========================================================================


class TTSProvider(Protocol):
    """Synthesizes a sentence to 24 kHz mono signed-16-bit-LE PCM bytes."""

    async def synthesize(self, sentence: str) -> bytes:
        ...

    async def aclose(self) -> None:
        ...


def _float_to_pcm16(samples: "object") -> bytes:
    """Convert a 1-D float array/tensor in [-1, 1] to int16 LE PCM bytes."""
    import numpy as np

    arr = np.asarray(samples, dtype=np.float32).reshape(-1)
    clipped = np.clip(arr, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def _resample_to_livekit(samples: "object", src_rate: int) -> bytes:
    """Resample a float signal to the LiveKit rate and return int16 PCM bytes.

    pocket-tts french_24l and OpenAI pcm are already 24 kHz, so this is only a
    safety net for a future model whose ``sample_rate`` differs.
    """
    import numpy as np

    arr = np.asarray(samples, dtype=np.float32).reshape(-1)
    if src_rate != LIVEKIT_SAMPLE_RATE:
        from scipy.signal import resample_poly

        from math import gcd

        g = gcd(int(src_rate), LIVEKIT_SAMPLE_RATE)
        arr = resample_poly(arr, LIVEKIT_SAMPLE_RATE // g, int(src_rate) // g)
    return _float_to_pcm16(arr)


class PocketTTS:
    """Local, free, CPU TTS via kyutai-labs pocket-tts.

    ``load_model`` and ``get_state_for_audio_prompt`` are slow, so we do them once
    here and reuse the voice state for every sentence. Generation is offloaded to a
    thread because the model is synchronous/CPU-bound.

    Verified against pocket-tts 2.1.0: French is only available as the 24-layer
    model, so the language id must be ``french_24l`` (plain ``french`` raises).
    """

    def __init__(self, *, language: str = "french_24l", voice: str = "estelle") -> None:
        from pocket_tts import TTSModel

        logger.info("pocket-tts: loading model language=%s (slow, one-time)", language)
        self._model = TTSModel.load_model(language=language)
        logger.info("pocket-tts: loading voice state voice=%s", voice)
        self._voice_state = self._model.get_state_for_audio_prompt(voice)
        self._sample_rate = int(self._model.sample_rate)
        logger.info("pocket-tts: ready (sample_rate=%d Hz)", self._sample_rate)

    def _generate_blocking(self, sentence: str) -> bytes:
        tensor = self._model.generate_audio(
            self._voice_state, sentence, max_tokens=2000
        )
        samples = tensor.detach().cpu().numpy()
        if self._sample_rate == LIVEKIT_SAMPLE_RATE:
            return _float_to_pcm16(samples)
        return _resample_to_livekit(samples, self._sample_rate)

    async def synthesize(self, sentence: str) -> bytes:
        return await asyncio.to_thread(self._generate_blocking, sentence)

    async def aclose(self) -> None:  # nothing to release
        return None


class OpenAITTS:
    """Optional OpenAI TTS fallback (paid; gated behind ALLOW_LIVE_LLM_TESTS).

    Verified against openai 2.43.0: ``audio.speech.with_streaming_response.create``
    accepts ``response_format="pcm"`` (raw 24 kHz mono int16 LE) and the response
    exposes ``aiter_bytes()``.
    """

    def __init__(self, *, voice: str = "alloy", model: str = "gpt-4o-mini-tts") -> None:
        from openai import AsyncOpenAI

        if not os.environ.get("OPENAI_API_KEY"):
            raise RuntimeError("OPENAI_API_KEY is required for --tts openai")
        self._client = AsyncOpenAI()
        self._voice = voice
        self._model = model
        logger.info("openai-tts: ready (model=%s voice=%s)", model, voice)

    async def synthesize(self, sentence: str) -> bytes:
        chunks: list[bytes] = []
        async with self._client.audio.speech.with_streaming_response.create(
            model=self._model,
            voice=self._voice,
            input=sentence,
            response_format="pcm",
        ) as response:
            async for chunk in response.aiter_bytes():
                if chunk:
                    chunks.append(chunk)
        return b"".join(chunks)

    async def aclose(self) -> None:
        await self._client.close()


async def build_tts(kind: str, voice: str | None) -> TTSProvider:
    """Construct the requested TTS provider, off the event loop where slow."""
    if kind == "pocket":
        return await asyncio.to_thread(
            lambda: PocketTTS(voice=voice or "estelle")
        )
    if kind == "openai":
        return OpenAITTS(voice=voice or "alloy")
    raise ValueError(f"unknown tts provider: {kind!r}")


# ===========================================================================
# Realtime API client (session creation)
# ===========================================================================


@dataclass(frozen=True)
class LiveKitJoin:
    room_name: str
    url: str
    token: str
    participant: str


@dataclass(frozen=True)
class CreatedSession:
    session_id: str
    join: LiveKitJoin


async def create_session(
    *,
    api_url: str,
    interview_plan_id: str,
    candidate_id: str,
    api_key: str | None,
) -> CreatedSession:
    """POST /v1/interview-sessions and parse the join descriptor (HTTP 201)."""
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    body = {
        "interview_plan_id": interview_plan_id,
        "candidate_id": candidate_id,
        "allowed_modalities": ["audio"],
    }
    url = api_url.rstrip("/") + "/v1/interview-sessions"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, headers=headers, json=body)
    if resp.status_code not in (200, 201):
        raise RuntimeError(
            f"create session failed: HTTP {resp.status_code}: {resp.text[:500]}"
        )
    data = resp.json()
    session = data["session"]
    join = data["livekit_join"]
    return CreatedSession(
        session_id=session["id"],
        join=LiveKitJoin(
            room_name=join["room_name"],
            url=join["url"],
            token=join["token"],
            participant=join.get("participant", candidate_id),
        ),
    )


# ===========================================================================
# Event store polling (psql subprocess; no psycopg dependency)
# ===========================================================================


@dataclass(frozen=True)
class StoredEvent:
    sequence_number: int
    type: str
    payload: dict


async def emit_candidate_ready(
    *,
    api_url: str,
    session_id: str,
    candidate_id: str,
    participant_id: str,
    room_name: str,
    api_key: str | None,
) -> None:
    """Tell the Go API the candidate's mic is live so it dispatches the agent.

    The interviewer agent-join is gated on ingestion of ``candidate_media_ready``
    (service.go ``dispatchAgentIfNeeded``); the session state machine requires
    ``candidate_joined`` (Created -> AgentJoining) before it. The real candidate
    app posts these after joining + publishing the mic — the synthetic candidate
    must do the same or the agent never joins.
    """
    base = api_url.rstrip("/") + f"/v1/interview-sessions/{session_id}/events"
    headers = {"content-type": "application/json"}
    if api_key:
        headers["authorization"] = f"Bearer {api_key}"
    # The append-only store needs event_id + a monotonic sequence (1-indexed).
    # The harness posts the first events for a fresh session, so 1 then 2.
    events = [
        {
            "event_id": f"evt_{session_id}_candidate_joined",
            "type": "candidate_joined",
            "actor": "candidate",
            "candidate_id": candidate_id,
            "sequence": 1,
            "sequence_number": 1,
            "idempotency_key": f"{session_id}:candidate_joined",
            "payload": {
                "candidate_participant_id": participant_id,
                "modes": ["audio"],
                "room_name": room_name,
            },
        },
        {
            "event_id": f"evt_{session_id}_candidate_media_ready",
            "type": "candidate_media_ready",
            "actor": "candidate",
            "candidate_id": candidate_id,
            "sequence": 2,
            "sequence_number": 2,
            "idempotency_key": f"{session_id}:candidate_media_ready",
            "payload": {
                "candidate_participant_id": participant_id,
                "audio": True,
                "video": False,
                "published_tracks": ["microphone"],
                "room_name": room_name,
            },
        },
    ]
    async with httpx.AsyncClient(timeout=15.0) as client:
        for body in events:
            resp = await client.post(base, json=body, headers=headers)
            if resp.status_code >= 300:
                raise RuntimeError(
                    f"event {body['type']} rejected: {resp.status_code} {resp.text[:200]}"
                )
            logger.info("emitted %s (%s)", body["type"], resp.status_code)


class EventStore:
    """Reads ``live_interview_events`` for one session via the ``psql`` CLI.

    psycopg/psycopg2 are not installed in the agent toolchain, but ``psql`` is
    available, so we shell out and parse JSON lines. Queries run in a thread to
    keep the event loop responsive.
    """

    def __init__(self, database_url: str, session_id: str) -> None:
        # psql rejects Prisma-style query params (e.g. ?schema=public). Strip the
        # query string; the queried tables live in the default "public" schema.
        self._database_url = database_url.split("?", 1)[0]
        self._session_id = session_id

    def _run_query(self, sql: str) -> str:
        proc = subprocess.run(
            ["psql", self._database_url, "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"psql failed: {proc.stderr.strip()[:500]}")
        return proc.stdout

    def _fetch_blocking(self, after_sequence: int) -> list[StoredEvent]:
        # row_to_json over a subquery yields one JSON object per line. We escape
        # the session id defensively even though it is server-minted (is_...).
        safe_session = self._session_id.replace("'", "''")
        sql = (
            "select row_to_json(t) from ("
            "  select sequence_number, type, payload"
            "  from live_interview_events"
            f"  where session_id = '{safe_session}'"
            f"    and sequence_number > {int(after_sequence)}"
            "  order by sequence_number asc"
            ") t"
        )
        out = self._run_query(sql)
        events: list[StoredEvent] = []
        for line in out.splitlines():
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            payload = row.get("payload")
            if isinstance(payload, str):
                payload = json.loads(payload) if payload else {}
            events.append(
                StoredEvent(
                    sequence_number=int(row["sequence_number"]),
                    type=str(row["type"]),
                    payload=payload or {},
                )
            )
        return events

    async def fetch_after(self, after_sequence: int) -> list[StoredEvent]:
        return await asyncio.to_thread(self._fetch_blocking, after_sequence)


def agent_transcript_text(event: StoredEvent) -> str:
    """Extract the interviewer's spoken text from an agent_speech_completed event.

    The live worker builds the payload as
    ``{... , "transcript_turn": {"speaker": "interviewer", "text": "...", ...}}``.
    Bare agent state-signal emits carry no ``transcript_turn`` and return "".
    """
    turn = event.payload.get("transcript_turn")
    if not isinstance(turn, dict):
        return ""
    text = turn.get("text")
    return text.strip() if isinstance(text, str) else ""


# ===========================================================================
# LiveKit audio publishing
# ===========================================================================


class CandidateAudio:
    """Owns the published microphone track and paces PCM into it in real time."""

    def __init__(self) -> None:
        self._source = rtc.AudioSource(LIVEKIT_SAMPLE_RATE, LIVEKIT_NUM_CHANNELS)
        self._track = rtc.LocalAudioTrack.create_audio_track(
            "candidate-voice", self._source
        )

    async def publish(self, room: rtc.Room) -> None:
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await room.local_participant.publish_track(self._track, options)
        logger.info("candidate audio track published")

    async def play_pcm(self, pcm: bytes) -> None:
        """Push raw int16 mono PCM as 10 ms frames.

        ``AudioSource.capture_frame`` self-paces by awaiting queue space, so this
        plays out at real time without a manual sleep per frame.
        """
        frame_bytes = SAMPLES_PER_FRAME * BYTES_PER_SAMPLE
        for offset in range(0, len(pcm), frame_bytes):
            chunk = pcm[offset : offset + frame_bytes]
            if not chunk:
                continue
            # Zero-pad a short final chunk to a whole frame.
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=LIVEKIT_SAMPLE_RATE,
                num_channels=LIVEKIT_NUM_CHANNELS,
                samples_per_channel=SAMPLES_PER_FRAME,
            )
            await self._source.capture_frame(frame)

    async def play_silence(self, duration_ms: int) -> None:
        frames = max(0, duration_ms // FRAME_DURATION_MS)
        silent = b"\x00" * (SAMPLES_PER_FRAME * BYTES_PER_SAMPLE)
        for _ in range(frames):
            frame = rtc.AudioFrame(
                data=silent,
                sample_rate=LIVEKIT_SAMPLE_RATE,
                num_channels=LIVEKIT_NUM_CHANNELS,
                samples_per_channel=SAMPLES_PER_FRAME,
            )
            await self._source.capture_frame(frame)

    async def aclose(self) -> None:
        await self._source.aclose()


# ===========================================================================
# Conversation driver
# ===========================================================================


@dataclass
class RunState:
    answers: list[str]
    next_answer_index: int = 0
    last_sequence_handled: int = 0
    spoken_seconds: float = 0.0
    responses_spoken: int = 0
    closing_seen: bool = False
    completed_seen: bool = False
    agent_joined: bool = False
    premature_closing: bool = False
    speaking: bool = field(default=False)

    def next_answer(self) -> str:
        if self.next_answer_index < len(self.answers):
            text = self.answers[self.next_answer_index]
            self.next_answer_index += 1
            return text
        return GENERIC_FOLLOWUP


async def speak_answer(
    audio: CandidateAudio, tts: TTSProvider, state: RunState, text: str
) -> None:
    """Synthesize the WHOLE answer first, then play it as one continuous turn.

    Synthesizing sentence-by-sentence while playing leaves multi-second silences
    (the model is generating the next sentence) which the VAD reads as several
    short turns — defeating the per-turn aggregation we are testing. Pre-rendering
    every chunk makes the candidate's answer a single speaking run with only short
    inter-sentence pauses.
    """
    state.speaking = True
    started = time.monotonic()
    try:
        sentences = split_sentences(text) or [text]
        chunks: list[bytes] = []
        for sentence in sentences:
            try:
                chunks.append(await tts.synthesize(sentence))
            except Exception:
                logger.exception("TTS failed for a sentence; skipping it")
        await asyncio.sleep(PRE_ANSWER_DELAY_S)
        for i, pcm in enumerate(chunks):
            await audio.play_pcm(pcm)
            if i < len(chunks) - 1:
                await audio.play_silence(INTER_SENTENCE_SILENCE_MS)
        # Trailing pause so the agent's endpoint detector closes the turn cleanly.
        await audio.play_silence(INTER_SENTENCE_SILENCE_MS)
    finally:
        state.spoken_seconds += time.monotonic() - started
        state.responses_spoken += 1
        state.speaking = False


async def drive_conversation(
    *,
    store: EventStore,
    audio: CandidateAudio,
    tts: TTSProvider,
    state: RunState,
    max_seconds: float,
) -> None:
    """Poll the event store and answer each interviewer utterance until the end.

    Responses are serialized: we never start a new answer while one is playing, so
    each ``agent_speech_completed`` triggers exactly one response.
    """
    deadline = time.monotonic() + max_seconds
    join_deadline = time.monotonic() + AGENT_JOIN_TIMEOUT_S
    closing_grace_deadline: float | None = None

    while True:
        if time.monotonic() > deadline:
            logger.warning("hard wall-clock cap (%.0fs) reached; stopping", max_seconds)
            return
        if closing_grace_deadline is not None and time.monotonic() > closing_grace_deadline:
            logger.info("session_completed did not arrive within the closing grace; stopping")
            return

        try:
            events = await store.fetch_after(state.last_sequence_handled)
        except Exception:
            logger.exception("event store poll failed; retrying")
            await asyncio.sleep(EVENT_POLL_INTERVAL_S)
            continue

        for event in events:
            state.last_sequence_handled = event.sequence_number

            if event.type in ("question_asked", "agent_speech_started", "session_started"):
                state.agent_joined = True

            if event.type == "session_completed":
                state.completed_seen = True
                logger.info("terminal event seen: session_completed")
                return

            if event.type == "session_closing":
                state.closing_seen = True
                if state.spoken_seconds < PREMATURE_END_MIN_SPOKEN_S:
                    state.premature_closing = True
                    logger.warning(
                        "session_closing after only %.1fs of candidate speech "
                        "(< %.1fs): possible premature end",
                        state.spoken_seconds,
                        PREMATURE_END_MIN_SPOKEN_S,
                    )
                # The closing line plays (LLM-generated, ~15s) before
                # session_completed fires — keep polling for it within a grace
                # window instead of stopping on session_closing.
                logger.info(
                    "session_closing seen — waiting up to %.0fs for session_completed",
                    CLOSING_GRACE_S,
                )
                closing_grace_deadline = time.monotonic() + CLOSING_GRACE_S
                continue

            if event.type == "agent_speech_completed":
                state.agent_joined = True
                # Ignore any agent utterance once closing has begun (the closing
                # line itself surfaces as an agent_speech_completed).
                if state.closing_seen:
                    continue
                text = agent_transcript_text(event)
                if not text:
                    continue
                answer = state.next_answer()
                logger.info(
                    "interviewer said (seq=%d): %s",
                    event.sequence_number,
                    text[:120],
                )
                logger.info("candidate answering: %s", answer[:120])
                await speak_answer(audio, tts, state, answer)

        if not state.agent_joined and time.monotonic() > join_deadline:
            raise RuntimeError(
                "interviewer agent never joined within "
                f"{AGENT_JOIN_TIMEOUT_S:.0f}s (is the autoworker running? "
                "`make live-openai-autoworker`)"
            )

        await asyncio.sleep(EVENT_POLL_INTERVAL_S)


# ===========================================================================
# Verdict
# ===========================================================================


async def print_verdict(store: EventStore, state: RunState, started_at: float) -> bool:
    """Summarize the run from the event store and return True on a clean pass."""
    try:
        events = await store.fetch_after(0)
    except Exception:
        logger.exception("could not read event store for verdict")
        return False

    counts: dict[str, int] = {}
    for event in events:
        counts[event.type] = counts.get(event.type, 0) + 1

    questions_asked = counts.get("question_asked", 0)
    questions_completed = counts.get("question_completed", 0)
    session_completed = counts.get("session_completed", 0) > 0
    session_closing = counts.get("session_closing", 0) > 0
    duration = time.monotonic() - started_at

    # The interview ended properly once it reached the closing (all questions done
    # plus the wrap-up). session_completed is just the post-closing-playout
    # confirmation, and the LLM closing line can run ~15s, so session_closing with
    # every question completed is itself a pass.
    reached_end = session_completed or (
        session_closing and questions_completed >= questions_asked
    )
    clean = (
        reached_end
        and questions_asked > 0
        and questions_completed > 0
        and not state.premature_closing
    )
    verdict = "PASS" if clean else "FAIL"

    logger.info("=" * 60)
    logger.info("SYNTHETIC CANDIDATE VERDICT: %s", verdict)
    logger.info("  questions_asked      : %d", questions_asked)
    logger.info("  questions_completed  : %d", questions_completed)
    logger.info("  session_closing      : %s", session_closing)
    logger.info("  session_completed    : %s", session_completed)
    logger.info("  candidate responses  : %d", state.responses_spoken)
    logger.info("  candidate spoken time: %.1fs", state.spoken_seconds)
    logger.info("  premature closing    : %s", state.premature_closing)
    logger.info("  wall-clock duration  : %.1fs", duration)
    logger.info("  event type counts    : %s", json.dumps(counts, sort_keys=True))
    logger.info("=" * 60)
    return clean


# ===========================================================================
# Entry point
# ===========================================================================


async def run(args: argparse.Namespace) -> int:
    candidate_id = args.candidate_id or f"synthetic-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    logger.info("creating interview session (candidate_id=%s)", candidate_id)
    created = await create_session(
        api_url=args.realtime_api_url,
        interview_plan_id=args.interview_plan_id,
        candidate_id=candidate_id,
        api_key=args.api_key or os.environ.get("REALTIME_API_KEY"),
    )
    logger.info(
        "session created: id=%s room=%s",
        created.session_id,
        created.join.room_name,
    )

    store = EventStore(args.database_url, created.session_id)
    state = RunState(answers=list(SCRIPTED_ANSWERS))

    # Build TTS before joining so model load time doesn't eat into the interview.
    logger.info("initializing TTS provider: %s", args.tts)
    tts = await build_tts(args.tts, args.voice)

    room = rtc.Room()
    audio = CandidateAudio()
    started_at = time.monotonic()
    try:
        logger.info("connecting to LiveKit room as candidate...")
        await room.connect(created.join.url, created.join.token)
        logger.info("connected; local participant=%s", room.local_participant.identity)
        await audio.publish(room)
        # Trigger the interviewer agent: the Go API dispatches the agent-join
        # only when it ingests candidate_media_ready (preceded by candidate_joined).
        await emit_candidate_ready(
            api_url=args.realtime_api_url,
            session_id=created.session_id,
            candidate_id=candidate_id,
            participant_id=room.local_participant.identity,
            room_name=created.join.room_name,
            api_key=args.api_key or os.environ.get("REALTIME_API_KEY"),
        )

        await drive_conversation(
            store=store,
            audio=audio,
            tts=tts,
            state=state,
            max_seconds=args.max_seconds,
        )
        clean = await print_verdict(store, state, started_at)
        return 0 if clean else 1
    finally:
        try:
            await audio.aclose()
        except Exception:
            logger.debug("audio close error", exc_info=True)
        try:
            await room.disconnect()
        except Exception:
            logger.debug("room disconnect error", exc_info=True)
        try:
            await tts.aclose()
        except Exception:
            logger.debug("tts close error", exc_info=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Synthetic candidate voice harness for the live IA interviewer."
    )
    parser.add_argument(
        "--interview-plan-id",
        default="interview_e2e_local-live",
        help="Published Interview id the candidate link resolves to.",
    )
    parser.add_argument(
        "--realtime-api-url",
        default="http://127.0.0.1:8080",
        help="Base URL of the Go realtime API.",
    )
    parser.add_argument(
        "--database-url",
        default="postgresql://postgres:postgres@localhost:5440/prelude",
        help="Postgres URL for the live_interview_events store.",
    )
    parser.add_argument(
        "--tts",
        choices=("pocket", "openai"),
        default="pocket",
        help="TTS backend. pocket = local/free/CPU (default); openai = paid fallback.",
    )
    parser.add_argument(
        "--voice",
        default=None,
        help="Voice id (pocket default: estelle; openai default: alloy).",
    )
    parser.add_argument(
        "--candidate-id",
        default=None,
        help="Override the candidate id (default: generated unique per run).",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Bearer token for the realtime API (else REALTIME_API_KEY env).",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=240.0,
        help="Hard wall-clock cap for the whole run.",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        help="Logging level (DEBUG, INFO, WARNING, ...).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, str(args.log_level).upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    try:
        return asyncio.run(run(args))
    except KeyboardInterrupt:
        logger.warning("interrupted")
        return 130
    except Exception as exc:
        logger.error("synthetic candidate run failed: %s", exc)
        logger.debug("traceback", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
