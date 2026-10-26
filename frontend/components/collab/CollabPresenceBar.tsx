"use client";

import React, { useState } from "react";
import { useStore } from "@/lib/store";
import { getCollabClient, sanitizeColor } from "@/lib/collab/client";

export function CollabPresenceBar() {
  const collabEnabled = useStore((s) => s.collabEnabled);
  const collabConnected = useStore((s) => s.collabConnected);
  const collabRoomId = useStore((s) => s.collabRoomId);
  const collabPeers = useStore((s) => s.collabPeers);
  const toggleCollab = useStore((s) => s.toggleCollab);
  const classroomMode = useStore((s) => s.classroomMode);
  const classroomPresenting = useStore((s) => s.classroomPresenting);
  const toggleClassroomPresenting = useStore((s) => s.toggleClassroomPresenting);

  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!collabEnabled) {
    return (
      <button
        onClick={toggleCollab}
        title="Toggle multi-viewer collaborative cursors & presence (Phase 5.8c / #301)"
        style={{
          height: "22px",
          padding: "0 7px",
          fontSize: "10px",
          fontWeight: 500,
          letterSpacing: "0.02em",
          borderRadius: "3px",
          border: "none",
          cursor: "pointer",
          transition: "all 0.12s ease",
          background: "transparent",
          color: "#a3a3a3",
          whiteSpace: "nowrap",
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
        }}
        aria-label="Collaborative cursors disabled (Click to enable)"
      >
        <span>👥</span>
        <span>COLLAB</span>
      </button>
    );
  }

  const client = getCollabClient();
  const peersList = Object.values(collabPeers);
  const totalCount = peersList.length + 1; // Peers + Self

  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("collab", "true");
      url.searchParams.set("room", collabRoomId || "model_qwen05");
      const link = url.toString();
      const done = () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done, () => {
          window.prompt("Copy invite link:", link);
        });
      } else {
        window.prompt("Copy invite link:", link);
      }
    }
  };

  const handleTogglePresenting = () => {
    toggleClassroomPresenting();
    const nextRole = !classroomPresenting ? "presenter" : "viewer";
    client.setRole(nextRole);
  };

  return (
    <div
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
      }}
    >
      {/* Trigger chip */}
      <button
        onClick={() => setExpanded(!expanded)}
        title="Collaborative Viewers & Presence (Phase 5.8c / #301)"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(15, 15, 18, 0.95)",
          border: `1px solid ${collabConnected ? "rgba(56, 189, 248, 0.4)" : "#333333"}`,
          borderRadius: 4,
          padding: "3px 8px",
          color: "#f5f5f5",
          fontSize: 11,
          fontFamily: "var(--font-mono, monospace)",
          cursor: "pointer",
          backdropFilter: "blur(12px)",
          transition: "all 0.15s ease",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: collabConnected ? "#10b981" : "#eab308",
            boxShadow: collabConnected ? "0 0 8px #10b981" : "none",
          }}
        />
        <span>Collab ({totalCount})</span>

        {/* Stacked mini avatars */}
        <div style={{ display: "flex", alignItems: "center", marginLeft: 2 }}>
          {/* Self dot */}
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: sanitizeColor(client.self.color),
              border: "1.5px solid #000000",
              display: "inline-block",
            }}
          />
          {peersList.slice(0, 3).map((peer) => (
            <span
              key={peer.user_id}
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: sanitizeColor(peer.color),
                border: "1.5px solid #000000",
                marginLeft: -4,
                display: "inline-block",
              }}
            />
          ))}
        </div>
      </button>

      {/* Expanded popover */}
      {expanded && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 250,
            background: "#0c0d10",
            border: "1px solid #2a2a2e",
            borderRadius: 6,
            padding: 12,
            boxShadow: "0 10px 25px rgba(0,0,0,0.7)",
            zIndex: 10000,
            fontFamily: "var(--font-sans, sans-serif)",
            color: "#e2e8f0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: "1px solid #202024",
              paddingBottom: 8,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>Collaborative Session</span>
            <span
              style={{
                fontSize: 10,
                color: collabConnected ? "#4ade80" : "#fbbf24",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              {collabConnected ? "CONNECTED" : "CONNECTING..."}
            </span>
          </div>

          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
            Room: <code style={{ color: "#38bdf8" }}>{collabRoomId || "default"}</code>
          </div>

          {/* Peer Roster */}
          <div style={{ marginBottom: 12, maxHeight: 120, overflowY: "auto" }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", color: "#64748b", marginBottom: 4 }}>
              Active Viewers ({totalCount})
            </div>

            {/* Self entry */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "3px 0",
                fontSize: 11,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: client.self.color,
                }}
              />
              <span style={{ fontWeight: 500 }}>{client.self.name} (You)</span>
              {classroomPresenting && (
                <span
                  style={{
                    fontSize: 8,
                    background: "#38bdf8",
                    color: "#000",
                    padding: "1px 3px",
                    borderRadius: 2,
                    fontWeight: 700,
                  }}
                >
                  PRESENTER
                </span>
              )}
            </div>

            {/* Peers */}
            {peersList.map((peer) => (
              <div
                key={peer.user_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 0",
                  fontSize: 11,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: sanitizeColor(peer.color),
                  }}
                />
                <span>{peer.name}</span>
                {peer.role === "presenter" && (
                  <span
                    style={{
                      fontSize: 8,
                      background: "#38bdf8",
                      color: "#000",
                      padding: "1px 3px",
                      borderRadius: 2,
                      fontWeight: 700,
                    }}
                  >
                    PRESENTER
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {classroomMode && (
              <button
                onClick={handleTogglePresenting}
                style={{
                  padding: "5px 8px",
                  fontSize: 11,
                  borderRadius: 4,
                  background: classroomPresenting ? "rgba(56, 189, 248, 0.2)" : "#18181c",
                  border: `1px solid ${classroomPresenting ? "#38bdf8" : "#2e2e34"}`,
                  color: classroomPresenting ? "#38bdf8" : "#cbd5e1",
                  cursor: "pointer",
                }}
              >
                {classroomPresenting ? "🎓 Presenting (Drive Cursors)" : "🎓 Become Presenter"}
              </button>
            )}

            <button
              onClick={handleCopyLink}
              style={{
                padding: "5px 8px",
                fontSize: 11,
                borderRadius: 4,
                background: "#18181c",
                border: "1px solid #2e2e34",
                color: "#cbd5e1",
                cursor: "pointer",
              }}
            >
              {copied ? "✓ Copied Collab Link!" : "🔗 Copy Invite Link"}
            </button>

            <button
              onClick={() => {
                toggleCollab();
                setExpanded(false);
              }}
              style={{
                padding: "5px 8px",
                fontSize: 11,
                borderRadius: 4,
                background: "transparent",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#f87171",
                cursor: "pointer",
              }}
            >
              Disconnect Collab
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
