import type { PlayerStatus, QueueItem } from "../domain/types.js";
import type { PlayerAdapter } from "./PlayerAdapter.js";
import { formatTrack } from "../utils/format.js";

export class MockPlayerAdapter implements PlayerAdapter {
  private status: PlayerStatus = { state: "idle" };

  async getStatus(): Promise<PlayerStatus> {
    return this.status;
  }

  async play(item: QueueItem): Promise<void> {
    this.status = { state: "playing", current: item };
    console.log(`[mock-player] playing ${formatTrack(item.track)}`);
  }

  async skip(): Promise<void> {
    this.status = { state: "idle" };
    console.log("[mock-player] skipped");
  }

  async pause(): Promise<void> {
    if (this.status.state === "playing") {
      this.status = { ...this.status, state: "paused" };
    }
  }

  async resume(): Promise<void> {
    if (this.status.state === "paused") {
      this.status = { ...this.status, state: "playing" };
    }
  }

  async clear(): Promise<void> {
    this.status = { state: "idle" };
  }
}
