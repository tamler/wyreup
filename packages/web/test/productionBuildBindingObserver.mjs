import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const BINDING_LIMITS = Object.freeze({
  recordBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024,
  records: 12,
  stringBytes: 8 * 1024,
  arrays: 256,
  aliases: 128,
  depth: 8,
  visited: 4096,
});

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const absent = () => ({ kind: 'absent' });
const undefinedValue = () => ({ kind: 'undefined' });
const inside = (root, file) => file === root || file.startsWith(root + sep);

const coreProofError = (field) => new Error(`Browser binding coordinated core proof mismatch: ${field}`);
function exactObject(value, keys, field) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.getOwnPropertySymbols(value).length ||
      Object.getOwnPropertyNames(value).sort().join(',') !== [...keys].sort().join(',') ||
      Object.getOwnPropertyNames(value).some((key) => !('value' in Object.getOwnPropertyDescriptor(value, key))))
    throw coreProofError(field);
}
function logicalPath(value, field) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..'))
    throw coreProofError(field);
  return value;
}
function proofPin(value, field, absolute = false) {
  exactObject(value, ['path', 'bytes', 'sha256'], field);
  if (absolute ? typeof value.path !== 'string' || !isAbsolute(value.path) : !logicalPath(value.path, field))
    throw coreProofError(field);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0 || !/^[a-f0-9]{64}$/.test(value.sha256))
    throw coreProofError(field);
}
function sortedPins(values, field) {
  if (!Array.isArray(values) || !values.length || values.length > 10000 ||
      Object.getOwnPropertyNames(values).length !== values.length + 1)
    throw coreProofError(field);
  let previous = '';
  for (const [index, value] of values.entries()) {
    proofPin(value, `${field}[${index}]`);
    if (value.path <= previous) throw coreProofError(`${field}.order/duplicate`);
    previous = value.path;
  }
}
async function exactFile(root, item, field) {
  const file = resolve(root, logicalPath(item.path, field));
  const base = await realpath(root);
  const info = await lstat(file);
  const actual = await realpath(file);
  if (!info.isFile() || info.isSymbolicLink() || !inside(base, actual)) throw coreProofError(field);
  const bytes = await readFile(actual);
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw coreProofError(field);
  return bytes;
}
async function externalFile(item, field) {
  if ((await realpath(item.path)) !== item.path || !(await lstat(item.path)).isFile()) throw coreProofError(field);
  const bytes = await readFile(item.path);
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw coreProofError(field);
  return bytes;
}
async function regularInventory(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = prefix + entry.name;
    const file = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await regularInventory(file, `${path}/`));
    else if (entry.isFile()) {
      const bytes = await readFile(file);
      result.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
    } else throw coreProofError(`symlink/nonregular ${path}`);
    if (result.length > 10000) throw coreProofError('inventory budget');
  }
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Fixed-root schema and byte reader. Synthetic controls are not executed-build evidence. */
export async function readCoordinatedCoreProof(root, runId) {
  try { return await readCoreProof(root, runId); }
  catch (error) {
    if (error.message?.startsWith('Browser binding coordinated core proof mismatch:')) throw error;
    throw new Error('Browser binding coordinated core proof mismatch: filesystem/metadata', { cause: error });
  }
}
async function readCoreProof(root, runId) {
  if (!/^[A-Za-z0-9-]{1,100}$/.test(runId)) throw coreProofError('runId');
  const runRelative = `docs/catalog-artifacts/${runId}`;
  const descriptorRelative = `${runRelative}/core-build-proof.json`;
  const descriptorPath = resolve(root, descriptorRelative);
  const info = await lstat(descriptorPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024)
    throw coreProofError('descriptor');
  const descriptor = await readFile(descriptorPath);
  if (!inside(await realpath(root), await realpath(descriptorPath))) throw coreProofError('descriptor confinement');
  let proof;
  try { proof = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptor)); }
  catch { throw coreProofError('descriptor JSON'); }
  exactObject(proof, ['schemaVersion', 'mode', 'runId', 'sourceRoot', 'ownedBuildRoot',
    'sourceInputs', 'sourceInputsAfter', 'dependencyIdentities', 'build', 'outputRoot',
    'outputs', 'packageManifest', 'sourcePathMapping'], 'descriptor schema');
  if (proof.schemaVersion !== 1 || proof.mode !== 'owned-current-core-build-v1' || proof.runId !== runId ||
      typeof proof.sourceRoot !== 'string' || typeof proof.ownedBuildRoot !== 'string' ||
      !isAbsolute(proof.sourceRoot) || !isAbsolute(proof.ownedBuildRoot) || proof.sourceRoot === proof.ownedBuildRoot ||
      proof.outputRoot !== 'core-build-output') throw coreProofError('descriptor identity');
  sortedPins(proof.sourceInputs, 'sourceInputs');
  sortedPins(proof.sourceInputsAfter, 'sourceInputsAfter');
  if (JSON.stringify(proof.sourceInputs) !== JSON.stringify(proof.sourceInputsAfter)) throw coreProofError('sourceInputsAfter');
  for (const required of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'packages/core/package.json', 'packages/core/tsup.config.ts', 'packages/core/tsconfig.json'])
    if (!proof.sourceInputs.some((item) => item.path === required)) throw coreProofError(`missing input ${required}`);
  for (const item of proof.sourceInputs) await exactFile(root, item, `sourceInputs ${item.path}`);
  const currentSrc = await regularInventory(join(root, 'packages/core/src'), 'packages/core/src/');
  if (JSON.stringify(currentSrc) !== JSON.stringify(proof.sourceInputs.filter((item) => item.path.startsWith('packages/core/src/'))))
    throw coreProofError('complete core source inventory');
  proofPin(proof.packageManifest, 'packageManifest');
  if (proof.packageManifest.path !== 'packages/core/package.json' ||
      JSON.stringify(proof.packageManifest) !== JSON.stringify(proof.sourceInputs.find((item) => item.path === proof.packageManifest.path)))
    throw coreProofError('packageManifest');
  const packageBytes = await exactFile(root, proof.packageManifest, 'packageManifest');
  const metadata = JSON.parse(packageBytes.toString('utf8'));
  if (metadata.name !== '@wyreup/core' || metadata.scripts?.build !== 'tsup' || metadata.exports?.['.']?.browser !== './dist/browser/index.js' ||
      metadata.exports?.['.']?.node !== './dist/node/index.js') throw coreProofError('package export map');
  exactObject(proof.sourcePathMapping, ['originalPrefix', 'ownedPrefix', 'logicalPrefix'], 'sourcePathMapping');
  if (proof.sourcePathMapping.originalPrefix !== join(proof.sourceRoot, 'packages/core') ||
      proof.sourcePathMapping.ownedPrefix !== join(proof.ownedBuildRoot, 'packages/core') ||
      proof.sourcePathMapping.logicalPrefix !== 'packages/core/') throw coreProofError('sourcePathMapping');
  exactObject(proof.build, ['argv', 'cwd', 'node', 'environment', 'configPin', 'log', 'outcome'], 'build');
  exactObject(proof.build.node, ['path', 'version', 'bytes', 'sha256'], 'build.node');
  if (typeof proof.build.node.path !== 'string' || !isAbsolute(proof.build.node.path) || !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(proof.build.node.version))
    throw coreProofError('build.node identity');
  proofPin({ path: proof.build.node.path, bytes: proof.build.node.bytes, sha256: proof.build.node.sha256 }, 'build.node', true);
  await externalFile(proof.build.node, 'build.node');
  if (proof.build.node.path !== await realpath(process.execPath) || proof.build.node.version !== process.version)
    throw coreProofError('different Node runtime held');
  if (!Array.isArray(proof.build.argv) || proof.build.argv.length < 2 || proof.build.argv.length > 128 ||
      proof.build.argv.some((arg) => typeof arg !== 'string' || !arg || Buffer.byteLength(arg) > 8192) ||
      proof.build.argv[0] !== proof.build.node.path || proof.build.cwd !== join(proof.ownedBuildRoot, 'packages/core'))
    throw coreProofError('build argv/cwd');
  const allowedEnvironment = new Set(['NODE_ENV', 'CI', 'TZ', 'LANG', 'LC_ALL', 'PATH', 'COREPACK_ENABLE_STRICT']);
  if (!proof.build.environment || Object.getPrototypeOf(proof.build.environment) !== Object.prototype ||
      Object.keys(proof.build.environment).some((key) => !allowedEnvironment.has(key) ||
        typeof proof.build.environment[key] !== 'string' || Buffer.byteLength(proof.build.environment[key]) > 8192))
    throw coreProofError('build environment');
  for (const key of ['configPin', 'log']) {
    proofPin(proof.build[key], `build.${key}`);
    if (!proof.build[key].path.startsWith(`${runRelative}/`) || proof.build[key].bytes <= 0)
      throw coreProofError(`build.${key} confinement/nonempty`);
    await exactFile(root, proof.build[key], `build.${key}`);
  }
  exactObject(proof.build.outcome, ['exitCode', 'signal', 'exitObserved', 'closeObserved', 'logWritersSettled'], 'build.outcome');
  if (proof.build.outcome.exitCode !== 0 || proof.build.outcome.signal !== null ||
      proof.build.outcome.exitObserved !== true || proof.build.outcome.closeObserved !== true ||
      proof.build.outcome.logWritersSettled !== true) throw coreProofError('build outcome');
  if (!Array.isArray(proof.dependencyIdentities) || !proof.dependencyIdentities.length || proof.dependencyIdentities.length > 1024)
    throw coreProofError('dependencyIdentities');
  const owners = new Set();
  const tools = new Set();
  let actualCompiler;
  const installedTsupPackage = await realpath(createRequire(join(root, 'packages/core/package.json')).resolve('tsup/package.json'));
  for (const [index, owner] of proof.dependencyIdentities.entries()) {
    exactObject(owner, ['packageRoot', 'name', 'version', 'packageJson', 'toolPins'], `dependencyIdentities[${index}]`);
    if (typeof owner.packageRoot !== 'string' || !isAbsolute(owner.packageRoot) || owners.has(owner.packageRoot) || typeof owner.name !== 'string' ||
        typeof owner.version !== 'string' || owner.packageJson?.path !== join(owner.packageRoot, 'package.json') ||
        !Array.isArray(owner.toolPins) || owner.toolPins.length > 256) throw coreProofError('dependency owner');
    owners.add(owner.packageRoot);
    proofPin(owner.packageJson, 'dependency packageJson', true);
    const actualMetadata = JSON.parse((await externalFile(owner.packageJson, 'dependency packageJson')).toString('utf8'));
    if (actualMetadata.name !== owner.name || actualMetadata.version !== owner.version) throw coreProofError('dependency metadata');
    if (owner.name === 'tsup' && owner.packageJson.path === installedTsupPackage) {
      if (typeof actualMetadata.bin?.tsup !== 'string') throw coreProofError('tsup executable metadata');
      actualCompiler = await realpath(resolve(owner.packageRoot, actualMetadata.bin.tsup));
    }
    for (const item of owner.toolPins) {
      proofPin(item, 'dependency tool', true);
      if (!inside(owner.packageRoot, item.path) || tools.has(item.path)) throw coreProofError('dependency tool confinement/duplicate');
      await externalFile(item, 'dependency tool');
      tools.add(item.path);
    }
  }
  if (!tools.has(proof.build.argv[1]) || proof.build.argv[1] !== actualCompiler) throw coreProofError('build executable/tool binding');
  sortedPins(proof.outputs, 'outputs');
  if (proof.outputs.some((item) => !/^(browser|node)\//.test(item.path))) throw coreProofError('outputs namespace');
  const outputDirectory = join(root, runRelative, 'core-build-output');
  if ((await realpath(outputDirectory)) !== resolve(await realpath(root), runRelative, 'core-build-output') ||
      !(await lstat(outputDirectory)).isDirectory()) throw coreProofError('archived output root');
  const actualOutputs = await regularInventory(outputDirectory);
  if (JSON.stringify(actualOutputs) !== JSON.stringify(proof.outputs)) throw coreProofError('complete archived output inventory');
  for (const file of ['browser/index.js', 'browser/index.js.map', 'browser/index.d.ts',
    'node/index.js', 'node/index.js.map', 'node/index.d.ts', 'node/index.cjs'])
    if (!proof.outputs.some((item) => item.path === file && item.bytes > 0)) throw coreProofError(`missing output ${file}`);
  return { proof, packageBytes, outputDirectory,
    proofPin: { path: descriptorRelative, bytes: descriptor.length, sha256: sha256(descriptor) } };
}

function policyError(path, detail) {
  return new Error(`Browser binding policy unsupported at ${path}: ${detail}`);
}

/** Serialize only selected returned policy values; public parent reads happen first. */
export function projectBindingPolicy(environment) {
  const config = environment.config;
  const resolveOptions = config.resolve;
  const buildOptions = config.build;
  const workerOptions = config.worker;
  const buildCanonical = buildOptions?.rolldownOptions;
  const workerCanonical = workerOptions?.rolldownOptions;
  const seen = new Set();
  let visited = 0;
  let stringBytes = 0;

  function value(input, path, depth = 0) {
    if (++visited > BINDING_LIMITS.visited || depth > BINDING_LIMITS.depth)
      throw policyError(path, 'walk budget');
    if (input === undefined) return undefinedValue();
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw policyError(path, 'nonfinite number');
      return input;
    }
    if (typeof input === 'string') {
      const bytes = Buffer.byteLength(input);
      if (bytes > BINDING_LIMITS.stringBytes ||
          (stringBytes += bytes) > BINDING_LIMITS.recordBytes)
        throw policyError(path, 'string budget');
      return input;
    }
    if (typeof input !== 'object') throw policyError(path, 'non-data value');
    if (seen.has(input)) throw policyError(path, 'cycle');
    if (Object.getOwnPropertySymbols(input).length) throw policyError(path, 'symbol keys');
    seen.add(input);
    try {
      if (Object.getPrototypeOf(input) === RegExp.prototype) {
        if (Object.getOwnPropertyNames(input).some((key) => key !== 'lastIndex'))
          throw policyError(path, 'extended RegExp');
        const source = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get.call(input);
        const flags = Object.getOwnPropertyDescriptor(RegExp.prototype, 'flags').get.call(input);
        return { kind: 'regexp', source: value(source, `${path}.source`, depth + 1),
          flags: value(flags, `${path}.flags`, depth + 1) };
      }
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype || input.length > BINDING_LIMITS.arrays)
          throw policyError(path, 'array shape/budget');
        const keys = Object.getOwnPropertyNames(input);
        if (keys.length !== input.length + 1 ||
            keys.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))
          throw policyError(path, 'sparse/extended array');
        return Array.from({ length: input.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
          if (!descriptor || !('value' in descriptor)) throw policyError(`${path}[${index}]`, 'accessor/hole');
          return value(descriptor.value, `${path}[${index}]`, depth + 1);
        });
      }
      if (![Object.prototype, null].includes(Object.getPrototypeOf(input)))
        throw policyError(path, 'custom prototype');
      const result = Object.create(null);
      for (const key of Object.getOwnPropertyNames(input)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) throw policyError(path, 'unsafe key');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !('value' in descriptor)) throw policyError(`${path}.${key}`, 'accessor');
        result[key] = value(descriptor.value, `${path}.${key}`, depth + 1);
      }
      return result;
    } finally { seen.delete(input); }
  }

  function selected(parent, key, path) {
    if (parent === undefined) return absent();
    if (parent === null || typeof parent !== 'object') throw policyError(path, 'parent shape');
    const descriptor = Object.getOwnPropertyDescriptor(parent, key);
    if (!descriptor) return absent();
    if (!('value' in descriptor)) throw policyError(path, 'accessor');
    return value(descriptor.value, path, path.split('.').length);
  }
  function fields(parent, names, prefix) {
    return Object.fromEntries(names.map((key) => [key, selected(parent, key, `${prefix}.${key}`)]));
  }
  let aliases = absent();
  if (resolveOptions !== undefined) {
    const descriptor = Object.getOwnPropertyDescriptor(resolveOptions, 'alias');
    if (descriptor) {
      if (!('value' in descriptor)) throw policyError('resolve.alias', 'accessor');
      if (descriptor.value === undefined) aliases = undefinedValue();
      else {
        const entries = descriptor.value;
        if (!Array.isArray(entries) || entries.length > BINDING_LIMITS.aliases)
          throw policyError('resolve.alias', 'array shape/budget');
        // Validate the dense array and each complete entry before projection.
        value(entries, 'resolve.alias', 2);
        aliases = entries.map((entry, index) => {
          const path = `resolve.alias[${index}]`;
          if (!entry || ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) ||
              Object.getOwnPropertyNames(entry).some((key) => !['find', 'replacement', 'customResolver'].includes(key)))
            throw policyError(path, 'unknown entry shape');
          const find = Object.getOwnPropertyDescriptor(entry, 'find');
          const replacement = Object.getOwnPropertyDescriptor(entry, 'replacement');
          const customResolver = Object.getOwnPropertyDescriptor(entry, 'customResolver');
          if (!find || !('value' in find) ||
              !(typeof find.value === 'string' || Object.getPrototypeOf(find.value ?? {}) === RegExp.prototype) ||
              !replacement || !('value' in replacement) || typeof replacement.value !== 'string')
            throw policyError(path, 'find/replacement shape');
          if (customResolver && (!('value' in customResolver) || customResolver.value !== undefined))
            throw policyError(`${path}.customResolver`, 'custom resolver');
          return { find: value(find.value, `${path}.find`, 4),
            replacement: value(replacement.value, `${path}.replacement`, 4),
            customResolver: customResolver ? undefinedValue() : absent() };
        });
      }
    }
  }
  const output = {
    consumer: value(config.consumer, 'consumer', 1),
    command: value(config.command, 'command', 1),
    mode: value(config.mode, 'mode', 1),
    resolve: { ...fields(resolveOptions,
      ['conditions', 'externalConditions', 'mainFields', 'extensions', 'dedupe',
        'preserveSymlinks', 'builtins', 'noExternal', 'external'], 'resolve'), alias: aliases },
    build: { ...fields(buildOptions, ['ssr', 'target', 'outDir'], 'build'),
      rolldownOptions: { external: selected(buildCanonical, 'external', 'build.rolldownOptions.external') } },
    worker: { format: selected(workerOptions, 'format', 'worker.format'),
      rolldownOptions: { external: selected(workerCanonical, 'external', 'worker.rolldownOptions.external') } },
  };
  if (Buffer.byteLength(JSON.stringify(output)) > BINDING_LIMITS.recordBytes)
    throw policyError('policy', 'record byte budget');
  return output;
}

