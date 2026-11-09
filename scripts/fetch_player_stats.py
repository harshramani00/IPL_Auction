#!/usr/bin/env python3
"""Build last-IPL-season, IPL career and T20 career stats for every player.

Run after fetch_player_images.py (it reuses the Wikipedia links found there).

Stats are computed from Cricsheet's ball-by-ball data (https://cricsheet.org,
Open Data Commons Attribution licence: credit Cricsheet if you publish them).
They stop at the auction date, so they show what teams knew when bidding:

  ipl<season>_*  the last IPL season before the auction (2025 by default)
  ipl_*          IPL career
  t20_*          all T20 cricket: internationals, franchise leagues and
                 domestic T20 (Syed Mushtaq Ali etc.). The Hundred is excluded.

Each player is linked to Cricsheet's player register by their ESPNcricinfo ID
(Wikipedia article -> Wikidata -> ESPNcricinfo ID -> Cricsheet), falling back to
careful name matching for players with no article. `match_method` says which.

Writes data/auction_<season>/player_stats.csv, one row per player. Players with
no T20 data in Cricsheet have blank stats.

    python3 scripts/fetch_player_stats.py
    python3 scripts/fetch_player_stats.py --refresh    # re-download Cricsheet data
"""

import argparse
import csv
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from fetch_auction_data import CODE_BY_NAME, USER_AGENT

WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
CRICINFO_ID = "P2697"  # Wikidata property: ESPNcricinfo player ID

CRICSHEET = {
    "all_male_json.zip": "https://cricsheet.org/downloads/all_male_json.zip",
    "people.csv": "https://cricsheet.org/register/people.csv",
    "names.csv": "https://cricsheet.org/register/names.csv",
}
CACHE_DIR = Path(".cache/cricsheet")

AUCTION_DATES = {2026: "2025-12-16"}

# Dismissals that aren't the bowler's wicket / aren't an "out" for the batter.
NOT_BOWLER_WICKETS = {"run out", "retired hurt", "retired out", "retired not out",
                      "obstructing the field"}
NOT_OUT_KINDS = {"retired hurt", "retired not out"}


def http_get(url, retries=5):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return resp.read()
        except Exception as exc:
            if attempt == retries - 1:
                raise
            wait = 5 * 2 ** attempt
            print(f"    {exc}; waiting {wait}s", file=sys.stderr)
            time.sleep(wait)


def api(base, **params):
    params = {"format": "json", **params}
    return json.loads(http_get(f"{base}?{urllib.parse.urlencode(params)}"))


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def norm(text):
    return re.sub(r"[^a-z ]", "", text.lower().replace("-", " ").replace(".", " ")).split()


# ---------------------------------------------------------------- player IDs

def cricinfo_ids(wiki_titles):
    """Wikipedia title -> ESPNcricinfo ID, via each article's Wikidata item."""
    items = {}
    titles = sorted(set(wiki_titles))
    for i in range(0, len(titles), 50):
        data = api(WIKIPEDIA_API, action="query", formatversion=2, redirects=1,
                   prop="pageprops", ppprop="wikibase_item", titles="|".join(titles[i:i + 50]))
        q = data["query"]
        final = {t: t for t in titles[i:i + 50]}
        for step in q.get("normalized", []) + q.get("redirects", []):
            for orig, cur in final.items():
                if cur == step["from"]:
                    final[orig] = step["to"]
        qid = {p["title"]: p.get("pageprops", {}).get("wikibase_item") for p in q["pages"]}
        for orig, cur in final.items():
            if qid.get(cur):
                items[orig] = qid[cur]

    ids = {}
    qids = sorted(set(items.values()))
    for i in range(0, len(qids), 50):
        data = api(WIKIDATA_API, action="wbgetentities", props="claims",
                   ids="|".join(qids[i:i + 50]))
        for qid, entity in data.get("entities", {}).items():
            claims = entity.get("claims", {}).get(CRICINFO_ID, [])
            if claims:
                ids[qid] = claims[0]["mainsnak"]["datavalue"]["value"]
    return {title: ids[q] for title, q in items.items() if q in ids}


def name_fits(ours, theirs_raw):
    """Does a Cricsheet name ("RD Gaikwad", "Arshad Khan") fit our full name?

    Same surname; their first token is either our first name or a block of
    initials ("RD") starting with our first initial; any other full word in
    their name must also be in ours ("V Jatinder Kumar" is not "Vijay Kumar").
    """
    raw = theirs_raw.replace(".", " ").replace("-", " ").split()
    theirs = norm(theirs_raw)
    if len(ours) < 2 or len(theirs) < 2 or theirs[-1] != ours[-1]:
        return False
    lead_is_initials = raw[0].isupper() and len(raw[0]) <= 3
    if not (theirs[0] == ours[0] or (lead_is_initials and theirs[0][0] == ours[0][0])):
        return False
    middle = theirs[1:-1]
    return all(w in ours for w in middle if len(w) > 2)


