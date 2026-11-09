import { gameData } from "@auction/shared/data";
import { cloneElement, useSyncExternalStore } from "react";
import { sound } from "../sound";
import { useRoomCtx } from "./context";
import { fmt, lotsById } from "../view";

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
        <SoundToggle />
        <span className="conn">{status}</span>
      </div>
    </header>
  );
}

function SoundToggle() {
  const on = useSyncExternalStore((fn) => sound.subscribe(fn), () => sound.enabled);
  return (
    <button className="ghost sound-toggle" aria-pressed={on} title="Auctioneer voice and sound effects"
      onClick={() => sound.setEnabled(!on)}>
      {on ? "🔊 Sound on" : "🔇 Sound off"}
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
