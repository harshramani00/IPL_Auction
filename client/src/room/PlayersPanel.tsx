import { MAX_SEATS } from "@auction/shared";
import { useEffect, useState } from "react";
import { teamsOf, useRoomCtx } from "./context";
import { seatColor } from "../view";

export function PlayersPanel() {
  const { s, me, mySeat, act, pending } = useRoomCtx();
  const [armed, setArmed] = useState(false);
  const lobby = s.phase === "lobby";
  const seated = s.seats.filter((p) => p !== null);
  const isLead = mySeat !== null && mySeat === s.leadSeat;

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  const capHint = seated.length
    ? `Each player can run up to ${s.cap} team${s.cap > 1 ? "s" : ""}` +
      (lobby && seated.length < MAX_SEATS ? " · the limit drops as more people join" : "")
    : "1 player runs up to 10 teams · 2 → 5 each · 3 → 3 · 4–5 → 2 · 6–10 → 1";

  return (
    <section className="room" aria-label="Players">
      <div className="room-h">
        <h3>Players <span>{seated.length} / {MAX_SEATS}</span></h3>
        <span className="hint">{capHint}</span>
        <div className="room-ctrls">
          {!me ? <NameForm /> : mySeat ? (
            lobby && <button className="ghost" disabled={!!pending} onClick={() => act({ type: "leave" })}>Leave</button>
          ) : (
            lobby && seated.length < MAX_SEATS &&
            <button className="gold-btn" disabled={!!pending} onClick={() => act({ type: "join" })}>Join the auction</button>
          )}
          {mySeat && (s.phase === "live" || s.phase === "paused") && (
            <button className="ghost" onClick={() => act({ type: "pause" })}>{s.phase === "paused" ? "Resume" : "Pause"}</button>
          )}
          {isLead && !lobby && (
            <button
              className={`ghost${armed ? " danger" : ""}`}
              onClick={() => { if (armed) { setArmed(false); void act({ type: "reset" }); } else setArmed(true); }}
            >
              {armed ? "Tap again to reset" : "Reset game"}
            </button>
          )}
        </div>
      </div>
      <div className="roster">
        {seated.map((p) => (
          <span key={p.seat} className={`pchip${p.userId === me?.id ? " me" : ""}`} style={{ "--pc": seatColor(p.seat) } as React.CSSProperties}>
            <span className="pbadge">P{p.seat}</span>
            <b>{p.name}{p.userId === me?.id ? " (you)" : ""}</b>
            <small>
              {teamsOf(s, p.seat).length}/{s.cap}
              {p.seat === s.leadSeat ? " · lead" : ""}
              {p.connected ? "" : " · away"}
            </small>
          </span>
        ))}
        {!seated.length && <span className="pchip open">Nobody has joined yet</span>}
        {seated.length > 0 && lobby && seated.length < MAX_SEATS &&
          <span className="pchip open">{MAX_SEATS - seated.length} seats open</span>}
      </div>
    </section>
  );
}

/** Shown to visitors without a name: pick one to be able to join. */
function NameForm() {
  const { setName } = useRoomCtx();
  const [name, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        setName(name).catch((err: Error) => setError(err.message));
      }}
    >
      <input
        aria-label="Your name" placeholder="Your name to play" maxLength={24}
        value={name} onChange={(e) => setValue(e.target.value)}
      />
      <button className="gold-btn" disabled={!name.trim()}>Join</button>
      {error && <span className="hint">{error}</span>}
    </form>
  );
}
