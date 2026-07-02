import type { QueueItem, Track } from "../types/api";

export function formatTrack(track: Track): string {
  return `${track.artist} - ${track.title}`;
}

export function requesterName(item: Pick<QueueItem, "requester">): string {
  return item.requester.name ?? item.requester.id;
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
