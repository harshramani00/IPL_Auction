#!/usr/bin/env python3
"""Scrape the most recent IPL auction (16 Dec 2025, for the 2026 season).

Sources:
  * the official final auction list (every shortlisted player with set and
    base price), as published in full by InsideSport
  * Wikipedia's "List of 2026 Indian Premier League personnel changes", for
    retained players with salaries and the result of every sale

Writes five CSVs:

  auction_pool.csv      pre-auction: all 369 players in lot order, with set,
                        role, capped/uncapped, age, base price, and the result
                        (sold/unsold, team, price)
  retained_players.csv  pre-auction: players each team kept, with salary
  teams.csv             pre-auction purse and open slots per team, then the
                        auction spend and what was left
  sold_players.csv      the 77 players bought, with previous team
  squads.csv            retained + bought, one row per player (final squads)

Prices are in crore (1 crore = 100 lakh). Uses only the standard library.

    python3 scripts/fetch_auction_data.py                    # -> data/auction_2026/
    python3 scripts/fetch_auction_data.py --season 2027      # once that page exists
"""

import argparse
import csv
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from fetch_team_logos import TEAMS

API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = "IPL-Auction-DataFetcher/1.0 (personal project)"
PAGE = "List of {season} Indian Premier League personnel changes"

CODE_BY_NAME = {name: code for code, (name, _) in TEAMS.items()}

# Article reproducing the BCCI's final auction list as a table, per season.
AUCTION_LIST_URL = {
    2026: "https://www.insidesport.in/?p=1184828",
}

SQUAD_MAX, OVERSEAS_MAX = 25, 8

# Set code prefix ("UFA5" -> "FA", uncapped) -> role.
SET_ROLES = {"BA": "Batter", "AL": "All-rounder", "WK": "Wicket-keeper",
             "FA": "Fast bowler", "SP": "Spin bowler"}

# Purse each team took into the auction, as announced after retentions (crore).
# Wikipedia's retained salaries don't capture every purse deduction (trades etc.),
# so cap - retained is off for some teams; prefer these when known.
OFFICIAL_PURSE_BEFORE_AUCTION = {
    2026: {"KKR": 64.3, "CSK": 43.4, "SRH": 25.5, "LSG": 22.95, "DC": 21.8,
           "RCB": 16.4, "RR": 16.05, "GT": 12.9, "PBKS": 11.5, "MI": 2.75},
}

# Words in a set caption ("Set 4: capped fast bowlers (FA1)") -> role.
ROLE_WORDS = [
    ("all-rounder", "All-rounder"),
    ("wicket-keeper", "Wicket-keeper"),
    ("batter", "Batter"),
    ("fast bowler", "Fast bowler"),
    ("spin bowler", "Spin bowler"),
]


class TableParser(HTMLParser):
    """Collect tables as {"caption": str, "rows": [[cell text, ...]]}.

    With css_class set, only tables carrying that class are collected.
    """

    SKIP = ("sup", "style", "script")  # footnote markers, inline CSS

    def __init__(self, css_class=None):
        super().__init__(convert_charrefs=True)
        self.css_class = css_class
        # One entry per open <table>: the collected dict, or None for layout tables
        # (Wikipedia's retained lists sit inside a two-column layout table).
        self.tables, self._stack, self._cell = [], [], None
        self._in_caption, self._skip = False, 0

    @property
    def _table(self):
        return self._stack[-1] if self._stack else None

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            table = None
            if not self.css_class or self.css_class in (dict(attrs).get("class") or ""):
                table = {"caption": "", "rows": []}
                self.tables.append(table)
            self._stack.append(table)
        elif tag in self.SKIP:
            self._skip += 1
        elif self._table is None:
            return
        elif tag == "caption":
            self._in_caption = True
        elif tag == "tr":
            self._table["rows"].append([])
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag):
        if tag == "table":
            self._stack.pop()
        elif tag in self.SKIP:
            self._skip -= 1
        elif self._table is None:
            return
        elif tag == "caption":
            self._in_caption = False
        elif tag in ("td", "th") and self._cell is not None:
            self._table["rows"][-1].append(" ".join("".join(self._cell).split()))
            self._cell = None

    def handle_data(self, data):
        if self._skip or self._table is None:
            return
        if self._in_caption:
            self._table["caption"] += data
        elif self._cell is not None:
            self._cell.append(data)


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def fetch_tables(season):
    params = {"action": "parse", "format": "json", "formatversion": "2",
              "page": PAGE.format(season=season), "prop": "text", "redirects": 1}
    data = json.loads(http_get(f"{API}?{urllib.parse.urlencode(params)}"))
    if "error" in data:
        raise SystemExit(f"Wikipedia: {data['error']['info']}")
    page_html = data["parse"]["text"]
    parser = TableParser("wikitable")
    parser.feed(page_html)
    for t in parser.tables:
        t["caption"] = " ".join(t["caption"].split())
    purse = re.search(r"purse for each franchise (?:was )?set at ₹\s*([\d.]+)\s*crore",
                      html.unescape(re.sub(r"<[^>]+>", "", page_html)))
    return parser.tables, float(purse.group(1)) if purse else None


