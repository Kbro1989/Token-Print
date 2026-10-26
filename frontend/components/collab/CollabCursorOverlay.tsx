"use client";

import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { getCollabClient, normalizeCursor, sanitizeColor } from "@/lib/collab/client";
import type { CollabPeer } from "@/lib/collab/types";

export function CollabCursorOverlay() {
  const collabEnabled = useStore((s) => s.collabEnabled);
  const collabRoomId = useStore((s) => s.collabRoomId);
  const collabPeers = useStore((s) => s.collabPeers);
  const setCollabConnected = useStore((s) => s.setCollabConnected);
  const setCollabPeers = useStore((s) => s.setCollabPeers);
  const updatePeerCursor = useStore((s) => s.updatePeerCursor);
  const updatePeerSelection = useStore((s) => s.updatePeerSelection);

  const [windowDims, setWindowDims] = useState({ width: 1920, height: 1080 });
  const [, setTick] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync window dimensions for cursor positioning
  useEffect(() => {
    const updateSize = () => {
      setWindowDims({ width: window.innerWidth, height: window.innerHeight });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // Periodic 5-second interval to expire idle cursors even when no store mutations occur
  useEffect(() => {
    if (!collabEnabled) return;
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, [collabEnabled]);

  // Initialize and manage Collab WebSocket connection
  useEffect(() => {
    if (!collabEnabled) {
      getCollabClient().disconnect();
      return;
    }

    const client = getCollabClient({
      onStatusChange: (connected) => {
        setCollabConnected(connected);
        if (!connected) {
          // Clear active peers immediately upon disconnection to prevent stale counts
          setCollabPeers({});
        }
      },
      onPresence: (peers) => {
        const peersMap: Record<string, CollabPeer> = {};
        for (const p of peers) {
          if (p.user_id !== client.self.user_id) {
            peersMap[p.user_id] = p;
          }
        }
        setCollabPeers(peersMap);
      },
      onPeerCursor: (userId, cursor) => {
        // Track local receivedAt timestamp to measure staleness independent of peer clock skew
        updatePeerCursor(userId, { ...cursor, receivedAt: Date.now() });
      },
      onPeerSelection: (userId, selection) => {
        updatePeerSelection(userId, selection);
      },
      onPeerStep: (userId, opIndex) => {
        // In classroom mode, student viewers follow instructor step if sender is recognized as presenter
        const isPresenter = useStore.getState().classroomPresenting;
        const sender = useStore.getState().collabPeers[userId];
        if (!isPresenter && (!sender || sender.role === "presenter")) {
          useStore.setState({ opIndex });
        }
      },
    });

    client.connect(collabRoomId || "default");

    return () => {
      client.disconnect();
    };
  }, [
    collabEnabled,
    collabRoomId,
    setCollabConnected,
    setCollabPeers,
    updatePeerCursor,
    updatePeerSelection,
  ]);

  // Track and broadcast local cursor
  useEffect(() => {
    if (!collabEnabled) return;

    const handlePointerMove = (e: PointerEvent) => {
      const client = getCollabClient();
      if (!client.isConnected()) return;

      const state = useStore.getState();
      const cursor = normalizeCursor(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight,
        {
          activeLayer: state.arch3dLayer,
          activeOp: state.arch3dOpKind,
        }
      );
      client.sendCursor(cursor);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, [collabEnabled]);

  if (!collabEnabled) return null;

  const now = Date.now();
  const activePeers = Object.values(collabPeers).filter(
    (p) => p.cursor && now - (p.cursor.receivedAt ?? p.cursor.timestamp) < 15000 // Active within 15 seconds
  );

  return (
    <div
      ref={containerRef}
      className="collab-cursor-overlay"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {activePeers.map((peer) => {
        const cursor = peer.cursor!;
        const posX = cursor.x * windowDims.width;
        const posY = cursor.y * windowDims.height;
        const color = sanitizeColor(peer.color);

        return (
          <div
            key={peer.user_id}
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              transform: `translate3d(${posX}px, ${posY}px, 0)`,
              transition: "transform 0.08s linear",
              pointerEvents: "none",
              willChange: "transform",
            }}
          >
            {/* SVG Cursor Pointer */}
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              style={{
                filter: `drop-shadow(0 2px 5px rgba(0,0,0,0.6))`,
              }}
            >
              <path
                d="M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z"
                fill={color}
                stroke="#000000"
                strokeWidth="1.2"
              />
            </svg>

            {/* Peer Name Tag & Active Focus Badge */}
            <div
              style={{
                position: "absolute",
                left: 14,
                top: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "2px 7px",
                borderRadius: 4,
                background: "rgba(10, 10, 12, 0.92)",
                border: `1px solid ${color}`,
                boxShadow: `0 4px 12px rgba(0,0,0,0.5)`,
                fontFamily: "var(--font-mono, monospace)",
                fontSize: 10,
                color: "#ffffff",
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                }}
              />
              <span style={{ fontWeight: 600 }}>{peer.name}</span>

              {peer.role === "presenter" && (
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "1px 3px",
                    borderRadius: 2,
                    background: color,
                    color: "#000000",
                  }}
                >
                  Presenter
                </span>
              )}

              {cursor.activeLayer !== null && cursor.activeLayer !== undefined && (
                <span
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    borderLeft: "1px solid rgba(255,255,255,0.2)",
                    paddingLeft: 4,
                  }}
                >
                  L{cursor.activeLayer}
                  {cursor.activeOp ? ` • ${cursor.activeOp}` : ""}
                </span>
              )}

              {peer.selection && (
                <span
                  style={{
                    color: "#fbbf24",
                    borderLeft: "1px solid rgba(255,255,255,0.2)",
                    paddingLeft: 4,
                  }}
                >
                  [{peer.selection.kind}: {String(peer.selection.name ?? peer.selection.index)}]
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
