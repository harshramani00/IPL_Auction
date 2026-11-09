import { describe, expect, it } from "vitest";
import { aiTurn, bid, claim, createRoom, join, nextAmount, snapshot, start } from "../src/index.js";
import { T0, lot, seq, testData, users } from "./helpers.js";

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

  it("keeps valuations out of the public snapshot", () => {
    const s = aiRoom([0.5]);
    const snap = snapshot(s, T0);
    expect(JSON.stringify(snap)).not.toContain("aiValues");
    expect(snap.nextAmount).toBe(200);
    expect(snap.serverNow).toBe(T0);
  });
});
