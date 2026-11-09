// Turns state changes into the sounds of the auction floor.
import { callFor, type Snapshot } from "@auction/shared";
import { useEffect, useRef } from "react";
import { sound, spokenAmount } from "../sound";
import { team } from "../view";

function announceLot(s: Snapshot): string {
  const lot = s.lot!;
  return `Lot ${s.lotIndex + 1}. ${lot.name}, ${lot.role}${lot.overseas ? ", overseas" : ""}. ` +
    `Base price, ${spokenAmount(lot.base)}.`;
}

export function useAuctionSounds(s: Snapshot | null, mySeat: number | null, serverNow: () => number): void {
  const prev = useRef<Snapshot | null>(null);
  const latest = useRef(s);
  latest.current = s;
  const lastCall = useRef("");

  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    // The first snapshot is just catching up (e.g. joining mid-auction): stay quiet.
    if (!s || !p) return;

    if (p.phase === "lobby" && s.phase === "live") {
      sound.play("fanfare");
      sound.say(`Welcome to the auction. ${announceLot(s)}`);
    } else if (s.phase === "live" && s.lotIndex !== p.lotIndex && s.lot) {
      sound.play("sting");
      sound.say(announceLot(s));
    }

    if (s.bidSeq > p.bidSeq && s.lead && s.lotIndex === p.lotIndex) {
      sound.play("tock");
      sound.say(`${spokenAmount(s.lead.amount)}, ${team(s.lead.teamId).city}`);
      const wasMine = p.lead && mySeat !== null && s.owners[p.lead.teamId] === mySeat;
      const nowMine = mySeat !== null && s.owners[s.lead.teamId] === mySeat;
      if (wasMine && !nowMine) sound.play("ping");
    }

    if (p.phase === "live" && s.phase === "paused") sound.say("Auction paused.");
    if (p.phase === "paused" && s.phase === "live") sound.say("We're back.");

    if (p.phase !== "sold" && s.phase === "sold" && s.outcome) {
      const o = s.outcome;
      if (o.status === "sold") {
        sound.play("gavel");
        sound.play("cheer");
        sound.say(`Sold! ${o.name}, to ${team(o.teamId!).name}, for ${spokenAmount(o.amount!)}.`);
      } else {
        sound.play("thud");
        sound.say(`${o.name}, unsold.`);
      }
    }

    if (p.phase !== "done" && s.phase === "done") {
      sound.play("fanfare");
      sound.say("And that's the end of the auction. Thank you, everyone.", false);
    }
  }, [s, mySeat]);

  // "Going once" / "going twice" come from the clock, not from a state change.
  useEffect(() => {
    const id = setInterval(() => {
      const cur = latest.current;
      if (!cur || cur.phase !== "live" || cur.deadline === null) return;
      const call = callFor(cur.deadline - serverNow());
      if (call === "open") return;
      const key = `${cur.lotIndex}:${cur.bidSeq}:${call}`;
      if (key === lastCall.current) return;
      lastCall.current = key;
      sound.play("tick");
      sound.say(call === "once" ? "Going once." : "Going twice.");
    }, 100);
    return () => clearInterval(id);
  }, [serverNow]);
}
