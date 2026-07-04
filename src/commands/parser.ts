import type { Command } from "../domain/types.js";

const INFO_COMMAND_ALIASES = new Map<string, Command["type"]>([
  ["队列", "show_queue"],
  ["待播放", "show_queue"],
  ["当前播放", "current"],
  ["当前", "current"],
  ["撤销我的点歌", "cancel_mine"],
  ["撤销", "cancel_mine"],
  ["取消", "cancel_mine"],
  ["切歌", "skip"],
  ["下一首", "skip"],
  ["暂停", "pause"],
  ["继续", "resume"],
  ["历史记录", "history"],
  ["历史", "history"],
  ["帮助", "help"],
  ["help", "help"]
]);

export function parseCommand(rawText: string, botDisplayName = "点歌机器人"): Command {
  const text = normalizeText(rawText, botDisplayName);

  if (!text) {
    return { type: "unknown", reason: "消息内容为空。可以试试：点歌 晴天 周杰伦" };
  }

  if (text.startsWith("点歌")) {
    const query = text.replace(/^点歌[:：]?\s*/u, "").trim();
    if (!query) {
      return { type: "unknown", reason: "点歌格式不完整。示例：点歌 晴天 周杰伦" };
    }
    return { type: "request_song", query };
  }

  const exact = INFO_COMMAND_ALIASES.get(text);
  if (exact && exact !== "request_song" && exact !== "unknown") {
    return { type: exact };
  }

  return { type: "request_song", query: text };
}

function normalizeText(rawText: string, botDisplayName: string): string {
  let text = rawText
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const escapedName = escapeRegExp(botDisplayName);
  text = text.replace(new RegExp(`^@?${escapedName}\\s*`, "u"), "").trim();
  text = text.replace(/^@\S+\s*/u, "").trim();

  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
