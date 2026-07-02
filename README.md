# Song Request Corner

Song Request Corner is a Feishu-first song request bot for an internal Windows playback machine.

It lets people mention a Feishu bot in a group chat, request a song, and have the Windows machine connected to the speaker play the queued music through NetEase Cloud Music web playback. It also includes a lightweight LAN admin page for queue control and 7-day play history.

> This project is for internal, self-hosted use. It does not bypass music platform copyright or playback restrictions.

## Features

- Feishu group chat song requests.
- Immediate bot feedback for searching, queued songs, and failures.
- NetEase web search and playback using your own logged-in account.
- Local admin page for current playback, queue reorder/remove, skip, pause/resume, and play-history replay.
- SQLite play history, kept for the most recent 7 days.
- Console mode for local testing before connecting Feishu.

## Requirements

- Windows playback computer connected to the speakers.
- Node.js 22 or newer.
- Chrome or Edge installed, or Playwright-managed Chromium.
- A Feishu internal app with bot capability enabled.
- A NetEase Cloud Music account that can play the songs you want.

## Quick Start

```bash
git clone https://github.com/AXing567/SongRequestCorner.git
cd SongRequestCorner
npm install
copy .env.example .env
npm run doctor
npm run dev
```

Open the admin page shown in the startup log. By default it listens on the LAN:

```text
[admin] LAN http://192.168.x.x:3333
```

If other devices cannot open it, allow Node.js or TCP port `3333` through Windows Firewall.

## Local Console Test

Start with mock search/playback so you can verify the command flow without Feishu or NetEase:

```text
BOT_TRANSPORT=console
MUSIC_PROVIDER=mock
PLAYER_ADAPTER=mock
```

Run:

```bash
npm run dev
```

Console input format:

```text
u1 点歌 晴天 周杰伦
u2 队列
u1 撤销我的点歌
```

## Feishu Mode

In the Feishu developer console:

1. Create an internal app.
2. Enable bot capability.
3. Add the bot to your target group.
4. Subscribe to `im.message.receive_v1`.
5. Use long connection event subscription.
6. Grant message send plus image upload/send permissions so the bot can post NetEase login QR codes when needed.
7. Copy the app id and app secret into `.env`.

Then set:

```text
BOT_TRANSPORT=feishu
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
BOT_DISPLAY_NAME=点歌机器人
```

Feishu users can request songs with either format:

```text
@点歌机器人 点歌 晴天 周杰伦
@点歌机器人 晴天 周杰伦
```

Supported chat commands:

```text
队列
当前播放
撤销我的点歌
帮助
```

Playback management is intentionally handled by the local admin page instead of Feishu admin commands.

## NetEase Playback

For real playback:

```text
MUSIC_PROVIDER=netease-web
PLAYER_ADAPTER=netease-web
NETEASE_HEADLESS=false
NETEASE_USER_DATA_DIR=.playwright/netease-profile
CHROME_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Start the service and request a song. A normal browser window opens. Log in to NetEase Cloud Music in that window. The login state is stored under `NETEASE_USER_DATA_DIR`.

If the NetEase web login state expires, the bot checks the playback page, posts a login notice and QR image to the last active Feishu group, and then thanks the NetEase account name it sees after login recovers. If the QR image does not arrive in Feishu, verify the app's image upload/send permissions in the Feishu developer console.

If `CHROME_EXECUTABLE_PATH` is empty, install Playwright Chromium:

```bash
npx playwright install chromium
```

## Admin Page

The admin page is enabled by default:

```text
ADMIN_SERVER_ENABLED=true
ADMIN_SERVER_HOST=0.0.0.0
ADMIN_SERVER_PORT=3333
HISTORY_DB_PATH=.data/play-history.sqlite
```

Set `ADMIN_SERVER_HOST=127.0.0.1` if you want the page to be accessible only from the playback computer.

## Health Check

Run this after editing `.env`:

```bash
npm run doctor
```

It checks common deployment issues, including Node.js version, Feishu credentials, Chrome path, admin host/port, and history database path.

## Production Run

```bash
npm ci
npm run build
npm start
```

`npm run build` builds both the Node.js service and the React admin console into `public/`.

For a Windows always-on setup, see [docs/windows-service.md](docs/windows-service.md).

## Documentation

- [Deployment guide](docs/deployment.md)
- [Architecture](docs/architecture.md)
- [Windows service setup](docs/windows-service.md)
- [Contributing](CONTRIBUTING.md)

## Limitations

- The queue is in memory and clears on service restart.
- Play history is persisted in SQLite for the latest 7 days.
- NetEase playback depends on account permissions and web page structure.
- Some tracks may require VIP, desktop client playback, or may be unavailable.

## License

MIT
