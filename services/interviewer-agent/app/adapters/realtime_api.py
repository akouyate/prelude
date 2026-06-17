from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx

from app.domain.models import InterviewEvent


@dataclass
class InMemoryRealtimeApiClient:
    events: list[InterviewEvent] = field(default_factory=list)
    print_events: bool = True

    async def emit_event(self, event: InterviewEvent) -> None:
        self.events.append(event)
        if self.print_events:
            print(event.model_dump_json())


class HttpRealtimeApiClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float = 5.0,
        api_key: str | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._api_key = api_key

    async def emit_event(self, event: InterviewEvent) -> None:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"

        payload = json.loads(event.model_dump_json())
        async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
            response = await client.post(
                f"{self._base_url}/v1/interview-sessions/{event.session_id}/events",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()
