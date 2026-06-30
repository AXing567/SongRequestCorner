# Windows Always-On Setup

For daily office use, run Song Request Corner as an always-on process on the Windows playback computer.

## Option A: Task Scheduler

This is the simplest built-in option.

1. Build once:

   ```bash
   npm ci
   npm run build
   ```

2. Open Windows Task Scheduler.
3. Create a task.
4. Trigger: at log on, or at system startup.
5. Action:

   ```text
   Program: C:\Program Files\nodejs\node.exe
   Arguments: dist/index.js
   Start in: C:\path\to\SongRequestCorner
   ```

6. Enable restart on failure in task settings if available.

Use a visible desktop session during first NetEase login. After the login profile is saved, the task can start the service automatically.

## Option B: PM2

Install PM2:

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name song-request-corner
pm2 save
```

To make PM2 start with Windows, use a PM2 startup helper such as `pm2-windows-startup`.

## Option C: NSSM

NSSM can wrap Node.js as a Windows service.

Service settings:

```text
Application path: C:\Program Files\nodejs\node.exe
Arguments: dist/index.js
Startup directory: C:\path\to\SongRequestCorner
```

Use NSSM stdout/stderr log files so playback errors are visible.

## Operational Checklist

- Keep the playback computer awake.
- Keep speakers selected as the default output device.
- Keep `.env` private.
- Keep `NETEASE_HEADLESS=false` until login is complete.
- After changing `.env`, run:

  ```bash
  npm run doctor
  ```

- After pulling updates:

  ```bash
  npm ci
  npm run build
  npm start
  ```
