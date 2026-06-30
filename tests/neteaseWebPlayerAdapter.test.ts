import { describe, expect, it } from "vitest";
import {
  NETEASE_SONG_PAGE_PLAY_SELECTORS,
  neteaseSongIdFromUrl,
  neteaseUrlContainsSongId,
  neteaseTextContainsTrackTitle
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

describe("NetEase song URL helpers", () => {
  it("extracts song ids from NetEase hash URLs", () => {
    expect(neteaseSongIdFromUrl("https://music.163.com/#/song?id=145962")).toBe("145962");
  });

  it("matches the active page URL by song id", () => {
    expect(neteaseUrlContainsSongId("https://music.163.com/#/song?id=145962", "145962")).toBe(true);
    expect(neteaseUrlContainsSongId("https://music.163.com/#/song?id=1", "145962")).toBe(false);
  });
});
