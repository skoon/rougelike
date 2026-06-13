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
| `js/pathfind.js` | `findPath()` | A* on the tile grid (enemy navigation) |
| `js/game.js` | `Game`, `showOverlay()` | State, turn loop, combat, items/equipment, status, render, input, HUD |
| `js/scores.js` | `saveRun`, `getBest`, `updateMeta`, `getUnlocks` | Run history, high scores, lifetime meta, unlock flags |
| `js/rng.js` | `seedRng(n)`, `rng()`, `hashSeed(s)` | Mulberry32 seeded PRNG + string hash |
| `js/npc.js` | `NPCS`, `makeNpc`, `genWares` | Merchant/healer templates + shop stock |

### `Dungeon` (js/dungeon.js) cheat-sheet
- Construct: `new Dungeon(w, h, strategy)` where strategy ∈ `"rooms" | "bsp" | "caves"`.
- Tile types: `WALL|FLOOR|STAIRS|LOCKED|SHRINE|WATER`. `LOCKED` blocks move+sight until a
  key opens it; `SHRINE` is walkable and triggers a one-time blessing; `WATER` (cave maps)
  is walkable but deals 1 cold damage per step.
- Fields: `tiles`, `decor`, `visible`, `explored`, `rooms` (empty for caves),
  `startPos`, `stairs`, `floors` (reachable, no-key, excludes vault),
  `vaultCells`/`nestCells`/`shrinePos`/`hasVault` (special rooms; room strategies only),
  `objs[]` (chest/barrel interactables; `getObj/clearObj`), `traps` (Set of hidden
  spike-trap indices), `lights[]` (torch positions + radius for dynamic lighting).
- Generation: `generate(strategy)` → `genRooms`/`genBSP`/`genCaves` → `finalize()`.
  `finalize()` floods from `startPos` (`_bfsFrom`), **seals unreachable floor**, places
  stairs at the farthest reachable cell, and builds `floors`. So *every* strategy is
  guaranteed connected with reachable stairs.
- Other: `carveRoom/carveCorridor/carveH/V`, `scatterDecor`, `roomCells(room)`,
  `_largestRegionCell`, `idx/inBounds/get/set`, `isWalkable`, `blocksSight`,
  `computeFov(ox,oy,radius)`, `lineOfSight(...)` (Bresenham).
- FOV is **per-cell raycast within radius**. Spawning (`populate`) uses `floors`+`startPos`,
  not rooms, so it works for all strategies.

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
| Characters | `assets/Roguelike Characters Pack/Spritesheet/roguelikeChar_transparent.png` | 54×12 | Partially (bodies + armor/weapon layers for paper-dolls) |
| Base | `assets/Roguelike Base Pack/Spritesheet/roguelikeSheet_transparent.png` | 57×31 | **Unused** (outdoor terrain, trees, buildings, doors, fences) |
| Interior | `assets/Roguelike Interior Pack/Tilesheets/roguelikeIndoor_transparent.png` | 27×18 | **Unused** (furniture, shop interiors) |
| Tiny Dungeons Biome | `assets/Tiny Dungeons - Biome Dungeon Pack/dungeon_elements/…` | per-object frame strips | **Unused** (animated chest/barrel/lever/gate/brazier/spikes, rat/slime/flying-skull monsters, tileset, particles) |
| Tiny Dungeons Player | `assets/Tiny Dungeons - Player Extended/…/character_extended.png` | frame strips | **Unused** (animated player: idle/run/jump/push/pull/carry) |
| Tiny Tales NPC Nobility | `assets/Tiny_Tales_Human_NPC_Nobility_1.0/Original/*.png` | RPG-Maker 3×4 walk sheets | **Unused** (noble/monarch NPC walk cycles, 32px & 48px variants) |
| Ambience | `assets/dark_dungeon_ambience.mp3` | — | **Used** as the music-bus ambient loop (M7) |

> Tip for any Kenney-sheet art task: crop with PIL at 17px stride and overlay a labeled
> grid to read exact `(col,row)` coordinates before adding `SPR` entries. The bodies live
> in char columns 0–1; dressed adventurers are rows 5–11. The Tiny Dungeons / Tiny Tales
> packs use **different grids and a different pixel style** than Kenney — measure each
> strip before use and check the bundled `License.txt` files.

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
        → M1 [done] → M4 [done]                     ← add DEPTH
        → M6 [done] → M7 [done]                     ← make it a COMPLETE game
        → M8 [done] → M9 (new art packs)             ← pay down the backlog, look GREAT
        → M10 (balance/QoL) → M11 (ship it)          ← make it a RELEASED game
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

