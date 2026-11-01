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
  const prefs = Object.assign({ map: BASE[0] && BASE[0].id, mode: "explore", labels: false, round: 10 }, store.get(K.prefs, {}));

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
  const TOUCH = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const NARROW = window.matchMedia ? matchMedia("(max-width: 860px)") : { matches: false };
  const MASTER_STREAK = 3;

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
    if (!q || q.done || !q.results.length) return true;
    if (leaveAsk && leaveAsk.key === key && Date.now() - leaveAsk.t < LEAVE_MS) { leaveAsk = null; return true; }
    leaveAsk = { key, t: Date.now() };
    toast("Round in progress \u2014 click again to leave", LEAVE_MS);
    return false;
  }

  // ---------- progress ----------
  function rec(mapId, id) {
    progress[mapId] = progress[mapId] || {};
    return (progress[mapId][id] = progress[mapId][id] || { s: 0, c: 0, k: 0 });
  }
  function score(mapId, id, ok) {
    const r = rec(mapId, id);
    r.s += 1;
    if (ok) { r.c += 1; r.k += 1; } else { r.k = 0; }
    store.set(K.progress, progress);
  }
  function calloutMastery(mapId, id) {
    const r = progress[mapId] && progress[mapId][id];
    return r ? Math.min(r.k, MASTER_STREAK) / MASTER_STREAK : 0;
  }
  // Learned = streak of MASTER_STREAK or more; learning = seen but not learned; fresh = never asked.
  function mapCounts(m) {
    const P = progress[m.id] || {};
    const n = { learned: 0, learning: 0, fresh: 0, total: m.callouts.length };
    for (const c of m.callouts) {
      const r = P[c.id];
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
    const P = progress[state.map.id] || {};
    const misses = (c) => P[c.id].s - P[c.id].c;
    n = Math.min(n, pool.length);
    const weak = shuffle(pool.filter((c) => P[c.id] && P[c.id].s > 0 && P[c.id].k === 0)).sort((a, b) => misses(b) - misses(a));
    const picked = weak.slice(0, Math.floor(n * WEAK_SHARE));
    const rest = pool.filter((c) => !picked.includes(c)).map((c) => {
      const r = P[c.id];
      const w = r ? 1 + 4 * (1 - calloutMastery(state.map.id, c.id)) + Math.min(r.s - r.c, 4) : 3;
      return { c, key: Math.pow(Math.random(), 1 / w) };
    });
    rest.sort((a, b) => b.key - a.key);
    return shuffle(picked.concat(rest.slice(0, n - picked.length).map((i) => i.c)));
  }

  // ---------- view / pan / zoom ----------
  function setView(v) {
    const [, , w] = v;
    const minW = 70, maxW = 1500;
    const k = Math.min(Math.max(w, minW), maxW) / w;
    const cx = v[0] + v[2] / 2, cy = v[1] + v[3] / 2;
    const nw = v[2] * k, nh = v[3] * k;
    state.view = [cx - nw / 2, cy - nh / 2, nw, nh];
    svg.setAttribute("viewBox", state.view.join(" "));
    rescaleMarks();
  }
  function fitView() { setView(state.map.view.slice()); }
  // svg units per screen px
  function unit() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return 1;
    return Math.max(state.view[2] / r.width, state.view[3] / r.height);
  }
  function zoomAt(factor, cx, cy) {
    const [x, y, w, h] = state.view;
    const nw = w / factor, nh = h / factor;
    setView([cx - (cx - x) * (nw / w), cy - (cy - y) * (nh / h), nw, nh]);
  }
  function zoomCenter(factor) { const [x, y, w, h] = state.view; zoomAt(factor, x + w / 2, y + h / 2); }
  function centerOn(p, minZoom) {
    let [, , w, h] = state.view;
    if (minZoom) {
      const fitW = state.map.view[2];
      if (w > fitW / minZoom) { const k = (fitW / minZoom) / w; w *= k; h *= k; }
    }
    setView([p.x - w / 2, p.y - h / 2, w, h]);
  }
  function ensureVisible(p) {
    // The svg letterboxes the viewBox, so the visible area can be wider or taller than it.
    const r = svg.getBoundingClientRect(), u = unit();
    const w = r.width * u || state.view[2], h = r.height * u || state.view[3];
    const x = state.view[0] + state.view[2] / 2 - w / 2, y = state.view[1] + state.view[3] / 2 - h / 2;
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
      } else { c.x = x; c.y = y; }
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
    const showAll = state.mode === "explore" || state.mode === "edit";
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
    el("circle", { class: "anchor", cx: c.x, cy: c.y, "data-r": 7 }, layerEdit);
    rescaleMarks();
  }
  function setHover(id) {
    if (state.hover === id) return;
    for (const n of svg.querySelectorAll(".is-hover")) n.classList.remove("is-hover");
    state.hover = id;
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
    layerFb.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Number(n.dataset.r) * u));
    layerFb.querySelectorAll("text").forEach((t) => {
      t.setAttribute("font-size", 16 * u);
      t.setAttribute("stroke-width", 3.5 * u);
      t.setAttribute("dx", t.dataset.dx * u);
      t.setAttribute("dy", t.dataset.dy * u);
    });
  }
  function fbCircle(cls, p, r) { return el("circle", { class: cls, cx: p.x, cy: p.y, "data-r": r }, layerFb); }
  function fbPoly(cls, c) { return el("polygon", { class: cls, points: ptsStr(c) }, layerFb); }
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
    if (refit) fitView();
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
      const n = mapCounts(m);
      b.title = `${m.name}: ${n.learned} / ${n.total} learned`;
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
    state.map = m;
    state.selected = null;
    state.search = "";
    state.quiz = null;
    prefs.map = m.id;
    store.set(K.prefs, prefs);
    clearFeedback();
    setLevel("upper", true);
    renderMapList();
    if (!keepMode) setMode(state.mode); else { renderMarkers(); renderPanel(); }
    updateHash();
    const cur = $("#mapList .map-btn[aria-current='true']");
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------- modes ----------
  function setMode(mode) {
    state.mode = mode;
    state.quiz = null;
    prefs.mode = mode;
    store.set(K.prefs, prefs);
    document.body.className = "mode-" + mode;
    document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    clearFeedback();
    renderMarkers();
    renderPanel();
    updateHash();
  }
  document.querySelectorAll(".modes button").forEach((b) => (b.onclick = () => {
    const mode = b.dataset.mode;
    if (mode !== state.mode && canLeave("mode:" + mode)) setMode(mode);
  }));

  function updateHash() {
    if (!state.map) return;
    const h = `#${state.map.id}/${state.mode}`;
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
    return renderQuiz();
  }

  function footer() {
    return `<div class="foot">Callout names follow <a href="https://totalcsgo.com/callouts" target="_blank" rel="noopener">Total CS</a>. Radar images come from the CS2 game files. Zones were generated from the radar and placed by hand; if one is off, fix it in Edit.</div>`;
  }

  function matches(c, q) {
    return c.name.toLowerCase().includes(q) || c.alt.some((a) => a.toLowerCase().includes(q));
  }

  function calloutCard(c, cls = "") {
    const r = progress[state.map.id] && progress[state.map.id][c.id];
    const ratio = r && r.s ? ` <span class="lifetime">${r.c} of ${r.s} right overall.</span>` : "";
    return `<div class="card ${cls}">
      <h3>${esc(c.name)}</h3>
      ${c.alt.length ? `<p class="alt">Also called ${c.alt.map(esc).join(", ")}</p>` : ""}
      <p class="desc">${esc(c.desc)}</p>
      <div class="meta">${state.map.levels.length > 1 ? esc(levelName(c.level)) + ". " : ""}<span class="status">${calloutStatus(r)}.</span>${ratio}</div>
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
            <span class="ms" title="${calloutStatus(progress[m.id] && progress[m.id][c.id])}"><i style="width:${calloutMastery(m.id, c.id) * 100}%"></i></span>
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
      renderMarkers();
      const s2 = $("#search"); s2.focus(); s2.setSelectionRange(pos, pos);
    };
    s.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (!list.length) return;
        selectCallout(list[0].id, true);
        const s2 = $("#search"); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length);
      } else if (e.key === "Escape" && s.value) {
        e.preventDefault();
        s.value = "";
        s.oninput();
      } else if (e.key === "ArrowDown") {
        const b = $("#list button[data-id]");
        if (b) { e.preventDefault(); b.focus(); }
      }
    };
    $("#list").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) selectCallout(b.dataset.id, true); };
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
    if (active && !center && !NARROW.matches) {
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
    const n = edits[m.id] ? Object.keys(edits[m.id]).length : 0;
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
    if (u) u.onclick = () => { delete edits[m.id][sel.id]; state.vertex = null; saveEdits(); };
    $("#copyJson").onclick = async () => {
      try { await navigator.clipboard.writeText(exportJson()); toast("Map data copied"); }
      catch { const f = downloadJson(true); toast(`Couldn't copy to the clipboard, downloaded ${f} instead.`, 4000); }
    };
    $("#dlJson").onclick = () => downloadJson();
    $("#resetEdits").onclick = () => {
      if (!confirm(`Discard ${n} changed zone${n === 1 ? "" : "s"} on ${m.name}?`)) return;
      delete edits[m.id]; state.vertex = null; saveEdits(); toast("Changes discarded");
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
  function commitEdit(c) {
    if (!c) return;
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
    sp.textContent = state.mode === "find" && q && !q.done && !q.answered ? current().name : "";
    sp.classList.toggle("is-find", !!sp.textContent);
    if (!q) return renderQuizSetup();
    if (q.done) return renderQuizSummary();
    return state.mode === "find" ? renderFindStep() : renderNameStep();
  }

  function renderQuizSetup() {
    const m = state.map;
    const n = mapCounts(m);
    const isFind = state.mode === "find";
    const sizes = [10, 20, 0];
    panel.innerHTML = `
      <p class="lede">${isFind
        ? `You get a callout name. <strong>Click anywhere inside its zone</strong> on the radar.`
        : `A zone lights up on the radar. <strong>Pick its name</strong> from four nearby callouts.`}
        Callouts you keep missing come up more often.</p>
      <div class="row"><span class="field-label">Questions</span>
        <div class="seg" id="roundSize">${sizes.map((s) => `<button type="button" data-n="${s}" aria-pressed="${prefs.round === s}">${s || "All " + m.callouts.length}</button>`).join("")}</div>
      </div>
      <div class="row"><button type="button" class="btn primary" id="start">Start ${esc(m.name)} round</button></div>
      <div class="breakdown">
        <p class="counts"><strong class="n-learned">${n.learned} learned</strong> · <span class="n-learning">${n.learning} learning</span> · <span class="n-new">${n.fresh} new</span></p>
        <p class="lede">A callout counts as learned after ${MASTER_STREAK} correct answers in a row.</p>
        ${n.fresh < n.total ? `<button type="button" class="link-btn" id="resetProgress">Reset ${esc(m.name)} progress</button>` : ""}
      </div>
      ${footer()}`;
    const rp = $("#resetProgress");
    if (rp) rp.onclick = () => {
      if (!confirm(`Reset your ${m.name} progress? Every ${m.name} callout goes back to new. Other maps keep theirs.`)) return;
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
  }

  function startRound(onlyIds) {
    const m = state.map;
    let pool = m.callouts;
    if (onlyIds) pool = pool.filter((c) => onlyIds.includes(c.id));
    const n = onlyIds ? pool.length : (prefs.round || pool.length);
    state.quiz = { items: pickRound(pool, n), i: 0, results: [], answered: false, done: false };
    fitView();
    prepareStep();
  }

  function current() { return state.quiz.items[state.quiz.i]; }

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
      ensureVisible(zoneCenter(c));
      rescaleMarks();
    }
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
    return `<div class="progress" aria-label="Question ${q.i + 1} of ${q.items.length}">${q.items.map((_, i) => {
      const r = q.results[i];
      return `<span class="${r ? r.kind : i === q.i ? "now" : ""}"></span>`;
    }).join("")}</div>`;
  }

  function renderFindStep() {
    const q = state.quiz, c = current();
    const r = q.results[q.i];
    const levelChip = state.map.levels.length > 1 ? `<p class="hint"><span class="chip">${esc(levelName(c.level))}</span></p>` : "";
    panel.innerHTML = `
      ${progressBar()}
      <div class="prompt">
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. Where is</p>
        <h2 class="callname">${esc(c.name)}</h2>
        ${c.alt.length ? `<p class="hint">Also called ${c.alt.map(esc).join(", ")}</p>` : ""}
        ${levelChip}
      </div>
      ${r ? resultBlock(r, c) : `<p class="kbd-hint">${TOUCH ? "Tap the radar. Drag to pan, pinch to zoom." : "Click the radar. Drag to pan, scroll to zoom."}</p>`}
      ${r ? `<div class="row"><button type="button" class="btn primary" id="next">${q.i + 1 < q.items.length ? "Next callout" : "See results"}</button>${enterHint()}</div>` : ""}
      <div class="row"><span class="spacer"></span><button type="button" class="btn quiet small" id="quit">End round</button></div>`;
    bindStepButtons();
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
    const alt = state.mode === "name" && c.alt.length ? `<p class="alt">Also called ${c.alt.map(esc).join(", ")}</p>` : "";
    return `<div class="result ${r.kind}"><h4>${titles[r.kind]}</h4>${detail ? `<p class="detail">${detail}</p>` : ""}<p class="desc">${esc(c.desc)}</p>${alt}</div>`;
  }

  function onMapClick(p) {
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
    q.results[q.i] = { kind, d: kind === "hit" ? 0 : edge.d, near, alias, id: c.id };
    // Zone edges are hand-placed and approximate, so "close" counts as correct.
    score(state.map.id, c.id, kind !== "miss");
    // feedback on the radar: the zone you clicked (if it wasn't a hit), then the answer on top
    const wrong = kind !== "hit" && near && near.id !== c.id ? near : null;
    if (wrong) fbPoly("fb-wrong", wrong);
    fbPoly("fb-answer", c);
    if (kind !== "hit") el("line", { class: "fb-line", x1: p.x, y1: p.y, x2: edge.x, y2: edge.y }, layerFb);
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
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. What is the highlighted zone called?</p>
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
      ${r ? `<div class="row"><button type="button" class="btn primary" id="next">${q.i + 1 < q.items.length ? "Next zone" : "See results"}</button>${enterHint()}</div>` : ""}
      <div class="row"><span class="spacer"></span><button type="button" class="btn quiet small" id="quit">End round</button></div>`;
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
    score(state.map.id, c.id, ok);
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

  function renderQuizSummary() {
    const q = state.quiz;
    const total = q.results.length;
    const hits = q.results.filter((r) => r.kind !== "miss").length;
    const missed = q.results.filter((r) => r.kind === "miss").map((r) => state.map.callouts.find((c) => c.id === r.id));
    panel.innerHTML = `
      ${progressBar()}
      <div>
        <div class="score-big">${hits}<small> / ${total}</small></div>
        <p class="lede">${hits === total ? cleanNext(total) : `${total - hits} to work on. They will come up more often next time.`}</p>
      </div>
      ${missed.length ? `<ul class="missed">${missed.map((c) => `<li><b>${esc(c.name)}</b>. ${esc(c.desc)}</li>`).join("")}</ul>` : ""}
      <div class="row">
        ${missed.length ? `<button type="button" class="btn primary" id="retryMissed">Drill the ${missed.length} missed</button>` : ""}
        <button type="button" class="btn ${missed.length ? "" : "primary"}" id="again">New round</button>
      </div>
      ${footer()}`;
    const rm = $("#retryMissed");
    if (rm) rm.onclick = () => startRound(missed.map((c) => c.id));
    $("#again").onclick = () => startRound();
  }

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea")) return;
    const q = state.quiz;
    if (q && !q.done) {
      if ((e.key === "Enter" || e.key === " ") && q.answered && !e.target.matches("button")) { e.preventDefault(); nextStep(); return; }
      if (state.mode === "name" && !q.answered && /^[1-4]$/.test(e.key)) {
        const o = q.options[Number(e.key) - 1];
        if (o) answerName(o.id);
        return;
      }
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
  function boot() {
    if (!MAPS.length) { panel.textContent = "No map data found. Check that data/maps.js loads."; return; }
    const [hMap, hMode] = location.hash.replace(/^#/, "").split("/");
    const modes = ["explore", "find", "name", "edit"];
    state.mode = modes.includes(hMode) ? hMode : modes.includes(prefs.mode) ? prefs.mode : "explore";
    selectMap(MAPS.some((m) => m.id === hMap) ? hMap : prefs.map);
  }
  window.addEventListener("hashchange", () => {
    const [hMap, hMode] = location.hash.replace(/^#/, "").split("/");
    const newMap = state.map && hMap && hMap !== state.map.id && MAPS.some((m) => m.id === hMap);
    const newMode = hMode && hMode !== state.mode && ["explore", "find", "name", "edit"].includes(hMode);
    if (!newMap && !newMode) return;
    if (!canLeave("hash:" + location.hash)) return updateHash(); // restore the hash of the round we kept
    if (newMap) selectMap(hMap);
    if (newMode) setMode(hMode);
  });
  boot();
})();
