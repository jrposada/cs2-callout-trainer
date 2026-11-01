#!/usr/bin/env python3
"""Give every callout in data/maps.js a rectangular zone.

How it works
  * The walkable floor of each radar is taken from its alpha channel (dark wall
    lines are excluded).
  * Each callout starts as a tiny box at its name and grows one step at a time
    in each direction while the new strip is mostly floor, stays under a size
    cap, and does not run into a neighbour. The map does not have to be fully
    covered: zones stop at walls and at each other.
  * "Area" callouts (tools/areas.json: rooms, corridors, sites) grow large and
    never overlap each other. Every other callout is a "spot" that stays small
    and sits on top of the areas.
  * Output is "poly": [x0, y0, x1, y0, x1, y1, x0, y1] in radar pixels (0-1024),
    plus "area": true for areas. The app can turn a rectangle into a free
    polygon in Edit when a zone really needs it.

By default only callouts without a zone are generated, so hand edits survive.
Use --force to rebuild everything, or --map dust2 for one map.

Needs: pip install numpy pillow scipy
"""
import argparse
import json
import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "maps.js"
AREAS = ROOT / "tools" / "areas.json"

# Size caps in game units (1 unit ~ 1 inch); converted to radar px per map.
CAP_UNITS = {True: 1100, False: 230}     # area, spot
FLOOR_SHARE = 0.85                       # a new strip must be at least this much floor
STEP = 2                                 # growth step, radar px
GAP = 2                                  # px kept between neighbouring zones of the same layer


def load_maps():
    text = DATA.read_text()
    body = text[text.index("[", text.index("CALLOUT_MAPS")): text.rstrip().rindex("]") + 1]
    header = text[: text.index("window.CALLOUT_MAPS")]
    return header, json.loads(body)


def fmt_map(m):
    head = {k: v for k, v in m.items() if k != "callouts"}
    s = "  {\n" + "".join(f"    {json.dumps(k)}: {json.dumps(v)},\n" for k, v in head.items())
    rows = []
    for c in m["callouts"]:
        for k in ("x", "y"):
            if float(c[k]).is_integer():
                c[k] = int(c[k])
        rows.append("      " + json.dumps(c, ensure_ascii=False, separators=(", ", ": ")))
    s += '    "callouts": [\n' + ",\n".join(rows) + "\n    ]\n  }"
    return s


def save_maps(header, maps):
    DATA.write_text(header + "window.CALLOUT_MAPS = [\n" + ",\n".join(fmt_map(m) for m in maps) + "\n];\n")


def floor_mask(radar_path, level):
    a = np.asarray(Image.open(radar_path).convert("RGBA"), dtype=np.float32)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    thresh = 240 if level == "lower" else 128
    mask = (a[..., 3] > thresh) & (lum > 22)
    return ndimage.binary_opening(mask, iterations=1)


def snap(mask, x, y):
    r = min(max(int(round(y)), 0), mask.shape[0] - 1)
    c = min(max(int(round(x)), 0), mask.shape[1] - 1)
    if mask[r, c]:
        return c, r
    _, (ri, ci) = ndimage.distance_transform_edt(~mask, return_indices=True)
    return int(ci[r, c]), int(ri[r, c])


def overlaps(a, b):
    return a[0] < b[2] + GAP and b[0] < a[2] + GAP and a[1] < b[3] + GAP and b[1] < a[3] + GAP


def grow(mask, group, cap):
    """Grow boxes [x0, y0, x1, y1] for every seed in the group together, one step per round."""
    H, W = mask.shape
    boxes = []
    for (sx, sy) in group:
        boxes.append([sx - 1, sy - 1, sx + 2, sy + 2])
    seeds = list(group)
    active = [True] * len(boxes)
    while any(active):
        for i, b in enumerate(boxes):
            if not active[i]:
                continue
            grew = False
            for side in range(4):
                nb = b[:]
                if side == 0: nb[0] = max(0, b[0] - STEP); strip = mask[b[1]:b[3], nb[0]:b[0]]
                elif side == 1: nb[2] = min(W, b[2] + STEP); strip = mask[b[1]:b[3], b[2]:nb[2]]
                elif side == 2: nb[1] = max(0, b[1] - STEP); strip = mask[nb[1]:b[1], b[0]:b[2]]
                else: nb[3] = min(H, b[3] + STEP); strip = mask[b[3]:nb[3], b[0]:b[2]]
                if strip.size == 0 or strip.mean() < FLOOR_SHARE:
                    continue
                if nb[2] - nb[0] > cap or nb[3] - nb[1] > cap:
                    continue
                # Never swallow another callout's name, never overlap a neighbour.
                if any(j != i and nb[0] - GAP <= sx <= nb[2] + GAP and nb[1] - GAP <= sy <= nb[3] + GAP for j, (sx, sy) in enumerate(seeds)):
                    continue
                if any(j != i and overlaps(nb, o) for j, o in enumerate(boxes)):
                    continue
                boxes[i] = b = nb
                grew = True
            active[i] = grew
    return boxes


def build_level(m, level, areas, force):
    mask = floor_mask(ROOT / m["radar"][level], level)
    callouts = [c for c in m["callouts"] if c.get("level", "upper") == level]
    made = 0
    for is_area in (True, False):
        group = [c for c in callouts if (c["name"] in areas) == is_area]
        for c in group:
            if is_area: c["area"] = True
            else: c.pop("area", None)
        if not any(force or not c.get("poly") for c in group):
            continue
        cap = CAP_UNITS[is_area] / m["scale"]
        seeds = [snap(mask, c["x"], c["y"]) for c in group]
        boxes = grow(mask, seeds, cap)
        for c, (sx, sy), (x0, y0, x1, y1) in zip(group, seeds, boxes):
            if not force and c.get("poly"):
                continue
            # Keep small spots readable even in tight corners.
            if x1 - x0 < 12: x0, x1 = sx - 6, sx + 6
            if y1 - y0 < 12: y0, y1 = sy - 6, sy + 6
            c["poly"] = [x0, y0, x1, y0, x1, y1, x0, y1]
            c["x"], c["y"] = (x0 + x1) // 2, (y0 + y1) // 2   # name in the middle of its zone
            made += 1
    return made


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="rebuild zones that already exist")
    ap.add_argument("--map", help="only this map id, e.g. dust2")
    args = ap.parse_args()
    header, maps = load_maps()
    area_names = json.loads(AREAS.read_text())
    for m in maps:
        if args.map and m["id"] != args.map:
            continue
        areas = set(area_names.get(m["id"], []))
        unknown = areas - {c["name"] for c in m["callouts"]}
        if unknown:
            print(f"  ! {m['id']}: areas.json names not in data: {sorted(unknown)}")
        total = sum(build_level(m, lv, areas, args.force) for lv in m["levels"])
        print(f"{m['id']}: {total} zones generated")
    save_maps(header, maps)


if __name__ == "__main__":
    main()
