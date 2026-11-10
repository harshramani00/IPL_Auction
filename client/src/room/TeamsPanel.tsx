import { OVERSEAS_MAX, SQUAD_MAX, overseasCount, type TeamId } from "@auction/shared";
import { useState } from "react";
import { Crest, TEAMS, fmt, ownerLabel, seatColor, startPurse, team, teamVars } from "../view";
import { useRoomCtx } from "./context";

type View = "mine" | "all";
const VIEW_KEY = "ar-teamview";

function storedView(): View | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "mine" || v === "all" ? v : null;
  } catch {
    return null;
  }
}

export function TeamsPanel() {
  const { s, mySeat, myTeams, activeTeam } = useRoomCtx();
  const [view, setView] = useState<View | null>(storedView);
  const [tab, setTab] = useState<TeamId | null>(null);
  const shown = view ?? (mySeat ? "mine" : "all");
  const pick = (v: View) => {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ }
  };
  const viewTeam = tab && myTeams.includes(tab) ? tab : activeTeam && myTeams.includes(activeTeam) ? activeTeam : myTeams[0];
  const purseNote = s.settings.start === "fresh"
    ? `${fmt(startPurse(s, "MI"))} purse per team`
    : "Real pre-auction purses with retained players";

  let body: React.ReactNode;
  if (shown === "all") {
    const order = TEAMS.map((t) => t.id).sort((a, b) => Number(myTeams.includes(b)) - Number(myTeams.includes(a)));
    body = <div className="teams-grid">{order.map((id) => <SquadCard key={id} id={id} />)}</div>;
  } else if (!mySeat) {
    body = <div className="teams-empty">Join the auction to see your team here. Switch to All teams to follow every franchise.</div>;
  } else if (!myTeams.length || !viewTeam) {
    body = (
      <div className="teams-empty">
        {s.phase === "lobby"
          ? "You haven't claimed a team yet. Tap a free paddle on the auction table."
          : "You're not running a team in this game. Switch to All teams to follow the auction."}
      </div>
    );
  } else {
    body = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {myTeams.length > 1 && (
          <div className="team-tabs">
            {myTeams.map((id) => (
              <button key={id} className="tchip" aria-pressed={id === viewTeam} onClick={() => setTab(id)}
                style={{ ...teamVars(id), "--pc": seatColor(mySeat) } as React.CSSProperties}>
                <Crest id={id} className="dot" />{id}
              </button>
            ))}
          </div>
        )}
        <SquadCard id={viewTeam} big />
      </div>
    );
  }

  return (
    <section className="block" aria-label="Teams">
      <div className="sec-h">
        <h3>Teams</h3>
        <div className="seg" role="group" aria-label="Which teams to show">
          <button aria-pressed={shown === "mine"} onClick={() => pick("mine")}>My team</button>
          <button aria-pressed={shown === "all"} onClick={() => pick("all")}>All teams</button>
        </div>
      </div>
      <div className="hint">{purseNote} · {SQUAD_MAX} players max · {OVERSEAS_MAX} overseas max · updates live as players are sold</div>
      {body}
    </section>
  );
}

export function SquadCard({ id, big = false }: { id: TeamId; big?: boolean }) {
  const { s, mySeat } = useRoomCtx();
  const t = team(id);
  const st = s.teams[id];
  const owner = s.owners[id];
  const lobby = s.phase === "lobby";
  // Before the auction starts the squads are still empty on the server; show what each team will start with.
  const squad = lobby ? (s.settings.start === "fresh" ? [] : t.retained.map((p) => ({ ...p, retained: true }))) : st.squad;
  const purse = lobby ? startPurse(s, id) : st.purse;
  const begin = startPurse(s, id);
  const spent = squad.reduce((sum, p) => sum + (p.retained ? 0 : p.price ?? 0), 0);
  const mix = { BAT: 0, WK: 0, AR: 0, BOWL: 0 };
  for (const p of squad) if (p.cat) mix[p.cat]++;
  const list = squad.slice().sort((a, b) => Number(!!a.retained) - Number(!!b.retained) || (b.price ?? 0) - (a.price ?? 0));
  const overseas = overseasCount({ ...st, squad });

  return (
    <div className={`sq${big ? " big" : ""}${mySeat && owner === mySeat ? " mine" : ""}`}
      style={{ ...teamVars(id), "--oc": owner ? seatColor(owner) : "var(--muted)" } as React.CSSProperties}>
      <div className="sq-h">
        <Crest id={id} />
        <div className="sq-t"><b>{t.name}</b><small>{owner ? ownerLabel(s, owner) : lobby ? "Free" : "AI"}</small></div>
        <div className="sq-purse"><span>Purse left</span><b>{fmt(purse)}</b></div>
      </div>
      <div className="meter"><i style={{ width: `${begin ? ((purse / begin) * 100).toFixed(1) : 0}%` }} /></div>
      <div className="sq-stats">
        <span>Players <b>{squad.length}/{SQUAD_MAX}</b></span>
        <span>✈ Overseas <b>{overseas}/{OVERSEAS_MAX}</b></span>
        <span>Spent <b>{spent ? fmt(spent) : "—"}</b></span>
      </div>
      <div className="mix">
        {(Object.keys(mix) as (keyof typeof mix)[]).map((k) => <span key={k}>{k} <b>{mix[k]}</b></span>)}
      </div>
      {list.length ? (
        <ol className="sq-list">
          {list.map((p) => (
            <li key={`${p.name}-${p.lotId ?? "r"}`} className={p.retained ? "ret" : ""}>
              <span className="cat">{p.cat ?? ""}</span>
              <span className="nm">{p.name}{p.overseas && <em>✈</em>}{p.retained && <small> kept</small>}</span>
              <span className="amt">{p.price ? fmt(p.price) : "—"}</span>
            </li>
          ))}
        </ol>
      ) : <div className="sq-empty">No players bought yet</div>}
    </div>
  );
}
