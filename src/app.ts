import type { Server } from "node:http";
import type { BotCard } from "./cards/BotCard.js";
import {
  createErrorCard,
  createPlaybackStartedCard,
  createQueueDepletedCard,
  createSearchingCard
} from "./cards/BotCard.js";
import type { AppConfig } from "./config.js";
import { CommandService } from "./commands/CommandService.js";
import { parseCommand } from "./commands/parser.js";
import type { IncomingMessage } from "./domain/types.js";
import type { BotTransport, SentBotMessage } from "./integrations/BotTransport.js";
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

      const text = `当前播放：${formatTrack(item.track)}`;
      await safeSend(transport, lastChatId, text, createPlaybackStartedCard(text));
    },
    onQueueDepleted: async () => {
      if (!transport || !lastChatId) {
        return;
      }

      await safeSend(
        transport,
        lastChatId,
        "点歌队列已经没有歌曲了，接下来会由网易云自动播放下一首。想听指定歌曲的话，继续 @我 发送歌名就行。",
        createQueueDepletedCard(
          "点歌队列已经没有歌曲了，接下来会由网易云自动播放下一首。想听指定歌曲的话，继续 @我 发送歌名就行。"
        )
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

  let progressMessage: SentBotMessage | undefined;
  if (command.type === "request_song") {
    progressMessage = await safeReplyOrSend(
      transport,
      message,
      `收到，正在搜索「${command.query}」`,
      createSearchingCard(command.query)
    );
  }

  try {
    const result = await commandService.execute(command, message);
    const updated = await safeUpdateCard(transport, progressMessage?.messageId, result.card);
    if (!updated) {
      await safeReplyOrSend(transport, message, result.text, result.card);
    }
    if (result.shouldCheckLogin) {
      await checkLoginStatusForNotification(loginNotifier);
    }
  } catch (error) {
    const text = humanizeError(error);
    const updated = await safeUpdateCard(transport, progressMessage?.messageId, createErrorCard(text));
    if (!updated) {
      await safeReplyOrSend(transport, message, text, createErrorCard(text));
    }
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

async function safeSend(
  transport: BotTransport,
  chatId: string,
  text: string,
  card?: BotCard
): Promise<SentBotMessage | undefined> {
  if (card && transport.sendCard) {
    try {
      return (await transport.sendCard(chatId, card)) ?? undefined;
    } catch (error) {
      console.error(`Card send failed: ${String(error)}`);
    }
  }

  try {
    return (await transport.sendText(chatId, text)) ?? undefined;
  } catch (error) {
    console.error(`Message send failed: ${String(error)}`);
    return undefined;
  }
}

async function safeReplyOrSend(
  transport: BotTransport,
  message: IncomingMessage,
  text: string,
  card?: BotCard
): Promise<SentBotMessage | undefined> {
  if (card && message.canReply && transport.replyCard) {
    try {
      return (await transport.replyCard(message.id, card)) ?? undefined;
    } catch (error) {
      console.error(`Card reply failed: ${String(error)}`);
    }
  }

  if (message.canReply && transport.replyText) {
    try {
      return (await transport.replyText(message.id, text)) ?? undefined;
    } catch (error) {
      console.error(`Message reply failed: ${String(error)}`);
    }
  }

  return await safeSend(transport, message.chatId, text, card);
}

async function safeUpdateCard(
  transport: BotTransport,
  messageId: string | undefined,
  card: BotCard | undefined
): Promise<boolean> {
  if (!messageId || !card || !transport.updateCard) {
    return false;
  }

  try {
    await transport.updateCard(messageId, card);
    return true;
  } catch (error) {
    console.error(`Card update failed: ${String(error)}`);
    return false;
  }
}

function humanizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `操作失败：${message}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
