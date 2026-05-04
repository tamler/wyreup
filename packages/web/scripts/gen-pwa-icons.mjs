/**
 * One-off script: generates PWA icons from packages/web/public/favicon.svg
 * Run: node packages/web/scripts/gen-pwa-icons.mjs
 * Output: packages/web/public/pwa-{192,512,maskable-512,monochrome-512}.png
 *         + apple-touch-icon.png
 *
 * Lives under packages/web/scripts/ rather than the repo-root tools/
 * directory so the @resvg/resvg-js dependency resolves through the
 * web package's node_modules tree (the repo root doesn't declare it).
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const svgSrc = readFileSync(join(publicDir, 'favicon.svg'), 'utf-8');

function render(svgString, size, { background = null } = {}) {
  const opts = { fitTo: { mode: 'width', value: size } };
  if (background) opts.background = background;
  const resvg = new Resvg(svgString, opts);
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

// pwa-monochrome-512.png — single-color silhouette on transparent bg.
// Used by Android 13+ themed icons, GNOME Shell badges, and other OS
// surfaces that recolor the icon to match the system theme. Spec
// requires transparent background and a single non-color glyph;
// browsers tint at render time.
const monochromeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <path d="M3 3 L3 6 M3 3 L6 3 M13 3 L10 3 M13 3 L13 6 M3 13 L3 10 M3 13 L6 13 M13 13 L10 13 M13 13 L13 10" stroke="#FFFFFF" stroke-width="1.5" stroke-linecap="round" fill="none"/>
</svg>`;
const pngMonochrome = render(monochromeSvg, 512);
writeFileSync(join(publicDir, 'pwa-monochrome-512.png'), pngMonochrome);
console.log('wrote pwa-monochrome-512.png');

console.log('Done.');
