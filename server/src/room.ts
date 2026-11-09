// One auction room: the authoritative state plus the timers that drive it
// (the hammer clock and the AI franchises). Every change ends in a broadcast.
import {
  advance, aiDelay, aiTurn, bid, claim, createRoom, join, leave, nextWake, pause, release,
  reset, setConnected, snapshot, start, updateSettings,
  type Check, type GameData, type Request, type RoomState, type Rng, type Snapshot, type User,
} from "@auction/shared";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface RoomOptions {
  data: GameData;
  aiEnabled: boolean;
  onChange: (snap: Snapshot) => void;
  clock?: Clock;
  rng?: Rng;
}

export class Room {
  readonly state: RoomState;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private wakeTimer: unknown = null;
  private aiTimer: unknown = null;
  /** Open sockets per user, so a second tab closing doesn't mark them away. */
  private sockets = new Map<string, number>();
  lastActive: number;

  constructor(readonly id: string, private readonly opts: RoomOptions) {
    this.state = createRoom(id);
    this.clock = opts.clock ?? realClock;
    this.rng = opts.rng ?? Math.random;
    this.lastActive = this.clock.now();
  }

  snapshot(): Snapshot {
    return snapshot(this.state, this.clock.now());
  }

  /** Apply one client request on behalf of `user` (null = anonymous spectator). */
  handle(user: User | null, req: Request): Check {
    if (!user) return { ok: false, reason: "Pick a display name to take part" };
    const now = this.settle();
    const s = this.state;
    let result: Check;
    switch (req.type) {
      case "join": result = join(s, user); break;
      case "leave": result = leave(s, user.id); break;
      case "claim": result = claim(s, user.id, req.teamId); break;
      case "release": result = release(s, user.id, req.teamId); break;
      case "settings": result = updateSettings(s, user.id, req.settings); break;
      case "start": result = start(s, user.id, this.opts.data, now, this.rng); break;
      case "bid": result = bid(s, user.id, req.teamId, req.amount, now); break;
      case "pause": result = pause(s, user.id, now); break;
      case "reset": result = reset(s, user.id); break;
    }
    if (result.ok) this.changed();
    return result;
  }

  connect(user: User | null): void {
    this.lastActive = this.clock.now();
    if (!user) return;
    this.sockets.set(user.id, (this.sockets.get(user.id) ?? 0) + 1);
    setConnected(this.state, user.id, true);
    this.changed();
  }

  disconnect(user: User | null): void {
    this.lastActive = this.clock.now();
    if (!user) return;
    const left = (this.sockets.get(user.id) ?? 1) - 1;
    if (left > 0) {
      this.sockets.set(user.id, left);
      return;
    }
    this.sockets.delete(user.id);
    // Players keep their seat while away; they pick up where they left off on reconnect.
    setConnected(this.state, user.id, false);
    this.changed();
  }

  get connectedUsers(): number {
    return this.sockets.size;
  }

  dispose(): void {
    this.clock.clearTimeout(this.wakeTimer);
    this.clock.clearTimeout(this.aiTimer);
    this.wakeTimer = this.aiTimer = null;
  }

  /** Apply clock transitions that are due (a timer may not have fired yet). */
  private settle(): number {
    const now = this.clock.now();
    if (advance(this.state, now, this.rng)) this.changed();
    return now;
  }

  private changed(): void {
    this.lastActive = this.clock.now();
    this.schedule();
    this.opts.onChange(this.snapshot());
  }

  private schedule(): void {
    this.clock.clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    const wake = nextWake(this.state);
    if (wake !== null) {
      this.wakeTimer = this.clock.setTimeout(() => {
        this.wakeTimer = null;
        this.settle();
      }, Math.max(0, wake - this.clock.now()));
    }

    const aiActive = this.opts.aiEnabled && this.state.phase === "live" && this.state.aiTeams.length > 0;
    if (!aiActive) {
      this.clock.clearTimeout(this.aiTimer);
      this.aiTimer = null;
    } else if (this.aiTimer === null) {
      this.aiTimer = this.clock.setTimeout(() => {
        this.aiTimer = null;
        const now = this.settle();
        if (aiTurn(this.state, now, this.rng)) this.changed();
        else this.schedule();
      }, aiDelay(this.rng));
    }
  }
}
