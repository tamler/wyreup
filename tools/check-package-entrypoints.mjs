import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import ts from 'typescript';

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageDir = join(root, 'packages/core');

function fail(message) {
  process.stderr.write(`Package entrypoint check failed: ${message}\n`);
  process.exitCode = 1;
}

const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
const declaredTypes = new Set([manifest.types, manifest.exports?.['.']?.types].filter(Boolean));

const packCache = await mkdtemp(join(tmpdir(), 'wyreup-npm-pack-cache-'));
let stdout;
try {
  ({ stdout } = await execFileAsync('npm', ['pack', '--json', '--dry-run'], {
    cwd: packageDir,
    env: { ...process.env, npm_config_cache: packCache },
    maxBuffer: 16 * 1024 * 1024,
  }));
} finally {
  await rm(packCache, { recursive: true, force: true });
}
const parsedPackResult = JSON.parse(stdout);
const packResult = Array.isArray(parsedPackResult)
  ? parsedPackResult[0]
  : (parsedPackResult[manifest.name] ?? Object.values(parsedPackResult)[0]);
if (!packResult?.files) throw new Error('npm pack did not return a package file list');
const packedPaths = new Set(packResult.files.map((file) => file.path));

for (const target of declaredTypes) {
  const packedPath = target.replace(/^\.\//, '');
  if (!packedPaths.has(packedPath)) {
    fail(`${target} is declared as a type entrypoint but is absent from the npm tarball`);
  }
}

const consumerDir = await mkdtemp(join(tmpdir(), 'wyreup-packed-consumer-'));
try {
  const scopeDir = join(consumerDir, 'node_modules/@wyreup');
  await mkdir(scopeDir, { recursive: true });
  await symlink(
    packageDir,
    join(scopeDir, 'core'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const consumer = join(consumerDir, 'index.ts');
  await writeFile(
    consumer,
    "import { createDefaultRegistry } from '@wyreup/core';\ncreateDefaultRegistry();\n",
  );

  const options = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
  };
  const program = ts.createProgram([consumer], options);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const host = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => consumerDir,
      getNewLine: () => '\n',
    };
    fail(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  }

  const resolved = ts.resolveModuleName('@wyreup/core', consumer, options, ts.sys).resolvedModule;
  if (!resolved?.isExternalLibraryImport || !resolved.resolvedFileName.endsWith('index.d.ts')) {
    fail(
      `TypeScript did not resolve @wyreup/core to a declaration file: ${resolved?.resolvedFileName}`,
    );
  } else {
    process.stdout.write(
      `Package entrypoint OK: ${relative(root, resolved.resolvedFileName.replace(consumerDir, packageDir))}\n`,
    );
  }
} finally {
  await rm(consumerDir, { recursive: true, force: true });
}
