import { CalendarDays, History, ListMusic } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { HistoryPage, QueueItem as QueueItemType } from "../types/api";
import { buttonTap, listSwitchMotion, panelEntrance } from "../motion/presets";
import { EmptyState } from "./EmptyState";
import { HistoryItem } from "./HistoryItem";
import { QueueItem } from "./QueueItem";

type ActiveView = "queue" | "history";

interface QueueHistoryPanelProps {
  pending: QueueItemType[];
  history?: HistoryPage;
  page: number;
  pageSize: number;
  day: string;
  busy: Set<string>;
  onDayChange: (day: string) => void;
  onPageChange: (page: number) => void;
  onMove: (itemId: string, direction: "up" | "down") => void;
  onRemove: (itemId: string) => void;
  onReplay: (itemId: string) => void;
}

export function QueueHistoryPanel({
  pending,
  history,
  page,
  pageSize,
  day,
  busy,
  onDayChange,
  onPageChange,
  onMove,
  onRemove,
  onReplay
}: QueueHistoryPanelProps) {
  const [activeView, setActiveView] = useState<ActiveView>("queue");
  const historyItems = history?.items ?? [];
  const historyTotal = history?.total ?? 0;
  const historyDays = buildHistoryDayOptions(history?.days ?? [], day);
  const totalPages = Math.max(1, Math.ceil(historyTotal / pageSize));
  const isQueueView = activeView === "queue";

  return (
    <motion.section
      className="queue-history-panel"
      variants={panelEntrance}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.1, duration: 0.26 }}
    >
      <div className="queue-history-toolbar">
        <ViewToggleButton
          activeView={activeView}
          pendingCount={pending.length}
          historyCount={historyTotal}
          onClick={() => setActiveView(isQueueView ? "history" : "queue")}
        />

        <AnimatePresence mode="wait" initial={false}>
          {activeView === "history" && (
            <motion.div
              key="history-tools"
              className="history-tools"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.16 }}
            >
              <CalendarDays size={16} />
              <select value={day} onChange={(event) => onDayChange(event.target.value)} title="按日期筛选">
                <option value="">全部日期</option>
                {historyDays.map((historyDay) => (
                  <option key={historyDay} value={historyDay}>
                    {historyDay === localDayKey(new Date()) ? `${historyDay} 今天` : historyDay}
                  </option>
                ))}
              </select>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {activeView === "queue" ? (
          <motion.div
            key="queue"
            className="list-stack queue-list"
            variants={listSwitchMotion}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <AnimatePresence initial={false}>
              {pending.length === 0 ? (
                <EmptyState
                  key="empty-queue"
                  title="队列暂时安静"
                  detail="在飞书群里 @机器人 发送歌名即可点播"
                />
              ) : (
                pending.map((item, index) => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    index={index}
                    total={pending.length}
                    busy={busy}
                    onMove={onMove}
                    onRemove={onRemove}
                  />
                ))
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="history"
            className="list-stack history-list"
            variants={listSwitchMotion}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <AnimatePresence initial={false}>
              {historyItems.length === 0 ? (
                <EmptyState
                  key="empty-history"
                  title="暂无播放历史"
                  detail="播放完成后，近 7 日记录会出现在这里"
                />
              ) : (
                historyItems.map((item) => (
                  <HistoryItem key={item.id} item={item} busy={busy.has(`replay:${item.id}`)} onReplay={onReplay} />
                ))
              )}
            </AnimatePresence>
            <div className="pager">
              <button type="button" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
                上一页
              </button>
              <span>
                第 {page} / {totalPages} 页
              </span>
              <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                下一页
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function buildHistoryDayOptions(days: string[], selectedDay: string): string[] {
  const ordered = selectedDay ? [selectedDay, ...days] : days;
  return ordered.filter((day, index) => day && ordered.indexOf(day) === index);
}

function localDayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ViewToggleButton({
  activeView,
  pendingCount,
  historyCount,
  onClick
}: {
  activeView: ActiveView;
  pendingCount: number;
  historyCount: number;
  onClick: () => void;
}) {
  const isQueueView = activeView === "queue";

  return (
    <motion.button
      className="view-toggle-button"
      type="button"
      aria-label={isQueueView ? "切换到历史记录" : "切换到待播放"}
      onClick={onClick}
      whileTap={buttonTap}
    >
      <span className="view-toggle-current">
        {isQueueView ? <ListMusic size={16} /> : <History size={16} />}
        <span>{isQueueView ? `待播放 ${pendingCount}` : `历史记录 ${historyCount}`}</span>
      </span>
      <span className="view-toggle-next">{isQueueView ? `切换到历史 ${historyCount}` : `切换到待播放 ${pendingCount}`}</span>
    </motion.button>
  );
}
