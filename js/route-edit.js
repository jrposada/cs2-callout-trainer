// Route editor for Live mode: fix one route by hand. Pick the spawn it starts from and the points
// it goes through: Walk points (the pathfinder finds the way there), Jump points (straight there,
// over boxes or ledges, for a few seconds each) and Over points (straight there for free, e.g.
// walking along the top of something the radar can't show).
// The pathfinding runs in tools/make_routes.py, so the map shows the plan (dashed = walk legs,
// solid = jumps) over the route as last generated. Edits are kept in this browser; copy one
// target for tools/routes.json, or download the map's edits and run
//   python3 tools/make_routes.py --apply route-edits-<map>.json
// js/live.js owns the mode and hands the panel, the radar layer and the pointer to this editor
// while it is open.
(() => {
  "use strict";

  const KEY = "cct.routeEdits";
  const JUMP_S = 0.5; // a new Jump point's seconds: about one jump onto a box
  const KINDS = [["walk", "Walk"], ["jump", "Jump"], ["over", "Over"]];
  const KIND_HELP = {
    walk: "the pathfinder finds the way there",
    jump: "straight there over boxes or a ledge, plus its seconds",
    over: "straight there for free, e.g. along the top of something",
  };

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  }
  function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode: edits last the session */ }
  }
  const r1 = (v) => Math.round(v * 100) / 100;

  // routes.json "via" <-> editor points [{ x, y, lv, kind, s }]
  function fromVia(via) {
    const out = [];
    for (const v of Array.isArray(via) ? via : []) {
      if (Array.isArray(v)) { out.push({ x: +v[0], y: +v[1], lv: v[2] || null, kind: "walk", s: 0 }); continue; }
      if (!v || !v.jump) continue;
      const jp = Array.isArray(v.jump[0]) ? v.jump : [v.jump];
      jp.forEach((q, i) => {
        // Seconds given for the whole jump go on its first point.
        const s = (q.length > 2 ? +q[2] : 0) + (i === 0 ? +(v.s || 0) : 0);
        out.push({ x: +q[0], y: +q[1], lv: v.level || null, kind: s > 0 ? "jump" : "over", s });
      });
    }
    return out;
  }
  function toVia(pts) {
    const via = [];
    let group = null;
    for (const p of pts) {
      const lv = p.lv && p.lv !== "upper" ? p.lv : null;
      if (p.kind === "walk") {
        group = null;
        via.push(lv ? [p.x, p.y, lv] : [p.x, p.y]);
        continue;
      }
      if (!group) { group = { jump: [] }; if (lv) group.level = lv; via.push(group); }
      group.jump.push(p.kind === "jump" && p.s > 0 ? [p.x, p.y, r1(p.s)] : [p.x, p.y]);
    }
    return via;
  }

  window.CCT_ROUTE_EDIT = function create(ctx) {
    const { A, layer } = ctx;
    let E = null; // { r, side, to, from, pts, add, sel, hist, drag }

    const mapId = () => A.state.map.id;
    const sideKey = (r) => (r.side === "CT" ? "CT" : "T");
    const sideCls = () => (E.side === "CT" ? "ct" : "t");
    function stored(r) {
      const m = load()[mapId()];
      return m && m[sideKey(r)] && m[sideKey(r)][r.to];
    }
    // The route as routes.json (or route_edits.json) set it, before any edit in this browser.
    const base = (r) => ({ from: r.pin != null ? +r.pin : null, pts: fromVia(r.via) });
    const snapshot = () => JSON.stringify({ from: E.from, pts: E.pts });
    function same(a, b) { return JSON.stringify({ from: a.from, pts: a.pts }) === JSON.stringify({ from: b.from, pts: b.pts }); }
    function entry() {
      const o = {};
      if (E.from != null) o.from = E.from;
      const via = toVia(E.pts);
      if (via.length) o.via = via;
      return o;
    }
    function persist() {
      const all = load();
      const m = (all[mapId()] = all[mapId()] || {});
      const s = (m[E.side] = m[E.side] || {});
      if (same(E, base(E.r))) delete s[E.to];
      else s[E.to] = entry();
      if (!Object.keys(s).length) delete m[E.side];
      if (!Object.keys(m).length) delete all[mapId()];
      save(all);
    }
    function change(fn) {
      E.hist.push(snapshot());
      if (E.hist.length > 100) E.hist.shift();
      fn();
      persist();
      render();
    }
    function undo() {
      if (!E || !E.hist.length) return;
      const s = JSON.parse(E.hist.pop());
      E.from = s.from; E.pts = s.pts;
      if (E.sel != null && E.sel >= E.pts.length) E.sel = null;
      persist();
      render();
    }

    function spawns() { return ctx.spawnList(ctx.mapData(), E.side); }
    function startPt() {
      const list = spawns();
      const sp = list[E.from != null ? E.from : +E.r.from || 0] || list[0];
      return sp ? { x: +sp.x, y: +sp.y, lv: sp.level || "upper" } : null;
    }
    function endPt() {
      const c = A.callout(E.to);
      return c ? { x: c.x, y: c.y, lv: c.level || "upper" } : null;
    }

    // ---------- radar ----------
    function draw() {
      layer.textContent = "";
      layer.classList.remove("has-sel", "is-idle");
      const lv = A.state.level;
      const g = () => A.el("g", {}, layer);
      const gOld = g(), gPlan = g(), gSpawn = g(), gPts = g();
      const cls = sideCls();
      // The route as last generated, faint, for reference.
      const segs = Array.isArray(E.r.segments) && E.r.segments.length ? E.r.segments : [{ level: E.r.level, path: E.r.path }];
      for (const s of segs) {
        if ((s.level || E.r.level || "upper") !== lv) continue;
        const p = s.path || [];
        const pts = [];
        for (let i = 0; i + 1 < p.length; i += 2) pts.push(`${p[i]},${p[i + 1]}`);
        A.el("polyline", { class: `re-old ${cls}`, points: pts.join(" ") }, gOld);
      }
      // The plan: start, points, end. A leg into a Walk point (or the end) is dashed:
      // the pathfinder decides that way. A leg into a Jump or Over point is straight.
      const chain = [startPt(), ...E.pts.map((p) => ({ ...p, lv: p.lv || "upper" })), endPt()].filter(Boolean);
      for (let i = 1; i < chain.length; i++) {
        const a = chain[i - 1], b = chain[i];
        if (a.lv !== lv || b.lv !== lv) continue;
        const kind = b.kind && b.kind !== "walk" ? "straight" : "walk";
        A.el("line", { class: `re-leg ${cls} ${kind}`, x1: a.x, y1: a.y, x2: b.x, y2: b.y }, gPlan);
      }
      // Spawns: click one to start there. The pinned one is solid; with Fastest, the one used is dashed bold.
      spawns().forEach((sp, i) => {
        if ((sp.level || "upper") !== lv) return;
        const pinned = E.from === i, used = E.from == null && (+E.r.from || 0) === i;
        A.el("circle", { class: `re-spawn ${cls}${pinned ? " is-pinned" : ""}${used ? " is-used" : ""}`, cx: sp.x, cy: sp.y, "data-r": 7, "data-spawn": i }, gSpawn);
        const t = A.el("text", { class: "re-num is-spawn", x: sp.x, y: sp.y, "data-dx": 0, "data-dy": 4 }, gSpawn);
        t.textContent = String(i + 1);
      });
      const end = endPt();
      if (end && end.lv === lv) A.el("circle", { class: `re-end ${cls}`, cx: end.x, cy: end.y, "data-r": 6 }, gPts);
      E.pts.forEach((p, i) => {
        if ((p.lv || "upper") !== lv) return;
        A.el("circle", { class: `re-pt ${p.kind}${E.sel === i ? " is-sel" : ""}`, cx: p.x, cy: p.y, "data-r": E.sel === i ? 7.5 : 6, "data-i": i }, gPts);
        const t = A.el("text", { class: "re-num", x: p.x, y: p.y, "data-dy": -9 }, gPts);
        t.textContent = String(i + 1) + (p.kind === "jump" ? ` · ${r1(p.s)}s` : "");
      });
      ctx.rescale();
    }
    function spawnAt(p) {
      const u = A.unit();
      let best = null;
      spawns().forEach((sp, i) => {
        if ((sp.level || "upper") !== A.state.level) return;
        const d = Math.hypot(sp.x - p.x, sp.y - p.y);
        if (d <= 10 * u && (!best || d < best.d)) best = { i, d };
      });
      return best ? best.i : null;
    }

    // ---------- panel ----------
    function count() {
      const m = load()[mapId()] || {};
      return Object.values(m).reduce((a, s) => a + Object.keys(s).length, 0);
    }
    function render() {
      const n = spawns().length;
      const local = !!stored(E.r);
      const c = A.callout(E.to);
      const name = c ? c.name : E.to;
      const json = JSON.stringify({ to: E.to, ...entry() });
      const multi = A.state.map.levels.length > 1;
      const startSeg = [["", "Fastest"], ...Array.from({ length: n }, (_, i) => [String(i), String(i + 1)])];
      A.panel.innerHTML = `
        <div class="re-head">
          <span class="re-side side-${sideCls()}">${E.side}</span>
          <h2 class="re-title">${A.esc(name)}</h2>
          <button type="button" class="btn small" id="reDone">Back</button>
        </div>
        <p class="desc re-now">Now ${ctx.fmt(+E.r.time)} from spawn ${(+E.r.from || 0) + 1}${E.r.edited ? ", set by hand" : ""}, drawn faint. Your changes show as dashed and solid lines; they get a path and a time when you regenerate.</p>
        <div class="row live-ctrl"><span class="field-label">Start</span>${seg("reFrom", startSeg, E.from == null ? "" : String(E.from))}</div>
        <div class="row live-ctrl"><span class="field-label">Click adds</span>${seg("reAdd", KINDS, E.add)}</div>
        <p class="kbd-hint re-help"><strong>${KINDS.find((k) => k[0] === E.add)[1]}</strong>: ${KIND_HELP[E.add]}. Click a spawn to start there. Drag a point to move it, click it to select it; the next point goes after the selected one.${multi ? " Points go on the level you're viewing." : ""}</p>
        ${E.pts.length ? `<ol class="re-pts">${E.pts.map((p, i) => `
          <li class="${E.sel === i ? "is-sel" : ""}" data-i="${i}">
            <button type="button" class="re-pick" data-act="pick" aria-pressed="${E.sel === i}">${i + 1}</button>
            ${seg("", KINDS.map(([k, l]) => [k, l[0]]), p.kind, `data-i="${i}" data-act="kind" aria-label="Point ${i + 1} kind"`)}
            ${p.kind === "jump" ? `<label class="re-s"><input type="number" min="0" max="5" step="0.1" value="${r1(p.s)}" data-i="${i}" aria-label="Point ${i + 1} seconds">s</label>` : `<span class="re-xy">${p.x}, ${p.y}${multi && p.lv && p.lv !== "upper" ? ` · ${A.esc(p.lv)}` : ""}</span>`}
            <button type="button" class="btn small quiet re-del" data-act="del" aria-label="Remove point ${i + 1}">✕</button>
          </li>`).join("")}</ol>`
        : `<div class="card re-empty"><p class="desc">No points: the route takes the plain fastest way. Click the map to add one.</p></div>`}
        <div class="row">
          <button type="button" class="btn small" id="reUndo"${E.hist.length ? "" : " disabled"}>Undo</button>
          <button type="button" class="btn small" id="reClear"${E.pts.length || E.from != null ? "" : " disabled"}>Clear</button>
          <button type="button" class="btn small quiet" id="reRevert"${local ? "" : " disabled"}>Discard my changes</button>
        </div>
        <pre class="re-json" aria-label="routes.json target">${A.esc(json)}</pre>
        <div class="row">
          <button type="button" class="btn small" id="reCopy">Copy JSON</button>
          <button type="button" class="btn small primary" id="reDown"${count() ? "" : " disabled"}>Download ${A.esc(A.state.map.name)} edits${count() ? ` (${count()})` : ""}</button>
        </div>
        <div class="foot">${local ? "Saved in this browser. " : ""}To use your edits, download them and run <code>python3 tools/make_routes.py --apply route-edits-${A.esc(mapId())}.json</code>, or paste the JSON over this target in <code>tools/routes.json</code>.</div>`;
      const P = A.panel;
      P.querySelector("#reDone").onclick = close;
      bindSeg("reFrom", (v) => change(() => { E.from = v === "" ? null : Number(v); }));
      bindSeg("reAdd", (v) => { E.add = v; render(); });
      P.querySelector("#reUndo").onclick = undo;
      P.querySelector("#reClear").onclick = () => change(() => { E.pts = []; E.from = null; E.sel = null; });
      P.querySelector("#reRevert").onclick = () => change(() => { const b = base(E.r); E.pts = b.pts; E.from = b.from; E.sel = null; });
      P.querySelector("#reCopy").onclick = async () => {
        try { await navigator.clipboard.writeText(json); A.toast("Route JSON copied"); }
        catch { A.toast("Couldn't copy; select the JSON above instead.", 3000); }
      };
      P.querySelector("#reDown").onclick = download;
      const list = P.querySelector(".re-pts");
      if (list) {
        list.onclick = (e) => {
          const b = e.target.closest("button");
          const li = e.target.closest("li[data-i]");
          if (!b || !li) return;
          const i = Number(li.dataset.i);
          if (b.dataset.act === "del") change(() => { E.pts.splice(i, 1); E.sel = null; });
          else if (b.dataset.act === "pick") { E.sel = E.sel === i ? null : i; render(); }
          else if (b.dataset.v) change(() => {
            const p = E.pts[i];
            p.kind = b.dataset.v;
            p.s = p.kind === "jump" ? (p.s > 0 ? p.s : JUMP_S) : 0;
          });
        };
        list.onchange = (e) => {
          const inp = e.target.closest("input[data-i]");
          if (!inp) return;
          const v = Math.max(0, Math.min(5, Number(inp.value) || 0));
          change(() => { E.pts[Number(inp.dataset.i)].s = v; });
        };
      }
      draw();
    }
    function seg(id, items, cur, extra = "") {
      return `<div class="seg"${id ? ` id="${id}"` : ""} ${extra}>${items.map(([v, label]) =>
        `<button type="button" data-v="${A.esc(v)}" aria-pressed="${String(v) === String(cur)}">${A.esc(label)}</button>`).join("")}</div>`;
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
    function download() {
      const all = load();
      const data = { routeEdits: { [mapId()]: all[mapId()] || {} } };
      const name = `route-edits-${mapId()}.json`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      A.toast(`Downloaded ${name}`);
    }

    // ---------- open / close ----------
    function open(r) {
      const s = stored(r);
      const b = base(r);
      E = {
        r, side: sideKey(r), to: r.to,
        from: s ? (s.from != null ? +s.from : null) : b.from,
        pts: s ? fromVia(s.via) : b.pts,
        add: "walk", sel: null, hist: [], drag: null,
      };
      render();
      // Zoom to the route: its spawns, current path, points and end on this level.
      const lv = A.state.level, xs = [], ys = [];
      const add = (x, y) => { xs.push(+x); ys.push(+y); };
      spawns().forEach((sp) => { if ((sp.level || "upper") === lv) add(sp.x, sp.y); });
      E.pts.forEach((p) => { if ((p.lv || "upper") === lv) add(p.x, p.y); });
      const segs = Array.isArray(r.segments) && r.segments.length ? r.segments : [{ level: r.level, path: r.path }];
      for (const s of segs) if ((s.level || r.level || "upper") === lv) for (let i = 0; i + 1 < (s.path || []).length; i += 2) add(s.path[i], s.path[i + 1]);
      if (xs.length) A.fitBox([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 0.25);
    }
    function close() {
      E = null;
      ctx.onClose();
    }

    // ---------- pointer and keys (forwarded by js/live.js) ----------
    function click(p) {
      const sp = spawnAt(p);
      if (sp != null) { change(() => { E.from = E.from === sp ? null : sp; }); return; }
      const pt = { x: Math.round(p.x), y: Math.round(p.y), lv: A.state.level === "upper" ? null : A.state.level, kind: E.add, s: E.add === "jump" ? JUMP_S : 0 };
      change(() => {
        const at = E.sel != null ? E.sel + 1 : E.pts.length;
        E.pts.splice(at, 0, pt);
        if (E.sel != null) E.sel = at;
      });
    }
    function grab(p, target) {
      const h = target && target.closest && target.closest(".re-pt");
      if (!h) return false;
      E.drag = { i: Number(h.dataset.i), before: snapshot() };
      return true;
    }
    function drag(p) {
      if (!E.drag) return;
      const q = E.pts[E.drag.i];
      q.x = Math.round(Math.max(0, Math.min(1024, p.x)));
      q.y = Math.round(Math.max(0, Math.min(1024, p.y)));
      draw();
    }
    function drop(p, moved) {
      if (!E.drag) return;
      const { i, before } = E.drag;
      E.drag = null;
      if (moved) { E.hist.push(before); persist(); render(); }
      else { E.sel = E.sel === i ? null : i; render(); }
    }
    function escape() {
      if (!E) return false;
      if (E.sel != null) { E.sel = null; render(); return true; }
      close();
      return true;
    }
    document.addEventListener("keydown", (e) => {
      if (!E) return;
      const t = e.target;
      if (t && (t.isContentEditable || (t.matches && t.matches("input, textarea, select")))) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) { e.preventDefault(); undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && E.sel != null) {
        e.preventDefault();
        const i = E.sel;
        change(() => { E.pts.splice(i, 1); E.sel = null; });
      }
    });

    return {
      open, close, render, draw, click, grab, drag, drop, escape,
      active: () => !!E,
      // Routes of the current map with edits in this browser, as "SIDE/to" keys.
      // An edit already applied with --apply matches the route data and doesn't count.
      editedKeys() {
        const m = load()[mapId()] || {};
        const d = ctx.mapData();
        const out = new Set();
        for (const [side, targets] of Object.entries(m)) {
          for (const [to, fix] of Object.entries(targets)) {
            const r = d && d.routes.find((x) => sideKey(x) === side && x.to === to);
            const mine = { from: fix.from != null ? +fix.from : null, pts: fromVia(fix.via) };
            if (!r || !same(mine, base(r))) out.add(`${side}/${to}`);
          }
        }
        return out;
      },
      reset() { E = null; },
    };
  };
})();
