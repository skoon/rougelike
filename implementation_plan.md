# Implementation Plan — M19: Surface Base Camp (F1)

**Status: awaiting review — no code changes until approved.**

The player can transport out of the dungeon to an outdoor camp — rest, heal,
buy, sell — then return to the depth they left. Uses the unused Kenney Base
Pack for outdoor art and reuses the existing shop/NPC/scroll frameworks.

---

## Design decisions locked in this plan (flag disagreements now)

1. **Return = floor regeneration, not snapshot.** `nextLevel()` already seeds
   each floor deterministically (`seedRng((seed ^ depth*2654435761) >>> 0)` at
   [game.js:155](js/game.js:155)), so re-entering depth N rebuilds the identical
   layout with fresh monsters/loot. Re-farming is possible but costs time, HP,
   and (later) M16 fuel; Scroll-of-Return scarcity is the main limiter.
2. **Camp is a mode, not a depth.** `game.mode = "dungeon" | "camp"` plus
   `campReturnDepth`. The camp map is a hand-authored string-array layout in a
   new `js/camp.js`, parsed into a `Dungeon`-shaped object (same `tiles` /
   `visible` / `explored` / `isWalkable` / `computeFov` surface) so render,
   movement, FOV, and pointer code run unchanged. Everything starts explored;
   FOV radius large (or all-visible).
3. **Two ways out of the dungeon:** a consumable **Scroll of Return** (new
   `scroll` sub-kind, usable anywhere) and a **waystone** tile placed near the
   stairs on every 3rd floor. Both run the descent fade in reverse.
4. **Camp services:** campfire (full heal + clear statuses, free), healer tent
   (remove curses for gold), merchant tent (large purse, stocks scrolls of
   Return, buys everything), cave mouth (return to `campReturnDepth`).
5. **No stash in M19** (that's F5-a, separately reviewable later).
6. Daily runs allow camp visits; recap gains a "camp visits" stat.

---

## Task graph & concurrency

```
T1 (assets)  ──┐            T1 ∥ T2 — parallel worktrees, contract below
T2 (camp core) ┴─► merge ─► T3 (scroll/waystone) ∥ T4 (services) ∥ T5 (polish)
                                └────────────┬───────────┘
                                             ▼
                              T6 (tests + integration) — after all merge
```

- **Wave 1 (concurrent):** T1 and T2 in separate worktrees/branches.
  Interface contract so T2 never waits on T1: the sprite keys are agreed
  up-front as `SPR.grass`, `SPR.grassAlt`, `SPR.path`, `SPR.tree`, `SPR.fence`,
  `SPR.tentMerchant*`, `SPR.tentHealer*`, `SPR.caveMouth`, `SPR.campfire` (T2
  codes against these names; missing sprites just draw blank until merge —
  `drawSprite` already no-ops on unknown sheets).

  > **Contract amendment (approved 2026-07-14, after T1's findings):** the Base
  > Pack's tents are genuinely **2x2** sprites; a single tile is just an
  > unreadable colored triangle. Tents are therefore four quadrant entries each
  > — `tentMerchantTL/TR/BL/BR` and `tentHealerTL/TR/BL/BR` — and the camp
  > legend's `M`/`H` tiles **anchor a 2x2 footprint** (anchor = top-left; the
  > anchor tile plus the three cells right/below/right-below are the tent, all
  > non-walkable). All other keys are unchanged and verified correct.
- **Wave 2 (concurrent, after wave-1 merge):** T3, T4, T5. **All three touch
  `js/game.js`**, so keep each one's diff surgical (T3: `useScroll` + `turn`;
  T4: `openShop` + new camp-service methods; T5: render/audio/recap) and
  expect a mechanical merge. If only one agent slot is available, order them
  T4 → T3 → T5.
- **Wave 3 (serial):** T6 integrates on one branch after everything merges.

Branch naming: `m19-t1-assets`, `m19-t2-camp-core`, etc. Scott handles all
commits/merges — agents leave work uncommitted in their worktree and report.

---

## Tasks

### M19-T1 — Base Pack sprite mapping · **Model: Sonnet** · *Wave 1, concurrent*
- **Files:** `js/assets.js` only (`SHEETS.base`, ~10 `SPR` entries,
  `ASSET_FILES` picks the new sheet up automatically).
- **Approach:** Follow the ROADMAP recipe — crop
  `assets/Roguelike Base Pack/Spritesheet/roguelikeSheet_transparent.png`
  (57×31 grid, 17px stride) with PIL, overlay a labeled grid, read exact
  `(col,row)` for: two grass variants, dirt path, tree, fence, two tent styles
  (or one tent + awning), cave/dungeon entrance, campfire (static tile is fine
  — the animated brazier strip can overlay for flame later). Add the `SPR`
  entries under a `// --- camp (base sheet) ---` comment using the agreed key
  names (contract above).
