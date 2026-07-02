import readline from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { stdin as input, stdout as output } from "node:process";
import type { AppConfig } from "../config.js";
import type { IncomingMessage } from "../domain/types.js";
import type { BotTransport } from "./BotTransport.js";
import type { PlayerLoginQrCode } from "../players/PlayerAdapter.js";

export class ConsoleTransport implements BotTransport {
  constructor(private readonly config: AppConfig) {}

  async start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void> {
    const rl = readline.createInterface({ input, output });
    console.log("控制台模式已启动。格式：<userId> <命令>，例如：u1 点歌 晴天 周杰伦");

    for await (const line of rl) {
      const parsed = parseConsoleLine(line);
      if (!parsed) {
        console.log("格式错误。示例：u1 点歌 晴天 周杰伦");
        continue;
      }

      await onMessage({
        id: randomUUID(),
        chatId: "console",
        text: parsed.text,
        sender: {
          id: parsed.userId,
          name: parsed.userId,
          role: this.config.adminUserIds.has(parsed.userId) ? "admin" : "employee"
        },
        createdAt: new Date()
      });
    }
  }

  async sendText(_chatId: string, text: string): Promise<void> {
    console.log(`[bot] ${text}`);
  }

  async sendImage(_chatId: string, image: PlayerLoginQrCode): Promise<void> {
    console.log(`[bot image] ${image.filename ?? "image.png"} (${image.mimeType}, ${image.data.length} bytes)`);
  }

  async replyText(messageId: string, text: string): Promise<void> {
    console.log(`[bot reply ${messageId}] ${text}`);
  }
}

function parseConsoleLine(line: string): { userId: string; text: string } | undefined {
  const trimmed = line.trim();
  const match = /^(\S+)\s+(.+)$/u.exec(trimmed);
  if (!match) {
    return undefined;
  }

  return { userId: match[1]!, text: match[2]! };
}
