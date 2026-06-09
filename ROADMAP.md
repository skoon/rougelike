# Catacombs of the Forgotten — Roadmap

This document is both a **product roadmap** and an **agent onboarding primer**. It is
written so that an AI (or human) agent can pick up any single task and start working
with minimal exploration. Read **Part 1** once for context, then jump to the task you
were assigned in **Part 3**.

---

## Part 1 — Project context primer

### What it is
A turn-based, grid-based pixel-art roguelike that runs in the browser with **no build
step**: plain HTML + CSS + ES modules + Canvas 2D. Art is the Kenney Roguelike packs
in `assets/` (16×16 tiles, 1px margin between tiles → 17px stride).

### How to run / preview
ES modules require HTTP (not `file://`).

```sh
# from the repo root
python -m http.server 8123
# open http://localhost:8123
```

There is also a preview entry named `roguelike` in
`D:\source\isoaarpg\.claude\launch.json` (python http.server on port 8123) used by the
Claude preview tooling.

### File / symbol map
| File | Exports / key symbols | Responsibility |
| --- | --- | --- |
| `index.html` | `#game` canvas, `#stats`, `#log`, `#overlay*`, `#help` | DOM skeleton + HUD containers |
| `css/style.css` | CSS vars `--hp`, `--xp`, `--accent`… | Theme, HUD bars, overlay/log styling |
| `js/main.js` | `boot()` | Loads assets, shows title overlay, constructs `Game` |
| `js/assets.js` | `TILE` (16), `loadAssets()`, `SPR`, `drawSprite(ctx,spr,dx,dy,size)` | Sheet loading + sprite atlas |
| `js/dungeon.js` | `WALL/FLOOR/STAIRS`, `Room`, `Dungeon` | Map generation + field of view |
| `js/entities.js` | `MONSTERS`, `ITEMS`, `makeMonster`, `makeItem`, `populate` | Actor/item templates + spawning |
| `js/audio.js` | `audio` (AudioManager singleton) | Web Audio buses, procedural SFX, ambient drone, volume persistence |
| `js/game.js` | `Game`, `showOverlay()` | State, turn loop, combat, render, input, HUD |

### `Dungeon` (js/dungeon.js) cheat-sheet
- Fields: `tiles` (Int array, `WALL|FLOOR|STAIRS`), `decor` (visual-only key per cell),
  `visible`, `explored` (bool arrays), `rooms` (Room[]), `stairs` ({x,y}).
- Methods: `generate()`, `carveRoom`, `carveCorridor`, `carveH/V`, `scatterDecor`,
  `roomCells(room)`, `idx/inBounds/get/set`, `isWalkable`, `blocksSight`,
  `computeFov(ox,oy,radius)`, `lineOfSight(x0,y0,x1,y1)` (Bresenham).
- Generation is **room + L-corridor** only. FOV is **per-cell raycast within radius**.

### `Game` (js/game.js) cheat-sheet
- Constants at top: `MAP_W=50`, `MAP_H=38`, `SCALE=2`, `CELL=32`, `VIEW_W=21`,
  `VIEW_H=15`, `FOV_RADIUS=8`, `MOVE_MS=90`.
- Turn flow: input → `turn(dx,dy)` → (move | `attack`) → `pickupAt` → stairs check →
  `enemyTurn()` → `computeFov` → `startTween()` → `updateHud()`.
- Rendering: `requestAnimationFrame` `loop()` tweens `rx/ry` toward `x/y`, then
  `render()` draws terrain → items → monsters → player (visible cells only;
  explored-but-unseen cells are dimmed with a translucent fill).
- Enemy AI: `enemyTurn()` + `stepToward()` (greedy, axis-priority, no real pathfinding).
- Combat: `attack(attacker, defender)` with `Math.max(1, atk-def ± 1)` and a crit-less
  random spread. `gainXp`, `die`, `pickupAt` handle progression.
- Input lock: `busyUntil` timestamp blocks input during the `MOVE_MS` tween.

