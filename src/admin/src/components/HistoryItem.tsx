import { RotateCcw } from "lucide-react";
import { motion } from "framer-motion";
import type { HistoryItem as HistoryItemType } from "../types/api";
import { buttonTap, listItemMotion } from "../motion/presets";
import { formatDateTime } from "../utils/format";

interface HistoryItemProps {
  item: HistoryItemType;
  onReplay: (itemId: string) => void;
  busy: boolean;
}

export function HistoryItem({ item, onReplay, busy }: HistoryItemProps) {
  return (
    <motion.article className={`list-row history-row ${busy ? "recently-touched" : ""}`} layout variants={listItemMotion} initial="hidden" animate="visible" exit="exit">
      <div className="row-index history">♪</div>
      <div className="row-main">
        <h3>{item.track.title}</h3>
        <small>
          {item.track.artist} · {formatDateTime(item.playedAt)} · {item.requester.name ?? item.requester.id}
        </small>
      </div>
      <div className="row-actions">
        <motion.button className="text-action replay" type="button" disabled={busy} onClick={() => onReplay(item.id)} whileTap={buttonTap}>
          <RotateCcw size={15} />
          <span>{busy ? "加入中" : "再次加入"}</span>
        </motion.button>
      </div>
    </motion.article>
  );
}
