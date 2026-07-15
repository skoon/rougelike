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
        → M8 [done] → M9 [done]                      ← pay down the backlog, look GREAT
        → M18 [done] → M10 [done] → M11 [done]       ← make it a RELEASED game
        → M12 [done] → M15 [done] → M17 [done] → M13 [done] → M14 [done] → M16  ← post-1.0 depth & replayability
```

**M18 [done]** fixed the release-blocking bug where NPCs could seal the stairs.
Post-1.0 milestones (M12–M17) are independent except where noted
(M14 builds on M13; M17 extends the M7 shop). Suggested order by impact-per-effort:
**M12** (abilities) → **M15** (daily run, cheap) → **M17** (selling) →
**M13 → M14** (loot overhaul pair) → **M16** (resource clock).
**M16** (resource clock: torchlight & rations) and **M19** (surface base camp, in
progress) are the last remaining milestones.

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

### M8 — Deferred polish backlog  *(DONE)*
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
> regression-tested to depth 2. Remaining visuals (d-pad layout, depth 3+ walls,
> bleed/slow/archer/wisp in the wild) confirmed by the user's manual playthrough.

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

### M9 — New art pack integration  *(DONE)*
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
> errors; NPC anchoring (depth 3+), skull (depth 4+), and death anims confirmed by
> the user's manual playthrough.

- [x] **M9-T1 — Animated interactables.** Chest/barrel strips with open/smash one-shot
  animations; pots (`dungeon_pot_01–04`) and crates added as smashables (pots can hide
  a potion); animated braziers as light-shedding decor.
  - Files: `js/assets.js` (strip loader), `js/game.js` (`drawObj`, obj-anim effects,
    `useObject`, brazier decor branch), `js/dungeon.js` (`_placeInteractables`,
    `scatterDecor`).
- [x] **M9-T2 — Levers & gates.** `GATE = 6` tile + `_placeGate()` carves a 3×3 treasure
  alcove into a solid 5×5 wall pocket on ~40% of floors (60% roll × pocket availability),
  sealed by a portcullis; a lever obj on distant reachable floor opens it (one-shot gate
  animation, "gate grinds open" log, open-arch decor remains). Carving only converts WALL,
  so connectivity can't break — Node-verified on 600 maps: lever always reachable,
  interior sealed pre-pull and reachable post-open, stairs unaffected, 2–3 loot items
  (depth+1 tier) inside. Sprung spike traps now play the pop-up animation and leave
  visible spent-spike studs instead of vanishing. Verified live with seed 32.
  - Files: `js/dungeon.js` (`GATE`, `_placeGate`, `blocksSight`), `js/game.js` (`turn`
    gate bump + trap decor, `useObject` lever branch, gate/decor render, minimap),
    `js/entities.js` (`populate` gate loot), `js/assets.js` (lever/gate/spikes strips).
- [x] **M9-T3 — NPC sprites & portraits.** Merchant = `Noble_M1`, healer = `Princess_F1`
  (Tiny Tales walk sheets, 16×20 frames, slow idle sway); standing-pose portrait drawn
  into `#shop-portrait` in the shop header.
  - Files: `js/npc.js`, `js/game.js` (`openShop` portrait), `index.html`/`css/style.css`.
- [x] **M9-T4 — Animated monsters.** Rat and slime now use the animated Tiny Dungeons
  strips (slime tinted green to keep its identity); new **blazing skull** melee monster
  (minDepth 4) from `dungeon_flying_skull.png`. Strip deaths play the pack's death rows.
  - Files: `js/assets.js`, `js/entities.js` (`strip` template field), `js/game.js`
    (`compositeActor`, death effects).

### M10 — Balance & quality of life  *(DONE)*
**Goal:** make the existing content fair, tunable, and comfortable.

