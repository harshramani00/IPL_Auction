import type { User } from "@auction/shared";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const getSession = () => call<{ user: User | null }>("/api/session").then((r) => r.user);

export const setName = (name: string) =>
  call<{ user: User }>("/api/session", { method: "POST", body: JSON.stringify({ name }) }).then((r) => r.user);

export const createRoom = () => call<{ id: string }>("/api/rooms", { method: "POST" }).then((r) => r.id);

export const roomExists = (id: string) =>
  call<{ id: string }>(`/api/rooms/${encodeURIComponent(id)}`).then(() => true, () => false);
