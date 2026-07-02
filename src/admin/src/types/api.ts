export type UserRole = "employee" | "admin";
export type PlayerState = "offline" | "idle" | "playing" | "paused";

export interface BotUser {
  id: string;
  name?: string;
  role: UserRole;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  durationMs?: number;
  source: "mock" | "netease";
  sourceUrl?: string;
  raw?: unknown;
}

export interface QueueItem {
  id: string;
  track: Track;
  requester: BotUser;
  requestedAt: string;
}

export interface HistoryItem {
  id: string;
  track: Track;
  requester: BotUser;
  requestedAt: string;
  playedAt: string;
}

export interface PlayerStatus {
  state: PlayerState;
  current?: QueueItem;
  busy?: boolean;
  revision?: number;
  switching?: boolean;
}

export interface StatusResponse {
  player: PlayerStatus;
  pending: QueueItem[];
}

export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  days: string[];
}

export interface PlaybackOperationResult<T = unknown> {
  ok: boolean;
  ignored?: boolean;
  reason?: "stale_state";
  revision: number;
  result?: T;
}
