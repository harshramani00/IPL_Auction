// HTTP routes (sessions, rooms) and the Socket.IO protocol.
//
// Client -> server: "request" {requestId, type, ...}  (join, leave, claim, release,
//                   settings, start, bid, pause, reset)
// Server -> client: "hello" {user}       once, who this connection is
//                   "state" Snapshot     after every change
//                   "ack" {requestId, ok, reason?}  exactly one per request
//                   "room-error" {reason} room doesn't exist (then disconnects)
import { existsSync } from "node:fs";
import { createServer, type Server as HttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { Ack, GameData, Request, User } from "@auction/shared";
import express from "express";
import { Server as IOServer } from "socket.io";
import { CookieAuth, type AuthProvider } from "./auth.js";
import type { Config } from "./config.js";
import { Room, type Clock } from "./room.js";
import { nameSchema, requestSchema, roomIdSchema } from "./schemas.js";
import { MemoryRoomStore, type RoomStore } from "./store.js";

const RATE_PER_SECOND = 10;
const IDLE_ROOM_MS = 2 * 60 * 60 * 1000;

export interface AppDeps {
  data: GameData;
  store?: RoomStore;
  auth?: AuthProvider;
  clock?: Clock;
  rng?: () => number;
}

export interface App {
  httpServer: HttpServer;
  io: IOServer;
  store: RoomStore;
  createRoom(): Room;
  close(): Promise<void>;
}

/** Token bucket: up to `rate` requests per second per socket. */
function rateLimiter(rate: number) {
  let tokens = rate;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(rate, tokens + ((now - last) / 1000) * rate);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function createApp(config: Config, deps: AppDeps): App {
  const auth = deps.auth ?? new CookieAuth(config.cookieSecret);
  const store = deps.store ?? new MemoryRoomStore();
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  const httpServer = createServer(app);
  const io = new IOServer(httpServer, {
    cors: config.clientOrigin ? { origin: config.clientOrigin, credentials: true } : undefined,
  });

  const createRoom = () => {
    const id = store.newId();
    const room = new Room(id, {
      data: deps.data,
      aiEnabled: config.aiEnabled,
      shuffleSets: config.shuffleSets,
      clock: deps.clock,
      rng: deps.rng,
      onChange: (snap) => io.to(id).emit("state", snap),
    });
    store.add(room);
    return room;
  };

  // ---- HTTP
  app.get("/api/session", (req, res) => {
    res.json({ user: auth.userFromCookie(req.headers.cookie) });
  });

  app.post("/api/session", (req, res) => {
    const parsed = nameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid name" });
      return;
    }
    const { user, setCookie } = auth.issue(parsed.data.name, auth.userFromCookie(req.headers.cookie));
    res.setHeader("Set-Cookie", setCookie).json({ user });
  });

  app.post("/api/rooms", (_req, res) => {
    res.status(201).json({ id: createRoom().id });
  });

  app.get("/api/rooms/:id", (req, res) => {
    const room = roomIdSchema.safeParse(req.params.id).success ? store.get(req.params.id) : undefined;
    if (!room) {
      res.status(404).json({ error: "No room with that code" });
      return;
    }
    res.json({ id: room.id, phase: room.state.phase, players: room.state.seats.filter(Boolean).length });
  });

  // Production: serve the built client (in dev, Vite serves it and proxies /api and /socket.io).
  const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile("index.html", { root: clientDist }));
  }

  // ---- Sockets
  io.on("connection", (socket) => {
    const user: User | null = auth.userFromCookie(socket.handshake.headers.cookie);
    const roomId = String(socket.handshake.auth?.roomId ?? socket.handshake.query.roomId ?? "");
    const room = roomIdSchema.safeParse(roomId).success ? store.get(roomId) : undefined;
    if (!room) {
      socket.emit("room-error", { reason: "That room doesn't exist (it may have ended)" });
      socket.disconnect(true);
      return;
    }

    void socket.join(room.id);
    socket.emit("hello", { user });
    room.connect(user);
    socket.emit("state", room.snapshot());

    const allow = rateLimiter(RATE_PER_SECOND);
    socket.on("request", (payload: unknown) => {
      const requestId = typeof (payload as { requestId?: unknown })?.requestId === "string"
        ? (payload as { requestId: string }).requestId.slice(0, 64)
        : null;
      const ack = (a: Omit<Ack, "requestId">) => {
        if (requestId) socket.emit("ack", { requestId, ...a } satisfies Ack);
      };
      if (!allow()) return ack({ ok: false, reason: "Slow down: too many requests" });
      const parsed = requestSchema.safeParse(payload);
      if (!parsed.success) return ack({ ok: false, reason: "That request wasn't understood" });
      const { requestId: _, ...request } = parsed.data;
      // Identity comes from the socket's session, never from the payload.
      const result = room.handle(user, request as Request);
      ack(result.ok ? { ok: true } : { ok: false, reason: result.reason });
    });

    socket.on("disconnect", () => room.disconnect(user));
  });

  // Drop rooms nobody has used for a while.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const id of store.ids()) {
      const room = store.get(id);
      if (room && room.connectedUsers === 0 && now - room.lastActive > IDLE_ROOM_MS) store.delete(id);
    }
  }, 10 * 60 * 1000);
  sweeper.unref();

  return {
    httpServer,
    io,
    store,
    createRoom,
    close: async () => {
      clearInterval(sweeper);
      await io.close();
      httpServer.closeAllConnections?.();
    },
  };
}
