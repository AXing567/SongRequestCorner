import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { BotUser, HistoryItem, HistoryPage, QueueItem, Track } from "../domain/types.js";

const HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export interface ListHistoryOptions {
  now?: Date;
  day?: string;
  page?: number;
  pageSize?: number;
}

export interface HistoryStore {
  record(item: QueueItem, playedAt?: Date): HistoryItem;
  list(options?: ListHistoryOptions): HistoryPage;
  find(id: string, now?: Date): HistoryItem | undefined;
  prune(now?: Date): number;
  loadPendingQueue(): QueueItem[];
  savePendingQueue(items: readonly QueueItem[]): void;
  close?(): void;
}

export class InMemoryHistoryStore implements HistoryStore {
  private history: HistoryItem[] = [];
  private pendingQueue: QueueItem[] = [];

  record(item: QueueItem, playedAt = new Date()): HistoryItem {
    const historyItem: HistoryItem = {
      id: randomUUID(),
      track: item.track,
      requester: item.requester,
      requestedAt: item.requestedAt,
      playedAt
    };
    this.history.unshift(historyItem);
    this.prune(playedAt);
    return historyItem;
  }

  list(options: ListHistoryOptions = {}): HistoryPage {
    const now = options.now ?? new Date();
    this.prune(now);
    const page = normalizePage(options.page);
    const pageSize = normalizePageSize(options.pageSize);
    const filtered = this.history
      .filter((item) => !options.day || dayKey(item.playedAt) === options.day)
      .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
    const visible = dedupeHistoryForList(filtered);
    const offset = (page - 1) * pageSize;

    return {
      items: visible.slice(offset, offset + pageSize),
      total: visible.length,
      page,
      pageSize,
      days: uniqueDays(this.history)
    };
  }

  find(id: string, now = new Date()): HistoryItem | undefined {
    this.prune(now);
    return this.history.find((item) => item.id === id);
  }

  prune(now = new Date()): number {
    const before = this.history.length;
    const cutoff = now.getTime() - HISTORY_RETENTION_MS;
    this.history = this.history.filter((item) => item.playedAt.getTime() >= cutoff);
    return before - this.history.length;
  }

  loadPendingQueue(): QueueItem[] {
    return this.pendingQueue.map(copyQueueItem);
  }

  savePendingQueue(items: readonly QueueItem[]): void {
    this.pendingQueue = items.map(copyQueueItem);
  }
}

