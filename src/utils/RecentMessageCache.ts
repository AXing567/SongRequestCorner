import type { IncomingMessage } from "../domain/types.js";

export class RecentMessageCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = 5 * 60 * 1000,
    private readonly fallbackWindowMs = 15 * 1000
  ) {}

  shouldProcess(message: IncomingMessage): boolean {
    const now = Date.now();
    this.prune(now);

    const key = this.keyFor(message);
    if (this.seen.has(key)) {
      return false;
    }

    this.seen.set(key, now);
    return true;
  }

  private keyFor(message: IncomingMessage): string {
    if (message.id) {
      return `id:${message.id}`;
    }

    const bucket = Math.floor(Date.now() / this.fallbackWindowMs);
    return `fingerprint:${message.chatId}:${message.sender.id}:${message.text}:${bucket}`;
  }

  private prune(now: number): void {
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs) {
        this.seen.delete(key);
      }
    }
  }
}
