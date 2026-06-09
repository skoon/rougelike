// Actor and item templates plus per-depth spawning.

import { FLOOR } from "./dungeon.js";

// Monster templates. `minDepth` gates when they start appearing; `weight`
// shapes how common they are. `layers` are [col,row] tiles on the Characters
// sheet, drawn bottom-to-top to build a paper-doll sprite.
// `flees`: retreats at low HP. `poisons`: melee hits can poison. `ranged`: can
// attack from a distance (value = range in tiles).
export const MONSTERS = {
  rat:    { name: "giant rat",    layers: [[0, 2]],                          hp: 6,  atk: 2, def: 0, xp: 3,  minDepth: 1, weight: 5, flees: true },
  slime:  { name: "green slime",  layers: [[0, 3]],                          hp: 10, atk: 3, def: 0, xp: 5,  minDepth: 1, weight: 4, poisons: true },
  goblin: { name: "goblin",       layers: [[0, 3], [11, 7], [23, 4]],        hp: 12, atk: 4, def: 1, xp: 7,  minDepth: 2, weight: 4 },
  bandit: { name: "bandit",       layers: [[0, 2], [8, 8], [23, 4]],         hp: 15, atk: 5, def: 1, xp: 9,  minDepth: 3, weight: 3 },
  wraith: { name: "pale wraith",  layers: [[1, 11]],                         hp: 14, atk: 6, def: 0, xp: 13, minDepth: 4, weight: 2, ranged: 5 },
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
    flees: !!t.flees,
    poisons: !!t.poisons,
    ranged: t.ranged || 0,
    statuses: [],
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

const BOSS_NAMES = ["the Bone Tyrant", "the Crypt Warden", "the Sunken King", "the Lord of Dust"];

// A unique, oversized foe for boss floors.
export function makeBoss(x, y, depth) {
  const m = makeMonster("knight", x, y, depth);
  m.boss = true;
  m.name = BOSS_NAMES[Math.min(BOSS_NAMES.length - 1, Math.floor(depth / 5) - 1)] || "the Tyrant";
  m.tint = "#7d3cff";
  m.maxHp = 55 + depth * 9;
  m.hp = m.maxHp;
  m.atk = 9 + depth;
  m.def = 4;
  m.xp = 70 + depth * 12;
  return m;
}

// Equipment tiers by slot: [name, bonus], deeper floors roll higher tiers.
export const GEAR = {
  weapon: [["rusty dagger", 2], ["short sword", 4], ["war axe", 6], ["runed blade", 9]],
  armor:  [["leather armor", 1], ["chainmail", 2], ["plate armor", 4], ["rune plate", 6]],
  shield: [["buckler", 1], ["kite shield", 2], ["tower shield", 3]],
};

// Build a world/inventory item. `category` drives how pickup handles it:
// "gold" (instant), "key" (instant), "consumable", or "equip".
export function makeItem(key, x, y, depth) {
  const base = { kind: "item", key, x, y };
  if (key === "gold") {
    base.category = "gold"; base.sprite = "gold"; base.name = "gold";
    base.amount = 5 + Math.floor(Math.random() * (8 + depth * 2));
  } else if (key === "amulet") {
    base.category = "gold"; base.sprite = "amulet"; base.name = "glittering amulet";
    base.amount = 25 + depth * 5;
  } else if (key === "key") {
    base.category = "key"; base.sprite = "key"; base.name = "iron key";
  } else if (key === "potion") {
    base.category = "consumable"; base.sprite = "potion"; base.name = "healing potion";
    base.heal = 12;
  } else {
    // weapon / armor / shield
    const tiers = GEAR[key];
    const ti = Math.max(0, Math.min(tiers.length - 1,
      Math.floor((depth - 1) / 2) + (Math.random() < 0.3 ? 1 : 0)));
    base.category = "equip"; base.slot = key; base.sprite = key;
    base.name = tiers[ti][0];
    base.bonus = tiers[ti][1];
  }
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

function randomLootKind() {
  const r = Math.random();
  if (r < 0.34) return "gold";
  if (r < 0.60) return "potion";
  if (r < 0.72) return "weapon";
  if (r < 0.84) return "armor";
  if (r < 0.93) return "shield";
  return "amulet";
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
    items.push(makeItem(randomLootKind(), c.x, c.y, depth));
  }

  // --- Locked treasure vault: a key out in the open + rich loot inside. ---
  if (dungeon.hasVault && dungeon.vaultCells.length) {
    if (ci < cand.length) items.push(makeItem("key", cand[ci].x, cand[ci++].y, depth));
    const vcells = shuffle(dungeon.vaultCells.slice());
    const lootKinds = ["amulet", "weapon", "armor", "shield", "potion"];
    const lootN = Math.min(vcells.length, 3 + Math.floor(Math.random() * 2));
    for (let n = 0; n < lootN; n++) {
      items.push(makeItem(lootKinds[n % lootKinds.length], vcells[n].x, vcells[n].y, depth));
    }
    // A guardian waits inside.
    if (vcells.length > lootN) {
      const g = vcells[lootN];
      monsters.push(makeElite(makeMonster(weightedPick(monsterKeys, depth + 2), g.x, g.y, depth + 1)));
    }
  }

  // --- Monster nest: a dense cluster, with a small reward. ---
  if (dungeon.nestCells.length) {
    const ncells = shuffle(dungeon.nestCells.slice());
    const nN = Math.min(ncells.length - 1, 4 + Math.floor(depth / 2) + Math.floor(Math.random() * 3));
    for (let n = 0; n < nN; n++) {
      monsters.push(makeMonster(weightedPick(monsterKeys, depth), ncells[n].x, ncells[n].y, depth));
    }
    if (ncells.length > nN) {
      const c = ncells[nN];
      items.push(makeItem(Math.random() < 0.5 ? "gold" : "potion", c.x, c.y, depth));
    }
  }

  return { monsters, items };
}
