import type { Track } from "../domain/types.js";
import type { MusicProvider, SongSearchRequest } from "./MusicProvider.js";

export class MockMusicProvider implements MusicProvider {
  async search(request: SongSearchRequest): Promise<Track[]> {
    const query = request.query.trim();
    if (!query || query.includes("找不到")) {
      return [];
    }

    const parts = query.split(/\s+/u).filter(Boolean);
    const title = parts[0] ?? query;
    const artist = parts.slice(1).join(" ") || "未知歌手";

    return [
      {
        id: `mock:${query}`,
        title,
        artist,
        durationMs: 180_000,
        source: "mock",
        sourceUrl: undefined
      }
    ];
  }
}
