import type { Track } from "../domain/types.js";
import type { MusicProvider, SongSearchRequest } from "./MusicProvider.js";

interface NeteaseSong {
  id: number;
  name: string;
  duration?: number;
  artists?: Array<{ name: string }>;
  ar?: Array<{ name: string }>;
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSong[];
  };
}

interface RankedSong {
  track: Track;
  score: number;
}

export class NeteaseSearchProvider implements MusicProvider {
  async search(request: SongSearchRequest): Promise<Track[]> {
    const params = new URLSearchParams({
      s: request.query,
      type: "1",
      offset: "0",
      limit: "10"
    });

    const response = await fetch("https://music.163.com/api/search/get/web", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        referer: "https://music.163.com/"
      },
      body: params
    });

    if (!response.ok) {
      throw new Error(`NetEase search failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as NeteaseSearchResponse;
    return (data.result?.songs ?? [])
      .map((song) => toRankedTrack(song, request.query))
      .sort((a, b) => b.score - a.score)
      .map((ranked) => ranked.track);
  }
}

function toRankedTrack(song: NeteaseSong, query: string): RankedSong {
  const artists = song.artists ?? song.ar ?? [];
  const artist = artists.map((item) => item.name).filter(Boolean).join(" / ") || "Unknown artist";
  const track: Track = {
    id: String(song.id),
    title: song.name,
    artist,
    durationMs: song.duration,
    source: "netease",
    sourceUrl: `https://music.163.com/#/song?id=${song.id}`,
    raw: song
  };

  return {
    track,
    score: scoreTrack(track, query)
  };
}

export function scoreTrack(track: Pick<Track, "title" | "artist">, query: string): number {
  const normalizedTitle = normalizeSearchText(track.title);
  const normalizedArtist = normalizeSearchText(track.artist);
  const tokens = tokenizeQuery(query);

  let score = 0;
  for (const token of tokens) {
    if (normalizedTitle === token) {
      score += 80;
    } else if (normalizedTitle.includes(token)) {
      score += 35;
    } else {
      score += Math.round(45 * similarity(normalizedTitle, token));
    }

    if (normalizedArtist === token) {
      score += 60;
    } else if (normalizedArtist.includes(token)) {
      score += 28;
    }
  }

  const titleToken = tokens[0];
  if (titleToken && normalizedTitle === titleToken) {
    score += 40;
  }

  return score;
}

function similarity(left: string, right: string): number {
  if (!left || !right) {
    return 0;
  }

  const distance = levenshtein(left, right);
  const maxLength = Math.max(left.length, right.length);
  return 1 - distance / maxLength;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + cost
      );
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length]!;
}

function tokenizeQuery(query: string): string[] {
  return query
    .split(/\s+/u)
    .map(normalizeSearchText)
    .filter(Boolean);
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/gu, "")
    .replace(/[《》"'“”‘’\-_/|（）()【】\[\]:：,，.。]/gu, "");
}