### Actor & item shape
- Monster (from `makeMonster`): `{kind:'monster', key, name, sprite, x,y, rx,ry,
  hp,maxHp, atk, def, xp, alive}`.
- Player (in `Game.start`): adds `level, xp, xpNext, gold`.
- Item (from `makeItem`): `{kind:'item', key, x,y, sprite, name, amount?}`.

### Sprite/asset coordinate system (important)
- `SPR.foo = [sheetKey, col, row]`. Pixel source = `col*17, row*17`, size `16×16`.
- `drawSprite` already applies the 17px stride; **always address tiles by (col,row)**.
- Sheets currently **loaded** (`assets.js` `SHEETS`): `dungeon`, `chars` only.
- `ctx.imageSmoothingEnabled = false` + CSS `image-rendering: pixelated` keep it crisp.

### Asset inventory (what's available vs used)
| Pack | File | Grid (cols×rows) | Used now? |
| --- | --- | --- | --- |
| Dungeon | `assets/Roguelike Dungeon Pack/Spritesheet/roguelikeDungeon_transparent.png` | 29×18 | Partially (floor/wall/stairs/items) |
| Characters | `assets/Roguelike Characters Pack/Spritesheet/roguelikeChar_transparent.png` | 54×12 | Partially (6 bodies). **Right-hand columns hold modular armor/helmet/weapon/shield layers — unused.** |
| Base | `assets/Roguelike Base Pack/Spritesheet/roguelikeSheet_transparent.png` | 57×31 | **Unused** (outdoor terrain, trees, buildings, doors, fences) |
| City | `assets/Roguelike City Pack/Tilemap/tilemap_packed.png` | 37×28 | **Unused** (urban tiles; also individual `Tiles/tile_XXXX.png`) |
| Interior | `assets/Roguelike Interior Pack/Tilesheets/roguelikeIndoor_transparent.png` | 27×18 | **Unused** (furniture, shop interiors) |

> Tip for any art task: crop with PIL at 17px stride and overlay a labeled grid to
> read exact `(col,row)` coordinates before adding `SPR` entries. The bodies live in
> char columns 0–1; dressed adventurers are rows 5–11.

### Conventions
- Vanilla ES modules, no framework, no bundler, no dependencies. Keep it that way
  unless a milestone explicitly introduces one.
- Grid coordinates are integers (`x,y`); render coordinates are floats (`rx,ry`).
- Anything new that the render loop touches should respect `visible`/`explored`.
- Keep modules single-responsibility; prefer a new `js/<feature>.js` over bloating
  `game.js`.

### Definition of done (applies to every task)
1. Game boots with no console errors (check via preview console).
2. The feature is observable in-browser (screenshot/interaction).
3. No regression to the core loop: start → move/attack → descend → die → restart (R).
4. Update this ROADMAP (check the task box) and `README.md` if behavior/controls change.

---

## Part 2 — Suggested sequencing

Order chosen for impact-per-effort and to lean on assets already owned:

```
M3 [done] → M2 [done] → M5 [done]                 ← make it FEEL good, cheap wins
        → M1 (procgen depth) → M4 (combat systems) ← add DEPTH
        → M6 (meta/progression) → M7 (world/content) ← make it a COMPLETE game
```

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## Part 3 — Milestones & concrete tasks

Each task lists **Files**, an **Approach** hint, and **Done when**. Tasks within a
milestone are roughly ordered; most are independently shippable.

---

### M3 — Better-looking enemies & actors  *(DONE)*
**Goal:** more visual variety and game feel from the art already loaded.

> Implemented: actors are now layered paper-dolls composited in an offscreen
> buffer (`Game.compositeLayers`/`drawActor` in `js/game.js`), with directional
> flipping, idle bob, attack lunge, white hit-flash, fade-out death effects, and
> tinted "elite" variants. Roster: rat/slime (beasts), goblin/bandit/wraith/
> dread-knight (layered humanoids); see `MONSTERS` in `js/entities.js`.

