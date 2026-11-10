// Turns auction moments into the sounds of the auction floor.
import type { Snapshot } from "@auction/shared";
import { sound } from "../sound";
import type { AuctionEvent } from "./events";
import { useAuctionEvents } from "./useAuctionEvents";

function play(e: AuctionEvent): void {
  switch (e.type) {
    case "start": sound.play("fanfare"); break;
    case "lot": sound.play("sting"); break;
    case "bid":
      sound.play("tock");
      if (e.outbidMe) sound.play("ping");
      break;
    case "once": case "twice": sound.play("tick"); break;
    case "sold": sound.play("gavel"); sound.play("cheer"); break;
    case "unsold": sound.play("thud"); break;
    case "done": sound.play("fanfare"); break;
    case "pause": case "resume": break;
  }
  sound.say(e.line, e.type !== "done");
}

export function useAuctionSounds(s: Snapshot | null, mySeat: number | null, serverNow: () => number): void {
  useAuctionEvents(s, mySeat, serverNow, play);
}
