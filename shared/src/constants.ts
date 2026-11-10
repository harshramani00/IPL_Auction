export const MAX_SEATS = 10;
export const SQUAD_MAX = 25;
export const OVERSEAS_MAX = 8;

/** Clock, in milliseconds. */
export const OPEN_MS = 45_000; // window for the opening bid
export const BID_MS = 45_000; // clock after every accepted bid
export const GOING_ONCE_MS = 10_000;
export const GOING_TWICE_MS = 5_000;
export const RESULT_MS = 3_200; // pause on SOLD / UNSOLD before the next lot

/** AI franchises act every 0.7–2.7 s and bid 75% of the time they can. */
export const AI_MIN_DELAY_MS = 700;
export const AI_MAX_DELAY_MS = 2_700;
export const AI_BID_CHANCE = 0.75;

export const SEAT_COLORS = [
  "#4cc9f0", "#ff7ab6", "#7ee081", "#ffb24d", "#b9a3ff",
  "#4fe0c8", "#ff8a80", "#f5e663", "#8fc1ff", "#f3a6f0",
] as const;

export const DEFAULT_SETTINGS = { preset: "quick", start: "retained" } as const;
