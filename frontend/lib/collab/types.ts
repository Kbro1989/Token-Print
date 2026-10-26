// Phase 5.8c (#301): Collaborative Cursors & Presence Types

export interface CollabCursor {
  x: number; // Normalized [0, 1] across viewport width
  y: number; // Normalized [0, 1] across viewport height
  activeLayer?: number | null;
  activeOp?: string | null;
  timestamp: number;
  receivedAt?: number; // Local timestamp upon arrival for clock-skew independent staleness
}

export interface CollabSelection {
  kind: "layer" | "head" | "op" | "token";
  index: number;
  name?: string;
}

export interface CollabPeer {
  user_id: string;
  name: string;
  color: string;
  role: "viewer" | "presenter";
  cursor?: CollabCursor | null;
  selection?: CollabSelection | null;
  last_seen?: number;
}

export type CollabMessage =
  | { type: "presence"; room_id: string; peers: CollabPeer[]; count: number; version?: number; timestamp: number }
  | { type: "peer_cursor"; user_id: string; cursor: CollabCursor }
  | { type: "peer_selection"; user_id: string; selection: CollabSelection | null }
  | { type: "peer_step"; user_id: string; op_index: number; token_index?: number }
  | { type: "cursor"; cursor: CollabCursor }
  | { type: "selection"; selection: CollabSelection | null }
  | { type: "step"; op_index: number; token_index?: number }
  | { type: "role"; role: "viewer" | "presenter" }
  | { type: "ping" }
  | { type: "pong"; timestamp: number };