### M1 — Deeper procedural generation  *(DONE)*
**Goal:** varied, themeable, always-connected floors.

> T1–T4 implemented: `Dungeon(w,h,strategy)` dispatches to `genRooms`/`genBSP`/
> `genCaves`, then a shared `finalize()` floods from `startPos`, **seals any
> unreachable floor**, and places the stairs at the farthest reachable cell —
> guaranteeing connectivity for every strategy. `populate()` (entities.js) is now
> generator-agnostic (scatters over `dungeon.floors` away from the entrance).
> `THEMES` in game.js select a strategy + tile palette + fog tint by depth
> (Crypt → Catacombs → Caverns → Sunken Depths), shown in the descent caption.
> Verified with a 600-run Node harness: 0 failures, 0 unreachable tiles.

- [x] **M1-T1 — Generator strategy seam.** `generate(strategy)` dispatch + `finalize()`.
- [x] **M1-T2 — New generators.** `genBSP()` (BSP rooms) and `genCaves()` (cellular automata).
- [x] **M1-T3 — Connectivity guarantee.** `finalize()` floods from `startPos`, walls off
  unreachable floor, and places stairs at the BFS-farthest reachable cell.
- [x] **M1-T4 — Theming by depth.** `THEMES`/`themeForDepth` in game.js drive
  floor/wall/stairs sprites + fog tint per depth.
  - Note: palettes currently all come from the Dungeon sheet (4 distinct looks).
    Loading the Base/City/Interior sheets for richer tilesets is a follow-up.
- [x] **M1-T5 — Special rooms.** `_placeSpecials()` (dungeon.js) tags non-start rooms as a
  locked **treasure vault** (border cells → `LOCKED`; reverts if it would orphan the map),
  a **monster nest**, and/or a **shrine** (`SHRINE` tile). `populate()` drops a reachable
  **key** + rich vault loot + a guardian, and clusters monsters in nests. game.js handles
  unlocking (consumes a key), the one-time shrine blessing (`useShrine`), and renders the
  door/shrine/key (key drawn procedurally — no key sprite in the packs).
- [x] **M1-T6 — Boss floors.** Every 5th depth spawns a unique tinted `makeBoss` near the
  stairs; announced in the log and the descent caption ("⚔ Boss Floor ⚔").

### M4 — Combat & RPG systems  *(DONE)*
**Goal:** decisions beyond bump-attack.

> Implemented: a base-stat + equipment model (`baseAtk/baseDef` →
> `recalcStats()` adds weapon/armor/shield bonuses to effective `atk/def`).
> Gear (`GEAR` tiers in entities.js) drops on floors, auto-equips when better,
> and is managed in an `I` inventory panel (equip / use buttons). Potions go to
> the inventory and are quaffed via the panel or number-key hotbar (1–9), costing
> a turn (`afterAction`). Status effects (`applyStatus`/`tickStatuses`) — slimes
> poison on hit, ticking green damage with an actor tint + HUD chip. Enemies use
> A* (`js/pathfind.js`) and per-type behaviors: rats flee at low HP, wraiths cast
> ranged bolts. Combat refactored into `damageActor`/`killMonster`/`rollDamage`.

- [x] **M4-T1 — Inventory + equipment.** Gear drops + auto-equip + `I` panel; bonuses feed
  `recalcStats` → effective ATK/DEF in the HUD. (Pickup verified live; tier data Node-tested.)
- [x] **M4-T2 — Consumables + hotbar.** Potions carried in inventory; used via panel or
  number keys 1–9 (`useConsumableSlot`), consuming a turn.
- [x] **M4-T3 — Status effects.** Poison from slimes: per-turn tick, green tint + floating
  number + HUD indicator (`tickStatuses`).
- [x] **M4-T4 — A* pathfinding.** `js/pathfind.js` `findPath` (Node-verified, 900 maps);
  `pathStep` routes enemies around walls/locked doors.
- [x] **M4-T5 — AI behaviors.** Rats flee at low HP (`fleeStep`); wraiths attack at range
  (`rangedAttack` + bolt effect). Nests already provide packs (M1).
  - Deferred: bleed/slow statuses and more ranged types — easy extensions of the same hooks.

