import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../src/domain/types.js";
import { RecentMessageCache } from "../src/utils/RecentMessageCache.js";

function message(id: string): IncomingMessage {
  return {
    id,
    chatId: "chat",
    text: "点歌 晴天 周杰伦",
    sender: { id: "user", role: "employee" },
    createdAt: new Date()
  };
}

describe("RecentMessageCache", () => {
  it("rejects duplicate message ids", () => {
    const cache = new RecentMessageCache();

    expect(cache.shouldProcess(message("m1"))).toBe(true);
    expect(cache.shouldProcess(message("m1"))).toBe(false);
  });
});
