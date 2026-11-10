// Your console: only ever rendered for the viewer's own seat.
import { OVERSEAS_MAX, SQUAD_MAX, overseasCount } from "@auction/shared";
import { Crest, fmt, seatColor, teamVars } from "../view";
import { bidBlock, bidLabel, skipBlock, useRoomCtx } from "./context";

/** `dock`: the one-line bar pinned to the bottom of the game screen. */
export function Console({ dock = false }: { dock?: boolean }) {
  const { s, mySeat, myTeams, activeTeam, setActiveTeam, bid, skip, pending } = useRoomCtx();
  if (!mySeat) return null;
  const lobby = s.phase === "lobby";
  const active = activeTeam && myTeams.includes(activeTeam) ? activeTeam : myTeams[0] ?? null;
  const block = bidBlock(s, mySeat, active, pending === "bid");
  const canSkip = !pending && skipBlock(s, mySeat, active) === null;
  const st = active ? s.teams[active] : null;

  const chips = (
    <div className="con-teams">
      {myTeams.map((id) => (
        <button key={id} className="tchip" style={teamVars(id)} aria-pressed={!lobby && id === active}
          onClick={() => !lobby && setActiveTeam(id)}>
          <Crest id={id} className="dot" />{id}
          {s.phase === "live" && s.skipped.includes(id) && <span className="tskip">skipped</span>}
        </button>
      ))}
    </div>
  );
  const actions = (
    <div className="con-actions">
      <button className="bidbtn" style={active ? teamVars(active) : undefined} disabled={!!block}
        onClick={() => bid(active ?? undefined)}>
        {pending === "bid" ? "Sending…" : bidLabel(s, active)}
      </button>
      <button className="skipbtn" disabled={!canSkip} onClick={() => skip(active ?? undefined)}
        title={active ? `${active} sits this player out` : undefined}>
        {pending === "skip" ? "…" : "Skip"}
      </button>
    </div>
  );

  if (dock) {
    return (
      <section className="console dock" style={{ "--pc": seatColor(mySeat) } as React.CSSProperties} aria-label="Your console">
        <span className="pbadge">P{mySeat}</span>
        {myTeams.length ? chips : <span className="con-note">You didn't claim a team for this game, so you're watching.</span>}
        {st && (
          <div className="con-stats">
            <span>Purse <b>{fmt(st.purse)}</b></span>
            <span>Squad <b>{st.squad.length}/{SQUAD_MAX}</b></span>
            <span>✈ <b>{overseasCount(st)}/{OVERSEAS_MAX}</b></span>
          </div>
        )}
        <div className="con-note">{block ?? "B to bid · S to skip"}</div>
        {myTeams.length > 0 && actions}
      </section>
    );
  }

  return (
    <section className="console" style={{ "--pc": seatColor(mySeat) } as React.CSSProperties} aria-label="Your console">
      <div className="con-h">
        <span className="pbadge">P{mySeat}</span>
        <b>Your console</b>
        <span className="con-lbl" style={{ marginLeft: 6 }}>{myTeams.length} / {s.cap} teams</span>
        {!lobby && <kbd title="Keyboard shortcuts: B to bid, S to skip, P to pause">B · S · P</kbd>}
      </div>
      <div className="con-lbl">{lobby ? "Your teams · tap a paddle again to give it back" : "Bidding as"}</div>
      {myTeams.length ? (
        <div className="con-teams">
          {myTeams.map((id) => (
            <button key={id} className="tchip" style={teamVars(id)} aria-pressed={!lobby && id === active}
              onClick={() => !lobby && setActiveTeam(id)}>
              <Crest id={id} className="dot" />{id}
              {s.phase === "live" && s.skipped.includes(id) && <span className="tskip">skipped</span>}
            </button>
          ))}
        </div>
      ) : (
        <div className="empty-own">
          {lobby
            ? `Tap free paddles on the auction table below to claim up to ${s.cap} team${s.cap > 1 ? "s" : ""}.`
            : "You didn't claim any teams for this game, so you're watching this one."}
        </div>
      )}
      {!lobby && (
        <>
          {st && (
            <div className="con-stats">
              <span>Purse <b>{fmt(st.purse)}</b></span>
              <span>Squad <b>{st.squad.length}/{SQUAD_MAX}</b></span>
              <span>✈ <b>{overseasCount(st)}/{OVERSEAS_MAX}</b></span>
            </div>
          )}
          <div className="con-actions">
            <button className="bidbtn" style={active ? teamVars(active) : undefined} disabled={!!block}
              onClick={() => bid(active ?? undefined)}>
              {pending === "bid" ? "Sending…" : bidLabel(s, active)}
            </button>
            <button className="skipbtn" disabled={!canSkip} onClick={() => skip(active ?? undefined)}
              title={active ? `${active} sits this player out` : undefined}>
              {pending === "skip" ? "…" : "Skip"}
            </button>
          </div>
        </>
      )}
      <div className="con-note">
        {lobby ? (myTeams.length ? "Waiting for the auction to start." : "") : block ?? "Press B or tap your paddle to bid, S to skip"}
      </div>
    </section>
  );
}
