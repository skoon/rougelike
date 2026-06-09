# Catacombs of the Forgotten

A small turn-based pixel-art roguelike that runs in the browser, built with plain
HTML5 Canvas + ES modules (no build step). Art is the
[Kenney Roguelike](https://kenney.nl/) packs in `assets/` (16×16 tiles, 1px margin).

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
| Move / attack     | Click or tap a tile |
| Wait a turn       | Space               |
| Descend           | Step onto the stairs|
| Restart           | R                   |

Volume (master/music/SFX), mute, and a screen-shake toggle live in the footer
(⚙ settings + 🔊 mute) and persist across sessions.

## Gameplay

- Procedurally generated dungeons with three generators (rooms+corridors, BSP,
  cellular-automata caves) selected by depth-themed biomes (Crypt → Catacombs →
  Caverns → Sunken Depths), each with its own tile palette and fog. Every floor is
  guaranteed fully connected with reachable stairs.
- Special rooms: locked treasure vaults (find the key), monster nests, and shrines
  that grant a one-time blessing. A unique boss guards every fifth floor.
- Line-of-sight field of view with remembered (dimmed) explored tiles.
- Bump-to-attack combat; defeating foes grants XP. Level-ups raise max HP, attack,
  and periodically defense.
- Loot: gold, healing potions, weapon upgrades, and valuable amulets.
- Six enemy types — beasts (rat, slime) and layered humanoids (goblin, bandit,
  wraith, dread knight) — gated and scaled by depth, plus tinted "elite"
  variants on deeper floors. The deeper you go, the deadlier it gets.
- Animated actors: directional facing, idle bob, attack lunges, hit flashes and
  fade-out deaths. Death is permanent.
- Fully procedural audio (no sound files): synthesized SFX for movement, combat,
  pickups, level-ups and descent, plus an ambient dungeon drone.
- Game feel: floating damage/heal numbers, blood and sparkle particles, screen
  shake, a corner minimap, and mouse/touch click-to-move. Volumes, mute, and a
  screen-shake toggle persist across sessions.

## Code layout

| File              | Responsibility                                            |
| ----------------- | --------------------------------------------------------- |
| `js/assets.js`    | Sprite-sheet loading and tile coordinate definitions.     |
| `js/audio.js`     | Web Audio buses, procedural SFX, ambient drone, volumes.  |
| `js/dungeon.js`   | Map generation (rooms + corridors) and field of view.     |
| `js/entities.js`  | Monster/item templates and per-depth spawning.            |
| `js/game.js`      | Game state, turn loop, combat, rendering, input, HUD.     |
| `js/main.js`      | Bootstrap: load assets, title screen, start.              |
