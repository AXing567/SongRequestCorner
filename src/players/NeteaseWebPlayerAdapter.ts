import type { PlayerStatus, QueueItem, Track } from "../domain/types.js";
import type { LoginAwarePlayerAdapter, PlayerLoginQrCode, PlayerLoginStatus } from "./PlayerAdapter.js";

interface NeteaseWebPlayerOptions {
  userDataDir: string;
  headless: boolean;
  executablePath?: string;
  playwright?: any;
}

type PageLike = any;
type LocatorLike = any;

export interface NeteaseLoginSurfaceSnapshot {
  profileCandidateCount: number;
  profileTexts: string[];
  loginModalCandidateCount: number;
  loginModalTexts: string[];
  loginTexts: string[];
}

export interface NeteaseLoginSurface {
  state: "unknown" | "logged_in" | "login_required";
  accountName?: string;
}

export const NETEASE_SONG_PAGE_PLAY_SELECTORS = [
  "frame:iframe#g_iframe|.m-info .btns a.u-btni-addply",
  "frame:iframe#g_iframe|.m-info .btns a[title='播放']",
  ".m-info .btns a.u-btni-addply",
  ".m-info .btns a[title='播放']"
] as const;

const SONG_PAGE_READY_SELECTORS = [
  "frame:iframe#g_iframe|.m-info",
  ".m-info"
] as const;

const BOTTOM_PLAYER_TOGGLE_SELECTORS = [
  "#g_player .ply",
  "#g_player a.ply",
  "#g_player .btnc-ply",
  ".btnc-ply"
] as const;

const LOGIN_QR_SELECTORS = [
  ".mrc-modal-container[role='dialog'] [data-log*='mod_web_qr_code_login'] img[src^='data:image']",
  ".mrc-modal-container[role='dialog'] [data-log*='mod_web_qr_code_login'] img",
  ".mrc-modal-container[role='dialog'] ._2SF8rF8D img[src^='data:image']",
  ".mrc-modal-container[role='dialog'] ._2SF8rF8D img",
  ".mrc-modal-container[role='dialog'] canvas",
  ".m-layer:has-text('登录获取更懂你的好音乐') img[src^='data:image']",
  ".m-layer:has-text('登录获取更懂你的好音乐') canvas",
  "[data-log*='mod_web_qr_code_login'] img[src^='data:image']",
  "[data-log*='mod_web_qr_code_login'] img",
  "[data-log*='mod_web_qr_code_login'] canvas"
] as const;

const LOGIN_DIALOG_SELECTORS = [
  ".mrc-modal-container[role='dialog']:has-text('登录获取更懂你的好音乐')",
  ".mrc-modal-container[role='dialog']:has-text('扫码登录')",
  ".m-layer:has-text('登录获取更懂你的好音乐')",
  ".m-layer:has-text('扫码登录')",
  "[data-log*='page_web_register_login']",
  "[data-log*='mod_web_qr_code_login']"
] as const;

const LOGIN_DIALOG_CLOSE_SELECTORS = [
  ".mrc-modal-container[role='dialog'] [aria-label*='关闭']",
  ".mrc-modal-container[role='dialog'] [title*='关闭']",
  ".mrc-modal-container[role='dialog'] button:has-text('×')",
  ".mrc-modal-container[role='dialog'] span:has-text('×')",
  ".m-layer .zcls",
  ".m-layer [title*='关闭']",
  "[role='dialog'] [aria-label*='关闭']",
  "[role='dialog'] [title*='关闭']",
  "[role='dialog'] button:has-text('×')",
  "[role='dialog'] span:has-text('×')"
] as const;

export class NeteaseLoginRequiredError extends Error {
  constructor(message = "网易云登录状态已失效，需要扫码登录后再播放。") {
    super(message);
    this.name = "NeteaseLoginRequiredError";
  }
}

export class NeteaseWebPlayerAdapter implements LoginAwarePlayerAdapter {
  private page?: PageLike;
  private context?: any;
  private pageLaunchInFlight?: Promise<PageLike>;
  private current?: QueueItem;
  private paused = false;

