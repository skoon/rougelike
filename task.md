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

## Wave 3 — DONE (uncommitted on master, for Scott)
- [x] **M19-T6 — Regression tests & balance pass** — done in-session (the delegated
      Opus agent was stopped; Scott chose to have the main session finish it, since
      the expensive part — live browser verification — was already done here).
      Working tree: `?? test/camp.js`, `M ROADMAP.md`, `M task.md`. **Nothing committed.**

`test/camp.js` covers what nothing else did — determinism of floor regeneration
(5000 floors), camp-map invariants, waystone-in-camp guard. It deliberately does
not duplicate `test/waystone.js` (placement) or `test/stairs.js` (reachability).
Economy checks need a DOM-bound `Game`, so they ran in the live browser instead of
via a mirror or a shim.

**Final suite on merged master, all green:**
- `node test/camp.js 500` → 5000 floors, 0 failures.
- `node test/waystone.js 500` → clean · `node test/stairs.js 500` → clean.
- `node test/sim.js` → 99.9% (baseline ~99.7%).
- Economy (live): every ware sells at half buy (25/12, 46/23, 39/19, 20/10); a
  buy→sell cycle strictly loses gold (1000→987); purse never negative; camp
  merchant 5 wares / purse 225 / all identified / none cursed.

**The test is not vacuous** — mutation-checked: the tile hash discriminates by both
seed and depth, and a real regression (rebuilding without re-seeding) is caught.

### Findings for Scott (decisions, not bugs)
1. **Return scrolls are effectively unbuyable — the T3/T4 handoff never closed.**
   `genCampWares` still carries `// M19-T3: guarantee a Scroll of Return here once
   entities.js exposes a "scrollReturn"-style item key`. T3 made "return" a *sub-kind*
   of the generic `scroll` key instead, so that key never existed and the marker was
   never actioned. Net: the camp merchant stocks a Return scroll only by chance
   (~2/10 per slot rolls `scroll`, then 6.25% of scrolls are `return`) ≈ **~5% of
   visits**. The plan said the merchant "sells a deeper stock list including scrolls
   of Return". So in practice the camp is **waystone-only, every 3rd floor**. That may
   actually be the better balance — but it is not what was designed. Decide: guarantee
   one in camp stock, raise the scroll weight, or ratify waystone-only.
2. **Waystone glow washes to white** (cosmetic) — `drawWaystone`'s violet `#b48cff`
   halo uses `globalCompositeOperation = "lighter"`; over the Catacombs' tan floor all
   channels saturate (measured 385/784 tile pixels at pure `255,255,255`). Waystones
   only spawn at depths 3/6/9 — all light-floored themes — so this is the normal case.
   The dark rune-stone on top still reads. Fix: lower the glow alpha, or skip `lighter`
   on light themes.
3. **T5's sky letterbox is dead code** — camp 30×20 > view 21×15, so the clamp never
   exposes it. Options: shrink the camp to fit the viewport (a hub you take in at a
   glance — the letterbox would then pay off), unclamp the camp camera, or delete it.
4. **Balance: don't tune the camp until M16 lands.** `sim.js` is unmoved at 99.9%
   (opt-in feature, sim never enters). The camp is deliberately generous — free full
   heal per visit, waystone every 3rd floor — and M16's fuel clock is its designed
   counterweight; the plan pairs them. Tuning the relief valve before the pressure
   exists is guessing.

## Wave 2 verified on merged master (2026-07-14, by the main session)
Merged master `4590e72` smoke + live checks — all green:
- Modules import; camp builds; waystone on depth 3, none on depth 4, **none in
  the camp** (the `!this.depth` guard holds against the default-0 constructor arg).
- `test/stairs.js 500` clean · `test/waystone.js 500` clean · `test/sim.js` 99.9%.
- **Live in-browser (port 8125 to bust the JS cache):**
  - Campfire rest: HP 5 → 40, `campRested` set; second attempt correctly blocked.
  - Camp healer rows: `Restore 35 HP / 17g` + **`Lift curses / 25g`** (= 15+10×1). ✔
  - **Camp-only gate proven at a REAL depth-4 dungeon healer** with cursed gear
    worn: only the heal row, no cleanse. ✔
  - Waystone depth 3 @ (33,31): walkable, not on stairs, stepping on it enters
    camp with `campReturnDepth: 3`. ✔
  - `campVisits` increments.

### Open polish nits (for T6 / Scott — not bugs)
1. **Waystone glow washes out.** `drawWaystone` draws its violet `#b48cff` halo
   with `globalCompositeOperation = "lighter"` at ~0.35 alpha. Over the Catacombs'
   tan floor `rgb(217,202,169)` every channel saturates → the halo renders **white**
   (measured: 385/784 tile pixels are pure `255,255,255`). Waystones only spawn at
   depths 3/6/9, which are all light-floored themes, so this is the normal case, not
   an edge case. The dark rune-stone (`#2a1f3d`) is drawn over it in normal mode and
   still reads. Cosmetic: lower the glow alpha or skip `lighter` on light themes.
2. **T5's sky letterbox has no visible effect** — camp 30×20 > viewport 21×15, so
   `centerCamera`'s clamp never exposes the margin. Decide: shrink the camp map,
   unclamp the camp camera, or drop the letterbox.

> **Screenshots remain unreliable** (preview tab stays `document.hidden` → rAF
> paused). One good frame of the camp was captured earlier; everything since is
> verified via DOM text + canvas `getImageData` probes, which is stronger anyway.

## Verification ledger
_(agents append: what they verified, what remains for Scott)_
