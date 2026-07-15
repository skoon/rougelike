// Regression test for M19-T3 — the waystone (shortcut back to camp) must only
// appear on every 3rd depth, must never land on the stairs or the start tile,
// and (since it's walkable) can never seal the stairs off.
//
//   node test/waystone.js [depths-per-strategy]
//
// Mirrors test/stairs.js's reachability check and uses the real Dungeon module
// so a regression in placement or in isWalkable/floors bookkeeping is caught.

import { Dungeon, WAYSTONE } from "../js/dungeon.js";
import { seedRng } from "../js/rng.js";

// BFS from startPos over walkable tiles — mirrors game.js's reachability check.
function stairsReachable(d) {
  const start = d.startPos, stairs = d.stairs;
  const seen = new Set([d.idx(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    if (c.x === stairs.x && c.y === stairs.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, ni = d.idx(nx, ny);
      if (!d.inBounds(nx, ny) || seen.has(ni) || !d.isWalkable(nx, ny)) continue;
      seen.add(ni);
      q.push({ x: nx, y: ny });
    }
  }
  return false;
}

function main() {
  const depthsPerStrategy = parseInt(process.argv[2], 10) || 500;
  const strategies = ["rooms", "bsp", "caves"];

  let checked = 0;
  let placedCount = 0;
  let wrongDepthPlacement = 0;   // waystone appeared on a depth not divisible by 3
  let missingOnEligible = 0;     // depth % 3 === 0 but no spot found (allowed, just tracked)
  let onStairs = 0;
  let onStart = 0;
  let notWalkable = 0;
  let staleInFloors = 0;         // waystone cell still listed in floors (would double-spawn)
  let stairsUnreachable = 0;
  let tooFarFromStairs = 0;      // sanity: should be within the ~4 Manhattan-distance budget

  for (let depth = 1; depth <= depthsPerStrategy; depth++) {
    for (const strat of strategies) {
      seedRng((2000 + depth) ^ (strategies.indexOf(strat) * 2654435761));
      const d = new Dungeon(50, 38, strat, depth);
      checked++;

      const eligible = depth % 3 === 0;
      const wp = d.waystonePos;

      if (wp) {
        placedCount++;
        if (!eligible) wrongDepthPlacement++;

        if (d.get(wp.x, wp.y) !== WAYSTONE) notWalkable++; // tile mismatch
        else if (!d.isWalkable(wp.x, wp.y)) notWalkable++;

        if (wp.x === d.stairs.x && wp.y === d.stairs.y) onStairs++;
        if (wp.x === d.startPos.x && wp.y === d.startPos.y) onStart++;

        if (d.floors.some((c) => c.x === wp.x && c.y === wp.y)) staleInFloors++;

        const dist = Math.abs(wp.x - d.stairs.x) + Math.abs(wp.y - d.stairs.y);
        if (dist > 4) tooFarFromStairs++;
      } else if (eligible) {
        missingOnEligible++;
      }

      // Waystones are walkable, so this should never fail — but verify anyway
      // per the task's "assert placement sanity regardless" instruction.
      if (!stairsReachable(d)) stairsUnreachable++;
    }
  }

  console.log(`Floors checked: ${checked} (depths 1..${depthsPerStrategy} x ${strategies.length} strategies)`);
  console.log(`Waystones placed: ${placedCount}`);
  console.log(`Placed on a non-eligible depth (depth % 3 !== 0): ${wrongDepthPlacement}`);
  console.log(`Eligible depths with no waystone placed (no free spot — allowed, just tracked): ${missingOnEligible}`);
  console.log(`Landed on stairs: ${onStairs}`);
  console.log(`Landed on start tile: ${onStart}`);
  console.log(`Not a walkable WAYSTONE tile at waystonePos: ${notWalkable}`);
  console.log(`Stale waystone cell still in floors[]: ${staleInFloors}`);
  console.log(`Farther than 4 tiles (Manhattan) from stairs: ${tooFarFromStairs}`);
  console.log(`Stairs unreachable (should never happen — waystone is walkable): ${stairsUnreachable}`);

  const ok = wrongDepthPlacement === 0 && onStairs === 0 && onStart === 0 &&
    notWalkable === 0 && staleInFloors === 0 && tooFarFromStairs === 0 && stairsUnreachable === 0;
  console.log(ok ? "OK — waystone placement is sane on every checked floor" : "FAIL");
  if (!ok) process.exit(1);
}

main();