### M6 — Progression & meta-game  *(DONE)*
**Goal:** goals, persistence, replayability.

> Implemented: `js/scores.js` persists per-run history + best score + lifetime meta
> stats (runs, kills, depth, wins); `js/rng.js` is a mulberry32 seeded PRNG threaded
> through `dungeon.js`, `entities.js`, and gameplay decisions in `game.js` — seeded
> per floor via `seedRng((seed ^ depth*Knuth) >>> 0)`. The title overlay shows a seed
> input (hex, decimal, or word → FNV-1a hash); seed and best score appear on
> death/win overlays. A class-select panel (Warrior / Rogue / Mage) appears after
> the title; each class has distinct starting stats, starting kit, and a signature
> perk (Toughness / Backstab / Arcane). Four meta unlocks (hardened / shadowcraft /
> archmage / veteran) gate bonus upgrades behind lifetime milestones and are
> annotated live in the class-select panel.

- [x] **M6-T1 — Win condition.** `the Forgotten Relic` artifact spawns at depth 10;
  picking it up triggers `showWin()`. `pickupAt` returns `true` to end the turn cleanly.
- [x] **M6-T2 — High scores & run history.** `js/scores.js` — `saveRun`/`getBest`;
  death overlay shows personal-best line; title shows last best run.
- [x] **M6-T3 — Seeded runs.** `js/rng.js` mulberry32 + `hashSeed` (string→u32);
  seeded each floor; seed input on title screen; seed shown in death/win overlays.
- [x] **M6-T4 — Character classes.** `CLASSES` in `entities.js`; class-select panel in
  `index.html`; `applyClass()` in `game.js`; class badge shown in HUD.
- [x] **M6-T5 — Meta unlocks.** `updateMeta`/`getUnlocks` in `scores.js`; four
  milestones (depth 5 / 50 kills / 1 win / 10 runs) buff classes; active upgrades
  annotated in the class-select panel.

### M7 — World & content  *(DONE)*
**Goal:** a living dungeon and surrounding world.

> Background music swapped to `assets/dark_dungeon_ambience.mp3` (mp3 via
> `createMediaElementSource`). Procedural drone kept but commented out in `audio.js`.

- [x] **M7-T1 — NPCs & shops.** Merchant (every 3rd floor) and healer (every 4th floor)
  spawn on non-boss floors. Bump into them to open a shop overlay. Merchants sell 3
  randomly generated items; healers restore HP for gold.
  - Files: new `js/npc.js` (NPC types, `makeNpc`, `genWares`), `js/game.js`
    (`nextLevel` NPC spawn, `openShop`, `npcAt`, `_itemPrice`, `drawNpcIndicator`),
    `index.html` (`#shop-panel`), `css/style.css` (shop styles).
- [x] **M7-T2 — Interactables.** Chests (procedural loot) and barrels (occasional gold)
  scatter across every floor. Walking onto them triggers the effect; chests play the
  levelUp fanfare; barrels smash with hit + particles.
  - Files: `js/dungeon.js` (`objs[]`, `_placeInteractables`, `getObj/clearObj`),
    `js/game.js` (`turn` obj check, `useObject`, `drawChest`, `drawBarrel`).
- [x] **M7-T3 — Hazards.** Hidden spike traps (2–5 damage, removed on trigger) and
  water tiles (1 cold damage per step) on cave maps. Traps stored in `dungeon.traps`
  Set; water is `WATER = 5` tile type with ripple overlay.
  - Files: `js/dungeon.js` (`WATER`, `_placeTraps`, `_placeWater`, `isWalkable`),
    `js/game.js` (water/trap handling in `turn`, `drawWaterOverlay`).
- [x] **M7-T4 — Dynamic lighting.** Torches (≈2% of floor tiles) stored in
  `dungeon.lights[]`. Each torch emits a warm radial gradient in `lighter` composite
  mode, pulsing on visible tiles and faintly glowing on explored-but-unseen tiles.
  - Files: `js/dungeon.js` (`lights[]`, torch in `scatterDecor`),
    `js/game.js` (torch glow pass in `render`, `drawTorch`).

### M8 — Deferred polish backlog  *(DONE — pending manual verification of T2/T4 visuals)*
**Goal:** close out every "deferred" note left in M1–M5 so no milestone has loose ends.

