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
  /** Each set's players come up in a random order (SHUFFLE_SETS=false keeps the official order). */
  shuffleSets: boolean;
  /** Extra origin allowed to open sockets (only needed when the client is served elsewhere). */
  clientOrigin: string | null;
}

/**
 * `dev`: running next to the Vite dev server, which may itself be given PORT,
 * so only SERVER_PORT applies. In production, hosting platforms set PORT.
 */
export function loadConfig(env = process.env, dev = process.argv.includes("--dev")): Config {
  let cookieSecret = env.COOKIE_SECRET ?? "";
  if (!cookieSecret) {
    cookieSecret = randomBytes(32).toString("hex");
    console.warn("COOKIE_SECRET is not set: using a random one, so sessions reset when the server restarts.");
  }
  return {
    port: Number((dev ? env.SERVER_PORT : env.PORT ?? env.SERVER_PORT) ?? 3001),
    cookieSecret,
    aiEnabled: env.AI_ENABLED !== "false",
    shuffleSets: env.SHUFFLE_SETS !== "false",
    clientOrigin: env.CLIENT_ORIGIN || null,
  };
}
