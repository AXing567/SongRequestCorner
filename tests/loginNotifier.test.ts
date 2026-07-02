import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { IncomingMessage, PlayerStatus, QueueItem } from "../src/domain/types.js";
import type { BotTransport } from "../src/integrations/BotTransport.js";
import { LoginNotifier } from "../src/login/LoginNotifier.js";
import type { LoginAwarePlayerAdapter, PlayerLoginStatus } from "../src/players/PlayerAdapter.js";

class FakeTransport implements BotTransport {
  readonly sent: string[] = [];
  readonly images: number[] = [];

  async start(_onMessage: (message: IncomingMessage) => Promise<void>): Promise<void> {}

  async sendText(_chatId: string, text: string): Promise<void> {
    this.sent.push(text);
  }

  async sendImage(_chatId: string, image: NonNullable<PlayerLoginStatus["qrCode"]>): Promise<void> {
    this.images.push(image.data.length);
  }
}

class FakeLoginPlayer implements LoginAwarePlayerAdapter {
  constructor(private readonly statuses: PlayerLoginStatus[]) {}

  async getLoginStatus(): Promise<PlayerLoginStatus> {
    return this.statuses.shift() ?? this.statuses[this.statuses.length - 1] ?? { state: "unknown" };
  }

  async getStatus(): Promise<PlayerStatus> {
    return { state: "idle" };
  }

  async play(_item: QueueItem): Promise<void> {}
  async skip(): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async clear(): Promise<void> {}
}

describe("LoginNotifier", () => {
  it("sends the NetEase login QR and thanks the logged-in account after recovery", async () => {
    const transport = new FakeTransport();
    const player = new FakeLoginPlayer([
      {
        state: "login_required",
        qrCode: { data: Buffer.from("qr"), mimeType: "image/png", filename: "qr.png" }
      },
      { state: "logged_in", accountName: "Alice" }
    ]);
    const notifier = new LoginNotifier({
      player,
      getTransport: () => transport,
      getChatId: () => "chat-1"
    });

    await notifier.checkNow();
    await notifier.checkNow();

    expect(transport.images).toEqual([2]);
    expect(transport.sent[0]).toContain("网易云登录状态已失效");
    expect(transport.sent[1]).toContain("感谢 网易云账号「Alice」");
  });

  it("does not resend the QR before the resend window passes", async () => {
    let now = 0;
    const transport = new FakeTransport();
    const player = new FakeLoginPlayer([
      {
        state: "login_required",
        qrCode: { data: Buffer.from("first"), mimeType: "image/png" }
      },
      {
        state: "login_required",
        qrCode: { data: Buffer.from("second"), mimeType: "image/png" }
      }
    ]);
    const notifier = new LoginNotifier({
      player,
      getTransport: () => transport,
      getChatId: () => "chat-1",
      resendAfterMs: 10_000,
      now: () => now
    });

    await notifier.checkNow();
    now = 5_000;
    await notifier.checkNow();

    expect(transport.images).toEqual([5]);
    expect(transport.sent.filter((text) => text.includes("网易云登录状态已失效"))).toHaveLength(1);
  });

  it("sends a QR later if the first login-required notice had no QR image", async () => {
    let now = 0;
    const transport = new FakeTransport();
    const player = new FakeLoginPlayer([
      { state: "login_required" },
      {
        state: "login_required",
        qrCode: { data: Buffer.from("qr"), mimeType: "image/png" }
      }
    ]);
    const notifier = new LoginNotifier({
      player,
      getTransport: () => transport,
      getChatId: () => "chat-1",
      resendAfterMs: 10_000,
      now: () => now
    });

    await notifier.checkNow();
    now = 1_000;
    await notifier.checkNow();

    expect(transport.images).toEqual([2]);
    expect(transport.sent.filter((text) => text.includes("网易云登录状态已失效"))).toHaveLength(2);
  });
});
