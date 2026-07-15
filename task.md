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

### Wave 1 integration — DONE, uncommitted on master (2026-07-14)
Both agent diffs applied to master's working tree (`git apply`, both clean —
master's 2 extra commits touch no `js/` files). Placeholder block stripped from
`js/camp.js`. **Nothing committed — Scott commits.**
Working tree: `M js/assets.js`, `M js/game.js`, `M js/main.js`, `M sw.js`, `?? js/camp.js`.

Verified on the merged tree (all green):
- Modules load; all 15 camp `SPR` keys resolve to real coords; no placeholder left.
- `node scripts/build.mjs` → 27 files (+1 Base sheet), zip written.
- `node test/stairs.js 500` → 0 failures.
- **Live in-browser** (the check nobody could close from a worktree): camp renders
  with real art — pixel probes at tile coords confirm merchant tent cream
  (206,197,163)/(217,202,169), healer tent green (80,162,104)/(75,168,109),
  campfire (249,150,40), path (204,147,89); both tent quadrant pairs draw, tents
  impassable. Zero console errors.
- **Round-trip determinism live:** depth 1 → camp → back = identical tiles hash
  + stairs + startPos, 18 fresh monsters, gold/HP carried through.
- **Core loop intact:** move → descend → die → restart, and restart resets
  `mode`/`campReturnDepth`.

> **Dev gotcha (cost an hour):** the browser HTTP-caches `js/*.js` on
> `localhost:8123`, so a reload silently runs STALE code (`window.game` stays the
> canvas element, not the Game). Port-bumping is the project's own cache-buster —
> added a `roguelike-8124` config to `.claude/launch.json` (gitignored). Use 8124,
> or hard-reload, when verifying by hand.

### Merge notes (historical — the branches were unmergeable)
**Root cause of the failed merge:** agents were told not to commit, so
`worktree-agent-*` had **zero commits**, and the worktrees were cut from
`92722ba` (2 behind master, already an ancestor) — so `git merge` correctly said
"Already up to date" and did nothing. **Wave 2 agents must commit on a branch cut
from master's tip.**
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

## Wave 2 — IN FLIGHT (launched 2026-07-14, all cut from master tip `e230106`)
Each agent verifies its base commit before starting, and **commits on its own
branch** so `git merge` actually works this time.
- [~] **M19-T3 — Scroll of Return + waystone** · Sonnet
      Files: `js/entities.js`, `js/dungeon.js`, `js/npc.js`, `js/game.js`
      (`useScroll` return branch, `turn` waystone step, waystone render/minimap, `_itemPrice`).
- [~] **M19-T4 — Camp services** · Sonnet · branch `m19-t4-camp-services` (base `e230106` ✔)
      Commit `46fb6cd` + a follow-up in flight. Files: `js/npc.js` (`genCampWares`),
      `js/game.js` — methods: `start` (`campRested` init), `turn` (campfire step),
      new `restAtCampfire`, `_swapToCamp` (merchant wares/purse, `campRested` reset),
      new `removeCurses`, `useScroll` uncurse branch (now calls it), `openShop`
      healer branch (Lift curses row).
      **Base-commit guard fired:** worktree came up on stale `3826a6e`; agent reset
      to master tip before starting. The guard works — keep it for all future waves.
      **Scott's ruling (2026-07-14):** curse-lifting is **camp healer only** — a
      `mode === "camp"` guard is being added; dungeon healers stay HP-for-gold.
      Verified headlessly (browser tooling can't reach worktrees): gold conserved
      on buy/sell, purse math, curse pricing `15+10*n`, campfire once-per-visit,
      core loop intact. `stairs.js 500` 0 failures; `sim.js` 99.9%.
- [~] **M19-T5 — Ambience, recap & docs polish** · Sonnet
      Files: `js/audio.js`, `js/game.js` (camp render sky/pulse, `buildRun`/`renderRecap`,
      ambience switch in `_swapToCamp`/`leaveCamp`), `README.md`, `index.html`, `ROADMAP.md`.

**Known merge overlap:** T3 and T4 both touch `useScroll` (return vs. uncurse
branches) and `turn()` (waystone step vs. campfire step). Expect a small manual
merge there. T4 may land before T3, so T4 was told not to hard-depend on the
Scroll of Return item key and to leave a marker instead.

## Wave 3 — serial, after all merges
- [ ] **M19-T6 — Regression tests & balance pass** · Opus · branch `m19-t6-tests`
      Files: new `test/camp.js`, tuning tweaks. Then Scott's manual playthrough.

## Verification ledger
_(agents append: what they verified, what remains for Scott)_
