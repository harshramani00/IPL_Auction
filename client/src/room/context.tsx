import {
  teamBlock, teamsOf as engineTeamsOf, type Ack, type Request, type Snapshot, type TeamId, type User,
} from "@auction/shared";
import { createContext, useContext } from "react";
import type { RoomConnection } from "../useRoom";
import { fmt } from "../view";

export interface RoomCtx {
  s: Snapshot;
  me: User | null;
  mySeat: number | null;
  myTeams: TeamId[];
  pending: RoomConnection["pending"];
  serverNow: () => number;
  /** Send a request; failures are shown as a toast. */
  act: (req: Request) => Promise<Ack>;
  toast: (msg: string) => void;
  activeTeam: TeamId | null;
  setActiveTeam: (t: TeamId) => void;
  /** Bid as `team` (default: the active team) at the next amount. */
  bid: (team?: TeamId) => void;
  setName: (name: string) => Promise<void>;
}

export const RoomContext = createContext<RoomCtx | null>(null);

export function useRoomCtx(): RoomCtx {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error("useRoomCtx outside a room");
  return ctx;
}

export const teamsOf = (s: Snapshot, seat: number) =>
  engineTeamsOf({ owners: s.owners } as Parameters<typeof engineTeamsOf>[0], seat);

/** Why `team` can't bid right now (shown under the button), or null. Mirrors the server's checks. */
export function bidBlock(s: Snapshot, seat: number | null, team: TeamId | null, pending: boolean): string | null {
  if (!seat) return "Join the auction to bid";
  if (pending) return "Sending your bid…";
  if (s.phase === "paused") return "The auction is paused";
  if (s.phase !== "live" || !s.lot || s.nextAmount === null) {
    return s.phase === "done" ? "The auction is over" : "Waiting for the next player";
  }
  if (!team) return "You have no teams in this game";
  if (s.lead && s.owners[s.lead.teamId] === seat) return `Your team ${s.lead.teamId} holds the bid`;
  return teamBlock(s.teams[team], s.lot, s.nextAmount);
}

export const bidLabel = (s: Snapshot, team: TeamId | null) =>
  s.phase === "live" && team && s.nextAmount !== null ? `Bid ${fmt(s.nextAmount)} as ${team}` : "Bid";
