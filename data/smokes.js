// Smoke line-ups for the Smokes tab (js/smokes.js). Coordinates are radar px (0-1024), like data/maps.js.
//
// These are well-known community smokes, described in our own words and placed by hand from memory of
// common practice. None has been tested in game by us yet, so every one ships as status "unverified" and
// the app labels it "Approximate". Only set status "checked" (with checked: "YYYY-MM") after throwing the
// line-up in game and seeing it land.
//
// Fields:
//   id      unique per map, used in links (#mirage/smokes/<id>)
//   side    "t" | "ct"           site  "a" | "mid" | "b"
//   to      where it lands: callout id from data/maps.js (+ x, y, level; x, y default to the callout's)
//   from    where you throw it from: callout id + the exact spot (inside that callout's zone) + level
//   stand   how to find the spot     aim   what to put the crosshair on     lands  what it blocks
//   throw   "left" | "right" | "leftright" | "jump" | "runjump" | "walk"
//   stance  "standing" | "crouch"
//   status  "unverified" | "checked" (checked also needs checked: "YYYY-MM")
window.CALLOUT_SMOKES = {
  mirage: [
    {
      id: "window-from-t-spawn", side: "t", site: "mid", name: "Window",
      to: { callout: "sniper-s-nest", x: 450, y: 444, level: "upper" },
      from: { callout: "t-spawn", x: 905, y: 400, level: "upper" },
      stand: "Near the top of T Spawn, backed into the corner by the wall, before you walk down towards mid.",
      aim: "The tip of the antenna on the roof ahead, just left of where it meets the sky.",
      throw: "jump", stance: "standing",
      lands: "In the window, so the CT sniper there can't see top mid.",
      status: "unverified",
    },
    {
      id: "connector-from-top-mid", side: "t", site: "mid", name: "Connector",
      to: { callout: "connector", x: 515, y: 564, level: "upper" },
      from: { callout: "top-mid", x: 720, y: 505, level: "upper" },
      stand: "At the bottom of top mid, against the left-hand wall where it meets the corner.",
      aim: "The top-left corner of the building across mid, along the roof edge.",
      throw: "left", stance: "standing",
      lands: "In the mouth of Connector, cutting the CT view from there into mid.",
      status: "unverified",
    },
    {
      id: "catwalk-from-top-mid", side: "t", site: "mid", name: "Catwalk",
      to: { callout: "catwalk", x: 461, y: 367, level: "upper" },
      from: { callout: "top-mid", x: 705, y: 440, level: "upper" },
      stand: "At top mid, tucked against the wall on the right, just past the boxes.",
      aim: "The right-hand edge of the tall building on the far side of mid, about a third of the way down from the top.",
      throw: "left", stance: "standing",
      lands: "On Catwalk (B Short), so CTs there can't watch you cross mid.",
      status: "unverified",
    },
    {
      id: "ct-from-t-roof", side: "t", site: "a", name: "CT",
      to: { callout: "ct", x: 495, y: 828, level: "upper" },
      from: { callout: "t-roof", x: 775, y: 660, level: "upper" },
      stand: "On the T side of the A ramp area, in the corner where the wall turns.",
      aim: "The top edge of the tower above the site, just right of its corner.",
      throw: "jump", stance: "standing",
      lands: "In the CT entrance to A, so rotators from CT can't see the site.",
      status: "unverified",
    },
    {
      id: "jungle-from-t-roof", side: "t", site: "a", name: "Jungle",
      to: { callout: "jungle", x: 505, y: 628, level: "upper" },
      from: { callout: "t-roof", x: 790, y: 610, level: "upper" },
      stand: "Against the wall on the T side of the A ramp area, a step back from the corner.",
      aim: "The top-left corner of the roof ahead, where it meets the sky.",
      throw: "jump", stance: "standing",
      lands: "In Jungle, so the CT there can't see the site or ramp.",
      status: "unverified",
    },
    {
      id: "stairs-from-t-roof", side: "t", site: "a", name: "Stairs",
      to: { callout: "stairs", x: 528, y: 645, level: "upper" },
      from: { callout: "t-roof", x: 780, y: 580, level: "upper" },
      stand: "At the far end of the T side of the A ramp area, against the back wall.",
      aim: "A dark notch on the roof line ahead, slightly right of the middle.",
      throw: "left", stance: "standing",
      lands: "On Stairs, cutting the view from there to the site.",
      status: "unverified",
    },
    {
      id: "market-window-from-apps", side: "t", site: "b", name: "Market Window",
      to: { callout: "window-market", x: 249, y: 419, level: "upper" },
      from: { callout: "b-apartments", x: 395, y: 185, level: "upper" },
      stand: "In B Apartments, against the far wall near the window that looks out over the site.",
      aim: "The top edge of the window frame in front of you, near its left corner.",
      throw: "left", stance: "standing",
      lands: "In the Market window, so CTs inside Market can't watch B.",
      status: "unverified",
    },
    {
      id: "market-door-from-apps", side: "t", site: "b", name: "Market Door",
      to: { callout: "door", x: 317, y: 383, level: "upper" },
      from: { callout: "b-apartments", x: 360, y: 200, level: "upper" },
      stand: "In B Apartments, just inside the room before the exit, against the left wall.",
      aim: "The right-hand corner of the archway ahead, where the light starts.",
      throw: "leftright", stance: "standing",
      lands: "On the Market door, so CTs can't come through or watch from it.",
      status: "unverified",
    },
    {
      id: "top-mid-from-connector", side: "ct", site: "mid", name: "Top Mid",
      to: { callout: "top-mid", x: 698, y: 461, level: "upper" },
      from: { callout: "connector", x: 500, y: 575, level: "upper" },
      stand: "In Connector, close to the mid end, against the wall on the right.",
      aim: "The top of the far wall at the end of mid, slightly left of centre.",
      throw: "left", stance: "standing",
      lands: "At top mid, so Ts can't take mid control for free.",
      status: "unverified",
    },
    {
      id: "a-ramp-from-jungle", side: "ct", site: "a", name: "A Ramp",
      to: { callout: "a-ramp", x: 649, y: 656, level: "upper" },
      from: { callout: "jungle", x: 480, y: 640, level: "upper" },
      stand: "In Jungle, with your back to the wall on the CT side.",
      aim: "The top edge of the building past the site, right above the ramp.",
      throw: "leftright", stance: "standing",
      lands: "On the top of A Ramp, so Ts there can't see onto the site.",
      status: "unverified",
    },
    {
      id: "apps-exit-from-market", side: "ct", site: "b", name: "B Apartments exit",
      to: { callout: "b-plat", x: 284, y: 228, level: "upper" },
      from: { callout: "market", x: 270, y: 450, level: "upper" },
      stand: "In Market, near the door out to B, against the wall on the right.",
      aim: "The top edge of the balcony opposite, near its right end.",
      throw: "left", stance: "standing",
      lands: "Where Apartments come out onto B, so Ts there can't see the site.",
      status: "unverified",
    },
  ],
};
