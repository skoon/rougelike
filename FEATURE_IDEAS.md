# Catacombs of the Forgotten — Feature Brainstorm

Ideas for post-M17 development, written in the same spirit as ROADMAP.md Part 3/4.
Nothing here is committed work — this is a menu for review. The one confirmed
feature is **F1 (Surface Base Camp)**, written up in the most detail.

Status of the existing roadmap: every milestone is done except **M16**
(resource clock: torchlight & rations). Several ideas below interact with M16,
noted where relevant.

---

## F1 — Surface Base Camp *(confirmed — flesh out and schedule)*

**Goal:** the player can transport out of the dungeon to an outdoor camp above
ground — rest, heal, sell, buy, then return to the depth they left. Turns the
run from a one-way dive into a rhythm of expeditions.

### Why it fits now
- The **Kenney Base Pack** (`assets/Roguelike Base Pack/…`, 57×31 grid) is
  loaded-adjacent but completely unused — it has exactly the outdoor art this
  needs: grass, dirt paths, trees, fences, tents, buildings, campfires.
- Merchant/healer NPC logic (`js/npc.js`, `openShop`, M17 selling) already
  exists and can be reused wholesale — the camp merchant is just an NPC with a
  bigger purse and better stock.
- The theme system (`THEMES` in game.js) already swaps tile palettes per map,
  so an "outdoor" palette is a natural extension.

### Design sketch
- **Getting out:** a consumable **Scroll of Return** (new `makeItem` branch,
  fits the M13 scroll framework) plus a permanent **waystone** tile placed near
  the stairs on every Nth floor (or on every floor, but the scroll is the
  anywhere-anytime option). Using either plays the descend transition in
  reverse and loads the camp map.
- **The camp map:** a small handcrafted (not procedural) map, e.g. 30×20 —
  a clearing with a campfire, a merchant tent, a healer tent, the dungeon
  entrance (a cave mouth / trapdoor), and decorative trees/fences from the
  Base Pack. Handcrafting keeps it cheap: a literal string array in a new
  `js/camp.js`, parsed into a `Dungeon`-shaped object so the existing render/
  FOV/walk code works unchanged (FOV radius can be huge outdoors, or just mark
  everything visible).
- **Services at camp:**
  - **Rest** (campfire): full HP restore, clears statuses. Free but not
    abusable — see "cost of retreat" below.
  - **Healer tent:** cures curses (cheaper than a Remove Curse scroll) — gives
    the healer a role the potion economy doesn't already cover.
  - **Merchant tent:** buys anything (large/infinite purse, unlike dungeon
    merchants), sells a deeper stock list including scrolls of Return.
  - **Stash chest** *(optional, pairs with F5 below)*: persistent storage.
- **Going back down:** stepping into the cave mouth returns the player to the
  depth they left (regenerate the floor from the same per-floor seed —
  `seedRng((seed ^ depth*Knuth))` already makes this deterministic — or keep a
  snapshot of the floor state; regeneration is far simpler and roguelike-
  traditional).
- **Cost of retreat (important for balance):** free round-trips would gut the
  tension. Options, roughly in order of preference:
  1. Scrolls of Return are uncommon/pricey; the waystone only appears every
     3rd floor.
  2. Returning to a depth **repopulates monsters** (regeneration gives this
     for free) but previously-looted chests stay looted only if we track a
     per-floor "opened" set — simplest is full regen: fresh danger, fresh
     (smaller?) loot, so re-farming is possible but costs time and HP.
  3. If M16 lands, the fuel clock makes every extra floor-crossing expensive
     anyway — the two features balance each other beautifully.
- **Scoring/daily runs:** camp visits should be tracked in the run recap
  (`buildRun`), and the daily-run mode could optionally disallow returns for
  leaderboard purity (or just count them).

### Task breakdown (M19 candidate)
- **M19-T1 — Camp map + mode switch.** `js/camp.js` with a hand-authored
  layout; `Game.enterCamp()`/`leaveCamp()` swap `this.dungeon`, saving
  `this.depth`. Load the Base Pack sheet in `assets.js` and map ~15 `SPR`
  entries (grass, path, tree, fence, tent, cave mouth, campfire).
