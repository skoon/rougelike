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
| Wait a turn       | Space               |
| Descend           | Step onto the stairs|
| Restart           | R                   |

## Gameplay

- Procedurally generated dungeons (rooms joined by corridors), a new layout each floor.
- Line-of-sight field of view with remembered (dimmed) explored tiles.
- Bump-to-attack combat; defeating foes grants XP. Level-ups raise max HP, attack,
  and periodically defense.
- Loot: gold, healing potions, weapon upgrades, and valuable amulets.
- Five enemy types that are gated and scaled by depth — the deeper you go, the
  deadlier it gets. Death is permanent.

## Code layout

| File              | Responsibility                                            |
| ----------------- | --------------------------------------------------------- |
| `js/assets.js`    | Sprite-sheet loading and tile coordinate definitions.     |
| `js/dungeon.js`   | Map generation (rooms + corridors) and field of view.     |
| `js/entities.js`  | Monster/item templates and per-depth spawning.            |
| `js/game.js`      | Game state, turn loop, combat, rendering, input, HUD.     |
| `js/main.js`      | Bootstrap: load assets, title screen, start.              |
