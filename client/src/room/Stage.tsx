// The stage: set banner, player on the block, live bid with the stump clock,
// the lobby checklist, the SOLD banner and the player's stats (on the hall's screen in 3D).
import { callFor, startProblems, type Lot } from "@auction/shared";
import { gameData, stats, statsByName } from "@auction/shared/data";
import { Component, Suspense, lazy, useEffect, useRef, type ReactNode } from "react";
import { useTicker } from "../useRoom";
import {
  Crest, Img, fmt, initials, lotsById, ownerLabel, seatName, statRows, statValue, team, teamVars, type StatRow,
} from "../view";
import { prefersReducedMotion, setViewMode, useViewMode } from "../viewMode";
import { useRoomCtx } from "./context";

// three.js only loads for people who see the 3D hall.
const Hall3D = lazy(() => import("../hall/Hall3D"));

export function Stage() {
  const { s, mySeat, serverNow } = useRoomCtx();
  const view = useViewMode();
  const lobby = s.phase === "lobby";
  const done = s.phase === "done";
  // In the lobby, preview the first lot of the chosen preset.
  const lot = s.lot ?? lotsById.get(gameData.presets[s.settings.preset].lots[0]!)!;
  const lastLot = s.results.length ? lotsById.get(s.results[s.results.length - 1]!.lotId) : null;
  const shown = done && lastLot ? lastLot : lot;
  const sold = s.results.filter((r) => r.status === "sold").length;
  const threeD = view === "3d";

  return (
    <section className="stage" aria-label="Player on the block">
      <div className="set-banner">
        <span>{lobby ? `Lobby · ${lot.set}` : done ? "Auction complete" : lot.set}</span>
        <span>{lobby ? "Up first" : done ? `${sold} sold` : "On the block"}</span>
      </div>
      {threeD && (
        <HallBoundary>
          <Suspense fallback={<div className="hall hall-loading">Setting up the auction hall…</div>}>
            <Hall3D s={s} mySeat={mySeat} serverNow={serverNow} reducedMotion={prefersReducedMotion()} />
          </Suspense>
        </HallBoundary>
      )}
      {/* In 3D the hall's big screen shows the player, so the card steps aside. */}
      <div className={`stage-grid${threeD ? " is-3d" : ""}`}>
        {!threeD && <PlayerCard lot={shown} />}
        <div className="bidpanel">{lobby ? <LobbyBox /> : <LiveBox lot={lot} />}</div>
      </div>
      <SoldBanner confetti={!threeD} />
      {/* In 3D the stats are on the hall's screen. */}
      {!threeD && <StatsTable lot={shown} />}
    </section>
  );
}

/** If WebGL fails (old GPU, lost context), drop back to the classic view for this visit. */
class HallBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    setViewMode("classic", false);
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function PlayerCard({ lot }: { lot: Lot }) {
  const { s } = useRoomCtx();
  const lead = s.phase !== "lobby" ? s.lead : null;
  const leadTeam = lead ? team(lead.teamId) : null;
  const border = leadTeam ? (leadTeam.ring === "#111111" ? leadTeam.color : leadTeam.ring) : "var(--line)";
  return (
    <div className="pcard" style={{ "--lead": border } as React.CSSProperties}>
      <div className="pc-top">
        <span className="cc">{lot.cc}</span>
        {lot.overseas && <span className="os">✈ Overseas</span>}
      </div>
      <div className={`avatar${lot.photo ? " has-img" : ""}`} key={lot.id}>
        <Img src={lot.photo} alt={lot.name} fallback={<span className="initials">{initials(lot.name)}</span>} />
      </div>
      <h2>{lot.name}</h2>
      <div className="prole">{lot.role}{lot.capped ? "" : " · Uncapped"}</div>
      <div className="base"><span>Base price</span><b>{fmt(lot.base)}</b></div>
    </div>
  );
}

