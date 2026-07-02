import { ArrowDown, ArrowUp, X } from "lucide-react";
import { motion } from "framer-motion";
import type { QueueItem as QueueItemType } from "../types/api";
import { buttonTap, listItemMotion } from "../motion/presets";
import { formatTime, requesterName } from "../utils/format";

interface QueueItemProps {
  item: QueueItemType;
  index: number;
  total: number;
  onMove: (itemId: string, direction: "up" | "down") => void;
  onRemove: (itemId: string) => void;
  busy: Set<string>;
}

export function QueueItem({ item, index, total, onMove, onRemove, busy }: QueueItemProps) {
  const movingUp = busy.has(`move:${item.id}:up`);
  const movingDown = busy.has(`move:${item.id}:down`);
  const removing = busy.has(`remove:${item.id}`);
  const isNext = index === 0;

  return (
    <motion.article
      className={`list-row queue-row ${isNext ? "next-up" : ""} ${movingUp || movingDown ? "recently-touched" : ""} ${
        removing ? "danger-pending" : ""
      }`}
      layout
      variants={listItemMotion}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="row-index">{index + 1}</div>
      <div className="row-main">
        <div className="row-title-line">
          <h3>{item.track.title}</h3>
          {isNext && <span>下一首</span>}
        </div>
        <p>{item.track.artist}</p>
        <small>
          {requesterName(item)} · {formatTime(item.requestedAt)}
        </small>
      </div>
      <div className="row-actions">
        <IconAction title="上移" disabled={index === 0 || movingUp} onClick={() => onMove(item.id, "up")}>
          <ArrowUp size={16} />
        </IconAction>
        <IconAction title="下移" disabled={index >= total - 1 || movingDown} onClick={() => onMove(item.id, "down")}>
          <ArrowDown size={16} />
        </IconAction>
        <motion.button
          className="text-action danger"
          type="button"
          onClick={() => onRemove(item.id)}
          disabled={removing}
          whileTap={buttonTap}
        >
          <X size={15} />
          <span>{removing ? "移出中" : "移出队列"}</span>
        </motion.button>
      </div>
    </motion.article>
  );
}

function IconAction({
  children,
  title,
  disabled,
  onClick
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button className="icon-button small" type="button" title={title} disabled={disabled} onClick={onClick} whileTap={buttonTap}>
      {children}
    </motion.button>
  );
}
