import { describe, expect, it } from "vitest";
import type { QueueItem } from "../src/domain/types.js";
import {
  NETEASE_SONG_PAGE_PLAY_SELECTORS,
  NeteaseWebPlayerAdapter,
  mergeNeteaseLoginSurfaceSnapshots,
  neteaseBottomPlayerControlLooksPlaying,
  neteaseSnapshotHasLoginDialog,
  neteaseSongIdFromUrl,
  neteaseUrlContainsSongId,
  neteaseTextContainsTrackTitle,
  resolveNeteaseLoginSurface
} from "../src/players/NeteaseWebPlayerAdapter.js";

describe("NETEASE_SONG_PAGE_PLAY_SELECTORS", () => {
  it("targets only the song-page button area", () => {
    expect(NETEASE_SONG_PAGE_PLAY_SELECTORS.every((selector) => selector.includes(".m-info .btns"))).toBe(
      true
    );
  });

  it("does not use broad text selectors that can hit the external-player link", () => {
    expect(NETEASE_SONG_PAGE_PLAY_SELECTORS.some((selector) => selector.includes("has-text"))).toBe(false);
    expect(NETEASE_SONG_PAGE_PLAY_SELECTORS.some((selector) => selector.includes("text="))).toBe(false);
  });
});

describe("neteaseTextContainsTrackTitle", () => {
  it("matches the target song title in noisy player text", () => {
    expect(neteaseTextContainsTrackTitle("周杰伦 - 晴天 03:21", { title: "晴天" })).toBe(true);
  });

  it("does not treat a playing old song as target playback", () => {
    expect(neteaseTextContainsTrackTitle("周杰伦 - 七里香 02:10", { title: "晴天" })).toBe(false);
  });

  it("normalizes punctuation from NetEase UI text", () => {
    expect(neteaseTextContainsTrackTitle("《冬天的秘密》 - 周传雄", { title: "冬天的秘密" })).toBe(true);
  });
});

describe("neteaseBottomPlayerControlLooksPlaying", () => {
  it("detects common NetEase playing-state class names and labels", () => {
    expect(neteaseBottomPlayerControlLooksPlaying("ply pas")).toBe(true);
    expect(neteaseBottomPlayerControlLooksPlaying("btnc-ply pause")).toBe(true);
    expect(neteaseBottomPlayerControlLooksPlaying("title 暂停")).toBe(true);
  });

  it("does not treat idle play controls as already playing", () => {
    expect(neteaseBottomPlayerControlLooksPlaying("ply play 播放")).toBe(false);
  });
});

describe("resolveNeteaseLoginSurface", () => {
  it("detects logged-in profile candidates and returns the account name", () => {
    expect(
      resolveNeteaseLoginSurface({
        profileCandidateCount: 1,
        profileTexts: ["Alice 个人主页 设置 退出"],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: []
      })
    ).toEqual({ state: "logged_in", accountName: "Alice" });
  });

  it("prefers a visible profile candidate over stale login text", () => {
    expect(
      resolveNeteaseLoginSurface({
        profileCandidateCount: 1,
        profileTexts: ["Alice"],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: ["登录"]
      })
    ).toEqual({ state: "logged_in", accountName: "Alice" });
  });

  it("does not treat a generic login entry as a lost session", () => {
    expect(
      resolveNeteaseLoginSurface({
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: ["发现音乐", "我的音乐", "登录"]
      })
    ).toEqual({ state: "unknown" });
  });

  it("detects the explicit NetEase QR login modal", () => {
    expect(
      resolveNeteaseLoginSurface({
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录 登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      })
    ).toEqual({ state: "login_required" });
  });

  it("merges login surface snapshots from page frames", () => {
    const snapshot = mergeNeteaseLoginSurfaceSnapshots([
      {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: []
      },
      {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["扫码登录"],
        loginTexts: ["login"]
      }
    ]);

    expect(resolveNeteaseLoginSurface(snapshot)).toEqual({ state: "login_required" });
  });
});

describe("neteaseSnapshotHasLoginDialog", () => {
  it("only reports a login dialog when an explicit login modal is visible", () => {
    expect(
      neteaseSnapshotHasLoginDialog({
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: ["鐧诲綍"]
      })
    ).toBe(false);

    expect(
      neteaseSnapshotHasLoginDialog({
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["鎵爜鐧诲綍"],
        loginTexts: []
      })
    ).toBe(true);
  });
});

