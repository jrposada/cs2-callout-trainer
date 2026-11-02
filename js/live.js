// Live mode: a round clock for a second screen. Start it when freeze time ends and dots run
// each side's fastest routes from spawn in real time, so you see where players can be.
// Routes come from data/routes.js (window.CALLOUT_ROUTES). This file loads before js/app.js,
// registers itself in window.CCT_MODES, and gets the app's helpers through init(api).
(() => {
  "use strict";

  const ROUND_S = 115; // a CS2 round after freeze time is 1:55
  const SIDES = [["T", "T"], ["CT", "CT"], ["both", "Both"]];
  const RATES = [0.5, 1, 2];
  const WEAPONS = [
    { id: "knife", name: "Knife", v: 250 },
    { id: "pistol", name: "Pistol", v: 240 },
    { id: "rifle", name: "Rifle", v: 215 },
    { id: "awp", name: "AWP", v: 200 },
  ];
  const REDUCED = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  let A = null;     // app api, from init()
  let layer = null; // <g> on the radar, owned by this mode
  const L = {
    running: false,
    acc: 0,          // game seconds elapsed before the last resume
    t0: 0,           // performance.now() at the last resume
    raf: 0,
    sel: null,       // highlighted route id
    routes: [],      // prepared routes for the current map, side and weapon
    arrived: new Set(),
    dom: new Map(),  // route id -> { legs: [{ j, trail }], dot, label, base: [] }
    clockText: "",
  };

  // ---------- settings (kept in the app's prefs) ----------
  const side = () => (SIDES.some((s) => s[0] === A.prefs.liveSide) ? A.prefs.liveSide : "both");
  const rate = () => (RATES.includes(A.prefs.liveRate) ? A.prefs.liveRate : 1);
  const weapon = () => WEAPONS.find((w) => w.id === A.prefs.liveWeapon) || WEAPONS[0];
  function setPref(k, v) { A.prefs[k] = v; A.savePrefs(); }

  // ---------- clock ----------
  function elapsed(now = performance.now()) {
    const run = L.running ? Math.max(0, now - L.t0) / 1000 * rate() : 0;
    return Math.min(ROUND_S, L.acc + run);
  }
  // m:ss.t, truncated so a row reads the same as the clock when its dot arrives
  function fmt(t) {
    const n = Math.floor(t * 10 + 1e-6);
    return `${Math.floor(n / 600)}:${String(Math.floor(n / 10) % 60).padStart(2, "0")}.${n % 10}`;
  }

  // ---------- data ----------
  function mapData() {
    const R = window.CALLOUT_ROUTES;
    const d = R && A.state.map && R[A.state.map.id];
    return d && Array.isArray(d.routes) && d.routes.length ? d : null;
  }
  function leg(level, flat) {
    const pts = [], cum = [0];
    for (let i = 0; i + 1 < (flat || []).length; i += 2) pts.push({ x: +flat[i], y: +flat[i + 1] });
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    return { level: level || "upper", pts, cum, len: cum[cum.length - 1] };
  }
  function prepare() {
    const d = mapData();
    if (!d) return [];
    const k = (d.speed || 250) / weapon().v;
    const sd = side();
    return d.routes
      .filter((r) => sd === "both" || r.side === sd)
      .map((r) => {
        const src = Array.isArray(r.segments) && r.segments.length ? r.segments : [{ level: r.level, path: r.path }];
        const legs = src.map((s) => leg(s.level || r.level, s.path)).filter((l) => l.pts.length);
        if (!legs.length || !Number.isFinite(+r.time)) return null;
        const last = legs[legs.length - 1];
        const c = A.callout(r.to);
        return {
          id: r.id, side: r.side === "CT" ? "ct" : "t", sideName: r.side === "CT" ? "CT" : "T",
          name: c ? c.name : String(r.to || r.id), time: Math.max(0, +r.time * k),
          legs, len: legs.reduce((a, l) => a + l.len, 0), end: last.pts[last.pts.length - 1], endLevel: last.level,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  }
  // Where a route's dot is after travelling d radar px: leg index, segment index, point.
  function at(rt, d) {
    let rest = d;
    for (let j = 0; j < rt.legs.length; j++) {
      const lg = rt.legs[j];
      if (rest <= lg.len || j === rt.legs.length - 1) {
        rest = Math.min(rest, lg.len);
        let i = 1;
        while (i < lg.cum.length - 1 && lg.cum[i] < rest) i++;
        if (lg.pts.length < 2) return { j, i: 0, x: lg.pts[0].x, y: lg.pts[0].y };
        const a = lg.pts[i - 1], b = lg.pts[i];
        const seg = lg.cum[i] - lg.cum[i - 1];
        const f = seg ? (rest - lg.cum[i - 1]) / seg : 1;
        return { j, i, x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
      rest -= lg.len;
    }
    return { j: 0, i: 0, x: rt.legs[0].pts[0].x, y: rt.legs[0].pts[0].y };
  }
  const ptsStr = (pts) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // ---------- radar layer ----------
  function draw() {
    layer.textContent = "";
    L.dom.clear();
    const lv = A.state.level;
    const g = () => A.el("g", {}, layer);
    const gSpawn = g(), gBase = g(), gTrail = g(), gDot = g(), gLabel = g();
    L.gPulse = g();
    layer.classList.toggle("has-sel", !!L.sel);
    const d = mapData();
    if (!d) return;
    const sd = side();
    for (const s of ["T", "CT"]) {
      const sp = d.spawns && d.spawns[s];
      if (!sp || (sd !== "both" && sd !== s) || (sp.level || "upper") !== lv) continue;
      A.el("circle", { class: "live-spawn " + s.toLowerCase(), cx: sp.x, cy: sp.y, "data-r": 11 }, gSpawn);
    }
    // Labels of routes that end at (nearly) the same spot stack instead of overlapping.
    const stack = [];
    for (const rt of L.routes) {
      const sel = rt.id === L.sel ? " is-sel" : "";
      const dom = { legs: [], dot: null, label: null };
      rt.legs.forEach((lg, j) => {
        if (lg.level !== lv) return;
        A.el("polyline", { class: `live-path ${rt.side}${sel}`, points: ptsStr(lg.pts) }, gBase);
        dom.legs.push({ j, trail: A.el("polyline", { class: `live-trail ${rt.side}${sel}`, points: "" }, gTrail) });
      });
      if (dom.legs.length) dom.dot = A.el("circle", { class: `live-dot ${rt.side}${sel}`, "data-r": sel ? 7 : 5.5 }, gDot);
      if (rt.endLevel === lv) {
        let k = 0;
        for (const s of stack) if (Math.hypot(s.x - rt.end.x, s.y - rt.end.y) < 14) k++;
        stack.push(rt.end);
        const t = A.el("text", { class: `live-label ${rt.side}${sel}`, x: rt.end.x, y: rt.end.y, "data-dy": -9 - k * 15 }, gLabel);
        t.textContent = rt.name + " ";
        A.el("tspan", { class: "tm" }, t).textContent = fmt(rt.time);
        dom.label = t;
      }
      L.dom.set(rt.id, dom);
    }
    update(elapsed(), false);
    rescale(A.unit());
  }

  function update(e, live) {
    const lv = A.state.level;
    layer.classList.toggle("is-idle", e === 0);
    let changed = false;
    for (const rt of L.routes) {
      const f = rt.time ? Math.min(1, e / rt.time) : 1;
      const pos = at(rt, f * rt.len);
      const dom = L.dom.get(rt.id);
      const arrived = e > 0 && e >= rt.time;
      if (dom) {
        for (const { j, trail } of dom.legs) {
          const lg = rt.legs[j];
          let pts = "";
          if (e > 0 && j < pos.j) pts = ptsStr(lg.pts);
          else if (e > 0 && j === pos.j) pts = ptsStr([...lg.pts.slice(0, pos.i), pos]);
          trail.setAttribute("points", pts);
        }
        if (dom.dot) {
          const show = rt.legs[pos.j].level === lv;
          dom.dot.style.display = show ? "" : "none";
          if (show) { dom.dot.setAttribute("cx", pos.x.toFixed(1)); dom.dot.setAttribute("cy", pos.y.toFixed(1)); }
          dom.dot.classList.toggle("is-arrived", arrived);
        }
        if (dom.label) dom.label.classList.toggle("is-arrived", arrived);
      }
      if (arrived !== L.arrived.has(rt.id)) {
        changed = true;
        if (arrived) { L.arrived.add(rt.id); if (live) announce(rt); } else L.arrived.delete(rt.id);
      }
    }
    if (changed) syncRows();
    syncClock(e);
  }

  function announce(rt) {
    const row = A.panel.querySelector(`.live-list button[data-id="${CSS.escape(rt.id)}"]`);
    if (row) { row.classList.remove("is-just"); void row.offsetWidth; row.classList.add("is-just"); }
    if (REDUCED.matches || rt.endLevel !== A.state.level || !L.gPulse) return;
    const p = A.el("circle", { class: "live-pulse " + rt.side, cx: rt.end.x, cy: rt.end.y, "data-r": 18, r: 18 * A.unit() }, L.gPulse);
    setTimeout(() => p.remove(), 1000);
  }

  function rescale(u) {
    if (!layer || !layer.firstChild) return;
    layer.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Number(n.dataset.r) * u));
    layer.querySelectorAll("text").forEach((t) => {
      t.setAttribute("font-size", 13 * u);
      t.setAttribute("dx", 9 * u);
      t.setAttribute("dy", Number(t.dataset.dy) * u);
      t.style.strokeWidth = 3.5 * u;
    });
  }

  // ---------- running ----------
  function frame(now) {
    const e = elapsed(now);
    if (e >= ROUND_S) { L.acc = ROUND_S; L.running = false; }
    update(e, true);
    if (L.running) L.raf = requestAnimationFrame(frame);
    else syncButtons();
  }
  function toggle() {
    if (!L.routes.length) return;
    const now = performance.now();
    if (L.running) {
      L.acc = elapsed(now);
      L.running = false;
      cancelAnimationFrame(L.raf);
    } else {
      if (L.acc >= ROUND_S) reset();
      L.t0 = now;
      L.running = true;
      L.raf = requestAnimationFrame(frame);
    }
    syncButtons();
  }
  function stop() { L.running = false; cancelAnimationFrame(L.raf); }
  function reset() {
    stop();
    L.acc = 0;
    if (layer && L.gPulse) L.gPulse.textContent = "";
    if (A.state.mode === "live" && layer.firstChild) update(0, false);
    syncButtons();
  }
  function setRate(r) {
    // Fold the time so far in at the old rate, then go on at the new one.
    const now = performance.now();
    L.acc = elapsed(now);
    L.t0 = now;
    setPref("liveRate", r);
  }

  // ---------- panel ----------
  function syncClock(e) {
    const s = fmt(e);
    if (s === L.clockText) return;
    L.clockText = s;
    const c = A.panel.querySelector("#liveClock");
    if (c) c.textContent = s;
  }
  function syncButtons() {
    const go = A.panel.querySelector("#liveGo");
    if (!go) return;
    go.textContent = L.running ? "Pause" : L.acc > 0 && L.acc < ROUND_S ? "Resume" : "Start";
    go.classList.toggle("primary", !L.running);
    A.panel.querySelector(".live-clock").classList.toggle("is-running", L.running);
    A.panel.querySelector("#liveReset").disabled = !L.running && L.acc === 0;
  }
  function syncRows() {
    A.panel.querySelectorAll(".live-list button[data-id]").forEach((b) => {
      b.classList.toggle("is-arrived", L.arrived.has(b.dataset.id));
      b.classList.toggle("is-sel", b.dataset.id === L.sel);
    });
  }
  const seg = (id, items, cur) =>
    `<div class="seg" id="${id}">${items.map(([v, label]) => `<button type="button" data-v="${v}" aria-pressed="${String(v) === String(cur)}">${label}</button>`).join("")}</div>`;

  function render() {
    const m = A.state.map;
    layer.style.display = "";
    L.routes = prepare();
    // Recount arrivals quietly: a redraw is not a dot arriving.
    const e0 = elapsed();
    L.arrived = new Set(L.routes.filter((rt) => e0 > 0 && e0 >= rt.time).map((rt) => rt.id));
    if (L.sel && !L.routes.some((rt) => rt.id === L.sel)) L.sel = null;
    L.clockText = "";
    if (!L.routes.length) {
      stop();
      L.acc = 0;
      layer.textContent = "";
      const R = window.CALLOUT_ROUTES;
      const here = !!mapData(); // this map has routes, just none for the chosen side
      const names = (window.CALLOUT_MAPS || [])
        .filter((x) => R && R[x.id] && Array.isArray(R[x.id].routes) && R[x.id].routes.length)
        .map((x) => A.esc(x.name));
      const msg = !R ? "The route timings did not load. They come from <code>data/routes.js</code>."
        : here ? `No ${side()} routes on ${A.esc(m.name)} yet. Pick another side.`
        : `No routes for ${A.esc(m.name)} yet.${names.length ? ` Live works on ${names.join(", ")}.` : ""}`;
      A.panel.innerHTML = `
        <p class="lede"><strong>Live</strong> runs a round clock while dots move along each side's fastest routes from spawn, for a second screen during a match.</p>
        <div class="card live-empty"><p class="desc">${msg}</p></div>
        ${here ? `<div class="row live-ctrl"><span class="field-label">Side</span>${seg("liveSide", SIDES, side())}</div>` : ""}`;
      bindSeg("liveSide", (v) => setPref("liveSide", v));
      return;
    }
    const multi = m.levels.length > 1;
    A.panel.innerHTML = `
      <div class="live-top">
        <div class="live-clock${L.running ? " is-running" : ""}" id="liveClock" aria-live="off">${fmt(elapsed())}</div>
        <div class="row">
          <button type="button" class="btn primary" id="liveGo">Start</button>
          <button type="button" class="btn" id="liveReset">Reset</button>
        </div>
        <span class="kbd-hint"><kbd>Space</kbd> start / pause, <kbd>R</kbd> reset</span>
      </div>
      <div class="live-ctrls">
        <div class="row live-ctrl"><span class="field-label">Side</span>${seg("liveSide", SIDES, side())}</div>
        <div class="row live-ctrl"><span class="field-label">Weapon</span>${seg("liveWeapon", WEAPONS.map((w) => [w.id, w.name]), weapon().id)}</div>
        <div class="row live-ctrl"><span class="field-label">Speed</span>${seg("liveRate", RATES.map((r) => [r, r + "×"]), rate())}</div>
      </div>
      <ol class="live-list" id="liveList">
        ${L.routes.map((rt) => `<li><button type="button" data-id="${A.esc(rt.id)}" class="side-${rt.side}">
            <span class="sd">${rt.sideName}</span>
            <span class="nm">${A.esc(rt.name)}</span>
            ${multi && rt.endLevel === "lower" ? `<span class="lv">lower</span>` : ""}
            <span class="tm">${fmt(rt.time)}</span>
          </button></li>`).join("")}
      </ol>
      <div class="foot">Hit Start when freeze time ends. Times are for running the whole way with the weapon out, no stops or jumps, so real players are a little slower. ${multi ? "Routes show on the level they run on." : ""}</div>`;
    A.panel.querySelector("#liveGo").onclick = toggle;
    A.panel.querySelector("#liveReset").onclick = reset;
    bindSeg("liveSide", (v) => setPref("liveSide", v));
    bindSeg("liveWeapon", (v) => setPref("liveWeapon", v));
    bindSeg("liveRate", (v) => setRate(Number(v)));
    A.panel.querySelector("#liveList").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (b) pick(b.dataset.id);
    };
    syncButtons();
    syncRows();
    draw();
  }
  function bindSeg(id, fn) {
    const box = A.panel.querySelector("#" + id);
    if (!box) return;
    box.onclick = (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b || b.getAttribute("aria-pressed") === "true") return;
      fn(b.dataset.v);
      render();
    };
  }
  function pick(id) {
    L.sel = L.sel === id ? null : id;
    const rt = L.routes.find((r) => r.id === id);
    if (L.sel && rt && !rt.legs.some((lg) => lg.level === A.state.level)) {
      A.setLevel(rt.endLevel); // redraws everything, panel included
    } else {
      syncRows();
      draw();
    }
    if (L.sel && rt && rt.endLevel === A.state.level) A.ensureVisible(rt.end);
  }

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (!A || A.state.mode !== "live" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select")))) return;
    if (e.key === " " || e.code === "Space") {
      e.preventDefault();
      if (e.repeat) return;
      // A focused button would also click on keyup, so let go of it.
      if (t && t !== document.body && t.blur) t.blur();
      toggle();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      reset();
    }
  });

  // ---------- registration ----------
  // Add the tab here, copying a sibling's attributes, so index.html's tab list stays untouched.
  // Runs before js/app.js, which wires up every .modes button.
  const tabs = document.querySelector(".modes");
  if (tabs && tabs.lastElementChild && !tabs.querySelector('[data-mode="live"]')) {
    const b = tabs.lastElementChild.cloneNode(false);
    b.dataset.mode = "live";
    b.textContent = "Live";
    tabs.appendChild(b);
  }
  window.CCT_MODES = window.CCT_MODES || {};
  window.CCT_MODES.live = {
    init(api) {
      A = api;
      layer = A.el("g", { id: "layerLive", class: "live-layer" });
      A.svg.insertBefore(layer, A.$("#layerEdit"));
      layer.style.display = "none";
    },
    render,
    rescale,
    // Leaving the mode or the map stops the clock and clears the radar.
    leave() {
      if (!A) return;
      stop();
      L.acc = 0;
      L.sel = null;
      L.arrived.clear();
      L.routes = [];
      if (layer) { layer.textContent = ""; layer.style.display = "none"; }
    },
    busy: () => !!A && A.state.mode === "live" && L.running,
  };
})();