> Implemented: `autoPath` click-to-move in game.js (`bindPointer`/`autoStep`, stepped
> from `loop()`), cancelled by key input, player damage, shop, descent, or a newly
> visible monster ("You stop — something stirs ahead."). `#dpad` overlay + settings
> toggle (`opt-dpad`, auto-on for coarse pointers). Bleed/slow statuses via the shared
> `worldTurn()` (slow grants the world an extra `enemyTurn()` on alternating actions);
> skeleton archer + frost wisp with per-template tints and styled bolts. Distinct
> theme walls picked from the **Dungeon sheet** (not Base/Interior — same-style tiles
> existed already): Catacombs (16,7) earthen brick, Caverns (16,2) gray stone, Sunken
> Depths (4,12) deep water; Crypt unchanged. Verified live: click-to-move walks long
> paths, opens chests en route, halts on traps/new threats; poison chip + combat
> regression-tested to depth 2. Not yet eyeballed: d-pad layout, depth 3+/5+/7+ walls,
> bleed/slow/archer/wisp in the wild (templates Node-tested).

- [x] **M8-T1 — Click-to-move with A\*.** Clicking/tapping a tile walks the whole path,
  not one greedy step (deferred from M5-T5).
  - Files: `js/game.js` (`bindPointer`, new `autoPath` field, auto-step in `loop()`),
    reuses `js/pathfind.js` `findPath`.
  - Approach: on `pointerdown`, run `findPath` from the player to the clicked tile
    (monsters block; raise `maxNodes` — long cave paths exceed the 600 default) and store
    the step list. In `loop()`, when `now >= busyUntil` and a path is queued, feed the
    next step to `turn(dx,dy)`. **Cancel** the path when the player takes damage, a
    monster becomes visible, a key is pressed, or the next step is no longer walkable.
  - Done when: clicking a far explored tile walks around corners; the walk halts on
    danger; clicking adjacent tiles / monsters still behaves as before (single step,
    attack, shop).
- [x] **M8-T2 — On-screen touch d-pad.** Playable without a keyboard (deferred from M5-T5).
  - Files: `index.html` (`#dpad` overlay in `#stage`), `css/style.css` (show via
    `@media (pointer: coarse)` plus a settings checkbox override), `js/main.js`/`js/game.js`
    (wire buttons → `game.turn`).
  - Approach: 4 arrow buttons + center wait, semi-transparent, bottom-left of the stage;
    `pointerdown` + repeat-while-held (interval ≥ `MOVE_MS`); `touch-action: none`.
  - Done when: a full run (start → fight → descend) works in DevTools touch emulation
    with the keyboard untouched, and the pad never appears for mouse users by default.
- [x] **M8-T3 — Bleed & slow statuses + new ranged foes.** (deferred from M4-T5).
  - Files: `js/entities.js` (two `MONSTERS` entries + per-template `tint` support in
    `makeMonster`), `js/game.js` (`tickStatuses` cases, `attack`/`rangedAttack` hooks,
    HUD status chips), `css/style.css` (status colors).
  - Approach: **bleed** mirrors poison (red, 3 turns, from bandit/dread-knight hits);
    **slow** makes the victim lose every other action — for the player, grant the world
    an extra `enemyTurn()` on alternating turns while slowed. New foes: a **skeleton
    archer** (ranged 6, bone-white tint, arrow bolt) and a **frost wisp** (ranged 4, icy
    tint, bolt applies slow), both reusing existing char-sheet layers + tint.
  - Done when: bandits sometimes cause bleed (red tick + HUD chip), wisp bolts slow the
    player (log + chip + visible effect), and both foes spawn at their `minDepth`.
- [x] **M8-T4 — Distinct theme tilesets.** All four themes currently share one wall tile
  (deferred from M1-T4).
  - Files: `js/game.js` (`THEMES` wall entries).
  - Implementation note: the **Dungeon sheet** turned out to already hold three more
    full wall styles in the existing art style (earthen brick, gray stone blocks, deep
    water), so no new sheets were loaded; the Base/Interior idea was unnecessary.
  - Done when: stepping through depths 1→8 shows four visually distinct wall/floor
    combinations with no missing-sprite artifacts.

### M9 — New art pack integration  *(T1/T3/T4 done; T2 remaining)*
**Goal:** put the Tiny Dungeons / Tiny Tales packs (added to `assets/` during M4) on
screen: animated objects, real NPC sprites, animated monsters.

