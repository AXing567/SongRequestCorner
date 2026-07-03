import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryHistoryStore, SqliteHistoryStore, type HistoryStore } from "../src/history/HistoryStore.js";
import type { QueueItem, Track } from "../src/domain/types.js";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "music-history-"));
  tempDirs.push(dir);
  return join(dir, "history.sqlite");
}

function item(title: string, requestedAt = new Date(), trackOverrides: Partial<Track> = {}): QueueItem {
  return {
    id: `queue-${title}`,
    track: { id: title, title, artist: "歌手", source: "mock", ...trackOverrides },
    requester: { id: "u1", name: "u1", role: "employee" },
    requestedAt
  };
}

function expectSameSongDedupedPerLocalDay(store: HistoryStore): void {
  const first = store.record(item("Encore"), new Date("2026-06-30T10:00:00+08:00"));
  const latest = store.record(item("Encore"), new Date("2026-06-30T11:00:00+08:00"));
  const nextDay = store.record(item("Encore"), new Date("2026-07-01T10:00:00+08:00"));

  const page = store.list({ now: new Date("2026-07-01T12:00:00+08:00"), page: 1, pageSize: 10 });
  expect(page.total).toBe(2);
  expect(page.items.map((history) => history.id)).toEqual([nextDay.id, latest.id]);
  expect(page.items.map((history) => history.id)).not.toContain(first.id);
  expect(store.find(first.id, new Date("2026-07-01T12:00:00+08:00"))).toBeDefined();

  const dayPage = store.list({
    now: new Date("2026-07-01T12:00:00+08:00"),
    day: "2026-06-30",
    page: 1,
    pageSize: 10
  });
  expect(dayPage.total).toBe(1);
  expect(dayPage.items.map((history) => history.id)).toEqual([latest.id]);
}

function expectSameTrackIdDedupedPerLocalDay(store: HistoryStore): void {
  const first = store.record(
    item("吻别", new Date("2026-07-01T09:00:00+08:00"), {
      id: "190449",
      artist: "张学友",
      source: "netease"
    }),
    new Date("2026-07-01T10:00:00+08:00")
  );
  const latest = store.record(
    item("吻别", new Date("2026-07-01T09:05:00+08:00"), {
      id: "190449",
      artist: "张学友 / Live",
      source: "netease"
    }),
    new Date("2026-07-01T11:00:00+08:00")
  );

  const page = store.list({ now: new Date("2026-07-01T12:00:00+08:00"), page: 1, pageSize: 10 });
  expect(page.total).toBe(1);
  expect(page.items.map((history) => history.id)).toEqual([latest.id]);
  expect(page.items.map((history) => history.id)).not.toContain(first.id);
}

describe("SqliteHistoryStore", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists play history across store instances", () => {
    const dbPath = tempDbPath();
    const first = new SqliteHistoryStore(dbPath);
    first.record(item("晴天"), new Date("2026-06-30T10:00:00+08:00"));
    first.close();

    const second = new SqliteHistoryStore(dbPath);
    expect(second.list({ now: new Date("2026-06-30T10:01:00+08:00") }).items[0]?.track.title).toBe("晴天");
    second.close();
  });

  it("persists the pending queue across store instances in order", () => {
    const dbPath = tempDbPath();
    const first = new SqliteHistoryStore(dbPath);
    first.savePendingQueue([item("第一首"), item("第二首")]);
    first.close();

    const second = new SqliteHistoryStore(dbPath);
    expect(second.loadPendingQueue().map((queueItem) => queueItem.track.title)).toEqual(["第一首", "第二首"]);
    second.savePendingQueue([item("第三首")]);
    second.close();

    const third = new SqliteHistoryStore(dbPath);
    expect(third.loadPendingQueue().map((queueItem) => queueItem.track.title)).toEqual(["第三首"]);
    third.close();
  });

  it("supports date filtering, pagination, and seven-day retention", () => {
    const store = new SqliteHistoryStore(tempDbPath());
    store.record(item("旧歌"), new Date("2026-06-21T10:00:00+08:00"));
    store.record(item("第一首"), new Date("2026-06-29T10:00:00+08:00"));
    store.record(item("第二首"), new Date("2026-06-30T10:00:00+08:00"));
    store.record(item("第三首"), new Date("2026-06-30T11:00:00+08:00"));

    const page = store.list({
      now: new Date("2026-06-30T12:00:00+08:00"),
      day: "2026-06-30",
      page: 1,
      pageSize: 1
    });

    expect(page.total).toBe(2);
    expect(page.items.map((history) => history.track.title)).toEqual(["第三首"]);
    expect(page.days).toEqual(["2026-06-30", "2026-06-29"]);
    store.close();
  });

  it("shows the latest same-song play once per local day", () => {
    const store = new SqliteHistoryStore(tempDbPath());
    expectSameSongDedupedPerLocalDay(store);
    store.close();
  });

  it("uses the stable track id for same-day display de-duplication", () => {
    const store = new SqliteHistoryStore(tempDbPath());
    expectSameTrackIdDedupedPerLocalDay(store);
    store.close();
  });
});

describe("InMemoryHistoryStore", () => {
  it("shows the latest same-song play once per local day", () => {
    expectSameSongDedupedPerLocalDay(new InMemoryHistoryStore());
  });

  it("uses the stable track id for same-day display de-duplication", () => {
    expectSameTrackIdDedupedPerLocalDay(new InMemoryHistoryStore());
  });
});
