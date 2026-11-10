import { describe, expect, it } from "vitest";
import {
  BID_MS, OPEN_MS, RESULT_MS,
  advance, bid, capFor, claim, createRoom, incrementFor, join, leave, nextAmount, nextWake,
  pause, release, reset, start, startProblems, teamsOf, updateSettings,
  type RoomState,
} from "../src/index.js";
import { T0, lot, player, seq, testData, users } from "./helpers.js";

const [u1, u2, u3, u4] = users as [typeof users[0], typeof users[0], typeof users[0], typeof users[0]];
const rng = seq(0.5);

/** Room with the given users seated and their claims made, started at T0. */
function liveRoom(data = testData(), setup: (s: RoomState) => void = (s) => {
  join(s, u1); join(s, u2);
  claim(s, u1.id, "MI"); claim(s, u2.id, "CSK");
}): RoomState {
  const s = createRoom("r1");
  setup(s);
  expect(start(s, u1.id, data, T0, rng)).toEqual({ ok: true });
  return s;
}

describe("team cap", () => {
  it("1. capFor gives 10, 5, 3, 2, 2, 1, 1, 1, 1, 1 for 1..10 players", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(capFor)).toEqual([10, 5, 3, 2, 2, 1, 1, 1, 1, 1]);
  });

  it("6. a join that lowers the cap trims the most recently claimed teams", () => {
    const s = createRoom("r1");
    join(s, u1);
    for (const t of ["MI", "CSK", "RCB", "KKR"] as const) expect(claim(s, u1.id, t).ok).toBe(true);
    join(s, u2); // cap 5: nothing lost
    expect(teamsOf(s, 1)).toEqual(["MI", "CSK", "RCB", "KKR"]);
    join(s, u3); // cap 3: KKR (claimed last) goes
    expect(teamsOf(s, 1)).toEqual(["MI", "CSK", "RCB"]);
    join(s, u4); // cap 2: RCB goes
    expect(teamsOf(s, 1)).toEqual(["MI", "CSK"]);
    expect(s.owners.RCB).toBeNull();
    expect(s.owners.KKR).toBeNull();
  });

  it("trims by claim order, not team order", () => {
    const s = createRoom("r1");
    join(s, u1);
    claim(s, u1.id, "LSG"); claim(s, u1.id, "MI"); claim(s, u1.id, "GT");
    join(s, u2); join(s, u3); join(s, u4);
    expect(teamsOf(s, 1).sort()).toEqual(["LSG", "MI"]);
  });

  it("rejects claims over the cap and on taken teams", () => {
    const s = createRoom("r1");
    join(s, u1); join(s, u2); join(s, u3); join(s, u4); join(s, users[4]!); join(s, users[5]!);
    expect(claim(s, u1.id, "MI").ok).toBe(true);
    expect(claim(s, u1.id, "CSK")).toEqual({ ok: false, reason: "You can run up to 1 team" });
    expect(claim(s, u2.id, "MI")).toEqual({ ok: false, reason: "MI is already taken" });
  });
});

describe("seats", () => {
  it("joins take the lowest free seat and the 11th is turned away", () => {
    const s = createRoom("r1");
    for (const u of users.slice(0, 10)) expect(join(s, u).ok).toBe(true);
    expect(join(s, users[10]!)).toEqual({ ok: false, reason: "The room is full (10 players)" });
    leave(s, u2.id);
    join(s, users[10]!);
    expect(s.seats[1]?.userId).toBe(users[10]!.id);
  });

  it("leaving frees that player's teams; the next seat becomes lead", () => {
    const s = createRoom("r1");
    join(s, u1); join(s, u2);
    claim(s, u1.id, "MI");
    leave(s, u1.id);
    expect(s.owners.MI).toBeNull();
    expect(updateSettings(s, u2.id, { preset: "full" }).ok).toBe(true);
  });

  it("only the lead can start, and only once everyone has a team", () => {
    const s = createRoom("r1");
    join(s, u1); join(s, u2);
    claim(s, u1.id, "MI");
    expect(startProblems(s)).toEqual(["P2 hasn't claimed a team"]);
    expect(start(s, u1.id, testData(), T0, rng)).toEqual({ ok: false, reason: "P2 hasn't claimed a team" });
    claim(s, u2.id, "CSK");
    expect(start(s, u2.id, testData(), T0, rng)).toEqual({ ok: false, reason: "Only the room lead can do that" });
    expect(start(s, u1.id, testData(), T0, rng).ok).toBe(true);
    expect(join(s, u3).ok).toBe(false); // mid-auction visitors watch
    expect(release(s, u1.id, "MI").ok).toBe(false);
  });
});

