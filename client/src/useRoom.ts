// Live connection to one room: the latest server snapshot, who we are, and a
// request helper that resolves with the server's ack (or a timeout).
import type { Ack, Request, Snapshot, User } from "@auction/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

const ACK_TIMEOUT_MS = 5000;
const OFFSET_SAMPLES = 20;

export interface RoomConnection {
  state: Snapshot | null;
  user: User | null;
  connected: boolean;
  error: string | null;
  /** Request type currently waiting for its ack, if any. */
  pending: Request["type"] | null;
  send: (req: Request) => Promise<Ack>;
  /** Server time estimate in ms (local clock + measured offset). */
  serverNow: () => number;
}

export function useRoom(roomId: string, sessionKey: string): RoomConnection {
  const [state, setState] = useState<Snapshot | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Request["type"] | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const offsets = useRef<number[]>([]);
  const waiting = useRef(new Map<string, (a: Ack) => void>());

  useEffect(() => {
    const socket = io({ auth: { roomId }, transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setError("Can't reach the auction server. Retrying…"));
    socket.on("room-error", (e: { reason: string }) => setError(e.reason));
    socket.on("hello", (h: { user: User | null }) => setUser(h.user));
    socket.on("state", (snap: Snapshot) => {
      // The smallest delay seen is the best guess at the true clock offset.
      const list = offsets.current;
      list.push(snap.serverNow - Date.now());
      if (list.length > OFFSET_SAMPLES) list.shift();
      setState(snap);
    });
    socket.on("ack", (a: Ack) => {
      waiting.current.get(a.requestId)?.(a);
    });
    return () => {
      socket.close();
      socketRef.current = null;
      for (const done of waiting.current.values()) done({ requestId: "", ok: false, reason: "Disconnected" });
      waiting.current.clear();
    };
    // sessionKey: reconnect after the player sets a name so the new cookie is used.
  }, [roomId, sessionKey]);

  const send = useCallback((req: Request) => new Promise<Ack>((resolve) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      resolve({ requestId: "", ok: false, reason: "Not connected to the room" });
      return;
    }
    const requestId = crypto.randomUUID();
    setPending(req.type);
    const finish = (a: Ack) => {
      clearTimeout(timer);
      waiting.current.delete(requestId);
      setPending(null);
      resolve(a);
    };
    const timer = setTimeout(
      () => finish({ requestId, ok: false, reason: "No answer from the server. Try again" }), ACK_TIMEOUT_MS);
    waiting.current.set(requestId, finish);
    socket.emit("request", { requestId, ...req });
  }), []);

  const serverNow = useCallback(() => {
    const list = offsets.current;
    return Date.now() + (list.length ? Math.max(...list) : 0);
  }, []);

  return { state, user, connected, error, pending, send, serverNow };
}

/** Re-render the calling component `hz` times a second. */
export function useTicker(hz: number, active = true): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000 / hz);
    return () => clearInterval(id);
  }, [hz, active]);
}
