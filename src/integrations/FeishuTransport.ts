import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { IncomingMessage } from "../domain/types.js";
import type { BotTransport } from "./BotTransport.js";

interface TenantAccessTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuMessageEvent {
  event?: FeishuMessageEventBody;
  message?: FeishuMessageEventBody["message"];
  sender?: FeishuMessageEventBody["sender"];
}

interface FeishuMessageEventBody {
  message?: {
    message_id?: string;
    chat_id?: string;
    content?: string;
    create_time?: string | number;
  };
  sender?: {
    sender_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
}

export class FeishuTransport implements BotTransport {
  private tenantToken?: { value: string; expiresAt: number };
  private sdk: any;

  constructor(private readonly config: AppConfig) {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new Error("BOT_TRANSPORT=feishu requires FEISHU_APP_ID and FEISHU_APP_SECRET.");
    }
  }

  async start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void> {
    const lark = await this.importLarkSdk();
    const wsClient = new lark.WSClient({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret
    });

    const dispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (event: FeishuMessageEvent) => {
        console.log("[feishu] received im.message.receive_v1 event");
        const normalized = normalizeFeishuMessageEvent(event, this.config.adminUserIds);
        if (normalized) {
          console.log(`[feishu] message from ${normalized.sender.id}: ${normalized.text}`);
          await onMessage(normalized);
        } else {
          console.warn("[feishu] ignored message event because required fields were missing");
        }
      }
    });

    wsClient.start({ eventDispatcher: dispatcher });
    console.log("[feishu] websocket bot started");
    setTimeout(() => {
      if (typeof wsClient.getConnectionStatus === "function") {
        console.log("[feishu] connection status", wsClient.getConnectionStatus());
      }
    }, 2000);
  }

  async sendText(chatId: string, text: string): Promise<void> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text })
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Feishu send message failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { code?: number; msg?: string };
    if (body.code && body.code !== 0) {
      throw new Error(`Feishu send message failed: ${body.msg ?? body.code}`);
    }
  }

  async replyText(messageId: string, text: string): Promise<void> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          msg_type: "text",
          content: JSON.stringify({ text })
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Feishu reply message failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as { code?: number; msg?: string };
    if (body.code && body.code !== 0) {
      throw new Error(`Feishu reply message failed: ${body.msg ?? body.code}`);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tenantToken && this.tenantToken.expiresAt > now + 60_000) {
      return this.tenantToken.value;
    }

    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          app_id: this.config.feishu.appId,
          app_secret: this.config.feishu.appSecret
        })
      }
    );

    if (!response.ok) {
      throw new Error(`Get Feishu tenant_access_token failed: HTTP ${response.status}`);
    }

    const body = (await response.json()) as TenantAccessTokenResponse;
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new Error(`Get Feishu tenant_access_token failed: ${body.msg ?? body.code}`);
    }

    this.tenantToken = {
      value: body.tenant_access_token,
      expiresAt: now + (body.expire ?? 7200) * 1000
    };
    return this.tenantToken.value;
  }

  private async importLarkSdk(): Promise<any> {
    if (this.sdk) {
      return this.sdk;
    }

    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<any>;
    try {
      this.sdk = await dynamicImport("@larksuiteoapi/node-sdk");
    } catch (error) {
      throw new Error(
        `Feishu websocket mode requires @larksuiteoapi/node-sdk. Run: npm install @larksuiteoapi/node-sdk@1.68.0. Original error: ${String(
          error
        )}`
      );
    }
    return this.sdk;
  }
}

export function normalizeFeishuMessageEvent(
  event: FeishuMessageEvent,
  adminUserIds: Set<string>
): IncomingMessage | undefined {
  const data = event.event ?? event;
  if (!data) {
    return undefined;
  }
  const message = data.message;
  const sender = data.sender;

  const chatId = message?.chat_id;
  const senderId = sender?.sender_id?.open_id ?? sender?.sender_id?.user_id;
  if (!chatId || !senderId) {
    return undefined;
  }

  const text = extractFeishuText(message?.content);
  if (!text) {
    return undefined;
  }

  return {
    id: message?.message_id ?? randomUUID(),
    chatId,
    text,
    sender: {
      id: senderId,
      name: sender?.sender_id?.union_id ?? senderId,
      role: adminUserIds.has(senderId) ? "admin" : "employee"
    },
    createdAt: new Date(Number(message?.create_time ?? Date.now())),
    canReply: true
  };
}

function extractFeishuText(content: unknown): string | undefined {
  if (typeof content !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text?.trim();
  } catch {
    return content.trim();
  }
}
