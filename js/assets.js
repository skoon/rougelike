// Sprite sheet loading and tile coordinate definitions.
// Kenney Roguelike packs: 16x16 tiles with a 1px margin (stride 17).

export const TILE = 16;
const STRIDE = 17;

const SHEETS = {
  dungeon: "assets/Roguelike Dungeon Pack/Spritesheet/roguelikeDungeon_transparent.png",
  chars: "assets/Roguelike Characters Pack/Spritesheet/roguelikeChar_transparent.png",
};

const images = {};

export function loadAssets() {
  const entries = Object.entries(SHEETS);
  return Promise.all(
    entries.map(
      ([key, path]) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            images[key] = img;
            resolve();
          };
          img.onerror = () => reject(new Error("Failed to load " + path));
          img.src = encodeURI(path);
        })
    )
  );
}

// A sprite is [sheet, col, row].
export const SPR = {
  // --- environment (dungeon sheet) ---
  floor: ["dungeon", 8, 2],
  floorAlt: ["dungeon", 8, 1],
  crack: ["dungeon", 11, 3],
  rubble: ["dungeon", 12, 3],
  wall: ["dungeon", 22, 4],
  stairs: ["dungeon", 16, 1],
  door: ["dungeon", 21, 5],

  // --- items (dungeon sheet) ---
  gold: ["dungeon", 15, 12],
  potion: ["dungeon", 14, 15],
  weapon: ["dungeon", 15, 15],
  amulet: ["dungeon", 14, 12],

  // --- actors (characters sheet) ---
  player: ["chars", 0, 6],
  slime: ["chars", 0, 3],
  rat: ["chars", 0, 2],
  bandit: ["chars", 1, 8],
  knight: ["chars", 0, 11],
  ghost: ["chars", 1, 11],
};

// Draw a sprite into ctx at device pixel position (dx,dy) scaled to `size`.
export function drawSprite(ctx, spr, dx, dy, size) {
  const [sheet, col, row] = spr;
  const img = images[sheet];
  if (!img) return;
  ctx.drawImage(
    img,
    col * STRIDE,
    row * STRIDE,
    TILE,
    TILE,
    dx,
    dy,
    size,
    size
  );
}
