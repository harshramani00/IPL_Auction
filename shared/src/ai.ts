// AI franchises. Each lot gets a hidden market value anchored on what the
// player really went for at the auction (varied each game), only a few AI
// teams are interested in any one player, and every AI team keeps enough
// purse back to fill the rest of its squad.
import { AI_BID_CHANCE, AI_MAX_DELAY_MS, AI_MIN_DELAY_MS, SQUAD_MAX } from "./constants.js";
import { teamBlock } from "./limits.js";
import { nextAmount } from "./money.js";
import type { Lot, RoomState, TeamId, TeamState } from "./types.js";

type Rng = () => number;

/** Cheapest a player can go for (lakhs): what an AI team reserves per empty slot. */
export const MIN_PRICE = 30;

const uniform = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);

function shuffled<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Hidden AI valuations for a lot (lakhs; 0 = not interested).
 * `market` is the lot's real result (see MarketPrices):
 * - Sold in reality (a price): the game's market value is that price
 *   x U(0.85, 1.15). Two or three AI teams want him; the two keenest value him
 *   close to it, so the bidding settles near the market value.
 * - Unsold in reality (null): usually no AI interest; 30% of the
 *   time one team will pay a little over base.
 * - No real result (undefined, e.g. a custom lot): the spec's
 *   tier formula, tier A base x U(3, 9), tier B base x U(0.9, 4).
 */
export function drawValuations(
  lot: Lot, market: number | null | undefined, aiTeams: TeamId[],
  teams: Record<TeamId, TeamState>, rng: Rng,
): Partial<Record<TeamId, number>> {
  const values: Partial<Record<TeamId, number>> = Object.fromEntries(aiTeams.map((t) => [t, 0]));
  if (market === undefined) {
    const value = lot.base * (lot.tier === "A" ? uniform(rng, 3, 9) : uniform(rng, 0.9, 4));
    for (const t of aiTeams) values[t] = Math.round(value * uniform(rng, 0.7, 1.15));
    return values;
  }
  // Teams that could pay the player's price come first, like real franchises
  // planning around their purse; the rest only make up the numbers.
  const budget = (t: TeamId) => teams[t].purse - aiReserve(teams[t]);
  const order = shuffled(aiTeams, rng);
  if (market === null) {
    const able = order.filter((t) => budget(t) >= lot.base);
    if (able.length && rng() < 0.3) values[able[0]!] = Math.round(lot.base * uniform(rng, 1, 1.4));
    return values;
  }
  const value = Math.max(lot.base, market * uniform(rng, 0.85, 1.15));
  const keen = rng() < 0.4 ? 3 : 2;
  const ranked = [...order.filter((t) => budget(t) >= value * 0.9), ...order.filter((t) => budget(t) < value * 0.9)];
  ranked.slice(0, keen).forEach((t, i) => {
    values[t] = Math.round(i < 2 ? value * uniform(rng, 0.93, 1.07) : value * uniform(rng, 0.5, 0.9));
  });
  return values;
}

/** Purse an AI team won't spend: the minimum price for each squad slot it still has to fill after this one. */
export function aiReserve(team: TeamState): number {
  return MIN_PRICE * Math.max(0, SQUAD_MAX - team.squad.length - 1);
}

/** Delay before the next AI decision, in ms. */
export const aiDelay = (rng: Rng) => uniform(rng, AI_MIN_DELAY_MS, AI_MAX_DELAY_MS);

/** Pick an AI team to bid now, or null: not the leader, still values the lot, and can afford it with its reserve. */
/** Whether AI team `t` would pay `amount` for this lot. Once false it stays false: prices only go up. */
export function aiWilling(s: RoomState, lot: Lot, t: TeamId, amount: number): boolean {
  const team = s.teams[t];
  return (s.aiValues[t] ?? 0) >= amount &&
    amount <= team.purse - aiReserve(team) &&
    teamBlock(team, lot, amount) === null;
}

export function pickAiBid(s: RoomState, lot: Lot, rng: Rng): { teamId: TeamId; amount: number } | null {
  const amount = nextAmount(lot, s.lead);
  const willing = s.aiTeams.filter((t) =>
    s.lead?.teamId !== t && !s.skipped.includes(t) && aiWilling(s, lot, t, amount));
  if (!willing.length || rng() >= AI_BID_CHANCE) return null;
  return { teamId: willing[Math.floor(rng() * willing.length)]!, amount };
}