def name_candidates(name, country, uncapped, people_names, history):
    """Cricsheet IDs that fit our player's name and career (see fits_career)."""
    ours = norm(name)
    hits = []
    for pid, h in history.items():
        if not name_fits(ours, people_names[pid]):
            continue
        # An uncapped player has no international caps; Indians play Indian
        # domestic T20 or the IPL, overseas players don't play Syed Mushtaq Ali.
        if uncapped and h["intl"]:
            continue
        if country == "India" and not (h["smat"] or h["ipl"]):
            continue
        if country != "India" and h["smat"]:
            continue
        hits.append(pid)
    return hits


# --------------------------------------------------------------------- stats

def new_totals():
    return defaultdict(int, best=(0, 0), hs=(0, False), teams=Counter())


def scopes_for(info, last_season):
    if info.get("match_type") not in ("T20", "IT20") or info.get("balls_per_over", 6) != 6:
        return []
    event = info.get("event", {}).get("name", "")
    if "Hundred" in event:
        return []
    scopes = ["t20"]
    if event == "Indian Premier League":
        scopes.append("ipl")
        if str(info.get("season")) == last_season:
            scopes.append("ipl_last")
    return scopes


def add_match(match, scopes, wanted, totals):
    info = match["info"]
    pid_of = info["registry"]["people"]
    bat = defaultdict(lambda: {"runs": 0, "balls": 0, "out": False})
    bowl = defaultdict(lambda: {"balls": 0, "runs": 0, "wkts": 0})
    field = defaultdict(lambda: {"ct": 0, "st": 0})

    for innings in match.get("innings", []):
        if innings.get("super_over"):
            continue
        for over in innings.get("overs", []):
            for d in over["deliveries"]:
                extras = d.get("extras", {})
                runs = d["runs"]
                b = bat[d["batter"]]
                bat[d["non_striker"]]  # batting at the other end counts as an innings
                if "wides" not in extras:
                    b["balls"] += 1
                b["runs"] += runs["batter"]
                if not runs.get("non_boundary"):
                    if runs["batter"] == 4:
                        b["fours"] = b.get("fours", 0) + 1
                    elif runs["batter"] == 6:
                        b["sixes"] = b.get("sixes", 0) + 1

                bw = bowl[d["bowler"]]
                if "wides" not in extras and "noballs" not in extras:
                    bw["balls"] += 1
                bw["runs"] += runs["batter"] + extras.get("wides", 0) + extras.get("noballs", 0)

                for w in d.get("wickets", []):
                    kind = w["kind"]
                    if kind not in NOT_OUT_KINDS:
                        bat[w["player_out"]]["out"] = True
                    if kind not in NOT_BOWLER_WICKETS:
                        bw["wkts"] += 1
                    if kind == "caught and bowled":
                        field[d["bowler"]]["ct"] += 1
                    for f in w.get("fielders", []):
                        if f.get("substitute") or "name" not in f:
                            continue
                        if kind == "caught":
                            field[f["name"]]["ct"] += 1
                        elif kind == "stumped":
                            field[f["name"]]["st"] += 1

    team_of = {pid_of.get(p): team for team, squad in info["players"].items() for p in squad}
    for scope in scopes:
        for pid in team_of.keys() & wanted:
            totals[pid][scope]["matches"] += 1
            totals[pid][scope]["teams"][team_of[pid]] += 1
        for name, b in bat.items():
            pid = pid_of.get(name)
            if pid not in wanted:
                continue
            t = totals[pid][scope]
            t["bat_innings"] += 1
            t["runs"] += b["runs"]
            t["balls_faced"] += b["balls"]
            t["outs"] += b["out"]
            t["fours"] += b.get("fours", 0)
            t["sixes"] += b.get("sixes", 0)
            t["fifties"] += 50 <= b["runs"] < 100
            t["hundreds"] += b["runs"] >= 100
            if (b["runs"], not b["out"]) > t["hs"]:
                t["hs"] = (b["runs"], not b["out"])
        for name, bw in bowl.items():
            pid = pid_of.get(name)
            if pid not in wanted:
                continue
            t = totals[pid][scope]
            t["bowl_innings"] += 1
            t["balls_bowled"] += bw["balls"]
            t["runs_conceded"] += bw["runs"]
            t["wickets"] += bw["wkts"]
            t["four_wkt_hauls"] += bw["wkts"] >= 4
            if (bw["wkts"], -bw["runs"]) > t["best"]:
                t["best"] = (bw["wkts"], -bw["runs"])
        for name, f in field.items():
            pid = pid_of.get(name)
            if pid in wanted:
                totals[pid][scope]["catches"] += f["ct"]
                totals[pid][scope]["stumpings"] += f["st"]