describe("bidding", () => {
  it("2. increments: +5 L below 1 Cr, +10 L to 2 Cr, +20 L to 5 Cr, then +25 L", () => {
    const amounts = [95, 100, 195, 200, 480, 500, 1000];
    expect(amounts.map(incrementFor)).toEqual([5, 10, 10, 20, 20, 25, 25]);
    const l = lot(1);
    expect(nextAmount(l, null)).toBe(200);
    expect(amounts.map((a) => nextAmount(l, { teamId: "MI", amount: a, bySeat: 1 })))
      .toEqual([100, 110, 205, 220, 500, 525, 1025]);
  });

  it("3. a bid for a team the sender doesn't own is rejected", () => {
    const s = liveRoom();
    expect(bid(s, u2.id, "MI", 200, T0)).toEqual({ ok: false, reason: "You can only bid for your own teams" });
    expect(bid(s, u2.id, "RCB", 200, T0)).toEqual({ ok: false, reason: "You can only bid for your own teams" });
    expect(s.lead).toBeNull();
  });

  it("4. a stale amount is rejected; the right one is accepted and resets the clock to 45 s", () => {
    const s = liveRoom();
    expect(s.deadline).toBe(T0 + OPEN_MS);
    expect(bid(s, u1.id, "MI", 200, T0 + 1000).ok).toBe(true);
    expect(s.deadline).toBe(T0 + 1000 + BID_MS);
    // Two bids at the same next amount: the first wins, the second is stale.
    expect(bid(s, u2.id, "CSK", 220, T0 + 2000).ok).toBe(true);
    expect(bid(s, u1.id, "MI", 220, T0 + 2000))
      .toEqual({ ok: false, reason: "Someone got in first at that price. Bid again" });
    expect(s.lead).toEqual({ teamId: "CSK", amount: 220, bySeat: 2 });
    expect(s.deadline).toBe(T0 + 2000 + BID_MS);
    expect(s.bidSeq).toBe(2);
  });

  it("a team can't raise its own top bid, but the player's other teams can", () => {
    const s = liveRoom(testData(), (r) => {
      join(r, u1); claim(r, u1.id, "MI"); claim(r, u1.id, "CSK");
    });
    bid(s, u1.id, "MI", 200, T0);
    expect(bid(s, u1.id, "MI", 220, T0)).toEqual({ ok: false, reason: "MI already has the top bid" });
    expect(bid(s, u1.id, "CSK", 220, T0 + 100)).toEqual({ ok: true });
    expect(s.lead).toEqual({ teamId: "CSK", amount: 220, bySeat: 1 });
    expect(bid(s, u1.id, "MI", 240, T0 + 200)).toEqual({ ok: true });
  });

  it("non-players and closed lots are rejected", () => {
    const s = liveRoom();
    expect(bid(s, "stranger", "MI", 200, T0)).toEqual({ ok: false, reason: "Join the auction to bid" });
    pause(s, u1.id, T0);
    expect(bid(s, u1.id, "MI", 200, T0)).toEqual({ ok: false, reason: "The auction is paused" });
  });

  it("purse, squad size and overseas limits count retained players", () => {
    const overseas = Array.from({ length: 8 }, (_, i) => player(`OS ${i}`, { overseas: true }));
    const full = Array.from({ length: 25 }, (_, i) => player(`P ${i}`));
    const data = testData({ retained: { MI: overseas, CSK: full } });
    const s = liveRoom(data, (r) => {
      join(r, u1); join(r, u2); join(r, u3);
      claim(r, u1.id, "MI"); claim(r, u2.id, "CSK"); claim(r, u3.id, "RCB");
    });
    expect(bid(s, u2.id, "CSK", 200, T0)).toEqual({ ok: false, reason: "CSK's squad is full (25)" });
    s.teams.RCB.purse = 150;
    expect(bid(s, u3.id, "RCB", 200, T0)).toEqual({ ok: false, reason: "RCB can't afford ₹ 2.00 Cr" });
    expect(bid(s, u1.id, "MI", 200, T0).ok).toBe(true); // lot 1 is Indian: fine
    advance(s, T0 + BID_MS + RESULT_MS, rng); // sold to MI, lot 2 (overseas) opens
    expect(s.lotIndex).toBe(1);
    expect(bid(s, u1.id, "MI", 200, s.deadline! - 1))
      .toEqual({ ok: false, reason: "MI already has 8 overseas players" });
  });
});

