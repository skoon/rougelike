// Headless difficulty simulator (M10-T1).
//
// Runs an auto-player through real generated/populated floors to gauge the
// difficulty curve, then prints survival and death-depth distributions per
// class. It imports the real generation + data modules (dungeon/entities/rng)
// and MIRRORS game.js's combat + leveling formulas — if those change in
// game.js, update the marked sections here too.
//
//   node test/sim.js [runsPerClass] [maxDepth]
//
// The combat model is intentionally simplified to isolate *balance* (does the
// player's power keep pace with monsters?), not tactics: the player fights the
// floor's monsters one at a time, auto-equips the best gear it finds, and
// quaffs a potion when below 40% HP. It deliberately ignores movement, FOV,
// traps, and the option to flee — so it is a pessimistic-ish lower bound that
// still tracks how scaling, gear tiers, and the XP curve interact.

import { Dungeon } from "../js/dungeon.js";
import { populate, makeBoss, makeItem, CLASSES, GEAR } from "../js/entities.js";
import { seedRng, rng } from "../js/rng.js";

const WIN_DEPTH = 10; // mirrors game.js
const ATK_MULT = process.env.ATK_MULT !== undefined ? parseFloat(process.env.ATK_MULT) : 1;
const HP_MULT = process.env.HP_MULT !== undefined ? parseFloat(process.env.HP_MULT) : 1;

// ----- mirrors game.js: player construction + class kit -----
function newPlayer(cls) {
  const c = CLASSES[cls] || CLASSES.warrior;
  const p = {
    cls,
    maxHp: c.hp, hp: c.hp,
    baseAtk: c.atk, baseDef: c.def,
    atk: c.atk, def: c.def,
    equip: { weapon: null, armor: null, shield: null },
    potions: 0,
    level: 1, xp: 0, xpNext: 20,
    gold: 0,
    minHpPct: 1,
  };
  // Starting kit (mirrors Game.applyClass; meta unlocks are off in the sim).
  if (cls === "warrior") p.equip.armor = { slot: "armor", bonus: 2 };
  if (cls === "rogue") p.equip.weapon = { slot: "weapon", bonus: 4 };
  if (cls === "mage") p.potions = 3;
  recalc(p);
  return p;
}

function recalc(p) {
  const e = p.equip;
  p.atk = p.baseAtk + (e.weapon ? e.weapon.bonus : 0);
  p.def = p.baseDef + (e.armor ? e.armor.bonus : 0) + (e.shield ? e.shield.bonus : 0);
}

// ----- mirrors game.js: rollDamage -----
function rollDamage(atk, def) {
  return Math.max(1, atk - def + (Math.floor(rng() * 3) - 1));
}

// Fraction of max HP restored on level-up (1 = full heal, as in current
// game.js). Override with env LVL_HEAL to test attrition models.
const LVL_HEAL = process.env.LVL_HEAL !== undefined ? parseFloat(process.env.LVL_HEAL) : 1;

// ----- mirrors game.js: gainXp -----
function gainXp(p, amount) {
  p.xp += amount;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = Math.floor(p.xpNext * 1.5);
    p.maxHp += 6;
    p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * LVL_HEAL));
    p.baseAtk += 1;
    if (p.level % 3 === 0) p.baseDef += 1;
  }
  recalc(p);
}

function maybeEquip(p, it) {
  if (!it || it.category !== "equip") return;
  const cur = p.equip[it.slot];
  if (!cur || it.bonus > cur.bonus) p.equip[it.slot] = { slot: it.slot, bonus: it.bonus };
  recalc(p);
}

function quaffIfLow(p) {
  p.minHpPct = Math.min(p.minHpPct, p.hp / p.maxHp);
  if (p.hp < p.maxHp * 0.45 && p.potions > 0) {
    p.potions--;
    p.hp = p.cls === "mage" ? p.maxHp : Math.min(p.maxHp, p.hp + 12);
  }
}

// Resolve one encounter (1+ monsters at once). The player focus-fires the
// nearest target, but EVERY living monster in the group lands a hit each round
// — this simultaneous-attacker pressure is the game's real difficulty driver
// (nests, open rooms, ranged foes). Returns the monster that kills the player,
// or null on survival.
function fightGroup(p, group) {
  const alive = group.slice();
  while (alive.length) {
    // Player kills/damages one target (first strike on the focus).
    const m = alive[0];
    let dmg = rollDamage(p.atk, m.def);
    if (p.cls === "rogue" && rng() < 0.3) dmg *= 2; // backstab
    m.hp -= dmg;
    if (m.hp <= 0) { gainXp(p, m.xp); alive.shift(); quaffIfLow(p); continue; }

    // Every living monster retaliates this round.
    for (const a of alive) {
      let mdmg = rollDamage(a.atk, p.def);
      if (p.cls === "warrior") mdmg = Math.max(1, mdmg - 1); // toughness
      p.hp -= mdmg;
      if (p.hp <= 0) { p.minHpPct = 0; return a; }
    }
    quaffIfLow(p);
  }
  return null;
}

// Split a floor's monsters into encounters. Most are singles/pairs; nests and
// boss floors create larger simultaneous fights.
function makeEncounters(monsters) {
  const pool = monsters.slice();
  const groups = [];
  while (pool.length) {
    const r = rng();
    let size = r < 0.55 ? 1 : r < 0.85 ? 2 : 3;
    size = Math.min(size, pool.length);
    groups.push(pool.splice(0, size));
  }
  return groups;
}

