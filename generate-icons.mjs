/**
 * generate-icons.mjs
 *
 * Reads src/images/logo.svg (the bird) and generates all icon PNGs
 * with a cream (#fffdef) rounded-rectangle background.
 *
 * Usage:  npm run icons
 * Needs:  sharp (npm i -D sharp)
 *
 * All dimensions are based on a 512px canvas:
 *   - Rounded rect: 472×472, centered (20px margin), corner-radius 40
 *   - Bird SVG composited on top, padded to ~70% of canvas
 */

import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config (all values at 512px base) ---
const BASE       = 512;
const RECT_SIZE  = 472;
const RECT_MARGIN = (BASE - RECT_SIZE) / 2;  // 20
const RADIUS     = 40;
const BG_COLOR   = '#fffdef';

// Bird padding inside the rounded rect (percentage of rect)
const BIRD_PAD_PCT = 0.10;  // 10% padding on each side

// --- Output targets ---
const OUTPUTS = [
  { path: 'src/images/icons/icon-512x512.png', size: 512 },
  { path: 'src/images/icons/icon-192x192.png', size: 192 },
  { path: 'src/images/logo.png',               size: 512 },
  { path: 'src/images/favicon.png',            size: 192 },
];

// --- Build composite SVG ---

// Read the bird path from the SVG source
const logoSvg = readFileSync(join(__dirname, 'src/images/logo.svg'), 'utf8');

// Extract the <path d="..."/> and the <g transform="..."> from the source SVG
const pathMatch = logoSvg.match(/<path d="([^"]+)"/s);
const transformMatch = logoSvg.match(/<g transform="([^"]+)"/);
const viewBoxMatch = logoSvg.match(/viewBox="([^"]+)"/);

if (!pathMatch || !transformMatch || !viewBoxMatch) {
  console.error('Could not parse logo.svg');
  process.exit(1);
}

const pathD = pathMatch[1];
const gTransform = transformMatch[1];
const [vbX, vbY, vbW, vbH] = viewBoxMatch[1].split(/\s+/).map(Number);

// The bird SVG viewBox is 970×979 (in pt units, but viewBox is unitless)
// We want to fit it inside the rounded rect with some padding
const birdPad = RECT_SIZE * BIRD_PAD_PCT;
const birdAreaSize = RECT_SIZE - birdPad * 2;

// Scale factor to fit bird into birdAreaSize
const birdScale = birdAreaSize / Math.max(vbW, vbH);

// Center the bird within the rounded rect
const birdOffsetX = RECT_MARGIN + birdPad + (birdAreaSize - vbW * birdScale) / 2;
const birdOffsetY = RECT_MARGIN + birdPad + (birdAreaSize - vbH * birdScale) / 2;

// Build a single SVG at 512×512
const compositeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${BASE}" height="${BASE}" viewBox="0 0 ${BASE} ${BASE}">
  <!-- Cream rounded rectangle background -->
  <rect x="${RECT_MARGIN}" y="${RECT_MARGIN}" width="${RECT_SIZE}" height="${RECT_SIZE}"
        rx="${RADIUS}" ry="${RADIUS}" fill="${BG_COLOR}" />
  <!-- Bird logo -->
  <g transform="translate(${birdOffsetX}, ${birdOffsetY}) scale(${birdScale})">
    <svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">
      <g transform="${gTransform}" fill="#000000" stroke="none">
        <path d="${pathD}"/>
      </g>
    </svg>
  </g>
</svg>`;

// --- Generate PNGs ---

async function generate() {
  const baseBuf = Buffer.from(compositeSvg);

  for (const { path: outPath, size } of OUTPUTS) {
    const fullPath = join(__dirname, outPath);
    mkdirSync(dirname(fullPath), { recursive: true });

    await sharp(baseBuf)
      .resize(size, size)
      .png()
      .toFile(fullPath);

    console.log(`✅ ${outPath} (${size}×${size})`);
  }

  console.log('\nDone! All icons generated from src/images/logo.svg');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
