import { Pause, Play, SkipForward } from "lucide-react";
import { motion } from "framer-motion";
import { buttonTap } from "../motion/presets";

interface PlaybackControlsProps {
  onAction: (action: "pause" | "resume" | "skip") => void;
  busy: Set<string>;
}

export function PlaybackControls({ onAction, busy }: PlaybackControlsProps) {
  return (
    <div className="playback-controls" aria-label="播放控制">
      <ControlButton title="暂停" busy={busy.has("pause")} onClick={() => onAction("pause")}>
        <Pause size={18} />
      </ControlButton>
      <ControlButton title="继续" variant="primary" busy={busy.has("resume")} onClick={() => onAction("resume")}>
        <Play size={18} />
      </ControlButton>
      <ControlButton title="下一首" busy={busy.has("skip")} onClick={() => onAction("skip")}>
        <SkipForward size={18} />
      </ControlButton>
    </div>
  );
}

function ControlButton({
  children,
  title,
  onClick,
  busy,
  variant = "secondary"
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  busy: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <motion.button
      className={`control-button ${variant}`}
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
      whileTap={buttonTap}
    >
      {children}
      <span>{busy ? "处理中" : title}</span>
    </motion.button>
  );
}