- **M19-T2 — Scroll of Return + waystone.** New scroll sub-kind in
  `makeItem`; `WAYSTONE` tile type placed near stairs every 3rd floor;
  both trigger `enterCamp()`.
- **M19-T3 — Camp services.** Campfire rest, healer (uncurse), merchant
  (reuse `openShop` with a camp stock table + big purse), cave-mouth return
  via floor regeneration at the stored depth.
- **M19-T4 — Polish.** Outdoor ambience (birdsong or just a brighter drone on
  the music bus), a day-sky background color outside the map bounds, recap
  stat ("camp visits"), README/help update.

---

## F2 — Quality-of-life ideas

- **F2-a — Auto-explore key.** Press `O`: A* to the nearest unexplored
  reachable tile, using the existing `autoPath` machinery and its
  cancel-on-danger rules (M8-T1 built all the hard parts). Standard roguelike
  QoL; huge for replays. *Cheap.*
- **F2-b — Run in a direction.** Shift+arrow (or a rebindable key) repeats a
  step until something interesting appears (junction, item, monster, door),
  reusing the same cancellation logic. *Cheap.*
- **F2-c — Examine / look mode.** Press `X` then move a cursor (or just hover
  with the mouse): a tooltip names the tile, item, trap-stud, or monster with
  its HP/statuses. Monsters could show a one-line bestiary blurb. *Moderate.*
- **F2-d — Message log history.** Scrollable full-log overlay (`L`), since the
  HUD log truncates. *Cheap.*
- **F2-e — Save & resume.** Serialize the run (seed, depth, player, inventory,
  RNG state, floor-visited list) to `localStorage` on every turn or on unload;
  "Continue" button on the title. Permadeath preserved — dying deletes the
  save. The seeded-PRNG architecture makes this smaller than it sounds, but
  entity state on the current floor needs real serialization. *Moderate-large,
  high value — the #1 ask for a browser game people play in tabs.*
- **F2-f — Compare-on-hover in shops/inventory.** Show the stat delta vs.
  currently equipped gear ("+2 ATK vs your Iron Sword") in `gearMeta`.
  *Cheap.*
- **F2-g — Turn counter + depth timer in HUD.** `turnCount` already exists
  (M12); surfacing it aids daily-run competition. *Trivial.*

## F3 — Graphical / audio ideas

- **F3-a — Weather & sky at camp.** If F1 lands: drifting cloud shadows or
  rain particles outdoors (the particle system from M5 is reusable). *Cheap,
  big mood payoff.*
- **F3-b — Animated player character.** The **Tiny Dungeons Player Extended**
  pack (idle/run/push/carry strips) is still unused. Swapping the paper-doll
  player for an animated strip has a cost: we'd lose visible equipped gear.
  Alternative: keep the paper-doll but add a 2-frame walk bob using the
  existing strip pipeline. *Moderate; decide identity vs. animation.*
- **F3-c — Fog & depth ambience tiers.** Deeper themes get drifting fog
  overlay particles, occasional dust motes in torchlight, and a slightly
  darker vignette. All composable from existing render passes. *Cheap.*
- **F3-d — Title screen scene.** Draw the camp (or a dungeon vista) behind the
  title overlay instead of a black void, with the ambient torch flicker.
  *Cheap once F1's tiles are mapped.*
- **F3-e — Damage-type colored bolts & impact flashes.** Fire/frost/arrow
  bolts already have colors; add matching impact particle bursts and brief
  tile-tint on hit. *Cheap.*
- **F3-f — New Tiny Dungeon tileset theme.** The just-added
  `assets/Tiny Dungeon/` pack (Kenney, 16px `tilemap_packed.png`) could drive
  a fifth visual theme or replace a current one — needs a style check against
  the Roguelike packs first (different pixel density reads badly side-by-side;
  measure before committing). *Moderate.*

## F4 — Gameplay / content ideas

- **F4-a — Finish M16 (fuel clock) alongside F1.** They're designed for each
  other: the camp is the pressure valve, fuel is the pressure. Shipping them
  in the same release makes both feel intentional. *Already spec'd in
  ROADMAP.*
