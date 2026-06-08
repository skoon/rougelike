// Actor and item templates plus per-depth spawning.

import { FLOOR } from "./dungeon.js";

// Monster templates. `minDepth` gates when they start appearing; `weight`
// shapes how common they are.
export const MONSTERS = {
  rat:    { name: "giant rat",    sprite: "rat",    hp: 6,  atk: 2, def: 0, xp: 3,  speed: 1, minDepth: 1, weight: 5 },
  slime:  { name: "green slime",  sprite: "slime",  hp: 10, atk: 3, def: 0, xp: 5,  speed: 1, minDepth: 1, weight: 4 },
  bandit: { name: "bandit",       sprite: "bandit", hp: 14, atk: 5, def: 1, xp: 9,  speed: 1, minDepth: 3, weight: 3 },
  ghost:  { name: "pale wraith",  sprite: "ghost",  hp: 12, atk: 6, def: 0, xp: 12, speed: 1, minDepth: 4, weight: 2 },
  knight: { name: "dread knight", sprite: "knight", hp: 26, atk: 8, def: 3, xp: 22, speed: 1, minDepth: 6, weight: 1 },
};

export function makeMonster(key, x, y, depth) {
  const t = MONSTERS[key];
  // Light scaling so deeper floors stay dangerous.
  const bonus = Math.floor((depth - t.minDepth) * 0.5);
  return {
    kind: "monster",
    key,
    name: t.name,
    sprite: t.sprite,
    x, y,
    rx: x, ry: y, // render position (for tweening)
    hp: t.hp + bonus * 2,
    maxHp: t.hp + bonus * 2,
    atk: t.atk + bonus,
    def: t.def,
    xp: t.xp,
    alive: true,
  };
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

// Populate a freshly generated dungeon. `startRoom` is left empty of monsters.
export function populate(dungeon, depth, startRoom) {
  const monsters = [];
  const items = [];
  const occupied = new Set();
  const key = (x, y) => x + "," + y;
  occupied.add(key(dungeon.stairs.x, dungeon.stairs.y));

  const freeCellIn = (room) => {
    const cells = dungeon.roomCells(room).filter((c) => !occupied.has(key(c.x, c.y)));
    if (!cells.length) return null;
    const c = cells[Math.floor(Math.random() * cells.length)];
    occupied.add(key(c.x, c.y));
    return c;
  };

  const monsterKeys = Object.keys(MONSTERS);

  dungeon.rooms.forEach((room, i) => {
    if (room === startRoom) return;

    const count = 1 + Math.floor(Math.random() * (1 + Math.min(3, depth)));
    for (let n = 0; n < count; n++) {
      const c = freeCellIn(room);
      if (!c) break;
      monsters.push(makeMonster(weightedPick(monsterKeys, depth), c.x, c.y, depth));
    }

    // Loot.
    if (Math.random() < 0.7) {
      const c = freeCellIn(room);
      if (c) {
        const r = Math.random();
        const k = r < 0.5 ? "gold" : r < 0.8 ? "potion" : r < 0.92 ? "weapon" : "amulet";
        items.push(makeItem(k, c.x, c.y, depth));
      }
    }
  });

  return { monsters, items };
}
