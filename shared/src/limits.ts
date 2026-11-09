import { OVERSEAS_MAX, SQUAD_MAX } from "./constants.js";
import { formatAmount } from "./money.js";
import type { Lot, TeamState } from "./types.js";

export const overseasCount = (team: TeamState) => team.squad.filter((p) => p.overseas).length;

/** Why this team can't bid `amount` on the lot, or null if it can. Retained players count. */
export function teamBlock(team: TeamState, lot: Lot, amount: number): string | null {
  if (team.squad.length >= SQUAD_MAX) return `${team.id}'s squad is full (${SQUAD_MAX})`;
  if (lot.overseas && overseasCount(team) >= OVERSEAS_MAX) {
    return `${team.id} already has ${OVERSEAS_MAX} overseas players`;
  }
  if (amount > team.purse) return `${team.id} can't afford ${formatAmount(amount)}`;
  return null;
}