- [x] **M3-T1 — Layered actor sprites.** Render actors as a stack of sprites
  (body + optional armor/helmet/weapon/shield) instead of one flat tile.
  - Files: `js/assets.js` (map the gear-layer `(col,row)` coords; add `SPR` entries or a
    `LAYERS` table), `js/entities.js` (give templates a `layers: []`), `js/game.js`
    `render()` (loop-draw layers in z-order).
  - Approach: first crop the Characters sheet right-hand columns with a labeled grid to
    identify armor/helmet/weapon/shield tiles; define a `drawActor(ctx, actor, sx, sy)`
    helper so player + monsters share one path.
  - Done when: at least 3 monster types use composited gear and look distinct.
- [x] **M3-T2 — Directional facing.** Flip sprites horizontally based on last move dir.
  - Files: `js/entities.js` (add `facing: 1`), `js/game.js` `turn()`/`stepToward()`
    (set facing on horizontal moves), `render()`/`drawSprite` (support `flipX`).
  - Approach: add an optional `flipX` arg to `drawSprite` using `ctx.save/scale(-1,1)`.
  - Done when: actors face the direction they last moved.
- [x] **M3-T3 — Hit flash + death animation.** White flash on damage; squash/fade on death.
  - Files: `js/game.js` `attack()` (set `actor.flashUntil`), `render()` (tint when
    flashing), and a short-lived `effects` list for death fades.
  - Approach: drive timing off `performance.now()`; draw a white rect with
    `globalCompositeOperation='source-atop'` over the sprite, or pre-tint.
  - Done when: hits flash and deaths visibly animate out.
- [x] **M3-T4 — Idle bob + attack lunge.** Subtle vertical bob; lunge toward target on attack.
  - Files: `js/game.js` `loop()`/`tweenActor()`/`render()`.
  - Done when: actors breathe slightly and visibly nudge toward whom they hit.
- [x] **M3-T5 — Elite tint variants.** Color-tinted, stat-boosted enemy variants.
  - Files: `js/entities.js` (`makeMonster` adds optional `tint`/`elite`), `js/game.js`
    render tint pass.
  - Done when: occasional tinted elites appear deeper and hit harder.

### M2 — Audio  *(DONE)*
**Goal:** SFX + ambience with volume control. No audio assets exist yet.

> Implemented in `js/audio.js` as a singleton `audio` (AudioManager): a Web Audio
> graph (master → destination, with `sfxGain`/`musicGain` buses), fully
> procedural SFX (no asset files), an ambient detuned-saw drone with a slow
> filter LFO, and `localStorage`-persisted volumes. `Game.start()` calls
> `audio.init()` + `startAmbient()` from the start gesture; SFX fire from
> `turn/attack/gainXp/pickupAt/beginDescent/die`. A footer mute button + master
> slider are wired in `js/main.js`.

- [x] **M2-T1 — AudioManager module.** Web Audio context, master/SFX/music gain nodes,
  mute toggle, settings persisted to `localStorage`.
- [x] **M2-T2 — Procedural SFX.** Oscillator/noise one-shots for move, attack, hit,
  enemy death, pickup, potion, level-up, descend, player death.
- [x] **M2-T3 — Ambient loop / music.** Low dungeon drone (continuous, on the music bus).
- [x] **M2-T4 — Volume UI.** Footer master slider + mute toggle, persisted across reloads.
  - Note: a fuller settings *panel* (per-bus sliders, etc.) is deferred to M5-T5;
    `audio.setSfx()`/`setMusic()` already exist for it to hook into.

### M5 — Game feel & UI polish  *(DONE)*
**Goal:** readability and juice.

> Implemented in `js/game.js`: a unified `effects` list (death fades + floating
> "float" numbers) plus a `particles` array updated with real `dt` in `loop()`.
> `spawnDamage`/`spawnParticles`/`addShake` fire from `attack`/`pickupAt`/`die`;
> `render()` wraps the world layer in a decaying screen-shake translate and draws
> particles + damage numbers. `renderMinimap()` paints a corner `#minimap` canvas
> from `explored`/`visible`. `bindPointer()` converts canvas px → tile for
> click/tap-to-move. A settings panel (`#settings-panel`, toggled by ⚙) exposes
> master/music/sfx + a screen-shake toggle, wired in `js/main.js` (shake persisted
> under `rl_opts`).

