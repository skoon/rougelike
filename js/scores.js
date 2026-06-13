// Run history, best-score, and lifetime meta-progression persistence.

const SCORES_KEY = "rl_scores";
const META_KEY   = "rl_meta";

function load() {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY)) || { best: null, history: [] }; }
  catch { return { best: null, history: [] }; }
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) ||
      { totalRuns: 0, totalKills: 0, deepestDepth: 0, wins: 0 };
  } catch { return { totalRuns: 0, totalKills: 0, deepestDepth: 0, wins: 0 }; }
}

// Save a completed run and update the best if applicable. `run` carries
// { depth, level, gold, won } plus optional recap fields (cls, kills, cause,
// seed, ms, at). Returns the updated store ({ best, history }).
export function saveRun(run) {
  const data = load();
  const entry = { at: Date.now(), ...run };
  data.history.unshift(entry);
  if (data.history.length > 20) data.history.length = 20;
  if (!data.best || entry.depth > data.best.depth ||
      (entry.depth === data.best.depth && entry.gold > data.best.gold)) {
    data.best = entry;
  }
  try { localStorage.setItem(SCORES_KEY, JSON.stringify(data)); } catch {}
  return data;
}

export function getHistory() {
  return load().history;
}

// Update lifetime meta stats at run end; returns the updated meta object.
export function updateMeta(depth, kills, won) {
  const m = loadMeta();
  m.totalRuns++;
  m.totalKills += kills;
  m.deepestDepth = Math.max(m.deepestDepth, depth);
  if (won) m.wins++;
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
  return m;
}

// Compute which meta-progression unlocks are active.
// Thresholds: depth 5 → hardened, 50 kills → shadowcraft,
//             1 win → archmage, 10 runs → veteran.
export function getUnlocks() {
  const m = loadMeta();
  return {
    hardened:    m.deepestDepth >= 5,   // Warrior: +5 max HP
    shadowcraft: m.totalKills >= 50,    // Rogue: backstab 40% (up from 30%)
    archmage:    m.wins >= 1,           // Mage: starts with 4th potion
    veteran:     m.totalRuns >= 10,     // All classes: +1 starting potion
  };
}

export function getBest() {
  return load().best;
}

export function getMeta() {
  return loadMeta();
}
