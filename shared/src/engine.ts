// The rules engine. Every function takes the room state plus the current time
// (and a random source where needed), changes the state in place and says
// whether the request was allowed. No I/O, no timers: the server owns the
// clock and calls `advance` when `nextWake` comes due.
import { aiWilling, drawValuations, pickAiBid } from "./ai.js";
import { BID_MS, DEFAULT_SETTINGS, MAX_SEATS, OPEN_MS, RESULT_MS } from "./constants.js";
import { teamBlock } from "./limits.js";
import { nextAmount } from "./money.js";
import {
  TEAM_IDS,
  type Check, type GameData, type Lot, type RoomState, type Seat, type Settings,
  type TeamId, type User,
} from "./types.js";

export type Rng = () => number;

const OK: Check = { ok: true };
const no = (reason: string): Check => ({ ok: false, reason });

const byTeam = <T>(make: (id: TeamId) => T) =>
  Object.fromEntries(TEAM_IDS.map((id) => [id, make(id)])) as Record<TeamId, T>;

export function createRoom(id: string): RoomState {
  return {
    id,
    phase: "lobby",
    seats: Array<Seat | null>(MAX_SEATS).fill(null),
    owners: byTeam(() => null),
    claimedAt: byTeam(() => null),
    claimSeq: 0,
    settings: { ...DEFAULT_SETTINGS },
    teams: byTeam((id) => ({ id, purse: 0, squad: [] })),
    queue: [],
    lotIndex: 0,
    lead: null,
    bids: [],
    skipped: [],
    deadline: null,
    windowMs: OPEN_MS,
    pausedLeft: null,
    resultUntil: null,
    outcome: null,
    results: [],
    bidSeq: 0,
    aiTeams: [],
    aiEnabled: true,
    shuffleSets: false,
    aiValues: {},
    market: {},
  };
}

// ------------------------------------------------------------- seats & teams

/** Teams each player may run: 1 player -> 10, 2 -> 5, 3 -> 3, 4–5 -> 2, 6–10 -> 1. */
export function capFor(players: number): number {
  return Math.max(1, Math.floor(TEAM_IDS.length / Math.max(players, 1)));
}

export const seatedCount = (s: RoomState) => s.seats.filter(Boolean).length;
export const seatOf = (s: RoomState, userId: string) =>
  s.seats.find((seat) => seat?.userId === userId)?.seat ?? null;
/** The room lead is the lowest-numbered occupied seat. */
export const leadSeat = (s: RoomState) => s.seats.find(Boolean)?.seat ?? null;
export const teamsOf = (s: RoomState, seat: number) => TEAM_IDS.filter((t) => s.owners[t] === seat);
export const currentLot = (s: RoomState): Lot | null => s.queue[s.lotIndex] ?? null;

/** Over-cap players lose their most recently claimed teams. */
export function trimClaims(s: RoomState): void {
  const cap = capFor(seatedCount(s));
  for (const seat of s.seats) {
    if (!seat) continue;
    const owned = teamsOf(s, seat.seat).sort((a, b) => (s.claimedAt[a] ?? 0) - (s.claimedAt[b] ?? 0));
    for (const team of owned.slice(cap)) {
      s.owners[team] = null;
      s.claimedAt[team] = null;
    }
  }
}

export function join(s: RoomState, user: User): Check {
  if (seatOf(s, user.id) !== null) return OK;
  if (s.phase !== "lobby") return no("The auction has started. You can watch until the next game");
  const free = s.seats.findIndex((seat) => seat === null);
  if (free === -1) return no(`The room is full (${MAX_SEATS} players)`);
  s.seats[free] = { seat: free + 1, userId: user.id, name: user.name, connected: true };
  trimClaims(s);
  return OK;
}

export function leave(s: RoomState, userId: string): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("You're not in the auction");
  if (s.phase !== "lobby") return no("You can only leave in the lobby");
  for (const team of teamsOf(s, seat)) {
    s.owners[team] = null;
    s.claimedAt[team] = null;
  }
  s.seats[seat - 1] = null;
  return OK;
}

export function setConnected(s: RoomState, userId: string, connected: boolean): void {
  const seat = seatOf(s, userId);
  if (seat !== null) s.seats[seat - 1]!.connected = connected;
}

export function claim(s: RoomState, userId: string, teamId: TeamId): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("Join the auction to claim a team");
  if (s.phase !== "lobby") return no("Teams can only be claimed in the lobby");
  const owner = s.owners[teamId];
  if (owner === seat) return no(`You already run ${teamId}`);
  if (owner !== null) return no(`${teamId} is already taken`);
  const cap = capFor(seatedCount(s));
  if (teamsOf(s, seat).length >= cap) {
    return no(`You can run up to ${cap} team${cap === 1 ? "" : "s"}`);
  }
  s.owners[teamId] = seat;
  s.claimedAt[teamId] = ++s.claimSeq;
  return OK;
}

