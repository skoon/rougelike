// Bootstrap: load assets, show the title screen, start on click.

import { loadAssets } from "./assets.js";
import { Game, showOverlay, DEFAULT_KEYS, KEY_ACTIONS } from "./game.js";
import { audio } from "./audio.js";
import { getBest, getUnlocks } from "./scores.js";
import { hashSeed } from "./rng.js";

function parseSeed(raw) {
  if (!raw) return undefined;
  if (/^0x/i.test(raw)) return parseInt(raw, 16) >>> 0;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10) >>> 0;
  return hashSeed(raw);
}

const OPTS_KEY = "rl_opts";
const loadOpts = () => {
  try { return JSON.parse(localStorage.getItem(OPTS_KEY)) || {}; }
  catch { return {}; }
};
const saveOpts = (o) => {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); }
  catch { /* ignore */ }
};

// Wire the footer mute button + settings panel (volume buses, screen shake,
// touch d-pad). The d-pad defaults to on for coarse-pointer (touch) devices.
function setupSettings(game) {
  const opts = Object.assign({ shake: true }, loadOpts());
  game.shakeEnabled = opts.shake;
  if (opts.dpad === undefined)
    opts.dpad = window.matchMedia("(pointer: coarse)").matches;

  const $ = (id) => document.getElementById(id);
  const master = $("vol-master");
  const music = $("vol-music");
  const sfx = $("vol-sfx");
  const mute = $("mute-btn");
  const shake = $("opt-shake");
  const dpadOpt = $("opt-dpad");
  const dpad = $("dpad");
  const reduceFlash = $("opt-reduce-flash");
  const colorblind = $("opt-colorblind");
  const uiscale = $("opt-uiscale");
  const gear = $("settings-btn");
  const panel = $("settings-panel");

  // Readability defaults.
  if (opts.reduceFlash === undefined) opts.reduceFlash = false;
  if (opts.colorblind === undefined) opts.colorblind = false;
  if (opts.uiscale === undefined) opts.uiscale = 100;

  const applyDpad = () => dpad.classList.toggle("visible", opts.dpad);
  const applyReadability = () => {
    game.reduceFlash = opts.reduceFlash;
    game.colorblind = opts.colorblind;
    document.body.classList.toggle("cb", opts.colorblind);
    document.documentElement.style.setProperty("--game-width", (opts.uiscale / 100 * 900) + "px");
  };

  const reflect = () => {
    master.value = Math.round(audio.settings.master * 100);
    music.value = Math.round(audio.settings.music * 100);
    sfx.value = Math.round(audio.settings.sfx * 100);
    shake.checked = game.shakeEnabled;
    dpadOpt.checked = opts.dpad;
    reduceFlash.checked = opts.reduceFlash;
    colorblind.checked = opts.colorblind;
    uiscale.value = opts.uiscale;
    mute.textContent = audio.settings.muted ? "🔇" : "🔊";
  };

  master.addEventListener("input", () => audio.setMaster(master.value / 100));
  music.addEventListener("input", () => audio.setMusic(music.value / 100));
  sfx.addEventListener("input", () => audio.setSfx(sfx.value / 100));
  mute.addEventListener("click", () => { audio.toggleMute(); reflect(); });
  shake.addEventListener("change", () => {
    game.shakeEnabled = shake.checked;
    opts.shake = shake.checked;
    saveOpts(opts);
  });
  dpadOpt.addEventListener("change", () => {
    opts.dpad = dpadOpt.checked;
    saveOpts(opts);
    applyDpad();
  });
  reduceFlash.addEventListener("change", () => {
    opts.reduceFlash = reduceFlash.checked; saveOpts(opts); applyReadability();
  });
  colorblind.addEventListener("change", () => {
    opts.colorblind = colorblind.checked; saveOpts(opts); applyReadability();
  });
  uiscale.addEventListener("input", () => {
    opts.uiscale = parseInt(uiscale.value, 10); saveOpts(opts); applyReadability();
  });
  gear.addEventListener("click", () => panel.classList.toggle("hidden"));

  // --- key rebinding ---
  const keysWrap = $("keybinds");
  const keyLabel = (k) => k === " " ? "Space" : (k || "—").length === 1 ? k.toUpperCase() : k;
  const applyKeys = () => game.setKeymap(opts.keys);
  opts.keys = Object.assign({ ...DEFAULT_KEYS }, opts.keys);
  applyKeys();

  let capturing = null; // { action, btn } while waiting for a keypress
  const renderKeys = () => {
    keysWrap.innerHTML = "";
    for (const [action, label] of KEY_ACTIONS) {
      const row = document.createElement("div");
      row.className = "keybind-row";
      const name = document.createElement("span");
      name.textContent = label;
      const btn = document.createElement("button");
      btn.textContent = keyLabel(opts.keys[action]);
      btn.onclick = () => {
        if (capturing) capturing.btn.textContent = keyLabel(opts.keys[capturing.action]);
        capturing = { action, btn };
        btn.textContent = "press a key…";
        btn.classList.add("capturing");
        game.captureKey = true; // make the game ignore the next keydown
      };
      row.appendChild(name);
      row.appendChild(btn);
      keysWrap.appendChild(row);
    }
  };

  // Capture phase so we intercept the rebind keypress before the game handler.
  window.addEventListener("keydown", (e) => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    const k = e.key.toLowerCase();
    if (k !== "escape") {
      // Free this key from any other action, then assign it.
      for (const [a] of KEY_ACTIONS) if (opts.keys[a] === k) opts.keys[a] = "";
      opts.keys[capturing.action] = k;
      saveOpts(opts);
      applyKeys();
    }
    capturing.btn.classList.remove("capturing");
    capturing = null;
    game.captureKey = false;
    renderKeys();
  }, true);

  $("keys-reset").addEventListener("click", () => {
    opts.keys = { ...DEFAULT_KEYS };
    saveOpts(opts);
    applyKeys();
    renderKeys();
  });
  renderKeys();

  applyDpad();
  applyReadability();
  reflect();
}

