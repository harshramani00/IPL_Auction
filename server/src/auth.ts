// Who is on the other end of a request or socket. v1: a display name and a
// generated user id in a signed cookie. Swap in OAuth by implementing AuthProvider.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { User } from "@auction/shared";

export interface AuthProvider {
  /** The user for a raw Cookie header, or null if there's no valid session. */
  userFromCookie(cookieHeader: string | undefined): User | null;
  /** Create (or rename) a session; returns the Set-Cookie header value. */
  issue(name: string, existing: User | null): { user: User; setCookie: string };
}

export const COOKIE_NAME = "ar_session";
const MAX_AGE_S = 60 * 60 * 24 * 365;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class CookieAuth implements AuthProvider {
  constructor(private readonly secret: string) {}

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  userFromCookie(cookieHeader: string | undefined): User | null {
    const raw = parseCookies(cookieHeader)[COOKIE_NAME];
    if (!raw) return null;
    const [payload, sig] = raw.split(".");
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as User;
      return typeof user.id === "string" && typeof user.name === "string" ? user : null;
    } catch {
      return null;
    }
  }

  issue(name: string, existing: User | null) {
    const user: User = { id: existing?.id ?? randomUUID(), name };
    const payload = Buffer.from(JSON.stringify(user)).toString("base64url");
    const value = encodeURIComponent(`${payload}.${this.sign(payload)}`);
    return {
      user,
      setCookie: `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}`,
    };
  }
}
