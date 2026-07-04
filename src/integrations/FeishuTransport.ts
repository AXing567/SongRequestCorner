import { randomUUID } from "node:crypto";
import {
  cardActionCommandToText,
  isBotCardActionCommand,
  type BotCard
} from "../cards/BotCard.js";
import type { AppConfig } from "../config.js";
import type { IncomingMessage } from "../domain/types.js";
import type { PlayerLoginQrCode } from "../players/PlayerAdapter.js";
import type { BotTransport, SentBotMessage } from "./BotTransport.js";

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

interface FeishuMessageData {
  message_id?: string;
  message?: {
    message_id?: string;
  };
}

interface FeishuUserProfileData {
  user?: unknown;
}

type FeishuUserIdType = "open_id" | "user_id" | "union_id";
type FeishuMessageType = "text" | "image" | "interactive";
type FeishuMessageContent = Record<string, string> | BotCard;

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

interface FeishuCardActionEvent {
  event?: FeishuCardActionEventBody;
  action?: FeishuCardActionEventBody["action"];
  operator?: FeishuCardActionEventBody["operator"];
  context?: FeishuCardActionEventBody["context"];
  token?: string;
  header?: {
    event_id?: string;
    event_type?: string;
    create_time?: string | number;
  };
}

interface FeishuCardActionEventBody {
  action?: {
    value?: unknown;
  };
  operator?: {
    open_id?: string;
    user_id?: string;
    union_id?: string;
    operator_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
  };
  context?: {
    open_chat_id?: string;
    chat_id?: string;
    open_message_id?: string;
    message_id?: string;
  };
  token?: string;
}

const FEISHU_CONNECT_WAIT_MS = 30_000;
const FEISHU_STATUS_LOG_INTERVAL_MS = 10_000;
const FEISHU_USER_NAME_CACHE_MS = 24 * 60 * 60 * 1000;
const FEISHU_USER_NAME_FAILURE_CACHE_MS = 10 * 60 * 1000;

