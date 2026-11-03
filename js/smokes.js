// Smokes content: well-known smoke line-ups on the radar. The app's learning mode picks the view.
// Explore filters them by side and target: pick a landing spot to see where it is thrown from, and a
// throw spot for how to throw it. Find it asks where you stand to throw a smoke (scored by distance),
// then which throw it is (a bonus, not scored). Name it is a placeholder for now.
// Each line-up can have two in-game screenshots (where to stand, where to aim), shown on its card,
// in the Find it reveal and in a lightbox.
// Line-ups come from data/smokes.js (window.CALLOUT_SMOKES). Like js/live.js, this file loads before
// js/app.js, registers itself in window.CCT_MODES, and gets the app's helpers through init(api).
(() => {
  "use strict";

  const SIDES = [["t", "T"], ["ct", "CT"], ["both", "Both"]];
  const SITES = [["a", "A"], ["mid", "Mid"], ["b", "B"]];
  const SITE_NAME = { a: "A", mid: "Mid", b: "B" };
  const SITE_HEAD = { a: "A site", mid: "Mid", b: "B site" };
  const SIDE_NAME = { t: "T", ct: "CT" };
  // How a line-up is thrown: one value per facet (`technique` in data/smokes.js).
  const CLICKS = { left: "Left click", right: "Right click", both: "Left+Right click" };
  const CLICK_SHORT = { left: "Left", right: "Right", both: "L+R" };
  const MOVES = { stand: "Standing", walk: "Walking", run: "Running" };
  const PRECISION = { precise: "Precise aim", loose: "Loose aim" };
  // Where a line-up comes from (`source` in data/smokes.js): only csnades.gg, https://csnades.gg/<map>/smokes/<slug>.
  const SOURCE_NAME = "csnades.gg";
  const SOURCE_PATH = /^\/([a-z0-9]+)\/smokes\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
  // One short name for compact places (list rows, the drill), e.g. "Jump · Left", "Run-jump · Left".
  function techLabel(t) {
    const how = t.jump
      ? (t.crouch ? "Crouch-jump" : t.move === "run" ? "Run-jump" : t.move === "walk" ? "Walk-jump" : "Jump")
      : t.crouch ? (t.move === "stand" ? "Crouch" : `Crouch-${t.move}`)
      : t.move === "run" ? "Run" : t.move === "walk" ? "Walk" : "Stand";
    return `${how} · ${CLICK_SHORT[t.click]}`;
  }
  // Throws that need movement stand out (gold border), as they are the easy ones to get wrong.
  const isMove = (t) => t.jump || t.move !== "stand";
  // Common throws the "Which throw?" bonus draws its wrong answers from.
  const TECH_POOL = [
    ["left", "stand", false, false], ["right", "stand", false, false], ["both", "stand", false, false],
    ["left", "stand", true, false], ["left", "run", true, false], ["left", "walk", false, false],
    ["left", "stand", false, true], ["right", "stand", false, true], ["left", "walk", true, false],
  ].map(([click, move, jump, crouch]) => techLabel({ click, move, jump, crouch }));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // A tiny mouse with the pressed button(s) filled.
  const mouseSvg = (click) => `<svg class="mouse" viewBox="0 0 12 16" aria-hidden="true"><rect x="0.75" y="0.75" width="10.5" height="14.5" rx="5.25"/>${
    click !== "right" ? `<path class="on" d="M6 1.5A4.5 4.5 0 0 0 1.5 6v1H6z"/>` : ""}${click !== "left" ? `<path class="on" d="M6 1.5A4.5 4.5 0 0 1 10.5 6v1H6z"/>` : ""
  }<path class="ln" d="M6 .75V7.25M.75 7.25h10.5"/></svg>`;
  const HOWTO_URL = "https://github.com/jrposada/cs2-callout-trainer#adding-line-up-screenshots";
  const SHOT_LABEL = { stand: "Where to stand", aim: "Where to aim" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const LAND_U = 144;  // a smoke's radius on the radar, in game units
  const HIT_PX = 22;   // screen px radius of every tap target (44 px across)
  const ISSUE_URL = "https://github.com/jrposada/cs2-callout-trainer/issues/new";
  // Drill tolerances, in game units from the throw spot. Only a Hit counts as correct. The throw spots are
  // approximate to a metre or two, so these stay generous until line-ups are checked in game.
  const HIT_U = 100;   // ~2.5 m
  const CLOSE_U = 200; // ~5 m
  const ROUND_MAX = 8;
  const PROGRESS_KEY = "cct.smokes"; // { [mapId]: { [lineupId]: { s, c, k } } }
  const REDUCED = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  let A = null;     // app api, from init()
  let layer = null; // <g> on the radar, owned by this mode
  const S = {
    focus: null,       // landing callout id whose throws are shown
    sel: null,         // selected line-up id
    drawnFocus: null,  // the focus whose arcs last drew in
    round: null,       // the Find it round, see startRound()
  };
  // The view follows the app's shared learning mode: "explore" | "find" | "name".
  const view = () => A.state.learn;

  // ---------- drill progress (its own key, apart from the callout progress) ----------
  let prog = (() => {
    try { const v = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  })();
  function saveProg() { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(prog)); } catch { /* private mode etc. */ } }
  const recOf = (id) => (prog[A.state.map.id] || {})[id];
  function score(id, ok) {
    const P = (prog[A.state.map.id] = prog[A.state.map.id] || {});
    const r = (P[id] = P[id] || { s: 0, c: 0, k: 0 });
    r.s += 1;
    if (ok) { r.c += 1; r.k += 1; } else r.k = 0;
    saveProg();
  }
  // "new" | "learning" | "learned"
  function stage(id) {
    const r = recOf(id);
    return !r || !r.s ? "new" : r.k >= A.MASTER_STREAK ? "learned" : "learning";
  }
  const mastery = (id) => { const r = recOf(id); return r ? Math.min(r.k, A.MASTER_STREAK) / A.MASTER_STREAK : 0; };
  function masteryText(id) {
    const r = recOf(id), st = stage(id);
    const now = st === "new" ? "not drilled yet" : st === "learned" ? "learned" : `learning, ${r.k} of ${A.MASTER_STREAK} in a row`;
    return `Find it: <span class="status">${now}.</span>${r && r.s ? ` <span class="lifetime">${r.c} of ${r.s} right overall.</span>` : ""}`;
  }

  // ---------- data ----------
  const warned = new Set();
  // Why a line-up can't be used, or "" if it can.
  function problem(r) {
    if (!r || typeof r.id !== "string" || !r.id) return "no id";
    if (!SIDE_NAME[r.side]) return `side "${r.side}"`;
    if (!SITE_NAME[r.site]) return `site "${r.site}"`;
    const t = r.technique;
    if (!t || typeof t !== "object") return "no technique";
    if (!CLICKS[t.click]) return `technique.click "${t.click}"`;
    if (!MOVES[t.move]) return `technique.move "${t.move}"`;
    if (typeof t.jump !== "boolean") return "technique.jump must be true or false";
    if (typeof t.crouch !== "boolean") return "technique.crouch must be true or false";
    const sh = r.shots;
    if (sh != null) {
      if (typeof sh !== "object") return "shots must be an object";
      for (const k of ["stand", "aim"]) if (sh[k] != null && sh[k] !== true && (typeof sh[k] !== "string" || !sh[k])) return `shots.${k} must be true or a path`;
      if (sh.aimAt != null && !(Array.isArray(sh.aimAt) && sh.aimAt.length === 2 && sh.aimAt.every((v) => Number.isFinite(v) && v >= 0 && v <= 1))) return "shots.aimAt must be [x, y] between 0 and 1";
    }
    if (r.precision != null && !PRECISION[r.precision]) return `precision "${r.precision}"`;
    const src = r.source;
    if (src != null) {
      if (typeof src !== "object") return "source must be an object";
      if (src.name !== SOURCE_NAME) return `source.name must be "${SOURCE_NAME}"`;
      let u = null;
      try { u = new URL(src.url); } catch { /* reported below */ }
      const m = u && u.protocol === "https:" && u.hostname === SOURCE_NAME && !u.port && !u.username && !u.search && !u.hash && SOURCE_PATH.exec(u.pathname);
      if (!m) return `source.url "${src.url}" must be https://${SOURCE_NAME}/<map>/smokes/<slug>`;
      if (m[1] !== A.state.map.id) return `source.url is for map "${m[1]}", not ${A.state.map.id}`;
    }
    if (r.status !== "unverified" && r.status !== "checked") return `status "${r.status}"`;
    if (r.status === "checked" && !/^\d{4}-\d{2}$/.test(r.checked || "")) return "checked needs a YYYY-MM date";
    if (!r.to || !A.callout(r.to.callout)) return `landing callout "${r.to && r.to.callout}" not on this map`;
    if (!r.from || !A.callout(r.from.callout)) return `throw callout "${r.from && r.from.callout}" not on this map`;
    return "";
  }
  function point(spec, c) {
    return { callout: c.id, name: c.name, x: Number.isFinite(spec.x) ? spec.x : c.x, y: Number.isFinite(spec.y) ? spec.y : c.y, level: spec.level || c.level || "upper" };
  }
  // Screenshot URLs (or null): true in the data means the usual file name.
  function shotsOf(r, mapId) {
    const sh = r.shots || {};
    const url = (k) => (sh[k] === true ? `img/smokes/${mapId}/${r.id}-${k}.webp` : typeof sh[k] === "string" ? sh[k] : null);
    return { stand: url("stand"), aim: url("aim"), aimAt: Array.isArray(sh.aimAt) ? sh.aimAt : [0.5, 0.5] };
  }
  function rawFor(mapId) {
    const D = window.CALLOUT_SMOKES;
    return D && Array.isArray(D[mapId]) ? D[mapId] : [];
  }
  // Every usable line-up on the current map, in display order: A, Mid, B; T before CT; then by name.
  function all() {
    const m = A.state.map;
    const out = [];
    for (const r of rawFor(m.id)) {
      const bad = problem(r);
      if (bad) {
        const k = `${m.id}/${r && r.id}`;
        if (!warned.has(k)) { warned.add(k); console.warn(`Smokes: skipped line-up ${k}: ${bad}.`); }
        continue;
      }
      out.push({ ...r, to: point(r.to, A.callout(r.to.callout)), from: point(r.from, A.callout(r.from.callout)), shots: shotsOf(r, m.id) });
    }
    const so = { a: 0, mid: 1, b: 2 };
    return out.sort((x, y) => so[x.site] - so[y.site] || (x.side === y.side ? 0 : x.side === "t" ? -1 : 1) || x.name.localeCompare(y.name));
  }
  const side = () => (SIDES.some((s) => s[0] === A.prefs.smkSide) ? A.prefs.smkSide : "both");
  // Target filter (A, Mid, B; empty = every site), shared by Explore and Find it and remembered like the side.
  const sites = () => new Set((Array.isArray(A.prefs.smkSites) ? A.prefs.smkSites : []).filter((s) => SITE_NAME[s]));
  function setSites(set) {
    A.prefs.smkSites = SITES.map(([s]) => s).filter((s) => set.has(s));
    A.savePrefs();
  }
  const passes = (l) => { const ss = sites(); return (side() === "both" || l.side === side()) && (!ss.size || ss.has(l.site)); };
  const filtered = () => all().filter(passes);
  // Line-ups grouped by where they land.
  function targets(list) {
    const T = new Map();
    for (const l of list) {
      const k = l.to.callout;
      if (!T.has(k)) T.set(k, { key: k, x: l.to.x, y: l.to.y, level: l.to.level, name: l.to.name, items: [] });
      T.get(k).items.push(l);
    }
    return T;
  }
  const landR = () => A.unitsToPx(LAND_U);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // ---------- radar layer ----------
  // A quadratic curve from the throw spot to the landing, bowed to the left of travel
  // (or to the right if the bend would leave the map).
  function arcPath(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, k = 0.18 * d;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let c = { x: mx + (dy / d) * k, y: my - (dx / d) * k };
    const [vx, vy, vw, vh] = A.state.map.view;
    if (c.x < vx || c.y < vy || c.x > vx + vw || c.y > vy + vh) c = { x: mx - (dy / d) * k, y: my + (dx / d) * k };
    return `M${a.x},${a.y} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${b.x},${b.y}`;
  }

  // Two-level maps (Nuke, Vertigo): a line-up end on the other level is a "ghost", a dashed ring at its spot
  // with an "upper" / "lower" chip. Tapping it switches the map to that level (see ghostAt). Keyboard users
  // get the same switch as a button on the card and in the drill reveal (levelBtn).
  function ghost(parent, p, land, cls) {
    const g = A.el("g", { class: `smk-ghost${land ? " is-land" : ""}${cls ? " " + cls : ""}`, "data-x": p.x, "data-y": p.y, "data-level": p.level, "data-land": land ? 1 : 0 }, parent);
    A.el("circle", { class: "smk-ghost-ring", cx: p.x, cy: p.y, ...(land ? { r: landR() } : { "data-r": 7 }) }, g);
    A.el("rect", { class: "smk-ghost-chip", rx: 3 }, g);
    A.el("text", { class: "smk-ghost-text" }, g).textContent = p.level;
    return g;
  }
  // The ghost under a map point, as { level, d }, or null. Its chip counts as a direct hit (d 0), so a ghost
  // stacked on a landing of this level (Nuke's A over B) can still be reached.
  function ghostAt(p) {
    const u = A.unit(), pad = 6 * u;
    let best = null;
    layer.querySelectorAll(".smk-ghost").forEach((n) => {
      const c = n.querySelector("rect"), cx = Number(c.getAttribute("x")), cy = Number(c.getAttribute("y"));
      const onChip = p.x >= cx - pad && p.x <= cx + Number(c.getAttribute("width")) + pad && p.y >= cy - pad && p.y <= cy + Number(c.getAttribute("height")) + pad;
      const d = onChip ? 0 : Math.hypot(p.x - Number(n.dataset.x), p.y - Number(n.dataset.y));
      const r = n.dataset.land === "1" ? Math.max(landR(), HIT_PX * u) : HIT_PX * u;
      if (d <= r && (!best || d < best.d)) best = { level: n.dataset.level, d };
    });
    return best;
  }
  function goLevel(lv) {
    if (!lv || lv === A.state.level) return;
    A.setLevel(lv);
    A.announce(`${lv[0].toUpperCase()}${lv.slice(1)} level.`);
  }
  // A button that switches to the level of a line-up's other end, or "" when both ends share a level.
  function levelBtn(l) {
    if (l.from.level === l.to.level) return "";
    const other = A.state.level === l.from.level ? l.to.level : l.from.level;
    return `<p class="smk-lvl">Thrown from the ${l.from.level} level, lands on the ${l.to.level} level. <button type="button" class="link-btn" data-goto-level="${other}">Show ${other} level</button></p>`;
  }
  function bindLevelBtns() {
    A.panel.querySelectorAll("[data-goto-level]").forEach((b) => (b.onclick = () => goLevel(b.dataset.gotoLevel)));
  }

  function draw(list) {
    layer.textContent = "";
    const lv = A.state.level;
    const sel = list.find((l) => l.id === S.sel) || null;
    layer.classList.toggle("has-focus", !!S.focus && !sel);
    layer.classList.toggle("has-sel", !!sel);
    const g = (cls) => A.el("g", cls ? { class: cls } : {}, layer);
    const gLand = g(), gArc = g(), gThrow = g(), gBadge = g(), gHit = g("smk-hits");
    const R = landR();
    for (const t of targets(list).values()) {
      if (t.level !== lv) {
        // A landing on the other level shows as a ghost when it is focused or thrown from this level.
        const here = t.items.some((l) => l.from.level === lv);
        if (t.key === S.focus || here) ghost(gLand, t, true, t.key === S.focus ? "is-focus" + (sel && sel.to.callout === t.key ? " is-sel " + sel.side : "") : "");
        continue;
      }
      let cls = "smk-land";
      if (t.key === S.focus) cls += " is-focus";
      if (sel && sel.to.callout === t.key) cls += " is-sel " + sel.side;
      A.el("circle", { class: cls, cx: t.x, cy: t.y, r: R }, gLand);
      A.el("circle", { class: "smk-hit", cx: t.x, cy: t.y, "data-r": HIT_PX, "data-min": R }, gHit);
      if (t.items.length > 1) {
        const b = A.el("g", { class: "smk-count" + (t.key === S.focus ? " is-focus" : "") }, gBadge);
        const bx = t.x + 0.7 * R, by = t.y - 0.7 * R;
        A.el("circle", { cx: bx, cy: by, "data-r": 9 }, b);
        A.el("text", { x: bx, y: by }, b).textContent = t.items.length;
      }
    }
    if (S.focus) {
      const animate = S.drawnFocus !== S.focus && !sel && !REDUCED.matches;
      S.drawnFocus = S.focus;
      for (const l of list) {
        if (l.to.callout !== S.focus) continue;
        const on = l.id === S.sel;
        const cls = ` ${l.side}${on ? " is-sel" : sel ? " is-dim" : ""}`;
        // Only the ends on this level are drawn; a throw spot on the other level is a ghost, with no arc.
        if (l.from.level !== lv) { if (l.to.level === lv) ghost(gThrow, l.from, false, cls.trim()); continue; }
        if (l.to.level === lv) {
          const d = arcPath(l.from, l.to);
          const casing = A.el("path", { class: "fb-casing smk-casing" + cls, d }, gArc);
          const arc = A.el("path", { class: "smk-arc" + cls, d }, gArc);
          if (animate) { casing.classList.add("is-draw"); arc.classList.add("is-draw"); }
        }
        A.el("circle", { class: "smk-throw" + cls, cx: l.from.x, cy: l.from.y, "data-r": on ? 8 : 6 }, gThrow);
        if (on) {
          const len = dist(l.from, l.to) || 1;
          A.el("line", { class: "smk-face " + l.side, x1: l.from.x, y1: l.from.y, "data-ux": (l.to.x - l.from.x) / len, "data-uy": (l.to.y - l.from.y) / len }, gThrow);
        }
        A.el("circle", { class: "smk-hit", cx: l.from.x, cy: l.from.y, "data-r": HIT_PX }, gHit);
      }
    }
    rescale(A.unit());
  }

  function rescale(u) {
    if (!layer || !layer.firstChild) return;
    layer.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Math.max(Number(n.dataset.r) * u, Number(n.dataset.min || 0))));
    layer.querySelectorAll(".smk-count text").forEach((t) => t.setAttribute("font-size", 12 * u));
    layer.querySelectorAll(".smk-face").forEach((n) => {
      n.setAttribute("x2", Number(n.getAttribute("x1")) + Number(n.dataset.ux) * 14 * u);
      n.setAttribute("y2", Number(n.getAttribute("y1")) + Number(n.dataset.uy) * 14 * u);
    });
    // Ghost chips sit just below their ring, at a fixed screen size.
    layer.querySelectorAll(".smk-ghost").forEach((n) => {
      const x = Number(n.dataset.x), ring = n.firstChild, w = 46 * u, h = 17 * u;
      const y = Number(n.dataset.y) + Number(ring.getAttribute("r")) + 3 * u;
      const rect = n.querySelector("rect"), text = n.querySelector("text");
      rect.setAttribute("x", x - w / 2); rect.setAttribute("y", y); rect.setAttribute("width", w); rect.setAttribute("height", h);
      text.setAttribute("x", x); text.setAttribute("y", y + h / 2); text.setAttribute("font-size", 12 * u);
    });
    // The draw-in dash is in screen px (non-scaling stroke), so it follows the zoom.
    layer.querySelectorAll("path.is-draw").forEach((p) => {
      const len = Math.ceil(p.getTotalLength() / u) + 2;
      p.style.setProperty("--len", len + "px");
      if (!p.dataset.bound) { p.dataset.bound = "1"; p.addEventListener("animationend", () => p.classList.remove("is-draw"), { once: true }); }
    });
  }

  // ---------- selection ----------
  function frame(l) {
    const R = landR();
    A.fitBox([Math.min(l.from.x, l.to.x - R), Math.min(l.from.y, l.to.y - R), Math.max(l.from.x, l.to.x + R), Math.max(l.from.y, l.to.y + R)], 0.15);
  }
  function setFocus(key) {
    const t = targets(filtered()).get(key);
    S.focus = t ? key : null;
    S.sel = null;
    render();
    A.updateHash();
    if (t) A.announce(`${t.name}: ${t.items.length} line-up${t.items.length === 1 ? "" : "s"}. Pick a throw spot.`);
  }
  // how: "list" (a row or [ ]), "radar" (a throw spot), "route" (a link)
  function select(id, how) {
    const l = all().find((x) => x.id === id);
    if (!l) return;
    // Stay on this level if either end is here (the other end shows as a ghost).
    if (l.to.level !== A.state.level && l.from.level !== A.state.level) A.setLevel(l.to.level);
    S.sel = l.id;
    S.focus = l.to.callout;
    render();
    frame(l);
    A.updateHash();
    A.announce(`${l.name}, from ${l.from.name}, ${SIDE_NAME[l.side]} side. Aim: ${l.aim}`);
    const panel = A.panel;
    if (how === "route") { panel.scrollTop = 0; return; }
    const row = panel.querySelector(`.smk-list button[data-id="${CSS.escape(l.id)}"]`);
    if (how === "list" && row) row.focus({ preventScroll: true });
    // Narrow screens have no sticky card, so bring the card itself into view.
    const card = A.NARROW.matches && panel.querySelector(".smk-card");
    if (card) card.scrollIntoView({ block: "nearest" });
    else if (row) {
      const sticky = panel.querySelector(".smk-card.is-sticky");
      panel.style.scrollPaddingTop = sticky ? `${sticky.offsetHeight + 28}px` : "";
      row.scrollIntoView({ block: "nearest" });
    }
  }
  // One state back: selected -> focused -> idle. False when there is nothing to undo.
  // Esc never switches content or mode, so Find it and Name it have nothing to step back from.
  function back() {
    if (view() === "find") {
      // Mid-round Esc skips the "Which throw?" bonus and otherwise does nothing (End round is the way out).
      const q = S.round;
      if (q && !q.done && q.phase === "reveal") { skipThrow(); return true; }
      return false;
    }
    if (view() !== "explore") return false;
    if (S.sel) {
      S.sel = null;
      render();
      A.updateHash();
      A.announce("Line-up closed.");
      return true;
    }
    if (S.focus) { S.focus = null; render(); A.announce("Showing every landing spot."); return true; }
    return false;
  }
  function step(dir) {
    const list = filtered();
    if (!list.length) return;
    const i = list.findIndex((l) => l.id === S.sel);
    const n = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    select(list[n].id, "list");
  }
  function setSide(v) {
    if (side() === v) return;
    A.prefs.smkSide = v;
    A.savePrefs();
    render();
    const n = filtered().length;
    A.announce(`${v === "both" ? "Both sides" : SIDE_NAME[v] + " side"}: ${n} line-up${n === 1 ? "" : "s"}.`);
  }

  // Map clicks: a throw spot of the focused target, then a landing, else one step back.
  function click(p) {
    if (view() === "find") { const q = S.round; if (q && !q.done && q.phase === "ask") answer(p); else goLevel((ghostAt(p) || {}).level); return; }
    if (view() !== "explore") return;
    const u = A.unit(), lv = A.state.level, list = filtered();
    let best = null, bd = Infinity;
    if (S.focus) {
      for (const l of list) {
        if (l.to.callout !== S.focus || l.from.level !== lv) continue;
        const d = dist(p, l.from);
        if (d <= HIT_PX * u && d < bd) { best = l; bd = d; }
      }
      if (best) { if (best.id !== S.sel) select(best.id, "radar"); return; }
    }
    const R = Math.max(landR(), HIT_PX * u);
    let t = null;
    bd = Infinity;
    for (const x of targets(list).values()) {
      if (x.level !== lv) continue;
      const d = dist(p, x);
      if (d <= R && d < bd) { t = x; bd = d; }
    }
    // A ghost (line-up end on the other level) wins over a landing here only when it is closer.
    const gl = ghostAt(p);
    if (gl && gl.d < bd) return goLevel(gl.level);
    if (t) { if (t.key !== S.focus || S.sel) setFocus(t.key); return; }
    back();
  }

  // ---------- panel ----------
  const esc = (s) => A.esc(s);
  const seg = (id, items, cur, label) =>
    `<div class="seg" id="${id}" role="group" aria-label="${label}">${items.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${l}</button>`).join("")}</div>`;
  function accBadge(l) {
    if (l.status === "checked") {
      const [y, mo] = l.checked.split("-");
      return `<span class="acc checked">✓ Checked · ${MONTHS[Number(mo) - 1] || mo} ${y}</span>`;
    }
    return `<span class="acc">◌ Approximate, not checked in game</span>`;
  }
  function issueUrl(l) {
    const m = A.state.map;
    const body = `Line-up: ${m.id}/${l.id} (${l.name}, from ${l.from.name})\n\nWhat's wrong:\n\n\nMap version or date you played it:\n\nClip or screenshot (if any):\n`;
    return `${ISSUE_URL}?title=${encodeURIComponent(`Smoke line-up wrong: ${m.id}/${l.id}`)}&body=${encodeURIComponent(body)}`;
  }
  // One chip per facet: [Left click] [Standing] [Jump-throw] (+ [Crouch]).
  function techChips(l) {
    const t = l.technique;
    return `<span class="tech tech-click">${mouseSvg(t.click)}${CLICKS[t.click]}</span>`
      + `<span class="tech${t.move !== "stand" ? " is-move" : ""}">${MOVES[t.move]}</span>`
      + (t.jump ? `<span class="tech is-move">Jump-throw</span>` : "")
      + (t.crouch ? `<span class="tech">Crouch</span>` : "")
      + (l.precision ? `<span class="tech tech-prec ${l.precision}">${PRECISION[l.precision]}</span>` : "");
  }
  // The outbound link to the source's video and screenshots, or "" for a line-up without one.
  const sourceLink = (l) => (l.source ? `<a class="smk-src" href="${esc(l.source.url)}" target="_blank" rel="noopener">Video and screenshots on ${SOURCE_NAME} ↗</a>` : "");

  // ---------- screenshots ----------
  const missingShots = new Set(); // URLs that failed to load, so a redraw goes straight to the placeholder
  function shotFig(l, kind, cls = "") {
    const url = l.shots[kind], ok = url && !missingShots.has(url);
    const [ax, ay] = l.shots.aimAt;
    const ring = kind === "aim" ? `<span class="smk-ring" style="left:${ax * 100}%;top:${ay * 100}%" aria-hidden="true"></span>` : "";
    return `<figure class="smk-shot ${cls}${ok ? "" : " is-missing"}" data-kind="${kind}">
        <div class="smk-frame">
          ${ok ? `<button type="button" class="smk-thumb" data-shot="${kind}" aria-label="${SHOT_LABEL[kind]}: open the screenshot"><img src="${esc(url)}" alt="" loading="lazy" decoding="async">${ring}</button>` : ""}
          <div class="smk-missing"><span>${l.source ? `Not here yet, see ${SOURCE_NAME}` : "Screenshot needed"}</span><a href="${HOWTO_URL}" target="_blank" rel="noopener">${l.source ? "Add yours" : "How to add"}</a></div>
        </div>
        <figcaption>${SHOT_LABEL[kind]}</figcaption>
      </figure>`;
  }
  // Wire up the thumbnails just drawn: a file that doesn't load turns into the placeholder.
  function bindShots(l) {
    A.panel.querySelectorAll(".smk-thumb").forEach((b) => {
      const img = b.querySelector("img"), fig = b.closest(".smk-shot");
      const fail = () => {
        const url = l.shots[fig.dataset.kind];
        if (!missingShots.has(url)) { missingShots.add(url); console.warn(`Smokes: screenshot not found: ${url}`); }
        const had = document.activeElement === b;
        fig.classList.add("is-missing");
        b.remove();
        if (had) A.panel.focus && A.panel.focus();
      };
      img.addEventListener("error", fail, { once: true });
      if (img.complete && img.src && !img.naturalWidth) fail();
      b.onclick = () => openLightbox(l, b.dataset.shot, b);
    });
  }

  // Lightbox: an accessible dialog with the full screenshot. Esc closes, arrows switch stand / aim.
  let LB = null;
  function openLightbox(l, kind, opener) {
    const items = ["stand", "aim"].filter((k) => l.shots[k] && !missingShots.has(l.shots[k]));
    if (!items.length) return;
    closeLightbox(false);
    const el = document.createElement("div");
    el.className = "smk-lb";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-labelledby", "smkLbTitle");
    document.body.appendChild(el);
    LB = { el, l, items, i: Math.max(0, items.indexOf(kind)), opener };
    el.addEventListener("click", (e) => {
      if (e.target === el) return closeLightbox(true);
      const b = e.target.closest("button");
      if (!b) return;
      if (b.classList.contains("smk-lb-close")) closeLightbox(true);
      else if (b.dataset.k) showLb(items.indexOf(b.dataset.k));
    });
    document.addEventListener("keydown", lbKey, true);
    drawLb();
    el.querySelector(".smk-lb-close").focus();
    A.announce(`${l.name}: ${SHOT_LABEL[items[LB.i]]}.`);
  }
  function drawLb() {
    const { el, l, items, i } = LB, k = items[i];
    const [ax, ay] = l.shots.aimAt;
    const text = k === "stand" ? `${l.from.name}. ${l.stand}` : l.aim;
    el.innerHTML = `<div class="smk-lb-box">
        <div class="smk-lb-top">
          <h2 id="smkLbTitle">${esc(l.name)} <span>· ${SHOT_LABEL[k]}</span></h2>
          <button type="button" class="btn small smk-lb-close" aria-label="Close">✕</button>
        </div>
        <div class="smk-lb-media"><span class="smk-lb-pic"><img src="${esc(l.shots[k])}" alt="${SHOT_LABEL[k]} for the ${esc(l.name)} smoke, from ${esc(l.from.name)}">${k === "aim" ? `<span class="smk-ring" style="left:${ax * 100}%;top:${ay * 100}%" aria-hidden="true"></span>` : ""}</span></div>
        <p class="smk-lb-cap"><span class="smk-k">${k === "stand" ? "Stand" : "Aim"}</span> ${esc(text)}</p>
        ${items.length > 1 ? `<div class="row smk-lb-nav"><div class="seg" role="group" aria-label="Screenshot">${items.map((x) => `<button type="button" data-k="${x}" aria-pressed="${x === k}">${SHOT_LABEL[x]}</button>`).join("")}</div><span class="kbd-hint"><kbd>←</kbd> <kbd>→</kbd> switch, <kbd>Esc</kbd> close</span></div>` : ""}
      </div>`;
  }
  function showLb(i) {
    if (!LB || i < 0 || i === LB.i) return;
    const k = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    LB.i = i;
    drawLb();
    const f = (k && LB.el.querySelector(`button[data-k="${LB.items[i]}"]`)) || LB.el.querySelector(".smk-lb-close");
    f.focus();
    A.announce(SHOT_LABEL[LB.items[i]]);
  }
  function closeLightbox(returnFocus) {
    if (!LB) return;
    const { el, opener } = LB;
    LB = null;
    document.removeEventListener("keydown", lbKey, true);
    el.remove();
    if (returnFocus && opener && opener.isConnected) opener.focus({ preventScroll: true });
  }
  // Captures every key while open, so the app's own keys (Esc, [ ], 1-6...) never fire behind it.
  function lbKey(e) {
    if (!LB) return;
    e.stopPropagation();
    const el = LB.el;
    if (e.key === "Escape") { e.preventDefault(); closeLightbox(true); return; }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const n = LB.items.length;
      if (n > 1) showLb((LB.i + (e.key === "ArrowRight" ? 1 : -1) + n) % n);
      return;
    }
    if (e.key === "Tab") {
      const f = [...el.querySelectorAll("button, a[href]")];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i < 0 ? 0 : i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  }
  function card(l, cls = "") {
    return `<div class="card smk-card ${cls}">
      <div class="smk-head"><h3>${esc(l.name)}</h3><span class="chip ${l.side}">${SIDE_NAME[l.side]}</span></div>
      <p class="alt">from ${esc(l.from.name)} · ${SITE_NAME[l.site]}</p>
      ${levelBtn(l)}
      <dl class="smk-rows">
        <div class="smk-row"><dt class="smk-k">Stand</dt><dd>${esc(l.stand)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Aim</dt><dd class="smk-aim">${esc(l.aim)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Technique</dt><dd class="smk-techs">${techChips(l)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Lands</dt><dd>${esc(l.lands)}</dd></div>
      </dl>
      <div class="smk-shots">${shotFig(l, "stand")}${shotFig(l, "aim")}</div>
      <div class="meta smk-meta">${accBadge(l)}${sourceLink(l)}<a class="smk-wrong" href="${esc(issueUrl(l))}" target="_blank" rel="noopener">This line-up is wrong?</a></div>
      <div class="meta"><span class="mode-st">${masteryText(l.id)}</span></div>
    </div>`;
  }
  function row(l) {
    const t = l.technique;
    const cls = `side-${l.side}${l.id === S.sel ? " is-active" : ""}${l.status !== "checked" ? " is-unverified" : ""}`;
    return `<li><button type="button" data-id="${esc(l.id)}" class="${cls}"${l.id === S.sel ? ` aria-current="true"` : ""}>
        <span class="sd">${SIDE_NAME[l.side]}</span>
        <span class="nm">${esc(l.name)}</span>
        <span class="from">from ${esc(l.from.name)}</span>
        <span class="tq${isMove(t) ? " is-move" : ""}">${techLabel(t)}</span>
        <span class="ms" title="Find it: ${stage(l.id)}"><i style="width:${mastery(l.id) * 100}%"></i></span>
        ${l.status !== "checked" ? `<span class="unv" title="Approximate, not checked in game" aria-hidden="true">◌</span><span class="sr-only">, approximate</span>` : ""}
      </button></li>`;
  }

  function renderEmpty() {
    const m = A.state.map;
    layer.textContent = "";
    const D = window.CALLOUT_SMOKES;
    const others = (window.CALLOUT_MAPS || []).map((x) => [x, rawFor(x.id).length]).filter(([x, n]) => n && x.id !== m.id);
    const msg = !D ? `The line-ups did not load. They come from <code>data/smokes.js</code>.`
      : `No smokes for ${esc(m.name)} yet.${others.map(([x, n]) => ` <a href="#${x.id}/smokes/explore">${esc(x.name)} has ${n}.</a>`).join("")}`;
    A.panel.innerHTML = `
      <p class="lede"><strong>Smokes</strong> shows where to stand and how to throw well-known smokes, on the radar you already know.</p>
      <div class="card smk-empty"><p class="desc">${msg}</p></div>`;
  }

  // Keep keyboard focus on the same control across a panel redraw.
  function focusKey() {
    const a = document.activeElement;
    if (!a || !A.panel.contains(a) || a === A.panel) return null;
    if (a.dataset.id) return `.smk-list button[data-id="${CSS.escape(a.dataset.id)}"]`;
    if (a.dataset.site) return `.flt-chip[data-site="${a.dataset.site}"]`;
    if (a.dataset.v && a.parentElement && a.parentElement.id) return `#${a.parentElement.id} button[data-v="${a.dataset.v}"]`;
    if (a.dataset.shot) return `.smk-thumb[data-shot="${a.dataset.shot}"]`;
    if (a.dataset.gotoLevel) return "[data-goto-level]";
    if (a.id) return "#" + a.id;
    return ".smk-list button[data-id]";
  }

  // Switch the app to another learning mode from a button in the panel, keeping focus near it.
  function goMode(m) {
    A.go({ learn: m });
    const t = A.$("#tab-" + m);
    if (t) t.focus({ preventScroll: true });
  }

  function render() {
    layer.style.display = "";
    const every = all();
    const active = view() === "find" && !!S.round && !S.round.done;
    document.body.classList.toggle("quiz-step", active);
    document.body.classList.toggle("quiz-answered", active && S.round.phase !== "ask");
    document.body.classList.toggle("smk-picked", active && S.round.phase === "picked");
    if (!every.length) { S.sel = S.focus = null; S.round = null; document.body.classList.remove("quiz-step", "quiz-answered", "smk-picked"); return renderEmpty(); }
    if (view() === "find") return renderDrill(every);
    if (view() === "name") return renderNameIt();
    renderBrowse(every);
  }
  // Name it for smokes is not built yet: say what it will be and point to the two views that work.
  function renderNameIt() {
    layer.textContent = "";
    A.$("#stagePrompt").textContent = "";
    A.panel.innerHTML = `
      <p class="lede"><strong>Name it for smokes is coming:</strong> you'll see where you stand and name the smoke. For now, learn line-ups in Explore and test them in Find it.</p>
      <div class="row">
        <button type="button" class="btn primary" id="smkGoFind">Go to Find it</button>
        <button type="button" class="btn" id="smkGoExplore">Explore</button>
      </div>`;
    A.$("#smkGoFind").onclick = () => goMode("find");
    A.$("#smkGoExplore").onclick = () => goMode("explore");
  }
  function renderBrowse(every) {
    const m = A.state.map;
    const list = every.filter(passes);
    if (S.sel && !list.some((l) => l.id === S.sel)) S.sel = null;
    if (S.focus && !list.some((l) => l.to.callout === S.focus)) S.focus = null;
    const sel = list.find((l) => l.id === S.sel);
    const keep = focusKey();
    const groups = SITES.map(([s]) => [s, list.filter((l) => l.site === s)]).filter(([, ls]) => ls.length);
    const n = list.length, total = every.length;
    A.panel.innerHTML = `
      <p class="lede">${n === total ? `${total} smoke${total === 1 ? "" : "s"}` : `${n} of ${total} smokes`} on ${esc(m.name)}. ${n ? "Tap a landing spot to see where it's thrown from." : "None match these filters."}</p>
      <div class="row smk-ctrl"><span class="field-label">Side</span>${seg("smkSide", SIDES, side(), "Side")}</div>
      ${targetRow()}
      ${sel ? card(sel, "is-sticky") : ""}
      <div class="smk-groups" id="smkList">
        ${groups.map(([s, ls]) => `<h4 class="smk-group">${SITE_HEAD[s]}</h4><ul class="smk-list">${ls.map(row).join("")}</ul>`).join("")}
      </div>
      <span class="kbd-hint"><kbd>[</kbd> <kbd>]</kbd> previous / next, <kbd>T</kbd> <kbd>C</kbd> <kbd>B</kbd> side, <kbd>Esc</kbd> back</span>
      <div class="foot">Line-ups are sourced from <a href="https://csnades.gg" target="_blank" rel="noopener">csnades.gg</a>, which hosts their videos and screenshots. We link to them, write each one up in our own words and place it by hand. They are approximate and not yet checked in game. Callout names follow <a href="https://totalcsgo.com/callouts" target="_blank" rel="noopener">Total CS</a>.</div>`;
    // On narrow screens the panel sits below the map, so echo the selection on the stage.
    A.$("#stagePrompt").innerHTML = sel ? `${esc(sel.name)}<span class="sp-desc">Aim: ${esc(sel.aim)}</span>` : "";
    bindSeg("smkSide", setSide);
    bindTargets();
    A.$("#smkList").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      if (b.dataset.id === S.sel) back(); else select(b.dataset.id, "list");
    };
    if (sel) bindShots(sel);
    bindLevelBtns();
    if (keep) {
      const f = A.panel.querySelector(keep);
      if (f) f.focus({ preventScroll: true });
    }
    draw(list);
  }
  function targetRow() {
    const ss = sites();
    return `<div class="row smk-ctrl" role="group" aria-label="Target"><span class="field-label">Target</span>
        ${SITES.map(([v, l]) => `<button type="button" class="flt-chip" data-site="${v}" aria-pressed="${ss.has(v)}">${l}</button>`).join("")}
      </div>`;
  }
  function bindTargets() {
    A.panel.querySelectorAll(".flt-chip").forEach((b) => (b.onclick = () => {
      const ss = sites(), s = b.dataset.site;
      if (ss.has(s)) ss.delete(s); else ss.add(s);
      setSites(ss);
      render();
      const k = filtered().length;
      A.announce(`${ss.size ? [...ss].map((x) => SITE_NAME[x]).join(", ") : "Every target"}: ${k} line-up${k === 1 ? "" : "s"}.`);
    }));
  }
  function bindSeg(id, fn) {
    const box = A.panel.querySelector("#" + id);
    if (!box) return;
    box.onclick = (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      fn(b.dataset.v);
    };
  }

  // ---------- drill ----------
  // Up to ROUND_MAX line-ups on the chosen side: new and learning ones first, then the learned, shuffled.
  function startRound() {
    const pool = all().filter(passes);
    if (!pool.length) return;
    const fresh = shuffle(pool.filter((l) => stage(l.id) !== "learned"));
    const learned = shuffle(pool.filter((l) => stage(l.id) === "learned"));
    const items = shuffle(fresh.concat(learned).slice(0, Math.min(ROUND_MAX, pool.length)));
    S.round = { items, i: 0, results: [], phase: "ask", done: false, pool: pool.map((l) => l.id), learned0: pool.filter((l) => stage(l.id) === "learned").length };
    S.sel = S.focus = null;
    askQuestion();
  }
  const cur = () => S.round.items[S.round.i];
  function askQuestion() {
    const q = S.round, l = cur();
    q.phase = "ask";
    if (l.to.level !== A.state.level) A.setLevel(l.to.level);
    A.fitView();
    render();
    A.announce(`Question ${q.i + 1} of ${q.items.length}. Where do you stand to smoke ${l.name}? ${SIDE_NAME[l.side]} side.`);
    const f = A.panel.querySelector(".callname");
    if (f) f.focus({ preventScroll: true });
  }
  function answer(p) {
    const q = S.round, l = cur();
    const d = dist(p, l.from), units = d * A.state.map.scale;
    // A click on the wrong level of a two-level map is a miss, however close.
    const lv = A.state.level, offLevel = lv !== l.from.level;
    const kind = offLevel ? "miss" : units <= HIT_U ? "hit" : units <= CLOSE_U ? "close" : "miss";
    q.results[q.i] = { id: l.id, kind, d, p: { x: p.x, y: p.y }, lv, offLevel, pick: null };
    // The right throw plus up to five other common ones, in random order.
    const right = techLabel(l.technique);
    q.options = shuffle([right, ...shuffle(TECH_POOL.filter((x) => x !== right)).slice(0, 5)]);
    q.phase = "reveal";
    score(l.id, kind === "hit");
    render();
    const R = landR(), xs = [p.x, l.from.x, l.to.x - R, l.to.x + R], ys = [p.y, l.from.y, l.to.y - R, l.to.y + R];
    A.fitBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 0.15);
    const m = A.meters(d);
    A.announce(`${RESULT[kind]}, ${offLevel ? `wrong level, it's thrown from the ${l.from.level} level` : `${m} metre${m === 1 ? "" : "s"} off`}. Stand: ${l.stand} Which throw is it? Press 1 to ${q.options.length}, or Escape to skip.`);
    const f = A.panel.querySelector(".smk-choices .choice");
    if (f) f.focus({ preventScroll: true });
  }
  function pickThrow(i) {
    const q = S.round;
    if (!q || q.done || q.phase !== "reveal" || !q.options[i]) return;
    const l = cur(), r = q.results[q.i], right = techLabel(l.technique);
    r.pick = q.options[i];
    r.throwOk = r.pick === right;
    q.phase = "picked";
    render();
    A.announce(`${r.throwOk ? "Right" : `No, it's ${right}`}. Aim: ${l.aim}`);
    showAim();
  }
  // Skip the bonus: show the right throw and the aim, with nothing picked (not counted in the summary).
  function skipThrow() {
    const q = S.round;
    if (!q || q.done || q.phase !== "reveal") return;
    q.results[q.i].skipped = true;
    q.phase = "picked";
    render();
    const l = cur();
    A.announce(`Skipped. It's ${techLabel(l.technique)}. Aim: ${l.aim}`);
    showAim();
  }
  function showAim() {
    const ab = A.panel.querySelector(".smk-aimblock");
    if (ab) ab.scrollIntoView({ block: "nearest" });
    const n = A.panel.querySelector("#smkNext");
    if (n) n.focus({ preventScroll: true });
  }
  function nextQuestion() {
    const q = S.round;
    if (!q || q.phase !== "picked") return;
    if (q.i + 1 >= q.items.length) return finishRound();
    q.i += 1;
    askQuestion();
  }
  function finishRound() {
    const q = S.round;
    q.done = true;
    A.fitView();
    render();
    const hits = q.results.filter((r) => r.kind === "hit").length;
    A.announce(`Round over, ${hits} of ${q.results.length}.`);
    const f = A.panel.querySelector("#smkAgain");
    if (f) f.focus({ preventScroll: true });
  }
  function endRound() {
    const q = S.round;
    if (!q.results.length) { S.round = null; A.fitView(); render(); return; }
    q.items = q.items.slice(0, q.results.length);
    finishRound();
  }

  const RESULT = { hit: "Hit", close: "Close", miss: "Missed" };
  function drillProgress() {
    const q = S.round;
    return `<div class="progress" aria-hidden="true">${q.items.map((_, i) => {
      const r = q.results[i];
      return `<span class="${r ? r.kind : i === q.i && !q.done ? "now" : ""}"></span>`;
    }).join("")}</div>`;
  }
  function renderDrill(every) {
    A.$("#stagePrompt").textContent = "";
    const q = S.round;
    if (!q) return renderDrillIntro(every);
    if (q.done) return renderSummary();
    const l = cur(), r = q.results[q.i];
    const picked = q.phase === "picked";
    const right = techLabel(l.technique);
    const choices = r ? `<div class="choices smk-choices" id="smkChoices">${q.options.map((o, i) => {
      let cls = "choice";
      // Once answered, the other options are marked so narrow screens can drop them and fit the aim.
      if (picked) cls += o === right ? " right" : r.pick === o ? " wrong" : " is-other";
      return `<button type="button" class="${cls}" data-i="${i}" ${picked ? "disabled" : ""}><kbd>${i + 1}</kbd>${o}</button>`;
    }).join("")}</div>` : "";
    const standShot = l.shots.stand ? shotFig(l, "stand", "smk-dshot") : "";
    const aimShot = l.shots.aim ? shotFig(l, "aim", "smk-dshot") : "";
    A.panel.innerHTML = `
      ${drillProgress()}
      <div class="prompt">
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. Where do you stand to smoke</p>
        <h2 class="callname" tabindex="-1">${esc(l.name)}</h2>
        <p class="hint"><span class="chip ${l.side}">${SIDE_NAME[l.side]} side</span>${l.from.level !== l.to.level ? ` <span class="chip">Thrown from the ${l.from.level} level</span>` : ""}</p>
      </div>
      ${r ? `<div class="smk-result${standShot ? " has-shot" : ""}"><div class="result ${r.kind}"><h4>${RESULT[r.kind]}</h4><p class="detail">${r.offLevel ? `Wrong level: it's thrown from the ${l.from.level} level.` : `${A.meters(r.d)} m off.`}</p>${accBadge(l)}
          <p class="desc"><strong>Stand:</strong> ${esc(l.from.name)}. ${esc(l.stand)}</p>${levelBtn(l)}</div>${standShot}</div>
        <p class="ask smk-ask">Which throw? <span class="tag-bonus">not scored in streak</span></p>
        ${choices}
        ${picked ? `<div class="smk-aimblock${aimShot ? " has-shot" : ""}">${aimShot}<div class="smk-aimtext"><span class="smk-k">Aim</span><p class="smk-aim">${esc(l.aim)}</p><p class="smk-tech-note">${techChips(l)}</p>${l.source ? `<p class="smk-src-note">${sourceLink(l)}</p>` : ""}</div></div>` : ""}`
      : `<p class="kbd-hint smk-hint">${A.TOUCH ? "Tap your throw spot. Drag to pan, pinch to zoom." : "Click your throw spot. Drag to pan, scroll to zoom."}</p>`}
      <div class="step-actions">
        ${picked ? `<div class="row"><button type="button" class="btn primary" id="smkNext">${q.i + 1 < q.items.length ? "Next" : "See results"}</button>${A.TOUCH ? "" : `<span class="kbd-hint"><kbd>Enter</kbd></span>`}</div>`
          : r ? `<div class="row"><button type="button" class="btn small" id="smkSkip">Skip</button>${A.TOUCH ? "" : `<span class="kbd-hint"><kbd>Esc</kbd></span>`}</div>` : ""}
        <div class="row"><span class="spacer"></span><button type="button" class="btn quiet small" id="smkQuit">End round</button></div>
      </div>`;
    const ch = A.$("#smkChoices");
    if (ch) ch.onclick = (e) => { const b = e.target.closest("button[data-i]"); if (b) pickThrow(Number(b.dataset.i)); };
    bindShots(l);
    bindLevelBtns();
    const nx = A.$("#smkNext");
    if (nx) nx.onclick = nextQuestion;
    const sk = A.$("#smkSkip");
    if (sk) sk.onclick = skipThrow;
    A.$("#smkQuit").onclick = endRound;
    drawDrill();
  }
  function renderDrillIntro(every) {
    const m = A.state.map;
    const pool = every.filter(passes);
    const n = { learned: 0, learning: 0, fresh: 0 };
    for (const l of pool) { const st = stage(l.id); if (st === "learned") n.learned++; else if (st === "learning") n.learning++; else n.fresh++; }
    const seen = prog[m.id] && Object.keys(prog[m.id]).length;
    const size = Math.min(ROUND_MAX, pool.length);
    A.panel.innerHTML = `
      <p class="lede">You get a smoke and where it lands. <strong>Click where you stand to throw it.</strong> Within ${Math.round(HIT_U * 0.0254 * 10) / 10} m is a hit; within ${Math.round(CLOSE_U * 0.0254)} m is close. Then pick the throw, for a bonus that doesn't touch your streak.</p>
      <p class="lede smk-approx"><span class="acc">◌ Approximate</span> These line-ups are approximate and not yet checked in game.</p>
      <div class="row smk-ctrl"><span class="field-label">Side</span>${seg("smkSide", SIDES, side(), "Side")}</div>
      ${targetRow()}
      <div class="row"><button type="button" class="btn primary" id="smkStart" ${size ? "" : "disabled"}>Start ${esc(m.name)} round (${size})</button></div>
      <div class="breakdown">
        <p class="counts"><strong class="n-learned">${n.learned} learned</strong> · <span class="n-learning">${n.learning} learning</span> · <span class="n-new">${n.fresh} new</span></p>
        <p class="lede">A line-up counts as learned after ${A.MASTER_STREAK} hits in a row. New and learning line-ups come first.</p>
        ${seen ? `<button type="button" class="link-btn" id="smkReset">Reset ${esc(m.name)} smokes</button>` : ""}
      </div>`;
    bindSeg("smkSide", setSide);
    bindTargets();
    A.$("#smkStart").onclick = startRound;
    const rs = A.$("#smkReset");
    if (rs) rs.onclick = () => {
      if (!confirm(`Reset your ${m.name} smokes progress in Find it? Every ${m.name} line-up goes back to new. Callout progress in Find it and Name it is not touched.`)) return;
      delete prog[m.id];
      saveProg();
      render();
      A.toast(`${m.name} smokes reset`);
      const b = A.$("#smkStart");
      if (b) b.focus({ preventScroll: true });
    };
    layer.textContent = "";
  }
  function renderSummary() {
    const q = S.round, m = A.state.map;
    const total = q.results.length;
    const hits = q.results.filter((r) => r.kind === "hit").length;
    const picks = q.results.filter((r) => r.pick);
    const rightThrows = picks.filter((r) => r.throwOk).length;
    const skips = q.results.filter((r) => r.skipped).length;
    const missed = [...new Set(q.results.filter((r) => r.kind !== "hit").map((r) => r.id))].map((id) => q.items.find((l) => l.id === id));
    const pool = all().filter((l) => q.pool.includes(l.id));
    const learned = pool.filter((l) => stage(l.id) === "learned").length, gain = learned - q.learned0;
    A.panel.innerHTML = `
      ${drillProgress()}
      <div>
        <div class="score-big">${hits}<small> / ${total}</small></div>
        <p class="gain">Throw technique: ${rightThrows} of ${picks.length} right${skips ? `, ${skips} skipped` : ""}.</p>
        <p class="gain">${esc(m.name)} smokes: ${q.learned0} → ${learned} learned <span class="${gain > 0 ? "up" : ""}">(${gain > 0 ? "+" : gain < 0 ? "−" : "±"}${Math.abs(gain)})</span></p>
        <p class="lede">${missed.length ? `${missed.length} to work on, shown on the radar. Pick one to see it in Explore.` : "Clean round. Every throw spot within a hit."}</p>
      </div>
      ${missed.length ? `<ul class="missed">${missed.map((l) => `<li><button type="button" data-id="${esc(l.id)}"><b>${esc(l.name)}</b> from ${esc(l.from.name)}</button></li>`).join("")}</ul>` : ""}
      <div class="row">
        <button type="button" class="btn primary" id="smkAgain">Again</button>
        <button type="button" class="btn" id="smkBrowse">Back to Explore</button>
      </div>`;
    const ml = A.panel.querySelector(".missed");
    if (ml) ml.onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      A.go({ learn: "explore" });
      select(b.dataset.id, "route");
      const row = A.panel.querySelector(`.smk-list button[data-id="${CSS.escape(b.dataset.id)}"]`);
      if (row) row.focus({ preventScroll: true });
    };
    A.$("#smkAgain").onclick = startRound;
    A.$("#smkBrowse").onclick = () => goMode("explore");
    drawSummary(missed);
  }

  // Drill radar: the question shows only the glowing landing; the reveal adds the true spot, the
  // tolerance rings, your guess and the arc. On a two-level map, an end on the other level is a ghost.
  function drawDrill() {
    layer.textContent = "";
    layer.classList.remove("has-focus", "has-sel");
    const q = S.round, l = cur(), r = q.results[q.i], R = landR(), lv = A.state.level;
    const g = A.el("g", {}, layer);
    if (!r) {
      if (l.to.level === lv) A.el("circle", { class: "smk-land is-target", cx: l.to.x, cy: l.to.y, r: R }, g);
      else ghost(g, l.to, true, "is-target");
      return rescale(A.unit());
    }
    drawLineup(g, l);
    const fromOn = l.from.level === lv;
    if (fromOn) for (const u of [HIT_U, CLOSE_U]) A.el("circle", { class: "smk-tol", cx: l.from.x, cy: l.from.y, r: A.unitsToPx(u) }, g);
    if (r.lv === lv) {
      const pts = { x1: r.p.x, y1: r.p.y, x2: l.from.x, y2: l.from.y };
      if (r.kind !== "hit" && fromOn) { A.el("line", { class: "fb-casing", ...pts }, g); A.el("line", { class: "fb-line", ...pts }, g); }
      A.el("circle", { class: "fb-guess" + (r.kind !== "miss" ? " " + r.kind : ""), cx: r.p.x, cy: r.p.y, "data-r": 5 }, g);
    }
    rescale(A.unit());
  }
  // A line-up as when selected: its landing, dashed arc, filled throw spot and its facing tick. Only the
  // ends on this level are drawn; the other one is a ghost.
  function drawLineup(g, l) {
    const lv = A.state.level, fromOn = l.from.level === lv, toOn = l.to.level === lv;
    if (toOn) A.el("circle", { class: "smk-land is-sel " + l.side, cx: l.to.x, cy: l.to.y, r: landR() }, g);
    else ghost(g, l.to, true, "is-sel " + l.side);
    if (!fromOn) { ghost(g, l.from, false, "is-sel " + l.side); return; }
    if (toOn) {
      const d = arcPath(l.from, l.to);
      A.el("path", { class: `fb-casing smk-casing ${l.side} is-sel`, d }, g);
      A.el("path", { class: `smk-arc ${l.side} is-sel`, d }, g);
    }
    A.el("circle", { class: `smk-throw ${l.side} is-sel`, cx: l.from.x, cy: l.from.y, "data-r": 8 }, g);
    const len = dist(l.from, l.to) || 1;
    A.el("line", { class: "smk-face " + l.side, x1: l.from.x, y1: l.from.y, "data-ux": (l.to.x - l.from.x) / len, "data-uy": (l.to.y - l.from.y) / len }, g);
  }
  function drawSummary(missed) {
    layer.textContent = "";
    layer.classList.remove("has-focus", "has-sel");
    const lv = A.state.level;
    const g = A.el("g", {}, layer);
    for (const l of missed) {
      if (l.to.level !== lv && l.from.level !== lv) continue;
      drawLineup(g, l);
    }
    for (const r of S.round.results) {
      if (r.kind !== "hit" && r.lv === lv) A.el("circle", { class: "fb-guess" + (r.kind === "close" ? " close" : ""), cx: r.p.x, cy: r.p.y, "data-r": 5 }, g);
    }
    rescale(A.unit());
  }
  // A round with at least one answer asks before it is thrown away (like the Find it quiz).
  const busy = () => !!A && A.state.mode === "smokes" && view() === "find" && !!S.round && !S.round.done && S.round.results.length > 0;

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (!A || A.state.mode !== "smokes" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select")))) return;
    if (!all().length || view() === "name") return;
    const q = view() === "find" ? S.round : null;
    if (q && !q.done) {
      if (q.phase === "reveal" && /^[1-6]$/.test(e.key)) { e.preventDefault(); pickThrow(Number(e.key) - 1); return; }
      // A focused button clicks itself on Enter, so leave that to the button.
      if (q.phase === "picked" && e.key === "Enter" && !(t && t.matches && t.matches("button, a"))) { e.preventDefault(); nextQuestion(); }
      return; // no side keys while a round is running
    }
    if (view() === "explore" && (e.key === "[" || e.key === "]")) { e.preventDefault(); step(e.key === "]" ? 1 : -1); return; }
    const k = e.key.toLowerCase();
    const v = k === "t" ? "t" : k === "c" ? "ct" : k === "b" ? "both" : null;
    if (v) { e.preventDefault(); setSide(v); }
  });

  // ---------- registration ----------
  // Line-up ids share the hash with the mode names (#mirage/smokes/explore/<id>), so those are reserved.
  const RESERVED = ["explore", "name", "find"];
  const D0 = window.CALLOUT_SMOKES || {};
  for (const mapId in D0) {
    for (const r of Array.isArray(D0[mapId]) ? D0[mapId] : []) {
      if (r && RESERVED.includes(r.id)) console.warn(`Smokes: line-up ${mapId}/${r.id} uses a reserved id (${RESERVED.join(", ")}); rename it.`);
    }
  }
  window.CCT_MODES = window.CCT_MODES || {};
  window.CCT_MODES.smokes = {
    init(api) {
      A = api;
      layer = A.el("g", { id: "layerSmokes", class: "smk-layer" });
      A.svg.insertBefore(layer, A.$("#layerEdit"));
      layer.style.display = "none";
    },
    zones: true,
    render,
    rescale,
    click,
    escape: back,
    // In Explore, #<map>/smokes/explore/<id> selects that line-up; anything else (or nothing) shows them all.
    route(arg) {
      closeLightbox(false);
      const l = arg && all().find((x) => x.id === arg);
      if (!l) { if (S.sel || S.focus) { S.sel = S.focus = null; render(); } return; }
      if (!passes(l)) {
        if (side() !== "both" && side() !== l.side) { A.prefs.smkSide = "both"; A.savePrefs(); }
        setSites(new Set());
      }
      select(l.id, "route");
    },
    hashArg: () => (view() === "explore" && S.sel) || "",
    busy,
    // Leaving the view or the map clears the radar.
    leave() {
      if (!A) return;
      S.sel = S.focus = S.drawnFocus = null;
      S.round = null;
      closeLightbox(false);
      if (layer) { layer.textContent = ""; layer.style.display = "none"; }
    },
  };
})();
