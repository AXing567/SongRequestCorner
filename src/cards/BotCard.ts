export type BotCardTone = "info" | "success" | "warning" | "danger" | "muted";

export type BotCardActionCommand =
  | "show_queue"
  | "current"
  | "cancel_mine"
  | "skip"
  | "pause"
  | "resume"
  | "history"
  | "replay_history"
  | "help";

export interface BotCardAction {
  command: BotCardActionCommand;
  label?: string;
  style?: "default" | "primary" | "danger";
  valueText?: string;
}

export interface BotCard {
  config: {
    wide_screen_mode: boolean;
    update_multi: boolean;
  };
  header: {
    template: string;
    title: {
      tag: "plain_text";
      content: string;
    };
  };
  elements: Array<Record<string, unknown>>;
}

export interface BotCardOptions {
  title: string;
  text: string;
  tone?: BotCardTone;
  actions?: BotCardAction[];
}

const TONE_TEMPLATE: Record<BotCardTone, string> = {
  info: "blue",
  success: "green",
  warning: "orange",
  danger: "red",
  muted: "grey"
};

const ACTION_TEXT: Record<BotCardActionCommand, string> = {
  show_queue: "待播放",
  current: "当前播放",
  cancel_mine: "撤销我的点歌",
  skip: "切歌",
  pause: "暂停",
  resume: "继续",
  history: "历史记录",
  replay_history: "再次加入",
  help: "帮助"
};

export function createBotCard(options: BotCardOptions): BotCard {
  const elements: Array<Record<string, unknown>> = [
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: sanitizeLarkMarkdown(options.text)
      }
    }
  ];

  if (options.actions?.length) {
    elements.push({
      tag: "action",
      actions: options.actions.slice(0, 6).map((action) => ({
        tag: "button",
        text: {
          tag: "plain_text",
          content: action.label ?? cardActionCommandToText(action.command)
        },
        type: action.style ?? "default",
        value: {
          command: action.command,
          text: action.valueText ?? cardActionCommandToText(action.command)
        }
      }))
    });
  }

  return {
    config: {
      wide_screen_mode: true,
      update_multi: true
    },
    header: {
      template: TONE_TEMPLATE[options.tone ?? "info"],
      title: {
        tag: "plain_text",
        content: options.title
      }
    },
    elements
  };
}

export function createSearchingCard(query: string): BotCard {
  return createBotCard({
    title: "正在搜索",
    text: `收到，正在搜索「${query}」`,
    tone: "info",
    actions: [{ command: "help" }]
  });
}

export function createPlaybackStartedCard(text: string): BotCard {
  return createBotCard({
    title: "当前播放",
    text,
    tone: "success",
    actions: playbackControlActions()
  });
}

export function createQueueDepletedCard(text: string): BotCard {
  return createBotCard({
    title: "队列已空",
    text,
    tone: "muted",
    actions: [
      { command: "show_queue" },
      { command: "history" },
      { command: "help" }
    ]
  });
}

export function createErrorCard(text: string): BotCard {
  return createBotCard({
    title: "操作失败",
    text,
    tone: "danger",
    actions: [{ command: "help" }]
  });
}

export function playbackControlActions(): BotCardAction[] {
  return [
    { command: "pause" },
    { command: "resume", style: "primary" },
    { command: "skip", style: "danger" },
    { command: "show_queue" }
  ];
}

export function queueActions(): BotCardAction[] {
  return [
    { command: "current" },
    { command: "show_queue", label: "刷新" },
    { command: "cancel_mine" },
    { command: "history" }
  ];
}

export function cardActionCommandToText(command: BotCardActionCommand): string {
  return ACTION_TEXT[command];
}

export function isBotCardActionCommand(value: string): value is BotCardActionCommand {
  return Object.prototype.hasOwnProperty.call(ACTION_TEXT, value);
}

function sanitizeLarkMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
