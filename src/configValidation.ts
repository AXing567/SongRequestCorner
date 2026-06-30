import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { AppConfig } from "./config.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  hint?: string;
}

export interface ConfigValidationResult {
  diagnostics: Diagnostic[];
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export function validateConfig(config: AppConfig): ConfigValidationResult {
  const diagnostics: Diagnostic[] = [
    ...validateCoreConfig(config),
    ...validateFeishuConfig(config),
    ...validateNeteaseConfig(config),
    ...validateAdminConfig(config),
    ...validateHistoryConfig(config)
  ];

  return {
    diagnostics,
    errors: diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
    warnings: diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
  };
}

export function assertValidConfig(config: AppConfig): void {
  const result = validateConfig(config);
  if (result.errors.length === 0) {
    return;
  }

  const details = result.errors
    .map((diagnostic) => `- ${diagnostic.message}${diagnostic.hint ? ` ${diagnostic.hint}` : ""}`)
    .join("\n");
  throw new Error(`Configuration is invalid:\n${details}`);
}

function validateCoreConfig(config: AppConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (config.musicProvider !== config.playerAdapter) {
    diagnostics.push({
      severity: "error",
      code: "provider-player-mismatch",
      message: "MUSIC_PROVIDER and PLAYER_ADAPTER must currently use the same mode.",
      hint: "Use mock/mock for local testing or netease-web/netease-web for real playback."
    });
  }

  if (!config.botDisplayName.trim()) {
    diagnostics.push({
      severity: "error",
      code: "missing-bot-display-name",
      message: "BOT_DISPLAY_NAME cannot be empty."
    });
  }

  return diagnostics;
}

function validateFeishuConfig(config: AppConfig): Diagnostic[] {
  if (config.botTransport !== "feishu") {
    return [
      {
        severity: "info",
        code: "console-mode",
        message: "BOT_TRANSPORT=console is suitable for local smoke tests."
      }
    ];
  }

  const diagnostics: Diagnostic[] = [];
  if (!config.feishu.appId) {
    diagnostics.push({
      severity: "error",
      code: "missing-feishu-app-id",
      message: "FEISHU_APP_ID is required when BOT_TRANSPORT=feishu."
    });
  }

  if (!config.feishu.appSecret) {
    diagnostics.push({
      severity: "error",
      code: "missing-feishu-app-secret",
      message: "FEISHU_APP_SECRET is required when BOT_TRANSPORT=feishu."
    });
  }

  if (config.adminUserIds.size === 0) {
    diagnostics.push({
      severity: "warning",
      code: "missing-admin-users",
      message: "ADMIN_USER_IDS is empty.",
      hint: "Playback controls are handled by the local admin panel, but admin ids are still useful for future privileged flows."
    });
  }

  return diagnostics;
}

function validateNeteaseConfig(config: AppConfig): Diagnostic[] {
  if (config.playerAdapter !== "netease-web" && config.musicProvider !== "netease-web") {
    return [
      {
        severity: "info",
        code: "mock-playback",
        message: "Mock playback is enabled; NetEase login is not required."
      }
    ];
  }

  const diagnostics: Diagnostic[] = [];
  if (config.netease.executablePath && !existsSync(config.netease.executablePath)) {
    diagnostics.push({
      severity: "error",
      code: "chrome-not-found",
      message: `CHROME_EXECUTABLE_PATH does not exist: ${config.netease.executablePath}`,
      hint: "Set it to an installed Chrome or Edge executable, or leave it empty and run npx playwright install chromium."
    });
  }

  if (!config.netease.executablePath) {
    diagnostics.push({
      severity: "warning",
      code: "chrome-path-empty",
      message: "CHROME_EXECUTABLE_PATH is empty.",
      hint: "The app will use Playwright-managed Chromium. Run npx playwright install chromium if startup fails."
    });
  }

  if (config.netease.headless) {
    diagnostics.push({
      severity: "warning",
      code: "netease-headless",
      message: "NETEASE_HEADLESS=true may make first-time NetEase login difficult.",
      hint: "Use NETEASE_HEADLESS=false during setup."
    });
  }

  return diagnostics;
}

function validateAdminConfig(config: AppConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!Number.isInteger(config.adminServer.port) || config.adminServer.port < 1 || config.adminServer.port > 65535) {
    diagnostics.push({
      severity: "error",
      code: "invalid-admin-port",
      message: "ADMIN_SERVER_PORT must be an integer between 1 and 65535."
    });
  }

  if (config.adminServer.enabled && config.adminServer.host === "127.0.0.1") {
    diagnostics.push({
      severity: "warning",
      code: "admin-localhost-only",
      message: "ADMIN_SERVER_HOST=127.0.0.1 only allows access from this computer.",
      hint: "Use ADMIN_SERVER_HOST=0.0.0.0 for LAN access."
    });
  }

  return diagnostics;
}

function validateHistoryConfig(config: AppConfig): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  if (!config.history.databasePath.trim()) {
    diagnostics.push({
      severity: "error",
      code: "missing-history-db-path",
      message: "HISTORY_DB_PATH cannot be empty."
    });
    return diagnostics;
  }

  const directory = dirname(config.history.databasePath);
  if (directory === ".") {
    diagnostics.push({
      severity: "warning",
      code: "history-db-root",
      message: "HISTORY_DB_PATH points to the project root.",
      hint: "Use .data/play-history.sqlite to keep generated data isolated."
    });
  }

  return diagnostics;
}
