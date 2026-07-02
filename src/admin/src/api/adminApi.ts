import type { HistoryPage, PlaybackOperationResult, StatusResponse } from "../types/api";

export interface HistoryQuery {
  page: number;
  pageSize: number;
  day?: string;
}

export async function getStatus(): Promise<StatusResponse> {
  return readJson<StatusResponse>("/api/status");
}

export async function getHistory(query: HistoryQuery): Promise<HistoryPage> {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize)
  });
  if (query.day) {
    params.set("day", query.day);
  }

  return readJson<HistoryPage>(`/api/history?${params.toString()}`);
}

export async function playbackAction(
  action: "pause" | "resume" | "skip",
  expectedRevision?: number
): Promise<PlaybackOperationResult> {
  const path = action === "skip" ? "/api/playback/skip" : `/api/playback/${action}`;
  return postJson<PlaybackOperationResult>(path, { expectedRevision });
}

export async function removeQueueItem(itemId: string): Promise<{ removed: unknown }> {
  return postJson(`/api/queue/${encodeURIComponent(itemId)}/remove`);
}

export async function moveQueueItem(itemId: string, direction: "up" | "down"): Promise<{ ok: boolean }> {
  return postJson(`/api/queue/${encodeURIComponent(itemId)}/move`, { direction });
}

export async function replayHistoryItem(itemId: string): Promise<{ item: unknown; position: number }> {
  return postJson(`/api/history/${encodeURIComponent(itemId)}/replay`);
}

async function readJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  return parseResponse<T>(response);
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return (await response.json()) as T;
  }

  const text = await response.text();
  let message = text || `${response.status} ${response.statusText}`;
  try {
    const payload = JSON.parse(text) as { error?: unknown };
    if (typeof payload.error === "string") {
      message = payload.error;
    }
  } catch {
    // Keep the raw response body when the server does not return JSON.
  }

  throw new Error(message);
}
