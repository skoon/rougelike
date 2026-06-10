// Mulberry32 seeded PRNG — one shared state, seeded per floor.

let state = 0;

export function seedRng(seed) {
  state = seed >>> 0;
}

// Returns a float in [0, 1).
export function rng() {
  state = (state + 0x6D2B79F5) >>> 0;
  let z = state;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}

// FNV-1a: hash an arbitrary string to a uint32 seed.
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
