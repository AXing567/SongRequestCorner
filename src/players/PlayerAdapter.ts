import type { PlayerStatus, QueueItem } from "../domain/types.js";

export interface PlayerAdapter {
  getStatus(): Promise<PlayerStatus>;
  play(item: QueueItem): Promise<void>;
  skip(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  clear(): Promise<void>;
}
