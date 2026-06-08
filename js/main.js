// Bootstrap: load assets, show the title screen, start on click.

import { loadAssets } from "./assets.js";
import { Game, showOverlay } from "./game.js";

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

  showOverlay(
    "Catacombs of the Forgotten",
    "Delve as deep as you dare. Bump into foes to attack, grab loot, and find the stairs to descend. Death is permanent.",
    "Enter the Catacombs",
    () => game.start()
  );
}

boot();
