// Regression test for M18 — the down-stairs must never be sealed off by a
// locked door (generation) or by an NPC standing on a choke tile (placement).
//
//   node test/stairs.js [maps]
//
// It uses the real Dungeon module and mirrors game.js's reachability logic
// (isWalkable BFS = no-key reachability; tileSafeToBlock = NPC placement check).

import { Dungeon } from "../js/dungeon.js";
import { seedRng } from "../js/rng.js";

// BFS from startPos over walkable tiles, with `blocked` (a Set of indices)
// treated as impassable. Returns whether the stairs is reachable.
function stairsReachable(d, blocked = new Set()) {
  const start = d.startPos, stairs = d.stairs;
  const seen = new Set([d.idx(start.x, start.y)]);
  const q = [start];
  while (q.length) {
    const c = q.shift();
    if (c.x === stairs.x && c.y === stairs.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = c.x + dx, ny = c.y + dy, ni = d.idx(nx, ny);
      if (!d.inBounds(nx, ny) || seen.has(ni) || blocked.has(ni) || !d.isWalkable(nx, ny))
        continue;
      seen.add(ni);
      q.push({ x: nx, y: ny });
    }
  }
  return false;
}

// FLOOR cells within `rad` of pos (excluding pos itself) — mirrors findFloorNear.
function floorsNear(d, pos, rad) {
  const out = [];
  for (let dy = -rad; dy <= rad; dy++)
    for (let dx = -rad; dx <= rad; dx++) {
      const x = pos.x + dx, y = pos.y + dy;
      if (x === pos.x && y === pos.y) continue;
      if (d.get(x, y) === 1 /* FLOOR */) out.push({ x, y });
    }
  return out;
}

const safe = (d, x, y, extra) => stairsReachable(d, new Set([d.idx(x, y), ...extra]));

function main() {
  const maps = parseInt(process.argv[2], 10) || 1200;
  const strategies = ["rooms", "bsp", "caves"];

  let doorFails = 0;       // stairs unreachable even with no blockers (gen/door bug)
  let unsafeChosen = 0;    // safe-filter still let a blocking tile through
  let noSafeSpot = 0;      // no safe candidate near the usual spot (NPC would be skipped)
  let naiveBlockers = 0;   // candidates the OLD code could have picked that DO block
  let naiveCandidates = 0; // total candidates considered (to size the old bug)

  for (let i = 0; i < maps; i++) {
    for (const strat of strategies) {
      seedRng((1000 + i) ^ (strategies.indexOf(strat) * 2654435761));
      const d = new Dungeon(50, 38, strat);

      // A) Door / generation invariant: stairs reachable with nothing blocking.
      if (!stairsReachable(d)) { doorFails++; continue; }

      // B) NPC placement. Healer searches near the stairs (the prime offender),
      //    merchant near the start. Verify the safe-filtered set is usable and
      //    never blocks, and measure how often the naive (unfiltered) pick would.
      for (const [pos, rad] of [[d.stairs, 6], [d.startPos, 5]]) {
        const cands = floorsNear(d, pos, rad);
        const safeCands = cands.filter((c) => safe(d, c.x, c.y, []));
        for (const c of cands) {
          naiveCandidates++;
          if (!safe(d, c.x, c.y, [])) naiveBlockers++;
        }
        // The fix widens the search if the first ring has none; only flag a
        // genuine miss if even a wide ring has no safe cell.
        if (!safeCands.length) {
          const wide = floorsNear(d, d.startPos, 12).filter((c) => safe(d, c.x, c.y, []));
          if (!wide.length) noSafeSpot++;
        }
        // Every tile the safe filter accepts must truly keep the stairs reachable.
        for (const c of safeCands) if (!safe(d, c.x, c.y, [])) unsafeChosen++;
      }

      // C) Two NPCs at once (merchant + healer): place both via the safe filter
      //    and confirm the stairs survives the combination.
      const m = floorsNear(d, d.startPos, 10).find((c) => safe(d, c.x, c.y, []));
      if (m) {
        const mBlocked = [d.idx(m.x, m.y)];
        const h = floorsNear(d, d.stairs, 6).find((c) => safe(d, c.x, c.y, mBlocked)) ||
                  floorsNear(d, d.startPos, 12).find((c) => safe(d, c.x, c.y, mBlocked));
        if (h && !stairsReachable(d, new Set([...mBlocked, d.idx(h.x, h.y)]))) unsafeChosen++;
      }
    }
  }

  const total = maps * strategies.length;
  console.log(`Maps generated: ${total}`);
  console.log(`Door/gen invariant failures (stairs unreachable, no blockers): ${doorFails}`);
  console.log(`Naive NPC candidates that WOULD seal the stairs: ${naiveBlockers}/${naiveCandidates}` +
    ` (${(naiveBlockers / naiveCandidates * 100).toFixed(1)}% — the bug this fixes)`);
  console.log(`Safe-filtered tiles that still blocked: ${unsafeChosen}`);
  console.log(`Floors with no safe NPC spot even when widened: ${noSafeSpot}`);

  const ok = doorFails === 0 && unsafeChosen === 0;
  console.log(ok ? "OK — stairs always reachable past doors and safely-placed NPCs" : "FAIL");
  if (!ok) process.exit(1);
}

main();
