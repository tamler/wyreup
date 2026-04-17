import { describe, it, expect } from 'vitest';
import { uuidGenerator } from '../../../src/tools/uuid-generator/index.js';
import type { ToolRunContext } from '../../../src/types.js';

function makeCtx(): ToolRunContext {
  return {
    onProgress: () => {},
    signal: new AbortController().signal,
    cache: new Map(),
    executionId: 'test',
  };
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid-generator — metadata', () => {
  it('has id uuid-generator', () => {
    expect(uuidGenerator.id).toBe('uuid-generator');
  });

  it('is in the create category', () => {
    expect(uuidGenerator.category).toBe('create');
  });

  it('requires no file input (min 0, max 0)', () => {
    expect(uuidGenerator.input.min).toBe(0);
    expect(uuidGenerator.input.max).toBe(0);
  });
});

describe('uuid-generator — run()', () => {
  it('generates a valid v4 UUID', async () => {
    const [out] = await uuidGenerator.run([], { version: 4, count: 1 }, makeCtx());
    const uuid = (await out!.text()).trim();
    expect(uuid).toMatch(UUID_V4_RE);
  });

  it('count > 1 produces that many UUIDs (one per line)', async () => {
    const [out] = await uuidGenerator.run([], { version: 4, count: 5 }, makeCtx());
    const lines = (await out!.text()).trim().split('\n');
    expect(lines.length).toBe(5);
    for (const line of lines) {
      expect(line.trim()).toMatch(UUID_V4_RE);
    }
  });

  it('each UUID is unique', async () => {
    const [out] = await uuidGenerator.run([], { version: 4, count: 20 }, makeCtx());
    const lines = (await out!.text()).trim().split('\n').map((l) => l.trim());
    const unique = new Set(lines);
    expect(unique.size).toBe(20);
  });

  it('output MIME type is text/plain', async () => {
    const [out] = await uuidGenerator.run([], { version: 4, count: 1 }, makeCtx());
    expect(out!.type).toBe('text/plain');
  });
});
