// The surface base camp: a hand-authored outdoor map the player retreats to
// from the dungeon (M19).
//
// The camp is a *mode*, not a depth (`Game.mode`), and it is not persisted:
// `Game.leaveCamp` rebuilds the floor it came from with the same per-floor seed,
// so the layout is identical while the monsters and loot are fresh.
//
// `buildCamp()` returns a real `Dungeon` whose generated contents are
// overwritten from the legend below. Going through the real class (rather than
// duck-typing a map-shaped object) guarantees every field and method the render
// and turn paths touch — idx/get/set/isWalkable/blocksSight/lineOfSight,
// objs/traps/lights/floors — exists and behaves exactly as underground.

import { Dungeon, WALL, FLOOR, STAIRS } from "./dungeon.js";
import { SPR } from "./assets.js";

// Legend (rows must all be the same width):
//   #  fence — the camp's impassable border
//   T  tree — impassable
//   .  grass          ,  dirt path
//   M  merchant tent  H  healer tent — the TOP-LEFT ANCHOR of a 2x2 tent. The
//                        anchor plus the cells right / below / below-right form
//                        the tent; all four are impassable and those three must
//                        be authored as grass. The NPC stands on the path tile
//                        two rows below the anchor, in front of the door.
//   C  campfire — walkable (M19-T4 rests here)
//   D  cave mouth — the way back down; a STAIRS tile, so the stairs marker,
//                     click-to-move and the `turn()` stairs check all just work
//   @  the player's arrival spot
const LEGEND = [
  "##############################",
  "#T..........................T#",
  "#T............TDT...........T#",
  "#..............,.............#",
  "#T.............,............T#",
  "#..............,.............#",
  "#......M.......,......H......#",
  "#..............,.............#",
  "#......,,,,,,,,,,,,,,,,......#",
  "#..............,.............#",
  "#T.............,............T#",
  "#..............,.............#",
  "#..............C.............#",
  "#..............,.............#",
  "#..............@.............#",
  "#............................#",
  "#T..........................T#",
  "#............................#",
  "#TT........................TT#",
  "##############################",
];

// Render theme, shaped like the dungeon THEMES entries so `render()` picks it
// up unchanged. `wall` is the ground sprite because trees and fences are drawn
// as decor over it — a bare WALL tile with no decor would be an invisible wall,
// so every # / T / M / H in the legend must set decor.
export const CAMP_THEME = {
  name: "the Camp",
  strategy: "camp",
  floor: SPR.grass,
  wall: SPR.grass,
  stairs: SPR.caveMouth,
  tint: "rgba(6,10,20,0.5)", // unused: the camp is fully lit, nothing is unseen
};

// Deterministic grass variation — a hash, not rng(), so the camp is identical
// every visit and building it never depends on the run's RNG stream.
const grassDecor = (x, y) => ((x * 7 + y * 13) % 11 === 0 ? "grassAlt" : null);

