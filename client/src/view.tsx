// Small view helpers shared by the room components.
import {
  SEAT_COLORS, TEAM_IDS, formatAmount, type Snapshot, type TeamId, type TeamInfo,
} from "@auction/shared";
import { gameData, teamInfo } from "@auction/shared/data";
import { useState, type CSSProperties } from "react";

export const fmt = formatAmount;
/** Broadcast order: MI, CSK, RCB, KKR, SRH, DC, RR, PBKS, GT, LSG. */
export const TEAMS: TeamInfo[] = TEAM_IDS.map((id) => teamInfo[id]);
export const team = (id: TeamId) => teamInfo[id];
export const lotsById = new Map(gameData.lots.map((l) => [l.id, l]));

export const seatColor = (seat: number) => SEAT_COLORS[(seat - 1) % SEAT_COLORS.length]!;

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** CSS variables that colour crests, paddles and buttons in team colours. */
export const teamVars = (id: TeamId): CSSProperties => {
  const t = teamInfo[id];
  return {
    "--tc": t.color, "--tc2": t.ring, "--ink": t.ink, "--cfs": id.length > 3 ? ".8" : "1",
  } as CSSProperties;
};

export function seatName(s: Snapshot, seat: number | null | undefined, meId?: string): string {
  if (!seat) return "AI";
  const p = s.seats[seat - 1];
  if (!p) return `P${seat}`;
  return p.userId === meId ? `${p.name} (you)` : p.name;
}

/** "P2 · Rohan", or "AI" for unowned teams. */
export const ownerLabel = (s: Snapshot, seat: number | null | undefined) =>
  seat ? `P${seat} · ${seatName(s, seat)}` : "AI";

/** Starting purse for this game, for the spent meter. */
export const startPurse = (s: Snapshot, id: TeamId) =>
  s.settings.start === "fresh" ? gameData.freshPurse : teamInfo[id].purse;

/** Image that falls back to `fallback` if it's missing or fails to load. */
export function Img({ src, alt, fallback }: { src: string | null; alt: string; fallback: React.ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} draggable={false} onError={() => setFailed(true)} />;
}

export function Crest({ id, className = "crest" }: { id: TeamId; className?: string }) {
  const t = teamInfo[id];
  const [failed, setFailed] = useState(false);
  const logo = t.logo && !failed;
  return (
    <span className={`${className}${logo ? " has-img" : ""}`} style={teamVars(id)}>
      {logo ? <img src={t.logo!} alt={t.city} draggable={false} onError={() => setFailed(true)} /> : id}
    </span>
  );
}