async function pin(file) {
  const path = await realpath(file);
  if (!(await stat(path)).isFile()) throw new Error('Browser binding expected regular file.');
  const bytes = await readFile(path);
  return { path, bytes: bytes.length, sha256: sha256(bytes) };
}

async function probeCore(context, importer) {
  const resolved = await context.resolve('@wyreup/core', importer);
  if (!resolved || typeof resolved.id !== 'string' || resolved.external ||
      !isAbsolute(resolved.id) || resolved.id.includes('\0') || resolved.id.includes('?'))
    return { supported: false, resolved: resolved ? { id: resolved.id, external: Boolean(resolved.external) } : null };
  const entry = await pin(resolved.id);
  let directory = dirname(entry.path);
  while (true) {
    try {
      const packagePin = await pin(join(directory, 'package.json'));
      const metadata = JSON.parse(await readFile(packagePin.path, 'utf8'));
      if (metadata.name !== '@wyreup/core') throw new Error('Browser binding core owner mismatch.');
      if (!inside(directory, entry.path)) throw new Error('Browser binding core entry escape.');
      let map;
      try { map = await pin(`${entry.path}.map`); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return { supported: false, reason: 'resolved entry map missing', packageRoot: directory,
          package: packagePin, name: metadata.name, version: metadata.version, entry };
      }
      return { supported: true, packageRoot: directory, package: packagePin,
        name: metadata.name, version: metadata.version, entry, map };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Browser binding core package owner unavailable.');
    directory = parent;
  }
}

/** Observations only: no worker hook, transform, resolver override or output policy. */
export function createProductionBindingObserver(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
      Object.keys(options).join(',') !== 'runId,observationDir,observerIdentity' ||
      !/^[A-Za-z0-9-]{1,100}$/.test(options.runId) || !isAbsolute(options.observationDir) ||
      !options.observerIdentity || Object.keys(options.observerIdentity).join(',') !== 'relativePath,bytes,sha256' ||
      options.observerIdentity.relativePath !== 'packages/web/test/productionBuildBindingObserver.mjs' ||
      !Number.isSafeInteger(options.observerIdentity.bytes) || options.observerIdentity.bytes <= 0 ||
      !/^[a-f0-9]{64}$/.test(options.observerIdentity.sha256))
    throw new Error('Browser binding run identity mismatch');
  const ownModule = fileURLToPath(import.meta.url);
  const stages = new Set();
  const environments = new Map();
  let sequence = 0;
  let totalBytes = 0;
  let webRoot;
  let queue = Promise.resolve();
  let firstPersistenceError;

  function record(stage, payload) {
    const task = queue.then(async () => {
      if (firstPersistenceError) throw firstPersistenceError;
      if (sequence >= BINDING_LIMITS.records || stages.has(stage))
        throw new Error('Incomplete browser build observation');
      const record = { version: 1, runId: options.runId, sequence, stage, ...payload };
      const bytes = Buffer.from(JSON.stringify(record) + '\n');
      if (bytes.length > BINDING_LIMITS.recordBytes || totalBytes + bytes.length > BINDING_LIMITS.totalBytes)
        throw new Error('Browser binding observation byte budget');
      await writeFile(join(options.observationDir, `${String(sequence).padStart(2, '0')}-${stage}.json`), bytes, { flag: 'wx' });
      stages.add(stage);
      sequence++;
      totalBytes += bytes.length;
      return { bytes: bytes.length, sha256: sha256(bytes) };
    });
    queue = task.catch((error) => { firstPersistenceError ??= error; });
    return task;
  }

  function plugin() {
    return {
      name: 'wyreup:production-binding-observer',
      async buildStart() {
        const name = this.environment.name;
        if (!['prerender', 'client'].includes(name)) return;
        try {
          const policy = projectBindingPolicy(this.environment);
          const core = await probeCore(this, join(webRoot, 'src/pages/tools/[slug].astro'));
          environments.set(name, { policy, core });
          await record(`${name}-start`, { environment: name, policy, core });
        } catch (error) {
          try { await record(`${name}-failure`, { environment: name, error: { name: error.name, message: error.message } }); }
          catch (persistence) { throw new AggregateError([error, persistence], 'Browser binding observation failure persistence'); }
          throw error;
        }
      },
      async buildEnd(error) {
        const name = this.environment.name;
        if (!['prerender', 'client'].includes(name)) return;
        if (error) {
          await record(`${name}-end-failure`, { environment: name, error: { name: error.name, message: error.message } });
          return;
        }
        const prior = environments.get(name);
        if (!prior) throw new Error('Incomplete browser build observation');
        const policy = projectBindingPolicy(this.environment);
        const core = await probeCore(this, join(webRoot, 'src/pages/tools/[slug].astro'));
        if (JSON.stringify(policy) !== JSON.stringify(prior.policy) || JSON.stringify(core) !== JSON.stringify(prior.core))
          throw new Error('Browser binding core environment-map mismatch');
        await record(`${name}-end`, { environment: name, policy, core });
      },
    };
  }

  return {
    name: 'wyreup:production-binding-observer',
    hooks: {
      async 'astro:config:done'({ config }) {
        webRoot = await realpath(fileURLToPath(config.root));
        const observer = await pin(ownModule);
        if (observer.bytes !== options.observerIdentity.bytes || observer.sha256 !== options.observerIdentity.sha256)
          throw new Error('Browser binding generated-config template mismatch');
        const actual = await realpath(options.observationDir);
        if (actual !== options.observationDir || actual.split(sep).at(-1) !== `binding-${options.runId}`)
          throw new Error('Browser binding run identity mismatch');
      },
      'astro:build:setup'({ updateConfig }) {
        // The setup argument is not the final resolved per-environment policy.
        updateConfig({ plugins: [plugin()] });
      },
      async 'astro:build:done'({ dir }) {
        await queue;
        if (firstPersistenceError) throw firstPersistenceError;
        if (!['prerender-start', 'prerender-end', 'client-start', 'client-end'].every((stage) => stages.has(stage)))
          throw new Error('Incomplete browser build observation');
        const observer = await pin(ownModule);
        if (observer.bytes !== options.observerIdentity.bytes || observer.sha256 !== options.observerIdentity.sha256)
          throw new Error('Browser binding generated-config template mismatch');
        const identities = [];
        for (const [environment, prior] of environments) {
          if (prior.core.supported) {
            const entry = await pin(prior.core.entry.path);
            const map = await pin(prior.core.map.path);
            const metadata = await pin(prior.core.package.path);
            if (JSON.stringify([entry, map, metadata]) !== JSON.stringify([prior.core.entry, prior.core.map, prior.core.package]))
              throw new Error('Browser binding core environment-map mismatch');
          }
          identities.push({ environment, core: prior.core });
        }
        await record('build-done', { outputDir: await realpath(fileURLToPath(dir)), observer, identities });
        await queue;
        if (firstPersistenceError) throw firstPersistenceError;
        const terminal = Buffer.from(JSON.stringify({ version: 1, runId: options.runId,
          completed: true, records: sequence, totalBytes, stages: [...stages],
          claimLimits: { consumedModuleGraphObserved: false, moduleLevelViteMapping: false,
            midiWorkerBuildGraphObserved: false, workerDistToEmittedAssociation: false,
            fixedWorkflowOnly: true, servedResponseBodyEquality: false } }) + '\n');
        if (terminal.length > BINDING_LIMITS.recordBytes || totalBytes + terminal.length > BINDING_LIMITS.totalBytes)
          throw new Error('Browser binding observation byte budget');
        await writeFile(join(options.observationDir, 'terminal.json'), terminal, { flag: 'wx' });
      },
    },
  };
}
