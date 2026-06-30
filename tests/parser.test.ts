import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/commands/parser.js";

describe("parseCommand", () => {
  it("parses explicit song request after bot mention", () => {
    expect(parseCommand("@点歌机器人 点歌 晴天 周杰伦")).toEqual({
      type: "request_song",
      query: "晴天 周杰伦"
    });
  });

  it("treats direct mentioned text as a song request", () => {
    expect(parseCommand("@点歌机器人 冬天的秘密 周传雄")).toEqual({
      type: "request_song",
      query: "冬天的秘密 周传雄"
    });
  });

  it("supports song title without artist", () => {
    expect(parseCommand("@点歌机器人 小星星")).toEqual({
      type: "request_song",
      query: "小星星"
    });
  });

  it("parses user commands that remain available in Feishu", () => {
    expect(parseCommand("队列")).toEqual({ type: "show_queue" });
    expect(parseCommand("当前播放")).toEqual({ type: "current" });
    expect(parseCommand("撤销我的点歌")).toEqual({ type: "cancel_mine" });
  });

  it("treats management words as song requests in chat", () => {
    expect(parseCommand("切歌")).toEqual({ type: "request_song", query: "切歌" });
    expect(parseCommand("清空队列")).toEqual({ type: "request_song", query: "清空队列" });
    expect(parseCommand("暂停")).toEqual({ type: "request_song", query: "暂停" });
    expect(parseCommand("继续")).toEqual({ type: "request_song", query: "继续" });
  });
});
