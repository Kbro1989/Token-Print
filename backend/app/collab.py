"""Collaborative session and presence manager for TokenPrint (Phase 5.8c / #301).

Manages multi-viewer presence, shared cursor coordinates, layer/op selections,
and classroom presenter sync over WebSocket rooms.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("tokenprint.collab")

# Capacity quotas to prevent room state exhaustion (Security / Denial-of-Service guard)
MAX_ROOMS = 500
MAX_PEERS_PER_ROOM = 50


@dataclass
class CollabPeer:
    user_id: str
    name: str
    color: str
    role: str = "viewer"  # "viewer" | "presenter"
    cursor: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None
    last_seen: float = field(default_factory=time.time)
    last_cursor_time: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "name": self.name,
            "color": self.color,
            "role": self.role,
            "cursor": self.cursor,
            "selection": self.selection,
            "last_seen": self.last_seen,
        }


class CollabRoomManager:
    """Manages WebSocket connections and state synchronization across rooms."""

    def __init__(self) -> None:
        # room_id -> { user_id: (WebSocket, CollabPeer) }
        self._rooms: dict[str, dict[str, tuple[WebSocket, CollabPeer]]] = {}
        # room_id -> monotonic presence snapshot version
        self._room_versions: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        room_id: str,
        user_id: str,
        ws: WebSocket,
        name: str,
        color: str,
        role: str = "viewer",
    ) -> CollabPeer | None:
        """Register a new peer connection in a collaborative room.

        Enforces room and peer quotas. If an existing socket is registered under
        the same user_id, it is closed gracefully before the new one is registered.
        Returns None if quotas are exceeded.
        """
        async with self._lock:
            if room_id not in self._rooms:
                if len(self._rooms) >= MAX_ROOMS:
                    logger.warning("Rejecting collab connection: MAX_ROOMS (%d) reached.", MAX_ROOMS)
                    return None
                self._rooms[room_id] = {}

            room = self._rooms[room_id]
            if user_id not in room and len(room) >= MAX_PEERS_PER_ROOM:
                logger.warning(
                    "Rejecting collab connection for %s: room '%s' full (%d).",
                    user_id.replace("\n", "").replace("\r", ""),
                    room_id.replace("\n", "").replace("\r", ""),
                    MAX_PEERS_PER_ROOM,
                )
                return None

            # If user_id already connected on another socket, close old socket cleanly
            if user_id in room:
                old_ws, _ = room[user_id]
                if old_ws is not ws:
                    try:
                        await old_ws.close(code=1000)
                    except Exception:  # noqa: BLE001, S110
                        # Best-effort close: the socket may already be gone.
                        pass

            # Ensure at most one active presenter per room
            if role == "presenter":
                for uid, (_, other_peer) in room.items():
                    if uid != user_id and other_peer.role == "presenter":
                        other_peer.role = "viewer"

            peer = CollabPeer(
                user_id=user_id,
                name=name,
                color=color,
                role=role if role in ("viewer", "presenter") else "viewer",
                last_seen=time.time(),
            )
            self._rooms[room_id][user_id] = (ws, peer)

        logger.info(
            "Peer %s (%s) connected to collab room '%s'. Total in room: %d",
            user_id.replace("\n", "").replace("\r", ""),
            name.replace("\n", "").replace("\r", ""),
            room_id.replace("\n", "").replace("\r", ""),
            len(self._rooms[room_id]),
        )

        # Notify all peers in the room of the updated presence list
        await self.broadcast_presence(room_id)
        return peer

    async def disconnect(
        self,
        room_id: str,
        user_id: str,
        ws: WebSocket | None = None,
    ) -> None:
        """Remove a peer from a collaborative room and notify remaining peers.

        If a WebSocket instance is provided, only remove the entry if the stored
        socket matches it, ensuring cleanup from an older connection does not remove
        a newly registered reconnection.
        """
        async with self._lock:
            room = self._rooms.get(room_id)
            if room is not None and user_id in room:
                stored_ws, _ = room[user_id]
                if ws is None or stored_ws is ws:
                    del room[user_id]
                    if not room:
                        del self._rooms[room_id]
                        self._room_versions.pop(room_id, None)
                        logger.info("Collab room '%s' is now empty and cleaned up.", room_id.replace("\n", "").replace("\r", ""))

        if room_id in self._rooms:
            await self.broadcast_presence(room_id)

    async def broadcast_presence(self, room_id: str) -> None:
        """Broadcast the full roster of active peers in the room with monotonic versioning."""
        async with self._lock:
            if room_id not in self._rooms:
                return
            version = self._room_versions.get(room_id, 0) + 1
            self._room_versions[room_id] = version
            peers_list = [peer.to_dict() for _, peer in self._rooms[room_id].values()]

        msg = {
            "type": "presence",
            "room_id": room_id,
            "peers": peers_list,
            "count": len(peers_list),
            "version": version,
            "timestamp": time.time(),
        }
        await self.broadcast(room_id, msg)

    def get_peers(self, room_id: str) -> list[CollabPeer]:
        """Return list of active peers in a room."""
        if room_id not in self._rooms:
            return []
        return [peer for _, peer in self._rooms[room_id].values()]

    async def broadcast(
        self,
        room_id: str,
        message: dict[str, Any],
        exclude_user_id: str | None = None,
    ) -> None:
        """Broadcast a message to peers in the specified room concurrently with timeout."""
        if room_id not in self._rooms:
            return

        targets = [
            (uid, ws)
            for uid, (ws, _) in list(self._rooms[room_id].items())
            if uid != exclude_user_id
        ]
        if not targets:
            return

        async def _send_safe(uid: str, ws: WebSocket) -> tuple[str, WebSocket, bool]:
            try:
                # 0.8s timeout prevents any single slow/unresponsive peer from holding up the room
                await asyncio.wait_for(ws.send_json(message), timeout=0.8)
                return uid, ws, True
            except Exception:  # noqa: BLE001 — any send failure marks the peer unreachable
                return uid, ws, False

        results = await asyncio.gather(
            *[_send_safe(uid, ws) for uid, ws in targets],
            return_exceptions=True,
        )

        stale: list[tuple[str, WebSocket]] = []
        for res in results:
            if isinstance(res, tuple) and not res[2]:
                stale.append((res[0], res[1]))

        if stale:
            async with self._lock:
                if room_id in self._rooms:
                    for uid, stale_ws in stale:
                        entry = self._rooms[room_id].get(uid)
                        if entry is not None and entry[0] is stale_ws:
                            del self._rooms[room_id][uid]
                    if not self._rooms[room_id]:
                        del self._rooms[room_id]
                        self._room_versions.pop(room_id, None)
                        logger.info("Collab room '%s' is now empty and cleaned up.", room_id.replace("\n", "").replace("\r", ""))

            if room_id in self._rooms:
                await self.broadcast_presence(room_id)

    async def handle_message(
        self,
        room_id: str,
        user_id: str,
        message: dict[str, Any],
    ) -> None:
        """Process incoming client message, validate schema, and relay to peers."""
        if room_id not in self._rooms or user_id not in self._rooms[room_id]:
            return

        _, peer = self._rooms[room_id][user_id]
        now = time.time()
        peer.last_seen = now
        msg_type = message.get("type")

        if msg_type == "cursor":
            # Rate limit cursor broadcasts to prevent excessive fanout load (~40 updates/sec max per peer)
            if now - peer.last_cursor_time < 0.025:
                return
            raw_cursor = message.get("cursor")
            if not isinstance(raw_cursor, dict):
                return

            raw_x = raw_cursor.get("x")
            raw_y = raw_cursor.get("y")
            raw_ts = raw_cursor.get("timestamp")

            # Validate numeric bounds & finite floats
            if not isinstance(raw_x, (int, float)) or isinstance(raw_x, bool) or math.isnan(raw_x) or math.isinf(raw_x):
                return
            if not isinstance(raw_y, (int, float)) or isinstance(raw_y, bool) or math.isnan(raw_y) or math.isinf(raw_y):
                return
            if not isinstance(raw_ts, (int, float)) or isinstance(raw_ts, bool) or math.isnan(raw_ts) or math.isinf(raw_ts):
                return

            active_layer = raw_cursor.get("activeLayer")
            if active_layer is not None and (not isinstance(active_layer, int) or isinstance(active_layer, bool) or active_layer < 0):
                return

            active_op = raw_cursor.get("activeOp")
            if active_op is not None and not isinstance(active_op, str):
                return

            bounded_cursor = {
                "x": max(0.0, min(1.0, float(raw_x))),
                "y": max(0.0, min(1.0, float(raw_y))),
                "activeLayer": active_layer,
                "activeOp": str(active_op)[:32] if active_op is not None else None,
                "timestamp": float(raw_ts),
            }

            peer.cursor = bounded_cursor
            peer.last_cursor_time = now
            await self.broadcast(
                room_id,
                {
                    "type": "peer_cursor",
                    "user_id": user_id,
                    "cursor": bounded_cursor,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "selection":
            raw_sel = message.get("selection")
            if raw_sel is not None:
                if not isinstance(raw_sel, dict):
                    return
                kind = raw_sel.get("kind")
                if kind not in ("layer", "head", "op", "token"):
                    return
                idx = raw_sel.get("index")
                if not isinstance(idx, int) or isinstance(idx, bool) or idx < 0:
                    return
                name = raw_sel.get("name")
                if name is not None and not isinstance(name, str):
                    return

                bounded_sel = {
                    "kind": kind,
                    "index": idx,
                    "name": str(name)[:64] if name is not None else None,
                }
            else:
                bounded_sel = None

            peer.selection = bounded_sel
            await self.broadcast(
                room_id,
                {
                    "type": "peer_selection",
                    "user_id": user_id,
                    "selection": bounded_sel,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "step":
            # Classroom presenter stepping through ops/layers (presenter-only)
            if peer.role != "presenter":
                return

            op_index = message.get("op_index", 0)
            if not isinstance(op_index, int) or isinstance(op_index, bool) or op_index < 0:
                return

            token_index = message.get("token_index")
            if token_index is not None and (not isinstance(token_index, int) or isinstance(token_index, bool) or token_index < 0):
                token_index = None

            await self.broadcast(
                room_id,
                {
                    "type": "peer_step",
                    "user_id": user_id,
                    "op_index": op_index,
                    "token_index": token_index,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "role":
            new_role = message.get("role", "viewer")
            if new_role in ("viewer", "presenter"):
                if new_role == "presenter":
                    # Demote any other presenter in this room so there is only one active presenter
                    for uid, (_, other_peer) in self._rooms[room_id].items():
                        if uid != user_id and other_peer.role == "presenter":
                            other_peer.role = "viewer"
                peer.role = new_role
                await self.broadcast_presence(room_id)

        elif msg_type == "ping":
            ws, _ = self._rooms[room_id][user_id]
            try:
                await ws.send_json({"type": "pong", "timestamp": time.time()})
            except Exception:  # noqa: BLE001, S110
                # Best-effort pong: the peer may have already disconnected.
                pass


# Singleton instance
collab_manager = CollabRoomManager()
