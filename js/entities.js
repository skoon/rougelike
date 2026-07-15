// Actor and item templates plus per-depth spawning.

import { FLOOR } from "./dungeon.js";
import { rng } from "./rng.js";

// Monster templates. `minDepth` gates when they start appearing; `weight`
// shapes how common they are. `layers` are [col,row] tiles on the Characters
// sheet, drawn bottom-to-top to build a paper-doll sprite.
// `flees`: retreats at low HP. `poisons`: melee hits can poison. `bleeds`:
// melee hits can cause bleeding. `ranged`: can attack from a distance (value =
// range in tiles). `slows`: ranged hits can slow. `tint`/`tintStrength` give a
// template a permanent color wash; `bolt` styles a ranged attack's projectile.
// `strip` swaps the layered paper-doll for an animated Tiny Dungeons strip:
// { key, idle:[row,frames], death:[row,frames], faces } where `faces` is the
// direction the art looks in the source (-1 = left).
export const MONSTERS = {
  rat:    { name: "giant rat",    strip: { key: "rat", idle: [0, 13], death: [4, 9], faces: -1 },
            hp: 6,  atk: 2, def: 0, xp: 3,  minDepth: 1, weight: 5, flees: true },
  slime:  { name: "green slime",  strip: { key: "slime", idle: [0, 6], death: [3, 8], faces: 1 },
            tint: "#3fae3f", tintStrength: 0.35,
            hp: 10, atk: 3, def: 0, xp: 5,  minDepth: 1, weight: 4, poisons: true },
  skull:  { name: "blazing skull", strip: { key: "skull", idle: [0, 10], death: [3, 7], faces: -1 },
            hp: 12, atk: 5, def: 0, xp: 11, minDepth: 4, weight: 2 },
  goblin: { name: "goblin",       layers: [[0, 3], [11, 7], [23, 4]],        hp: 12, atk: 4, def: 1, xp: 7,  minDepth: 2, weight: 4 },
  bandit: { name: "bandit",       layers: [[0, 2], [8, 8], [23, 4]],         hp: 15, atk: 5, def: 1, xp: 9,  minDepth: 3, weight: 3, bleeds: true },
  archer: { name: "skeleton archer", layers: [[0, 2], [23, 4]],              hp: 13, atk: 5, def: 0, xp: 12, minDepth: 3, weight: 2, ranged: 6,
            tint: "#e8e4d0", tintStrength: 0.45, bolt: { color: "#e8d8a8", msg: "looses an arrow at you" } },
  wraith: { name: "pale wraith",  layers: [[1, 11]],                         hp: 14, atk: 6, def: 0, xp: 13, minDepth: 4, weight: 2, ranged: 5 },
  wisp:   { name: "frost wisp",   layers: [[1, 11]],                         hp: 11, atk: 4, def: 0, xp: 14, minDepth: 5, weight: 2, ranged: 4, slows: true,
            tint: "#7fd4ff", tintStrength: 0.5, bolt: { color: "#9fe8ff", msg: "flings a freezing shard" } },
  knight: { name: "dread knight", layers: [[0, 0], [15, 7], [17, 5], [23, 7]], hp: 28, atk: 8, def: 3, xp: 24, minDepth: 6, weight: 1, bleeds: true },
};

