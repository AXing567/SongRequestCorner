# Contributing

Thanks for improving Song Request Corner.

## Development

```bash
npm install
copy .env.example .env
npm run doctor
npm run dev
```

Run checks before opening a pull request:

```bash
npm run check
```

## Project Boundaries

- Feishu is the first supported chat platform.
- NetEase web playback uses the user's own account and must not bypass copyright restrictions.
- Playback control should remain centralized in `PlaybackEngine`.
- Queue state is in memory; play history is persisted through `HistoryStore`.

## Adding Integrations

Prefer adding integrations behind existing interfaces:

- `BotTransport` for chat platforms.
- `MusicProvider` for search.
- `PlayerAdapter` for playback control.

Include tests for new behavior and update docs when configuration changes.
