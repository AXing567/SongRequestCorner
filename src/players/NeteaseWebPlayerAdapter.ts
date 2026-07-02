import type { PlayerStatus, QueueItem, Track } from "../domain/types.js";
import type { LoginAwarePlayerAdapter, PlayerLoginQrCode, PlayerLoginStatus } from "./PlayerAdapter.js";

interface NeteaseWebPlayerOptions {
  userDataDir: string;
  headless: boolean;
  executablePath?: string;
}

type PageLike = any;
type LocatorLike = any;

export interface NeteaseLoginSurfaceSnapshot {
  profileCandidateCount: number;
  profileTexts: string[];
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

const LOGIN_ENTRY_SELECTORS = [
  "#g-topbar a:has-text('登录')",
  "#g_topbar a:has-text('登录')",
  ".m-tophead a:has-text('登录')",
  "a.link.s-fc3:has-text('登录')",
  "a:has-text('登录')",
  "button:has-text('登录')",
  "[role='button']:has-text('登录')",
  "[class*='login']:has-text('登录')",
  "[class*='Login']:has-text('登录')"
] as const;

const LOGIN_QR_SELECTORS = [
  ".m-layer img[src*='qr']",
  ".m-layer img[src*='QRCode']",
  ".m-layer img[src*='qrcode']",
  ".m-layer img[src*='unikey']",
  ".m-layer img[src*='login']",
  ".m-layer [class*='qr'] img",
  ".m-layer [class*='QR'] img",
  ".m-layer [class*='code'] img",
  ".m-layer [class*='Code'] img",
  ".m-layer canvas",
  "[class*='login'] img[src*='qr']",
  "[class*='login'] img[src*='qrcode']",
  "[class*='login'] img[src*='QRCode']",
  "[class*='login'] img[src*='unikey']",
  "[class*='login'] [class*='qr'] img",
  "[class*='login'] [class*='code'] img",
  "[class*='login'] canvas",
  "[class*='Login'] img[src*='qr']",
  "[class*='Login'] [class*='qr'] img",
  "[class*='Login'] canvas",
  "[class*='scan'] img",
  "[class*='scan'] canvas",
  "[class*='Scan'] img",
  "[class*='Scan'] canvas",
  "[class*='code'] img",
  "[class*='Code'] img",
  "img[src*='qr']",
  "img[src*='qrcode']",
  "img[src*='QRCode']",
  "img[src*='unikey']",
  "canvas"
] as const;

const LOGIN_DIALOG_SELECTORS = [
  ".m-layer",
  "[class*='login']",
  "[class*='Login']",
  "[class*='qr']",
  "[class*='QR']",
  "[class*='scan']",
  "[class*='Scan']",
  "[class*='code']",
  "[class*='Code']"
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
  private current?: QueueItem;
  private paused = false;

  constructor(private readonly options: NeteaseWebPlayerOptions) {}

  async getLoginStatus(): Promise<PlayerLoginStatus> {
    const page = await this.ensurePage();
    const surface = await this.readLoginSurfaceAfterSettling(page);
    if (surface.state === "logged_in") {
      return { state: "logged_in", accountName: surface.accountName };
    }

    const existingQrCode = await this.screenshotLoginQrCandidate(page);
    if (existingQrCode) {
      return {
        state: "login_required",
        qrCode: existingQrCode,
        reason: "NetEase web session is not logged in."
      };
    }

    if (surface.state === "unknown") {
      return { state: "unknown" };
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
    if (this.page) {
      return this.page;
    }

    const playwright = await importOptionalPlaywright();
    this.context = await playwright.chromium.launchPersistentContext(this.options.userDataDir, {
      headless: this.options.headless,
      executablePath: this.options.executablePath,
      viewport: { width: 1280, height: 800 },
      args: ["--autoplay-policy=no-user-gesture-required"]
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    await this.page.goto("https://music.163.com/", { waitUntil: "domcontentloaded" });
    return this.page;
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

    return resolveNeteaseLoginSurface(mergeNeteaseLoginSurfaceSnapshots(snapshots));
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

    const existingQrCode = await this.screenshotLoginQrCandidate(page);
    if (existingQrCode) {
      return existingQrCode;
    }

    await this.clickLoginEntry(page);
    await page.waitForTimeout(500).catch(() => undefined);
    await this.clickQrLoginTab(page);

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
      return await this.openLoginQrCode(loginPage);
    } catch (error) {
      console.warn(`[netease-web] failed to open isolated login page: ${errorMessage(error)}`);
      return await this.openLoginQrCode(fallbackPage);
    } finally {
      await loginPage?.close?.().catch(() => undefined);
    }
  }

  private async clickLoginEntry(page: PageLike): Promise<void> {
    for (const surface of this.locatorSurfaces(page)) {
      if (await this.clickFirst(surface, LOGIN_ENTRY_SELECTORS, false)) {
        return;
      }

      const clicked = await surface
        .evaluate(() => {
          const visible = (element: HTMLElement): boolean => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
          };
          const candidates = Array.from(document.querySelectorAll<HTMLElement>("#g-topbar a, #g_topbar a, .m-tophead a, a"));
          const target = candidates.find(
            (candidate) => visible(candidate) && /\u767b\u5f55|login/iu.test(candidate.textContent ?? candidate.title ?? "")
          );
          target?.click();
          return Boolean(target);
        })
        .catch(() => false);

      if (clicked) {
        return;
      }
    }
  }

  private async clickQrLoginTab(page: PageLike): Promise<void> {
    for (const surface of this.locatorSurfaces(page)) {
      for (const selector of [
        ".m-layer a:has-text('\u626b\u7801')",
        ".m-layer a:has-text('\u4e8c\u7ef4\u7801')",
        ".m-layer button:has-text('\u626b\u7801')",
        ".m-layer button:has-text('\u4e8c\u7ef4\u7801')",
        ".m-layer [role='button']:has-text('\u626b\u7801')",
        ".m-layer [role='button']:has-text('\u4e8c\u7ef4\u7801')",
        "[class*='login'] a:has-text('\u626b\u7801')",
        "[class*='login'] a:has-text('\u4e8c\u7ef4\u7801')",
        "[class*='login'] button:has-text('\u626b\u7801')",
        "[class*='login'] button:has-text('\u4e8c\u7ef4\u7801')",
        "[class*='login'] [role='button']:has-text('\u626b\u7801')",
        "[class*='login'] [role='button']:has-text('\u4e8c\u7ef4\u7801')"
      ]) {
        if (await this.tryClick(surface.locator(selector).first(), 500)) {
          return;
        }
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
        loginTexts: loginElements.map(textFor)
      };
    })
    .catch((): NeteaseLoginSurfaceSnapshot => emptyNeteaseLoginSurfaceSnapshot());
}

function emptyNeteaseLoginSurfaceSnapshot(): NeteaseLoginSurfaceSnapshot {
  return {
    profileCandidateCount: 0,
    profileTexts: [],
    loginTexts: []
  };
}

export function mergeNeteaseLoginSurfaceSnapshots(
  snapshots: readonly NeteaseLoginSurfaceSnapshot[]
): NeteaseLoginSurfaceSnapshot {
  return {
    profileCandidateCount: snapshots.reduce((count, snapshot) => count + snapshot.profileCandidateCount, 0),
    profileTexts: snapshots.flatMap((snapshot) => snapshot.profileTexts),
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

  if (snapshot.loginTexts.some(neteaseTextLooksLikeLoginEntry)) {
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