export function makeMonster(key, x, y, depth) {
  const t = MONSTERS[key];
  // Depth scaling. `steps` is how many floors past a monster's debut we are, so
  // newly-introduced monsters stay at baseline. ATK scales faster than HP so it
  // keeps pace with the player's climbing DEF (level bumps + gear) — otherwise
  // the back half of a run trivialises into minimum-damage hits. Tuned against
  // test/sim.js; keep that harness in sync when adjusting these numbers.
  const steps = Math.max(0, depth - t.minDepth);
  const hpBonus = Math.floor(steps * 0.5) * 2;
  // ATK ramps ~1/floor past a monster's debut and is lifted ~70% over the old
  // baseline so it keeps pace with the player's climbing DEF (level bumps +
  // gear). Without this, late floors decayed into pure minimum-damage hits.
  // Validated in test/sim.js: this restores back-half attrition (optimal-play
  // min-HP ~25-36%, scary runs scaling warrior<rogue<mage) while a careful
  // run still almost always survives.
  const atk = Math.round((t.atk + steps) * 1.7);
  return {
    kind: "monster",
    key,
    name: t.name,
    layers: t.layers || null,
    strip: t.strip || null,
    x, y,
    rx: x, ry: y, // render position (for tweening)
    facing: 1,
    bobPhase: rng() * Math.PI * 2,
    flashUntil: 0,
    hp: t.hp + hpBonus,
    maxHp: t.hp + hpBonus,
    atk,
    def: t.def,
    xp: t.xp,
    flees: !!t.flees,
    poisons: !!t.poisons,
    bleeds: !!t.bleeds,
    slows: !!t.slows,
    ranged: t.ranged || 0,
    bolt: t.bolt || null,
    tint: t.tint || null,
    tintStrength: t.tintStrength || 0,
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

// Playable class definitions. Starting stats + kit + perk + two activated
// abilities (slot 0 = key Q, slot 1 = key E). Each ability: { id, name, cd
// (turn cooldown), range?, short (HUD label) }. Behaviour lives in
// Game.useAbility (js/game.js), dispatched on `id`.
export const CLASSES = {
  warrior: {
    name: "Warrior",
    hp: 40, atk: 6, def: 2,
    kit: "Starts with chainmail armor.",
    perk: "Toughness: take 1 less damage from every hit.",
    abilities: [
      { id: "cleave", name: "Cleave", short: "Cleave", cd: 4, desc: "Strike all adjacent foes." },
      { id: "brace",  name: "Brace",  short: "Brace",  cd: 5, desc: "Halve damage until your next turn." },
    ],
  },
  rogue: {
    name: "Rogue",
    hp: 25, atk: 8, def: 0,
    kit: "Starts with a short sword.",
    perk: "Backstab: 30% chance to deal double damage.",
    abilities: [
      { id: "dash",  name: "Dash",  short: "Dash",  cd: 4, range: 4, desc: "Leap to a foe and backstab." },
      { id: "smoke", name: "Smoke", short: "Smoke", cd: 6, desc: "Vanish — foes lose track of you." },
    ],
  },
  mage: {
    name: "Mage",
    hp: 22, atk: 4, def: 0,
    kit: "Starts with 3 healing potions.",
    perk: "Arcane: healing potions restore full HP.",
    abilities: [
      { id: "firebolt",  name: "Firebolt",   short: "Firebolt", cd: 2, range: 6, desc: "Hurl a bolt of fire." },
      { id: "frostnova", name: "Frost Nova", short: "Frost",    cd: 5, desc: "Slow all adjacent foes." },
    ],
  },
};

// Equipment tiers by slot: [name, bonus], deeper floors roll higher tiers.
export const GEAR = {
  weapon: [["rusty dagger", 2], ["short sword", 4], ["war axe", 6], ["runed blade", 9]],
  armor:  [["leather armor", 1], ["chainmail", 2], ["plate armor", 4], ["rune plate", 6]],
  shield: [["buckler", 1], ["kite shield", 2], ["tower shield", 3]],
};

// Build a world/inventory item. `category` drives how pickup handles it:
// "gold" (instant), "key" (instant), "consumable" (potions + scrolls), "wand"
// (charge-based caster), or "equip" (weapon/armor/shield/ring).
export function makeItem(key, x, y, depth) {
  const base = { kind: "item", key, x, y };
  if (key === "gold") {
    base.category = "gold"; base.sprite = "gold"; base.name = "gold";
    base.amount = 5 + Math.floor(rng() * (8 + depth * 2));
  } else if (key === "amulet") {
    base.category = "gold"; base.sprite = "amulet"; base.name = "glittering amulet";
    base.amount = 25 + depth * 5;
  } else if (key === "key") {
    base.category = "key"; base.sprite = "key"; base.name = "iron key";
  } else if (key === "potion") {
    base.category = "consumable"; base.sprite = "potion"; base.name = "healing potion";
    base.heal = 12;
  } else if (key === "artifact") {
    base.category = "artifact"; base.name = "the Forgotten Relic";
  } else if (key === "scroll") {
    // One-shot consumables; the effect lives in Game.useScroll. Weighted (not
    // uniform) so the return scroll — the main limiter on camp round-trips —
    // stays uncommon relative to the rest.
    base.category = "consumable"; base.sprite = "scroll";
    const kinds = [
      ["teleport", "scroll of teleport", 3],
      ["map",      "scroll of magic mapping", 3],
      ["enchant",  "scroll of enchantment", 3],
      ["identify", "scroll of identify", 3],
      ["uncurse",  "scroll of remove curse", 3],
      ["return",   "scroll of return", 1],
    ];
    const total = kinds.reduce((s, k) => s + k[2], 0);
    let roll = rng() * total;
    let pick = kinds[kinds.length - 1];
    for (const k of kinds) {
      roll -= k[2];
      if (roll <= 0) { pick = k; break; }
    }
    base.scroll = pick[0]; base.name = pick[1];
  } else if (key === "wand") {
    // Charge-based caster; fired from the hotbar (Game.useWand).
    base.category = "wand"; base.sprite = "wand";
    const kinds = [
      ["fire",  "wand of firebolts", "#ff8c2a", 5],
      ["frost", "wand of frost",     "#9fe8ff", 3],
    ];
    const pick = kinds[Math.floor(rng() * kinds.length)];
    base.wand = pick[0]; base.name = pick[1];
    base.boltColor = pick[2]; base.power = pick[3];
    base.charges = 3 + Math.floor(rng() * 4); // 3-6 casts
    base.range = 6;
  } else if (key === "ring") {
    // Passive equip in its own slot; affixes fold into Game.recalcStats.
    base.category = "equip"; base.slot = "ring"; base.sprite = "ring";
    const affixes = [
      ["ring of regeneration", "regen",  1],
      ["ring of precision",    "crit",   18],
      ["ring of warding",      "resist", 25],
    ];
    const pick = affixes[Math.floor(rng() * affixes.length)];
    base.name = pick[0]; base.affix = pick[1]; base.power = pick[2];
    base.desc = ringDesc(base.affix, base.power); base.bonus = 0;
  } else {
    // weapon / armor / shield
    const tiers = GEAR[key];
    const ti = Math.max(0, Math.min(tiers.length - 1,
      Math.floor((depth - 1) / 2) + (rng() < 0.3 ? 1 : 0)));
    base.category = "equip"; base.slot = key; base.sprite = key;
    base.name = tiers[ti][0];
    base.bonus = tiers[ti][1];
  }

  // M14: gear and wands arrive unidentified — an obscured name until equipped,
  // used, or read with a scroll of identify.
  if (base.category === "equip" || base.category === "wand") base.identified = false;

  // M14: a fraction of gear is cursed — a stronger pull, but it locks onto you
  // (can't be swapped out) and drags a secondary stat until cleansed.
  if (base.category === "equip" && rng() < 0.22) {
    base.cursed = true;
    if (base.slot === "ring") {
      base.power += base.affix === "regen" ? 1 : 8;
      base.desc = ringDesc(base.affix, base.power);
    } else {
      base.bonus += 2;
      if (base.slot === "weapon") base.malusDef = 2; else base.malusAtk = 2;
    }
  }
  return base;
}

// Human-readable effect line for a ring affix at a given power.
export function ringDesc(affix, power) {
  return affix === "regen" ? `+${power} HP / 3 turns`
    : affix === "crit" ? `+${power}% crit`
    : `−${power}% damage taken`;
}

function weightedPick(keys, depth) {
  const pool = keys.filter((k) => MONSTERS[k].minDepth <= depth);
  const total = pool.reduce((s, k) => s + MONSTERS[k].weight, 0);
  let roll = rng() * total;
  for (const k of pool) {
    roll -= MONSTERS[k].weight;
    if (roll <= 0) return k;
  }
  return pool[pool.length - 1];
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomLootKind() {
  const r = rng();
  if (r < 0.30) return "gold";
  if (r < 0.50) return "potion";
  if (r < 0.62) return "weapon";
  if (r < 0.72) return "armor";
  if (r < 0.80) return "shield";
  if (r < 0.88) return "scroll";
  if (r < 0.93) return "wand";
  if (r < 0.97) return "ring";
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
    5 + depth * 2 + Math.floor(area / 130) + Math.floor(rng() * 4)
  );
  for (let n = 0; n < monsterCount && ci < cand.length; n++) {
    const c = cand[ci++];
    const m = makeMonster(weightedPick(monsterKeys, depth), c.x, c.y, depth);
    if (depth >= 3 && rng() < 0.08 + depth * 0.01) makeElite(m);
    monsters.push(m);
  }

  const itemCount = Math.min(cand.length - ci, 4 + Math.floor(rng() * 4));
  for (let n = 0; n < itemCount && ci < cand.length; n++) {
    const c = cand[ci++];
    items.push(makeItem(randomLootKind(), c.x, c.y, depth));
  }

  // --- Locked treasure vault: a key out in the open + rich loot inside. ---
  if (dungeon.hasVault && dungeon.vaultCells.length) {
    if (ci < cand.length) items.push(makeItem("key", cand[ci].x, cand[ci++].y, depth));
    const vcells = shuffle(dungeon.vaultCells.slice());
    const lootKinds = ["amulet", "weapon", "armor", "shield", "potion"];
    const lootN = Math.min(vcells.length, 3 + Math.floor(rng() * 2));
    for (let n = 0; n < lootN; n++) {
      items.push(makeItem(lootKinds[n % lootKinds.length], vcells[n].x, vcells[n].y, depth));
    }
    // A guardian waits inside.
    if (vcells.length > lootN) {
      const g = vcells[lootN];
      monsters.push(makeElite(makeMonster(weightedPick(monsterKeys, depth + 2), g.x, g.y, depth + 1)));
    }
  }

  // --- Lever-gated alcove: a burst of treasure behind the portcullis. ---
  if (dungeon.gateCells && dungeon.gateCells.length) {
    const gcells = shuffle(dungeon.gateCells.slice());
    const kinds = ["amulet", "weapon", "armor", "potion"];
    const lootN = Math.min(gcells.length, 2 + Math.floor(rng() * 2));
    for (let n = 0; n < lootN; n++)
      items.push(makeItem(kinds[n % kinds.length], gcells[n].x, gcells[n].y, depth + 1));
  }

  // --- Monster nest: a dense cluster, with a small reward. ---
  if (dungeon.nestCells.length) {
    const ncells = shuffle(dungeon.nestCells.slice());
    const nN = Math.min(ncells.length - 1, 4 + Math.floor(depth / 2) + Math.floor(rng() * 3));
    for (let n = 0; n < nN; n++) {
      monsters.push(makeMonster(weightedPick(monsterKeys, depth), ncells[n].x, ncells[n].y, depth));
    }
    if (ncells.length > nN) {
      const c = ncells[nN];
      items.push(makeItem(rng() < 0.5 ? "gold" : "potion", c.x, c.y, depth));
    }
  }

  return { monsters, items };
}
