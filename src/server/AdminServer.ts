import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize } from "node:path";
import { cwd } from "node:process";
import type { BotUser } from "../domain/types.js";
import type { PlaybackEngine } from "../playback/PlaybackEngine.js";
import type { QueueService } from "../queue/QueueService.js";

interface AdminServerOptions {
  host: string;
  port: number;
  queue: QueueService;
  playback: PlaybackEngine;
}

const ROOT_DIR = join(cwd(), "public");
const ADMIN_PANEL_USER: BotUser = { id: "admin-panel", name: "管理后台", role: "admin" };

export function startAdminServer(options: AdminServerOptions): Server {
  const server = createServer((request, response) => {
    void handleRequest(request, response, options).catch((error) => {
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  server.listen(options.port, options.host, () => {
    console.log(`[admin] http://${options.host}:${options.port}`);
    if (options.host === "0.0.0.0" || options.host === "::") {
      for (const address of localIPv4Addresses()) {
        console.log(`[admin] LAN http://${address}:${options.port}`);
      }
    }
  });

  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: AdminServerOptions
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url, options);
    return;
  }

  await serveStatic(url.pathname, response);
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: AdminServerOptions
): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/status") {
    const status = await options.playback.getStatus();
    writeJson(response, 200, {
      player: status,
      pending: options.queue.listPending()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/history") {
    writeJson(response, 200, options.queue.listHistoryPage(readHistoryQuery(url)));
    return;
  }

  const replayMatch = /^\/api\/history\/([^/]+)\/replay$/u.exec(url.pathname);
  if (request.method === "POST" && replayMatch) {
    const result = options.queue.replayHistoryItem(decodeURIComponent(replayMatch[1]!), ADMIN_PANEL_USER);
    if (!result) {
      writeJson(response, 404, { error: "history item not found" });
      return;
    }

    await options.playback.ensurePlaying();
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/playback/skip") {
    const body = await readJsonBody<{ expectedRevision?: number }>(request);
    const result = await options.playback.skip({ expectedRevision: body.expectedRevision });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/playback/pause") {
    const body = await readJsonBody<{ expectedRevision?: number }>(request);
    const result = await options.playback.pause({ expectedRevision: body.expectedRevision });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/playback/resume") {
    const body = await readJsonBody<{ expectedRevision?: number }>(request);
    const result = await options.playback.resume({ expectedRevision: body.expectedRevision });
    writeJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/clear") {
    writeJson(response, 410, { error: "queue clear is disabled" });
    return;
  }

  const removeMatch = /^\/api\/queue\/([^/]+)\/remove$/u.exec(url.pathname);
  if (request.method === "POST" && removeMatch) {
    const removed = options.queue.removePending(decodeURIComponent(removeMatch[1]!));
    writeJson(response, removed ? 200 : 404, { removed });
    return;
  }

  const moveMatch = /^\/api\/queue\/([^/]+)\/move$/u.exec(url.pathname);
  if (request.method === "POST" && moveMatch) {
    const body = await readJsonBody<{ direction?: "up" | "down" }>(request);
    if (body.direction !== "up" && body.direction !== "down") {
      writeJson(response, 400, { error: "direction must be up or down" });
      return;
    }

    const ok = options.queue.movePending(decodeURIComponent(moveMatch[1]!), body.direction);
    writeJson(response, ok ? 200 : 404, { ok });
    return;
  }

  writeJson(response, 404, { error: "not found" });
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/u, "");
  const absolutePath = normalize(join(ROOT_DIR, relativePath));
  if (!absolutePath.startsWith(ROOT_DIR) || !existsSync(absolutePath)) {
    writeJson(response, 404, { error: "not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(absolutePath)
  });
  createReadStream(absolutePath).pipe(response);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function contentTypeFor(pathname: string): string {
  switch (extname(pathname)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "text/html; charset=utf-8";
  }
}

export async function readAdminIndex(): Promise<string> {
  return readFile(join(ROOT_DIR, "index.html"), "utf8");
}

function readHistoryQuery(url: URL): { day?: string; page?: number; pageSize?: number } {
  const day = url.searchParams.get("day") || undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "20");
  return { day, page, pageSize };
}

function localIPv4Addresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}