describe("NeteaseWebPlayerAdapter pause control", () => {
  it("uses a DOM fallback when the normal locator click cannot reach the bottom-player toggle", async () => {
    const page = new FakePage({ domToggleSucceeds: true });
    const adapter = adapterWithPage(page);

    await adapter.pause();

    expect(adapterInternals(adapter).paused).toBe(true);
    expect(page.domToggleAttempts).toBe(1);
  });

  it("does not mark playback as paused when no pause control can be triggered", async () => {
    const adapter = adapterWithPage(new FakePage({ domToggleSucceeds: false }));

    await expect(adapter.pause()).rejects.toThrow("Could not pause the NetEase web player");

    expect(adapterInternals(adapter).paused).toBe(false);
  });
});

describe("NeteaseWebPlayerAdapter clear control", () => {
  it("does not press the global media key when safely stopping old playback", async () => {
    const page = new FakePage({ domToggleSucceeds: false });
    const adapter = adapterWithPage(page);

    await adapter.clear();

    expect(page.keyboardPresses).toEqual([]);
  });
});

describe("NeteaseWebPlayerAdapter login QR detection", () => {
  it("reuses the persistent NetEase login cookie after a restart", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      loginEntryClicksBeforeSuccess: 1,
      dialogScreenshot: Buffer.from("dialog")
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;
    adapterInternals(adapter).context = new FakeBrowserContext(undefined, [
      { name: "MUSIC_U", value: "persisted-session" }
    ]);

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("logged_in");
    expect(page.loginEntryClicks).toBe(0);
    expect(page.loginDialogCloseClicks).toBe(0);
  });

  it("closes a stale NetEase login dialog when the persistent login cookie is still valid", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      surfaceSnapshot: {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      }
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;
    adapterInternals(adapter).context = new FakeBrowserContext(undefined, [
      { name: "MUSIC_U", value: "persisted-session" }
    ]);

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("logged_in");
    expect(page.loginDialogCloseClicks).toBe(1);
  });

  it("closes a stale NetEase login dialog when the page avatar is already visible", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      surfaceSnapshot: {
        profileCandidateCount: 1,
        profileTexts: ["Alice 个人主页"],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      }
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;

    const status = await adapter.getLoginStatus();

    expect(status).toEqual({ state: "logged_in", accountName: "Alice" });
    expect(page.loginDialogCloseClicks).toBe(1);
  });

  it("does not open a login QR when the page login state is unknown", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      loginEntryClicksBeforeSuccess: 1,
      dialogScreenshot: Buffer.from("dialog")
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("unknown");
    expect(page.loginEntryClicks).toBe(0);
  });

  it("ignores broad non-modal QR candidates when the login state is unknown", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      qrScreenshot: Buffer.from("qr")
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("unknown");
    expect(status.qrCode).toBeUndefined();
  });

  it("falls back to sending the login dialog screenshot when no QR candidate is found", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      surfaceSnapshot: {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      },
      loginEntryClicksBeforeSuccess: 1,
      dialogScreenshot: Buffer.from("dialog")
    });
    const adapter = adapterWithPage(page);
    adapterInternals(adapter).current = undefined;

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("login_required");
    expect(status.qrCode?.data.toString()).toBe("dialog");
    expect(page.loginEntryClicks).toBe(0);
  });

  it("opens the login QR in a temporary page when a browser context is available", async () => {
    const mainPage = new FakePage({
      domToggleSucceeds: false,
      surfaceSnapshot: {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      },
      loginEntryClicksBeforeSuccess: 1,
      dialogScreenshot: Buffer.from("main-dialog")
    });
    const loginPage = new FakePage({
      domToggleSucceeds: false,
      surfaceSnapshot: {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 1,
        loginModalTexts: ["登录获取更懂你的好音乐 扫码登录"],
        loginTexts: ["登录"]
      },
      loginEntryClicksBeforeSuccess: 1,
      dialogScreenshot: Buffer.from("isolated-dialog")
    });
    const adapter = adapterWithPage(mainPage);
    adapterInternals(adapter).current = undefined;
    adapterInternals(adapter).context = new FakeBrowserContext(loginPage);

    const status = await adapter.getLoginStatus();

    expect(status.state).toBe("login_required");
    expect(status.qrCode?.data.toString()).toBe("isolated-dialog");
    expect(mainPage.loginEntryClicks).toBe(0);
    expect(loginPage.gotoCalls).toBe(1);
    expect(loginPage.loginEntryClicks).toBe(0);
    expect(loginPage.closed).toBe(true);
  });
});

