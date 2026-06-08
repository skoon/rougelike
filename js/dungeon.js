// Procedural dungeon generation (rooms + corridors) and field of view.

export const WALL = 0;
export const FLOOR = 1;
export const STAIRS = 2;

const rnd = (n) => Math.floor(Math.random() * n);
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
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tiles = new Array(w * h).fill(WALL);
    this.decor = new Array(w * h).fill(null); // visual-only floor decoration
    this.visible = new Array(w * h).fill(false);
    this.explored = new Array(w * h).fill(false);
    this.rooms = [];
    this.stairs = null;
    this.generate();
  }

  idx(x, y) { return y * this.w + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[this.idx(x, y)] : WALL; }
  set(x, y, v) { if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = v; }

  isWalkable(x, y) {
    const t = this.get(x, y);
    return t === FLOOR || t === STAIRS;
  }
  blocksSight(x, y) { return this.get(x, y) === WALL; }

  generate() {
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

    // Stairs in the room farthest from the first one.
    const start = this.rooms[0];
    let best = this.rooms[1] || start;
    let bestD = -1;
    for (const r of this.rooms.slice(1)) {
      const d = Math.abs(r.cx - start.cx) + Math.abs(r.cy - start.cy);
      if (d > bestD) { bestD = d; best = r; }
    }
    this.stairs = { x: best.cx, y: best.cy };
    this.set(this.stairs.x, this.stairs.y, STAIRS);

    this.scatterDecor();
  }

  carveRoom(room) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        this.set(x, y, FLOOR);
      }
    }
  }

  carveCorridor(x1, y1, x2, y2) {
    if (Math.random() < 0.5) {
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
        const r = Math.random();
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
