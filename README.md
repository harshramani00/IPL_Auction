# Auction Room

A real-time multiplayer IPL player auction. Up to 10 people join one room from
their own devices, each runs one or more of the 10 franchises, and they bid
against each other and AI-run franchises for the real players from the
December 2025 IPL auction. The hammer falls on its own.

- **Real data:** all 369 lots in official set order, each franchise's retained
  squad and pre-auction purse, team logos, player photos, and IPL 2025, IPL
  career and T20 career stats as they stood on auction day.
- **Server-authoritative:** the server owns the state, the clock, the AI and
  every rule. Clients only send requests, and each request is tied to the
  sender's session, so nobody can bid for someone else's team.
- **Spectators welcome:** anyone with the room link can watch live.

## Quick start

Needs Node 20 or later.

```bash
npm install
npm run dev
```

Open http://localhost:5173, enter a name and create a room. To try it alone,
open the room link (`/r/ABC123`) in a second browser profile or a private
window; each has its own session.

To play with friends on other devices on your network, run the production
build, which listens on all interfaces, and share `http://<your-computer's-IP>:3001/r/<code>`:

```bash
npm run build
npm start
```

| Command | What it does |
|---|---|
| `npm run dev` | Game server (port 3001, restarts on change) and Vite client (port 5173, proxies to the server) |
| `npm run build` | Builds the client into `client/dist` |
| `npm start` | Production: the game server also serves `client/dist` on `PORT` |
| `npm test` | Unit tests (shared engine), server tests and Playwright end-to-end tests |
| `npm run typecheck` | TypeScript across all workspaces |

The first time you run the end-to-end tests, install their browser:
`npx playwright install chromium`.

### Configuration

Copy `.env.example` to `.env`. None of it is needed for local play.

| Variable | Default | Purpose |
|---|---|---|
| `SERVER_PORT` | 3001 | Game server port in development |
| `PORT` | 3001 | Port for `npm start` (hosting platforms set it) |
| `COOKIE_SECRET` | random per run | Signs the session cookie; set it in production so sessions survive restarts |
| `AI_ENABLED` | `true` | `false` turns the AI franchises off (the end-to-end tests do) |
| `CLIENT_ORIGIN` | none | Only if the client is served from a different origin |

## How a game works

1. **Lobby.** Players join (seats P1–P10, lowest free seat) and claim
   franchises by tapping paddles. Each player can run up to
   `floor(10 / players)` teams. When someone joins and the cap drops, players
   over it lose their most recently claimed teams. The room lead (lowest seat)
   picks the lot list (Quick 16, Capped 117, or Full 369) and whether teams
   start with their real retained squads and purses or empty squads and
   ₹120 Cr each.
2. **Live.** Lots come up in order at their base price. The next bid must be
   exactly the current bid plus the increment: +₹5 L below ₹1 Cr, +₹10 L
   below ₹2 Cr, +₹20 L below ₹5 Cr, then +₹25 L. A lot gets 10 s for an
   opening bid and each bid resets the clock to 8 s, with "going once" at 5 s
   and "going twice" at 2.5 s. Squads cap at 25 players and 8 overseas,
   retained players included. Any player can pause.
3. **Hammer.** At zero the player is SOLD to the top bid, or UNSOLD if there
   was no bid. The next lot opens 3.2 s later. Unclaimed franchises are run by
   AI that values each lot privately and bids every 0.7–2.7 s while the price
   is under its valuation.

## Architecture

npm workspaces, TypeScript throughout:

```
shared/   types, constants, the pure rules engine, generated game data (shared/data/*.json)
server/   Express + Socket.IO + zod: rooms, timers, AI loop, sessions
client/   React 18 + Vite; styles in client/src/styles.css (from the design mock)
e2e/      Playwright: four browsers and a spectator play one room
scripts/  Python (standard library only) scrapers that build the data
data/     scraped CSVs (auction_2026/)
static/   team logos and player photos, served at /logos and /players
```

- **`shared/src/engine.ts`** holds every rule as plain functions over a
  `RoomState`: join, claim, bid validation, pause, the hammer. It takes the
  time and a random source as arguments and never sets timers itself, so the
  same code is unit-tested with fake time and run live by the server.
  `nextWake(state)` tells the server when to call `advance(state, now)` next.
