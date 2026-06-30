import "dotenv/config";

export interface AppConfig {
  botTransport: "console" | "feishu";
  musicProvider: "mock" | "netease-web";
  playerAdapter: "mock" | "netease-web";
  adminUserIds: Set<string>;
  botDisplayName: string;
  feishu: {
    appId?: string;
    appSecret?: string;
  };
  netease: {
    userDataDir: string;
    headless: boolean;
    executablePath?: string;
  };
  adminServer: {
    enabled: boolean;
    host: string;
    port: number;
  };
  history: {
    databasePath: string;
  };
}

function readChoice<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const value = process.env[name] ?? fallback;
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }

  throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readList(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function loadConfig(): AppConfig {
  return {
    botTransport: readChoice("BOT_TRANSPORT", "console", ["console", "feishu"] as const),
    musicProvider: readChoice("MUSIC_PROVIDER", "mock", ["mock", "netease-web"] as const),
    playerAdapter: readChoice("PLAYER_ADAPTER", "mock", ["mock", "netease-web"] as const),
    adminUserIds: readList("ADMIN_USER_IDS"),
    botDisplayName: process.env.BOT_DISPLAY_NAME ?? "点歌机器人",
    feishu: {
      appId: process.env.FEISHU_APP_ID,
      appSecret: process.env.FEISHU_APP_SECRET
    },
    netease: {
      userDataDir: process.env.NETEASE_USER_DATA_DIR ?? ".playwright/netease-profile",
      headless: readBoolean("NETEASE_HEADLESS", false),
      executablePath: process.env.CHROME_EXECUTABLE_PATH || undefined
    },
    adminServer: {
      enabled: readBoolean("ADMIN_SERVER_ENABLED", true),
      host: process.env.ADMIN_SERVER_HOST ?? "0.0.0.0",
      port: Number(process.env.ADMIN_SERVER_PORT ?? "3333")
    },
    history: {
      databasePath: process.env.HISTORY_DB_PATH ?? ".data/play-history.sqlite"
    }
  };
}
