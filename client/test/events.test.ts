import { claim, createRoom, join, snapshot, start, bid, advance, type RoomState } from "@auction/shared";
import { gameData } from "@auction/shared/data";
import { describe, expect, it } from "vitest";
import { auctionEvents, clockEvent } from "../src/room/events";

const seq = () => 0.5;

function room(): RoomState {
  const s = createRoom("T");
  join(s, { id: "a", name: "A" });
  join(s, { id: "b", name: "B" });
  claim(s, "a", "KKR");
  claim(s, "b", "CSK");
  return s;
}

describe("auction events", () => {
  it("announces the first lot when the auction starts", () => {
    const s = room();
    const before = snapshot(s, 0);
    start(s, "a", gameData, 0, seq);
    const [e] = auctionEvents(before, snapshot(s, 0), 1);
    expect(e).toMatchObject({ type: "start", lot: { name: "Devon Conway" } });
    expect(e!.line).toBe("Welcome to the auction. Lot 1. Devon Conway, Batter, overseas. Base price, 2 crore.");
  });

  it("calls each bid and flags when you've been outbid", () => {
    const s = room();
    start(s, "a", gameData, 0, seq);
    const s0 = snapshot(s, 0);
    bid(s, "a", "KKR", 200, 10);
    const s1 = snapshot(s, 10);
    expect(auctionEvents(s0, s1, 1)).toEqual([
      expect.objectContaining({ type: "bid", teamId: "KKR", amount: 200, outbidMe: false, line: "2 crore, Kolkata." }),
    ]);
    bid(s, "b", "CSK", 220, 20);
    const [e] = auctionEvents(s1, snapshot(s, 20), 1);
    expect(e).toMatchObject({ type: "bid", teamId: "CSK", outbidMe: true, line: "2 crore 20 lakh, Chennai." });
  });

  it("sells, then announces the next lot", () => {
    const s = room();
    start(s, "a", gameData, 0, seq);
    bid(s, "a", "KKR", 200, 10);
    const live = snapshot(s, 10);
    advance(s, 10 + 8000, seq); // the 8 s clock runs out
    const sold = snapshot(s, 8010);
    expect(auctionEvents(live, sold, 1)).toEqual([expect.objectContaining({
      type: "sold", teamId: "KKR", amount: 200, line: "Sold! Devon Conway, to Kolkata Knight Riders, for 2 crore.",
    })]);
    advance(s, 8010 + 3200, seq); // after the result pause
    expect(auctionEvents(sold, snapshot(s, 11_210), 1)[0]).toMatchObject({ type: "lot", lot: { name: "Cameron Green" } });
  });

  it("turns clock calls into going once / twice", () => {
    expect(clockEvent("open")).toBeNull();
    expect(clockEvent("once")).toEqual({ type: "once", line: "Going once." });
    expect(clockEvent("twice")).toEqual({ type: "twice", line: "Going twice." });
  });
});