def summarise(t):
    """Raw totals -> display columns."""
    if not t["matches"]:
        return {}
    ratio = lambda a, b, k=1: round(a * k / b, 2) if b else ""
    hs_runs, hs_not_out = t["hs"]
    best_w, best_r = t["best"]
    return {
        "matches": t["matches"],
        "bat_innings": t["bat_innings"],
        "runs": t["runs"],
        "balls_faced": t["balls_faced"],
        "not_outs": t["bat_innings"] - t["outs"],
        "highest_score": f"{hs_runs}{'*' if hs_not_out else ''}" if t["bat_innings"] else "",
        "bat_average": ratio(t["runs"], t["outs"]),
        "strike_rate": ratio(t["runs"], t["balls_faced"], 100),
        "fifties": t["fifties"],
        "hundreds": t["hundreds"],
        "fours": t["fours"],
        "sixes": t["sixes"],
        "bowl_innings": t["bowl_innings"],
        "overs": f"{t['balls_bowled'] // 6}.{t['balls_bowled'] % 6}" if t["balls_bowled"] else "",
        "runs_conceded": t["runs_conceded"] if t["bowl_innings"] else "",
        "wickets": t["wickets"] if t["bowl_innings"] else "",
        "best_bowling": f"{best_w}/{-best_r}" if t["bowl_innings"] else "",
        "bowl_average": ratio(t["runs_conceded"], t["wickets"]),
        "economy": ratio(t["runs_conceded"], t["balls_bowled"], 6),
        "bowl_strike_rate": ratio(t["balls_bowled"], t["wickets"]),
        "four_wkt_hauls": t["four_wkt_hauls"] if t["bowl_innings"] else "",
        "catches": t["catches"],
        "stumpings": t["stumpings"],
    }


STAT_COLUMNS = list(summarise(defaultdict(int, matches=1, best=(0, 0), hs=(0, False))))


