/**
 * Tests for the `run` command — executeTool() and helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──── fs/promises mock ────────────────────────────────────────────────────────

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args) as unknown,
  writeFile: (...args: unknown[]) => mockWriteFile(...args) as unknown,
  mkdir: (...args: unknown[]) => mockMkdir(...args) as unknown,
}));

// ──── crypto mock ─────────────────────────────────────────────────────────────

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

// ──── registry mock ───────────────────────────────────────────────────────────

const mockHashRun = vi.fn();
const mockCompressRun = vi.fn();
const mockSplitRun = vi.fn();

const TOOL_HASH = {
  id: 'hash',
  slug: 'hash',
  name: 'Hash',
  description: 'Compute hashes of any file',
  category: 'inspect',
  presence: 'both',
  keywords: ['hash', 'sha'],
  input: { accept: ['*/*'], min: 1, max: 1 },
  output: { mime: 'application/json', multiple: false },
  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',
  run: mockHashRun,
  Component: {} as never,
  defaults: { algorithm: 'sha256' },
  paramSchema: {
    algorithm: { type: 'enum' as const, label: 'Algorithm', options: [{ value: 'sha256', label: 'SHA-256' }] },
  },
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/json'] },
};

const TOOL_COMPRESS = {
  id: 'compress',
  slug: 'compress',
  name: 'Compress',
  description: 'Compress an image',
  category: 'optimize',
  presence: 'both',
  keywords: ['compress'],
  input: { accept: ['image/*'], min: 1, max: 1 },
  output: { mime: 'image/jpeg', multiple: false },
  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',
  run: mockCompressRun,
  Component: {} as never,
  defaults: { quality: 80 },
  paramSchema: {
    quality: { type: 'range' as const, min: 1, max: 100 },
  },
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/jpeg'] },
};

const TOOL_SPLIT = {
  id: 'split-pdf',
  slug: 'split-pdf',
  name: 'Split PDF',
  description: 'Split a PDF',
  category: 'pdf',
  presence: 'both',
  keywords: ['split'],
  input: { accept: ['application/pdf'], min: 1, max: 1 },
  output: { mime: 'application/pdf', multiple: true },
  interactive: false,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  run: mockSplitRun,
  Component: {} as never,
  defaults: {},
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['application/pdf'] },
};

const mockToolsById = new Map([
  ['hash', TOOL_HASH],
  ['compress', TOOL_COMPRESS],
  ['split-pdf', TOOL_SPLIT],
]);

vi.mock('@wyreup/core', () => ({
  createDefaultRegistry: () => ({
    tools: [TOOL_HASH, TOOL_COMPRESS, TOOL_SPLIT],
    toolsById: mockToolsById,
  }),
  runChain: vi.fn(),
  parseChainString: vi.fn(),
}));

// ──── import after mocks ──────────────────────────────────────────────────────

import { executeTool, addToolOptions, mergeToolOptions } from '../src/commands/run.js';
import { Command } from 'commander';

// ──── process mock helpers ────────────────────────────────────────────────────

let stderrOutput: string[] = [];
let stdoutOutput: Buffer[] = [];
let exitCode: number | undefined;

beforeEach(() => {
  stderrOutput = [];
  stdoutOutput = [];
  exitCode = undefined;
  mockReadFile.mockReset();
  mockWriteFile.mockReset().mockResolvedValue(undefined);
  mockMkdir.mockReset().mockResolvedValue(undefined);
  mockHashRun.mockReset();
  mockCompressRun.mockReset();
  mockSplitRun.mockReset();

  vi.spyOn(process.stderr, 'write').mockImplementation((s) => {
    stderrOutput.push(typeof s === 'string' ? s : s.toString());
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
    stdoutOutput.push(typeof s === 'string' ? Buffer.from(s) : Buffer.from(s));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code as number;
    throw new Error(`process.exit(${code})`);
  });

  // Default stdin: TTY so stdin-detection doesn't trigger
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──── helpers ─────────────────────────────────────────────────────────────────

function makeJsonBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

function makeImageBlob(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
}

// ──── run — JSON-output tool (hash) ──────────────────────────────────────────

describe('executeTool — hash (JSON output)', () => {
  it('prints JSON to stdout when no -o given', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockHashRun.mockResolvedValue(makeJsonBlob({ sha256: 'abc' }));

    await executeTool('hash', ['/tmp/file.bin'], {});

    const output = stdoutOutput.map((b) => b.toString()).join('');
    expect(output).toContain('"sha256"');
    expect(exitCode).toBeUndefined();
  });

  it('writes output to -o path when provided', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockHashRun.mockResolvedValue(makeJsonBlob({ sha256: 'abc' }));

    await executeTool('hash', ['/tmp/file.bin'], { output: '/tmp/out.json' });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/tmp/out.json',
      expect.any(Buffer),
    );
  });

  it('passes defaults merged with --param overrides', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockHashRun.mockResolvedValue(makeJsonBlob({}));

    await executeTool('hash', ['/tmp/file.bin'], { param: ['algorithm=sha512'] });

    expect(mockHashRun).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ algorithm: 'sha512' }),
      expect.any(Object),
    );
  });

  it('coerces numeric param values', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockCompressRun.mockResolvedValue(makeImageBlob());

    await executeTool('compress', ['/tmp/photo.jpg'], {
      param: ['quality=42'],
      output: '/tmp/out.jpg',
    });

    expect(mockCompressRun).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ quality: 42 }),
      expect.any(Object),
    );
  });
});