def to_crore(text):
    """'₹18 crore (US$2.1 million)' -> 18.0, '₹30 lakh (...)' -> 0.3."""
    m = re.search(r"([\d.,]+)\s*(crore|lakh)", text)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    return round(value if m.group(2) == "crore" else value / 100, 2)


def lakh_to_crore(text):
    return round(float(text.replace(",", "")) / 100, 2) if text.strip() else None


def blank_na(text):
    return "" if text.lower().strip("—–- ") in ("", "n/a") else text


def parse_retained(tables):
    rows = []
    for t in tables:
        header = t["rows"][0] if t["rows"] else []
        if header[:4] != ["No.", "Player", "Nationality", "Salary"]:
            continue
        team = t["caption"]
        for r in t["rows"][1:]:
            if len(r) < 4:
                continue
            rows.append({"team": team, "team_code": CODE_BY_NAME.get(team, ""),
                         "name": r[1], "nationality": r[2], "salary_cr": to_crore(r[3])})
    return rows


def parse_sold(tables, season):
    rows = []
    for t in tables:
        if not t["rows"] or "Auctioned price" not in " ".join(t["rows"][0]):
            continue
        cols = [re.sub(r"\(.*", "", h).strip() for h in t["rows"][0]]
        caption = t["caption"]
        set_name = caption.split(":")[0] if caption.startswith("Set") else caption
        lower = caption.lower()
        caption_role = next((role for word, role in ROLE_WORDS if word in lower), "")
        caption_cat = "Uncapped" if "uncapped" in lower else "Capped" if "capped" in lower else ""

        for r in t["rows"][1:]:
            if len(r) != len(cols):
                continue
            cell = dict(zip(cols, r))
            team = cell[f"{season} IPL team"]
            rows.append({
                "set": set_name,
                "lot_no": cell["No."],
                "name": cell["Name"],
                "country": cell["Country"],
                "role": cell.get("Role") or caption_role,
                "category": cell.get("Category") or caption_cat,
                "ipl_matches": blank_na(cell.get("No. of IPL matches", "")),
                "base_price_cr": lakh_to_crore(cell["Base price"]),
                "sold_price_cr": lakh_to_crore(cell["Auctioned price"]),
                "team": team,
                "team_code": CODE_BY_NAME.get(team, ""),
                "previous_team": blank_na(cell.get(f"{season - 1} IPL team", "")),
            })
    return rows


def fetch_pool(season):
    """Every shortlisted player in lot order, from the published auction list."""
    url = AUCTION_LIST_URL.get(season)
    if not url:
        return []
    parser = TableParser()
    parser.feed(http_get(url))
    pool = []
    for t in parser.tables:
        if not t["rows"] or "Set No." not in t["rows"][0]:
            continue
        cols = t["rows"][0]
        for r in t["rows"][1:]:
            if len(r) != len(cols):
                continue
            cell = dict(zip(cols, r))
            code = cell["Set"]
            pool.append({
                "lot_no": cell["Sr. No."],
                "set_no": cell["Set No."],
                "set_code": code,
                "name": cell["Player Name"],
                "country": cell["Country"],
                "age": cell["Age"],
                "role": SET_ROLES.get(code.lstrip("U")[:2], ""),
                "category": "Uncapped" if code.startswith("U") else "Capped",
                "base_price_cr": lakh_to_crore(cell["Base Price (Rs Lakh)"]),
            })
    return pool


