import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { IncomingMessage } from "../src/domain/types.js";
import {
  FeishuTransport,
  normalizeFeishuCardActionEvent,
  normalizeFeishuMessageEvent,
  pickFeishuUserDisplayName
} from "../src/integrations/FeishuTransport.js";

function config(): AppConfig {
  return {
    botTransport: "feishu",
    musicProvider: "mock",
    playerAdapter: "mock",
    adminUserIds: new Set(["ou_admin"]),
    botDisplayName: "bot",
    feishu: {
      appId: "app-id",
      appSecret: "app-secret"
    },
    netease: {
      userDataDir: ".playwright/netease-profile",
      headless: false
    },
    adminServer: {
      enabled: true,
      host: "0.0.0.0",
      port: 3333
    },
    history: {
      databasePath: ".data/play-history.sqlite"
    }
  };
}

interface TestableFeishuTransport {
  handleMessageEvent(
    event: unknown,
    onMessage: (message: IncomingMessage) => Promise<void>
  ): Promise<void>;
  handleCardActionEvent(
    event: unknown,
    onMessage: (message: IncomingMessage) => Promise<void>
  ): Promise<void>;
  sendCard(chatId: string, card: unknown): Promise<{ messageId?: string } | void>;
  updateCard(messageId: string, card: unknown): Promise<void>;
}

describe("normalizeFeishuMessageEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts text message fields and admin role", () => {
    const message = normalizeFeishuMessageEvent(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_1",
            content: JSON.stringify({ text: "@点歌机器人 点歌 冬天的秘密 周传雄" }),
            create_time: "1710000000000"
          },
          sender: {
            sender_id: {
              open_id: "ou_admin",
              union_id: "on_admin"
            }
          }
        }
      },
      new Set(["ou_admin"])
    );

    expect(message?.chatId).toBe("oc_1");
    expect(message?.text).toBe("@点歌机器人 点歌 冬天的秘密 周传雄");
    expect(message?.sender.role).toBe("admin");
    expect(message?.sender.name).toBeUndefined();
  });

  it("ignores events without text content", () => {
    const message = normalizeFeishuMessageEvent(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_1"
          },
          sender: {
            sender_id: {
              open_id: "ou_user"
            }
          }
        }
      },
      new Set()
    );

    expect(message).toBeUndefined();
  });

  it("picks a readable display name from a Feishu user profile", () => {
    expect(
      pickFeishuUserDisplayName({
        i18n_name: { zh_cn: "Alice CN", en_us: "Alice EN" },
        en_name: "Alice English"
      })
    ).toBe("Alice CN");
    expect(pickFeishuUserDisplayName({ name: "Alice" })).toBe("Alice");
    expect(pickFeishuUserDisplayName({})).toBeUndefined();
  });

  it("normalizes a card button action into a chat command message", () => {
    const message = normalizeFeishuCardActionEvent(
      {
        event: {
          action: {
            value: {
              command: "skip"
            }
          },
          operator: {
            open_id: "ou_user"
          },
          context: {
            open_chat_id: "oc_1",
            open_message_id: "om_card"
          },
          token: "token-1"
        }
      },
      new Set()
    );

    expect(message).toMatchObject({
      id: "token-1",
      chatId: "oc_1",
      text: "切歌",
      sender: {
        id: "ou_user",
        role: "employee"
      },
      canReply: false
    });
  });

  it("enriches incoming messages with the Feishu user profile name", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: "tenant-token",
            expire: 7200
          })
        );
      }

      if (target.includes("/contact/v3/users/ou_user?user_id_type=open_id")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              user: {
                name: "Alice"
              }
            }
          })
        );
      }

      return new Response(JSON.stringify({ code: 404, msg: `unexpected url: ${target}` }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FeishuTransport(config()) as unknown as TestableFeishuTransport;
    const received: IncomingMessage[] = [];

    await transport.handleMessageEvent(
      {
        event: {
          message: {
            message_id: "om_2",
            chat_id: "oc_1",
            content: JSON.stringify({ text: "晴天 周杰伦" }),
            create_time: "1710000000000"
          },
          sender: {
            sender_id: {
              open_id: "ou_user",
              union_id: "on_user"
            }
          }
        }
      },
      async (message) => {
        received.push(message);
      }
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.sender).toMatchObject({
      id: "ou_user",
      name: "Alice",
      role: "employee"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("enriches card action messages with the Feishu user profile name", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: "tenant-token",
            expire: 7200
          })
        );
      }

      if (target.includes("/contact/v3/users/ou_user?user_id_type=open_id")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              user: {
                name: "Alice"
              }
            }
          })
        );
      }

      return new Response(JSON.stringify({ code: 404, msg: `unexpected url: ${target}` }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FeishuTransport(config()) as unknown as TestableFeishuTransport;
    const received: IncomingMessage[] = [];

    await transport.handleCardActionEvent(
      {
        event: {
          action: {
            value: {
              text: "暂停"
            }
          },
          operator: {
            open_id: "ou_user"
          },
          context: {
            open_chat_id: "oc_1",
            open_message_id: "om_card"
          },
          token: "token-2"
        }
      },
      async (message) => {
        received.push(message);
      }
    );

    expect(received[0]).toMatchObject({
      text: "暂停",
      sender: {
        id: "ou_user",
        name: "Alice"
      }
    });
  });

  it("sends and updates Feishu interactive cards", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url);
      calls.push({ url: target, init });
      if (target.includes("/auth/v3/tenant_access_token/internal")) {
        return new Response(
          JSON.stringify({
            code: 0,
            tenant_access_token: "tenant-token",
            expire: 7200
          })
        );
      }

      if (target.includes("/open-apis/im/v1/messages?receive_id_type=chat_id")) {
        return new Response(JSON.stringify({ code: 0, data: { message_id: "om_card" } }));
      }

      if (target.includes("/open-apis/im/v1/messages/om_card")) {
        return new Response(JSON.stringify({ code: 0 }));
      }

      return new Response(JSON.stringify({ code: 404, msg: `unexpected url: ${target}` }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const transport = new FeishuTransport(config()) as unknown as TestableFeishuTransport;
    const card = {
      config: { wide_screen_mode: true, update_multi: true },
      header: { template: "blue", title: { tag: "plain_text", content: "测试卡片" } },
      elements: []
    };

    const sent = await transport.sendCard("oc_1", card);
    await transport.updateCard("om_card", card);

    expect(sent).toEqual({ messageId: "om_card" });
    const sendBody = JSON.parse(String(calls[1]?.init?.body)) as { msg_type: string; content: string };
    expect(sendBody.msg_type).toBe("interactive");
    expect(JSON.parse(sendBody.content)).toMatchObject({ header: { title: { content: "测试卡片" } } });
    expect(calls[2]?.init?.method).toBe("PATCH");
  });
});
