import { describe, expect, it } from "vitest";
import { QueueService } from "../src/queue/QueueService.js";

function user(id = "u1") {
  return { id, name: id, role: "employee" as const };
}

describe("QueueService history", () => {
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
