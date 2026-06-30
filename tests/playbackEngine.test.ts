import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerStatus, QueueItem } from "../src/domain/types.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import type { PlayerAdapter } from "../src/players/PlayerAdapter.js";
import { QueueService } from "../src/queue/QueueService.js";

class RecordingPlayer implements PlayerAdapter {
  calls: string[] = [];
  status: PlayerStatus = { state: "idle" };
  skipDelayMs = 0;
  playDelayMs = 0;

  async getStatus(): Promise<PlayerStatus> {
    return this.status;
  }

  async play(item: QueueItem): Promise<void> {
    this.calls.push(`play:${item.track.title}`);
    if (this.playDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.playDelayMs));
    }
    this.status = { state: "playing", current: item };
  }

  async skip(): Promise<void> {
    this.calls.push("skip");
    if (this.skipDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.skipDelayMs));
    }
    this.status = { state: "idle" };
  }

  async pause(): Promise<void> {
    this.calls.push("pause");
  }

  async resume(): Promise<void> {
    this.calls.push("resume");
  }

  async clear(): Promise<void> {
    this.calls.push("clear");
    this.status = { state: "idle" };
  }
}

function user() {
  return { id: "u1", role: "employee" as const };
}

describe("PlaybackEngine", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips even when current is the last song so the player may auto-continue", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "最后一首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();
    await engine.skip();

    expect(player.calls).toEqual(["play:最后一首", "skip"]);
    expect(queue.listHistory()[0]?.track.title).toBe("最后一首");
  });

  it("skips to the next queued song when pending songs exist", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();
    await engine.skip();

    expect(player.calls).toEqual(["play:第一首", "clear", "play:第二首"]);
  });

  it("does not ask the provider to auto-skip when a requested song is queued", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "上一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "点歌下一首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();
    await engine.skip();

    expect(player.calls).not.toContain("skip");
    expect(player.calls.at(-1)).toBe("play:点歌下一首");
  });

  it("emits track started events", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const started: string[] = [];
    const engine = new PlaybackEngine(queue, player, {
      onTrackStarted: (item) => {
        started.push(item.track.title);
      }
    });

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();

    expect(started).toEqual(["第一首"]);
  });

  it("exposes the next song while the player adapter is still switching", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    player.playDelayMs = 30;
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "慢切歌", artist: "歌手", source: "mock" }, user());
    const playing = engine.ensurePlaying();
    const statusWhileSwitching = await engine.getStatus();
    await playing;

    expect(statusWhileSwitching.current?.track.title).toBe("慢切歌");
    expect(statusWhileSwitching.switching).toBe(true);
  });

  it("records history when a song naturally finishes", async () => {
    vi.useFakeTimers();
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "短歌", artist: "歌手", source: "mock", durationMs: 100 }, user());
    await engine.ensurePlaying();
    await vi.advanceTimersByTimeAsync(100);

    expect(queue.getCurrent()).toBeUndefined();
    expect(queue.listHistory()[0]?.track.title).toBe("短歌");
  });

  it("advances to the requested next song when the external player leaves the current song early", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();

    player.status = { state: "playing" };
    const status = await engine.getStatus();

    expect(status.current?.track.title).toBe("第二首");
    expect(player.calls).toEqual(["play:第一首", "clear", "play:第二首"]);
    expect(queue.listHistory()[0]?.track.title).toBe("第一首");
  });

  it("clears the bot current song when the external player auto-continues and no requested song is pending", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "最后一首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();

    player.status = { state: "playing" };
    const status = await engine.getStatus();

    expect(status.current).toBeUndefined();
    expect(queue.getCurrent()).toBeUndefined();
    expect(queue.listHistory()[0]?.track.title).toBe("最后一首");
    expect(player.calls).toEqual(["play:最后一首"]);
  });

  it("serializes concurrent playback operations", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    player.skipDelayMs = 30;
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();
    const revision = (await engine.getStatus()).revision;

    const firstSkip = engine.skip({ expectedRevision: revision });
    const statusWhileBusy = await engine.getStatus();
    const secondSkip = engine.skip({ expectedRevision: revision });
    const [firstResult, secondResult] = await Promise.all([firstSkip, secondSkip]);

    expect(statusWhileBusy.busy).toBe(true);
    expect(firstResult.ok).toBe(true);
    expect(secondResult.ignored).toBe(true);
    expect(player.calls).toEqual(["play:第一首", "clear", "play:第二首"]);
    expect(queue.getCurrent()?.track.title).toBe("第二首");
  });

  it("ignores a stale skip that was submitted for a previous current song", async () => {
    const queue = new QueueService();
    const player = new RecordingPlayer();
    const engine = new PlaybackEngine(queue, player);

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "3", title: "第三首", artist: "歌手", source: "mock" }, user());
    await engine.ensurePlaying();

    const revision = (await engine.getStatus()).revision;
    await engine.skip({ expectedRevision: revision });
    const staleResult = await engine.skip({ expectedRevision: revision });

    expect(staleResult).toMatchObject({ ok: false, ignored: true, reason: "stale_state" });
    expect(queue.getCurrent()?.track.title).toBe("第二首");
    expect(queue.listPending().map((item) => item.track.title)).toEqual(["第三首"]);
  });
});
