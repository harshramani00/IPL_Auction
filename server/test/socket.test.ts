// The real server over real sockets: identity comes from the session cookie,
// every request gets one ack, and hand-crafted requests can't act for others.
import type { AddressInfo } from "node:net";
import type { Ack, Snapshot } from "@auction/shared";
import { gameData } from "@auction/shared/data";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../src/app.js";
import { CookieAuth } from "../src/auth.js";

const SECRET = "test-secret";
const auth = new CookieAuth(SECRET);
let app: App;
let base: string;

beforeAll(async () => {
  app = createApp({ port: 0, cookieSecret: SECRET, aiEnabled: false, clientOrigin: null }, { data: gameData });
  await new Promise<void>((done) => app.httpServer.listen(0, done));
  base = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

const cookieFor = (name: string) => auth.issue(name, null).setCookie.split(";")[0]!;

interface Client {
  socket: Socket;
  state: () => Snapshot;
  send: (req: object) => Promise<Ack>;
}

async function client(roomId: string, cookie?: string): Promise<Client> {
  const socket = connect(base, {
    auth: { roomId }, transports: ["websocket"], forceNew: true,
    extraHeaders: cookie ? { cookie } : {},
  });
  let latest: Snapshot | null = null;
  socket.on("state", (s: Snapshot) => (latest = s));
  await new Promise<void>((done) => socket.once("state", () => done()));
  let n = 0;
  const send = (req: object) => new Promise<Ack>((done) => {
    const requestId = `r${++n}-${Math.random()}`;
    const onAck = (a: Ack) => {
      if (a.requestId !== requestId) return;
      socket.off("ack", onAck);
      done(a);
    };
    socket.on("ack", onAck);
    socket.emit("request", { requestId, ...req });
  });
  return { socket, state: () => latest!, send };
}

const settle = () => new Promise((r) => setTimeout(r, 50));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response | Promise<Response>): Promise<any> => (await res).json();

describe("HTTP", () => {
  it("issues a signed session cookie and creates rooms", async () => {
    const res = await fetch(`${base}/api/session`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  Harsh " }),
    });
    const { user } = await json(res);
    expect(user.name).toBe("Harsh");
    const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
    const me = await json(fetch(`${base}/api/session`, { headers: { cookie } }));
    expect(me.user).toEqual(user);
    const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await json(fetch(`${base}/api/session`, { headers: { cookie: tampered } }))).user).toBeNull();

    const room = await json(fetch(`${base}/api/rooms`, { method: "POST" }));
    expect(room.id).toMatch(/^[A-Z0-9]{6}$/);
    expect((await fetch(`${base}/api/rooms/${room.id}`)).status).toBe(200);
    expect((await fetch(`${base}/api/rooms/NOPE99`)).status).toBe(404);
  });
});

describe("sockets", () => {
  it("rejects unknown rooms", async () => {
    const socket = connect(base, { auth: { roomId: "NOPE99" }, transports: ["websocket"], forceNew: true });
    const err = await new Promise<{ reason: string }>((done) => socket.once("room-error", done));
    expect(err.reason).toMatch(/doesn't exist/);
    socket.close();
  });

  it("binds every request to the session, not the payload", async () => {
    const roomId = app.createRoom().id;
    const a = await client(roomId, cookieFor("Alice"));
    const b = await client(roomId, cookieFor("Bob"));
    expect((await a.send({ type: "join" })).ok).toBe(true);
    expect((await b.send({ type: "join" })).ok).toBe(true);
    expect((await a.send({ type: "claim", teamId: "MI" })).ok).toBe(true);
    expect((await b.send({ type: "claim", teamId: "MI" })))
      .toMatchObject({ ok: false, reason: "MI is already taken" });
    expect((await b.send({ type: "claim", teamId: "RR" })).ok).toBe(true);
    expect((await b.send({ type: "start" }))).toMatchObject({ ok: false, reason: "Only the room lead can do that" });
    expect((await a.send({ type: "start" })).ok).toBe(true);
    await settle();

    const before = b.state();
    // Bob hand-crafts a bid for Alice's team, even claiming to be her.
    const forged = await b.send({ type: "bid", teamId: "MI", amount: before.nextAmount, userId: a.state().seats[0]!.userId });
    expect(forged).toMatchObject({ ok: false });
    const crafted = await b.send({ type: "bid", teamId: "MI", amount: before.nextAmount });
    expect(crafted).toEqual(expect.objectContaining({ ok: false, reason: "You can only bid for your own teams" }));
    await settle();
    expect(b.state().bidSeq).toBe(before.bidSeq);
    expect(b.state().lead).toBeNull();

    expect((await b.send({ type: "bid", teamId: "RR", amount: before.nextAmount })).ok).toBe(true);
    await settle();
    expect(a.state().lead).toMatchObject({ teamId: "RR", bySeat: 2 });
    a.socket.close(); b.socket.close();
  });

  it("acks malformed requests, rate-limits floods and refuses spectators", async () => {
    const roomId = app.createRoom().id;
    const c = await client(roomId, cookieFor("Carol"));
    expect(await c.send({ type: "bid", teamId: "XYZ", amount: -5 }))
      .toMatchObject({ ok: false, reason: "That request wasn't understood" });
    const acks = await Promise.all(Array.from({ length: 20 }, () => c.send({ type: "pause" })));
    expect(acks.some((a) => a.reason?.startsWith("Slow down"))).toBe(true);

    const spectator = await client(roomId);
    expect(spectator.state().roomId).toBe(roomId);
    expect(await spectator.send({ type: "join" }))
      .toMatchObject({ ok: false, reason: "Pick a display name to take part" });
    c.socket.close(); spectator.socket.close();
  });
});
