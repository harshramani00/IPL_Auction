import { describe, expect, it } from "vitest";
import { TEAM_IDS, claim, createRoom, join, start } from "../src/index.js";
import { gameData, statsByName } from "../src/data.js";
import { T0, seq } from "./helpers.js";

describe("generated game data", () => {
  it("has 369 lots and the three presets", () => {
    expect(gameData.lots).toHaveLength(369);
    expect(gameData.presets.quick.lots).toHaveLength(16);
    expect(gameData.presets.full.lots).toHaveLength(369);
    const ids = new Set(gameData.lots.map((l) => l.id));
    for (const p of Object.values(gameData.presets)) for (const id of p.lots) expect(ids.has(id)).toBe(true);
  });

  it("starts a real retained game with the pre-auction purses and squads", () => {
    const s = createRoom("r1");
    join(s, { id: "u1", name: "One" });
    claim(s, "u1", "MI");
    start(s, "u1", gameData, T0, seq(0.5));
    expect(TEAM_IDS.every((t) => s.teams[t].purse > 0)).toBe(true);
    expect(s.teams.MI.purse).toBe(275); // ₹2.75 Cr
    expect(s.teams.MI.squad).toHaveLength(20);
    expect(s.queue).toHaveLength(16);
  });

  it("has stats in the spec's shape", () => {
    const kohli = statsByName.get("Virat Kohli")!;
    expect(kohli.last).toMatchObject({ team: "RCB", m: 15, runs: 657 });
    expect(kohli.ipl).toMatchObject({ runs: 8661, hs: "113*" });
    expect(kohli.t20?.asof).toBe("2025-12-16");
  });
});
