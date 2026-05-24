import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Auditor } from '../src/audit.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wymcp-audit-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('Auditor [spec §#6]', () => {
  it('is a no-op when path is undefined', async () => {
    const a = new Auditor({ path: undefined, strict: false, apiKey: undefined });
    await a.append({ ts: '2026-05-24T00:00:00.000Z', tool: 'compress', input_paths: ['/a'], status: 'ok', duration_ms: 1 });
  });

  it('creates file with mode 0o600 and appends one JSON line per call', async () => {
    const p = join(dir, 'audit.jsonl');
    const a = new Auditor({ path: p, strict: false, apiKey: undefined });
    await a.append({ ts: '2026-05-24T00:00:00.000Z', tool: 'compress', input_paths: ['/a'], status: 'ok', duration_ms: 1 });
    await a.append({ ts: '2026-05-24T00:00:01.000Z', tool: 'compress', input_paths: ['/b'], status: 'error', duration_ms: 2, error: 'bad' });
    const s = await stat(p);
    expect(s.mode & 0o777).toBe(0o600);
    const lines = (await readFile(p, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as Record<string, unknown>)['tool']).toBe('compress');
    expect((JSON.parse(lines[1]!) as Record<string, unknown>)['error']).toBe('bad');
  });

  it('sanitizes the bearer token from the error field', async () => {
    const p = join(dir, 'audit.jsonl');
    const a = new Auditor({ path: p, strict: false, apiKey: 'wk_secret_xyz' });
    await a.append({ ts: 'x', tool: 't', input_paths: [], status: 'error', duration_ms: 0, error: 'failed at wk_secret_xyz' });
    const line = (await readFile(p, 'utf8')).trim();
    expect(line).not.toContain('wk_secret_xyz');
    expect(line).toContain('[REDACTED]');
  });

  it('does not include params field in serialized line', async () => {
    const p = join(dir, 'audit.jsonl');
    const a = new Auditor({ path: p, strict: false, apiKey: undefined });
    await a.append({ ts: 'x', tool: 't', input_paths: [], status: 'ok', duration_ms: 0 });
    const line = (await readFile(p, 'utf8')).trim();
    expect(JSON.parse(line)).not.toHaveProperty('params');
  });

  it('loose mode swallows write errors (logger called, no throw)', async () => {
    const messages: string[] = [];
    const a = new Auditor({ path: '/nonexistent-dir-xyz/x.jsonl', strict: false, apiKey: undefined, logger: (m) => messages.push(m) });
    await a.append({ ts: 'x', tool: 't', input_paths: [], status: 'ok', duration_ms: 0 });
    expect(messages.join('\n')).toMatch(/audit/i);
  });

  it('strict mode throws on write failure', async () => {
    const a = new Auditor({ path: '/nonexistent-dir-xyz/x.jsonl', strict: true, apiKey: undefined });
    await expect(a.append({ ts: 'x', tool: 't', input_paths: [], status: 'ok', duration_ms: 0 })).rejects.toThrow();
  });
});
