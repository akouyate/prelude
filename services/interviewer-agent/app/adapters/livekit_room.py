from __future__ import annotations

from app.domain.models import AgentLiveKitJoin


class MockLiveKitRoomAdapter:
    def __init__(self) -> None:
        self.joined: AgentLiveKitJoin | None = None
        self.disconnected = False

    async def join(self, join: AgentLiveKitJoin) -> None:
        self.joined = join
        self.disconnected = False

    async def disconnect(self) -> None:
        self.disconnected = True


class LiveKitRoomAdapter:
    def __init__(self) -> None:
        self._room = None

    async def join(self, join: AgentLiveKitJoin) -> None:
        if join.token.startswith("mock_lk_"):
            self._room = MockLiveKitRoomAdapter()
            await self._room.join(join)
            return

        try:
            from livekit import rtc
        except ImportError as exc:
            raise RuntimeError(
                "livekit is required to join a real LiveKit room. "
                "Install dependencies from services/interviewer-agent/requirements.txt."
            ) from exc

        room = rtc.Room()
        await room.connect(join.url, join.token)
        self._room = room

    async def disconnect(self) -> None:
        if self._room is None:
            return

        disconnect = getattr(self._room, "disconnect", None)
        if disconnect is None:
            self._room = None
            return

        result = disconnect()
        if hasattr(result, "__await__"):
            await result
        self._room = None