export class FeishuTransport implements BotTransport {
  private tenantToken?: { value: string; expiresAt: number };
  private readonly userNameCache = new Map<string, { name?: string; expiresAt: number }>();
  private readonly userNameInflight = new Map<string, Promise<string | undefined>>();
  private sdk: any;
  private wsClient?: any;
  private dispatcher?: any;
  private statusMonitor?: NodeJS.Timeout;
  private lastLoggedConnectionState?: string;

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
      },
      "card.action.trigger": async (event: FeishuCardActionEvent) => {
        await this.handleCardActionEvent(event, onMessage);
      }
    });
    this.wrapDispatcherForDiagnostics();

    await this.wsClient.start({ eventDispatcher: this.dispatcher });
    this.startConnectionStatusMonitor();
    await this.waitForConnected();
  }

  private startConnectionStatusMonitor(): void {
    this.statusMonitor ??= setInterval(() => {
      this.logConnectionStatus();
    }, FEISHU_STATUS_LOG_INTERVAL_MS);
    this.statusMonitor.unref?.();
    this.logConnectionStatus();
  }

  private async waitForConnected(): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < FEISHU_CONNECT_WAIT_MS) {
      const status = this.getConnectionStatus();
      if (status?.state === "connected") {
        console.log("[feishu] websocket bot started and connected");
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const status = this.getConnectionStatus();
    console.warn(
      `[feishu] websocket is not connected yet: ${JSON.stringify(
        status
      )}. The bot will not receive group mentions until this becomes connected.`
    );
  }

  private logConnectionStatus(): void {
    const status = this.getConnectionStatus();
    if (!status) {
      return;
    }

    const state = String(status.state ?? "unknown");
    if (state === this.lastLoggedConnectionState && state === "connected") {
      return;
    }

    this.lastLoggedConnectionState = state;
    const level = state === "connected" ? "log" : "warn";
    console[level]("[feishu] connection status", status);
  }

  private getConnectionStatus(): { state?: string; [key: string]: unknown } | undefined {
    if (typeof this.wsClient?.getConnectionStatus !== "function") {
      return undefined;
    }

    return this.wsClient.getConnectionStatus();
  }

  private wrapDispatcherForDiagnostics(): void {
    if (!this.dispatcher || typeof this.dispatcher.invoke !== "function") {
      return;
    }

    const originalInvoke = this.dispatcher.invoke.bind(this.dispatcher);
    this.dispatcher.invoke = async (event: unknown, params?: unknown) => {
      const eventType = readFeishuEventType(event);
      console.log(`[feishu] raw event received: ${eventType ?? "unknown"}`);
      return await originalInvoke(event, params);
    };
  }

  private async handleMessageEvent(
    event: FeishuMessageEvent,
    onMessage: (message: IncomingMessage) => Promise<void>
  ): Promise<void> {
    console.log("[feishu] received im.message.receive_v1 event");

    try {
      const normalized = normalizeFeishuMessageEvent(event, this.config.adminUserIds);
      if (normalized) {
        const enriched = await this.enrichSenderName(event, normalized);
        console.log(
          `[feishu] message from ${enriched.sender.name ?? enriched.sender.id} (${enriched.sender.id}): ${
            enriched.text
          }`
        );
        await onMessage(enriched);
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

  private async handleCardActionEvent(
    event: FeishuCardActionEvent,
    onMessage: (message: IncomingMessage) => Promise<void>
  ): Promise<void> {
    console.log("[feishu] received card.action.trigger event");

    try {
      const normalized = normalizeFeishuCardActionEvent(event, this.config.adminUserIds);
      if (normalized) {
        const enriched = await this.enrichCardActionSenderName(event, normalized);
        console.log(
          `[feishu] card action from ${enriched.sender.name ?? enriched.sender.id} (${enriched.sender.id}): ${
            enriched.text
          }`
        );
        await onMessage(enriched);
        return;
      }

      const data = event.event ?? event;
      console.warn(
        `[feishu] ignored card action because required fields were missing: ${JSON.stringify({
          eventType: event.header?.event_type,
          hasAction: Boolean(data?.action),
          hasOperator: Boolean(data?.operator),
          hasContext: Boolean(data?.context)
        })}`
      );
    } catch (error) {
      console.error(`[feishu] card action handler failed: ${errorMessage(error)}`);
    }
  }

  private async enrichSenderName(event: FeishuMessageEvent, message: IncomingMessage): Promise<IncomingMessage> {
    const identity = readFeishuSenderIdentity(event.event ?? event);
    if (!identity) {
      return message;
    }

    const name = await this.lookupUserDisplayName(identity.id, identity.type);
    if (!name) {
      return message;
    }

    return {
      ...message,
      sender: {
        ...message.sender,
        name
      }
    };
  }

  private async enrichCardActionSenderName(
    event: FeishuCardActionEvent,
    message: IncomingMessage
  ): Promise<IncomingMessage> {
    const identity = readFeishuOperatorIdentity(event.event ?? event);
    if (!identity) {
      return message;
    }

    const name = await this.lookupUserDisplayName(identity.id, identity.type);
    if (!name) {
      return message;
    }

    return {
      ...message,
      sender: {
        ...message.sender,
        name
      }
    };
  }

  async sendText(chatId: string, text: string): Promise<SentBotMessage | void> {
    return await this.sendMessage(chatId, "text", { text });
  }

  async sendImage(chatId: string, image: PlayerLoginQrCode): Promise<void> {
    const imageKey = await this.uploadImage(image);
    await this.sendMessage(chatId, "image", { image_key: imageKey });
  }

  async sendCard(chatId: string, card: BotCard): Promise<SentBotMessage | void> {
    return await this.sendMessage(chatId, "interactive", card);
  }

  async replyText(messageId: string, text: string): Promise<SentBotMessage | void> {
    return await this.replyMessage(messageId, "text", { text });
  }

  async replyCard(messageId: string, card: BotCard): Promise<SentBotMessage | void> {
    return await this.replyMessage(messageId, "interactive", card);
  }

  async updateCard(messageId: string, card: BotCard): Promise<void> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          content: JSON.stringify(card)
        })
      }
    );

    await assertFeishuOk(response, "Feishu update card failed");
  }

  private async replyMessage(
    messageId: string,
    msgType: FeishuMessageType,
    content: FeishuMessageContent
  ): Promise<SentBotMessage | void> {
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
          msg_type: msgType,
          content: JSON.stringify(content)
        })
      }
    );

    const body = await readFeishuJson<FeishuMessageData>(response, "Feishu reply message failed");
    return { messageId: readFeishuMessageId(body.data) };
  }

  private async sendMessage(
    chatId: string,
    msgType: FeishuMessageType,
    content: FeishuMessageContent
  ): Promise<SentBotMessage | void> {
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

    const body = await readFeishuJson<FeishuMessageData>(response, "Feishu send message failed");
    return { messageId: readFeishuMessageId(body.data) };
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

  private async lookupUserDisplayName(
    userId: string,
    userIdType: FeishuUserIdType
  ): Promise<string | undefined> {
    const cacheKey = `${userIdType}:${userId}`;
    const now = Date.now();
    const cached = this.userNameCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.name;
    }

    const inflight = this.userNameInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }

    const request = this.fetchUserDisplayName(userId, userIdType)
      .then((name) => {
        this.userNameCache.set(cacheKey, {
          name,
          expiresAt: Date.now() + (name ? FEISHU_USER_NAME_CACHE_MS : FEISHU_USER_NAME_FAILURE_CACHE_MS)
        });
        return name;
      })
      .catch((error) => {
        console.warn(
          `[feishu] could not resolve user display name for ${userIdType}:${userId}: ${errorMessage(error)}`
        );
        this.userNameCache.set(cacheKey, {
          expiresAt: Date.now() + FEISHU_USER_NAME_FAILURE_CACHE_MS
        });
        return undefined;
      })
      .finally(() => {
        this.userNameInflight.delete(cacheKey);
      });

    this.userNameInflight.set(cacheKey, request);
    return request;
  }

  private async fetchUserDisplayName(
    userId: string,
    userIdType: FeishuUserIdType
  ): Promise<string | undefined> {
    const token = await this.getTenantAccessToken();
    const response = await fetch(
      `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(
        userId
      )}?user_id_type=${encodeURIComponent(userIdType)}`,
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );

    const body = await readFeishuJson<FeishuUserProfileData>(response, "Feishu get user profile failed");
    return pickFeishuUserDisplayName(body.data?.user);
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

function readFeishuMessageId(data: FeishuMessageData | undefined): string | undefined {
  return firstPlainString(data?.message_id, data?.message?.message_id);
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
  const senderIdentity = readFeishuSenderIdentity(data);

  const chatId = message?.chat_id;
  const senderId = senderIdentity?.id;
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
      role: adminUserIds.has(senderId) ? "admin" : "employee"
    },
    createdAt: new Date(Number(message?.create_time ?? Date.now())),
    canReply: true
  };
}

