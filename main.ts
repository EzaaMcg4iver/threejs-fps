/**
 * threejs-fps-01 entry (Node 22, standard library only).
 *
 * Hands in the game BREACHLINE: copies game/ (the playable game as static
 * ES modules) and screenshots/ (3 or 4 renders of the game) from this
 * repository to the output directory, then writes /output/dossier.json
 * with buildDossier from vendor/makefun-threejs.ts (the kit's copy,
 * unchanged). Deterministic: the same repository writes the same bytes
 * on every run — file contents only, no clock, no randomness, copies in
 * sorted order.
 *
 * Usage: MAKEFUN_OUTPUT_DIR=<dir> node main.ts   (default /output)
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const OUTPUT_DIR = process.env['MAKEFUN_OUTPUT_DIR'] ?? '/output';

function copyTree(srcDir: string, dstDir: string): void {
  mkdirSync(dstDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    const stat = lstatSync(src);
    if (stat.isSymbolicLink()) throw new Error(`refusing to copy symlink: ${src}`);
    if (stat.isDirectory()) copyTree(src, dst);
    else if (stat.isFile()) copyFileSync(src, dst);
  }
}

function main(): void {
  const gameDir = join(REPO_DIR, 'game');
  const shotsDir = join(REPO_DIR, 'screenshots');
  if (!existsSync(gameDir)) throw new Error('game/ is missing from the repository');
  if (!existsSync(shotsDir)) throw new Error('screenshots/ is missing from the repository');
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });
  copyTree(gameDir, join(OUTPUT_DIR, 'game'));
  copyTree(shotsDir, join(OUTPUT_DIR, 'screenshots'));
  const dossier = buildDossier(OUTPUT_DIR, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(OUTPUT_DIR, 'dossier.json'), dossier);
  console.log(`wrote ${OUTPUT_DIR}/dossier.json (${dossier.length} bytes)`);
}

main();