export function release(s: RoomState, userId: string, teamId: TeamId): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("Join the auction to manage teams");
  if (s.phase !== "lobby") return no("Teams can only be released in the lobby");
  if (s.owners[teamId] !== seat) return no(`You don't run ${teamId}`);
  s.owners[teamId] = null;
  s.claimedAt[teamId] = null;
  return OK;
}

function requireLead(s: RoomState, userId: string): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("Join the auction first");
  if (seat !== leadSeat(s)) return no("Only the room lead can do that");
  return OK;
}

export function updateSettings(s: RoomState, userId: string, settings: Partial<Settings>): Check {
  const lead = requireLead(s, userId);
  if (!lead.ok) return lead;
  if (s.phase !== "lobby") return no("Settings can only change in the lobby");
  s.settings = { ...s.settings, ...settings };
  return OK;
}

/** Readiness checks the lobby shows; start() requires all of them. */
export function startProblems(s: RoomState): string[] {
  const problems: string[] = [];
  if (seatedCount(s) === 0) problems.push("At least one player has to join");
  for (const seat of s.seats) {
    if (seat && teamsOf(s, seat.seat).length === 0) problems.push(`P${seat.seat} hasn't claimed a team`);
  }
  return problems;
}

// ------------------------------------------------------------------- auction

export function start(s: RoomState, userId: string, data: GameData, now: number, rng: Rng): Check {
  const lead = requireLead(s, userId);
  if (!lead.ok) return lead;
  if (s.phase !== "lobby") return no("The auction is already running");
  const problems = startProblems(s);
  if (problems.length) return no(problems[0]!);

  const fresh = s.settings.start === "fresh";
  for (const info of data.teams) {
    s.teams[info.id] = {
      id: info.id,
      purse: fresh ? data.freshPurse : info.purse,
      squad: fresh ? [] : info.retained.map((p) => ({ ...p, retained: true })),
    };
  }
  const lotsById = new Map(data.lots.map((l) => [l.id, l]));
  s.queue = data.presets[s.settings.preset].lots.map((id) => lotsById.get(id)!).filter(Boolean);
  if (s.shuffleSets) s.queue = shuffledWithinSets(s.queue, rng);
  s.aiTeams = TEAM_IDS.filter((t) => s.owners[t] === null);
  s.market = data.market ?? {};
  s.results = [];
  s.lotIndex = 0;
  openLot(s, now, rng);
  return OK;
}

/** The same sets in the same order, with the players inside each one drawn at random. */
export function shuffledWithinSets(lots: Lot[], rng: Rng): Lot[] {
  const out: Lot[] = [];
  for (let from = 0; from < lots.length;) {
    let to = from;
    while (to < lots.length && lots[to]!.setCode === lots[from]!.setCode) to++;
    const set = lots.slice(from, to);
    // Fisher–Yates
    for (let i = set.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [set[i], set[j]] = [set[j]!, set[i]!];
    }
    out.push(...set);
    from = to;
  }
  return out;
}

function openLot(s: RoomState, now: number, rng: Rng): void {
  const lot = currentLot(s);
  if (!lot) {
    s.phase = "done";
    s.deadline = null;
    return;
  }
  s.phase = "live";
  s.lead = null;
  s.bids = [];
  s.skipped = [];
  s.outcome = null;
  s.resultUntil = null;
  s.pausedLeft = null;
  s.windowMs = OPEN_MS;
  s.deadline = now + OPEN_MS;
  s.aiValues = drawValuations(lot, s.market[lot.id], s.aiTeams, s.teams, rng);
}

export function validateBid(s: RoomState, userId: string, teamId: TeamId, amount: number): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("Join the auction to bid");
  if (s.phase === "paused") return no("The auction is paused");
  const lot = currentLot(s);
  if (s.phase !== "live" || !lot) return no("Bidding is closed right now");
  if (s.owners[teamId] !== seat) return no("You can only bid for your own teams");
  // A team can't raise its own top bid; a player's other teams may still bid.
  if (s.lead?.teamId === teamId) return no(`${teamId} already has the top bid`);
  if (s.skipped.includes(teamId)) return no(`${teamId} skipped this player`);
  if (amount !== nextAmount(lot, s.lead)) return no("Someone got in first at that price. Bid again");
  const block = teamBlock(s.teams[teamId], lot, amount);
  return block ? no(block) : OK;
}

function applyBid(s: RoomState, teamId: TeamId, amount: number, bySeat: number | null, now: number): void {
  s.lead = { teamId, amount, bySeat };
  s.bids.push({ teamId, amount, bySeat, at: now });
  s.bidSeq++;
  s.windowMs = BID_MS;
  s.deadline = now + BID_MS;
}

export function bid(s: RoomState, userId: string, teamId: TeamId, amount: number, now: number): Check {
  const check = validateBid(s, userId, teamId, amount);
  if (check.ok) {
    applyBid(s, teamId, amount, seatOf(s, userId), now);
    // The new price may have put every other team out of reach.
    if (everyonePassed(s)) resolveLot(s, now);
  }
  return check;
}

