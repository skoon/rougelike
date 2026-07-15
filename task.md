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
- [x] **M19-T2 — Camp map, mode switch & floor regeneration** · Opus · worktree branch `worktree-agent-afbe76bc799de3758`
      Files: new `js/camp.js` (198 lines), `js/game.js` (+103/-14), `js/main.js` (+1
      `window.game` dev handle), `sw.js` (+1 precache entry).
      `game.js` methods touched (wave-2 merge contract): `start`, `turn` (stairs
      fork), `beginTransition` (**new**, extracted from `beginDescent`),
      `beginDescent`, `updateTransition`, `enterCamp`/`_swapToCamp`/`leaveCamp`
      (**new**), `centerCamera` (clamp to `d.w/h`), `render` (+2 lines: WALL decor),
      `renderMinimap` (scale from map size), `drawTransition` (caption/sub).
      Verified by T2: 5000-floor determinism round-trip, 0 mismatches; core loop
      intact; `stairs.js` + `sim.js` clean. Independently re-verified here: camp
      invariants (fully lit, walkable NPC spots, cave mouth reachable, objs/traps/
      floors well-formed), `stairs.js 500` clean, and the camp composed offline
      with T1's sprites — **it renders correctly, tents read well**.
      **Ready for Scott to merge.**

**Merge gate:** Scott reviews + merges T1 and T2 before Wave 2 starts.

### Merge notes (action required)
1. **Delete the placeholder block in `js/camp.js`** (lines ~17-33, marked
   `DELETE THIS BLOCK once m19-t1-assets is merged`). It registers the 15 camp
   `SPR` keys against the unloaded `"base"` sheet so T2's branch doesn't crash
   standalone. Inert after T1 merges (`if (!SPR[key])`), but it's dead code.
2. **Plan erratum:** the plan claimed missing sprites "just draw blank" — wrong.
   `drawSprite` destructures the `SPR` tuple, so an undefined *key* throws.
   Only an unknown *sheet* no-ops. T2 caught this; it's why the block exists.
3. Branches are named `worktree-agent-<id>`, not the plan's `m19-tN-*`.
4. **Not verified by anyone: the live in-browser boot.** `preview_start` binds
   to the main repo root, not worktrees, so neither agent could load its branch.
   After merging, run the preview and check `game.enterCamp()` at any depth.

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
