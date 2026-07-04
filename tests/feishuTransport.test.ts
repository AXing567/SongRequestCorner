import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import type { IncomingMessage } from "../src/domain/types.js";
import {
  FeishuTransport,
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
});
