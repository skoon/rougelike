# Catacombs of the Forgotten

A small turn-based pixel-art roguelike that runs in the browser, built with plain
HTML5 Canvas + ES modules (no build step). Art is the
[Kenney Roguelike](https://kenney.nl/) packs (16×16 tiles, 1px margin) plus the
Tiny Dungeons (Roupiks) and Tiny Tales (Megatiles) packs in `assets/` for animated
objects, monsters, and NPCs.

## Play

It uses ES modules, so it must be served over HTTP (not opened as a `file://`).

```sh
python -m http.server 8123
# then open http://localhost:8123
```

### Controls

| Action            | Keys                |
| ----------------- | ------------------- |
| Move / attack     | Arrow keys or WASD  |
| Walk to a tile    | Click or tap it (A\* path; stops at danger) |
| Wait a turn       | Space               |
| Inventory         | I                   |
| Use item (hotbar) | 1 – 9               |
| Pause             | P or Esc            |
| Descend           | Step onto the stairs|
| Restart           | R                   |

The ⚙ settings panel (footer) holds volume (master/music/SFX), mute, screen
shake, an on-screen touch d-pad toggle (auto-on for touch devices), readability
options (reduced flash, colorblind palette, UI scale), and fully rebindable
movement/wait/inventory/pause keys. All settings persist across sessions.

## Gameplay

- Procedurally generated dungeons with three generators (rooms+corridors, BSP,
  cellular-automata caves) selected by depth-themed biomes (Crypt → Catacombs →
  Caverns → Sunken Depths), each with its own wall/floor palette and fog. Every
  floor is guaranteed fully connected with reachable stairs.
- Three classes (Warrior / Rogue / Mage) with distinct stats, kits, perks, and two
  activated abilities each (Q / E, on cooldowns): Warrior Cleave/Brace, Rogue
  Dash/Smoke, Mage Firebolt/Frost Nova. Plus meta unlocks earned across runs, optional
  seeded runs (enter a seed on the title screen), and locally-persisted high scores and
  run history.
- Win by recovering the Forgotten Relic from depth 10 — or die trying. Death is
  permanent.
- Special rooms: locked treasure vaults (find the key), monster nests, and shrines
  that grant a one-time blessing. A unique boss guards every fifth floor.
- A living dungeon: merchants and healers (bump into them to trade — with shop
  portraits), animated chests, smashable barrels/pots/crates, hidden spike traps
  that stay sprung, cold water, flickering torches and braziers, and lever-opened
  portcullis vaults hiding treasure.
- Equipment (weapons, armor, shields) with tiers that scale by depth, auto-equipped
  when better and managed in an inventory panel (I). Carried potions are quaffed
  from a number-key hotbar (1–9).
- Nine enemy types — animated beasts (rat, slime, blazing skull) and layered
  humanoids (goblin, bandit, skeleton archer, wraith, frost wisp, dread knight) —
  gated and scaled by depth, plus tinted "elite" variants on deeper floors.
- Smarter foes: A* pathfinding, rats that flee when wounded, archers and casters
  that attack from range. Status effects: poison (slimes), bleed (blades), and
  slow (frost), each with HUD chips and actor tints.
- Animated actors: directional facing, idle bob, attack lunges, hit flashes and
  fade-out deaths.
- Audio: synthesized SFX for movement, combat, pickups, level-ups and descent,
  plus a looping dark-ambience track.
- Game feel: floating damage/heal numbers, blood and sparkle particles, screen
  shake, a corner minimap, level-transition fades, and click-to-move pathfinding
  that halts when something dangerous comes into view.

## Code layout

| File              | Responsibility                                            |
| ----------------- | --------------------------------------------------------- |
| `js/assets.js`    | Sprite-sheet loading and tile coordinate definitions.     |
| `js/audio.js`     | Web Audio buses, procedural SFX, ambient music, volumes.  |
| `js/dungeon.js`   | Map generation (3 strategies), special rooms, traps, FOV. |
| `js/entities.js`  | Monster/item/class templates and per-depth spawning.      |
| `js/npc.js`       | Merchant/healer templates and shop stock.                 |
| `js/pathfind.js`  | A* pathfinding (enemy AI and click-to-move).              |
| `js/rng.js`       | Seeded PRNG (mulberry32) for reproducible runs.           |
| `js/scores.js`    | Run history, high scores, lifetime meta, unlocks.         |
| `js/game.js`      | Game state, turn loop, combat, rendering, input, HUD.     |
| `js/main.js`      | Bootstrap: load assets, title screen, settings, start.    |

## Build & deploy

```sh
node scripts/build.mjs
```

This assembles a `dist/` folder (and a zip) containing `index.html`, `css/`, `js/`,
and **only the asset files the game actually loads** — a few hundred KB instead of the
raw multi-hundred-MB packs. Upload the zip to [itch.io](https://itch.io) as an HTML5
game (set `index.html` as the entry point), or serve `dist/` from any static host.

The game is also an installable PWA: `manifest.json` + a service worker (`sw.js`)
precache the shell and runtime-cache assets, so it works offline after one visit.
(The service worker is intentionally **not** registered on `localhost`, so local
development still picks up edits immediately.)

## Credits

Code by the project author. Art and audio assets remain the property of their
creators — see each pack's `License.txt` under `assets/`:

- **Kenney Roguelike packs** (Dungeon, Characters) — [kenney.nl](https://kenney.nl/),
  released under **CC0** (public domain).
- **Tiny Dungeons – Biome Dungeon Pack** (animated objects & monsters) — by
  **Roupiks**, [roupiks.itch.io](https://roupiks.itch.io/). Free for commercial and
  non-commercial use; redistribution/resale of the assets is not permitted.
- **Tiny Tales – Human NPC Nobility** (merchant & healer sprites) — by **Megatiles**,
  artist **Rayane Félix**. Free for commercial and non-commercial use;
  redistribution/resale of the assets is not permitted.

The ambient track (`assets/dark_dungeon_ambience.mp3`) and the app icon are used
under their respective terms. All in-game SFX are synthesized at runtime (no files).