describe("NeteaseWebPlayerAdapter browser launch", () => {
  it("warms up the persistent page without opening the login QR flow", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      loginEntryClicksBeforeSuccess: 1
    });
    let launchCalls = 0;
    const adapter = new NeteaseWebPlayerAdapter({
      userDataDir: "profile",
      headless: true,
      playwright: {
        chromium: {
          launchPersistentContext: async () => {
            launchCalls += 1;
            return new FakeBrowserContext(page, [{ name: "MUSIC_U", value: "persisted-session" }]);
          }
        }
      }
    } as any);

    await adapter.warmUp();

    expect(launchCalls).toBe(1);
    expect(page.gotoCalls).toBe(1);
    expect(page.loginEntryClicks).toBe(0);
  });

  it("coalesces concurrent persistent browser launches for the shared profile", async () => {
    const page = new FakePage({ domToggleSucceeds: false });
    let releaseLaunch!: () => void;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    let launchCalls = 0;
    const adapter = new NeteaseWebPlayerAdapter({
      userDataDir: "profile",
      headless: true,
      playwright: {
        chromium: {
          launchPersistentContext: async () => {
            launchCalls += 1;
            await launchGate;
            return new FakeBrowserContext(page);
          }
        }
      }
    } as any);

    const firstPage = (adapter as any).ensurePage() as Promise<FakePage>;
    const secondPage = (adapter as any).ensurePage() as Promise<FakePage>;
    releaseLaunch();

    await expect(Promise.all([firstPage, secondPage])).resolves.toEqual([page, page]);
    expect(launchCalls).toBe(1);
    expect(page.gotoCalls).toBe(1);
  });

  it("turns Chrome profile lock failures into a clear retryable error", async () => {
    const page = new FakePage({ domToggleSucceeds: false });
    let launchShouldFail = true;
    let launchCalls = 0;
    const adapter = new NeteaseWebPlayerAdapter({
      userDataDir: "C:\\music\\netease-profile",
      headless: true,
      playwright: {
        chromium: {
          launchPersistentContext: async () => {
            launchCalls += 1;
            if (launchShouldFail) {
              throw new Error(
                "browserType.launchPersistentContext: Target page, context or browser has been closed\n[pid][out] 正在现有的浏览器会话中打开。\n--user-data-dir=C:\\music\\netease-profile"
              );
            }

            return new FakeBrowserContext(page);
          }
        }
      }
    } as any);

    await expect((adapter as any).ensurePage()).rejects.toThrow("浏览器配置目录正在被另一个 Chrome 会话占用");

    launchShouldFail = false;
    await expect((adapter as any).ensurePage()).resolves.toBe(page);
    expect(launchCalls).toBe(2);
  });
});

describe("NeteaseWebPlayerAdapter fast song routing", () => {
  it("routes song pages through the existing NetEase iframe without a full-page goto", async () => {
    const page = new FakePage({
      domToggleSucceeds: false,
      routeInPlaceSucceeds: true
    });
    const adapter = adapterWithPage(page);
    const item = queueItem("song-123", "Fast Route", "Tester");

    await (adapter as any).navigateToSongPage(page, item);

    expect(page.gotoCalls).toBe(0);
    expect(page.routeInPlaceCalls).toBe(1);
    expect(page.url()).toBe("https://music.163.com/#/song?id=123");
    expect(page.frameUrl).toBe("https://music.163.com/song?id=123");
  });
});

describe("NeteaseWebPlayerAdapter lifecycle", () => {
  it("closes the persistent browser context so the profile can flush to disk", async () => {
    const adapter = adapterWithPage(new FakePage({ domToggleSucceeds: false }));
    const context = new FakeBrowserContext();
    adapterInternals(adapter).context = context;

    await adapter.dispose();

    expect(context.closed).toBe(true);
    expect(adapterInternals(adapter).page).toBeUndefined();
    expect(adapterInternals(adapter).current).toBeUndefined();
  });
});

