import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { PlayerStatus, QueueItem } from "../src/domain/types.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import type { PlayerAdapter } from "../src/players/PlayerAdapter.js";
import { QueueService } from "../src/queue/QueueService.js";
import { startAdminServer } from "../src/server/AdminServer.js";

class RecordingPlayer implements PlayerAdapter {
  status: PlayerStatus = { state: "idle" };

  async getStatus(): Promise<PlayerStatus> {
    return this.status;
  }

  async play(item: QueueItem): Promise<void> {
    this.status = { state: "playing", current: item };
  }

  async skip(): Promise<void> {
    this.status = { state: "idle" };
  }

  async pause(): Promise<void> {
    this.status = { ...this.status, state: "paused" };
  }

  async resume(): Promise<void> {
    this.status = { ...this.status, state: "playing" };
  }

  async clear(): Promise<void> {
    this.status = { state: "idle" };
  }
}

function user() {
  return { id: "u1", name: "u1", role: "employee" as const };
}

describe("AdminServer", () => {
  const servers: Array<{ close: (callback?: (error?: Error) => void) => void }> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
      )
    );
  });

  it("returns history and replays a history item through the API", async () => {
    const queue = new QueueService();
    const playback = new PlaybackEngine(queue, new RecordingPlayer());
    const server = startAdminServer({ host: "127.0.0.1", port: 0, queue, playback });
    servers.push(server);

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    queue.enqueue({ id: "1", title: "晴天", artist: "周杰伦", source: "mock" }, user());
    await playback.ensurePlaying();
    await playback.skip();

    const statusResponse = await fetch(`${baseUrl}/api/status`);
    const status = (await statusResponse.json()) as { history?: unknown };
    expect(status.history).toBeUndefined();

    const historyResponse = await fetch(`${baseUrl}/api/history?page=1&pageSize=10`);
    const history = (await historyResponse.json()) as {
      items: Array<{ id: string; track: { title: string } }>;
      total: number;
    };
    expect(history.total).toBe(1);
    expect(history.items[0]?.track.title).toBe("晴天");

    const replayResponse = await fetch(`${baseUrl}/api/history/${history.items[0]!.id}/replay`, {
      method: "POST"
    });
    expect(replayResponse.status).toBe(200);
    expect((await playback.getStatus()).current?.track.title).toBe("晴天");
  });

  it("ignores stale playback controls from another admin page", async () => {
    const queue = new QueueService();
    const playback = new PlaybackEngine(queue, new RecordingPlayer());
    const server = startAdminServer({ host: "127.0.0.1", port: 0, queue, playback });
    servers.push(server);

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    queue.enqueue({ id: "1", title: "第一首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "2", title: "第二首", artist: "歌手", source: "mock" }, user());
    queue.enqueue({ id: "3", title: "第三首", artist: "歌手", source: "mock" }, user());
    await playback.ensurePlaying();

    const statusResponse = await fetch(`${baseUrl}/api/status`);
    const status = (await statusResponse.json()) as { player: { revision: number } };
    const body = JSON.stringify({ expectedRevision: status.player.revision });

    const firstResponse = await fetch(`${baseUrl}/api/playback/skip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
    const secondResponse = await fetch(`${baseUrl}/api/playback/skip`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });

    expect((await firstResponse.json()) as { ok: boolean }).toMatchObject({ ok: true });
    expect((await secondResponse.json()) as { ignored: boolean; reason: string }).toMatchObject({
      ignored: true,
      reason: "stale_state"
    });
    expect((await playback.getStatus()).current?.track.title).toBe("第二首");
  });

  it("rejects queue clear requests", async () => {
    const queue = new QueueService();
    const playback = new PlaybackEngine(queue, new RecordingPlayer());
    const server = startAdminServer({ host: "127.0.0.1", port: 0, queue, playback });
    servers.push(server);

    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    queue.enqueue({ id: "1", title: "晴天", artist: "周杰伦", source: "mock" }, user());
    await playback.ensurePlaying();

    const response = await fetch(`${baseUrl}/api/queue/clear`, { method: "POST" });

    expect(response.status).toBe(410);
    expect((await playback.getStatus()).current?.track.title).toBe("晴天");
  });
});
