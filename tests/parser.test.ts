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

  it("parses playback control commands available to every Feishu user", () => {
    expect(parseCommand("切歌")).toEqual({ type: "skip" });
    expect(parseCommand("下一首")).toEqual({ type: "skip" });
    expect(parseCommand("暂停")).toEqual({ type: "pause" });
    expect(parseCommand("继续")).toEqual({ type: "resume" });
  });

  it("parses queue, history, and help aliases", () => {
    expect(parseCommand("待播放")).toEqual({ type: "show_queue" });
    expect(parseCommand("历史记录")).toEqual({ type: "history" });
    expect(parseCommand("历史")).toEqual({ type: "history" });
    expect(parseCommand("帮助")).toEqual({ type: "help" });
    expect(parseCommand("清空队列")).toEqual({ type: "request_song", query: "清空队列" });
  });

  it("parses history replay commands from card buttons", () => {
    expect(parseCommand("再次加入 hist-1")).toEqual({
      type: "replay_history",
      historyItemId: "hist-1"
    });
    expect(parseCommand("重播 hist-2")).toEqual({
      type: "replay_history",
      historyItemId: "hist-2"
    });
  });
});
