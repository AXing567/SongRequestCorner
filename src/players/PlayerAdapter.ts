import type { Buffer } from "node:buffer";
import type { PlayerStatus, QueueItem } from "../domain/types.js";

export interface PlayerAdapter {
  getStatus(): Promise<PlayerStatus>;
  warmUp?(): Promise<void> | void;
  play(item: QueueItem): Promise<void>;
  skip(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  clear(): Promise<void>;
  dispose?(): Promise<void> | void;
}

export interface PlayerLoginQrCode {
  data: Buffer;
  mimeType: string;
  filename?: string;
}

export interface PlayerLoginStatus {
  state: "unknown" | "logged_in" | "login_required";
  accountName?: string;
  qrCode?: PlayerLoginQrCode;
  reason?: string;
}

export interface LoginAwarePlayerAdapter extends PlayerAdapter {
  getLoginStatus(): Promise<PlayerLoginStatus>;
}

export function isLoginAwarePlayerAdapter(player: PlayerAdapter): player is LoginAwarePlayerAdapter {
  return typeof (player as Partial<LoginAwarePlayerAdapter>).getLoginStatus === "function";
}
