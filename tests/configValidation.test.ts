import { describe, expect, it } from "vitest";
import type { AppConfig } from "../src/config.js";
import { validateConfig } from "../src/configValidation.js";

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    botTransport: "console",
    musicProvider: "mock",
    playerAdapter: "mock",
    adminUserIds: new Set(["admin"]),
    botDisplayName: "点歌机器人",
    feishu: {},
    netease: {
      userDataDir: ".playwright/netease-profile",
      headless: false
    },
    adminServer: {
      enabled: true,
      host: "0.0.0.0",
      port: 3333
    },
    history: {
      databasePath: ".data/play-history.sqlite"
    },
    ...overrides
  };
}

describe("validateConfig", () => {
  it("accepts the default console mock configuration", () => {
    const result = validateConfig(baseConfig());

    expect(result.errors).toEqual([]);
  });

  it("requires Feishu credentials in Feishu mode", () => {
    const result = validateConfig(baseConfig({ botTransport: "feishu", feishu: {} }));

    expect(result.errors.map((error) => error.code)).toEqual([
      "missing-feishu-app-id",
      "missing-feishu-app-secret"
    ]);
  });

  it("rejects mismatched provider and player modes", () => {
    const result = validateConfig(baseConfig({ musicProvider: "netease-web", playerAdapter: "mock" }));

    expect(result.errors.map((error) => error.code)).toContain("provider-player-mismatch");
  });

  it("warns when the admin page only binds to localhost", () => {
    const result = validateConfig(
      baseConfig({
        adminServer: { enabled: true, host: "127.0.0.1", port: 3333 }
      })
    );

    expect(result.warnings.map((warning) => warning.code)).toContain("admin-localhost-only");
  });
});
