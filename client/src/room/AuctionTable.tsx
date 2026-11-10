// The auction table: ten franchise paddles. Lobby: tap to claim / release.
// Live: tap your own paddle to bid as that team.
import { teamBlock } from "@auction/shared";
import { Crest, TEAMS, fmt, ownerLabel, seatColor, seatName, teamVars } from "../view";
import { useRoomCtx } from "./context";

export function AuctionTable() {
  const { s, mySeat, myTeams, act, toast, bid } = useRoomCtx();
  const lobby = s.phase === "lobby";

  const tap = (id: (typeof TEAMS)[number]["id"]) => {
    const owner = s.owners[id];
    if (!mySeat) return toast("Join the auction to play");
    if (lobby) {
      if (owner === mySeat) void act({ type: "release", teamId: id });
      else if (owner) toast(`${seatName(s, owner)} runs ${id}`);
      else if (myTeams.length >= s.cap) toast(`You already run ${s.cap} team${s.cap > 1 ? "s" : ""}, the limit`);
      else void act({ type: "claim", teamId: id });
      return;
    }
    if (owner !== mySeat) return toast(owner ? `That's ${seatName(s, owner)}'s paddle` : `${id} is run by AI`);
    bid(id);
  };

  return (
    <section className="block" aria-label="Auction table">
      <div className="sec-h">
        <h3>The auction table</h3>
        <span className="hint">
          {lobby
            ? mySeat ? "Tap a free paddle to claim it, tap yours again to give it back." : "Players claim teams here before the auction starts."
            : mySeat ? "Tap one of your paddles to bid as that team." : "Unclaimed teams are bid for by AI."}
        </span>
      </div>
      <div className="paddles">
        {TEAMS.map((t) => {
          const st = s.teams[t.id];
          const owner = s.owners[t.id];
          const leading = !lobby && s.lead?.teamId === t.id;
          const skipped = s.phase === "live" && s.skipped.includes(t.id);
          const out = skipped || (s.phase === "live" && !leading && !!s.lot && s.nextAmount !== null &&
            teamBlock(st, s.lot, s.nextAmount) !== null);
          const usable = !!mySeat && (lobby ? !owner || owner === mySeat : owner === mySeat);
          const cls = ["seat",
            leading && "lead", leading && "bump",
            mySeat && owner === mySeat && "mine",
            lobby && mySeat && !owner && myTeams.length < s.cap && "claimable",
            out && "out"].filter(Boolean).join(" ");
          return (
            // Re-keying the leader on every bid replays the paddle-raise animation.
            <div key={leading ? `${t.id}-${s.bidSeq}` : t.id} className={cls}
              style={{ ...teamVars(t.id), "--oc": owner ? seatColor(owner) : lobby ? "var(--gold)" : "var(--line)" } as React.CSSProperties}>
              <button className="paddle" disabled={!usable} onClick={() => tap(t.id)}
                aria-label={lobby ? (owner === mySeat ? `Give back ${t.city}` : `Claim ${t.city}`) : `Bid as ${t.city}`}>
                <Crest id={t.id} className="ph" /><span className="ps" />
              </button>
              <div className="sname">{t.city}</div>
              <div className="spurse">{lobby ? "" : skipped ? "Skipped" : fmt(st.purse)}</div>
              <span className="otag">{owner ? ownerLabel(s, owner) : lobby ? "Free" : "AI"}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
