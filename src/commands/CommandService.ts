import type { Command, IncomingMessage, PlayerStatus } from "../domain/types.js";
import type { MusicProvider } from "../providers/MusicProvider.js";
import type { QueueService } from "../queue/QueueService.js";
import type { PlaybackEngine } from "../playback/PlaybackEngine.js";
import { formatQueueItem, formatTrack, pluralSong } from "../utils/format.js";

export interface CommandResult {
  text: string;
  shouldCheckLogin?: boolean;
}

export class CommandService {
  private readonly controlGuard = new PlaybackCommandGuard();

  constructor(
    private readonly musicProvider: MusicProvider,
    private readonly queue: QueueService,
    private readonly playback: PlaybackEngine
  ) {}

  async execute(command: Command, message: IncomingMessage): Promise<CommandResult> {
    switch (command.type) {
      case "request_song":
        return this.requestSong(command.query, message);
      case "show_queue":
        return this.showQueue();
      case "current":
        return this.showCurrent();
      case "cancel_mine":
        return this.cancelMine(message.sender.id);
      case "skip":
        return this.skip(message);
      case "clear_queue":
        return { text: "清空队列功能已关闭，避免误操作。需要处理单首歌时，请在本地管理面板移除待播歌曲或切歌。" };
      case "pause":
        return this.pause(message);
      case "resume":
        return this.resume(message);
      case "history":
        return this.showHistory();
      case "help":
        return { text: helpText() };
      case "unknown":
        return { text: `${command.reason}\n${helpText()}` };
    }
  }

  private async requestSong(query: string, message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return { text: "点歌失败：播放端离线，请联系管理员检查公司音响电脑。" };
    }

    let tracks;
    try {
      tracks = await this.musicProvider.search({ query });
    } catch (error) {
      return { text: `点歌失败：搜索服务异常，${errorMessage(error)}` };
    }

    const track = tracks[0];
    if (!track) {
      return { text: `点歌失败：没有找到「${query}」。可以试试加上歌手名。` };
    }

    const { position } = this.queue.enqueue(track, message.sender);
    try {
      await this.playback.ensurePlaying();
    } catch (error) {
      return {
        text: `点歌失败：播放端无法播放这首歌，${errorMessage(error)}`,
        shouldCheckLogin: true
      };
    }

