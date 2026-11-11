// The auctioneer's recorded voice: every line he says is a short list of
// clips (a name, a price, a team, a stock phrase) played back to back, so the
// same few hundred recordings cover any auction. `scripts/build_voice.ts`
// generates them into static/voice/; a clip's key is its file name.
import { incrementFor, type GameData, type Lot, type TeamId, type TeamInfo } from "@auction/shared";
import { spokenAmount } from "../speech";

/** Prices are recorded up to here (lakhs); a bid beyond it falls back to the browser's voice. */
export const MAX_SPOKEN_AMOUNT = 3000;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const clip = {
  welcome: "welcome",
  base: "base-price",
  once: "going-once",
  twice: "going-twice",
  sold: "sold",
  unsold: "unsold",
  paused: "paused",
  back: "back",
  done: "done",
  /** The player's name. */
  name: (lotId: number) => `name-${lotId}`,
  /** "Batter." or "Batter, overseas." */
  role: (lot: Pick<Lot, "role" | "overseas">) => `role-${slug(lot.role)}${lot.overseas ? "-overseas" : ""}`,
  /** "2 crore 40 lakh." */
  amount: (lakhs: number) => `amount-${lakhs}`,
  /** "Kolkata.", after a price: who the bid is with. */
  city: (team: TeamId) => `city-${team.toLowerCase()}`,
  /** "to Kolkata Knight Riders, for", between SOLD's name and price. */
  to: (team: TeamId) => `to-${team.toLowerCase()}`,
};

export interface ClipText {
  key: string;
  text: string;
}

/** Every price the auction can reach: each base price, walked up by the bid increments. */
export function spokenAmounts(lots: Pick<Lot, "base">[]): number[] {
  const all = new Set<number>();
  for (const base of new Set(lots.map((l) => l.base))) {
    for (let a = base; a <= MAX_SPOKEN_AMOUNT; a += incrementFor(a)) all.add(a);
  }
  return [...all].sort((a, b) => a - b);
}

/** Every clip the game can ask for, with the words to record for it. */
export function catalogue(data: Pick<GameData, "lots">, teams: TeamInfo[]): ClipText[] {
  const out: ClipText[] = [
    { key: clip.welcome, text: "Welcome to the auction." },
    { key: clip.base, text: "Base price," },
    { key: clip.once, text: "Going once." },
    { key: clip.twice, text: "Going twice!" },
    { key: clip.sold, text: "Sold!" },
    { key: clip.unsold, text: "Unsold." },
    { key: clip.paused, text: "Auction paused." },
    { key: clip.back, text: "We're back." },
    { key: clip.done, text: "And that's the end of the auction. Thank you, everyone." },
  ];
  const roles = new Map<string, string>();
  for (const lot of data.lots) roles.set(clip.role(lot), `${lot.role}${lot.overseas ? ", overseas" : ""}.`);
  for (const [key, text] of [...roles].sort()) out.push({ key, text });
  for (const t of teams) {
    out.push({ key: clip.city(t.id), text: `${t.city}.` });
    out.push({ key: clip.to(t.id), text: `to ${t.name}, for` });
  }
  for (const a of spokenAmounts(data.lots)) out.push({ key: clip.amount(a), text: `${spokenAmount(a)}.` });
  for (const lot of data.lots) out.push({ key: clip.name(lot.id), text: `${lot.name}.` });
  return out;
}
