#!/usr/bin/env python3
"""Add a playing role to every retained player.

The auction list gives each auction player a role through their set, but the
retained lists have none. This reads the role from each retained player's
Wikipedia infobox ("role" and "bowling" fields), then from the previous
auction's sold lists, then guesses from T20 stats. Run after fetch_player_images.py (article links)
and fetch_player_stats.py (fallback stats).

Writes a `role` column into retained_players.csv using the auction list's
vocabulary: Batter, Wicket-keeper, All-rounder, Fast bowler, Spin bowler
(or Bowler when the type is unknown). `role_source` says where it came from.

    python3 scripts/fetch_player_roles.py
"""

import argparse
import csv
import json
import re
import time
import urllib.parse
from collections import Counter
from pathlib import Path

from fetch_auction_data import fetch_tables, parse_sold
from fetch_player_images import api, read_csv

# Matched with spaces and hyphens removed ("leg-break", "legbreak", "leg break").
SPIN_WORDS = ("spin", "offbreak", "legbreak", "orthodox", "googly", "chinaman", "wrist", "slow")
PACE_WORDS = ("fast", "medium", "pace", "seam")


def plain(wikitext):
    """'[[Batsman]], [[Wicket Keeper|Occasionally Wicket Keeper]]' -> 'Batsman, Occasionally Wicket Keeper'."""
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", wikitext)
    text = re.sub(r"\{\{[^}]*\}\}|<[^>]+>", "", text)
    return text.strip()


def infobox_fields(title):
    data = api(titles=title, redirects=1, prop="revisions", rvprop="content",
               rvslots="main", rvsection=0)
    page = data["query"]["pages"][0]
    if "revisions" not in page:
        return {}
    wikitext = page["revisions"][0]["slots"]["main"]["content"]
    return {k.lower(): plain(v) for k, v in
            re.findall(r"^\s*\|\s*(role|bowling)\s*=\s*(.*)$", wikitext, re.M | re.I)}


def role_from_infobox(fields):
    # Ignore secondary skills: "Batsman, Occasionally Wicket Keeper" is a batter.
    parts = [p for p in re.split(r"[,/;]| and ", fields.get("role", "").lower())
             if p.strip() and "occasional" not in p and "part-time" not in p]
    role = " ".join(parts)
    bowling = re.sub(r"[\s-]", "", fields.get("bowling", "").lower())
    if not role:
        return ""
    if "keep" in role or "wicket" in role:
        return "Wicket-keeper"
    if "all" in role and "round" in role:
        return "All-rounder"
    if "bowl" in role:
        if any(w in bowling for w in SPIN_WORDS):
            return "Spin bowler"
        if any(w in bowling for w in PACE_WORDS):
            return "Fast bowler"
        return "Bowler"
    if "bat" in role:
        return "Batter"
    return ""


def role_from_stats(s):
    """Rough role from T20 career numbers, for players with no article."""
    num = lambda k: float(s.get(k) or 0)
    matches = num("t20_matches")
    if not matches:
        return ""
    if num("t20_stumpings") >= 2:
        return "Wicket-keeper"
    wkts_per_match = num("t20_wickets") / matches
    runs_per_inn = num("t20_runs") / max(num("t20_bat_innings"), 1)
    if wkts_per_match >= 0.6 and runs_per_inn >= 15:
        return "All-rounder"
    if wkts_per_match >= 0.4:
        return "Bowler"
    return "Batter"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()
    data_dir = Path(f"data/auction_{args.season}")

    wiki = {r["name"]: urllib.parse.unquote(r["wikipedia"].rsplit("/wiki/", 1)[1])
            for r in read_csv(data_dir / "player_images.csv") if r["wikipedia"]}
    stats = {r["name"]: r for r in read_csv(data_dir / "player_stats.csv")}

    # Most retained players were bought at the previous auction, whose sold
    # lists give a role through the set ("capped fast bowlers") or a column.
    previous_auction = {s["name"]: s["role"] for s in parse_sold(fetch_tables(args.season - 1)[0],
                                                                  args.season - 1)}

    cache_path = data_dir / ".wikipedia_role_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    path = data_dir / "retained_players.csv"
    rows = read_csv(path)
    for r in rows:
        title = wiki.get(r["name"])
        role, source = "", ""
        if title:
            if title not in cache:
                cache[title] = infobox_fields(title)
                cache_path.write_text(json.dumps(cache, indent=1))
                time.sleep(1)  # be gentle with Wikipedia
            role, source = role_from_infobox(cache[title]), "wikipedia"
        earlier = previous_auction.get(r["name"], "")
        # The auction list can also say whether a "Bowler" is pace or spin.
        if earlier and (not role or (role == "Bowler" and earlier.endswith("bowler"))):
            role, source = earlier, f"{args.season - 1} auction"
        if not role:
            role, source = role_from_stats(stats.get(r["name"], {})), "stats"
        r["role"], r["role_source"] = role, source if role else ""

    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    sources = Counter(r["role_source"] or "unknown" for r in rows)
    print(f"Roles for {len(rows)} retained players ({dict(sources)}) -> {path}")


if __name__ == "__main__":
    main()