export class SqliteHistoryStore implements HistoryStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath, { timeout: 1000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS play_history (
        id TEXT PRIMARY KEY,
        track_json TEXT NOT NULL,
        requester_json TEXT NOT NULL,
        requested_at INTEGER NOT NULL,
        played_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_play_history_played_at ON play_history(played_at DESC);
      CREATE TABLE IF NOT EXISTS pending_queue (
        id TEXT PRIMARY KEY,
        position INTEGER NOT NULL,
        track_json TEXT NOT NULL,
        requester_json TEXT NOT NULL,
        requested_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_pending_queue_position ON pending_queue(position ASC);
    `);
    this.prune();
  }

  record(item: QueueItem, playedAt = new Date()): HistoryItem {
    const historyItem: HistoryItem = {
      id: randomUUID(),
      track: item.track,
      requester: item.requester,
      requestedAt: item.requestedAt,
      playedAt
    };

    this.db
      .prepare(
        `INSERT INTO play_history (id, track_json, requester_json, requested_at, played_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        historyItem.id,
        JSON.stringify(historyItem.track),
        JSON.stringify(historyItem.requester),
        historyItem.requestedAt.getTime(),
        historyItem.playedAt.getTime()
      );
    this.prune(playedAt);
    return historyItem;
  }

  list(options: ListHistoryOptions = {}): HistoryPage {
    const now = options.now ?? new Date();
    this.prune(now);
    const page = normalizePage(options.page);
    const pageSize = normalizePageSize(options.pageSize);
    const range = options.day ? dayRange(options.day) : undefined;
    const offset = (page - 1) * pageSize;
    const rows = range
      ? this.db
          .prepare(
            `SELECT * FROM play_history
             WHERE played_at >= ? AND played_at < ?
             ORDER BY played_at DESC`
          )
          .all(range.start, range.end)
      : this.db
          .prepare(`SELECT * FROM play_history ORDER BY played_at DESC`)
          .all();
    const visible = dedupeHistoryForList(rows.map(rowToHistoryItem));

    return {
      items: visible.slice(offset, offset + pageSize),
      total: visible.length,
      page,
      pageSize,
      days: this.listDays()
    };
  }

  find(id: string, now = new Date()): HistoryItem | undefined {
    this.prune(now);
    const row = this.db.prepare(`SELECT * FROM play_history WHERE id = ?`).get(id);
    return row ? rowToHistoryItem(row) : undefined;
  }

  prune(now = new Date()): number {
    const cutoff = now.getTime() - HISTORY_RETENTION_MS;
    const result = this.db.prepare(`DELETE FROM play_history WHERE played_at < ?`).run(cutoff);
    return Number(result.changes);
  }

  loadPendingQueue(): QueueItem[] {
    return this.db
      .prepare(`SELECT * FROM pending_queue ORDER BY position ASC, requested_at ASC`)
      .all()
      .map(rowToQueueItem);
  }

  savePendingQueue(items: readonly QueueItem[]): void {
    const insert = this.db.prepare(
      `INSERT INTO pending_queue (id, position, track_json, requester_json, requested_at)
       VALUES (?, ?, ?, ?, ?)`
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`DELETE FROM pending_queue`).run();
      items.forEach((item, index) => {
        insert.run(
          item.id,
          index,
          JSON.stringify(item.track),
          JSON.stringify(item.requester),
          item.requestedAt.getTime()
        );
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  private listDays(): string[] {
    return this.db
      .prepare(`SELECT played_at FROM play_history ORDER BY played_at DESC`)
      .all()
      .map((row) => dayKey(new Date(Number(row.played_at))))
      .filter((day, index, days) => days.indexOf(day) === index);
  }
}

export function dayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayRange(day: string): { start: number; end: number } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) {
    return undefined;
  }

  const [year, month, date] = day.split("-").map(Number);
  const start = new Date(year!, month! - 1, date!).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

function uniqueDays(history: HistoryItem[]): string[] {
  return history
    .map((item) => dayKey(item.playedAt))
    .filter((day, index, days) => days.indexOf(day) === index);
}

function dedupeHistoryForList(history: HistoryItem[]): HistoryItem[] {
  const seen = new Set<string>();

  return history.filter((item) => {
    const key = historyListDedupeKey(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function historyListDedupeKey(item: HistoryItem): string {
  const stableTrackId = normalizeTrackText(item.track.id);
  if (stableTrackId) {
    return [dayKey(item.playedAt), item.track.source, "id", stableTrackId].join("\u0000");
  }

  return [
    dayKey(item.playedAt),
    item.track.source,
    "text",
    normalizeTrackText(item.track.title),
    normalizeTrackText(item.track.artist)
  ].join("\u0000");
}

function normalizeTrackText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function normalizePage(value?: number): number {
  return Math.max(1, Math.floor(value ?? 1));
}

function normalizePageSize(value?: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value ?? DEFAULT_PAGE_SIZE)));
}

function rowToHistoryItem(row: Record<string, unknown>): HistoryItem {
  return {
    id: String(row.id),
    track: JSON.parse(String(row.track_json)) as Track,
    requester: JSON.parse(String(row.requester_json)) as BotUser,
    requestedAt: new Date(Number(row.requested_at)),
    playedAt: new Date(Number(row.played_at))
  };
}

function rowToQueueItem(row: Record<string, unknown>): QueueItem {
  return {
    id: String(row.id),
    track: JSON.parse(String(row.track_json)) as Track,
    requester: JSON.parse(String(row.requester_json)) as BotUser,
    requestedAt: new Date(Number(row.requested_at))
  };
}

function copyQueueItem(item: QueueItem): QueueItem {
  return {
    id: item.id,
    track: { ...item.track },
    requester: { ...item.requester },
    requestedAt: new Date(item.requestedAt.getTime())
  };
}
