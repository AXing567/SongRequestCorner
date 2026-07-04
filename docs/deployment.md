# Deployment Guide

This guide focuses on the recommended deployment: one Windows playback computer, one Feishu bot, and NetEase web playback.

## 1. Prepare The Windows Playback Machine

Install:

- Node.js 22 or newer.
- Chrome or Edge.
- Git.

Clone and install:

```bash
git clone https://github.com/AXing567/SongRequestCorner.git
cd SongRequestCorner
npm install
copy .env.example .env
```

Run the health check:

```bash
npm run doctor
```

## 2. First Smoke Test

Before connecting Feishu or NetEase, use mock mode:

```text
BOT_TRANSPORT=console
MUSIC_PROVIDER=mock
PLAYER_ADAPTER=mock
ADMIN_SERVER_ENABLED=true
```

Start:

```bash
npm run dev
```

Try:

```text
u1 点歌 晴天 周杰伦
u2 队列
```

Open the admin page printed in the log.

## 3. Configure Feishu

In the Feishu developer console:

1. Create an internal app.
2. Enable bot capability.
3. Add the bot to your group.
4. Subscribe to `im.message.receive_v1` and `card.action.trigger`.
5. Enable long connection events.
6. Grant message send, interactive card, image upload/send, and basic user info permissions.

Set:

```text
BOT_TRANSPORT=feishu
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
BOT_DISPLAY_NAME=点歌机器人
```

Run:

```bash
npm run doctor
npm run dev
```

Mention the bot in the Feishu group:

```text
@点歌机器人 点歌 晴天 周杰伦
```

## 4. Configure NetEase

Set:

```text
MUSIC_PROVIDER=netease-web
PLAYER_ADAPTER=netease-web
NETEASE_HEADLESS=false
NETEASE_USER_DATA_DIR=.playwright/netease-profile
CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Start the service and request a song. Log in to NetEase Cloud Music in the browser window that opens. Keep `NETEASE_HEADLESS=false` until login is complete.

If you do not set `CHROME_EXECUTABLE_PATH`, install Playwright Chromium:

```bash
npx playwright install chromium
```

## 5. LAN Admin Page

Default settings:

```text
ADMIN_SERVER_ENABLED=true
ADMIN_SERVER_HOST=0.0.0.0
ADMIN_SERVER_PORT=3333
```

The startup log prints LAN URLs such as:

```text
[admin] LAN http://192.168.x.x:3333
```

If another device cannot connect:

1. Confirm both devices are on the same LAN.
2. Allow Node.js through Windows Firewall.
3. Allow inbound TCP port `3333`.
4. Confirm `.env` does not set `ADMIN_SERVER_HOST=127.0.0.1`.

## 6. Data And Restart Behavior

```text
HISTORY_DB_PATH=.data/play-history.sqlite
```

- Pending queue: memory only, clears on restart.
- Play history: SQLite, kept for the latest 7 days.
- NetEase login profile: `NETEASE_USER_DATA_DIR`.

Generated local directories should not be committed.

## 7. Production Run

```bash
npm ci
npm run build
npm start
```

For always-on usage, configure a Windows service or scheduled task. See [windows-service.md](windows-service.md).

## 8. Common Problems

### The bot does not respond in Feishu

- Confirm the app is added to the target group.
- Confirm `im.message.receive_v1` is subscribed.
- Confirm long connection is enabled.
- Run `npm run doctor`.
- Check that `FEISHU_APP_ID` and `FEISHU_APP_SECRET` match the app.

### Feishu card buttons do not work

- Confirm `card.action.trigger` is subscribed.
- Confirm card-related permissions are enabled and the app has been republished or reinstalled after permission changes.
- Check the terminal for `[feishu] received card.action.trigger event`.

### NetEase browser opens but does not play

- Log in manually.
- Confirm the account can play the track.
- Keep `NETEASE_HEADLESS=false`.
- Try setting `CHROME_EXECUTABLE_PATH` to installed Chrome.

### Admin page cannot be opened from another computer

- Use `ADMIN_SERVER_HOST=0.0.0.0`.
- Open the LAN URL printed by the startup log.
- Allow Windows Firewall inbound access.

### SQLite warning appears

Node.js 22 may print an `ExperimentalWarning` for `node:sqlite`. This project uses it as a local embedded database and does not require a separate database service.
