# CS2 Callout Trainer

Learn Counter-Strike 2 map callouts on clean, label-free radars, then drill them until they stick.

**Maps:** Mirage, Dust II, Inferno, Nuke, Ancient, Anubis, Overpass, Train, Vertigo, Cache (463 callouts).
Cobblestone is not included because it is not in CS2, so there is no CS2 radar for it.

## Modes

- **Explore** – every callout is a zone on the radar. Hover or tap a zone, or search the list, to see its name, other names and what it is. Toggle all names on or off; names that would overlap stay hidden until you zoom in, and the selected or hovered name always shows.
- **Name it** – a zone lights up on the radar; pick its name from four nearby callouts (keys `1`–`4`). The easier drill, so it comes before Find it.
- **Find it** – you get a name and click anywhere inside its zone. A click just outside the edge is a **Close** and still counts as correct, and clicking a zone that goes by one of the target's other names (B Short for Catwalk on Mirage) is a hit. Otherwise you see how many metres outside it you were and which zone you clicked, outlined on the radar.
- **Edit** – select a zone, drag inside it to move it, drag a corner to resize it, or drag the round handle above its label to move its name. Rectangles stay rectangles; **Add corner** (or a double-click on an edge) turns one into a free shape for the rare zone that needs it, and **Make rectangle** turns it back. **Undo** (or Ctrl/Cmd+Z) steps back through this session's edits, including a whole-map Discard. The Edit tab shows "Edit · N" when the current map has local edits. Then copy or download that map's data.

Zones are rectangles by default and don't need to cover the whole map. They are layered: **areas** (rooms, corridors, site zones) never overlap each other, and **spots** (boxes, corners, small positions) sit on top. Clicking a spot that lies inside an area counts for both: Default on A Site is a correct answer for *A Site* and for *Default*.

Rounds are 10, 20 or every callout on the map. Callouts you missed last time come back first (up to 40% of a round, most-missed first), the rest of the round favours weak callouts over new ones, and a callout counts as learned after three correct answers in a row.

Find it and Name it keep **separate progress**, so picking a name from four options never marks a callout as learned for finding it on the map. Each mode's setup shows how many callouts on the map are learned, still being learned and new in that mode, with a link to reset the map's progress (both modes). The Explore card and list show both modes; the map buttons show Find it progress. Progress saved by older versions counts as Find it progress.

A callout you miss for the first time in a round is **asked again** three or four questions later, marked "Again:". The re-ask scores like any answer, and the round grows by one question.

At the end of a round the **summary shows every missed callout on the radar** with its name (and, in Find it, where you clicked). Click a callout in the list to centre and highlight its zone, switching level if needed. A line such as "Mirage: 9 → 12 learned in Find it (+3)" shows what the round changed.

Progress and edits are stored in the browser (localStorage). Two-level maps (Nuke, Vertigo) switch levels automatically during quizzes.

Links are shareable: `#mirage/find`, `#nuke/explore`, and so on.

## Live mode

The **Live** tab is for a second screen during a match. Hit **Start** (or `Space`) when freeze time ends and dots run from each spawn along the fastest routes to the early peek spots in real time, with a round clock and a list of arrival times. Filter by side, pick a weapon to rescale the times, or slow playback down to study (`R` resets). Links work too: `#mirage/live`.

## Smoke line-ups

The **Smokes** tab shows where to stand to throw well-known smokes, and how to throw them, on the same radar. Mirage has 11 line-ups so far; other maps show an empty state with a link to Mirage.

- Every landing spot is a circle about the size of a smoke. Tap one to see the spots it is thrown from, with an arc for each throw; tap a throw spot (or a name in the list) for its card: where to **stand**, what to **aim** at, the **throw** (left click, jump-throw and so on, plus standing or crouching) and what it **blocks**. The view zooms to fit the throw and the landing.
- Filter by side (`T`, `C`, `B` for both; remembered) and by target (A, Mid, B; pick any mix).
- `[` and `]` step through the list, `Esc` (or a tap on empty radar) goes back one step, `+` `−` `0` zoom.
- Links open a line-up directly: `#mirage/smokes/ct-from-t-roof`.
- **Drill** (the Browse | Drill switch at the top) asks "Where do you stand to smoke Window?" with the landing spot lit up. Click your throw spot: within about 2.5 m (100 units) is a **Hit**, within about 5 m is **Close**, and only a Hit counts. The reveal shows the real spot, both rings, your click and where to stand. Then a bonus question, **Which throw?** (keys `1`–`6`), which never touches your streak, and the aim. `Enter` goes on. Rounds are up to 8 line-ups on the chosen side, new and still-learning ones first.
- The summary shows your score, how many throws you got right, and every missed line-up on the radar; click one to open it in Browse. A line-up counts as learned after three Hits in a row. Drill progress is saved in its own store (`cct.smokes`), and **Reset Mirage smokes** clears only that, not your callout progress.

**These line-ups are approximate.** They are well-known community smokes, described in our own words and placed by hand from memory of common practice. **We have not tested them in game**, so throw spots, aims and techniques may be off by a step or two. Every card says "Approximate, not checked in game" until someone confirms it.

If a line-up is wrong, use **This line-up is wrong?** on its card. It opens a GitHub issue with the line-up already named; say what's off and, if you can, add a clip. A line-up only becomes **Checked** through a pull request to `data/smokes.js` from someone who threw it in game: set `status: "checked"` and `checked: "YYYY-MM"`, and fix the spot or text if needed.

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
data/smokes.js      smoke line-ups for the Smokes tab (hand-written, approximate)
js/live.js          Live mode
js/smokes.js        Smokes mode
tools/              zone generator and the list of area callouts
img/radars/*.webp   clean CS2 radars
```
