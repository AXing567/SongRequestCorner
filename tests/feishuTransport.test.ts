import { describe, expect, it } from "vitest";
import { normalizeFeishuMessageEvent } from "../src/integrations/FeishuTransport.js";

describe("normalizeFeishuMessageEvent", () => {
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
});
