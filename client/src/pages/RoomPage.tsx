import type { Request, TeamId, User } from "@auction/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuctionTable } from "../room/AuctionTable";
import { Console } from "../room/Console";
import { RoomContext, bidBlock, teamsOf, type RoomCtx } from "../room/context";
import { Header, Strip } from "../room/Header";
import { PlayersPanel } from "../room/PlayersPanel";
import { ResultsTicker, Rules } from "../room/Results";
import { Stage } from "../room/Stage";
import { TeamsPanel } from "../room/TeamsPanel";
import { useRoom } from "../useRoom";
import { Link } from "../router";

interface Props {
  roomId: string;
  sessionKey: string;
  onName: (name: string) => Promise<User>;
}

export function RoomPage({ roomId, sessionKey, onName }: Props) {
  const conn = useRoom(roomId, sessionKey);
  const { state: s, user, send, pending, serverNow } = conn;
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [activeTeam, setActiveTeam] = useState<TeamId | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const act = useCallback(async (req: Request) => {
    const ack = await send(req);
    if (!ack.ok && ack.reason) toast(ack.reason);
    return ack;
  }, [send, toast]);

  const mySeat = s && user ? s.seats.find((p) => p?.userId === user.id)?.seat ?? null : null;
  const myTeams = useMemo(() => (s && mySeat ? teamsOf(s, mySeat) : []), [s, mySeat]);
  const active = activeTeam && myTeams.includes(activeTeam) ? activeTeam : myTeams[0] ?? null;

  const bid = useCallback((teamId?: TeamId) => {
    if (!s) return;
    const t = teamId ?? active;
    if (t) setActiveTeam(t);
    const block = bidBlock(s, mySeat, t, pending === "bid");
    if (block) { if (pending !== "bid") toast(block); return; }
    void act({ type: "bid", teamId: t!, amount: s.nextAmount! });
  }, [s, active, mySeat, pending, act, toast]);

  // Keyboard: B bids with the active team, P pauses or resumes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select")) return;
      if (e.key === "b" || e.key === "B") { e.preventDefault(); bid(); }
      if ((e.key === "p" || e.key === "P") && mySeat && s && (s.phase === "live" || s.phase === "paused")) {
        e.preventDefault();
        void act({ type: "pause" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bid, act, mySeat, s]);

  if (conn.error && !s) {
    return (
      <div className="wrap center-page">
        <div className="notice">{conn.error}</div>
        <Link to="/" className="gold-btn">Back to the start</Link>
      </div>
    );
  }
  if (!s) return <div className="wrap center-page"><div className="hint">Connecting to the room…</div></div>;

  const ctx: RoomCtx = {
    s, me: user, mySeat, myTeams, pending, serverNow, act, toast,
    activeTeam: active, setActiveTeam, bid,
    setName: async (name) => { await onName(name); },
  };

  return (
    <RoomContext.Provider value={ctx}>
      <div className="wrap">
        <Header />
        <Strip />
        {(conn.error || !conn.connected) && (
          <div className="notice">{conn.error ?? "Reconnecting to the room…"}</div>
        )}
        <PlayersPanel />
        <div className="main">
          <div className="col">
            <Stage />
            <Console />
            <AuctionTable />
            <TeamsPanel />
            <Rules />
            <p className="hint footer-links">
              Share this room: <b>{location.origin}/r/{s.roomId}</b> · <Link to="/credits">Photo &amp; data credits</Link>
            </p>
          </div>
          <ResultsTicker />
        </div>
      </div>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </RoomContext.Provider>
  );
}
