// Game data for the server: everything in data.ts plus the real auction
// prices that anchor the AI. Never import this from the client, or every
// player's real price ends up in the browser bundle.
import marketJson from "../data/market.json";
import { gameData } from "./data.js";
import type { GameData, MarketPrices } from "./types.js";

const market: MarketPrices = Object.fromEntries(
  Object.entries(marketJson as Record<string, number | null>).map(([id, price]) => [Number(id), price]));

export const serverGameData: GameData = { ...gameData, market };
