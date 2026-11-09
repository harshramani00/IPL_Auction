// Configuration from the environment (.env in the repo root, see .env.example).
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env file: fall back to the process environment and defaults.
}

export interface Config {
  port: number;
  cookieSecret: string;
  aiEnabled: boolean;
  /** Extra origin allowed to open sockets (only needed when the client is served elsewhere). */
  clientOrigin: string | null;
}

export function loadConfig(env = process.env): Config {
  let cookieSecret = env.COOKIE_SECRET ?? "";
  if (!cookieSecret) {
    cookieSecret = randomBytes(32).toString("hex");
    console.warn("COOKIE_SECRET is not set: using a random one, so sessions reset when the server restarts.");
  }
  return {
    port: Number(env.PORT ?? 3001),
    cookieSecret,
    aiEnabled: env.AI_ENABLED !== "false",
    clientOrigin: env.CLIENT_ORIGIN || null,
  };
}
