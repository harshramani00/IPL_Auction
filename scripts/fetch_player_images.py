#!/usr/bin/env python3
"""Download a photo for every player in the auction data, where one exists.

Run after fetch_auction_data.py. For each player in auction_pool.csv and
retained_players.csv it finds the player's English Wikipedia article and
downloads the article's lead photo. Wikipedia only exposes freely licensed
photos this way, so every image is reusable with attribution, but many
players (especially uncapped ones) have no photo and are left blank.

Articles are found by, in order:
  1. the link on the season's personnel-changes page (retained/sold players)
  2. a Wikipedia search, accepted only when the result is described as a
     cricketer from the player's country

Writes:
  static/players/<slug>.jpg            the photos (~500px wide)
  data/auction_<season>/player_images.csv
      name, country, wikipedia, image, image_url, license, artist
and adds an `image` column (path or blank) to auction_pool.csv,
retained_players.csv and the results/ CSVs.

    python3 scripts/fetch_player_images.py
    python3 scripts/fetch_player_images.py --refresh   # re-download existing photos
"""

import argparse
import csv
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from fetch_auction_data import API, PAGE, USER_AGENT

THUMB_WIDTH = 500
IMAGES_DIR = Path("static/players")

# Country in the auction list -> words a Wikipedia description would use.
DEMONYMS = {
    "India": ["Indian"], "Australia": ["Australian"], "England": ["English", "British"],
    "New Zealand": ["New Zealand"], "South Africa": ["South African"],
    "Sri Lanka": ["Sri Lankan"], "Afghanistan": ["Afghan"], "Bangladesh": ["Bangladeshi"],
    "Zimbabwe": ["Zimbabwean"], "Ireland": ["Irish"], "Netherlands": ["Dutch"],
    "Scotland": ["Scottish"], "USA": ["American"], "United States": ["American"],
    "Nepal": ["Nepalese", "Nepali"], "Malaysia": ["Malaysian"], "Namibia": ["Namibian"],
    "Pakistan": ["Pakistani"], "United Arab Emirates": ["Emirati"], "UAE": ["Emirati"],
    # West Indians are described by island ("Jamaican", "Trinidadian", ...).
    "West Indies": [""],
}


def http_get(url, retries=6):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read()
        except Exception as exc:  # usually 429 from Wikimedia
            if attempt == retries - 1:
                raise
            retry_after = getattr(exc, "headers", None) and exc.headers.get("Retry-After")
            wait = int(retry_after) if retry_after and retry_after.isdigit() else 5 * 2 ** attempt
            print(f"    {exc}; waiting {wait}s", file=sys.stderr)
            time.sleep(wait)


def api(**params):
    params = {"action": "query", "format": "json", "formatversion": "2", **params}
    return json.loads(http_get(f"{API}?{urllib.parse.urlencode(params)}"))


def name_key(name):
    return re.sub(r"[^a-z]", "", name.lower())


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def strip_tags(text):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", "", text or "")).split())


def linked_titles(season):
    """name -> article title, from player links on the personnel-changes page."""
    params = {"action": "parse", "format": "json", "formatversion": "2",
              "page": PAGE.format(season=season), "prop": "text", "redirects": 1}
    page = json.loads(http_get(f"{API}?{urllib.parse.urlencode(params)}"))["parse"]["text"]
    # Player cells look like <th scope="row"><span ...><a href="/wiki/X">Name</a>...</th>.
    titles = {}
    for cell in re.findall(r'<th scope="row">(.*?)</th>', page, re.S):
        m = re.search(r'<a href="/wiki/([^"#]+)"[^>]*>(.*?)</a>', cell)
        if m and "redlink" not in cell:
            titles[name_key(strip_tags(m.group(2)))] = urllib.parse.unquote(m.group(1)).replace("_", " ")
    return titles


def is_match(name, country, title, description):
    description = description or ""
    if "cricketer" not in description.lower():
        return False
    demonyms = DEMONYMS.get(country)
    if demonyms is not None and not any(d in description for d in demonyms):
        return False
    # The surname must appear in the article title.
    surname = name_key(name.split()[-1])
    return surname in name_key(re.sub(r"\(.*\)", "", title))


def search_title(name, country):
    data = api(generator="search", gsrsearch=f'"{name}" cricketer', gsrlimit=5,
               gsrnamespace=0, prop="description")
    pages = sorted(data.get("query", {}).get("pages", []), key=lambda p: p["index"])
    for p in pages:
        if is_match(name, country, p["title"], p.get("description")):
            return p["title"]
    return None


