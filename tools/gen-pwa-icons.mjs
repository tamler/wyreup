/**
 * One-off script: generates PWA icons from packages/web/public/favicon.svg
 * Run: node tools/gen-pwa-icons.mjs
 * Output: packages/web/public/pwa-192.png, pwa-512.png, pwa-maskable-512.png
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'packages/web/public');

const svgSrc = readFileSync(join(publicDir, 'favicon.svg'), 'utf-8');

function render(svgString, size) {
  const resvg = new Resvg(svgString, {
    fitTo: { mode: 'width', value: size },
  });
  return resvg.render().asPng();
}

// pwa-192.png — plain render
const png192 = render(svgSrc, 192);
writeFileSync(join(publicDir, 'pwa-192.png'), png192);
console.log('wrote pwa-192.png');

// pwa-512.png — plain render
const png512 = render(svgSrc, 512);
writeFileSync(join(publicDir, 'pwa-512.png'), png512);
console.log('wrote pwa-512.png');

// pwa-maskable-512.png — glyph inset ~10% each side (20% padding)
// We embed the svg inside a padded viewport: original glyph occupies 80% of 512 = 409.6px
// We do this by wrapping in a new SVG with a translated/scaled inner group.
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#111113"/>
  <svg x="51.2" y="51.2" width="409.6" height="409.6" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 3 L3 6 M3 3 L6 3 M13 3 L10 3 M13 3 L13 6 M3 13 L3 10 M3 13 L6 13 M13 13 L10 13 M13 13 L13 10" stroke="#FFB000" stroke-width="1.5" stroke-linecap="round" fill="none"/>
  </svg>
</svg>`;

const pngMaskable = render(maskableSvg, 512);
writeFileSync(join(publicDir, 'pwa-maskable-512.png'), pngMaskable);
console.log('wrote pwa-maskable-512.png');

// apple-touch-icon.png (180x180)
const png180 = render(svgSrc, 180);
writeFileSync(join(publicDir, 'apple-touch-icon.png'), png180);
console.log('wrote apple-touch-icon.png');

console.log('Done.');
