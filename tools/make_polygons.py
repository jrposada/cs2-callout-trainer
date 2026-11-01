#!/usr/bin/env python3
"""Generate a polygon for every callout in data/maps.js.

How it works
  * The walkable floor of each radar is taken from its alpha channel (dark wall
    lines are excluded).
  * "Area" callouts (listed in tools/areas.json) split the whole floor between
    them: each floor pixel goes to the area whose label point is nearest when
    walking around walls (a geodesic Voronoi split).
  * Every other callout is a "spot": it gets the floor nearest to it among the
    spots, limited to a short walking distance, and is drawn on top of the areas.
  * Each region is traced, simplified and written back as "poly": [x1, y1, x2, y2, ...]
    in radar pixels (0-1024), plus "area": true for areas.

By default only callouts without a polygon are generated, so hand edits made in
the app's Edit mode survive. Use --force to rebuild everything, or
--map dust2 to limit the run to one map.

Needs: pip install numpy pillow scipy scikit-image shapely
"""
import argparse
import json
import pathlib
import re

import numpy as np
from PIL import Image
from scipy import ndimage
from shapely.geometry import Polygon, MultiPolygon
from shapely.ops import polylabel, nearest_points
from shapely.geometry import Point
from skimage import measure
from skimage.graph import MCP_Geometric

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "maps.js"
AREAS = ROOT / "tools" / "areas.json"

WORK = 512                 # grid used for the walking-distance search
SPOT_REACH_UNITS = 160     # how far a spot extends, in game units (1 unit ~ 1 inch)
SIMPLIFY_PX = {True: 3.0, False: 2.0}   # areas, spots


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
    im = Image.open(radar_path).convert("RGBA")
    a = np.asarray(im, dtype=np.float32)
    alpha = a[..., 3]
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    thresh = 240 if level == "lower" else 128
    mask = (alpha > thresh) & (lum > 22)
    mask = ndimage.binary_opening(mask, iterations=1)
    return mask


def geodesic_costs(mask_small, seeds_small):
    """Walking distance from each seed to every floor cell (inf where unreachable)."""
    cost = np.where(mask_small, 1.0, -1.0)
    out = np.full((len(seeds_small),) + mask_small.shape, np.inf, dtype=np.float32)
    for i, (r, c) in enumerate(seeds_small):
        mcp = MCP_Geometric(cost, fully_connected=True)
        d, _ = mcp.find_costs([(r, c)])
        d = d.astype(np.float32)
        d[~mask_small] = np.inf
        d[~np.isfinite(d)] = np.inf
        out[i] = d
    return out


def snap(mask, x, y):
    """Nearest floor pixel to (x, y) in mask coordinates."""
    r, c = int(round(y)), int(round(x))
    r = min(max(r, 0), mask.shape[0] - 1)
    c = min(max(c, 0), mask.shape[1] - 1)
    if mask[r, c]:
        return r, c
    _, (ri, ci) = ndimage.distance_transform_edt(~mask, return_indices=True)
    return int(ri[r, c]), int(ci[r, c])


def region_to_poly(region, seed_xy, scale, tolerance):
    """Trace a boolean region (in WORK grid) into a simplified polygon in radar px."""
    region = ndimage.binary_closing(region, iterations=1)
    region = ndimage.binary_fill_holes(region)
    lab, n = ndimage.label(region)
    if n == 0:
        return None
    sr, sc = int(seed_xy[1] / scale), int(seed_xy[0] / scale)
    sr = min(max(sr, 0), region.shape[0] - 1)
    sc = min(max(sc, 0), region.shape[1] - 1)
    keep = lab[sr, sc]
    if keep == 0:
        sizes = ndimage.sum(region, lab, range(1, n + 1))
        keep = int(np.argmax(sizes)) + 1
    part = np.pad(lab == keep, 1)
    contours = measure.find_contours(part.astype(np.float32), 0.5)
    if not contours:
        return None
    cont = max(contours, key=len)
    pts = [((c - 1 + 0.5) * scale, (r - 1 + 0.5) * scale) for r, c in cont]
    poly = Polygon(pts).buffer(0)
    if isinstance(poly, MultiPolygon):
        poly = max(poly.geoms, key=lambda g: g.area)
    poly = poly.simplify(tolerance, preserve_topology=True)
    if poly.is_empty or poly.area < 30:
        return None
    coords = list(poly.exterior.coords)[:-1]
    flat = []
    for x, y in coords:
        flat += [int(round(min(max(x, 0), 1024))), int(round(min(max(y, 0), 1024)))]
    return flat


def build_level(m, level, areas, force):
    radar = ROOT / m["radar"][level]
    mask = floor_mask(radar, level)
    scale = mask.shape[0] / WORK
    small = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).resize((WORK, WORK), Image.NEAREST)) > 0
    callouts = [c for c in m["callouts"] if c.get("level", "upper") == level]
    area_cs = [c for c in callouts if c["name"] in areas]
    spot_cs = [c for c in callouts if c["name"] not in areas]
    reach = SPOT_REACH_UNITS / m["scale"] / scale  # in WORK cells

    def seeds(cs):
        return [snap(small, c["x"] / scale, c["y"] / scale) for c in cs]

    made = 0
    for group, is_area in ((area_cs, True), (spot_cs, False)):
        if not group:
            continue
        todo = [c for c in group if force or not c.get("poly")]
        for c in group:
            if is_area:
                c["area"] = True
            else:
                c.pop("area", None)
        if not todo:
            continue
        costs = geodesic_costs(small, seeds(group))
        nearest = np.argmin(costs, axis=0)
        best = np.min(costs, axis=0)
        reachable = np.isfinite(best)
        for i, c in enumerate(group):
            if c not in todo:
                continue
            region = (nearest == i) & reachable
            if not is_area:
                region &= costs[i] <= reach
            if region.sum() < 4:
                # Seed boxed in by others: fall back to a small disc of its own floor.
                region = costs[i] <= max(reach * 0.5, 3)
            poly = region_to_poly(region, (c["x"], c["y"]), scale, SIMPLIFY_PX[is_area])
            if poly:
                c["poly"] = poly
                made += 1
                # A label point that sits in a wall or the void moves inside its polygon.
                sx, sy = int(round(c["x"])), int(round(c["y"]))
                if not (0 <= sx < mask.shape[1] and 0 <= sy < mask.shape[0] and mask[sy, sx]):
                    p = Polygon(list(zip(poly[0::2], poly[1::2]))).buffer(0)
                    inner = p.buffer(-5)
                    if inner.is_empty:
                        lab = polylabel(p, tolerance=1)
                    else:
                        lab = nearest_points(inner, Point(c["x"], c["y"]))[0]
                    print(f"  moved label {m['id']}/{c['name']} {c['x']},{c['y']} -> {round(lab.x)},{round(lab.y)}")
                    c["x"], c["y"] = float(round(lab.x)), float(round(lab.y))
            else:
                print(f"  ! no polygon for {m['id']}/{c['name']}")
    return made


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true", help="rebuild polygons that already exist")
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
        print(f"{m['id']}: {total} polygons generated")
    save_maps(header, maps)


if __name__ == "__main__":
    main()
