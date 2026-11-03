// Smoke line-ups for the Smokes tab (js/smokes.js). Coordinates are radar px (0-1024), like data/maps.js.
//
// Line-ups are sourced from csnades.gg, which hosts the video and screenshots for each one. We link to it
// and copy nothing from it: no images, no setpos, no text. Stand, aim and lands are written in our own
// words, and both positions are placed by hand on our radar.
// A source link makes a line-up sourced, not checked: it stays status "unverified" (the app labels it
// "Approximate") until someone throws it in game. Only then set status "checked" (with checked: "YYYY-MM").
//
// Fields:
//   id      unique per map, used in links (#mirage/smokes/explore/<id>); renaming one breaks old links
//   side    "t" | "ct"           site  "a" | "mid" | "b"
//   to      where it lands: callout id from data/maps.js (+ x, y, level; x, y default to the callout's).
//           level may differ from the callout's when the smoke sits at a stair top (Nuke Secret).
//   from    where you throw it from: callout id + the exact spot (inside that callout's zone) + level.
//           tools/check_smokes.mjs checks both spots against the zones.
//   stand   how to find the spot     aim   what to put the crosshair on     lands  what it blocks
//   technique  how to throw it, one value per facet:
//              click "left" | "right" | "both" (left and right together)
//              move  "stand" | "walk" | "run"     jump  true | false     crouch  true | false
//   precision  optional, how exact the aim has to be: "precise" | "loose"
//   source  optional for now: { name: "csnades.gg", url: "https://csnades.gg/<map>/smokes/<slug>" }
//           <map> is the map id here (they match the csnades slugs); the card links to it for the video
//   status "unverified" | "checked" (checked also needs checked: "YYYY-MM")
//   shots   optional screenshots, taken in game by a contributor (see README, "Adding line-up screenshots"):
//           { stand: true | "path", aim: true | "path", aimAt: [x, y] }
//           true means the usual file, img/smokes/<map>/<id>-stand.webp or -aim.webp. aimAt is where the
//           crosshair sits in the aim shot, as fractions of its width and height (default [0.5, 0.5]).
//           Leave shots out until the files exist; the card then shows "Screenshot needed".
window.CALLOUT_SMOKES = {
  mirage: [
    {
      id: "window-from-t-spawn", side: "t", site: "mid", name: "Window",
      to: { callout: "sniper-s-nest", x: 452, y: 446, level: "upper" },
      from: { callout: "t-spawn", x: 896, y: 398, level: "upper" },
      stand: "In T Spawn, before the path heads down to Mid.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "walk", jump: true, crouch: true },
      precision: "precise",
      lands: "In Sniper's Nest, so the CT there can't watch Top Mid.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/mid-window-from-t-spawn-a" },
      status: "unverified",
    },
    {
      id: "connector-from-apps-ramp", side: "t", site: "mid", name: "Connector",
      to: { callout: "connector", x: 515, y: 546, level: "upper" },
      from: { callout: "apps-ramp", x: 860, y: 244, level: "upper" },
      stand: "On Apps Ramp, on the T Spawn side.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "In the Mid end of Connector, so CTs there can't see Mid.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/bottom-connector-from-apts-ramp" },
      status: "unverified",
    },
    {
      id: "catwalk-from-top-mid", side: "t", site: "mid", name: "Catwalk",
      to: { callout: "catwalk", x: 470, y: 380, level: "upper" },
      from: { callout: "top-mid", x: 705, y: 440, level: "upper" },
      stand: "At Top Mid, on the right by Mid Boxes.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: false, crouch: false },
      precision: "loose",
      lands: "On Catwalk, so CTs on B Short can't watch Mid.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/catwalk-from-top-mid" },
      status: "unverified",
    },
    {
      id: "jungle-from-t-roof", side: "t", site: "a", name: "Jungle",
      to: { callout: "jungle", x: 500, y: 604, level: "upper" },
      from: { callout: "t-roof", x: 768, y: 650, level: "upper" },
      stand: "On T Roof, against the wall above A Ramp.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: false, crouch: false },
      precision: "precise",
      lands: "Where Jungle meets Connector, so CTs there can't see A Ramp or the site.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/jungle-and-connector-from-t-roof-a" },
      status: "unverified",
    },
    {
      id: "stairs-from-t-roof", side: "t", site: "a", name: "Stairs",
      to: { callout: "stairs", x: 530, y: 648, level: "upper" },
      from: { callout: "t-roof", x: 770, y: 600, level: "upper" },
      stand: "On T Roof, further back along the wall.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "both", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "On Stairs, so the CT there can't see Tetris or A Ramp.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/stairs-from-t-roof" },
      status: "unverified",
    },
    {
      id: "ticket-booth-from-a-ramp", side: "t", site: "a", name: "Ticket Booth",
      to: { callout: "ticket-booth", x: 440, y: 808, level: "upper" },
      from: { callout: "a-ramp", x: 678, y: 650, level: "upper" },
      stand: "At the T end of A Ramp, before the arch.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "On Ticket Booth, cutting the view from there and from CT onto the site.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/top-of-ticket-booth-from-a-ramp" },
      status: "unverified",
    },
    {
      id: "market-window-from-back-alley", side: "t", site: "b", name: "Market Window",
      to: { callout: "window-market", x: 250, y: 418, level: "upper" },
      from: { callout: "back-alley", x: 565, y: 176, level: "upper" },
      stand: "In Back Alley, toward the Apartments end.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "In the Market window, so CTs in Market can't watch B.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/market-window-from-back-alley" },
      status: "unverified",
    },
    {
      id: "market-door-from-back-alley", side: "t", site: "b", name: "Market Door",
      to: { callout: "door", x: 318, y: 384, level: "upper" },
      from: { callout: "back-alley", x: 578, y: 180, level: "upper" },
      stand: "In Back Alley, toward the Apartments end.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "On the Market door, so CTs can't come out or watch B from it.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/market-door-from-back-alley" },
      status: "unverified",
    },
    {
      id: "arches-from-back-alley", side: "t", site: "b", name: "Arches",
      to: { callout: "arches", x: 338, y: 300, level: "upper" },
      from: { callout: "back-alley", x: 600, y: 175, level: "upper" },
      stand: "In Back Alley.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: false, crouch: false },
      precision: "precise",
      lands: "In Arches, so CTs coming from B Short can't see the site.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/right-arch-from-back-alley" },
      status: "unverified",
    },
    {
      id: "palace-from-ct-spawn", side: "ct", site: "a", name: "Palace",
      to: { callout: "palace", x: 712, y: 752, level: "upper" },
      from: { callout: "ct-spawn", x: 342, y: 712, level: "upper" },
      stand: "In CT Spawn, near the way out to A.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "At the Palace exit onto A, so Ts can't push out of Palace.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/palace-from-ct-spawn" },
      status: "unverified",
    },
    {
      id: "a-ramp-from-ct-spawn", side: "ct", site: "a", name: "A Ramp",
      to: { callout: "a-ramp", x: 622, y: 660, level: "upper" },
      from: { callout: "ct-spawn", x: 338, y: 730, level: "upper" },
      stand: "In CT Spawn, near the way out to A.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "stand", jump: true, crouch: false },
      precision: "precise",
      lands: "On A Ramp, so Ts coming down can't see the site.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/a-ramp-from-ct-spawn" },
      status: "unverified",
    },
    {
      id: "apps-exit-from-market", side: "ct", site: "b", name: "B Plat",
      to: { callout: "b-plat", x: 285, y: 218, level: "upper" },
      from: { callout: "market", x: 275, y: 440, level: "upper" },
      stand: "In Market, near the door out to B.",
      aim: "Exact crosshair spot: see the csnades.gg screenshot.",
      technique: { click: "left", move: "run", jump: true, crouch: false },
      precision: "precise",
      lands: "On B Plat, so Ts coming out of Apartments can't see the site.",
      source: { name: "csnades.gg", url: "https://csnades.gg/mirage/smokes/apts-from-market" },
      status: "unverified",
    },
  ],
};