function LobbyBox() {
  const { s, mySeat, myTeams, act, pending } = useRoomCtx();
  const isLead = mySeat !== null && mySeat === s.leadSeat;
  const problems = startProblems({ seats: s.seats, owners: s.owners } as Parameters<typeof startProblems>[0]);
  const seated = s.seats.filter(Boolean).length;
  const ai = Object.values(s.owners).filter((o) => o === null).length;
  const checks = [
    { ok: seated > 0, txt: seated ? `${seated} player${seated > 1 ? "s" : ""} in the room` : "At least one player has to join" },
    ...(mySeat && !myTeams.length ? [{ ok: false, txt: "Claim your teams: tap free paddles below" }] : []),
    { ok: seated > 0 && problems.length === 0, txt: problems.find((p) => p.includes("claimed")) ?? "Every player has a team" },
    { ok: true, txt: ai ? `${ai} unclaimed team${ai > 1 ? "s" : ""} will be run by AI` : "All 10 teams have a player" },
  ];
  const ready = problems.length === 0;
  const presets = Object.entries(gameData.presets) as [keyof typeof gameData.presets, { label: string }][];
  const leadName = seatName(s, s.leadSeat);

  return (
    <div className="lobby">
      <div className="bp-label">Before the hammer</div>
      <h4>{ready ? "Ready when you are" : "Getting the room ready"}</h4>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.txt} className={`check${c.ok ? " ok" : ""}`}><i>{c.ok ? "✓" : ""}</i>{c.txt}</li>
        ))}
      </ul>
      <div className="settings">
        <div className="seg" role="group" aria-label="Lots">
          {presets.map(([id, p]) => (
            <button key={id} aria-pressed={s.settings.preset === id} disabled={!isLead || !!pending}
              onClick={() => act({ type: "settings", settings: { preset: id } })}>{p.label}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Squads">
          <button aria-pressed={s.settings.start === "retained"} disabled={!isLead || !!pending}
            onClick={() => act({ type: "settings", settings: { start: "retained" } })}>Real squads &amp; purses</button>
          <button aria-pressed={s.settings.start === "fresh"} disabled={!isLead || !!pending}
            onClick={() => act({ type: "settings", settings: { start: "fresh" } })}>Fresh · {fmt(gameData.freshPurse)} each</button>
        </div>
      </div>
      {isLead && (
        <button className="gold-btn start-btn" disabled={!ready || !!pending} onClick={() => act({ type: "start" })}>
          Start the auction
        </button>
      )}
      <div className="hint">
        {isLead
          ? ready ? "Everyone's in. Bring up the first player." : "Start unlocks once the checks are green."
          : mySeat ? `Waiting for ${leadName} to start the auction.` : "Join the auction above to play, or stay and watch."}
      </div>
    </div>
  );
}

function LiveBox({ lot }: { lot: Lot }) {
  const { s, mySeat, act } = useRoomCtx();
  const lead = s.lead;
  const done = s.phase === "done";
  return (
    <div className="live-box">
      <div className="bp-label">{lead ? (s.phase === "sold" || done ? "Final bid" : "Current bid") : "Opening bid"}</div>
      <div className={`bp-amt${lead ? " pulse" : ""}`} key={s.bidSeq}>{fmt(lead ? lead.amount : lot.base)}</div>
      {lead ? (
        <div className="bp-team">
          <Crest id={lead.teamId} />{team(lead.teamId).name}
          <span className="dim">· {ownerLabel(s, s.owners[lead.teamId])}</span>
        </div>
      ) : <div className="bp-team none">{done ? "" : "No bids yet"}</div>}
      <Clock />
      <div className="hist-h">Bids on this player</div>
      <ol className="hist">
        {s.bids.length ? s.bids.map((b) => (
          <li key={`${b.at}-${b.amount}`} style={teamVars(b.teamId)}>
            <span className="sw" />{b.teamId} <span className="dim">{ownerLabel(s, b.bySeat)}</span>
            <span className="amt">{fmt(b.amount)}</span>
          </li>
        )) : <li className="empty">Waiting for a paddle to go up</li>}
      </ol>
      {done && mySeat !== null && mySeat === s.leadSeat && (
        <button className="gold-btn" style={{ alignSelf: "flex-start" }} onClick={() => act({ type: "reset" })}>
          Run it again
        </button>
      )}
    </div>
  );
}

/** Countdown, auctioneer's call and stumps; re-rendered at 10 Hz from the server clock. */
function Clock() {
  const { s, serverNow } = useRoomCtx();
  const ph = s.phase;
  const timed = ph === "live" || ph === "paused";
  useTicker(10, ph === "live");
  const left = ph === "live" ? Math.max(0, (s.deadline ?? 0) - serverNow()) : ph === "paused" ? s.pausedLeft ?? 0 : 0;
  const call = timed ? callFor(left) : "open";
  const warn = timed && call !== "open";
  const hot = timed && call === "twice";
  const soldNow = ph === "sold" && s.outcome?.status === "sold";

  let text: string;
  let cls = "call";
  if (ph === "live") {
    if (hot) { text = "Going twice…"; cls += " hot"; }
    else if (warn) { text = "Going once…"; cls += " warn"; }
    else text = s.lead ? `${s.lead.teamId} holds the bid` : "Opening at base price";
  } else if (ph === "paused") text = "Auction paused";
  else if (ph === "sold") {
    text = soldNow ? `Sold to ${team(s.outcome!.teamId!).name}!` : "Unsold";
    if (soldNow) cls += " sold";
  } else text = "Auction complete";

  return (
    <div className="clock">
      {/* Keyed by lot so the stumps reset instantly for each new player instead of the bails floating back. */}
      <div key={s.lot?.id} className={`stumps${soldNow ? " down" : hot ? " hot" : warn ? " warn" : ""}`} aria-hidden="true">
        <span className="stump" /><span className="stump" /><span className="stump" />
        <span className="bail b1" /><span className="bail b2" /><span className="ground" />
      </div>
      <div className="clock-r">
        <div className={cls} aria-live="polite">{text}</div>
        <div className={`tbar${hot ? " hot" : warn ? " warn" : ""}`}>
          <i style={{ width: `${(Math.min(1, timed ? left / s.windowMs : 0) * 100).toFixed(1)}%` }} />
        </div>
        <div className="secs">
          {timed ? `${(left / 1000).toFixed(1)}s on the clock${ph === "paused" ? " · paused" : ""}`
            : ph === "sold" ? "Next player coming up" : ""}
        </div>
      </div>
    </div>
  );
}

/** `confetti`: the classic view's 2D burst (the 3D hall has its own). */
function SoldBanner({ confetti: withConfetti }: { confetti: boolean }) {
  const { s } = useRoomCtx();
  const canvas = useRef<HTMLCanvasElement>(null);
  const o = s.phase === "sold" ? s.outcome : null;
  const key = o ? `${o.lotId}-${o.status}` : "";

  useEffect(() => {
    if (!withConfetti || !o || o.status !== "sold" || !canvas.current) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = team(o.teamId!);
    return confetti(canvas.current, [t.color, t.ring, "#f3c34f", "#ffffff"]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <>
      {o && (
        <div className={`sold-banner${o.status === "unsold" ? " unsold" : ""}`} key={key}
          style={o.teamId ? teamVars(o.teamId) : undefined}>
          <div className="sb-inner">
            <svg className="sb-gavel" viewBox="0 0 64 64" aria-hidden="true">
              <rect x="10" y="10" width="30" height="16" rx="4" transform="rotate(-35 25 18)" fill="currentColor" />
              <rect x="30" y="22" width="7" height="34" rx="3" transform="rotate(-35 33 39)" fill="currentColor" opacity=".85" />
              <rect x="6" y="54" width="34" height="6" rx="3" fill="currentColor" opacity=".6" />
            </svg>
            <div className="sb-txt">
              <div className="sb-big">{o.status === "sold" ? "Sold" : "Unsold"}</div>
              <div className="sb-sub">
                {o.status === "sold"
                  ? `${o.name} to ${team(o.teamId!).name}${o.bySeat ? ` · ${seatName(s, o.bySeat)}` : ""}`
                  : `${o.name} · no bid at base`}
              </div>
            </div>
            <div className="sb-price">{fmt(o.status === "sold" ? o.amount! : lotsById.get(o.lotId)?.base ?? 0)}</div>
            {o.teamId && <span className="sb-crest"><Crest id={o.teamId} /></span>}
          </div>
        </div>
      )}
      <canvas className="confetti" ref={canvas} aria-hidden="true" />
    </>
  );
}

/** Burst of confetti in the given colours; returns a cancel function. */
function confetti(cv: HTMLCanvasElement, colors: string[]): () => void {
  const box = cv.parentElement!.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = box.width * dpr;
  cv.height = box.height * dpr;
  const ctx = cv.getContext("2d")!;
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 140 }, () => ({
    x: box.width * (0.2 + Math.random() * 0.6), y: box.height * 0.42,
    vx: (Math.random() - 0.5) * 9, vy: -4 - Math.random() * 8,
    r: 4 + Math.random() * 5, a: Math.random() * 6.28, va: (Math.random() - 0.5) * 0.4,
    c: colors[Math.floor(Math.random() * colors.length)]!,
  }));
  const t0 = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    const el = now - t0;
    ctx.clearRect(0, 0, box.width, box.height);
    for (const p of parts) {
      p.vy += 0.22; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.globalAlpha = Math.max(0, 1 - el / 2200);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (el < 2200) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, box.width, box.height);
  };
  raf = requestAnimationFrame(frame);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, box.width, box.height); };
}

