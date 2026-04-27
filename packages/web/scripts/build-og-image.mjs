#!/usr/bin/env node
/**
 * Render public/og-image.svg → public/og-image.png at 1200×630.
 *
 * LinkedIn and Twitter/X don't reliably render SVG og:image tags. This
 * script produces a PNG fallback alongside the SVG so social-card
 * unfurling works everywhere. Run manually after editing the SVG; the
 * PNG is committed alongside it.
 *
 * Usage: pnpm run build:og
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, '..', 'public', 'og-image.svg');
const pngPath = resolve(here, '..', 'public', 'og-image.png');

const svg = await readFile(svgPath, 'utf8');

const { Resvg } = await import('@resvg/resvg-js');
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1200 },
  background: '#111113',
  font: {
    // Without a system font, Resvg falls back to its built-in. The
    // wordmark stays legible; subtitle works on most platforms.
    loadSystemFonts: true,
  },
});
const png = resvg.render().asPng();

await writeFile(pngPath, png);
console.log(`Wrote ${pngPath} (${png.byteLength.toLocaleString()} bytes)`);
