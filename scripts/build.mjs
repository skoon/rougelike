// Build a distributable bundle (M11-T1).
//
//   node scripts/build.mjs
//
// Assembles dist/ from index.html + css + js + ONLY the asset files the game
// actually loads (the raw packs are hundreds of MB; we ship a few hundred KB),
// then zips it for itch.io. No dependencies — uses Node's fs and, on Windows,
// PowerShell's Compress-Archive for the zip step.

import { mkdir, rm, cp, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { ASSET_FILES } from "../js/assets.js";
import { MUSIC_FILE } from "../js/audio.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const ZIP = join(ROOT, "catacombs-of-the-forgotten.zip");

// Top-level files to ship if present (manifest/sw/icons arrive with M11-T2).
const ROOT_FILES = [
  "index.html", "manifest.json", "sw.js",
  "favicon.ico", "favicon.png", "icon-192.png", "icon-512.png",
];
const DIRS = ["css", "js"];
const ASSETS = [...ASSET_FILES, MUSIC_FILE];

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

async function main() {
  console.log("Building dist/ …");
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  let copied = 0;
  const missing = [];

  for (const f of ROOT_FILES) {
    const src = join(ROOT, f);
    if (existsSync(src)) { await cp(src, join(DIST, f)); copied++; }
  }
  for (const d of DIRS) {
    if (existsSync(join(ROOT, d))) { await cp(join(ROOT, d), join(DIST, d), { recursive: true }); }
  }
  for (const rel of ASSETS) {
    const src = join(ROOT, rel);
    if (!existsSync(src)) { missing.push(rel); continue; }
    const dest = join(DIST, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(src, dest);
    copied++;
  }

  if (missing.length) {
    console.error("ERROR — referenced assets not found:\n  " + missing.join("\n  "));
    process.exit(1);
  }

  const bytes = await dirSize(DIST);
  console.log(`Copied ${copied} files + css/ + js/  (dist/ = ${(bytes / 1024).toFixed(0)} KB)`);

  // Zip (Windows PowerShell). Non-fatal if unavailable — dist/ is still usable.
  await rm(ZIP, { force: true });
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-Command",
     `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${ZIP}' -Force`],
    { stdio: "ignore" }
  );
  if (r.status === 0 && existsSync(ZIP)) {
    console.log(`Zipped → ${ZIP} (${((await stat(ZIP)).size / 1024).toFixed(0)} KB)`);
  } else {
    console.log("dist/ ready (zip skipped — Compress-Archive unavailable; zip dist/ manually).");
  }
  console.log("Done. Upload the zip (or dist/) to itch.io as an HTML5 game.");
}

main().catch((e) => { console.error(e); process.exit(1); });
