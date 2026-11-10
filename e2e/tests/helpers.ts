import type { Ack, Snapshot } from "@auction/shared";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { io } from "socket.io-client";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
  cookie: string;
}

/**
 * A fresh browser context in the given view. The protocol tests use the
 * classic view: four headless browsers rendering the 3D hall in software
 * would mostly test the CPU. The hall has its own test.
 */
export async function newContext(browser: Browser, baseURL: string, view: "classic" | "3d" = "classic") {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript((v) => localStorage.setItem("ar-view", v), view);
  return context;
}

/** A browser context with a named session, opened on the room. */
export async function player(browser: Browser, baseURL: string, roomId: string, name: string, view: "classic" | "3d" = "classic"): Promise<Player> {
  const context = await newContext(browser, baseURL, view);
  const res = await context.request.post("/api/session", { data: { name } });
  expect(res.ok()).toBe(true);
  const session = (await context.cookies()).find((c) => c.name === "ar_session")!;
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".stage")).toBeVisible();
  return { name, context, page, cookie: `${session.name}=${session.value}` };
}

/** A visitor with no session at all. */
export async function spectator(browser: Browser, baseURL: string, roomId: string) {
  const context = await newContext(browser, baseURL);
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".stage")).toBeVisible();
  return { context, page };
}

/** The owner tag under a franchise paddle, found by city. */
export const ownerTag = (page: Page, city: string) =>
  page.locator(".seat", { has: page.locator(".sname", { hasText: city }) }).locator(".otag");

/** A raw socket, as a hand-crafted client would open one. */
export async function rawSocket(baseURL: string, roomId: string, cookie?: string) {
  const socket = io(baseURL, {
    auth: { roomId }, transports: ["websocket"], forceNew: true,
    extraHeaders: cookie ? { cookie } : {},
  });
  let latest: Snapshot | null = null;
  socket.on("state", (s: Snapshot) => (latest = s));
  await new Promise<void>((done) => socket.once("state", () => done()));
  let n = 0;
  const send = (req: Record<string, unknown>) => new Promise<Ack>((done) => {
    const requestId = `e2e-${++n}`;
    const onAck = (a: Ack) => {
      if (a.requestId !== requestId) return;
      socket.off("ack", onAck);
      done(a);
    };
    socket.on("ack", onAck);
    socket.emit("request", { requestId, ...req });
  });
  return { send, state: () => latest!, close: () => socket.close() };
}
