#!/usr/bin/env python3
"""Build data/routes.js: the fastest runs from each spawn to the early-round spots.

How it works
  * The walkable floor of each radar level comes from its alpha channel, the
    same way tools/make_polygons.py builds it. tools/routes.json can paint
    extra floor ("open") or walls ("block") as rectangles where the radar is wrong.
  * Shortest paths are found with Dijkstra on that mask (8-connected, no
    corner cutting). Each step costs a little more close to walls (a
    distance-transform penalty), so paths keep off the walls the way players do.
  * The pixel path is simplified with Ramer-Douglas-Peucker, but a simplified
    segment is only kept if it stays on floor, so it never cuts a corner.
  * Length is measured on the simplified line and turned into game units with
    the map's "scale" (units per radar px); time = units / SPEED.
  * A route can pass "via" points, e.g. to take a drop or a door the mask gets
    wrong. A via point on another level ([x, y, "lower"]) switches level there
    (stairs, ladders); such routes also get "segments", one per level.

tools/routes.json holds the spawns and targets. Run:
  python3 tools/make_routes.py                 # all maps
  python3 tools/make_routes.py --map mirage    # one map (others are kept)
  python3 tools/make_routes.py --png DIR       # also draw an overlay per map

Needs: pip install numpy pillow scipy
"""
import argparse
import json
import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, sparse
from scipy.sparse import csgraph

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from make_polygons import ROOT, floor_mask, load_maps, snap  # noqa: E402

SPEC = ROOT / "tools" / "routes.json"
OUT = ROOT / "data" / "routes.js"

SPEED = 250            # game units / second (knife)
CLEAR_UNITS = 40       # walls closer than this (game units) make a step dearer
WALL_PENALTY = 1.5     # extra cost per px right next to a wall
RDP_EPS = 2.5          # simplification tolerance, radar px


class Level:
    """Floor mask of one radar level plus a Dijkstra-ready graph."""

    def __init__(self, m, level, edits):
        mask = floor_mask(ROOT / m["radar"][level], level)
        if edits.get("wall_contrast"):
            # Radars whose walls are thin grey lines on the floor, not holes in it:
            # a pixel much darker than the brightest one next to it is a wall.
            a = np.asarray(Image.open(ROOT / m["radar"][level]).convert("RGB"), dtype=np.float32)
            lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
            mask &= lum > ndimage.maximum_filter(lum, size=5) - edits["wall_contrast"]
        for x0, y0, x1, y1 in edits.get("open", []):
            mask[y0:y1, x0:x1] = True
        for x0, y0, x1, y1 in edits.get("block", []):
            mask[y0:y1, x0:x1] = False
        # Drop small islands (inside boxes, roofs) so points snap onto the real floor.
        lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
        if n > 1:
            sizes = ndimage.sum(mask, lab, range(1, n + 1))
            mask = np.isin(lab, 1 + np.nonzero(sizes >= 0.1 * sizes.max())[0])
        self.mask = mask
        H, W = mask.shape
        clear = CLEAR_UNITS / m["scale"]
        dt = ndimage.distance_transform_edt(mask)
        cost = 1 + WALL_PENALTY * np.clip((clear - dt) / clear, 0, 1)
        idx = np.full(mask.shape, -1, dtype=np.int64)
        rr, cc = np.nonzero(mask)
        idx[rr, cc] = np.arange(len(rr))
        self.idx, self.rr, self.cc = idx, rr, cc
        rows, cols, w = [], [], []
        for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
            r2, c2 = rr + dr, cc + dc
            ok = (r2 < H) & (c2 >= 0) & (c2 < W)
            r1, c1, r2, c2 = rr[ok], cc[ok], r2[ok], c2[ok]
            ok = mask[r2, c2]
            if dr and dc:   # diagonal: both side pixels must be floor
                ok &= mask[r1, c2] & mask[r2, c1]
            r1, c1, r2, c2 = r1[ok], c1[ok], r2[ok], c2[ok]
            step = math.hypot(dr, dc)
            rows.append(idx[r1, c1]); cols.append(idx[r2, c2])
            w.append(step * (cost[r1, c1] + cost[r2, c2]) / 2)
        rows, cols, w = map(np.concatenate, (rows, cols, w))
        n = len(rr)
        self.graph = sparse.csr_matrix((w, (rows, cols)), shape=(n, n))
        self.cache = {}

    def node(self, x, y):
        cx, cy = snap(self.mask, x, y)
        return int(self.idx[cy, cx])

    def path(self, a, b):
        """Pixel path [(x, y), ...] from point a to point b, or None."""
        s, t = self.node(*a), self.node(*b)
        if s not in self.cache:
            self.cache[s] = csgraph.dijkstra(self.graph, directed=False, indices=s,
                                             return_predecessors=True)[1]
        pred = self.cache[s]
        if t != s and pred[t] < 0:
            return None
        out = [t]
        while out[-1] != s:
            out.append(pred[out[-1]])
        return [(int(self.cc[i]), int(self.rr[i])) for i in reversed(out)]

    def clear_line(self, a, b):
        n = max(2, int(math.hypot(b[0] - a[0], b[1] - a[1]) * 2) + 1)
        xs = np.rint(np.linspace(a[0], b[0], n)).astype(int)
        ys = np.rint(np.linspace(a[1], b[1], n)).astype(int)
        return bool(self.mask[ys, xs].all())


