import { gameData } from "@auction/shared/data";
import { MAX_SEATS } from "@auction/shared";
import { cloneElement, useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "../router";
import { sound } from "../sound";
import { setViewMode, useViewMode } from "../viewMode";
import { teamsOf, useRoomCtx } from "./context";
import { Rules } from "./Results";
import { fmt, lotsById, seatColor } from "../view";

export function Header() {
  const { s, mySeat, me } = useRoomCtx();
  const ph = s.phase;
  const live = ph === "live" || ph === "paused" || ph === "sold";
  const preset = gameData.presets[s.settings.preset];
  const status = mySeat
    ? <>You're <b>P{mySeat}</b> · {me?.name}</>
    : me ? <>Watching · join to play</> : <>Watching</>;
  return (
    <header className="bar">
      <div className="brand">
        <span className="mark has-img"><img src="/logos/IPL.svg" alt="IPL" /></span>
        <div>
          <h1>Auction Room</h1>
          <div className="sub">
            <span className={`live${live ? "" : " off"}`}>
              <i />
              {ph === "lobby" ? "Lobby" : ph === "done" ? "Finished" : ph === "paused" ? "Paused" : "Live"}
            </span>
            Room {s.roomId} · <b>{ph === "lobby" ? preset.label : `Lot ${Math.min(s.lotIndex + 1, s.lotCount)} / ${s.lotCount}`}</b>
          </div>
        </div>
      </div>
      <div className="bar-r">
        <ViewToggle />
        <SoundToggle />
        <span className="conn">{status}</span>
      </div>
    </header>
  );
}

/**
 * The game's one-line top bar while the auction runs: brand and lot, the
 * players, and the controls. Replaces the header, ticker and players panel.
 */
export function GameBar() {
  const { s, mySeat, me, act } = useRoomCtx();
  const [rules, setRules] = useState(false);
  const [armed, setArmed] = useState(false);
  const ph = s.phase;
  const isLead = mySeat !== null && mySeat === s.leadSeat;
  const seated = s.seats.filter((p) => p !== null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <header className="bar game-bar">
      <div className="brand">
        <span className="mark has-img"><img src="/logos/IPL.svg" alt="IPL" /></span>
        <div>
          <h1>Auction Room</h1>
          <div className="sub">
            <span className={`live${ph === "done" ? " off" : ""}`}>
              <i />{ph === "done" ? "Finished" : ph === "paused" ? "Paused" : "Live"}
            </span>
            <span className="gb-room">Room {s.roomId} · </span><b>Lot {Math.min(s.lotIndex + 1, s.lotCount)} / {s.lotCount}</b>
          </div>
        </div>
      </div>
      <div className="gb-players" aria-label={`Players ${seated.length} of ${MAX_SEATS}`}>
        {seated.map((p) => (
          <span key={p.seat} className={`pchip mini${p.userId === me?.id ? " me" : ""}${p.connected ? "" : " away"}`}
            style={{ "--pc": seatColor(p.seat) } as React.CSSProperties}
            title={`${p.name}: ${teamsOf(s, p.seat).join(", ") || "no teams"}${p.connected ? "" : " (away)"}`}>
            <span className="pbadge">P{p.seat}</span>{p.name}{p.userId === me?.id ? " (you)" : ""}
          </span>
        ))}
      </div>
      <div className="bar-r">
        {mySeat && (ph === "live" || ph === "paused") && (
          <button className="ghost" onClick={() => act({ type: "pause" })}>{ph === "paused" ? "Resume" : "Pause"}</button>
        )}
        {isLead && (
          <button className={`ghost${armed ? " danger" : ""}`}
            onClick={() => { if (armed) { setArmed(false); void act({ type: "reset" }); } else setArmed(true); }}>
            {armed ? "Tap again" : "Reset"}
          </button>
        )}
        <ViewToggle />
        <SoundToggle compact />
        <button className="ghost icon-btn" aria-label="Rules and room link" title="Rules" onClick={() => setRules(true)}>?</button>
        <span className="conn">{mySeat ? <>P{mySeat} · {me?.name}</> : me ? <>Watching · join next game</> : <>Watching</>}</span>
      </div>
      {rules && <RulesDialog onClose={() => setRules(false)} />}
    </header>
  );
}

function RulesDialog({ onClose }: { onClose: () => void }) {
  const { s } = useRoomCtx();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Rules" onClick={(e) => e.stopPropagation()}>
        <div className="sec-h">
          <h3>How it works</h3>
          <button className="ghost icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <Rules />
        <p className="hint">
          Keys: <b>B</b> bid · <b>S</b> skip · <b>P</b> pause. Share this room: <b>{location.origin}/r/{s.roomId}</b> ·{" "}
          <Link to="/credits">Photo &amp; data credits</Link>
        </p>
      </div>
    </div>
  );
}

function ViewToggle() {
  const view = useViewMode();
  return (
    <div className="seg view-toggle" role="group" aria-label="View">
      <button aria-pressed={view === "3d"} onClick={() => setViewMode("3d")}>3D hall</button>
      <button aria-pressed={view === "classic"} onClick={() => setViewMode("classic")}>Classic</button>
    </div>
  );
}

function SoundToggle({ compact = false }: { compact?: boolean }) {
  const on = useSyncExternalStore((fn) => sound.subscribe(fn), () => sound.enabled);
  return (
    <button className={`ghost sound-toggle${compact ? " icon-btn" : ""}`} aria-pressed={on}
      title="Auctioneer voice and sound effects" aria-label={on ? "Sound on" : "Sound off"}
      onClick={() => sound.setEnabled(!on)}>
      {compact ? (on ? "🔊" : "🔇") : on ? "🔊 Sound on" : "🔇 Sound off"}
    </button>
  );
}

/** Scrolling "Latest" results strip under the header. */
export function Strip() {
  const { s } = useRoomCtx();
  const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Scroll only when there's enough to fill the strip; one or two results just sit still.
  const reduce = reduceMotion || (s.results.length > 0 && s.results.length < 4);
  const purse = s.settings.start === "fresh" ? `${fmt(gameData.freshPurse)} purse per team` : "Real pre-auction purses and squads";
  const items = s.results.length
    ? s.results.slice(-12).reverse().map((r) => r.status === "sold"
      ? <span key={r.lotId}>{r.name} <i>to</i> {r.teamId}<b>{fmt(r.amount!)}</b></span>
      : <span key={r.lotId} className="uns">{r.name} <i>unsold</i><b>{fmt(lotsById.get(r.lotId)?.base ?? 0)}</b></span>)
    : [
      <span key="a">IPL 2026 Auction · {gameData.presets[s.settings.preset].label} · 10 franchises · up to 10 bidders</span>,
      <span key="b">{purse}</span>,
      <span key="c">{s.phase === "lobby" ? "Lobby open · join and claim your teams" : "Bidding is live"}</span>,
    ];
  return (
    <div className="strip" aria-label="Latest results">
      <span className="strip-label">Latest</span>
      <div className="strip-track">
        <div className={`strip-run${reduce ? " still" : ""}`} style={{ "--dur": `${Math.max(20, items.length * 6)}s` } as React.CSSProperties}>
          {items}
          {/* A second copy makes the marquee loop seamlessly. */}
          {!reduce && items.map((el) => cloneElement(el, { key: `dup-${el.key}`, "aria-hidden": true }))}
        </div>
      </div>
    </div>
  );
}