/** Drop out of the current lot. Once every team but the leader is out, the hammer falls. */
export function skip(s: RoomState, userId: string, teamId: TeamId, now: number): Check {
  const seat = seatOf(s, userId);
  if (seat === null) return no("Join the auction to play");
  if (s.phase === "paused") return no("The auction is paused");
  if (s.phase !== "live" || !currentLot(s)) return no("Nothing to skip right now");
  if (s.owners[teamId] !== seat) return no("You can only skip for your own teams");
  if (s.lead?.teamId === teamId) return no(`${teamId} holds the bid`);
  if (s.skipped.includes(teamId)) return no(`${teamId} already skipped this player`);
  s.skipped.push(teamId);
  if (everyonePassed(s)) resolveLot(s, now);
  return OK;
}

/** True when no team but the leader can still bid: each has skipped, or can't afford or fit the player. */
export function everyonePassed(s: RoomState): boolean {
  const lot = currentLot(s);
  if (!lot) return false;
  const amount = nextAmount(lot, s.lead);
  return TEAM_IDS.every((t) =>
    t === s.lead?.teamId ||
    s.skipped.includes(t) ||
    (!s.aiEnabled && s.aiTeams.includes(t)) ||
    teamBlock(s.teams[t], lot, amount) !== null);
}

/** One AI decision; the server calls this every 0.7–2.7 s while live. AI teams priced out skip. */
export function aiTurn(s: RoomState, now: number, rng: Rng): boolean {
  const lot = currentLot(s);
  if (s.phase !== "live" || !lot) return false;
  const amount = nextAmount(lot, s.lead);
  const priced = s.aiTeams.filter((t) =>
    t !== s.lead?.teamId && !s.skipped.includes(t) && !aiWilling(s, lot, t, amount));
  s.skipped.push(...priced);
  if (everyonePassed(s)) {
    resolveLot(s, now);
    return true;
  }
  const choice = pickAiBid(s, lot, rng);
  if (!choice) return priced.length > 0;
  applyBid(s, choice.teamId, choice.amount, null, now);
  if (everyonePassed(s)) resolveLot(s, now);
  return true;
}

/** Pause a live lot, or resume a paused one, keeping the exact time left. */
export function pause(s: RoomState, userId: string, now: number): Check {
  if (seatOf(s, userId) === null) return no("Only players can pause");
  if (s.phase === "live") {
    s.pausedLeft = Math.max(0, (s.deadline ?? now) - now);
    s.deadline = null;
    s.phase = "paused";
    return OK;
  }
  if (s.phase === "paused") {
    s.deadline = now + (s.pausedLeft ?? 0);
    s.pausedLeft = null;
    s.phase = "live";
    return OK;
  }
  return no("Nothing to pause right now");
}

/** Back to the lobby: seats and team ownership stay, the auction is wiped. */
export function reset(s: RoomState, userId: string): Check {
  const lead = requireLead(s, userId);
  if (!lead.ok) return lead;
  const fresh = createRoom(s.id);
  Object.assign(s, fresh, {
    seats: s.seats, owners: s.owners, claimedAt: s.claimedAt, claimSeq: s.claimSeq, settings: s.settings,
    aiEnabled: s.aiEnabled, shuffleSets: s.shuffleSets,
  });
  return OK;
}

/** The hammer: sell to the top bid or mark unsold. */
export function resolveLot(s: RoomState, now: number): void {
  const lot = currentLot(s);
  if (!lot) return;
  if (s.lead) {
    const team = s.teams[s.lead.teamId];
    team.purse -= s.lead.amount;
    team.squad.push({
      name: lot.name, price: s.lead.amount, role: lot.role, cat: lot.cat,
      overseas: lot.overseas, photo: lot.photo, lotId: lot.id,
    });
    s.outcome = {
      status: "sold", lotId: lot.id, name: lot.name,
      teamId: s.lead.teamId, amount: s.lead.amount, bySeat: s.lead.bySeat,
    };
  } else {
    s.outcome = { status: "unsold", lotId: lot.id, name: lot.name };
  }
  s.results.push(s.outcome);
  s.phase = "sold";
  s.deadline = null;
  s.resultUntil = now + RESULT_MS;
}

/** When the server should next call `advance`, or null if nothing is pending. */
export function nextWake(s: RoomState): number | null {
  if (s.phase === "live") return s.deadline;
  if (s.phase === "sold") return s.resultUntil;
  return null;
}

/** Apply any clock transitions that are due. Returns true if the state changed. */
export function advance(s: RoomState, now: number, rng: Rng): boolean {
  let changed = false;
  for (;;) {
    if (s.phase === "live" && s.deadline !== null && now >= s.deadline) {
      resolveLot(s, s.deadline);
    } else if (s.phase === "sold" && s.resultUntil !== null && now >= s.resultUntil) {
      s.lotIndex++;
      openLot(s, s.resultUntil, rng);
    } else {
      return changed;
    }
    changed = true;
  }
}