describe("NetEase song URL helpers", () => {
  it("extracts song ids from NetEase hash URLs", () => {
    expect(neteaseSongIdFromUrl("https://music.163.com/#/song?id=145962")).toBe("145962");
  });

  it("matches the active page URL by song id", () => {
    expect(neteaseUrlContainsSongId("https://music.163.com/#/song?id=145962", "145962")).toBe(true);
    expect(neteaseUrlContainsSongId("https://music.163.com/#/song?id=1", "145962")).toBe(false);
  });
});

class FakePage {
  domToggleAttempts = 0;
  loginEntryClicks = 0;
  loginDialogCloseClicks = 0;
  gotoCalls = 0;
  routeInPlaceCalls = 0;
  currentUrl = "https://music.163.com/";
  frameUrl = "https://music.163.com/";
  keyboardPresses: string[] = [];
  closed = false;
  keyboard = {
    press: async (key: string) => {
      this.keyboardPresses.push(key);
    }
  };

  constructor(
    private readonly options: {
      domToggleSucceeds: boolean;
      mediaPauseSucceeds?: boolean;
      qrScreenshot?: Buffer;
      dialogScreenshot?: Buffer;
      loginEntryClicksBeforeSuccess?: number;
      routeInPlaceSucceeds?: boolean;
      surfaceSnapshot?: {
        profileCandidateCount: number;
        profileTexts: string[];
        loginModalCandidateCount: number;
        loginModalTexts: string[];
        loginTexts: string[];
      };
    }
  ) {}

  frames(): FakePage[] {
    return [];
  }

  locator(selector: string): FakeLocator {
    if (selector === "iframe#g_iframe") {
      return new FakeLocator(() => "", {
        evaluate: (_callback, targetSongId?: string) => {
          if (targetSongId) {
            this.frameUrl = `https://music.163.com/song?id=${targetSongId}`;
          }
          return undefined;
        }
      });
    }

    if (selector === "#g_player") {
      return new FakeLocator(() => {
        this.domToggleAttempts += 1;
        return this.options.domToggleSucceeds;
      });
    }

    if (
      selector.includes("zcls") ||
      selector.includes("关闭") ||
      selector.includes("has-text('×')") ||
      selector.includes('has-text("×")')
    ) {
      return new FakeLocator(() => "", {
        click: () => {
          this.loginDialogCloseClicks += 1;
          return true;
        }
      });
    }

    if (
      selector.includes("mrc-modal-container") ||
      selector.includes("page_web_register_login") ||
      selector.includes("mod_web_qr_code_login")
    ) {
      const isQrImageSelector =
        selector.includes(" img") || selector.includes("canvas") || selector.includes("._2SF8rF8D");
      return new FakeLocator(() => "", {
        screenshot: isQrImageSelector ? this.options.qrScreenshot : this.options.dialogScreenshot,
        width: isQrImageSelector ? 88 : 180,
        height: isQrImageSelector ? 88 : 180
      });
    }

    if (selector.includes("has-text")) {
      return new FakeLocator(() => "", {
        click: () => {
          this.loginEntryClicks += 1;
          return this.loginEntryClicks <= (this.options.loginEntryClicksBeforeSuccess ?? 0);
        }
      });
    }

    if (selector.includes("qr") || selector.includes("QRCode") || selector.includes("unikey")) {
      return new FakeLocator(() => "", {
        screenshot: this.options.qrScreenshot,
        width: 88,
        height: 88
      });
    }

    return new FakeLocator(() => "");
  }

  url(): string {
    return this.currentUrl;
  }

