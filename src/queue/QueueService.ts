import { randomUUID } from "node:crypto";
import type { BotUser, HistoryItem, HistoryPage, QueueItem, Track } from "../domain/types.js";
import { InMemoryHistoryStore, type HistoryStore, type ListHistoryOptions } from "../history/HistoryStore.js";

export class QueueService {
  private pending: QueueItem[];
  private current?: QueueItem;

  constructor(private readonly historyStore: HistoryStore = new InMemoryHistoryStore()) {
    this.pending = historyStore.loadPendingQueue();
  }

  enqueue(track: Track, requester: BotUser): { item: QueueItem; position: number } {
    const item: QueueItem = {
      id: randomUUID(),
      track,
      requester,
      requestedAt: new Date()
    };

    this.pending.push(item);
    this.persistPending();
    return {
      item,
      position: this.pending.length + (this.current ? 1 : 0)
    };
  }

  next(): QueueItem | undefined {
    this.current = this.pending.shift();
    this.persistPending();
    return this.current;
  }

  getCurrent(): QueueItem | undefined {
    return this.current;
  }

  finishCurrent(): void {
    this.current = undefined;
  }

  completeCurrent(playedAt = new Date()): QueueItem | undefined {
    const item = this.current;
    if (!item) {
      return undefined;
    }

    this.recordHistory(item, playedAt);
    this.current = undefined;
    return item;
  }

  listPending(): QueueItem[] {
    return [...this.pending];
  }

  listHistory(now = new Date()): HistoryItem[] {
    return this.historyStore.list({ now, page: 1, pageSize: 100 }).items;
  }

  listHistoryPage(options: ListHistoryOptions = {}): HistoryPage {
    return this.historyStore.list(options);
  }

  replayHistoryItem(historyItemId: string, requester?: BotUser): { item: QueueItem; position: number } | undefined {
    const historyItem = this.historyStore.find(historyItemId);
    if (!historyItem) {
      return undefined;
    }

    return this.enqueue(historyItem.track, requester ?? historyItem.requester);
  }

  cancelLatestByUser(userId: string): QueueItem | undefined {
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index]?.requester.id === userId) {
        const [removed] = this.pending.splice(index, 1);
        this.persistPending();
        return removed;
      }
    }

    return undefined;
  }

  removePending(itemId: string): QueueItem | undefined {
    const index = this.pending.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return undefined;
    }

    const [removed] = this.pending.splice(index, 1);
    this.persistPending();
    return removed;
  }

  movePending(itemId: string, direction: "up" | "down"): boolean {
    const index = this.pending.findIndex((item) => item.id === itemId);
    if (index < 0) {
      return false;
    }

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= this.pending.length) {
      return false;
    }

    const [item] = this.pending.splice(index, 1);
    this.pending.splice(targetIndex, 0, item);
    this.persistPending();
    return true;
  }

  clearPending(): number {
    const count = this.pending.length;
    this.pending = [];
    this.persistPending();
    return count;
  }

  private recordHistory(item: QueueItem, playedAt: Date): void {
    this.historyStore.record(item, playedAt);
  }

  private persistPending(): void {
    this.historyStore.savePendingQueue(this.pending);
  }
}
