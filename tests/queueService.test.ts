import { describe, expect, it } from "vitest";
import { InMemoryHistoryStore } from "../src/history/HistoryStore.js";
import { QueueService } from "../src/queue/QueueService.js";

function user(id = "u1") {
  return { id, name: id, role: "employee" as const };
}

describe("QueueService history", () => {
  it("restores pending songs from the backing store after a service restart", () => {
    const store = new InMemoryHistoryStore();
    const first = new QueueService(store);

    first.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user("u1"));
    first.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user("u2"));

    const restarted = new QueueService(store);

    expect(restarted.listPending().map((item) => item.track.title)).toEqual(["第一首", "第二首"]);
    expect(restarted.listPending().map((item) => item.requester.id)).toEqual(["u1", "u2"]);
  });

  it("updates the persisted pending queue when songs are reordered or removed", () => {
    const store = new InMemoryHistoryStore();
    const queue = new QueueService(store);
    const first = queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user()).item;
    const second = queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user()).item;
    queue.enqueue({ id: "3", title: "第三首", artist: "歌手", source: "mock" }, user());

    queue.movePending(second.id, "up");
    queue.removePending(first.id);

    expect(new QueueService(store).listPending().map((item) => item.track.title)).toEqual(["第二首", "第三首"]);
  });

  it("records completed songs and can replay them into the queue", () => {
    const queue = new QueueService();
    const now = new Date();
    const original = queue.enqueue({ id: "1", title: "晴天", artist: "周杰伦", source: "mock" }, user()).item;

    queue.next();
    queue.completeCurrent(now);

    const history = queue.listHistory(now);
    expect(history).toHaveLength(1);
    expect(history[0]?.track).toEqual(original.track);

    const replayed = queue.replayHistoryItem(history[0]!.id, user("admin"));
    expect(replayed?.position).toBe(1);
    expect(queue.listPending()[0]?.track.title).toBe("晴天");
    expect(queue.listPending()[0]?.requester.id).toBe("admin");
  });

  it("keeps only history from the last 7 days", () => {
    const queue = new QueueService();
    const now = new Date();
    const old = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    queue.enqueue({ id: "old", title: "旧歌", artist: "歌手", source: "mock" }, user());
    queue.next();
    queue.completeCurrent(old);

    queue.enqueue({ id: "new", title: "新歌", artist: "歌手", source: "mock" }, user());
    queue.next();
    queue.completeCurrent(now);

    const history = queue.listHistory(now);
    expect(history.map((item) => item.track.title)).toEqual(["新歌"]);
  });
});
