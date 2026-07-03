import type { Server } from "node:http";
import type { AppConfig } from "./config.js";
import { CommandService } from "./commands/CommandService.js";
import { parseCommand } from "./commands/parser.js";
import type { IncomingMessage } from "./domain/types.js";
import type { BotTransport } from "./integrations/BotTransport.js";
import { ConsoleTransport } from "./integrations/ConsoleTransport.js";
import { FeishuTransport } from "./integrations/FeishuTransport.js";
import { SqliteHistoryStore } from "./history/HistoryStore.js";
import { LoginNotifier } from "./login/LoginNotifier.js";
import { startAdminServer } from "./server/AdminServer.js";
import { PlaybackEngine } from "./playback/PlaybackEngine.js";
import { MockPlayerAdapter } from "./players/MockPlayerAdapter.js";
import { isNeteaseLoginRequiredError, NeteaseWebPlayerAdapter } from "./players/NeteaseWebPlayerAdapter.js";
import { isLoginAwarePlayerAdapter, type PlayerAdapter } from "./players/PlayerAdapter.js";
import { MockMusicProvider } from "./providers/MockMusicProvider.js";
import { NeteaseSearchProvider } from "./providers/NeteaseSearchProvider.js";
import { QueueService } from "./queue/QueueService.js";
import { RecentMessageCache } from "./utils/RecentMessageCache.js";
import { formatTrack } from "./utils/format.js";

export async function startApp(config: AppConfig): Promise<void> {
  const historyStore = new SqliteHistoryStore(config.history.databasePath);
  const queue = new QueueService(historyStore);
  const musicProvider =
    config.musicProvider === "netease-web" ? new NeteaseSearchProvider() : new MockMusicProvider();
  const player =
    config.playerAdapter === "netease-web"
      ? new NeteaseWebPlayerAdapter(config.netease)
      : new MockPlayerAdapter();
  let transport: BotTransport | undefined;
  let lastChatId: string | undefined;
  const playback = new PlaybackEngine(queue, player, {
    onTrackStarted: async (item) => {
      if (!transport || !lastChatId) {
        return;
      }

      await safeSend(transport, lastChatId, `当前播放：${formatTrack(item.track)}`);
    },
    onQueueDepleted: async () => {
      if (!transport || !lastChatId) {
        return;
      }

      await safeSend(
        transport,
        lastChatId,
        "点歌队列已经没有歌曲了，接下来会由网易云自动播放下一首。想听指定歌曲的话，继续 @我 发送歌名就行。"
      );
    }
  });
  const commandService = new CommandService(musicProvider, queue, playback);
  transport = createTransport(config);
  const loginNotifier = isLoginAwarePlayerAdapter(player)
    ? new LoginNotifier({
        player,
        getTransport: () => transport,
        getChatId: () => lastChatId
      })
    : undefined;
  const recentMessages = new RecentMessageCache();
  let adminServer: Server | undefined;

  if (config.adminServer.enabled) {
    adminServer = startAdminServer({
      host: config.adminServer.host,
      port: config.adminServer.port,
      queue,
      playback
    });
  }

  loginNotifier?.start();
  installGracefulShutdown({
    adminServer,
    historyStore,
    loginNotifier,
    player
  });
  startPlayerWarmUp(player);

  await transport.start((message) =>
    handleIncomingMessage(
      message,
      config,
      commandService,
      transport,
      recentMessages,
      (chatId) => {
        lastChatId = chatId;
      },
      loginNotifier
    )
  );
}

function startPlayerWarmUp(player: PlayerAdapter): void {
  if (!player.warmUp) {
    return;
  }

  void Promise.resolve(player.warmUp()).catch((error) => {
    console.warn(`[player] warm-up failed: ${errorMessage(error)}`);
  });
}

function installGracefulShutdown(resources: {
  adminServer?: Server;
  historyStore: SqliteHistoryStore;
  loginNotifier?: LoginNotifier;
  player: PlayerAdapter;
}): void {
  let stopping = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;
    console.log(`[app] shutting down after ${signal}; closing browser profile and local resources...`);
    await closeResources(resources);
    console.log("[app] shutdown complete");
    process.exit(0);
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.once(signal, () => {
      void shutdown(signal);
    });
  }
}

async function closeResources(resources: {
  adminServer?: Server;
  historyStore: SqliteHistoryStore;
  loginNotifier?: LoginNotifier;
  player: PlayerAdapter;
}): Promise<void> {
  resources.loginNotifier?.stop();
  await closeServer(resources.adminServer);
  await resources.player.dispose?.();
  resources.historyStore.close();
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        console.warn(`Admin server close failed: ${String(error)}`);
      }
      resolve();
    });
  });
}

export async function handleIncomingMessage(
  message: IncomingMessage,
  config: AppConfig,
  commandService: CommandService,
  transport: BotTransport,
  recentMessages = new RecentMessageCache(),
  onSeenChat?: (chatId: string) => void,
  loginNotifier?: Pick<LoginNotifier, "checkNow">
): Promise<void> {
  if (!recentMessages.shouldProcess(message)) {
    console.warn(`[bot] ignored duplicate message ${message.id}`);
    return;
  }

  const command = parseCommand(message.text, config.botDisplayName);
  onSeenChat?.(message.chatId);

  if (command.type === "request_song") {
    await safeReplyOrSend(transport, message, `收到，正在搜索「${command.query}」`);
  }

  try {
    const result = await commandService.execute(command, message);
    await safeReplyOrSend(transport, message, result.text);
    if (result.shouldCheckLogin) {
      await checkLoginStatusForNotification(loginNotifier);
    }
  } catch (error) {
    await safeReplyOrSend(transport, message, humanizeError(error));
    if (isNeteaseLoginRequiredError(error)) {
      await checkLoginStatusForNotification(loginNotifier);
    }
  }
}

async function checkLoginStatusForNotification(
  loginNotifier?: Pick<LoginNotifier, "checkNow">
): Promise<void> {
  if (!loginNotifier) {
    return;
  }

  try {
    await loginNotifier.checkNow();
  } catch (error) {
    console.warn(`[login] failed to check NetEase login status after playback failure: ${String(error)}`);
  }
}

function createTransport(config: AppConfig): BotTransport {
  if (config.botTransport === "feishu") {
    return new FeishuTransport(config);
  }

  return new ConsoleTransport(config);
}

async function safeSend(transport: BotTransport, chatId: string, text: string): Promise<void> {
  try {
    await transport.sendText(chatId, text);
  } catch (error) {
    console.error(`Message send failed: ${String(error)}`);
  }
}

async function safeReplyOrSend(
  transport: BotTransport,
  message: IncomingMessage,
  text: string
): Promise<void> {
  if (message.canReply && transport.replyText) {
    try {
      await transport.replyText(message.id, text);
      return;
    } catch (error) {
      console.error(`Message reply failed: ${String(error)}`);
    }
  }

  await safeSend(transport, message.chatId, text);
}

function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `操作失败：${message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