  constructor(private readonly options: NeteaseWebPlayerOptions) {}

  async getLoginStatus(): Promise<PlayerLoginStatus> {
    const page = await this.ensurePage();
    const surface = await this.readLoginSurfaceAfterSettling(page);
    if (surface.state === "logged_in") {
      return { state: "logged_in", accountName: surface.accountName };
    }

    if (surface.state === "unknown") {
      return { state: "unknown" };
    }

    const existingQrCode = await this.screenshotLoginQrCandidate(page);
    if (existingQrCode) {
      return {
        state: "login_required",
        qrCode: existingQrCode,
        reason: "NetEase web session is not logged in."
      };
    }

    const qrCode = await this.openLoginQrCodeInTemporaryPage(page);
    return {
      state: "login_required",
      qrCode,
      reason: "NetEase web session is not logged in."
    };
  }

  async getStatus(): Promise<PlayerStatus> {
    if (!this.page) {
      return { state: "idle", current: this.current };
    }

    if (this.current) {
      const bottomPlayerText = await this.readBottomPlayerText();
      if (bottomPlayerText && !neteaseTextContainsTrackTitle(bottomPlayerText, this.current.track)) {
        this.current = undefined;
        this.paused = false;
        return { state: "playing" };
      }
    }

    return {
      state: this.current ? (this.paused ? "paused" : "playing") : "idle",
      current: this.current
    };
  }

  async play(item: QueueItem): Promise<void> {
    if (!item.track.sourceUrl) {
      throw new Error("Track is missing a NetEase song URL.");
    }

    const page = await this.ensurePage();
    await this.assertLoggedInForPlayback(page);
    this.current = undefined;
    this.paused = false;

    await this.pauseCurrentPagePlayback();
    await page.goto(item.track.sourceUrl, { waitUntil: "domcontentloaded" });
    await this.ensureSongFrameRoute(page, item);
    await this.waitForSongPageReady(page, item);

    const clicked = await this.clickSongPagePlay(page);
    if (!clicked) {
      throw new Error("Could not find the NetEase song page play button.");
    }
    console.log(`[netease-web] clicked play for ${item.track.artist} - ${item.track.title}`);

    await this.waitForPlaybackSignal(page, item, async () => {
      await this.clickSongPagePlay(page);
    });
    console.log(`[netease-web] playback detected for ${item.track.artist} - ${item.track.title}`);
    this.current = item;
  }

  async skip(): Promise<void> {
    if (!this.page) {
      this.current = undefined;
      return;
    }

    const clicked = await this.clickNextTrack();
    if (!clicked) {
      throw new Error("Could not click NetEase next-track control.");
    }

    this.current = undefined;
    this.paused = false;
  }

  async pause(): Promise<void> {
    if (!this.page || !this.current || this.paused) {
      return;
    }

    const paused = await this.pauseCurrentPagePlayback({ forceToggle: true });
    if (!paused) {
      throw new Error("Could not pause the NetEase web player. Confirm the bottom player controls are visible.");
    }

    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.page || !this.current || !this.paused) {
      return;
    }

    const resumed = (await this.clickBottomPlaybackToggle()) || (await this.resumeHtmlMediaElements());
    if (!resumed) {
      throw new Error("Could not resume the NetEase web player. Confirm the bottom player controls are visible.");
    }

