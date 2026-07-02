import { Loader2, Pause, Play, Radio, WifiOff } from "lucide-react";
import { motion } from "framer-motion";
import type { PlayerState } from "../types/api";

interface StatusPillProps {
  state: PlayerState;
  busy?: boolean;
  switching?: boolean;
}

const stateText: Record<PlayerState, string> = {
  idle: "空闲",
  playing: "播放中",
  paused: "已暂停",
  offline: "离线"
};

export function StatusPill({ state, busy, switching }: StatusPillProps) {
  const activeBusy = Boolean(busy || switching);
  const label = switching ? "切换中" : activeBusy ? "处理中" : stateText[state] ?? state;
  const Icon = activeBusy ? Loader2 : state === "offline" ? WifiOff : state === "paused" ? Pause : state === "playing" ? Radio : Play;

  return (
    <motion.div
      layout
      className={`status-pill status-${activeBusy ? "busy" : state}`}
      initial={false}
      animate={{ opacity: 1, scale: activeBusy ? 1.02 : 1 }}
      transition={{ duration: 0.18 }}
    >
      <Icon className={activeBusy ? "spin-soft" : ""} size={15} />
      <span>{label}</span>
    </motion.div>
  );
}
