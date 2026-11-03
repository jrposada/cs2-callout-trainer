# CS2 Callout Trainer

Learn Counter-Strike 2 map callouts on clean, label-free radars, then drill them until they stick.

**Maps:** Mirage, Dust II, Inferno, Nuke, Ancient, Anubis, Overpass, Train, Vertigo, Cache (463 callouts).
Cobblestone is not included because it is not in CS2, so there is no CS2 radar for it.

## Modes

The panel has two rows. The top one picks what you learn, **Callouts** or **Smokes** (see [Smoke line-ups](#smoke-line-ups)), and holds the **Live** button. The row under it picks how: **Explore**, **Name it** or **Find it**. The mode stays when you switch between Callouts and Smokes. Arrow keys move along a row and `Enter` or `Space` switches.

- **Explore** – every callout is a zone on the radar. Hover or tap a zone, or search the list, to see its name, other names and what it is. Toggle all names on or off; names that would overlap stay hidden until you zoom in, and the selected or hovered name always shows.
- **Name it** – a zone lights up on the radar; pick its name from four nearby callouts (keys `1`–`4`). The easier drill, so it comes before Find it.
- **Find it** – you get a name and click anywhere inside its zone. A click just outside the edge is a **Close** and still counts as correct, and clicking a zone that goes by one of the target's other names (B Short for Catwalk on Mirage) is a hit. Otherwise you see how many metres outside it you were and which zone you clicked, outlined on the radar.
- **Edit zones** – the **Edit zones** link in the panel footer (shows `· N` with local edits) opens the zone editor; **Done** goes back. Select a zone, drag inside it to move it, drag a corner to resize it, or drag the round handle above its label to move its name. Rectangles stay rectangles; **Add corner** (or a double-click on an edge) turns one into a free shape for the rare zone that needs it, and **Make rectangle** turns it back. **Undo** (or Ctrl/Cmd+Z) steps back through this session's edits, including a whole-map Discard. Then copy or download that map's data.

Zones are rectangles by default and don't need to cover the whole map. They are layered: **areas** (rooms, corridors, site zones) never overlap each other, and **spots** (boxes, corners, small positions) sit on top. Clicking a spot that lies inside an area counts for both: Default on A Site is a correct answer for *A Site* and for *Default*.

Rounds are 10, 20 or every callout on the map. Callouts you missed last time come back first (up to 40% of a round, most-missed first), the rest of the round favours weak callouts over new ones, and a callout counts as learned after three correct answers in a row.

Find it and Name it keep **separate progress**, so picking a name from four options never marks a callout as learned for finding it on the map. Each mode's setup shows how many callouts on the map are learned, still being learned and new in that mode, with a link to reset the map's progress (both modes). The Explore card and list show both modes; the map buttons show Find it progress. Progress saved by older versions counts as Find it progress.

A callout you miss for the first time in a round is **asked again** three or four questions later, marked "Again:". The re-ask scores like any answer, and the round grows by one question.

At the end of a round the **summary shows every missed callout on the radar** with its name (and, in Find it, where you clicked). Click a callout in the list to centre and highlight its zone, switching level if needed. A line such as "Mirage: 9 → 12 learned in Find it (+3)" shows what the round changed.

Progress and edits are stored in the browser (localStorage). Two-level maps (Nuke, Vertigo) switch levels automatically during quizzes.

Links are shareable: `#mirage/find`, `#nuke/explore`, `#mirage/smokes/find`, and so on.

## Live mode

The **Live** button is for a second screen during a match. Hit **Start** (or `Space`) when freeze time ends and dots run from each spawn along the fastest routes to the early peek spots in real time, with a round clock and a list of arrival times. Filter by side, pick a weapon to rescale the times, or slow playback down to study (`R` resets). **Done** (or the Live button again) takes you back to where you were. Links work too: `#mirage/live`.

## Smoke line-ups

**Smokes** (top row) shows where to stand to throw well-known smokes, and how to throw them, on the same radar. Mirage has 11 line-ups so far; other maps show an empty state with a link to Mirage.

- **Explore**: every landing spot is a circle about the size of a smoke. Tap one to see the spots it is thrown from, with an arc for each throw; tap a throw spot (or a name in the list) for its card: where to **stand**, what to **aim** at, the **technique** (which mouse button, standing, walking or running, jump-throw or not, crouching or not) and what it **blocks**. Two screenshots, **Where to stand** and **Where to aim**, open full size on click (`←` `→` switch, `Esc` closes); until someone adds them the card says "Screenshot needed". The view zooms to fit the throw and the landing.
- Filter by side (`T`, `C`, `B` for both) and by target (A, Mid, B; pick any mix). Both filters are remembered and apply to Find it too.
- `[` and `]` step through the list, `Esc` (or a tap on empty radar) goes back one step, `+` `−` `0` zoom.
- Links open a line-up directly: `#mirage/smokes/explore/ct-from-t-roof`. Older links such as `#mirage/smokes/ct-from-t-roof` still work.
- **Find it** asks "Where do you stand to smoke Window?" with the landing spot lit up. Click your throw spot: within about 2.5 m (100 units) is a **Hit**, within about 5 m is **Close**, and only a Hit counts. The reveal shows the real spot, both rings, your click (gold for a Close, red for a miss) and where to stand. Then a bonus question, **Which throw?** (keys `1`–`6`: the right technique among common ones such as "Jump · Left" or "Stand · L+R"), which never touches your streak; **Skip** (or `Esc`) shows the answer without picking. Then the aim, with the screenshots when the line-up has them. `Enter` goes on. Rounds are up to 8 line-ups matching the side and target filters, new and still-learning ones first.
- The summary shows your score, how many throws you got right (and how many you skipped), and every missed line-up on the radar; click one to open it in Explore. A line-up counts as learned after three Hits in a row. Find it progress is saved in its own store (`cct.smokes`), and **Reset Mirage smokes** clears only that, not your callout progress.
- **Name it** for smokes is coming (the tab says "soon"): you'll see where you stand and name the smoke.

**These line-ups are approximate.** They are well-known community smokes, described in our own words and placed by hand from memory of common practice. **We have not tested them in game**, so throw spots, aims and techniques may be off by a step or two. Every card says "Approximate, not checked in game" until someone confirms it.

If a line-up is wrong, use **This line-up is wrong?** on its card. It opens a GitHub issue with the line-up already named; say what's off and, if you can, add a clip. A line-up only becomes **Checked** through a pull request to `data/smokes.js` from someone who threw it in game: set `status: "checked"` and `checked: "YYYY-MM"`, and fix the spot or text if needed.

## Adding line-up screenshots

No screenshots ship yet. Each line-up can have two, and only **screenshots you took yourself** are accepted: don't copy them from guides, videos or other sites.

1. Open the map in a private practice match (no other players), so nothing gets in the way.
2. Stand exactly on the throw spot and take the **stand** shot: look so that a recognisable landmark (a wall corner, a box, a door frame) shows where you are standing. A slightly downward view that shows the floor at your feet helps.
3. Line up the throw and take the **aim** shot with the crosshair in the middle of the screen, on the spot the card's Aim text describes.
4. Crop or scale both to **16:9, about 1280×720**, and save them as **WebP** under about **150 KB** each.
5. Name them after the line-up id and put them in `img/smokes/<map>/`:
   `img/smokes/mirage/window-from-t-spawn-stand.webp` and `img/smokes/mirage/window-from-t-spawn-aim.webp`.
6. In `data/smokes.js`, add `shots: { stand: true, aim: true }` to that line-up (`true` means the file name above; a path string also works). If the crosshair isn't centred in the aim shot, add `aimAt: [x, y]` with its position as fractions of the width and height, e.g. `[0.52, 0.47]`; the app rings that point.

A line-up without `shots` shows the "Screenshot needed" placeholder and requests no image. If a listed file is missing, the card falls back to the placeholder and the console says which file. Open a pull request with the images and the data change, and say in it that you took them.

## Where the data comes from

- **Radar images** are the official CS2 radars, taken from the game files as published by [awpy-data](https://github.com/pnxenopoulos/awpy-data) (release 2000935). They contain no text, so nothing had to be painted out.
- **Callout names** follow the list at [totalcsgo.com/callouts](https://totalcsgo.com/callouts). The descriptions in this app are written fresh.
- **Positions** were placed by hand on the radars, so some are approximate. Dust II has had a review pass against several callout guides.
- **Zones** were generated from the radar by `tools/make_polygons.py` (see below), so their edges are a starting point. Fix them with **Edit zones**.

Counter-Strike and its map radars belong to Valve. This project is not affiliated with Valve or Total CS.

## Fixing a zone

1. Open the map, click **Edit zones** in the panel footer, click the zone, and drag its points (or its name handle) where they belong.
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
data/smokes.js      smoke line-ups for Smokes (hand-written, approximate)
js/live.js          the Live tool
js/smokes.js        Smokes (Explore, Find it and the Name it placeholder)
tools/              zone generator and the list of area callouts
img/radars/*.webp   clean CS2 radars
img/smokes/<map>/   line-up screenshots (<id>-stand.webp, <id>-aim.webp)
```