describe("clock and hammer", () => {
  it("5. expiry with a lead sells: purse deducted, squad updated, result logged", () => {
    const s = liveRoom();
    bid(s, u1.id, "MI", 200, T0);
    bid(s, u2.id, "CSK", 220, T0 + 1000);
    expect(nextWake(s)).toBe(T0 + 1000 + BID_MS);
    expect(advance(s, T0 + 1000 + BID_MS - 1, rng)).toBe(false);
    expect(advance(s, T0 + 1000 + BID_MS, rng)).toBe(true);
    expect(s.phase).toBe("sold");
    expect(s.outcome).toMatchObject({ status: "sold", lotId: 1, teamId: "CSK", amount: 220, bySeat: 2 });
    expect(s.teams.CSK.purse).toBe(12000 - 220);
    expect(s.teams.CSK.squad).toEqual([expect.objectContaining({ name: "Player 1", price: 220, lotId: 1 })]);
    expect(s.results).toHaveLength(1);
  });

  it("5. expiry without a bid is unsold; next lot opens after the result pause; then done", () => {
    const s = liveRoom(); // quick preset: lots 1 and 2
    advance(s, T0 + OPEN_MS, rng);
    expect(s.outcome).toMatchObject({ status: "unsold", lotId: 1 });
    expect(s.teams.MI.purse).toBe(12000);
    advance(s, T0 + OPEN_MS + RESULT_MS, rng);
    expect(s.phase).toBe("live");
    expect(s.lotIndex).toBe(1);
    expect(s.deadline).toBe(T0 + OPEN_MS + RESULT_MS + OPEN_MS);
    advance(s, T0 + 2 * (OPEN_MS + RESULT_MS), rng);
    expect(s.phase).toBe("done");
    expect(s.results.map((r) => r.status)).toEqual(["unsold", "unsold"]);
  });

  it("pause keeps exactly the time that was left", () => {
    const s = liveRoom();
    bid(s, u1.id, "MI", 200, T0); // deadline T0 + BID_MS
    expect(pause(s, u2.id, T0 + 3000).ok).toBe(true);
    expect(s.pausedLeft).toBe(BID_MS - 3000);
    expect(advance(s, T0 + 100_000, rng)).toBe(false); // nothing resolves while paused
    expect(pause(s, u2.id, T0 + 100_000).ok).toBe(true);
    expect(s.deadline).toBe(T0 + 100_000 + BID_MS - 3000);
    expect(s.phase).toBe("live");
  });
});

describe("game setup", () => {
  it("presets pick the lots; unclaimed teams are AI", () => {
    const s = createRoom("r1");
    join(s, u1); claim(s, u1.id, "MI");
    updateSettings(s, u1.id, { preset: "full" });
    start(s, u1.id, testData(), T0, rng);
    expect(s.queue.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(s.aiTeams).toHaveLength(9);
    expect(s.aiTeams).not.toContain("MI");
  });

  it("retained start uses real purses and squads; fresh start gives empty squads", () => {
    const data = testData({ purse: 275, retained: { MI: [player("Rohit")] } });
    const s = liveRoom(data);
    expect(s.teams.MI.purse).toBe(275);
    expect(s.teams.MI.squad).toEqual([expect.objectContaining({ name: "Rohit", retained: true })]);

    const f = createRoom("r2");
    join(f, u1); claim(f, u1.id, "MI");
    updateSettings(f, u1.id, { start: "fresh" });
    start(f, u1.id, data, T0, rng);
    expect(f.teams.MI.purse).toBe(12000);
    expect(f.teams.MI.squad).toEqual([]);
  });

  it("reset returns to the lobby keeping seats and teams", () => {
    const s = liveRoom();
    bid(s, u1.id, "MI", 200, T0);
    expect(reset(s, u2.id).ok).toBe(false);
    expect(reset(s, u1.id).ok).toBe(true);
    expect(s.phase).toBe("lobby");
    expect(s.results).toEqual([]);
    expect(s.lead).toBeNull();
    expect(s.owners.MI).toBe(1);
    expect(s.seats[1]?.userId).toBe(u2.id);
  });
});