- **`server/src/room.ts`** wraps one room: it applies requests through the
  engine, keeps the hammer timer and the AI timer, settles overdue transitions
  before every request (a bid arriving just after the deadline is rejected even
  if the timer hasn't fired), and broadcasts a snapshot after every change.
  `snapshot()` never includes the AI valuations.
- **`server/src/app.ts`** has the HTTP routes and the socket protocol.
  `AuthProvider` (a signed-cookie session) and `RoomStore` (in memory) are
  interfaces, so OAuth or a Redis store can be added without touching game
  code. Rooms are lost on a server restart, and idle rooms are removed after
  2 hours.
- **The client** renders whatever the server last sent. It estimates the
  server's clock offset from `serverNow` and draws the countdown at 10 Hz, but
  only the server decides when a lot closes.
- **Extension points:** `RoomState.queue` is the lot queue (an accelerated or
  unsold round can append to it), and all bids go through
  `bid()`/`applyBid()` in the engine (the place to add RTM cards).

## Protocol

HTTP:

| Route | |
|---|---|
| `GET /api/session` | `{ user }` for the session cookie, or `null` |
| `POST /api/session {name}` | Sets or renames the session (signed `ar_session` cookie) |
| `POST /api/rooms` | Creates a room, returns `{ id }` |
| `GET /api/rooms/:id` | `{ id, phase, players }` or 404 |

Socket.IO: connect with `auth: { roomId }`. Your identity comes from the
session cookie; without one you're a spectator.

| Direction | Event | Payload |
|---|---|---|
| client → server | `request` | `{ requestId, type, ... }`, where `type` is `join`, `leave`, `claim {teamId}`, `release {teamId}`, `settings {settings}`, `start`, `bid {teamId, amount}`, `pause` (toggles), or `reset` |
| server → client | `hello` | `{ user }`, once on connect |
| server → client | `state` | the full public `Snapshot` (`shared/src/types.ts`) after every change |
| server → client | `ack` | `{ requestId, ok, reason? }`, exactly one per request |
| server → client | `room-error` | `{ reason }` when the room doesn't exist; then disconnects |

Every payload is validated with zod (`server/src/schemas.ts`), and each socket
is limited to 10 requests per second. Rejections carry a reason meant for the
player, such as "You can only bid for your own teams" or "Someone got in first
at that price. Bid again".

## Data

Everything the game reads is in `shared/data/*.json`, generated from the CSVs in
`data/auction_2026/` by `scripts/build_game_data.py`. To rebuild from scratch,
run these from the repo root, in order:

```bash
python3 scripts/fetch_team_logos.py      # static/logos: team and IPL logos (Wikipedia)
python3 scripts/fetch_auction_data.py    # auction list, retentions, purses, sold results
python3 scripts/fetch_player_images.py   # static/players + image column (Wikimedia, free licences)
python3 scripts/fetch_player_stats.py    # stats from Cricsheet ball-by-ball data (~130 MB, cached in .cache/)
python3 scripts/fetch_player_roles.py    # roles for retained players
python3 scripts/build_game_data.py       # shared/data/{lots,teams,stats,credits}.json
```

`fetch_auction_data.py` rewrites the CSVs, so after it, rerun every later
script to restore the image and role columns.

**Sources:**
- **Auction list:** the BCCI's final list (via InsideSport).
- **Retentions and sold results:** Wikipedia.
- **Stats:** computed from [Cricsheet](https://cricsheet.org) (Open Data Commons Attribution), cut off at the auction date (16 Dec 2025).
- **Photos:** from Wikimedia Commons, with each photographer and licence listed on the in-app `/credits` page.

### Adding lots, presets or stats

- **Presets** are lists of lot ids in `lots.json` under `presets`. Add one in
  `build_game_data.py` (next to `quick`, `capped` and `full`) and add its id to
  `PresetId` in `shared/src/types.ts` and to the zod enum in
  `server/src/schemas.ts`.
- **Lots:** any lot in `lots.json` needs `id`, `name`, `cc`, `country`,
  `overseas`, `cat` (`BAT`/`WK`/`AR`/`BOWL`), `role`, `capped`, `set`, `setCode`,
  `base` (lakhs), `tier` (`A`/`B`, which drives AI valuations) and `photo` (a
  path or `null`). Lots for a different auction season come from
  `fetch_auction_data.py --season`.
- **Stats** are looked up by player name in `stats.json`. A player without
  stats shows a "no T20 record" row.

## Tests

- `shared/test`: the rules engine. Cap and claim trimming, increments, bid
  validation messages, limits including retained players, pause timing,
  SOLD/UNSOLD, AI valuations and privacy, and the generated data.
- `server/test`: a Room with fake timers (including a full 16-lot game against
  the AI), and real sockets (forged bids, malformed payloads, rate limits,
  spectators, cookie tampering).
- `e2e/tests`: the spec's acceptance tests 7–11 with four players and a
  spectator in separate browser contexts.

CI (`.github/workflows/ci.yml`) runs the typecheck and `npm test` on Node 20.

## Credits

Team and IPL logos are trademarks of their owners, shown here for a
non-commercial fan game. Player photos are freely licensed. See `/credits` in
the app for every photo's author and licence.
