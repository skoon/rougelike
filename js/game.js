// Core game: state, turn loop, combat, rendering, input, HUD.

import { drawSprite, SPR, TILE } from "./assets.js";
import { Dungeon, WALL, FLOOR, STAIRS, LOCKED, SHRINE } from "./dungeon.js";
import { populate, makeMonster, makeBoss } from "./entities.js";
import { findPath } from "./pathfind.js";
import { audio } from "./audio.js";

const MAP_W = 50;
const MAP_H = 38;
const SCALE = 2; // each 16px tile -> 32 device px
const CELL = TILE * SCALE; // 32
const VIEW_W = 21; // tiles shown horizontally
const VIEW_H = 15; // tiles shown vertically
const FOV_RADIUS = 8;
const MOVE_MS = 90; // tween duration

// Depth themes: each picks a generation strategy and a tile palette
// ([sheet, col, row]) for floor/wall/stairs. Deeper = later entries.
const THEMES = [
  { name: "the Crypt",       strategy: "rooms", floor: ["dungeon", 8, 2],   wall: ["dungeon", 22, 4], stairs: ["dungeon", 16, 1], tint: "rgba(6,5,12,0.55)" },
  { name: "the Catacombs",   strategy: "bsp",   floor: ["dungeon", 16, 14], wall: ["dungeon", 22, 4], stairs: ["dungeon", 16, 1], tint: "rgba(10,7,4,0.55)" },
  { name: "the Caverns",     strategy: "caves", floor: ["dungeon", 16, 12], wall: ["dungeon", 22, 4], stairs: ["dungeon", 16, 1], tint: "rgba(10,6,3,0.55)" },
  { name: "the Sunken Depths", strategy: "caves", floor: ["dungeon", 16, 10], wall: ["dungeon", 22, 4], stairs: ["dungeon", 16, 1], tint: "rgba(4,8,14,0.6)" },
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

    // Minimap canvas (optional; absent in minimal HTML).
    this.mini = document.getElementById("minimap");
    if (this.mini) {
      this.miniScale = 3;
      this.mini.width = MAP_W * this.miniScale;
      this.mini.height = MAP_H * this.miniScale;
      this.miniCtx = this.mini.getContext("2d");
    }

    // Offscreen buffer for compositing layered, flipped, tinted actors.
    this.fx = document.createElement("canvas");
    this.fx.width = CELL;
    this.fx.height = CELL;
    this.fxCtx = this.fx.getContext("2d");
    this.fxCtx.imageSmoothingEnabled = false;

    this.bindInput();
    this.bindPointer();
    this.loop = this.loop.bind(this);
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.depth = 0;
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
      equip: { weapon: null, armor: null, shield: null },
      inventory: [],
      level: 1, xp: 0, xpNext: 20,
      gold: 0,
      keys: 0,
      statuses: [],
      alive: true,
    };
    this.recalcStats();
    this.messages = [];
    this.effects = [];
    this.particles = [];
    this.shake = { mag: 0, until: 0, dur: 1 };
    this.transition = null;
    this.busyUntil = 0;
    this.over = false;
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
    this.dungeon = new Dungeon(MAP_W, MAP_H, this.theme.strategy);
    const spawn = this.dungeon.startPos;
    const p = this.player;
    p.x = spawn.x; p.y = spawn.y; p.rx = spawn.x; p.ry = spawn.y;

    const { monsters, items } = populate(this.dungeon, this.depth);
    this.monsters = monsters;
    this.items = items;

    // Boss floor every 5 depths: spawn a unique guardian near the stairs.
    this.isBossFloor = this.depth % 5 === 0;
    if (this.isBossFloor) {
      const spot = this.findFloorNear(this.dungeon.stairs, 5) || this.dungeon.stairs;
      this.monsters.push(makeBoss(spot.x, spot.y, this.depth));
      this.log("A mighty presence guards this floor.", "bad");
    }

    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.centerCamera(true);
    if (this.depth > 1) this.log(`You reach depth ${this.depth}.`, "dim");
    this.updateHud();
  }

  // Find a free floor cell within `rad` of `pos` (for boss placement).
  findFloorNear(pos, rad) {
    const opts = [];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const x = pos.x + dx, y = pos.y + dy;
        if (x === pos.x && y === pos.y) continue;
        if (this.dungeon.get(x, y) === FLOOR && !this.monsterAt(x, y)) opts.push({ x, y });
      }
    }
    return opts.length ? opts[Math.floor(Math.random() * opts.length)] : null;
  }

  // ------------------------------------------------------------------- input
  bindInput() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "r") { e.preventDefault(); this.start(); return; }
      if (this.over) return;
      if (k === "i") { e.preventDefault(); this.toggleInventory(); return; }
      if (performance.now() < this.busyUntil) return;

      // Hotbar: number keys quaff the Nth carried consumable.
      if (k >= "1" && k <= "9") {
        e.preventDefault();
        this.useConsumableSlot(parseInt(k, 10) - 1);
        return;
      }

      let dx = 0, dy = 0, wait = false;
      switch (k) {
        case "arrowup": case "w": dy = -1; break;
        case "arrowdown": case "s": dy = 1; break;
        case "arrowleft": case "a": dx = -1; break;
        case "arrowright": case "d": dx = 1; break;
        case " ": case "spacebar": wait = true; break;
        default: return;
      }
      e.preventDefault();
      if (wait) this.turn(0, 0);
      else this.turn(dx, dy);
    });
  }

  // Click / tap a tile to step (or attack) one square toward it.
  bindPointer() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.over || performance.now() < this.busyUntil) return;
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const cy = (e.clientY - rect.top) * (this.canvas.height / rect.height);
      const tx = Math.floor(cx / CELL + this.cam.x);
      const ty = Math.floor(cy / CELL + this.cam.y);
      const p = this.player;
      let dx = Math.sign(tx - p.x);
      let dy = Math.sign(ty - p.y);
      // Movement is 4-directional: collapse diagonals to the dominant axis.
      if (dx !== 0 && dy !== 0) {
        if (Math.abs(tx - p.x) >= Math.abs(ty - p.y)) dy = 0;
        else dx = 0;
      }
      this.turn(dx, dy); // (0,0) when the player's own tile is tapped = wait
    });
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
      } else if (this.dungeon.isWalkable(nx, ny)) {
        p.x = nx; p.y = ny;
        audio.move();
      } else {
        return; // bumped a wall: no turn spent
      }
    }

    this.pickupAt(p.x, p.y);

    if (this.dungeon.get(p.x, p.y) === SHRINE) this.useShrine();

    if (this.dungeon.get(p.x, p.y) === STAIRS) {
      this.beginDescent();
      return;
    }

    this.enemyTurn();
    if (p.alive) this.tickStatuses(p);
    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.startTween();
    this.updateHud();
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
    const boon = Math.random();
    if (boon < 0.34) { p.maxHp += 5; p.hp = p.maxHp; this.log("The shrine blesses you — max HP up!", "gold"); }
    else if (boon < 0.67) { p.baseAtk += 1; this.log("The shrine blesses you — attack up!", "gold"); }
    else { p.baseDef += 1; this.log("The shrine blesses you — defense up!", "gold"); }
    this.recalcStats();
    audio.levelUp();
    this.spawnParticles(p.rx, p.ry, "#7fe6ff", 14, true);
  }

  // Kick off a fade-to-black transition; the new level is generated at the
  // midpoint (while the screen is fully dark) so the swap is never visible.
  beginDescent() {
    this.log("You find a staircase leading deeper.", "good");
    audio.descend();
    this.busyUntil = Infinity; // lock input for the whole transition
    this.transition = { phase: "out", alpha: 0, duration: 420 };
    this.transitionStart = this.now;
  }

  updateTransition() {
    const tr = this.transition;
    const k = Math.min(1, (this.now - this.transitionStart) / tr.duration);
    tr.alpha = tr.phase === "out" ? k : 1 - k;
    if (k < 1) return;
    if (tr.phase === "out") {
      this.nextLevel(); // generate the next floor while the screen is black
      tr.phase = "in";
      tr.alpha = 1;
      this.transitionStart = this.now;
    } else {
      this.transition = null;
      this.busyUntil = 0; // unlock input
    }
  }

  enemyTurn() {
    const p = this.player;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      this.tickStatuses(m);
      if (!m.alive) continue;

      const sees = this.dungeon.visible[this.dungeon.idx(m.x, m.y)];
      const dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);
      if (!sees || dist > FOV_RADIUS + 2) continue;

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
    return Math.max(1, raw + (Math.floor(Math.random() * 3) - 1));
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
    const dmg = this.rollDamage(attacker, defender);
    if (attacker.kind === "player") {
      this.log(`You hit the ${defender.name} for ${dmg}.`, "good");
      audio.hit();
    } else if (defender.kind === "player") {
      this.log(`The ${attacker.name} hits you for ${dmg}.`, "bad");
      audio.hurt();
    }
    this.damageActor(defender, dmg);

    // Slimes (and the like) can poison on a connecting hit.
    if (attacker.poisons && defender.alive && Math.random() < 0.5) {
      this.applyStatus(defender, "poison", 4, 2);
      if (defender.kind === "player") this.log("You are poisoned!", "bad");
    }
  }

  rangedAttack(caster, target) {
    caster.flashUntil = this.now + 80;
    const dmg = this.rollDamage(caster, target);
    this.effects.push({
      type: "bolt", color: "#b48cff",
      x0: caster.rx + 0.5, y0: caster.ry + 0.5,
      x1: target.rx + 0.5, y1: target.ry + 0.5,
      start: this.now, dur: 220,
    });
    this.log(`The ${caster.name} hurls a spectral bolt for ${dmg}.`, "bad");
    audio.hurt();
    this.damageActor(target, dmg);
  }

  // Apply damage with floating numbers / blood / shake, and resolve death.
  damageActor(target, dmg, color) {
    const isPlayer = target.kind === "player";
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
    this.log(`The ${m.name} dies.`, "dim");
    audio.enemyDie();
    this.effects.push({
      type: "death", layers: m.layers,
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
      if (s.type === "poison") {
        this.damageActor(actor, s.power, "#7dd65a");
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

  die() {
    this.player.alive = false;
    this.over = true;
    this.log("You have fallen in the dark.", "bad");
    audio.playerDie();
    this.addShake(11, 450);
    showOverlay(
      "You Died",
      `You reached depth ${this.depth} at level ${this.player.level} with ${this.player.gold} gold.`,
      "Try Again",
      () => this.start()
    );
  }

  // ------------------------------------------------------------------ items
  pickupAt(x, y) {
    const idx = this.items.findIndex((it) => it.x === x && it.y === y);
    if (idx < 0) return;
    const it = this.items[idx];
    const p = this.player;

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
      case "equip":
        p.inventory.push(it);
        this.log(`You pick up a ${it.name} (+${it.bonus} ${it.slot === "weapon" ? "ATK" : "DEF"}).`, "good");
        this.tryAutoEquip(it);
        break;
    }
    audio.pickup();
    this.spawnParticles(p.rx, p.ry, "#ffcf6b", 10, true);
    this.items.splice(idx, 1);
  }

  // ---------------------------------------------------------- equipment
  recalcStats() {
    const p = this.player;
    const e = p.equip;
    p.atk = p.baseAtk + (e.weapon ? e.weapon.bonus : 0);
    p.def = p.baseDef + (e.armor ? e.armor.bonus : 0) + (e.shield ? e.shield.bonus : 0);
    if (this.statsEl) this.updateHud();
  }

  tryAutoEquip(it) {
    const cur = this.player.equip[it.slot];
    if (!cur || it.bonus > cur.bonus) this.equipItem(it);
  }

  equipItem(it) {
    const p = this.player;
    const cur = p.equip[it.slot];
    p.inventory = p.inventory.filter((x) => x !== it);
    if (cur) p.inventory.push(cur);
    p.equip[it.slot] = it;
    this.log(`You equip the ${it.name}.`, "good");
    this.recalcStats();
    this.renderInventory();
  }

  useConsumable(it) {
    const p = this.player;
    if (it.key === "potion") {
      const heal = Math.min(p.maxHp - p.hp, it.heal);
      p.hp += heal;
      this.log(`You quaff a ${it.name} and recover ${heal} HP.`, "good");
      audio.potion();
      this.spawnDamage(p.rx, p.ry, `+${heal}`, "#6cc04a");
      this.spawnParticles(p.rx, p.ry, "#6cc04a", 8, true);
    }
    p.inventory = p.inventory.filter((x) => x !== it);
    this.renderInventory();
  }

  // Use the Nth consumable (hotbar 1-9). Costs a turn.
  useConsumableSlot(n) {
    const cons = this.player.inventory.filter((it) => it.category === "consumable");
    const it = cons[n];
    if (!it) return;
    this.useConsumable(it);
    this.afterAction();
  }

  // Run the world's reaction to a non-move player action (item use).
  afterAction() {
    if (this.over) return;
    this.enemyTurn();
    if (this.player.alive) this.tickStatuses(this.player);
    this.dungeon.computeFov(this.player.x, this.player.y, FOV_RADIUS);
    this.startTween();
    this.updateHud();
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
      const stat = slot === "weapon" ? "ATK" : "DEF";
      return `<div class="inv-row"><span class="inv-slot">${label}</span>` +
        `<span class="inv-name">${it ? `${it.name} <em>(+${it.bonus} ${stat})</em>` : "—"}</span></div>`;
    };
    document.getElementById("inv-equipped").innerHTML =
      `<div class="inv-head">Equipped</div>${slotRow("weapon")}${slotRow("armor")}${slotRow("shield")}`;

    const carriedEl = document.getElementById("inv-carried");
    if (!p.inventory.length) {
      carriedEl.innerHTML = `<div class="inv-head">Carried</div><div class="inv-empty">empty</div>`;
      return;
    }
    const consumables = p.inventory.filter((it) => it.category === "consumable");
    carriedEl.innerHTML = `<div class="inv-head">Carried</div>`;
    p.inventory.forEach((it) => {
      const row = document.createElement("div");
      row.className = "inv-row";
      let meta = "";
      if (it.category === "equip") meta = ` <em>(+${it.bonus} ${it.slot === "weapon" ? "ATK" : "DEF"})</em>`;
      const btn = document.createElement("button");
      if (it.category === "equip") {
        btn.textContent = "Equip";
        btn.onclick = () => this.equipItem(it);
      } else {
        const n = consumables.indexOf(it);
        btn.textContent = n >= 0 && n < 9 ? `Use [${n + 1}]` : "Use";
        btn.onclick = () => { this.useConsumable(it); this.afterAction(); };
      }
      row.innerHTML = `<span class="inv-name">${it.name}${meta}</span>`;
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
    this.statsEl.innerHTML = `
      <span class="stat bar">HP
        <span class="track"><span class="fill hp" style="width:${hpPct}%"></span></span>
        <b>${Math.max(0, p.hp)}/${p.maxHp}</b></span>
      <span class="stat bar">XP
        <span class="track"><span class="fill xp" style="width:${xpPct}%"></span></span></span>
      <span class="stat">Lv <b>${p.level}</b></span>
      <span class="stat">ATK <b>${p.atk}</b></span>
      <span class="stat">DEF <b>${p.def}</b></span>
      <span class="stat">Gold <b>${p.gold}</b></span>
      ${p.keys > 0 ? `<span class="stat">Keys <b>${p.keys}</b></span>` : ""}
      <span class="stat">Depth <b>${this.depth}</b></span>
      ${p.statuses.map((s) => `<span class="stat status-${s.type}">${s.type} <b>${s.turns}</b></span>`).join("")}`;
  }

  // ---------------------------------------------------------------- render
  centerCamera(snap) {
    const p = this.player;
    let cx = p.rx - (VIEW_W - 1) / 2;
    let cy = p.ry - (VIEW_H - 1) / 2;
    cx = Math.max(0, Math.min(MAP_W - VIEW_W, cx));
    cy = Math.max(0, Math.min(MAP_H - VIEW_H, cy));
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
    if (this.transition) this.updateTransition();
    // Tween render positions toward logical positions.
    const t = 0.35;
    this.tweenActor(this.player, t);
    for (const m of this.monsters) this.tweenActor(m, t);
    if (this.effects.length)
      this.effects = this.effects.filter((e) => now - e.start < e.dur);
    if (this.particles.length) this.updateParticles(dt);
    this.centerCamera(false);
    this.render();
    if (this.miniCtx) this.renderMinimap();
    requestAnimationFrame(this.loop);
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
    ctx.fillStyle = "#06050c";
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
        } else if (tile === LOCKED) {
          drawSprite(ctx, theme.floor, sx, sy, CELL);
          drawSprite(ctx, SPR.door, sx, sy, CELL);
          this.drawLock(sx, sy);
        } else {
          drawSprite(ctx, theme.floor, sx, sy, CELL);
          const dec = d.decor[i];
          if (dec) drawSprite(ctx, SPR[dec], sx, sy, CELL);
          if (tile === STAIRS) drawSprite(ctx, theme.stairs, sx, sy, CELL);
          if (tile === SHRINE) this.drawShrine(sx, sy);
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

    // --- items (only when visible) ---
    for (const it of this.items) {
      const i = d.idx(it.x, it.y);
      if (!d.visible[i]) continue;
      const sx = Math.round((it.x - camX) * CELL);
      const sy = Math.round((it.y - camY) * CELL);
      if (it.key === "key") this.drawKey(sx, sy);
      else if (it.slot === "armor") this.drawArmorIcon(sx, sy);
      else if (it.slot === "shield") this.drawShieldIcon(sx, sy);
      else drawSprite(ctx, SPR[it.sprite], sx, sy, CELL);
    }

    // --- death effects (fade + rise to a shadow) ---
    for (const e of this.effects) {
      if (e.type !== "death") continue;
      const k = (this.now - e.start) / e.dur;
      const sx = Math.round((e.x - camX) * CELL);
      const sy = Math.round((e.y - camY) * CELL - k * 12);
      this.compositeLayers(e.layers, e.facing, 0, k * 0.7, "#000");
      ctx.globalAlpha = 1 - k;
      ctx.drawImage(this.fx, sx, sy);
      ctx.globalAlpha = 1;
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
    const s = this.miniScale;
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

  // Black fade with a "Depth N" caption as the new floor fades in.
  drawTransition(ctx) {
    const a = this.transition.alpha;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = `rgba(6,5,12,${a})`;
    ctx.fillRect(0, 0, w, h);

    if (this.transition.phase === "in") {
      const textA = Math.max(0, (a - 0.15) / 0.85);
      ctx.save();
      ctx.globalAlpha = textA;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#e8e4d8";
      ctx.font = "bold 30px 'Trebuchet MS', system-ui, sans-serif";
      ctx.fillText(`Depth ${this.depth}`, w / 2, h / 2 - 10);
      if (this.isBossFloor) {
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

  // Composite an actor's layers into the offscreen buffer, optionally flipped
  // and tinted, leaving the result in `this.fx`.
  compositeLayers(layers, facing, flashStrength, tintStrength, tintColor) {
    const o = this.fxCtx;
    o.clearRect(0, 0, CELL, CELL);
    const flip = facing < 0;
    if (flip) { o.save(); o.translate(CELL, 0); o.scale(-1, 1); }
    for (const [c, r] of layers) drawSprite(o, ["chars", c, r], 0, 0, CELL);
    if (flip) o.restore();

    if (tintStrength > 0) {
      o.globalCompositeOperation = "source-atop";
      o.globalAlpha = tintStrength;
      o.fillStyle = tintColor;
      o.fillRect(0, 0, CELL, CELL);
      o.globalAlpha = 1;
      o.globalCompositeOperation = "source-over";
    }
    if (flashStrength > 0) {
      o.globalCompositeOperation = "source-atop";
      o.globalAlpha = flashStrength;
      o.fillStyle = "#ffffff";
      o.fillRect(0, 0, CELL, CELL);
      o.globalAlpha = 1;
      o.globalCompositeOperation = "source-over";
    }
  }

  // Draw a living actor with idle bob, attack lunge, hit flash, elite/poison tint.
  drawActor(a, sx, sy) {
    const flash =
      this.now < a.flashUntil ? (a.flashUntil - this.now) / 130 * 0.85 : 0;
    // Poison shows as a pulsing green wash; otherwise use any elite tint.
    let tintColor = a.tint;
    let tintStr = a.tint ? 0.4 : 0;
    if (this.hasStatus(a, "poison")) {
      tintColor = "#5fbf3a";
      tintStr = 0.3 + 0.15 * (0.5 + 0.5 * Math.sin(this.now / 200));
    }
    this.compositeLayers(a.layers, a.facing, flash, tintStr, tintColor);

    let ox = 0;
    let oy = Math.sin(this.now / 280 + a.bobPhase) * 1.2;
    const LUNGE = 150;
    if (a.lungeStart && this.now - a.lungeStart < LUNGE) {
      const k = (this.now - a.lungeStart) / LUNGE;
      const amt = Math.sin(k * Math.PI) * 6;
      ox += (a.lungeDx || 0) * amt;
      oy += (a.lungeDy || 0) * amt;
    }
    this.ctx.drawImage(this.fx, Math.round(sx + ox), Math.round(sy + oy));
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
}

// ---------------------------------------------------------------- overlay UI
export function showOverlay(title, text, btnLabel, onClick) {
  const ov = document.getElementById("overlay");
  document.getElementById("overlay-title").textContent = title;
  document.getElementById("overlay-text").textContent = text;
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