export function normalizeFeishuCardActionEvent(
  event: FeishuCardActionEvent,
  adminUserIds: Set<string>
): IncomingMessage | undefined {
  const data = event.event ?? event;
  if (!data) {
    return undefined;
  }

  const text = readCardActionText(data.action?.value);
  const chatId = firstPlainString(data.context?.open_chat_id, data.context?.chat_id);
  const senderIdentity = readFeishuOperatorIdentity(data);
  if (!text || !chatId || !senderIdentity) {
    return undefined;
  }

  return {
    id:
      firstPlainString(
        data.token,
        event.header?.event_id,
        data.context?.open_message_id,
        data.context?.message_id
      ) ?? randomUUID(),
    chatId,
    text,
    sender: {
      id: senderIdentity.id,
      role: adminUserIds.has(senderIdentity.id) ? "admin" : "employee"
    },
    createdAt: new Date(Number(event.header?.create_time ?? Date.now())),
    canReply: false
  };
}

export function pickFeishuUserDisplayName(user: unknown): string | undefined {
  const record = asRecord(user);
  if (!record) {
    return undefined;
  }

  const i18nName = asRecord(record.i18n_name);
  return firstPlainString(
    record.name,
    i18nName?.zh_cn,
    i18nName?.zh_hk,
    i18nName?.zh_tw,
    record.display_name,
    record.nickname,
    record.en_name,
    i18nName?.en_us,
    i18nName?.ja_jp,
    record.alias
  );
}

function readFeishuSenderIdentity(
  body: FeishuMessageEventBody | undefined
): { id: string; type: FeishuUserIdType } | undefined {
  const senderId = body?.sender?.sender_id;
  const openId = firstPlainString(senderId?.open_id);
  if (openId) {
    return { id: openId, type: "open_id" };
  }

  const userId = firstPlainString(senderId?.user_id);
  if (userId) {
    return { id: userId, type: "user_id" };
  }

  const unionId = firstPlainString(senderId?.union_id);
  if (unionId) {
    return { id: unionId, type: "union_id" };
  }

  return undefined;
}

function readFeishuOperatorIdentity(
  body: FeishuCardActionEventBody | undefined
): { id: string; type: FeishuUserIdType } | undefined {
  const operator = body?.operator;
  const operatorId = operator?.operator_id;
  const openId = firstPlainString(operator?.open_id, operatorId?.open_id);
  if (openId) {
    return { id: openId, type: "open_id" };
  }

  const userId = firstPlainString(operator?.user_id, operatorId?.user_id);
  if (userId) {
    return { id: userId, type: "user_id" };
  }

  const unionId = firstPlainString(operator?.union_id, operatorId?.union_id);
  if (unionId) {
    return { id: unionId, type: "union_id" };
  }

  return undefined;
}

function readCardActionText(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const explicitText = firstPlainString(record.text);
  if (explicitText) {
    return explicitText;
  }

  const command = firstPlainString(record.command);
  if (command && isBotCardActionCommand(command)) {
    return cardActionCommandToText(command);
  }

  return undefined;
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

function readFeishuEventType(event: unknown): string | undefined {
  const eventRecord = asRecord(event);
  if (!eventRecord) {
    return undefined;
  }

  const direct =
    firstPlainString(eventRecord.type, eventRecord.event_type) ||
    firstPlainString(asRecord(eventRecord.header)?.event_type) ||
    firstPlainString(asRecord(eventRecord.event)?.type, asRecord(eventRecord.event)?.event_type);
  if (direct) {
    return direct;
  }

  const data = eventRecord.data;
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    return readFeishuEventType(JSON.parse(data));
  } catch {
    return undefined;
  }
}

function firstPlainString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
