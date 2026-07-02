import { HeaderBar } from "./components/HeaderBar";
import { NowPlayingPanel } from "./components/NowPlayingPanel";
import { QueueHistoryPanel } from "./components/QueueHistoryPanel";
import { Toast } from "./components/Toast";
import { useAdminData } from "./hooks/useAdminData";

export function AdminApp() {
  const {
    status,
    history,
    historyPage,
    historyPageSize,
    historyDay,
    busy,
    toast,
    setHistoryPage,
    setHistoryDay,
    refresh,
    controlPlayback,
    removeItem,
    moveItem,
    replayItem
  } = useAdminData();

  const pending = status?.pending ?? [];

  return (
    <main className="app-shell">
      <HeaderBar player={status?.player} pendingCount={pending.length} onRefresh={refresh} refreshing={busy.has("refresh")} />
      <NowPlayingPanel player={status?.player} busy={busy} onAction={controlPlayback} />
      <QueueHistoryPanel
        pending={pending}
        history={history}
        page={historyPage}
        pageSize={historyPageSize}
        day={historyDay}
        busy={busy}
        onDayChange={(nextDay) => {
          setHistoryDay(nextDay);
          setHistoryPage(1);
        }}
        onPageChange={setHistoryPage}
        onMove={moveItem}
        onRemove={removeItem}
        onReplay={replayItem}
      />
      <Toast toast={toast} />
    </main>
  );
}
