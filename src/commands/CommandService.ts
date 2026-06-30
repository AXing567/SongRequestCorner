import type { Command, IncomingMessage } from "../domain/types.js";
import type { MusicProvider } from "../providers/MusicProvider.js";
import type { QueueService } from "../queue/QueueService.js";
import type { PlaybackEngine } from "../playback/PlaybackEngine.js";
import { formatQueueItem, formatTrack, pluralSong } from "../utils/format.js";

export interface CommandResult {
  text: string;
}

export class CommandService {
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
        return { text: "请在本地管理面板里切歌。" };
      case "clear_queue":
        return { text: "清空队列功能已关闭，避免误操作。需要处理单首歌时，请在本地管理面板移除待播歌曲或切歌。" };
      case "pause":
        return { text: "请在本地管理面板里暂停播放。" };
      case "resume":
        return { text: "请在本地管理面板里继续播放。" };
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
      return { text: `点歌失败：播放端无法播放这首歌，${errorMessage(error)}` };
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

}

function helpText(): string {
  return [
    "可用命令：",
    "点歌 晴天 周杰伦",
    "队列",
    "当前播放",
    "撤销我的点歌",
    "管理操作请打开本地管理面板"
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
