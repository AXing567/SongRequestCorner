import { describe, expect, it } from "vitest";
import { scoreTrack } from "../src/providers/NeteaseSearchProvider.js";

describe("scoreTrack", () => {
  it("prefers exact title and artist matches over same-artist unrelated songs", () => {
    const query = "冬天里的秘密 周传雄";

    const requested = scoreTrack({ title: "冬天的秘密", artist: "周传雄" }, query);
    const unrelated = scoreTrack({ title: "黄昏", artist: "周传雄" }, query);

    expect(requested).toBeGreaterThan(unrelated);
  });

  it("handles separator noise in artist names", () => {
    const query = "晴天 周杰伦";

    const score = scoreTrack({ title: "晴天", artist: "周杰伦 / A-LNK" }, query);

    expect(score).toBeGreaterThan(100);
  });
});
