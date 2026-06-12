// Sprite sheet loading and tile coordinate definitions.
// Kenney Roguelike packs: 16x16 tiles with a 1px margin (stride 17).
// Tiny Dungeons / Tiny Tales packs: margin-less frame strips (see STRIP_DEFS).

export const TILE = 16;
const STRIDE = 17;

const SHEETS = {
  dungeon: "assets/Roguelike Dungeon Pack/Spritesheet/roguelikeDungeon_transparent.png",
  chars: "assets/Roguelike Characters Pack/Spritesheet/roguelikeChar_transparent.png",
};

// Animated frame strips (no margins). `fw`/`fh` are the per-frame pixel size;
// rows are separate animations (e.g. monster idle / death).
const TD = "assets/Tiny Dungeons - Biome Dungeon Pack/dungeon_elements/";
const TT = "assets/Tiny_Tales_Human_NPC_Nobility_1.0/Original/";
const STRIP_DEFS = {
  chest:    { url: TD + "objects_animated/dungeon_chest.png",   fw: 16, fh: 16 },
  barrel:   { url: TD + "objects_animated/dungeon_barrel.png",  fw: 32, fh: 32 },
  crate:    { url: TD + "objects_animated/dungeon_crate.png",   fw: 32, fh: 32 },
  pot1:     { url: TD + "objects_animated/dungeon_pot_01.png",  fw: 32, fh: 32 },
  pot2:     { url: TD + "objects_animated/dungeon_pot_02.png",  fw: 32, fh: 32 },
  pot3:     { url: TD + "objects_animated/dungeon_pot_03.png",  fw: 32, fh: 32 },
  pot4:     { url: TD + "objects_animated/dungeon_pot_04.png",  fw: 32, fh: 32 },
  brazier:  { url: TD + "objects_animated/dungeon_brazier.png", fw: 32, fh: 32 },
  rat:      { url: TD + "monsters/dungeon_rat.png",             fw: 32, fh: 32 },
  slime:    { url: TD + "monsters/dungeon_slime.png",           fw: 32, fh: 32 },
  skull:    { url: TD + "monsters/dungeon_flying_skull.png",    fw: 32, fh: 32 },
  noble:    { url: TT + "Noble_M1.png",                         fw: 16, fh: 20 },
  princess: { url: TT + "Princess_F1.png",                      fw: 16, fh: 20 },
};

const images = {};
export const STRIPS = {};

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load " + path));
    img.src = encodeURI(path);
  });
}

export function loadAssets() {
  const sheets = Object.entries(SHEETS).map(([key, path]) =>
    loadImage(path).then((img) => { images[key] = img; })
  );
  const strips = Object.entries(STRIP_DEFS).map(([key, def]) =>
    loadImage(def.url).then((img) => {
      STRIPS[key] = { img, fw: def.fw, fh: def.fh, cols: Math.floor(img.width / def.fw) };
    })
  );
  return Promise.all([...sheets, ...strips]);
}

// Draw frame (col,row) of a strip at device position (dx,dy), scaled by
// `scale` device px per art px (2 matches the 16px tiles at CELL=32).
export function drawFrame(ctx, key, col, row, dx, dy, scale = 2) {
  const s = STRIPS[key];
  if (!s) return;
  ctx.drawImage(
    s.img,
    col * s.fw, row * s.fh, s.fw, s.fh,
    dx, dy, s.fw * scale, s.fh * scale
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

  // Actors are composited from layered Characters-sheet tiles; see the
  // `layers` arrays in entities.js and Game.drawActor (js/game.js).
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