    return { text: `已加入队列：${formatTrack(track)}，目前第 ${position} 首` };
  }

  private async showQueue(): Promise<CommandResult> {
    const current = this.queue.getCurrent();
    const pending = this.queue.listPending();
    if (!current && pending.length === 0) {
      return { text: "队列是空的，快来点第一首。" };
    }

    const lines = [
      current ? `当前播放：${formatTrack(current.track)}` : "当前没有播放中的歌曲。",
      `待播放：${pluralSong(pending.length)}`,
      ...pending.map((item, index) => formatQueueItem(item, index + 1))
    ];
    return { text: lines.join("\n") };
  }

  private async showCurrent(): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (!status.current) {
      return { text: "当前没有播放中的歌曲。" };
    }

    const label = status.state === "paused" ? "当前暂停" : "当前播放";
    return { text: `${label}：${formatTrack(status.current.track)}` };
  }

  private async cancelMine(userId: string): Promise<CommandResult> {
    const item = this.queue.cancelLatestByUser(userId);
    if (!item) {
      return { text: "没有找到你可以撤销的待播歌曲。正在播放的歌曲不能撤销，可以在本地管理面板切歌。" };
    }

    return { text: `已撤销：${formatTrack(item.track)}` };
  }

  private async skip(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    const guardKey = this.controlGuard.tryStart(message.chatId, "skip", status);
    if (!guardKey) {
      return { text: "刚刚已经有人切过这首了，正在处理新的播放状态。" };
    }

    try {
      const result = await this.playback.skip({ expectedRevision: status.revision });
      if (result.ignored) {
        return { text: "刚刚已经有人切过这首了，当前播放状态已经变化。" };
      }

      const nextStatus = await this.playback.getStatus();
      if (nextStatus.current) {
        return { text: `已切歌，当前播放：${formatTrack(nextStatus.current.track)}` };
      }

      return { text: "已切歌，当前没有待播放歌曲，将由网易云自动播放。" };
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("切歌失败", error);
    }
  }

  private async pause(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return { text: "暂停失败：播放端离线，请检查公司音响电脑。" };
    }
    if (!status.current) {
      return { text: "当前没有点歌播放中的歌曲。" };
    }
    if (status.state === "paused") {
      return { text: "当前已经暂停。" };
    }

    const guardKey = this.controlGuard.tryStart(message.chatId, "pause", status);
    if (!guardKey) {
      return { text: "刚刚已经有人暂停过了，当前播放状态正在更新。" };
    }

    try {
      const result = await this.playback.pause({ expectedRevision: status.revision });
      if (result.ignored) {
        return { text: "当前播放状态已经变化，暂停没有重复执行。" };
      }
      if (!result.ok) {
        return { text: "当前已经暂停或没有可暂停的歌曲。" };
      }

      return { text: "已暂停当前播放。" };
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("暂停失败", error);
    }
  }

  private async resume(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return { text: "继续失败：播放端离线，请检查公司音响电脑。" };
    }
    if (!status.current) {
      return { text: "当前没有点歌播放中的歌曲。" };
    }
    if (status.state === "playing") {
      return { text: "当前已经在播放。" };
    }

    const guardKey = this.controlGuard.tryStart(message.chatId, "resume", status);
    if (!guardKey) {
      return { text: "刚刚已经有人继续播放了，当前播放状态正在更新。" };
    }

    try {
      const result = await this.playback.resume({ expectedRevision: status.revision });
      if (result.ignored) {
        return { text: "当前播放状态已经变化，继续播放没有重复执行。" };
      }
      if (!result.ok) {
        return { text: "当前已经在播放或没有可继续的歌曲。" };
      }

      return { text: "已继续播放。" };
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("继续失败", error);
    }
  }

  private async showHistory(): Promise<CommandResult> {
    const history = this.queue.listHistoryPage({ page: 1, pageSize: 10 });
    if (history.items.length === 0) {
      return { text: "暂无历史记录。" };
    }

    const lines = [
      "最近播放历史：",
      ...history.items.map((item, index) => {
        const requester = item.requester.name ?? item.requester.id;
        return `${index + 1}. ${formatTrack(item.track)}（${formatHistoryTime(item.playedAt)}，${requester}）`;
      })
    ];
    return { text: lines.join("\n") };
  }
}

type PlaybackControlCommand = "skip" | "pause" | "resume";

class PlaybackCommandGuard {
  private readonly consumed = new Map<string, true>();
  private readonly maxEntries = 200;

  tryStart(chatId: string, command: PlaybackControlCommand, status: PlayerStatus): string | undefined {
    const key = this.keyFor(chatId, command, status);
    if (this.consumed.has(key)) {
      return undefined;
    }

    this.consumed.set(key, true);
    this.prune();
    return key;
  }

  release(key: string): void {
    this.consumed.delete(key);
  }

  private keyFor(chatId: string, command: PlaybackControlCommand, status: PlayerStatus): string {
    return [
      chatId,
      command,
      status.revision ?? "unknown-revision",
      status.current?.id ?? "no-current"
    ].join("\u0000");
  }

  private prune(): void {
    while (this.consumed.size > this.maxEntries) {
      const oldestKey = this.consumed.keys().next().value;
      if (!oldestKey) {
        return;
      }

      this.consumed.delete(oldestKey);
    }
  }
}

function helpText(): string {
  return [
    "点歌方式：",
    "艾特机器人后直接发歌名：晴天",
    "也可以发歌名 + 歌手：晴天 周杰伦",
    "群里直接发送歌名也会自动搜索。",
    "",
    "可用命令：",
    "待播放 / 队列",
    "当前播放",
    "撤销我的点歌",
    "切歌",
    "暂停",
    "继续",
    "历史记录",
    "帮助"
  ].join("\n");
}

function playbackControlFailure(prefix: string, error: unknown): CommandResult {
  return {
    text: `${prefix}：${errorMessage(error)}`,
    shouldCheckLogin: true
  };
}

function formatHistoryTime(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