- [x] **M5-T1 — Floating damage numbers.** Rising/fading numbers on hits (and heal/gold).
- [x] **M5-T2 — Screen shake.** Decaying shake on player damage / death; user-toggleable.
- [x] **M5-T3 — Particles.** Blood on hits + deaths, sparkle on pickups; all self-expire.
- [x] **M5-T4 — Minimap.** Corner minimap of explored tiles, monster blips, player marker.
- [x] **M5-T5 — Settings + input options.** Settings panel (volume buses + shake) and
  pointer click/tap-to-move-or-attack (covers mouse and touch via `pointerdown`).
  - Deferred polish: A* path on click (currently one greedy step) and an on-screen
    touch d-pad — revisit alongside M4-T4.

### M1 — Deeper procedural generation
**Goal:** varied, themeable, always-connected floors.

- [ ] **M1-T1 — Generator strategy seam.** Refactor `Dungeon.generate()` to call a
  pluggable generator so multiple algorithms can coexist.
  - Files: `js/dungeon.js` (extract current logic into `genRoomsAndCorridors()`; add a
    `generate(strategy)` dispatch).
  - Done when: current behavior is preserved behind a named strategy.
- [ ] **M1-T2 — New generators.** Add BSP rooms and cellular-automata caves.
  - Files: `js/dungeon.js` (new `genBSP()`, `genCaves()`).
  - Done when: each produces a playable, connected map.
- [ ] **M1-T3 — Connectivity guarantee.** Flood-fill from spawn; reconnect or discard
  unreachable regions; verify stairs reachable.
  - Files: `js/dungeon.js` (post-process step in `generate`).
  - Done when: stairs are always reachable across 100 regen tests.
- [ ] **M1-T4 — Theming by depth.** Introduce a `theme` mapping tile-roles → `SPR`,
  selected by depth (crypt → caverns → city → interior).
  - Files: `js/assets.js` (load Base/City/Interior sheets in `SHEETS`; add coords),
    `js/dungeon.js`/`js/game.js` (render via theme instead of hard-coded `SPR.floor`
    etc.).
  - Done when: at least 2 visually distinct themes appear at different depths.
- [ ] **M1-T5 — Special rooms.** Treasure vault (locked + key), monster nest, shrine.
  - Files: `js/dungeon.js` (tag rooms), `js/entities.js` (`populate` honors tags),
    plus a `key` item + locked-door tile.
  - Done when: special rooms generate and the key/lock interaction works.
- [ ] **M1-T6 — Boss floors.** Every N depths, a special layout + a boss monster.
  - Files: `js/dungeon.js`, `js/entities.js`, `js/game.js` (`nextLevel`).
  - Done when: boss floors trigger on schedule with a tougher unique enemy.

### M4 — Combat & RPG systems
**Goal:** decisions beyond bump-attack.

- [ ] **M4-T1 — Inventory + equipment.** Pick up/equip weapons, armor, shields; stats
  apply to `atk/def`.
  - Files: new `js/inventory.js`; `js/entities.js` (gear item defs), `js/game.js`
    (`pickupAt`, derived-stat calc), `index.html`/`css` (equip panel).
  - Done when: equipping changes stats and is reflected in the HUD.
- [ ] **M4-T2 — Consumables + hotbar.** Potions/scrolls usable from number keys.
  - Files: `js/inventory.js`, `js/game.js` (`bindInput`), HUD.
  - Done when: a hotkey consumes an item and applies its effect.
- [ ] **M4-T3 — Status effects.** Poison/bleed/slow with per-turn ticks + indicators.
  - Files: `js/entities.js` (effect defs), `js/game.js` (`enemyTurn`/turn tick, render
    icon).
  - Done when: slime hits can poison; ticks deal damage with a visible marker.
