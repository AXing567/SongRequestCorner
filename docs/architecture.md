# Architecture

Song Request Corner is organized around three replaceable boundaries:

- `BotTransport`: receives and sends chat messages.
- `MusicProvider`: searches for playable tracks.
- `PlayerAdapter`: controls the real playback surface.

The current recommended stack is:

```text
Feishu group -> FeishuTransport -> CommandService -> QueueService
                                             |       |
                                             |       -> PlaybackEngine -> NeteaseWebPlayerAdapter
                                             |
                                             -> NeteaseSearchProvider
```

## Runtime Flow

1. A Feishu user mentions the bot.
2. `FeishuTransport` normalizes the event into `IncomingMessage`.
3. `parseCommand` turns text into a command.
4. `CommandService` searches music and updates the queue.
5. `PlaybackEngine` serializes playback operations and starts songs.
6. `NeteaseWebPlayerAdapter` opens NetEase song pages and verifies the bottom player switched to the target track.
7. `LoginNotifier` watches login-aware players; when NetEase login expires, it asks the transport to send a QR image and later thanks the recovered account name.
8. The admin page polls `/api/status` and loads history from `/api/history`.

## Queue And History

- Pending queue and current song are in memory in `QueueService`.
- Played history is persisted through `HistoryStore`.
- The production store is `SqliteHistoryStore`, backed by `node:sqlite`.
- History is pruned to the latest 7 days.

## Playback Robustness

`PlaybackEngine` owns bot queue state. The player adapter reports real playback state.

For NetEase, the adapter reads the bottom-player text. If the real player leaves the bot current song, the engine reconciles state:

- with pending requested songs: record old song, clear provider playback, play next requested song;
- with no pending requested songs: record old song and let NetEase auto-play continue outside the bot queue.

Playback controls are serialized through one operation queue. The admin page sends `expectedRevision` so multiple clients clicking the same control do not execute duplicate skips.

## Extension Points

### Add a new chat platform

Implement `BotTransport`:

```typescript
interface BotTransport {
  start(onMessage: (message: IncomingMessage) => Promise<void>): Promise<void>;
  sendText(chatId: string, text: string): Promise<void>;
  sendImage?(chatId: string, image: PlayerLoginQrCode): Promise<void>;
  replyText?(messageId: string, text: string): Promise<void>;
}
```

Then add a config option and wire it in `createTransport`.

### Add a new music provider

Implement `MusicProvider`:

```typescript
interface MusicProvider {
  search(request: SearchRequest): Promise<Track[]>;
}
```

The first returned track is currently selected automatically.

### Add a new player

Implement `PlayerAdapter`:

```typescript
interface PlayerAdapter {
  getStatus(): Promise<PlayerStatus>;
  play(item: QueueItem): Promise<void>;
  skip(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  clear(): Promise<void>;
}
```

The adapter should only report `current` when the real player is actually on the bot-requested song.

Players that can detect session state may also implement `LoginAwarePlayerAdapter`:

```typescript
interface LoginAwarePlayerAdapter extends PlayerAdapter {
  getLoginStatus(): Promise<PlayerLoginStatus>;
}
```

`LoginNotifier` uses that optional method to send NetEase QR-code login prompts through the active `BotTransport`.

## HTTP Admin API

- `GET /api/status`
- `GET /api/history?page=<n>&pageSize=<n>&day=<YYYY-MM-DD>`
- `POST /api/history/:id/replay`
- `POST /api/playback/skip`
- `POST /api/playback/pause`
- `POST /api/playback/resume`
- `POST /api/queue/:id/remove`
- `POST /api/queue/:id/move`

`POST /api/queue/clear` intentionally returns `410` to avoid accidental full queue deletion.

## Admin Frontend

The admin page is a Vite + React + TypeScript app under `src/admin`.

```text
src/admin/index.html
src/admin/src/AdminApp.tsx
src/admin/src/components/
src/admin/src/hooks/
src/admin/src/api/
src/admin/src/types/
src/admin/src/motion/
```

Build output goes to `public/`, which is still served by `src/server/AdminServer.ts`. This keeps the backend static-file contract unchanged.

Key conventions:

- API calls live in `src/admin/src/api/adminApi.ts`.
- API response types live in `src/admin/src/types/api.ts`.
- Motion constants live in `src/admin/src/motion/presets.ts`.
- Components should use lucide-react icons and Framer Motion for focused micro-interactions.
- Do not add a clear-queue action to the UI.