- **Done when:** a scratch HTML/Node check draws every new sprite correctly;
  game still boots clean (sheet loads, no 404, `scripts/build.mjs` bundles it).
- **Why Sonnet:** single-file, recipe exists in ROADMAP, no architecture.

### M19-T2 — Camp map, mode switch & floor regeneration · **Model: Opus** · *Wave 1, concurrent*
- **Files:** new `js/camp.js`; `js/game.js` (`enterCamp`, `leaveCamp`,
  transition reuse, guards); no changes to `js/dungeon.js` expected.
- **Approach:**
  - `js/camp.js` exports `buildCamp()` → a `Dungeon`-shaped object built from
    a ~30×20 string-array legend (`#` fence/tree border, `.` grass, `,` path,
    `T` tree, `M` merchant tent, `H` healer tent, `C` campfire, `D` cave
    mouth, `@` spawn). It must satisfy every field the render/turn path reads:
    `tiles`, `decor`, `visible` (all true), `explored` (all true), `rooms:[]`,
    `objs:[]`, `traps: new Set()`, `lights[]` (campfire glow), `startPos`,
    `stairs` (the cave mouth), `floors`, `idx/inBounds/get/set/isWalkable/
    blocksSight/computeFov/lineOfSight/getObj/clearObj`. Simplest path:
    construct a real `new Dungeon(w,h,"rooms")` and overwrite tiles/fields
    from the legend rather than duck-typing from scratch.
  - `Game.enterCamp()`: set `campReturnDepth = depth`, `mode = "camp"`, swap
    `this.dungeon = buildCamp()`, position player, clear `monsters` (keep the
    array empty, not null — `enemyTurn` and render iterate it), place the two
    camp NPCs, run the existing fade transition (`beginDescent`-style with an
    "ascend" caption). `Game.leaveCamp()`: `mode = "dungeon"`,
    `depth = campReturnDepth - 1`, then `nextLevel()` (regenerates
    deterministically); depth-triggered NPC/boss/artifact logic in
    `nextLevel` re-runs — that's correct and desired.
  - Guards: no waystone/return-scroll use while already in camp; camp
    disables descend-on-stairs semantics (cave mouth calls `leaveCamp`
    instead); minimap, autoPath, d-pad, and pause must work in camp
    (they should for free — verify).
  - Camp entry/exit hook points: `turn()` stairs check at
    [game.js:527](js/game.js:527) branches on mode; transition machinery at
    [game.js:581-604](js/game.js:581) is reused with a target callback rather
    than duplicated.
- **Done when:** dev-console `game.enterCamp()` fades to a rendered outdoor
  camp with working movement/FOV/minimap; stepping on the cave mouth returns
  to the same depth number with the identical layout (seed-verified);
  win-depth artifact and boss floors still spawn on re-entry.
- **Why Opus:** cross-cutting mode switch through the game loop, transition,
  and lifecycle — highest regression risk in the milestone.

### M19-T3 — Scroll of Return + waystone · **Model: Sonnet** · *Wave 2, after T1+T2*
- **Files:** `js/entities.js` (`makeItem` scroll sub-kind, loot tables),
  `js/dungeon.js` (`WAYSTONE = 7` tile type, placement near stairs,
  walkable, never blocks), `js/game.js` (`useScroll` "return" branch,
  `turn()` waystone step → `enterCamp()`, waystone render + minimap dot),
  `js/npc.js` (`WARE_POOL` gets `"scrollReturn"` weighting or the generic
  scroll roll includes it).
- **Approach:** clone the teleport-scroll pattern at
  [game.js:1068](js/game.js:1068) — `useScroll` returns `false` (no turn, not
  consumed) if already in camp. Waystone placement mirrors `_placeSpecials`:
  every 3rd depth, a free floor cell within ~4 of the stairs; skip silently if
  none. Waystone sprite: reuse `SPR.shrine`-style dungeon-sheet tile or a
  procedural draw like `drawRing`.
- **Done when:** scroll drops/sells, using it in-dungeon fades to camp and is
  consumed; using it in camp no-ops without consuming; waystones appear on
  depths 3/6/9 and stepping on one enters camp; Node check confirms waystone
  never lands on stairs/start.
- **Why Sonnet:** three existing patterns to clone (scroll branch, special
  placement, tile type); T2 defines the API it calls.

### M19-T4 — Camp services · **Model: Sonnet** · *Wave 2, after T2 (T1 for art)*
- **Files:** `js/npc.js` (camp merchant/healer variants or flags),
  `js/game.js` (campfire interaction in `turn()`, camp-healer shop mode,
  camp-merchant stock/purse in `enterCamp`), `index.html`/`css/style.css`
  only if the shop panel needs a new row type.