  async evaluate(callback?: () => unknown, targetSongId?: string): Promise<boolean | unknown> {
    const source = callback?.toString() ?? "";
    if (source.includes("profileCandidateCount")) {
      return this.options.surfaceSnapshot ?? {
        profileCandidateCount: 0,
        profileTexts: [],
        loginModalCandidateCount: 0,
        loginModalTexts: [],
        loginTexts: []
      };
    }

    if (source.includes("#g_player")) {
      if (source.includes("target.click")) {
        this.domToggleAttempts += 1;
        return this.options.domToggleSucceeds;
      }

      return "";
    }

    if (source.includes("iframe#g_iframe") && source.includes("window.location.hash")) {
      this.routeInPlaceCalls += 1;
      if (!this.options.routeInPlaceSucceeds || !targetSongId) {
        return false;
      }

      this.currentUrl = `https://music.163.com/#/song?id=${targetSongId}`;
      this.frameUrl = `https://music.163.com/song?id=${targetSongId}`;
      return true;
    }

    if (source.includes("iframe#g_iframe")) {
      if (targetSongId) {
        this.frameUrl = `https://music.163.com/song?id=${targetSongId}`;
      }
      return undefined;
    }

    return this.options.mediaPauseSucceeds ?? false;
  }

  async waitForTimeout(): Promise<void> {}

  async goto(url?: string): Promise<void> {
    this.gotoCalls += 1;
    if (url) {
      this.currentUrl = url;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeLocator {
  constructor(
    private readonly evaluateResult: () => unknown,
    private readonly options: {
      click?: () => boolean;
      screenshot?: Buffer;
      width?: number;
      height?: number;
      evaluate?: (callback?: (...args: any[]) => unknown, ...args: any[]) => unknown;
    } = {}
  ) {}

  first(): FakeLocator {
    return this;
  }

  async waitFor(): Promise<void> {
    if (!this.options.screenshot && !this.options.click) {
      throw new Error("not visible");
    }
  }

  async scrollIntoViewIfNeeded(): Promise<void> {}

  async click(): Promise<void> {
    if (this.options.click && !this.options.click()) {
      throw new Error("click failed");
    }
  }

  async getAttribute(): Promise<string> {
    return "";
  }

  async evaluate(callback?: (...args: any[]) => unknown, ...args: any[]): Promise<unknown> {
    if (this.options.evaluate) {
      return this.options.evaluate(callback, ...args);
    }

    return this.evaluateResult();
  }

  async textContent(): Promise<string> {
    return "";
  }

  async boundingBox(): Promise<{ width: number; height: number } | undefined> {
    if (!this.options.screenshot) {
      return undefined;
    }

    return {
      width: this.options.width ?? 100,
      height: this.options.height ?? 100
    };
  }

  async screenshot(): Promise<Buffer> {
    if (!this.options.screenshot) {
      throw new Error("missing screenshot");
    }

    return this.options.screenshot;
  }
}

class FakeBrowserContext {
  closed = false;

  constructor(
    private readonly nextPage?: FakePage,
    private readonly storedCookies: Array<{ name: string; value: string }> = []
  ) {}

  async close(): Promise<void> {
    this.closed = true;
  }

  pages(): FakePage[] {
    return this.nextPage ? [this.nextPage] : [];
  }

  async newPage(): Promise<FakePage> {
    return this.nextPage ?? new FakePage({ domToggleSucceeds: false });
  }

  async cookies(): Promise<Array<{ name: string; value: string }>> {
    return this.storedCookies;
  }
}

function queueItem(id: string, title: string, artist: string): QueueItem {
  return {
    id: `queue-${id}`,
    track: {
      id,
      title,
      artist,
      source: "netease",
      sourceUrl: `https://music.163.com/#/song?id=${id.replace(/\D/gu, "")}`
    },
    requester: { id: "u1", role: "employee" },
    requestedAt: new Date()
  };
}

function adapterWithPage(page: FakePage): NeteaseWebPlayerAdapter {
  const adapter = new NeteaseWebPlayerAdapter({ userDataDir: "", headless: true });
  const internals = adapterInternals(adapter);
  internals.page = page;
  internals.current = {
    id: "queue-1",
    track: { id: "track-1", title: "晴天", artist: "周杰伦", source: "netease" },
    requester: { id: "u1", role: "employee" },
    requestedAt: new Date()
  };
  internals.paused = false;
  return adapter;
}

function adapterInternals(adapter: NeteaseWebPlayerAdapter): {
  page?: FakePage;
  context?: FakeBrowserContext;
  current?: QueueItem;
  paused: boolean;
} {
  return adapter as unknown as {
    page?: FakePage;
    context?: FakeBrowserContext;
    current?: QueueItem;
    paused: boolean;
  };
}