> Implemented: `STRIP_DEFS`/`STRIPS` + `drawFrame(ctx, key, col, row, dx, dy, scale)`
> in assets.js (margin-less frame strips, loaded alongside the Kenney sheets). The fx
> compositing buffer is now **2×2 cells** (64px) and `compositeActor()` draws either
> paper-doll `layers` or a `strip` frame (`{key, idle:[row,n], death:[row,n], faces,
> rate}`) with the same flip/tint/flash pipeline; actors blit at `(sx-CELL/2,
> sy-CELL/2)`. Rat/slime/skull play their real death animations via `animOverride`.
> Chests/barrels + new pots (4 variants) and crates render from strips and play
> one-shot open/smash animations (`type:"obj"` effects); braziers (animated, radius-4
> light) join torches in `scatterDecor`. Licenses checked: both packs allow game use,
> no redistribution of raw assets — credit in M11-T3.
> Verified live on depth 1: chests/barrel/pot interactions, animated rats, no console
> errors; eyeball NPC anchoring (depth 3+), skull (depth 4+), and death anims in play.

- [x] **M9-T1 — Animated interactables.** Chest/barrel strips with open/smash one-shot
  animations; pots (`dungeon_pot_01–04`) and crates added as smashables (pots can hide
  a potion); animated braziers as light-shedding decor.
  - Files: `js/assets.js` (strip loader), `js/game.js` (`drawObj`, obj-anim effects,
    `useObject`, brazier decor branch), `js/dungeon.js` (`_placeInteractables`,
    `scatterDecor`).
- [ ] **M9-T2 — Levers & gates.** A lever (`dungeon_lever.png`) somewhere on the floor
  opens a gate (`dungeon_gate.png`) elsewhere — a second, art-driven flavor of the
  vault/key mechanic. Animate the spike trap (`dungeon_spikes.png`) once sprung instead
  of deleting it.
  - Files: `js/dungeon.js` (gate tile or obj + lever obj), `js/game.js` (`turn` lever
    handling, gate render/walkability).
- [x] **M9-T3 — NPC sprites & portraits.** Merchant = `Noble_M1`, healer = `Princess_F1`
  (Tiny Tales walk sheets, 16×20 frames, slow idle sway); standing-pose portrait drawn
  into `#shop-portrait` in the shop header.
  - Files: `js/npc.js`, `js/game.js` (`openShop` portrait), `index.html`/`css/style.css`.
- [x] **M9-T4 — Animated monsters.** Rat and slime now use the animated Tiny Dungeons
  strips (slime tinted green to keep its identity); new **blazing skull** melee monster
  (minDepth 4) from `dungeon_flying_skull.png`. Strip deaths play the pack's death rows.
  - Files: `js/assets.js`, `js/entities.js` (`strip` template field), `js/game.js`
    (`compositeActor`, death effects).

### M10 — Balance & quality of life
**Goal:** make the existing content fair, tunable, and comfortable.

- [ ] **M10-T1 — Difficulty curve pass.** Headless Node sim (auto-player) over seeds ×
  depths × classes; tune monster scaling, gear tiers, gold/heal prices from the results.
  - Files: new `test/sim.js` harness; tuning constants in `entities.js`/`game.js`.
- [ ] **M10-T2 — Death recap.** Death/win overlay gains a run summary: kills, gold,
  floors, cause of death, run duration; recent-runs list from `scores.js` history.
- [ ] **M10-T3 — Key rebinding + pause.** Settings panel section to remap movement/wait/
  inventory keys (persist in `rl_opts`); `Esc`/`P` pauses the rAF world.
- [ ] **M10-T4 — Readability options.** Colorblind-safe alternates for HP/poison/bleed
  hues, UI scale slider, reduced-flash mode (caps screen shake + hit flash).

### M11 — Packaging & release
**Goal:** something people can play without cloning a repo.

- [ ] **M11-T1 — itch.io build.** Script (`build.ps1` or npm-free Node script) that zips
  `index.html + css + js + only the asset files actually loaded` (the packs are huge —
  ship only what `assets.js`/`audio.js` reference).
- [ ] **M11-T2 — PWA / offline.** `manifest.json` + tiny service worker precaching the
  same file list; favicon + social meta tags.
- [ ] **M11-T3 — README & screenshots.** Hero GIF/screenshots, controls, credits section
  for Kenney / Tiny Dungeons / Tiny Tales licenses.

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
