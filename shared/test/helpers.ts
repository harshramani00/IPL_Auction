import { TEAM_IDS, type GameData, type Lot, type SquadPlayer, type TeamId } from "../src/index.js";

export const T0 = 1_000_000;

export function lot(id: number, extra: Partial<Lot> = {}): Lot {
  return {
    id, name: `Player ${id}`, cc: "IND", country: "India", overseas: false, cat: "BAT",
    role: "Batter", capped: true, set: "Set 1 · Capped batters", setCode: "BA1",
    base: 200, tier: "B", photo: null, ...extra,
  };
}

export const player = (name: string, extra: Partial<SquadPlayer> = {}): SquadPlayer => ({
  name, price: 100, role: "Batter", cat: "BAT", overseas: false, photo: null, ...extra,
});

/** Small game: three lots, every team with a 120 Cr purse and no retained players. */
export function testData(overrides: { lots?: Lot[]; retained?: Partial<Record<TeamId, SquadPlayer[]>>; purse?: number } = {}): GameData {
  const lots = overrides.lots ?? [lot(1), lot(2, { overseas: true, cc: "AUS", country: "Australia" }), lot(3)];
  const ids = lots.map((l) => l.id);
  return {
    lots,
    presets: {
      quick: { label: "Quick", lots: ids.slice(0, 2) },
      capped: { label: "Capped", lots: ids },
      full: { label: "Full", lots: ids },
    },
    teams: TEAM_IDS.map((id) => ({
      id, name: id, city: id, color: "#000", ring: "#fff", ink: "#fff", logo: null,
      purse: overrides.purse ?? 12000, retained: overrides.retained?.[id] ?? [],
    })),
    freshPurse: 12000,
  };
}

/** Deterministic random source cycling through the given values. */
export function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

export const users = Array.from({ length: 11 }, (_, i) => ({ id: `u${i + 1}`, name: `User ${i + 1}` }));
