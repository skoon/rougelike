// Procedural dungeon generation (rooms + corridors) and field of view.

import { rng } from "./rng.js";

export const WALL = 0;
export const FLOOR = 1;
export const STAIRS = 2;
export const LOCKED = 3; // locked door: blocks movement + sight until a key opens it
export const SHRINE = 4; // steppable tile granting a one-time blessing

const rnd = (n) => Math.floor(rng() * n);
const rint = (min, max) => min + rnd(max - min + 1);

class Room {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }
  get cx() { return Math.floor(this.x + this.w / 2); }
  get cy() { return Math.floor(this.y + this.h / 2); }
  intersects(o) {
    return (
      this.x - 1 <= o.x + o.w &&
      this.x + this.w + 1 >= o.x &&
      this.y - 1 <= o.y + o.h &&
      this.y + this.h + 1 >= o.y
    );
  }
  randPoint() {
    return { x: rint(this.x, this.x + this.w - 1), y: rint(this.y, this.y + this.h - 1) };
  }
}

export class Dungeon {
  constructor(w, h, strategy = "rooms") {
    this.w = w;
    this.h = h;
    this.tiles = new Array(w * h).fill(WALL);
    this.decor = new Array(w * h).fill(null); // visual-only floor decoration
    this.visible = new Array(w * h).fill(false);
    this.explored = new Array(w * h).fill(false);
    this.rooms = [];
    this.startPos = null; // where the player enters
    this.stairs = null; // where the player descends
    this.floors = []; // all reachable floor cells (for spawning)
    this.vaultCells = []; // interior of the locked treasure vault (if any)
    this.nestCells = []; // interior of the monster nest (if any)
    this.shrinePos = null; // {x,y} of the shrine tile (if any)
    this.hasVault = false;
    this.strategy = strategy;
    this.generate(strategy);
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : WALL; }
  set(x, y, v) { if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = v; }

  isWalkable(x, y) {
    const t = this.get(x, y);
    return t === FLOOR || t === STAIRS || t === SHRINE;
  }
  blocksSight(x, y) {
    const t = this.get(x, y);
    return t === WALL || t === LOCKED;
  }

  // Dispatch to a generation strategy, then run the shared finalize pass that
  // guarantees connectivity and places reachable stairs.
  generate(strategy) {
    if (strategy === "caves") this.genCaves();
    else if (strategy === "bsp") this.genBSP();
    else this.genRooms();
    this.finalize();
  }

  // --- Strategy: random non-overlapping rooms joined by L-corridors. ---
  genRooms() {
    const maxRooms = 16;
    for (let i = 0; i < maxRooms * 3 && this.rooms.length < maxRooms; i++) {
      const w = rint(5, 10);
      const h = rint(4, 8);
      const x = rint(1, this.w - w - 2);
      const y = rint(1, this.h - h - 2);
      const room = new Room(x, y, w, h);
      if (this.rooms.some((r) => room.intersects(r))) continue;
      this.carveRoom(room);
      if (this.rooms.length > 0) {
        const prev = this.rooms[this.rooms.length - 1];
        this.carveCorridor(prev.cx, prev.cy, room.cx, room.cy);
      }
      this.rooms.push(room);
    }
    this.startPos = { x: this.rooms[0].cx, y: this.rooms[0].cy };
    this._placeSpecials();
  }

  // --- Strategy: binary space partition into rooms, joined in sequence. ---
  genBSP() {
    const leaves = [];
    this._splitBSP({ x: 1, y: 1, w: this.w - 2, h: this.h - 2 }, 0, leaves);
    for (const leaf of leaves) {
      const rw = rint(4, Math.max(4, leaf.w - 2));
      const rh = rint(4, Math.max(4, leaf.h - 2));
      if (rw >= leaf.w - 1 || rh >= leaf.h - 1) continue;
      const rx = leaf.x + rint(1, leaf.w - rw - 1);
      const ry = leaf.y + rint(1, leaf.h - rh - 1);
      const room = new Room(rx, ry, rw, rh);
      this.carveRoom(room);
      this.rooms.push(room);
    }
    // Connect rooms sequentially so the whole map is reachable.
    for (let i = 1; i < this.rooms.length; i++) {
      const a = this.rooms[i - 1];
      const b = this.rooms[i];
      this.carveCorridor(a.cx, a.cy, b.cx, b.cy);
    }
    this.startPos = this.rooms.length
      ? { x: this.rooms[0].cx, y: this.rooms[0].cy }
      : null;
    this._placeSpecials();
  }

