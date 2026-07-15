// Core game: state, turn loop, combat, rendering, input, HUD.

import { drawSprite, drawFrame, STRIPS, SPR, TILE } from "./assets.js";
import { Dungeon, WALL, FLOOR, STAIRS, LOCKED, SHRINE, WATER, GATE, WAYSTONE } from "./dungeon.js";
import { buildCamp, CAMP_THEME } from "./camp.js";
import { populate, makeMonster, makeBoss, makeItem, ringDesc, CLASSES } from "./entities.js";
import { makeNpc, genWares, genCampWares } from "./npc.js";
import { findPath } from "./pathfind.js";
import { audio } from "./audio.js";
import { saveRun, getBest, getHistory, updateMeta, getUnlocks } from "./scores.js";
import { seedRng, rng } from "./rng.js";

const MAP_W = 50;
const MAP_H = 38;
const SCALE = 2; // each 16px tile -> 32 device px
const CELL = TILE * SCALE; // 32
const VIEW_W = 21; // tiles shown horizontally
const VIEW_H = 15; // tiles shown vertically
const FOV_RADIUS = 8;
const MOVE_MS = 90; // tween duration
const WIN_DEPTH = 10; // depth where the win artifact spawns

// Rebindable action keys (lowercased `event.key`). Arrow keys are always-on
// movement fallbacks and are not remappable. Overridden from rl_opts.keys.
export const DEFAULT_KEYS = {
  up: "w", down: "s", left: "a", right: "d",
  wait: " ", inventory: "i", pause: "p",
  ability1: "q", ability2: "e",
};
export const KEY_ACTIONS = [
  ["up", "Move up"], ["down", "Move down"], ["left", "Move left"],
  ["right", "Move right"], ["wait", "Wait"], ["inventory", "Inventory"],
  ["ability1", "Ability 1"], ["ability2", "Ability 2"], ["pause", "Pause"],
];

