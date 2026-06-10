// NPC types and factory for merchants and healers.

import { rng } from "./rng.js";

export const NPC_TYPES = {
  merchant: {
    name: "Merchant",
    layers: [[0, 2]],
    tint: "#d4a820",
    greeting: "Welcome, adventurer. See anything you like?",
    indicator: "$",
  },
  healer: {
    name: "Healer",
    layers: [[1, 11]],
    tint: "#5090d8",
    greeting: "Your wounds cry out for my art.",
    indicator: "+",
  },
};

const WARE_POOL = ["potion", "potion", "weapon", "weapon", "armor", "shield", "key"];

// Returns an array of 3 item key strings for a merchant's stock.
export function genWares() {
  const pool = WARE_POOL.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
}

export function makeNpc(type, x, y) {
  const t = NPC_TYPES[type];
  return {
    kind: "npc",
    npcType: type,
    name: t.name,
    layers: t.layers,
    tint: t.tint,
    tintStrength: 0.55,
    greeting: t.greeting,
    indicator: t.indicator,
    x, y,
    rx: x, ry: y,
    facing: 1,
    bobPhase: Math.random() * Math.PI * 2,
    flashUntil: 0,
    lungeStart: 0,
    lungeDx: 0,
    lungeDy: 0,
    statuses: [],
    alive: true,
    wareItems: null, // set by Game.nextLevel after seeded item generation
  };
}