// Play one full run; returns { depth, won, level, gold, cause }.
function playRun(p, seed, maxDepth) {
  for (let depth = 1; depth <= maxDepth; depth++) {
    seedRng((seed ^ (depth * 2654435761)) >>> 0);
    const dungeon = new Dungeon(50, 38, themeStrategy(depth));
    const { monsters, items } = populate(dungeon, depth);

    // Sweep knobs: post-scale TRASH offense (not the boss, whose stats are set
    // explicitly in makeBoss) to search for good makeMonster values before
    // baking them in. ATK_MULT/HP_MULT default to 1 (no change).
    if (ATK_MULT !== 1 || HP_MULT !== 1) {
      for (const m of monsters) {
        m.atk = Math.round(m.atk * ATK_MULT);
        m.hp = m.maxHp = Math.round(m.hp * HP_MULT);
      }
    }

    if (depth % 5 === 0) {
      const s = dungeon.stairs;
      monsters.push(makeBoss(s.x, s.y, depth));
    }

    // Grab the floor's actual loot (an attentive player gears up before
    // fighting and pockets any potions / gold the floor offers).
    for (const it of items) {
      if (it.category === "equip") maybeEquip(p, it);
      else if (it.category === "consumable") p.potions++;
      else if (it.category === "gold") p.gold += it.amount;
    }
    // Chests add a little extra: ~1 gear roll + a chance at a potion.
    maybeEquip(p, makeItem(["weapon", "armor", "shield"][Math.floor(rng() * 3)], 0, 0, depth));
    if (rng() < 0.5) p.potions++;

    // Fight the floor as a series of encounters.
    for (const group of makeEncounters(monsters)) {
      const killer = fightGroup(p, group);
      if (killer) {
        return { depth, won: false, level: p.level, gold: p.gold, cause: killer.name, minHpPct: 0 };
      }
    }

    if (depth >= WIN_DEPTH) {
      return { depth, won: true, level: p.level, gold: p.gold, cause: null, minHpPct: p.minHpPct };
    }
  }
  return { depth: maxDepth, won: true, level: p.level, gold: p.gold, cause: null, minHpPct: p.minHpPct };
}

// mirrors game.js themeForDepth strategy selection
function themeStrategy(depth) {
  const strats = ["rooms", "bsp", "caves", "caves"];
  return strats[Math.min(strats.length - 1, Math.floor((depth - 1) / 2))];
}

function main() {
  const runs = parseInt(process.argv[2], 10) || 400;
  const maxDepth = parseInt(process.argv[3], 10) || WIN_DEPTH;
  const classes = Object.keys(CLASSES);

  console.log(`Difficulty sim: ${runs} runs/class, maxDepth ${maxDepth}\n`);
  const overall = {};

  for (const cls of classes) {
    let wins = 0;
    const deathDepths = [];
    const causes = {};
    let sumDepth = 0, sumLevel = 0, sumMinHp = 0, dangerRuns = 0;
    for (let i = 0; i < runs; i++) {
      const p = newPlayer(cls);
      const r = playRun(p, 1000 + i, maxDepth);
      sumDepth += r.depth;
      sumLevel += r.level;
      sumMinHp += r.minHpPct;
      if (r.minHpPct < 0.25) dangerRuns++; // dropped below 25% HP at some point
      if (r.won) wins++;
      else { deathDepths.push(r.depth); causes[r.cause] = (causes[r.cause] || 0) + 1; }
    }
    const winPct = (wins / runs) * 100;
    overall[cls] = winPct;

    // death-depth histogram
    const hist = {};
    for (const d of deathDepths) hist[d] = (hist[d] || 0) + 1;
    const histStr = Array.from({ length: maxDepth }, (_, i) => i + 1)
      .map((d) => `${d}:${hist[d] || 0}`).join(" ");
    const topCauses = Object.entries(causes)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([n, c]) => `${n}(${c})`).join(", ");

    console.log(`${cls.padEnd(8)} win ${winPct.toFixed(1).padStart(5)}%  avgDepth ${(sumDepth / runs).toFixed(1)}  endLvl ${(sumLevel / runs).toFixed(1)}`);
    console.log(`   avg min-HP ${(sumMinHp / runs * 100).toFixed(0)}%  scary runs (<25% HP) ${(dangerRuns / runs * 100).toFixed(0)}%`);
    console.log(`   deaths by depth: ${histStr}`);
    console.log(`   top killers: ${topCauses || "—"}\n`);
  }

  const avg = Object.values(overall).reduce((a, b) => a + b, 0) / classes.length;
  console.log(`Mean win rate across classes: ${avg.toFixed(1)}%`);

  if (process.env.DEBUG) {
    // Snapshot a warrior's stats at the end of a clean run, plus depth-10
    // monster offense, to see the ATK-vs-DEF gap directly.
    const p = newPlayer("warrior");
    playRun(p, 12345, maxDepth);
    console.log(`\n[debug] end warrior: lvl ${p.level} atk ${p.atk} def ${p.def} maxHp ${p.maxHp}`);
    seedRng(999);
    const d = new Dungeon(50, 38, "caves");
    const { monsters } = populate(d, 10);
    const sample = {};
    for (const m of monsters) if (!sample[m.key]) sample[m.key] = m;
    for (const k of Object.keys(sample)) {
      const m = sample[k];
      console.log(`[debug] depth10 ${k.padEnd(8)} atk ${m.atk} def ${m.def} hp ${m.hp}  -> dmg to player ~${Math.max(1, m.atk - p.def)}`);
    }
  }
}

main();