export function buildCamp() {
  const h = LEGEND.length;
  const w = LEGEND[0].length;
  for (const row of LEGEND)
    if (row.length !== w)
      throw new Error(`camp legend rows must all be ${w} wide, got ${row.length}`);

  // A real Dungeon, then overwrite everything its generator produced.
  const d = new Dungeon(w, h, "rooms");
  d.strategy = "camp";
  d.tiles.fill(WALL);
  d.decor.fill(null);
  d.objs.fill(null);
  d.traps.clear();
  d.lights.length = 0;
  d.rooms = [];
  d.floors = [];
  d.vaultCells = [];
  d.nestCells = [];
  d.gateCells = [];
  d.shrinePos = null;
  d.gatePos = null;
  d.leverPos = null;
  d.hasVault = false;
  d.startPos = null;
  d.stairs = null;
  d.tents = {};    // 2x2 tent anchors (top-left): { merchant: {x,y}, healer: {x,y} }
  d.npcSpots = {}; // where each camp NPC stands: { merchant: {x,y}, healer: {x,y} }
  d.campfire = null; // {x,y} of the fire (M19-T4's rest spot)

  // Pass 1: expand each 2x2 tent anchor into its four quadrant cells. Giving
  // every cell its own quadrant sprite as decor means the normal per-tile decor
  // draw renders the block correctly — no special case in the render path.
  const TENT_KEY = { M: ["merchant", "tentMerchant"], H: ["healer", "tentHealer"] };
  const tentCells = new Map(); // idx -> quadrant sprite key
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = TENT_KEY[LEGEND[y][x]];
      if (!t) continue;
      const [who, key] = t;
      if (x + 1 >= w || y + 1 >= h)
        throw new Error(`${who} tent anchor at ${x},${y} runs off the camp edge`);
      for (const [dx, dy, quad] of [[0, 0, "TL"], [1, 0, "TR"], [0, 1, "BL"], [1, 1, "BR"]]) {
        const cx = x + dx, cy = y + dy;
        // The three cells the anchor covers must be authored as plain grass, so
        // the 2x2 footprint is unambiguous in the legend above.
        if ((dx || dy) && LEGEND[cy][cx] !== ".")
          throw new Error(
            `${who} tent at ${x},${y} needs grass for its 2x2 footprint, ` +
            `found "${LEGEND[cy][cx]}" at ${cx},${cy}`);
        tentCells.set(d.idx(cx, cy), key + quad);
      }
      d.tents[who] = { x, y };
      d.npcSpots[who] = { x, y: y + 2 }; // on the path, in front of the door
    }
  }

  // Pass 2: the rest of the legend.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = LEGEND[y][x];
      const i = d.idx(x, y);
      // Tent cells are impassable and already carry their quadrant sprite.
      if (tentCells.has(i)) {
        d.tiles[i] = WALL;
        d.decor[i] = tentCells.get(i);
        continue;
      }
      switch (ch) {
        case "#": d.tiles[i] = WALL; d.decor[i] = "fence"; break;
        case "T": d.tiles[i] = WALL; d.decor[i] = "tree"; break;
        case ".": d.tiles[i] = FLOOR; d.decor[i] = grassDecor(x, y); break;
        case ",": d.tiles[i] = FLOOR; d.decor[i] = "path"; break;
        case "C":
          d.tiles[i] = FLOOR; d.decor[i] = "campfire";
          d.lights.push({ x, y, radius: 5 });
          d.campfire = { x, y };
          break;
        case "@": d.tiles[i] = FLOOR; d.startPos = { x, y }; break;
        case "D": d.tiles[i] = STAIRS; d.stairs = { x, y }; break;
        default:
          throw new Error(`unknown camp legend char "${ch}" at ${x},${y}`);
      }
      if (d.tiles[i] === FLOOR) d.floors.push({ x, y });
    }
  }

  if (!d.startPos) throw new Error("camp legend has no @ spawn");
  if (!d.stairs) throw new Error("camp legend has no D cave mouth");
  if (!d.campfire) throw new Error("camp legend has no C campfire");
  if (!d.tents.merchant || !d.tents.healer)
    throw new Error("camp legend needs one M and one H tent");

  // Each NPC must stand on open ground in front of its own tent — otherwise the
  // shop is unreachable, or the NPC is standing inside the canvas.
  for (const [who, spot] of Object.entries(d.npcSpots)) {
    if (!d.isWalkable(spot.x, spot.y))
      throw new Error(`the ${who} would stand on an impassable tile at ${spot.x},${spot.y}`);
    const a = d.tents[who];
    if (spot.y !== a.y + 2 || spot.x < a.x || spot.x > a.x + 1)
      throw new Error(`the ${who} is not in front of its tent door`);
  }

  // The camp is a safe, fully lit clearing: no fog of war, and no FOV recompute
  // (`turn()` calls computeFov after every step, which would re-fog it).
  d.visible.fill(true);
  d.explored.fill(true);
  d.computeFov = () => {};

  return d;
}
