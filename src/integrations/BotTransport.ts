import type { IncomingMessage } from "../domain/types.js";
import type { PlayerLoginQrCode } from "../players/PlayerAdapter.js";

export interface BotTransport {
  start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  sendImage?(chatId: string, image: PlayerLoginQrCode): Promise<void>;
  replyText?(messageId: string, text: string): Promise<void>;
}
