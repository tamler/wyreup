import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { isBuiltin } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(packageRoot, 'dist');
await mkdir(dist, { recursive: true });

const allowedCore = new Set([
  'packages/core/src/lib/codecs.ts',
  'packages/core/src/lib/exif.ts',
  'packages/core/src/lib/pick-smaller.ts',
  'packages/core/src/lib/budget.ts',
  'packages/core/src/tools/compress-image-to-size/index.ts',
  'packages/core/src/tools/compress-image-to-size/types.ts',
  'packages/core/src/tools/strip-exif/index.ts',
  'packages/core/src/tools/strip-exif/types.ts',
  'packages/core/src/tools/merge-pdf/index.ts',
  'packages/core/src/tools/merge-pdf/types.ts',
]);

const runtimeImports = new Set(['pdf-lib', 'sharp',
  '@jsquash/jpeg/decode.js', '@jsquash/jpeg/encode.js',
  '@jsquash/png/decode.js', '@jsquash/png/encode.js',
  '@jsquash/webp/decode.js', '@jsquash/webp/encode.js']);

async function backend(entry) {
  const result = await build({
    absWorkingDir: root, entryPoints: [resolve(packageRoot, 'src', `${entry}.ts`)],
    outfile: resolve(dist, `${entry}.js`), bundle: true, platform: 'node', format: 'esm',
    target: 'node22', external: ['@jsquash/*', 'pdf-lib', 'sharp'],
    treeShaking: true, metafile: true, write: false, drop: ['console'],
    banner: { js: 'import { createRequire as createPilotRequire } from "node:module"; const require = createPilotRequire(import.meta.url);' },
  });
  const inputs = Object.keys(result.metafile.inputs).map(input => relative(root, resolve(root, input)).replace(/\\/g, '/'));
  const core = inputs.filter(input => input.startsWith('packages/core/'));
  if (core.some(input => !allowedCore.has(input)) ||
      (entry === 'worker' && (core.length !== allowedCore.size || [...allowedCore].some(input => !core.includes(input)))) ||
      (entry === 'index' && core.length !== 0)) throw new Error('Unexpected core bundle input.');
  for (const output of Object.values(result.metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external && !isBuiltin(dependency.path) && !runtimeImports.has(dependency.path)) {
        throw new Error('Unexpected external runtime dependency.');
      }
    }
  }
  for (const output of result.outputFiles) {
    await writeFile(output.path, output.contents);
    execFileSync(process.execPath, ['--check', output.path]);
  }
  await writeFile(resolve(dist, `${entry}.metafile.json`), JSON.stringify(result.metafile, null, 2) + '\n');
}

await backend('index');
await backend('worker');
await build({
  entryPoints: [resolve(packageRoot, 'src/widget.ts')], outfile: resolve(dist, 'widget.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  drop: ['console'], legalComments: 'none', minify: true, write: true,
});
execFileSync(process.execPath, ['--check', resolve(dist, 'widget.js')]);
const widget = await readFile(resolve(dist, 'widget.js'), 'utf8');
if (/\bconsole\s*(?:\.|\[)/.test(widget)) throw new Error('Widget bundle contains a console call.');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="wyreup-result"></div><script type="module">${widget.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
await writeFile(resolve(dist, 'widget.html'), html);
