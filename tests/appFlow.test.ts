import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../src/app.js";
import { CommandService } from "../src/commands/CommandService.js";
import type { AppConfig } from "../src/config.js";
import type { IncomingMessage } from "../src/domain/types.js";
import type { BotTransport } from "../src/integrations/BotTransport.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import { MockPlayerAdapter } from "../src/players/MockPlayerAdapter.js";
import type { PlayerAdapter } from "../src/players/PlayerAdapter.js";
import { MockMusicProvider } from "../src/providers/MockMusicProvider.js";
import { QueueService } from "../src/queue/QueueService.js";

class FailingPlayerAdapter implements PlayerAdapter {
  async getStatus() {
    return { state: "idle" as const };
  }

  async play(): Promise<void> {
    throw new Error(
      "Clicked the NetEase song-page play button, but the bottom player did not switch to the target song."
    );
  }

  async skip(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async clear(): Promise<void> {}
}

class FakeLoginNotifier {
  checks = 0;

  async checkNow(): Promise<void> {
    this.checks += 1;
  }
}
class FakeTransport implements BotTransport {
  readonly sent: string[] = [];
  readonly replies: Array<{ messageId: string; text: string }> = [];

  async start(): Promise<void> {
    return;
  }

  async sendText(_chatId: string, text: string): Promise<void> {
    this.sent.push(text);
  }

  async replyText(messageId: string, text: string): Promise<void> {
    this.replies.push({ messageId, text });
  }
}

function createHarness() {
  const queue = new QueueService();
  const playback = new PlaybackEngine(queue, new MockPlayerAdapter());
  const service = new CommandService(new MockMusicProvider(), queue, playback);
  const transport = new FakeTransport();
  const config: AppConfig = {
    botTransport: "console",
    musicProvider: "mock",
    playerAdapter: "mock",
    adminUserIds: new Set(["admin"]),
    botDisplayName: "点歌机器人",
    feishu: {},
    netease: { userDataDir: ".playwright/netease-profile", headless: true },
    adminServer: { enabled: false, host: "127.0.0.1", port: 3333 },
    history: { databasePath: ":memory:" }
  };

  return { config, service, transport };
}

function message(text: string, userId = "u1", role: "employee" | "admin" = "employee"): IncomingMessage {
  return {
    id: `${userId}-${text}`,
    chatId: "chat-1",
    text,
    sender: { id: userId, name: userId, role },
    createdAt: new Date(),
    canReply: false
  };
}

describe("app message flow", () => {
  it("sends immediate searching ack before queue result", async () => {
    const { config, service, transport } = createHarness();

    await handleIncomingMessage(message("@点歌机器人 点歌 晴天 周杰伦"), config, service, transport);

    expect(transport.sent[0]).toBe("收到，正在搜索「晴天 周杰伦」");
    expect(transport.sent[1]).toContain("已加入队列：周杰伦 - 晴天");
  });

  it("replies to the original Feishu message when possible", async () => {
    const { config, service, transport } = createHarness();
    const incoming = { ...message("@点歌机器人 小星星"), canReply: true };

    await handleIncomingMessage(incoming, config, service, transport);

    expect(transport.replies[0]).toEqual({
      messageId: incoming.id,
      text: "收到，正在搜索「小星星」"
    });
  });

  it("handles queue view end to end", async () => {
    const { config, service, transport } = createHarness();

    await handleIncomingMessage(message("点歌 晴天 周杰伦", "u1"), config, service, transport);
    await handleIncomingMessage(message("点歌 稻香 周杰伦", "u2"), config, service, transport);
    await handleIncomingMessage(message("队列", "u3"), config, service, transport);

    expect(transport.sent.some((text) => text.includes("当前播放：周杰伦 - 晴天"))).toBe(true);
  });
  it("checks login status when a song request fails during playback startup", async () => {
    const queue = new QueueService();
    const playback = new PlaybackEngine(queue, new FailingPlayerAdapter());
    const service = new CommandService(new MockMusicProvider(), queue, playback);
    const transport = new FakeTransport();
    const loginNotifier = new FakeLoginNotifier();
    const config = createHarness().config;

    await handleIncomingMessage(
      message("song artist"),
      config,
      service,
      transport,
      undefined,
      undefined,
      loginNotifier
    );

    expect(transport.sent[1]).toContain("Clicked the NetEase song-page play button");
    expect(loginNotifier.checks).toBe(1);
  });
});
