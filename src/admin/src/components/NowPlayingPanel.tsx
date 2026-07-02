import { Disc3, Music2 } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { PlayerStatus } from "../types/api";
import { panelEntrance, softEase } from "../motion/presets";
import { PlaybackControls } from "./PlaybackControls";
import { formatTrack, requesterName } from "../utils/format";

interface NowPlayingPanelProps {
  player?: PlayerStatus;
  busy: Set<string>;
  onAction: (action: "pause" | "resume" | "skip") => void;
}

export function NowPlayingPanel({ player, busy, onAction }: NowPlayingPanelProps) {
  const current = player?.current;
  const isPlaying = player?.state === "playing" && Boolean(current);
  const isPaused = player?.state === "paused" && Boolean(current);
  const isOffline = player?.state === "offline";

  return (
    <motion.section
      className={`now-playing ${isPlaying ? "is-playing" : ""} ${isPaused ? "is-paused" : ""} ${
        isOffline ? "is-offline" : ""
      }`}
      variants={panelEntrance}
      initial="hidden"
      animate="visible"
      transition={{ delay: 0.06, duration: 0.28, ease: softEase }}
    >
      <div className="record-mark" aria-hidden="true">
        <div className="record-disc">
          <Disc3 size={52} />
        </div>
      </div>
      <div className="now-copy">
        <p className="eyebrow">当前播放</p>
        <AnimatePresence mode="wait">
          <motion.div
            key={current?.id ?? "empty"}
            initial={{ opacity: 0, x: 12, y: 8, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: -16, filter: "blur(4px)" }}
            transition={{ duration: 0.25, ease: softEase }}
          >
            <h2>{current ? formatTrack(current.track) : "等待下一首点播"}</h2>
            <p className="muted">
              {current ? `由 ${requesterName(current)} 点播` : "当前没有点播歌曲，网易云可以自由播放"}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
      <LevelBars active={isPlaying && !player?.switching} paused={isPaused} offline={isOffline} />
      <PlaybackControls onAction={onAction} busy={busy} />
    </motion.section>
  );
}

function LevelBars({ active, paused, offline }: { active: boolean; paused: boolean; offline: boolean }) {
  return (
    <div className={`level-bars ${active ? "active" : ""} ${paused ? "paused" : ""} ${offline ? "offline" : ""}`} aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => (
        <span key={index} style={{ animationDelay: `${index * 70}ms` }} />
      ))}
      {!active && <Music2 size={18} className="level-idle" />}
    </div>
  );
}
