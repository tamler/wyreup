import { afterAll, beforeAll, expect, it } from 'vitest';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';

const execute = promisify(execFile);
let directory: string;
let entry: string;
const children = new Set<ReturnType<typeof spawn>>();
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wyreup-params-file-admission-'));
  entry = join(directory, 'params-reader.mjs');
  const coreEntry = import.meta.resolve('@wyreup/core');
  await build({
    entryPoints: [new URL('../src/lib/tool-params.ts', import.meta.url).pathname],
    outfile: entry, bundle: true, platform: 'node', format: 'esm',
    plugins: [{ name: 'actual-public-core', setup(builder) {
      builder.onResolve({ filter: /^@wyreup\/core$/ }, () => ({ path: coreEntry, external: true }));
    } }],
  });
  await execute(process.execPath, ['--check', entry]);
});
afterAll(() => {
  for (const child of children) child.kill('SIGTERM');
});

async function probe(path: string, stdin?: number) {
  const program = `import {readToolParamsJson} from ${JSON.stringify(new URL(`file://${entry}`).href)};
console.log('STARTED');
try { const result = await readToolParamsJson(process.argv[1], new AbortController().signal); console.log(JSON.stringify({accepted:result})); }
catch (error) { console.log(JSON.stringify({refused:error.message})); }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, path], {
    stdio: [stdin ?? 'ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout?.on('data', (bytes: Buffer) => { stdout += bytes.toString(); });
  child.stderr?.on('data', (bytes: Buffer) => { stderr += bytes.toString(); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 2000);
  try {
    const status = await exited;
    const observation = { path, timedOut, stdout, stderr, ...status };
    await writeFile(join(directory, `observation-${children.size}-${path.replace(/[^a-z0-9]/gi, '_')}.json`), JSON.stringify(observation, null, 2));
    return observation;
  } finally { clearTimeout(timer); children.delete(child); }
}

it('refuses a real FIFO before any blocking read or writer', async () => {
  const path = join(directory, 'params.fifo');
  await execute('mkfifo', [path]);
  const result = await probe(path);
  expect(result.stdout).toContain('STARTED');
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('regular file');
  expect(result.stdout).not.toContain('accepted');
});

it('refuses descriptor/stdin aliases even when stdin is an actual regular JSON file', async () => {
  const path = join(directory, 'stdin.json');
  await writeFile(path, '{"stdinCanary":"must not be consumed"}');
  const input = await open(path, 'r');
  try {
    for (const alias of ['/dev/fd/0', '/dev/stdin']) {
      const result = await probe(alias, input.fd);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('refused');
      expect(result.stdout).not.toContain('stdinCanary');
    }
    expect(await input.readFile('utf8')).toBe('{"stdinCanary":"must not be consumed"}');
  } finally { await input.close(); }
});

it('refuses the same regular inode as stdin through its ordinary file path', async () => {
  const path = join(directory, 'shared-stdin.json');
  await writeFile(path, '{"stdinCanary":"must not be consumed"}');
  const input = await open(path, 'r');
  try {
    const result = await probe(path, input.fd);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('refused');
    expect(result.stdout).not.toContain('stdinCanary');
  } finally { await input.close(); }
});

it('retains an ordinary independent regular UTF8 object file', async () => {
  const path = join(directory, 'ordinary.json');
  await writeFile(path, '{"amount":"1.25","count":2}');
  const result = await probe(path);
  expect(result.timedOut).toBe(false);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('"accepted":{"amount":"1.25","count":2}');
  expect(await readFile(path, 'utf8')).toBe('{"amount":"1.25","count":2}');
});
