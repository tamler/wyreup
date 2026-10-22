import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubbedEnv } from '../src/supervisor.js';
import type { WorkerJob } from '../src/worker-types.js';

const workerPath = fileURLToPath(new URL('../dist/worker.js', import.meta.url));
const html = '<div><b>hello</b></div>';
const formattedHtml = '<div><b>hello</b></div>\n';

async function runActualWorker(job: WorkerJob) {
  return await new Promise<{
    message: unknown;
    code: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
  }>((resolve, reject) => {
    const child = fork(workerPath, [], {
      silent: true,
      env: scrubbedEnv(),
      execArgv: process.execArgv.filter((flag) => flag.split('=')[0] === '--enable-source-maps'),
    });
    let message: unknown;
    let stderr = '';
    child.stderr?.on('data', (bytes: Buffer) => {
      stderr = (stderr + bytes.toString('utf8')).slice(-8192);
    });
    child.once('message', (result: unknown) => {
      message = result;
    });
    const deadline = setTimeout(() => child.kill('SIGTERM'), 12000);
    child.once('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(deadline);
      resolve({ message, code, signal, stderr });
    });
    child.send(job);
  });
}

describe('actual default MCP worker MIME admission and output naming', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'wyreup-worker-mime-')));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function job(toolId: string, inputPath: string, params: Record<string, unknown>): WorkerJob {
    return {
      toolId,
      inputPaths: [inputPath],
      params,
      timeoutMs: 10000,
      proOrigin: 'https://wyreup.com',
      modelCdn: null,
      modelAllowedOrigins: [],
      allowedRoots: [directory],
      allowOverwrite: false,
      maxBytes: 1024 * 1024,
    };
  }

  it.each(['html', 'htm', 'HTM'])(
    'formats equal .%s bytes to the exact complete HTML text',
    async (extension) => {
      const inputPath = join(directory, `input.${extension}`);
      await writeFile(inputPath, html);
      const result = await runActualWorker(job('code-beautifier', inputPath, { language: 'html' }));
      expect(result).toEqual({
        message: { ok: true, writtenPaths: [], textOutput: formattedHtml },
        code: 0,
        signal: null,
        stderr: '',
      });
    },
    20000,
  );

  it.each(['gif', 'bmp', 'svg', 'ico'])(
    'preserves .%s MIME through real Base64 byte conversion and output_dir',
    async (extension) => {
      // These are encoded arbitrary bytes, not valid image fixtures. The actual
      // converter preserves File MIME; this control makes no image-validation claim.
      const inputPath = join(directory, `encoded.${extension}`);
      await writeFile(inputPath, 'AAH/fw==');
      const expectedOutput = join(directory, `base64-0.${extension}`);
      const result = await runActualWorker({
        ...job('base64', inputPath, { mode: 'decode', encodeOutput: 'raw', urlSafe: false }),
        outputDir: directory,
      });
      expect(result).toEqual({
        message: { ok: true, writtenPaths: [expectedOutput] },
        code: 0,
        signal: null,
        stderr: '',
      });
      expect([...(await readFile(expectedOutput))]).toEqual([0, 1, 255, 127]);
    },
    20000,
  );

  it('keeps the worker read allowlist active', async () => {
    const inputPath = join(directory, 'blocked.html');
    await writeFile(inputPath, html);
    const result = await runActualWorker({
      ...job('code-beautifier', inputPath, { language: 'html' }),
      allowedRoots: [],
    });
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    expect(result.message).toEqual({
      ok: false,
      error: `Path outside allowed roots: ${inputPath} (resolved: ${inputPath}). Allowed: `,
      stage: 'validate',
    });
  }, 20000);
});
