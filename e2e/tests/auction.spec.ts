// Spec acceptance tests 7–11: four people and a spectator in one room, each
// in their own browser context (their own session), against the real server.
import { expect, test } from "@playwright/test";
import { ownerTag, player, rawSocket, spectator, type Player } from "./helpers";

test.describe.configure({ mode: "serial" });

let roomId: string;
let base: string;
let p1: Player, p2: Player, p3: Player, p4: Player;
const everyone = () => [p1, p2, p3, p4];

test.beforeAll(async ({ request, baseURL }) => {
  base = baseURL!;
  const res = await request.post("/api/rooms");
  roomId = (await res.json()).id;
});

test.afterAll(async () => {
  for (const p of [p1, p2, p3, p4]) await p?.context.close();
});

test("7. later joins trim P1 back to their first two claims", async ({ browser }) => {
  p1 = await player(browser, base, roomId, "Alice");
  await p1.page.getByRole("button", { name: "Join the auction" }).click();
  await expect(p1.page.locator(".pchip.me")).toContainText("P1");

  // Alone, P1 may run all 10; claim four, one at a time so the order is certain.
  for (const city of ["Mumbai", "Chennai", "Bengaluru", "Kolkata"]) {
    await p1.page.getByRole("button", { name: `Claim ${city}` }).click();
    await expect(ownerTag(p1.page, city)).toHaveText("P1 · Alice");
  }

  p2 = await player(browser, base, roomId, "Bob");
  p3 = await player(browser, base, roomId, "Cara");
  p4 = await player(browser, base, roomId, "Dev");
  for (const p of [p2, p3, p4]) {
    await p.page.getByRole("button", { name: "Join the auction" }).click();
    await expect(p.page.locator(".pchip.me")).toBeVisible();
  }

  // Four players: cap 2. P1 keeps Mumbai and Chennai; the later claims are freed.
  for (const p of everyone()) {
    await expect(p.page.locator(".room-h h3")).toContainText("4 / 10");
    await expect(ownerTag(p.page, "Mumbai")).toContainText("P1 · Alice");
    await expect(ownerTag(p.page, "Chennai")).toContainText("P1 · Alice");
    await expect(ownerTag(p.page, "Bengaluru")).toHaveText("Free");
    await expect(ownerTag(p.page, "Kolkata")).toHaveText("Free");
  }
});

test("8. a bid shows up on every client within 500 ms", async () => {
  await p2.page.getByRole("button", { name: "Claim Bengaluru" }).click();
  await p3.page.getByRole("button", { name: "Claim Kolkata" }).click();
  await p4.page.getByRole("button", { name: "Claim Hyderabad" }).click();
  await expect(ownerTag(p1.page, "Hyderabad")).toContainText("P4 · Dev");
  await expect(ownerTag(p1.page, "Kolkata")).toContainText("P3 · Cara");

  // Only the lead (P1) gets a start button.
  for (const p of [p2, p3, p4]) await expect(p.page.getByRole("button", { name: "Start the auction" })).toHaveCount(0);
  await p1.page.getByRole("button", { name: "Start the auction" }).click();
  for (const p of everyone()) await expect(p.page.locator(".bp-team")).toHaveText("No bids yet");

  const bid = p3.page.locator(".bidbtn");
  await expect(bid).toHaveText(/^Bid ₹ 2\.00 Cr as KKR$/);
  await bid.click();
  await Promise.all(everyone().map((p) =>
    expect(p.page.locator(".bp-team")).toContainText("Kolkata Knight Riders", { timeout: 500 })));
  await expect(p1.page.locator(".bp-team")).toContainText("P3 · Cara");
});

test("9. a hand-crafted bid for someone else's team is rejected and changes nothing", async () => {
  const before = await p1.page.locator(".bp-amt").textContent();
  const bidsBefore = await p1.page.locator(".hist li").count();

  // P4 opens their own socket (their real session) and bids for P3's team.
  const forger = await rawSocket(base, roomId, p4.cookie);
  const next = forger.state().nextAmount!;
  const ack = await forger.send({ type: "bid", teamId: "KKR", amount: next });
  expect(ack).toMatchObject({ ok: false, reason: "You can only bid for your own teams" });
  // Claiming to be P3 in the payload doesn't help either.
  const spoofed = await forger.send({ type: "bid", teamId: "KKR", amount: next, userId: "p3", seat: 3 });
  expect(spoofed.ok).toBe(false);
  forger.close();

  await p1.page.waitForTimeout(300);
  for (const p of everyone()) {
    await expect(p.page.locator(".bp-amt")).toHaveText(before!);
    await expect(p.page.locator(".bp-team")).toContainText("Kolkata Knight Riders");
  }
  expect(await p1.page.locator(".hist li").count()).toBe(bidsBefore);
});

test("10. when the clock runs out: SOLD, bails off, next lot ~3 s later", async () => {
  // Nobody bids again; the 8-second clock runs down.
  await Promise.all(everyone().map(async (p) => {
    await expect(p.page.locator(".sold-banner .sb-big")).toHaveText("Sold", { timeout: 12_000 });
    await expect(p.page.locator(".stumps")).toHaveClass(/\bdown\b/);
  }));
  const soldAt = Date.now();
  await expect(p1.page.locator(".sold-banner .sb-sub")).toContainText("Kolkata Knight Riders");
  await expect(p1.page.locator(".results .res").first()).toContainText("₹ 2.00 Cr");

  await Promise.all(everyone().map((p) =>
    expect(p.page.locator(".brand .sub")).toContainText("Lot 2 / 16", { timeout: 6000 })));
  const gap = Date.now() - soldAt;
  expect(gap).toBeGreaterThan(2000);
  expect(gap).toBeLessThan(4500);
  for (const p of everyone()) {
    await expect(p.page.locator(".sold-banner")).toHaveCount(0);
    await expect(p.page.locator(".stumps")).not.toHaveClass(/\bdown\b/);
  }
  // KKR paid for its player.
  await expect(p3.page.locator(".console .con-stats")).toContainText("₹ 62.30 Cr");
});

test("11. a spectator sees everything, has no console, and every request fails", async ({ browser }) => {
  const watcher = await spectator(browser, base, roomId);
  const page = watcher.page;
  await expect(page.locator(".brand .sub")).toContainText("Lot 2 / 16");
  await expect(page.locator(".results .res").first()).toContainText("Kolkata");
  await expect(page.locator(".console")).toHaveCount(0);
  await expect(page.locator(".conn")).toHaveText("Watching");
  for (const btn of await page.locator(".paddle").all()) await expect(btn).toBeDisabled();

  // Live updates still arrive: P1 bids with Mumbai.
  await p1.page.locator(".bidbtn").click();
  await expect(page.locator(".bp-team")).toContainText("Mumbai Indians");

  // Over the socket: no session, so nothing is allowed.
  const anon = await rawSocket(base, roomId);
  for (const req of [{ type: "join" }, { type: "pause" }, { type: "bid", teamId: "MI", amount: 500 }]) {
    expect(await anon.send(req)).toMatchObject({ ok: false, reason: "Pick a display name to take part" });
  }
  anon.close();

  // Even with a name, a latecomer can't take a seat mid-auction.
  const late = await player(browser, base, roomId, "Late");
  const lateSocket = await rawSocket(base, roomId, late.cookie);
  expect(await lateSocket.send({ type: "join" })).toMatchObject({ ok: false, reason: expect.stringContaining("auction has started") });
  await expect(late.page.locator(".console")).toHaveCount(0);
  lateSocket.close();
  await late.context.close();
  await watcher.context.close();
});
