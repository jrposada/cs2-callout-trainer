#!/usr/bin/env python3
"""Fill the "spawns" of tools/routes.json with the real competitive spawn points.

A competitive round puts each player on one of the map's enabled
info_player_terrorist / info_player_counterterrorist entities with priority 0
(five per side on most maps, more on some: CS2 picks five of them at random).
Those positions come from setpos.gg's dataset (CC BY 4.0,
https://github.com/setposgg/cs2-spawns) in game units, and are turned into
radar px with each map's overview origin (pos_x, pos_y) and scale from awpy's
map_data.json (https://github.com/pnxenopoulos/awpy-data).

Maps the dataset lacks keep the spawns already in routes.json. Only the
"spawns" line of each map is rewritten, so the rest of the file keeps its layout.
Run, then rebuild the routes:
  python3 tools/fetch_spawns.py
  python3 tools/make_routes.py

Needs only the standard library (and network access).
"""
import json
import pathlib
import re
import sys
import urllib.request

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_polygons import ROOT, load_maps  # noqa: E402

SPEC = ROOT / "tools" / "routes.json"
SPAWNS_URL = "https://raw.githubusercontent.com/setposgg/cs2-spawns/main/spawns-competitive.json"
LATEST_URL = "https://api.github.com/repos/pnxenopoulos/awpy-data/releases/latest"
MAPDATA_URL = "https://github.com/pnxenopoulos/awpy-data/releases/download/{tag}/map_data.json"


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "cs2-callout-trainer"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    _, maps = load_maps()
    spawns = get_json(SPAWNS_URL)["spawns"]
    tag = get_json(LATEST_URL)["tag_name"]
    overview = get_json(MAPDATA_URL.format(tag=tag))
    text = SPEC.read_text()
    for m in maps:
        ov = overview.get("de_" + m["id"])
        found = {}
        for s in spawns if ov else []:
            if s["map"] != m["id"] or not s.get("competitive") or not s.get("enabled", True) or s.get("priority", 0) != 0:
                continue
            x = (s["x"] - ov["pos_x"]) / ov["scale"]
            y = (ov["pos_y"] - s["y"]) / ov["scale"]
            found.setdefault(s["side"].upper(), []).append([round(x), round(y)])
        if not ov or set(found) != {"T", "CT"}:
            print(f"{m['id']}: no spawn data, kept as is")
            continue
        if abs(ov["scale"] - m["scale"]) > 1e-3:
            sys.exit(f"{m['id']}: overview scale {ov['scale']} != maps.js scale {m['scale']}; radar changed?")
        line = json.dumps({"T": found["T"], "CT": found["CT"]}, separators=(", ", ": "))
        # Within this map's block, swap out the one-line "spawns": {...}, entry.
        start = text.index(f'"{m["id"]}": {{')
        pat = re.compile(r'"spawns": \{.*\},\n')
        hit = pat.search(text, start)
        text = text[:hit.start()] + f'"spawns": {line},\n' + text[hit.end():]
        print(f"{m['id']}: {len(found['T'])} T, {len(found['CT'])} CT spawns")
    SPEC.write_text(text)


if __name__ == "__main__":
    main()