def page_images(titles):
    """title -> {file, thumb, description} for titles that have a free lead photo."""
    out = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        data = api(titles="|".join(batch), redirects=1, prop="pageimages|description",
                   piprop="thumbnail|name", pithumbsize=THUMB_WIDTH)
        q = data["query"]
        resolved = {t: t for t in batch}
        for step in q.get("normalized", []) + q.get("redirects", []):
            for orig, cur in resolved.items():
                if cur == step["from"]:
                    resolved[orig] = step["to"]
        by_title = {p["title"]: p for p in q["pages"]}
        for orig, final in resolved.items():
            p = by_title.get(final, {})
            # SVG lead images are flags or logos (e.g. Flag_of_India.svg), never photos.
            if (p.get("pageimage") and p.get("thumbnail")
                    and not p["pageimage"].lower().endswith(".svg")):
                out[orig] = {"file": p["pageimage"], "thumb": p["thumbnail"]["source"].split("?")[0],
                             "title": final, "description": p.get("description", "")}
    return out


def credits(files):
    """file name -> (license, artist) from Commons metadata."""
    out = {}
    for i in range(0, len(files), 50):
        batch = files[i:i + 50]
        data = api(titles="|".join(f"File:{f}" for f in batch), prop="imageinfo",
                   iiprop="extmetadata", iiextmetadatafilter="LicenseShortName|Artist")
        for p in data["query"]["pages"]:
            meta = (p.get("imageinfo") or [{}])[0].get("extmetadata", {})
            out[p["title"].split(":", 1)[1].replace(" ", "_")] = (
                strip_tags(meta.get("LicenseShortName", {}).get("value")),
                strip_tags(meta.get("Artist", {}).get("value")))
    return out


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def add_image_column(path, images, name_field="name"):
    if not path.exists():
        return
    rows = read_csv(path)
    for r in rows:
        r["image"] = images.get(r[name_field], "")
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--refresh", action="store_true", help="re-download photos already on disk")
    args = parser.parse_args()
    data_dir = Path(f"data/auction_{args.season}")

    players = {}  # name -> country, first spelling wins
    for r in read_csv(data_dir / "auction_pool.csv"):
        players.setdefault(r["name"], r["country"])
    for r in read_csv(data_dir / "retained_players.csv"):
        players.setdefault(r["name"], r["nationality"])
    print(f"{len(players)} players")

    # Search results are cached so an interrupted run picks up where it stopped.
    cache_path = data_dir / ".wikipedia_search_cache.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    linked = linked_titles(args.season)
    titles = {}
    for n, (name, country) in enumerate(players.items(), 1):
        title = linked.get(name_key(name))
        if not title:
            if name not in cache:
                cache[name] = search_title(name, country)
                cache_path.write_text(json.dumps(cache, indent=1))
                time.sleep(1)  # Wikipedia rate-limits bursts of searches
            title = cache[name]
        if title:
            titles[name] = title
        if n % 50 == 0:
            print(f"  looked up {n}/{len(players)} ({len(titles)} articles found)")
    print(f"{len(titles)} players have a Wikipedia article")

    found = page_images(sorted(set(titles.values())))
    photos = {name: found[t] for name, t in titles.items() if t in found}
    lic = credits(sorted({p["file"] for p in photos.values()}))
    print(f"{len(photos)} have a free photo; downloading to {IMAGES_DIR}/")

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    rows, image_paths = [], {}
    for name, country in players.items():
        p = photos.get(name)
        row = {"name": name, "country": country,
               "wikipedia": f"https://en.wikipedia.org/wiki/{urllib.parse.quote(titles[name].replace(' ', '_'))}"
               if name in titles else "",
               "image": "", "image_url": "", "license": "", "artist": ""}
        if p:
            ext = Path(p["thumb"]).suffix.lower().replace(".jpeg", ".jpg") or ".jpg"
            path = IMAGES_DIR / f"{slug(name)}{ext}"
            if args.refresh or not path.exists():
                path.write_bytes(http_get(p["thumb"]))
                time.sleep(1)  # upload.wikimedia.org throttles fast downloads
            license_name, artist = lic.get(p["file"], ("", ""))
            row.update(image=path.as_posix(), image_url=p["thumb"],
                       license=license_name, artist=artist)
            image_paths[name] = path.as_posix()
        rows.append(row)

    with open(data_dir / "player_images.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    for path in [data_dir / "auction_pool.csv", data_dir / "retained_players.csv",
                 data_dir / "results" / "sold_players.csv", data_dir / "results" / "squads.csv"]:
        add_image_column(path, image_paths)

    print(f"Done: {len(image_paths)}/{len(players)} players have a photo "
          f"-> {data_dir / 'player_images.csv'}")


if __name__ == "__main__":
    main()
