import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { IncomingMessage } from "../domain/types.js";
import type { PlayerLoginQrCode } from "../players/PlayerAdapter.js";
import type { BotTransport } from "./BotTransport.js";

interface TenantAccessTokenResponse {
  code: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
}

interface FeishuApiResponse<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
}

interface FeishuImageUploadData {
  image_key?: string;
}

interface FeishuMessageEvent {
  event?: FeishuMessageEventBody;
  message?: FeishuMessageEventBody["message"];
  sender?: FeishuMessageEventBody["sender"];
  header?: {
    event_type?: string;
  };
}

interface FeishuMessageEventBody {
  message?: {
    message_id?: string;
    chat_id?: string;
    message_type?: string;
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
  private wsClient?: any;
  private dispatcher?: any;

  constructor(private readonly config: AppConfig) {
    if (!config.feishu.appId || !config.feishu.appSecret) {
      throw new Error("BOT_TRANSPORT=feishu requires FEISHU_APP_ID and FEISHU_APP_SECRET.");
    }
  }

  async start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void> {
    const lark = await this.importLarkSdk();
    this.wsClient = new lark.WSClient({
      appId: this.config.feishu.appId,
      appSecret: this.config.feishu.appSecret,
      autoReconnect: true,
      handshakeTimeoutMs: 15_000,
      wsConfig: {
        pingTimeout: 15
      },
      onReady: () => {
        console.log("[feishu] websocket connected");
      },
      onError: (error: Error) => {
        console.error(`[feishu] websocket error: ${error.message}`);
      },
      onReconnecting: () => {
        console.warn("[feishu] websocket reconnecting");
      },
      onReconnected: () => {
        console.log("[feishu] websocket reconnected");
      }
    });

    this.dispatcher = new lark.EventDispatcher({}).register({
      "im.message.receive_v1": async (event: FeishuMessageEvent) => {
        await this.handleMessageEvent(event, onMessage);
      }
    });

    await this.wsClient.start({ eventDispatcher: this.dispatcher });
    console.log("[feishu] websocket bot started");
    setTimeout(() => {
      if (typeof this.wsClient?.getConnectionStatus === "function") {
        console.log("[feishu] connection status", this.wsClient.getConnectionStatus());
      }
    }, 2000);
  }

  private async handleMessageEvent(
    event: FeishuMessageEvent,
    onMessage: (message: IncomingMessage) => Promise<void>
  ): Promise<void> {
    console.log("[feishu] received im.message.receive_v1 event");

    try {
      const normalized = normalizeFeishuMessageEvent(event, this.config.adminUserIds);
      if (normalized) {
        console.log(`[feishu] message from ${normalized.sender.id}: ${normalized.text}`);
        await onMessage(normalized);
        return;
      }

      const data = event.event ?? event;
      console.warn(
        `[feishu] ignored message event because required fields were missing: ${JSON.stringify({
          eventType: event.header?.event_type,
          messageId: data?.message?.message_id,
          messageType: data?.message?.message_type,
          hasChatId: Boolean(data?.message?.chat_id),
          hasSender: Boolean(data?.sender?.sender_id),
          hasContent: Boolean(data?.message?.content)
        })}`
      );
    } catch (error) {
      console.error(`[feishu] message event handler failed: ${errorMessage(error)}`);
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, "text", { text });
  }

  async sendImage(chatId: string, image: PlayerLoginQrCode): Promise<void> {
    const imageKey = await this.uploadImage(image);
    await this.sendMessage(chatId, "image", { image_key: imageKey });
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

    await assertFeishuOk(response, "Feishu reply message failed");
  }

  private async sendMessage(chatId: string, msgType: "text" | "image", content: Record<string, string>): Promise<void> {
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
          msg_type: msgType,
          content: JSON.stringify(content)
        })
      }
    );

    await assertFeishuOk(response, "Feishu send message failed");
  }

  private async uploadImage(image: PlayerLoginQrCode): Promise<string> {
    const token = await this.getTenantAccessToken();
    const form = new FormData();
    const bytes = Uint8Array.from(image.data);
    form.append("image_type", "message");
    form.append(
      "image",
      new Blob([bytes.buffer], { type: image.mimeType }),
      image.filename ?? "netease-login-qr.png"
    );

    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      },
      body: form
    });

    const body = await readFeishuJson<FeishuImageUploadData>(response, "Feishu upload image failed");
    const imageKey = body.data?.image_key;
    if (!imageKey) {
      throw new Error("Feishu upload image failed: missing image_key");
    }

    return imageKey;
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

async function assertFeishuOk(response: Response, action: string): Promise<void> {
  await readFeishuJson(response, action);
}

async function readFeishuJson<T>(response: Response, action: string): Promise<FeishuApiResponse<T>> {
  if (!response.ok) {
    throw new Error(`${action}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as FeishuApiResponse<T>;
  if (body.code && body.code !== 0) {
    throw new Error(`${action}: ${body.msg ?? body.code}`);
  }

  return body;
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
    const parsed = JSON.parse(content) as unknown;
    const text = extractTextFromParsedContent(parsed);
    return text || undefined;
  } catch {
    const text = content.trim();
    return text || undefined;
  }
}

function extractTextFromParsedContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content.map(extractTextFromParsedContent).filter(Boolean).join(" ").trim();
  }

  if (!content || typeof content !== "object") {
    return "";
  }

  const record = content as Record<string, unknown>;
  const preferred = firstString(record.text, record.un_escape_text, record.title, record.content);
  if (preferred) {
    return preferred;
  }

  const parts: string[] = [];
  for (const key of ["elements", "items", "children"]) {
    const value = record[key];
    const text = extractTextFromParsedContent(value);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join(" ").trim();
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = extractTextFromParsedContent(value);
    if (text) {
      return text;
    }
  }

  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
