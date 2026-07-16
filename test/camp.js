// Regression test for M19 — the surface base camp.
//
//   node test/camp.js [seeds]
//
// Covers what no other harness does:
//   1. Determinism — the camp's core promise. `Game.leaveCamp` does not save the
//      floor it came from; it sets depth = campReturnDepth - 1 and calls
//      `nextLevel`, which re-seeds per floor. So "the same floor" is only true if
//      (seed, depth) alone determine the map — including after the RNG stream has
//      been churned by a camp visit. This mirrors nextLevel's seeding exactly.
//   2. Camp map invariants — buildCamp()'s hand-authored legend must stay
//      walkable, reachable, and correctly shaped as the render/turn paths expect.
//   3. The waystone must never leak into the camp (camp builds a Dungeon with the
//      default depth 0; dungeon.js guards with `!this.depth`).
//
// Waystone *placement* is covered by test/waystone.js; stairs reachability by
// test/stairs.js. This file deliberately does not duplicate them.
//
// Uses the real Dungeon / camp modules. Economy + shop checks need a live `Game`
// (DOM-bound), so they are verified in-browser rather than mirrored here.

import { Dungeon, WAYSTONE, WALL } from "../js/dungeon.js";
import { buildCamp } from "../js/camp.js";
import { seedRng } from "../js/rng.js";

// --- mirrored from js/game.js (keep in sync) ---------------------------------
const MAP_W = 50;
const MAP_H = 38;
// THEMES[min(3, floor((depth-1)/2))].strategy
const STRATEGIES = ["rooms", "bsp", "caves", "caves"];
const strategyForDepth = (depth) => STRATEGIES[Math.min(3, Math.floor((depth - 1) / 2))];

// Exactly what Game.nextLevel does: re-seed from the run seed + depth, then build.
function buildFloor(seed, depth) {
  seedRng((seed ^ (depth * 2654435761)) >>> 0);
  return new Dungeon(MAP_W, MAP_H, strategyForDepth(depth), depth);
}