function StatsTable({ lot }: { lot: Lot }) {
  const st = statsByName.get(lot.name);
  const rows = statRows(lot.cat);
  const cell = (blk: object | null | undefined, r: StatRow, cls: string) => {
    const shown = statValue(blk, r);
    return <td className={`${cls}${shown === null ? " na" : ""}`}>{shown ?? "—"}</td>;
  };

  const foot: string[] = [];
  if (st && !st.last) foot.push(`Didn't play ${stats.season}`);
  if (st?.ipl?.hs && lot.cat !== "BOWL") foot.push(`IPL highest score ${st.ipl.hs}`);
  if (st?.ipl?.bb && (lot.cat === "BOWL" || lot.cat === "AR")) foot.push(`IPL best bowling ${st.ipl.bb}`);
  if (st && !st.ipl) foot.push("No IPL matches yet");
  const asOf = stats.statsAsOf
    // A calendar date: format in UTC so no time zone shifts it a day.
    ? new Date(stats.statsAsOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : null;

  return (
    <div className="stats">
      <div className="stats-h">
        <span>Player stats</span>
        <span>{asOf ? `To ${asOf} · ${stats.source.split(" ")[0]}` : ""}</span>
      </div>
      <div className="stats-wrap">
        <table className="stbl">
          <thead>
            <tr>
              <th />
              <th className="last">{stats.season}{st?.last?.team ? ` · ${st.last.team}` : ""}</th>
              <th>IPL career</th>
              <th>T20 career</th>
            </tr>
          </thead>
          <tbody>
            {st ? rows.map((r) => (
              <tr key={r[0]}>
                <td className="k">{r[0]}</td>
                {cell(st.last, r, "last")}
                {cell(st.ipl, r, "")}
                {cell(st.t20, r, "")}
              </tr>
            )) : (
              <tr><td className="k" colSpan={4}>No T20 record on file for this player</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="stats-foot">{foot.join(" · ")}</div>
    </div>
  );
}