// Depth themes: each picks a generation strategy and a tile palette
// ([sheet, col, row]) for floor/wall/stairs. Deeper = later entries.
const THEMES = [
  { name: "the Crypt",       strategy: "rooms", floor: ["dungeon", 8, 2],   wall: ["dungeon", 22, 4], stairs: ["dungeon", 16, 1], tint: "rgba(6,5,12,0.55)" },  // dark masonry
  { name: "the Catacombs",   strategy: "bsp",   floor: ["dungeon", 16, 14], wall: ["dungeon", 16, 7], stairs: ["dungeon", 16, 1], tint: "rgba(10,7,4,0.55)" },  // earthen brick
  { name: "the Caverns",     strategy: "caves", floor: ["dungeon", 16, 12], wall: ["dungeon", 16, 2], stairs: ["dungeon", 16, 1], tint: "rgba(10,6,3,0.55)" },  // rough gray stone
  { name: "the Sunken Depths", strategy: "caves", floor: ["dungeon", 16, 10], wall: ["dungeon", 4, 12], stairs: ["dungeon", 16, 1], tint: "rgba(4,8,14,0.6)" }, // deep water
];
function themeForDepth(depth) {
  return THEMES[Math.min(THEMES.length - 1, Math.floor((depth - 1) / 2))];
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;
    canvas.width = VIEW_W * CELL;
    canvas.height = VIEW_H * CELL;

    this.logEl = document.getElementById("log");
    this.statsEl = document.getElementById("stats");

    this.cam = { x: 0, y: 0 };
    this.busyUntil = 0; // timestamp until which input is locked (tweening)
    this.over = false;
    this.now = 0; // latest rAF timestamp
    this.lastNow = 0; // previous frame timestamp (for dt)
    this.effects = []; // transient visual effects (death fades, damage numbers)
    this.particles = []; // physics-y particle bits
    this.shake = { mag: 0, until: 0, dur: 1 }; // screen-shake state
    this.shakeEnabled = true;
    this.transition = null; // level-change fade state
    this.autoPath = null; // queued click-to-move steps
    this.knownVisible = new Set(); // monsters visible when the walk began
    this.keymap = { ...DEFAULT_KEYS }; // rebindable action keys
    this.paused = false;
    this.reduceFlash = false; // cap screen shake + hit flash (readability)
    this.colorblind = false;  // use a red-green-safe status/heal palette

    // Minimap canvas (optional; absent in minimal HTML).
    this.mini = document.getElementById("minimap");
    if (this.mini) {
      this.miniScale = 3;
      this.mini.width = MAP_W * this.miniScale;
      this.mini.height = MAP_H * this.miniScale;
      this.miniCtx = this.mini.getContext("2d");
    }

    // Offscreen buffer for compositing flipped/tinted actors. Sized 2x2 cells
    // so oversized strip art (32x32 frames) fits; the actor's tile occupies
    // the centre cell, i.e. the buffer is blitted at (sx-CELL/2, sy-CELL/2).
    this.fx = document.createElement("canvas");
    this.fx.width = CELL * 2;
    this.fx.height = CELL * 2;
    this.fxCtx = this.fx.getContext("2d");
    this.fxCtx.imageSmoothingEnabled = false;

    this.bindInput();
    this.bindPointer();
    this.bindDpad();
    this.loop = this.loop.bind(this);
  }

  // ---------------------------------------------------------------- lifecycle
  // `dailyDate` ("YYYY-MM-DD") tags a run as that day's daily challenge.
  start(seed, cls, dailyDate) {
    this.seed = seed !== undefined ? seed >>> 0 : (Math.random() * 0x100000000 >>> 0);
    this.seedDisplay = this.seed.toString(16).padStart(8, "0").toUpperCase();
    this.cls = cls !== undefined ? cls : (this.cls || "warrior");
    this.dailyDate = dailyDate || null;
    this.depth = 0;
    this.mode = "dungeon";    // "dungeon" | "camp" — the camp is a mode, not a depth
    this.campReturnDepth = 0; // depth the camp was entered from (leaveCamp rebuilds it)
    this.campVisits = 0;      // M19-T5 recap stat — count of enterCamp() this run
    this.player = {
      kind: "player",
      // Layered paper-doll: body + leather armor + ginger hair.
      layers: [[0, 0], [11, 7], [23, 0]],
      x: 0, y: 0, rx: 0, ry: 0,
      facing: 1,
      bobPhase: 0,
      flashUntil: 0,
      hp: 30, maxHp: 30,
      baseAtk: 5, baseDef: 1,
      atk: 5, def: 1, // effective (base + equipment), set by recalcStats
      equip: { weapon: null, armor: null, shield: null, ring: null },
      inventory: [],
      level: 1, xp: 0, xpNext: 20,
      gold: 0,
      keys: 0,
      statuses: [],
      cooldowns: {},   // ability id -> turn number when usable again
      alive: true,
    };
    this.applyClass();  // overrides hp/atk/def and adds starting kit
    this.runKills = 0;
    this.runStart = Date.now();
    this.turnCount = 0;       // player turns elapsed (drives ability cooldowns)
    this.braceUntil = -1;     // turn until which Brace halves incoming damage
    this.smokeUntil = -1;     // turn until which Smoke hides the player from foes
    this.lastHitBy = null; // cause of the player's most recent damage
    this.messages = [];
    this.effects = [];
    this.particles = [];
    this.shake = { mag: 0, until: 0, dur: 1 };
    this.transition = null;
    this.autoPath = null;
    this.busyUntil = 0;
    this.over = false;
    this.shopOpen = false;
    // start() runs from a user gesture (button click / R key), so it is a
    // valid place to unlock audio and begin the ambient bed.
    audio.init();
    audio.startAmbient();
    this.log("You descend into the catacombs...", "dim");
    this.nextLevel();
    requestAnimationFrame(this.loop);
  }

  nextLevel() {
    this.depth++;
    this.theme = themeForDepth(this.depth);
    seedRng((this.seed ^ (this.depth * 2654435761)) >>> 0);
    this.dungeon = new Dungeon(MAP_W, MAP_H, this.theme.strategy, this.depth);
    const spawn = this.dungeon.startPos;
    const p = this.player;
    p.x = spawn.x; p.y = spawn.y; p.rx = spawn.x; p.ry = spawn.y;

    const { monsters, items } = populate(this.dungeon, this.depth);
    this.monsters = monsters;
    this.items = items;

    // NPCs: merchant every 3 floors, healer every 4 floors (skipped on boss floors).
    this.isBossFloor = this.depth % 5 === 0;
    this.npcs = [];
    if (!this.isBossFloor) {
      // NPCs are non-walkable, so they must never spawn on a tile that seals
      // off the stairs (tileSafeToBlock); widen the search if the first ring
      // has no safe cell, and skip the NPC entirely rather than block the run.
      const safe = (x, y) => this.tileSafeToBlock(x, y);
      if (this.depth % 3 === 0) {
        const spot = this.findFloorNear(this.dungeon.startPos, 5, safe) ||
          this.findFloorNear(this.dungeon.startPos, 10, safe);
        if (spot) {
          const npc = makeNpc("merchant", spot.x, spot.y);
          npc.wareItems = genWares().map((key) => makeItem(key, 0, 0, this.depth));
          // Merchants appraise their stock: wares are identified and never cursed.
          npc.wareItems.forEach((it) => {
            it.identified = true;
            if (it.cursed) { it.cursed = false; it.malusAtk = 0; it.malusDef = 0; }
          });
          npc.gold = 40 + this.depth * 15; // finite purse for buying from the player
          this.npcs.push(npc);
          this.log("You spot a merchant's lantern nearby.", "gold");
        }
      }
      if (this.depth % 4 === 0) {
        const spot = this.findFloorNear(this.dungeon.stairs, 6, safe) ||
          this.findFloorNear(this.dungeon.startPos, 12, safe);
        if (spot) {
          const npc = makeNpc("healer", spot.x, spot.y);
          this.npcs.push(npc);
          this.log("A healer awaits somewhere on this floor.", "good");
        }
      }
    }

    // Boss floor every 5 depths: spawn a unique guardian near the stairs.
    if (this.isBossFloor) {
      const spot = this.findFloorNear(this.dungeon.stairs, 5) || this.dungeon.stairs;
      this.monsters.push(makeBoss(spot.x, spot.y, this.depth));
      this.log("A mighty presence guards this floor.", "bad");
    }

    // Win artifact on the target depth.
    if (this.depth === WIN_DEPTH) {
      const spot = this.findFloorNear(this.dungeon.stairs, 8) || this.dungeon.startPos;
      this.items.push(makeItem("artifact", spot.x, spot.y, this.depth));
      this.log("An ancient power radiates from somewhere on this floor...", "gold");
    }

    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.centerCamera(true);
    if (this.depth > 1) this.log(`You reach depth ${this.depth}.`, "dim");
    this.updateHud();
  }

  // Apply the chosen class's starting stats, kit, and any active meta unlocks.
  applyClass() {
    const p = this.player;
    const c = CLASSES[this.cls] || CLASSES.warrior;
    p.maxHp = c.hp; p.hp = c.hp;
    p.baseAtk = c.atk; p.baseDef = c.def;

    this.unlocks = getUnlocks();
    const u = this.unlocks;

    const equip = (slot, name, bonus) => ({
      kind: "item", key: slot, category: "equip",
      slot, sprite: slot, name, bonus, x: 0, y: 0,
    });
    const potion = () => ({ kind: "item", key: "potion", category: "consumable",
      sprite: "potion", name: "healing potion", heal: 12, x: 0, y: 0 });

    switch (this.cls) {
      case "warrior":
        p.equip.armor = equip("armor", "chainmail", 2);
        if (u.hardened) { p.maxHp += 5; p.hp += 5; }
        break;
      case "rogue":
        p.equip.weapon = equip("weapon", "short sword", 4);
        break;
      case "mage":
        for (let i = 0; i < (u.archmage ? 4 : 3); i++) p.inventory.push(potion());
        break;
    }
    if (u.veteran) p.inventory.push(potion()); // bonus potion for all classes
    this.recalcStats();
  }

  // Find a free floor cell within `rad` of `pos`. Optional `filter(x,y)` rejects
  // candidates (e.g. tiles that would wall off the stairs).
  findFloorNear(pos, rad, filter = null) {
    const opts = [];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = pos.x + dx, y = pos.y + dy;
        if (x === pos.x && y === pos.y) continue;
        if (this.dungeon.get(x, y) === FLOOR && !this.monsterAt(x, y) &&
            (!filter || filter(x, y))) opts.push({ x, y });
      }
    }
    return opts.length ? opts[Math.floor(rng() * opts.length)] : null;
  }

  // True if a non-walkable blocker (an NPC) may stand on (x,y) without sealing
  // the player away from the down-stairs. BFS from startPos over walkable tiles
  // with (x,y) — and any already-placed NPCs — treated as impassable.
  tileSafeToBlock(x, y) {
    const d = this.dungeon;
    if (!d.inBounds(x, y) || d.get(x, y) !== FLOOR) return false;
    const start = d.startPos, stairs = d.stairs;
    if (!stairs) return true;
    const blocked = new Set([d.idx(x, y)]);
    for (const n of this.npcs) blocked.add(d.idx(n.x, n.y));
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

  // ------------------------------------------------------------------- input
  // Replace the action keymap (e.g. from saved settings); unknown keys keep
  // their defaults.
  setKeymap(map) {
    this.keymap = { ...DEFAULT_KEYS, ...(map || {}) };
  }

  // Resolve a lowercased event.key to an action. Arrow keys are fixed movement
  // fallbacks; everything else comes from the (rebindable) keymap.
  actionForKey(k) {
    if (k === "arrowup") return "up";
    if (k === "arrowdown") return "down";
    if (k === "arrowleft") return "left";
    if (k === "arrowright") return "right";
    for (const [action] of KEY_ACTIONS) if (this.keymap[action] === k) return action;
    return null;
  }

  togglePause() {
    this.paused = !this.paused;
    this.autoPath = null;
    this.log(this.paused ? "Paused." : "Resumed.", "dim");
  }

  // Status / heal colors, swapped for a red-green-safe set in colorblind mode.
  palette(key) {
    const normal = { poison: "#5fbf3a", bleed: "#d8453a", slow: "#7fd4ff", heal: "#6cc04a" };
    const cb     = { poison: "#3a8cff", bleed: "#ff8c1a", slow: "#ffe14d", heal: "#37c0e8" };
    return (this.colorblind ? cb : normal)[key];
  }

  bindInput() {
    window.addEventListener("keydown", (e) => {
      // A settings rebind capture swallows the next key before we see it.
      if (this.captureKey) return;
      const k = e.key.toLowerCase();
      if (k === "r") { e.preventDefault(); this.start(); return; }
      if (this.over || this.shopOpen) return;

      const action = this.actionForKey(k);
      // Pause toggles on its key or Escape, even mid-tween.
      if (k === "escape" || action === "pause") {
        e.preventDefault();
        this.togglePause();
        return;
      }
      if (this.paused) return;

      this.autoPath = null; // any key takes over from click-to-move
      if (action === "inventory") { e.preventDefault(); this.toggleInventory(); return; }
      if (performance.now() < this.busyUntil) return;

      // Hotbar: number keys quaff the Nth carried consumable.
      if (k >= "1" && k <= "9") {
        e.preventDefault();
        this.useConsumableSlot(parseInt(k, 10) - 1);
        return;
      }

      // Class abilities (Q / E by default).
      if (action === "ability1") { e.preventDefault(); this.useAbilitySlot(0); return; }
      if (action === "ability2") { e.preventDefault(); this.useAbilitySlot(1); return; }

      let dx = 0, dy = 0;
      if (action === "up") dy = -1;
      else if (action === "down") dy = 1;
      else if (action === "left") dx = -1;
      else if (action === "right") dx = 1;
      else if (action === "wait") { e.preventDefault(); this.turn(0, 0); return; }
      else return;
      e.preventDefault();
      this.turn(dx, dy);
    });
  }

  // Click / tap a tile: adjacent tiles act immediately (step / attack / shop);
  // farther explored tiles queue a full A* walk that auto-cancels on danger.
  bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.over || this.shopOpen || this.paused || performance.now() < this.busyUntil) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      const tx = Math.floor(cx / CELL + this.cam.x);
      const ty = Math.floor(cy / CELL + this.cam.y);
      const p = this.player;
      const d = this.dungeon;
      this.autoPath = null;
      if (!d.inBounds(tx, ty) || !d.explored[d.idx(tx, ty)]) return;

      const dist = Math.abs(tx - p.x) + Math.abs(ty - p.y);
      if (dist === 0) { this.turn(0, 0); return; } // own tile = wait
      if (dist === 1) { this.turn(tx - p.x, ty - p.y); return; }

      // Only path to somewhere the final turn() can act on: open ground, a
      // locked door / gate, or an occupied tile (monster or NPC).
      const occupied = this.monsterAt(tx, ty) || this.npcAt(tx, ty);
      const tt = d.get(tx, ty);
      if (!d.isWalkable(tx, ty) && tt !== LOCKED && tt !== GATE && !occupied) return;

      // Monsters/NPCs block intermediate steps, and the walk must not trip
      // over the stairs or a shrine in passing; the clicked tile is exempt.
      const blockers = (x, y) =>
        !!(this.monsterAt(x, y) || this.npcAt(x, y)) ||
        d.get(x, y) === STAIRS || d.get(x, y) === SHRINE;
      const path = findPath(d, p.x, p.y, tx, ty, blockers, 2000);
      if (!path || !path.length) return;
      this.autoPath = path;
      // Snapshot current threats: a NEW monster coming into view stops the walk.
      this.knownVisible = new Set(
        this.monsters.filter((m) => m.alive && d.visible[d.idx(m.x, m.y)])
      );
      this.autoStep();
    });
  }

  // On-screen touch d-pad: each button steps once, then repeats while held.
  bindDpad() {
    const pad = document.getElementById("dpad");
    if (!pad) return;
    let timer = null;
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    pad.querySelectorAll("button").forEach((btn) => {
      const dx = parseInt(btn.dataset.dx, 10);
      const dy = parseInt(btn.dataset.dy, 10);
      const step = () => {
        if (this.over || this.shopOpen || this.paused || performance.now() < this.busyUntil) return;
        this.autoPath = null;
        this.turn(dx, dy);
      };
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        stop();
        step();
        timer = setInterval(step, MOVE_MS + 60);
      });
      for (const ev of ["pointerup", "pointerleave", "pointercancel"])
        btn.addEventListener(ev, stop);
    });
  }

  // Advance one queued click-to-move step; stops itself on any surprise.
  autoStep() {
    const p = this.player;
    const step = this.autoPath[0];
    const isLast = this.autoPath.length === 1;
    // Someone wandered onto the route (the clicked tile itself is fair game).
    if (!isLast && (this.monsterAt(step.x, step.y) || this.npcAt(step.x, step.y))) {
      this.autoPath = null;
      return;
    }
    this.autoPath.shift();
    if (!this.autoPath.length) this.autoPath = null;
    this.turn(step.x - p.x, step.y - p.y);
    if (!this.autoPath || this.over) return;
    // Stop when a threat that wasn't visible at click time comes into view.
    for (const m of this.monsters) {
      if (m.alive && this.dungeon.visible[this.dungeon.idx(m.x, m.y)] &&
          !this.knownVisible.has(m)) {
        this.autoPath = null;
        this.log("You stop — something stirs ahead.", "dim");
        return;
      }
    }
  }

  // ----------------------------------------------------------------- turns
  turn(dx, dy) {
    const p = this.player;
    if (dx !== 0 || dy !== 0) {
      if (dx !== 0) p.facing = dx > 0 ? 1 : -1;
      const nx = p.x + dx;
      const ny = p.y + dy;
      const target = this.monsterAt(nx, ny);
      if (target) {
        this.attack(p, target);
      } else if (this.npcAt(nx, ny)) {
        this.openShop(this.npcAt(nx, ny));
        return; // no turn spent — shop UI takes over
      } else if (this.dungeon.get(nx, ny) === LOCKED) {
        if (p.keys > 0) {
          p.keys--;
          this.dungeon.set(nx, ny, FLOOR);
          this.log("You unlock the door.", "good");
          audio.pickup();
          p.x = nx; p.y = ny;
          audio.move();
        } else {
          this.log("The door is locked — you need a key.", "dim");
          return; // no turn spent
        }
      } else if (this.dungeon.get(nx, ny) === GATE) {
        this.log("A heavy portcullis bars the way. A mechanism must open it.", "dim");
        return; // no turn spent
      } else if (this.dungeon.isWalkable(nx, ny)) {
        p.x = nx; p.y = ny;
        audio.move();
        // Water hazard: cold damage on each step.
        if (this.dungeon.get(p.x, p.y) === WATER) {
          this.log("Cold water bites at your feet.", "dim");
          this.damageActor(p, 1, "#5ab4e8", "the freezing water");
          if (this.over) return;
        }
        // Spike trap: hidden until sprung, then it stays visible (and spent).
        const ti = this.dungeon.idx(p.x, p.y);
        if (this.dungeon.traps.has(ti)) {
          this.dungeon.traps.delete(ti);
          this.dungeon.decor[ti] = "spikes";
          this.effects.push({
            type: "obj", strip: "spikes", row: 1, from: 0, to: 7,
            x: p.x, y: p.y, start: this.now, dur: 360,
          });
          const dmg = 2 + Math.floor(rng() * 4);
          this.log(`Click — a spike trap! You take ${dmg} damage.`, "bad");
          audio.hurt();
          this.addShake(4, 150);
          this.damageActor(p, dmg, undefined, "a spike trap");
          if (this.over) return;
        }
      } else {
        return; // bumped a wall: no turn spent
      }
    }

    // Interactable objects: chests and barrels trigger on walk-over.
    const oi = this.dungeon.idx(p.x, p.y);
    if (this.dungeon.objs[oi]) this.useObject(p.x, p.y, this.dungeon.objs[oi]);

    if (this.pickupAt(p.x, p.y)) return;

    if (this.dungeon.get(p.x, p.y) === SHRINE) this.useShrine();

    // Camp campfire: full heal + clear statuses, once per visit (M19-T4).
    if (this.mode === "camp" && this.dungeon.campfire &&
      p.x === this.dungeon.campfire.x && p.y === this.dungeon.campfire.y) {
      this.restAtCampfire();
    }

    if (this.dungeon.get(p.x, p.y) === STAIRS) {
      // The camp's cave mouth is a STAIRS tile, but it leads back down to the
      // depth we left rather than one deeper.
      if (this.mode === "camp") this.leaveCamp();
      else this.beginDescent();
      return;
    }

    if (this.dungeon.get(p.x, p.y) === WAYSTONE) {
      this.enterCamp();
      return;
    }

    this.worldTurn();
    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.startTween();
    this.updateHud();
  }

  // The world's reaction to one player action: monsters act (twice on
  // alternating turns while the player is slowed), then statuses tick.
  worldTurn() {
    const p = this.player;
    this.turnCount++; // drives ability cooldowns
    this.enemyTurn();
    if (p.alive && this.hasStatus(p, "slow")) {
      this.slowTick = !this.slowTick;
      if (this.slowTick) {
        this.log("You move sluggishly — the world surges ahead.", "dim");
        this.enemyTurn();
      }
    }
    if (p.alive) this.tickStatuses(p);
    // Ring of regeneration: slow trickle of HP every few turns.
    if (p.alive && p.regen && p.hp < p.maxHp && this.turnCount % 3 === 0) {
      const h = Math.min(p.maxHp - p.hp, p.regen);
      p.hp += h;
      this.spawnDamage(p.rx, p.ry, `+${h}`, this.palette("heal"));
    }
  }

  startTween() {
    this.busyUntil = performance.now() + MOVE_MS;
  }

  // One-time shrine blessing: full heal plus a small permanent boon.
  useShrine() {
    const p = this.player;
    this.dungeon.set(p.x, p.y, FLOOR);
    if (this.dungeon.shrinePos) this.dungeon.shrinePos = null;
    p.hp = p.maxHp;
    const boon = rng();
    if (boon < 0.34) { p.maxHp += 5; p.hp = p.maxHp; this.log("The shrine blesses you — max HP up!", "gold"); }
    else if (boon < 0.67) { p.baseAtk += 1; this.log("The shrine blesses you — attack up!", "gold"); }
    else { p.baseDef += 1; this.log("The shrine blesses you — defense up!", "gold"); }
    this.recalcStats();
    audio.levelUp();
    this.spawnParticles(p.rx, p.ry, "#7fe6ff", 14, true);
  }

  // Camp campfire rest (M19-T4): full heal + clear statuses, free, once per
  // camp visit — `campRested` is reset in `_swapToCamp`. Mirrors useShrine's
  // log/particles/SFX pattern.
  restAtCampfire() {
    if (this.campRested) return;
    this.campRested = true;
    const p = this.player;
    p.hp = p.maxHp;
    p.statuses = [];
    this.log("The campfire's warmth mends your wounds and clears your ailments.", "good");
    audio.levelUp();
    this.spawnParticles(p.rx, p.ry, "#ff9a3c", 16, true);
    this.updateHud();
  }

  // Kick off a fade-to-black transition. `target()` runs at the midpoint (while
  // the screen is fully dark) so the map swap is never visible. `caption`/`sub`
  // override the fade-in banner, which otherwise names the new depth + theme.
  beginTransition(target, caption = null, sub = null) {
    this.autoPath = null;
    this.busyUntil = Infinity; // lock input for the whole transition
    this.transition = { phase: "out", alpha: 0, duration: 420, target, caption, sub };
    this.transitionStart = this.now;
  }

  beginDescent() {
    this.log("You find a staircase leading deeper.", "good");
    audio.descend();
    this.beginTransition(() => this.nextLevel());
  }

  updateTransition() {
    const tr = this.transition;
    const k = Math.min(1, (this.now - this.transitionStart) / tr.duration);
    tr.alpha = tr.phase === "out" ? k : 1 - k;
    if (k < 1) return;
    if (tr.phase === "out") {
      tr.target(); // swap the map while the screen is black
      tr.phase = "in";
      tr.alpha = 1;
      this.transitionStart = this.now;
    } else {
      this.transition = null;
      this.busyUntil = 0; // unlock input
    }
  }

  // ---------------------------------------------------------------- the camp
  // Retreat from the dungeon to the surface camp (M19). The floor being left is
  // not saved: leaveCamp regenerates it from the run seed, which is what makes
  // the camp cheap — see `nextLevel`'s per-floor `seedRng`.
  enterCamp() {
    if (!this.player || this.over || this.transition || this.mode === "camp")
      return false;
    this.log("The world folds around you — you surface at the camp.", "gold");
    audio.levelUp();
    this.beginTransition(() => this._swapToCamp(), "The Camp", "a haven above the dark");
    return true;
  }

  // Midpoint of the enterCamp fade: swap the dungeon out for the camp map.
  _swapToCamp() {
    this.campReturnDepth = this.depth;
    this.mode = "camp";
    this.theme = CAMP_THEME;
    this.isBossFloor = false;
    this.dungeon = buildCamp();
    this.campVisits = (this.campVisits || 0) + 1; // recap stat, reset in start()
    audio.stopAmbient();
    audio.startAmbient("camp");

    const p = this.player;
    const s = this.dungeon.startPos;
    p.x = s.x; p.y = s.y; p.rx = s.x; p.ry = s.y;

    // Nothing hostile, nothing loose on the ground. `monsters` must stay an
    // array — enemyTurn, the minimap and nearestVisibleMonster all iterate it.
    this.monsters = [];
    this.items = [];

    // The two camp NPCs stand on the path in front of their 2x2 tents (the
    // camp legend places them; the tents themselves are impassable).
    const spots = this.dungeon.npcSpots;
    const merchant = makeNpc("merchant", spots.merchant.x, spots.merchant.y);
    // Camp merchant: bigger stock and purse than a dungeon merchant (M19-T4).
    // Wares are identified and never cursed, same as the dungeon-merchant
    // pattern in nextLevel — a merchant appraises everything it stocks.
    merchant.wareItems = genCampWares().map((key) => makeItem(key, 0, 0, this.campReturnDepth));
    merchant.wareItems.forEach((it) => {
      it.identified = true;
      if (it.cursed) { it.cursed = false; it.malusAtk = 0; it.malusDef = 0; }
    });
    merchant.gold = 200 + this.campReturnDepth * 25;
    this.npcs = [
      merchant,
      makeNpc("healer", spots.healer.x, spots.healer.y),
    ];
    // Campfire rest is usable once per camp visit (M19-T4).
    this.campRested = false;

    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS); // no-op: the camp is fully lit
    this.centerCamera(true);
    this.updateHud();
  }

  // Step into the cave mouth: rebuild the floor we left and drop back onto it.
  leaveCamp() {
    if (this.mode !== "camp" || this.transition) return false;
    this.log("You shoulder your pack and head back below.", "dim");
    audio.descend();
    this.beginTransition(() => {
      this.mode = "dungeon";
      audio.stopAmbient();
      audio.startAmbient("dungeon");
      // nextLevel() increments, so step back one and let it re-derive the floor:
      // it re-seeds from (seed ^ depth * 2654435761), producing the identical
      // layout with fresh monsters and loot, and correctly re-runs the
      // depth-triggered merchant / healer / boss / win-artifact logic.
      this.depth = this.campReturnDepth - 1;
      this.nextLevel();
    });
    return true;
  }

  enemyTurn() {
    const p = this.player;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      this.tickStatuses(m);
      if (!m.alive) continue;
      // Slowed monsters lose every other action.
      if (this.hasStatus(m, "slow")) {
        m.slowTick = !m.slowTick;
        if (m.slowTick) continue;
      }

      const sees = this.dungeon.visible[this.dungeon.idx(m.x, m.y)];
      const dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
      if (!sees || dist > FOV_RADIUS + 2) continue;

      // Rogue's Smoke: non-adjacent foes lose track of the player.
      if (this.turnCount <= this.smokeUntil && dist > 1) continue;

      // Fleeing creatures retreat once badly wounded.
      if (m.flees && m.hp / m.maxHp < 0.3) {
        if (dist === 1 && Math.random() < 0.4) this.attack(m, p); // cornered: bite back
        else this.fleeStep(m, p.x, p.y);
        continue;
      }
      // Ranged casters strike from afar when they have a clear line.
      if (m.ranged && dist > 1 && dist <= m.ranged &&
          this.dungeon.lineOfSight(m.x, m.y, p.x, p.y)) {
        this.rangedAttack(m, p);
        continue;
      }
      if (dist === 1) { this.attack(m, p); continue; }
      this.pathStep(m, p.x, p.y);
    }
    this.monsters = this.monsters.filter((m) => m.alive);
  }

  // A* step toward (tx,ty), avoiding walls, locked doors and other monsters.
  pathStep(m, tx, ty) {
    const blocked = (x, y) => this.monsterAt(x, y) && !(x === m.x && y === m.y);
    const path = findPath(this.dungeon, m.x, m.y, tx, ty, blocked, 400);
    if (!path || !path.length) return;
    const step = path[0];
    if (step.x === tx && step.y === ty) return; // that's the player's tile
    if (step.x !== m.x) m.facing = step.x > m.x ? 1 : -1;
    m.x = step.x; m.y = step.y;
  }

  // Step to the neighbour that maximises distance from the threat.
  fleeStep(m, tx, ty) {
    let best = null, bestD = Math.abs(m.x - tx) + Math.abs(m.y - ty);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = m.x + dx, ny = m.y + dy;
      if (!this.dungeon.isWalkable(nx, ny) || this.monsterAt(nx, ny)) continue;
      if (this.player.x === nx && this.player.y === ny) continue;
      const d = Math.abs(nx - tx) + Math.abs(ny - ty);
      if (d > bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    if (best) {
      if (best.x !== m.x) m.facing = best.x > m.x ? 1 : -1;
      m.x = best.x; m.y = best.y;
    }
  }

  // ---------------------------------------------------------------- combat
  rollDamage(attacker, defender) {
    const raw = attacker.atk - defender.def;
    return Math.max(1, raw + (Math.floor(rng() * 3) - 1));
  }

  attack(attacker, defender) {
    // Visual feedback: attacker lunges at the target; defender flashes white.
    const ldx = Math.sign(defender.x - attacker.x);
    const ldy = Math.sign(defender.y - attacker.y);
    if (ldx !== 0) attacker.facing = ldx;
    attacker.lungeStart = this.now;
    attacker.lungeDx = ldx;
    attacker.lungeDy = ldy;

    if (attacker.kind === "player") audio.swing();
    let dmg = this.rollDamage(attacker, defender);
    if (attacker.kind === "player" && this.cls === "rogue" &&
        rng() < (this.unlocks?.shadowcraft ? 0.4 : 0.3)) {
      dmg *= 2;
      this.log("Backstab!", "good");
    }
    // Ring of precision: a chance to land a heavier blow.
    if (attacker.kind === "player" && this.player.critChance && rng() < this.player.critChance) {
      dmg = Math.round(dmg * 1.5);
      this.log("Critical hit!", "good");
    }
    if (attacker.kind === "player") {
      this.log(`You hit the ${defender.name} for ${dmg}.`, "good");
      audio.hit();
    } else if (defender.kind === "player") {
      this.log(`The ${attacker.name} hits you for ${dmg}.`, "bad");
      audio.hurt();
    }
    this.damageActor(defender, dmg, undefined,
      attacker.kind === "monster" ? `the ${attacker.name}` : undefined);

    // Slimes (and the like) can poison on a connecting hit.
    if (attacker.poisons && defender.alive && rng() < 0.5) {
      this.applyStatus(defender, "poison", 4, 2);
      if (defender.kind === "player") this.log("You are poisoned!", "bad");
    }
    // Blade-wielders (bandits, dread knights) can open a bleeding wound.
    if (attacker.bleeds && defender.alive && rng() < 0.35) {
      this.applyStatus(defender, "bleed", 3, 2);
      if (defender.kind === "player") this.log("The wound bleeds freely!", "bad");
    }
  }

  rangedAttack(caster, target) {
    caster.flashUntil = this.now + 80;
    const dmg = this.rollDamage(caster, target);
    const bolt = caster.bolt || { color: "#b48cff", msg: "hurls a spectral bolt" };
    this.effects.push({
      type: "bolt", color: bolt.color,
      x0: caster.rx + 0.5, y0: caster.ry + 0.5,
      x1: target.rx + 0.5, y1: target.ry + 0.5,
      start: this.now, dur: 220,
    });
    this.log(`The ${caster.name} ${bolt.msg} for ${dmg}.`, "bad");
    audio.hurt();
    this.damageActor(target, dmg, undefined, `the ${caster.name}`);
    // Frost casters chill their victim, costing it every other action.
    if (caster.slows && target.alive && rng() < 0.6) {
      this.applyStatus(target, "slow", 3, 0);
      if (target.kind === "player") this.log("Frost crawls up your legs — you are slowed!", "bad");
    }
  }

  // Apply damage with floating numbers / blood / shake, and resolve death.
  // `cause` (a display string) is recorded as the player's last damage source
  // for the death recap.
  damageActor(target, dmg, color, cause) {
    const isPlayer = target.kind === "player";
    if (isPlayer) {
      this.autoPath = null; // pain interrupts click-to-move
      if (cause) this.lastHitBy = cause;
    }
    if (isPlayer && this.cls === "warrior") dmg = Math.max(1, dmg - 1);
    // Warrior's Brace halves incoming damage until the next turn.
    if (isPlayer && this.turnCount <= this.braceUntil) dmg = Math.max(1, Math.floor(dmg / 2));
    // Ring of warding: flat fraction off all incoming damage.
    if (isPlayer && this.player.resist) dmg = Math.max(1, Math.round(dmg * (1 - this.player.resist)));
    target.hp -= dmg;
    target.flashUntil = this.now + 130;
    this.spawnDamage(target.rx, target.ry, dmg, color || (isPlayer ? "#ff6b5e" : "#ffe6a8"));
    this.spawnParticles(target.rx, target.ry, isPlayer ? "#c0392b" : "#8a1f1f", 8);
    if (isPlayer) this.addShake(Math.min(9, 2 + dmg * 0.6), 200);
    if (target.hp <= 0) {
      if (isPlayer) this.die();
      else this.killMonster(target);
    }
  }

  killMonster(m) {
    if (!m.alive) return;
    m.alive = false;
    this.runKills++;
    this.log(`The ${m.name} dies.`, "dim");
    audio.enemyDie();
    this.effects.push({
      type: "death", layers: m.layers, strip: m.strip,
      x: m.rx, y: m.ry, facing: m.facing,
      start: this.now, dur: 420,
    });
    this.spawnParticles(m.rx, m.ry, "#8a1f1f", 12);
    this.gainXp(m.xp);
  }

  // ----------------------------------------------------------- status effects
  applyStatus(actor, type, turns, power) {
    const existing = actor.statuses.find((s) => s.type === type);
    if (existing) { existing.turns = Math.max(existing.turns, turns); existing.power = Math.max(existing.power, power); }
    else actor.statuses.push({ type, turns, power });
  }

  tickStatuses(actor) {
    if (!actor.statuses || !actor.statuses.length) return;
    for (const s of actor.statuses) {
      if (s.type === "poison" || s.type === "bleed") {
        this.damageActor(actor, s.power, this.palette(s.type),
          s.type === "poison" ? "festering poison" : "bleeding out");
        if (!actor.alive) return;
      }
      s.turns--;
    }
    actor.statuses = actor.statuses.filter((s) => s.turns > 0);
  }

  hasStatus(actor, type) {
    return actor.statuses && actor.statuses.some((s) => s.type === type);
  }

  gainXp(amount) {
    const p = this.player;
    p.xp += amount;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = Math.floor(p.xpNext * 1.5);
      p.maxHp += 6;
      p.hp = p.maxHp;
      p.baseAtk += 1;
      if (p.level % 3 === 0) p.baseDef += 1;
      this.log(`You reach level ${p.level}! You feel stronger.`, "gold");
      audio.levelUp();
    }
    this.recalcStats();
  }

  // Assemble the run record saved to history and shown in the recap.
  buildRun(won) {
    const p = this.player;
    return {
      depth: this.depth, level: p.level, gold: p.gold, won,
      cls: this.cls, kills: this.runKills,
      cause: won ? null : (this.lastHitBy || "the dark"),
      seed: this.seedDisplay,
      ms: Date.now() - this.runStart,
      daily: this.dailyDate || null,
      campVisits: this.campVisits || 0,
    };
  }

  die() {
    if (this.over) return;
    const p = this.player;
    p.alive = false;
    this.over = true;
    this.log("You have fallen in the dark.", "bad");
    audio.playerDie();
    this.addShake(11, 450);
    const prev = getBest();
    const run = this.buildRun(false);
    saveRun(run);
    updateMeta(this.depth, this.runKills, false);
    const isPB = !prev || run.depth > prev.depth ||
      (run.depth === prev.depth && run.gold > prev.gold);
    showOverlay(
      "You Died",
      `Slain by ${run.cause} on depth ${run.depth}.${isPB ? " A new personal best!" : ""}`,
      "Try Again",
      () => this.start()
    );
    this.renderRecap(run, prev, isPB);
  }

  showWin() {
    if (this.over) return;
    this.over = true;
    this.log("You have recovered the Forgotten Relic! You escape into legend.", "gold");
    const prev = getBest();
    const run = this.buildRun(true);
    saveRun(run);
    updateMeta(this.depth, this.runKills, true);
    showOverlay(
      "Victory!",
      `You recovered the Forgotten Relic and escaped into legend.`,
      "Play Again",
      () => this.start()
    );
    this.renderRecap(run, prev, false);
  }

  // Populate the overlay's recap panel: this run's stats plus recent history.
  renderRecap(run, prev, isPB) {
    const el = document.getElementById("overlay-recap");
    if (!el) return;
    const mm = Math.floor(run.ms / 60000);
    const ss = Math.floor((run.ms % 60000) / 1000);
    const dur = `${mm}:${ss.toString().padStart(2, "0")}`;
    const clsName = CLASSES[run.cls]?.name || run.cls;

    const stat = (label, value) =>
      `<div class="recap-stat"><span>${label}</span><b>${value}</b></div>`;
    let html = run.daily
      ? `<div class="recap-daily">⚑ Daily Challenge · ${run.daily}</div>` : "";
    html += `<div class="recap-grid">` +
      stat("Class", clsName) +
      stat("Depth", run.depth) +
      stat("Level", run.level) +
      stat("Gold", run.gold) +
      stat("Kills", run.kills) +
      stat("Time", dur) +
      stat("Camp visits", run.campVisits || 0) +
      `</div>` +
      `<div class="recap-seed">Seed ${run.seed}` +
      (prev && !isPB ? ` · best depth ${prev.depth}, Lv ${prev.level}` : "") +
      `</div>`;

    // Recent runs (skip the one we just saved, which is index 0).
    const hist = getHistory().slice(1, 6);
    if (hist.length) {
      html += `<div class="recap-head">Recent runs</div><div class="recap-runs">`;
      for (const h of hist) {
        const tag = h.won ? "win" : "loss";
        const mark = h.won ? "★" : "✝";
        html += `<div class="recap-run ${tag}"><span>${mark} ${CLASSES[h.cls]?.name || h.cls || "?"}</span>` +
          `<span>depth ${h.depth} · Lv ${h.level} · ${h.gold}g</span></div>`;
      }
      html += `</div>`;
    }
    el.innerHTML = html;
    el.classList.remove("hidden");
  }

  // ------------------------------------------------------------------ items
  pickupAt(x, y) {
    const idx = this.items.findIndex((it) => it.x === x && it.y === y);
    if (idx < 0) return false;
    const it = this.items[idx];
    const p = this.player;

    if (it.category === "artifact") {
      this.items.splice(idx, 1);
      audio.levelUp();
      this.spawnParticles(p.rx, p.ry, "#ffd700", 24, true);
      this.showWin();
      return true;
    }

    switch (it.category) {
      case "gold":
        p.gold += it.amount;
        this.log(it.key === "amulet"
          ? `A glittering amulet! Worth ${it.amount} gold.`
          : `You pick up ${it.amount} gold.`, "gold");
        break;
      case "key":
        p.keys++;
        this.log("You pick up an iron key.", "gold");
        break;
      case "consumable":
        p.inventory.push(it);
        this.log(`You pick up a ${it.name}.`, "good");
        break;
      case "wand":
        p.inventory.push(it);
        this.log(it.identified === false
          ? `You pick up ${this.displayName(it)}.`
          : `You pick up a ${it.name} (${it.charges} charges).`, "good");
        break;
      case "equip":
        p.inventory.push(it);
        this.log(it.identified === false
          ? `You pick up ${this.displayName(it)}.`
          : `You pick up a ${it.name} (${this.gearMeta(it)}).`, "good");
        this.tryAutoEquip(it);
        break;
    }
    audio.pickup();
    this.spawnParticles(p.rx, p.ry, "#ffcf6b", 10, true);
    this.items.splice(idx, 1);
    return false;
  }

  // ---------------------------------------------------------- equipment
  recalcStats() {
    const p = this.player;
    const e = p.equip;
    // M14: cursed gear drags a secondary stat while worn.
    let malusAtk = 0, malusDef = 0;
    for (const s of ["weapon", "armor", "shield", "ring"]) {
      const g = e[s];
      if (g && g.cursed) { malusAtk += g.malusAtk || 0; malusDef += g.malusDef || 0; }
    }
    p.atk = Math.max(1, p.baseAtk + (e.weapon ? e.weapon.bonus : 0) - malusAtk);
    p.def = Math.max(0, p.baseDef + (e.armor ? e.armor.bonus : 0) + (e.shield ? e.shield.bonus : 0) - malusDef);
    // Ring passives (M13): regen HP/3turns, crit chance, incoming-damage resist.
    const r = e.ring;
    p.regen = r && r.affix === "regen" ? r.power : 0;
    p.critChance = r && r.affix === "crit" ? r.power / 100 : 0;
    p.resist = r && r.affix === "resist" ? r.power / 100 : 0;
    if (this.statsEl) this.updateHud();
  }

  // Obscured name for an unidentified item; its real name once known (M14).
  displayName(it) {
    if (it.identified === false) {
      switch (it.slot || it.category) {
        case "weapon": return "an unknown weapon";
        case "armor":  return "unidentified armor";
        case "shield": return "an unmarked shield";
        case "ring":   return "a glowing ring";
        default:       return it.category === "wand" ? "an unmarked wand" : "an unknown item";
      }
    }
    return it.name;
  }

  // Name with an article for log lines ("a healing potion" / "an unknown weapon").
  itemPhrase(it) {
    return it.identified === false ? this.displayName(it) : `a ${it.name}`;
  }

  // Reveal an unidentified item. Returns true if it was previously unknown.
  identify(it) {
    if (it.identified === false) { it.identified = true; return true; }
    return false;
  }

  // Display string for a gear piece's effect (rings carry an affix description).
  gearMeta(it) {
    if (it.slot === "ring") return it.desc || "ring";
    let s = `+${it.bonus} ${it.slot === "weapon" ? "ATK" : "DEF"}`;
    if (it.malusAtk) s += `, −${it.malusAtk} ATK`;
    if (it.malusDef) s += `, −${it.malusDef} DEF`;
    return s;
  }

  tryAutoEquip(it) {
    if (it.identified === false) return;       // don't auto-equip unknown gear (might be cursed)
    const cur = this.player.equip[it.slot];
    if (cur && cur.cursed) return;             // a cursed piece can't be swapped out
    if (!cur || it.bonus > cur.bonus) this.equipItem(it);
  }

  equipItem(it) {
    const p = this.player;
    const cur = p.equip[it.slot];
    // M14: cursed gear refuses to come off until cleansed.
    if (cur && cur.cursed) {
      this.log(`The ${cur.name} is cursed — it won't come off!`, "bad");
      return;
    }
    this.identify(it); // wearing it reveals what it is
    p.inventory = p.inventory.filter((x) => x !== it);
    if (cur) p.inventory.push(cur);
    p.equip[it.slot] = it;
    this.log(`You equip the ${it.name}.`, "good");
    if (it.cursed) {
      this.log(`A malevolent force binds the ${it.name} to you — it's cursed!`, "bad");
      this.spawnParticles(p.rx, p.ry, "#8a1f5a", 14, true);
      audio.hurt();
    }
    this.recalcStats();
    this.renderInventory();
  }

  // Strip the curse flag + stat malus from every cursed worn item. Shared by
  // the uncurse scroll and the camp healer's "Lift curses" service (M19-T4).
  // Returns the worn pieces that were cleansed (empty array if none were cursed).
  removeCurses() {
    const p = this.player;
    const worn = ["weapon", "armor", "shield", "ring"].map((s) => p.equip[s]);
    const cursed = worn.filter((g) => g && g.cursed);
    cursed.forEach((g) => { g.cursed = false; g.malusAtk = 0; g.malusDef = 0; });
    if (cursed.length) this.recalcStats();
    return cursed;
  }

  // Quaff a potion or read a scroll. Returns true if it fired (consumes a turn);
  // a scroll that can't take effect (e.g. enchant with no gear) returns false.
  useConsumable(it) {
    const p = this.player;
    if (it.key === "scroll") {
      if (!this.useScroll(it)) return false; // fizzled — keep the scroll, no turn
    } else if (it.key === "potion") {
      const heal = this.cls === "mage" ? p.maxHp - p.hp : Math.min(p.maxHp - p.hp, it.heal);
      p.hp += heal;
      this.log(`You quaff a ${it.name} and recover ${heal} HP.`, "good");
      audio.potion();
      this.spawnDamage(p.rx, p.ry, `+${heal}`, this.palette("heal"));
      this.spawnParticles(p.rx, p.ry, this.palette("heal"), 8, true);
    }
    p.inventory = p.inventory.filter((x) => x !== it);
    this.renderInventory();
    return true;
  }

  // Resolve a scroll's effect. Returns false (no consume, no turn) if it can't
  // take effect right now.
  useScroll(it) {
    const p = this.player, d = this.dungeon;
    if (it.scroll === "teleport") {
      const spots = d.floors.filter((c) =>
        !(c.x === p.x && c.y === p.y) && !this.monsterAt(c.x, c.y) && !this.npcAt(c.x, c.y));
      if (!spots.length) { this.log("The scroll of teleport fizzles.", "dim"); return false; }
      const dst = spots[Math.floor(rng() * spots.length)];
      this.spawnParticles(p.rx, p.ry, "#b48cff", 16, true);
      p.x = dst.x; p.y = dst.y; p.rx = dst.x; p.ry = dst.y;
      this.autoPath = null;
      this.centerCamera(true);
      this.spawnParticles(p.rx, p.ry, "#b48cff", 16, true);
      this.log("The scroll of teleport whisks you away!", "good");
      audio.descend();
      return true;
    }
    if (it.scroll === "map") {
      d.explored.fill(true);
      this.log("The floor's layout floods into your mind.", "good");
      audio.levelUp();
      return true;
    }
    if (it.scroll === "enchant") {
      const gear = ["weapon", "armor", "shield", "ring"].map((s) => p.equip[s]).filter(Boolean);
      if (!gear.length) { this.log("You have nothing equipped to enchant.", "dim"); return false; }
      const target = gear[Math.floor(rng() * gear.length)];
      if (target.slot === "ring") {
        target.power += target.affix === "regen" ? 1 : 5;
        target.desc = ringDesc(target.affix, target.power);
      } else {
        target.bonus += 1;
        if (!/^enchanted /.test(target.name)) target.name = "enchanted " + target.name;
      }
      this.recalcStats();
      this.log(`Your ${target.name} glows with new power!`, "gold");
      audio.levelUp();
      this.spawnParticles(p.rx, p.ry, "#7fe6ff", 14, true);
      return true;
    }
    if (it.scroll === "identify") {
      const unknown = p.inventory.filter((x) => x.identified === false);
      if (!unknown.length) { this.log("You have nothing left to identify.", "dim"); return false; }
      unknown.forEach((x) => { x.identified = true; });
      this.log(`The scroll reveals: ${unknown.map((x) => x.name).join(", ")}.`, "good");
      audio.levelUp();
      this.renderInventory();
      return true;
    }
    if (it.scroll === "uncurse") {
      const cursed = this.removeCurses();
      if (!cursed.length) { this.log("There is no curse to lift.", "dim"); return false; }
      this.log("A wave of cleansing light breaks the curse.", "good");
      audio.levelUp();
      this.spawnParticles(p.rx, p.ry, "#fff0a0", 16, true);
      this.renderInventory();
      return true;
    }
    if (it.scroll === "return") {
      // enterCamp() itself no-ops (returns false) while already in camp, mid-
      // transition, dead, etc. — mirror that here so the scroll isn't spent.
      if (!this.enterCamp()) {
        this.log("You are already at the camp — the scroll fizzles.", "dim");
        return false;
      }
      return true;
    }
    return false;
  }

  // Fire a wand at the nearest visible foe; depletes a charge, crumbles at 0.
  // Returns false (no turn) when there is no valid target.
  useWand(it) {
    const p = this.player;
    if (it.charges <= 0) return false;
    const target = this.nearestVisibleMonster(it.range || 6, true);
    if (!target) { this.log(`No clear target for your ${this.displayName(it)}.`, "dim"); return false; }
    this.identify(it); // firing reveals what the wand is
    p.facing = target.x >= p.x ? 1 : -1;
    const color = it.boltColor || "#b48cff";
    this.effects.push({
      type: "bolt", color,
      x0: p.rx + 0.5, y0: p.ry + 0.5, x1: target.rx + 0.5, y1: target.ry + 0.5,
      start: this.now, dur: 200,
    });
    const dmg = this.rollDamage(p, target) + (it.power || 4);
    this.log(`Your ${it.name} blasts the ${target.name} for ${dmg}.`, "good");
    audio.hit();
    this.damageActor(target, dmg);
    this.spawnParticles(target.rx, target.ry, color, 10);
    if (it.wand === "frost" && target.alive) {
      this.applyStatus(target, "slow", 3, 0);
    }
    it.charges--;
    if (it.charges <= 0) {
      this.player.inventory = this.player.inventory.filter((x) => x !== it);
      this.log(`Your ${it.name} crumbles to dust.`, "dim");
    }
    this.renderInventory();
    return true;
  }

  // Items usable from the hotbar / inventory panel (consumables + wands).
  usableItems() {
    return this.player.inventory.filter((it) =>
      it.category === "consumable" || it.category === "wand");
  }

  // Dispatch a usable item by category. Returns true if it consumed the action.
  useInventoryItem(it) {
    return it.category === "wand" ? this.useWand(it) : this.useConsumable(it);
  }

  // Use the Nth hotbar item (keys 1-9). Costs a turn only if it fires.
  useConsumableSlot(n) {
    const it = this.usableItems()[n];
    if (!it) return;
    if (this.useInventoryItem(it)) this.afterAction();
  }

  // Run the world's reaction to a non-move player action (item use).
  afterAction() {
    if (this.over) return;
    this.worldTurn();
    this.dungeon.computeFov(this.player.x, this.player.y, FOV_RADIUS);
    this.startTween();
    this.updateHud();
  }

  // ----------------------------------------------------------- abilities
  // Alive monsters orthogonally adjacent to the player.
  adjacentMonsters() {
    const p = this.player, out = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const m = this.monsterAt(p.x + dx, p.y + dy);
      if (m) out.push(m);
    }
    return out;
  }

  // Nearest visible alive monster within `range` (Manhattan); optionally needs
  // line of sight.
  nearestVisibleMonster(range, requireLos = false) {
    const p = this.player, d = this.dungeon;
    let best = null, bd = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
      if (dist > range) continue;
      if (!d.visible[d.idx(m.x, m.y)]) continue;
      if (requireLos && !d.lineOfSight(p.x, p.y, m.x, m.y)) continue;
      if (dist < bd) { bd = dist; best = m; }
    }
    return best;
  }

  // Use the ability in class slot n (0 = Q, 1 = E). Costs a turn + cooldown
  // only if it actually fires (abilities needing a target can no-op).
  useAbilitySlot(n) {
    if (this.over || this.shopOpen || this.paused) return;
    if (performance.now() < this.busyUntil) return;
    const cls = CLASSES[this.cls];
    const ability = cls && cls.abilities && cls.abilities[n];
    if (!ability) return;
    const ready = this.player.cooldowns[ability.id] || 0;
    if (this.turnCount < ready) {
      const left = ready - this.turnCount;
      this.log(`${ability.name} is recharging (${left} turn${left > 1 ? "s" : ""}).`, "dim");
      return;
    }
    this.autoPath = null;
    if (!this.useAbility(ability)) return; // couldn't fire — no turn, no cooldown
    this.player.cooldowns[ability.id] = this.turnCount + ability.cd + 1;
    this.afterAction();
  }

  // Dispatch an ability by id. Returns true if it fired (consumes a turn).
  useAbility(ability) {
    const p = this.player;
    switch (ability.id) {
      case "cleave": {
        const targets = this.adjacentMonsters();
        if (!targets.length) { this.log("No foe within reach to cleave.", "dim"); return false; }
        this.log("You sweep your weapon in a wide arc!", "good");
        audio.swing();
        this.addShake(3, 150);
        for (const m of targets) this.attack(p, m);
        return true;
      }
      case "brace": {
        this.braceUntil = this.turnCount + 1; // covers the coming enemy turn
        this.log("You raise your guard, bracing for impact.", "good");
        audio.swing();
        this.spawnParticles(p.rx, p.ry, "#9aa6b8", 8, true);
        return true;
      }
      case "dash": {
        const target = this.nearestVisibleMonster(ability.range);
        if (!target) { this.log("No foe in sight to dash to.", "dim"); return false; }
        const spots = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = target.x + dx, y = target.y + dy;
          if (this.dungeon.isWalkable(x, y) && !this.monsterAt(x, y) && !this.npcAt(x, y))
            spots.push({ x, y });
        }
        if (!spots.length) { this.log("No room to dash beside your quarry.", "dim"); return false; }
        spots.sort((a, b) =>
          (Math.abs(a.x - p.x) + Math.abs(a.y - p.y)) - (Math.abs(b.x - p.x) + Math.abs(b.y - p.y)));
        const dest = spots[0];
        this.spawnParticles(p.rx, p.ry, "#cfcfe6", 12);
        p.x = dest.x; p.y = dest.y; p.rx = dest.x; p.ry = dest.y; // blink (no tween)
        if (dest.x !== target.x) p.facing = target.x > dest.x ? 1 : -1;
        this.log("You dash through the shadows!", "good");
        audio.swing();
        const dmg = this.rollDamage(p, target) * 2;
        this.log(`Backstab! You hit the ${target.name} for ${dmg}.`, "good");
        audio.hit();
        this.damageActor(target, dmg);
        return true;
      }
      case "smoke": {
        this.smokeUntil = this.turnCount + 3;
        this.log("You vanish in a cloud of smoke.", "good");
        audio.descend();
        this.spawnParticles(p.rx, p.ry, "#b8b8c8", 22, true);
        return true;
      }
      case "firebolt": {
        const target = this.nearestVisibleMonster(ability.range, true);
        if (!target) { this.log("No clear target for your firebolt.", "dim"); return false; }
        p.facing = target.x >= p.x ? 1 : -1;
        this.effects.push({
          type: "bolt", color: "#ff8c2a",
          x0: p.rx + 0.5, y0: p.ry + 0.5, x1: target.rx + 0.5, y1: target.ry + 0.5,
          start: this.now, dur: 200,
        });
        const dmg = this.rollDamage(p, target) + 4; // fire bonus
        this.log(`Your firebolt scorches the ${target.name} for ${dmg}.`, "good");
        audio.hit();
        this.damageActor(target, dmg);
        this.spawnParticles(target.rx, target.ry, "#ff8c2a", 10);
        return true;
      }
      case "frostnova": {
        const targets = this.adjacentMonsters();
        if (!targets.length) { this.log("No foe close enough to freeze.", "dim"); return false; }
        this.log("You unleash a burst of frost!", "good");
        audio.potion();
        this.addShake(2, 150);
        for (const m of targets) {
          this.applyStatus(m, "slow", 3, 0);
          this.damageActor(m, Math.max(1, this.rollDamage(p, m) - 1), this.palette("slow"));
        }
        this.spawnParticles(p.rx, p.ry, this.palette("slow"), 16);
        return true;
      }
      default:
        return false;
    }
  }

  // ----------------------------------------------------------- inventory UI
  toggleInventory() {
    const panel = document.getElementById("inventory-panel");
    if (!panel) return;
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) this.renderInventory();
  }

  renderInventory() {
    const panel = document.getElementById("inventory-panel");
    if (!panel || panel.classList.contains("hidden")) return;
    const p = this.player;

    const slotRow = (slot) => {
      const it = p.equip[slot];
      const label = slot[0].toUpperCase() + slot.slice(1);
      const cls = it && it.cursed ? "inv-name cursed" : "inv-name";
      const curse = it && it.cursed ? ` <em class="curse">cursed</em>` : "";
      return `<div class="inv-row"><span class="inv-slot">${label}</span>` +
        `<span class="${cls}">${it ? `${it.name} <em>(${this.gearMeta(it)})</em>${curse}` : "—"}</span></div>`;
    };
    document.getElementById("inv-equipped").innerHTML =
      `<div class="inv-head">Equipped</div>${slotRow("weapon")}${slotRow("armor")}${slotRow("shield")}${slotRow("ring")}`;

    const carriedEl = document.getElementById("inv-carried");
    if (!p.inventory.length) {
      carriedEl.innerHTML = `<div class="inv-head">Carried</div><div class="inv-empty">empty</div>`;
      return;
    }
    const usable = this.usableItems();
    carriedEl.innerHTML = `<div class="inv-head">Carried</div>`;
    p.inventory.forEach((it) => {
      const row = document.createElement("div");
      row.className = "inv-row";
      let meta = "";
      const known = it.identified !== false;
      if (known) {
        if (it.category === "equip") meta = ` <em>(${this.gearMeta(it)})</em>`;
        else if (it.category === "wand") meta = ` <em>(${it.charges} charges)</em>`;
      }
      // Once identified, flag a cursed piece so the player can avoid equipping it.
      const cursed = known && it.cursed;
      if (cursed) meta += ` <em class="curse">cursed</em>`;
      const btn = document.createElement("button");
      if (it.category === "equip") {
        btn.textContent = "Equip";
        btn.onclick = () => this.equipItem(it);
      } else {
        const n = usable.indexOf(it);
        btn.textContent = n >= 0 && n < 9 ? `Use [${n + 1}]` : "Use";
        btn.onclick = () => { if (this.useInventoryItem(it)) this.afterAction(); };
      }
      row.innerHTML = `<span class="inv-name${cursed ? " cursed" : ""}">${this.displayName(it)}${meta}</span>`;
      row.appendChild(btn);
      carriedEl.appendChild(row);
    });
  }

  // --------------------------------------------------------------- helpers
  monsterAt(x, y) {
    return this.monsters.find((m) => m.alive && m.x === x && m.y === y);
  }

  log(text, cls = "") {
    this.messages.unshift({ text, cls });
    if (this.messages.length > 40) this.messages.pop();
    this.renderLog();
  }

  renderLog() {
    this.logEl.innerHTML = this.messages
      .map((m) => `<div class="msg ${m.cls}">${m.text}</div>`)
      .join("");
  }

  updateHud() {
    const p = this.player;
    const hpPct = Math.max(0, (p.hp / p.maxHp) * 100);
    const xpPct = (p.xp / p.xpNext) * 100;

    // Ability cooldown chips (key + name + ● ready / N turns left).
    const keyLabel = (k) => k === " " ? "Spc" : (k || "?").toUpperCase();
    const abilities = CLASSES[this.cls]?.abilities || [];
    const abilityHud = abilities.map((a, i) => {
      const key = keyLabel(this.keymap[i === 0 ? "ability1" : "ability2"]);
      const left = (p.cooldowns[a.id] || 0) - this.turnCount;
      const ready = left <= 0;
      return `<span class="stat ability ${ready ? "ready" : "cooling"}">` +
        `<em>${key}</em> ${a.short} ${ready ? "●" : left}</span>`;
    }).join("");

    this.statsEl.innerHTML = `
      <span class="stat bar">HP
        <span class="track"><span class="fill hp" style="width:${hpPct}%"></span></span>
        <b>${Math.max(0, p.hp)}/${p.maxHp}</b></span>
      <span class="stat bar">XP
        <span class="track"><span class="fill xp" style="width:${xpPct}%"></span></span></span>
      <span class="stat">Lv <b>${p.level}</b></span>
      <span class="stat cls-${this.cls}">${CLASSES[this.cls]?.name || ""}</span>
      <span class="stat">ATK <b>${p.atk}</b></span>
      <span class="stat">DEF <b>${p.def}</b></span>
      <span class="stat">Gold <b>${p.gold}</b></span>
      ${p.keys > 0 ? `<span class="stat">Keys <b>${p.keys}</b></span>` : ""}
      <span class="stat">Depth <b>${this.depth}</b></span>
      ${abilityHud}
      ${p.statuses.map((s) => `<span class="stat status-${s.type}">${s.type} <b>${s.turns}</b></span>`).join("")}`;
  }

  // ---------------------------------------------------------------- render
  centerCamera(snap) {
    const p = this.player;
    const d = this.dungeon;
    let cx = p.rx - (VIEW_W - 1) / 2;
    let cy = p.ry - (VIEW_H - 1) / 2;
    // Clamp to the current map, not MAP_W/MAP_H — the camp is smaller.
    cx = Math.max(0, Math.min(d.w - VIEW_W, cx));
    cy = Math.max(0, Math.min(d.h - VIEW_H, cy));
    if (snap) { this.cam.x = cx; this.cam.y = cy; }
    else {
      this.cam.x += (cx - this.cam.x) * 0.25;
      this.cam.y += (cy - this.cam.y) * 0.25;
    }
  }

  tweenActor(a, t) {
    a.rx += (a.x - a.rx) * t;
    a.ry += (a.y - a.ry) * t;
    if (Math.abs(a.x - a.rx) < 0.01) a.rx = a.x;
    if (Math.abs(a.y - a.ry) < 0.01) a.ry = a.y;
  }

  loop(now) {
    this.now = now;
    const dt = Math.min(0.05, (now - this.lastNow) / 1000) || 0;
    this.lastNow = now;
    // Paused: freeze the world (no tweens / turns / effects), just show it.
    if (this.paused) {
      this.render();
      this.drawPauseOverlay();
      if (this.miniCtx) this.renderMinimap();
      requestAnimationFrame(this.loop);
      return;
    }
    if (this.transition) this.updateTransition();
    // Tween render positions toward logical positions.
    const t = 0.35;
    this.tweenActor(this.player, t);
    for (const m of this.monsters) this.tweenActor(m, t);
    if (this.npcs) for (const n of this.npcs) this.tweenActor(n, t);
    if (this.effects.length)
      this.effects = this.effects.filter((e) => now - e.start < e.dur);
    if (this.particles.length) this.updateParticles(dt);
    // Click-to-move: take the next queued step once the previous tween ends.
    if (this.autoPath && !this.over && !this.shopOpen && !this.transition &&
        now >= this.busyUntil) {
      this.autoStep();
    }
    this.centerCamera(false);
    this.render();
    if (this.miniCtx) this.renderMinimap();
    requestAnimationFrame(this.loop);
  }

  // Dim the screen and show a "Paused" banner over the frozen world.
  drawPauseOverlay() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.save();
    ctx.fillStyle = "rgba(6,5,12,0.6)";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#e8e4d8";
    ctx.font = "bold 34px 'Trebuchet MS', system-ui, sans-serif";
    ctx.fillText("Paused", w / 2, h / 2 - 10);
    ctx.fillStyle = "#8a86a0";
    ctx.font = "15px 'Trebuchet MS', system-ui, sans-serif";
    const key = this.keymap.pause === " " ? "Space" : (this.keymap.pause || "P").toUpperCase();
    ctx.fillText(`Press ${key} or Esc to resume`, w / 2, h / 2 + 22);
    ctx.restore();
  }

  // ------------------------------------------------------- effects / juice
  spawnDamage(rx, ry, text, color) {
    this.effects.push({
      type: "float", text: String(text), color,
      x: rx + 0.5, y: ry, start: this.now, dur: 720, rise: 20,
    });
  }

  spawnParticles(rx, ry, color, count, up = false) {
    for (let i = 0; i < count; i++) {
      const ang = up
        ? -Math.PI / 2 + (Math.random() - 0.5) * 1.3
        : Math.random() * Math.PI * 2;
      const spd = 0.6 + Math.random() * 2.0; // tiles/second
      this.particles.push({
        x: rx + 0.5, y: ry + 0.5,
        vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - (up ? 1.2 : 0),
        life: 0, maxLife: 0.32 + Math.random() * 0.3,
        grav: up ? 2.5 : 4.0,
        size: 2 + Math.random() * 2,
        color,
      });
    }
  }

  addShake(mag, dur) {
    if (!this.shakeEnabled) return;
    if (this.reduceFlash) mag = Math.min(mag, 2.5); // gentler shake
    this.shake = { mag: Math.max(this.shake.mag, mag), until: this.now + dur, dur };
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.life += dt;
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
  }

  render() {
    const ctx = this.ctx;
    const d = this.dungeon;
    if (this.mode === "camp") {
      // Dusk sky for any out-of-bounds edge the camera's overdraw margin
      // exposes around the camp map, instead of the dungeon's void black.
      const grd = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
      grd.addColorStop(0, "#2c3f6b");
      grd.addColorStop(0.55, "#8a5d82");
      grd.addColorStop(1, "#d98a52");
      ctx.fillStyle = grd;
    } else {
      ctx.fillStyle = "#06050c";
    }
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const camX = this.cam.x;
    const camY = this.cam.y;
    const x0 = Math.floor(camX);
    const y0 = Math.floor(camY);

    // --- screen shake (offsets everything in the world layer) ---
    ctx.save();
    if (this.now < this.shake.until) {
      const k = (this.shake.until - this.now) / this.shake.dur;
      const m = this.shake.mag * k;
      ctx.translate(
        Math.round((Math.random() * 2 - 1) * m),
        Math.round((Math.random() * 2 - 1) * m)
      );
    }

    // --- terrain ---
    for (let vy = -1; vy <= VIEW_H; vy++) {
      for (let vx = -1; vx <= VIEW_W; vx++) {
        const mx = x0 + vx;
        const my = y0 + vy;
        if (!d.inBounds(mx, my)) continue;
        const i = d.idx(mx, my);
        if (!d.explored[i]) continue;

        const sx = Math.round((mx - camX) * CELL);
        const sy = Math.round((my - camY) * CELL);
        const tile = d.tiles[i];

        const theme = this.theme;
        if (tile === WALL) {
          drawSprite(ctx, theme.wall, sx, sy, CELL);
          // Camp trees/fences are decor drawn over the ground sprite; dungeon
          // walls never carry decor, so this is a no-op underground.
          const dec = d.decor[i];
          if (dec) drawSprite(ctx, SPR[dec], sx, sy, CELL);
        } else if (tile === LOCKED) {
          drawSprite(ctx, theme.floor, sx, sy, CELL);
          drawSprite(ctx, SPR.door, sx, sy, CELL);
          this.drawLock(sx, sy);
        } else if (tile === GATE) {
          drawSprite(ctx, theme.floor, sx, sy, CELL);
          drawFrame(ctx, "gate", 0, 0, sx - CELL / 2, sy - CELL / 2, 2);
        } else {
          drawSprite(ctx, theme.floor, sx, sy, CELL);
          if (tile === WATER) this.drawWaterOverlay(sx, sy);
          const dec = d.decor[i];
          if (dec) {
            if (dec === "torch") this.drawTorch(sx, sy);
            else if (dec === "brazier") {
              const f = Math.floor(this.now / 140 + mx * 7 + my * 13) % 4;
              drawFrame(ctx, "brazier", f, 0, sx - CELL / 2, sy - CELL / 2, 2);
            }
            else if (dec === "gate_open")
              drawFrame(ctx, "gate", 4, 0, sx - CELL / 2, sy - CELL / 2, 2);
            else if (dec === "spikes")
              drawFrame(ctx, "spikes", 6, 0, sx - CELL / 2, sy - CELL / 2, 2);
            else drawSprite(ctx, SPR[dec], sx, sy, CELL);
          }
          if (tile === STAIRS) drawSprite(ctx, theme.stairs, sx, sy, CELL);
          if (tile === SHRINE) this.drawShrine(sx, sy);
          if (tile === WAYSTONE) this.drawWaystone(sx, sy);
        }

        if (!d.visible[i]) {
          // explored-but-unseen: darken with the theme's tint
          ctx.fillStyle = theme.tint;
          ctx.fillRect(sx, sy, CELL, CELL);
        }
      }
    }

    // --- stairs marker (once discovered, always findable) ---
    const st = d.stairs;
    if (st && d.explored[d.idx(st.x, st.y)]) {
      const sx = Math.round((st.x - camX) * CELL);
      const sy = Math.round((st.y - camY) * CELL);
      this.drawStairsMarker(sx, sy, d.visible[d.idx(st.x, st.y)]);
    }

    // --- dynamic torch lighting ---
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const lt of d.lights) {
      const ei = d.idx(lt.x, lt.y);
      if (!d.explored[ei]) continue;
      const lsx = Math.round((lt.x - camX + 0.5) * CELL);
      const lsy = Math.round((lt.y - camY + 0.5) * CELL);
      const pulse = 0.5 + 0.5 * Math.sin(this.now / 250 + lt.x * 1.7 + lt.y * 2.3);
      const alpha = d.visible[ei] ? (0.11 + 0.05 * pulse) : 0.05;
      const rad = lt.radius * CELL;
      const grd = ctx.createRadialGradient(lsx, lsy, 0, lsx, lsy, rad);
      grd.addColorStop(0, `rgba(255,170,50,${alpha})`);
      grd.addColorStop(1, "rgba(255,170,50,0)");
      ctx.fillStyle = grd;
      ctx.fillRect(lsx - rad, lsy - rad, rad * 2, rad * 2);
    }
    ctx.restore();

    // --- interactable objects: chests, barrels, pots, crates ---
    for (let vy = -1; vy <= VIEW_H; vy++) {
      for (let vx = -1; vx <= VIEW_W; vx++) {
        const mx = x0 + vx, my = y0 + vy;
        if (!d.inBounds(mx, my)) continue;
        const i = d.idx(mx, my);
        if (!d.objs[i] || !d.visible[i]) continue;
        const sx = Math.round((mx - camX) * CELL);
        const sy = Math.round((my - camY) * CELL);
        this.drawObj(d.objs[i], sx, sy);
      }
    }

    // --- one-shot object animations (chest opening, smashing, gates, spikes) ---
    for (const e of this.effects) {
      if (e.type !== "obj") continue;
      if (!d.visible[d.idx(e.x, e.y)]) continue;
      const k = Math.min(0.999, (this.now - e.start) / e.dur);
      const frame = e.from + Math.floor(k * (e.to - e.from + 1));
      const sx = Math.round((e.x - camX) * CELL);
      const sy = Math.round((e.y - camY) * CELL);
      const s = STRIPS[e.strip];
      if (!s) continue;
      if (s.fw === 16) drawFrame(ctx, e.strip, frame, e.row || 0, sx, sy, 2);
      else drawFrame(ctx, e.strip, frame, e.row || 0, sx - CELL / 2, sy - CELL / 2, 2);
    }

    // --- items (only when visible) ---
    for (const it of this.items) {
      const i = d.idx(it.x, it.y);
      if (!d.visible[i]) continue;
      const sx = Math.round((it.x - camX) * CELL);
      const sy = Math.round((it.y - camY) * CELL);
      if (it.key === "key") this.drawKey(sx, sy);
      else if (it.key === "artifact") this.drawArtifact(sx, sy);
      else if (it.key === "scroll") this.drawScroll(sx, sy);
      else if (it.key === "wand") this.drawWand(sx, sy);
      else if (it.slot === "ring") this.drawRing(sx, sy);
      else if (it.slot === "armor") this.drawArmorIcon(sx, sy);
      else if (it.slot === "shield") this.drawShieldIcon(sx, sy);
      else drawSprite(ctx, SPR[it.sprite], sx, sy, CELL);
    }

    // --- death effects: strips play their death animation, paper-dolls fade ---
    for (const e of this.effects) {
      if (e.type !== "death") continue;
      const k = (this.now - e.start) / e.dur;
      if (e.strip && e.strip.death) {
        const [row, n] = e.strip.death;
        const sx = Math.round((e.x - camX) * CELL);
        const sy = Math.round((e.y - camY) * CELL);
        this.compositeActor(e, 0, 0, null,
          { row, frame: Math.min(n - 1, Math.floor(k * n)) });
        ctx.drawImage(this.fx, sx - CELL / 2, sy - CELL / 2);
      } else {
        const sx = Math.round((e.x - camX) * CELL);
        const sy = Math.round((e.y - camY) * CELL - k * 12);
        this.compositeActor(e, 0, k * 0.7, "#000");
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(this.fx, sx - CELL / 2, sy - CELL / 2);
        ctx.globalAlpha = 1;
      }
    }

    // --- monsters (only when visible) ---
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const i = d.idx(m.x, m.y);
      if (!d.visible[i]) continue;
      const sx = Math.round((m.rx - camX) * CELL);
      const sy = Math.round((m.ry - camY) * CELL);
      this.drawActor(m, sx, sy);
      this.drawHealthBar(ctx, sx, sy, m.hp / m.maxHp);
    }

    // --- NPCs ---
    if (this.npcs) {
      for (const npc of this.npcs) {
        if (!npc.alive) continue;
        const i = d.idx(npc.x, npc.y);
        if (!d.visible[i]) continue;
        const sx = Math.round((npc.rx - camX) * CELL);
        const sy = Math.round((npc.ry - camY) * CELL);
        this.drawActor(npc, sx, sy);
        this.drawNpcIndicator(sx, sy, npc);
      }
    }

    // --- player ---
    const p = this.player;
    if (p.alive) {
      const sx = Math.round((p.rx - camX) * CELL);
      const sy = Math.round((p.ry - camY) * CELL);
      this.drawActor(p, sx, sy);
    }

    // --- ranged bolts (travel from caster to target) ---
    for (const e of this.effects) {
      if (e.type !== "bolt") continue;
      const k = Math.min(1, (this.now - e.start) / e.dur);
      const x = e.x0 + (e.x1 - e.x0) * k;
      const y = e.y0 + (e.y1 - e.y0) * k;
      const sx = (x - camX) * CELL;
      const sy = (y - camY) * CELL;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // --- particles ---
    for (const pt of this.particles) {
      const sx = (pt.x - camX) * CELL;
      const sy = (pt.y - camY) * CELL;
      ctx.globalAlpha = Math.max(0, 1 - pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(sx - pt.size / 2, sy - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    // --- floating damage / heal numbers ---
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 13px 'Trebuchet MS', system-ui, sans-serif";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    for (const e of this.effects) {
      if (e.type !== "float") continue;
      const k = (this.now - e.start) / e.dur;
      const sx = (e.x - camX) * CELL;
      const sy = (e.y - camY) * CELL - 4 - k * e.rise;
      ctx.globalAlpha = 1 - k;
      ctx.strokeText(e.text, sx, sy);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, sx, sy);
    }
    ctx.globalAlpha = 1;

    ctx.restore(); // end screen shake

    // --- level-change fade (drawn over everything, unshaken) ---
    if (this.transition) this.drawTransition(ctx);
  }

  // Top-corner minimap drawn from explored/visible state.
  renderMinimap() {
    const d = this.dungeon;
    // Fit the current map to the widget: 3px/tile for the dungeon (unchanged),
    // larger for the smaller camp map.
    const s = Math.max(1, Math.floor(Math.min(this.mini.width / d.w, this.mini.height / d.h)));
    const mm = this.miniCtx;
    mm.clearRect(0, 0, this.mini.width, this.mini.height);
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        const i = d.idx(x, y);
        if (!d.explored[i]) continue;
        const t = d.tiles[i];
        let col;
        if (t === WALL) col = "#2b2a3c";
        else if (t === STAIRS) col = "#e0a040";
        else if (t === LOCKED) col = "#b06a2e";
        else if (t === SHRINE) col = "#7fe6ff";
        else if (t === WATER) col = "#1a3d80";
        else if (t === GATE) col = "#9aa6b8";
        else if (t === WAYSTONE) col = "#b48cff";
        else col = "#69697e";
        mm.globalAlpha = d.visible[i] ? 1 : 0.5;
        mm.fillStyle = col;
        mm.fillRect(x * s, y * s, s, s);
      }
    }
    mm.globalAlpha = 1;
    // monsters currently in view
    mm.fillStyle = "#e0594b";
    for (const m of this.monsters) {
      if (m.alive && d.visible[d.idx(m.x, m.y)])
        mm.fillRect(m.x * s, m.y * s, s, s);
    }
    // player
    const p = this.player;
    mm.fillStyle = "#ffe6a8";
    mm.fillRect(p.x * s - 1, p.y * s - 1, s + 2, s + 2);
  }

  // Pulsing glow + bobbing down-chevron so the stairs are unmistakable.
  drawStairsMarker(sx, sy, lit) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 350);
    const dim = lit ? 1 : 0.45;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (0.12 + 0.22 * pulse) * dim;
    ctx.fillStyle = "#ffcf6b";
    ctx.fillRect(sx, sy, CELL, CELL);
    ctx.restore();

    const bob = Math.sin(this.now / 350) * 2;
    const cx = sx + CELL / 2;
    const cy = sy - 5 + bob;
    ctx.save();
    ctx.globalAlpha = (0.7 + 0.3 * pulse) * dim;
    ctx.strokeStyle = "#ffe6a8";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx, cy + 5);
    ctx.lineTo(cx + 5, cy);
    ctx.stroke();
    ctx.restore();
  }

  // Small padlock badge on a locked door.
  drawLock(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2;
    ctx.save();
    ctx.fillStyle = "#1a1208";
    ctx.fillRect(cx - 4, cy - 1, 8, 7);
    ctx.strokeStyle = "#f4c542";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 4, cy - 1, 8, 7);
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 2.6, Math.PI, 0); // shackle
    ctx.stroke();
    ctx.restore();
  }

  // Pulsing holy glyph for a shrine tile.
  drawShrine(sx, sy) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 300);
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.2 + 0.3 * pulse;
    ctx.fillStyle = "#7fe6ff";
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#eafcff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    const r = 5 + pulse;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.restore();
  }

  // Pulsing rune-stone marking a waystone (M19) — stepping onto it fades to
  // camp, same as the scroll of return. Violet to read distinctly from the
  // shrine's cyan.
  drawWaystone(sx, sy) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 300);
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.2 + 0.3 * pulse;
    ctx.fillStyle = "#b48cff";
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "#2a1f3d";
    ctx.strokeStyle = "#d9c2ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + 6);
    ctx.lineTo(cx - 5, cy - 2);
    ctx.lineTo(cx, cy - 7);
    ctx.lineTo(cx + 5, cy - 2);
    ctx.lineTo(cx + 4, cy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.85 * (0.6 + 0.4 * pulse);
    ctx.strokeStyle = "#eadcff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy - 1, 2.5 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Procedural gold key (no key sprite exists in the asset packs).
  drawKey(sx, sy) {
    const ctx = this.ctx;
    const bob = Math.sin(this.now / 300) * 1.5;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + bob;
    ctx.save();
    ctx.strokeStyle = "#f4c542";
    ctx.fillStyle = "#f4c542";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx - 4, cy, 3.5, 0, Math.PI * 2); // bow
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - 1, cy);
    ctx.lineTo(cx + 7, cy); // shaft
    ctx.stroke();
    ctx.fillRect(cx + 5, cy, 2, 4); // teeth
    ctx.fillRect(cx + 2, cy, 2, 3);
    ctx.restore();
  }

  // Pulsing golden diamond — the win artifact.
  drawArtifact(sx, sy) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 220);
    const bob = Math.sin(this.now / 300) * 2;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + bob;
    const r = 7 + pulse * 1.5;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.12 + 0.22 * pulse;
    ctx.fillStyle = "#ffe060";
    ctx.beginPath();
    ctx.arc(cx, cy, CELL * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#ffd700";
    ctx.strokeStyle = "#fffacc";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.62, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.62, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#fff8c0";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.28, cy - r * 0.1);
    ctx.lineTo(cx, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.28, cy - r * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Procedural rolled-parchment icon for scroll pickups.
  drawScroll(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + Math.sin(this.now / 300) * 1.2;
    ctx.save();
    ctx.fillStyle = "#e9dcb5";
    ctx.strokeStyle = "#8a7a4a";
    ctx.lineWidth = 1.5;
    ctx.fillRect(cx - 4, cy - 7, 8, 14);
    ctx.strokeRect(cx - 4, cy - 7, 8, 14);
    ctx.fillStyle = "#cbbd8e"; // rolled ends
    ctx.fillRect(cx - 5, cy - 7, 10, 2);
    ctx.fillRect(cx - 5, cy + 5, 10, 2);
    ctx.strokeStyle = "#9a86c8"; // inked runes
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(cx - 2.5, cy + i * 3);
      ctx.lineTo(cx + 2.5, cy + i * 3);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Procedural wand icon: a stick with a glowing tip.
  drawWand(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + Math.sin(this.now / 300) * 1.2;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 200);
    ctx.save();
    ctx.strokeStyle = "#7a5a3a";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy + 6);
    ctx.lineTo(cx + 4, cy - 5);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(150,200,255,${0.4 + 0.4 * pulse})`;
    ctx.beginPath();
    ctx.arc(cx + 5, cy - 6, 3 + pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Procedural ring icon: a gold band set with a gem.
  drawRing(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + Math.sin(this.now / 300) * 1.2;
    ctx.save();
    ctx.strokeStyle = "#f4c542";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy + 1, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#5fd0ff";
    ctx.beginPath();
    ctx.arc(cx, cy - 5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Procedural breastplate icon for armor pickups.
  drawArmorIcon(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + Math.sin(this.now / 300) * 1.2;
    ctx.save();
    ctx.fillStyle = "#9aa6b2";
    ctx.strokeStyle = "#3a4654";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 5);
    ctx.lineTo(cx + 6, cy - 5);
    ctx.lineTo(cx + 5, cy + 4);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx - 5, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 5); ctx.lineTo(cx, cy + 6);
    ctx.stroke();
    ctx.restore();
  }

  // Procedural shield icon for shield pickups.
  drawShieldIcon(sx, sy) {
    const ctx = this.ctx;
    const cx = sx + CELL / 2;
    const cy = sy + CELL / 2 + Math.sin(this.now / 300) * 1.2;
    ctx.save();
    ctx.fillStyle = "#c2873f";
    ctx.strokeStyle = "#5a3d1c";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 6);
    ctx.lineTo(cx + 5, cy - 6);
    ctx.lineTo(cx + 5, cy + 1);
    ctx.lineTo(cx, cy + 7);
    ctx.lineTo(cx - 5, cy + 1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Black fade with a caption as the new map fades in — the transition's own
  // caption/sub if it supplied one, else the new floor's depth and theme.
  drawTransition(ctx) {
    const a = this.transition.alpha;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = `rgba(6,5,12,${a})`;
    ctx.fillRect(0, 0, w, h);

    if (this.transition.phase === "in") {
      const tr = this.transition;
      const textA = Math.max(0, (a - 0.15) / 0.85);
      ctx.save();
      ctx.globalAlpha = textA;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e8e4d8";
      ctx.font = "bold 30px 'Trebuchet MS', system-ui, sans-serif";
      ctx.fillText(tr.caption || `Depth ${this.depth}`, w / 2, h / 2 - 10);
      if (tr.sub) {
        ctx.fillStyle = "#d98e3a";
        ctx.font = "italic 17px 'Trebuchet MS', system-ui, sans-serif";
        ctx.fillText(tr.sub, w / 2, h / 2 + 16);
      } else if (this.isBossFloor) {
        ctx.fillStyle = "#e0594b";
        ctx.font = "bold italic 18px 'Trebuchet MS', system-ui, sans-serif";
        ctx.fillText("⚔ Boss Floor ⚔", w / 2, h / 2 + 16);
      } else {
        ctx.fillStyle = "#d98e3a";
        ctx.font = "italic 17px 'Trebuchet MS', system-ui, sans-serif";
        ctx.fillText(this.theme.name, w / 2, h / 2 + 16);
      }
      ctx.restore();
    }
  }

  // Composite an actor's art — paper-doll layers OR an animated strip frame —
  // into the 2x2-cell offscreen buffer, optionally flipped and tinted. The
  // actor's logical tile is the centre cell of the buffer.
  // `animOverride` = { row, frame } plays a specific strip frame (deaths).
  compositeActor(a, flashStrength, tintStrength, tintColor, animOverride = null) {
    const o = this.fxCtx;
    const B = CELL * 2;
    o.clearRect(0, 0, B, B);
    const facing = a.facing || 1;
    const flip = a.strip ? facing !== (a.strip.faces || 1) : facing < 0;
    if (flip) { o.save(); o.translate(B, 0); o.scale(-1, 1); }
    if (a.strip && STRIPS[a.strip.key]) {
      const s = STRIPS[a.strip.key];
      let row, frame;
      if (animOverride) {
        ({ row, frame } = animOverride);
      } else {
        const [r, n] = a.strip.idle;
        row = r;
        frame = Math.floor(this.now / (a.strip.rate || 130) + (a.bobPhase || 0) * 3) % n;
      }
      const w = s.fw * 2, h = s.fh * 2;
      // Centre horizontally; 32px monster frames fill the buffer, smaller
      // art (16x20 NPCs) is anchored to the bottom of the centre cell.
      const dx = (B - w) / 2;
      const dy = s.fh === 32 ? 0 : CELL * 1.5 - h;
      drawFrame(o, a.strip.key, frame, row, dx, dy, 2);
    } else if (a.layers) {
      for (const [c, r] of a.layers)
        drawSprite(o, ["chars", c, r], CELL / 2, CELL / 2, CELL);
    }
    if (flip) o.restore();

    if (tintStrength > 0) {
      o.globalCompositeOperation = "source-atop";
      o.globalAlpha = tintStrength;
      o.fillStyle = tintColor;
      o.fillRect(0, 0, B, B);
      o.globalAlpha = 1;
      o.globalCompositeOperation = "source-over";
    }
    if (flashStrength > 0) {
      o.globalCompositeOperation = "source-atop";
      o.globalAlpha = flashStrength;
      o.fillStyle = "#ffffff";
      o.fillRect(0, 0, B, B);
      o.globalAlpha = 1;
      o.globalCompositeOperation = "source-over";
    }
  }

  // Draw a living actor with idle bob, attack lunge, hit flash, elite/poison tint.
  drawActor(a, sx, sy) {
    const flashCap = this.reduceFlash ? 0.3 : 0.85;
    const flash =
      this.now < a.flashUntil ? (a.flashUntil - this.now) / 130 * flashCap : 0;
    // Status washes (poison / bleed / slow) take priority over any permanent
    // elite/template tint; hues come from the (colorblind-aware) palette.
    let tintColor = a.tint;
    let tintStr = a.tint ? (a.tintStrength || 0.4) : 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 200);
    if (this.hasStatus(a, "poison")) {
      tintColor = this.palette("poison");
      tintStr = 0.3 + 0.15 * pulse;
    } else if (this.hasStatus(a, "bleed")) {
      tintColor = this.palette("bleed");
      tintStr = 0.25 + 0.15 * pulse;
    } else if (this.hasStatus(a, "slow")) {
      tintColor = this.palette("slow");
      tintStr = 0.3 + 0.15 * pulse;
    }
    this.compositeActor(a, flash, tintStr, tintColor);

    // Strip art carries its own motion; only paper-dolls get the idle bob.
    let ox = 0;
    let oy = a.strip ? 0 : Math.sin(this.now / 280 + a.bobPhase) * 1.2;
    const LUNGE = 150;
    if (a.lungeStart && this.now - a.lungeStart < LUNGE) {
      const k = (this.now - a.lungeStart) / LUNGE;
      const amt = Math.sin(k * Math.PI) * 6;
      ox += (a.lungeDx || 0) * amt;
      oy += (a.lungeDy || 0) * amt;
    }
    this.ctx.drawImage(
      this.fx,
      Math.round(sx + ox - CELL / 2),
      Math.round(sy + oy - CELL / 2)
    );
  }

  drawHealthBar(ctx, sx, sy, pct) {
    if (pct >= 1) return;
    const w = CELL - 8;
    const x = sx + 4;
    const y = sy - 4;
    ctx.fillStyle = "#000";
    ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = "#c44";
    ctx.fillRect(x, y, Math.max(0, w * pct), 3);
  }

  // --------------------------------------------------------- NPC & shop
  npcAt(x, y) {
    if (!this.npcs) return null;
    return this.npcs.find((n) => n.alive && n.x === x && n.y === y) || null;
  }

  openShop(npc) {
    const panel = document.getElementById("shop-panel");
    if (!panel) return;
    this.autoPath = null;
    this.shopOpen = true;
    document.getElementById("shop-title").textContent = npc.name;
    document.getElementById("shop-greeting").textContent = npc.greeting;
    // Portrait: the NPC's standing frame at native resolution (CSS upscales).
    const pc = document.getElementById("shop-portrait");
    if (pc && npc.strip && STRIPS[npc.strip.key]) {
      const s = STRIPS[npc.strip.key];
      const pctx = pc.getContext("2d");
      pctx.imageSmoothingEnabled = false;
      pctx.clearRect(0, 0, pc.width, pc.height);
      pctx.drawImage(s.img, s.fw, 0, s.fw, s.fh, 0, 0, pc.width, pc.height);
    }
    const itemsEl = document.getElementById("shop-items");
    itemsEl.innerHTML = "";
    const purseEl = document.getElementById("shop-purse");
    const sellEl = document.getElementById("shop-sell");
    purseEl.classList.add("hidden");
    sellEl.innerHTML = "";
    const p = this.player;

    if (npc.npcType === "healer") {
      const healCost = 15 + this.depth * 2;
      const missing = p.maxHp - p.hp;
      const row = document.createElement("div");
      row.className = "shop-row";
      const nameEl = document.createElement("span");
      nameEl.className = "shop-name";
      nameEl.textContent = missing > 0 ? `Restore ${missing} HP` : "You are at full health.";
      const priceEl = document.createElement("span");
      priceEl.className = "shop-price";
      priceEl.textContent = `${healCost}g`;
      const btn = document.createElement("button");
      btn.className = "shop-buy";
      btn.textContent = "Heal";
      btn.disabled = p.gold < healCost || missing === 0;
      btn.onclick = () => {
        if (p.gold < healCost || p.hp >= p.maxHp) return;
        p.gold -= healCost;
        p.hp = p.maxHp;
        this.log(`The healer restores your health. (−${healCost}g)`, "good");
        audio.potion();
        this.updateHud();
        this.openShop(npc);
      };
      row.appendChild(nameEl);
      row.appendChild(priceEl);
      row.appendChild(btn);
      itemsEl.appendChild(row);

      // Lift curses (M19-T4): a camp-only service. Dungeon healers stay
      // HP-for-gold only — cleansing on every 4th floor would blunt the M14
      // curse mechanic and remove one of the camp's reasons to exist. Only
      // worth showing when something is actually cursed; the button itself
      // disables if the player can't afford it.
      const wornCursed = ["weapon", "armor", "shield", "ring"]
        .map((s) => p.equip[s]).filter((g) => g && g.cursed);
      if (this.mode === "camp" && wornCursed.length) {
        const curseCost = 15 + 10 * wornCursed.length;
        const curseRow = document.createElement("div");
        curseRow.className = "shop-row";
        const curseNameEl = document.createElement("span");
        curseNameEl.className = "shop-name";
        curseNameEl.textContent = "Lift curses";
        const cursePriceEl = document.createElement("span");
        cursePriceEl.className = "shop-price";
        cursePriceEl.textContent = `${curseCost}g`;
        const curseBtn = document.createElement("button");
        curseBtn.className = "shop-buy";
        curseBtn.textContent = "Cleanse";
        curseBtn.disabled = p.gold < curseCost;
        curseBtn.onclick = () => {
          if (p.gold < curseCost) return;
          p.gold -= curseCost;
          this.removeCurses();
          this.log(`The healer lifts your curse${wornCursed.length > 1 ? "s" : ""}. (−${curseCost}g)`, "good");
          audio.levelUp();
          this.spawnParticles(this.player.rx, this.player.ry, "#fff0a0", 16, true);
          this.updateHud();
          this.renderInventory();
          this.openShop(npc);
        };
        curseRow.appendChild(curseNameEl);
        curseRow.appendChild(cursePriceEl);
        curseRow.appendChild(curseBtn);
        itemsEl.appendChild(curseRow);
      }
    } else if (npc.npcType === "merchant") {
      // Merchant's purse (finite — it limits how much it can buy from you).
      purseEl.textContent = `Purse: ${npc.gold}g`;
      purseEl.classList.remove("hidden");

      const itemDesc = (it) => {
        const nm = this.displayName(it);
        if (it.identified === false) return nm; // unknown carried items in the sell list
        if (it.category === "equip") return `${nm} (${this.gearMeta(it)})`;
        if (it.category === "wand") return `${nm} (${it.charges} charges)`;
        return nm;
      };

      // --- Buy: the merchant's wares ---
      itemsEl.innerHTML = '<div class="shop-head-row">Buy</div>';
      const wares = npc.wareItems || [];
      if (!wares.length) {
        itemsEl.innerHTML += '<div class="shop-empty">I\'m all out of stock.</div>';
      } else {
        wares.forEach((it, idx) => {
          const price = this._itemPrice(it);
          const row = document.createElement("div");
          row.className = "shop-row";
          const nameEl = document.createElement("span");
          nameEl.className = "shop-name";
          nameEl.textContent = itemDesc(it);
          const priceEl = document.createElement("span");
          priceEl.className = "shop-price";
          priceEl.textContent = `${price}g`;
          const btn = document.createElement("button");
          btn.className = "shop-buy";
          btn.textContent = "Buy";
          btn.disabled = p.gold < price;
          btn.onclick = () => {
            if (p.gold < price) return;
            p.gold -= price;
            npc.wareItems.splice(idx, 1);
            switch (it.category) {
              case "gold": p.gold += it.amount; break;
              case "key": p.keys++; break;
              case "consumable": p.inventory.push(it); break;
              case "wand": p.inventory.push(it); break;
              case "equip": p.inventory.push(it); this.tryAutoEquip(it); break;
            }
            this.log(`You buy a ${it.name}. (−${price}g)`, "gold");
            audio.pickup();
            this.updateHud();
            this.openShop(npc);
          };
          row.appendChild(nameEl);
          row.appendChild(priceEl);
          row.appendChild(btn);
          itemsEl.appendChild(row);
        });
      }

      // --- Sell: the player's carried items (equipped gear stays equipped) ---
      sellEl.innerHTML = '<div class="shop-head-row">Sell</div>';
      const sellable = p.inventory;
      if (!sellable.length) {
        sellEl.innerHTML += '<div class="shop-empty">Nothing to sell.</div>';
      } else {
        sellable.forEach((it) => {
          const price = this._sellPrice(it);
          const afford = npc.gold >= price;
          const row = document.createElement("div");
          row.className = "shop-row";
          const nameEl = document.createElement("span");
          nameEl.className = "shop-name";
          nameEl.textContent = itemDesc(it);
          const priceEl = document.createElement("span");
          priceEl.className = "shop-price";
          priceEl.textContent = `${price}g`;
          const btn = document.createElement("button");
          btn.className = "shop-buy";
          btn.textContent = "Sell";
          btn.disabled = !afford;
          btn.title = afford ? "" : "The merchant can't afford this.";
          btn.onclick = () => {
            if (npc.gold < price) return;
            const i = p.inventory.indexOf(it);
            if (i < 0) return;
            p.inventory.splice(i, 1);
            p.gold += price;
            npc.gold -= price;
            this.log(`You sell the ${this.displayName(it)}. (+${price}g)`, "gold");
            audio.pickup();
            this.updateHud();
            this.openShop(npc);
          };
          row.appendChild(nameEl);
          row.appendChild(priceEl);
          row.appendChild(btn);
          sellEl.appendChild(row);
        });
      }
    }

    document.getElementById("shop-close").onclick = () => {
      panel.classList.add("hidden");
      this.shopOpen = false;
      this.worldTurn();
      this.dungeon.computeFov(this.player.x, this.player.y, FOV_RADIUS);
      this.startTween();
      this.updateHud();
    };
    panel.classList.remove("hidden");
  }

  _itemPrice(it) {
    const base = { potion: 25, weapon: 40, armor: 35, shield: 30, key: 20,
      scroll: 30, wand: 55, ring: 60 };
    let price = (base[it.key] || 25) + (it.bonus || 0) * 3;
    if (it.key === "scroll" && it.scroll === "return") price = 80; // scarce — the camp round-trip limiter
    if (it.category === "wand") price += (it.charges || 0) * 4;
    if (it.slot === "ring") price += (it.power || 0); // affix strength
    return price;
  }

  // Merchants buy at ~half the buy price.
  _sellPrice(it) {
    return Math.max(1, Math.floor(this._itemPrice(it) * 0.5));
  }

  useObject(x, y, obj) {
    // Levers persist on their tile; pulling one opens the floor's gate.
    if (obj.type === "lever") {
      if (obj.pulled) return;
      obj.pulled = true;
      this.effects.push({
        type: "obj", strip: "lever", row: 0, from: 0, to: 4,
        x, y, start: this.now, dur: 320,
      });
      const g = this.dungeon.gatePos;
      if (g) {
        this.dungeon.set(g.x, g.y, FLOOR);
        this.dungeon.decor[this.dungeon.idx(g.x, g.y)] = "gate_open";
        this.effects.push({
          type: "obj", strip: "gate", row: 0, from: 0, to: 4,
          x: g.x, y: g.y, start: this.now, dur: 500,
        });
        this.dungeon.gatePos = null;
        this.log("You pull the lever. Somewhere, a gate grinds open.", "gold");
        audio.descend();
        this.addShake(3, 220);
      } else {
        this.log("You pull the lever. Nothing seems to happen.", "dim");
        audio.pickup();
      }
      return;
    }

    this.dungeon.clearObj(x, y);
    const p = this.player;
    const strip = this.objStrip(obj);
    // Play the strip's remaining frames as a one-shot animation on the tile.
    const playAnim = (dur) => {
      const s = STRIPS[strip];
      if (!s || s.cols < 2) return;
      this.effects.push({
        type: "obj", strip, from: 1, to: s.cols - 1,
        x, y, start: this.now, dur,
      });
    };

    if (obj.type === "chest") {
      playAnim(450);
      if (rng() < 0.15) {
        this.log("The chest is empty.", "dim");
        audio.pickup();
      } else {
        const kinds = ["gold", "potion", "weapon", "armor", "shield", "scroll", "wand", "ring"];
        const it = makeItem(kinds[Math.floor(rng() * kinds.length)], x, y, this.depth);
        this.log(`You open a chest! Found ${this.itemPhrase(it)}.`, "gold");
        audio.levelUp();
        this.spawnParticles(x, y, "#ffcf6b", 10, true);
        switch (it.category) {
          case "gold": p.gold += it.amount; break;
          case "key": p.keys++; break;
          case "consumable": p.inventory.push(it); break;
          case "wand": p.inventory.push(it); break;
          case "equip": p.inventory.push(it); this.tryAutoEquip(it); break;
        }
        this.updateHud();
      }
    } else {
      // Smashables: barrels pay out most often, pots may hide a potion.
      playAnim(320);
      const noun = obj.type === "pot" ? "pot" : obj.type;
      this.log(`You smash the ${noun}.`, "dim");
      audio.hit();
      this.spawnParticles(x, y, obj.type === "pot" ? "#b8762a" : "#8b5c2a", 6);
      const r = rng();
      if (obj.type === "pot" && r < 0.1) {
        p.inventory.push(makeItem("potion", 0, 0, this.depth));
        this.log("A healing potion was hidden inside!", "good");
        this.updateHud();
      } else if (r < (obj.type === "barrel" ? 0.4 : 0.3)) {
        const gold = 3 + Math.floor(rng() * (5 + this.depth));
        p.gold += gold;
        this.log(`It had ${gold} gold inside!`, "gold");
        this.updateHud();
      }
    }
  }

  // ------------------------------------------------ procedural draw helpers
  drawWaterOverlay(sx, sy) {
    const ctx = this.ctx;
    const ripple = 0.5 + 0.5 * Math.sin(this.now / 700 + sx * 0.08 + sy * 0.06);
    ctx.save();
    ctx.globalAlpha = 0.50 + 0.08 * ripple;
    ctx.fillStyle = "#0d2e5a";
    ctx.fillRect(sx, sy, CELL, CELL);
    ctx.globalAlpha = 0.12 * ripple;
    ctx.fillStyle = "#6ab8e8";
    ctx.fillRect(sx + 3, sy + Math.round(CELL * 0.35), CELL - 6, 3);
    ctx.fillRect(sx + 6, sy + Math.round(CELL * 0.6), CELL - 12, 2);
    ctx.restore();
  }

  drawTorch(sx, sy) {
    const ctx = this.ctx;
    const pulse = 0.5 + 0.5 * Math.sin(this.now / 180 + sx * 0.3 + sy * 0.4);
    const cx = sx + CELL * 0.5;
    const cy = sy + CELL * 0.6;
    ctx.save();
    ctx.strokeStyle = "#5c3310";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 6);
    ctx.lineTo(cx, cy - 2);
    ctx.stroke();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55 + 0.3 * pulse;
    ctx.fillStyle = "#ff8c18";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 4 - pulse * 1.5, 3.5, 5 + pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5 * pulse;
    ctx.fillStyle = "#ffe860";
    ctx.beginPath();
    ctx.ellipse(cx, cy - 5 - pulse, 1.8, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Which strip an interactable object renders from.
  objStrip(obj) {
    if (obj.type === "chest") return "chest";
    if (obj.type === "pot") return "pot" + (obj.variant || 1);
    return obj.type; // barrel, crate
  }

  // Idle frame of a Tiny Dungeons object. 16px chests fill the tile; the
  // 32px objects are drawn centred over it. Pulled levers show frame 4.
  drawObj(obj, sx, sy) {
    const key = this.objStrip(obj);
    if (!STRIPS[key]) return;
    const col = obj.type === "lever" && obj.pulled ? 4 : 0;
    if (STRIPS[key].fw === 16) drawFrame(this.ctx, key, col, 0, sx, sy, 2);
    else drawFrame(this.ctx, key, col, 0, sx - CELL / 2, sy - CELL / 2, 2);
  }

  drawNpcIndicator(sx, sy, npc) {
    const ctx = this.ctx;
    const bob = Math.sin(this.now / 380) * 1.5;
    const pulse = 0.65 + 0.35 * Math.sin(this.now / 380);
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.font = "bold 9px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = npc.npcType === "healer" ? "#88ccff" : "#ffd060";
    ctx.fillText(npc.indicator, sx + CELL / 2, sy - 3 + bob);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- overlay UI
export function showOverlay(title, text, btnLabel, onClick) {
  const ov = document.getElementById("overlay");
  document.getElementById("overlay-title").textContent = title;
  document.getElementById("overlay-text").textContent = text;
  // Recap is opt-in; callers that want it (death/win) populate it afterward.
  const recap = document.getElementById("overlay-recap");
  if (recap) { recap.innerHTML = ""; recap.classList.add("hidden"); }
  // The Daily Run button + board belong only to the title screen (re-shown by
  // boot()); hide them on death/win overlays.
  const btn2 = document.getElementById("overlay-btn2");
  if (btn2) btn2.classList.add("hidden");
  const board = document.getElementById("daily-board");
  if (board) { board.innerHTML = ""; board.classList.add("hidden"); }
  const btn = document.getElementById("overlay-btn");
  btn.textContent = btnLabel;
  const handler = () => {
    ov.classList.add("hidden");
    btn.removeEventListener("click", handler);
    onClick();
  };
  btn.addEventListener("click", handler);
  ov.classList.remove("hidden");
}
