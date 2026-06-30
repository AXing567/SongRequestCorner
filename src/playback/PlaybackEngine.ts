import type { PlayerStatus, QueueItem } from "../domain/types.js";
import type { PlayerAdapter } from "../players/PlayerAdapter.js";
import type { QueueService } from "../queue/QueueService.js";

const DEFAULT_TRACK_DURATION_MS = 180_000;
const PLAYER_STATUS_SYNC_INTERVAL_MS = 2_000;

export interface PlaybackEngineEvents {
  onTrackStarted?: (item: QueueItem) => void | Promise<void>;
  onQueueDepleted?: () => void | Promise<void>;
}

export interface PlaybackOperationOptions {
  expectedRevision?: number;
}

export interface PlaybackOperationResult<T> {
  ok: boolean;
  ignored?: boolean;
  reason?: "stale_state";
  revision: number;
  result?: T;
}

export class PlaybackEngine {
  private timer?: NodeJS.Timeout;
  private statusSyncTimer?: NodeJS.Timeout;
  private remainingMs = 0;
  private timerStartedAt = 0;
  private paused = false;
  private operationQueue: Promise<unknown> = Promise.resolve();
  private busy = false;
  private revision = 0;
  private switching = false;

  constructor(
    private readonly queue: QueueService,
    private readonly player: PlayerAdapter,
    private readonly events: PlaybackEngineEvents = {}
  ) {}

  async getStatus(): Promise<PlayerStatus> {
    const adapterStatus = await this.player.getStatus();
    if (!this.busy && this.isExternalCurrentMismatch(adapterStatus)) {
      await this.reconcileExternalPlaybackChange(adapterStatus).catch((error) => {
        console.warn(`[playback] failed to reconcile external player state: ${errorMessage(error)}`);
      });
      const syncedStatus = await this.player.getStatus();
      return this.composeStatus(syncedStatus);
    }

    return this.composeStatus(adapterStatus);
  }

  private composeStatus(adapterStatus: PlayerStatus): PlayerStatus {
    const current = this.queue.getCurrent() ?? adapterStatus.current;
    return {
      state: current ? adapterStatus.state : adapterStatus.state === "offline" ? "offline" : "idle",
      current,
      busy: this.busy,
      revision: this.revision,
      switching: this.switching
    };
  }

  async ensurePlaying(): Promise<void> {
    return this.runExclusive(() => this.ensurePlayingUnlocked());
  }

  async skip(options: PlaybackOperationOptions = {}): Promise<PlaybackOperationResult<QueueItem | undefined>> {
    return this.runExclusive(() => this.runVersionedOperation(options, () => this.skipUnlocked()));
  }

  async pause(options: PlaybackOperationOptions = {}): Promise<PlaybackOperationResult<boolean>> {
    return this.runExclusive(() => this.runVersionedOperation(options, () => this.pauseUnlocked()));
  }

  async resume(options: PlaybackOperationOptions = {}): Promise<PlaybackOperationResult<boolean>> {
    return this.runExclusive(() => this.runVersionedOperation(options, () => this.resumeUnlocked()));
  }

  async clear(options: PlaybackOperationOptions = {}): Promise<PlaybackOperationResult<number>> {
    return this.runExclusive(() => this.runVersionedOperation(options, () => this.clearUnlocked()));
  }

  private async ensurePlayingUnlocked(): Promise<void> {
    const current = this.queue.getCurrent();
    if (current || this.paused) {
      return;
    }

    const next = this.queue.next();
    if (!next) {
      return;
    }

    this.switching = true;
    this.bumpRevision();

    try {
      await this.startItem(next);
    } catch (error) {
      this.clearTimer();
      this.queue.finishCurrent();
      this.switching = false;
      this.bumpRevision();
      throw error;
    }
  }

  private async skipUnlocked(): Promise<QueueItem | undefined> {
    const skipped = this.queue.getCurrent();
    if (!skipped) {
      await this.player.skip();
      void this.notifyQueueDepleted();
      return undefined;
    }

    const hasQueuedNext = this.queue.listPending().length > 0;
    this.clearTimer();
    this.queue.completeCurrent();
    this.paused = false;

    if (hasQueuedNext) {
      await this.player.clear();
    } else {
      await this.player.skip();
    }

    if (this.queue.listPending().length > 0) {
      await this.ensurePlayingUnlocked();
    } else {
      void this.notifyQueueDepleted();
    }

    return skipped;
  }

  private async pauseUnlocked(): Promise<boolean> {
    const current = this.queue.getCurrent();
    if (!current || this.paused) {
      return false;
    }

    await this.player.pause();
    this.pauseTimer();
    this.paused = true;
    return true;
  }

