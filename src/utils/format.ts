import type { QueueItem, Track } from "../domain/types.js";

export function formatTrack(track: Track): string {
  return `${track.artist} - ${track.title}`;
}

export function formatQueueItem(item: QueueItem, index: number): string {
  return `${index}. ${formatTrack(item.track)}（${item.requester.name ?? item.requester.id}）`;
}

export function pluralSong(count: number): string {
  return `${count} 首`;
}