async function boot() {
  const canvas = document.getElementById("game");
  try {
    await loadAssets();
  } catch (err) {
    document.getElementById("overlay-text").textContent =
      "Failed to load art assets: " + err.message;
    document.getElementById("overlay").classList.remove("hidden");
    return;
  }

  const game = new Game(canvas);
  setupSettings(game);

  const best = getBest();
  const bestLine = best
    ? (best.won
        ? ` Last victory: depth ${best.depth}, Lv ${best.level}!`
        : ` Best run: depth ${best.depth}, Lv ${best.level}.`)
    : "";

  const seedRow = document.getElementById("seed-row");
  const seedInput = document.getElementById("seed-input");
  seedRow.classList.remove("hidden");

  const classPanel = document.getElementById("class-panel");

  showOverlay(
    "Catacombs of the Forgotten",
    `Delve as deep as you dare. Bump into foes to attack, grab loot, and find the stairs to descend. Death is permanent.${bestLine}`,
    "Enter the Catacombs",
    () => {
      seedRow.classList.add("hidden");
      const chosenSeed = parseSeed(seedInput.value.trim());
      classPanel.classList.remove("hidden");

      // Restore original text before annotating (prevents duplication on repeat shows).
      classPanel.querySelectorAll(".cls-perk, .cls-kit").forEach((el) => {
        if (!el.dataset.orig) el.dataset.orig = el.textContent;
        else el.textContent = el.dataset.orig;
      });

      // Annotate unlocked perks.
      const u = getUnlocks();
      const annot = (sel, txt) => {
        const el = classPanel.querySelector(sel);
        if (el) el.textContent += txt;
      };
      if (u.hardened)    annot("[data-cls=warrior] .cls-perk", " (+5 HP)");
      if (u.shadowcraft) annot("[data-cls=rogue] .cls-perk",   " (40%)");
      if (u.archmage)    annot("[data-cls=mage] .cls-perk",    " (+1 potion)");
      if (u.veteran)
        classPanel.querySelectorAll(".cls-kit")
          .forEach((el) => { el.textContent += " + bonus potion."; });

      classPanel.querySelectorAll(".cls-btn").forEach((btn) => {
        btn.onclick = () => {
          const cls = btn.closest(".cls-opt").dataset.cls;
          classPanel.classList.add("hidden");
          game.start(chosenSeed, cls);
        };
      });
    }
  );
}

boot();
