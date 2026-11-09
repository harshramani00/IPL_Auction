#!/usr/bin/env python3
"""Turn the scraped auction CSVs into the JSON files the game reads.

Run last, after the scrapers (see README). Reads data/auction_<season>/ and
writes shared/data/:

  lots.json     every auction lot in official order, plus presets
                (quick / capped / full) as lists of lot ids
  teams.json    the 10 franchises: colours, logo, pre-auction purse and the
                retained squad
  stats.json    last IPL season, IPL career and T20 career per player
  credits.json  photo credits and the Cricsheet data notice

Money is in integer lakhs (1 crore = 100 lakhs). Image paths are site paths
served from static/ (e.g. /players/ms-dhoni.jpg, /logos/MI.svg).

    python3 scripts/build_game_data.py
"""

import argparse
import csv
import json
from pathlib import Path

from fetch_team_logos import TEAMS

OUT_DIR = Path("shared/data")
STATIC_DIR = Path("static")

COUNTRY_CODES = {
    "India": "IND", "England": "ENG", "Australia": "AUS", "New Zealand": "NZ",
    "South Africa": "RSA", "Sri Lanka": "SL", "Afghanistan": "AFG", "West Indies": "WI",
    "Bangladesh": "BAN", "Ireland": "IRE", "Malaysia": "MAS", "Zimbabwe": "ZIM",
    "Pakistan": "PAK", "Netherlands": "NED", "Scotland": "SCO", "Nepal": "NEP",
    "USA": "USA", "United States": "USA", "Namibia": "NAM", "UAE": "UAE",
}

CATEGORY = {"Batter": "BAT", "Wicket-keeper": "WK", "All-rounder": "AR",
            "Fast bowler": "BOWL", "Spin bowler": "BOWL", "Bowler": "BOWL"}

SET_NAMES = {"BA": "batters", "AL": "all-rounders", "WK": "wicket-keepers",
             "FA": "fast bowlers", "SP": "spin bowlers"}

# Broadcast colours: crest fill, ring, text.
TEAM_STYLE = {
    "MI": ("Mumbai", "#0b4ea2", "#d9b648", "#ffffff"),
    "CSK": ("Chennai", "#f7c81e", "#1450a3", "#1b1400"),
    "RCB": ("Bengaluru", "#c8102e", "#111111", "#ffffff"),
    "KKR": ("Kolkata", "#3a225d", "#d4af37", "#ffffff"),
    "SRH": ("Hyderabad", "#f26522", "#111111", "#ffffff"),
    "DC": ("Delhi", "#17479e", "#e4252c", "#ffffff"),
    "RR": ("Rajasthan", "#e2297f", "#254aa5", "#ffffff"),
    "PBKS": ("Punjab", "#d71920", "#c0c2c4", "#ffffff"),
    "GT": ("Gujarat", "#1c2c4a", "#c8a95b", "#ffffff"),
    "LSG": ("Lucknow", "#1f6fbf", "#f47b20", "#ffffff"),
}

QUICK_SIZE = 16


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def lakhs(crore):
    return round(float(crore) * 100) if crore not in ("", None) else None


def num(value):
    """CSV cell -> int, float or None."""
    if value in ("", None):
        return None
    f = float(value)
    return int(f) if f.is_integer() and "." not in value else f


def site_path(image):
    """'static/players/x.jpg' -> '/players/x.jpg'."""
    return "/" + Path(image).relative_to(STATIC_DIR).as_posix() if image else None


def set_label(set_no, code):
    capped = "Uncapped" if code.startswith("U") else "Capped"
    return f"Set {set_no} · {capped} {SET_NAMES[code.lstrip('U')[:2]]}"