    this.paused = false;
  }

  async clear(): Promise<void> {
    if (this.page) {
      await this.pauseCurrentPagePlayback();
    }

    this.current = undefined;
    this.paused = false;
  }

  async dispose(): Promise<void> {
    const context = this.context;
    this.page = undefined;
    this.context = undefined;
    this.current = undefined;
    this.paused = false;

    if (!context) {
      return;
    }

    try {
      await context.close();
    } catch (error) {
      console.warn(`[netease-web] failed to close browser context cleanly: ${errorMessage(error)}`);
    }
  }

  private async ensurePage(): Promise<PageLike> {
    if (this.page && !this.page.isClosed?.()) {
      return this.page;
    }

    this.page = undefined;
    if (this.pageLaunchInFlight) {
      return this.pageLaunchInFlight;
    }

    this.pageLaunchInFlight = this.launchPersistentPage().finally(() => {
      this.pageLaunchInFlight = undefined;
    });
    return this.pageLaunchInFlight;
  }

  private async launchPersistentPage(): Promise<PageLike> {
    let context: any;
    try {
      const playwright = this.options.playwright ?? (await importOptionalPlaywright());
      context = await playwright.chromium.launchPersistentContext(this.options.userDataDir, {
        headless: this.options.headless,
        executablePath: this.options.executablePath,
        viewport: { width: 1280, height: 800 },
        args: ["--autoplay-policy=no-user-gesture-required"]
      });
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto("https://music.163.com/", { waitUntil: "domcontentloaded" });
      this.context = context;
      this.page = page;
      return page;
    } catch (error) {
      try {
        await context?.close?.();
      } catch {
        // Ignore cleanup failures while normalizing the original launch error.
      }
      this.context = undefined;
      this.page = undefined;
      throw normalizeNeteaseBrowserLaunchError(error, this.options.userDataDir);
    }
  }

  private async assertLoggedInForPlayback(page: PageLike): Promise<void> {
    const surface = await this.readLoginSurfaceAfterSettling(page);
    if (surface.state === "login_required") {
      throw new NeteaseLoginRequiredError();
    }
  }

  private async readLoginSurface(page: PageLike): Promise<NeteaseLoginSurface> {
    const snapshots = await Promise.all(
      this.locatorSurfaces(page).map((surface) => readNeteaseLoginSurfaceSnapshot(surface))
    );
    const domSurface = resolveNeteaseLoginSurface(mergeNeteaseLoginSurfaceSnapshots(snapshots));
    const cookieSurface = await this.readCookieLoginSurface();

    if (cookieSurface?.state === "logged_in" || domSurface.state === "logged_in") {
      await this.dismissStaleLoginDialog(page);
      if (domSurface.state === "logged_in") {
        return domSurface;
      }

      return cookieSurface ?? { state: "unknown" };
    }

    return domSurface;
  }

  private async readCookieLoginSurface(): Promise<NeteaseLoginSurface | undefined> {
    if (!this.context || typeof this.context.cookies !== "function") {
      return undefined;
    }

    const cookies = await this.context
      .cookies(["https://music.163.com/", "https://interface.music.163.com/"])
      .catch(() => []);
    const musicUserCookie = cookies.find(
      (cookie: { name?: string; value?: string }) => cookie.name === "MUSIC_U" && Boolean(cookie.value)
    );

    return musicUserCookie ? { state: "logged_in" } : undefined;
  }

  private async readLoginSurfaceAfterSettling(page: PageLike): Promise<NeteaseLoginSurface> {
    let latest = await this.readLoginSurface(page);
    if (latest.state === "logged_in") {
      return latest;
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.waitForTimeout(300).catch(() => undefined);
      latest = await this.readLoginSurface(page);
      if (latest.state === "logged_in") {
        return latest;
      }
    }

    return latest;
  }

  private async openLoginQrCode(page: PageLike): Promise<PlayerLoginQrCode | undefined> {
    const surface = await this.readLoginSurfaceAfterSettling(page);
    if (surface.state === "logged_in") {
      return undefined;
    }

    if (surface.state === "unknown") {
      return undefined;
    }

    const existingQrCode = await this.screenshotLoginQrCandidate(page);
    if (existingQrCode) {
      return existingQrCode;
    }

    await this.clickQrLoginTab(page);
    await this.refreshLoginQrCode(page);

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const qrCode = await this.screenshotLoginQrCandidate(page);
      if (qrCode) {
        return qrCode;
      }

      await page.waitForTimeout(250);
    }

    return await this.screenshotLoginDialog(page);
  }

  private async openLoginQrCodeInTemporaryPage(fallbackPage: PageLike): Promise<PlayerLoginQrCode | undefined> {
    if (!this.context || typeof this.context.newPage !== "function") {
      return await this.openLoginQrCode(fallbackPage);
    }

    let loginPage: PageLike | undefined;
    try {
      loginPage = await this.context.newPage();
      await loginPage.goto("https://music.163.com/", { waitUntil: "domcontentloaded" });
      return (await this.openLoginQrCode(loginPage)) ?? (await this.openLoginQrCode(fallbackPage));
    } catch (error) {
      console.warn(`[netease-web] failed to open isolated login page: ${errorMessage(error)}`);
      return await this.openLoginQrCode(fallbackPage);
    } finally {
      await loginPage?.close?.().catch(() => undefined);
    }
  }

  private async clickQrLoginTab(page: PageLike): Promise<void> {
    for (const surface of this.locatorSurfaces(page)) {
      for (const selector of [
        ".mrc-modal-container[role='dialog'] a:has-text('\u626b\u7801')",
        ".mrc-modal-container[role='dialog'] a:has-text('\u4e8c\u7ef4\u7801')",
        ".mrc-modal-container[role='dialog'] button:has-text('\u626b\u7801')",
        ".mrc-modal-container[role='dialog'] button:has-text('\u4e8c\u7ef4\u7801')",
        ".mrc-modal-container[role='dialog'] [role='button']:has-text('\u626b\u7801')",
        ".mrc-modal-container[role='dialog'] [role='button']:has-text('\u4e8c\u7ef4\u7801')",
        "[data-log*='page_web_register_login'] a:has-text('\u626b\u7801')",
        "[data-log*='page_web_register_login'] a:has-text('\u4e8c\u7ef4\u7801')",
        "[data-log*='page_web_register_login'] button:has-text('\u626b\u7801')",
        "[data-log*='page_web_register_login'] button:has-text('\u4e8c\u7ef4\u7801')"
      ]) {
        if (await this.tryClick(surface.locator(selector).first(), 500)) {
          return;
        }
      }
    }
  }

  private async refreshLoginQrCode(page: PageLike): Promise<void> {
    for (const surface of this.locatorSurfaces(page)) {
      for (const selector of [
        ".mrc-modal-container[role='dialog'] a:has-text('\u70b9\u51fb\u5237\u65b0')",
        ".mrc-modal-container[role='dialog'] button:has-text('\u70b9\u51fb\u5237\u65b0')",
        "[data-log*='mod_web_qr_code_login'] a:has-text('\u70b9\u51fb\u5237\u65b0')",
        "[data-log*='mod_web_qr_code_login'] button:has-text('\u70b9\u51fb\u5237\u65b0')"
      ]) {
        if (await this.tryClick(surface.locator(selector).first(), 500)) {
          await page.waitForTimeout(500).catch(() => undefined);
          return;
        }
      }
    }
  }

  private async dismissStaleLoginDialog(page: PageLike): Promise<void> {
    for (const surface of this.locatorSurfaces(page)) {
      if (await this.clickFirst(surface, LOGIN_DIALOG_CLOSE_SELECTORS, false)) {
        await page.waitForTimeout(150).catch(() => undefined);
        return;
      }
    }
  }

  private async screenshotLoginQrCandidate(page: PageLike): Promise<PlayerLoginQrCode | undefined> {
    for (const surface of this.locatorSurfaces(page)) {
      for (const selector of LOGIN_QR_SELECTORS) {
        const locator = surface.locator(selector).first();
        const qrCode = await this.screenshotVisibleLocator(locator, {
          minWidth: 80,
          minHeight: 80,
          filename: "netease-login-qr.png"
        });
        if (qrCode) {
          return qrCode;
        }
      }
    }

    return undefined;
  }

  private async screenshotLoginDialog(page: PageLike): Promise<PlayerLoginQrCode | undefined> {
    for (const surface of this.locatorSurfaces(page)) {
      for (const selector of LOGIN_DIALOG_SELECTORS) {
        const locator = surface.locator(selector).first();
        const image = await this.screenshotVisibleLocator(locator, {
          minWidth: 120,
          minHeight: 120,
          filename: "netease-login-dialog.png"
        });
        if (image) {
          return image;
        }
      }
    }

    return undefined;
  }

  private locatorSurfaces(page: PageLike): PageLike[] {
    const frames = typeof page.frames === "function" ? page.frames() : [];
    return [page, ...frames];
  }

  private async screenshotVisibleLocator(
    locator: LocatorLike,
    options: { minWidth: number; minHeight: number; filename: string }
  ): Promise<PlayerLoginQrCode | undefined> {
    try {
      await locator.waitFor({ state: "visible", timeout: 500 });
      const box = await locator.boundingBox();
      if (!box || box.width < options.minWidth || box.height < options.minHeight) {
        return undefined;
      }

      const data = await locator.screenshot({ type: "png" });
      return { data, mimeType: "image/png", filename: options.filename };
    } catch {
      return undefined;
    }
  }

  private async clickSongPagePlay(page: PageLike): Promise<boolean> {
    return this.clickAny(page, NETEASE_SONG_PAGE_PLAY_SELECTORS);
  }

  private async ensureSongFrameRoute(page: PageLike, item: QueueItem): Promise<void> {
    const songId = neteaseSongIdFromUrl(item.track.sourceUrl);
    if (!songId) {
      return;
    }

    await page
      .locator("iframe#g_iframe")
      .evaluate((iframe: HTMLIFrameElement, targetSongId: string) => {
        const expectedPath = `/song?id=${targetSongId}`;
        if (!iframe.src.includes(expectedPath)) {
          iframe.src = `https://music.163.com${expectedPath}`;
        }
      }, songId)
      .catch(() => undefined);
  }

  private async waitForSongPageReady(page: PageLike, item: QueueItem): Promise<void> {
    const expectedSongId = neteaseSongIdFromUrl(item.track.sourceUrl);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const urlMatches = expectedSongId ? neteaseUrlContainsSongId(page.url?.() ?? "", expectedSongId) : true;

      for (const selector of SONG_PAGE_READY_SELECTORS) {
        const text = await this.readLocatorText(page, selector);
        if (neteaseTextContainsTrackTitle(text, item.track) || (urlMatches && (await this.locatorCanBecomeVisible(page, selector)))) {
          return;
        }
      }

      await page.waitForTimeout(150);
    }

    throw new Error(`NetEase song page did not become playable: ${item.track.artist} - ${item.track.title}`);
  }

  private async waitForPlaybackSignal(
    page: PageLike,
    item: QueueItem,
    retryPlay: () => Promise<void>
  ): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const bottomPlayerText = await this.readBottomPlayerText();
      if (neteaseTextContainsTrackTitle(bottomPlayerText, item.track)) {
        return;
      }

      if (attempt === 6 || attempt === 14 || attempt === 24) {
        await retryPlay();
      }

      await page.waitForTimeout(150);
    }

    const loginSurface = await this.readLoginSurface(page);
    if (loginSurface.state === "login_required") {
      throw new NeteaseLoginRequiredError();
    }

    throw new Error(
      "Clicked the NetEase song-page play button, but the bottom player did not switch to the target song. The track may require the desktop client, VIP rights, or another manual confirmation."
    );
  }

  private async readLocatorText(page: PageLike, selector: string): Promise<string> {
    return await this.locatorFor(page, selector)
      .textContent({ timeout: 150 })
      .catch(() => "");
  }

  private async locatorCanBecomeVisible(page: PageLike, selector: string): Promise<boolean> {
    const locator = this.locatorFor(page, selector);
    try {
      await locator.waitFor({ state: "visible", timeout: 250 });
      return true;
    } catch {
      return false;
    }
  }

  private async clickFirst(page: PageLike, selectors: readonly string[], required = true): Promise<boolean> {
    for (const selector of selectors) {
      try {
        const locator = this.locatorFor(page, selector);
        if (await this.tryClick(locator)) {
          return true;
        }
      } catch {
        // Try the next selector. NetEase web markup changes occasionally.
      }
    }

    if (required) {
      throw new Error("Could not control the NetEase web player. Confirm login and page structure.");
    }

    return false;
  }

  private async clickAny(page: PageLike, selectors: readonly string[]): Promise<boolean> {
    const attempts = selectors.map((selector) => this.tryClick(this.locatorFor(page, selector), 900));
    return (await Promise.all(attempts)).some(Boolean);
  }

  private async pauseCurrentPagePlayback(options: { forceToggle?: boolean } = {}): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    if (await this.pauseHtmlMediaElements()) {
      return true;
    }

    const shouldToggle = options.forceToggle === true || (await this.bottomPlayerLooksPlaying());
    if (shouldToggle && (await this.clickBottomPlaybackToggle())) {
      return true;
    }

    await this.page.keyboard.press("MediaPlayPause").catch(() => undefined);
    return false;
  }

  private async bottomPlayerLooksPlaying(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const controlState = await this.page
      .locator("#g_player .ply, #g_player .btnc-ply, .btnc-ply")
      .first()
      .evaluate((element: Element) =>
        [
          element.getAttribute("class"),
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          element.textContent
        ]
          .filter(Boolean)
          .join(" ")
      )
      .catch(() => "");

    return neteaseBottomPlayerControlLooksPlaying(controlState);
  }

  private async clickBottomPlaybackToggle(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    if (await this.clickFirst(this.page, BOTTOM_PLAYER_TOGGLE_SELECTORS, false)) {
      return true;
    }

    return await this.page
      .locator("#g_player")
      .evaluate((player: Element, selectors: readonly string[]) => {
        const candidates = selectors.flatMap((selector) =>
          Array.from(player.querySelectorAll<HTMLElement>(selector.replace(/^#g_player\s*/u, "")))
        );
        const target =
          candidates.find((candidate) => {
            const style = window.getComputedStyle(candidate);
            const rect = candidate.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          }) ?? candidates[0];

        if (!target) {
          return false;
        }

        target.click();
        return true;
      }, BOTTOM_PLAYER_TOGGLE_SELECTORS)
      .catch(() => false);
  }

  private async pauseHtmlMediaElements(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    return await this.page
      .evaluate(() => {
        const media = Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).filter(
          (element) => !element.paused
        );
        for (const element of media) {
          element.pause();
        }
        return media.length > 0;
      })
      .catch(() => false);
  }

  private async resumeHtmlMediaElements(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    return await this.page
      .evaluate(async () => {
        const media = Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).filter(
          (element) => element.paused
        );
        let resumed = false;
        for (const element of media) {
          try {
            await element.play();
            resumed = true;
          } catch {
            // Keep trying other media elements; browser autoplay rules may reject one of them.
          }
        }
        return resumed;
      })
      .catch(() => false);
  }

  private async clickNextTrack(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const before = await this.readBottomPlayerText();

    for (const selector of ["#g_player .nxt", "#g_player a.nxt", ".btnc-nxt", "a[title='下一首']"]) {
      try {
        const locator = this.locatorFor(this.page, selector);
        if (await this.tryClick(locator, 900)) {
          await this.page.waitForTimeout(800);
          const after = await this.readBottomPlayerText();
          if (!before || !after || before !== after) {
            return true;
          }
        }
      } catch {
        // Try the next strategy.
      }
    }

    const domClicked = await this.page
      .locator("#g_player")
      .evaluate((player: Element) => {
        const candidates = Array.from(
          player.querySelectorAll<HTMLElement>(".nxt, .btnc-nxt, [title='下一首']")
        );
        const target = candidates.find((candidate) => candidate.offsetParent !== null) ?? candidates[0];
        if (!target) {
          return false;
        }
        target.click();
        return true;
      })
      .catch(() => false);

    if (domClicked) {
      return true;
    }

    await this.page.keyboard.press("MediaNextTrack").catch(() => undefined);
    return true;
  }

  private async readBottomPlayerText(): Promise<string> {
    if (!this.page) {
      return "";
    }

    return await this.page
      .locator("#g_player")
      .evaluate((player: Element) => (player.textContent ?? "").trim())
      .catch(() => "");
  }

  private locatorFor(page: PageLike, selector: string): LocatorLike {
    if (selector.startsWith("frame:")) {
      const [frameSelector, innerSelector] = selector.slice("frame:".length).split("|");
      if (!frameSelector || !innerSelector) {
        throw new Error(`Invalid frame selector: ${selector}`);
      }

      return page.frameLocator(frameSelector).locator(innerSelector).first();
    }

    return page.locator(selector).first();
  }

  private async tryClick(locator: LocatorLike, timeoutMs = 1500): Promise<boolean> {
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      await locator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => undefined);
      await locator.click({ timeout: timeoutMs, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function readNeteaseLoginSurfaceSnapshot(surface: PageLike): Promise<NeteaseLoginSurfaceSnapshot> {
  return await surface
    .evaluate((): NeteaseLoginSurfaceSnapshot => {
      const visible = (element: Element): boolean => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const textFor = (element: Element): string =>
        [
          element.textContent,
          element.getAttribute("title"),
          element.getAttribute("aria-label"),
          element.getAttribute("alt")
        ]
          .filter(Boolean)
          .join(" ");
      const dataLogFor = (element: Element): string =>
        [
          element.getAttribute("data-log"),
          ...Array.from(element.querySelectorAll("[data-log]")).map((child) => child.getAttribute("data-log"))
        ]
          .filter(Boolean)
          .join(" ");
      const looksLikeLoginModal = (element: Element): boolean => {
        const text = textFor(element);
        const dataLog = dataLogFor(element);
        return (
          dataLog.includes("page_web_register_login") ||
          dataLog.includes("mod_web_qr_code_login") ||
          (text.includes("登录获取更懂你的好音乐") && text.includes("扫码登录"))
        );
      };

      const profileElements = Array.from(
        document.querySelectorAll(
          [
            "#g-topbar a[href*='user/home']",
            "#g_topbar a[href*='user/home']",
            "#g-topbar .m-tophead .head",
            "#g_topbar .m-tophead .head",
            "#g-topbar .m-tophead img[src]",
            "#g_topbar .m-tophead img[src]",
            ".m-tophead a[href*='user/home']",
            ".m-tophead [href*='user/home']",
            ".m-tophead .name",
            ".m-tophead .nm",
            ".m-tophead .head",
            ".m-tophead img[src]",
            ".m-tophead [class*='avatar']",
            ".m-tophead [class*='Avatar']",
            ".m-tophead img[alt]",
            "a[href*='/user/home?id='] img",
            "a[href*='user/home?id='] img",
            "a[href*='/user/home?id=']",
            "a[href*='user/home?id=']"
          ].join(",")
        )
      ).filter(visible);
      const loginModalElements = Array.from(
        document.querySelectorAll(
          [
            ".mrc-modal-container[role='dialog']",
            ".mrc-modal-appear-done .mrc-modal-container[role='dialog']",
            ".mrc-modal-enter-done .mrc-modal-container[role='dialog']",
            ".m-layer",
            "[data-log*='page_web_register_login']",
            "[data-log*='mod_web_qr_code_login']"
          ].join(",")
        )
      ).filter((element) => visible(element) && looksLikeLoginModal(element));
      const loginElements = Array.from(
        document.querySelectorAll(
          [
            "#g-topbar a",
            "#g_topbar a",
            ".m-tophead a",
            "a.link.s-fc3",
            "a[href*='login']",
            ".m-layer",
            "[class*='login']",
            "[class*='Login']",
            "[class*='qr']",
            "[class*='scan']"
          ].join(",")
        )
      ).filter(visible);

      return {
        profileCandidateCount: profileElements.length,
        profileTexts: profileElements.map(textFor),
        loginModalCandidateCount: loginModalElements.length,
        loginModalTexts: loginModalElements.map(textFor),
        loginTexts: loginElements.map(textFor)
      };
    })
    .catch((): NeteaseLoginSurfaceSnapshot => emptyNeteaseLoginSurfaceSnapshot());
}

function emptyNeteaseLoginSurfaceSnapshot(): NeteaseLoginSurfaceSnapshot {
  return {
    profileCandidateCount: 0,
    profileTexts: [],
    loginModalCandidateCount: 0,
    loginModalTexts: [],
    loginTexts: []
  };
}

export function mergeNeteaseLoginSurfaceSnapshots(
  snapshots: readonly NeteaseLoginSurfaceSnapshot[]
): NeteaseLoginSurfaceSnapshot {
  return {
    profileCandidateCount: snapshots.reduce((count, snapshot) => count + snapshot.profileCandidateCount, 0),
    profileTexts: snapshots.flatMap((snapshot) => snapshot.profileTexts),
    loginModalCandidateCount: snapshots.reduce(
      (count, snapshot) => count + snapshot.loginModalCandidateCount,
      0
    ),
    loginModalTexts: snapshots.flatMap((snapshot) => snapshot.loginModalTexts),
    loginTexts: snapshots.flatMap((snapshot) => snapshot.loginTexts)
  };
}
export function neteaseTextContainsTrackTitle(text: string, track: Pick<Track, "title">): boolean {
  const normalizedText = normalizeNeteaseText(text);
  const normalizedTitle = normalizeNeteaseText(track.title);
  return normalizedTitle.length > 0 && normalizedText.includes(normalizedTitle);
}

export function neteaseBottomPlayerControlLooksPlaying(controlState: string): boolean {
  return /pas|pause|ply-z-slt|暂停/u.test(controlState);
}

export function resolveNeteaseLoginSurface(snapshot: NeteaseLoginSurfaceSnapshot): NeteaseLoginSurface {
  const accountName = snapshot.profileTexts.map(cleanNeteaseAccountName).find(Boolean);
  if (snapshot.profileCandidateCount > 0) {
    return { state: "logged_in", accountName };
  }

  if (
    snapshot.loginModalCandidateCount > 0 ||
    snapshot.loginModalTexts.some(neteaseTextLooksLikeExplicitLoginModal)
  ) {
    return { state: "login_required" };
  }

  return { state: "unknown" };
}

export function isNeteaseLoginRequiredError(error: unknown): boolean {
  return (
    error instanceof NeteaseLoginRequiredError ||
    (error instanceof Error && error.name === "NeteaseLoginRequiredError")
  );
}

export function neteaseSongIdFromUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }

  return /[?&]id=(\d+)/u.exec(url)?.[1];
}

export function neteaseUrlContainsSongId(url: string, songId: string): boolean {
  return neteaseSongIdFromUrl(url) === songId;
}

function normalizeNeteaseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[《》"'“”‘’\-_/|（）()【】\[\]:：,，.。·]/gu, "");
}

function cleanNeteaseAccountName(value: string): string | undefined {
  const cleaned = value
    .replace(/\s+/gu, " ")
    .replace(/退出|设置|消息|我的主页|个人主页|用户中心/gu, " ")
    .trim();

  if (!cleaned || neteaseTextLooksLikeLoginEntry(cleaned)) {
    return undefined;
  }

  return cleaned;
}

function neteaseTextLooksLikeLoginEntry(value: string): boolean {
  return /登录|login/iu.test(value);
}

function neteaseTextLooksLikeExplicitLoginModal(value: string): boolean {
  return (
    value.includes("登录获取更懂你的好音乐") ||
    value.includes("扫码登录") ||
    value.includes("page_web_register_login") ||
    value.includes("mod_web_qr_code_login")
  );
}

function normalizeNeteaseBrowserLaunchError(error: unknown, userDataDir: string): Error {
  const message = errorMessage(error);
  if (neteaseBrowserLaunchLooksProfileLocked(message)) {
    return new Error(
      `无法启动网易云播放浏览器：浏览器配置目录正在被另一个 Chrome 会话占用（${userDataDir}）。请关闭之前由点歌系统打开的网易云 Chrome 窗口，或在任务管理器结束命令行包含 netease-profile 的 chrome.exe 后重试。`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function neteaseBrowserLaunchLooksProfileLocked(message: string): boolean {
  return (
    /launchPersistentContext|Target page, context or browser has been closed|existing browser session|现有的浏览器会话|�������е�������Ự�д�/iu.test(
      message
    ) && /user-data-dir|netease-profile|existing browser session|现有的浏览器会话|�������е�������Ự�д�/iu.test(message)
  );
}

async function importOptionalPlaywright(): Promise<any> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<any>;
    return await dynamicImport("playwright");
  } catch (error) {
    throw new Error(`PLAYER_ADAPTER=netease-web requires playwright. Original error: ${String(error)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
