import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { build } from 'vite';
import { injectManifest } from 'workbox-build';

const registration =
  "if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('/sw.js', { scope: '/' })})}";
/** @param {string} file */
const checkJavaScript = (file) => execFileSync(process.execPath, ['--check', file]);

/** @typedef {Omit<import('workbox-build').InjectManifestOptions, 'swSrc' | 'swDest' | 'globDirectory'>} PrecacheOptions */

/**
 * @param {{root:string,outDir:string,manifest:Record<string,unknown>,precache:PrecacheOptions,format:string,trailingSlash:string,assets:string}} options
 */
export async function buildPwa({
  root,
  outDir,
  manifest,
  precache,
  format,
  trailingSlash,
  assets,
}) {
  await writeFile(join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest));
  await writeFile(join(outDir, 'registerSW.js'), registration);
  checkJavaScript(join(outDir, 'registerSW.js'));
  const temporary = await mkdtemp(join(tmpdir(), 'wyreup-pwa-'));
  try {
    await build({
      configFile: false,
      root,
      publicDir: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: temporary,
        emptyOutDir: false,
        minify: true,
        lib: {
          entry: join(root, 'src/sw.ts'),
          name: 'WyreupServiceWorker',
          formats: ['iife'],
          fileName: () => 'sw-source.js',
        },
      },
    });
    const swSrc = join(temporary, 'sw-source.js');
    const swDest = join(outDir, 'sw.js');
    checkJavaScript(swSrc);
    const assetDirectory = assets.replace(/^\/+|\/+$/g, '');
    const result = await injectManifest({
      ...precache,
      swSrc,
      swDest,
      globDirectory: outDir,
      globIgnores: [...(precache.globIgnores ?? []), 'sw.js'],
      dontCacheBustURLsMatching: new RegExp(
        `^${assetDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`,
      ),
      manifestTransforms: [
        (entries) =>
          Promise.resolve({
            manifest: entries.map((entry) => {
              if (!entry.url.endsWith('.html')) return entry;
              let url = entry.url === 'index.html' ? '/' : entry.url.replace(/\.html$/, '');
              if (format === 'directory' && url.endsWith('/index')) url = url.slice(0, -6);
              if (trailingSlash === 'always' && url !== '/') url += '/';
              return { ...entry, url };
            }),
            warnings: [],
          }),
      ],
    });
    checkJavaScript(swDest);
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * @param {{manifest:Record<string,unknown>,injectManifest:PrecacheOptions}} options
 * @returns {import('astro').AstroIntegration}
 */
export default function wyreupPwa({ manifest, injectManifest: precache }) {
  /** @type {import('astro').AstroConfig | undefined} */
  let config;
  return {
    name: 'wyreup:pwa',
    hooks: {
      'astro:config:done': ({ config: resolved }) => {
        config = resolved;
      },
      'astro:build:done': async ({ dir, logger }) => {
        if (!config || config.output !== 'static' || config.base !== '/') {
          throw new Error('Wyreup PWA requires a static build served at the site root');
        }
        const result = await buildPwa({
          root: fileURLToPath(config.root),
          outDir: fileURLToPath(dir),
          manifest,
          precache,
          format: config.build.format,
          trailingSlash: config.trailingSlash,
          assets: config.build.assets,
        });
        if (result.warnings.length)
          throw new Error(`PWA precache incomplete: ${result.warnings.join('; ')}`);
        logger.info(`Precached ${result.count} assets (${result.size} bytes)`);
      },
    },
  };
}
