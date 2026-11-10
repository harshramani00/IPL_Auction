import { describe, expect, it } from "vitest";
import { MIN_PRICE, aiReserve, drawValuations } from "../src/ai.js";
import {
  SQUAD_MAX, TEAM_IDS, aiTurn, bid, claim, createRoom, join, nextAmount, snapshot, start,
  type TeamId, type TeamState,
} from "../src/index.js";
import { serverGameData } from "../src/serverData.js";
import { T0, lot, player, seq, testData, users } from "./helpers.js";
import { seeded, simulate } from "./simulate.js";

const [u1] = users as [typeof users[0]];

function aiRoom(rngValues: number[]) {
  const s = createRoom("r1");
  join(s, u1);
  claim(s, u1.id, "MI");
  start(s, u1.id, testData({ lots: [lot(1, { tier: "A" }), lot(2)] }), T0, seq(...rngValues));
  return s;
}

describe("AI franchises", () => {
  it("values tier A lots at base x 3–9, then x 0.7–1.15 per team", () => {
    const low = aiRoom([0]); // every draw at the bottom of its range
    for (const v of Object.values(low.aiValues)) expect(v).toBe(Math.round(200 * 3 * 0.7));
    const high = aiRoom([0.999999]);
    for (const v of Object.values(high.aiValues)) expect(v).toBe(Math.round(200 * 9 * 1.15));
    expect(Object.keys(low.aiValues)).toHaveLength(9); // the 9 unclaimed teams
  });

  it("never bids above its valuation and never against itself", () => {
    const s = aiRoom([0.1]);
    const values = { ...s.aiValues };
    let now = T0;
    for (let i = 0; i < 500 && aiTurn(s, ++now, seq(0.1)); i++) {
      expect(s.lead!.bySeat).toBeNull();
      expect(s.lead!.amount).toBeLessThanOrEqual(values[s.lead!.teamId]!);
    }
    const next = nextAmount(s.queue[0]!, s.lead);
    const stillWilling = s.aiTeams.filter((t) => t !== s.lead!.teamId && values[t]! >= next);
    expect(stillWilling).toEqual([]);
  });

  it("only bids with probability 0.75", () => {
    const s = aiRoom([0.5]);
    expect(aiTurn(s, T0, seq(0.8))).toBe(false);
    expect(aiTurn(s, T0, seq(0.7, 0))).toBe(true);
  });

  it("outbids a human, who can then bid again", () => {
    const s = aiRoom([0.5]);
    bid(s, u1.id, "MI", 200, T0);
    expect(aiTurn(s, T0 + 1, seq(0))).toBe(true);
    expect(s.lead!.teamId).not.toBe("MI");
    expect(bid(s, u1.id, "MI", 240, T0 + 2).ok).toBe(true);
  });

  it("keeps valuations and real prices out of the public snapshot", () => {
    const s = aiRoom([0.5]);
    s.market = { 1: 2520 };
    const snap = snapshot(s, T0);
    expect(JSON.stringify(snap)).not.toContain("aiValues");
    expect(JSON.stringify(snap)).not.toContain("2520");
    expect(snap.nextAmount).toBe(200);
    expect(snap.serverNow).toBe(T0);
  });
});

describe("AI valuations anchored on the real auction", () => {
  const ai = ["CSK", "RCB", "KKR", "GT"] as const;
  const teams = (purses: Partial<Record<TeamId, number>>) => Object.fromEntries(TEAM_IDS.map((id) => {
    const team: TeamState = { id, purse: purses[id] ?? 5000, squad: [] };
    return [id, team];
  })) as Record<TeamId, TeamState>;

  it("only two or three teams want a player who really sold, at about his real price", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const v = drawValuations(lot(1), 1000, [...ai], teams({}), seeded(seed));
      const keen = Object.values(v).filter((x) => x! > 0).sort((a, b) => b! - a!);
      expect(keen.length).toBeGreaterThanOrEqual(2);
      expect(keen.length).toBeLessThanOrEqual(3);
      // The two keenest bracket the market value: real price x 0.85–1.15, x 0.93–1.07.
      for (const x of keen.slice(0, 2)) {
        expect(x).toBeGreaterThanOrEqual(Math.floor(1000 * 0.85 * 0.93));
        expect(x).toBeLessThanOrEqual(Math.ceil(1000 * 1.15 * 1.07));
      }
    }
  });

  it("prefers teams that can afford him", () => {
    // Only CSK and RCB have the money for a 10 Cr player.
    const purses = { CSK: 3000, RCB: 3000, KKR: 400, GT: 400 };
    for (let seed = 1; seed <= 30; seed++) {
      const v = drawValuations(lot(1), 1000, [...ai], teams(purses), seeded(seed));
      expect(v.CSK).toBeGreaterThan(700);
      expect(v.RCB).toBeGreaterThan(700);
    }
  });

  it("rarely wants a player who went unsold, and then only near base", () => {
    let interested = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const v = Object.values(drawValuations(lot(1), null, [...ai], teams({}), seeded(seed))).filter((x) => x! > 0);
      expect(v.length).toBeLessThanOrEqual(1);
      for (const x of v) expect(x).toBeLessThanOrEqual(200 * 1.4);
      interested += v.length;
    }
    expect(interested / 200).toBeGreaterThan(0.15);
    expect(interested / 200).toBeLessThan(0.45);
  });

  it("keeps purse back for the squad slots still to fill", () => {
    expect(aiReserve({ id: "GT", purse: 1000, squad: Array(20).fill(player("x")) })).toBe(MIN_PRICE * 4);
    const s = aiRoom([0.5]);
    s.teams.GT = { id: "GT", purse: 500, squad: Array(10).fill(player("x")) }; // reserve 14 x 30 L = 420 L
    s.aiTeams = ["GT"];
    s.aiValues = { GT: 10_000 };
    expect(aiTurn(s, T0, seq(0))).toBe(true); // 200 L would leave less than the reserve, so GT skips
    expect(s.lead).toBeNull();
    expect(s.skipped).toEqual(["GT"]);
  });

  it("plays the real Quick auction about as the real one went", () => {
    const ratios: number[] = [];
    let sold = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const end = simulate(serverGameData, "quick", seed);
      for (const r of end.results) {
        total++;
        if (r.status !== "sold") continue;
        sold++;
        const real = serverGameData.market![r.lotId];
        if (real) ratios.push(r.amount! / real);
        else expect(r.amount!).toBeLessThanOrEqual(200 * 1.4); // went unsold for real: near base at most
      }
      for (const t of end.aiTeams) {
        expect(end.teams[t].purse).toBeGreaterThanOrEqual(MIN_PRICE * (SQUAD_MAX - end.teams[t].squad.length));
      }
    }
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)]!;
    expect(sold / total).toBeGreaterThan(0.55); // 11 of 16 sold for real
    expect(sold / total).toBeLessThan(0.9);
    expect(median).toBeGreaterThan(0.85);
    expect(median).toBeLessThan(1.15);
  });
});
