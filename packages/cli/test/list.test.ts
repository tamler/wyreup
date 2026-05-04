import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listCommand } from '../src/commands/list.js';

describe('listCommand', () => {
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(' '));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('runs without throwing', () => {
    expect(() => listCommand()).not.toThrow();
  });

  it('prints a count line and the run-a-tool hint', () => {
    listCommand();
    const all = logs.join('\n');
    expect(all).toMatch(/\d+ tools available/);
    expect(all).toContain('Run a tool:');
    expect(all).toContain('Chain tools:');
  });

  it('groups tools by category and lists known core tools', () => {
    listCommand();
    const all = logs.join('\n');
    // Spot-check stable foundational tools — if these vanish from the
    // CLI surface something has broken upstream in the registry's
    // surface filter.
    expect(all).toContain('compress');
    expect(all).toContain('merge-pdf');
    expect(all).toContain('hash');
  });

  it('includes the geo tools added 2026-05-03', () => {
    listCommand();
    const all = logs.join('\n');
    expect(all).toContain('csv-to-geojson');
    expect(all).toContain('kml-to-geojson');
    expect(all).toContain('convert-geo');
  });

  it('hides web-only capture primitives (surfaces filter)', () => {
    listCommand();
    const all = logs.join('\n');
    // record-audio is surfaces:['web']. It must not appear in CLI.
    expect(all).not.toContain('record-audio');
  });
});
