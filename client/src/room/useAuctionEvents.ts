import { callFor, type Snapshot } from "@auction/shared";
import { useEffect, useRef } from "react";
import { auctionEvents, clockEvent, type AuctionEvent } from "./events";

/**
 * Calls `onEvent` for each auction moment as it happens. The first snapshot
 * only catches up (e.g. joining mid-auction), so it produces no events.
 */
export function useAuctionEvents(
  s: Snapshot | null,
  mySeat: number | null,
  serverNow: () => number,
  onEvent: (e: AuctionEvent) => void,
): void {
  const prev = useRef<Snapshot | null>(null);
  const latest = useRef(s);
  latest.current = s;
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const lastCall = useRef("");

  useEffect(() => {
    const p = prev.current;
    prev.current = s;
    if (!s || !p) return;
    for (const e of auctionEvents(p, s, mySeat)) handler.current(e);
  }, [s, mySeat]);

  useEffect(() => {
    const id = setInterval(() => {
      const cur = latest.current;
      if (!cur || cur.phase !== "live" || cur.deadline === null) return;
      const call = callFor(cur.deadline - serverNow());
      const key = `${cur.lotIndex}:${cur.bidSeq}:${call}`;
      if (call === "open" || key === lastCall.current) return;
      lastCall.current = key;
      const e = clockEvent(call);
      if (e) handler.current(e);
    }, 100);
    return () => clearInterval(id);
  }, [serverNow]);
}
