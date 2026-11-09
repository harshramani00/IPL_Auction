import type { User } from "@auction/shared";
import { gameData } from "@auction/shared/data";
import { useState } from "react";
import { createRoom, roomExists } from "../api";
import { Link, navigate } from "../router";

interface Props {
  user: User | null;
  onName: (name: string) => Promise<User>;
}

export function Landing({ user, onName }: Props) {
  const [name, setName] = useState(user?.name ?? "");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ensureName = async () => {
    if (user && name.trim() === user.name) return;
    await onName(name);
  };

  const run = (fn: () => Promise<void>) => async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const create = run(async () => {
    await ensureName();
    navigate(`/r/${await createRoom()}`);
  });

  const join = run(async () => {
    const id = code.trim().toUpperCase();
    if (!(await roomExists(id))) throw new Error(`No room with code ${id}`);
    if (name.trim()) await ensureName();
    navigate(`/r/${id}`);
  });

  return (
    <div className="wrap landing">
      <header className="bar">
        <div className="brand">
          <span className="mark has-img"><img src="/logos/IPL.svg" alt="IPL" /></span>
          <div>
            <h1>Auction Room</h1>
            <div className="sub">IPL 2026 auction · <b>{gameData.lots.length} players</b> · up to 10 bidders</div>
          </div>
        </div>
      </header>

      <section className="stage landing-card">
        <div className="set-banner"><span>Run your own IPL auction</span><span>Live · multiplayer</span></div>
        <div className="landing-body">
          <p>
            Grab a franchise, bring your friends, and bid for the real December 2025 auction pool
            against each other and AI-run teams. The hammer falls on its own.
          </p>
          <form className="landing-form" onSubmit={create}>
            <label className="con-lbl" htmlFor="nm">Your name</label>
            <input id="nm" value={name} maxLength={24} placeholder="e.g. Harsh" onChange={(e) => setName(e.target.value)} />
            <button className="gold-btn" disabled={busy || !name.trim()}>Create a room</button>
          </form>
          <form className="landing-form" onSubmit={join}>
            <label className="con-lbl" htmlFor="code">Have a room code?</label>
            <input id="code" value={code} maxLength={12} placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase())} />
            <button className="ghost" disabled={busy || code.trim().length < 4}>Join or watch</button>
          </form>
          {error && <div className="notice">{error}</div>}
        </div>
      </section>
      <p className="hint footer-links"><Link to="/credits">Photo &amp; data credits</Link></p>
    </div>
  );
}
