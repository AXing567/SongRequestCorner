import { describe, expect, it } from "vitest";
import { handleIncomingMessage } from "../src/app.js";
import { CommandService } from "../src/commands/CommandService.js";
import type { AppConfig } from "../src/config.js";
import type { IncomingMessage } from "../src/domain/types.js";
import type { BotTransport } from "../src/integrations/BotTransport.js";
import { PlaybackEngine } from "../src/playback/PlaybackEngine.js";
import { MockPlayerAdapter } from "../src/players/MockPlayerAdapter.js";
import { MockMusicProvider } from "../src/providers/MockMusicProvider.js";
import { QueueService } from "../src/queue/QueueService.js";

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
});
