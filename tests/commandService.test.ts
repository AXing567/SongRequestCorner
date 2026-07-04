import { describe, expect, it } from "vitest";
import { CommandService } from "../src/commands/CommandService.js";
import type { IncomingMessage, PlayerStatus, QueueItem } from "../src/domain/types.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import { MockPlayerAdapter } from "../src/players/MockPlayerAdapter.js";
import type { PlayerAdapter } from "../src/players/PlayerAdapter.js";
import { MockMusicProvider } from "../src/providers/MockMusicProvider.js";
import { QueueService } from "../src/queue/QueueService.js";

class RecordingPlayer implements PlayerAdapter {
  calls: string[] = [];
  status: PlayerStatus = { state: "idle" };
  clearDelayMs = 0;

  async getStatus(): Promise<PlayerStatus> {
    return this.status;
  }

  async play(item: QueueItem): Promise<void> {
    this.calls.push(`play:${item.track.title}`);
    this.status = { state: "playing", current: item };
  }

  async skip(): Promise<void> {
    this.calls.push("skip");
    this.status = { state: "idle" };
  }

  async pause(): Promise<void> {
    this.calls.push("pause");
    if (this.status.current) {
      this.status = { ...this.status, state: "paused" };
    }
  }

  async resume(): Promise<void> {
    this.calls.push("resume");
    if (this.status.current) {
      this.status = { ...this.status, state: "playing" };
    }
  }

  async clear(): Promise<void> {
    this.calls.push("clear");
    if (this.clearDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.clearDelayMs));
    }
    this.status = { state: "idle" };
  }
}

function createService() {
  const queue = new QueueService();
  const playback = new PlaybackEngine(queue, new MockPlayerAdapter());
  return {
    queue,
    service: new CommandService(new MockMusicProvider(), queue, playback)
  };
}

function createServiceWithPlayer(player = new RecordingPlayer()) {
  const queue = new QueueService();
  const playback = new PlaybackEngine(queue, player);
  return {
    player,
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

  it("lets any user skip from chat controls", async () => {
    const { service, queue, player } = createServiceWithPlayer();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));

    const result = await service.execute({ type: "skip" }, message("u3"));

    expect(result.text).toContain("已切歌");
    expect(queue.getCurrent()?.track.title).toBe("第二首");
    expect(player.calls).toEqual(["play:第一首", "clear", "play:第二首"]);
  });

  it("deduplicates concurrent skip commands for the same playback state", async () => {
    const player = new RecordingPlayer();
    player.clearDelayMs = 20;
    const { service, queue } = createServiceWithPlayer(player);
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));
    await service.execute({ type: "request_song", query: "第三首 C" }, message("u3"));

    const [first, second] = await Promise.all([
      service.execute({ type: "skip" }, message("u4")),
      service.execute({ type: "skip" }, message("u5"))
    ]);

    expect([first.text, second.text].some((text) => text.includes("已切歌"))).toBe(true);
    expect([first.text, second.text].some((text) => text.includes("刚刚已经有人切过"))).toBe(true);
    expect(queue.getCurrent()?.track.title).toBe("第二首");
    expect(queue.listPending().map((item) => item.track.title)).toEqual(["第三首"]);
    expect(player.calls).toEqual(["play:第一首", "clear", "play:第二首"]);
  });

  it("lets any user pause and resume from chat controls", async () => {
    const { service, player } = createServiceWithPlayer();
    await service.execute({ type: "request_song", query: "晴天 周杰伦" }, message("u1"));

    const pause = await service.execute({ type: "pause" }, message("u2"));
    const resume = await service.execute({ type: "resume" }, message("u3"));

    expect(pause.text).toBe("已暂停当前播放。");
    expect(resume.text).toBe("已继续播放。");
    expect(player.calls).toEqual(["play:晴天", "pause", "resume"]);
  });

  it("does not expose clear queue through chat", async () => {
    const { service, queue } = createService();
    await service.execute({ type: "request_song", query: "晴天 周杰伦" }, message("u1"));

    const result = await service.execute({ type: "clear_queue" }, message("admin", "admin"));

    expect(result.text).toContain("清空队列功能已关闭");
    expect(queue.getCurrent()).toBeDefined();
  });

  it("shows every pending song in the queue response", async () => {
    const { service } = createService();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));
    await service.execute({ type: "request_song", query: "第三首 C" }, message("u3"));
    await service.execute({ type: "request_song", query: "第四首 D" }, message("u4"));

    const result = await service.execute({ type: "show_queue" }, message("u5"));

    expect(result.text).toContain("待播放：3 首");
    expect(result.text).toContain("B - 第二首");
    expect(result.text).toContain("C - 第三首");
    expect(result.text).toContain("D - 第四首");
  });

  it("shows recent play history", async () => {
    const { service } = createServiceWithPlayer();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));
    await service.execute({ type: "skip" }, message("u3"));

    const result = await service.execute({ type: "history" }, message("u4"));

    expect(result.text).toContain("最近播放历史");
    expect(result.text).toContain("A - 第一首");
  });

  it("replays a history item from a card button command", async () => {
    const { service, queue } = createServiceWithPlayer();
    await service.execute({ type: "request_song", query: "第一首 A" }, message("u1"));
    await service.execute({ type: "request_song", query: "第二首 B" }, message("u2"));
    await service.execute({ type: "skip" }, message("u3"));

    const historyItem = queue.listHistoryPage({ page: 1, pageSize: 10 }).items[0]!;
    const result = await service.execute(
      { type: "replay_history", historyItemId: historyItem.id },
      message("u4")
    );

    expect(result.text).toContain("已再次加入队列");
    expect(queue.listPending()[0]?.track.title).toBe("第一首");
    expect(queue.listPending()[0]?.requester.id).toBe("u4");
  });

  it("returns chat help with playback controls", async () => {
    const { service } = createService();

    const result = await service.execute({ type: "help" }, message("u1"));

    expect(result.text).toContain("艾特机器人后直接发歌名");
    expect(result.text).toContain("群里直接发送歌名也会自动搜索");
    expect(result.text).toContain("切歌");
    expect(result.text).toContain("暂停");
    expect(result.text).toContain("历史记录");
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
