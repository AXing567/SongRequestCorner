import { RefreshCw } from "lucide-react";
import { motion } from "framer-motion";
import type { PlayerStatus } from "../types/api";
import { StatusPill } from "./StatusPill";
import { buttonTap, panelEntrance } from "../motion/presets";

interface HeaderBarProps {
  player?: PlayerStatus;
  pendingCount: number;
  onRefresh: () => void;
  refreshing: boolean;
}

export function HeaderBar({ player, pendingCount, onRefresh, refreshing }: HeaderBarProps) {
  return (
    <motion.header className="header-bar" variants={panelEntrance} initial="hidden" animate="visible">
      <div>
        <p className="eyebrow">Song Request Corner</p>
        <h1>点歌控制台</h1>
      </div>
      <div className="header-meta">
        <div className="mini-meter" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <div className="queue-counter">
          <span>{pendingCount}</span>
          <small>首待播</small>
        </div>
        <StatusPill state={player?.state ?? "idle"} busy={player?.busy} switching={player?.switching} />
        <motion.button
          className="icon-button"
          type="button"
          title="刷新"
          onClick={onRefresh}
          disabled={refreshing}
          whileTap={buttonTap}
        >
          <RefreshCw size={17} className={refreshing ? "spin-soft" : ""} />
        </motion.button>
      </div>
    </motion.header>
  );
}