- **Approach:** camp NPCs are ordinary `makeNpc` instances placed by
  `enterCamp` at the legend's tent tiles. Merchant: `wareItems` of 5 slots
  (guaranteed 1 scroll of Return + 1 potion + 3 rolls), purse
  `200 + campReturnDepth * 25`, identified/uncursed as at
  [game.js:180](js/game.js:180). Healer: extend `openShop`'s healer branch
  with an "Lift curses — Ng" row (price ~`15 + 10×cursed pieces`) calling the
  existing uncurse logic from [game.js:1116](js/game.js:1116) (refactor that
  block into `Game.removeCurses()` shared by scroll + healer). Campfire:
  stepping on it full-heals + clears statuses with log/particles/SFX, usable
  once per camp visit (reset on `enterCamp`).
- **Done when:** full loop works in-browser — enter camp, rest at fire, sell
  junk, buy a Return scroll, uncurse at healer, exit via cave mouth.
- **Why Sonnet:** entirely composed of existing shop/NPC mechanics.

### M19-T5 — Ambience, recap & docs polish · **Model: Sonnet** · *Wave 2, after T2*
- **Files:** `js/audio.js` (camp ambience — brighter procedural pad or reuse
  of the drone with a highpass; no new asset files), `js/game.js` (sky-color
  letterbox + campfire light pulse in camp render; `campVisits` counter into
  `buildRun`/`renderRecap`), `README.md`, help footer in `index.html`,
  `ROADMAP.md` (add M19 section, check boxes as tasks land).
- **Approach:** ambience switches on `enterCamp`/`leaveCamp` via the existing
  music bus; keep it procedural to avoid new licensing/build entries. Sky =
  fill the out-of-bounds letterbox with a dusk gradient when `mode === "camp"`
  instead of black.
- **Done when:** camp sounds/looks distinct from dungeon; recap shows camp
  visits; README/help mention the waystone, scroll, and camp controls.
- **Why Sonnet:** additive polish with clear seams, no game-logic risk.

### M19-T6 — Regression tests & balance pass · **Model: Opus** · *Wave 3, after all merges*
- **Files:** new `test/camp.js`; possibly `test/sim.js` knobs; tuning tweaks
  to scroll rarity/prices from findings.
- **Approach:** Node harness in the style of `test/stairs.js`:
  (a) determinism — for 500 seeds×depths, generate a floor, "leave", regenerate,
  assert tile-array and stairs equality; (b) camp map invariants — every legend
  tile walkable-reachable from spawn, cave mouth reachable, NPC tiles adjacent-
  reachable; (c) waystone invariants — placement never blocks stairs (reuse
  `tileSafeToBlock` logic), appears only on depth % 3 floors; (d) economy
  sanity — merchant purse/pricing can't gold-dupe via buy-sell cycles (sell
  price stays < buy price for identical items). Then a `test/sim.js` run to
  confirm baseline balance is unchanged (camp is opt-in, sim ignores it), and
  a written recommendation on Return-scroll drop weight.
- **Done when:** all assertions pass on ≥500 maps; sim win% within noise of
  the M13 baseline (~99.7%); findings + any tuning documented in the PR notes;
  ROADMAP M19 checked off. **Scott then does the final manual playthrough
  before anything is called done** (per Definition of Done — agents state what
  to verify, the user verifies).
- **Why Opus:** designing invariants across three merged branches and judging
  balance implications; last line of defense.

---

## Risks & watch items

- **`game.js` is the merge hot-spot** (T3/T4/T5 all touch it). Mitigation:
  each task's plan above names the exact methods it may touch; anything wider
  needs a check-in first.
- **Regeneration re-triggers `nextLevel` side effects** (NPC spawn logs,
  "You reach depth N" message). Acceptable, but T2 should suppress duplicate
  boss/artifact *log spam* if it reads oddly — the spawns themselves are
  correct (fresh floor = fresh boss).
- **`monsters=[]` assumptions:** several systems iterate monsters
  (`enemyTurn`, minimap blips, `nearestVisibleMonster` for wands/abilities).
  Empty array is safe; `null` is not. T2 must never null it.
- **Build/PWA:** the new Base sheet must appear in the dist bundle and SW
  precache — automatic via `ASSET_FILES`, but T6 verifies `scripts/build.mjs`
  output count.
- **M16 interplay:** fuel refill at camp is *out of scope* here; when M16
  lands, the campfire simply also refills fuel (one line, noted in ROADMAP).

## Process (applies to every task)

- Each agent works in its own worktree on its `m19-t*` branch; **no commits to
  master; Scott performs all commits and merges.**
- Every task runs `node test/stairs.js 500` + existing tests before reporting,
  states exactly how it verified its work in-browser, and lists what remains
  for manual verification.
- `task.md` tracks live progress during execution (created at kickoff after
  this plan is approved).
