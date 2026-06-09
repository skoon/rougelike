// Bootstrap: load assets, show the title screen, start on click.

import { loadAssets } from "./assets.js";
import { Game, showOverlay } from "./game.js";
import { audio } from "./audio.js";

const OPTS_KEY = "rl_opts";
const loadOpts = () => {
  try { return JSON.parse(localStorage.getItem(OPTS_KEY)) || {}; }
  catch { return {}; }
};
const saveOpts = (o) => {
  try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); }
  catch { /* ignore */ }
};

// Wire the footer mute button + settings panel (volume buses, screen shake).
function setupSettings(game) {
  const opts = Object.assign({ shake: true }, loadOpts());
  game.shakeEnabled = opts.shake;

  const $ = (id) => document.getElementById(id);
  const master = $("vol-master");
  const music = $("vol-music");
  const sfx = $("vol-sfx");
  const mute = $("mute-btn");
  const shake = $("opt-shake");
  const gear = $("settings-btn");
  const panel = $("settings-panel");

  const reflect = () => {
    master.value = Math.round(audio.settings.master * 100);
    music.value = Math.round(audio.settings.music * 100);
    sfx.value = Math.round(audio.settings.sfx * 100);
    shake.checked = game.shakeEnabled;
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
  gear.addEventListener("click", () => panel.classList.toggle("hidden"));
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

  showOverlay(
    "Catacombs of the Forgotten",
    "Delve as deep as you dare. Bump into foes to attack, grab loot, and find the stairs to descend. Death is permanent.",
    "Enter the Catacombs",
    () => game.start()
  );
}

boot();
