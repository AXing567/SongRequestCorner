import type { IncomingMessage } from "../domain/types.js";
import type { PlayerLoginQrCode } from "../players/PlayerAdapter.js";
import type { BotCard } from "../cards/BotCard.js";

export interface SentBotMessage {
  messageId?: string;
}

export interface BotTransport {
  start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void>;
  sendText(chatId: string, text: string): Promise<SentBotMessage | void>;
  sendImage?(chatId: string, image: PlayerLoginQrCode): Promise<void>;
  replyText?(messageId: string, text: string): Promise<SentBotMessage | void>;
  sendCard?(chatId: string, card: BotCard): Promise<SentBotMessage | void>;
  replyCard?(messageId: string, card: BotCard): Promise<SentBotMessage | void>;
  updateCard?(messageId: string, card: BotCard): Promise<void>;
}
