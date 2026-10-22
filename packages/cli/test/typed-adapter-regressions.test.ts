import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeTool } from '../src/commands/run.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stdout: string[] = [];
const stderr: string[] = [];
beforeEach(() => {
  stdout.length = 0;
  stderr.length = 0;
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Error(`exit ${code}`);
  });
  vi.spyOn(process, 'on').mockReturnValue(process);
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

describe('actual public cron tool through CLI parameter admission', () => {
  it('preserves a numeric-looking cron string and exact next run', async () => {
    await executeTool('cron-from-text', [], {
      param: ['mode=fields', 'minute=5', 'currentDate=2026-01-01T00:00:00Z', 'nextCount=1'],
    });
    expect(stderr.join('')).toBe('');
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      cron: '5 * * * *',
      nextRuns: ['2026-01-01T00:05:00.000Z'],
    });
  });
  it('reads a real JSON file, then applies ordered overrides and named flags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wyreup-cli-params-'));
    try {
      const path = join(directory, 'params.json');
      await writeFile(
        path,
        JSON.stringify({
          mode: 'fields',
          minute: '5',
          nextCount: 2,
          currentDate: '2026-01-01T00:00:00Z',
        }),
      );
      await executeTool('cron-from-text', [], {
        paramsJson: path,
        param: ['minute=6', 'nextCount=2', 'nextCount=1'],
        namedFlags: { minute: '7' },
      });
      expect(JSON.parse(stdout.join(''))).toMatchObject({
        cron: '7 * * * *',
        nextRuns: ['2026-01-01T00:07:00.000Z'],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('refuses a real web-only tool before trying to read its payload path', async () => {
    await expect(executeTool('gamepad-tester', ['/does-not-exist'], {})).rejects.toThrow('exit 1');
    expect(stderr.join('')).toContain('not available on CLI');
    expect(stderr.join('')).not.toContain('ENOENT');
    expect(stdout).toEqual([]);
  });
  it('passes a generator row string once and emits complete literal robots output', async () => {
    await executeTool('robots-txt-generator', [], {
      param: [
        'groupsJson=[{"userAgent":"Bot","rule":"Allow","path":"/public"}]',
        'sitemapsJson=[{"url":"https://example.com/map.xml"}]',
      ],
    });
    expect(stdout.join('')).toBe(
      'User-agent: Bot\nAllow: /public\n\nSitemap: https://example.com/map.xml\n',
    );
  });
});