def name_key(name):
    return re.sub(r"[^a-z]", "", name.lower())


def add_results(pool, sold):
    """Attach sold/unsold, team and price to each pool row (joined on lot number)."""
    by_lot = {s["lot_no"]: s for s in sold}
    for p in pool:
        s = by_lot.pop(p["lot_no"], None)
        if s and name_key(s["name"]) != name_key(p["name"]):
            # Usually the same player spelled differently (Lungisani vs Lungi Ngidi).
            print(f"Note: lot {p['lot_no']} is {p['name']} in the list, "
                  f"{s['name']} on Wikipedia", file=sys.stderr)
        p.update({"status": "sold" if s else "unsold",
                  "team": s["team"] if s else "", "team_code": s["team_code"] if s else "",
                  "sold_price_cr": s["sold_price_cr"] if s else ""})
    for s in by_lot.values():
        print(f"Warning: sold player {s['name']} (lot {s['lot_no']}) not in the auction list",
              file=sys.stderr)


def write_csv(path, rows):
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--season", type=int, default=2026,
                        help="IPL season the auction was for (default: 2026)")
    parser.add_argument("--out", help="output folder (default: data/auction_<season>)")
    args = parser.parse_args()
    out_dir = Path(args.out or f"data/auction_{args.season}")

    tables, purse_cap = fetch_tables(args.season)
    retained = parse_retained(tables)
    sold = parse_sold(tables, args.season)
    if not sold:
        raise SystemExit(f"No sold-player tables found for {args.season} yet.")
    pool = fetch_pool(args.season)
    add_results(pool, sold)

    squads = (
        [{"name": r["name"], "nationality": r["nationality"], "team": r["team"],
          "team_code": r["team_code"], "status": "retained", "price_cr": r["salary_cr"]}
         for r in retained]
        + [{"name": s["name"], "nationality": s["country"], "team": s["team"],
            "team_code": s["team_code"], "status": "bought", "price_cr": s["sold_price_cr"]}
           for s in sold]
    )
    squads.sort(key=lambda r: (r["team"], r["status"] != "retained", -(r["price_cr"] or 0)))

    official = OFFICIAL_PURSE_BEFORE_AUCTION.get(args.season, {})
    teams = []
    for code, (name, _) in TEAMS.items():
        kept = [r for r in retained if r["team_code"] == code]
        bought = [s for s in sold if s["team_code"] == code]
        kept_cr = round(sum(r["salary_cr"] or 0 for r in kept), 2)
        bought_cr = round(sum(s["sold_price_cr"] or 0 for s in bought), 2)
        before = official.get(code) or (round(purse_cap - kept_cr, 2) if purse_cap else None)
        overseas = sum(r["nationality"] != "India" for r in kept)
        teams.append({
            "team": name, "team_code": code,
            "purse_cap_cr": purse_cap,
            "retained": len(kept),
            "retained_overseas": overseas,
            "retained_salaries_cr": kept_cr,
            "purse_before_auction_cr": before if before is not None else "",
            "slots_open": SQUAD_MAX - len(kept),
            "overseas_slots_open": OVERSEAS_MAX - overseas,
            "bought": len(bought),
            "squad_size": len(kept) + len(bought),
            "auction_spend_cr": bought_cr,
            "purse_remaining_cr": round(before - bought_cr, 2) if before is not None else "",
        })

    out_dir.mkdir(parents=True, exist_ok=True)
    if pool:
        write_csv(out_dir / "auction_pool.csv", pool)
    else:
        print(f"No auction list source known for {args.season}; skipping auction_pool.csv",
              file=sys.stderr)
    write_csv(out_dir / "sold_players.csv", sold)
    write_csv(out_dir / "retained_players.csv", retained)
    write_csv(out_dir / "squads.csv", squads)
    write_csv(out_dir / "teams.csv", teams)

    unmatched = {r["team"] for r in retained + sold if not r["team_code"]}
    print(f"{len(pool)} in auction pool, {len(sold)} sold, {len(retained)} retained, "
          f"{len(squads)} squad rows -> {out_dir}")
    if unmatched:
        print(f"Warning: team names not matched to a code: {', '.join(sorted(unmatched))}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
