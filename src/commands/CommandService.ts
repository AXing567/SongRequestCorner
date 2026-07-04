import type { BotCard } from "../cards/BotCard.js";
import {
  createBotCard,
  playbackControlActions,
  queueActions
} from "../cards/BotCard.js";
import type { Command, IncomingMessage, PlayerStatus } from "../domain/types.js";
import type { MusicProvider } from "../providers/MusicProvider.js";
import type { QueueService } from "../queue/QueueService.js";
import type { PlaybackEngine } from "../playback/PlaybackEngine.js";
import { formatQueueItem, formatTrack, pluralSong } from "../utils/format.js";

export interface CommandResult {
  text: string;
  card?: BotCard;
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
        return resultCard({
          title: "功能已关闭",
          text: "清空队列功能已关闭，避免误操作。需要处理单首歌时，请在本地管理面板移除待播歌曲或切歌。",
          tone: "warning",
          actions: queueActions()
        });
      case "pause":
        return this.pause(message);
      case "resume":
        return this.resume(message);
      case "history":
        return this.showHistory();
      case "replay_history":
        return this.replayHistory(command.historyItemId, message);
      case "help":
        return resultCard({
          title: "点歌帮助",
          text: helpText(),
          tone: "info",
          actions: [
            { command: "show_queue" },
            { command: "current" },
            { command: "history" }
          ]
        });
      case "unknown":
        return resultCard({
          title: "没听懂这句",
          text: `${command.reason}\n${helpText()}`,
          tone: "warning",
          actions: [{ command: "help" }]
        });
    }
  }

  private async requestSong(query: string, message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return resultCard({
        title: "点歌失败",
        text: "点歌失败：播放端离线，请联系管理员检查公司音响电脑。",
        tone: "danger",
        actions: [{ command: "help" }]
      });
    }

    let tracks;
    try {
      tracks = await this.musicProvider.search({ query });
    } catch (error) {
      return resultCard({
        title: "点歌失败",
        text: `点歌失败：搜索服务异常，${errorMessage(error)}`,
        tone: "danger",
        actions: [{ command: "help" }]
      });
    }

    const track = tracks[0];
    if (!track) {
      return resultCard({
        title: "没有找到歌曲",
        text: `点歌失败：没有找到「${query}」。可以试试加上歌手名。`,
        tone: "warning",
        actions: [{ command: "help" }]
      });
    }

    const { position } = this.queue.enqueue(track, message.sender);
    try {
      await this.playback.ensurePlaying();
    } catch (error) {
      return resultCard({
        title: "播放失败",
        text: `点歌失败：播放端无法播放这首歌，${errorMessage(error)}`,
        tone: "danger",
        actions: [{ command: "help" }],
        shouldCheckLogin: true
      });
    }

    return resultCard({
      title: "已加入队列",
      text: `已加入队列：${formatTrack(track)}，目前第 ${position} 首`,
      tone: "success",
      actions: [
        { command: "show_queue", style: "primary" },
        { command: "current" },
        { command: "cancel_mine" }
      ]
    });
  }

  private async showQueue(): Promise<CommandResult> {
    const current = this.queue.getCurrent();
    const pending = this.queue.listPending();
    if (!current && pending.length === 0) {
      return resultCard({
        title: "待播放队列",
        text: "队列是空的，快来点第一首。",
        tone: "muted",
        actions: [
          { command: "history" },
          { command: "help" }
        ]
      });
    }

    const lines = [
      current ? `当前播放：${formatTrack(current.track)}` : "当前没有播放中的歌曲。",
      `待播放：${pluralSong(pending.length)}`,
      ...pending.map((item, index) => formatQueueItem(item, index + 1))
    ];
    return resultCard({
      title: "待播放队列",
      text: lines.join("\n"),
      tone: pending.length > 0 ? "info" : "muted",
      actions: queueActions()
    });
  }

  private async showCurrent(): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (!status.current) {
      return resultCard({
        title: "当前播放",
        text: "当前没有播放中的歌曲。",
        tone: "muted",
        actions: [
          { command: "show_queue" },
          { command: "history" }
        ]
      });
    }

    const label = status.state === "paused" ? "当前暂停" : "当前播放";
    return resultCard({
      title: label,
      text: `${label}：${formatTrack(status.current.track)}`,
      tone: status.state === "paused" ? "warning" : "success",
      actions: playbackControlActions()
    });
  }

  private async cancelMine(userId: string): Promise<CommandResult> {
    const item = this.queue.cancelLatestByUser(userId);
    if (!item) {
      return resultCard({
        title: "没有可撤销歌曲",
        text: "没有找到你可以撤销的待播歌曲。正在播放的歌曲不能撤销，可以在本地管理面板切歌。",
        tone: "warning",
        actions: queueActions()
      });
    }

    return resultCard({
      title: "已撤销",
      text: `已撤销：${formatTrack(item.track)}`,
      tone: "success",
      actions: queueActions()
    });
  }

  private async skip(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    const guardKey = this.controlGuard.tryStart(message.chatId, "skip", status);
    if (!guardKey) {
      return resultCard({
        title: "切歌处理中",
        text: "刚刚已经有人切过这首了，正在处理新的播放状态。",
        tone: "warning",
        actions: [{ command: "current" }, { command: "show_queue" }]
      });
    }

    try {
      const result = await this.playback.skip({ expectedRevision: status.revision });
      if (result.ignored) {
        return resultCard({
          title: "切歌已处理",
          text: "刚刚已经有人切过这首了，当前播放状态已经变化。",
          tone: "warning",
          actions: [{ command: "current" }, { command: "show_queue" }]
        });
      }

      const nextStatus = await this.playback.getStatus();
      if (nextStatus.current) {
        return resultCard({
          title: "已切歌",
          text: `已切歌，当前播放：${formatTrack(nextStatus.current.track)}`,
          tone: "success",
          actions: playbackControlActions()
        });
      }

      return resultCard({
        title: "已切歌",
        text: "已切歌，当前没有待播放歌曲，将由网易云自动播放。",
        tone: "muted",
        actions: [
          { command: "show_queue" },
          { command: "history" }
        ]
      });
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("切歌失败", error);
    }
  }

  private async pause(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return resultCard({
        title: "暂停失败",
        text: "暂停失败：播放端离线，请检查公司音响电脑。",
        tone: "danger",
        actions: [{ command: "current" }]
      });
    }
    if (!status.current) {
      return resultCard({
        title: "没有可暂停歌曲",
        text: "当前没有点歌播放中的歌曲。",
        tone: "warning",
        actions: [{ command: "show_queue" }]
      });
    }
    if (status.state === "paused") {
      return resultCard({
        title: "当前已经暂停",
        text: "当前已经暂停。",
        tone: "warning",
        actions: [{ command: "resume", style: "primary" }, { command: "skip" }]
      });
    }

    const guardKey = this.controlGuard.tryStart(message.chatId, "pause", status);
    if (!guardKey) {
      return resultCard({
        title: "暂停处理中",
        text: "刚刚已经有人暂停过了，当前播放状态正在更新。",
        tone: "warning",
        actions: [{ command: "current" }]
      });
    }

    try {
      const result = await this.playback.pause({ expectedRevision: status.revision });
      if (result.ignored) {
        return resultCard({
          title: "播放状态已变化",
          text: "当前播放状态已经变化，暂停没有重复执行。",
          tone: "warning",
          actions: [{ command: "current" }]
        });
      }
      if (!result.ok) {
        return resultCard({
          title: "暂停未执行",
          text: "当前已经暂停或没有可暂停的歌曲。",
          tone: "warning",
          actions: [{ command: "current" }]
        });
      }

      return resultCard({
        title: "已暂停",
        text: "已暂停当前播放。",
        tone: "success",
        actions: [{ command: "resume", style: "primary" }, { command: "skip" }, { command: "show_queue" }]
      });
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("暂停失败", error);
    }
  }

  private async resume(message: IncomingMessage): Promise<CommandResult> {
    const status = await this.playback.getStatus();
    if (status.state === "offline") {
      return resultCard({
        title: "继续失败",
        text: "继续失败：播放端离线，请检查公司音响电脑。",
        tone: "danger",
        actions: [{ command: "current" }]
      });
    }
    if (!status.current) {
      return resultCard({
        title: "没有可继续歌曲",
        text: "当前没有点歌播放中的歌曲。",
        tone: "warning",
        actions: [{ command: "show_queue" }]
      });
    }
    if (status.state === "playing") {
      return resultCard({
        title: "正在播放",
        text: "当前已经在播放。",
        tone: "success",
        actions: playbackControlActions()
      });
    }

    const guardKey = this.controlGuard.tryStart(message.chatId, "resume", status);
    if (!guardKey) {
      return resultCard({
        title: "继续处理中",
        text: "刚刚已经有人继续播放了，当前播放状态正在更新。",
        tone: "warning",
        actions: [{ command: "current" }]
      });
    }

    try {
      const result = await this.playback.resume({ expectedRevision: status.revision });
      if (result.ignored) {
        return resultCard({
          title: "播放状态已变化",
          text: "当前播放状态已经变化，继续播放没有重复执行。",
          tone: "warning",
          actions: [{ command: "current" }]
        });
      }
      if (!result.ok) {
        return resultCard({
          title: "继续未执行",
          text: "当前已经在播放或没有可继续的歌曲。",
          tone: "warning",
          actions: [{ command: "current" }]
        });
      }

      return resultCard({
        title: "已继续播放",
        text: "已继续播放。",
        tone: "success",
        actions: playbackControlActions()
      });
    } catch (error) {
      this.controlGuard.release(guardKey);
      return playbackControlFailure("继续失败", error);
    }
  }

  private async showHistory(): Promise<CommandResult> {
    const history = this.queue.listHistoryPage({ page: 1, pageSize: 10 });
    if (history.items.length === 0) {
      return resultCard({
        title: "历史记录",
        text: "暂无历史记录。",
        tone: "muted",
        actions: [{ command: "show_queue" }, { command: "current" }]
      });
    }

    const lines = [
      "最近播放历史：",
      ...history.items.map((item, index) => {
        const requester = item.requester.name ?? item.requester.id;
        return `${index + 1}. ${formatTrack(item.track)}（${formatHistoryTime(item.playedAt)}，${requester}）`;
      })
    ];
    return resultCard({
      title: "历史记录",
      text: lines.join("\n"),
      tone: "info",
      actions: [
        ...history.items.slice(0, 4).map((item, index) => ({
          command: "replay_history" as const,
          label: `重播 ${index + 1}`,
          valueText: `再次加入 ${item.id}`,
          style: index === 0 ? ("primary" as const) : undefined
        })),
        { command: "show_queue" as const },
        { command: "current" as const }
      ]
    });
  }

  private async replayHistory(historyItemId: string, message: IncomingMessage): Promise<CommandResult> {
    const replayed = this.queue.replayHistoryItem(historyItemId, message.sender);
    if (!replayed) {
      return resultCard({
        title: "再次加入失败",
        text: "没有找到这条历史记录，可能已经超过 7 天或被清理了。",
        tone: "warning",
        actions: [{ command: "history" }]
      });
    }

    try {
      await this.playback.ensurePlaying();
    } catch (error) {
      return resultCard({
        title: "播放失败",
        text: `已加入队列，但播放端无法播放这首歌：${errorMessage(error)}`,
        tone: "danger",
        actions: [{ command: "show_queue" }],
        shouldCheckLogin: true
      });
    }

    return resultCard({
      title: "已再次加入",
      text: `已再次加入队列：${formatTrack(replayed.item.track)}，目前第 ${replayed.position} 首`,
      tone: "success",
      actions: [
        { command: "show_queue", style: "primary" },
        { command: "current" }
      ]
    });
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
  return resultCard({
    title: prefix,
    text: `${prefix}：${errorMessage(error)}`,
    tone: "danger",
    actions: [{ command: "current" }, { command: "show_queue" }],
    shouldCheckLogin: true
  });
}

function resultCard(options: Parameters<typeof createBotCard>[0] & { shouldCheckLogin?: boolean }): CommandResult {
  return {
    text: options.text,
    card: createBotCard(options),
    shouldCheckLogin: options.shouldCheckLogin
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
