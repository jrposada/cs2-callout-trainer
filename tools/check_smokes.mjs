// Checks data/smokes.js against the zones in data/maps.js:
// - every throw spot (from x, y) sits strictly inside its callout's zone;
// - every landing (to x, y) sits inside or on the edge of its callout's zone;
// - ids are unique per map, and source urls point at csnades.gg/<map>/smokes/<slug>.
// The app checks the rest of the fields when it loads. Usage: node tools/check_smokes.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);
const ctx = { window: {} };
for (const f of ["data/maps.js", "data/smokes.js"]) vm.runInNewContext(readFileSync(new URL(f, root), "utf8"), ctx);
const maps = Object.fromEntries(ctx.window.CALLOUT_MAPS.map((m) => [m.id, m]));
const smokes = ctx.window.CALLOUT_SMOKES || {};

// "in", "edge" or "out" for point p and a flat [x0, y0, x1, y1, ...] polygon.
function where(p, poly) {
  const n = poly.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi, xj, yj] = [poly[2 * i], poly[2 * i + 1], poly[2 * j], poly[2 * j + 1]];
    const cross = (xj - xi) * (p.y - yi) - (yj - yi) * (p.x - xi);
    const within = p.x >= Math.min(xi, xj) && p.x <= Math.max(xi, xj) && p.y >= Math.min(yi, yj) && p.y <= Math.max(yi, yj);
    if (cross === 0 && within) return "edge";
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? "in" : "out";
}

const problems = [];
let total = 0;
for (const [mapId, list] of Object.entries(smokes)) {
  const m = maps[mapId];
  if (!m) { problems.push(`${mapId}: no such map`); continue; }
  const ids = new Set();
  for (const r of list) {
    total++;
    const k = `${mapId}/${r.id}`;
    if (ids.has(r.id)) problems.push(`${k}: duplicate id`);
    ids.add(r.id);
    for (const [end, okOnEdge] of [["from", false], ["to", true]]) {
      const s = r[end] || {}, c = m.callouts.find((x) => x.id === s.callout);
      if (!c) { problems.push(`${k}: ${end} callout "${s.callout}" not on the map`); continue; }
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) { problems.push(`${k}: ${end} needs x, y`); continue; }
      if (!Array.isArray(c.poly)) { problems.push(`${k}: ${end} callout "${c.id}" has no zone`); continue; }
      const w = where(s, c.poly);
      if (w === "out" || (w === "edge" && !okOnEdge)) problems.push(`${k}: ${end} (${s.x}, ${s.y}) is ${w === "out" ? "outside" : "on the edge of"} ${c.id}`);
      if (s.level && !m.levels.includes(s.level)) problems.push(`${k}: ${end} level "${s.level}" not on the map`);
    }
    if (r.source) {
      const u = new URL(r.source.url);
      if (u.hostname !== "csnades.gg" || !u.pathname.startsWith(`/${mapId}/smokes/`)) problems.push(`${k}: source url ${r.source.url}`);
    }
  }
}
for (const p of problems) console.log(p);
console.log(`${total} line-ups on ${Object.keys(smokes).length} maps, ${problems.length} problem${problems.length === 1 ? "" : "s"}.`);
process.exit(problems.length ? 1 : 0);
