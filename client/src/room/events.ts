// The moments of an auction, worked out from consecutive snapshots. Sounds,
// the auctioneer's lines, his animations and the 3D camera all react to these.
import type { Lot, Snapshot, TeamId } from "@auction/shared";
import { spokenAmount } from "../speech";
import { team } from "../view";

export type AuctionEvent =
  | { type: "start" | "lot"; lot: Lot; line: string }
  | { type: "bid"; teamId: TeamId; amount: number; outbidMe: boolean; line: string }
  | { type: "once" | "twice"; line: string }
  | { type: "pause" | "resume"; line: string }
  | { type: "sold"; teamId: TeamId; amount: number; name: string; line: string }
  | { type: "unsold"; name: string; line: string }
  | { type: "done"; line: string };

function announce(s: Snapshot): string {
  const lot = s.lot!;
  return `Lot ${s.lotIndex + 1}. ${lot.name}, ${lot.role}${lot.overseas ? ", overseas" : ""}. ` +
    `Base price, ${spokenAmount(lot.base)}.`;
}

/** Everything that happened between two snapshots, in order. */
export function auctionEvents(p: Snapshot, s: Snapshot, mySeat: number | null): AuctionEvent[] {
  const out: AuctionEvent[] = [];

  if (p.phase === "lobby" && s.phase === "live" && s.lot) {
    out.push({ type: "start", lot: s.lot, line: `Welcome to the auction. ${announce(s)}` });
  } else if (s.phase === "live" && s.lotIndex !== p.lotIndex && s.lot) {
    out.push({ type: "lot", lot: s.lot, line: announce(s) });
  }

  if (s.bidSeq > p.bidSeq && s.lead && s.lotIndex === p.lotIndex) {
    const wasMine = !!p.lead && mySeat !== null && s.owners[p.lead.teamId] === mySeat;
    const nowMine = mySeat !== null && s.owners[s.lead.teamId] === mySeat;
    out.push({
      type: "bid", teamId: s.lead.teamId, amount: s.lead.amount, outbidMe: wasMine && !nowMine,
      line: `${spokenAmount(s.lead.amount)}, ${team(s.lead.teamId).city}.`,
    });
  }

  if (p.phase === "live" && s.phase === "paused") out.push({ type: "pause", line: "Auction paused." });
  if (p.phase === "paused" && s.phase === "live") out.push({ type: "resume", line: "We're back." });

  if (p.phase !== "sold" && s.phase === "sold" && s.outcome) {
    const o = s.outcome;
    out.push(o.status === "sold"
      ? {
        type: "sold", teamId: o.teamId!, amount: o.amount!, name: o.name,
        line: `Sold! ${o.name}, to ${team(o.teamId!).name}, for ${spokenAmount(o.amount!)}.`,
      }
      : { type: "unsold", name: o.name, line: `${o.name}, unsold.` });
  }

  if (p.phase !== "done" && s.phase === "done") {
    out.push({ type: "done", line: "And that's the end of the auction. Thank you, everyone." });
  }
  return out;
}

/** "Going once" / "going twice" come from the clock rather than a state change. */
export function clockEvent(call: "open" | "once" | "twice"): AuctionEvent | null {
  if (call === "once") return { type: "once", line: "Going once." };
  if (call === "twice") return { type: "twice", line: "Going twice." };
  return null;
}