- [ ] **M4-T4 — A* pathfinding.** Replace greedy `stepToward` with A* on the tile grid.
  - Files: new `js/pathfind.js`; `js/game.js` `enemyTurn`.
  - Done when: enemies route around walls/corners toward the player.
- [ ] **M4-T5 — AI behaviors.** Fleeing at low HP, ranged attackers, simple packs.
  - Files: `js/entities.js` (per-type `behavior`), `js/game.js` `enemyTurn`.
  - Done when: at least one ranged and one fleeing enemy type exist.

### M6 — Progression & meta-game
**Goal:** goals, persistence, replayability.

- [ ] **M6-T1 — Win condition.** Artifact at target depth → escape/victory screen.
  - Files: `js/entities.js` (artifact item), `js/game.js` (`pickupAt`, victory overlay
    via `showOverlay`).
  - Done when: grabbing the artifact and reaching the exit shows a win screen.
- [ ] **M6-T2 — High scores & run history.** Persist best depth/gold/level to
  `localStorage`; show on title/death screens.
  - Files: new `js/scores.js`; `js/game.js` (`die`/`start`), `index.html` overlay.
  - Done when: scores persist across reloads and display.
- [ ] **M6-T3 — Seeded runs.** Replace `Math.random` with a seeded PRNG; show/enter seed.
  - Files: new `js/rng.js`; thread through `js/dungeon.js`, `js/entities.js`.
  - Done when: the same seed reproduces the same run.
- [ ] **M6-T4 — Character classes.** Warrior/rogue/mage starting kits + a signature skill.
  - Files: `js/entities.js` (class defs), `js/main.js`/`index.html` (class select),
    `js/game.js` `start()`.
  - Done when: choosing a class changes starting stats/kit.
- [ ] **M6-T5 — Meta unlocks.** Persistent unlocks earned across runs.
  - Files: `js/scores.js`/new `js/meta.js`; gate content in `entities.js`.
  - Done when: an unlock persists and affects future runs.

### M7 — World & content
**Goal:** a living dungeon and surrounding world.

- [ ] **M7-T1 — NPCs & shops.** Merchant/healer on safe floors using City/Interior art.
  - Files: `js/assets.js` (load + map those sheets), new `js/npc.js`, `js/game.js`
    (interaction + buy UI).
  - Done when: a shop floor lets you spend gold for items/healing.
- [ ] **M7-T2 — Interactables.** Destructible barrels, openable chests, levers.
  - Files: `js/dungeon.js` (object layer), `js/game.js` (`turn` interaction).
  - Done when: chests give loot and barrels break.
- [ ] **M7-T3 — Hazards.** Traps, lava/water, spikes with damage/movement rules.
  - Files: `js/dungeon.js` (tile flags), `js/game.js` (`isWalkable`/on-enter effects).
  - Done when: stepping on a hazard applies its effect.
- [ ] **M7-T4 — Dynamic lighting.** Torch light radii blended with FOV for atmosphere.
  - Files: `js/dungeon.js` (light sources), `js/game.js` `render()` (lightmap pass).
  - Done when: torches cast visible light pools integrated with FOV dimming.

---

## Appendix — Quick recipes

- **Add a new sprite:** crop the sheet at 17px stride to read `(col,row)`, add to `SPR`
  in `assets.js`, draw with `drawSprite(ctx, SPR.key, sx, sy, CELL)`.
- **Add a new monster:** add a template to `MONSTERS` (`entities.js`) with `minDepth`
  + `weight`; `populate()` will spawn it automatically.
- **Add a new item:** add to `ITEMS` + handle its `key` in `Game.pickupAt`.
- **Add input:** extend the `switch` in `Game.bindInput`; remember the `busyUntil` lock.
- **Verify a change:** run the server, open the page, drive it with keyboard events, and
  check the preview console for errors (see "Definition of done").
