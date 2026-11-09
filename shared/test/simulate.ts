// Plays whole auctions with only AI bidding, on fake time, for realism checks.
import {
  advance, aiDelay, aiTurn, claim, createRoom, join, nextWake, start, updateSettings,
  type GameData, type PresetId, type RoomState,
} from "../src/index.js";

/** Small seeded random generator (mulberry32), so simulations are repeatable. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One human who claims MI and never bids; the other nine teams are AI. */
export function simulate(data: GameData, preset: PresetId, seed: number): RoomState {
  const rng = seeded(seed);
  const s = createRoom("sim");
  join(s, { id: "u", name: "Watcher" });
  claim(s, "u", "MI");
  updateSettings(s, "u", { preset });
  start(s, "u", data, 0, rng);
  let now = 0;
  while (s.phase !== "done") {
    const wake = nextWake(s)!;
    const aiAt = now + aiDelay(rng);
    if (s.phase === "live" && aiAt < wake) {
      now = aiAt;
      aiTurn(s, now, rng);
    } else {
      now = wake;
      advance(s, now, rng);
    }
  }
  return s;
}
