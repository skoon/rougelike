// Bootstrap: load assets, show the title screen, start on click.

import { loadAssets } from "./assets.js";
import { Game, showOverlay } from "./game.js";
import { audio } from "./audio.js";

// Wire the footer volume slider + mute button to the audio manager. These work
// before the AudioContext exists (settings are stored and applied on init).
function setupAudioControls() {
  const slider = document.getElementById("vol-slider");
  const mute = document.getElementById("mute-btn");
  const reflect = () => {
    slider.value = Math.round(audio.settings.master * 100);
    mute.textContent = audio.settings.muted ? "🔇" : "🔊";
  };
  slider.addEventListener("input", () => audio.setMaster(slider.value / 100));
  mute.addEventListener("click", () => { audio.toggleMute(); reflect(); });
  reflect();
}

async function boot() {
  const canvas = document.getElementById("game");
  setupAudioControls();
  try {
    await loadAssets();
  } catch (err) {
    document.getElementById("overlay-text").textContent =
      "Failed to load art assets: " + err.message;
    document.getElementById("overlay").classList.remove("hidden");
    return;
  }

  const game = new Game(canvas);

  showOverlay(
    "Catacombs of the Forgotten",
    "Delve as deep as you dare. Bump into foes to attack, grab loot, and find the stairs to descend. Death is permanent.",
    "Enter the Catacombs",
    () => game.start()
  );
}

boot();
