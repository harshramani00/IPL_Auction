// AI franchises: each lot gets a hidden market value, each AI team its own
// take on it, and they keep bidding while the price is under their value.
import { AI_BID_CHANCE, AI_MAX_DELAY_MS, AI_MIN_DELAY_MS } from "./constants.js";
import { teamBlock } from "./limits.js";
import { nextAmount } from "./money.js";
import type { Lot, RoomState, TeamId } from "./types.js";

type Rng = () => number;

const uniform = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

/** Tier A lots: base x U(3, 9); tier B: base x U(0.9, 4). Each AI team then x U(0.7, 1.15). */
export function drawValuations(lot: Lot, aiTeams: TeamId[], rng: Rng): Partial<Record<TeamId, number>> {
  const value = lot.base * (lot.tier === "A" ? uniform(rng, 3, 9) : uniform(rng, 0.9, 4));
  return Object.fromEntries(aiTeams.map((t) => [t, Math.round(value * uniform(rng, 0.7, 1.15))]));
}

/** Delay before the next AI decision, in ms. */
export const aiDelay = (rng: Rng) => uniform(rng, AI_MIN_DELAY_MS, AI_MAX_DELAY_MS);

/** Pick an AI team to bid now, or null: not the leader, can afford it, still values the lot. */
export function pickAiBid(s: RoomState, lot: Lot, rng: Rng): { teamId: TeamId; amount: number } | null {
  const amount = nextAmount(lot, s.lead);
  const willing = s.aiTeams.filter((t) =>
    s.lead?.teamId !== t &&
    (s.aiValues[t] ?? 0) >= amount &&
    teamBlock(s.teams[t], lot, amount) === null);
  if (!willing.length || rng() >= AI_BID_CHANCE) return null;
  return { teamId: willing[Math.floor(rng() * willing.length)]!, amount };
}
