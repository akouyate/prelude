from __future__ import annotations

import asyncio

import pytest

from app.application.inactivity import (
    CandidateInactivityCoordinator,
    CandidateInactivityPolicy,
    InactivityStage,
    InactivityStep,
    InactivityTrigger,
)


@pytest.mark.asyncio
async def test_inactivity_runs_check_in_warning_then_timeout() -> None:
    steps: list[InactivityStep] = []
    timeouts: list[tuple[InactivityTrigger, float]] = []
    policy = CandidateInactivityPolicy(
        user_away_after_seconds=0.01,
        warning_after_seconds=0.01,
        terminate_after_seconds=0.01,
        wait_extension_seconds=0.04,
    )
    coordinator = CandidateInactivityCoordinator(
        policy=policy,
        on_step=lambda step: _append(steps, step),
        on_timeout=lambda trigger, elapsed: _append(
            timeouts, (trigger, elapsed)
        ),
        on_recovered=lambda *_args: _noop(),
    )

    coordinator.mark_away()
    await asyncio.sleep(0.04)

    assert [step.stage for step in steps] == [
        InactivityStage.CHECK_IN,
        InactivityStage.WARNING,
    ]
    assert steps[0].silent_for_seconds == 0.01
    assert steps[1].next_action_in_seconds == 0.01
    assert timeouts == [(InactivityTrigger.USER_AWAY, pytest.approx(0.03))]


@pytest.mark.asyncio
async def test_candidate_activity_cancels_before_warning_and_records_recovery() -> None:
    steps: list[InactivityStep] = []
    recoveries: list[tuple[object, ...]] = []
    timeouts: list[tuple[InactivityTrigger, float]] = []
    coordinator = CandidateInactivityCoordinator(
        policy=CandidateInactivityPolicy(
            user_away_after_seconds=0.01,
            warning_after_seconds=0.04,
            terminate_after_seconds=0.04,
            wait_extension_seconds=0.08,
        ),
        on_step=lambda step: _append(steps, step),
        on_timeout=lambda trigger, elapsed: _append(
            timeouts, (trigger, elapsed)
        ),
        on_recovered=lambda *args: _append(recoveries, args),
    )

    coordinator.mark_away()
    await asyncio.sleep(0.01)
    coordinator.mark_active(source="voice")
    await asyncio.sleep(0.05)

    assert [step.stage for step in steps] == [InactivityStage.CHECK_IN]
    assert recoveries
    assert recoveries[0][0] == InactivityStage.CHECK_IN
    assert recoveries[0][3] == "voice"
    assert timeouts == []


@pytest.mark.asyncio
async def test_candidate_activity_during_warning_cancels_terminal_timeout() -> None:
    steps: list[InactivityStep] = []
    timeouts: list[tuple[InactivityTrigger, float]] = []
    coordinator = CandidateInactivityCoordinator(
        policy=CandidateInactivityPolicy(
            user_away_after_seconds=0.01,
            warning_after_seconds=0.01,
            terminate_after_seconds=0.05,
            wait_extension_seconds=0.1,
        ),
        on_step=lambda step: _append(steps, step),
        on_timeout=lambda trigger, elapsed: _append(
            timeouts, (trigger, elapsed)
        ),
        on_recovered=lambda *_args: _noop(),
    )

    coordinator.mark_away()
    await asyncio.sleep(0.025)
    assert coordinator.stage == InactivityStage.WARNING

    coordinator.mark_active(source="voice")
    await asyncio.sleep(0.06)

    assert [step.stage for step in steps] == [
        InactivityStage.CHECK_IN,
        InactivityStage.WARNING,
    ]
    assert timeouts == []


@pytest.mark.asyncio
async def test_explicit_wait_defers_first_check_in() -> None:
    steps: list[InactivityStep] = []
    coordinator = CandidateInactivityCoordinator(
        policy=CandidateInactivityPolicy(
            user_away_after_seconds=0.01,
            warning_after_seconds=0.03,
            terminate_after_seconds=0.03,
            wait_extension_seconds=0.04,
        ),
        on_step=lambda step: _append(steps, step),
        on_timeout=lambda *_args: _noop(),
        on_recovered=lambda *_args: _noop(),
    )

    coordinator.grant_wait_extension()
    coordinator.mark_away()
    await asyncio.sleep(0.02)
    assert steps == []

    await asyncio.sleep(0.03)
    assert steps[0].stage == InactivityStage.CHECK_IN
    assert steps[0].trigger == InactivityTrigger.WAIT_EXTENSION
    await coordinator.aclose()


@pytest.mark.asyncio
async def test_presence_confirmation_restarts_full_away_grace() -> None:
    steps: list[InactivityStep] = []
    recoveries: list[tuple[object, ...]] = []
    coordinator = CandidateInactivityCoordinator(
        policy=CandidateInactivityPolicy(
            user_away_after_seconds=0.03,
            warning_after_seconds=0.05,
            terminate_after_seconds=0.05,
            wait_extension_seconds=0.1,
        ),
        on_step=lambda step: _append(steps, step),
        on_timeout=lambda *_args: _noop(),
        on_recovered=lambda *args: _append(recoveries, args),
    )

    coordinator.mark_away()
    await asyncio.sleep(0.01)
    coordinator.confirm_presence()
    await asyncio.sleep(0.01)

    assert recoveries
    assert len(steps) == 1
    assert steps[0].stage == InactivityStage.CHECK_IN

    await asyncio.sleep(0.03)
    assert len(steps) == 2
    assert steps[-1].trigger == InactivityTrigger.PRESENCE_CONFIRMATION
    await coordinator.aclose()


async def _append(items: list, value) -> None:
    items.append(value)


async def _noop() -> None:
    return None
