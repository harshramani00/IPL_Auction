// Typed access to the generated game data (scripts/build_game_data.py).
import creditsJson from "../data/credits.json";
import lotsJson from "../data/lots.json";
import statsJson from "../data/stats.json";
import teamsJson from "../data/teams.json";
import type { GameData, Lot, PresetId, TeamId, TeamInfo } from "./types.js";

export interface StatLine {
  m: number | null;
  runs: number;
  sr: number | null;
  avg: number | null;
  wk: number;
  econ: number | null;
}

export interface PlayerStats {
  n: string;
  season: string;
  last: (StatLine & { team: TeamId | null }) | null;
  ipl: (StatLine & { hs: string | null; bb: string | null }) | null;
  t20: (StatLine & { asof: string | null }) | null;
}

export interface StatsFile {
  season: string;
  statsAsOf: string | null;
  source: string;
  players: PlayerStats[];
}

export interface Credits {
  stats: string;
  logos: string;
  photos: { name: string; photo: string; artist: string; license: string; source: string }[];
}

const lotsFile = lotsJson as unknown as {
  season: number;
  presets: Record<PresetId, { label: string; lots: number[] }>;
  lots: Lot[];
};
const teamsFile = teamsJson as unknown as { freshPurse: number; teams: TeamInfo[] };

export const gameData: GameData = {
  lots: lotsFile.lots,
  presets: lotsFile.presets,
  teams: teamsFile.teams,
  freshPurse: teamsFile.freshPurse,
};

export const stats = statsJson as unknown as StatsFile;
export const credits = creditsJson as unknown as Credits;

export const statsByName = new Map(stats.players.map((p) => [p.n, p]));
export const teamInfo = Object.fromEntries(gameData.teams.map((t) => [t.id, t])) as Record<TeamId, TeamInfo>;
