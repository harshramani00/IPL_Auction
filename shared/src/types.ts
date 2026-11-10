// Shared game types. Money is always integer lakhs (100 lakhs = 1 crore).

export const TEAM_IDS = ["MI", "CSK", "RCB", "KKR", "SRH", "DC", "RR", "PBKS", "GT", "LSG"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export type Cat = "BAT" | "WK" | "AR" | "BOWL";

export interface Lot {
  id: number;
  name: string;
  cc: string;
  country: string;
  overseas: boolean;
  cat: Cat;
  role: string;
  capped: boolean;
  set: string;
  setCode: string;
  base: number;
  tier: "A" | "B";
  photo: string | null;
}

/**
 * What each lot really went for at the auction (lakhs), or null if he went
 * unsold. Anchors the AI's hidden valuations, so it is server-only: it lives
 * in shared/data/market.json, which the client never imports, and never
 * appears in a snapshot.
 */
export type MarketPrices = Record<number, number | null>;

export interface SquadPlayer {
  name: string;
  price: number | null;
  role: string | null;
  cat: Cat | null;
  overseas: boolean;
  photo: string | null;
  /** Kept by the franchise before the auction. */
  retained?: boolean;
  /** Set for players bought in this game. */
  lotId?: number;
}

export interface TeamInfo {
  id: TeamId;
  name: string;
  city: string;
  color: string;
  ring: string;
  ink: string;
  logo: string | null;
  /** Purse going into the auction, after retentions. */
  purse: number;
  retained: SquadPlayer[];
}

export type PresetId = "quick" | "capped" | "full";
export type StartMode = "retained" | "fresh";

export interface Settings {
  preset: PresetId;
  /** "retained": real pre-auction purses and squads. "fresh": empty squads, equal purses. */
  start: StartMode;
}

export interface GameData {
  lots: Lot[];
  presets: Record<PresetId, { label: string; lots: number[] }>;
  teams: TeamInfo[];
  freshPurse: number;
  /** Server-only (see MarketPrices). Without it the AI falls back to the tier formula. */
  market?: MarketPrices;
}

export type Phase = "lobby" | "live" | "paused" | "sold" | "done";

export interface Seat {
  seat: number; // 1..10
  userId: string;
  name: string;
  connected: boolean;
}

export interface TeamState {
  id: TeamId;
  purse: number;
  squad: SquadPlayer[];
}

export interface Lead {
  teamId: TeamId;
  amount: number;
  /** Seat that placed the bid, or null for an AI franchise. */
  bySeat: number | null;
}

export interface BidEntry extends Lead {
  at: number;
}

export interface Outcome {
  status: "sold" | "unsold";
  lotId: number;
  name: string;
  teamId?: TeamId;
  amount?: number;
  bySeat?: number | null;
}

/** Full room state. Lives on the server; clients only ever see a Snapshot. */
export interface RoomState {
  id: string;
  phase: Phase;
  seats: (Seat | null)[]; // index 0 = P1
  owners: Record<TeamId, number | null>; // seat number
  /** Claim order (higher = more recent); used to trim claims when the cap drops. */
  claimedAt: Record<TeamId, number | null>;
  claimSeq: number;
  settings: Settings;
  teams: Record<TeamId, TeamState>;
  /** Lots for this game, in order. Extension point: an accelerated round can append to it. */
  queue: Lot[];
  lotIndex: number;
  lead: Lead | null;
  bids: BidEntry[];
  /** Teams that skipped the current lot; they can't bid on it again. */
  skipped: TeamId[];
  deadline: number | null; // epoch ms
  windowMs: number;
  pausedLeft: number | null;
  resultUntil: number | null;
  outcome: Outcome | null;
  results: Outcome[];
  bidSeq: number;
  aiTeams: TeamId[];
  /** False when the server runs without AI (tests): AI teams then count as skipping. */
  aiEnabled: boolean;
  /** Hidden AI valuations for the current lot. Never sent to clients. */
  aiValues: Partial<Record<TeamId, number>>;
  /** Real auction prices for this game's lots (server-only, see MarketPrices). */
  market: MarketPrices;
}

/** Public view of the room, broadcast after every change. */
export interface Snapshot {
  roomId: string;
  phase: Phase;
  seats: (Seat | null)[];
  leadSeat: number | null;
  cap: number;
  owners: Record<TeamId, number | null>;
  claimedAt: Record<TeamId, number | null>;
  settings: Settings;
  teams: Record<TeamId, TeamState>;
  aiTeams: TeamId[];
  lot: Lot | null;
  lotIndex: number;
  lotCount: number;
  lead: Lead | null;
  bids: BidEntry[]; // last 5, newest first
  skipped: TeamId[];
  nextAmount: number | null;
  deadline: number | null;
  windowMs: number;
  pausedLeft: number | null;
  resultUntil: number | null;
  outcome: Outcome | null;
  results: Outcome[];
  bidSeq: number;
  serverNow: number;
}

export interface User {
  id: string;
  name: string;
}

export type Check = { ok: true } | { ok: false; reason: string };

export type Request =
  | { type: "join" }
  | { type: "leave" }
  | { type: "claim"; teamId: TeamId }
  | { type: "release"; teamId: TeamId }
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "start" }
  | { type: "bid"; teamId: TeamId; amount: number }
  | { type: "skip"; teamId: TeamId }
  | { type: "pause" }
  | { type: "reset" };

export interface Ack {
  requestId: string;
  ok: boolean;
  reason?: string;
}
