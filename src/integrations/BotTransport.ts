import type { IncomingMessage } from "../domain/types.js";

export interface BotTransport {
  start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  replyText?(messageId: string, text: string): Promise<void>;
}
