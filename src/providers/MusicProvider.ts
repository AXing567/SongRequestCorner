import type { Track } from "../domain/types.js";

export interface SongSearchRequest {
  query: string;
}

export interface MusicProvider {
  search(request: SongSearchRequest): Promise<Track[]>;
}
