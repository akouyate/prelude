from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from enum import StrEnum


class InactivityStage(StrEnum):
    CHECK_IN = "check_in"
    WARNING = "warning"


class InactivityTrigger(StrEnum):
    USER_AWAY = "user_away"
    WAIT_EXTENSION = "wait_extension"
    PRESENCE_CONFIRMATION = "presence_confirmation"


@dataclass(frozen=True)
class CandidateInactivityPolicy:
    """Deterministic policy applied after LiveKit marks the user as away."""

    user_away_after_seconds: float = 15.0
    warning_after_seconds: float = 20.0
    terminate_after_seconds: float = 20.0
    wait_extension_seconds: float = 60.0

    def __post_init__(self) -> None:
        for name, value in (
            ("user_away_after_seconds", self.user_away_after_seconds),
            ("warning_after_seconds", self.warning_after_seconds),
            ("terminate_after_seconds", self.terminate_after_seconds),
            ("wait_extension_seconds", self.wait_extension_seconds),
        ):
            if value <= 0:
                raise ValueError(f"{name} must be positive")


@dataclass(frozen=True)
class InactivityStep:
    stage: InactivityStage
    trigger: InactivityTrigger
    silent_for_seconds: float
    next_action_in_seconds: float


InactivityStepHandler = Callable[[InactivityStep], Awaitable[None]]
InactivityTimeoutHandler = Callable[[InactivityTrigger, float], Awaitable[None]]
InactivityRecoveryHandler = Callable[
    [InactivityStage | None, InactivityTrigger, float, str],
    Awaitable[None],
]


class CandidateInactivityCoordinator:
    """Runs one cancellable inactivity sequence for a connected candidate."""

    def __init__(
        self,
        *,
        policy: CandidateInactivityPolicy,
        on_step: InactivityStepHandler,
        on_timeout: InactivityTimeoutHandler,
        on_recovered: InactivityRecoveryHandler,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._policy = policy
        self._on_step = on_step
        self._on_timeout = on_timeout
        self._on_recovered = on_recovered
        self._sleep = sleep
        self._clock = clock
        self._task: asyncio.Task[None] | None = None
        self._background_tasks: set[asyncio.Task[None]] = set()
        self._away_since: float | None = None
        self._stage: InactivityStage | None = None
        self._trigger = InactivityTrigger.USER_AWAY

    @property
    def stage(self) -> InactivityStage | None:
        return self._stage

    def mark_away(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._start(
            trigger=InactivityTrigger.USER_AWAY,
            initial_delay_seconds=0,
            silent_baseline_seconds=self._policy.user_away_after_seconds,
        )

    def grant_wait_extension(self) -> None:
        self._cancel()
        self._start(
            trigger=InactivityTrigger.WAIT_EXTENSION,
            initial_delay_seconds=self._policy.wait_extension_seconds,
            silent_baseline_seconds=self._policy.wait_extension_seconds,
        )

    def confirm_presence(self) -> None:
        self.mark_active(source="candidate_control")
        self._start(
            trigger=InactivityTrigger.PRESENCE_CONFIRMATION,
            initial_delay_seconds=self._policy.user_away_after_seconds,
            silent_baseline_seconds=self._policy.user_away_after_seconds,
        )

    def mark_active(self, *, source: str = "voice") -> None:
        task = self._task
        if task is None:
            return
        previous_stage = self._stage
        trigger = self._trigger
        elapsed = self._elapsed()
        self._cancel()
        if previous_stage is not None:
            task = asyncio.create_task(
                self._on_recovered(previous_stage, trigger, elapsed, source)
            )
            self._background_tasks.add(task)
            task.add_done_callback(self._background_tasks.discard)

    def pause(self) -> None:
        self._cancel()

    async def aclose(self) -> None:
        task = self._task
        self._cancel()
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if self._background_tasks:
            await asyncio.gather(
                *tuple(self._background_tasks),
                return_exceptions=True,
            )
            self._background_tasks.clear()

    def _start(
        self,
        *,
        trigger: InactivityTrigger,
        initial_delay_seconds: float,
        silent_baseline_seconds: float,
    ) -> None:
        self._trigger = trigger
        self._stage = None
        self._away_since = self._clock()
        self._task = asyncio.create_task(
            self._run(
                trigger=trigger,
                initial_delay_seconds=initial_delay_seconds,
                silent_baseline_seconds=silent_baseline_seconds,
            )
        )

    async def _run(
        self,
        *,
        trigger: InactivityTrigger,
        initial_delay_seconds: float,
        silent_baseline_seconds: float,
    ) -> None:
        try:
            if initial_delay_seconds:
                await self._sleep(initial_delay_seconds)

            self._stage = InactivityStage.CHECK_IN
            await self._on_step(
                InactivityStep(
                    stage=self._stage,
                    trigger=trigger,
                    silent_for_seconds=silent_baseline_seconds,
                    next_action_in_seconds=self._policy.warning_after_seconds,
                )
            )
            await self._sleep(self._policy.warning_after_seconds)

            self._stage = InactivityStage.WARNING
            await self._on_step(
                InactivityStep(
                    stage=self._stage,
                    trigger=trigger,
                    silent_for_seconds=(
                        silent_baseline_seconds
                        + self._policy.warning_after_seconds
                    ),
                    next_action_in_seconds=self._policy.terminate_after_seconds,
                )
            )
            await self._sleep(self._policy.terminate_after_seconds)

            await self._on_timeout(
                trigger,
                silent_baseline_seconds
                + self._policy.warning_after_seconds
                + self._policy.terminate_after_seconds,
            )
        except asyncio.CancelledError:
            return
        finally:
            if self._task is asyncio.current_task():
                self._task = None

    def _cancel(self) -> None:
        task = self._task
        if task is not None and not task.done():
            task.cancel()
        self._task = None
        self._away_since = None
        self._stage = None

    def _elapsed(self) -> float:
        if self._away_since is None:
            return 0
        return max(0, self._clock() - self._away_since)