# ---------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--season", type=int, default=2026, help="auction season (default: 2026)")
    parser.add_argument("--as-of", help="ignore matches from this date on (default: auction date)")
    parser.add_argument("--refresh", action="store_true", help="re-download Cricsheet data")
    args = parser.parse_args()
    data_dir = Path(f"data/auction_{args.season}")
    cutoff = args.as_of or AUCTION_DATES.get(args.season, f"{args.season}-01-01")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in CRICSHEET.items():
        path = CACHE_DIR / name
        if args.refresh or not path.exists():
            print(f"Downloading {url}")
            path.write_bytes(http_get(url))

    # Our players, with the Wikipedia article fetch_player_images.py found.
    players = {}
    for r in read_csv(data_dir / "auction_pool.csv"):
        players.setdefault(r["name"], {"country": r["country"],
                                       "uncapped": r["category"] == "Uncapped"})
    for r in read_csv(data_dir / "retained_players.csv"):
        players.setdefault(r["name"], {"country": r["nationality"], "uncapped": False})
    wiki = {r["name"]: urllib.parse.unquote(r["wikipedia"].rsplit("/wiki/", 1)[1]).replace("_", " ")
            for r in read_csv(data_dir / "player_images.csv") if r["wikipedia"]}

    people = read_csv(CACHE_DIR / "people.csv")
    people_names = {p["identifier"]: p["name"] for p in people}
    by_cricinfo = {}
    for p in people:
        for key in ("key_cricinfo", "key_cricinfo_2", "key_cricinfo_3"):
            if p[key]:
                by_cricinfo[p[key]] = p["identifier"]
    full_names = defaultdict(set)
    for r in read_csv(CACHE_DIR / "names.csv"):
        full_names[" ".join(norm(r["name"]))].add(r["identifier"])

    # Pass 1 over the archive: each T20 player's career shape (used to vet name
    # matches), who was active in the two years before the cutoff, and the
    # last IPL season.
    archive = zipfile.ZipFile(CACHE_DIR / "all_male_json.zip")
    files = [n for n in archive.namelist() if n.endswith(".json")]
    history = defaultdict(lambda: {"intl": False, "smat": False, "ipl": False})
    active, ipl_seasons, t20_files = set(), set(), []
    recent = f"{int(cutoff[:4]) - 2}{cutoff[4:]}"
    print(f"Scanning {len(files)} matches...")
    for n in files:
        info = json.loads(archive.read(n))["info"]
        if info["dates"][0] >= cutoff or not scopes_for(info, ""):
            continue
        t20_files.append(n)
        event = info.get("event", {}).get("name", "")
        if event == "Indian Premier League":
            ipl_seasons.add(str(info["season"]))
        played = [info["registry"]["people"][p] for team in info["players"].values() for p in team]
        for pid in played:
            h = history[pid]
            h["intl"] |= info.get("team_type") == "international"
            h["smat"] |= event == "Syed Mushtaq Ali Trophy"
            h["ipl"] |= event == "Indian Premier League"
        if info["dates"][0] >= recent:
            active.update(played)
    last_season = max(ipl_seasons, key=lambda s: s[:4])
    print(f"{len(t20_files)} T20 matches before {cutoff}; last IPL season {last_season}")

    print("Looking up ESPNcricinfo IDs via Wikidata...")
    title_ids = cricinfo_ids(wiki.values())
    for name, p in players.items():
        cid = title_ids.get(wiki.get(name, ""))
        p["cricinfo_id"] = cid or ""
        p["cricsheet_id"], p["match_method"] = "", "not found"
        if cid and cid in by_cricinfo:
            p["cricsheet_id"], p["match_method"] = by_cricinfo[cid], "cricinfo id"

    # Name matching for the rest: only recently active players not already
    # claimed by an ID match, so namesakes and stars can't be picked up.
    claimed = {p["cricsheet_id"] for p in players.values() if p["cricsheet_id"]}
    recent_history = {pid: history[pid] for pid in active - claimed if pid in people_names}
    for name, p in players.items():
        if p["cricsheet_id"]:
            continue
        exact = full_names.get(" ".join(norm(name)), set()) & recent_history.keys()
        hits = list(exact) or name_candidates(name, p["country"], p["uncapped"],
                                              people_names, recent_history)
        if len(hits) == 1:
            p["cricsheet_id"] = hits[0]
            p["match_method"] = "full name" if exact else "name + initial"
        elif hits:
            p["match_method"] = f"ambiguous ({len(hits)} candidates)"

    # Two of our players landing on one Cricsheet ID by name: trust neither.
    by_id = defaultdict(list)
    for name, p in players.items():
        if p["match_method"] in ("full name", "name + initial"):
            by_id[p["cricsheet_id"]].append(name)
    for names in by_id.values():
        if len(names) > 1:
            for name in names:
                players[name].update(cricsheet_id="", match_method="ambiguous (shared match)")

    wanted = {p["cricsheet_id"] for p in players.values() if p["cricsheet_id"]}
    print(f"{len(wanted)}/{len(players)} players linked to Cricsheet; computing stats...")
    totals = defaultdict(lambda: defaultdict(new_totals))
    for n in t20_files:
        match = json.loads(archive.read(n))
        add_match(match, scopes_for(match["info"], last_season), wanted, totals)

    prefixes = {"ipl_last": f"ipl{last_season}_", "ipl": "ipl_", "t20": "t20_"}
    rows = []
    for name, p in players.items():
        row = {"name": name, "country": p["country"], "cricsheet_id": p["cricsheet_id"],
               "cricsheet_name": people_names.get(p["cricsheet_id"], ""),
               "cricinfo_id": p["cricinfo_id"], "match_method": p["match_method"]}
        for scope, prefix in prefixes.items():
            stats = summarise(totals[p["cricsheet_id"]][scope]) if p["cricsheet_id"] else {}
            row.update({prefix + c: stats.get(c, "") for c in STAT_COLUMNS})
            if scope == "ipl_last":
                # Team code he played most of the season for (e.g. "KKR").
                teams = totals[p["cricsheet_id"]][scope]["teams"] if p["cricsheet_id"] else None
                team = teams.most_common(1)[0][0] if teams else ""
                row[prefix + "team"] = CODE_BY_NAME.get(team, team)
        rows.append(row)

    out = data_dir / "player_stats.csv"
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    with_t20 = sum(bool(r["t20_matches"]) for r in rows)
    with_ipl = sum(bool(r["ipl_matches"]) for r in rows)
    with_last = sum(bool(r[f"ipl{last_season}_matches"]) for r in rows)
    print(f"Done -> {out}: {with_t20} players with T20 stats, {with_ipl} with IPL, "
          f"{with_last} played IPL {last_season}")


if __name__ == "__main__":
    main()
