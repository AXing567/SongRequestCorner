import { describe, expect, it } from "vitest";
import { CommandService } from "../src/commands/CommandService.js";
import type { IncomingMessage } from "../src/domain/types.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import { MockPlayerAdapter } from "../src/players/MockPlayerAdapter.js";
import { MockMusicProvider } from "../src/providers/MockMusicProvider.js";
import { QueueService } from "../src/queue/QueueService.js";

function createService() {
  const queue = new QueueService();
  const playback = new PlaybackEngine(queue, new MockPlayerAdapter());
  return {
    queue,
    service: new CommandService(new MockMusicProvider(), queue, playback)
  };
}

function message(userId = "u1", role: "employee" | "admin" = "employee"): IncomingMessage {
  return {
    id: "m1",
    chatId: "c1",
    text: "",
    sender: { id: userId, name: userId, role },
    createdAt: new Date()
  };
}

describe("CommandService", () => {
  it("adds a found song to queue and starts playback", async () => {
    const { service, queue } = createService();

    const result = await service.execute({ type: "request_song", query: "晴天 周杰伦" }, message());

    expect(result.text).toContain("已加入队列：周杰伦 - 晴天");
    expect(queue.getCurrent()?.track.title).toBe("晴天");
  });

  it("reports search miss", async () => {
    const { service } = createService();

    const result = await service.execute({ type: "request_song", query: "找不到" }, message());

    expect(result.text).toContain("点歌失败");
  });

  it("lets a user cancel their pending song", async () => {
    const { service } = createService();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u1"));

    const result = await service.execute({ type: "cancel_mine" }, message("u1"));

    expect(result.text).toContain("已撤销");
    expect(result.text).toContain("B - 第二首");
  });

  it("does not execute management commands from chat", async () => {
    const { service } = createService();

    const result = await service.execute({ type: "skip" }, message("u1"));

    expect(result.text).toBe("请在本地管理面板里切歌。");
  });

  it("does not expose clear queue through chat", async () => {
    const { service, queue } = createService();
    await service.execute({ type: "request_song", query: "晴天 周杰伦" }, message("u1"));

    const result = await service.execute({ type: "clear_queue" }, message("admin", "admin"));

    expect(result.text).toContain("清空队列功能已关闭");
    expect(queue.getCurrent()).toBeDefined();
  });

  it("moves and removes pending queue items", async () => {
    const { service, queue } = createService();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));
    await service.execute({ type: "request_song", query: "第三首 C" }, message("u3"));

    const pending = queue.listPending();
    expect(pending).toHaveLength(2);

    expect(queue.movePending(pending[1]!.id, "up")).toBe(true);
    expect(queue.listPending()[0]?.track.title).toBe("第三首");

    const removed = queue.removePending(pending[1]!.id);
    expect(removed?.track.title).toBe("第三首");
    expect(queue.listPending()).toHaveLength(1);
  });
});
