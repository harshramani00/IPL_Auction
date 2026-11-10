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

## Hosting

The game is one Node process: it keeps live connections to every player,
runs the clock, and keeps rooms in memory. So host it somewhere that runs a
long-lived server, run **a single instance**, and expect rooms to be lost on
restart (restart between games, not during one). Serverless platforms such as
Vercel or Netlify won't work.

### On a spare machine with Tailscale (the plan for this project)

**1. Install and build** (Node 20 or later):

```bash
git clone https://github.com/harshramani00/IPL_Auction.git
cd IPL_Auction
npm ci
npm run build
```

**2. Set a fixed cookie secret,** so players stay signed in across restarts:

```bash
echo "COOKIE_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" > .env
```

**3. Keep it running** with pm2. It restarts the game after a crash or a
reboot. `pm2 startup` prints one more command to run.

```bash
npm install -g pm2
pm2 start npm --name auction -- start
pm2 save
pm2 startup
```

The game now listens on port 3001. Turn off sleep on the machine, or the game
goes offline when it sleeps.

**4. Make it reachable.** Pick one:

| Who can play | How | Address |
|---|---|---|
| Anyone with the link | `tailscale funnel --bg 3001` (the first time, Tailscale asks you to enable HTTPS and Funnel in its admin console) | `https://<machine>.<tailnet>.ts.net` |
| Only people on your tailnet | `tailscale serve --bg 3001` | same address, private |
| Anyone, on your own domain | Cloudflare Tunnel (below) | `https://auction.yourdomain.com` |

Funnel only serves its own `*.ts.net` address. Pointing your domain at it
fails, because the HTTPS certificate won't match your domain. For your own
domain, either add a URL redirect at your registrar from
`auction.yourdomain.com` to the `ts.net` link, or move the domain's DNS to
Cloudflare (free) and run a Cloudflare Tunnel on the machine instead of
Funnel:

```bash
cloudflared tunnel login
cloudflared tunnel create auction
cloudflared tunnel route dns auction auction.yourdomain.com
cloudflared tunnel run --url http://localhost:3001 auction
```

To keep the tunnel running too, start it with pm2 as well:
`pm2 start cloudflared --name tunnel -- tunnel run --url http://localhost:3001 auction`.

**5. Update** to the latest version (between games):

```bash
git pull && npm ci && npm run build && pm2 restart auction
```

### Other options

- **Same Wi-Fi, no setup:** run `npm run build && npm start` and share
  `http://<your-computer's-IP>:3001`.
- **One-off from your laptop:** run
  `cloudflared tunnel --url http://localhost:3001` for a temporary public
  `trycloudflare.com` link.
- **Cloud:** on Render, Railway or Fly.io, use build command
  `npm ci && npm run build` and start command `npm start`, set `COOKIE_SECRET`,
  and keep it to one instance. The platform sets `PORT`. Free tiers that sleep
  when idle lose any rooms in progress.

The game shows official IPL and team logos. Keep public links to games with
friends, and don't make money from it.

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
   below ₹2 Cr, +₹20 L below ₹5 Cr, then +₹25 L. A lot gets 45 s for an
   opening bid and each bid resets the clock to 45 s, with "going once" at
   10 s and "going twice" at 5 s. A player running several teams bids as one of
   them at a time; a team can't raise its own top bid, but the player's other
   teams can bid against it. Squads cap at 25 players and 8 overseas,
   retained players included. Any player can pause.
   A team can also **skip** a player, which takes it out of that lot. As
   soon as every team except the top bidder has skipped (or can't afford or
   fit him), the hammer falls: sold to the top bid, or unsold if nobody bid.
   AI teams skip once the price passes their valuation.
3. **Hammer.** At zero the player is SOLD to the top bid, or UNSOLD if there
   was no bid. The next lot opens 3.2 s later.
4. **AI franchises.** Unclaimed teams are run by AI that bids every
   0.7–2.7 s while the price is under its private valuation. Valuations are
   anchored on what each player really went for (varied ±15% each game). Two
   or three AI teams, mostly ones that can afford him, want a player who
   really sold. A player who went unsold for real draws an AI bid near base
   only about 30% of the time. Each AI team keeps ₹30 L back for every squad
   slot it still has to fill. In simulated Quick games 73% of lots sell
   (69% for real), at a median of 1.0× the real price.

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

### The 3D hall and sound

- **The moments of an auction:** `client/src/room/events.ts` works out each
  moment (a new player, a bid, going once or twice, sold, unsold) from
  consecutive snapshots, together with the auctioneer's line. The sounds
  (`useAuctionSounds`) and the 3D hall both react to these, so the voice,
  captions, animation and camera stay in step.
- **What's in the hall** (`client/src/hall/`):
  - React Three Fiber and three.js, in a chunk that only loads in the 3D view.
  - The stage, podium and a big LED screen drawn live from the current lot.
  - The ten team tables with logos, owners and paddles that rise on each bid.
  - A crowd, spotlights and three.js's built-in studio lighting (nothing is
    fetched from a CDN).
- **The director** (`Hall3D.tsx`) chooses the shots:
  - wide for a new player
  - a hard cut to the bidding table on each bid
  - a push-in on the auctioneer, with warmer light, at "going twice"
  - on SOLD, the gavel strikes, then the camera swings to the winning table
    as confetti falls
- **The auctioneer:** "Business_Male_01", a realistic businessman from
  Microsoft's open-source Rocketbox avatars (MIT licence,
  `static/models/rocketbox/`).
  - **Animation:** his arms are posed in code (aimed at targets each frame).
    He gestures while announcing, points at each bidding table, raises the
    gavel and strikes it, with his fingers curled round the gavel.
  - **Your own character:** a `static/models/auctioneer.glb` with Mixamo clips
    (for example an exported MetaHuman) takes over if present. It's
    git-ignored, since most such models can't be redistributed. See
    `static/models/README.md`.
  - **Fallback:** a stand-in mannequin covers the moment while he loads.
- **Rendering:**
  - Image-based lighting from a CC0 studio HDRI (`static/hdri/`, from Poly Haven).
  - Soft shadows, with a sharper key light on the auctioneer.
  - Skin and wool-suit sheen.
  - Post-processing: ambient occlusion (N8AO), bloom, depth of field that
    follows the shot, a vignette and filmic tone mapping.
  - Phones and modest machines get bloom only. To override, set
    `localStorage["ar-quality"]` to `high`, `low` or `off`.
- **3D or Classic:** the header switch flips between the 3D hall and the
  classic layout, and each browser remembers its choice. Browsers without
  WebGL2, with "reduce motion" on, or with little memory start in Classic. If
  WebGL fails, the page falls back to Classic.

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
| client → server | `request` | `{ requestId, type, ... }`, where `type` is `join`, `leave`, `claim {teamId}`, `release {teamId}`, `settings {settings}`, `start`, `bid {teamId, amount}`, `skip {teamId}`, `pause` (toggles), or `reset` |
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
python3 scripts/build_game_data.py       # shared/data/{lots,teams,stats,credits,market}.json
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
  `base` (lakhs), `tier` (`A`/`B`) and `photo` (a path or `null`). The AI
  reads each lot's real price from `market.json`. For a lot that isn't listed
  there, it falls back to the spec's tier formula (tier A base × 3–9, tier B
  base × 0.9–4). `market.json` is server-only (`@auction/shared/server-data`).
  Never import it in the client, or every real price ends up in the browser. Lots for a different auction season come from
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
