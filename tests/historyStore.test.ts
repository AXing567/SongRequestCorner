import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteHistoryStore } from "../src/history/HistoryStore.js";
import type { QueueItem } from "../src/domain/types.js";

const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "music-history-"));
  tempDirs.push(dir);
  return join(dir, "history.sqlite");
}

function item(title: string, requestedAt = new Date()): QueueItem {
  return {
    id: `queue-${title}`,
    track: { id: title, title, artist: "歌手", source: "mock" },
    requester: { id: "u1", name: "u1", role: "employee" },
    requestedAt
  };
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
});