def rdp(pts, eps, lv):
    """Ramer-Douglas-Peucker that only keeps segments lying on floor."""
    if len(pts) < 3:
        return list(pts)
    a, b = np.array(pts[0], float), np.array(pts[-1], float)
    p = np.array(pts[1:-1], float)
    d = b - a
    L = math.hypot(*d)
    if L == 0:
        dev = np.hypot(*(p - a).T)
    else:
        dev = np.abs(d[0] * (p[:, 1] - a[1]) - d[1] * (p[:, 0] - a[0])) / L
    i = int(dev.argmax())
    if dev[i] <= eps and lv.clear_line(pts[0], pts[-1]):
        return [pts[0], pts[-1]]
    if dev[i] <= eps:
        i = len(p) // 2
    k = i + 1
    return rdp(pts[: k + 1], eps, lv)[:-1] + rdp(pts[k:], eps, lv)


def plen(pts):
    return sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))


def build_map(m, spec, report):
    callouts = {c["id"]: c for c in m["callouts"]}
    edits = spec.get("mask", {})
    levels = {lv: Level(m, lv, edits.get(lv, {})) for lv in m["levels"]}
    spawns = spec["spawns"]
    routes = []
    for side in ("T", "CT"):
        sp = spawns[side]
        for t in spec["targets"][side]:
            t = {"to": t} if isinstance(t, str) else t
            c = callouts[t["to"]]
            tlevel = c.get("level", "upper")
            pts = [(sp["x"], sp["y"], sp.get("level", "upper"))]
            for v in t.get("via", []):
                pts.append((v[0], v[1], v[2] if len(v) > 2 else pts[-1][2]))
            pts.append((c["x"], c["y"], tlevel))
            if pts[-2][2] != tlevel:
                report.append(f"{m['id']}: skipped {side} -> {t['to']} (other level, no connector)")
                continue
            segs, ok = [], True
            for (ax, ay, al), (bx, by, bl) in zip(pts, pts[1:]):
                if al != bl:            # level change: start a new segment at b
                    segs.append([bl, []])
                    continue
                p = levels[al].path((ax, ay), (bx, by))
                if p is None:
                    ok = False
                    break
                if not segs or segs[-1][0] != al:
                    segs.append([al, []])
                segs[-1][1].extend(p if not segs[-1][1] else p[1:])
            if not ok:
                report.append(f"{m['id']}: no path {side} -> {t['to']}")
                continue
            segs = [(lv, rdp(p, RDP_EPS, levels[lv])) for lv, p in segs if p]
            units = sum(plen(p) for _, p in segs) * m["scale"]
            r = {"id": f"{side.lower()}-{t['to']}", "side": side, "to": t["to"], "level": tlevel,
                 "path": [v for xy in segs[-1][1] for v in xy],
                 "units": int(round(units)), "time": round(units / SPEED, 1)}
            if len(segs) > 1:
                r["segments"] = [{"level": lv, "path": [v for xy in p for v in xy]} for lv, p in segs]
            routes.append(r)
    out = {"speed": SPEED,
           "spawns": {s: {"x": v["x"], "y": v["y"], "level": v.get("level", "upper")} for s, v in spawns.items()},
           "routes": routes}
    return out, levels


