import { capFor, currentLot, leadSeat, seatedCount } from "./engine.js";
import { nextAmount } from "./money.js";
import type { RoomState, Snapshot } from "./types.js";

/** Everything clients may see. Deliberately leaves out the AI valuations. */
export function snapshot(s: RoomState, now: number): Snapshot {
  const lot = currentLot(s);
  return {
    roomId: s.id,
    phase: s.phase,
    seats: s.seats,
    leadSeat: leadSeat(s),
    cap: capFor(seatedCount(s)),
    owners: s.owners,
    claimedAt: s.claimedAt,
    settings: s.settings,
    teams: s.teams,
    aiTeams: s.aiTeams,
    lot: s.phase === "lobby" ? null : lot,
    lotIndex: s.lotIndex,
    lotCount: s.queue.length,
    lead: s.lead,
    bids: s.bids.slice(-5).reverse(),
    skipped: s.skipped,
    nextAmount: lot && (s.phase === "live" || s.phase === "paused") ? nextAmount(lot, s.lead) : null,
    deadline: s.deadline,
    windowMs: s.windowMs,
    pausedLeft: s.pausedLeft,
    resultUntil: s.resultUntil,
    outcome: s.outcome,
    results: s.results,
    bidSeq: s.bidSeq,
    serverNow: now,
  };
}
