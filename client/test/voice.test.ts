import { incrementFor } from "@auction/shared";
import { gameData, teamInfo } from "@auction/shared/data";
import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_AMOUNT, catalogue, clip, spokenAmounts } from "../src/voice/clips";

const all = catalogue(gameData, Object.values(teamInfo));
const keys = new Set(all.map((c) => c.key));

describe("voice clips", () => {
  it("has one clip per key, each with words and a safe file name", () => {
    expect(keys.size).toBe(all.length);
    for (const c of all) {
      expect(c.key).toMatch(/^[a-z0-9-]+$/);
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("covers every player, role, team and stock phrase the events can ask for", () => {
    for (const lot of gameData.lots) {
      expect(keys.has(clip.name(lot.id))).toBe(true);
      expect(keys.has(clip.role(lot))).toBe(true);
      expect(keys.has(clip.amount(lot.base))).toBe(true);
    }
    for (const t of gameData.teams) {
      expect(keys.has(clip.city(t.id))).toBe(true);
      expect(keys.has(clip.to(t.id))).toBe(true);
    }
    for (const k of [clip.welcome, clip.base, clip.once, clip.twice, clip.sold, clip.unsold, clip.paused, clip.back, clip.done]) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it("has every price a bidding war can reach, up to the recorded ceiling", () => {
    const amounts = new Set(spokenAmounts(gameData.lots));
    // Each recorded price leads to another recorded price (or past the ceiling).
    for (const a of amounts) {
      const next = a + incrementFor(a);
      expect(next > MAX_SPOKEN_AMOUNT || amounts.has(next)).toBe(true);
    }
    expect(all.find((c) => c.key === clip.amount(675))?.text).toBe("6 crore 75 lakh.");
  });

  it("stays within a small recording budget", () => {
    expect(all.reduce((n, c) => n + c.text.length, 0)).toBeLessThan(10_000);
  });
});
