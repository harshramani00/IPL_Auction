#!/usr/bin/env python3
"""Download the current official logo for every IPL team.

Source: the logo in each team's English Wikipedia infobox, which is kept up
to date and is almost always a vector SVG. For each team we save:

  <CODE>.svg   original vector file (best quality, scales to any size)
  <CODE>.png   transparent PNG rendered by Wikimedia, at least --width pixels wide

plus a manifest.json with names, codes, file paths and source URLs.

Uses only the Python standard library.

    python3 scripts/fetch_team_logos.py                  # -> static/logos/
    python3 scripts/fetch_team_logos.py --out assets --width 1024
    python3 scripts/fetch_team_logos.py --teams MI CSK   # just some teams
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://en.wikipedia.org/w/api.php"
# Wikimedia rejects requests without a descriptive User-Agent.
USER_AGENT = "IPL-Auction-LogoFetcher/1.0 (https://github.com/; personal project)"

# code -> (display name, Wikipedia article title)
TEAMS = {
    "CSK": ("Chennai Super Kings", "Chennai Super Kings"),
    "DC": ("Delhi Capitals", "Delhi Capitals"),
    "GT": ("Gujarat Titans", "Gujarat Titans"),
    "KKR": ("Kolkata Knight Riders", "Kolkata Knight Riders"),
    "LSG": ("Lucknow Super Giants", "Lucknow Super Giants"),
    "MI": ("Mumbai Indians", "Mumbai Indians"),
    "PBKS": ("Punjab Kings", "Punjab Kings"),
    "RR": ("Rajasthan Royals", "Rajasthan Royals"),
    "RCB": ("Royal Challengers Bengaluru", "Royal Challengers Bengaluru"),
    "SRH": ("Sunrisers Hyderabad", "Sunrisers Hyderabad"),
}

INFOBOX_FIELDS = ("logo", "image")
IMAGE_EXT = re.compile(r"\.(svg|png|jpe?g|webp)$", re.I)


def http_get(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except Exception as exc:  # network hiccup or 429
            if attempt == retries - 1:
                raise
            print(f"    retrying after error: {exc}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def api(**params):
    params = {"action": "query", "format": "json", "formatversion": "2", **params}
    return json.loads(http_get(f"{API}?{urllib.parse.urlencode(params)}"))


def clean_filename(raw):
    """Turn an infobox value like '[[File:X Logo.svg|200px]]' into 'X Logo.svg'."""
    raw = re.sub(r"^\[\[(?:File|Image):", "", raw.strip(), flags=re.I)
    raw = raw.split("|")[0].strip(" ]")
    return raw if IMAGE_EXT.search(raw) else None


def find_logo_file(article):
    """Return the File: name of the team's logo, or None."""
    data = api(titles=article, redirects=1, prop="revisions",
               rvprop="content", rvslots="main", rvsection=0)
    page = data["query"]["pages"][0]
    if "missing" in page:
        raise LookupError(f"Wikipedia article not found: {article}")
    wikitext = page["revisions"][0]["slots"]["main"]["content"]

    for field in INFOBOX_FIELDS:
        m = re.search(rf"^\s*\|\s*{field}\s*=\s*(.+)$", wikitext, re.M | re.I)
        if m and (name := clean_filename(m.group(1))):
            return name

    # Fallback: any file on the page with "logo" in its name, SVGs first.
    data = api(titles=page["title"], prop="images", imlimit="max")
    files = [i["title"].split(":", 1)[1] for i in data["query"]["pages"][0].get("images", [])]
    logos = [f for f in files if "logo" in f.lower() and IMAGE_EXT.search(f)]
    logos.sort(key=lambda f: not f.lower().endswith(".svg"))
    return logos[0] if logos else None


def image_info(filename, width):
    data = api(titles=f"File:{filename}", prop="imageinfo",
               iiprop="url|mime|size", iiurlwidth=width)
    info = data["query"]["pages"][0]["imageinfo"][0]
    strip = lambda u: u.split("?")[0]  # drop utm_* tracking params
    return {
        "original_url": strip(info["url"]),
        "png_url": strip(info["thumburl"]),
        "mime": info["mime"],
        "page": info["descriptionurl"],
    }


def fetch_team(code, name, article, out_dir, width):
    filename = find_logo_file(article)
    if not filename:
        raise LookupError("no logo found in infobox or page images")
    info = image_info(filename, width)

    ext = Path(urllib.parse.unquote(info["original_url"])).suffix.lower()
    original_path = out_dir / f"{code}{ext}"
    original_path.write_bytes(http_get(info["original_url"]))

    entry = {"code": code, "name": name, "source": info["page"],
             "original": original_path.name}

    # A raster original is already the best we can get; only render SVGs.
    if ext == ".svg":
        png_path = out_dir / f"{code}.png"
        png_path.write_bytes(http_get(info["png_url"]))
        entry["png"] = png_path.name
    return entry


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", default="static/logos", help="output folder (default: static/logos)")
    parser.add_argument("--width", type=int, default=512, help="minimum PNG width in px; Wikimedia rounds up to its standard sizes (default: 512)")
    parser.add_argument("--teams", nargs="*", metavar="CODE", help=f"subset of: {' '.join(TEAMS)}")
    args = parser.parse_args()

    codes = [c.upper() for c in args.teams] if args.teams else list(TEAMS)
    unknown = [c for c in codes if c not in TEAMS]
    if unknown:
        parser.error(f"unknown team code(s): {', '.join(unknown)}")

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest, failed = [], []
    for code in codes:
        name, article = TEAMS[code]
        print(f"{code:5} {name} ... ", end="", flush=True)
        try:
            entry = fetch_team(code, name, article, out_dir, args.width)
            manifest.append(entry)
            print(", ".join(filter(None, [entry["original"], entry.get("png")])))
        except Exception as exc:
            failed.append(code)
            print(f"FAILED ({exc})")
        time.sleep(0.5)  # be polite to Wikimedia

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"\nSaved {len(manifest)} logo(s) to {out_dir.resolve()}")
    if failed:
        print(f"Failed: {' '.join(failed)}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
