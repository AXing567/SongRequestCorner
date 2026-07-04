export type UserRole = "employee" | "admin";

export interface BotUser {
  id: string;
  name?: string;
  role: UserRole;
}

export interface IncomingMessage {
  id: string;
  chatId: string;
  text: string;
  sender: BotUser;
  createdAt: Date;
  canReply?: boolean;
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
  requestedAt: Date;
}

export interface HistoryItem {
  id: string;
  track: Track;
  requester: BotUser;
  requestedAt: Date;
  playedAt: Date;
}

export interface HistoryPage {
  items: HistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  days: string[];
}

export type PlayerState = "offline" | "idle" | "playing" | "paused";

export interface PlayerStatus {
  state: PlayerState;
  current?: QueueItem;
  busy?: boolean;
  revision?: number;
  switching?: boolean;
}

export type Command =
  | { type: "request_song"; query: string }
  | { type: "show_queue" }
  | { type: "current" }
  | { type: "cancel_mine" }
  | { type: "skip" }
  | { type: "clear_queue" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "history" }
  | { type: "help" }
  | { type: "unknown"; reason: string };
