// The 3D hall: it loads, runs alongside the normal controls, and follows the auction.
import { expect, test } from "@playwright/test";
import { player } from "./helpers";

test("the 3D hall renders, captions each moment and falls back to classic on request", async ({ browser, baseURL, request }) => {
  const roomId = (await (await request.post("/api/rooms")).json()).id;
  const p = await player(browser, baseURL!, roomId, "Hall", "3d");
  const errors: string[] = [];
  p.page.on("pageerror", (e) => errors.push(e.message));

  await expect(p.page.locator(".hall canvas")).toBeVisible({ timeout: 15_000 });
  await expect(p.page.locator(".pcard")).toHaveCount(0); // the hall's screen shows the player

  await p.page.getByRole("button", { name: "Join the auction" }).click();
  await p.page.getByRole("button", { name: "Claim Kolkata" }).click();
  await p.page.getByRole("button", { name: "Start the auction" }).click();
  await expect(p.page.locator(".hall-caption")).toContainText("Welcome to the auction");

  await p.page.locator(".bidbtn").click();
  await expect(p.page.locator(".hall-caption")).toContainText("2 crore, Kolkata.");
  await expect(p.page.locator(".bp-team")).toContainText("Kolkata Knight Riders");

  // The view toggle swaps to the classic layout and remembers it.
  await p.page.getByRole("button", { name: "Classic" }).click();
  await expect(p.page.locator(".hall")).toHaveCount(0);
  await expect(p.page.locator(".pcard")).toBeVisible();
  expect(await p.page.evaluate(() => localStorage.getItem("ar-view"))).toBe("classic");

  expect(errors).toEqual([]);
  await p.context.close();
});

test("reduced motion starts in the classic view", async ({ browser, baseURL, request }) => {
  const roomId = (await (await request.post("/api/rooms")).json()).id;
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(`/r/${roomId}`);
  await expect(page.locator(".stage")).toBeVisible();
  await expect(page.locator(".hall")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Classic" })).toHaveAttribute("aria-pressed", "true");
  await context.close();
});