  // Designate a few non-start rooms as a locked treasure vault, a monster nest,
  // and/or a shrine. Only meaningful for room-based strategies.
  _placeSpecials() {
    if (this.rooms.length < 3) return;
    const pool = this.rooms.slice(1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    if (rng() < 0.7) {
      const room = pool.pop();
      this.vaultCells = this.roomCells(room);
      // Lock every floor cell bordering the vault so the only way in is keyed.
      for (const c of this.vaultCells) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = c.x + dx, ny = c.y + dy;
          const inside = nx >= room.x && nx < room.x + room.w && ny >= room.y && ny < room.y + room.h;
          if (!inside && this.get(nx, ny) === FLOOR) this.set(nx, ny, LOCKED);
        }
      }
      this.hasVault = true;
    }

    if (pool.length && rng() < 0.6) {
      this.nestCells = this.roomCells(pool.pop());
    }

    if (pool.length && rng() < 0.6) {
      const room = pool.pop();
      this.shrinePos = { x: room.cx, y: room.cy };
      this.set(room.cx, room.cy, SHRINE);
    }
  }

  _splitBSP(node, depth, leaves) {
    const MIN = 7;
    if (depth >= 5 || (node.w <= MIN * 2 && node.h <= MIN * 2)) {
      leaves.push(node);
      return;
    }
    const horiz = node.w / node.h < 1.25 && (node.h / node.w >= 1.25 || rng() < 0.5);
    if (horiz) {
      if (node.h - MIN <= MIN) { leaves.push(node); return; }
      const cut = rint(MIN, node.h - MIN);
      this._splitBSP({ x: node.x, y: node.y, w: node.w, h: cut }, depth + 1, leaves);
      this._splitBSP({ x: node.x, y: node.y + cut, w: node.w, h: node.h - cut }, depth + 1, leaves);
    } else {
      if (node.w - MIN <= MIN) { leaves.push(node); return; }
      const cut = rint(MIN, node.w - MIN);
      this._splitBSP({ x: node.x, y: node.y, w: cut, h: node.h }, depth + 1, leaves);
      this._splitBSP({ x: node.x + cut, y: node.y, w: node.w - cut, h: node.h }, depth + 1, leaves);
    }
  }

  // --- Strategy: cellular-automata caves. ---
  genCaves() {
    const W = this.w, H = this.h;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const edge = x < 1 || y < 1 || x >= W - 1 || y >= H - 1;
        this.set(x, y, edge || rng() < 0.45 ? WALL : FLOOR);
      }
    }
    for (let it = 0; it < 5; it++) {
      const copy = this.tiles.slice();
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              if ((dx || dy) && copy[this.idx(x + dx, y + dy)] === WALL) walls++;
          this.set(x, y, walls >= 5 ? WALL : FLOOR);
        }
      }
    }
    // Enter in the largest cavern; finalize() walls off the rest.
    this.startPos = this._largestRegionCell();
  }

  // --- Shared finalize: flood from startPos, wall off unreachable floor,
  // place stairs at the farthest reachable cell, build the floor list. ---
  finalize() {
    if (!this.startPos || !this.isWalkable(this.startPos.x, this.startPos.y)) {
      this.startPos = this._firstFloor();
    }
    let dist = this._bfsFrom(this.startPos.x, this.startPos.y);
    let vaultSet = new Set(this.vaultCells.map((c) => this.idx(c.x, c.y)));

    // If locking the vault orphaned more non-vault floor than the vault itself,
    // it was a pass-through room: unlock it rather than seal a real region.
    if (this.hasVault) {
      let lost = 0;
      for (let i = 0; i < this.tiles.length; i++)
        if (this.tiles[i] === FLOOR && dist[i] < 0 && !vaultSet.has(i)) lost++;
      if (lost > this.vaultCells.length) {
        for (let i = 0; i < this.tiles.length; i++)
          if (this.tiles[i] === LOCKED) this.tiles[i] = FLOOR;
        this.hasVault = false;
        this.vaultCells = [];
        vaultSet = new Set();
        dist = this._bfsFrom(this.startPos.x, this.startPos.y);
      }
    }

    let farthest = { ...this.startPos };
    let far = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        if (this.tiles[i] !== FLOOR) continue;
        // Seal floor the player can't reach without a key, except the vault.
        if (dist[i] < 0) { if (!vaultSet.has(i)) this.tiles[i] = WALL; continue; }
        if (dist[i] > far) { far = dist[i]; farthest = { x, y }; }
      }
    }

    this.stairs = farthest;
    this.set(farthest.x, farthest.y, STAIRS);

    // Reachable (no-key) floor for normal spawning; vault loot is placed separately.
    this.floors = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.tiles[this.idx(x, y)] === FLOOR && dist[this.idx(x, y)] >= 0)
          this.floors.push({ x, y });

    this.scatterDecor();
  }

  _bfsFrom(sx, sy) {
    const dist = new Array(this.w * this.h).fill(-1);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const q = [[sx, sy]];
    dist[this.idx(sx, sy)] = 0;
    let head = 0;
    while (head < q.length) {
      const [x, y] = q[head++];
      const d = dist[this.idx(x, y)];
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        // Player reachability without a key: walls and locked doors stop it.
        const t = this.tiles[ni];
        if (dist[ni] !== -1 || t === WALL || t === LOCKED) continue;
        dist[ni] = d + 1;
        q.push([nx, ny]);
      }
    }
    return dist;
  }

  _largestRegionCell() {
    const seen = new Array(this.w * this.h).fill(false);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let bestCell = null, bestSize = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const start = this.idx(x, y);
        if (this.tiles[start] !== FLOOR || seen[start]) continue;
        const q = [[x, y]];
        seen[start] = true;
        let head = 0;
        while (head < q.length) {
          const [cx, cy] = q[head++];
          for (const [dx, dy] of dirs) {
            const nx = cx + dx, ny = cy + dy;
            if (!this.inBounds(nx, ny)) continue;
            const ni = this.idx(nx, ny);
            if (seen[ni] || this.tiles[ni] !== FLOOR) continue;
            seen[ni] = true;
            q.push([nx, ny]);
          }
        }
        if (q.length > bestSize) { bestSize = q.length; bestCell = { x, y }; }
      }
    }
    return bestCell || this._firstFloor();
  }

  _firstFloor() {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.get(x, y) === FLOOR) return { x, y };
    // Degenerate fallback: carve one cell.
    this.set(1, 1, FLOOR);
    return { x: 1, y: 1 };
  }

  carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        this.set(x, y, FLOOR);
      }
    }
  }

  carveCorridor(x1, y1, x2, y2) {
    if (rng() < 0.5) {
      this.carveH(x1, x2, y1);
      this.carveV(y1, y2, x2);
    } else {
      this.carveV(y1, y2, x1);
      this.carveH(x1, x2, y2);
    }
  }
  carveH(x1, x2, y) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++)
      if (this.get(x, y) === WALL) this.set(x, y, FLOOR);
  }
  carveV(y1, y2, x) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++)
      if (this.get(x, y) === WALL) this.set(x, y, FLOOR);
  }

  scatterDecor() {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== FLOOR) continue;
        const r = rng();
        if (r < 0.04) this.decor[this.idx(x, y)] = "crack";
        else if (r < 0.06) this.decor[this.idx(x, y)] = "rubble";
        else if (r < 0.10) this.decor[this.idx(x, y)] = "floorAlt";
      }
    }
  }

  // All floor cells of a room, useful for spawning.
  roomCells(room) {
    const cells = [];
    for (let y = room.y; y < room.y + room.h; y++)
      for (let x = room.x; x < room.x + room.w; x++)
        if (this.get(x, y) === FLOOR) cells.push({ x, y });
    return cells;
  }

  // --- Field of view: cast a ray to every cell within radius. ---
  computeFov(ox, oy, radius) {
    this.visible.fill(false);
    this.visible[this.idx(ox, oy)] = true;
    this.explored[this.idx(ox, oy)] = true;
    const r2 = radius * radius;
    for (let y = oy - radius; y <= oy + radius; y++) {
      for (let x = ox - radius; x <= ox + radius; x++) {
        if (!this.inBounds(x, y)) continue;
        const dx = x - ox;
        const dy = y - oy;
        if (dx * dx + dy * dy > r2) continue;
        if (this.lineOfSight(ox, oy, x, y)) {
          const i = this.idx(x, y);
          this.visible[i] = true;
          this.explored[i] = true;
        }
      }
    }
  }

  // Bresenham LOS; the target cell itself may be a wall (still seen).
  lineOfSight(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    while (true) {
      if (x === x1 && y === y1) return true;
      // Walls block sight, but the wall cell we are stepping onto is allowed
      // as the final cell (handled by the check above).
      if (!(x === x0 && y === y0) && this.blocksSight(x, y)) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }
}
