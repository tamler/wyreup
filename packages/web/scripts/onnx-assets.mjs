import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import manifest from '../../core/src/lib/onnx-assets.json' with { type: 'json' };

const webDirectory = resolve(import.meta.dirname, '..');
const coreRequire = createRequire(join(webDirectory, '../core/package.json'));
const hfRequire = createRequire(coreRequire.resolve('@huggingface/transformers'));
const origin = 'https://models.wyreup.com';
const prefix = '\0wyreup-onnx-asset:';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export default function onnxAssets() {
  let directories;
  const virtual = new Map();
  async function validate() {
    if (directories) return directories;
    const entries = [];
    for (const loader of [coreRequire, hfRequire]) {
      const directory = await realpath(
        dirname(loader.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')),
      );
      const installed = JSON.parse(await readFile(join(directory, '../package.json'), 'utf8'));
      const runtime = manifest.runtimes.find((item) => item.version === installed.version);
      if (!runtime) throw new Error(`Unpinned ONNX browser runtime: ${installed.version}`);
      for (const asset of runtime.assets) {
        const bytes = await readFile(join(directory, asset.file));
        if (bytes.length !== asset.bytes || sha256(bytes) !== asset.sha256) {
          throw new Error(`ONNX runtime source mismatch: ${runtime.version}/${asset.file}`);
        }
      }
      entries.push({ directory, runtime });
    }
    directories = entries;
    return entries;
  }
  function assetUrl(runtime, file) {
    return `${origin}/onnxruntime-web@${runtime.version}/dist/${file}`;
  }
  async function runtimeFor(id) {
    const path = id.split('?')[0];
    if (!path.includes('onnxruntime-web')) return null;
    const file = await realpath(path);
    return (await validate()).find((entry) => file.startsWith(entry.directory + '/')) ?? null;
  }
  return {
    name: 'wyreup-pinned-onnx-assets',
    enforce: 'pre',
    async buildStart() {
      await validate();
    },
    async resolveId(source, importer) {
      if (!source.endsWith('?url') || !/ort-wasm-simd-threaded.*\.(?:wasm|mjs)\?url$/.test(source))
        return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved || resolved.external) return null;
      const entry = await runtimeFor(resolved.id);
      if (!entry) return null;
      const file = resolved.id.split('?')[0].split('/').at(-1);
      if (!entry.runtime.assets.some((asset) => asset.file === file))
        throw new Error(`Unpinned ONNX asset: ${file}`);
      const id = prefix + entry.runtime.version + '/' + file;
      virtual.set(id, assetUrl(entry.runtime, file));
      return id;
    },
    load(id) {
      const url = virtual.get(id);
      return url ? `export default ${JSON.stringify(url)};` : null;
    },
    async transform(code, id) {
      if (!id.split('?')[0].endsWith('.mjs')) return null;
      const entry = await runtimeFor(id);
      if (!entry) return null;
      const replacements = [];
      const pending = [this.parse(code)];
      while (pending.length) {
        const node = pending.pop();
        if (
          node.type === 'NewExpression' &&
          node.callee?.type === 'Identifier' &&
          node.callee.name === 'URL'
        ) {
          const [file, base] = node.arguments;
          if (
            typeof file?.value === 'string' &&
            base?.type === 'MemberExpression' &&
            !base.computed &&
            base.property?.name === 'url' &&
            base.object?.type === 'MetaProperty' &&
            base.object.meta.name === 'import' &&
            base.object.property.name === 'meta' &&
            entry.runtime.assets.some((asset) => asset.file === file.value)
          ) {
            replacements.push({
              start: file.start,
              end: file.end,
              value: JSON.stringify(assetUrl(entry.runtime, file.value)),
            });
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value))
            pending.push(...value.filter((item) => item && typeof item.type === 'string'));
          else if (value && typeof value.type === 'string') pending.push(value);
        }
      }
      if (!replacements.length) return null;
      let transformed = code;
      for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
        transformed =
          transformed.slice(0, replacement.start) +
          replacement.value +
          transformed.slice(replacement.end);
      }
      return { code: transformed, map: null };
    },
    async generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset' && /ort-wasm-simd-threaded.*\.wasm$/.test(output.fileName)) {
          throw new Error(`ONNX binary unexpectedly emitted into Pages: ${output.fileName}`);
        }
      }
      for (const runtime of manifest.runtimes) {
        for (const license of runtime.licenses) {
          const source = await readFile(
            join(webDirectory, 'licenses', `onnxruntime-web@${runtime.version}`, license.file),
          );
          if (source.length !== license.bytes || sha256(source) !== license.sha256) {
            throw new Error(`ONNX license source mismatch: ${runtime.version}/${license.file}`);
          }
          this.emitFile({
            type: 'asset',
            fileName: `licenses/onnxruntime-web@${runtime.version}/${license.file}`,
            source,
          });
        }
      }
    },
  };
}
