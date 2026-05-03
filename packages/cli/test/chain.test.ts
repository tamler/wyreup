/**
 * Tests for the `chain` command — executeChain() and extractStepsFromUrl().
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

vi.mock('node:crypto', () => ({
  randomUUID: () => 'chain-uuid-5678',
}));

// ──── tool mocks ──────────────────────────────────────────────────────────────

const mockStripExifRun = vi.fn();
const mockCompressRun = vi.fn();

const TOOL_STRIP_EXIF = {
  id: 'strip-exif',
  slug: 'strip-exif',
  name: 'Strip EXIF',
  description: 'Remove EXIF metadata',
  category: 'privacy',
  presence: 'both',
  keywords: ['exif', 'metadata'],
  input: { accept: ['image/*'], min: 1, max: 1 },
  output: { mime: 'image/jpeg', multiple: false },
  interactive: false,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',
  run: mockStripExifRun,
  Component: {} as never,
  defaults: {},
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/jpeg'] },
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
  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/jpeg'] },
};

const mockRunChain = vi.fn();
const mockParseChainString = vi.fn();

vi.mock('@wyreup/core', () => ({
  createDefaultRegistry: () => ({
    tools: [TOOL_STRIP_EXIF, TOOL_COMPRESS],
    toolsById: new Map([
      ['strip-exif', TOOL_STRIP_EXIF],
      ['compress', TOOL_COMPRESS],
    ]),
  }),
  runChain: (...args: unknown[]) => mockRunChain(...args) as unknown,
  parseChainString: (...args: unknown[]) => mockParseChainString(...args) as unknown,
}));

// ──── import after mocks ──────────────────────────────────────────────────────

import { executeChain, extractStepsFromUrl } from '../src/commands/chain.js';

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
  mockRunChain.mockReset();
  mockParseChainString.mockReset();
  mockStripExifRun.mockReset();
  mockCompressRun.mockReset();

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

  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──── helpers ─────────────────────────────────────────────────────────────────

function makeImageBlob(): Blob {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
}

function makeChain(steps: string[]): { toolId: string; params: Record<string, unknown> }[] {
  return steps.map((id) => ({ toolId: id, params: {} }));
}

// ──── extractStepsFromUrl ─────────────────────────────────────────────────────

describe('extractStepsFromUrl', () => {
  it('extracts steps param from a full URL', () => {
    const url = 'https://wyreup.com/chain/run?steps=strip-exif%7Ccompress';
    expect(extractStepsFromUrl(url)).toBe('strip-exif|compress');
  });

  it('extracts from URL with bracket params', () => {
    const url = 'https://wyreup.com/chain/run?steps=compress%5Bquality%3D75%5D';
    expect(extractStepsFromUrl(url)).toBe('compress[quality=75]');
  });

  it('returns plain chain string unchanged', () => {
    expect(extractStepsFromUrl('strip-exif|compress')).toBe('strip-exif|compress');
  });

  it('handles steps= prefix without full URL', () => {
    expect(extractStepsFromUrl('steps=strip-exif|compress')).toBe('strip-exif|compress');
  });

  it('handles URL with multiple query params', () => {
    const url = 'https://wyreup.com/chain/run?foo=bar&steps=strip-exif';
    expect(extractStepsFromUrl(url)).toBe('strip-exif');
  });

  it('throws-style error if URL has no steps param', () => {
    // Falls back to returning the URL as a chain string (not a valid chain, but no crash)
    const result = extractStepsFromUrl('https://wyreup.com/chain/run?noSteps=true');
    // URL has no steps= so it returns the raw input as plain chain string
    expect(typeof result).toBe('string');
  });
});

// ──── executeChain — basic ────────────────────────────────────────────────────

describe('executeChain — basic run', () => {
  it('runs a two-step chain and writes to -o', async () => {
    const chain = makeChain(['strip-exif', 'compress']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockRunChain.mockResolvedValue([makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], {
      steps: 'strip-exif|compress',
      output: '/tmp/clean.jpg',
    });

    expect(mockRunChain).toHaveBeenCalledOnce();
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/clean.jpg', expect.any(Buffer));
    expect(exitCode).toBeUndefined();
  });

  it('passes step params to runChain', async () => {
    const chain = [{ toolId: 'compress', params: { quality: 75 } }];
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockRunChain.mockResolvedValue([makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], {
      steps: 'compress[quality=75]',
      output: '/tmp/out.jpg',
    });

    // runChain is called with the parsed chain including params
    expect(mockRunChain).toHaveBeenCalledWith(
      chain,
      expect.any(Array),
      expect.any(Object),
      expect.any(Object),
    );
  });
});

// ──── executeChain — from-url ─────────────────────────────────────────────────

describe('executeChain — --from-url', () => {
  it('parses chain from a URL', async () => {
    const chain = makeChain(['strip-exif', 'compress']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockRunChain.mockResolvedValue([makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], {
      fromUrl: 'https://wyreup.com/chain/run?steps=strip-exif%7Ccompress',
      output: '/tmp/out.jpg',
    });

    // parseChainString called with decoded steps
    expect(mockParseChainString).toHaveBeenCalledWith('strip-exif|compress');
  });
});

// ──── executeChain — error cases ──────────────────────────────────────────────

describe('executeChain — error cases', () => {
  it('exits when no --steps or --from-url given', async () => {
    await expect(executeChain(['/tmp/photo.jpg'], {})).rejects.toThrow('process.exit(1)');
    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/--steps/);
  });

  it('exits when unknown tool in chain', async () => {
    const chain = [{ toolId: 'not-a-tool', params: {} }];
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));

    await expect(
      executeChain(['/tmp/photo.jpg'], { steps: 'not-a-tool' }),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/Unknown tool/);
  });

  it('exits when chain string is empty', async () => {
    mockParseChainString.mockReturnValue([]);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));

    await expect(
      executeChain(['/tmp/photo.jpg'], { steps: '' }),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    // Empty steps string triggers "Provide --steps" message before parse
    expect(stderrOutput.join('')).toMatch(/steps/);
  });

  it('exits when runChain throws', async () => {
    const chain = makeChain(['strip-exif']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));
    mockRunChain.mockRejectedValue(new Error('WASM crash'));

    await expect(
      executeChain(['/tmp/photo.jpg'], { steps: 'strip-exif', output: '/tmp/out.jpg' }),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/Chain error/);
  });

  it('exits when multi-output with no -O', async () => {
    const chain = makeChain(['strip-exif']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));
    mockRunChain.mockResolvedValue([makeImageBlob(), makeImageBlob()]);

    await expect(
      executeChain(['/tmp/photo.jpg'], { steps: 'strip-exif', output: '/tmp/out.jpg' }),
    ).rejects.toThrow('process.exit(1)');

    expect(exitCode).toBe(1);
    expect(stderrOutput.join('')).toMatch(/-O/);
  });
});

// ──── executeChain — multi-output ─────────────────────────────────────────────

describe('executeChain — multi-output', () => {
  it('writes multiple files to -O directory', async () => {
    const chain = makeChain(['strip-exif']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));
    mockRunChain.mockResolvedValue([makeImageBlob(), makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], {
      steps: 'strip-exif',
      outputDir: '/tmp/out-dir',
    });

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/out-dir', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });
});

// ──── executeChain — stdout pipe ──────────────────────────────────────────────

describe('executeChain — stdout pipe', () => {
  it('writes binary output to stdout when stdout is not a TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    const chain = makeChain(['compress']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake-jpeg'));
    mockRunChain.mockResolvedValue([makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], { steps: 'compress' });

    expect(stdoutOutput.length).toBeGreaterThan(0);
    expect(exitCode).toBeUndefined();
  });
});

// ──── executeChain — verbose ──────────────────────────────────────────────────

describe('executeChain — verbose', () => {
  it('does not crash when verbose is true', async () => {
    const chain = makeChain(['compress']);
    mockParseChainString.mockReturnValue(chain);
    mockReadFile.mockResolvedValue(Buffer.from('fake'));
    mockRunChain.mockResolvedValue([makeImageBlob()]);

    await executeChain(['/tmp/photo.jpg'], {
      steps: 'compress',
      output: '/tmp/out.jpg',
      verbose: true,
    });

    expect(exitCode).toBeUndefined();
  });
});