- [x] **M10-T1 — Difficulty curve pass.** `test/sim.js` — a headless optimal-play
  auto-player that imports the real dungeon/entities/rng modules and mirrors game.js's
  combat + leveling formulas, then reports win%, avg depth/level, min-HP, "scary run"
  rate, death-by-depth histogram, and top killers per class. Env knobs (`ATK_MULT`,
  `HP_MULT`, `LVL_HEAL`, `DEBUG`) for sweeping. **Finding:** the late game was trivial —
  player DEF (~14) + HP (~100) outscaled monster ATK (~11-14), so nearly every hit did
  the minimum 1 damage; HP/heal tweaks did nothing because no damage was landing.
  **Fix:** `makeMonster` ATK lifted ~70% (`round((base + steps) * 1.7)`) so it keeps
  pace with DEF. Result: optimal play still wins ~99-100% (mastery rewarded, headroom
  for the real game's omitted difficulty) but with genuine back-half attrition — min-HP
  ~26-38%, scary-run rate scaling warrior<rogue<mage; early floors stay gentle for the
  sturdy classes. Run: `node test/sim.js [runs] [maxDepth]`.
  - Files: `test/sim.js` (harness), `js/entities.js` (`makeMonster` ATK scaling).
  - Note: the sim is *optimal-play* (perfect focus-fire/potion use, no traps/ranged/
    DoT/forced mobs), so real-game difficulty is higher — tune conservatively against it.
- [x] **M10-T2 — Death recap.** The death/win overlay now shows a recap panel: a
  class/depth/level/gold/kills/time stat grid, the seed, and a "Recent runs" list from
  `scores.js` history (win/loss coloured). Death subtitle names the killer ("Slain by
  the giant rat on depth N"). Cause of death is tracked via a `cause` arg threaded
  through `damageActor` (melee/ranged attacker name, traps, water, poison/bleed); run
  duration from `runStart`. `saveRun` now stores a full run object (cls, kills, cause,
  seed, ms, at) and `getHistory()` exposes it. Verified live (mage death → recap grid +
  killer subtitle render correctly).
  - Files: `js/scores.js` (`saveRun` object form, `getHistory`), `js/game.js`
    (`buildRun`/`renderRecap`, `damageActor` cause, `showOverlay` recap reset),
    `index.html` (`#overlay-recap`), `css/style.css` (recap styles).
- [x] **M10-T3 — Key rebinding + pause.** Settings "Controls" section remaps
  up/down/left/right/wait/inventory/pause (click a slot → press a key; arrows stay as
  fixed movement fallbacks); persisted in `rl_opts.keys` with a reset button. `P`
  (rebindable) or `Esc` pauses — the rAF loop freezes the world and draws a "Paused"
  banner; input/pointer/d-pad are blocked while paused. Verified live (pause blocks
  moves, K-rebind moves & unbinds W, reset restores W).
  - Files: `js/game.js` (`DEFAULT_KEYS`/`KEY_ACTIONS`, `setKeymap`/`actionForKey`/
    `togglePause`/`drawPauseOverlay`, `captureKey` guard, paused loop), `js/main.js`
    (rebind UI + capture), `index.html`, `css/style.css`.
- [x] **M10-T4 — Readability options.** Settings "Readability" section: reduced-flash
  (caps screen shake to 2.5 and hit-flash alpha to 0.3), a red-green-safe colorblind
  palette (canvas status/heal tints via `Game.palette()`, plus a `body.cb` CSS remap of
  the HP bar, log good/bad, and status chips), and a UI-scale slider (80-120%, drives
  `--game-width`). All persisted in `rl_opts`. Verified live.
  - Files: `js/game.js` (`palette()`, `reduceFlash`/`colorblind` in `drawActor`/
    `addShake`/`tickStatuses`/heal), `js/main.js` (`applyReadability` + controls),
    `index.html`, `css/style.css` (`body.cb`, `--game-width`).

### M11 — Packaging & release  *(DONE)*
**Goal:** something people can play without cloning a repo.

- [x] **M11-T1 — itch.io build.** `scripts/build.mjs` (dependency-free Node) assembles
  `dist/` + a zip from `index.html` + `css/` + `js/` + only the loaded asset files
  (~2.7 MB vs. the raw packs' hundreds of MB). `ASSET_FILES` (assets.js) + `MUSIC_FILE`
  (audio.js) are the single source of truth; the build errors if a referenced asset is
  missing. Verified: 20 files bundled, zip produced.
- [x] **M11-T2 — PWA / offline.** `manifest.json` + `sw.js` (shell precache + cache-first
  runtime caching); generated `icon-192/512.png`, `favicon.png/.ico`; theme-color + OG/
  social meta in `index.html`. SW registers only off-localhost (keeps the dev port-bump
  cache-busting working). Verified booting clean; manifest/icons load 200.
- [x] **M11-T3 — README & credits.** README gained Build & deploy + Credits sections
  (Kenney CC0 / Tiny Dungeons by Roupiks / Tiny Tales by Megatiles–Rayane Félix, per the
  packs' `License.txt`). Gameplay screenshots left for a manual capture (the canvas→file
  bridge wasn't worth the cost); the app icon doubles as the marketing image.

---

## Part 4 — Post-1.0 milestones (M12–M16)

Depth and replayability features beyond the shippable game. Same task format as
Part 3 (**Files** / **Approach** / **Done when**).

---

### M12 — Active class abilities  *(DONE)*
**Goal:** turn the three stat profiles into three real playstyles. Combat was pure
bump-attack; the Mage now has the ranged option its fantasy implied. Each class has two
activated abilities on a turn-cooldown, fired from Q / E (rebindable).

> Implemented: `CLASSES[*].abilities` data (`js/entities.js`); `ability1`/`ability2`
> actions in `DEFAULT_KEYS`/`KEY_ACTIONS` (default q/e, flow through the M10 rebind UI);
> `useAbilitySlot`/`useAbility` dispatch in `js/game.js`. Turn/cooldown bookkeeping via
> `turnCount` (incremented in `worldTurn`) and `player.cooldowns[id]`; abilities that need
> a target no-op (no turn, no cooldown) instead of whiffing. HUD shows each ability as
> `KEY Name ●` (ready) or `KEY Name N` (turns left). Verified live: cooldown lifecycle
> (fire → set → tick down → "recharging" no-op), key handling, no-target no-op, clean boot.

- [x] **M12-T1 — Ability framework + cooldowns.** `useAbilitySlot(n)`/`useAbility(ability)`;
  `turnCount` drives `player.cooldowns[id]`; two rebindable keys. Verified live.
- [x] **M12-T2 — The six abilities.** Warrior **Cleave** (hit all adjacent) + **Brace**
  (halve incoming damage until next turn, via `braceUntil` in `damageActor`). Rogue
  **Dash** (blink beside the nearest visible foe + guaranteed backstab) + **Smoke**
  (`smokeUntil`; non-adjacent foes lose track in `enemyTurn`). Mage **Firebolt**
  (player-sourced bolt at nearest LOS foe, +4 fire) + **Frost Nova** (slow + chip all
  adjacent). Reuses `attack`/`rollDamage`/`applyStatus`/`spawnParticles`/bolt effects.
- [x] **M12-T3 — Ability HUD.** Cooldown chips in `updateHud` (ready ● / N turns), styled
  `.ability.ready`/`.cooling`; Q/E hint in the help footer. (A render-time range telegraph
  was deemed unnecessary — abilities auto-target the nearest valid foe.)

### M13 — Item depth: scrolls, wands & rings  *(DONE)*
**Goal:** loot beyond gold / potion / weapon / armor / shield. Add consumable **scrolls**,
charge-based **wands**, and a **ring/amulet equip slot** with passive bonuses. (Note:
`amulet` is already an item key that today only awards gold — repurpose or split it.)

> Implemented: `makeItem` (`js/entities.js`) grows three new branches — **scroll**
> (`category:"consumable"`, sub-kinds teleport/map/enchant), **wand** (`category:"wand"`,
> fire/frost, `charges` 3-6, `power`, `boltColor`), and **ring** (`category:"equip"`,
> `slot:"ring"`, affix regen/crit/resist with a `desc`). `randomLootKind`, chest loot
> (`Game.useObject`), and merchant `WARE_POOL` (`js/npc.js`) all distribute them.
> `_itemPrice` prices the new keys (wands scale with charges, rings with affix power).
> A shared `Game.gearMeta(it)` renders effect text for every gear slot (ring shows its
> affix). The hotbar/inventory now act on `usableItems()` (consumables **and** wands) via
> `useInventoryItem` → `useConsumable`/`useWand`; methods that can't take effect (wand with
> no target, enchant with nothing equipped) return false so they cost neither a turn nor the
> item. `player.equip.ring` folds into `recalcStats` as `regen`/`critChance`/`resist`,
> consumed by `worldTurn` (HP trickle every 3 turns), `attack` (crit) and `damageActor`
> (warding). New procedural world icons `drawScroll`/`drawWand`/`drawRing`. Verified: module
> load + node unit tests of all three scrolls, wand fire/no-op, and ring recalc; sim.js
> still 99.7% (loot-table change didn't disturb balance).

- [x] **M13-T1 — Scrolls.** **Teleport** (random reachable floor tile + camera snap),
  **Magic Map** (`dungeon.explored.fill(true)`), **Enchant** (+1 to a random equipped piece;
  ring affixes bump their `power`/`desc` instead). A scroll that can't fire is not consumed.
  - Files: `js/entities.js` (`scroll` sub-kinds), `js/game.js` (`useScroll`, `useConsumable`
    return value, no-op guards on the hotbar/panel use paths).
- [x] **M13-T2 — Wands.** `useWand` fires a player-sourced bolt at the nearest visible foe
  (reuses `nearestVisibleMonster`/`rollDamage`/bolt effects), +`power` damage, frost wands
  slow; depletes a charge and the item crumbles at 0. Charges shown in inventory/shop.
  - Files: `js/entities.js` (`wand` category, `charges`), `js/game.js` (`useWand`,
    `usableItems`/`useInventoryItem`, `drawWand`).
- [x] **M13-T3 — Ring slot.** `player.equip.ring` with three affixes folded into
  `recalcStats` (`regen` HP/3turns, `crit` % in `attack`, `resist` % in `damageActor`); the
  inventory panel gained a Ring row + `gearMeta` effect text.
  - Files: `js/game.js` (`equip.ring`, `recalcStats`, `gearMeta`, regen tick, crit, resist,
    inventory slot, `drawRing`), `js/entities.js` (ring affixes in `makeItem`).
  - Note: `amulet` stays a gold-category pickup (untouched); rings are the new equip slot.

### M14 — Identification & curses  *(DONE, builds on M13)*
**Goal:** classic risk/reward — unknown items are a gamble until identified, and some are
cursed (locked on, hidden malus) in exchange for a strong bonus.

> Implemented: `makeItem` (`js/entities.js`) tags every equip piece and wand
> `identified:false`, and rolls `cursed:true` on ~22% of gear — cursed gear gets a stronger
> pull (weapon/armor/shield `bonus +2`; ring affix boosted) **and** a hidden drawback
> (a `malusAtk`/`malusDef` to the opposite stat). `Game.displayName(it)` renders an obscured
> name by slot ("a glowing ring", "an unknown weapon", "an unmarked wand") until identified;
> `itemPhrase` handles log articles. Items reveal on **equip** (`equipItem` → `identify`),
> on **wand use** (`useWand`), or via two new scrolls — **identify** (appraises all carried
> unknowns, exposing curses before you wear them) and **remove curse** (frees + de-maluses
> all worn cursed gear). `tryAutoEquip` no longer auto-equips unknown gear (you must choose
> to gamble), and `equipItem` refuses to swap **out** a cursed piece. `recalcStats` folds the
> cursed malus into ATK/DEF; `gearMeta` shows it. Merchant wares are pre-appraised
> (identified, never cursed). Inventory marks cursed pieces in red ("cursed"). Verified:
> node unit tests of obscured naming, identify-on-equip, cursed lock-out, malus math,
> identify/remove-curse scrolls; 19% cursed-rate over 400 rolls; sim.js still clean.

- [x] **M14-T1 — Unidentified items.** Gear/rings/wands spawn `identified:false`, show an
  obscured name, and resolve on equip/use or a **Scroll of Identify** (reveals all carried
  unknowns, including their cursed status).
  - Files: `js/entities.js` (`identified` flag), `js/game.js` (`displayName`/`itemPhrase`/
    `identify`, name gating in `renderInventory`/pickup logs/shop, identify-on-equip/use,
    `useScroll` identify branch).
- [x] **M14-T2 — Curses.** ~22% of gear rolls `cursed:true`: a higher bonus plus an opposite-
  stat malus, locked on once worn (`equipItem` won't swap it out; reveal log + red tint +
  particle). A **Scroll of Remove Curse** lifts the curse and its malus.
  - Files: `js/entities.js` (`cursed` roll + `malusAtk`/`malusDef`), `js/game.js`
    (`recalcStats` malus, `equipItem` lock + reveal, `useScroll` uncurse branch),
    `css/style.css` (`.inv-name.cursed`, `em.curse`).
  - Note: deviates slightly from "malus *or* can't-unequip" — cursed gear has **both** a
    malus and the lock, so the lure (stronger bonus) is a genuine gamble, not free power.

### M15 — Daily challenge & leaderboard  *(DONE)*
**Goal:** a shared, fixed-seed run per day for competition and replay. Leans entirely on
the existing seeded PRNG and run-history persistence.

> Implemented: a "Daily Run" button (`#overlay-btn2`) on the title overlay starts a run
> seeded by `hashSeed("daily-" + UTC-YYYY-MM-DD)` — deterministic worldwide and stable on
> replay. `Game.start(seed, cls, dailyDate)` records `this.dailyDate`; `buildRun` tags the
> saved run with `daily`. `scores.getDailyRuns(date)` powers a "Today's daily" board on the
> title (run count + best depth/Lv/gold) and a daily badge on the death/win recap. Verified
> live: both title buttons, daily board renders from persisted data, deterministic seed
> (Node-checked), clean boot.

- [x] **M15-T1 — Daily seed.** UTC-date seed via `hashSeed("daily-"+date)`; "Daily Run"
  button → class select → `game.start(dailySeed, cls, date)`. Same dungeon for everyone on
  a given day; identical on replay.
  - Files: `js/main.js` (button, `chooseClass` refactor, date→seed), `js/game.js`
    (`start` `dailyDate`), `index.html`/`css` (button + board).
- [x] **M15-T2 — Daily board.** Runs tagged `daily:"YYYY-MM-DD"` in `buildRun`/`saveRun`;
  `getDailyRuns` filter; "Today's daily" board on the title + daily badge in `renderRecap`.
  - Files: `js/scores.js` (`getDailyRuns`), `js/game.js` (`buildRun`, recap badge),
    `js/main.js` (title board).
  - No hard lockout (a local game shouldn't bar replays); attempts are listed and the best
    is highlighted. Data shape (`daily` field) is ready for a future cross-player backend.

### M16 — Resource clock: torchlight & rations
**Goal:** add forward pressure so a floor isn't a pure puzzle. A depleting light/food
meter drains per turn, shrinking FOV as it runs low, refilled by braziers (already in the
world) and found torches/rations.

> Context: FOV is `dungeon.computeFov(x, y, FOV_RADIUS)` called from `Game.turn`/
> `worldTurn`; `FOV_RADIUS` is a constant in `js/game.js`. Braziers are placed in
> `scatterDecor` (`js/dungeon.js`) and already shed light.

- [ ] **M16-T1 — Fuel meter.** A `fuel` counter on the player, decremented each turn in
    `worldTurn`; a HUD bar beside HP.
  - Files: `js/game.js` (`player.fuel`, tick, `updateHud` bar), reset/refill on descent.
  - Done when: fuel drains visibly per turn and refills are possible.
- [ ] **M16-T2 — Dimming FOV + refills.** Scale the radius passed to `computeFov` down as
    fuel drops (e.g. 8 → 3); braziers become interactable refills; add `torch`/`ration`
    pickups.
  - Files: `js/game.js` (dynamic FOV radius, brazier interaction in `turn`),
    `js/dungeon.js`/`js/entities.js` (refill items).
  - Done when: low fuel tightens vision and stepping on a brazier / using a torch restores
    it — creating a real "keep moving" tension. Balance the drain rate via `test/sim.js`.

### M17 — Selling to merchants  *(DONE)*
**Goal:** make merchants two-way. The player can sell carried gear/consumables for gold,
and each merchant carries a finite gold purse so selling is a resource, not infinite money.

> Implemented: each merchant gets a finite purse `40 + depth * 15` (set in
> `Game.nextLevel`, defaulted to `0` in `makeNpc`), shown as "Purse: Ng" in the shop header
> (`#shop-purse`). `openShop` now appends a **Sell** section (`#shop-sell`) listing every
> carried `player.inventory` item with `_sellPrice(it)` (= `floor(_itemPrice * 0.5)`, min 1);
> clicking "Sell" splices the item out, moves gold both ways (`p.gold += price`,
> `npc.gold -= price`), logs it, and re-renders. Rows disable when the purse can't cover the
> price. Equipped gear stays equipped (only carried inventory is sellable). The shop card was
> made scrollable so long buy+sell lists keep the Leave button reachable (`#shop-scroll`).
> Verified live.

- [x] **M17-T1 — Merchant gold purse.** Purse `40 + depth * 15` set in `nextLevel`, shown in
  the shop header (`#shop-purse`).
  - Files: `js/npc.js` (`makeNpc` merchant `gold`), `js/game.js` (`nextLevel`, `openShop`),
    `index.html`/`css` (`#shop-purse`).
- [x] **M17-T2 — Sell UI + transaction.** `#shop-sell` section lists carried inventory with
  `_sellPrice`; selling transfers gold both ways and shrinks the purse (rows disable when the
  merchant can't afford it). Gold is conserved (splice + single transfer, no duplication).
  - Files: `js/game.js` (`_sellPrice`, sell list + handler in `openShop`),
    `index.html` (`#shop-sell`, `#shop-scroll`), `css/style.css` (`.shop-head-row`, scroll).
  - Note: only carried inventory sells; amulets are gold-category (auto-converted on pickup),
    so they never reach the sell list.

### M18 — Bugfix: blockers can seal the stairs  *(DONE)*
**Goal:** fix the bug where a merchant, healer, or locked door can occupy the only
approach to the down-stairs, making a floor impossible to descend without a workaround.

> Root cause (confirmed): NPCs are non-walkable and `Game.npcAt` intercepts a step into
> them to open a shop instead of moving, so an NPC on a 1-wide choke tile walls off
> whatever is behind it. The healer was placed with `findFloorNear(this.dungeon.stairs, 6)`
> — deliberately near the stairs — with no reachability check; `test/stairs.js` measured
> that **3.3% of those candidate tiles would seal the stairs**. Locked doors, by contrast,
> never can: `finalize()` places the stairs at the farthest cell found by `_bfsFrom`, which
> already models no-key movement (`WALL`+`LOCKED` block it), so the stairs is reachable
> without a key by construction.

- [x] **M18-T1 — Reachability-safe blocker placement.** `Game.tileSafeToBlock(x, y)` does a
  BFS from `startPos` to `stairs` over `isWalkable`, treating `(x,y)` and any already-placed
  NPCs as impassable. `findFloorNear` gained an optional `filter`; merchant and healer
  placement now require a safe tile (widening the search ring, and skipping the NPC entirely
  rather than blocking the run if none exists).
  - Files: `js/game.js` (`tileSafeToBlock`, `findFloorNear` filter arg, NPC placement in
    `nextLevel`).
  - Done when: NPCs never spawn on a stairs choke point. ✔ (4500-map test: 0 unsafe placements.)
- [x] **M18-T2 — Doors never gate the stairs without a key route.** Verified already
  guaranteed: `finalize()` only ever sites the stairs on a no-key-reachable cell (and the
  existing vault-orphan revert keeps that true), so a `LOCKED` door can't be the sole path.
  Covered by the regression test rather than new code.
  - Files: `js/dungeon.js` (`finalize`/`_bfsFrom` — no change needed; behaviour asserted).
  - Done when: the stairs is always reachable without a key. ✔ (4500-map test: 0 failures.)
- [x] **M18-T3 — Regression test.** `test/stairs.js` generates maps across all three
  strategies and asserts the door invariant (stairs reachable with no blockers) and that
  every safe-filtered NPC tile keeps the stairs reachable (incl. merchant + healer
  together); also reports the naive-blocker rate to quantify the bug.
  - Files: `test/stairs.js`. Run: `node test/stairs.js [maps]`.
  - Done when: a large run (≥1000 maps) reports zero stairs-blocked failures. ✔ (4500 maps,
    0 door failures, 0 unsafe placements, 3.3% naive-blocker rate documented.)

### M19 — Surface Base Camp

**Goal:** a retreat between dives. The player can leave the dungeon for a hand-authored
outdoor camp — rest at the campfire, buy/sell/lift curses with the camp NPCs — then
return to the depth they left, regenerated fresh from the same per-floor seed. Uses the
previously-unused Kenney Base Pack for outdoor art.

> Context: `game.mode` is `"dungeon" | "camp"`; `game.campReturnDepth` holds the depth
> to rebuild on return. `js/camp.js`'s `buildCamp()` returns a real `Dungeon` (same
> `tiles`/`visible`/`explored`/`isWalkable`/`computeFov` surface) built from a 30×20
> hand-authored legend, fully lit and fully explored (no fog of war at the surface).
> `Game.enterCamp()`/`_swapToCamp()`/`leaveCamp()` drive the mode switch through the
> existing fade-transition machinery; `leaveCamp()` steps `depth` back one and calls
> `nextLevel()`, which re-seeds deterministically — identical layout, fresh monsters
> and loot.

- [x] **M19-T1 — Base Pack sprite mapping.** `SPR` entries for camp terrain (grass ×2,
  path, tree, fence, 2×2 merchant/healer tents, cave mouth, campfire) cropped from
  `assets/Roguelike Base Pack/Spritesheet/roguelikeSheet_transparent.png` at the
  standard 17px stride.
  - Files: `js/assets.js` (`SHEETS.base`, `SPR` entries under `// --- camp (base
    sheet) ---`).
- [x] **M19-T2 — Camp map, mode switch & floor regeneration.** `js/camp.js`'s
  `buildCamp()` parses the legend into a `Dungeon`-shaped object (2×2 tent footprints,
  campfire light, cave-mouth-as-stairs so click-to-move/minimap/the stairs check all
  work unchanged); `Game.enterCamp()`/`_swapToCamp()`/`leaveCamp()` swap `this.dungeon`,
  reposition the player, clear `monsters`/`items` (kept as empty arrays, never `null`),
  and place the two camp NPCs, reusing the existing transition fade.
  - Files: `js/camp.js` (new), `js/game.js` (`enterCamp`, `_swapToCamp`, `leaveCamp`,
    `mode`/`campReturnDepth` state, `turn()` mode branch).
  - Done when: `game.enterCamp()` fades to a rendered, walkable camp; the cave mouth
    returns to the same depth number with the identical seeded layout. ✔ (verified
    live).
- [ ] **M19-T3 — Scroll of Return + waystone.** A consumable scroll (usable anywhere)
  and a waystone tile placed near the stairs every 3rd floor, both entering camp via
  the reverse descent fade.
  - Files: `js/entities.js`, `js/dungeon.js`, `js/game.js` (`useScroll`, `turn()`
    waystone step, waystone render), `js/npc.js`.
- [ ] **M19-T4 — Camp services.** Campfire (free full heal + clear statuses, once per
  visit), healer tent (lift curses for gold via a shared `Game.removeCurses()`),
  merchant tent (stocked purse including Return scrolls).
  - Files: `js/npc.js`, `js/game.js` (`openShop` healer branch, `removeCurses()`,
    campfire interaction in `turn()`, camp NPC stock/purse setup in `_swapToCamp`).
- [x] **M19-T5 — Ambience, recap & docs polish.** The camp cross-fades to a brighter
  procedural pad (`audio.startAmbient("camp")`, no new asset files) and restores the
  dungeon bed on leaving; a dusk-gradient sky letterbox replaces the void black behind
  the camp map; the campfire's warm light pulse falls out of the existing generic torch/
  brazier lighting loop (`d.lights`) for free, since T2 already registers it there — no
  new render code needed for the pulse itself. A `campVisits` counter (reset in
  `start()`, incremented in `_swapToCamp()`) is threaded through `buildRun`/`renderRecap`
  as a "Camp visits" stat.
  - Files: `js/audio.js` (`startAmbient(kind)`), `js/game.js` (camp branch of `render()`,
    `buildRun`, `renderRecap`, `_swapToCamp`/`leaveCamp` ambience calls, one-line
    `campVisits` reset in `start()`), `README.md`, `index.html` (help footer).
  - Note: the camp map (30×20) is comfortably larger than the view (21×15) in both
    dimensions, so `centerCamera`'s clamp (unchanged, out of this task's scope) always
    keeps the full viewport inside the map — the sky letterbox's out-of-bounds region is
    therefore not reachable on screen with the current map/view sizing. The code is
    correct and mode-aware (verified by driving the real `render()` through a headless
    Node harness and recording every `fillRect`/gradient call — `preview_start` bound to
    the main repo root, not this worktree, so browser pixel probes weren't available)
    but has no visible effect until the camp map shrinks, the view grows, or the camera
    clamp changes — none of which were in scope here.
- [ ] **M19-T6 — Regression tests & balance pass.** `test/camp.js`: floor-regeneration
  determinism, camp-map reachability invariants, waystone placement invariants, and
  merchant economy sanity; a `test/sim.js` balance check.
  - Files: `test/camp.js` (new).

---

## Appendix — Quick recipes

- **Add a new sprite:** crop the sheet at 17px stride to read `(col,row)`, add to `SPR`
  in `assets.js`, draw with `drawSprite(ctx, SPR.key, sx, sy, CELL)`.
- **Add a new monster:** add a template to `MONSTERS` (`entities.js`) with `minDepth`
  + `weight`; `populate()` will spawn it automatically.
- **Add a new item:** add to `ITEMS` + handle its `key` in `Game.pickupAt`.
- **Add input:** extend the `switch` in `Game.bindInput`; remember the `busyUntil` lock.
- **Verify a change:** Tell the user how to verify the change manually and ask them to verify that the change is complete before considering the change as "done" (see "Definition of done").
