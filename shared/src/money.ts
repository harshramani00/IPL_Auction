import { GOING_ONCE_MS, GOING_TWICE_MS } from "./constants.js";
import type { Lead, Lot } from "./types.js";

/** Bid step for the current amount (lakhs). */
export function incrementFor(amount: number): number {
  if (amount < 100) return 5;
  if (amount < 200) return 10;
  if (amount < 500) return 20;
  return 25;
}

/** The only amount the next bid may be: the base price, then lead + increment. */
export function nextAmount(lot: Lot, lead: Lead | null): number {
  return lead ? lead.amount + incrementFor(lead.amount) : lot.base;
}

/** 220 -> "₹ 2.20 Cr", 30 -> "₹ 30 L". */
export function formatAmount(lakhs: number): string {
  return lakhs >= 100 ? `₹ ${(lakhs / 100).toFixed(2)} Cr` : `₹ ${lakhs} L`;
}

export type Call = "open" | "once" | "twice";

/** Auctioneer's call for the time left on the clock. */
export function callFor(msLeft: number): Call {
  if (msLeft <= GOING_TWICE_MS) return "twice";
  if (msLeft <= GOING_ONCE_MS) return "once";
  return "open";
}
