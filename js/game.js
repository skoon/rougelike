// Core game: state, turn loop, combat, rendering, input, HUD.

import { drawSprite, SPR, TILE } from "./assets.js";
import { Dungeon, WALL, FLOOR, STAIRS } from "./dungeon.js";
import { populate, makeMonster } from "./entities.js";

const MAP_W = 50;
const MAP_H = 38;
const SCALE = 2; // each 16px tile -> 32 device px
const CELL = TILE * SCALE; // 32
const VIEW_W = 21; // tiles shown horizontally
const VIEW_H = 15; // tiles shown vertically
const FOV_RADIUS = 8;
const MOVE_MS = 90; // tween duration

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

    this.bindInput();
    this.loop = this.loop.bind(this);
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.depth = 0;
    this.player = {
      kind: "player",
      sprite: "player",
      x: 0, y: 0, rx: 0, ry: 0,
      hp: 30, maxHp: 30,
      atk: 5, def: 1,
      level: 1, xp: 0, xpNext: 20,
      gold: 0,
      alive: true,
    };
    this.messages = [];
    this.over = false;
    this.log("You descend into the catacombs...", "dim");
    this.nextLevel();
    requestAnimationFrame(this.loop);
  }

  nextLevel() {
    this.depth++;
    this.dungeon = new Dungeon(MAP_W, MAP_H);
    const startRoom = this.dungeon.rooms[0];
    const spawn = startRoom.randPoint();
    const p = this.player;
    p.x = spawn.x; p.y = spawn.y; p.rx = spawn.x; p.ry = spawn.y;

    const { monsters, items } = populate(this.dungeon, this.depth, startRoom);
    this.monsters = monsters;
    this.items = items;

    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.centerCamera(true);
    if (this.depth > 1) this.log(`You reach depth ${this.depth}.`, "dim");
    this.updateHud();
  }

  // ------------------------------------------------------------------- input
  bindInput() {
    window.addEventListener("keydown", (e) => {
      const k = e.key.toLowerCase();
      if (k === "r") { e.preventDefault(); this.start(); return; }
      if (this.over) return;
      if (performance.now() < this.busyUntil) return;

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

  // ----------------------------------------------------------------- turns
  turn(dx, dy) {
    const p = this.player;
    if (dx !== 0 || dy !== 0) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      const target = this.monsterAt(nx, ny);
      if (target) {
        this.attack(p, target);
      } else if (this.dungeon.isWalkable(nx, ny)) {
        p.x = nx; p.y = ny;
      } else {
        return; // bumped a wall: no turn spent
      }
    }

    this.pickupAt(p.x, p.y);

    if (this.dungeon.get(p.x, p.y) === STAIRS) {
      this.log("You find a staircase leading deeper.", "good");
      this.nextLevel();
      this.startTween();
      return;
    }

    this.enemyTurn();
    this.dungeon.computeFov(p.x, p.y, FOV_RADIUS);
    this.startTween();
    this.updateHud();
  }

  startTween() {
    this.busyUntil = performance.now() + MOVE_MS;
  }

  enemyTurn() {
    const p = this.player;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const i = this.dungeon.idx(m.x, m.y);
      const sees = this.dungeon.visible[i];
      const dist = Math.abs(m.x - p.x) + Math.abs(m.y - p.y);

      if (sees && dist === 1) {
        this.attack(m, p);
        continue;
      }
      if (sees && dist <= FOV_RADIUS) {
        this.stepToward(m, p.x, p.y);
      }
    }
    this.monsters = this.monsters.filter((m) => m.alive);
  }

  // Greedy step toward target, avoiding walls and other actors.
  stepToward(m, tx, ty) {
    const options = [];
    const sx = Math.sign(tx - m.x);
    const sy = Math.sign(ty - m.y);
    if (sx) options.push([sx, 0]);
    if (sy) options.push([0, sy]);
    // Prefer the larger axis first.
    if (Math.abs(tx - m.x) < Math.abs(ty - m.y)) options.reverse();

    for (const [dx, dy] of options) {
      const nx = m.x + dx;
      const ny = m.y + dy;
      if (
        this.dungeon.isWalkable(nx, ny) &&
        !this.monsterAt(nx, ny) &&
        !(this.player.x === nx && this.player.y === ny)
      ) {
        m.x = nx; m.y = ny;
        return;
      }
    }
  }

  // ---------------------------------------------------------------- combat
  attack(attacker, defender) {
    const raw = attacker.atk - defender.def;
    const dmg = Math.max(1, raw + (Math.floor(Math.random() * 3) - 1));
    defender.hp -= dmg;

    if (attacker.kind === "player") {
      this.log(`You hit the ${defender.name} for ${dmg}.`, "good");
    } else if (defender.kind === "player") {
      this.log(`The ${attacker.name} hits you for ${dmg}.`, "bad");
    }

    if (defender.hp <= 0) {
      if (defender.kind === "player") {
        this.die();
      } else {
        defender.alive = false;
        this.log(`The ${defender.name} dies.`, "dim");
        this.gainXp(defender.xp);
      }
    }
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
      p.atk += 1;
      if (p.level % 3 === 0) p.def += 1;
      this.log(`You reach level ${p.level}! You feel stronger.`, "gold");
    }
  }

  die() {
    this.player.alive = false;
    this.over = true;
    this.log("You have fallen in the dark.", "bad");
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
    switch (it.key) {
      case "gold":
        p.gold += it.amount;
        this.log(`You pick up ${it.amount} gold.`, "gold");
        break;
      case "amulet":
        p.gold += it.amount;
        this.log(`A glittering amulet! Worth ${it.amount} gold.`, "gold");
        break;
      case "potion": {
        const heal = Math.min(p.maxHp - p.hp, 12);
        p.hp += heal;
        this.log(`You quaff a potion and recover ${heal} HP.`, "good");
        break;
      }
      case "weapon":
        p.atk += 2;
        this.log("You find a sharper blade. Attack up!", "good");
        break;
    }
    this.items.splice(idx, 1);
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
      <span class="stat">Depth <b>${this.depth}</b></span>`;
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
    // Tween render positions toward logical positions.
    const t = 0.35;
    this.tweenActor(this.player, t);
    for (const m of this.monsters) this.tweenActor(m, t);
    this.centerCamera(false);
    this.render();
    requestAnimationFrame(this.loop);
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

        if (tile === WALL) {
          drawSprite(ctx, SPR.wall, sx, sy, CELL);
        } else {
          drawSprite(ctx, SPR.floor, sx, sy, CELL);
          const dec = d.decor[i];
          if (dec) drawSprite(ctx, SPR[dec], sx, sy, CELL);
          if (tile === STAIRS) drawSprite(ctx, SPR.stairs, sx, sy, CELL);
        }

        if (!d.visible[i]) {
          // explored-but-unseen: darken
          ctx.fillStyle = "rgba(6,5,12,0.55)";
          ctx.fillRect(sx, sy, CELL, CELL);
        }
      }
    }

    // --- items (only when visible) ---
    for (const it of this.items) {
      const i = d.idx(it.x, it.y);
      if (!d.visible[i]) continue;
      const sx = Math.round((it.x - camX) * CELL);
      const sy = Math.round((it.y - camY) * CELL);
      drawSprite(ctx, SPR[it.sprite], sx, sy, CELL);
    }

    // --- monsters (only when visible) ---
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const i = d.idx(m.x, m.y);
      if (!d.visible[i]) continue;
      const sx = Math.round((m.rx - camX) * CELL);
      const sy = Math.round((m.ry - camY) * CELL);
      drawSprite(ctx, SPR[m.sprite], sx, sy, CELL);
      this.drawHealthBar(ctx, sx, sy, m.hp / m.maxHp);
    }

    // --- player ---
    const p = this.player;
    if (p.alive) {
      const sx = Math.round((p.rx - camX) * CELL);
      const sy = Math.round((p.ry - camY) * CELL);
      drawSprite(ctx, SPR.player, sx, sy, CELL);
    }
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