  private async resumeUnlocked(): Promise<boolean> {
    const current = this.queue.getCurrent();
    if (!current || !this.paused) {
      return false;
    }

    await this.player.resume();
    this.paused = false;
    this.scheduleCurrent(this.remainingMs);
    return true;
  }

  private async clearUnlocked(): Promise<number> {
    const cleared = this.queue.clearPending();
    this.clearTimer();
    await this.player.clear();
    this.queue.completeCurrent();
    this.paused = false;
    return cleared;
  }

  private async startItem(item: QueueItem): Promise<void> {
    await this.player.play(item);
    await this.events.onTrackStarted?.(item);
    this.switching = false;
    this.bumpRevision();
    this.scheduleCurrent(item.track.durationMs ?? DEFAULT_TRACK_DURATION_MS);
  }

  private scheduleCurrent(durationMs: number): void {
    this.clearTimer();
    this.remainingMs = durationMs;
    this.timerStartedAt = Date.now();
    this.timer = setTimeout(() => {
      this.clearStatusSyncTimer();
      if (this.queue.completeCurrent()) {
        this.bumpRevision();
      }
      void Promise.resolve().finally(() => {
        if (this.queue.listPending().length > 0) {
          void this.runExclusive(() => this.ensurePlayingUnlocked());
        } else {
          void this.notifyQueueDepleted();
        }
      });
    }, durationMs);
    this.timer.unref?.();
    this.startStatusSyncTimer();
  }

  private pauseTimer(): void {
    if (!this.timer) {
      return;
    }

    clearTimeout(this.timer);
    this.timer = undefined;
    this.clearStatusSyncTimer();
    this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.timerStartedAt));
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.clearStatusSyncTimer();
  }

  private startStatusSyncTimer(): void {
    this.clearStatusSyncTimer();
    this.statusSyncTimer = setInterval(() => {
      if (this.busy || this.switching || this.paused || !this.queue.getCurrent()) {
        return;
      }

      void this.reconcileExternalPlaybackChange().catch((error) => {
        console.warn(`[playback] failed to reconcile external player state: ${errorMessage(error)}`);
      });
    }, PLAYER_STATUS_SYNC_INTERVAL_MS);
    this.statusSyncTimer.unref?.();
  }

  private clearStatusSyncTimer(): void {
    if (this.statusSyncTimer) {
      clearInterval(this.statusSyncTimer);
      this.statusSyncTimer = undefined;
    }
  }

  private async notifyQueueDepleted(): Promise<void> {
    await this.events.onQueueDepleted?.();
  }

  private async reconcileExternalPlaybackChange(observedStatus?: PlayerStatus): Promise<void> {
    if (this.busy || this.switching) {
      return;
    }

    if (observedStatus && !this.isExternalCurrentMismatch(observedStatus)) {
      return;
    }

    await this.runExclusive(async () => {
      const latestStatus = await this.player.getStatus();
      if (!this.isExternalCurrentMismatch(latestStatus)) {
        return;
      }

      await this.advanceAfterExternalCurrentEndedUnlocked();
    });
  }

  private async advanceAfterExternalCurrentEndedUnlocked(): Promise<void> {
    this.clearTimer();
    const completed = this.queue.completeCurrent();
    this.paused = false;
    if (!completed) {
      return;
    }

    this.bumpRevision();
    if (this.queue.listPending().length > 0) {
      await this.player.clear();
      await this.ensurePlayingUnlocked();
    } else {
      void this.notifyQueueDepleted();
    }
  }

  private isExternalCurrentMismatch(adapterStatus: PlayerStatus): boolean {
    const current = this.queue.getCurrent();
    if (!current || this.paused || this.switching || adapterStatus.state === "offline") {
      return false;
    }

    return !adapterStatus.current || adapterStatus.current.id !== current.id;
  }

  private async runVersionedOperation<T>(
    options: PlaybackOperationOptions,
    operation: () => Promise<T>
  ): Promise<PlaybackOperationResult<T>> {
    if (
      options.expectedRevision !== undefined &&
      options.expectedRevision !== this.revision
    ) {
      return {
        ok: false,
        ignored: true,
        reason: "stale_state",
        revision: this.revision
      };
    }

    const beforeRevision = this.revision;
    const result = await operation();
    const changed = result !== false;
    if (changed && this.revision === beforeRevision) {
      this.bumpRevision();
    }

    return {
      ok: changed,
      revision: this.revision,
      result
    };
  }

  private bumpRevision(): void {
    this.revision += 1;
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(async () => {
      this.busy = true;
      try {
        return await operation();
      } finally {
        this.busy = false;
      }
    });

    this.operationQueue = run.catch(() => undefined);
    return run;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
