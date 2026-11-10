// The game screen's right-hand column: Teams, Results and Bids as tabs, each
// scrolling inside the panel so the page itself never has to.
import { OVERSEAS_MAX, SQUAD_MAX, overseasCount, teamBlock, type TeamId } from "@auction/shared";
import { useState } from "react";
import { Crest, TEAMS, fmt, ownerLabel, seatColor, team, teamVars } from "../view";
import { useRoomCtx } from "./context";
import { ResultsList } from "./Results";
import { SquadCard } from "./TeamsPanel";

type Tab = "teams" | "results" | "bids";
const TAB_KEY = "ar-sidetab";

function storedTab(): Tab {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t === "teams" || t === "results" || t === "bids" ? t : "teams";
  } catch {
    return "teams";
  }
}

export function SidePanel() {
  const { s } = useRoomCtx();
  const [tab, setTab] = useState<Tab>(storedTab);
  const pick = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode */ }
  };
  const sold = s.results.filter((r) => r.status === "sold").length;
  const tabs: [Tab, string][] = [["teams", "Teams"], ["results", `Results · ${sold}/${s.results.length}`], ["bids", "Bids"]];
  return (
    <aside className="side" aria-label="Teams, results and bids">
      <div className="seg side-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => pick(id)}>{label}</button>
        ))}
      </div>
      {/* All three stay mounted so switching is instant; only the chosen one shows. */}
      <div className="side-body" hidden={tab !== "teams"}><TeamsTable /></div>
      <div className="side-body" hidden={tab !== "results"}><ResultsList /></div>
      <div className="side-body" hidden={tab !== "bids"}><BidsList /></div>
    </aside>
  );
}

/** One row per franchise: purse, squad and overseas; tap a row for the full squad. */
function TeamsTable() {
  const { s, mySeat, myTeams } = useRoomCtx();
  const [open, setOpen] = useState<TeamId | null>(null);
  const order = TEAMS.map((t) => t.id).sort((a, b) => Number(myTeams.includes(b)) - Number(myTeams.includes(a)));
  return (
    <ul className="tt">
      {order.map((id) => {
        const st = s.teams[id];
        const owner = s.owners[id];
        const leading = s.lead?.teamId === id && (s.phase === "live" || s.phase === "paused");
        const out = s.phase === "live" && !leading && (s.skipped.includes(id) ||
          (!!s.lot && s.nextAmount !== null && teamBlock(st, s.lot, s.nextAmount) !== null));
        return (
          <li key={id} className={`${mySeat && owner === mySeat ? "mine" : ""}${out ? " out" : ""}`}
            style={{ ...teamVars(id), "--oc": owner ? seatColor(owner) : "var(--muted)" } as React.CSSProperties}>
            <button className="tt-row" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
              <Crest id={id} />
              <span className="tt-name">
                <b>{id}</b>
                <small>{owner ? ownerLabel(s, owner) : "AI"}{leading ? " · leading" : out ? (s.skipped.includes(id) ? " · skipped" : " · out") : ""}</small>
              </span>
              <span className="tt-num"><b>{fmt(st.purse)}</b><small>{st.squad.length}/{SQUAD_MAX} · ✈ {overseasCount(st)}/{OVERSEAS_MAX}</small></span>
            </button>
            {open === id && <div className="tt-squad"><SquadCard id={id} /></div>}
          </li>
        );
      })}
    </ul>
  );
}

/** The bids on this player, newest first, and who has skipped. */
function BidsList() {
  const { s } = useRoomCtx();
  const live = s.phase === "live" || s.phase === "paused";
  return (
    <div className="bids-tab">
      {live && s.nextAmount !== null && <div className="hint">Next bid {fmt(s.nextAmount)}</div>}
      <ol className="bids-list">
        {s.bids.length ? s.bids.map((b) => (
          <li key={`${b.at}-${b.amount}`} style={teamVars(b.teamId)}>
            <Crest id={b.teamId} className="dot" />
            <span>{team(b.teamId).city} <span className="dim">{ownerLabel(s, b.bySeat)}</span></span>
            <b>{fmt(b.amount)}</b>
          </li>
        )) : <li className="empty">No bids on this player yet</li>}
      </ol>
      {live && s.skipped.length > 0 && <div className="hint">Skipped: {s.skipped.join(", ")}</div>}
    </div>
  );
}