def stats_entry(s, season):
    last_m = num(s[f"ipl{season}_matches"])
    block = lambda p: {
        "m": num(s[p + "matches"]),
        "runs": num(s[p + "runs"]) or 0,
        "sr": num(s[p + "strike_rate"]),
        "avg": num(s[p + "bat_average"]),
        "wk": num(s[p + "wickets"]) or 0,
        "econ": num(s[p + "economy"]),
    }
    return {
        "n": s["name"],
        "season": f"IPL {season}",
        "last": {"team": s[f"ipl{season}_team"] or None, **block(f"ipl{season}_")} if last_m else None,
        "ipl": {**block("ipl_"), "hs": s["ipl_highest_score"] or None,
                "bb": s["ipl_best_bowling"] or None} if num(s["ipl_matches"]) else None,
        "t20": block("t20_") if num(s["t20_matches"]) else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--season", type=int, default=2026, help="auction season (default: 2026)")
    args = parser.parse_args()
    data_dir = Path(f"data/auction_{args.season}")

    pool = read_csv(data_dir / "auction_pool.csv")
    retained = read_csv(data_dir / "retained_players.csv")
    team_rows = {r["team_code"]: r for r in read_csv(data_dir / "teams.csv")}
    stats_rows = {r["name"]: r for r in read_csv(data_dir / "player_stats.csv")}
    images = read_csv(data_dir / "player_images.csv")

    last_cols = [c for c in next(iter(stats_rows.values())) if c.endswith("_team") and c.startswith("ipl")]
    last_season = last_cols[0][3:-5]  # "ipl2025_team" -> "2025"
    ipl_matches = lambda name: num(stats_rows.get(name, {}).get("ipl_matches")) or 0

    # ---- lots
    lots = []
    for r in pool:
        base = lakhs(r["base_price_cr"])
        capped = r["category"] == "Capped"
        lots.append({
            "id": int(r["lot_no"]),
            "name": r["name"],
            "cc": COUNTRY_CODES.get(r["country"], r["country"][:3].upper()),
            "country": r["country"],
            "overseas": r["country"] != "India",
            "cat": CATEGORY[r["role"]],
            "role": r["role"],
            "capped": capped,
            "set": set_label(r["set_no"], r["set_code"]),
            "setCode": r["set_code"],
            "base": base,
            "tier": "A" if capped and base >= 200 and ipl_matches(r["name"]) >= 25 else "B",
            "photo": site_path(r.get("image")),
        })
    capped_lots = [l for l in lots if l["capped"]]
    quick_ids = {l["id"] for l in sorted(capped_lots, key=lambda l: (-l["base"], -ipl_matches(l["name"])))[:QUICK_SIZE]}
    presets = {
        "quick": {"label": f"Quick · {QUICK_SIZE} players", "lots": [l["id"] for l in lots if l["id"] in quick_ids]},
        "capped": {"label": f"Capped · {len(capped_lots)} players", "lots": [l["id"] for l in capped_lots]},
        "full": {"label": f"Full auction · {len(lots)} players", "lots": [l["id"] for l in lots]},
    }

    # ---- teams
    teams = []
    for code, (name, _) in TEAMS.items():
        if code == "IPL":
            continue
        city, color, ring, ink = TEAM_STYLE[code]
        logo = STATIC_DIR / "logos" / f"{code}.svg"
        squad = sorted(
            ({"name": r["name"], "price": lakhs(r["salary_cr"]), "role": r.get("role") or None,
              "cat": CATEGORY.get(r.get("role", "")), "overseas": r["nationality"] != "India",
              "photo": site_path(r.get("image"))}
             for r in retained if r["team_code"] == code),
            key=lambda p: -(p["price"] or 0))
        teams.append({
            "id": code, "name": name, "city": city,
            "color": color, "ring": ring, "ink": ink,
            "logo": site_path(logo.as_posix()) if logo.exists() else None,
            "purse": lakhs(team_rows[code]["purse_before_auction_cr"]),
            "retained": squad,
        })

    # ---- stats, for every lot and retained player that has any
    names = [l["name"] for l in lots] + [r["name"] for r in retained]
    players = [stats_entry(stats_rows[n], last_season) for n in dict.fromkeys(names)
               if n in stats_rows and stats_rows[n]["t20_matches"]]
    as_of = {2026: "2025-12-16"}.get(args.season)
    stats = {"season": f"IPL {last_season}", "statsAsOf": as_of,
             "source": "Cricsheet (cricsheet.org)", "players": players}
    for p in players:
        if p["t20"]:
            p["t20"]["asof"] = as_of

    # ---- credits
    credits = {
        "stats": "Player statistics are computed from ball-by-ball data published by "
                 "Cricsheet (https://cricsheet.org) under the Open Data Commons Attribution License.",
        "logos": "Team and IPL logos are trademarks of their owners, shown for this non-commercial fan game.",
        "photos": [{"name": r["name"], "photo": site_path(r["image"]), "artist": r["artist"],
                    "license": r["license"], "source": r["wikipedia"]}
                   for r in images if r["image"]],
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, payload in [("lots", {"season": args.season, "presets": presets, "lots": lots}),
                          ("teams", {"freshPurse": 12000, "teams": teams}),
                          ("stats", stats), ("credits", credits)]:
        (OUT_DIR / f"{name}.json").write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n")

    sizes = ", ".join(f"{k}: {len(v['lots'])}" for k, v in presets.items())
    print(f"{len(lots)} lots ({sizes}), "
          f"{len(teams)} teams, {len(players)} players with stats, "
          f"{len(credits['photos'])} photo credits -> {OUT_DIR}/")


if __name__ == "__main__":
    main()
