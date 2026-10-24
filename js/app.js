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
        return e ? { ...c, x: e.x, y: e.y, edited: true } : { ...c };
      }),
    }));
  }
  let MAPS = buildMaps();

  // ---------- constants ----------
  const HIT_PX = 34;       // radar px; a click this close always counts
  const NEAREST_PX = 80;   // ...or within this and nearer to the target than to any other callout
  const CLOSE_PX = 95;
  const INCH_TO_M = 0.0254; // 1 Hammer unit ~ 1 inch
  const TOUCH = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  const MASTER_STREAK = 3;

  // ---------- dom ----------
  const $ = (s, el = document) => el.querySelector(s);
  const svg = $("#radar");
  const img = $("#radarImg");
  const layerMarkers = $("#layerMarkers");
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

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
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
  function mapMastery(m) {
    if (!m.callouts.length) return 0;
    return m.callouts.reduce((a, c) => a + calloutMastery(m.id, c.id), 0) / m.callouts.length;
  }
  // Weighted pick: weak and unseen callouts come up more often.
  function pickRound(pool, n) {
    const items = pool.map((c) => {
      const r = progress[state.map.id] && progress[state.map.id][c.id];
      const w = 1 + 3 * (1 - calloutMastery(state.map.id, c.id)) + (r ? 0 : 1.5);
      return { c, key: Math.pow(Math.random(), 1 / w) };
    });
    items.sort((a, b) => b.key - a.key);
    return items.slice(0, Math.min(n, items.length)).map((i) => i.c);
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
    const [x, y, w, h] = state.view;
    const m = Math.min(w, h) * 0.12;
    if (p.x < x + m || p.x > x + w - m || p.y < y + m || p.y > y + h - m) centerOn(p);
  }
  function clientToSvg(cx, cy, ctm) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    return pt.matrixTransform((ctm || svg.getScreenCTM()).inverse());
  }

  // pointer handling: pan, pinch, click, drag-marker
  const pointers = new Map();
  let gesture = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const markerEl = e.target.closest && e.target.closest(".marker");
      const ctm = svg.getScreenCTM();
      gesture = {
        type: "maybe", start: { x: e.clientX, y: e.clientY }, ctm, view0: state.view.slice(),
        p0: clientToSvg(e.clientX, e.clientY, ctm), marker: markerEl ? markerEl.dataset.id : null,
      };
      if (state.mode === "edit" && gesture.marker) {
        gesture.type = "drag";
        selectCallout(gesture.marker, false);
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y), view0: state.view.slice(), ctm: svg.getScreenCTM(),
        mid0: clientToSvg((a.x + b.x) / 2, (a.y + b.y) / 2) };
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
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
    } else if (gesture.type === "drag") {
      const p = clientToSvg(e.clientX, e.clientY);
      moveCallout(gesture.marker, Math.round(p.x), Math.round(p.y), false);
    }
  });
  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === "maybe" && pointers.size === 0) {
      const p = clientToSvg(e.clientX, e.clientY);
      onMapClick(p, gesture.marker);
    } else if (gesture.type === "drag") {
      const p = clientToSvg(e.clientX, e.clientY);
      moveCallout(gesture.marker, Math.round(p.x), Math.round(p.y), true);
    }
    if (pointers.size === 0) { gesture = null; svg.classList.remove("is-panning"); }
    else if (gesture.type === "pinch") { gesture = null; }
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
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

  // ---------- rendering the radar ----------
  function levelCallouts() { return state.map.callouts.filter((c) => c.level === state.level); }

  function renderMarkers() {
    layerMarkers.textContent = "";
    const showAll = state.mode === "explore" || state.mode === "edit";
    svg.classList.toggle("show-labels", state.mode === "edit" || (state.mode === "explore" && prefs.labels));
    if (!showAll) return;
    const q = state.search.trim().toLowerCase();
    for (const c of levelCallouts()) {
      const g = el("g", { class: "marker", "data-id": c.id }, layerMarkers);
      el("circle", { class: "hit", cx: c.x, cy: c.y }, g);
      el("circle", { class: "dot", cx: c.x, cy: c.y }, g);
      const t = el("text", { x: c.x, y: c.y }, g);
      t.textContent = c.name;
      if (c.id === state.selected) g.classList.add("is-active");
      if (q && !matches(c, q)) g.classList.add("is-dim");
    }
    rescaleMarks();
  }
  function rescaleMarks() {
    if (!state.map) return;
    const u = unit();
    layerMarkers.querySelectorAll(".marker").forEach((g) => {
      const [hit, dot, text] = g.children;
      const active = g.classList.contains("is-active");
      hit.setAttribute("r", 13 * u);
      dot.setAttribute("r", (active ? 7 : 5) * u);
      text.setAttribute("font-size", 14 * u);
      text.setAttribute("dx", 9 * u);
      text.setAttribute("dy", 4.5 * u);
    });
    layerFb.querySelectorAll("[data-r]").forEach((n) => n.setAttribute("r", Number(n.dataset.r) * u));
    layerFb.querySelectorAll("text").forEach((t) => {
      t.setAttribute("font-size", 16 * u);
      t.setAttribute("dx", t.dataset.dx * u);
      t.setAttribute("dy", t.dataset.dy * u);
    });
  }
  function fbCircle(cls, p, r) { return el("circle", { class: cls, cx: p.x, cy: p.y, "data-r": r }, layerFb); }
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
    if (refit) fitView();
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
      const pct = Math.round(mapMastery(m) * 100);
      b.title = `${m.name}: ${pct}% learned`;
      b.innerHTML = `${esc(m.name)}<span class="mastery"><i style="width:${pct}%"></i></span>`;
      b.onclick = () => selectMap(m.id);
      nav.appendChild(b);
    }
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
    document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
    clearFeedback();
    renderMarkers();
    renderPanel();
    updateHash();
  }
  document.querySelectorAll(".modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

  function updateHash() {
    if (!state.map) return;
    const h = `#${state.map.id}/${state.mode}`;
    if (location.hash !== h) history.replaceState(null, "", h);
  }

  function renderPanel() {
    $("#stagePrompt").textContent = "";
    if (state.mode === "explore") return renderExplore();
    if (state.mode === "edit") return renderEdit();
    return renderQuiz();
  }

  function footer() {
    return `<div class="foot">Callout names follow <a href="https://totalcsgo.com/callouts" target="_blank" rel="noopener">Total CS</a>. Radar images come from the CS2 game files. Positions were placed by hand; if one is off, move it in Edit.</div>`;
  }

  function matches(c, q) {
    return c.name.toLowerCase().includes(q) || c.alt.some((a) => a.toLowerCase().includes(q));
  }

  function calloutCard(c) {
    const r = progress[state.map.id] && progress[state.map.id][c.id];
    const stat = r ? `Answered ${r.c} of ${r.s} correctly` : "Not drilled yet";
    return `<div class="card">
      <h3>${esc(c.name)}</h3>
      ${c.alt.length ? `<p class="alt">Also called ${c.alt.map(esc).join(", ")}</p>` : ""}
      <p class="desc">${esc(c.desc)}</p>
      <div class="meta">${state.map.levels.length > 1 ? esc(levelName(c.level)) + ". " : ""}${stat}.</div>
    </div>`;
  }

  // ----- Explore -----
  function renderExplore() {
    const m = state.map;
    const q = state.search.trim().toLowerCase();
    const list = m.callouts.slice().sort((a, b) => a.name.localeCompare(b.name)).filter((c) => !q || matches(c, q));
    const sel = m.callouts.find((c) => c.id === state.selected);
    panel.innerHTML = `
      <p class="lede">${m.callouts.length} callouts on ${esc(m.name)}. Tap a dot or a name to see where it is and what it means.</p>
      <div class="row">
        <label class="switch"><input type="checkbox" id="labelsToggle" ${prefs.labels ? "checked" : ""}> Show all names on the map</label>
      </div>
      <input class="search" id="search" type="search" placeholder="Search callouts" value="${esc(state.search)}" autocomplete="off" aria-label="Search callouts">
      ${sel ? calloutCard(sel) : ""}
      <ul class="callout-list" id="list">
        ${list.map((c) => `<li><button type="button" data-id="${c.id}" class="${c.id === state.selected ? "is-active" : ""}">
            <span class="nm">${esc(c.name)}</span>
            ${m.levels.length > 1 && c.level === "lower" ? `<span class="lv">lower</span>` : ""}
            <span class="ms" title="${Math.round(calloutMastery(m.id, c.id) * 100)}% learned"><i style="width:${calloutMastery(m.id, c.id) * 100}%"></i></span>
          </button></li>`).join("") || `<li class="lede">No callout matches “${esc(state.search)}”.</li>`}
      </ul>
      ${footer()}`;
    $("#labelsToggle").onchange = (e) => { prefs.labels = e.target.checked; store.set(K.prefs, prefs); renderMarkers(); };
    const s = $("#search");
    s.oninput = () => {
      state.search = s.value;
      const pos = s.selectionStart;
      renderExplore();
      renderMarkers();
      const s2 = $("#search"); s2.focus(); s2.setSelectionRange(pos, pos);
    };
    $("#list").onclick = (e) => { const b = e.target.closest("button[data-id]"); if (b) selectCallout(b.dataset.id, true); };
  }

  function selectCallout(id, center) {
    const c = state.map.callouts.find((x) => x.id === id);
    if (!c) return;
    state.selected = id;
    if (c.level !== state.level) setLevel(c.level);
    renderMarkers();
    renderPanel();
    if (center) { centerOn(c, 1.8); panel.scrollTop = 0; }
    const active = panel.querySelector(".callout-list .is-active");
    if (active && !center) active.scrollIntoView({ block: "nearest" });
  }

  // ----- Edit -----
  function renderEdit() {
    const m = state.map;
    const sel = m.callouts.find((c) => c.id === state.selected);
    const n = edits[m.id] ? Object.keys(edits[m.id]).length : 0;
    panel.innerHTML = `
      <p class="lede">Drag any dot to where the callout really is. Changes save in this browser and are used by the quizzes straight away. Export them to update the site for everyone.</p>
      ${sel ? `${calloutCard(sel)}
        <div class="row"><span class="field-label">Position ${Math.round(sel.x)}, ${Math.round(sel.y)}</span><span class="spacer"></span>
        ${sel.edited ? `<button type="button" class="btn small quiet" id="undoOne">Undo move</button>` : ""}</div>`
        : `<div class="card"><p class="desc" style="margin:0">Pick a dot on the map to select it.</p></div>`}
      <div class="row">
        <span class="field-label">${n ? `${n} moved on ${esc(m.name)}` : `No moves on ${esc(m.name)} yet`}</span>
      </div>
      <div class="row">
        <button type="button" class="btn primary" id="copyJson">Copy map data</button>
        <button type="button" class="btn" id="dlJson">Download</button>
        <span class="spacer"></span>
        <button type="button" class="btn quiet" id="resetEdits" ${n ? "" : "disabled"}>Discard moves</button>
      </div>
      <p class="lede">The copied data replaces the <strong>callouts</strong> list for ${esc(m.name)} in <code>data/maps.js</code>.</p>
      ${footer()}`;
    const u = $("#undoOne");
    if (u) u.onclick = () => { delete edits[m.id][sel.id]; saveEdits(); };
    $("#copyJson").onclick = async () => {
      try { await navigator.clipboard.writeText(exportJson()); toast("Map data copied"); }
      catch { downloadJson(); }
    };
    $("#dlJson").onclick = downloadJson;
    $("#resetEdits").onclick = () => { delete edits[m.id]; saveEdits(); toast("Moves discarded"); };
  }
  function exportJson() {
    const m = state.map;
    const rows = m.callouts.map(({ edited, ...c }) => "      " + JSON.stringify({ ...c, x: Math.round(c.x), y: Math.round(c.y) }));
    return `"callouts": [\n${rows.join(",\n")}\n    ]`;
  }
  function downloadJson() {
    const blob = new Blob([exportJson() + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.map.id}-callouts.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Downloaded " + a.download);
  }
  function moveCallout(id, x, y, commit) {
    const c = state.map.callouts.find((k) => k.id === id);
    if (!c) return;
    c.x = Math.max(0, Math.min(1024, x));
    c.y = Math.max(0, Math.min(1024, y));
    const g = layerMarkers.querySelector(`.marker[data-id="${CSS.escape(id)}"]`);
    if (g) {
      g.querySelectorAll("circle").forEach((ci) => { ci.setAttribute("cx", c.x); ci.setAttribute("cy", c.y); });
      const t = g.querySelector("text"); t.setAttribute("x", c.x); t.setAttribute("y", c.y);
    }
    if (commit) {
      edits[state.map.id] = edits[state.map.id] || {};
      edits[state.map.id][id] = { x: c.x, y: c.y };
      saveEdits();
    }
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
    $("#stagePrompt").textContent = state.mode === "find" && q && !q.done && !q.answered ? current().name : "";
    if (!q) return renderQuizSetup();
    if (q.done) return renderQuizSummary();
    return state.mode === "find" ? renderFindStep() : renderNameStep();
  }

  function renderQuizSetup() {
    const m = state.map;
    const pct = Math.round(mapMastery(m) * 100);
    const isFind = state.mode === "find";
    const sizes = [10, 20, 0];
    panel.innerHTML = `
      <p class="lede">${isFind
        ? `You get a callout name. <strong>Click where it is</strong> on the radar. Within a few metres counts.`
        : `A spot pulses on the radar. <strong>Pick its name</strong> from four nearby callouts.`}
        Callouts you keep missing come up more often.</p>
      <div class="row"><span class="field-label">Questions</span>
        <div class="seg" id="roundSize">${sizes.map((s) => `<button type="button" data-n="${s}" aria-pressed="${prefs.round === s}">${s || "All " + m.callouts.length}</button>`).join("")}</div>
      </div>
      <div class="row"><button type="button" class="btn primary" id="start">Start ${esc(m.name)} round</button></div>
      <p class="lede">${pct}% of ${esc(m.name)} learned. A callout counts as learned after ${MASTER_STREAK} correct answers in a row.</p>
      ${footer()}`;
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
    if (state.mode === "name") {
      q.options = buildOptions(c);
      fbCircle("target-pulse", c, 10);
      fbCircle("target-ring", c, 10);
      ensureVisible(c);
      rescaleMarks();
    }
    renderPanel();
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
      ${r ? `<div class="row"><button type="button" class="btn primary" id="next">${q.i + 1 < q.items.length ? "Next callout" : "See results"}</button><span class="kbd-hint"><kbd>Enter</kbd></span></div>` : ""}
      <div class="row"><span class="spacer"></span><button type="button" class="btn quiet small" id="quit">End round</button></div>`;
    bindStepButtons();
  }

  function resultBlock(r, c) {
    const titles = { hit: "Right spot", close: "Close", miss: "Missed" };
    let detail;
    if (state.mode === "find") {
      detail = `You were <strong>${meters(r.d)} m</strong> away.`;
      if (r.kind !== "hit" && r.near && r.near.id !== c.id) detail += ` You clicked nearest to <strong>${esc(r.near.name)}</strong>.`;
    } else {
      detail = r.kind === "hit" ? "" : `That spot is <strong>${esc(c.name)}</strong>.`;
    }
    return `<div class="result ${r.kind}"><h4>${titles[r.kind]}</h4>${detail ? `<p>${detail}</p>` : ""}<p>${esc(c.desc)}</p></div>`;
  }

  function onMapClick(p, markerId) {
    if (state.mode === "explore") {
      if (markerId) selectCallout(markerId, false);
      else if (state.selected) { state.selected = null; renderMarkers(); renderPanel(); }
      return;
    }
    if (state.mode === "edit") {
      if (markerId) selectCallout(markerId, false);
      return;
    }
    if (state.mode !== "find" || !state.quiz || state.quiz.done || state.quiz.answered) return;
    const c = current();
    const d = dist(p, c);
    let near = null, best = Infinity;
    for (const o of levelCallouts()) { const od = dist(p, o); if (od < best) { best = od; near = o; } }
    const nearestIsTarget = near && (near.id === c.id || near.name === c.name);
    const kind = d <= HIT_PX || (nearestIsTarget && d <= NEAREST_PX) ? "hit" : d <= CLOSE_PX ? "close" : "miss";
    const q = state.quiz;
    q.answered = true;
    q.results[q.i] = { kind, d, near, id: c.id };
    score(state.map.id, c.id, kind === "hit");
    // feedback on the radar
    el("line", { class: "fb-line", x1: p.x, y1: p.y, x2: c.x, y2: c.y }, layerFb);
    el("circle", { class: "fb-zone", cx: c.x, cy: c.y, r: HIT_PX }, layerFb);
    fbCircle("fb-true", c, 9);
    fbCircle("fb-guess" + (kind === "hit" ? " hit" : ""), p, 5);
    fbLabel(c, c.name);
    rescaleMarks();
    ensureVisible(c);
    renderMapList();
    renderPanel();
  }

  function renderNameStep() {
    const q = state.quiz, c = current();
    const r = q.results[q.i];
    panel.innerHTML = `
      ${progressBar()}
      <div class="prompt">
        <p class="ask">Question ${q.i + 1} of ${q.items.length}. What is the pulsing spot called?</p>
        ${state.map.levels.length > 1 ? `<p class="hint"><span class="chip">${esc(levelName(c.level))}</span></p>` : ""}
      </div>
      <div class="choices" id="choices">
        ${q.options.map((o, i) => {
          let cls = "choice";
          if (r) { if (o.id === c.id) cls += " right"; else if (q.choice === o.id) cls += " wrong"; }
          return `<button type="button" class="${cls}" data-id="${o.id}" ${r ? "disabled" : ""}><kbd>${i + 1}</kbd>${esc(o.name)}</button>`;
        }).join("")}
      </div>
      ${r ? resultBlock(r, c) : `<p class="kbd-hint">Press <kbd>1</kbd> to <kbd>4</kbd> to answer.</p>`}
      ${r ? `<div class="row"><button type="button" class="btn primary" id="next">${q.i + 1 < q.items.length ? "Next spot" : "See results"}</button><span class="kbd-hint"><kbd>Enter</kbd></span></div>` : ""}
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
    q.results[q.i] = { kind: ok ? "hit" : "miss", id: c.id };
    score(state.map.id, c.id, ok);
    clearFeedback();
    fbCircle("fb-true", c, 9);
    fbLabel(c, c.name);
    if (!ok) {
      const wrong = state.map.callouts.find((o) => o.id === id);
      if (wrong && wrong.level === state.level) { fbCircle("fb-guess", wrong, 5); fbLabel(wrong, wrong.name); }
    }
    rescaleMarks();
    renderMapList();
    renderPanel();
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

  function renderQuizSummary() {
    const q = state.quiz;
    const total = q.results.length;
    const hits = q.results.filter((r) => r.kind === "hit").length;
    const missed = q.results.filter((r) => r.kind !== "hit").map((r) => state.map.callouts.find((c) => c.id === r.id));
    panel.innerHTML = `
      ${progressBar()}
      <div>
        <div class="score-big">${hits}<small> / ${total}</small></div>
        <p class="lede">${hits === total ? "Clean round. Try a bigger round or another map." : `${total - hits} to work on. They will come up more often next time.`}</p>
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
    if (state.map && hMap && hMap !== state.map.id && MAPS.some((m) => m.id === hMap)) selectMap(hMap);
    if (hMode && hMode !== state.mode && ["explore", "find", "name", "edit"].includes(hMode)) setMode(hMode);
  });
  boot();
})();
