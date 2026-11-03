(() => {
  "use strict";

  // ---------- storage (never trust it to exist) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
    },
  };
  const K = { progress: "cct.progress", edits: "cct.edits", prefs: "cct.prefs" };

  const BASE = window.CALLOUT_MAPS || [];
  let edits = store.get(K.edits, {});
  let progress = store.get(K.progress, {});
  // Progress is kept per quiz mode: progress[map][id] = { find: {s, c, k}, name: {s, c, k} }.
  // Older saves held one {s, c, k} per callout; that record moves into find (Find it was the headline drill).
  (function migrateProgress() {
    let moved = false;
    for (const mapId in progress) {
      const P = progress[mapId];
      if (!P || typeof P !== "object") continue;
      for (const id in P) {
        const r = P[id];
        if (r && typeof r.s === "number" && !r.find && !r.name) { P[id] = { find: { s: r.s, c: r.c || 0, k: r.k || 0 } }; moved = true; }
      }
    }
    if (moved) store.set(K.progress, progress);
  })();
  const prefs = Object.assign({ map: BASE[0] && BASE[0].id, content: "callouts", mode: "explore", labels: false, round: 10 }, store.get(K.prefs, {}));
  // The panel picks what you learn (content) and how (a learning mode, shared by both contents).
  // prefs.mode only ever holds a learning mode: older saves could hold "smokes" (now Smokes · Explore),
  // or a tool ("live", "edit"), which is never restored from prefs, only from the hash.
  const LEARN = ["explore", "name", "find"];
  const LEARN_NAME = { explore: "Explore", name: "Name it", find: "Find it" };
  const TOOLS = ["live", "edit"];
  if (prefs.mode === "smokes") { prefs.content = "smokes"; prefs.mode = "explore"; }
  if (!LEARN.includes(prefs.mode)) prefs.mode = "explore";
  if (prefs.content !== "smokes") prefs.content = "callouts";

  // Maps with the user's local position edits applied.
  function buildMaps() {
    return BASE.map((m) => ({
      ...m,
      callouts: m.callouts.map((c) => {
        const e = edits[m.id] && edits[m.id][c.id];
        if (!e) return { ...c };
        const out = { ...c, edited: true };
        if (e.x != null) { out.x = e.x; out.y = e.y; }
        if (e.poly) out.poly = e.poly;
        return out;
      }),
    }));
  }
  let MAPS = buildMaps();

  // ---------- constants ----------
  const CLOSE_PX = 24;     // radar px outside a zone that still counts as "close"
  const INCH_TO_M = 0.0254; // 1 Hammer unit ~ 1 inch
  const ANCHOR_PX = 14;     // screen px between a label and its name handle (Edit)
  const UNDO_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘Z" : "Ctrl+Z";
  const TOUCH = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const NARROW = window.matchMedia ? matchMedia("(max-width: 860px)") : { matches: false };
  const MASTER_STREAK = 3;
  // Extra modes from other scripts (js/live.js, js/smokes.js): window.CCT_MODES[id] = { init, render, leave,
  // rescale, busy, and optionally click(p), escape() -> handled?, route(arg), hashArg() -> string, zones }.
  const EXT = window.CCT_MODES || {};
  const ext = () => EXT[state.mode] || null;
  const extLeave = () => { for (const k in EXT) if (EXT[k].leave) EXT[k].leave(); };

  // ---------- dom ----------
  const $ = (s, el = document) => el.querySelector(s);
  const svg = $("#radar");
  const img = $("#radarImg");
  const layerZones = $("#layerZones");
  const layerMarkers = $("#layerMarkers");
  const layerEdit = $("#layerEdit");
  const layerFb = $("#layerFeedback");
  const panel = $("#panelBody");
  const stage = $("#stage");
  const NS = "http://www.w3.org/2000/svg";

  const state = {
    map: null,
    level: "upper",
    content: "callouts", // what you learn: "callouts" | "smokes"
    learn: "explore",    // how: "explore" | "name" | "find", shared by both contents
    tool: null,          // null | "live" | "edit", shown instead of the learning view
    // The view on screen, worked out by go(): the tool, "smokes", or the callout learning mode.
    mode: "explore",
    view: [0, 0, 1024, 1024],
    selected: null,
    vertex: null,   // index of the active polygon point in Edit
    hover: null,
    search: "",
    quiz: null,
  };

  // ---------- helpers ----------
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const levelName = (lv) => (lv === "lower" ? "Lower level" : "Upper level");
  const meters = (px) => Math.max(1, Math.round(px * state.map.scale * INCH_TO_M));

  // ---------- zone geometry ----------
  // A callout's zone is c.poly = [x1, y1, x2, y2, ...] in radar px. Without one, a small circle stands in.
  const ptsCache = new WeakMap();
  function ptsOf(c) {
    const key = c.poly || c;
    let p = ptsCache.get(key);
    if (p) return p;
    p = [];
    if (c.poly && c.poly.length >= 6) {
      for (let i = 0; i < c.poly.length; i += 2) p.push({ x: c.poly[i], y: c.poly[i + 1] });
    } else {
      for (let k = 0; k < 12; k++) p.push({ x: c.x + 18 * Math.cos((k * Math.PI) / 6), y: c.y + 18 * Math.sin((k * Math.PI) / 6) });
    }
    if (c.poly) ptsCache.set(key, p);
    return p;
  }
  const ptsStr = (c) => ptsOf(c).map((p) => `${p.x},${p.y}`).join(" ");
  const flatOf = (c) => ptsOf(c).flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
  // An axis-aligned four-corner zone; corner drags keep it that way.
  function isRect(c) {
    const p = ptsOf(c);
    if (p.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      if (a.x !== b.x && a.y !== b.y) return false;
    }
    return true;
  }
  function pointInPoly(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function nearestOnSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    return { d: dist(p, q), x: q.x, y: q.y };
  }
  // Distance from p to the zone's edge, plus the nearest edge point and the edge index.
  function edgeNearest(p, pts) {
    let best = { d: Infinity, x: p.x, y: p.y, i: 0 };
    for (let i = 0; i < pts.length; i++) {
      const r = nearestOnSeg(p, pts[i], pts[(i + 1) % pts.length]);
      if (r.d < best.d) best = { ...r, i };
    }
    return best;
  }
  function polyArea(pts) {
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    return Math.abs(s / 2);
  }
  // Drawing order: big areas underneath, spots on top, larger before smaller.
  function zOrdered() {
    return levelCallouts()
      .map((c) => ({ c, a: polyArea(ptsOf(c)) }))
      .sort((u, v) => (!!v.c.area - !!u.c.area) || v.a - u.a)
      .map((u) => u.c);
  }
  // The topmost zone under a point (the smallest one that contains it).
  function calloutAt(p) {
    let best = null, bestA = Infinity;
    for (const c of levelCallouts()) {
      const pts = ptsOf(c);
      if (!pointInPoly(p, pts)) continue;
      const a = polyArea(pts) * (c.area ? 1000 : 1);
      if (a < bestA) { best = c; bestA = a; }
    }
    return best;
  }

  // Screen-reader status: #sr-status lives outside the re-rendered panel, so nothing cuts it off.
  // Clearing first lets the same sentence be announced twice in a row.
  let srTimer;
  function announce(msg) {
    const n = $("#sr-status");
    clearTimeout(srTimer);
    n.textContent = "";
    srTimer = setTimeout(() => { n.textContent = msg; }, 60);
  }
  let searchTimer;
  function announceMatches(n) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => announce(n ? `${n} callout${n === 1 ? "" : "s"} match` : "No callout matches"), 600);
  }

  let toastTimer;
  function toast(msg, ms = 1800) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // Leaving an answered, unfinished round takes a second identical action within LEAVE_MS.
  const LEAVE_MS = 3000;
  let leaveAsk = null;
  function canLeave(key) {
    const q = state.quiz;
    const busy = (q && !q.done && q.results.length) || Object.values(EXT).some((x) => x.busy && x.busy());
    if (!busy) return true;
    if (leaveAsk && leaveAsk.key === key && Date.now() - leaveAsk.t < LEAVE_MS) { leaveAsk = null; return true; }
    leaveAsk = { key, t: Date.now() };
    toast("Round in progress \u2014 click again to leave", LEAVE_MS);
    return false;
  }

  // ---------- progress ----------
  // The record a quiz mode trains; Explore and Edit read Find it's.
  const progMode = (mode) => (mode === "name" ? "name" : "find");
  // A callout's record for one mode, or undefined if that mode never asked it.
  function recOf(mapId, id, mode) {
    const r = progress[mapId] && progress[mapId][id];
    return r ? r[progMode(mode)] : undefined;
  }
  function rec(mapId, id, mode) {
    const P = (progress[mapId] = progress[mapId] || {});
    const r = (P[id] = P[id] || {});
    return (r[progMode(mode)] = r[progMode(mode)] || { s: 0, c: 0, k: 0 });
  }
  function score(mapId, id, ok, mode) {
    const r = rec(mapId, id, mode);
    r.s += 1;
    if (ok) { r.c += 1; r.k += 1; } else { r.k = 0; }
    store.set(K.progress, progress);
  }
  function calloutMastery(mapId, id, mode) {
    const r = recOf(mapId, id, mode);
    return r ? Math.min(r.k, MASTER_STREAK) / MASTER_STREAK : 0;
  }
  // Learned = streak of MASTER_STREAK or more; learning = seen but not learned; fresh = never asked.
  function mapCounts(m, mode) {
    const n = { learned: 0, learning: 0, fresh: 0, total: m.callouts.length };
    for (const c of m.callouts) {
      const r = recOf(m.id, c.id, mode);
      if (!r || !r.s) n.fresh++;
      else if (r.k >= MASTER_STREAK) n.learned++;
      else n.learning++;
    }
    return n;
  }
  function calloutStatus(r) {
    if (!r || !r.s) return "Not drilled yet";
    return r.k >= MASTER_STREAK ? "Learned" : `${r.k} of ${MASTER_STREAK} in a row`;
  }
  // Up to this share of a round goes to seen callouts on a zero streak, most-missed first.
  const WEAK_SHARE = 0.4;
  // Weak callouts come back first; the rest is a weighted pick where weak seen callouts outweigh unseen ones.
  function pickRound(pool, n) {
    const mode = state.mode, R = (c) => recOf(state.map.id, c.id, mode);
    const misses = (c) => R(c).s - R(c).c;
    n = Math.min(n, pool.length);
    const weak = shuffle(pool.filter((c) => R(c) && R(c).s > 0 && R(c).k === 0)).sort((a, b) => misses(b) - misses(a));
    const picked = weak.slice(0, Math.floor(n * WEAK_SHARE));
    const rest = pool.filter((c) => !picked.includes(c)).map((c) => {
      const r = R(c);
      const w = r ? 1 + 4 * (1 - calloutMastery(state.map.id, c.id, mode)) + Math.min(r.s - r.c, 4) : 3;
      return { c, key: Math.pow(Math.random(), 1 / w) };
    });
    rest.sort((a, b) => b.key - a.key);
    return shuffle(picked.concat(rest.slice(0, n - picked.length).map((i) => i.c)));
  }

  // ---------- view / pan / zoom ----------
  // setView jumps (wheel, pinch, drag, restoring). goView animates (buttons, keys, framing a zone or line-up).
  function clampView(v) {
    const minW = 70, maxW = 1500;
    const k = Math.min(Math.max(v[2], minW), maxW) / v[2];
    const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
    const nw = v[2] * k, nh = v[3] * k;
    return [cx - nw / 2, cy - nh / 2, nw, nh];
  }
  function applyView(v) {
    state.view = v;
    svg.setAttribute("viewBox", v.join(" "));
    rescaleMarks();
  }
  function setView(v) { stopView(); applyView(clampView(v)); }
  function fitView() { goView(state.map.view.slice()); }
  // Where the view is headed: the running animation's end, else the current view. Relative moves build on it.
  function viewTarget() { return viewAnim ? viewAnim.to : state.view; }
  // svg units per screen px
  function unitOf(v) {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    return Math.max(v[2] / r.width, v[3] / r.height);
  }
  function unit() { return unitOf(state.view); }

  // Smooth zoom and pan (van Wijk & Nuij 2003, as in d3.interpolateZoom): a long move zooms out, travels
  // and zooms back in, and a zoom with no pan just scales. It runs on the visible area (centre and width
  // on screen), since the svg letterboxes the viewBox, then lands on the exact target viewBox.
  // Speed along the path is a cubic with start slope m that never overshoots for m in [0, 3]: m = 3 is
  // ease-out (short zooms move on the press), m = 0.75 is close to Material's standard curve (long flights).
  const RHO = Math.SQRT2, REDUCE_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
  const ease = (t, m) => t * (m + t * ((3 - 2 * m) + t * (m - 2)));
  const dease = (t, m) => m + t * (2 * (3 - 2 * m) + 3 * t * (m - 2));
  let viewAnim = null;
  function stopView() { if (viewAnim) { cancelAnimationFrame(viewAnim.raf); viewAnim = null; } }
  function goView(v) {
    const to = clampView(v), r = svg.getBoundingClientRect(), prev = viewAnim, now0 = performance.now();
    stopView();
    if (REDUCE_MOTION.matches || !r.width || !r.height) return applyView(to);
    const from = state.view;
    const ux0 = from[0] + from[2] / 2, uy0 = from[1] + from[3] / 2, w0 = unitOf(from) * r.width;
    const ux1 = to[0] + to[2] / 2, uy1 = to[1] + to[3] / 2, w1 = unitOf(to) * r.width;
    const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy, d1 = Math.sqrt(d2);
    let S, at;
    if (d1 < 1e-6 * w0) {
      // Same centre: scale only.
      S = Math.log(w1 / w0) / RHO;
      at = (s) => [ux0, uy0, w0 * Math.exp(RHO * s * S)];
    } else {
      const R2 = RHO * RHO, R4 = R2 * R2;
      const b0 = (w1 * w1 - w0 * w0 + R4 * d2) / (2 * w0 * R2 * d1);
      const b1 = (w1 * w1 - w0 * w0 - R4 * d2) / (2 * w1 * R2 * d1);
      const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      const c0 = Math.cosh(r0), s0 = Math.sinh(r0);
      S = (r1 - r0) / RHO;
      at = (s) => {
        const a = RHO * s * S + r0;
        const u = (w0 / (R2 * d1)) * (c0 * Math.tanh(a) - s0);
        return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(a)];
      };
    }
    const len = Math.abs(S);
    if (!isFinite(len) || len < 1e-3) return applyView(to);
    const zoomOnly = d1 < 1e-6 * w0;
    const ms = Math.min(180 + 300 * len, 700), aspect = r.height / r.width;
    // A press during a flight carries its speed over, so repeated zooms keep pace instead of stuttering.
    // Reversing a zoom (in, then out) starts fresh.
    let carried = 0;
    if (prev && prev.t0 != null && !(prev.zoomOnly && zoomOnly && Math.sign(prev.S) !== Math.sign(S))) {
      const t = Math.min(Math.max((now0 - prev.t0) / prev.ms, 0), 1);
      carried = (dease(t, prev.m) * prev.len) / prev.ms;
    }
    const m = Math.min(3, Math.max(len < 0.4 ? 3 : 0.75, (carried * ms) / len));
    // The clock starts on the first frame, counted as one frame in so the view moves at once. (A rAF
    // timestamp can predate the click, and a negative t would step ease-out backwards.)
    const step = (now) => {
      if (viewAnim.t0 == null) viewAnim.t0 = now - 1000 / 60;
      const t = Math.min(Math.max((now - viewAnim.t0) / ms, 0), 1);
      if (t >= 1) { viewAnim = null; return applyView(to); }
      const [cx, cy, w] = at(ease(t, m)), h = w * aspect;
      applyView([cx - w / 2, cy - h / 2, w, h]);
      viewAnim.raf = requestAnimationFrame(step);
    };
    viewAnim = { to, t0: null, ms, len, m, S, zoomOnly, raf: requestAnimationFrame(step) };
  }
  function zoomAt(factor, cx, cy) {
    const [x, y, w, h] = state.view;
    const nw = w / factor, nh = h / factor;
    setView([cx - (cx - x) * (nw / w), cy - (cy - y) * (nh / h), nw, nh]);
  }
  // Buttons and keys: animated, and repeated presses stack on where the view is headed.
  function zoomCenter(factor) {
    const [x, y, w, h] = viewTarget(), nw = w / factor, nh = h / factor;
    goView([x + (w - nw) / 2, y + (h - nh) / 2, nw, nh]);
  }
  function centerOn(p, minZoom) {
    let [, , w, h] = viewTarget();
    if (minZoom) {
      const fitW = state.map.view[2];
      if (w > fitW / minZoom) { const k = (fitW / minZoom) / w; w *= k; h *= k; }
    }
    goView([p.x - w / 2, p.y - h / 2, w, h]);
  }
  function ensureVisible(p) {
    // The svg letterboxes the viewBox, so the visible area can be wider or taller than it.
    const v = viewTarget(), r = svg.getBoundingClientRect(), u = unitOf(v);
    const w = r.width * u || v[2], h = r.height * u || v[3];
    const x = v[0] + v[2] / 2 - w / 2, y = v[1] + v[3] / 2 - h / 2;
    const m = Math.min(w, h) * 0.03;
    if (p.x < x + m || p.x > x + w - m || p.y < y + m || p.y > y + h - m) centerOn(p);
  }
  function clientToSvg(cx, cy, ctm) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform((ctm || svg.getScreenCTM()).inverse());
  }

  // pointer handling: pan, pinch, click, drag edit handles
  const pointers = new Map();
  let gesture = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    stopView();
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const handle = state.mode === "edit" && e.target.closest && e.target.closest(".vertex, .anchor");
      const ctm = svg.getScreenCTM();
      gesture = {
        type: "maybe", start: { x: e.clientX, y: e.clientY }, ctm, view0: state.view.slice(),
        p0: clientToSvg(e.clientX, e.clientY, ctm),
      };
      const sel = state.mode === "edit" && selectedCallout();
      if (handle) {
        const c = sel;
        if (handle.classList.contains("vertex")) {
          gesture.type = "vertex";
          gesture.i = Number(handle.dataset.i);
          gesture.rect = isRect(c);
          gesture.orig = flatOf(c);
          state.vertex = gesture.i;
          c.poly = flatOf(c);
          renderHandles();
        } else {
          gesture.type = "anchor";
          // Keep the grab offset, since the handle is drawn above the label point.
          gesture.off = { x: c.x - gesture.p0.x, y: c.y - gesture.p0.y };
        }
        gesture.moved = false;
      } else if (sel && sel.level === state.level && (calloutAt(gesture.p0) || {}).id === sel.id) {
        // Dragging inside the selected zone moves the whole zone and its name.
        gesture.type = "zone";
        gesture.orig = flatOf(sel);
        gesture.xy = { x: sel.x, y: sel.y };
        gesture.moved = false;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), view0: state.view.slice(), ctm: svg.getScreenCTM(),
        mid0: clientToSvg((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) {
      if (e.pointerType === "mouse") hoverAt(clientToSvg(e.clientX, e.clientY));
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.type === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = gesture.d0 / d;
      const [x, y, w, h] = gesture.view0;
      const m = gesture.mid0;
      const nw = w * k, nh = h * k;
      state.view = [m.x - (m.x - x) * k, m.y - (m.y - y) * k, nw, nh];
      setView(state.view);
      return;
    }
    if (gesture.type === "maybe" && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) > 6) {
      gesture.type = "pan";
      svg.classList.add("is-panning");
    }
    if (gesture.type === "pan") {
      const p = clientToSvg(e.clientX, e.clientY, gesture.ctm);
      const [x, y, w, h] = gesture.view0;
      setView([x - (p.x - gesture.p0.x), y - (p.y - gesture.p0.y), w, h]);
    } else if (gesture.type === "vertex" || gesture.type === "anchor" || gesture.type === "zone") {
      const p = clientToSvg(e.clientX, e.clientY);
      const x = Math.round(Math.max(0, Math.min(1024, p.x))), y = Math.round(Math.max(0, Math.min(1024, p.y)));
      const c = selectedCallout();
      if (!c) return;
      if (!gesture.moved && Math.hypot(e.clientX - gesture.start.x, e.clientY - gesture.start.y) < 3) return;
      gesture.moved = true;
      if (gesture.type === "vertex") {
        const i = gesture.i, o = gesture.orig;
        c.poly[i * 2] = x; c.poly[i * 2 + 1] = y;
        if (gesture.rect) {
          // Keep rectangles rectangular: the neighbours follow the dragged corner.
          const prev = (i + 3) % 4, next = (i + 1) % 4;
          const prevSharesX = o[prev * 2] === o[i * 2];
          if (prevSharesX) { c.poly[prev * 2] = x; c.poly[next * 2 + 1] = y; }
          else { c.poly[prev * 2 + 1] = y; c.poly[next * 2] = x; }
        }
      } else if (gesture.type === "zone") {
        const dx = Math.round(p.x - gesture.p0.x), dy = Math.round(p.y - gesture.p0.y);
        c.poly = gesture.orig.map((v, k) => v + (k % 2 ? dy : dx));
        c.x = gesture.xy.x + dx; c.y = gesture.xy.y + dy;
      } else {
        c.x = Math.round(Math.max(0, Math.min(1024, p.x + gesture.off.x)));
        c.y = Math.round(Math.max(0, Math.min(1024, p.y + gesture.off.y)));
      }
      updateZoneDom(c);
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === "maybe" && pointers.size === 0) {
      const p = clientToSvg(e.clientX, e.clientY);
      onMapClick(p);
    } else if (gesture.type === "vertex" || gesture.type === "anchor" || gesture.type === "zone") {
      if (gesture.moved) commitEdit(selectedCallout());
      else if (gesture.type === "zone") onMapClick(clientToSvg(e.clientX, e.clientY));
      else renderPanel();
    }
    if (pointers.size === 0) { gesture = null; svg.classList.remove("is-panning"); }
    else if (gesture.type === "pinch") { gesture = null; }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("pointerleave", () => setHover(null));
  // Edit: double-click near the selected zone's edge to add a point there.
  svg.addEventListener("dblclick", (e) => {
    if (state.mode !== "edit") return;
    const c = selectedCallout();
    if (!c) return;
    const p = clientToSvg(e.clientX, e.clientY);
    const hit = edgeNearest(p, ptsOf(c));
    if (hit.d > 14 * unit()) return;
    insertVertex(c, hit.i, Math.round(hit.x), Math.round(hit.y));
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = clientToSvg(e.clientX, e.clientY);
    const factor = Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1));
    zoomAt(factor, p.x, p.y);
  }, { passive: false });
  $("#zoomIn").onclick = () => zoomCenter(1.4);
  $("#zoomOut").onclick = () => zoomCenter(1 / 1.4);
  $("#zoomReset").onclick = fitView;
  window.addEventListener("resize", rescaleMarks);
  window.addEventListener("resize", updateMapFades);
  $("#mapList").addEventListener("scroll", updateMapFades, { passive: true });
  if (document.fonts) document.fonts.ready.then(updateMapFades);
  for (const b of document.querySelectorAll(".maps-more")) {
    b.onclick = () => {
      const nav = $("#mapList");
      nav.scrollBy({ left: b.dataset.dir * nav.clientWidth * 0.7, behavior: "smooth" });
    };
  }

  // ---------- rendering the radar ----------
  function levelCallouts() { return state.map.callouts.filter((c) => c.level === state.level); }

  // Zones and their names (Explore and Edit). Quizzes draw only feedback.
  function renderMarkers() {
    layerZones.textContent = "";
    layerMarkers.textContent = "";
    layerEdit.textContent = "";
    state.hover = null;
    // An extra mode with zones: true gets the zones as a backdrop (no names unless hovered or selected).
    const showAll = state.mode === "explore" || state.mode === "edit" || !!(ext() && ext().zones);
    svg.classList.toggle("show-labels", state.mode === "edit" || (state.mode === "explore" && prefs.labels));
    if (!showAll) return;
    const q = state.search.trim().toLowerCase();
    const order = zOrdered();
    for (const c of order) {
      const z = el("polygon", { class: "zone " + (c.area ? "zone-area" : "zone-spot"), points: ptsStr(c), "data-id": c.id }, layerZones);
      if (c.id === state.selected) z.classList.add("is-active");
      if (q && !matches(c, q)) z.classList.add("is-dim");
    }
    for (const c of order) {
      const t = el("text", { class: "label" + (c.area ? " label-area" : ""), x: c.x, y: c.y, "data-id": c.id }, layerMarkers);
      t.textContent = c.name;
      if (c.id === state.selected) t.classList.add("is-active");
      if (q && !matches(c, q)) t.classList.add("is-dim");
    }
    if (state.mode === "edit") renderHandles();
    rescaleMarks();
  }
  function selectedCallout() { return state.map && state.map.callouts.find((c) => c.id === state.selected); }
  // Corner points and the name handle of the selected zone (Edit).
  function renderHandles() {
    layerEdit.textContent = "";
    const c = selectedCallout();
    if (!c || c.level !== state.level) return;
    ptsOf(c).forEach((p, i) => {
      el("circle", { class: "vertex" + (i === state.vertex ? " is-active" : ""), cx: p.x, cy: p.y, "data-i": i, "data-r": i === state.vertex ? 6.5 : 5 }, layerEdit);
    });
    // The name handle sits a fixed ANCHOR_PX above the label, so a drag on the label (or the middle of a small zone) moves the zone.
    el("circle", { class: "anchor", cx: c.x, cy: c.y, "data-y": c.y, "data-oy": -ANCHOR_PX, "data-r": 7 }, layerEdit);
    rescaleMarks();
  }
  function setHover(id) {
    if (state.hover === id) return;
    for (const n of svg.querySelectorAll(".is-hover")) n.classList.remove("is-hover");
    state.hover = id;
    scheduleDeclutter();
    if (!id) return;
    for (const n of svg.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) n.classList.add("is-hover");
  }
  let hoverFrame = 0;
  function hoverAt(p) {
    if (state.mode !== "explore" && state.mode !== "edit") return;
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => { const c = calloutAt(p); setHover(c ? c.id : null); });
  }
  function rescaleMarks() {
    if (!state.map) return;
    const u = unit();
    layerMarkers.querySelectorAll("text").forEach((t) => {
      t.setAttribute("font-size", (t.classList.contains("label-area") ? 14.5 : 13) * u);
      t.setAttribute("stroke-width", 3.5 * u);
      t.setAttribute("dy", 4.5 * u);
    });
    layerEdit.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Number(n.dataset.r) * u));
    layerEdit.querySelectorAll("[data-oy]").forEach((n) => n.setAttribute("cy", Number(n.dataset.y) + Number(n.dataset.oy) * u));
    layerFb.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Number(n.dataset.r) * u));
    layerFb.querySelectorAll("text").forEach((t) => {
      t.setAttribute("font-size", 16 * u);
      t.setAttribute("stroke-width", 3.5 * u);
      t.setAttribute("dx", t.dataset.dx * u);
      t.setAttribute("dy", t.dataset.dy * u);
    });
    if (EXT[state.mode] && EXT[state.mode].rescale) EXT[state.mode].rescale(u);
    scheduleDeclutter();
  }

  // ---------- label declutter ----------
  // Labels are a constant size on screen, so with all names on they collide. A greedy pass shows the
  // most important labels first and hides (never removes) any label that would overlap one already shown.
  // Order: quiz feedback labels (the last drawn first), selected, hovered, then areas and spots by zone size.
  const LABEL_PAD = 2;           // screen px of air kept between labels
  const labelBoxes = new Map();  // "size|text" -> {w, a, d} in screen px, measured once per label size
  let measureCtx = null, declutterFrame = 0;
  function labelBox(text, size) {
    const key = size + "|" + text;
    let b = labelBoxes.get(key);
    if (!b) {
      if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
      const ff = getComputedStyle(document.documentElement).getPropertyValue("--display") || "sans-serif";
      measureCtx.font = `600 ${size}px ${ff}`;
      const m = measureCtx.measureText(text);
      b = { w: m.width, a: m.fontBoundingBoxAscent || size * 0.95, d: m.fontBoundingBoxDescent || size * 0.3 };
      labelBoxes.set(key, b);
    }
    return b;
  }
  // Web fonts can arrive after the first measurement.
  if (document.fonts) document.fonts.addEventListener("loadingdone", () => { labelBoxes.clear(); scheduleDeclutter(); });
  function scheduleDeclutter() {
    if (declutterFrame) return;
    declutterFrame = requestAnimationFrame(() => { declutterFrame = 0; declutter(); });
  }
  function declutter() {
    if (!state.map) return;
    const u = unit();
    const showAll = svg.classList.contains("show-labels");
    const size = new Map(levelCallouts().map((c) => [c.id, polyArea(ptsOf(c))]));
    const items = [];
    const fb = layerFb.querySelectorAll("text");
    fb.forEach((t, i) => items.push({ t, rank: 0, key: i, size: 16 }));
    layerMarkers.querySelectorAll("text").forEach((t) => {
      const cl = t.classList;
      if (cl.contains("is-dim") || !(showAll || cl.contains("is-hover") || cl.contains("is-active"))) { cl.remove("is-hidden"); return; }
      const rank = cl.contains("is-active") ? 1 : cl.contains("is-hover") ? 2 : cl.contains("label-area") ? 3 : 4;
      items.push({ t, rank, key: -(size.get(t.dataset.id) || 0), size: cl.contains("label-area") ? 14.5 : 13 });
    });
    // Feedback labels drawn later (the answer, the focused zone) win over earlier ones.
    items.sort((a, b) => a.rank - b.rank || (a.rank === 0 ? b.key - a.key : a.key - b.key));
    const placed = [];
    for (const it of items) {
      const t = it.t, b = labelBox(t.textContent, it.size);
      const dx = Number(t.dataset.dx || 0), dy = t.dataset.dy != null ? Number(t.dataset.dy) : 4.5;
      const x = Number(t.getAttribute("x")) / u + dx, y = Number(t.getAttribute("y")) / u + dy;
      const r = { l: x - b.w / 2 - LABEL_PAD, r: x + b.w / 2 + LABEL_PAD, t: y - b.a - LABEL_PAD, b: y + b.d + LABEL_PAD };
      const hit = placed.some((p) => r.l < p.r && p.l < r.r && r.t < p.b && p.t < r.b);
      t.classList.toggle("is-hidden", hit);
      if (!hit) placed.push(r);
    }
  }
  function fbCircle(cls, p, r) { return el("circle", { class: cls, cx: p.x, cy: p.y, "data-r": r }, layerFb); }
  // Every feedback shape sits on a dark casing, so its colour reads on light and dark floors alike.
  function fbPoly(cls, c) {
    el("polygon", { class: "fb-casing", points: ptsStr(c) }, layerFb);
    return el("polygon", { class: cls, points: ptsStr(c) }, layerFb);
  }
  function fbLine(a, b) {
    const pts = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    el("line", { class: "fb-casing", ...pts }, layerFb);
    return el("line", { class: "fb-line", ...pts }, layerFb);
  }
  // Name it: zoom in until a small target is about TARGET_PX on screen (but never so far that it overflows).
  const TARGET_PX = 60;
  function showTarget(c) {
    const pts = ptsOf(c), r = svg.getBoundingClientRect(), u = unitOf(viewTarget());
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
    const want = r.width && r.height ? Math.max(Math.min(bw, bh) / TARGET_PX, bw / (0.7 * r.width), bh / (0.7 * r.height)) : u;
    if (want >= u) return ensureVisible(zoneCenter(c));
    const p = zoneCenter(c), k = want / u, [, , w, h] = viewTarget();
    goView([p.x - (w * k) / 2, p.y - (h * k) / 2, w * k, h * k]);
  }
  // Centre of a zone's bounding box, for keeping it in view.
  function zoneCenter(c) {
    const pts = ptsOf(c);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  function fbLabel(p, text, dx = 12, dy = -10) {
    const t = el("text", { class: "fb-label", x: p.x, y: p.y, "data-dx": dx, "data-dy": dy }, layerFb);
    t.textContent = text;
    return t;
  }
  function clearFeedback() { layerFb.textContent = ""; }

  function setLevel(lv, refit) {
    if (!state.map.levels.includes(lv)) lv = "upper";
    state.level = lv;
    img.setAttribute("href", state.map.radar[lv]);
    const box = $("#levels");
    box.textContent = "";
    if (state.map.levels.length > 1) {
      for (const l of state.map.levels) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = l === "lower" ? "Lower" : "Upper";
        b.setAttribute("aria-pressed", String(l === lv));
        b.onclick = () => { if (state.quiz && !state.quiz.done) return toast("The quiz picks the level for you."); setLevel(l); renderMarkers(); renderPanel(); };
        box.appendChild(b);
      }
    }
    svg.setAttribute("aria-label", `${state.map.name} radar${lv === "lower" ? ", lower level" : ""}`);
    syncLevelButtons();
    // A new map or level swaps the radar image, so the view jumps rather than flies.
    if (refit) setView(state.map.view.slice());
  }
  // During an unfinished round the quiz picks the level, so the buttons say they're off.
  function syncLevelButtons() {
    const locked = !!state.quiz && !state.quiz.done;
    for (const b of document.querySelectorAll("#levels button")) {
      if (locked) { b.setAttribute("aria-disabled", "true"); b.title = "The quiz picks the level"; }
      else { b.removeAttribute("aria-disabled"); b.removeAttribute("title"); }
    }
  }

  // ---------- map list ----------
  function renderMapList() {
    const nav = $("#mapList");
    nav.textContent = "";
    for (const m of MAPS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "map-btn";
      b.setAttribute("aria-current", String(state.map && m.id === state.map.id));
      // Map buttons follow Find it, the harder drill.
      const n = mapCounts(m, "find");
      b.title = `${m.name}: ${n.learned} / ${n.total} learned in Find it`;
      b.innerHTML = `${esc(m.name)}<span class="mastery"><i style="width:${n.total ? (100 * n.learned) / n.total : 0}%"></i></span>`;
      b.onclick = () => { if (m.id !== state.map.id && canLeave("map:" + m.id)) selectMap(m.id); };
      nav.appendChild(b);
    }
    updateMapFades();
  }

  // Show an edge fade only on the side(s) where more maps are scrolled out of view.
  function updateMapFades() {
    const nav = $("#mapList"), wrap = $("#mapsWrap");
    const max = nav.scrollWidth - nav.clientWidth;
    wrap.classList.toggle("fade-l", nav.scrollLeft > 1);
    wrap.classList.toggle("fade-r", nav.scrollLeft < max - 1);
  }

  function selectMap(id, keepMode) {
    const m = MAPS.find((x) => x.id === id) || MAPS[0];
    extLeave();
    state.map = m;
    state.selected = null;
    state.search = "";
    state.quiz = null;
    prefs.map = m.id;
    store.set(K.prefs, prefs);
    clearFeedback();
    setLevel("upper", true);
    renderMapList();
    if (!keepMode) go({ tool: state.tool }, true); else { renderMarkers(); renderPanel(); }
    updateHash();
    const cur = $("#mapList .map-btn[aria-current='true']");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------- navigation: content × learning mode, plus the tools ----------
  // next: any of { content, learn, tool }; what it leaves out stays, except tool, which closes.
  // Edit only works on callouts. Switching content drops the selection and the search; map, level and zoom stay.
  function go(next, quiet) {
    const t = { content: state.content, learn: state.learn, tool: null, ...next };
    if (t.tool === "edit") t.content = "callouts";
    const f = document.activeElement;
    const fromNav = !!f && !!f.closest && !!f.closest(".panel-nav, .edit-link");
    extLeave();
    if (t.content !== state.content) { state.selected = null; state.search = ""; state.vertex = null; }
    state.content = t.content;
    state.learn = t.learn;
    state.tool = t.tool;
    state.mode = t.tool || (t.content === "smokes" ? "smokes" : t.learn);
    state.quiz = null;
    prefs.content = t.content;
    prefs.mode = t.learn;
    store.set(K.prefs, prefs);
    document.body.className = t.tool ? "mode-" + t.tool : `content-${t.content} mode-${t.learn}`;
    syncNav();
    clearFeedback();
    renderMarkers();
    renderPanel();
    updateHash();
    // Focus stays on the control that switched; if it is gone (Done, the Edit link), it lands on the nearest one.
    if (fromNav) {
      const to = f.isConnected && f.offsetParent ? f : state.tool ? $("[data-tool-done]") : $("#tab-" + state.learn);
      to.focus({ preventScroll: true });
    }
    if (!quiet) announce(navName());
  }
  const navName = () => state.tool === "live" ? "Live round clock"
    : state.tool === "edit" ? `Editing ${state.map.name} zones`
    : `${state.content === "smokes" ? "Smokes" : "Callouts"} · ${LEARN_NAME[state.learn]}`;

  // Pressed content, selected tab, the "soon" tag on smokes Name it, the tool head and the panel's role.
  function syncNav() {
    const tool = state.tool;
    document.querySelectorAll(".content-seg button").forEach((b) => {
      const on = b.dataset.content === state.content;
      b.setAttribute("aria-pressed", String(on && !tool));
      b.tabIndex = on ? 0 : -1;
    });
    $(".nav-tool[data-tool='live']").setAttribute("aria-pressed", String(tool === "live"));
    $(".modes").hidden = !!tool;
    document.querySelectorAll(".modes [role='tab']").forEach((b) => {
      const on = b.dataset.mode === state.learn;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    const nameTab = $("#tab-name"), soon = state.content === "smokes", tag = nameTab.querySelector(".soon");
    nameTab.toggleAttribute("data-soon", soon);
    if (soon) {
      nameTab.setAttribute("aria-label", "Name it, coming soon for smokes");
      if (!tag) nameTab.insertAdjacentHTML("beforeend", `<span class="soon" aria-hidden="true">soon</span>`);
    } else {
      nameTab.removeAttribute("aria-label");
      if (tag) tag.remove();
    }
    $(".tool-head").hidden = !tool;
    if (tool) {
      $(".tool-title").textContent = navName();
      panel.setAttribute("role", "region");
      panel.setAttribute("aria-label", tool === "live" ? "Live" : "Edit zones");
      panel.removeAttribute("aria-labelledby");
    } else {
      panel.setAttribute("role", "tabpanel");
      panel.removeAttribute("aria-label");
      panel.setAttribute("aria-labelledby", "tab-" + state.learn);
    }
  }

  // Every switch asks canLeave first, so an answered round (or a running Live clock) needs a second click.
  document.querySelectorAll(".content-seg button").forEach((b) => (b.onclick = () => {
    const c = b.dataset.content;
    if ((c !== state.content || state.tool) && canLeave("content:" + c)) go({ content: c });
  }));
  document.querySelectorAll(".modes [role='tab']").forEach((b) => (b.onclick = () => {
    const m = b.dataset.mode;
    if (m !== state.learn && canLeave("mode:" + m)) go({ learn: m });
  }));
  $(".nav-tool[data-tool='live']").onclick = () => {
    if (canLeave("tool:live")) go({ tool: state.tool === "live" ? null : "live" });
  };
  $("[data-tool-done]").onclick = () => { if (canLeave("tool:done")) go({}); };
  // The Edit zones link lives in the (re-rendered) panel footer.
  panel.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".edit-link");
    if (b && state.tool !== "edit" && canLeave("tool:edit")) go({ tool: "edit" });
  });
  // Each row is one Tab stop: arrows, Home and End move focus inside it; Enter or Space switches.
  document.querySelectorAll(".content-seg, .modes").forEach((row) => row.addEventListener("keydown", (e) => {
    const bs = [...row.querySelectorAll("button")], i = bs.indexOf(document.activeElement), n = bs.length;
    if (i < 0) return;
    const j = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (j == null) return;
    e.preventDefault();
    bs[j].focus();
  }));

  function updateHash() {
    if (!state.map) return;
    // #mirage/find, #mirage/smokes/find, #mirage/live. Smokes Explore can add a line-up id.
    const x = ext(), arg = x && x.hashArg ? x.hashArg() : "";
    const path = state.tool || (state.content === "smokes" ? "smokes/" + state.learn : state.learn);
    const h = `#${state.map.id}/${path}${arg ? "/" + arg : ""}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function renderPanel() {
    // Body flags let the narrow layout fit a whole quiz step on screen.
    const q = state.quiz, step = !!q && !q.done && (state.mode === "find" || state.mode === "name");
    document.body.classList.toggle("quiz-step", step);
    document.body.classList.toggle("quiz-answered", step && q.answered);
    syncLevelButtons();
    $("#stagePrompt").textContent = "";
    $("#stagePrompt").classList.remove("is-find");
    if (state.mode === "explore") return renderExplore();
    if (state.mode === "edit") return renderEdit();
    if (EXT[state.mode]) return EXT[state.mode].render();
    return renderQuiz();
  }

  // Local edits change quiz answers, so the Edit zones link shows how many the current map has.
  function editCount(m) { return edits[m.id] ? Object.keys(edits[m.id]).length : 0; }

  // Callout views only. The footer's last sentence is the way into Edit (left out in Edit itself).
  function footer() {
    const n = editCount(state.map);
    const link = state.mode === "edit" ? "."
      : `; if one is off, fix it in <button type="button" class="link-btn edit-link${n ? " has-edits" : ""}" data-tool="edit"${
        n ? ` aria-label="Edit zones, ${n} local edit${n === 1 ? "" : "s"} on ${esc(state.map.name)}"` : ""}>${n ? `Edit zones · ${n}` : "Edit zones"}</button>.`;
    return `<div class="foot">Callout names follow <a href="https://totalcsgo.com/callouts" target="_blank" rel="noopener">Total CS</a>. Radar images come from the CS2 game files. Zones were generated from the radar and placed by hand${link}</div>`;
  }

  function matches(c, q) {
    return c.name.toLowerCase().includes(q) || c.alt.some((a) => a.toLowerCase().includes(q));
  }

  // Status of one callout in each quiz mode, e.g. "Find it: Learned. Name it: 2 of 3 in a row."
  function modeStatus(mapId, id, mode) {
    const r = recOf(mapId, id, mode);
    const ratio = r && r.s ? ` <span class="lifetime">${r.c} of ${r.s} right overall.</span>` : "";
    return `<span class="mode-st">${mode === "name" ? "Name it" : "Find it"}: <span class="status">${calloutStatus(r)}.</span>${ratio}</span>`;
  }
  function calloutCard(c, cls = "") {
    return `<div class="card ${cls}">
      <h3>${esc(c.name)}</h3>
      ${c.alt.length ? `<p class="alt">Also called ${c.alt.map(esc).join(", ")}</p>` : ""}
      <p class="desc">${esc(c.desc)}</p>
      <div class="meta">${state.map.levels.length > 1 ? `<span class="mode-st">${esc(levelName(c.level))}.</span>` : ""}${modeStatus(state.map.id, c.id, "find")}${modeStatus(state.map.id, c.id, "name")}</div>
    </div>`;
  }

  // ----- Explore -----
  function renderExplore() {
    const m = state.map;
    const q = state.search.trim().toLowerCase();
    const list = m.callouts.slice().sort((a, b) => a.name.localeCompare(b.name)).filter((c) => !q || matches(c, q));
    const sel = m.callouts.find((c) => c.id === state.selected);
    panel.innerHTML = `
      <p class="lede">${m.callouts.length} callouts on ${esc(m.name)}. Tap a zone or a name to see where it is and what it means. Study here, then test yourself in Name it and Find it.</p>
      <div class="row">
        <label class="switch"><input type="checkbox" id="labelsToggle" ${prefs.labels ? "checked" : ""}> Show all names on the map</label>
      </div>
      <input class="search" id="search" type="search" placeholder="Search callouts" value="${esc(state.search)}" autocomplete="off" aria-label="Search callouts">
      ${sel ? calloutCard(sel, "is-sticky") : ""}
      <ul class="callout-list" id="list">
        ${list.map((c) => `<li><button type="button" data-id="${c.id}" class="${c.id === state.selected ? "is-active" : ""}">
            <span class="nm">${esc(c.name)}</span>
            ${m.levels.length > 1 && c.level === "lower" ? `<span class="lv">lower</span>` : ""}
            <span class="ms" title="Find it: ${calloutStatus(recOf(m.id, c.id, "find"))}. Name it: ${calloutStatus(recOf(m.id, c.id, "name"))}."><span><i style="width:${calloutMastery(m.id, c.id, "find") * 100}%"></i></span><span><i style="width:${calloutMastery(m.id, c.id, "name") * 100}%"></i></span></span>
          </button></li>`).join("") || `<li class="lede">No callout matches “${esc(state.search)}”.</li>`}
      </ul>
      ${footer()}`;
    // On narrow screens the panel sits below the map, so echo the selection on the stage.
    $("#stagePrompt").innerHTML = sel ? `${esc(sel.name)}<span class="sp-desc">${esc(sel.desc)}</span>` : "";
    $("#labelsToggle").onchange = (e) => { prefs.labels = e.target.checked; store.set(K.prefs, prefs); renderMarkers(); };
    const s = $("#search");
    s.oninput = () => {
      state.search = s.value;
      const pos = s.selectionStart;
      renderExplore();
      announceMatches(panel.querySelectorAll("#list button[data-id]").length);
      renderMarkers();
      const s2 = $("#search"); s2.focus(); s2.setSelectionRange(pos, pos);
    };
    s.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!list.length) return;
        selectCallout(list[0].id, true);
        const s2 = $("#search"); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length);
      } else if (e.key === "Escape") {
        if (!escapeStep()) return;
        e.preventDefault();
        const s2 = $("#search"); if (s2) s2.focus();
      } else if (e.key === "ArrowDown") {
        const b = $("#list button[data-id]");
        if (b) { e.preventDefault(); b.focus(); }
      }
    };
    $("#list").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) selectCallout(b.dataset.id, true); };
  }

  // Escape undoes one thing at a time: the Edit point, then the search, then the selection.
  function escapeStep() {
    if (ext() && ext().escape) return !!ext().escape();
    if (state.mode === "edit" && state.vertex != null) { state.vertex = null; renderHandles(); renderPanel(); return true; }
    if (state.mode === "explore" && state.search) { state.search = ""; renderMarkers(); renderPanel(); return true; }
    if ((state.mode === "explore" || state.mode === "edit") && state.selected) {
      state.selected = null; state.vertex = null; renderMarkers(); renderPanel(); return true;
    }
    return false;
  }

  function selectCallout(id, center) {
    const c = state.map.callouts.find((x) => x.id === id);
    if (!c) return;
    if (state.selected !== id) state.vertex = null;
    state.selected = id;
    if (c.level !== state.level) setLevel(c.level);
    renderMarkers();
    renderPanel();
    if (center) { centerOn(c, 1.8); panel.scrollTop = 0; }
    const active = panel.querySelector(".callout-list .is-active");
    // Narrow screens have no room for a sticky card, so a radar tap brings the card itself into view.
    const card = !center && NARROW.matches && panel.querySelector(".card");
    if (card) card.scrollIntoView({ block: "nearest" });
    else if (active && !center && !NARROW.matches) {
      // Keep the row clear of the sticky card when bringing it into view.
      const card = panel.querySelector(".card.is-sticky");
      panel.style.scrollPaddingTop = card ? `${card.offsetHeight + 28}px` : "";
      active.scrollIntoView({ block: "nearest" });
    }
  }

  // ----- Edit -----
  function renderEdit() {
    const m = state.map;
    const sel = selectedCallout();
    const n = editCount(m);
    const npts = sel ? ptsOf(sel).length : 0;
    panel.innerHTML = `
      <p class="lede">Click a zone to select it. Drag inside it to move it, drag a corner to resize it, and drag the round handle to move its name. Zones don't need to cover the whole map. Changes save in this browser and are used by the quizzes straight away. Export them to update the site for everyone.</p>
      ${sel ? `${calloutCard(sel)}
        <div class="row">
          <span class="field-label">${sel.area ? "Area" : "Spot"}, ${isRect(sel) ? "rectangle" : `${npts}-point shape`}</span><span class="spacer"></span>
          ${isRect(sel)
            ? `<button type="button" class="btn small" id="addPt" title="Turn this zone into a shape with an extra corner">Add corner</button>`
            : `<button type="button" class="btn small" id="addPt">Add point</button>
               <button type="button" class="btn small" id="delPt" ${state.vertex == null || npts <= 3 ? "disabled" : ""}>Delete point</button>
               <button type="button" class="btn small" id="toRect">Make rectangle</button>`}
        </div>
        ${sel.edited ? `<div class="row"><span class="spacer"></span><button type="button" class="btn small quiet" id="undoOne">Undo changes to ${esc(sel.name)}</button></div>` : ""}`
        : `<div class="card"><p class="desc" style="margin:0">Pick a zone on the map to select it.</p></div>`}
      <div class="row">
        <span class="field-label">${n ? `${n} changed on ${esc(m.name)}` : `No changes on ${esc(m.name)} yet`}</span>
        <span class="spacer"></span>
        <button type="button" class="btn small" id="undoEdit" title="Undo the last edit (${UNDO_KEY})" ${canUndo() ? "" : "disabled"}>Undo</button>
      </div>
      <div class="row">
        <button type="button" class="btn primary" id="copyJson">Copy map data</button>
        <button type="button" class="btn" id="dlJson">Download</button>
        <span class="spacer"></span>
        <button type="button" class="btn quiet" id="resetEdits" ${n ? "" : "disabled"}>Discard changes</button>
      </div>
      <p class="lede">The copied data replaces the <strong>callouts</strong> list for ${esc(m.name)} in <code>data/maps.js</code>.</p>
      ${footer()}`;
    if (sel) {
      $("#addPt").onclick = () => {
        const pts = ptsOf(sel);
        // New point halfway along the edge after the active point (or the longest edge).
        let i = state.vertex;
        if (i == null) {
          let best = -1;
          pts.forEach((p, k) => { const d = dist(p, pts[(k + 1) % pts.length]); if (d > best) { best = d; i = k; } });
        }
        const a = pts[i], b = pts[(i + 1) % pts.length];
        insertVertex(sel, i, Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2));
      };
      const dp = $("#delPt");
      if (dp) dp.onclick = () => deleteVertex(sel, state.vertex);
      const tr = $("#toRect");
      if (tr) tr.onclick = () => {
        const pts = ptsOf(sel);
        const xs = pts.map((p) => Math.round(p.x)), ys = pts.map((p) => Math.round(p.y));
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        sel.poly = [x0, y0, x1, y0, x1, y1, x0, y1];
        state.vertex = null;
        commitEdit(sel);
      };
    }
    const u = $("#undoOne");
    if (u) u.onclick = () => { pushUndo("reset of " + sel.name, sel.id); delete edits[m.id][sel.id]; state.vertex = null; saveEdits(); };
    $("#undoEdit").onclick = () => {
      undoEdit();
      // The panel re-renders, so keep keyboard focus on Undo while there is more to undo.
      const b = $("#undoEdit");
      if (b && !b.disabled) b.focus({ preventScroll: true });
    };
    $("#copyJson").onclick = async () => {
      try { await navigator.clipboard.writeText(exportJson()); toast("Map data copied"); }
      catch { const f = downloadJson(true); toast(`Couldn't copy to the clipboard, downloaded ${f} instead.`, 4000); }
    };
    $("#dlJson").onclick = () => downloadJson();
    $("#resetEdits").onclick = () => {
      if (!confirm(`Discard ${n} changed zone${n === 1 ? "" : "s"} on ${m.name}?`)) return;
      pushUndo(`discard of ${n} change${n === 1 ? "" : "s"}`);
      delete edits[m.id]; state.vertex = null; saveEdits(); toast(`Changes discarded. Press ${UNDO_KEY} to undo.`, 3000);
    };
  }
  // Same layout as data/maps.js, so the export can be pasted straight in.
  const fmtJson = (v) => Array.isArray(v) ? "[" + v.map(fmtJson).join(", ") + "]"
    : v && typeof v === "object" ? "{" + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ": " + fmtJson(x)).join(", ") + "}"
    : JSON.stringify(v);
  function exportJson() {
    const m = state.map;
    const rows = m.callouts.map(({ edited, ...c }) => {
      const o = { id: c.id, name: c.name, alt: c.alt, desc: c.desc, x: Math.round(c.x), y: Math.round(c.y), level: c.level };
      if (c.area) o.area = true;
      if (c.poly) o.poly = c.poly.map((v) => Math.round(v));
      return "      " + fmtJson(o);
    });
    return `"callouts": [\n${rows.join(",\n")}\n    ]`;
  }
  function insertVertex(c, afterIndex, x, y) {
    const flat = ptsOf(c).flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
    flat.splice((afterIndex + 1) * 2, 0, x, y);
    c.poly = flat;
    state.vertex = afterIndex + 1;
    commitEdit(c);
  }
  function deleteVertex(c, i) {
    const pts = ptsOf(c);
    if (i == null || pts.length <= 3) return;
    const flat = pts.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
    flat.splice(i * 2, 2);
    c.poly = flat;
    state.vertex = null;
    commitEdit(c);
  }
  // Redraw one zone while it is being dragged, without rebuilding everything.
  function updateZoneDom(c) {
    const id = CSS.escape(c.id);
    const z = layerZones.querySelector(`.zone[data-id="${id}"]`);
    if (z) z.setAttribute("points", ptsStr(c));
    const t = layerMarkers.querySelector(`text[data-id="${id}"]`);
    if (t) { t.setAttribute("x", c.x); t.setAttribute("y", c.y); }
    renderHandles();
  }
  // The export is a snippet for data/maps.js, not a JSON document, so save it as plain text.
  function downloadJson(quiet) {
    const blob = new Blob([exportJson() + "\n"], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.map.id}-callouts.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    if (!quiet) toast("Downloaded " + a.download);
    return a.download;
  }
  // Step undo for Edit: one stack per map of earlier snapshots of that map's edits, kept for the session.
  const UNDO_MAX = 50;
  const undoStacks = {};
  function pushUndo(what, id) {
    const mid = state.map.id, st = undoStacks[mid] || (undoStacks[mid] = []);
    st.push({ what, id, prev: edits[mid] ? JSON.parse(JSON.stringify(edits[mid])) : null });
    if (st.length > UNDO_MAX) st.shift();
  }
  function canUndo() { return !!(undoStacks[state.map.id] || []).length; }
  function undoEdit() {
    const st = undoStacks[state.map.id];
    const u = st && st.pop();
    if (!u) return false;
    if (u.prev) edits[state.map.id] = u.prev; else delete edits[state.map.id];
    state.vertex = null;
    const c = u.id && state.map.callouts.find((x) => x.id === u.id);
    if (c) { state.selected = c.id; if (c.level !== state.level) setLevel(c.level); }
    saveEdits();
    announce("Undid " + u.what);
    return true;
  }
  function commitEdit(c) {
    if (!c) return;
    pushUndo("change to " + c.name, c.id);
    edits[state.map.id] = edits[state.map.id] || {};
    const e = { x: c.x, y: c.y };
    if (c.poly) e.poly = c.poly.slice();
    edits[state.map.id][c.id] = e;
    saveEdits();
  }
  function saveEdits() {
    for (const k in edits) if (!Object.keys(edits[k]).length) delete edits[k];
    store.set(K.edits, edits);
    const keepSel = state.selected, keepView = state.view.slice(), lv = state.level;
    MAPS = buildMaps();
    state.map = MAPS.find((m) => m.id === state.map.id);
    state.selected = keepSel;
    setLevel(lv);
    setView(keepView);
    renderMarkers();
    renderPanel();
  }

  // ----- Quizzes (Find it / Name it) -----
  function renderQuiz() {
    const q = state.quiz;
    // Find it: the target name sits on the radar until you answer (a pill on wide screens).
    const sp = $("#stagePrompt");
    sp.textContent = state.mode === "find" && q && !q.done && !q.answered ? (isRetry() ? "Again: " : "") + current().name : "";
    sp.classList.toggle("is-find", !!sp.textContent);
    if (!q) return renderQuizSetup();
    if (q.done) return renderQuizSummary();
    return state.mode === "find" ? renderFindStep() : renderNameStep();
  }

  function renderQuizSetup() {
    const m = state.map;
    const n = mapCounts(m, state.mode);
    const isFind = state.mode === "find";
    const seen = progress[m.id] && Object.keys(progress[m.id]).length;
    const sizes = [10, 20, 0];
    const ne = editCount(m);
    panel.innerHTML = `
      <p class="lede">${isFind
        ? `You get a callout name. <strong>Click anywhere inside its zone</strong> on the radar.`
        : `A zone lights up on the radar. <strong>Pick its name</strong> from four nearby callouts.`}
        Callouts you keep missing come up more often.</p>
      ${ne ? `<p class="lede">Using your ${ne} local zone edit${ne === 1 ? "" : "s"} on ${esc(m.name)}.</p>` : ""}
      <div class="row"><span class="field-label">Questions</span>
        <div class="seg" id="roundSize">${sizes.map((s) => `<button type="button" data-n="${s}" aria-pressed="${prefs.round === s}">${s || "All " + m.callouts.length}</button>`).join("")}</div>
      </div>
      <div class="row"><button type="button" class="btn primary" id="start">Start ${esc(m.name)} round</button></div>
      <div class="breakdown">
        <p class="counts"><strong class="n-learned">${n.learned} learned</strong> · <span class="n-learning">${n.learning} learning</span> · <span class="n-new">${n.fresh} new</span></p>
        <p class="lede">In ${isFind ? "Find it" : "Name it"}, a callout counts as learned after ${MASTER_STREAK} correct answers in a row. ${isFind ? "Name it" : "Find it"} keeps its own count.</p>
        ${seen ? `<button type="button" class="link-btn" id="resetProgress">Reset ${esc(m.name)} progress</button>` : ""}
      </div>
      ${footer()}`;
    const rp = $("#resetProgress");
    if (rp) rp.onclick = () => {
      if (!confirm(`Reset your ${m.name} progress? Every ${m.name} callout goes back to new in both Find it and Name it. Other maps keep theirs.`)) return;
      delete progress[m.id];
      store.set(K.progress, progress);
      renderMapList();
      renderQuizSetup();
      toast(`${m.name} progress reset`);
    };
    $("#roundSize").onclick = (e) => {
      const b = e.target.closest("button"); if (!b) return;
      prefs.round = Number(b.dataset.n); store.set(K.prefs, prefs); renderQuizSetup();
    };
    $("#start").onclick = () => startRound();
    $("#start").focus({ preventScroll: true });
  }

  function startRound(onlyIds) {
    const m = state.map;
    let pool = m.callouts;
    if (onlyIds) pool = pool.filter((c) => onlyIds.includes(c.id));
    const n = onlyIds ? pool.length : (prefs.round || pool.length);
    // learned0 is the map's learned count before the round, for the summary's "9 → 12 learned".
    // retry[i] marks a re-asked miss and stays index-aligned with items.
    const items = pickRound(pool, n);
    state.quiz = { items, i: 0, results: [], answered: false, done: false, learned0: mapCounts(m, state.mode).learned,
      retry: items.map(() => false), requeued: new Set() };
    fitView();
    prepareStep();
  }

  function current() { return state.quiz.items[state.quiz.i]; }
  const isRetry = () => !!state.quiz.retry[state.quiz.i];
  // A first miss comes back 3 or 4 questions later (or last), once per callout per round.
  function requeue(c) {
    const q = state.quiz;
    if (isRetry() || q.requeued.has(c.id)) return false;
    q.requeued.add(c.id);
    const at = Math.min(q.i + 3 + Math.floor(Math.random() * 2), q.items.length);
    q.items.splice(at, 0, c);
    q.retry.splice(at, 0, true);
    return true;
  }
  const AGAIN_NOTE = "It comes back in a few questions.";

  function prepareStep() {
    const q = state.quiz;
    q.answered = false;
    q.guess = null;
    q.choice = null;
    clearFeedback();
    const c = current();
    if (c.level !== state.level) setLevel(c.level);
    if (state.mode === "name") q.options = buildOptions(c);
    renderPanel(); // first, so the stage has its final size before fitting the zone
    if (state.mode === "name") {
      fbPoly("fb-target", c);
      showTarget(c);
      rescaleMarks();
    }
    const again = isRetry() ? " Again:" : "";
    announce(`Question ${q.i + 1} of ${q.items.length}.${state.mode === "find" ? `${again} Where is ${c.name}?` : again ? " Again: what is this zone called?" : ""}`);
    // Keyboard users start each question where they answer it: the first name, or the Find target.
    const f = panel.querySelector(state.mode === "name" ? ".choice" : ".callname");
    if (f) f.focus({ preventScroll: true });
  }

  function buildOptions(c) {
    const others = state.map.callouts
      .filter((o) => o.id !== c.id && o.name !== c.name && !c.alt.includes(o.name) && !o.alt.includes(c.name))
      .map((o) => ({ o, d: dist(o, c) + (o.level !== c.level ? 400 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 7);
    const picks = shuffle(others).slice(0, 3).map((x) => x.o);
    return shuffle([c, ...picks]);
  }

  function progressBar() {
    const q = state.quiz;
    return `<div class="progress" aria-hidden="true">${q.items.map((_, i) => {
      const r = q.results[i];
      const cls = (r ? r.kind : i === q.i ? "now" : "") + (q.retry[i] ? " again" : "");
      return `<span class="${cls.trim()}"></span>`;
    }).join("")}</div>`;
  }

  function renderFindStep() {
    const q = state.quiz, c = current();
    const r = q.results[q.i];
    const levelChip = state.map.levels.length > 1 ? `<p class="hint"><span class="chip">${esc(levelName(c.level))}</span></p>` : "";
    panel.innerHTML = `
      ${progressBar()}
      <div class="prompt">
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. ${isRetry() ? `<span class="again-tag">Again:</span> where` : "Where"} is</p>
        <h2 class="callname" tabindex="-1">${esc(c.name)}</h2>
        ${c.alt.length ? `<p class="hint">Also called ${c.alt.map(esc).join(", ")}</p>` : ""}
        ${levelChip}
      </div>
      ${r ? resultBlock(r, c) : `<p class="kbd-hint">${TOUCH ? "Tap the radar. Drag to pan, pinch to zoom." : "Click the radar. Drag to pan, scroll to zoom."}</p>`}
      ${stepActions(r, "Next callout")}`;
    bindStepButtons();
  }

  // Next (once answered) and End round. On narrow screens the wrapper is a bar stuck to the panel's foot.
  function stepActions(r, nextLabel) {
    const q = state.quiz;
    return `<div class="step-actions">
      ${r ? `<div class="row"><button type="button" class="btn primary" id="next">${q.i + 1 < q.items.length ? nextLabel : "See results"}</button>${enterHint()}</div>` : ""}
      <div class="row"><span class="spacer"></span><button type="button" class="btn quiet small" id="quit">End round</button></div>
    </div>`;
  }

  // Keyboard hint next to Next; touch screens have no Enter key to point at.
  const enterHint = () => (TOUCH ? "" : `<span class="kbd-hint"><kbd>Enter</kbd></span>`);

  function resultBlock(r, c) {
    const titles = { hit: "Right spot", close: "Close", miss: "Missed" };
    let detail;
    if (state.mode === "find") {
      if (r.kind === "hit") {
        if (r.alias) detail = r.near.alt.includes(c.name)
          ? `You clicked <strong>${esc(r.near.name)}</strong>, which some teams also call ${esc(c.name)}.`
          : `You clicked <strong>${esc(r.near.name)}</strong>, a name some teams also use for ${esc(c.name)}.`;
        else detail = r.near && r.near.id !== c.id ? `You clicked <strong>${esc(r.near.name)}</strong>, which is inside it.` : "";
      } else {
        detail = `You were <strong>${meters(r.d)} m</strong> outside it.`;
        if (r.near && r.near.id !== c.id) detail += ` You clicked <strong>${esc(r.near.name)}</strong>.`;
      }
    } else {
      titles.hit = "Correct";
      detail = r.kind === "hit" ? "" : `It is <strong>${esc(c.name)}</strong>.`;
      // A wrong pick on the other floor can't be outlined, so say where it is.
      const pick = r.kind !== "hit" && state.map.callouts.find((o) => o.id === r.pick);
      if (pick && pick.level !== c.level) detail += ` You picked <strong>${esc(pick.name)}</strong> (${pick.level} level).`;
    }
    if (r.again) detail = (detail ? detail + " " : "") + AGAIN_NOTE;
    const alt = state.mode === "name" && c.alt.length ? `<p class="alt">Also called ${c.alt.map(esc).join(", ")}</p>` : "";
    return `<div class="result ${r.kind}"><h4>${titles[r.kind]}</h4>${detail ? `<p class="detail">${detail}</p>` : ""}<p class="desc">${esc(c.desc)}</p>${alt}</div>`;
  }

  function onMapClick(p) {
    if (ext() && ext().click) { ext().click(p); return; }
    if (state.mode === "explore" || state.mode === "edit") {
      const hit = calloutAt(p);
      if (hit) selectCallout(hit.id, false);
      else if (state.selected) { state.selected = null; state.vertex = null; renderMarkers(); renderPanel(); }
      return;
    }
    if (state.mode !== "find" || !state.quiz || state.quiz.done || state.quiz.answered) return;
    const c = current();
    const pts = ptsOf(c);
    const inside = pointInPoly(p, pts);
    const edge = inside ? { d: 0, x: p.x, y: p.y } : edgeNearest(p, pts);
    // A zone that goes by the target's name (either way round) is the same callout to a teammate.
    // Like areas and spots, any zone under the click counts, not only the topmost one.
    const same = (o) => o.name === c.name || c.alt.includes(o.name) || o.alt.includes(c.name);
    const aliasZone = inside ? null : levelCallouts().find((o) => o.id !== c.id && same(o) && pointInPoly(p, ptsOf(o)));
    const alias = !!aliasZone;
    const near = aliasZone || calloutAt(p);
    const kind = inside || alias ? "hit" : edge.d <= CLOSE_PX ? "close" : "miss";
    const q = state.quiz;
    q.answered = true;
    q.results[q.i] = { kind, d: kind === "hit" ? 0 : edge.d, near, alias, id: c.id, p: { x: p.x, y: p.y } };
    // Zone edges are hand-placed and approximate, so "close" counts as correct.
    score(state.map.id, c.id, kind !== "miss", "find");
    if (kind === "miss") q.results[q.i].again = requeue(c);
    const clicked = near && near.id !== c.id ? ` You clicked ${near.name}.` : "";
    announce(kind === "hit" ? `Right spot.${alias ? clicked : ""}`
      : `${kind === "close" ? "Close" : "Missed"}, ${meters(edge.d)} metre${meters(edge.d) === 1 ? "" : "s"} outside ${c.name}.${clicked}${q.results[q.i].again ? " " + AGAIN_NOTE : ""}`);
    // feedback on the radar: the zone you clicked (if it wasn't a hit), then the answer on top
    const wrong = kind !== "hit" && near && near.id !== c.id ? near : null;
    if (wrong) fbPoly("fb-wrong", wrong);
    fbPoly("fb-answer", c);
    if (kind !== "hit") fbLine(p, edge);
    fbCircle("fb-guess" + (kind !== "miss" ? " hit" : ""), p, 5);
    // After the dot so it stays readable; nudged away from the answer's name so neighbours don't collide.
    if (wrong) fbLabel(wrong, wrong.name, 0, wrong.y <= c.y ? -12 : 21);
    fbLabel(c, c.name, 0, 4.5);
    renderMapList();
    renderPanel();
    rescaleMarks();
    ensureVisible(zoneCenter(c));
  }

  function renderNameStep() {
    const q = state.quiz, c = current();
    const r = q.results[q.i];
    panel.innerHTML = `
      ${progressBar()}
      <div class="prompt">
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. ${isRetry() ? `<span class="again-tag">Again:</span> what` : "What"} is the highlighted zone called?</p>
        ${state.map.levels.length > 1 ? `<p class="hint"><span class="chip">${esc(levelName(c.level))}</span></p>` : ""}
      </div>
      <div class="choices" id="choices">
        ${q.options.map((o, i) => {
          let cls = "choice";
          if (r) { if (o.id === c.id) cls += " right"; else if (q.choice === o.id) cls += " wrong"; }
          return `<button type="button" class="${cls}" data-id="${o.id}" ${r ? "disabled" : ""}><kbd>${i + 1}</kbd>${esc(o.name)}</button>`;
        }).join("")}
      </div>
      ${r ? resultBlock(r, c) : `<p class="kbd-hint">${TOUCH ? "Tap a name." : "Press <kbd>1</kbd> to <kbd>4</kbd> to answer."}</p>`}
      ${stepActions(r, "Next zone")}`;
    $("#choices").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) answerName(b.dataset.id); };
    bindStepButtons();
  }

  function answerName(id) {
    const q = state.quiz;
    if (!q || q.answered) return;
    const c = current();
    const ok = id === c.id;
    q.answered = true;
    q.choice = id;
    q.results[q.i] = { kind: ok ? "hit" : "miss", id: c.id, pick: id };
    score(state.map.id, c.id, ok, "name");
    if (!ok) q.results[q.i].again = requeue(c);
    announce(ok ? "Correct." : `Wrong. That zone is ${c.name}.${q.results[q.i].again ? " " + AGAIN_NOTE : ""}`);
    clearFeedback();
    if (!ok) {
      const wrong = state.map.callouts.find((o) => o.id === id);
      if (wrong && wrong.level === state.level) { fbPoly("fb-wrong", wrong); fbLabel(wrong, wrong.name, 0, 4.5); }
    }
    fbPoly("fb-answer", c);
    fbLabel(c, c.name, 0, 4.5);
    renderMapList();
    renderPanel();
    rescaleMarks();
  }

  function bindStepButtons() {
    const n = $("#next");
    if (n) { n.onclick = nextStep; n.focus({ preventScroll: true }); }
    $("#quit").onclick = () => {
      const q = state.quiz;
      if (q.results.filter(Boolean).length) { q.items = q.items.slice(0, q.results.length); q.done = true; clearFeedback(); renderPanel(); }
      else { state.quiz = null; clearFeedback(); renderPanel(); }
    };
  }

  function nextStep() {
    const q = state.quiz;
    if (!q || !q.answered) return;
    if (q.i + 1 >= q.items.length) { q.done = true; clearFeedback(); renderPanel(); return; }
    q.i += 1;
    prepareStep();
  }

  // After a clean round, point to the next step: Name it leads to Find it, Find it to a bigger round.
  function cleanNext(total) {
    if (state.mode === "name") return "Clean round. Now try finding them in Find it.";
    const all = state.map.callouts.length;
    return total < all ? `Clean round. Try All ${all} or another map.` : "Clean round. Try another map.";
  }

  // Summary radar: every missed zone with its name and, in Find it, each click that missed it.
  // The zone picked in the list (q.focus) is drawn last, as the highlighted target.
  function drawSummary(missed) {
    const q = state.quiz;
    clearFeedback();
    const here = missed.filter((c) => c.level === state.level);
    const focus = here.find((c) => c.id === q.focus);
    for (const c of here) if (c !== focus) fbPoly("fb-answer", c);
    if (focus) fbPoly("fb-target", focus);
    for (const r of q.results) {
      if (r.kind === "miss" && r.p && here.some((c) => c.id === r.id)) fbCircle("fb-guess", r.p, 5);
    }
    for (const c of here) if (c !== focus) fbLabel(c, c.name, 0, 4.5);
    if (focus) fbLabel(focus, focus.name, 0, 4.5);
    rescaleMarks();
  }

  function renderQuizSummary() {
    const q = state.quiz, m = state.map;
    const total = q.results.length;
    const hits = q.results.filter((r) => r.kind !== "miss").length;
    const missed = [...new Set(q.results.filter((r) => r.kind === "miss").map((r) => r.id))].map((id) => m.callouts.find((c) => c.id === id));
    const learned = mapCounts(m, state.mode).learned, gain = learned - (q.learned0 || 0);
    const first = !q.told;
    if (first) {
      q.told = true;
      announce(`Round over, ${hits} of ${total}.`);
      // Start on a level that has something to review, with the whole map in view.
      if (missed.length && !missed.some((c) => c.level === state.level)) setLevel(missed[0].level);
      fitView();
    }
    panel.innerHTML = `
      ${progressBar()}
      <div>
        <div class="score-big">${hits}<small> / ${total}</small></div>
        <p class="lede">${hits === total ? cleanNext(total) : `${missed.length} to work on, shown on the radar. They will come up more often next time.`}</p>
        <p class="gain">${esc(m.name)}: ${q.learned0 || 0} → ${learned} learned in ${state.mode === "name" ? "Name it" : "Find it"} <span class="${gain > 0 ? "up" : ""}">(${gain > 0 ? "+" : gain < 0 ? "−" : "±"}${Math.abs(gain)})</span></p>
      </div>
      ${missed.length ? `<ul class="missed">${missed.map((c) => `<li><button type="button" data-id="${c.id}" aria-pressed="${c.id === q.focus}"><b>${esc(c.name)}</b>${m.levels.length > 1 && c.level === "lower" ? ` <span class="lv">lower</span>` : ""}. ${esc(c.desc)}</button></li>`).join("")}</ul>` : ""}
      <div class="row">
        ${missed.length ? `<button type="button" class="btn primary" id="retryMissed">Drill the ${missed.length} missed</button>` : ""}
        <button type="button" class="btn ${missed.length ? "" : "primary"}" id="again">New round</button>
      </div>
      ${footer()}`;
    drawSummary(missed);
    const ml = panel.querySelector(".missed");
    if (ml) ml.onclick = (e) => {
      const b = e.target.closest("button[data-id]"); if (!b) return;
      const c = missed.find((x) => x.id === b.dataset.id);
      q.focus = c.id;
      if (c.level !== state.level) setLevel(c.level);
      const top = panel.scrollTop;
      renderQuizSummary();
      panel.scrollTop = top;
      centerOn(zoneCenter(c), 2);
      announce(`${c.name}${m.levels.length > 1 ? `, ${levelName(c.level).toLowerCase()}` : ""}, centred on the radar.`);
      const nb = panel.querySelector(`.missed button[data-id="${CSS.escape(c.id)}"]`);
      if (nb) nb.focus({ preventScroll: true });
    };
    const rm = $("#retryMissed");
    if (rm) rm.onclick = () => startRound(missed.map((c) => c.id));
    $("#again").onclick = () => startRound();
    if (first) (rm || $("#again")).focus({ preventScroll: true });
  }

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    if (e.key === "Escape") { if (escapeStep()) e.preventDefault(); return; }
    const q = state.quiz;
    if (q && !q.done) {
      if ((e.key === "Enter" || e.key === " ") && q.answered && !e.target.matches("button")) { e.preventDefault(); nextStep(); return; }
      if (state.mode === "name" && !q.answered && /^[1-4]$/.test(e.key)) {
        const o = q.options[Number(e.key) - 1];
        if (o) answerName(o.id);
        return;
      }
    }
    if (state.mode === "edit" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (!undoEdit()) announce("Nothing to undo");
      return;
    }
    if (state.mode === "edit" && (e.key === "Delete" || e.key === "Backspace") && state.vertex != null) {
      // Same rule as the Delete point button: never on rectangles or below three points.
      const c = selectedCallout();
      if (c && !isRect(c) && ptsOf(c).length > 3) { e.preventDefault(); deleteVertex(c, state.vertex); }
      return;
    }
    if (e.key === "+" || e.key === "=") zoomCenter(1.4);
    else if (e.key === "-") zoomCenter(1 / 1.4);
    else if (e.key === "0") fitView();
  });

  // ---------- boot ----------
  // Fit the view around a radar-px box [x0, y0, x1, y1], padded by a share of its size on each side.
  function fitBox(b, pad = 0.15) {
    const w = Math.max(b[2] - b[0], 1), h = Math.max(b[3] - b[1], 1);
    goView([b[0] - w * pad, b[1] - h * pad, w * (1 + 2 * pad), h * (1 + 2 * pad)]);
  }
  // What extra modes get to use. setLevel here also redraws, like the level buttons.
  const api = {
    state, prefs, panel, svg, $, el, esc, toast, unit, levelName, ensureVisible, NARROW, TOUCH, MASTER_STREAK,
    centerOn, fitView, setView, fitBox, clientToSvg, announce, canLeave, updateHash,
    // Switch content, learning mode or tool (see go()); extra modes use it for their own "go to" buttons.
    go: (next) => go(next),
    // Game units to radar px on the current map, and radar px to whole metres.
    unitsToPx: (u) => u / state.map.scale,
    meters,
    savePrefs: () => store.set(K.prefs, prefs),
    setLevel: (lv) => { setLevel(lv); renderMarkers(); renderPanel(); },
    callout: (id) => state.map.callouts.find((c) => c.id === id),
  };
  for (const k in EXT) if (EXT[k].init) EXT[k].init(api);
  // A hash as { map, content, learn, tool, arg }, with null for what it doesn't say.
  // Old links: #mirage/smokes is Smokes · Explore, and #mirage/smokes/<id> opens that line-up there.
  function parseHash() {
    const [hMap, a, b, ...rest] = location.hash.replace(/^#/, "").split("/");
    const h = { map: MAPS.some((m) => m.id === hMap) ? hMap : null, content: null, learn: null, tool: null, arg: "" };
    if (LEARN.includes(a)) { h.content = "callouts"; h.learn = a; }
    else if (TOOLS.includes(a)) h.tool = a;
    else if (a === "smokes") {
      h.content = "smokes";
      if (LEARN.includes(b)) { h.learn = b; if (b === "explore") h.arg = rest.join("/"); }
      else { h.learn = "explore"; h.arg = b || ""; }
    }
    return h;
  }
  function boot() {
    if (!MAPS.length) { panel.textContent = "No map data found. Check that data/maps.js loads."; return; }
    const h = parseHash();
    state.content = h.content || prefs.content;
    state.learn = h.learn || prefs.mode;
    state.tool = h.tool;
    selectMap(h.map || prefs.map);
    routeExt(h.arg);
  }
  // Hand a line-up id to Smokes · Explore, then write the hash it settles on.
  function routeExt(arg) {
    const x = ext();
    if (x && x.route && state.learn === "explore") {
      let a = arg || "";
      try { a = decodeURIComponent(a); } catch { /* keep it raw */ }
      x.route(a);
    }
    updateHash();
  }
  window.addEventListener("hashchange", () => {
    const h = parseHash();
    const t = h.tool ? { tool: h.tool } : h.content ? { content: h.content, learn: h.learn } : null;
    const newMap = !!state.map && !!h.map && h.map !== state.map.id;
    const newView = !!t && (t.tool ? t.tool !== state.tool : !!state.tool || t.content !== state.content || t.learn !== state.learn);
    // Same map and view, but a new line-up id (a hand-edited link, say).
    const x = ext();
    const newArg = !newMap && !newView && !!x && !!x.route && state.learn === "explore" && h.arg !== (x.hashArg ? x.hashArg() || "" : "");
    if (!newMap && !newView && !newArg) return updateHash(); // an old or odd spelling of where we already are
    if (!canLeave("hash:" + location.hash)) return updateHash(); // restore the hash of the round we kept
    if (newMap) selectMap(h.map);
    if (newView) go(t);
    routeExt(h.arg);
  });
  boot();
})();