- **F4-b — Quests / bounties at camp.** The camp healer or a new NPC offers
  one small objective per expedition ("kill the boss on depth 5", "bring me 3
  rat tails", "find the shrine") for gold/scroll rewards. Gives each dive a
  goal beyond descent. Needs a tiny quest state object on the player and a
  hook in `killMonster`/`pickupAt`. *Moderate.*
- **F4-c — Monster loot drops.** Beasts drop crafting-ish trinkets (rat tail,
  slime gel, wraith essence) that exist only to sell or hand in for bounties
  (F4-b) — no crafting system needed, just flavor + economy. *Cheap.*
- **F4-d — Thrown/utility consumables.** A bomb (damages a 3×3, breaks walls?
  probably not walls — connectivity), a flash vial (blinds adjacent foes —
  they lose track like Smoke), a lure stone (noise attracts monsters to a
  tile). All reuse existing status/AI hooks. *Moderate.*
- **F4-e — More boss variety.** Bosses (every 5th depth) are tinted elites
  today. Give each boss one signature move: the depth-5 boss summons rats,
  depth-10 relic guardian teleports, etc. One `bossAct()` dispatch in
  `enemyTurn`. *Moderate.*
- **F4-f — Shrine variety.** Shrines grant one fixed blessing today. Roll one
  of: heal, enchant, identify-all, curse-removal, or a gamble (bless-or-curse)
  — with distinct tint/particles. *Cheap.*
- **F4-g — Second win tier / endless mode.** After grabbing the Relic at depth
  10, offer a choice: ascend to win (climb back up through repopulated floors
  — thrilling with F1/M16) or keep descending in an endless scaling mode for
  score. The "ascent with the relic" escape is a classic roguelike finale and
  would reuse floor regeneration from F1. *Large, but a signature feature.*
- **F4-i — Monster roster freshening.** *(Scott: confirmed interest.)* Most of
  the roster is stat-line-plus-tint today. Give each existing monster one
  identity quirk (goblins steal gold and run, bandits call an ally when first
  hit, wraiths phase through walls every other turn, dread knights riposte),
  and add 2-3 genuinely new behaviors deeper down (a splitter slime, a
  trap-laying spider, a mimic chest reusing the chest strip). Builds entirely
  on the M4/M8 AI hooks (`flees`, `ranged`, per-type branches in `enemyTurn`).
  *Moderate; high flavor per line of code.*
- **F4-h — A fourth class.** E.g. a **Ranger**: starts with a bow (ranged
  basic attack at 4 tiles, weaker in melee), abilities Volley (hit 3 nearest
  visible) and Trap (place a spike trap). Ranged basic attack is the only new
  mechanic; everything else exists. *Moderate.*

## F5 — Persistence / meta ideas

- **F5-a — Camp stash.** A chest at camp (F1) holding ~10 items that persist
  **across runs** (`localStorage`, like scores.js). Death loses carried gear
  but not stashed gear. This is a meaningful difficulty knob — maybe unlock it
  via the existing meta-unlock system so purists earn it. *Moderate.*
- **F5-b — Bestiary & discoveries page.** Track first-kills per monster type
  in `updateMeta`; a title-screen page shows sprites + stats of everything
  encountered, with silhouettes for undiscovered ones. *Cheap-moderate.*
- **F5-c — Achievements.** ~15 flags in scores.js ("win without a potion",
  "reach depth 5 with a cursed ring", "sell 50 items") surfaced on the title
  and death recap. *Cheap, endless flavor.*

---

## Suggested sequencing

```
M16 + F1/M19 (fuel clock + base camp — designed as a pair)
   → F2-a/b/d/f/g (cheap QoL batch)
   → F2-e (save & resume)
   → F4-b + F4-c (bounties + trinket loot, builds on camp)
   → F4-g (ascent finale) → F5-a (stash) → the rest as taste dictates
```

Rationale: F1+M16 complete the game's core tension loop; the QoL batch makes
long runs comfortable; save/resume unlocks longer sessions that the camp loop
encourages; bounties give the camp a reason to exist beyond shopping; the
ascent finale is the flagship "2.0" feature.
