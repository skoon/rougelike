// Actor and item templates plus per-depth spawning.

import { FLOOR } from "./dungeon.js";

// Monster templates. `minDepth` gates when they start appearing; `weight`
// shapes how common they are. `layers` are [col,row] tiles on the Characters
// sheet, drawn bottom-to-top to build a paper-doll sprite.
export const MONSTERS = {
  rat:    { name: "giant rat",    layers: [[0, 2]],                          hp: 6,  atk: 2, def: 0, xp: 3,  minDepth: 1, weight: 5 },
  slime:  { name: "green slime",  layers: [[0, 3]],                          hp: 10, atk: 3, def: 0, xp: 5,  minDepth: 1, weight: 4 },
  goblin: { name: "goblin",       layers: [[0, 3], [11, 7], [23, 4]],        hp: 12, atk: 4, def: 1, xp: 7,  minDepth: 2, weight: 4 },
  bandit: { name: "bandit",       layers: [[0, 2], [8, 8], [23, 4]],         hp: 15, atk: 5, def: 1, xp: 9,  minDepth: 3, weight: 3 },
  wraith: { name: "pale wraith",  layers: [[1, 11]],                         hp: 14, atk: 6, def: 0, xp: 13, minDepth: 4, weight: 2 },
  knight: { name: "dread knight", layers: [[0, 0], [15, 7], [17, 5], [23, 7]], hp: 28, atk: 8, def: 3, xp: 24, minDepth: 6, weight: 1 },
};

export function makeMonster(key, x, y, depth) {
  const t = MONSTERS[key];
  // Light scaling so deeper floors stay dangerous.
  const bonus = Math.floor((depth - t.minDepth) * 0.5);
  return {
    kind: "monster",
    key,
    name: t.name,
    layers: t.layers,
    x, y,
    rx: x, ry: y, // render position (for tweening)
    facing: 1,
    bobPhase: Math.random() * Math.PI * 2,
    flashUntil: 0,
    hp: t.hp + bonus * 2,
    maxHp: t.hp + bonus * 2,
    atk: t.atk + bonus,
    def: t.def,
    xp: t.xp,
    alive: true,
  };
}

// Upgrade a monster into a tougher, tinted "elite" in place.
export function makeElite(m) {
  m.elite = true;
  m.tint = "#cf3a2e";
  m.maxHp = Math.round(m.maxHp * 1.6);
  m.hp = m.maxHp;
  m.atk += 2;
  m.xp = Math.round(m.xp * 2.2);
  m.name = "elite " + m.name;
  return m;
}

// Item templates.
export const ITEMS = {
  gold:   { sprite: "gold",   name: "gold" },
  potion: { sprite: "potion", name: "healing potion" },
  weapon: { sprite: "weapon", name: "sharpened blade" },
  amulet: { sprite: "amulet", name: "glittering amulet" },
};

export function makeItem(key, x, y, depth) {
  const base = { kind: "item", key, x, y, sprite: ITEMS[key].sprite, name: ITEMS[key].name };
  if (key === "gold") base.amount = 5 + Math.floor(Math.random() * (8 + depth * 2));
  if (key === "amulet") base.amount = 25 + depth * 5;
  return base;
}

function weightedPick(keys, depth) {
  const pool = keys.filter((k) => MONSTERS[k].minDepth <= depth);
  const total = pool.reduce((s, k) => s + MONSTERS[k].weight, 0);
  let roll = Math.random() * total;
  for (const k of pool) {
    roll -= MONSTERS[k].weight;
    if (roll <= 0) return k;
  }
  return pool[pool.length - 1];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Populate a freshly generated dungeon. Generator-agnostic: scatters monsters
// and loot across reachable floor cells, away from the player's entrance.
export function populate(dungeon, depth) {
  const monsters = [];
  const items = [];
  const start = dungeon.startPos;
  const stairs = dungeon.stairs;

  // Candidate cells: reachable floor, a safe distance from the entrance, and
  // not the stairs tile.
  const cand = shuffle(
    dungeon.floors.filter((c) => {
      if (c.x === stairs.x && c.y === stairs.y) return false;
      const d = Math.abs(c.x - start.x) + Math.abs(c.y - start.y);
      return d > 6;
    })
  );

  const area = dungeon.floors.length;
  const monsterKeys = Object.keys(MONSTERS);
  let ci = 0;

  const monsterCount = Math.min(
    cand.length,
    5 + depth * 2 + Math.floor(area / 130) + Math.floor(Math.random() * 4)
  );
  for (let n = 0; n < monsterCount && ci < cand.length; n++) {
    const c = cand[ci++];
    const m = makeMonster(weightedPick(monsterKeys, depth), c.x, c.y, depth);
    if (depth >= 3 && Math.random() < 0.08 + depth * 0.01) makeElite(m);
    monsters.push(m);
  }

  const itemCount = Math.min(cand.length - ci, 4 + Math.floor(Math.random() * 4));
  for (let n = 0; n < itemCount && ci < cand.length; n++) {
    const c = cand[ci++];
    const r = Math.random();
    const k = r < 0.5 ? "gold" : r < 0.8 ? "potion" : r < 0.92 ? "weapon" : "amulet";
    items.push(makeItem(k, c.x, c.y, depth));
  }

  return { monsters, items };
}