def fmt(maps):
    lines = ["// Generated by tools/make_routes.py — do not edit by hand.", "window.CALLOUT_ROUTES = {"]
    blocks = []
    for mid, m in maps.items():
        s = f"  {json.dumps(mid)}: {{\n    \"speed\": {m['speed']},\n"
        s += f"    \"spawns\": {json.dumps(m['spawns'], separators=(', ', ': '))},\n"
        s += "    \"routes\": [\n" + ",\n".join(
            "      " + json.dumps(r, separators=(", ", ": ")) for r in m["routes"]) + "\n    ]\n  }"
        blocks.append(s)
    return "\n".join(lines) + "\n" + ",\n".join(blocks) + "\n};\n"


def load_routes():
    if not OUT.exists():
        return {}
    text = OUT.read_text()
    return json.loads(text[text.index("{", text.index("CALLOUT_ROUTES")): text.rstrip().rindex("}") + 1])


COLORS = {"T": (255, 170, 40), "CT": (80, 170, 255)}


def draw(m, data, levels, png_dir, show_mask):
    tiles = []
    for lv in m["levels"]:
        img = Image.open(ROOT / m["radar"][lv]).convert("RGBA")
        bg = Image.new("RGBA", img.size, (20, 20, 24, 255))
        if show_mask:
            tint = np.zeros((*levels[lv].mask.shape, 4), np.uint8)
            tint[levels[lv].mask] = (0, 255, 0, 50)
            img = Image.alpha_composite(img, Image.fromarray(tint))
        img = Image.alpha_composite(bg, img)
        d = ImageDraw.Draw(img)
        for r in data["routes"]:
            col = COLORS[r["side"]]
            segs = r.get("segments") or [{"level": r["level"], "path": r["path"]}]
            for s in segs:
                if s["level"] != lv:
                    continue
                p = s["path"]
                xy = list(zip(p[::2], p[1::2]))
                d.line(xy, fill=col + (255,), width=2)
                for q in xy:
                    d.ellipse([q[0] - 1, q[1] - 1, q[0] + 1, q[1] + 1], fill=(255, 255, 255, 255))
            if r["level"] == lv:
                x, y = r["path"][-2], r["path"][-1]
                d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col + (255,))
                label = f"{r['to']} {r['time']}s"
                d.text((x + 5, y - 6), label, fill=(0, 0, 0, 255), stroke_width=2, stroke_fill=(0, 0, 0, 255))
                d.text((x + 5, y - 6), label, fill=col + (255,))
        for side, sp in data["spawns"].items():
            if sp["level"] == lv:
                d.rectangle([sp["x"] - 5, sp["y"] - 5, sp["x"] + 5, sp["y"] + 5], outline=(255, 255, 255, 255), width=2)
        tiles.append(img)
    out = Image.new("RGBA", (1024 * len(tiles), 1024))
    for i, t in enumerate(tiles):
        out.paste(t, (1024 * i, 0))
    path = pathlib.Path(png_dir) / f"routes_{m['id']}.png"
    out.convert("RGB").save(path)
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--map", help="only this map id, e.g. mirage")
    ap.add_argument("--png", help="write an overlay image per map into this folder")
    ap.add_argument("--mask", action="store_true", help="tint the walkable mask in the overlay")
    args = ap.parse_args()
    _, maps = load_maps()
    spec = json.loads(SPEC.read_text())
    done = load_routes() if args.map else {}
    report = []
    for m in maps:
        if args.map and m["id"] != args.map:
            continue
        if m["id"] not in spec:
            report.append(f"{m['id']}: not in routes.json")
            continue
        data, levels = build_map(m, spec[m["id"]], report)
        done[m["id"]] = data
        times = ", ".join(f"{r['id']} {r['time']}" for r in data["routes"])
        print(f"{m['id']}: {len(data['routes'])} routes  ({times})")
        if args.png:
            print("   ", draw(m, data, levels, args.png, args.mask))
    order = [m["id"] for m in maps]
    done = {k: done[k] for k in sorted(done, key=lambda k: order.index(k) if k in order else 99)}
    OUT.write_text(fmt(done))
    for line in report:
        print("  !", line)


if __name__ == "__main__":
    main()
