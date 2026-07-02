import type { BotTransport } from "../integrations/BotTransport.js";
import type { LoginAwarePlayerAdapter, PlayerLoginStatus } from "../players/PlayerAdapter.js";

const DEFAULT_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_RESEND_AFTER_MS = 10 * 60_000;

interface LoginNotifierOptions {
  player: LoginAwarePlayerAdapter;
  getTransport: () => BotTransport | undefined;
  getChatId: () => string | undefined;
  checkIntervalMs?: number;
  resendAfterMs?: number;
  now?: () => number;
}

export class LoginNotifier {
  private timer?: NodeJS.Timeout;
  private awaitingLogin = false;
  private lastNoticeHadQrCode = false;
  private lastNoticeAt = 0;
  private checkInFlight?: Promise<void>;
  private readonly checkIntervalMs: number;
  private readonly resendAfterMs: number;
  private readonly now: () => number;

  constructor(private readonly options: LoginNotifierOptions) {
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.resendAfterMs = options.resendAfterMs ?? DEFAULT_RESEND_AFTER_MS;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.checkNow().catch((error) => {
        console.warn(`[login] failed to check NetEase login status: ${errorMessage(error)}`);
      });
    }, this.checkIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkNow(): Promise<void> {
    if (this.checkInFlight) {
      return this.checkInFlight;
    }

    this.checkInFlight = this.checkOnce().finally(() => {
      this.checkInFlight = undefined;
    });
    return this.checkInFlight;
  }

  private async checkOnce(): Promise<void> {
    const transport = this.options.getTransport();
    const chatId = this.options.getChatId();
    if (!transport || !chatId) {
      return;
    }

    const status = await this.options.player.getLoginStatus();
    if (status.state === "login_required") {
      await this.sendLoginRequired(transport, chatId, status);
      return;
    }

    if (status.state === "logged_in" && this.awaitingLogin) {
      await this.sendLoginRecovered(transport, chatId, status);
    }
  }

  private async sendLoginRequired(
    transport: BotTransport,
    chatId: string,
    status: PlayerLoginStatus
  ): Promise<void> {
    const now = this.now();
    if (
      this.awaitingLogin &&
      now - this.lastNoticeAt < this.resendAfterMs &&
      (this.lastNoticeHadQrCode || !status.qrCode)
    ) {
      return;
    }

    this.awaitingLogin = true;
    this.lastNoticeHadQrCode = Boolean(status.qrCode && transport.sendImage);
    this.lastNoticeAt = now;

    await safeSendText(
      transport,
      chatId,
      "网易云登录状态已失效，需要重新登录才能继续播放点歌。请用网易云音乐 App 扫描下面的二维码完成登录。"
    );

    if (status.qrCode && transport.sendImage) {
      await safeSendImage(transport, chatId, status.qrCode);
      return;
    }

    await safeSendText(
      transport,
      chatId,
      "我没能自动截到二维码，请到播放电脑上的网易云音乐网页手动登录。登录恢复后我会在群里同步。"
    );
  }

  private async sendLoginRecovered(
    transport: BotTransport,
    chatId: string,
    status: PlayerLoginStatus
  ): Promise<void> {
    this.awaitingLogin = false;
    this.lastNoticeHadQrCode = false;
    this.lastNoticeAt = 0;

    const who = status.accountName ? `网易云账号「${status.accountName}」` : "完成登录的同事";
    await safeSendText(transport, chatId, `网易云已恢复登录，感谢 ${who}！`);
  }
}

async function safeSendText(transport: BotTransport, chatId: string, text: string): Promise<void> {
  try {
    await transport.sendText(chatId, text);
  } catch (error) {
    console.error(`Login notice send failed: ${errorMessage(error)}`);
  }
}

async function safeSendImage(
  transport: BotTransport,
  chatId: string,
  image: PlayerLoginStatus["qrCode"]
): Promise<void> {
  if (!image || !transport.sendImage) {
    return;
  }

  try {
    await transport.sendImage(chatId, image);
  } catch (error) {
    console.error(`Login QR send failed: ${errorMessage(error)}`);
    await safeSendText(
      transport,
      chatId,
      "二维码图片发送失败，请到播放电脑上的网易云音乐网页手动登录。登录恢复后我会在群里同步。"
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
