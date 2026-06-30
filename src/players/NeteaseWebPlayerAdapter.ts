import type { PlayerStatus, QueueItem, Track } from "../domain/types.js";
import type { PlayerAdapter } from "./PlayerAdapter.js";

interface NeteaseWebPlayerOptions {
  userDataDir: string;
  headless: boolean;
  executablePath?: string;
}

type PageLike = any;
type LocatorLike = any;

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

export class NeteaseWebPlayerAdapter implements PlayerAdapter {
  private page?: PageLike;
  private context?: any;
  private current?: QueueItem;
  private paused = false;

  constructor(private readonly options: NeteaseWebPlayerOptions) {}

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

    await this.clickFirst(this.page, ["#g_player .ply", ".btnc-ply", "a[title='暂停']"], false);
    this.paused = true;
  }

  async resume(): Promise<void> {
    if (!this.page || !this.current || !this.paused) {
      return;
    }

    await this.clickFirst(this.page, ["#g_player .ply", ".btnc-ply", "a[title='播放']"], false);
    this.paused = false;
  }

  async clear(): Promise<void> {
    if (this.page) {
      await this.pauseCurrentPagePlayback();
    }

    this.current = undefined;
    this.paused = false;
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

  private async clickFirst(page: PageLike, selectors: string[], required = true): Promise<void> {
    for (const selector of selectors) {
      try {
        const locator = this.locatorFor(page, selector);
        if (await this.tryClick(locator)) {
          return;
        }
      } catch {
        // Try the next selector. NetEase web markup changes occasionally.
      }
    }

    if (required) {
      throw new Error("Could not control the NetEase web player. Confirm login and page structure.");
    }
  }

  private async clickAny(page: PageLike, selectors: readonly string[]): Promise<boolean> {
    const attempts = selectors.map((selector) => this.tryClick(this.locatorFor(page, selector), 900));
    return (await Promise.all(attempts)).some(Boolean);
  }

  private async pauseCurrentPagePlayback(): Promise<void> {
    if (!this.page) {
      return;
    }

    const playButtonClass = await this.page
      .locator("#g_player .ply, .btnc-ply")
      .first()
      .getAttribute("class", { timeout: 350 })
      .catch(() => "");

    if (playButtonClass && /pas|pause|ply-z-slt/u.test(playButtonClass)) {
      await this.clickFirst(this.page, ["#g_player .ply", ".btnc-ply", "a[title='暂停']"], false);
      return;
    }

    await this.page.keyboard.press("MediaPlayPause").catch(() => undefined);
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

export function neteaseTextContainsTrackTitle(text: string, track: Pick<Track, "title">): boolean {
  const normalizedText = normalizeNeteaseText(text);
  const normalizedTitle = normalizeNeteaseText(track.title);
  return normalizedTitle.length > 0 && normalizedText.includes(normalizedTitle);
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
