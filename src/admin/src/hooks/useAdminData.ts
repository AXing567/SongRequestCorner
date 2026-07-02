import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getHistory,
  getStatus,
  moveQueueItem,
  playbackAction,
  removeQueueItem,
  replayHistoryItem
} from "../api/adminApi";
import type { HistoryPage, PlaybackOperationResult, StatusResponse } from "../types/api";

const HISTORY_PAGE_SIZE = 20;

export type OperationName =
  | "refresh"
  | "pause"
  | "resume"
  | "skip"
  | `remove:${string}`
  | `move:${string}:up`
  | `move:${string}:down`
  | `replay:${string}`;

export interface ToastState {
  kind: "success" | "error" | "info";
  text: string;
}

export function useAdminData() {
  const [status, setStatus] = useState<StatusResponse>();
  const [history, setHistory] = useState<HistoryPage>();
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDay, setHistoryDay] = useState(() => localDayKey(new Date()));
  const [busy, setBusy] = useState<Set<OperationName>>(() => new Set());
  const [toast, setToast] = useState<ToastState>();
  const statusRef = useRef<StatusResponse | undefined>(undefined);
  const historyQuery = useMemo(
    () => ({ page: historyPage, pageSize: HISTORY_PAGE_SIZE, day: historyDay || undefined }),
    [historyDay, historyPage]
  );

  const setOperationBusy = useCallback((name: OperationName, isBusy: boolean) => {
    setBusy((current) => {
      const next = new Set(current);
      if (isBusy) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }, []);

  const showToast = useCallback((nextToast: ToastState) => {
    setToast(nextToast);
    window.setTimeout(() => setToast((current) => (current === nextToast ? undefined : current)), 2600);
  }, []);

  const loadStatus = useCallback(async () => {
    const next = await getStatus();
    statusRef.current = next;
    setStatus(next);
  }, []);

  const loadHistory = useCallback(async () => {
    const next = await getHistory(historyQuery);
    setHistory(next);
    const totalPages = Math.max(1, Math.ceil(next.total / HISTORY_PAGE_SIZE));
    if (historyPage > totalPages) {
      setHistoryPage(totalPages);
    }
  }, [historyPage, historyQuery]);

  const changeHistoryDay = useCallback((day: string) => {
    setHistoryPage(1);
    setHistoryDay(day);
  }, []);

  const runOperation = useCallback(
    async (name: OperationName, operation: () => Promise<void>, successText?: string) => {
      setOperationBusy(name, true);
      try {
        await operation();
        if (successText) {
          showToast({ kind: "success", text: successText });
        }
      } catch (error) {
        showToast({ kind: "error", text: error instanceof Error ? error.message : String(error) });
      } finally {
        setOperationBusy(name, false);
      }
    },
    [setOperationBusy, showToast]
  );

  const refresh = useCallback(
    () =>
      runOperation(
        "refresh",
        async () => {
          await Promise.all([loadStatus(), loadHistory()]);
        },
        "已刷新"
      ),
    [loadHistory, loadStatus, runOperation]
  );

  const controlPlayback = useCallback(
    (action: "pause" | "resume" | "skip") =>
      runOperation(
        action,
        async () => {
          const result = await playbackAction(action, statusRef.current?.player.revision);
          assertPlaybackResult(action, result);
          if (action === "skip") {
            await Promise.all([loadStatus(), loadHistory()]);
            return;
          }

          await loadStatus();
        },
        action === "pause" ? "已暂停" : action === "resume" ? "继续播放" : "已切到下一首"
      ),
    [loadHistory, loadStatus, runOperation]
  );

  const removeItem = useCallback(
    (itemId: string) =>
      runOperation(
        `remove:${itemId}`,
        async () => {
          await removeQueueItem(itemId);
          await loadStatus();
        },
        "已移出队列"
      ),
    [loadStatus, runOperation]
  );

  const moveItem = useCallback(
    (itemId: string, direction: "up" | "down") =>
      runOperation(
        `move:${itemId}:${direction}`,
        async () => {
          await moveQueueItem(itemId, direction);
          await loadStatus();
        },
        "顺序已调整"
      ),
    [loadStatus, runOperation]
  );

  const replayItem = useCallback(
    (itemId: string) =>
      runOperation(
        `replay:${itemId}`,
        async () => {
          await replayHistoryItem(itemId);
          await Promise.all([loadStatus(), loadHistory()]);
        },
        "已再次加入"
      ),
    [loadHistory, loadStatus, runOperation]
  );

  useEffect(() => {
    void loadStatus().catch((error) => showToast({ kind: "error", text: String(error) }));
  }, [loadStatus, showToast]);

  useEffect(() => {
    void loadHistory().catch((error) => showToast({ kind: "error", text: String(error) }));
  }, [loadHistory, showToast]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (busy.size === 0) {
        void loadStatus().catch(() => undefined);
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [busy.size, loadStatus]);

  useEffect(() => {
    if (status?.player.revision === undefined) {
      return;
    }

    void loadHistory().catch((error) => showToast({ kind: "error", text: String(error) }));
  }, [loadHistory, showToast, status?.player.revision]);

  return {
    status,
    history,
    historyPage,
    historyPageSize: HISTORY_PAGE_SIZE,
    historyDay,
    busy,
    toast,
    setHistoryPage,
    setHistoryDay: changeHistoryDay,
    refresh,
    controlPlayback,
    removeItem,
    moveItem,
    replayItem
  };
}

function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertPlaybackResult(
  action: "pause" | "resume" | "skip",
  result: PlaybackOperationResult
): void {
  if (result.ignored) {
    throw new Error("播放状态刚刚变化，已忽略这次操作，请刷新后重试。");
  }

  if (result.ok) {
    return;
  }

  if (action === "pause") {
    throw new Error("当前没有可暂停的点歌，或已经处于暂停状态。");
  }

  if (action === "resume") {
    throw new Error("当前没有可继续的暂停歌曲。");
  }

  throw new Error("当前没有可切换的点歌。");
}
