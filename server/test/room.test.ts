import { BID_MS, OPEN_MS, RESULT_MS, type Request, type Snapshot } from "@auction/shared";
import { gameData } from "@auction/shared/data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Room } from "../src/room.js";

const p1 = { id: "u1", name: "Harsh" };
const p2 = { id: "u2", name: "Rohan" };

function makeRoom(aiEnabled = false, onSnap?: (s: Snapshot, room: Room) => void) {
  const snaps: Snapshot[] = [];
  const room: Room = new Room("ROOM01", {
    data: gameData, aiEnabled,
    onChange: (s) => { snaps.push(s); onSnap?.(s, room); },
  });
  const send = (user: typeof p1 | null, req: Request) => room.handle(user, req);
  return { room, snaps, send, last: () => snaps[snaps.length - 1]! };
}

function startTwoPlayer() {
  const r = makeRoom();
  r.room.connect(p1); r.room.connect(p2);
  r.send(p1, { type: "join" }); r.send(p2, { type: "join" });
  r.send(p1, { type: "claim", teamId: "KKR" }); r.send(p2, { type: "claim", teamId: "CSK" });
  expect(r.send(p1, { type: "start" })).toEqual({ ok: true });
  return r;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("Room", () => {
  it("runs the clock: bid, 8 s to SOLD, 3.2 s to the next lot", () => {
    const r = startTwoPlayer();
    const lot = r.last().lot!;
    expect(r.send(p1, { type: "bid", teamId: "KKR", amount: lot.base })).toEqual({ ok: true });
    vi.advanceTimersByTime(BID_MS - 1);
    expect(r.last().phase).toBe("live");
    vi.advanceTimersByTime(1);
    expect(r.last()).toMatchObject({ phase: "sold", outcome: { status: "sold", teamId: "KKR", amount: lot.base } });
    expect(r.last().teams.KKR.purse).toBe(6430 - lot.base);
    vi.advanceTimersByTime(RESULT_MS);
    expect(r.last()).toMatchObject({ phase: "live", lotIndex: 1, lead: null });
  });

  it("marks an unbid lot unsold after the 10 s opening window", () => {
    const r = startTwoPlayer();
    vi.advanceTimersByTime(OPEN_MS);
    expect(r.last().outcome).toMatchObject({ status: "unsold" });
  });

  it("pause and resume keep the exact time left", () => {
    const r = startTwoPlayer();
    r.send(p1, { type: "bid", teamId: "KKR", amount: r.last().nextAmount! });
    vi.advanceTimersByTime(3000);
    r.send(p2, { type: "pause" });
    expect(r.last()).toMatchObject({ phase: "paused", pausedLeft: BID_MS - 3000, deadline: null });
    vi.advanceTimersByTime(60_000);
    expect(r.last().phase).toBe("paused");
    r.send(p2, { type: "pause" });
    expect(r.last().deadline).toBe(Date.now() + BID_MS - 3000);
    vi.advanceTimersByTime(BID_MS - 3000);
    expect(r.last().phase).toBe("sold");
  });

  it("rejects a bid for someone else's team and leaves the state untouched", () => {
    const r = startTwoPlayer();
    const before = JSON.stringify(r.room.snapshot());
    const count = r.snaps.length;
    expect(r.send(p2, { type: "bid", teamId: "KKR", amount: r.last().nextAmount! }))
      .toEqual({ ok: false, reason: "You can only bid for your own teams" });
    expect(r.snaps).toHaveLength(count);
    expect(JSON.stringify(r.room.snapshot())).toBe(before);
  });

  it("closes the lot at the deadline even if the timer hasn't fired yet", () => {
    const r = startTwoPlayer();
    r.send(p1, { type: "bid", teamId: "KKR", amount: r.last().nextAmount! });
    vi.setSystemTime(Date.now() + BID_MS); // time passes, timers haven't run
    expect(r.send(p2, { type: "bid", teamId: "CSK", amount: r.last().nextAmount! }))
      .toEqual({ ok: false, reason: "Bidding is closed right now" });
    expect(r.last().outcome).toMatchObject({ status: "sold", teamId: "KKR" });
  });

  it("turns away anonymous connections and keeps seats through a disconnect", () => {
    const r = startTwoPlayer();
    expect(r.send(null, { type: "pause" })).toEqual({ ok: false, reason: "Pick a display name to take part" });
    r.room.disconnect(p2);
    expect(r.last().seats[1]).toMatchObject({ userId: "u2", connected: false });
    r.room.connect(p2);
    expect(r.last().seats[1]).toMatchObject({ userId: "u2", connected: true });
  });

  it("AI franchises play a whole game within their valuations, which stay private", () => {
    const aiCheck: string[] = [];
    let aiBids = 0;
    // Checked as each broadcast goes out, while the lot's valuations are current.
    const r = makeRoom(true, (snap, room) => {
      if ("aiValues" in snap) aiCheck.push("valuations leaked");
      const lead = snap.lead;
      if (snap.phase === "live" && lead && lead.bySeat === null) {
        aiBids++;
        const value = room.state.aiValues[lead.teamId] ?? 0;
        if (lead.amount > value) aiCheck.push(`${lead.teamId} bid ${lead.amount} > ${value}`);
      }
    });
    r.room.connect(p1);
    r.send(p1, { type: "join" });
    r.send(p1, { type: "claim", teamId: "MI" });
    r.send(p1, { type: "start" });
    for (let i = 0; i < 20_000 && r.last().phase !== "done"; i++) vi.advanceTimersByTime(1000);
    const end = r.last();
    expect(aiBids).toBeGreaterThan(16);
    expect(end.phase).toBe("done");
    expect(aiCheck).toEqual([]);
    expect(end.results).toHaveLength(16);
    expect(end.results.some((x) => x.status === "sold")).toBe(true);
    for (const t of Object.values(end.teams)) expect(t.purse).toBeGreaterThanOrEqual(0);
  });
});