// ──── run — binary-output tool (compress) ────────────────────────────────────

describe('executeTool — compress (binary output)', () => {
  it('writes binary blob to -o path', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockCompressRun.mockResolvedValue(makeImageBlob());

    await executeTool('compress', ['/tmp/photo.jpg'], { output: '/tmp/out.jpg' });

    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/out.jpg', expect.any(Buffer));
    expect(exitCode).toBeUndefined();
  });

  it('prints error to stderr when no -o given and stdout is a TTY', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockCompressRun.mockResolvedValue(makeImageBlob());

    await expect(
      executeTool('compress', ['/tmp/photo.jpg'], {}),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    const errText = stderrOutput.join('');
    expect(errText).toMatch(/Use -o/);
  });

  it('writes to stdout when stdout is not a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockCompressRun.mockResolvedValue(makeImageBlob());

    await executeTool('compress', ['/tmp/photo.jpg'], {});

    expect(stdoutOutput.length).toBeGreaterThan(0);
    expect(exitCode).toBeUndefined();
  });
});

// ──── run — multi-output tool (split-pdf) ────────────────────────────────────

describe('executeTool — split-pdf (multi-output)', () => {
  it('writes each output to -O directory', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-pdf'));
    mockSplitRun.mockResolvedValue([
      new Blob(['page1'], { type: 'application/pdf' }),
      new Blob(['page2'], { type: 'application/pdf' }),
    ]);

    await executeTool('split-pdf', ['/tmp/doc.pdf'], { outputDir: '/tmp/pages' });

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/pages', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it('errors when multiple outputs and no -O', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('fake-pdf'));
    mockSplitRun.mockResolvedValue([
      new Blob(['page1'], { type: 'application/pdf' }),
      new Blob(['page2'], { type: 'application/pdf' }),
    ]);

    await expect(
      executeTool('split-pdf', ['/tmp/doc.pdf'], { output: '/tmp/out.pdf' }),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/multiple files/i);
  });
});

// ──── run — unknown tool ──────────────────────────────────────────────────────

describe('executeTool — unknown tool', () => {
  it('exits with error when tool ID not found', async () => {
    await expect(
      executeTool('not-a-real-tool', [], {}),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/Unknown tool/);
  });
});

// ──── run — stdin piping ──────────────────────────────────────────────────────

describe('executeTool — stdin input', () => {
  it('reads from stdin when no positional args given and stdin is not a TTY', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    mockHashRun.mockResolvedValue(makeJsonBlob({ sha256: 'abc' }));

    // Mock stdin as an async iterable
    const chunk = Buffer.from('hello');
    const mockStdin = {
      // eslint-disable-next-line @typescript-eslint/require-await
      [Symbol.asyncIterator]: async function* () { yield chunk; },
    };
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(mockStdin as unknown as typeof process.stdin);

    await executeTool('hash', [], { inputFormat: 'text/plain' });

    expect(mockHashRun).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(File)]),
      expect.any(Object),
      expect.any(Object),
    );
  });
});

// ──── addToolOptions / mergeToolOptions ───────────────────────────────────────

describe('addToolOptions', () => {
  it('adds options from paramSchema to a Command', () => {
    const cmd = new Command('test');
    addToolOptions(cmd, TOOL_HASH as never);
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain('--algorithm');
  });

  it('adds range options from paramSchema', () => {
    const cmd = new Command('test');
    addToolOptions(cmd, TOOL_COMPRESS as never);
    const opts = cmd.options.map((o) => o.long);
    expect(opts).toContain('--quality');
  });

  it('does nothing when no paramSchema', () => {
    const cmd = new Command('test');
    const toolWithoutSchema = { ...TOOL_SPLIT, paramSchema: undefined };
    addToolOptions(cmd, toolWithoutSchema as never);
    expect(cmd.options.length).toBe(0);
  });
});

describe('mergeToolOptions', () => {
  it('extracts named options into param strings', () => {
    const rawOpts = { algorithm: 'sha512', other: 'ignored' };
    const extra = mergeToolOptions(rawOpts, TOOL_HASH as never);
    expect(extra).toContain('algorithm=sha512');
  });

  it('excludes undefined options', () => {
    const rawOpts = { algorithm: undefined };
    const extra = mergeToolOptions(rawOpts, TOOL_HASH as never);
    expect(extra).toHaveLength(0);
  });

  it('returns empty array when no paramSchema', () => {
    const extra = mergeToolOptions({}, TOOL_SPLIT as never);
    expect(extra).toHaveLength(0);
  });
});

// ──── param parsing edge cases ────────────────────────────────────────────────

describe('executeTool — param edge cases', () => {
  it('malformed --param entry emits warning but continues', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockHashRun.mockResolvedValue(makeJsonBlob({}));

    await executeTool('hash', ['/tmp/file.bin'], { param: ['no-equals-sign'] });

    const err = stderrOutput.join('');
    expect(err).toMatch(/malformed/i);
  });

  it('boolean param coercion works', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'));
    mockHashRun.mockResolvedValue(makeJsonBlob({}));

    await executeTool('hash', ['/tmp/file.bin'], { param: ['stripAll=true'] });

    expect(mockHashRun).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ stripAll: true }),
      expect.any(Object),
    );
  });
});
