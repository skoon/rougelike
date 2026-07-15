# M19 — Surface Base Camp · execution checklist

Plan: `implementation_plan.md` (approved 2026-07-14). Agents never commit —
work stays uncommitted in each task's worktree; Scott commits and merges.

## Wave 1 — concurrent (interface contract: agreed `SPR` key names)
- [x] **M19-T1 — Base Pack sprite mapping** · Sonnet · worktree branch `worktree-agent-ab74b6e1080af4438`
      Files: `js/assets.js` (diff is this file only). `SHEETS.base` + 15 camp
      `SPR` entries. All coords independently verified by cropping each tile
      onto a checkerboard; both tents verified by reassembling the four
      quadrant crops into an intact 2x2. Build: 27 files (+1, the new sheet).
      `test/stairs.js 500` clean; `test/sim.js` 99.9%.
      **Ready for Scott to merge.** Unverified: live in-browser boot (the
      preview tool binds to the main repo root, not the worktree).
- [ ] **M19-T2 — Camp map, mode switch & floor regeneration** · Opus · branch `m19-t2-camp-core`
      Files: new `js/camp.js`, `js/game.js` (`enterCamp`/`leaveCamp`/transition/`turn` stairs branch).

**Merge gate:** Scott reviews + merges T1 and T2 before Wave 2 starts.

## Wave 2 — concurrent after Wave 1 (each declares its `game.js` methods)
- [ ] **M19-T3 — Scroll of Return + waystone** · Sonnet · branch `m19-t3-return`
      Files: `js/entities.js`, `js/dungeon.js`, `js/game.js` (`useScroll`, `turn` waystone, render/minimap), `js/npc.js`.
- [ ] **M19-T4 — Camp services** · Sonnet · branch `m19-t4-services`
      Files: `js/npc.js`, `js/game.js` (`openShop`, `removeCurses` refactor, campfire in `turn`, camp NPC setup in `enterCamp`).
- [ ] **M19-T5 — Ambience, recap & docs polish** · Sonnet · branch `m19-t5-polish`
      Files: `js/audio.js`, `js/game.js` (camp render sky/light, `buildRun`/`renderRecap`), `README.md`, `index.html`, `ROADMAP.md`.

## Wave 3 — serial, after all merges
- [ ] **M19-T6 — Regression tests & balance pass** · Opus · branch `m19-t6-tests`
      Files: new `test/camp.js`, tuning tweaks. Then Scott's manual playthrough.

## Verification ledger
_(agents append: what they verified, what remains for Scott)_
