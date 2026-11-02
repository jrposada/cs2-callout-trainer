# CS2 Callout Trainer

Learn Counter-Strike 2 map callouts on clean, label-free radars, then drill them until they stick.

**Maps:** Mirage, Dust II, Inferno, Nuke, Ancient, Anubis, Overpass, Train, Vertigo, Cache (463 callouts).
Cobblestone is not included because it is not in CS2, so there is no CS2 radar for it.

## Modes

- **Explore** – every callout is a zone on the radar. Hover or tap a zone, or search the list, to see its name, other names and what it is. Toggle all names on or off.
- **Find it** – you get a name and click anywhere inside its zone. On a miss you see how many metres outside it you were and which zone you clicked.
- **Name it** – a zone lights up on the radar; pick its name from four nearby callouts (keys `1`–`4`).
- **Edit** – select a zone, drag inside it to move it, drag a corner to resize it, or drag the round handle to move its name. Rectangles stay rectangles; **Add corner** (or a double-click on an edge) turns one into a free shape for the rare zone that needs it, and **Make rectangle** turns it back. Then copy or download that map's data.

Zones are rectangles by default and don't need to cover the whole map. They are layered: **areas** (rooms, corridors, site zones) never overlap each other, and **spots** (boxes, corners, small positions) sit on top. Clicking a spot that lies inside an area counts for both: Default on A Site is a correct answer for *A Site* and for *Default*.

Rounds are 10, 20 or every callout on the map. Callouts you miss come up more often, and a callout counts as learned after three correct answers in a row. Progress and edits are stored in the browser (localStorage). Two-level maps (Nuke, Vertigo) switch levels automatically during quizzes.

Links are shareable: `#mirage/find`, `#nuke/explore`, and so on.

## Live mode

The **Live** tab is for a second screen during a match. Hit **Start** (or `Space`) when freeze time ends and dots run from each spawn along the fastest routes to the early peek spots in real time, with a round clock and a list of arrival times. Filter by side, pick a weapon to rescale the times, or slow playback down to study (`R` resets). Links work too: `#mirage/live`.

## Where the data comes from

- **Radar images** are the official CS2 radars, taken from the game files as published by [awpy-data](https://github.com/pnxenopoulos/awpy-data) (release 2000935). They contain no text, so nothing had to be painted out.
- **Callout names** follow the list at [totalcsgo.com/callouts](https://totalcsgo.com/callouts). The descriptions in this app are written fresh.
- **Positions** were placed by hand on the radars, so some are approximate. Dust II has had a review pass against several callout guides.
- **Zones** were generated from the radar by `tools/make_polygons.py` (see below), so their edges are a starting point. Fix them in Edit mode.

Counter-Strike and its map radars belong to Valve. This project is not affiliated with Valve or Total CS.

## Fixing a zone

1. Open the map in **Edit**, click the zone, and drag its points (or its name handle) where they belong.
2. Click **Copy map data** (or **Download**).
3. In `data/maps.js`, replace that map's `"callouts": [ ... ]` block with what you copied, and commit.

## Regenerating zones

`tools/make_polygons.py` grows a rectangle from each callout's name while the new edge is mostly floor, until it hits a wall, a neighbour or a size cap (about 1100 game units for areas listed in `tools/areas.json`, 230 for spots). By default it only fills in callouts that have no zone yet, so hand edits survive.

```sh
pip install numpy pillow scipy
python3 tools/make_polygons.py                 # only callouts without a zone
python3 tools/make_polygons.py --map dust2 --force   # rebuild one map from scratch
```

## Regenerating routes

`tools/make_routes.py` builds `data/routes.js`, the fastest runs from each spawn to the common early-round spots. Spawns and targets are listed in `tools/routes.json`. Paths are shortest paths on the radar floor (kept a little off the walls), and times assume knife speed (250 units/s). Where the radar is wrong, `routes.json` can force "via" points or patch the floor.

```sh
python3 tools/make_routes.py                    # all maps
python3 tools/make_routes.py --map mirage --png /tmp   # one map, plus an overlay image to check it
```

## Run locally

It is a static site with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Opening `index.html` directly from disk also works.

## Deploy on GitHub Pages

Settings → Pages → Build and deployment → Source: **Deploy from a branch**, Branch: `main`, folder `/ (root)`. The site will be at `https://<user>.github.io/cs2-callout-trainer/`.

## Files

```
index.html          page shell
css/style.css       styles
js/app.js           the app (no dependencies)
data/maps.js        maps, callouts, name positions and zones (radar pixel space, 0–1024)
data/routes.js      spawn-to-spot routes for Live mode (generated by tools/make_routes.py)
tools/              zone generator and the list of area callouts
img/radars/*.webp   clean CS2 radars
```
