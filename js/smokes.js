// Smokes mode: well-known smoke line-ups on the radar. Browse them by side and target, pick a landing
// spot to see where it is thrown from, and pick a throw spot for how to throw it.
// Line-ups come from data/smokes.js (window.CALLOUT_SMOKES). Like js/live.js, this file loads before
// js/app.js, registers itself in window.CCT_MODES, and gets the app's helpers through init(api).
(() => {
  "use strict";

  const SIDES = [["t", "T"], ["ct", "CT"], ["both", "Both"]];
  const SITES = [["a", "A"], ["mid", "Mid"], ["b", "B"]];
  const SITE_NAME = { a: "A", mid: "Mid", b: "B" };
  const SITE_HEAD = { a: "A site", mid: "Mid", b: "B site" };
  const SIDE_NAME = { t: "T", ct: "CT" };
  // Throw techniques, in the order the drill offers them. Movement throws stand out on the card.
  const THROWS = [
    { id: "left", name: "Left click", short: "Left", glyph: "◐" },
    { id: "right", name: "Right click", short: "Right", glyph: "◑" },
    { id: "leftright", name: "Left+Right", short: "L+R", glyph: "●" },
    { id: "jump", name: "Jump-throw", short: "Jump", glyph: "↑", move: true },
    { id: "runjump", name: "Run+Jump", short: "Run+Jump", glyph: "↗", move: true },
    { id: "walk", name: "Walk + throw", short: "Walk", glyph: "→", move: true },
  ];
  const throwOf = (id) => THROWS.find((t) => t.id === id);
  const STANCES = { standing: "Standing", crouch: "Crouch" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const LAND_U = 144;  // a smoke's radius on the radar, in game units
  const HIT_PX = 22;   // screen px radius of every tap target (44 px across)
  const ISSUE_URL = "https://github.com/jrposada/cs2-callout-trainer/issues/new";
  const REDUCED = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  let A = null;     // app api, from init()
  let layer = null; // <g> on the radar, owned by this mode
  const S = {
    focus: null,       // landing callout id whose throws are shown
    sel: null,         // selected line-up id
    sites: new Set(),  // target filter; empty = every site
    drawnFocus: null,  // the focus whose arcs last drew in
  };

  // ---------- data ----------
  const warned = new Set();
  // Why a line-up can't be used, or "" if it can.
  function problem(r) {
    if (!r || typeof r.id !== "string" || !r.id) return "no id";
    if (!SIDE_NAME[r.side]) return `side "${r.side}"`;
    if (!SITE_NAME[r.site]) return `site "${r.site}"`;
    if (!throwOf(r.throw)) return `throw "${r.throw}"`;
    if (!STANCES[r.stance]) return `stance "${r.stance}"`;
    if (r.status !== "unverified" && r.status !== "checked") return `status "${r.status}"`;
    if (r.status === "checked" && !/^\d{4}-\d{2}$/.test(r.checked || "")) return "checked needs a YYYY-MM date";
    if (!r.to || !A.callout(r.to.callout)) return `landing callout "${r.to && r.to.callout}" not on this map`;
    if (!r.from || !A.callout(r.from.callout)) return `throw callout "${r.from && r.from.callout}" not on this map`;
    return "";
  }
  function point(spec, c) {
    return { callout: c.id, name: c.name, x: Number.isFinite(spec.x) ? spec.x : c.x, y: Number.isFinite(spec.y) ? spec.y : c.y, level: spec.level || c.level || "upper" };
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
      out.push({ ...r, to: point(r.to, A.callout(r.to.callout)), from: point(r.from, A.callout(r.from.callout)) });
    }
    const so = { a: 0, mid: 1, b: 2 };
    return out.sort((x, y) => so[x.site] - so[y.site] || (x.side === y.side ? 0 : x.side === "t" ? -1 : 1) || x.name.localeCompare(y.name));
  }
  const side = () => (SIDES.some((s) => s[0] === A.prefs.smkSide) ? A.prefs.smkSide : "both");
  const passes = (l) => (side() === "both" || l.side === side()) && (!S.sites.size || S.sites.has(l.site));
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
      if (t.level !== lv) continue;
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
        if (l.to.callout !== S.focus || l.from.level !== lv || l.to.level !== lv) continue;
        const on = l.id === S.sel;
        const cls = ` ${l.side}${on ? " is-sel" : sel ? " is-dim" : ""}`;
        const d = arcPath(l.from, l.to);
        const casing = A.el("path", { class: "fb-casing smk-casing" + cls, d }, gArc);
        const arc = A.el("path", { class: "smk-arc" + cls, d }, gArc);
        if (animate) { casing.classList.add("is-draw"); arc.classList.add("is-draw"); }
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
    if (l.to.level !== A.state.level) A.setLevel(l.to.level);
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
  function back() {
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
  function techChips(l) {
    const t = throwOf(l.throw);
    return `<span class="tech${t.move ? " is-move" : ""}"><span class="g" aria-hidden="true">${t.glyph}</span>${t.name}</span><span class="tech">${STANCES[l.stance]}</span>`;
  }
  function card(l, cls = "") {
    return `<div class="card smk-card ${cls}">
      <div class="smk-head"><h3>${esc(l.name)}</h3><span class="chip ${l.side}">${SIDE_NAME[l.side]}</span></div>
      <p class="alt">from ${esc(l.from.name)} · ${SITE_NAME[l.site]}</p>
      <dl class="smk-rows">
        <div class="smk-row"><dt class="smk-k">Stand</dt><dd>${esc(l.stand)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Aim</dt><dd class="smk-aim">${esc(l.aim)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Throw</dt><dd class="smk-techs">${techChips(l)}</dd></div>
        <div class="smk-row"><dt class="smk-k">Lands</dt><dd>${esc(l.lands)}</dd></div>
      </dl>
      <div class="meta smk-meta">${accBadge(l)}<a class="smk-wrong" href="${esc(issueUrl(l))}" target="_blank" rel="noopener">This line-up is wrong?</a></div>
    </div>`;
  }
  function row(l) {
    const t = throwOf(l.throw);
    const cls = `side-${l.side}${l.id === S.sel ? " is-active" : ""}${l.status !== "checked" ? " is-unverified" : ""}`;
    return `<li><button type="button" data-id="${esc(l.id)}" class="${cls}"${l.id === S.sel ? ` aria-current="true"` : ""}>
        <span class="sd">${SIDE_NAME[l.side]}</span>
        <span class="nm">${esc(l.name)}</span>
        <span class="from">from ${esc(l.from.name)}</span>
        <span class="tq${t.move ? " is-move" : ""}">${t.short}</span>
        ${l.status !== "checked" ? `<span class="unv" title="Approximate, not checked in game" aria-hidden="true">◌</span><span class="sr-only">, approximate</span>` : ""}
      </button></li>`;
  }

  function renderEmpty() {
    const m = A.state.map;
    layer.textContent = "";
    const D = window.CALLOUT_SMOKES;
    const others = (window.CALLOUT_MAPS || []).map((x) => [x, rawFor(x.id).length]).filter(([x, n]) => n && x.id !== m.id);
    const msg = !D ? `The line-ups did not load. They come from <code>data/smokes.js</code>.`
      : `No smokes for ${esc(m.name)} yet.${others.map(([x, n]) => ` <a href="#${x.id}/smokes">${esc(x.name)} has ${n}.</a>`).join("")}`;
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
    if (a.id) return "#" + a.id;
    return ".smk-list button[data-id]";
  }

  function render() {
    const m = A.state.map;
    layer.style.display = "";
    const every = all();
    if (!every.length) { S.sel = S.focus = null; return renderEmpty(); }
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
      <div class="row smk-ctrl" role="group" aria-label="Target"><span class="field-label">Target</span>
        ${SITES.map(([v, l]) => `<button type="button" class="flt-chip" data-site="${v}" aria-pressed="${S.sites.has(v)}">${l}</button>`).join("")}
      </div>
      ${sel ? card(sel, "is-sticky") : ""}
      <div class="smk-groups" id="smkList">
        ${groups.map(([s, ls]) => `<h4 class="smk-group">${SITE_HEAD[s]}</h4><ul class="smk-list">${ls.map(row).join("")}</ul>`).join("")}
      </div>
      <span class="kbd-hint"><kbd>[</kbd> <kbd>]</kbd> previous / next, <kbd>T</kbd> <kbd>C</kbd> <kbd>B</kbd> side, <kbd>Esc</kbd> back</span>
      <div class="foot">These line-ups are well-known community smokes, written up in our own words and placed by hand. They are approximate and not yet checked in game. Callout names follow <a href="https://totalcsgo.com/callouts" target="_blank" rel="noopener">Total CS</a>.</div>`;
    // On narrow screens the panel sits below the map, so echo the selection on the stage.
    A.$("#stagePrompt").innerHTML = sel ? `${esc(sel.name)}<span class="sp-desc">Aim: ${esc(sel.aim)}</span>` : "";
    bindSeg("smkSide", setSide);
    A.panel.querySelectorAll(".flt-chip").forEach((b) => (b.onclick = () => {
      const s = b.dataset.site;
      if (S.sites.has(s)) S.sites.delete(s); else S.sites.add(s);
      render();
      const k = filtered().length;
      A.announce(`${S.sites.size ? [...S.sites].map((x) => SITE_NAME[x]).join(", ") : "Every target"}: ${k} line-up${k === 1 ? "" : "s"}.`);
    }));
    A.$("#smkList").onclick = (e) => {
      const b = e.target.closest("button[data-id]");
      if (!b) return;
      if (b.dataset.id === S.sel) back(); else select(b.dataset.id, "list");
    };
    if (keep) {
      const f = A.panel.querySelector(keep);
      if (f) f.focus({ preventScroll: true });
    }
    draw(list);
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

  // ---------- keyboard ----------
  document.addEventListener("keydown", (e) => {
    if (!A || A.state.mode !== "smokes" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select")))) return;
    if (!all().length) return;
    if (e.key === "[" || e.key === "]") { e.preventDefault(); step(e.key === "]" ? 1 : -1); return; }
    const k = e.key.toLowerCase();
    const v = k === "t" ? "t" : k === "c" ? "ct" : k === "b" ? "both" : null;
    if (v) { e.preventDefault(); setSide(v); }
  });

  // ---------- registration ----------
  // Add the tab after the others, copying a sibling's attributes (see js/live.js).
  const tabs = document.querySelector(".modes");
  if (tabs && tabs.lastElementChild && !tabs.querySelector('[data-mode="smokes"]')) {
    const b = tabs.lastElementChild.cloneNode(false);
    b.dataset.mode = "smokes";
    b.textContent = "Smokes";
    tabs.appendChild(b);
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
    // #<map>/smokes/<id> selects that line-up; anything else (or nothing) is plain Browse.
    route(arg) {
      const l = arg && all().find((x) => x.id === arg);
      if (!l) { if (S.sel || S.focus) { S.sel = S.focus = null; render(); } return; }
      if (!passes(l)) {
        if (side() !== "both" && side() !== l.side) { A.prefs.smkSide = "both"; A.savePrefs(); }
        S.sites.clear();
      }
      select(l.id, "route");
    },
    hashArg: () => S.sel || "",
    // Leaving the mode or the map clears the radar.
    leave() {
      if (!A) return;
      S.sel = S.focus = S.drawnFocus = null;
      if (layer) { layer.textContent = ""; layer.style.display = "none"; }
    },
  };
})();
