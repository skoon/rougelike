// A* pathfinding on the dungeon grid (4-directional, uniform cost).

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Returns an array of {x,y} steps from (sx,sy) to (tx,ty), excluding the start
// and ending at the target — or null if unreachable within `maxNodes`.
// `blocked(x,y)` optionally marks extra impassable cells (e.g. other monsters);
// the target cell is always allowed so enemies can path onto the player.
export function findPath(dungeon, sx, sy, tx, ty, blocked = null, maxNodes = 600) {
  if (sx === tx && sy === ty) return [];
  const W = dungeon.w;
  const key = (x, y) => y * W + x;
  const h = (x, y) => Math.abs(tx - x) + Math.abs(ty - y);

  const open = [{ x: sx, y: sy, f: h(sx, sy) }];
  const g = new Map([[key(sx, sy), 0]]);
  const came = new Map();
  let nodes = 0;

  while (open.length) {
    // Pop the lowest-f node (linear scan; fine for these map sizes).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);

    if (cur.x === tx && cur.y === ty) {
      const path = [];
      let k = ck;
      while (came.has(k)) {
        path.push({ x: k % W, y: Math.floor(k / W) });
        k = came.get(k);
      }
      return path.reverse();
    }
    if (++nodes > maxNodes) break;

    const cg = g.get(ck);
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!dungeon.inBounds(nx, ny)) continue;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget) {
        if (!dungeon.isWalkable(nx, ny)) continue;
        if (blocked && blocked(nx, ny)) continue;
      }
      const nk = key(nx, ny);
      const ng = cg + 1;
      if (!g.has(nk) || ng < g.get(nk)) {
        g.set(nk, ng);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}
