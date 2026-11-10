import { gameData } from "@auction/shared/data";
import { fmt, lotsById, ownerLabel, team } from "../view";
import { useRoomCtx } from "./context";

export function ResultsTicker() {
  const { s } = useRoomCtx();
  const sold = s.results.filter((r) => r.status === "sold").length;
  const newest = s.results.slice().reverse();
  return (
    <aside className="ticker" aria-label="Results">
      <div className="sec-h"><h3>Results</h3><span className="tally">{sold} sold · {s.results.length - sold} unsold</span></div>
      <ol className="results">
        {newest.length ? newest.map((r) => r.status === "sold" ? (
          <li key={r.lotId} className="res">
            <span className="pill">Sold</span>
            <div style={{ minWidth: 0 }}>
              <div className="nm">{r.name}</div>
              <div className="by">{team(r.teamId!).city} · {ownerLabel(s, r.bySeat)}</div>
            </div>
            <span className="amt">{fmt(r.amount!)}</span>
          </li>
        ) : (
          <li key={r.lotId} className="res unsold">
            <span className="pill">Unsold</span>
            <div style={{ minWidth: 0 }}><div className="nm">{r.name}</div><div className="by">No bid at base</div></div>
            <span className="amt dim">{fmt(lotsById.get(r.lotId)?.base ?? 0)}</span>
          </li>
        )) : <li className="res-empty">Sold and unsold players land here as the hammer falls.</li>}
      </ol>
    </aside>
  );
}

export function Rules() {
  return (
    <ol className="rules">
      <li><b>Your seat is yours.</b> Each person joins from their own device. You only get a console for your own seat, and the server checks every bid against the account that sent it, so nobody can bid for another player's team.</li>
      <li><b>Up to 10 players.</b> Anyone with the link can join in the lobby. The 10 franchises are split evenly: 1 player runs up to 10 teams, 2 players 5 each, 3 players 3 each, 4–5 players 2 each, 6–10 players 1 each. Teams nobody claims are bid for by AI. If someone joins after you've claimed, your most recent extra claims go back on the table.</li>
      <li><b>Real auction, your way.</b> The lots are the {gameData.lots.length} players from the December 2025 IPL auction, in the official set order. The lead picks a short or full list, and whether teams start with their real retained squads and purses or a fresh {fmt(gameData.freshPurse)} each.</li>
      <li><b>One team per bid.</b> Each bid is placed by one of your teams; pick it in your console or tap its paddle. A team can't raise its own top bid, but your other teams can bid against it.</li>
      <li><b>The hammer is automatic.</b> Every bid restarts a 45-second clock: "going once" at 10 seconds, "going twice" at 5, then the bails come off and the player is sold. No opening bid inside 45 seconds means unsold.</li>
      <li><b>Increments.</b> ₹5 L below ₹1 Cr, ₹10 L up to ₹2 Cr, ₹20 L up to ₹5 Cr, then ₹25 L. Squads max out at 25 players with 8 overseas, retained players included.</li>
    </ol>
  );
}