function hashTiles(tiles) {
  let h = 2166136261;
  for (let i = 0; i < tiles.length; i++) {
    h ^= tiles[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const posEq = (a, b) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y);

// BFS over walkable tiles; returns the set of reachable indices.
function reachableFrom(d, start) {
  const seen = new Set([d.idx(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, ni = d.idx(nx, ny);
      if (!d.inBounds(nx, ny) || seen.has(ni) || !d.isWalkable(nx, ny)) continue;
      seen.add(ni);
      q.push({ x: nx, y: ny });
    }
  }
  return seen;
}

// --- 1. determinism ----------------------------------------------------------
// A camp round-trip churns the RNG stream (camp wares, etc.) before the floor is
// rebuilt, so the rebuild must not depend on stream position — only on the seed.
function testDeterminism(seeds, fails) {
  let checked = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = (s * 2654435761 + 12345) >>> 0;
    for (let depth = 1; depth <= 10; depth++) {
      const before = buildFloor(seed, depth);
      const snap = {
        tiles: hashTiles(before.tiles),
        stairs: before.stairs,
        startPos: before.startPos,
        floors: before.floors.length,
      };

      // Churn the stream the way a camp visit would, then rebuild via the exact
      // path leaveCamp -> nextLevel takes.
      for (let i = 0; i < 50; i++) Math.random();
      seedRng((seed ^ 0xdeadbeef) >>> 0);
      const camp = buildCamp();
      if (!camp) fails.push(`seed ${seed}: buildCamp returned nothing`);

      const after = buildFloor(seed, depth);
      if (hashTiles(after.tiles) !== snap.tiles)
        fails.push(`seed ${seed} depth ${depth}: tiles differ after round-trip`);
      if (!posEq(after.stairs, snap.stairs))
        fails.push(`seed ${seed} depth ${depth}: stairs moved ${JSON.stringify(snap.stairs)} -> ${JSON.stringify(after.stairs)}`);
      if (!posEq(after.startPos, snap.startPos))
        fails.push(`seed ${seed} depth ${depth}: startPos moved`);
      if (after.floors.length !== snap.floors)
        fails.push(`seed ${seed} depth ${depth}: floors count ${snap.floors} -> ${after.floors.length}`);
      checked++;
    }
  }
  return checked;
}

// --- 2. camp map invariants --------------------------------------------------
function testCampMap(fails) {
  const d = buildCamp();

  // Shape the render/turn paths depend on.
  if (!Array.isArray(d.floors) || !d.floors.length) fails.push("camp: floors is empty");
  if (!Array.isArray(d.objs)) fails.push("camp: objs is not an array");
  if (!(d.traps instanceof Set)) fails.push("camp: traps is not a Set");
  if (!Array.isArray(d.lights) || !d.lights.length) fails.push("camp: no lights (campfire glow missing)");
  if (!Array.isArray(d.rooms)) fails.push("camp: rooms is not an array");
  if (!d.startPos) fails.push("camp: no startPos");
  if (!d.stairs) fails.push("camp: no stairs (cave mouth)");
  if (!d.campfire) fails.push("camp: no campfire");
  if (!d.tents || !d.tents.merchant || !d.tents.healer) fails.push("camp: tents missing");
  if (!d.npcSpots || !d.npcSpots.merchant || !d.npcSpots.healer) fails.push("camp: npcSpots missing");

  // Fully lit: the camp has no fog, and computeFov must not re-fog it.
  if (!d.visible.every(Boolean)) fails.push("camp: not fully visible");
  if (!d.explored.every(Boolean)) fails.push("camp: not fully explored");
  d.computeFov(d.startPos.x, d.startPos.y, 8);
  if (!d.visible.every(Boolean)) fails.push("camp: computeFov re-fogged the camp");

  // The cave mouth must be reachable, or the player is trapped at the camp.
  const reach = reachableFrom(d, d.startPos);
  if (!reach.has(d.idx(d.stairs.x, d.stairs.y)))
    fails.push("camp: cave mouth unreachable from spawn — player would be stranded");

  // The campfire must be reachable AND avoidable (grass around it is walkable),
  // so the rest is a choice, not a toll gate on the way to the cave mouth.
  if (!reach.has(d.idx(d.campfire.x, d.campfire.y)))
    fails.push("camp: campfire unreachable");
  const beside = [[1, 0], [-1, 0]].filter(([dx, dy]) => d.isWalkable(d.campfire.x + dx, d.campfire.y + dy));
  if (!beside.length) fails.push("camp: campfire has no walkable tile beside it — rest would be forced");

  // Each NPC must stand on reachable open ground in front of its own tent.
  for (const who of ["merchant", "healer"]) {
    const spot = d.npcSpots[who], anchor = d.tents[who];
    if (!d.isWalkable(spot.x, spot.y)) fails.push(`camp: ${who} stands on an impassable tile`);
    if (!reach.has(d.idx(spot.x, spot.y))) fails.push(`camp: ${who} is unreachable — shop unusable`);
    if (spot.y !== anchor.y + 2 || spot.x < anchor.x || spot.x > anchor.x + 1)
      fails.push(`camp: ${who} is not in front of its tent door`);
    // All four cells of the 2x2 tent must be solid.
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const tx = anchor.x + dx, ty = anchor.y + dy;
      if (d.get(tx, ty) !== WALL) fails.push(`camp: ${who} tent cell ${tx},${ty} is not solid`);
      if (!d.decor[d.idx(tx, ty)]) fails.push(`camp: ${who} tent cell ${tx},${ty} has no quadrant sprite`);
    }
  }

  // A bare WALL with no decor renders as an invisible wall.
  for (let i = 0; i < d.tiles.length; i++)
    if (d.tiles[i] === WALL && !d.decor[i]) {
      fails.push(`camp: solid tile ${i % d.w},${Math.floor(i / d.w)} has no decor — invisible wall`);
      break;
    }

  // 3. The waystone must never leak into the camp (default depth 0 guard).
  if (d.tiles.some((t) => t === WAYSTONE))
    fails.push("camp: a WAYSTONE leaked into the camp map");

  return d;
}

function main() {
  const seeds = parseInt(process.argv[2], 10) || 500;
  const fails = [];

  const floors = testDeterminism(seeds, fails);
  const camp = testCampMap(fails);

  console.log(`Camp round-trips checked: ${floors} floors (${seeds} seeds x depths 1-10)`);
  console.log(`Camp map: ${camp.w}x${camp.h}, ${camp.floors.length} walkable, ` +
    `spawn ${JSON.stringify(camp.startPos)}, cave mouth ${JSON.stringify(camp.stairs)}, ` +
    `campfire ${JSON.stringify(camp.campfire)}`);
  console.log(`Waystone in camp: ${camp.tiles.some((t) => t === WAYSTONE) ? "LEAKED" : "none"}`);

  if (fails.length) {
    console.error(`\nFAILED — ${fails.length} problem(s):`);
    for (const f of fails.slice(0, 20)) console.error("  - " + f);
    if (fails.length > 20) console.error(`  ... and ${fails.length - 20} more`);
    process.exit(1);
  }
  console.log("\nOK — floor regeneration is deterministic and the camp map is sound");
}

main();
